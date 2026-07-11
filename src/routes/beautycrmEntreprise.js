const express = require('express')
const router = express.Router()
const pool = require('../config/db')
const auth = require('../middleware/auth')
const { encrypt, decrypt } = require('../utils/cryptoServer')
const { exchangeCodeForTokens, getAccessTokenFromRefresh, findFile, readFile, writeFile, revokeToken, deleteFile } = require('../utils/googleDrive')
const transporter = require('../config/mailer')

const SUPPORT_EMAIL = 'supportizi26@gmail.com'
const SUPPORT_WHATSAPP = '+243997245614'

const BEAUTYCRM_SECRET = process.env.BEAUTYCRM_SECRET || 'beautycrm_izi360_2026'
const SHARED_FILE_NAME = 'beautycrm-entreprise-data.json'
const CALLMEBOT_APIKEY = process.env.CALLMEBOT_APIKEY || ''

async function notifierAdmin({ adminWhatsapp, adminEmail, sujet, message }) {
  try {
    if (adminWhatsapp && CALLMEBOT_APIKEY) {
      const phone = adminWhatsapp.replace(/[^0-9]/g, '')
      const url = 'https://api.callmebot.com/whatsapp.php?phone=' + phone + '&text=' + encodeURIComponent(message) + '&apikey=' + CALLMEBOT_APIKEY
      await fetch(url).catch(e => console.error('CallMeBot erreur:', e.message))
    }
    if (adminEmail) {
      await transporter.sendMail({
        from: SUPPORT_EMAIL,
        to: adminEmail,
        subject: sujet,
        text: message,
      }).catch(e => console.error('Email notif erreur:', e.message))
    }
  } catch (e) {
    console.error('notifierAdmin erreur:', e.message)
  }
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

function genCode6() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// 1. Point de depart : le frontend redirige l'admin ici pour lancer la connexion Google (flux Authorization Code)
router.get('/oauth-start', (req, res) => {
  const { admin_email } = req.query
  if (!admin_email) return res.status(400).send('admin_email requis')
  if (!isValidEmail(admin_email)) return res.status(400).send('Email invalide')

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: 'https://izi360-backend.vercel.app/api/beautycrm/entreprise/oauth-callback',
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: 'https://www.googleapis.com/auth/drive.file',
    state: admin_email,
  })
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
})

// 1bis. Meme principe mais pour la sauvegarde personnelle (n'importe quel utilisateur, pas seulement admin entreprise)
// L'email n'est pas requis en amont : il est decouvert apres consentement via l'API userinfo de Google.
router.get('/oauth-start-personal', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: 'https://izi360-backend.vercel.app/api/beautycrm/entreprise/oauth-callback',
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
    state: 'personal',
  })
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
})

// 2. Google redirige ici apres consentement (gere a la fois le flux entreprise et le flux personnel)
router.get('/oauth-callback', async (req, res) => {
  const { code, state, error } = req.query
  if (error) return res.send(`<h2>Connexion annulee</h2><p>${error}</p>`)
  if (!code || !state) return res.status(400).send('Parametres manquants')

  const isPersonal = state === 'personal'

  try {
    const tokens = await exchangeCodeForTokens(code)
    if (!tokens.refresh_token) {
      return res.send(`<h2>Erreur</h2><p>Aucun refresh_token recu. Revoquez l'acces sur myaccount.google.com/permissions puis reessayez.</p>`)
    }
    const encrypted = encrypt(tokens.refresh_token)

    let emailUtilisateur, nomUtilisateur, photoUtilisateur
    if (isPersonal) {
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
      const info = await infoRes.json()
      if (!info.email) return res.send('<h2>Erreur</h2><p>Impossible de recuperer votre email Google.</p>')
      emailUtilisateur = info.email
      nomUtilisateur = info.name || info.email
      photoUtilisateur = info.picture || ''

      await pool.query(`
        INSERT INTO beautycrm_users_drive (email, refresh_token_encrypted)
        VALUES ($1, $2)
        ON CONFLICT (email) DO UPDATE SET refresh_token_encrypted = EXCLUDED.refresh_token_encrypted, updated_at = NOW()
      `, [emailUtilisateur, encrypted])
    } else {
      emailUtilisateur = state
      if (!isValidEmail(emailUtilisateur)) return res.status(400).send('Email invalide')
      await pool.query(`
        INSERT INTO beautycrm_entreprises (admin_email, refresh_token_encrypted)
        VALUES ($1, $2)
        ON CONFLICT (admin_email) DO UPDATE SET refresh_token_encrypted = EXCLUDED.refresh_token_encrypted, updated_at = NOW()
      `, [emailUtilisateur, encrypted])
    }

    const messageType = isPersonal ? 'izi360_personal_drive_connected' : 'izi360_drive_connected'
    const payload = isPersonal
      ? { type: messageType, email: emailUtilisateur, name: nomUtilisateur, picture: photoUtilisateur }
      : { type: messageType, admin_email: emailUtilisateur }
    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;">
      <h2>✅ Connexion reussie</h2>
      <p>Cette fenetre va se fermer automatiquement...</p>
      <script>
        if (window.opener) {
          window.opener.postMessage(${JSON.stringify(payload)}, '*');
        }
        setTimeout(function() { window.close(); }, 800);
      </script>
    </body></html>`)
  } catch (e) {
    console.error(e)
    res.status(500).send('<h2>Erreur serveur</h2><p>' + e.message + '</p>')
  }
})

// 2bis. Le frontend appelle cette route a chaque fois qu'il a besoin d'un token d'acces Drive valide
// (le refresh_token stocke cote serveur permet de ne jamais redemander de connexion a l'utilisateur)
router.post('/drive-token-personal', async (req, res) => {
  try {
    const { secret, email } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    if (!email) return res.status(400).json({ message: 'email requis' })

    const result = await pool.query('SELECT refresh_token_encrypted FROM beautycrm_users_drive WHERE email=$1', [email])
    if (result.rows.length === 0) return res.status(404).json({ message: 'Aucune connexion Drive personnelle trouvee' })

    const refreshToken = decrypt(result.rows[0].refresh_token_encrypted)
    const accessToken = await getAccessTokenFromRefresh(refreshToken)
    res.json({ access_token: accessToken })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: e.message || 'Erreur serveur' })
  }
})

// Verifie si un utilisateur a deja une connexion Drive personnelle active
router.post('/drive-status-personal', async (req, res) => {
  try {
    const { secret, email } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    if (!email) return res.status(400).json({ message: 'email requis' })
    const result = await pool.query('SELECT email FROM beautycrm_users_drive WHERE email=$1', [email])
    res.json({ connected: result.rows.length > 0 })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// 3. Admin genere un code d'invitation
router.post('/generate-code', async (req, res) => {
  try {
    const { secret, admin_email, admin_whatsapp } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    if (!admin_email) return res.status(400).json({ message: 'admin_email requis' })
    if (!isValidEmail(admin_email)) return res.status(400).json({ message: 'Email invalide' })
    if (admin_whatsapp) {
      await pool.query('UPDATE beautycrm_entreprises SET admin_whatsapp=$1 WHERE admin_email=$2', [admin_whatsapp, admin_email])
    }

    const existing = await pool.query('SELECT refresh_token_encrypted FROM beautycrm_entreprises WHERE admin_email=$1', [admin_email])
    if (!existing.rows[0]?.refresh_token_encrypted) {
      return res.status(400).json({ message: 'Connectez d\'abord Google Drive (mode entreprise) avant de generer un code.' })
    }

    let code, unique = false
    while (!unique) {
      code = genCode6()
      const clash = await pool.query('SELECT id FROM beautycrm_entreprises WHERE code=$1 AND code_used=false AND code_expiry > $2', [code, Date.now()])
      if (clash.rows.length === 0) unique = true
    }
    const expiry = Date.now() + 15 * 60 * 1000

    await pool.query('UPDATE beautycrm_entreprises SET code=$1, code_expiry=$2, code_used=false, updated_at=NOW() WHERE admin_email=$3', [code, expiry, admin_email])

    res.json({ code, expiry })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// 4. Employe rejoint avec un code
router.post('/set-devise', async (req, res) => {
  try {
    const { secret, admin_email, devise } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    if (!admin_email || !devise) return res.status(400).json({ message: 'Champs manquants' })
    await pool.query('UPDATE beautycrm_entreprises SET devise=$1 WHERE admin_email=$2', [devise, admin_email])
    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

router.post('/set-facture', async (req, res) => {
  try {
    const { secret, admin_email, nom, adresse, telephone, email, logo } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    if (!admin_email) return res.status(400).json({ message: 'Champs manquants' })
    await pool.query(
      'UPDATE beautycrm_entreprises SET fact_nom=$1, fact_adresse=$2, fact_telephone=$3, fact_email=$4, fact_logo=$5 WHERE admin_email=$6',
      [nom || '', adresse || '', telephone || '', email || '', logo || '', admin_email]
    )
    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

router.post('/check-email', async (req, res) => {
  try {
    const { secret, email: emailRaw } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    if (!emailRaw) return res.status(400).json({ message: 'Email requis' })
    const email = emailRaw.trim().toLowerCase()

    const adminRow = await pool.query('SELECT admin_email FROM beautycrm_entreprises WHERE LOWER(TRIM(admin_email))=$1', [email])
    if (adminRow.rows.length > 0) {
      return res.json({ found: true, role: 'admin', admin_email: adminRow.rows[0].admin_email })
    }

    const empRow = await pool.query(
      'SELECT admin_email, poste, id FROM beautycrm_employes WHERE LOWER(TRIM(email))=$1 AND revoked=false AND vole=false ORDER BY joined_at DESC LIMIT 1',
      [email]
    )
    if (empRow.rows.length > 0) {
      return res.json({ found: true, role: 'employe', admin_email: empRow.rows[0].admin_email, poste: empRow.rows[0].poste, employe_id: empRow.rows[0].id })
    }

    return res.json({ found: false })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

router.post('/join', async (req, res) => {
  try {
    const { secret, code, nom, poste, email } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    if (!code || !nom || !poste) return res.status(400).json({ message: 'Champs manquants' })

    const result = await pool.query(
      'SELECT admin_email FROM beautycrm_entreprises WHERE code=$1 AND code_used=false AND code_expiry > $2',
      [code, Date.now()]
    )
    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Code invalide ou expire' })
    }
    const admin_email = result.rows[0].admin_email

    await pool.query('UPDATE beautycrm_entreprises SET code_used=true WHERE admin_email=$1', [admin_email])

    // Si un employe du meme nom existe deja marque vole/perdu, on le reactive au lieu d'en creer un nouveau (evite les doublons)
    const existingVole = await pool.query(
      'SELECT id FROM beautycrm_employes WHERE admin_email=$1 AND nom=$2 AND vole=true AND revoked=false',
      [admin_email, nom]
    )
    let employeId
    if (existingVole.rows.length > 0) {
      employeId = existingVole.rows[0].id
      await pool.query(
        'UPDATE beautycrm_employes SET poste=$1, vole=false, vole_code=NULL, vole_code_expiry=NULL, email=$2 WHERE id=$3',
        [poste, email || null, employeId]
      )
    } else {
      const inserted = await pool.query('INSERT INTO beautycrm_employes (admin_email, nom, poste, email) VALUES ($1,$2,$3,$4) RETURNING id', [admin_email, nom, poste, email || null])
      employeId = inserted.rows[0].id
    }

    const entRow = await pool.query('SELECT admin_whatsapp, devise, fact_nom, fact_adresse, fact_telephone, fact_email, fact_logo FROM beautycrm_entreprises WHERE admin_email=$1', [admin_email])
    const er = entRow.rows[0] || {}

    res.json({
      success: true, admin_email, employe_id: employeId,
      admin_whatsapp: er.admin_whatsapp || null, devise: er.devise || null,
      facture: { nom: er.fact_nom || '', adresse: er.fact_adresse || '', telephone: er.fact_telephone || '', email: er.fact_email || '', logo: er.fact_logo || '' },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// 5. Liste des employes (pour l'admin)
router.post('/employes', async (req, res) => {
  try {
    const { secret, admin_email } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    const result = await pool.query('SELECT id, nom, poste, joined_at, vole, vole_code, vole_code_expiry FROM beautycrm_employes WHERE admin_email=$1 AND revoked=false AND vole=false ORDER BY joined_at DESC', [admin_email])
    res.json(result.rows)
  } catch (e) { res.status(500).json({ message: 'Erreur serveur' }) }
})

// 6. Revoquer un employe
router.post('/revoke-employe', async (req, res) => {
  try {
    const { secret, admin_email, employe_id, motif } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    await pool.query('UPDATE beautycrm_employes SET revoked=true, motif_revocation=$1, revoked_at=NOW() WHERE id=$2 AND admin_email=$3', [motif || '', employe_id, admin_email])
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: 'Erreur serveur' }) }
})

// 6d. Marquer un employe comme "vole/perdu" (genere un code de deverrouillage a transmettre manuellement)
router.post('/marquer-vole', async (req, res) => {
  try {
    const { secret, admin_email, employe_id } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    if (!admin_email || !employe_id) return res.status(400).json({ message: 'Champs manquants' })

    const code = genCode6()
    const expiry = Date.now() + 48 * 60 * 60 * 1000 // 48h pour transmettre le code

    const result = await pool.query(
      'UPDATE beautycrm_employes SET vole=true, vole_code=$1, vole_code_expiry=$2 WHERE id=$3 AND admin_email=$4 RETURNING id',
      [code, expiry, employe_id, admin_email]
    )
    if (result.rows.length === 0) return res.status(404).json({ message: 'Employe introuvable' })

    res.json({ success: true, code, expiry })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// 6e. L'employe (ou la personne qui a le telephone) confirme son identite avec le code transmis par l'admin
router.post('/verifier-vole', async (req, res) => {
  try {
    const { secret, admin_email, employe_id, code } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    if (!admin_email || !employe_id || !code) return res.status(400).json({ message: 'Champs manquants' })

    const result = await pool.query(
      'SELECT vole_code, vole_code_expiry FROM beautycrm_employes WHERE id=$1 AND admin_email=$2',
      [employe_id, admin_email]
    )
    if (result.rows.length === 0) return res.status(404).json({ message: 'Employe introuvable' })

    const row = result.rows[0]
    if (!row.vole_code || row.vole_code_expiry < Date.now()) {
      return res.status(400).json({ success: false, message: 'Code expire. Contactez l administrateur.' })
    }
    if (String(code).trim() !== row.vole_code) {
      return res.status(400).json({ success: false, message: 'Code incorrect.' })
    }

    await pool.query('UPDATE beautycrm_employes SET vole=false, vole_code=NULL, vole_code_expiry=NULL WHERE id=$1', [employe_id])
    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// 6f. Liste des employes voles/perdus (pour l'onglet dedie de l'admin)
router.post('/employes-voles', async (req, res) => {
  try {
    const { secret, admin_email } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    const result = await pool.query('SELECT id, nom, poste, joined_at, vole_code, vole_code_expiry FROM beautycrm_employes WHERE admin_email=$1 AND revoked=false AND vole=true ORDER BY joined_at DESC', [admin_email])
    res.json(result.rows)
  } catch (e) { res.status(500).json({ message: 'Erreur serveur' }) }
})

// 6c. Liste des employes revoques (pour le menu "Anciens employes" de l'admin)
router.post('/employes-revoques', async (req, res) => {
  try {
    const { secret, admin_email } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    const result = await pool.query('SELECT id, nom, poste, joined_at, motif_revocation, revoked_at FROM beautycrm_employes WHERE admin_email=$1 AND revoked=true ORDER BY revoked_at DESC', [admin_email])
    res.json(result.rows)
  } catch (e) { res.status(500).json({ message: 'Erreur serveur' }) }
})

// 5b. Admin ferme l'entreprise (desactive le mode entreprise avec un motif communique aux employes)
router.post('/fermer-entreprise', async (req, res) => {
  try {
    const { secret, admin_email, motif } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    if (!admin_email) return res.status(400).json({ message: 'admin_email requis' })

    const row = await pool.query('SELECT refresh_token_encrypted FROM beautycrm_entreprises WHERE admin_email=$1', [admin_email])
    const encrypted = row.rows[0]?.refresh_token_encrypted
    if (encrypted) {
      try {
        const refreshToken = decrypt(encrypted)
        const accessToken = await getAccessTokenFromRefresh(refreshToken)
        const existing = await findFile(accessToken, SHARED_FILE_NAME)
        if (existing) await deleteFile(accessToken, existing.id)
        await revokeToken(refreshToken)
      } catch (e) {
        console.error('Erreur purge Drive lors de la fermeture (on continue quand meme):', e.message)
      }
    }

    // Fermeture = suppression definitive et immediate (local + Drive + BDD), cascade sur les employes
    await pool.query('DELETE FROM beautycrm_entreprises WHERE admin_email=$1', [admin_email])

    try {
      await transporter.sendMail({
        from: `"IZI360" <${process.env.MAIL_USER}>`,
        to: admin_email,
        subject: 'Fermeture du mode entreprise — BeautyCRM',
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
            <h1 style="color: #1D9E75;">IZI<span style="color: #111">360</span></h1>
            <p>Le mode entreprise de votre compte BeautyCRM a ete ferme et supprime definitivement.</p>
            <p>Toutes les donnees (locales et sur Google Drive) ont ete effacees. Cette action est irreversible.</p>
            ${motif ? `<p><strong>Motif :</strong> ${motif}</p>` : ''}
            <p>Vos employes ne pourront plus acceder aux donnees partagees de l'entreprise.</p>
            <p style="margin-top:24px; color:#888; font-size:13px;">L'equipe BeautyCRM © IZIsoft 2026</p>
          </div>
        `,
      })
    } catch (e) {
      console.error('Erreur envoi email fermeture:', e.message)
    }

    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// 6b. Verifier si un employe a ete revoque (appelé par l'app employe au demarrage)
router.post('/check-status', async (req, res) => {
  try {
    const { secret, admin_email, employe_id } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    if (!admin_email || !employe_id) return res.status(400).json({ message: 'Champs manquants' })

    const result = await pool.query('SELECT revoked, motif_revocation, vole, vole_code_expiry FROM beautycrm_employes WHERE id=$1 AND admin_email=$2', [employe_id, admin_email])
    const entRow = await pool.query('SELECT admin_whatsapp, fermee, motif_fermeture, devise, fact_nom, fact_adresse, fact_telephone, fact_email, fact_logo FROM beautycrm_entreprises WHERE admin_email=$1', [admin_email])
    const ent = entRow.rows[0] || {}
    const facture = { nom: ent.fact_nom || '', adresse: ent.fact_adresse || '', telephone: ent.fact_telephone || '', email: ent.fact_email || '', logo: ent.fact_logo || '' }

    if (ent.fermee) {
      notifierAdmin({
        adminWhatsapp: ent.admin_whatsapp,
        adminEmail: admin_email,
        sujet: 'Alerte: un employe a vu le statut entreprise fermee',
        message: 'Un employe (id ' + employe_id + ') a consulte son statut et l entreprise est marquee comme fermee. Motif: ' + (ent.motif_fermeture || 'aucun'),
      })
      return res.json({ revoked: true, entreprise_fermee: true, admin_whatsapp: ent.admin_whatsapp || null, motif: ent.motif_fermeture || null, devise: ent.devise || null, facture })
    }
    if (result.rows.length === 0) return res.json({ revoked: true, admin_whatsapp: null, motif: null, devise: ent.devise || null, facture })

    if (result.rows[0].revoked === true) {
      notifierAdmin({
        adminWhatsapp: ent.admin_whatsapp,
        adminEmail: admin_email,
        sujet: 'Alerte: employe revoque a tente une connexion',
        message: 'L employe (id ' + employe_id + ') revoque a consulte son statut. Motif: ' + (result.rows[0].motif_revocation || 'aucun'),
      })
    }

    if (result.rows[0].vole === true) {
      return res.json({ revoked: false, vole: true, vole_expiry: result.rows[0].vole_code_expiry, admin_whatsapp: ent.admin_whatsapp || null, devise: ent.devise || null, facture })
    }

    res.json({ revoked: result.rows[0].revoked === true, vole: false, admin_whatsapp: ent.admin_whatsapp || null, motif: result.rows[0].motif_revocation || null, devise: ent.devise || null, facture })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// 7. Sync proxy : lecture/ecriture des donnees partagees (clients, ventes, produits...) sur le Drive de l'admin
router.post('/sync', async (req, res) => {
  try {
    const { secret, admin_email, action, payload } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    if (!admin_email || !action) return res.status(400).json({ message: 'Champs manquants' })

    const row = await pool.query('SELECT refresh_token_encrypted FROM beautycrm_entreprises WHERE admin_email=$1', [admin_email])
    if (!row.rows[0]?.refresh_token_encrypted) {
      return res.status(400).json({ message: 'Entreprise non configuree' })
    }
    const refreshToken = decrypt(row.rows[0].refresh_token_encrypted)
    const accessToken = await getAccessTokenFromRefresh(refreshToken)

    const existing = await findFile(accessToken, SHARED_FILE_NAME)

    if (action === 'download') {
      if (!existing) return res.json({ data: null })
      const data = await readFile(accessToken, existing.id)
      return res.json({ data })
    }

    if (action === 'upload') {
      if (!payload) return res.status(400).json({ message: 'payload requis' })
      await writeFile(accessToken, SHARED_FILE_NAME, payload, existing?.id)
      return res.json({ success: true })
    }

    res.status(400).json({ message: 'action invalide' })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// === ADMIN IZI360 (support) : gestion des suspensions d'entreprise ===

// Liste toutes les entreprises (pour le panneau admin izi360)
router.get('/admin/list', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Acces refuse' })
    const result = await pool.query(`
      SELECT e.admin_email, e.fermee, e.suspendue, e.motif_suspension, e.supprimee, e.motif_suppression, e.deleted_at, e.created_at,
        (SELECT COUNT(*) FROM beautycrm_employes emp WHERE emp.admin_email = e.admin_email AND emp.revoked=false) as nb_employes
      FROM beautycrm_entreprises e ORDER BY e.created_at DESC
    `)
    res.json(result.rows)
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// Suspendre une entreprise (support izi360)
router.post('/admin/suspend', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Acces refuse' })
    const { admin_email, motif } = req.body
    if (!admin_email) return res.status(400).json({ message: 'admin_email requis' })
    await pool.query('UPDATE beautycrm_entreprises SET suspendue=true, motif_suspension=$1, suspended_at=NOW() WHERE admin_email=$2', [motif || '', admin_email])
    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// Supprimer definitivement une entreprise (support izi360) — marque seulement pour l'instant,
// la purge reelle (Drive + BDD) se fait quand l'admin clique "Fermer" via /purge-supprimee
router.post('/admin/delete', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Acces refuse' })
    const { admin_email, motif } = req.body
    if (!admin_email) return res.status(400).json({ message: 'admin_email requis' })
    const result = await pool.query('UPDATE beautycrm_entreprises SET supprimee=true, motif_suppression=$1, deleted_at=NOW() WHERE admin_email=$2 RETURNING id', [motif || '', admin_email])
    if (result.rows.length === 0) return res.status(404).json({ message: 'Entreprise introuvable' })
    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// Reactiver une entreprise suspendue
router.post('/admin/unsuspend', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Acces refuse' })
    const { admin_email } = req.body
    if (!admin_email) return res.status(400).json({ message: 'admin_email requis' })
    await pool.query('UPDATE beautycrm_entreprises SET suspendue=false, motif_suspension=NULL, suspended_at=NULL WHERE admin_email=$1', [admin_email])
    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// Purge definitive : appelee par l'app quand l'admin clique "Fermer" sur l'ecran "entreprise supprimee"
// Supprime le fichier Drive, revoque le token Google, puis supprime la ligne BDD (cascade sur les employes)
router.post('/purge-supprimee', async (req, res) => {
  try {
    const { secret, admin_email } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    if (!admin_email) return res.status(400).json({ message: 'admin_email requis' })

    const row = await pool.query('SELECT supprimee, refresh_token_encrypted FROM beautycrm_entreprises WHERE admin_email=$1', [admin_email])
    const ent = row.rows[0]
    if (!ent) return res.json({ success: true }) // deja purgee
    if (!ent.supprimee) return res.status(400).json({ message: 'Cette entreprise n est pas marquee comme supprimee' })

    if (ent.refresh_token_encrypted) {
      try {
        const refreshToken = decrypt(ent.refresh_token_encrypted)
        const accessToken = await getAccessTokenFromRefresh(refreshToken)
        const existing = await findFile(accessToken, SHARED_FILE_NAME)
        if (existing) await deleteFile(accessToken, existing.id)
        await revokeToken(refreshToken)
      } catch (e) {
        console.error('Erreur purge Drive (on continue quand meme la purge BDD):', e.message)
      }
    }

    await pool.query('DELETE FROM beautycrm_entreprises WHERE admin_email=$1', [admin_email])

    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// === STATUT consulte par l'app au demarrage (admin ET employe) ===
router.post('/status', async (req, res) => {
  try {
    const { secret, admin_email, role } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    if (!admin_email) return res.status(400).json({ message: 'admin_email requis' })

    const result = await pool.query('SELECT suspendue, motif_suspension, fermee, motif_fermeture, admin_whatsapp, supprimee, motif_suppression, devise, fact_nom, fact_adresse, fact_telephone, fact_email, fact_logo FROM beautycrm_entreprises WHERE admin_email=$1', [admin_email])
    const ent = result.rows[0]
    if (!ent) return res.json({ blocked: false })
    const facture = { nom: ent.fact_nom || '', adresse: ent.fact_adresse || '', telephone: ent.fact_telephone || '', email: ent.fact_email || '', logo: ent.fact_logo || '' }

    if (ent.supprimee) {
      return res.json({
        blocked: true,
        reason: 'supprimee',
        motif: ent.motif_suppression || null,
        contact: role === 'admin'
          ? { type: 'support', email: SUPPORT_EMAIL, whatsapp: SUPPORT_WHATSAPP }
          : { type: 'entreprise', whatsapp: ent.admin_whatsapp || null },
      })
    }

    if (ent.suspendue) {
      notifierAdmin({
        adminWhatsapp: SUPPORT_WHATSAPP,
        adminEmail: SUPPORT_EMAIL,
        sujet: 'Alerte: compte entreprise suspendu',
        message: 'Le compte entreprise (' + admin_email + ') a affiche le statut suspendu. Motif: ' + (ent.motif_suspension || 'aucun'),
      })
      return res.json({
        blocked: true,
        reason: 'suspendue',
        motif: ent.motif_suspension || null,
        contact: role === 'admin'
          ? { type: 'support', email: SUPPORT_EMAIL, whatsapp: SUPPORT_WHATSAPP }
          : { type: 'entreprise', whatsapp: ent.admin_whatsapp || null },
      })
    }

    if (role === 'employe' && ent.fermee) {
      return res.json({ blocked: true, reason: 'fermee', motif: ent.motif_fermeture || null, contact: { type: 'entreprise', whatsapp: ent.admin_whatsapp || null }, devise: ent.devise || null, facture })
    }

    res.json({ blocked: false, devise: ent.devise || null, facture })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})


// === Suspendre / supprimer un compte PERSONNEL (hors mode entreprise) ===
router.post('/admin/suspend-personal', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Acces refuse' })
    const { email, motif } = req.body
    if (!email) return res.status(400).json({ message: 'email requis' })
    await pool.query('UPDATE beautycrm_users SET suspendu=true, motif_suspension=$1, suspended_at=NOW() WHERE email=$2', [motif || '', email])
    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

router.post('/admin/unsuspend-personal', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Acces refuse' })
    const { email } = req.body
    if (!email) return res.status(400).json({ message: 'email requis' })
    await pool.query('UPDATE beautycrm_users SET suspendu=false, motif_suspension=NULL, suspended_at=NULL WHERE email=$1', [email])
    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// Marque le compte comme supprime (soft) - la purge reelle (Drive + BDD) se fait
// quand l'utilisateur clique "Fermer" via /purge-personal-supprime
router.post('/admin/delete-personal', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Acces refuse' })
    const { email, motif } = req.body
    if (!email) return res.status(400).json({ message: 'email requis' })
    const result = await pool.query('UPDATE beautycrm_users SET supprime=true, motif_suppression=$1, deleted_at=NOW() WHERE email=$2 RETURNING id', [motif || '', email])
    if (result.rows.length === 0) return res.status(404).json({ message: 'Utilisateur introuvable' })
    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// Statut consulte par l'app au demarrage pour le compte personnel
router.post('/status-personal', async (req, res) => {
  try {
    const { secret, email } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    if (!email) return res.status(400).json({ message: 'email requis' })

    const result = await pool.query('SELECT suspendu, motif_suspension, supprime, motif_suppression FROM beautycrm_users WHERE email=$1', [email])
    const u = result.rows[0]
    if (!u) return res.json({ blocked: false })

    if (u.supprime) {
      return res.json({
        blocked: true,
        reason: 'supprimee',
        motif: u.motif_suppression || null,
        contact: { type: 'support', email: SUPPORT_EMAIL, whatsapp: SUPPORT_WHATSAPP },
      })
    }

    if (u.suspendu) {
      return res.json({
        blocked: true,
        reason: 'suspendue',
        motif: u.motif_suspension || null,
        contact: { type: 'support', email: SUPPORT_EMAIL, whatsapp: SUPPORT_WHATSAPP },
      })
    }

    return res.json({ blocked: false })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// Purge definitive du compte personnel : appelee quand l'utilisateur clique "Fermer"
// sur l'ecran "compte supprime". Revoque le token Drive personnel puis supprime la ligne BDD.
router.post('/purge-personal-supprime', async (req, res) => {
  try {
    const { secret, email } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    if (!email) return res.status(400).json({ message: 'email requis' })

    const row = await pool.query('SELECT supprime FROM beautycrm_users WHERE email=$1', [email])
    const u = row.rows[0]
    if (!u) return res.json({ success: true }) // deja purge
    if (!u.supprime) return res.status(400).json({ message: 'Ce compte n est pas marque comme supprime' })

    const driveRow = await pool.query('SELECT refresh_token_encrypted FROM beautycrm_users_drive WHERE email=$1', [email])
    if (driveRow.rows.length > 0) {
      try {
        const refreshToken = decrypt(driveRow.rows[0].refresh_token_encrypted)
        await revokeToken(refreshToken)
      } catch (e) {
        console.error('Erreur revocation Drive personnelle (on continue quand meme):', e.message)
      }
      await pool.query('DELETE FROM beautycrm_users_drive WHERE email=$1', [email])
    }

    await pool.query('DELETE FROM beautycrm_users WHERE email=$1', [email])

    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

module.exports = router
