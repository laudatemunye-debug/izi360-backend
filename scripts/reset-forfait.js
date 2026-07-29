// Usage : node scripts/reset-forfait.js email@exemple.com
const pool = require('../src/config/db')

async function reset() {
  const email = process.argv[2]
  if (!email) {
    console.error('Usage: node scripts/reset-forfait.js email@exemple.com')
    process.exit(1)
  }
  try {
    const result = await pool.query(
      `UPDATE beautycrm_users
       SET forfait_type = 'essai', forfait_expire_le = NULL, ia_addon = FALSE
       WHERE email = $1
       RETURNING email, forfait_type`,
      [email]
    )
    if (result.rows.length === 0) {
      console.log('Aucun utilisateur trouve avec cet email.')
    } else {
      console.log('Reinitialise :', result.rows[0])
    }
  } catch (err) {
    console.error('Erreur :', err.message)
  } finally {
    await pool.end()
  }
}

reset()
