const pool = require('../src/config/db')

async function migrer() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS likelemba_devices (
        id SERIAL PRIMARY KEY,
        install_id VARCHAR(64) UNIQUE NOT NULL,
        tontine_name VARCHAR(200),
        admin_name VARCHAR(200),
        admin_phone VARCHAR(50),
        members_count INTEGER DEFAULT 0,
        app_version VARCHAR(20),
        push_subscription JSONB,
        opens_count INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW(),
        last_seen TIMESTAMP DEFAULT NOW()
      )`)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS likelemba_messages (
        id SERIAL PRIMARY KEY,
        title VARCHAR(100) NOT NULL,
        body VARCHAR(500) NOT NULL,
        sent_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP
      )`)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS likelemba_polls (
        id SERIAL PRIMARY KEY,
        question VARCHAR(200) NOT NULL,
        options JSONB NOT NULL,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        closes_at TIMESTAMP
      )`)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS likelemba_votes (
        id SERIAL PRIMARY KEY,
        poll_id INTEGER NOT NULL REFERENCES likelemba_polls(id) ON DELETE CASCADE,
        install_id VARCHAR(64) NOT NULL,
        option_index INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (poll_id, install_id)
      )`)
    // Sécurité : personne ne peut lire ces tables via l'API publique Supabase.
    for (const t of ['likelemba_devices', 'likelemba_messages', 'likelemba_polls', 'likelemba_votes']) {
      await pool.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`)
    }
    console.log('Migration reussie : tables Likelemba creees et protegees (RLS).')
  } catch (err) {
    console.error('Erreur de migration :', err.message)
  } finally {
    await pool.end()
  }
}

migrer()
