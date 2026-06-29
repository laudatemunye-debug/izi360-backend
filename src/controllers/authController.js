const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const pool = require('../config/db')
const transporter = require('../config/mailer')

exports.register = async (req, res) => {
  try {
    const { nom, email, password } = req.body
    if (!nom || !email || !password) return res.status(400).json({ message: 'Champs requis manquants' })

    // Validation format email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) return res.status(400).json({ message: 'Format email invalide' })

    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email])
    if (exists.rows.length > 0) return res.status(400).json({ message: 'Email déjà utilisé' })

    const hash = await bcrypt.hash(password, 10)
    const token = crypto.randomBytes(32).toString('hex')

    const result = await pool.query(
      'INSERT INTO users (nom, email, password, verification_token, verified) VALUES ($1, $2, $3, $4, FALSE) RETURNING id, nom, email',
      [nom, email, hash, token]
    )

    const user = result.rows[0]
    const verifyUrl = `${process.env.CLIENT_URL}/verify-email?token=${token}`

    await transporter.sendMail({
      from: `"IZI360" <${process.env.MAIL_USER}>`,
      to: email,
      subject: 'Confirmez votre adresse email — IZI360',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background:#fff;">
          <h1 style="color: #1D9E75; margin-bottom: 8px;">IZI<span style="color: #111">360</span></h1>
          <p>Bonjour <strong>${nom}</strong>,</p>
          <p>Merci de vous être inscrit sur IZI360 ! Veuillez confirmer votre adresse email en cliquant sur le bouton ci-dessous :</p>
          <a href="${verifyUrl}" style="display:inline-block; background:#1D9E75; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:700; margin: 16px 0;">
            Confirmer mon email &rsaquo;
          </a>
          <p style="color:#6B7280; font-size:13px;">Ce lien expirera dans 24 heures.<br>Si vous n'avez pas créé de compte IZI360, vous pouvez ignorer cet email en toute sécurité.</p>
          <hr style="border:none; border-top:1px solid #eee; margin: 24px 0;">
          <p style="color:#9CA3AF; font-size:11px;">Cordialement,<br>L'équipe IZI360<br>&copy; 2026 IZISOFT</p>
        </div>
      `
    })

    res.status(201).json({ message: 'Inscription réussie ! Vérifiez votre email pour activer votre compte.' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: "Erreur serveur" })
  }
}

exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.query
    if (!token) return res.status(400).json({ message: 'Token manquant' })

    const result = await pool.query('SELECT id FROM users WHERE verification_token = $1', [token])
    if (result.rows.length === 0) return res.status(400).json({ message: 'Lien invalide ou expiré' })

    await pool.query('UPDATE users SET verified = TRUE, verification_token = NULL WHERE verification_token = $1', [token])
    res.json({ message: 'Email confirmé avec succès' })
  } catch (err) {
    res.status(500).json({ message: "Erreur serveur" })
  }
}

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) return res.status(400).json({ message: 'Email et mot de passe requis' })

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email])
    if (result.rows.length === 0) return res.status(401).json({ message: 'Email ou mot de passe incorrect' })

    const user = result.rows[0]
    if (!user.verified) return res.status(401).json({ message: 'Veuillez confirmer votre email avant de vous connecter.' })

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) return res.status(401).json({ message: 'Email ou mot de passe incorrect' })

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' })
    res.json({ token, user: { id: user.id, nom: user.nom, email: user.email, role: user.role } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: "Erreur serveur" })
  }
}

exports.me = async (req, res) => {
  try {
    const result = await pool.query('SELECT id, nom, email, verified, created_at FROM users WHERE id = $1', [req.user.id])
    if (result.rows.length === 0) return res.status(404).json({ message: 'Utilisateur non trouvé' })
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: "Erreur serveur" })
  }
}

exports.resendVerification = async (req, res) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ message: 'Email requis' })
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email])
    if (result.rows.length === 0) return res.status(404).json({ message: 'Email non trouvé' })
    const user = result.rows[0]
    if (user.verified) return res.status(400).json({ message: 'Email déjà confirmé' })
    const token = require('crypto').randomBytes(32).toString('hex')
    await pool.query('UPDATE users SET verification_token = $1 WHERE email = $2', [token, email])
    const verifyUrl = `${process.env.CLIENT_URL}/verify-email?token=${token}`
    await transporter.sendMail({
      from: `"IZI360" <${process.env.MAIL_USER}>`,
      to: email,
      subject: 'Confirmez votre adresse email — IZI360',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <h1 style="color: #1D9E75;">IZI<span style="color: #111">360</span></h1>
          <p>Bonjour <strong>${user.nom}</strong>,</p>
          <p>Voici votre nouveau lien de confirmation :</p>
          <a href="${verifyUrl}" style="display:inline-block; background:#1D9E75; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:700; margin: 16px 0;">
            Confirmer mon email
          </a>
          <p style="color:#6B7280; font-size:12px;">Ce lien expire dans 24h.</p>
        </div>
      `
    })
    res.json({ message: 'Email de confirmation renvoyé !' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: "Erreur serveur" })
  }
}

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ message: 'Email requis' })
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email])
    if (result.rows.length === 0) return res.status(404).json({ message: 'Aucun compte trouvé avec cet email.' })
    const user = result.rows[0]
    const token = require('crypto').randomBytes(32).toString('hex')
    const expires = new Date(Date.now() + 3600000) // 1 heure
    await pool.query('UPDATE users SET reset_token = $1, reset_expires = $2 WHERE email = $3', [token, expires, email])
    const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${token}`
    await transporter.sendMail({
      from: `"IZI360" <${process.env.MAIL_USER}>`,
      to: email,
      subject: 'Réinitialisation de mot de passe — IZI360',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <h1 style="color: #1D9E75;">IZI<span style="color: #111">360</span></h1>
          <p>Bonjour <strong>${user.nom}</strong>,</p>
          <p>Vous avez demandé à réinitialiser votre mot de passe. Cliquez ci-dessous :</p>
          <a href="${resetUrl}" style="display:inline-block; background:#1D9E75; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:700; margin: 16px 0;">
            Réinitialiser mon mot de passe
          </a>
          <p style="color:#6B7280; font-size:12px;">Ce lien expire dans 1 heure. Si vous n'avez pas fait cette demande, ignorez cet email.</p>
        </div>
      `
    })
    res.json({ message: 'Lien de réinitialisation envoyé !' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: "Erreur serveur" })
  }
}

exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body
    if (!token || !password) return res.status(400).json({ message: 'Token et mot de passe requis' })
    if (password.length < 6) return res.status(400).json({ message: 'Mot de passe trop court' })
    const result = await pool.query('SELECT * FROM users WHERE reset_token = $1 AND reset_expires > NOW()', [token])
    if (result.rows.length === 0) return res.status(400).json({ message: 'Lien invalide ou expiré' })
    const hash = await require('bcryptjs').hash(password, 10)
    await pool.query('UPDATE users SET password = $1, reset_token = NULL, reset_expires = NULL WHERE reset_token = $2', [hash, token])
    res.json({ message: 'Mot de passe mis à jour avec succès !' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: "Erreur serveur" })
  }
}
