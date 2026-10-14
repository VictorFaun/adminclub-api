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
 * cualquier color de marca) + nombre del club al lado. Sin logo, la inicial en el círculo. */
function renderHeader({ brandName, brandColor, logoUrl }) {
  const contrastColor = getContrastColor(brandColor);
  const nameHtml = `<span style="font-size:17px; font-weight:700; letter-spacing:-0.01em; color:${contrastColor};">${escapeHtml(brandName)}</span>`;
  const badge = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="" width="38" height="38" style="display:inline-block; width:38px; height:38px; border-radius:50%; object-fit:contain; vertical-align:middle;" />`
    : `<span style="display:inline-block; font-size:19px; font-weight:800; line-height:46px; color:${shadeColor(brandColor, 0.15)};">${escapeHtml(String(brandName || '?').trim().charAt(0).toUpperCase())}</span>`;
  return `<td bgcolor="${brandColor}" style="background:${brandColor}; padding:18px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:46px; height:46px; background:#ffffff; border-radius:50%; text-align:center; vertical-align:middle;">${badge}</td>
                  <td style="padding-left:12px; vertical-align:middle;">${nameHtml}</td>
                </tr>
              </table>
            </td>`;
}

/** Layout base compartido — tabla (no flex/grid) a propósito: es lo único con soporte confiable
 * en clientes de correo como Outlook, que renderiza con un motor basado en Word.
 * `eyebrow` (etiqueta chica sobre el título, p.ej. "Notificación") y `preheader` (texto que el
 * cliente de correo muestra como vista previa junto al asunto) son opcionales. Con botón, debajo
 * va también el enlace en texto, por si el cliente de correo no muestra el botón. */
function renderLayout({ brandName, brandColor, logoUrl, title, bodyHtml, ctaText, ctaUrl, eyebrow, preheader, viaPlatform }) {
  const contrastColor = getContrastColor(brandColor);
  // Tono oscurecido de la marca para texto sobre fondo claro (un dorado/amarillo tal cual no se lee).
  const accentText = shadeColor(brandColor, 0.4);

  const eyebrowHtml = eyebrow
    ? `<span style="display:inline-block; margin:0 0 14px; padding:4px 10px; border-radius:999px; background:${tintColor(brandColor, 0.85)}; color:${accentText}; font-size:11px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase;">${escapeHtml(eyebrow)}</span>`
    : '';

  const ctaRow =
    ctaText && ctaUrl
      ? `
          <tr>
            <td style="padding:4px 28px 4px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" bgcolor="${brandColor}" style="border-radius:12px; background:${brandColor};">
                    <a href="${escapeHtml(ctaUrl)}"
                       style="display:block; padding:15px 24px; border-radius:12px; color:${contrastColor}; text-decoration:none; font-weight:700; font-size:15px;">
                      ${escapeHtml(ctaText)} &rarr;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:12px 0 0; font-size:12px; line-height:1.5; color:#9a9aa5; word-break:break-all;">
                ¿No funciona el botón? Copia este enlace: <a href="${escapeHtml(ctaUrl)}" style="color:${accentText};">${escapeHtml(ctaUrl)}</a>
              </p>
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
    @media (max-width: 480px) {
      .shell { padding: 16px 8px !important; }
      .content { padding: 26px 20px 18px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background:#f2f2f5; font-family:${FONT_STACK};">
  ${preheaderHtml}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f5;">
    <tr>
      <td class="shell" align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; background:#ffffff; border:1px solid #e6e6ec; border-radius:18px; overflow:hidden; box-shadow:0 4px 18px rgba(22,21,31,0.06);">
          <tr>
            ${renderHeader({ brandName, brandColor, logoUrl })}
          </tr>
          <tr>
            <td class="content" style="padding:34px 28px 22px; font-family:${FONT_STACK};">
              ${eyebrowHtml}
              <h1 style="margin:0 0 14px; font-size:23px; line-height:1.3; font-weight:800; letter-spacing:-0.015em; color:#16151f;">${escapeHtml(title)}</h1>
              <div style="font-size:15px; line-height:1.65; color:#3f3f4a;">${bodyHtml}</div>
            </td>
          </tr>${ctaRow}
          <tr>
            <td style="padding:24px 28px 0;">
              <div style="border-top:1px solid #ededf2; font-size:0; line-height:0;">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 26px; font-size:12.5px; line-height:1.5; color:#9a9aa5;">
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

// ------------------------------------------------------------------ piezas para el cuerpo

/** Cifra destacada (ej. total adeudado): etiqueta, cifra grande y un dato secundario opcional.
 * `tone`: 'danger' (rojo) | 'brand' (color del club, pasar `color`) | neutro. */
function renderHighlight({ label, value, hint, tone = 'neutral', color = PLATFORM_COLOR }) {
  const palette = {
    danger: { bg: '#fdf0f0', border: '#f3caca', text: '#c0362c' },
    brand: { bg: tintColor(color, 0.9), border: tintColor(color, 0.7), text: shadeColor(color, 0.35) },
    neutral: { bg: '#f6f6f8', border: '#e6e6ec', text: '#16151f' },
  }[tone] || { bg: '#f6f6f8', border: '#e6e6ec', text: '#16151f' };
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;">
  <tr>
    <td style="padding:16px 18px; border-radius:14px; background:${palette.bg}; border:1px solid ${palette.border};">
      <div style="font-size:12px; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:#6b6b78;">${escapeHtml(label)}</div>
      <div style="margin-top:4px; font-size:30px; line-height:1.15; font-weight:800; letter-spacing:-0.02em; color:${palette.text};">${escapeHtml(value)}</div>
      ${hint ? `<div style="margin-top:4px; font-size:13px; color:#6b6b78;">${escapeHtml(hint)}</div>` : ''}
    </td>
  </tr>
</table>`;
}

/** Tabla de datos. `columns`: [{ label, align }]; `rows`: celdas en HTML ya escapado (usar
 * `escapeHtml`); `footer` (opcional): una fila final destacada, ej. el total. */
function renderTable({ columns, rows, footer = null }) {
  const th = columns
    .map(
      (c) =>
        `<th align="${c.align || 'left'}" style="padding:9px 12px; font-size:11.5px; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; color:#6b6b78; background:#f6f6f8; border-bottom:1px solid #e6e6ec;">${escapeHtml(c.label)}</th>`
    )
    .join('');
  const tr = rows
    .map(
      (cells) =>
        `<tr>${cells.map((cell, i) => `<td align="${columns[i]?.align || 'left'}" style="padding:10px 12px; font-size:14px; color:#3f3f4a; border-bottom:1px solid #ededf2;">${cell}</td>`).join('')}</tr>`
    )
    .join('');
  const tf = footer
    ? `<tr>${footer.map((cell, i) => `<td align="${columns[i]?.align || 'left'}" style="padding:11px 12px; font-size:14.5px; font-weight:800; color:#16151f; background:#fafafb;">${cell}</td>`).join('')}</tr>`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px; border:1px solid #e6e6ec; border-radius:12px; border-collapse:separate; overflow:hidden;">
  <thead><tr>${th}</tr></thead>
  <tbody>${tr}${tf}</tbody>
</table>`;
}

/** Nota destacada con borde del color del club (ej. un mensaje de la directiva). */
function renderNote(text, color = PLATFORM_COLOR, label = null) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
  <tr>
    <td style="padding:12px 14px; border-left:4px solid ${color}; border-radius:6px; background:${tintColor(color, 0.92)}; font-size:14px; line-height:1.55; color:#3f3f4a;">
      ${label ? `<div style="margin-bottom:4px; font-size:12px; font-weight:700; color:${shadeColor(color, 0.35)};">${escapeHtml(label)}</div>` : ''}${escapeHtml(text).replace(/\n/g, '<br>')}
    </td>
  </tr>
</table>`;
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

module.exports = { renderPlatformEmail, renderClubEmail, renderHighlight, renderTable, renderNote, escapeHtml };
