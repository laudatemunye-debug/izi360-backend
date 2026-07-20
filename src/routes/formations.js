const express = require('express')
const router = express.Router()
const pool = require('../config/db')
const auth = require('../middleware/auth')
const transporter = require('../config/mailer')
const { envoyerWhatsApp } = require('../utils/whatsapp')
const { rateLimit, ipKeyGenerator } = require('express-rate-limit')

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: 'Trop de requêtes, réessayez plus tard' },
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  validate: { trustProxy: false }
})

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
      created_at TIMESTAMP DEFAULT NOW(),
      heure_debut VARCHAR(5),
      fuseau_horaire VARCHAR(50) DEFAULT 'Africa/Lubumbashi'
    )
  `)
  await pool.query(`ALTER TABLE formations ADD COLUMN IF NOT EXISTS heure_debut VARCHAR(5)`)
  await pool.query(`ALTER TABLE formations ADD COLUMN IF NOT EXISTS fuseau_horaire VARCHAR(50) DEFAULT 'Africa/Lubumbashi'`)
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sondages (
      id SERIAL PRIMARY KEY,
      type VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sondage_reponses (
      id SERIAL PRIMARY KEY,
      sondage_id INTEGER REFERENCES sondages(id) ON DELETE CASCADE,
      telephone VARCHAR(50),
      nom VARCHAR(255),
      reponse TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sondage_envois (
      id SERIAL PRIMARY KEY,
      sondage_id INTEGER REFERENCES sondages(id) ON DELETE CASCADE,
      telephone VARCHAR(50) NOT NULL,
      envoye_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sondage_envois (
      id SERIAL PRIMARY KEY,
      sondage_id INTEGER REFERENCES sondages(id) ON DELETE CASCADE,
      telephone VARCHAR(50) NOT NULL,
      envoye_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS broadcast_campagnes (
      id SERIAL PRIMARY KEY,
      type VARCHAR(50) NOT NULL DEFAULT 'diffusion',
      message_base TEXT NOT NULL,
      variantes JSONB,
      exclure_numeros JSONB DEFAULT '[]',
      max_par_jour INTEGER DEFAULT 20,
      statut VARCHAR(20) DEFAULT 'en_cours',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS broadcast_envois (
      id SERIAL PRIMARY KEY,
      campagne_id INTEGER REFERENCES broadcast_campagnes(id) ON DELETE CASCADE,
      telephone VARCHAR(50) NOT NULL,
      nom VARCHAR(255),
      statut VARCHAR(20) DEFAULT 'en_attente',
      envoye_at TIMESTAMP
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


// GET /api/formations/contexte/:telephone - contexte pour l'agent IA WhatsApp (protege par secret partage)
router.get('/contexte/:telephone', async (req, res) => {
  try {
    const secret = req.headers.authorization || ''
    if (secret !== `Bearer ${process.env.WHATSAPP_SECRET}`) {
      return res.status(401).json({ message: 'Non autorise' })
    }

    const numero = (req.params.telephone || '').replace(/[^0-9]/g, '')

    const inscriptionResult = await pool.query(
      `SELECT i.nom, i.telephone, i.domaine, i.utilise_beautycrm,
              f.titre, f.description, f.lieu, f.duree, f.date_debut, f.heure_debut, f.fuseau_horaire, f.formateur
       FROM formation_inscriptions i
       JOIN formations f ON f.id = i.formation_id
       WHERE TRIM(REGEXP_REPLACE(i.telephone, '[^0-9]', '', 'g')) = $1
       ORDER BY i.created_at DESC
       LIMIT 1`,
      [numero]
    )

    const utilisateurResult = await pool.query(
      `SELECT nom, email, telephone, entreprise, role, devise, version, referral_code, created_at
       FROM beautycrm_users
       WHERE TRIM(REGEXP_REPLACE(telephone, '[^0-9]', '', 'g')) = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [numero]
    )

    let modeEntreprise = null
    const emailUtilisateur = utilisateurResult.rows[0]?.email

    if (emailUtilisateur) {
      const estAdmin = await pool.query(
        'SELECT admin_email, fermee FROM beautycrm_entreprises WHERE admin_email=$1',
        [emailUtilisateur]
      )
      if (estAdmin.rows.length > 0) {
        modeEntreprise = { statut: 'administrateur', entreprise_fermee: estAdmin.rows[0].fermee === true }
      } else {
        const estEmploye = await pool.query(
          'SELECT admin_email, poste, revoked FROM beautycrm_employes WHERE email=$1 ORDER BY created_at DESC LIMIT 1',
          [emailUtilisateur]
        )
        if (estEmploye.rows.length > 0) {
          modeEntreprise = {
            statut: 'employe',
            poste: estEmploye.rows[0].poste,
            acces_revoque: estEmploye.rows[0].revoked === true,
          }
        } else {
          modeEntreprise = { statut: 'personnel' }
        }
      }
    }

    if (inscriptionResult.rows.length === 0 && utilisateurResult.rows.length === 0) {
      return res.status(404).json({ message: 'Aucun contexte trouve pour ce numero' })
    }

    res.json({
      inscription_formation: inscriptionResult.rows[0] || null,
      utilisateur_beautycrm: utilisateurResult.rows[0] || null,
      mode_entreprise: modeEntreprise,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// GET /api/formations/contexte-email/:email - meme contexte mais recherche par email (priorite pour identification)
router.get('/contexte-email/:email', async (req, res) => {
  try {
    const secret = req.headers.authorization || ''
    if (secret !== `Bearer ${process.env.WHATSAPP_SECRET}`) {
      return res.status(401).json({ message: 'Non autorise' })
    }

    const email = (req.params.email || '').trim().toLowerCase()
    if (!email) return res.status(400).json({ message: 'Email requis' })

    const inscriptionResult = await pool.query(
      `SELECT i.nom, i.telephone, i.domaine, i.utilise_beautycrm,
              f.titre, f.description, f.lieu, f.duree, f.date_debut, f.heure_debut, f.fuseau_horaire, f.formateur
       FROM formation_inscriptions i
       JOIN formations f ON f.id = i.formation_id
       WHERE LOWER(TRIM(i.email)) = $1
       ORDER BY i.created_at DESC
       LIMIT 1`,
      [email]
    )

    const utilisateurResult = await pool.query(
      `SELECT nom, email, telephone, entreprise, role, devise, version, referral_code, created_at
       FROM beautycrm_users
       WHERE LOWER(TRIM(email)) = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [email]
    )

    let modeEntreprise = null
    if (utilisateurResult.rows.length > 0 || inscriptionResult.rows.length > 0) {
      const estAdmin = await pool.query(
        'SELECT admin_email, fermee FROM beautycrm_entreprises WHERE admin_email=$1',
        [email]
      )
      if (estAdmin.rows.length > 0) {
        modeEntreprise = { statut: 'administrateur', entreprise_fermee: estAdmin.rows[0].fermee === true }
      } else {
        const estEmploye = await pool.query(
          'SELECT admin_email, poste, revoked FROM beautycrm_employes WHERE email=$1 ORDER BY created_at DESC LIMIT 1',
          [email]
        )
        if (estEmploye.rows.length > 0) {
          modeEntreprise = {
            statut: 'employe',
            poste: estEmploye.rows[0].poste,
            acces_revoque: estEmploye.rows[0].revoked === true,
          }
        } else {
          modeEntreprise = { statut: 'personnel' }
        }
      }
    }

    if (inscriptionResult.rows.length === 0 && utilisateurResult.rows.length === 0) {
      return res.status(404).json({ message: 'Aucun contexte trouve pour cet email' })
    }

    res.json({
      inscription_formation: inscriptionResult.rows[0] || null,
      utilisateur_beautycrm: utilisateurResult.rows[0] || null,
      mode_entreprise: modeEntreprise,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// GET /api/formations/admin/stats-utilisateurs?periode=jour|semaine|mois|total
// Protege par secret partage (utilise par l'agent WhatsApp pour les commandes admin)
router.get('/admin/stats-utilisateurs', async (req, res) => {
  try {
    const secret = req.headers.authorization || ''
    if (secret !== `Bearer ${process.env.WHATSAPP_SECRET}`) {
      return res.status(401).json({ message: 'Non autorise' })
    }

    const periode = req.query.periode || 'total'
    let filtreDate = ''
    if (periode === 'jour') filtreDate = `WHERE created_at >= CURRENT_DATE`
    else if (periode === 'semaine') filtreDate = `WHERE created_at >= date_trunc('week', NOW())`
    else if (periode === 'mois') filtreDate = `WHERE created_at >= date_trunc('month', NOW())`

    const totalResult = await pool.query(`SELECT COUNT(*)::int as total FROM beautycrm_users`)

    const listeResult = periode !== 'total'
      ? await pool.query(`SELECT nom, email, telephone, created_at FROM beautycrm_users ${filtreDate} ORDER BY created_at DESC`)
      : { rows: [] }

    res.json({
      periode,
      total_utilisateurs: totalResult.rows[0].total,
      nombre_periode: periode !== 'total' ? listeResult.rows.length : null,
      liste: periode !== 'total' ? listeResult.rows : null,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// GET /api/formations/admin/inscrits-formation/:slugOuTitre
router.get('/admin/inscrits-formation/:recherche', async (req, res) => {
  try {
    const secret = req.headers.authorization || ''
    if (secret !== `Bearer ${process.env.WHATSAPP_SECRET}`) {
      return res.status(401).json({ message: 'Non autorise' })
    }

    const recherche = `%${req.params.recherche}%`
    const result = await pool.query(
      `SELECT f.titre, i.nom, i.telephone, i.email, i.created_at
       FROM formation_inscriptions i
       JOIN formations f ON f.id = i.formation_id
       WHERE f.titre ILIKE $1 OR f.slug ILIKE $1
       ORDER BY i.created_at DESC`,
      [recherche]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Aucune formation correspondante trouvee' })
    }

    res.json({
      formation_titre: result.rows[0].titre,
      nombre_inscrits: result.rows.length,
      inscrits: result.rows.map(r => ({ nom: r.nom, telephone: r.telephone, email: r.email, date: r.created_at })),
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// POST /api/formations/admin/sondage - crée un sondage et retourne la liste des destinataires
router.post('/admin/sondage', async (req, res) => {
  try {
    const secret = req.headers.authorization || ''
    if (secret !== `Bearer ${process.env.WHATSAPP_SECRET}`) {
      return res.status(401).json({ message: 'Non autorise' })
    }
    const { type, message } = req.body
    if (!type || !message) return res.status(400).json({ message: 'type et message requis' })

    const result = await pool.query(
      'INSERT INTO sondages (type, message) VALUES ($1,$2) RETURNING *',
      [type, message]
    )
    const sondage = result.rows[0]

    const destinataires = await pool.query(
      `SELECT nom, telephone FROM beautycrm_users WHERE telephone IS NOT NULL AND telephone != ''`
    )

    res.status(201).json({
      sondage_id: sondage.id,
      type: sondage.type,
      message: sondage.message,
      destinataires: destinataires.rows,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// POST /api/formations/admin/sondage-reponse - enregistre la reponse d'un utilisateur
router.post('/admin/sondage-reponse', async (req, res) => {
  try {
    const secret = req.headers.authorization || ''
    if (secret !== `Bearer ${process.env.WHATSAPP_SECRET}`) {
      return res.status(401).json({ message: 'Non autorise' })
    }
    const { sondage_id, telephone, nom, reponse } = req.body
    if (!sondage_id || !telephone || !reponse) return res.status(400).json({ message: 'Champs manquants' })

    await pool.query(
      'INSERT INTO sondage_reponses (sondage_id, telephone, nom, reponse) VALUES ($1,$2,$3,$4)',
      [sondage_id, telephone, nom || '', reponse]
    )
    res.status(201).json({ message: 'Reponse enregistree' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// GET /api/formations/admin/sondage-resultat/:id - resultats d'un sondage
router.get('/admin/sondage-resultat/:id', async (req, res) => {
  try {
    const secret = req.headers.authorization || ''
    if (secret !== `Bearer ${process.env.WHATSAPP_SECRET}`) {
      return res.status(401).json({ message: 'Non autorise' })
    }
    const sondageResult = await pool.query('SELECT * FROM sondages WHERE id=$1', [req.params.id])
    if (sondageResult.rows.length === 0) return res.status(404).json({ message: 'Sondage introuvable' })

    const reponsesResult = await pool.query(
      'SELECT nom, telephone, reponse, created_at FROM sondage_reponses WHERE sondage_id=$1 ORDER BY created_at DESC',
      [req.params.id]
    )

    res.json({
      sondage: sondageResult.rows[0],
      nombre_reponses: reponsesResult.rows.length,
      reponses: reponsesResult.rows,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// GET /api/formations/admin/sondage-dernier - dernier sondage cree (pour /resultat sondage sans id)
router.get('/admin/sondage-dernier', async (req, res) => {
  try {
    const secret = req.headers.authorization || ''
    if (secret !== `Bearer ${process.env.WHATSAPP_SECRET}`) {
      return res.status(401).json({ message: 'Non autorise' })
    }
    const result = await pool.query('SELECT * FROM sondages ORDER BY created_at DESC LIMIT 1')
    if (result.rows.length === 0) return res.status(404).json({ message: 'Aucun sondage trouve' })
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// GET /api/formations/admin/sondage-destinataires-restants/:id - ceux qui n'ont pas encore repondu
router.get('/admin/sondage-destinataires-restants/:id', async (req, res) => {
  try {
    const secret = req.headers.authorization || ''
    if (secret !== `Bearer ${process.env.WHATSAPP_SECRET}`) {
      return res.status(401).json({ message: 'Non autorise' })
    }

    const sondageResult = await pool.query('SELECT * FROM sondages WHERE id=$1', [req.params.id])
    if (sondageResult.rows.length === 0) return res.status(404).json({ message: 'Sondage introuvable' })

    const result = await pool.query(
      `SELECT nom, telephone FROM beautycrm_users
       WHERE telephone IS NOT NULL AND telephone != ''
       AND TRIM(REGEXP_REPLACE(telephone, '[^0-9]', '', 'g')) NOT IN (
         SELECT TRIM(REGEXP_REPLACE(telephone, '[^0-9]', '', 'g')) FROM sondage_reponses WHERE sondage_id=$1
       )`,
      [req.params.id]
    )

    res.json({
      sondage: sondageResult.rows[0],
      destinataires: result.rows,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// GET /api/formations/admin/tous-destinataires?exclure=num1,num2 - liste pour annonces/diffusions
router.get('/admin/tous-destinataires', async (req, res) => {
  try {
    const secret = req.headers.authorization || ''
    if (secret !== `Bearer ${process.env.WHATSAPP_SECRET}`) {
      return res.status(401).json({ message: 'Non autorise' })
    }

    const exclureListe = (req.query.exclure || '').split(',').map(n => n.replace(/[^0-9]/g, '')).filter(Boolean)

    const result = await pool.query(
      `SELECT nom, telephone FROM beautycrm_users WHERE telephone IS NOT NULL AND telephone != ''`
    )

    const destinataires = result.rows.filter(u => {
      const num = (u.telephone || '').replace(/[^0-9]/g, '')
      return !exclureListe.includes(num)
    })

    res.json({ total: destinataires.length, destinataires })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// POST /api/formations/admin/sondage-marquer-envoye - enregistre qu'un message de sondage a bien ete envoye
router.post('/admin/sondage-marquer-envoye', async (req, res) => {
  try {
    const secret = req.headers.authorization || ''
    if (secret !== `Bearer ${process.env.WHATSAPP_SECRET}`) {
      return res.status(401).json({ message: 'Non autorise' })
    }
    const { sondage_id, telephone } = req.body
    if (!sondage_id || !telephone) return res.status(400).json({ message: 'Champs manquants' })

    await pool.query('INSERT INTO sondage_envois (sondage_id, telephone) VALUES ($1,$2)', [sondage_id, telephone])
    res.status(201).json({ message: 'ok' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// GET /api/formations/admin/sondage-en-attente/:telephone - y a-t-il un sondage envoye a ce numero sans reponse ?
router.get('/admin/sondage-en-attente/:telephone', async (req, res) => {
  try {
    const secret = req.headers.authorization || ''
    if (secret !== `Bearer ${process.env.WHATSAPP_SECRET}`) {
      return res.status(401).json({ message: 'Non autorise' })
    }
    const numero = (req.params.telephone || '').replace(/[^0-9]/g, '')

    const result = await pool.query(
      `SELECT e.sondage_id
       FROM sondage_envois e
       WHERE TRIM(REGEXP_REPLACE(e.telephone, '[^0-9]', '', 'g')) = $1
       AND NOT EXISTS (
         SELECT 1 FROM sondage_reponses r
         WHERE r.sondage_id = e.sondage_id
         AND TRIM(REGEXP_REPLACE(r.telephone, '[^0-9]', '', 'g')) = $1
       )
       ORDER BY e.envoye_at DESC
       LIMIT 1`,
      [numero]
    )

    if (result.rows.length === 0) return res.json({ en_attente: false })
    res.json({ en_attente: true, sondage_id: result.rows[0].sondage_id })
  } catch (err) {
    console.error(err)
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
    const { slug, titre, description, lieu, duree, dateDebut, heureDebut, fuseauHoraire, formateur } = req.body
    if (!slug || !titre) return res.status(400).json({ message: 'Slug et titre requis' })

    const exists = await pool.query('SELECT id FROM formations WHERE slug=$1', [slug])
    if (exists.rows.length > 0) return res.status(400).json({ message: 'Ce slug existe deja' })

    const result = await pool.query(
      `INSERT INTO formations (slug, titre, description, lieu, duree, date_debut, heure_debut, fuseau_horaire, formateur)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [slug, titre, description || '', lieu || '', duree || '', dateDebut || null, heureDebut || null, fuseauHoraire || 'Africa/Lubumbashi', formateur || '']
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})


// PATCH /api/formations/:id - modifier ou activer/desactiver (admin)
router.patch('/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Acces refuse' })
    const { actif, titre, description, lieu, duree, dateDebut, heureDebut, fuseauHoraire, formateur } = req.body

    const current = await pool.query('SELECT * FROM formations WHERE id=$1', [req.params.id])
    if (current.rows.length === 0) return res.status(404).json({ message: 'Formation introuvable' })
    const f = current.rows[0]

    const result = await pool.query(
      `UPDATE formations SET
        actif=$1, titre=$2, description=$3, lieu=$4, duree=$5,
        date_debut=$6, heure_debut=$7, fuseau_horaire=$8, formateur=$9
       WHERE id=$10 RETURNING *`,
      [
        actif !== undefined ? actif : f.actif,
        titre !== undefined ? titre : f.titre,
        description !== undefined ? description : f.description,
        lieu !== undefined ? lieu : f.lieu,
        duree !== undefined ? duree : f.duree,
        dateDebut !== undefined ? dateDebut : f.date_debut,
        heureDebut !== undefined ? heureDebut : f.heure_debut,
        fuseauHoraire !== undefined ? fuseauHoraire : f.fuseau_horaire,
        formateur !== undefined ? formateur : f.formateur,
        req.params.id
      ]
    )
    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})


// POST /api/formations/:id/inscriptions - inscription publique
router.post('/:id/inscriptions', publicLimiter, async (req, res) => {
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
    const inscrit = result.rows[0]

    // Recuperer les infos de la formation (utilise pour WhatsApp et email)
    const formationData = await pool.query('SELECT * FROM formations WHERE id=$1', [req.params.id])
    const formationInfo = formationData.rows[0]

    // Envoyer message WhatsApp de bienvenue
    if (formationInfo) {
      const dateTexte = formatDateHeureFuseau(formationInfo.date_debut, formationInfo.heure_debut, formationInfo.fuseau_horaire)
      const appUrl = process.env.APP_DOWNLOAD_URL || ''

      const messageWhatsApp = `Bonjour ${inscrit.nom} ! 🎉

Votre inscription a la formation *${formationInfo.titre}* a bien été enregistrée.

📅 Date : ${dateTexte}
📍 Lieu : ${formationInfo.lieu || 'a confirmer'}
⏱️ Durée : ${formationInfo.duree || 'a confirmer'}

📲 Pensez a telecharger l'application BeautyCRM si ce n'est pas deja fait :
${appUrl}

Nous reviendrons vers vous très bientôt avec tous les détails pratiques.

— L'équipe IZI360`

      await envoyerWhatsApp(inscrit.telephone, messageWhatsApp).catch(err => console.error('WhatsApp erreur:', err))
    }

    // Envoyer email si email fourni
    if (email && formationInfo) {
      await envoyerEmailConfirmation(inscrit, formationInfo).catch(err => console.error('Email erreur:', err))
    }

    res.status(201).json(inscrit)
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
router.post('/:id/videos/:videoId/likes', publicLimiter, async (req, res) => {
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
router.post('/:id/videos/:videoId/comments', publicLimiter, async (req, res) => {
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


function formatDateHeureFuseau(dateDebut, heureDebut, fuseauHoraire) {
  if (!dateDebut) return 'Date a confirmer'
  const tz = fuseauHoraire || 'Africa/Lubumbashi'
  const dateTexte = new Date(dateDebut).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  if (!heureDebut) return dateTexte
  try {
    const [h, m] = heureDebut.split(':')
    const refDate = new Date(dateDebut)
    refDate.setUTCHours(12, 0, 0, 0)
    const nomZone = new Intl.DateTimeFormat('fr-FR', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(refDate)
      .find(p => p.type === 'timeZoneName')?.value || tz
    return `${dateTexte} a ${h}h${m !== '00' ? m : ''} (${nomZone})`
  } catch {
    return `${dateTexte} a ${heureDebut}`
  }
}

async function envoyerEmailConfirmation(inscrit, formation) {
  const dateDebut = formatDateHeureFuseau(formation.date_debut, formation.heure_debut, formation.fuseau_horaire)

  await transporter.sendMail({
    from: `"BeautyCRM" <${process.env.MAIL_USER}>`,
    to: inscrit.email,
    subject: `Inscription confirmée — ${formation.titre}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;">
        <div style="background:#3D5AFE;padding:32px 40px;text-align:center;">
          <div style="font-size:28px;font-weight:900;color:#fff;">BeautyCRM</div>
          <div style="color:rgba(255,255,255,0.8);font-size:13px;margin-top:4px;">par IZIsoft</div>
        </div>
        <div style="padding:40px;">
          <div style="font-size:22px;font-weight:700;color:#1A1F36;margin-bottom:8px;">Bonjour ${inscrit.nom},</div>
          <p style="color:#6B7280;font-size:15px;line-height:1.7;">Votre inscription a bien été enregistrée. Nous sommes ravis de vous compter parmi nous !</p>
          <div style="background:#F5F6FA;border-radius:12px;padding:24px;margin:24px 0;border-left:4px solid #3D5AFE;">
            <div style="font-size:13px;color:#3D5AFE;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Détails de la formation</div>
            <div style="font-size:18px;font-weight:700;color:#1A1F36;margin-bottom:16px;">${formation.titre}</div>
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:6px 0;color:#6B7280;font-size:14px;width:40%;">Date</td><td style="padding:6px 0;color:#1A1F36;font-size:14px;font-weight:600;">${dateDebut}</td></tr>
              ${formation.lieu ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:14px;">Lieu</td><td style="padding:6px 0;color:#1A1F36;font-size:14px;font-weight:600;">${formation.lieu}</td></tr>` : ''}
              ${formation.duree ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:14px;">Durée</td><td style="padding:6px 0;color:#1A1F36;font-size:14px;font-weight:600;">${formation.duree}</td></tr>` : ''}
              ${formation.formateur ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:14px;">Formateur</td><td style="padding:6px 0;color:#1A1F36;font-size:14px;font-weight:600;">${formation.formateur}</td></tr>` : ''}
            </table>
          </div>
          <div style="background:#EEF0FF;border-radius:12px;padding:20px;margin-bottom:24px;">
            <div style="font-size:13px;color:#3D5AFE;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Vos informations</div>
            <div style="font-size:14px;color:#1A1F36;">
              <strong>Nom :</strong> ${inscrit.nom}<br>
              <strong>Téléphone :</strong> ${inscrit.telephone}<br>
              ${inscrit.ville ? `<strong>Ville :</strong> ${inscrit.ville}` : ''}
            </div>
          </div>
          <p style="color:#6B7280;font-size:14px;line-height:1.7;">Nous vous contacterons sur WhatsApp au <strong style="color:#1A1F36;">${inscrit.telephone}</strong> avec tous les détails pratiques.</p>
          <div style="text-align:center;margin:32px 0;">
            <a href="https://beautycrm.izi360.org?ref=LAUD-K99N" style="display:inline-block;padding:14px 32px;background:#3D5AFE;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;">Télécharger BeautyCRM gratuitement</a>
          </div>
        </div>
        <div style="background:#F5F6FA;padding:24px 40px;text-align:center;border-top:1px solid #E8EAF0;">
          <div style="color:#9CA3AF;font-size:12px;">BeautyCRM · IZIsoft © 2026 · Tous droits réservés.</div>
        </div>
      </div>
    `
  })
}

module.exports = router
