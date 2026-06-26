const express = require('express')
const router = express.Router()
const authMiddleware = require('../middleware/auth')
const pool = require('../config/db')

// Licences de l'utilisateur connecté
router.get('/my-licences', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT l.id, l.module_code, l.type, l.date_fin, l.actif, l.is_trial,
              m.nom, m.description, m.prix_mensuel, m.prix_annuel, m.trial_days,
              CASE WHEN l.date_fin IS NOT NULL THEN EXTRACT(DAY FROM l.date_fin - NOW()) ELSE NULL END as jours_restants
       FROM licences l
       JOIN modules m ON m.code = l.module_code
       WHERE l.user_id = $1 AND l.actif = TRUE`,
      [req.user.id]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// Tous les modules disponibles
router.get('/modules', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM modules WHERE actif = TRUE ORDER BY id')
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// Demander accès à un module
router.post('/request-access', authMiddleware, async (req, res) => {
  try {
    const { module_code } = req.body
    const user = await pool.query('SELECT nom, email FROM users WHERE id = $1', [req.user.id])
    const transporter = require('../config/mailer')
    await transporter.sendMail({
      from: `"IZI360" <${process.env.MAIL_USER}>`,
      to: process.env.MAIL_USER,
      subject: `Demande d'accès — ${module_code}`,
      html: `
        <div style="font-family: sans-serif; padding: 24px;">
          <h2>Nouvelle demande d'accès</h2>
          <p><strong>Utilisateur :</strong> ${user.rows[0].nom}</p>
          <p><strong>Email :</strong> ${user.rows[0].email}</p>
          <p><strong>Module demandé :</strong> ${module_code}</p>
        </div>
      `
    })
    res.json({ message: 'Demande envoyée ! Nous vous contacterons bientôt.' })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// Démarrer le trial d'un module
router.post('/start-trial', authMiddleware, async (req, res) => {
  try {
    const { module_code } = req.body
    // Vérifier si déjà une licence
    const existing = await pool.query(
      'SELECT * FROM licences WHERE user_id = $1 AND module_code = $2',
      [req.user.id, module_code]
    )
    if (existing.rows.length > 0) return res.status(400).json({ message: 'Vous avez déjà accès à ce module.' })

    // Récupérer les jours de trial du module
    const mod = await pool.query('SELECT * FROM modules WHERE code = $1', [module_code])
    if (mod.rows.length === 0) return res.status(404).json({ message: 'Module non trouvé' })

    const trialDays = mod.rows[0].trial_days || 14
    const dateFin = new Date()
    dateFin.setDate(dateFin.getDate() + trialDays)

    const result = await pool.query(
      'INSERT INTO licences (user_id, module_code, type, date_fin, actif, is_trial) VALUES ($1, $2, $3, $4, TRUE, TRUE) RETURNING *',
      [req.user.id, module_code, 'trial', dateFin]
    )
    res.status(201).json({ 
      message: `Trial de ${trialDays} jours démarré !`,
      licence: result.rows[0],
      trial_days: trialDays,
      date_fin: dateFin
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

module.exports = router
