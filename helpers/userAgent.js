/**
 * Descripción legible de un User-Agent para la lista de sesiones (Perfil → Sesiones):
 * navegador, sistema y tipo de dispositivo. Aproximado a propósito (sin dependencias): solo sirve
 * para que la persona reconozca sus equipos, nunca para decidir nada de seguridad.
 */
function describeUserAgent(ua) {
  const s = String(ua || '');
  if (!s) return { browser: null, os: null, deviceType: 'desktop', label: 'Dispositivo desconocido' };

  let browser = null;
  if (/EdgA?\/|Edg\//.test(s)) browser = 'Edge';
  else if (/SamsungBrowser\//.test(s)) browser = 'Samsung Internet';
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera';
  else if (/Firefox\/|FxiOS\//.test(s)) browser = 'Firefox';
  else if (/CriOS\//.test(s)) browser = 'Chrome';
  else if (/Chrome\//.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s) && /Version\//.test(s)) browser = 'Safari';
  else if (/Capacitor|wv\)/.test(s)) browser = 'App';

  let os = null;
  const isIPad = /iPad/.test(s);
  if (/Android/.test(s)) os = 'Android';
  else if (/iPhone|iPod/.test(s)) os = 'iPhone';
  else if (isIPad) os = 'iPad';
  else if (/Windows/.test(s)) os = 'Windows';
  else if (/CrOS/.test(s)) os = 'ChromeOS';
  else if (/Mac OS X|Macintosh/.test(s)) os = 'macOS';
  else if (/Linux/.test(s)) os = 'Linux';

  let deviceType = 'desktop';
  if (isIPad || (/Android/.test(s) && !/Mobile/.test(s))) deviceType = 'tablet';
  else if (/Mobi|iPhone|iPod|Android/.test(s)) deviceType = 'mobile';

  const label = browser && os ? `${browser} en ${os}` : browser || os || 'Dispositivo desconocido';
  return { browser, os, deviceType, label };
}

/** "::ffff:192.168.1.5" → "192.168.1.5" (IPv4 vista desde un socket IPv6). */
function displayIp(ip) {
  if (!ip) return null;
  return String(ip).replace(/^::ffff:/, '');
}

module.exports = { describeUserAgent, displayIp };
