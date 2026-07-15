const axios = require('axios')

async function envoyerWhatsApp(telephone, message) {
  const numero = (telephone || '').replace(/[^0-9]/g, '')

  if (numero.length < 10 || numero.length > 15) {
    console.error('Numero WhatsApp invalide, envoi annule:', telephone)
    return
  }

  try {
    await axios.post(
      `${process.env.WHATSAPP_API_URL}/send`,
      { telephone: numero, message },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_SECRET}`,
          'Content-Type': 'application/json'
        },
        timeout: 20000
      }
    )
    console.log('WhatsApp envoye a', numero)
  } catch (err) {
    console.error('Erreur envoi WhatsApp:', err.response?.data || err.message)
  }
}

module.exports = { envoyerWhatsApp }
