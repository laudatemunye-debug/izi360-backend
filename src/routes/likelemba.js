const express = require('express')
const rateLimit = require('express-rate-limit')
const webpush = require('web-push')
const pool = require('../config/db')
const auth = require('../middleware/auth')
const admin = require('../middleware/admin')

const router = express.Router()

const hasVapid = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
if (hasVapid) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:contact@izi360.org',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )
}

const limiter = rateLimit({ windowMs: 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false })
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max)
const validInstall = (id) => /^[A-Za-z0-9_-]{16,64}$/.test(id)
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res) } catch (e) { console.error('likelemba:', e.message); res.status(500).json({ message: 'Erreur serveur' }) }
}
const toDate = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d }

async function pushAll(payload) {
  if (!hasVapid) return { sent: 0, failed: 0, note: 'Clés VAPID non configurées' }
  const r = await pool.query('SELECT id, push_subscription FROM likelemba_devices WHERE push_subscription IS NOT NULL')
  const body = JSON.stringify(payload)
  let sent = 0, failed = 0
  for (let i = 0; i < r.rows.length; i += 20) {
    await Promise.all(r.rows.slice(i, i + 20).map(async (d) => {
      try {
        await webpush.sendNotification(d.push_subscription, body, { TTL: 86400 })
        sent++
      } catch (e) {
        failed++
        if (e.statusCode === 404 || e.statusCode === 410) {
          await pool.query('UPDATE likelemba_devices SET push_subscription = NULL WHERE id = $1', [d.id]).catch(() => {})
        }
      }
    }))
  }
  return { sent, failed }
}

/* ---------------------- Côté app (public) ---------------------- */

router.get('/vapid-public', (req, res) => res.json({ key: process.env.VAPID_PUBLIC_KEY || null }))

router.post('/ping', limiter, wrap(async (req, res) => {
  const b = req.body || {}
  const installId = str(b.installId, 64)
  if (!validInstall(installId)) return res.status(400).json({ message: 'installId invalide' })
  const sub = b.pushSubscription && typeof b.pushSubscription.endpoint === 'string' ? b.pushSubscription : null
  await pool.query(`
    INSERT INTO likelemba_devices (install_id, tontine_name, admin_name, admin_phone, members_count, app_version, push_subscription)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (install_id) DO UPDATE SET
      tontine_name = EXCLUDED.tontine_name,
      admin_name = EXCLUDED.admin_name,
      admin_phone = EXCLUDED.admin_phone,
      members_count = EXCLUDED.members_count,
      app_version = EXCLUDED.app_version,
      push_subscription = COALESCE(EXCLUDED.push_subscription, likelemba_devices.push_subscription),
      last_seen = NOW(),
      opens_count = likelemba_devices.opens_count + 1
  `, [installId, str(b.tontineName, 200), str(b.adminName, 200), str(b.adminPhone, 50),
      Math.max(0, parseInt(b.membersCount, 10) || 0), str(b.appVersion, 20), sub ? JSON.stringify(sub) : null])

  const msgs = await pool.query(`
    SELECT id, title, body, created_at FROM likelemba_messages
    WHERE (expires_at IS NULL OR expires_at > NOW()) AND created_at > NOW() - INTERVAL '60 days'
    ORDER BY created_at DESC LIMIT 30`)
  const polls = await pool.query(`
    SELECT p.id, p.question, p.options, p.created_at, v.option_index AS my_vote
    FROM likelemba_polls p
    LEFT JOIN likelemba_votes v ON v.poll_id = p.id AND v.install_id = $1
    WHERE p.active = TRUE AND (p.closes_at IS NULL OR p.closes_at > NOW())
    ORDER BY p.created_at DESC LIMIT 10`, [installId])
  res.json({
    messages: msgs.rows.map((m) => ({ id: m.id, title: m.title, body: m.body, createdAt: m.created_at })),
    polls: polls.rows.map((p) => ({ id: p.id, question: p.question, options: p.options, myVote: p.my_vote })),
  })
}))

router.post('/vote', limiter, wrap(async (req, res) => {
  const b = req.body || {}
  const installId = str(b.installId, 64)
  const pollId = parseInt(b.pollId, 10)
  const optionIndex = parseInt(b.optionIndex, 10)
  if (!validInstall(installId) || !(pollId > 0)) return res.status(400).json({ message: 'Requête invalide' })
  const p = await pool.query('SELECT options, active, closes_at FROM likelemba_polls WHERE id = $1', [pollId])
  const poll = p.rows[0]
  if (!poll || !poll.active || (poll.closes_at && poll.closes_at < new Date())) return res.status(410).json({ message: 'Sondage terminé' })
  if (!(optionIndex >= 0 && optionIndex < poll.options.length)) return res.status(400).json({ message: 'Option invalide' })
  await pool.query(`
    INSERT INTO likelemba_votes (poll_id, install_id, option_index) VALUES ($1,$2,$3)
    ON CONFLICT (poll_id, install_id) DO UPDATE SET option_index = EXCLUDED.option_index`,
    [pollId, installId, optionIndex])
  res.json({ ok: true })
}))

/* ---------------------- Côté super admin ---------------------- */

router.get('/admin/devices', auth, admin, wrap(async (req, res) => {
  const r = await pool.query(`
    SELECT id, install_id, tontine_name, admin_name, admin_phone, members_count, app_version,
           (push_subscription IS NOT NULL) AS push_on, created_at, last_seen, opens_count
    FROM likelemba_devices ORDER BY last_seen DESC LIMIT 1000`)
  const s = await pool.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '7 days')::int AS actifs_7j,
           COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '30 days')::int AS actifs_30j,
           COUNT(*) FILTER (WHERE push_subscription IS NOT NULL)::int AS avec_notifications
    FROM likelemba_devices`)
  res.json({ stats: s.rows[0], devices: r.rows })
}))

router.delete('/admin/devices/:id', auth, admin, wrap(async (req, res) => {
  await pool.query('DELETE FROM likelemba_devices WHERE id = $1', [parseInt(req.params.id, 10)])
  res.json({ ok: true })
}))

router.get('/admin/messages', auth, admin, wrap(async (req, res) => {
  const r = await pool.query('SELECT id, title, body, sent_count, created_at, expires_at FROM likelemba_messages ORDER BY created_at DESC LIMIT 100')
  res.json(r.rows)
}))

router.post('/admin/messages', auth, admin, wrap(async (req, res) => {
  const b = req.body || {}
  const title = str(b.title, 100), body = str(b.body, 500)
  if (!title || !body) return res.status(400).json({ message: 'Titre et message obligatoires' })
  const ins = await pool.query('INSERT INTO likelemba_messages (title, body, expires_at) VALUES ($1,$2,$3) RETURNING id', [title, body, toDate(b.expiresAt)])
  const push = await pushAll({ title, body, url: '/' })
  await pool.query('UPDATE likelemba_messages SET sent_count = $1 WHERE id = $2', [push.sent, ins.rows[0].id])
  res.json({ ok: true, id: ins.rows[0].id, push })
}))

router.delete('/admin/messages/:id', auth, admin, wrap(async (req, res) => {
  await pool.query('DELETE FROM likelemba_messages WHERE id = $1', [parseInt(req.params.id, 10)])
  res.json({ ok: true })
}))

router.get('/admin/polls', auth, admin, wrap(async (req, res) => {
  const polls = await pool.query('SELECT id, question, options, active, closes_at, created_at FROM likelemba_polls ORDER BY created_at DESC LIMIT 50')
  const votes = await pool.query('SELECT poll_id, option_index, COUNT(*)::int AS votes FROM likelemba_votes GROUP BY poll_id, option_index')
  res.json(polls.rows.map((p) => {
    const counts = p.options.map(() => 0)
    votes.rows.filter((v) => v.poll_id === p.id).forEach((v) => { if (counts[v.option_index] !== undefined) counts[v.option_index] = v.votes })
    return { ...p, counts, total: counts.reduce((a, c) => a + c, 0) }
  }))
}))

router.post('/admin/polls', auth, admin, wrap(async (req, res) => {
  const b = req.body || {}
  const question = str(b.question, 200)
  const options = Array.isArray(b.options) ? b.options.map((o) => str(o, 100)).filter(Boolean) : []
  if (!question || options.length < 2 || options.length > 6) return res.status(400).json({ message: 'Une question et 2 à 6 options sont obligatoires' })
  const ins = await pool.query('INSERT INTO likelemba_polls (question, options, closes_at) VALUES ($1,$2,$3) RETURNING id', [question, JSON.stringify(options), toDate(b.closesAt)])
  const push = b.notify ? await pushAll({ title: 'Nouveau sondage', body: question, url: '/' }) : null
  res.json({ ok: true, id: ins.rows[0].id, push })
}))

router.patch('/admin/polls/:id', auth, admin, wrap(async (req, res) => {
  await pool.query('UPDATE likelemba_polls SET active = $1 WHERE id = $2', [!!(req.body || {}).active, parseInt(req.params.id, 10)])
  res.json({ ok: true })
}))

router.delete('/admin/polls/:id', auth, admin, wrap(async (req, res) => {
  await pool.query('DELETE FROM likelemba_polls WHERE id = $1', [parseInt(req.params.id, 10)])
  res.json({ ok: true })
}))

module.exports = router
