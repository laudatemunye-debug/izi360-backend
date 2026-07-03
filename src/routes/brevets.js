const express = require('express')
const router = express.Router()
const pool = require('../config/db')
const auth = require('../middleware/auth')

// Pas de système de migration dans ce projet -> on crée la table au démarrage si absente
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS brevets (
      id VARCHAR(50) PRIMARY KEY,
      participant VARCHAR(255) NOT NULL,
      lieu VARCHAR(255),
      date_formation DATE,
      duree VARCHAR(100),
      formateur VARCHAR(255),
      formation VARCHAR(255) DEFAULT 'Production de Champignons',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await pool.query(`ALTER TABLE brevets ADD COLUMN IF NOT EXISTS numero VARCHAR(10)`)
}
ensureTable().catch(err => console.error('Erreur création table brevets:', err))

const genererId = () => {
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase()
  const annee = new Date().getFullYear()
  return `IZI-CHAMP-${annee}-${rand}`
}

// POST /api/brevets - créer un brevet (admin uniquement)
router.post('/', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Accès refusé' })
    const { participant, lieu, dateFormation, duree, formateur, formation } = req.body
    if (!participant || !dateFormation) {
      return res.status(400).json({ message: 'Nom du participant et date requis' })
    }

    const formationNom = formation || 'Production de Champignons'
    const doublon = await pool.query(
      `SELECT id FROM brevets WHERE LOWER(TRIM(participant))=LOWER(TRIM($1)) AND formation=$2`,
      [participant, formationNom]
    )
    if (doublon.rows.length > 0) {
      return res.status(400).json({
        message: `Un brevet existe déjà pour ${participant} sur cette formation`,
        existingId: doublon.rows[0].id,
      })
    }

    let id
    let idOk = false
    while (!idOk) {
      id = genererId()
      const exists = await pool.query('SELECT id FROM brevets WHERE id=$1', [id])
      if (exists.rows.length === 0) idOk = true
    }

    const anneeActuelle = new Date().getFullYear()
    const compteResult = await pool.query(
      `SELECT COUNT(*) FROM brevets WHERE date_part('year', created_at) = $1`,
      [anneeActuelle]
    )
    const numero = String(parseInt(compteResult.rows[0].count, 10) + 1).padStart(3, '0')

    const result = await pool.query(
      `INSERT INTO brevets (id, participant, lieu, date_formation, duree, formateur, formation, numero)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [id, participant, lieu, dateFormation, duree, formateur, formation || 'Production de Champignons', numero]
    )

    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// GET /api/brevets/:id - vérification publique (déclenchée par le scan du QR)
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM brevets WHERE id=$1', [req.params.id])
    if (result.rows.length === 0) return res.status(404).json({ message: 'Brevet introuvable' })
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

module.exports = router
