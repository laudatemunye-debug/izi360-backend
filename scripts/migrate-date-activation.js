const pool = require('../src/config/db')

async function migrer() {
  try {
    await pool.query(`
      ALTER TABLE beautycrm_users
      ADD COLUMN IF NOT EXISTS forfait_active_depuis TIMESTAMP
    `)
    console.log('Migration reussie : colonne forfait_active_depuis ajoutee.')
  } catch (err) {
    console.error('Erreur de migration :', err.message)
  } finally {
    await pool.end()
  }
}

migrer()
