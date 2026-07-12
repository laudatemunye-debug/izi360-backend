const express = require('express')
const router = express.Router()
const pool = require('../config/db')
const auth = require('../middleware/auth')

router.use(auth)

function requireEntreprise(req, res, next) {
  if (req.user.mode !== 'entreprise') {
    return res.status(403).json({ message: 'Fonctionnalité réservée au mode entreprise' })
  }
  next()
}

function requireAdmin(req, res, next) {
  if (req.user.role === 'admin') return next()
  return res.status(403).json({ message: 'Accès réservé admin' })
}

router.use(requireEntreprise)

function logAudit(orgId, userId, action, entite, entiteId) {
  return pool.query(
    `INSERT INTO audit_log (organisation_id, user_id, action, entite, entite_id) VALUES ($1,$2,$3,$4,$5)`,
    [orgId, userId, action, entite, entiteId]
  )
}

router.get('/employes', async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      const { rows } = await pool.query(
        `SELECT * FROM employes WHERE organisation_id=$1 AND actif=TRUE ORDER BY nom`,
        [req.user.organisation_id]
      )
      return res.json(rows)
    }
    const { rows } = await pool.query(
      `SELECT id,nom,poste,mode_paiement FROM employes WHERE organisation_id=$1 AND user_id=$2`,
      [req.user.organisation_id, req.user.id]
    )
    res.json(rows)
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
})

router.post('/employes', requireAdmin, async (req, res) => {
  const { user_id, nom, poste, salaire_base, mode_paiement } = req.body
  if (!nom || !salaire_base) return res.status(400).json({ message: 'Champs manquants' })
  try {
    const { rows } = await pool.query(
      `INSERT INTO employes (organisation_id,user_id,nom,poste,salaire_base,mode_paiement)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.organisation_id, user_id||null, nom, poste||null, salaire_base, mode_paiement||'especes']
    )
    await logAudit(req.user.organisation_id, req.user.id, 'create', 'employe', rows[0].id)
    res.status(201).json(rows[0])
  } catch (err) { res.status(500).json({ message: 'Erreur création employé' }) }
})

router.put('/employes/:id', requireAdmin, async (req, res) => {
  const { nom, poste, salaire_base, mode_paiement, actif } = req.body
  try {
    const { rows } = await pool.query(
      `UPDATE employes SET nom=COALESCE($1,nom),poste=COALESCE($2,poste),
        salaire_base=COALESCE($3,salaire_base),mode_paiement=COALESCE($4,mode_paiement),actif=COALESCE($5,actif)
       WHERE id=$6 AND organisation_id=$7 RETURNING *`,
      [nom, poste, salaire_base, mode_paiement, actif, req.params.id, req.user.organisation_id]
    )
    if (!rows.length) return res.status(404).json({ message: 'Employé introuvable' })
    res.json(rows[0])
  } catch (err) { res.status(500).json({ message: 'Erreur mise à jour' }) }
})

router.get('/bulletins', async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      const { rows } = await pool.query(
        `SELECT b.*,e.nom AS employe_nom FROM bulletins_paie b
         JOIN employes e ON e.id=b.employe_id
         WHERE b.organisation_id=$1 ORDER BY b.periode_debut DESC`,
        [req.user.organisation_id]
      )
      return res.json(rows)
    }
    const { rows } = await pool.query(
      `SELECT b.periode_debut,b.periode_fin,b.salaire_brut,b.primes,b.retenues,b.salaire_net,b.valide,b.created_at
       FROM bulletins_paie b JOIN employes e ON e.id=b.employe_id
       WHERE b.organisation_id=$1 AND e.user_id=$2 ORDER BY b.periode_debut DESC`,
      [req.user.organisation_id, req.user.id]
    )
    res.json(rows)
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
})

router.get('/bulletins/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.*,e.nom,e.user_id AS employe_user_id FROM bulletins_paie b
       JOIN employes e ON e.id=b.employe_id
       WHERE b.id=$1 AND b.organisation_id=$2`,
      [req.params.id, req.user.organisation_id]
    )
    if (!rows.length) return res.status(404).json({ message: 'Bulletin introuvable' })
    if (req.user.role !== 'admin' && rows[0].employe_user_id !== req.user.id)
      return res.status(403).json({ message: 'Accès interdit' })
    res.json(rows[0])
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
})

router.post('/bulletins', requireAdmin, async (req, res) => {
  const { employe_id, periode_debut, periode_fin, primes=0, retenues=0, compte_salaire_id, compte_paiement_id } = req.body
  if (!employe_id || !periode_debut || !periode_fin || !compte_salaire_id || !compte_paiement_id)
    return res.status(400).json({ message: 'Champs manquants' })
  const client = await pool.connect()
  try {
    const emp = await client.query(
      `SELECT * FROM employes WHERE id=$1 AND organisation_id=$2`,
      [employe_id, req.user.organisation_id]
    )
    if (!emp.rows.length) return res.status(404).json({ message: 'Employé introuvable' })
    const e = emp.rows[0]
    const brut = parseFloat(e.salaire_base) + parseFloat(primes)
    const net = brut - parseFloat(retenues)
    await client.query('BEGIN')
    const ecriture = await client.query(
      `INSERT INTO ecritures_comptables
        (organisation_id,date,compte_debit,compte_credit,montant,libelle,source_type,created_by)
       VALUES ($1,CURRENT_DATE,$2,$3,$4,$5,'paie',$6) RETURNING id`,
      [req.user.organisation_id, compte_salaire_id, compte_paiement_id, net,
       `Salaire ${e.nom} - ${periode_debut} au ${periode_fin}`, req.user.id]
    )
    const bulletin = await client.query(
      `INSERT INTO bulletins_paie
        (organisation_id,employe_id,periode_debut,periode_fin,salaire_brut,primes,retenues,salaire_net,ecriture_id,valide,valide_par,valide_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10,now()) RETURNING *`,
      [req.user.organisation_id, employe_id, periode_debut, periode_fin, brut, primes, retenues, net, ecriture.rows[0].id, req.user.id]
    )
    await client.query('COMMIT')
    await logAudit(req.user.organisation_id, req.user.id, 'valide_paie', 'bulletin_paie', bulletin.rows[0].id)
    res.status(201).json(bulletin.rows[0])
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ message: 'Erreur génération bulletin' })
  } finally { client.release() }
})

router.get('/masse-salariale', requireAdmin, async (req, res) => {
  const { debut, fin } = req.query
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS nb_bulletins, SUM(salaire_brut) AS total_brut,
         SUM(primes) AS total_primes, SUM(retenues) AS total_retenues, SUM(salaire_net) AS total_net
       FROM bulletins_paie WHERE organisation_id=$1
         AND ($2::date IS NULL OR periode_debut>=$2) AND ($3::date IS NULL OR periode_fin<=$3)`,
      [req.user.organisation_id, debut||null, fin||null]
    )
    res.json(rows[0])
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
})

module.exports = router
