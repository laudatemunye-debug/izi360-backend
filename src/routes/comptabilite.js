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

function requireAdminOuComptable(req, res, next) {
  if (['admin', 'comptable'].includes(req.user.role)) return next()
  return res.status(403).json({ message: 'Accès réservé admin/comptable' })
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

router.get('/plan-comptable', requireAdminOuComptable, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM plan_comptable WHERE organisation_id=$1 ORDER BY code`,
      [req.user.organisation_id]
    )
    res.json(rows)
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
})

router.post('/plan-comptable/init', requireAdmin, async (req, res) => {
  const orgId = req.user.organisation_id
  try {
    await pool.query(`
      INSERT INTO plan_comptable (organisation_id, code, libelle, type) VALUES
      ($1,'512','Banque','actif'),($1,'571','Caisse','actif'),($1,'411','Clients','actif'),
      ($1,'401','Fournisseurs','passif'),($1,'701','Ventes de marchandises','produit'),
      ($1,'601','Achats de marchandises','charge'),($1,'613','Loyer','charge'),
      ($1,'624','Transport','charge'),($1,'641','Salaires','charge'),
      ($1,'645','Charges sociales','charge'),($1,'101','Capital','capitaux')
      ON CONFLICT DO NOTHING`, [orgId])
    res.json({ message: 'Plan comptable initialisé' })
  } catch (err) { res.status(500).json({ message: 'Erreur initialisation' }) }
})

router.get('/ecritures', requireAdminOuComptable, async (req, res) => {
  const { debut, fin } = req.query
  try {
    const { rows } = await pool.query(
      `SELECT e.*, d.code AS code_debit, d.libelle AS libelle_debit,
         c.code AS code_credit, c.libelle AS libelle_credit
       FROM ecritures_comptables e
       JOIN plan_comptable d ON d.id=e.compte_debit
       JOIN plan_comptable c ON c.id=e.compte_credit
       WHERE e.organisation_id=$1
         AND ($2::date IS NULL OR e.date>=$2)
         AND ($3::date IS NULL OR e.date<=$3)
       ORDER BY e.date DESC`,
      [req.user.organisation_id, debut||null, fin||null]
    )
    res.json(rows)
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
})

router.post('/ecritures', requireAdminOuComptable, async (req, res) => {
  const { date, compte_debit, compte_credit, montant, libelle, reference_piece } = req.body
  if (!date || !compte_debit || !compte_credit || !montant || !libelle)
    return res.status(400).json({ message: 'Champs manquants' })
  try {
    const { rows } = await pool.query(
      `INSERT INTO ecritures_comptables
        (organisation_id,date,compte_debit,compte_credit,montant,libelle,reference_piece,source_type,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'manuelle',$8) RETURNING *`,
      [req.user.organisation_id, date, compte_debit, compte_credit, montant, libelle, reference_piece||null, req.user.id]
    )
    await logAudit(req.user.organisation_id, req.user.id, 'create', 'ecriture', rows[0].id)
    res.status(201).json(rows[0])
  } catch (err) { res.status(500).json({ message: 'Erreur création écriture' }) }
})

router.post('/ecritures/:id/annuler', requireAdmin, async (req, res) => {
  try {
    const orig = await pool.query(
      `SELECT * FROM ecritures_comptables WHERE id=$1 AND organisation_id=$2`,
      [req.params.id, req.user.organisation_id]
    )
    if (!orig.rows.length) return res.status(404).json({ message: 'Écriture introuvable' })
    const e = orig.rows[0]
    const { rows } = await pool.query(
      `INSERT INTO ecritures_comptables
        (organisation_id,date,compte_debit,compte_credit,montant,libelle,source_type,source_id,created_by)
       VALUES ($1,CURRENT_DATE,$2,$3,$4,$5,'annulation',$6,$7) RETURNING *`,
      [req.user.organisation_id, e.compte_credit, e.compte_debit, e.montant, `Annulation: ${e.libelle}`, e.id, req.user.id]
    )
    await pool.query(`UPDATE ecritures_comptables SET annule_par=$1 WHERE id=$2`, [rows[0].id, e.id])
    await logAudit(req.user.organisation_id, req.user.id, 'annulation', 'ecriture', e.id)
    res.json(rows[0])
  } catch (err) { res.status(500).json({ message: 'Erreur annulation' }) }
})

router.get('/charges', requireAdminOuComptable, async (req, res) => {
  const { debut, fin } = req.query
  try {
    const { rows } = await pool.query(
      `SELECT * FROM charges WHERE organisation_id=$1
       AND ($2::date IS NULL OR date>=$2) AND ($3::date IS NULL OR date<=$3)
       ORDER BY date DESC`,
      [req.user.organisation_id, debut||null, fin||null]
    )
    res.json(rows)
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
})

router.post('/charges', requireAdminOuComptable, async (req, res) => {
  const { categorie, libelle, montant, date, compte_charge_id, compte_paiement_id } = req.body
  if (!categorie || !libelle || !montant || !date || !compte_charge_id || !compte_paiement_id)
    return res.status(400).json({ message: 'Champs manquants' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const ecriture = await client.query(
      `INSERT INTO ecritures_comptables
        (organisation_id,date,compte_debit,compte_credit,montant,libelle,source_type,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'charge',$7) RETURNING id`,
      [req.user.organisation_id, date, compte_charge_id, compte_paiement_id, montant, libelle, req.user.id]
    )
    const charge = await client.query(
      `INSERT INTO charges (organisation_id,categorie,libelle,montant,date,ecriture_id,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.organisation_id, categorie, libelle, montant, date, ecriture.rows[0].id, req.user.id]
    )
    await client.query('COMMIT')
    await logAudit(req.user.organisation_id, req.user.id, 'create', 'charge', charge.rows[0].id)
    res.status(201).json(charge.rows[0])
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ message: 'Erreur création charge' })
  } finally { client.release() }
})

router.get('/balance', requireAdminOuComptable, async (req, res) => {
  const { debut, fin } = req.query
  try {
    const { rows } = await pool.query(
      `SELECT pc.code, pc.libelle, pc.type,
         COALESCE(SUM(CASE WHEN e.compte_debit=pc.id THEN e.montant ELSE 0 END),0) AS total_debit,
         COALESCE(SUM(CASE WHEN e.compte_credit=pc.id THEN e.montant ELSE 0 END),0) AS total_credit
       FROM plan_comptable pc
       LEFT JOIN ecritures_comptables e
         ON (e.compte_debit=pc.id OR e.compte_credit=pc.id)
         AND ($2::date IS NULL OR e.date>=$2) AND ($3::date IS NULL OR e.date<=$3)
       WHERE pc.organisation_id=$1
       GROUP BY pc.id,pc.code,pc.libelle,pc.type ORDER BY pc.code`,
      [req.user.organisation_id, debut||null, fin||null]
    )
    res.json(rows)
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
})

router.get('/compte-resultat', requireAdminOuComptable, async (req, res) => {
  const { debut, fin } = req.query
  try {
    const { rows } = await pool.query(
      `SELECT pc.code, pc.libelle, pc.type,
         COALESCE(SUM(CASE
           WHEN pc.type='produit' AND e.compte_credit=pc.id THEN e.montant
           WHEN pc.type='charge' AND e.compte_debit=pc.id THEN e.montant
           ELSE 0 END),0) AS total
       FROM plan_comptable pc
       LEFT JOIN ecritures_comptables e
         ON (e.compte_debit=pc.id OR e.compte_credit=pc.id)
         AND ($2::date IS NULL OR e.date>=$2) AND ($3::date IS NULL OR e.date<=$3)
       WHERE pc.organisation_id=$1 AND pc.type IN ('charge','produit')
       GROUP BY pc.id,pc.code,pc.libelle,pc.type ORDER BY pc.type,pc.code`,
      [req.user.organisation_id, debut||null, fin||null]
    )
    const produits = rows.filter(r=>r.type==='produit').reduce((s,r)=>s+parseFloat(r.total),0)
    const charges = rows.filter(r=>r.type==='charge').reduce((s,r)=>s+parseFloat(r.total),0)
    res.json({ lignes: rows, total_produits: produits, total_charges: charges, resultat: produits-charges })
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
})

router.get('/periodes', requireAdminOuComptable, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM periodes_comptables WHERE organisation_id=$1 ORDER BY date_debut DESC`,
      [req.user.organisation_id]
    )
    res.json(rows)
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
})

router.post('/periodes', requireAdmin, async (req, res) => {
  const { date_debut, date_fin } = req.body
  if (!date_debut || !date_fin) return res.status(400).json({ message: 'Dates manquantes' })
  try {
    const { rows } = await pool.query(
      `INSERT INTO periodes_comptables (organisation_id,date_debut,date_fin) VALUES ($1,$2,$3) RETURNING *`,
      [req.user.organisation_id, date_debut, date_fin]
    )
    res.status(201).json(rows[0])
  } catch (err) { res.status(500).json({ message: 'Erreur création période' }) }
})

router.post('/periodes/:id/cloturer', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE periodes_comptables SET cloturee=TRUE,cloturee_par=$1,cloturee_at=now()
       WHERE id=$2 AND organisation_id=$3 RETURNING *`,
      [req.user.id, req.params.id, req.user.organisation_id]
    )
    if (!rows.length) return res.status(404).json({ message: 'Période introuvable' })
    await logAudit(req.user.organisation_id, req.user.id, 'cloture', 'periode', req.params.id)
    res.json(rows[0])
  } catch (err) { res.status(500).json({ message: 'Erreur clôture' }) }
})

module.exports = router
