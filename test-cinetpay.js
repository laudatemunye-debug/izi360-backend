require('dotenv').config()
const { initierPaiement } = require('./src/utils/cinetpay')
const { detecterPaysDepuisTelephone, devisePourPays } = require('./src/utils/cinetpayPays')

async function test(telephone) {
  const pays = detecterPaysDepuisTelephone(telephone)
  const devise = devisePourPays(pays)
  console.log(`Tel: ${telephone} -> Pays: ${pays} -> Devise: ${devise}`)

  if (!devise) {
    console.log('BLOQUE: pays non couvert (comportement attendu)')
    return
  }

  const transactionId = 'TEST' + Date.now()
  try {
    const res = await initierPaiement({
      merchant_transaction_id: transactionId,
      amount: 1000,
      currency: devise,
      designation: 'Test BeautyCRM',
      client_email: 'test@example.com',
      client_first_name: 'Test',
      client_last_name: 'User',
      client_phone_number: telephone,
      notify_url: 'https://izi360-backend.vercel.app/api/beautycrm/paiement/notify',
      success_url: 'https://beautycrm-web.vercel.app?paiement=succes',
      failed_url: 'https://beautycrm-web.vercel.app?paiement=echec',
    })
    console.log(JSON.stringify(res, null, 2))
  } catch (e) {
    console.error('ERREUR:', e.response?.data || e.message)
  }
}

const numero = process.argv[2]
if (!numero) {
  console.log('Usage: node test-cinetpay.js +226XXXXXXXX')
  process.exit(1)
}
test(numero)
