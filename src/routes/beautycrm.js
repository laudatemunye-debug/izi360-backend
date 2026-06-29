const express = require('express')
const router = express.Router()
const pool = require('../config/db')
const auth = require('../middleware/auth')
const transporter = require('../config/mailer')

const BEAUTYCRM_SECRET = process.env.BEAUTYCRM_SECRET || 'beautycrm_izi360_2026'

router.post('/register', async (req, res) => {
  try {
    const { secret, nom, email, telephone, pays, ville, entreprise, role, devise, version, plateforme } = req.body
    if (secret !== BEAUTYCRM_SECRET) return res.status(401).json({ message: 'Non autorisé' })
    if (!email) return res.status(400).json({ message: 'Email requis' })

    const result = await pool.query(`
      INSERT INTO beautycrm_users (nom, email, telephone, pays, ville, entreprise, role, devise, version, plateforme)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (email) DO UPDATE SET
        nom = EXCLUDED.nom, telephone = EXCLUDED.telephone,
        pays = EXCLUDED.pays, ville = EXCLUDED.ville,
        entreprise = EXCLUDED.entreprise, role = EXCLUDED.role,
        devise = EXCLUDED.devise, version = EXCLUDED.version,
        plateforme = EXCLUDED.plateforme
      RETURNING *, (xmax = 0) AS is_new
    `, [nom, email, telephone, pays, ville, entreprise, role, devise, version, plateforme || 'web'])

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

                <p style="color: #555;">Votre essai gratuit de <strong>14 jours</strong> est maintenant actif. Profitez de toutes les fonctionnalités sans limitation !</p>

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

module.exports = router
