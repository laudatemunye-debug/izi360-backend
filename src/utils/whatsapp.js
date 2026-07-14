const axios = require('axios')

async function envoyerWhatsApp(telephone, message) {
  try {
    const numero = telephone.replace(/[^0-9]/g, '')
    await axios.post(
      `${process.env.WHATSAPP_API_URL}/send`,
      { telephone: numero, message },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_SECRET}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    )
    console.log('WhatsApp envoye a', numero)
  } catch (err) {
    console.error('Erreur envoi WhatsApp:', err.response?.data || err.message)
  }
}

module.exports = { envoyerWhatsApp }
