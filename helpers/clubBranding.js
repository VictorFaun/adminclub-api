const settingsRepository = require('../repositories/settings.repository');

/** club_settings: '0' = no mostrar el logo sobre el banner (cuando el banner ya lo trae). */
const SHOW_LOGO_KEY = 'banner_show_logo';

/** ¿Se dibuja el logo del club bajo el banner en las páginas públicas? Por defecto, sí. */
async function showLogoOnBanner(clubId) {
  const settings = await settingsRepository.findAllByClub(clubId);
  return settings[SHOW_LOGO_KEY] !== '0';
}

async function setShowLogoOnBanner(clubId, value) {
  await settingsRepository.upsertMany(clubId, { [SHOW_LOGO_KEY]: value ? '1' : '0' });
}

module.exports = { SHOW_LOGO_KEY, showLogoOnBanner, setShowLogoOnBanner };
