const express = require('express')
const cors = require('cors')
require('dotenv').config()

const authRoutes = require('./routes/auth')
const adminRoutes = require('./routes/admin')
const userRoutes = require('./routes/user')

const app = express()

app.use(cors({
  origin: ['https://izi-360.vercel.app', 'http://localhost:5173'],
  credentials: true
}))
app.use(express.json())

app.get('/', (req, res) => res.json({ message: 'IZI360 API v1.0', status: 'ok' }))
app.use('/api/auth', authRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/user', userRoutes)
app.use('/api/beautycrm', require('./routes/beautycrm'))

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000
  app.listen(PORT, () => console.log(`IZI360 Backend running on port ${PORT}`))
}

module.exports = app
