const { getContrastColor, tintColor, shadeColor } = require('./emailBrand');

const PLATFORM_NAME = 'Admin Club';
const PLATFORM_COLOR = '#4F46E5'; // mismo default que clubs.service.js#create usa para clubes nuevos
const FONT_STACK = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Encabezado: logo (en un círculo blanco, así un logo oscuro o con fondo propio se ve bien sobre
 * cualquier color de marca) + nombre del club al lado. Sin logo, solo el nombre. */
function renderHeader({ brandName, brandColor, logoUrl }) {
  const contrastColor = getContrastColor(brandColor);
  const nameHtml = `<span style="font-size:17px; font-weight:700; letter-spacing:-0.01em; color:${contrastColor};">${escapeHtml(brandName)}</span>`;
  if (!logoUrl) {
    return `<td bgcolor="${brandColor}" style="background:${brandColor}; padding:22px 32px;">${nameHtml}</td>`;
  }
  return `<td bgcolor="${brandColor}" style="background:${brandColor}; padding:18px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:44px; height:44px; background:#ffffff; border-radius:50%; text-align:center; vertical-align:middle;">
                    <img src="${escapeHtml(logoUrl)}" alt="" width="36" height="36" style="display:inline-block; width:36px; height:36px; border-radius:50%; object-fit:contain; vertical-align:middle;" />
                  </td>
                  <td style="padding-left:12px; vertical-align:middle;">${nameHtml}</td>
                </tr>
              </table>
            </td>`;
}

/** Layout base compartido — tabla (no flex/grid) a propósito: es lo único con soporte confiable
 * en clientes de correo como Outlook, que renderiza con un motor basado en Word.
 * `eyebrow` (etiqueta chica sobre el título, p.ej. "Notificación") y `preheader` (texto que el
 * cliente de correo muestra como vista previa junto al asunto) son opcionales. */
function renderLayout({ brandName, brandColor, logoUrl, title, bodyHtml, ctaText, ctaUrl, eyebrow, preheader, viaPlatform }) {
  const contrastColor = getContrastColor(brandColor);
  // Tono oscurecido de la marca para texto sobre fondo claro (un dorado/amarillo tal cual no se lee).
  const accentText = shadeColor(brandColor, 0.4);

  const eyebrowHtml = eyebrow
    ? `<span style="display:inline-block; margin:0 0 14px; padding:4px 10px; border-radius:999px; background:${tintColor(brandColor, 0.85)}; color:${accentText}; font-size:11px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase;">${escapeHtml(eyebrow)}</span>`
    : '';

  const ctaRow = ctaText && ctaUrl
    ? `
          <tr>
            <td style="padding:8px 32px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:10px; background:${brandColor};">
                    <a href="${escapeHtml(ctaUrl)}"
                       style="display:inline-block; padding:13px 28px; border-radius:10px; color:${contrastColor}; text-decoration:none; font-weight:600; font-size:14.5px;">
                      ${escapeHtml(ctaText)} &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
    : '';

  const preheaderHtml = preheader
    ? `<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">${escapeHtml(preheader)}</div>`
    : '';

  const sentBy = viaPlatform
    ? `Enviado por <strong style="color:#6b6b78;">${escapeHtml(brandName)}</strong> a través de ${PLATFORM_NAME}.`
    : `Enviado por ${PLATFORM_NAME}.`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${escapeHtml(title)}</title>
  <style>
    .content p { margin: 0 0 14px; }
    .content p:last-child { margin-bottom: 0; }
    .content a { color: ${accentText}; }
    .content ul { margin: 0 0 14px; padding-left: 20px; }
  </style>
</head>
<body style="margin:0; padding:0; background:#f2f2f5; font-family:${FONT_STACK};">
  ${preheaderHtml}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f5;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; background:#ffffff; border:1px solid #e6e6ec; border-radius:16px; overflow:hidden;">
          <tr>
            ${renderHeader({ brandName, brandColor, logoUrl })}
          </tr>
          <tr>
            <td class="content" style="padding:36px 32px 24px; font-family:${FONT_STACK};">
              ${eyebrowHtml}
              <h1 style="margin:0 0 14px; font-size:22px; line-height:1.3; font-weight:700; letter-spacing:-0.01em; color:#16151f;">${escapeHtml(title)}</h1>
              <div style="font-size:15px; line-height:1.65; color:#3f3f4a;">${bodyHtml}</div>
            </td>
          </tr>${ctaRow}
          <tr>
            <td style="padding:24px 32px 0;">
              <div style="border-top:1px solid #ededf2; font-size:0; line-height:0;">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 28px; font-size:12.5px; line-height:1.5; color:#9a9aa5;">
              Si no esperabas este correo, puedes ignorarlo con confianza.
            </td>
          </tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <tr>
            <td align="center" style="padding:20px 16px 0; font-size:12px; line-height:1.5; color:#9a9aa5;">
              ${sentBy}
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
function renderPlatformEmail({ title, bodyHtml, ctaText, ctaUrl, eyebrow, preheader }) {
  return renderLayout({
    brandName: PLATFORM_NAME,
    brandColor: PLATFORM_COLOR,
    logoUrl: null,
    title,
    bodyHtml,
    ctaText,
    ctaUrl,
    eyebrow,
    preheader,
    viaPlatform: false,
  });
}

/** Branding del club (logo + color primario) — para correos ligados a un club específico
 * (invitaciones, recibos). `club` es el DTO ya resuelto por clubs.service.js#toDto
 * (`logoUrl` ya absoluto, ver helpers/mediaUrl.js). */
function renderClubEmail({ club, title, bodyHtml, ctaText, ctaUrl, eyebrow, preheader }) {
  return renderLayout({
    brandName: club.name,
    brandColor: club.primaryColor || PLATFORM_COLOR,
    logoUrl: club.logoUrl || null,
    title,
    bodyHtml,
    ctaText,
    ctaUrl,
    eyebrow,
    preheader,
    viaPlatform: true,
  });
}

module.exports = { renderPlatformEmail, renderClubEmail };
