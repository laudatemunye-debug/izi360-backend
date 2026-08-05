const pool = require('../src/config/db')

async function migrer() {
  try {
    await pool.query(`
      ALTER TABLE beautycrm_users
      ADD COLUMN IF NOT EXISTS derniere_connexion TIMESTAMP
    `)
    console.log('Migration reussie : colonne derniere_connexion ajoutee.')
  } catch (err) {
    console.error('Erreur de migration :', err.message)
  } finally {
    await pool.end()
  }
}

migrer()
