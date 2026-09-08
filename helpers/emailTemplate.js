const { getContrastColor } = require('./emailBrand');

const PLATFORM_COLOR = '#4F46E5'; // mismo default que clubs.service.js#create usa para clubes nuevos

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Layout base compartido — tabla (no flex/grid) a propósito: es lo único con soporte confiable
 * en clientes de correo como Outlook, que renderiza con un motor basado en Word. */
function renderLayout({ brandName, brandColor, logoUrl, title, bodyHtml, ctaText, ctaUrl }) {
  const contrastColor = getContrastColor(brandColor);
  const ctaButton = ctaText && ctaUrl
    ? `
      <tr>
        <td align="center" style="padding: 8px 0 4px;">
          <a href="${escapeHtml(ctaUrl)}"
             style="display:inline-block; padding:12px 28px; border-radius:8px; background:${brandColor}; color:${contrastColor}; text-decoration:none; font-weight:600; font-size:14px;">
            ${escapeHtml(ctaText)}
          </a>
        </td>
      </tr>`
    : '';

  const logoHtml = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(brandName)}" height="36" style="display:block; height:36px;" />`
    : `<span style="font-size:18px; font-weight:700; color:${contrastColor};">${escapeHtml(brandName)}</span>`;

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0; padding:0; background:#f4f4f7; font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background:#ffffff; border-radius:12px; overflow:hidden;">
          <tr>
            <td style="background:${brandColor}; padding:20px 28px;">
              ${logoHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px 8px;">
              <h1 style="margin:0 0 16px; font-size:20px; color:#16151f;">${escapeHtml(title)}</h1>
              <div style="font-size:14.5px; line-height:1.6; color:#3f3f4a;">${bodyHtml}</div>
            </td>
          </tr>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${ctaButton}</table>
          <tr>
            <td style="padding:24px 28px 32px; font-size:12px; color:#9a9aa5;">
              Si no esperabas este correo, puedes ignorarlo con confianza.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Branding genérico de Admin Club — para correos a nivel de USUARIO (verificar correo,
 * recuperar contraseña, bienvenida), ya que un usuario puede pertenecer a varios clubes y no hay
 * un club único al que atribuirle el envío. */
function renderPlatformEmail({ title, bodyHtml, ctaText, ctaUrl }) {
  return renderLayout({
    brandName: 'Admin Club',
    brandColor: PLATFORM_COLOR,
    logoUrl: null,
    title,
    bodyHtml,
    ctaText,
    ctaUrl,
  });
}

/** Branding del club (logo + color primario) — para correos ligados a un club específico
 * (invitaciones, recibos). `club` es el DTO ya resuelto por clubs.service.js#toDto
 * (`logoUrl` ya absoluto, ver helpers/mediaUrl.js). */
function renderClubEmail({ club, title, bodyHtml, ctaText, ctaUrl }) {
  return renderLayout({
    brandName: club.name,
    brandColor: club.primaryColor || PLATFORM_COLOR,
    logoUrl: club.logoUrl || null,
    title,
    bodyHtml,
    ctaText,
    ctaUrl,
  });
}

module.exports = { renderPlatformEmail, renderClubEmail };
