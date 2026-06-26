const pool = require('../config/db')

// Stats dashboard
exports.getStats = async (req, res) => {
  try {
    const users = await pool.query('SELECT COUNT(*) FROM users')
    const verified = await pool.query('SELECT COUNT(*) FROM users WHERE verified = TRUE')
    const admins = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'admin'")
    const licences = await pool.query('SELECT COUNT(*) FROM licences WHERE actif = TRUE')
    const modules = await pool.query('SELECT COUNT(*) FROM modules WHERE actif = TRUE')
    res.json({
      total_users: parseInt(users.rows[0].count),
      verified_users: parseInt(verified.rows[0].count),
      admins: parseInt(admins.rows[0].count),
      licences_actives: parseInt(licences.rows[0].count),
      modules_actifs: parseInt(modules.rows[0].count),
    })
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
}

// Liste utilisateurs
exports.getUsers = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.nom, u.email, u.role, u.active, u.verified, u.created_at,
        json_agg(json_build_object('module', l.module_code, 'type', l.type, 'actif', l.actif, 'date_fin', l.date_fin)) 
        FILTER (WHERE l.id IS NOT NULL) as licences
      FROM users u
      LEFT JOIN licences l ON l.user_id = u.id
      GROUP BY u.id ORDER BY u.created_at DESC
    `)
    res.json(result.rows)
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
}

// Activer/désactiver utilisateur
exports.toggleUser = async (req, res) => {
  try {
    const { id } = req.params
    const result = await pool.query('UPDATE users SET active = NOT active WHERE id = $1 RETURNING id, nom, active', [id])
    if (result.rows.length === 0) return res.status(404).json({ message: 'Utilisateur non trouvé' })
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
}

// Changer rôle
exports.setRole = async (req, res) => {
  try {
    const { id } = req.params
    const { role } = req.body
    if (!['user', 'admin'].includes(role)) return res.status(400).json({ message: 'Rôle invalide' })
    const result = await pool.query('UPDATE users SET role = $1 WHERE id = $2 RETURNING id, nom, role', [role, id])
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
}

// Attribuer licence
exports.grantLicence = async (req, res) => {
  try {
    const { user_id, module_code, type, date_fin } = req.body
    if (!user_id || !module_code) return res.status(400).json({ message: 'user_id et module_code requis' })
    // Désactiver ancienne licence
    await pool.query('UPDATE licences SET actif = FALSE WHERE user_id = $1 AND module_code = $2', [user_id, module_code])
    // Créer nouvelle licence
    const result = await pool.query(
      'INSERT INTO licences (user_id, module_code, type, date_fin, actif) VALUES ($1, $2, $3, $4, TRUE) RETURNING *',
      [user_id, module_code, type || 'gratuit', date_fin || null]
    )
    res.status(201).json(result.rows[0])
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
}

// Révoquer licence
exports.revokeLicence = async (req, res) => {
  try {
    const { id } = req.params
    await pool.query('UPDATE licences SET actif = FALSE WHERE id = $1', [id])
    res.json({ message: 'Licence révoquée' })
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
}

// Liste modules
exports.getModules = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM modules ORDER BY id')
    res.json(result.rows)
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
}

// Modifier prix module
exports.updateModule = async (req, res) => {
  try {
    const { id } = req.params
    const { prix_mensuel, prix_annuel, actif } = req.body
    const result = await pool.query(
      'UPDATE modules SET prix_mensuel = $1, prix_annuel = $2, actif = $3 WHERE id = $4 RETURNING *',
      [prix_mensuel, prix_annuel, actif, id]
    )
    res.json(result.rows[0])
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
}

// Supprimer utilisateur
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params
    if (parseInt(id) === req.user.id) return res.status(400).json({ message: 'Impossible de supprimer votre propre compte' })
    await pool.query('DELETE FROM licences WHERE user_id = $1', [id])
    await pool.query('DELETE FROM users WHERE id = $1', [id])
    res.json({ message: 'Utilisateur supprimé' })
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
}

// Envoyer email à un utilisateur
exports.sendEmail = async (req, res) => {
  try {
    const { user_id, subject, message } = req.body
    if (!user_id || !subject || !message) return res.status(400).json({ message: 'Champs requis manquants' })
    const result = await pool.query('SELECT nom, email FROM users WHERE id = $1', [user_id])
    if (result.rows.length === 0) return res.status(404).json({ message: 'Utilisateur non trouvé' })
    const user = result.rows[0]
    const transporter = require('../config/mailer')
    await transporter.sendMail({
      from: `"IZI360" <${process.env.MAIL_USER}>`,
      to: user.email,
      subject,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <h1 style="color: #1D9E75;">IZI<span style="color: #111">360</span></h1>
          <p>Bonjour <strong>${user.nom}</strong>,</p>
          <div style="margin: 16px 0; line-height: 1.6;">${message}</div>
          <hr style="border:none; border-top:1px solid #eee; margin: 24px 0;">
          <p style="color:#9CA3AF; font-size:11px;">IZI360 — La suite logicielle IZISOFT</p>
        </div>
      `
    })
    res.json({ message: `Email envoyé à ${user.email}` })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Erreur serveur' }) }
}

// Envoyer email à tous les utilisateurs
exports.sendEmailAll = async (req, res) => {
  try {
    const { subject, message } = req.body
    if (!subject || !message) return res.status(400).json({ message: 'Sujet et message requis' })
    const result = await pool.query('SELECT nom, email FROM users WHERE verified = TRUE AND active = TRUE')
    const transporter = require('../config/mailer')
    let sent = 0
    for (const user of result.rows) {
      try {
        await transporter.sendMail({
          from: `"IZI360" <${process.env.MAIL_USER}>`,
          to: user.email,
          subject,
          html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
              <h1 style="color: #1D9E75;">IZI<span style="color: #111">360</span></h1>
              <p>Bonjour <strong>${user.nom}</strong>,</p>
              <div style="margin: 16px 0; line-height: 1.6;">${message}</div>
              <hr style="border:none; border-top:1px solid #eee; margin: 24px 0;">
              <p style="color:#9CA3AF; font-size:11px;">IZI360 — La suite logicielle IZISOFT</p>
            </div>
          `
        })
        sent++
      } catch(e) { console.error(`Erreur email ${user.email}:`, e) }
    }
    res.json({ message: `Email envoyé à ${sent} utilisateur(s)` })
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
}

// Stats avancées
exports.getAdvancedStats = async (req, res) => {
  try {
    const licencesByModule = await pool.query(`
      SELECT module_code, type, COUNT(*) as total 
      FROM licences WHERE actif = TRUE 
      GROUP BY module_code, type ORDER BY total DESC
    `)
    const newUsersThisMonth = await pool.query(`
      SELECT COUNT(*) FROM users 
      WHERE created_at >= date_trunc('month', NOW())
    `)
    const revenueEstimate = await pool.query(`
      SELECT 
        SUM(CASE WHEN l.type = 'mensuel' THEN m.prix_mensuel ELSE 0 END) +
        SUM(CASE WHEN l.type = 'annuel' THEN m.prix_annuel/12 ELSE 0 END) as monthly_revenue
      FROM licences l
      JOIN modules m ON m.code = l.module_code
      WHERE l.actif = TRUE
    `)
    res.json({
      licences_by_module: licencesByModule.rows,
      new_users_this_month: parseInt(newUsersThisMonth.rows[0].count),
      monthly_revenue: parseFloat(revenueEstimate.rows[0].monthly_revenue || 0).toFixed(2)
    })
  } catch (err) { res.status(500).json({ message: 'Erreur serveur' }) }
}
