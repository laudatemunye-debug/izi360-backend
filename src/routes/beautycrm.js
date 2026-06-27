const express = require('express')
const router = express.Router()
const pool = require('../config/db')
const auth = require('../middleware/auth')

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
      RETURNING *
    `, [nom, email, telephone, pays, ville, entreprise, role, devise, version, plateforme || 'web'])
    res.status(201).json({ message: 'Enregistré', user: result.rows[0] })
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

module.exports = router
