const express = require('express')
const router = express.Router()
const authMiddleware = require('../middleware/auth')
const adminMiddleware = require('../middleware/admin')
const { 
  getStats, getUsers, toggleUser, setRole, deleteUser,
  grantLicence, revokeLicence, getModules, updateModule,
  sendEmail, sendEmailAll, getAdvancedStats
} = require('../controllers/adminController')

router.use(authMiddleware)
router.use(adminMiddleware)

router.get('/stats', getStats)
router.get('/stats/advanced', getAdvancedStats)
router.get('/users', getUsers)
router.patch('/users/:id/toggle', toggleUser)
router.patch('/users/:id/role', setRole)
router.delete('/users/:id', deleteUser)
router.post('/licences', grantLicence)
router.patch('/licences/:id/revoke', revokeLicence)
router.get('/modules', getModules)
router.patch('/modules/:id', updateModule)
router.post('/email/user', sendEmail)
router.post('/email/all', sendEmailAll)

module.exports = router
