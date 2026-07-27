// Script de migration a executer une seule fois : node scripts/migrate-forfait.js
const pool = require('../src/config/db')

async function migrer() {
  try {
    await pool.query(`
      ALTER TABLE beautycrm_users
      ADD COLUMN IF NOT EXISTS forfait_type VARCHAR(20) DEFAULT 'essai',
      ADD COLUMN IF NOT EXISTS forfait_expire_le TIMESTAMP,
      ADD COLUMN IF NOT EXISTS ia_addon BOOLEAN DEFAULT FALSE
    `)
    console.log('Migration reussie : colonnes forfait_type, forfait_expire_le, ia_addon ajoutees.')
  } catch (err) {
    console.error('Erreur de migration :', err.message)
  } finally {
    await pool.end()
  }
}

migrer()
