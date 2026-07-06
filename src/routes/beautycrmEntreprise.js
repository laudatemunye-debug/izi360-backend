const express = require('express')
const router = express.Router()
const pool = require('../config/db')
const { encrypt, decrypt } = require('../utils/cryptoServer')
const { exchangeCodeForTokens, getAccessTokenFromRefresh, findFile, readFile, writeFile } = require('../utils/googleDrive')

const BEAUTYCRM_SECRET = process.env.BEAUTYCRM_SECRET || 'beautycrm_izi360_2026'
const SHARED_FILE_NAME = 'beautycrm-entreprise-data.json'

function genCode6() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// 1. Point de depart : le frontend redirige l'admin ici pour lancer la connexion Google (flux Authorization Code)
router.get('/oauth-start', (req, res) => {
  const { admin_email } = req.query
  if (!admin_email) return res.status(400).send('admin_email requis')

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

// 2. Google redirige ici apres consentement de l'admin
router.get('/oauth-callback', async (req, res) => {
  const { code, state: admin_email, error } = req.query
  if (error) return res.send(`<h2>Connexion annulee</h2><p>${error}</p>`)
  if (!code || !admin_email) return res.status(400).send('Parametres manquants')

  try {
    const tokens = await exchangeCodeForTokens(code)
    if (!tokens.refresh_token) {
      return res.send(`<h2>Erreur</h2><p>Aucun refresh_token recu. Revoquez l'acces sur myaccount.google.com/permissions puis reessayez.</p>`)
    }
    const encrypted = encrypt(tokens.refresh_token)

    await pool.query(`
      INSERT INTO beautycrm_entreprises (admin_email, refresh_token_encrypted)
      VALUES ($1, $2)
      ON CONFLICT (admin_email) DO UPDATE SET refresh_token_encrypted = EXCLUDED.refresh_token_encrypted, updated_at = NOW()
    `, [admin_email, encrypted])

    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;">
      <h2>✅ Connexion reussie</h2>
      <p>Vous pouvez fermer cette fenetre et retourner sur BeautyCRM.</p>
    </body></html>`)
  } catch (e) {
    console.error(e)
    res.status(500).send('<h2>Erreur serveur</h2><p>' + e.message + '</p>')
  }
})

// 3. Admin genere un code d'invitation
router.post('/generate-code', async (req, res) => {
  try {
    const { secret, admin_email, admin_whatsapp } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    if (!admin_email) return res.status(400).json({ message: 'admin_email requis' })
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
router.post('/join', async (req, res) => {
  try {
    const { secret, code, nom, poste } = req.body
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
    const inserted = await pool.query('INSERT INTO beautycrm_employes (admin_email, nom, poste) VALUES ($1,$2,$3) RETURNING id', [admin_email, nom, poste])
    const entRow = await pool.query('SELECT admin_whatsapp FROM beautycrm_entreprises WHERE admin_email=$1', [admin_email])

    res.json({ success: true, admin_email, employe_id: inserted.rows[0].id, admin_whatsapp: entRow.rows[0]?.admin_whatsapp || null })
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
    const result = await pool.query('SELECT id, nom, poste, joined_at FROM beautycrm_employes WHERE admin_email=$1 AND revoked=false ORDER BY joined_at DESC', [admin_email])
    res.json(result.rows)
  } catch (e) { res.status(500).json({ message: 'Erreur serveur' }) }
})

// 6. Revoquer un employe
router.post('/revoke-employe', async (req, res) => {
  try {
    const { secret, admin_email, employe_id } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    await pool.query('UPDATE beautycrm_employes SET revoked=true WHERE id=$1 AND admin_email=$2', [employe_id, admin_email])
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: 'Erreur serveur' }) }
})

// 6b. Verifier si un employe a ete revoque (appelé par l'app employe au demarrage)
router.post('/check-status', async (req, res) => {
  try {
    const { secret, admin_email, employe_id } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    if (!admin_email || !employe_id) return res.status(400).json({ message: 'Champs manquants' })

    const result = await pool.query('SELECT revoked FROM beautycrm_employes WHERE id=$1 AND admin_email=$2', [employe_id, admin_email])
    if (result.rows.length === 0) return res.json({ revoked: true, admin_whatsapp: null })

    const entRow = await pool.query('SELECT admin_whatsapp FROM beautycrm_entreprises WHERE admin_email=$1', [admin_email])
    res.json({ revoked: result.rows[0].revoked === true, admin_whatsapp: entRow.rows[0]?.admin_whatsapp || null })
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

module.exports = router
