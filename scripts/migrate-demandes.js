const pool = require('../src/config/db')

async function migrer() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS beautycrm_demandes_paiement (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        code_reference VARCHAR(20) UNIQUE NOT NULL,
        forfait_type VARCHAR(20) NOT NULL,
        duree_mois INTEGER NOT NULL,
        ia_addon BOOLEAN DEFAULT FALSE,
        montant_attendu NUMERIC(10,2),
        statut VARCHAR(20) DEFAULT 'attente',
        created_at TIMESTAMP DEFAULT NOW(),
        confirme_at TIMESTAMP
      )
    `)
    console.log('Migration reussie : table beautycrm_demandes_paiement creee.')
  } catch (err) {
    console.error('Erreur de migration :', err.message)
  } finally {
    await pool.end()
  }
}

migrer()
