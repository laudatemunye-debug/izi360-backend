const axios = require('axios')

const BASE_URL = process.env.CINETPAY_BASE_URL || 'https://api.cinetpay.net'
const API_KEY = process.env.CINETPAY_API_KEY
const API_PASSWORD = process.env.CINETPAY_API_PASSWORD
const CURRENCY = process.env.CINETPAY_CURRENCY || 'USD'

let _tokenCache = null
let _tokenExpiry = 0

// Recupere un token d'acces valide (cache ~4min, le token dure 5min cote CinetPay)
async function getAccessToken() {
  const now = Date.now()
  if (_tokenCache && now < _tokenExpiry) {
    return _tokenCache
  }
  const resp = await axios.post(`${BASE_URL}/v1/oauth/login`, {
    api_key: API_KEY,
    api_password: API_PASSWORD,
  })
  if (resp.data?.code !== 200 || !resp.data?.access_token) {
    throw new Error('Impossible d\'obtenir un token CinetPay: ' + JSON.stringify(resp.data))
  }
  _tokenCache = resp.data.access_token
  // On rafraichit un peu avant l'expiration reelle (marge de securite)
  _tokenExpiry = now + ((resp.data.expires_in || 300) * 1000) - 30000
  return _tokenCache
}

// Initialise une transaction de paiement web. Retourne { payment_url, notify_token, transaction_id }
async function initierPaiement({ merchant_transaction_id, amount, designation, client_email, client_first_name, client_last_name, client_phone_number, success_url, failed_url, notify_url }) {
  const token = await getAccessToken()
  const resp = await axios.post(`${BASE_URL}/v1/payment`, {
    currency: CURRENCY,
    merchant_transaction_id,
    amount,
    lang: 'fr',
    designation,
    client_email,
    client_first_name,
    client_last_name,
    client_phone_number,
    success_url,
    failed_url,
    notify_url,
  }, {
    headers: { Authorization: `Bearer ${token}` }
  })
  return resp.data
}

// Verifie le statut canonique d'une transaction aupres de CinetPay (jamais se fier au webhook seul)
async function verifierStatutPaiement(merchant_transaction_id) {
  const token = await getAccessToken()
  const resp = await axios.get(`${BASE_URL}/v1/payment/${merchant_transaction_id}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  return resp.data
}

module.exports = { getAccessToken, initierPaiement, verifierStatutPaiement }
