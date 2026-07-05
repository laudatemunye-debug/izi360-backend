const express = require('express')
require('dotenv').config()

const authRoutes = require('./routes/auth')
const adminRoutes = require('./routes/admin')
const userRoutes = require('./routes/user')

const app = express()

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  next()
})

app.use(express.json())

app.get('/', (req, res) => res.json({ message: 'IZI360 API v1.0', status: 'ok' }))
app.use('/api/auth', authRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/user', userRoutes)
app.use('/api/beautycrm', require('./routes/beautycrm'))
app.use('/api/beautycrm/entreprise', require('./routes/beautycrmEntreprise'))
app.use('/api/brevets', require('./routes/brevets'))
app.use('/api/formations', require('./routes/formations'))
app.use('/api/formateurs', require('./routes/formateurs'))

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000
  app.listen(PORT, () => console.log(`IZI360 Backend running on port ${PORT}`))
}

module.exports = app
