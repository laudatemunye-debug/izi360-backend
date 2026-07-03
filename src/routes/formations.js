const express = require('express')
const router = express.Router()
const pool = require('../config/db')
const auth = require('../middleware/auth')

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS formations (
      id SERIAL PRIMARY KEY,
      slug VARCHAR(100) UNIQUE NOT NULL,
      titre VARCHAR(255) NOT NULL,
      description TEXT,
      lieu VARCHAR(255),
      duree VARCHAR(100),
      date_debut DATE,
      formateur VARCHAR(255),
      actif BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS formation_inscriptions (
      id SERIAL PRIMARY KEY,
      formation_id INTEGER REFERENCES formations(id) ON DELETE CASCADE,
      nom VARCHAR(255) NOT NULL,
      telephone VARCHAR(50),
      email VARCHAR(255),
      ville VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
}
ensureTables().catch(err => console.error('Erreur creation tables formations:', err))

// GET /api/formations - liste publique des formations actives
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM formations WHERE actif = true ORDER BY created_at DESC')
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// GET /api/formations/all - liste complete (admin), avec nombre d'inscrits
router.get('/all', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Acces refuse' })
    const result = await pool.query(`
      SELECT f.*, COUNT(i.id) as nb_inscrits
      FROM formations f
      LEFT JOIN formation_inscriptions i ON i.formation_id = f.id
      GROUP BY f.id
      ORDER BY f.created_at DESC
    `)
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// GET /api/formations/slug/:slug - detail public par slug
router.get('/slug/:slug', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM formations WHERE slug=$1 AND actif=true', [req.params.slug])
    if (result.rows.length === 0) return res.status(404).json({ message: 'Formation introuvable' })
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// GET /api/formations/:id - detail public par id
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM formations WHERE id=$1', [req.params.id])
    if (result.rows.length === 0) return res.status(404).json({ message: 'Formation introuvable' })
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// POST /api/formations - creer une formation (admin)
router.post('/', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Acces refuse' })
    const { slug, titre, description, lieu, duree, dateDebut, formateur } = req.body
    if (!slug || !titre) return res.status(400).json({ message: 'Slug et titre requis' })

    const exists = await pool.query('SELECT id FROM formations WHERE slug=$1', [slug])
    if (exists.rows.length > 0) return res.status(400).json({ message: 'Ce slug existe deja' })

    const result = await pool.query(
      `INSERT INTO formations (slug, titre, description, lieu, duree, date_debut, formateur)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [slug, titre, description || '', lieu || '', duree || '', dateDebut || null, formateur || '']
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// PATCH /api/formations/:id - activer/desactiver (admin)
router.patch('/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Acces refuse' })
    const { actif } = req.body
    const result = await pool.query('UPDATE formations SET actif=$1 WHERE id=$2 RETURNING *', [actif, req.params.id])
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// POST /api/formations/:id/inscriptions - inscription publique
router.post('/:id/inscriptions', async (req, res) => {
  try {
    const { nom, telephone, email, ville } = req.body
    if (!nom || !telephone) return res.status(400).json({ message: 'Nom et telephone requis' })

    const formation = await pool.query('SELECT id FROM formations WHERE id=$1', [req.params.id])
    if (formation.rows.length === 0) return res.status(404).json({ message: 'Formation introuvable' })

    const doublon = await pool.query(
      `SELECT id FROM formation_inscriptions WHERE formation_id=$1 AND TRIM(telephone)=TRIM($2)`,
      [req.params.id, telephone]
    )
    if (doublon.rows.length > 0) {
      return res.status(400).json({ message: 'Vous êtes déjà inscrit(e) à cette formation' })
    }

    const result = await pool.query(
      `INSERT INTO formation_inscriptions (formation_id, nom, telephone, email, ville)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, nom, telephone, email || '', ville || '']
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// GET /api/formations/:id/inscriptions - liste des inscrits (admin)
router.get('/:id/inscriptions', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Acces refuse' })
    const result = await pool.query(
      'SELECT * FROM formation_inscriptions WHERE formation_id=$1 ORDER BY created_at DESC',
      [req.params.id]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

module.exports = router
