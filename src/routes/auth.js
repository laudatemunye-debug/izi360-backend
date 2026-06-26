const express = require('express')
const router = express.Router()
const { register, login, me, verifyEmail, resendVerification, forgotPassword, resetPassword } = require('../controllers/authController')
const authMiddleware = require('../middleware/auth')

router.post('/register', register)
router.post('/login', login)
router.get('/verify-email', verifyEmail)
router.post('/resend-verification', resendVerification)
router.post('/forgot-password', forgotPassword)
router.post('/reset-password', resetPassword)
router.get('/me', authMiddleware, me)

module.exports = router
