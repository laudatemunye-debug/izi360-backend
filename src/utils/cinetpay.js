const axios = require('axios')

const CINETPAY_API_KEY = process.env.CINETPAY_API_KEY
const CINETPAY_API_PASSWORD = process.env.CINETPAY_API_PASSWORD
const CURRENCY = process.env.CINETPAY_CURRENCY || 'USD'

// Relais via un proxy IP fixe si configure (necessaire si CinetPay exige une IP whitelistee
// incompatible avec les IP dynamiques des fonctions serverless Vercel). Sinon appel direct.
const PROXY_URL = process.env.CINETPAY_PROXY_URL
const PROXY_SECRET = process.env.CINETPAY_PROXY_SECRET
const CINETPAY_BASE_URL = process.env.CINETPAY_BASE_URL || 'https://api-checkout.cinetpay.com'

function relayUrl(path) {
  if (PROXY_URL) return `${PROXY_URL}/relay${path}`
  return `${CINETPAY_BASE_URL}${path}`
}

function relayHeaders(extra) {
  const headers = { ...extra }
  if (PROXY_URL && PROXY_SECRET) headers['x-proxy-secret'] = PROXY_SECRET
  return headers
}

let _tokenCache = null
let _tokenExpiry = 0

async function getAccessToken() {
  const now = Date.now()
  if (_tokenCache && now < _tokenExpiry) {
    return _tokenCache
  }
  const resp = await axios.post(relayUrl('/v1/oauth/login'), {
    api_key: CINETPAY_API_KEY,
    api_password: CINETPAY_API_PASSWORD,
  }, {
    headers: relayHeaders()
  })
  if (resp.data?.code !== 200 || !resp.data?.access_token) {
    throw new Error('Impossible d\'obtenir un token CinetPay: ' + JSON.stringify(resp.data))
  }
  _tokenCache = resp.data.access_token
  _tokenExpiry = now + ((resp.data.expires_in || 300) * 1000) - 30000
  return _tokenCache
}

async function initierPaiement({ merchant_transaction_id, amount, currency, designation, client_email, client_first_name, client_last_name, client_phone_number, payment_method, direct_pay, success_url, failed_url, notify_url }) {
  const token = await getAccessToken()
  const resp = await axios.post(relayUrl('/v1/payment'), {
    currency: currency || CURRENCY,
    merchant_transaction_id,
    amount,
    lang: 'fr',
    designation,
    client_email,
    client_first_name,
    client_last_name,
    client_phone_number,
    payment_method,
    direct_pay,
    success_url,
    failed_url,
    notify_url,
  }, {
    headers: relayHeaders({ Authorization: `Bearer ${token}` })
  })
  return resp.data
}

async function verifierStatutPaiement(merchant_transaction_id) {
  const token = await getAccessToken()
  const resp = await axios.get(relayUrl(`/v1/payment/${merchant_transaction_id}`), {
    headers: relayHeaders({ Authorization: `Bearer ${token}` })
  })
  return resp.data
}

module.exports = { getAccessToken, initierPaiement, verifierStatutPaiement }
