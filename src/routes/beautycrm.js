const express = require('express')
const router = express.Router()
const pool = require('../config/db')
const auth = require('../middleware/auth')
const transporter = require('../config/mailer')
const { envoyerWhatsApp } = require('../utils/whatsapp')

const BEAUTYCRM_SECRET = process.env.BEAUTYCRM_SECRET || 'beautycrm_izi360_2026'

router.post('/register', async (req, res) => {
  try {
    const { secret, nom, email, telephone, pays, ville, entreprise, role, devise, version, plateforme, ip_address, referred_by } = req.body
    
    // Générer code parrainage unique
    const genCode = (nom) => {
      const prefix = (nom||'USR').replace(/[^a-zA-Z]/g,'').toUpperCase().slice(0,4).padEnd(4,'X')
      const suffix = Math.random().toString(36).toUpperCase().slice(2,6)
      return prefix+'-'+suffix
    }
    let referral_code
    let codeOk = false
    while(!codeOk){
      referral_code = genCode(nom)
      const exists = await pool.query('SELECT id FROM beautycrm_users WHERE referral_code=$1',[referral_code])
      if(exists.rows.length===0) codeOk=true
    }
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorisé' })
    if (!email) return res.status(400).json({ message: 'Email requis' })

    const result = await pool.query(`
      INSERT INTO beautycrm_users (nom, email, telephone, pays, ville, entreprise, role, devise, version, plateforme, ip_address, referral_code, referred_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (email) DO UPDATE SET
        nom = EXCLUDED.nom, telephone = EXCLUDED.telephone,
        pays = EXCLUDED.pays, ville = EXCLUDED.ville,
        entreprise = EXCLUDED.entreprise, role = EXCLUDED.role,
        devise = EXCLUDED.devise, version = EXCLUDED.version,
        plateforme = EXCLUDED.plateforme
      RETURNING *, (xmax = 0) AS is_new
    `, [nom, email, telephone, pays, ville, entreprise, role, devise, version, plateforme || 'web', ip_address || '', referral_code, referred_by || null])

    const user = result.rows[0]

    // Envoyer email seulement si c'est un nouvel utilisateur
    if (user.is_new && email.includes('@')) {
      try {
        await transporter.sendMail({
          from: `"BeautyCRM" <${process.env.MAIL_USER}>`,
          to: email,
          subject: `Bienvenue sur BeautyCRM, ${nom || ''} ! 🎉`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background: #fff; padding: 0;">
              
              <!-- Header -->
              <div style="background: linear-gradient(135deg, #C084FC, #9333EA); padding: 40px 32px; text-align: center; border-radius: 12px 12px 0 0;">
                <h1 style="color: #fff; margin: 0; font-size: 32px; letter-spacing: 1px;">💄 BeautyCRM</h1>
                <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">La solution de gestion pour votre business beauté</p>
              </div>

              <!-- Body -->
              <div style="padding: 32px; background: #fafafa;">
                <p style="font-size: 16px; color: #333;">Bonjour <strong>${nom || 'cher(e) utilisateur(trice)'}</strong>,</p>
                <p style="color: #555;">Merci d'avoir créé votre compte sur <strong>BeautyCRM</strong> ! Votre compte est maintenant actif et prêt à l'emploi.</p>

                <!-- Features -->
                <div style="background: #fff; border-radius: 12px; padding: 24px; margin: 24px 0; border: 1px solid #eee;">
                  <h2 style="color: #9333EA; font-size: 16px; margin: 0 0 16px;">✨ Ce que vous pouvez faire avec BeautyCRM :</h2>
                  
                  <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                      <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; vertical-align: top; width: 32px;">👥</td>
                      <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;">
                        <strong style="color: #333;">Gestion des clients</strong><br>
                        <span style="color: #777; font-size: 13px;">Fiche client complète, historique des achats, suivi personnalisé</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; vertical-align: top;">💰</td>
                      <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;">
                        <strong style="color: #333;">Ventes & Factures</strong><br>
                        <span style="color: #777; font-size: 13px;">Enregistrement rapide des ventes, génération de factures PDF</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; vertical-align: top;">📦</td>
                      <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;">
                        <strong style="color: #333;">Gestion de stock</strong><br>
                        <span style="color: #777; font-size: 13px;">Suivi des produits, alertes de stock bas, approvisionnement</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; vertical-align: top;">📊</td>
                      <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;">
                        <strong style="color: #333;">Tableau de bord & Rapports</strong><br>
                        <span style="color: #777; font-size: 13px;">CA, marges, statistiques de vente, évolution mensuelle</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; vertical-align: top;">💳</td>
                      <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;">
                        <strong style="color: #333;">Crédits & Paiements</strong><br>
                        <span style="color: #777; font-size: 13px;">Gestion des ventes à crédit, suivi des versements, relances</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 0; vertical-align: top;">📱</td>
                      <td style="padding: 10px 0;">
                        <strong style="color: #333;">Disponible partout</strong><br>
                        <span style="color: #777; font-size: 13px;">Application PWA installable sur mobile et desktop, fonctionne hors ligne</span>
                      </td>
                    </tr>
                  </table>
                </div>

                <p style="color: #555;">Votre essai gratuit de <strong>30 jours</strong> est maintenant actif. Profitez de toutes les fonctionnalités sans limitation !</p>

                <div style="text-align: center; margin: 32px 0;">
                  <a href="https://beautycrm-web.vercel.app" style="background: linear-gradient(135deg, #C084FC, #9333EA); color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 16px;">
                    Ouvrir BeautyCRM →
                  </a>
                </div>

                <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
                <p style="color: #999; font-size: 12px; text-align: center;">
                  Une question ? Répondez à cet email, nous sommes là pour vous aider.<br><br>
                  Cordialement,<br>
                  <strong>L'équipe IZISOFT</strong><br>
                  <span style="color: #C084FC;">BeautyCRM</span> — Gérez votre business beauté avec style<br><br>
                  © 2026 IZISOFT · <a href="https://beautycrm-web.vercel.app" style="color: #C084FC;">beautycrm-web.vercel.app</a>
                </p>
              </div>
            </div>
          `
        })
      } catch(mailErr) {
        console.error('Mail error:', mailErr.message)
      }
    }

    res.status(201).json({ message: 'Enregistré', user })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

router.get('/users', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Accès refusé' })
    const result = await pool.query('SELECT * FROM beautycrm_users ORDER BY created_at DESC')
    res.json(result.rows)
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
})

router.get('/stats', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Accès refusé' })
    const [total, pays, version, ce_mois] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM beautycrm_users'),
      pool.query('SELECT pays, COUNT(*) as total FROM beautycrm_users GROUP BY pays ORDER BY total DESC LIMIT 5'),
      pool.query('SELECT version, COUNT(*) as total FROM beautycrm_users GROUP BY version ORDER BY total DESC'),
      pool.query("SELECT COUNT(*) FROM beautycrm_users WHERE date_trunc('month', created_at) = date_trunc('month', NOW())")
    ])
    res.json({
      total: parseInt(total.rows[0].count),
      ce_mois: parseInt(ce_mois.rows[0].count),
      par_pays: pays.rows,
      par_version: version.rows
    })
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
})

router.patch('/users/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Accès refusé' })
    const { nom, email, telephone, pays, ville, entreprise, role, devise } = req.body
    const result = await pool.query(
      'UPDATE beautycrm_users SET nom=$1,email=$2,telephone=$3,pays=$4,ville=$5,entreprise=$6,role=$7,devise=$8 WHERE id=$9 RETURNING *',
      [nom, email, telephone, pays, ville, entreprise, role, devise, req.params.id]
    )
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
})

router.delete('/users/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Accès refusé' })
    await pool.query('DELETE FROM beautycrm_users WHERE id=$1', [req.params.id])
    res.json({ message: 'Supprimé' })
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
})

router.get('/parrainage/count', async (req, res) => {
  try {
    const { code } = req.query
    if (!code) return res.json({ count: 0 })
    const result = await pool.query('SELECT COUNT(*) FROM beautycrm_users WHERE referred_by=$1', [code])
    res.json({ count: parseInt(result.rows[0].count) })
  } catch (err) { res.status(500).json({ count: 0 }) }
})

router.get('/parrainage', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Accès refusé' })
    const result = await pool.query(`
      SELECT 
        p.id, p.nom, p.email, p.telephone, p.referral_code,
        COUNT(f.id) as nb_filleuls,
        json_agg(json_build_object('nom', f.nom, 'email', f.email, 'telephone', f.telephone, 'date', f.created_at)) FILTER (WHERE f.id IS NOT NULL) as filleuls
      FROM beautycrm_users p
      LEFT JOIN beautycrm_users f ON f.referred_by = p.referral_code
      WHERE p.referral_code IS NOT NULL
      GROUP BY p.id, p.nom, p.email, p.telephone, p.referral_code
      ORDER BY nb_filleuls DESC, p.nom ASC
    `)
    // Retourner tous les utilisateurs avec code
    res.json(result.rows)
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
})

router.post('/notify', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Accès refusé' })
    const { subject, message } = req.body
    if (!subject || !message) return res.status(400).json({ message: 'Sujet et message requis' })
    const result = await pool.query("SELECT email, nom FROM beautycrm_users WHERE email LIKE '%@%'")
    const users = result.rows
    let sent = 0
    for (const user of users) {
      try {
        await transporter.sendMail({
          from: `"BeautyCRM" <${process.env.MAIL_USER}>`,
          to: user.email,
          subject,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 0;">
              <div style="background: linear-gradient(135deg, #C084FC, #9333EA); padding: 32px; text-align: center; border-radius: 12px 12px 0 0;">
                <h1 style="color: #fff; margin: 0; font-size: 28px;">💄 BeautyCRM</h1>
              </div>
              <div style="padding: 32px; background: #fafafa;">
                <p>Bonjour <strong>${user.nom || ''}</strong>,</p>
                <div style="background: #fff; border-radius: 8px; padding: 20px; border: 1px solid #eee; white-space: pre-wrap; color: #333; line-height: 1.6;">${message}</div>
                <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
                <p style="color: #999; font-size: 12px; text-align: center;">
                  Cordialement,<br><strong>L'équipe IZISOFT</strong><br>
                  © 2026 IZISOFT · BeautyCRM
                </p>
              </div>
            </div>
          `
        })
        sent++
      } catch(_) {}
    }
    res.json({ message: `Email envoyé à ${sent} utilisateur(s) !` })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// Supprimer un utilisateur BeautyCRM
router.delete('/users/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Accès refusé' })
    await pool.query('DELETE FROM beautycrm_users WHERE id = $1', [req.params.id])
    res.json({ message: 'Utilisateur supprimé' })
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
})


// Statut du forfait d'un utilisateur (appele par l'app BeautyCRM au demarrage)
// Desactivation manuelle d'un forfait par un admin (ex: paiement conteste, erreur, etc.)
router.post('/forfait/desactiver', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Acces refuse' })
    const { email } = req.body
    if (!email) return res.status(400).json({ message: 'email requis' })

    const result = await pool.query(
      `UPDATE beautycrm_users
       SET forfait_type = 'essai', forfait_expire_le = NULL, ia_addon = FALSE, forfait_active_depuis = NULL
       WHERE email = $1
       RETURNING email, forfait_type`,
      [email]
    )
    if (result.rows.length === 0) return res.status(404).json({ message: 'Utilisateur introuvable' })

    res.json({ message: 'Forfait desactive', user: result.rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// Si un compte en mode Entreprise active un forfait Personnel, le mode Entreprise
// doit se desactiver automatiquement (les employes perdent l'acces), avec notification a l'admin.
async function retrograderVersPersonnelSiEntreprise(email) {
  try {
    const entRow = await pool.query('SELECT admin_whatsapp FROM beautycrm_entreprises WHERE admin_email=$1', [email])
    if (entRow.rows.length === 0) return // ce compte n'est pas admin d'une entreprise, rien a faire

    const adminWhatsapp = entRow.rows[0].admin_whatsapp

    // Suppression de l'entreprise : cascade automatiquement sur les employes (revoque leur acces)
    await pool.query('DELETE FROM beautycrm_entreprises WHERE admin_email=$1', [email])

    const messageAlerte = "Votre forfait Personnel a ete active avec succes. Consequence importante : votre mode Entreprise a ete desactive automatiquement, et vos employes ne pourront plus acceder aux donnees partagees de l'entreprise. Vous pouvez continuer a utiliser BeautyCRM en solo des maintenant."

    if (adminWhatsapp) {
      await envoyerWhatsApp(adminWhatsapp, messageAlerte)
    } else {
      // Repli : utiliser le telephone personnel du compte si aucun numero admin_whatsapp enregistre
      const userRow = await pool.query('SELECT telephone FROM beautycrm_users WHERE email=$1', [email])
      if (userRow.rows[0]?.telephone) {
        await envoyerWhatsApp(userRow.rows[0].telephone, messageAlerte)
      }
    }
  } catch (e) {
    console.error('Erreur retrogradation entreprise vers personnel:', e.message)
  }
}

// Symetrique de la fonction ci-dessus : si un compte personnel active un forfait
// Entreprise, on ne peut pas activer automatiquement le mode Entreprise (necessite
// une connexion Google Drive faite par l'utilisateur), mais on le notifie que
// c'est maintenant possible.
async function notifierActivationEntrepriseDisponible(email) {
  try {
    const entRow = await pool.query('SELECT admin_email FROM beautycrm_entreprises WHERE admin_email=$1', [email])
    if (entRow.rows.length > 0) return // deja en mode entreprise, rien a faire

    const userRow = await pool.query('SELECT telephone FROM beautycrm_users WHERE email=$1', [email])
    const telephone = userRow.rows[0]?.telephone
    if (!telephone) return

    const message = "Votre forfait Entreprise a ete active avec succes ! Vous pouvez maintenant configurer le mode Entreprise dans BeautyCRM (Parametres > Mode Entreprise) pour inviter vos employes et acceder a la comptabilite/paie."
    await envoyerWhatsApp(telephone, message)
  } catch (e) {
    console.error('Erreur notification activation entreprise:', e.message)
  }
}

router.get('/forfait/status', async (req, res) => {
  try {
    const { email, secret } = req.query
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    if (!email) return res.status(400).json({ message: 'Email requis' })

    const result = await pool.query(
      'SELECT forfait_type, forfait_expire_le, ia_addon, created_at, forfait_active_depuis FROM beautycrm_users WHERE email=$1',
      [email]
    )
    if (result.rows.length === 0) return res.status(404).json({ message: 'Utilisateur introuvable' })

    const u = result.rows[0]
    const maintenant = new Date()
    // Date fixe : tous les comptes crees avant cette date voient leur essai
    // demarrer a cette date (pas a leur inscription reelle). Les comptes
    // crees apres cette date gardent leurs 30 jours a partir de leur propre inscription.
    const DATE_FIXE_DEBUT_ESSAI = new Date('2026-09-01T00:00:00Z')
    const dateInscription = new Date(u.created_at)
    const debutCompte = dateInscription < DATE_FIXE_DEBUT_ESSAI ? DATE_FIXE_DEBUT_ESSAI : dateInscription
    const finEssai = new Date(debutCompte.getTime() + 30 * 24 * 60 * 60 * 1000)
    const forfaitPayantActif = u.forfait_type !== 'essai' && u.forfait_expire_le && new Date(u.forfait_expire_le) > maintenant

    let statut, joursRestantsEssai = 0
    if (forfaitPayantActif) {
      statut = u.forfait_type // 'personnel' ou 'entreprise'
    } else if (maintenant <= finEssai) {
      statut = 'essai'
      joursRestantsEssai = Math.ceil((finEssai - maintenant) / (24 * 60 * 60 * 1000))
    } else {
      statut = 'expire' // lecture seule, IA coupee
    }

    res.json({
      statut,
      jours_restants_essai: joursRestantsEssai,
      ia_addon: forfaitPayantActif ? u.ia_addon : false,
      forfait_expire_le: u.forfait_expire_le,
      forfait_active_depuis: u.forfait_active_depuis,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// Activation manuelle d'un forfait par un admin (Phase 1 - paiement manuel)
router.post('/forfait/activer', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Acces refuse' })
    const { email, forfait_type, duree_mois, ia_addon } = req.body
    if (!email || !forfait_type || !duree_mois) {
      return res.status(400).json({ message: 'email, forfait_type et duree_mois sont requis' })
    }
    if (!['personnel', 'entreprise'].includes(forfait_type)) {
      return res.status(400).json({ message: "forfait_type doit etre 'personnel' ou 'entreprise'" })
    }

    const result = await pool.query(
      `UPDATE beautycrm_users
       SET forfait_type = $1,
           forfait_expire_le = NOW() + ($2 || ' months')::interval,
           ia_addon = $3,
           forfait_active_depuis = NOW()
       WHERE email = $4
       RETURNING email, forfait_type, forfait_expire_le, ia_addon, forfait_active_depuis`,
      [forfait_type, duree_mois, !!ia_addon, email]
    )
    if (result.rows.length === 0) return res.status(404).json({ message: 'Utilisateur introuvable' })

    if (forfait_type === 'personnel') {
      await retrograderVersPersonnelSiEntreprise(email)
    } else if (forfait_type === 'entreprise') {
      await notifierActivationEntrepriseDisponible(email)
    }

    res.json({ message: 'Forfait active', user: result.rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})


const PRIX_FORFAITS = {
  personnel: { 1: 1.5, 12: 10 },
  entreprise: { 1: 5, 12: 40 },
}
const PRIX_ADDON_IA = {
  personnel: { 1: 1, 12: 8 },
  entreprise: { 1: 3, 12: 25 },
}

// Secret separe pour le telephone/app qui detecte les SMS (a definir dans .env)
const SMS_SECRET = process.env.BEAUTYCRM_SMS_SECRET || 'change_moi_en_prod'

// 1. L'utilisateur demande a payer -> generation d'un code de reference unique
router.post('/forfait/demande', async (req, res) => {
  try {
    const { email, secret, forfait_type, duree_mois, ia_addon } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    if (!email || !forfait_type || !duree_mois) {
      return res.status(400).json({ message: 'email, forfait_type et duree_mois sont requis' })
    }
    if (!PRIX_FORFAITS[forfait_type] || !PRIX_FORFAITS[forfait_type][duree_mois]) {
      return res.status(400).json({ message: 'Combinaison forfait_type/duree_mois invalide' })
    }

    let montant = PRIX_FORFAITS[forfait_type][duree_mois]
    if (ia_addon && PRIX_ADDON_IA[forfait_type]?.[duree_mois]) {
      montant += PRIX_ADDON_IA[forfait_type][duree_mois]
    }

    // Genere un code unique du type BCRM-A1B2C3
    const genCode = () => 'BCRM-' + Math.random().toString(36).toUpperCase().slice(2, 8)
    let code, codeOk = false
    while (!codeOk) {
      code = genCode()
      const exists = await pool.query('SELECT id FROM beautycrm_demandes_paiement WHERE code_reference=$1', [code])
      if (exists.rows.length === 0) codeOk = true
    }

    await pool.query(
      `INSERT INTO beautycrm_demandes_paiement (email, code_reference, forfait_type, duree_mois, ia_addon, montant_attendu)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [email, code, forfait_type, duree_mois, !!ia_addon, montant]
    )

    res.status(201).json({
      code_reference: code,
      montant_a_payer: montant,
      instructions: `Envoyez ${montant}$ (equivalent en Francs Congolais au taux du jour) par Mobile Money, en indiquant le code ${code} dans le motif du transfert.`,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})




const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP_NUMBER || '243835771593'

// Table de correspondance montant (USD) -> plan. Tolerance de 0.05$ pour les arrondis.
const TABLE_MONTANTS = [
  { montant: 1.5,  forfait_type: 'personnel',  duree_mois: 1,  ia_addon: false },
  { montant: 10,   forfait_type: 'personnel',  duree_mois: 12, ia_addon: false },
  { montant: 2.5,  forfait_type: 'personnel',  duree_mois: 1,  ia_addon: true },
  { montant: 18,   forfait_type: 'personnel',  duree_mois: 12, ia_addon: true },
  { montant: 5,    forfait_type: 'entreprise', duree_mois: 1,  ia_addon: false },
  { montant: 40,   forfait_type: 'entreprise', duree_mois: 12, ia_addon: false },
  { montant: 8,    forfait_type: 'entreprise', duree_mois: 1,  ia_addon: true },
  { montant: 65,   forfait_type: 'entreprise', duree_mois: 12, ia_addon: true },
]

function trouverPlan(montant) {
  return TABLE_MONTANTS.find(p => Math.abs(p.montant - montant) <= 0.05) || null
}

// Extrait numero expediteur + montant USD depuis differents formats de SMS mobile money.
// Retourne null si aucun format connu ne correspond.
function parserSmsPaiement(texte) {
  // Format M-Pesa "Vous avez recu" (transfert entre particuliers)
  let m = texte.match(/Vous avez recu\s+USD\s*([\d.,]+)\s+de\s+(\d+)\s+([^.]+)\./i)
  if (m) {
    return {
      montant: parseFloat(m[1].replace(',', '.')),
      numero: m[2],
      nom: m[3].trim(),
    }
  }
  // Format M-Pesa "depot effectue par" (parfois utilise selon le canal de paiement)
  m = texte.match(/depot effectue par\s+(\d+)\s*-\s*([^\d]+?)\d*\s+a reussi Montant:\s*([\d.,]+)\s*USD/i)
  if (m) {
    return {
      montant: parseFloat(m[3].replace(',', '.')),
      numero: m[1],
      nom: m[2].trim(),
    }
  }
  return null
}

function derniersChiffres(numero, n = 9) {
  return (numero || '').replace(/\D/g, '').slice(-n)
}

router.post('/forfait/sms-recu', async (req, res) => {
  try {
    const { secret, texte_sms } = req.body
    if (secret !== SMS_SECRET) return res.status(401).json({ message: 'Non autorise' })
    if (!texte_sms) return res.status(400).json({ message: 'texte_sms requis' })

    const infos = parserSmsPaiement(texte_sms)
    if (!infos) {
      await envoyerWhatsApp(ADMIN_WHATSAPP, `Paiement recu mais SMS non reconnu, verification manuelle requise :\n\n${texte_sms}`)
      return res.json({ traite: false, raison: 'sms_non_reconnu' })
    }

    const plan = trouverPlan(infos.montant)
    if (!plan) {
      await envoyerWhatsApp(ADMIN_WHATSAPP, `Paiement de ${infos.montant}$ recu de ${infos.nom} (${infos.numero}), mais montant ne correspond a aucun forfait connu. Verification manuelle requise.`)
      return res.json({ traite: false, raison: 'montant_non_reconnu', infos })
    }

    const chiffresExpediteur = derniersChiffres(infos.numero)
    const utilisateur = await pool.query(
      `SELECT email, telephone FROM beautycrm_users WHERE RIGHT(REGEXP_REPLACE(telephone, '\\D', '', 'g'), 9) = $1`,
      [chiffresExpediteur]
    )

    if (utilisateur.rows.length === 0) {
      await envoyerWhatsApp(ADMIN_WHATSAPP, `Paiement de ${infos.montant}$ recu de ${infos.nom} (${infos.numero}) pour un forfait ${plan.forfait_type}/${plan.duree_mois} mois${plan.ia_addon ? ' + IA' : ''}, mais aucun compte BeautyCRM ne correspond a ce numero. Activation manuelle requise.`)
      return res.json({ traite: false, raison: 'compte_introuvable', infos, plan })
    }

    const email = utilisateur.rows[0].email
    const code = Math.floor(100000 + Math.random() * 900000).toString()

    await pool.query(
      `INSERT INTO beautycrm_demandes_paiement (email, code_reference, forfait_type, duree_mois, ia_addon, montant_attendu, statut)
       VALUES ($1,$2,$3,$4,$5,$6,'attente')`,
      [email, code, plan.forfait_type, plan.duree_mois, plan.ia_addon, infos.montant]
    )

    await envoyerWhatsApp(
      infos.numero,
      `Merci pour votre paiement de ${infos.montant}$ ! Voici votre code d'activation BeautyCRM : ${code}\n\nEntrez ce code dans l'application (Parametres > Activer mon forfait) pour activer votre acces.`
    )

    res.json({ traite: true, email, plan, code })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// L'utilisateur entre le code recu par WhatsApp dans l'app pour activer son forfait.
router.post('/forfait/valider-code', async (req, res) => {
  try {
    const { email, secret, code } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorise' })
    if (!email || !code) return res.status(400).json({ message: 'email et code sont requis' })

    const demande = await pool.query(
      "SELECT * FROM beautycrm_demandes_paiement WHERE code_reference=$1 AND email=$2 AND statut='attente'",
      [code, email]
    )
    if (demande.rows.length === 0) {
      return res.status(404).json({ message: 'Code invalide, expire, ou deja utilise' })
    }

    const d = demande.rows[0]

    await pool.query(
      `UPDATE beautycrm_users
       SET forfait_type = $1,
           forfait_expire_le = NOW() + ($2 || ' months')::interval,
           ia_addon = $3,
           forfait_active_depuis = NOW()
       WHERE email = $4`,
      [d.forfait_type, d.duree_mois, d.ia_addon, email]
    )

    await pool.query(
      "UPDATE beautycrm_demandes_paiement SET statut='confirme', confirme_at=NOW() WHERE id=$1",
      [d.id]
    )

    if (d.forfait_type === 'personnel') {
      await retrograderVersPersonnelSiEntreprise(email)
    } else if (d.forfait_type === 'entreprise') {
      await notifierActivationEntrepriseDisponible(email)
    }

    res.json({ message: 'Forfait active avec succes', forfait_type: d.forfait_type, duree_mois: d.duree_mois, ia_addon: d.ia_addon })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

module.exports = router
