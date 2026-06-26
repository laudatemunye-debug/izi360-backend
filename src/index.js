const express = require('express')
const cors = require('cors')
require('dotenv').config()

const authRoutes = require('./routes/auth')
const adminRoutes = require('./routes/admin')

const app = express()
const PORT = process.env.PORT || 5000

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }))
app.use(express.json())

app.get('/', (req, res) => res.json({ message: 'IZI360 API v1.0', status: 'ok' }))
app.use('/api/auth', authRoutes)
app.use('/api/admin', adminRoutes)

app.listen(PORT, () => console.log(`IZI360 Backend running on port ${PORT}`))
