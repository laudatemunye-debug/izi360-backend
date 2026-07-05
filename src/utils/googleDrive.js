const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const REDIRECT_URI = 'https://izi360-backend.vercel.app/api/beautycrm/entreprise/oauth-callback'

// Echange le "code" recu apres connexion Google contre access_token + refresh_token
async function exchangeCodeForTokens(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error_description || data.error || 'Echange token echoue')
  return data // { access_token, refresh_token, expires_in, ... }
}

// Obtient un access_token frais a partir du refresh_token stocke
async function getAccessTokenFromRefresh(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error_description || data.error || 'Refresh token invalide')
  return data.access_token
}

// Trouve un fichier par nom sur le Drive du compte proprietaire de l'access_token
async function findFile(accessToken, fileName) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${fileName}' and trashed=false&spaces=drive&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const data = await res.json()
  return data.files?.[0] || null
}

// Lit le contenu JSON d'un fichier Drive
async function readFile(accessToken, fileId) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error('Lecture fichier echouee: ' + res.status)
  return res.json()
}

// Ecrit (cree ou remplace) le contenu JSON d'un fichier Drive
async function writeFile(accessToken, fileName, dataObj, existingFileId) {
  const blob = JSON.stringify(dataObj, null, 2)
  const boundary = 'boundary_' + Date.now()
  const meta = { name: fileName, mimeType: 'application/json' }
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${blob}\r\n--${boundary}--`

  const url = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart'

  const res = await fetch(url, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  })
  if (!res.ok) throw new Error('Ecriture fichier echouee: ' + res.status)
  return res.json()
}

module.exports = { exchangeCodeForTokens, getAccessTokenFromRefresh, findFile, readFile, writeFile }
