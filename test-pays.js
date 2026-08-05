require('dotenv').config()
const { initierPaiement } = require('./src/utils/cinetpay')

const tests = [
  { tel: '+237600000000', pays: 'Cameroun' },
  { tel: '+224600000000', pays: 'Guinee' },
]

;(async () => {
  for (const t of tests) {
    try {
      const res = await initierPaiement({
        merchant_transaction_id: 'TESTPAYS' + Date.now() + Math.floor(Math.random()*1000),
        amount: 1000,
        currency: 'USD',
        designation: 'Test ' + t.pays,
        client_email: 'test@example.com',
        client_first_name: 'Test',
        client_last_name: 'User',
        client_phone_number: t.tel,
        notify_url: 'https://izi360-backend.vercel.app/api/beautycrm/paiement/notify',
        success_url: 'https://beautycrm-web.vercel.app?paiement=succes',
        failed_url: 'https://beautycrm-web.vercel.app?paiement=echec',
      })
      console.log(t.pays, '->', res.details?.status || res.status, res.details?.message || '')
    } catch (e) {
      console.log(t.pays, '-> ERREUR', e.response?.data || e.message)
    }
    await new Promise(r => setTimeout(r, 1500))
  }
})()
