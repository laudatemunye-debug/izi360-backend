// Usage : node scripts/fix-compte-entreprise.js email@exemple.com
const pool = require('../src/config/db')

async function fix() {
  const email = process.argv[2]
  if (!email) {
    console.error('Usage: node scripts/fix-compte-entreprise.js email@exemple.com')
    process.exit(1)
  }
  try {
    const entRow = await pool.query('SELECT admin_email FROM beautycrm_entreprises WHERE admin_email=$1', [email])
    if (entRow.rows.length === 0) {
      console.log('Ce compte n est pas admin d une entreprise. Rien a faire.')
      return
    }
    await pool.query('DELETE FROM beautycrm_entreprises WHERE admin_email=$1', [email])
    console.log('Mode entreprise supprime cote serveur pour', email, '- cascade sur les employes effectuee.')
  } catch (err) {
    console.error('Erreur :', err.message)
  } finally {
    await pool.end()
  }
}

fix()
