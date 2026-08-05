require('dotenv').config()
const { initierPaiement } = require('./src/utils/cinetpay')

;(async () => {
  try {
    const res = await initierPaiement({
      merchant_transaction_id: 'TESTRDC' + Date.now(),
      amount: 1000,
      currency: 'USD',
      designation: 'Test RDC',
      client_email: 'test@example.com',
      client_first_name: 'Test',
      client_last_name: 'User',
      client_phone_number: '+243997245614',
      notify_url: 'https://izi360-backend.vercel.app/api/beautycrm/paiement/notify',
      success_url: 'https://beautycrm-web.vercel.app?paiement=succes',
      failed_url: 'https://beautycrm-web.vercel.app?paiement=echec',
    })
    console.log(JSON.stringify(res, null, 2))
  } catch (e) {
    console.log('ERREUR', JSON.stringify(e.response?.data || e.message, null, 2))
  }
})()
