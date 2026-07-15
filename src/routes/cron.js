const express = require('express')
const router = express.Router()
const pool = require('../config/db')
const { envoyerWhatsApp } = require('../utils/whatsapp')
const transporter = require('../config/mailer')

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS formation_relances (
      id SERIAL PRIMARY KEY,
      inscription_id INTEGER NOT NULL REFERENCES formation_inscriptions(id) ON DELETE CASCADE,
      palier VARCHAR(20) NOT NULL,
      envoye_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(inscription_id, palier)
    )
  `)
}

const PALIERS = [
  { code: 'J-30', jours: 30, canal: 'both' },
  { code: 'J-21', jours: 21, canal: 'email' },
  { code: 'J-14', jours: 14, canal: 'whatsapp' },
  { code: 'J-7',  jours: 7,  canal: 'both' },
  { code: 'J-3',  jours: 3,  canal: 'whatsapp' },
  { code: 'J-1',  jours: 1,  canal: 'whatsapp' },
  { code: 'J0',   jours: 0,  canal: 'whatsapp' },
]

function messageParPalier(code, inscrit, formation) {
  const dateTexte = formation.date_debut
    ? new Date(formation.date_debut).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'bientot'

  const messages = {
    'J-30': `Bonjour ${inscrit.nom} ! Merci de vous etre inscrit(e) a *${formation.titre}*. Rendez-vous le ${dateTexte}.`,
    'J-14': `Bonjour ${inscrit.nom}, les places pour *${formation.titre}* se remplissent vite. Ne manquez pas le ${dateTexte} !`,
    'J-7':  `Bonjour ${inscrit.nom}, plus qu'une semaine avant *${formation.titre}* (${dateTexte}). Voici le programme detaille, restez connecte(e).`,
    'J-3':  `Bonjour ${inscrit.nom}, encore 3 jours avant *${formation.titre}* ! On vous attend le ${dateTexte}.`,
    'J-1':  `Bonjour ${inscrit.nom}, c'est demain ! *${formation.titre}* commence le ${dateTexte}. Preparez-vous !`,
    'J0':   `Bonjour ${inscrit.nom}, c'est aujourd'hui ! *${formation.titre}* a lieu maintenant. A tout de suite !`,
  }
  return messages[code] || `Rappel: ${formation.titre} - ${dateTexte}`
}

router.get('/relances', async (req, res) => {
  const auth = req.headers.authorization || ''
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ message: 'Non autorise' })
  }

  await ensureTable()

  const formations = await pool.query(
    `SELECT * FROM formations WHERE actif = true AND date_debut IS NOT NULL`
  )

  let envoyes = []

  for (const formation of formations.rows) {
    const joursRestants = Math.ceil(
      (new Date(formation.date_debut) - new Date()) / (1000 * 60 * 60 * 24)
    )

    const palier = PALIERS.find(p => p.jours === joursRestants)
    if (!palier) continue

    const inscrits = await pool.query(
      `SELECT i.* FROM formation_inscriptions i
       WHERE i.formation_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM formation_relances r
         WHERE r.inscription_id = i.id AND r.palier = $2
       )`,
      [formation.id, palier.code]
    )

    for (const inscrit of inscrits.rows) {
      const message = messageParPalier(palier.code, inscrit, formation)

      if (palier.canal === 'whatsapp' || palier.canal === 'both') {
        envoyerWhatsApp(inscrit.telephone, message).catch(err => console.error('WhatsApp relance erreur:', err))
      }
      if ((palier.canal === 'email' || palier.canal === 'both') && inscrit.email) {
        transporter.sendMail({
          from: process.env.UTILISATEUR_MAIL,
          to: inscrit.email,
          subject: `${formation.titre} - ${palier.code}`,
          html: `<p>${message}</p>`
        }).catch(err => console.error('Email relance erreur:', err))
      }

      await pool.query(
        `INSERT INTO formation_relances (inscription_id, palier) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [inscrit.id, palier.code]
      )

      envoyes.push({ inscrit: inscrit.nom, palier: palier.code, formation: formation.titre })
    }
  }

  res.json({ success: true, envoyes })
})

module.exports = router
