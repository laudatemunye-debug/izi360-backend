const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const pool = require('../config/db')
const auth = require('../middleware/auth')

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS formateur_demandes (
      id SERIAL PRIMARY KEY,
      nom VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      telephone VARCHAR(50),
      password VARCHAR(255) NOT NULL,
      formation_id INTEGER,
      formation_titre VARCHAR(255),
      statut VARCHAR(20) DEFAULT 'en_attente',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS formation_id INTEGER`)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS formation_titre VARCHAR(255)`)
}
ensureTable().catch(err => console.error('Erreur création table formateur_demandes:', err))

// GET /api/formateurs/formations-actives - liste publique pour le formulaire de demande
router.get('/formations-actives', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, titre FROM formations WHERE actif = true ORDER BY titre')
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// POST /api/formateurs/demande - soumission publique (via QR code)
router.post('/demande', async (req, res) => {
  try {
    const { nom, email, telephone, password, formationId, formationTitre } = req.body
    if (!nom || !email || !password || !formationId) {
      return res.status(400).json({ message: 'Nom, email, mot de passe et formation requis' })
    }
    if (password.length < 6) return res.status(400).json({ message: 'Mot de passe trop court (6 caractères min.)' })

    const existsUser = await pool.query('SELECT id FROM users WHERE email = $1', [email])
    if (existsUser.rows.length > 0) return res.status(400).json({ message: 'Cet email est déjà utilisé' })

    const existsDemande = await pool.query(
      `SELECT id FROM formateur_demandes WHERE email = $1 AND statut = 'en_attente'`,
      [email]
    )
    if (existsDemande.rows.length > 0) return res.status(400).json({ message: 'Une demande est déjà en attente pour cet email' })

    const hash = await bcrypt.hash(password, 10)
    await pool.query(
      `INSERT INTO formateur_demandes (nom, email, telephone, password, formation_id, formation_titre)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [nom, email, telephone, hash, formationId, formationTitre]
    )
    res.status(201).json({ message: 'Demande envoyée ! Un administrateur va valider votre accès formateur.' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// GET /api/formateurs/demandes - liste (admin uniquement)
router.get('/demandes', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Accès refusé' })
    const result = await pool.query('SELECT * FROM formateur_demandes ORDER BY created_at DESC')
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// PATCH /api/formateurs/demandes/:id/valider - cree le compte formateur (admin)
router.patch('/demandes/:id/valider', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Accès refusé' })
    const demande = await pool.query('SELECT * FROM formateur_demandes WHERE id = $1', [req.params.id])
    if (demande.rows.length === 0) return res.status(404).json({ message: 'Demande introuvable' })
    const d = demande.rows[0]
    if (d.statut !== 'en_attente') return res.status(400).json({ message: 'Demande déjà traitée' })

    const existsUser = await pool.query('SELECT id FROM users WHERE email = $1', [d.email])
    if (existsUser.rows.length > 0) return res.status(400).json({ message: 'Un compte existe déjà avec cet email' })

    await pool.query(
      `INSERT INTO users (nom, email, password, verified, role, formation_id, formation_titre)
       VALUES ($1,$2,$3,TRUE,'formateur',$4,$5)`,
      [d.nom, d.email, d.password, d.formation_id, d.formation_titre]
    )
    await pool.query(`UPDATE formateur_demandes SET statut = 'validee' WHERE id = $1`, [req.params.id])
    res.json({ message: `Compte formateur créé pour ${d.nom}` })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// PATCH /api/formateurs/demandes/:id/refuser - rejette la demande (admin)
router.patch('/demandes/:id/refuser', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Accès refusé' })
    const result = await pool.query(`UPDATE formateur_demandes SET statut = 'refusee' WHERE id = $1 RETURNING id`, [req.params.id])
    if (result.rows.length === 0) return res.status(404).json({ message: 'Demande introuvable' })
    res.json({ message: 'Demande refusée' })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

module.exports = router
