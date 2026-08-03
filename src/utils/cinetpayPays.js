// Mapping pays -> methodes de paiement disponibles (encaissement=Oui uniquement, doc CinetPay)
const METHODES_PAR_PAYS = {
  CI: [{ code: 'OM_CI', label: 'Orange Money' }, { code: 'MOOV_CI', label: 'Moov Money' }, { code: 'MTN_CI', label: 'MTN Money' }, { code: 'WAVE_CI', label: 'Wave' }, { code: 'VISA_CI', label: 'Carte bancaire' }],
  BF: [{ code: 'OM_BF', label: 'Orange Money' }, { code: 'MOOV_BF', label: 'Moov Money' }, { code: 'WAVE_BF', label: 'Wave' }, { code: 'VISA_BF', label: 'Carte bancaire' }],
  ML: [{ code: 'OM_ML', label: 'Orange Money' }, { code: 'MOOV_ML', label: 'Moov Money' }, { code: 'VISA_ML', label: 'Carte bancaire' }],
  SN: [{ code: 'OM_SN', label: 'Orange Money' }, { code: 'FREE_SN', label: 'Free Money' }, { code: 'WAVE_SN', label: 'Wave' }, { code: 'VISA_SN', label: 'Carte bancaire' }],
  TG: [{ code: 'MOOV_TG', label: 'Moov Money' }, { code: 'TMONEY_TG', label: 'T-Money' }, { code: 'VISA_TG', label: 'Carte bancaire' }],
  GN: [{ code: 'OM_GN', label: 'Orange Money' }, { code: 'MTN_GN', label: 'MTN Money' }, { code: 'VISA_GN', label: 'Carte bancaire' }],
  CM: [{ code: 'OM_CM', label: 'Orange Money' }, { code: 'MTN_CM', label: 'MTN Money' }, { code: 'VISA_CM', label: 'Carte bancaire' }],
  BJ: [{ code: 'MOOV_BJ', label: 'Moov Money' }, { code: 'MTN_BJ', label: 'MTN Money' }, { code: 'VISA_BJ', label: 'Carte bancaire' }],
  CD: [{ code: 'OM_CD', label: 'Orange Money' }, { code: 'AIRTEL_CD', label: 'Airtel Money' }, { code: 'MPESA_CD', label: 'M-Pesa' }],
  NE: [{ code: 'AIRTEL_NE', label: 'Airtel Money' }, { code: 'MOOV_NE', label: 'Moov Money' }, { code: 'ZAMANI_NE', label: 'Zamani' }],
}

// Indicatifs -> code pays, pour deduire le pays a partir du numero de telephone
const INDICATIF_VERS_PAYS = [
  ['+225', 'CI'], ['+226', 'BF'], ['+223', 'ML'], ['+221', 'SN'], ['+228', 'TG'],
  ['+224', 'GN'], ['+237', 'CM'], ['+229', 'BJ'], ['+243', 'CD'], ['+227', 'NE'],
]

function detecterPaysDepuisTelephone(telephone) {
  if (!telephone) return null
  const t = telephone.startsWith('+') ? telephone : `+${telephone}`
  const match = INDICATIF_VERS_PAYS.find(([indicatif]) => t.startsWith(indicatif))
  return match ? match[1] : null
}

// Normalise les noms de pays en francais deja stockes en base (RDC, Cameroun, Cote dIvoire...)
// vers les codes ISO utilises par METHODES_PAR_PAYS et l'API CinetPay
const NOMS_VERS_CODE = {
  'RDC': 'CD', 'RD CONGO': 'CD', 'CONGO RDC': 'CD', 'CONGO KINSHASA': 'CD',
  'COTE DIVOIRE': 'CI', "COTE D'IVOIRE": 'CI', 'IVOIRE': 'CI',
  'CAMEROUN': 'CM', 'SENEGAL': 'SN', 'MALI': 'ML', 'BURKINA FASO': 'BF', 'BURKINA': 'BF',
  'TOGO': 'TG', 'GUINEE': 'GN', 'BENIN': 'BJ', 'NIGER': 'NE',
}

function normaliserPays(pays) {
  if (!pays) return null
  const p = pays.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (METHODES_PAR_PAYS[p]) return p // deja un code ISO valide (CD, CI, CM...)
  return NOMS_VERS_CODE[p] || null
}

function methodesPourPays(pays) {
  const code = normaliserPays(pays)
  return code ? (METHODES_PAR_PAYS[code] || []) : []
}

module.exports = { METHODES_PAR_PAYS, detecterPaysDepuisTelephone, methodesPourPays, normaliserPays }
