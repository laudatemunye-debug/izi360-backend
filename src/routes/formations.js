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
      pays VARCHAR(100),
      domaine VARCHAR(255),
      utilise_beautycrm VARCHAR(10),
      version_beautycrm VARCHAR(50),
      entendu_parler VARCHAR(10),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await pool.query(`ALTER TABLE formation_inscriptions ADD COLUMN IF NOT EXISTS pays VARCHAR(100)`)
  await pool.query(`ALTER TABLE formation_inscriptions ADD COLUMN IF NOT EXISTS domaine VARCHAR(255)`)
  await pool.query(`ALTER TABLE formation_inscriptions ADD COLUMN IF NOT EXISTS utilise_beautycrm VARCHAR(10)`)
  await pool.query(`ALTER TABLE formation_inscriptions ADD COLUMN IF NOT EXISTS version_beautycrm VARCHAR(50)`)
  await pool.query(`ALTER TABLE formation_inscriptions ADD COLUMN IF NOT EXISTS entendu_parler VARCHAR(10)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS formation_videos (
      id SERIAL PRIMARY KEY,
      formation_id INTEGER REFERENCES formations(id) ON DELETE CASCADE,
      titre VARCHAR(255) NOT NULL,
      description TEXT,
      url_video TEXT,
      type_contenu VARCHAR(20) DEFAULT 'video',
      ordre INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await pool.query(`ALTER TABLE formation_videos ALTER COLUMN url_video DROP NOT NULL`).catch(()=>{})
  await pool.query(`ALTER TABLE formation_videos ADD COLUMN IF NOT EXISTS type_contenu VARCHAR(20) DEFAULT 'video'`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS formation_contenu_likes (
      id SERIAL PRIMARY KEY,
      contenu_id INTEGER REFERENCES formation_videos(id) ON DELETE CASCADE,
      visitor_id VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(contenu_id, visitor_id)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS formation_contenu_comments (
      id SERIAL PRIMARY KEY,
      contenu_id INTEGER REFERENCES formation_videos(id) ON DELETE CASCADE,
      nom VARCHAR(255) NOT NULL,
      texte TEXT NOT NULL,
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

// GET /api/formations/all - liste complete (admin: toutes, formateur: la sienne)
router.get('/all', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'formateur') return res.status(403).json({ message: 'Acces refuse' })
    const result = req.user.role === 'formateur'
      ? await pool.query(`
          SELECT f.*, COUNT(i.id) as nb_inscrits
          FROM formations f
          LEFT JOIN formation_inscriptions i ON i.formation_id = f.id
          WHERE f.titre ILIKE '%' || $1 || '%'
          GROUP BY f.id
          ORDER BY f.created_at DESC
        `, [req.user.formation_titre])
      : await pool.query(`
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
    const result = await pool.query(`
      SELECT f.*, COUNT(i.id)::int as nb_inscrits
      FROM formations f
      LEFT JOIN formation_inscriptions i ON i.formation_id = f.id
      WHERE f.slug=$1 AND f.actif=true
      GROUP BY f.id
    `, [req.params.slug])
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
    const { nom, telephone, email, ville, pays, domaine, utilise_beautycrm, version_beautycrm, entendu_parler } = req.body
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
      `INSERT INTO formation_inscriptions (formation_id, nom, telephone, email, ville, pays, domaine, utilise_beautycrm, version_beautycrm, entendu_parler)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.params.id, nom, telephone, email || '', ville || '', pays || '', domaine || '', utilise_beautycrm || '', version_beautycrm || '', entendu_parler || '']
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// GET /api/formations/:id/inscriptions - liste des inscrits (admin: toutes, formateur: la sienne)
router.get('/:id/inscriptions', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'formateur') return res.status(403).json({ message: 'Acces refuse' })
    if (req.user.role === 'formateur') {
      const f = await pool.query('SELECT titre FROM formations WHERE id=$1', [req.params.id])
      if (f.rows.length === 0) return res.status(404).json({ message: 'Formation introuvable' })
      if (!f.rows[0].titre.toLowerCase().includes(req.user.formation_titre.toLowerCase())) {
        return res.status(403).json({ message: 'Acces refuse' })
      }
    }
    const result = await pool.query(
      'SELECT * FROM formation_inscriptions WHERE formation_id=$1 ORDER BY created_at DESC',
      [req.params.id]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// DELETE /api/formations/:id/inscriptions/:inscritId - supprimer un inscrit (admin: toutes, formateur: la sienne)
router.delete('/:id/inscriptions/:inscritId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'formateur') return res.status(403).json({ message: 'Acces refuse' })
    if (req.user.role === 'formateur') {
      const f = await pool.query('SELECT titre FROM formations WHERE id=$1', [req.params.id])
      if (f.rows.length === 0) return res.status(404).json({ message: 'Formation introuvable' })
      if (!f.rows[0].titre.toLowerCase().includes(req.user.formation_titre.toLowerCase())) {
        return res.status(403).json({ message: 'Acces refuse' })
      }
    }
    const result = await pool.query(
      'DELETE FROM formation_inscriptions WHERE id=$1 AND formation_id=$2 RETURNING id',
      [req.params.inscritId, req.params.id]
    )
    if (result.rows.length === 0) return res.status(404).json({ message: 'Inscrit introuvable' })
    res.json({ message: 'Inscrit supprime' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// GET /api/formations/:id/videos - liste publique des videos d'une formation
router.get('/:id/videos', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM formation_videos WHERE formation_id=$1 ORDER BY ordre ASC, created_at ASC',
      [req.params.id]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// POST /api/formations/:id/videos - ajouter une video (admin/formateur)
router.post('/:id/videos', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'formateur') return res.status(403).json({ message: 'Acces refuse' })
    const { titre, description, urlVideo, ordre, typeContenu } = req.body
    if (!titre) return res.status(400).json({ message: 'Titre requis' })
    if ((typeContenu || 'video') === 'video' && !urlVideo) return res.status(400).json({ message: 'URL de la video requise' })

    const result = await pool.query(
      `INSERT INTO formation_videos (formation_id, titre, description, url_video, type_contenu, ordre)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, titre, description || '', urlVideo || '', typeContenu || 'video', ordre || 0]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// PATCH /api/formations/:id/videos/:videoId - modifier une video (admin/formateur)
router.patch('/:id/videos/:videoId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'formateur') return res.status(403).json({ message: 'Acces refuse' })
    const { titre, description, urlVideo, ordre, typeContenu } = req.body
    const result = await pool.query(
      `UPDATE formation_videos SET titre=COALESCE($1,titre), description=COALESCE($2,description), url_video=COALESCE($3,url_video), type_contenu=COALESCE($4,type_contenu), ordre=COALESCE($5,ordre)
       WHERE id=$6 AND formation_id=$7 RETURNING *`,
      [titre, description, urlVideo, typeContenu, ordre, req.params.videoId, req.params.id]
    )
    if (result.rows.length === 0) return res.status(404).json({ message: 'Video introuvable' })
    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// DELETE /api/formations/:id/videos/:videoId - supprimer une video (admin/formateur)
router.delete('/:id/videos/:videoId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'formateur') return res.status(403).json({ message: 'Acces refuse' })
    const result = await pool.query(
      'DELETE FROM formation_videos WHERE id=$1 AND formation_id=$2 RETURNING id',
      [req.params.videoId, req.params.id]
    )
    if (result.rows.length === 0) return res.status(404).json({ message: 'Video introuvable' })
    res.json({ message: 'Video supprimee' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// GET /api/formations/:id/videos/:videoId/likes?visiteurId=xxx - compte + statut du visiteur
router.get('/:id/videos/:videoId/likes', async (req, res) => {
  try {
    const { visiteurId } = req.query
    const countRes = await pool.query('SELECT COUNT(*)::int as count FROM formation_contenu_likes WHERE contenu_id=$1', [req.params.videoId])
    let liked = false
    if (visiteurId) {
      const likedRes = await pool.query('SELECT id FROM formation_contenu_likes WHERE contenu_id=$1 AND visitor_id=$2', [req.params.videoId, visiteurId])
      liked = likedRes.rows.length > 0
    }
    res.json({ count: countRes.rows[0].count, liked })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// POST /api/formations/:id/videos/:videoId/likes - toggle like (body: visiteurId)
router.post('/:id/videos/:videoId/likes', async (req, res) => {
  try {
    const { visiteurId } = req.body
    if (!visiteurId) return res.status(400).json({ message: 'visiteurId requis' })

    const existing = await pool.query('SELECT id FROM formation_contenu_likes WHERE contenu_id=$1 AND visitor_id=$2', [req.params.videoId, visiteurId])
    let liked
    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM formation_contenu_likes WHERE id=$1', [existing.rows[0].id])
      liked = false
    } else {
      await pool.query('INSERT INTO formation_contenu_likes (contenu_id, visitor_id) VALUES ($1,$2)', [req.params.videoId, visiteurId])
      liked = true
    }
    const countRes = await pool.query('SELECT COUNT(*)::int as count FROM formation_contenu_likes WHERE contenu_id=$1', [req.params.videoId])
    res.json({ count: countRes.rows[0].count, liked })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// GET /api/formations/:id/videos/:videoId/comments - liste des commentaires
router.get('/:id/videos/:videoId/comments', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM formation_contenu_comments WHERE contenu_id=$1 ORDER BY created_at DESC',
      [req.params.videoId]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// POST /api/formations/:id/videos/:videoId/comments - ajouter un commentaire (public)
router.post('/:id/videos/:videoId/comments', async (req, res) => {
  try {
    const { nom, texte } = req.body
    if (!texte || !texte.trim()) return res.status(400).json({ message: 'Commentaire requis' })

    const result = await pool.query(
      `INSERT INTO formation_contenu_comments (contenu_id, nom, texte) VALUES ($1,$2,$3) RETURNING *`,
      [req.params.videoId, (nom && nom.trim()) || 'Visiteur', texte.trim()]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// DELETE /api/formations/:id/videos/:videoId/comments/:commentId - moderation (admin/formateur)
router.delete('/:id/videos/:videoId/comments/:commentId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'formateur') return res.status(403).json({ message: 'Acces refuse' })
    const result = await pool.query(
      'DELETE FROM formation_contenu_comments WHERE id=$1 AND contenu_id=$2 RETURNING id',
      [req.params.commentId, req.params.videoId]
    )
    if (result.rows.length === 0) return res.status(404).json({ message: 'Commentaire introuvable' })
    res.json({ message: 'Commentaire supprime' })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

module.exports = router
