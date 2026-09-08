# Envío de correo con Resend — qué falta configurar

El código ya está completo y funcionando. Sin `RESEND_API_KEY`, `email.service.js` sigue
comportándose como siempre (el correo queda logueado en la consola del servidor, no se envía de
verdad) — no rompe nada mientras no la configures.

## 1. Crear cuenta y verificar un dominio en Resend

1. Crea una cuenta en [resend.com](https://resend.com).
2. Ve a **Domains → Add Domain** y agrega un dominio del que tengas acceso a la configuración DNS
   (por ejemplo `tudominio.cl`, o un subdominio como `mail.tudominio.cl`).
3. Resend te da unos registros DNS para agregar (típicamente **SPF**, **DKIM** y opcionalmente
   **DMARC**). Agrégalos en el proveedor donde administras el DNS de ese dominio.
4. Espera a que Resend marque el dominio como **Verified** (puede tardar desde minutos hasta
   algunas horas según la propagación DNS).

**Mientras el dominio no esté verificado**, Resend solo te deja enviar correos a la casilla con la
que creaste la cuenta — cualquier otro destinatario va a fallar silenciosamente (el `catch` en
`email.service.js#send` lo loguea como error pero no rompe el flujo). Es una limitación real de la
plataforma, no un bug de esta integración.

## 2. Generar la API key

En **API Keys → Create API Key**, con permiso de "Sending access" es suficiente. Copia la key
(empieza con `re_`).

## 3. Configurar `api/.env`

```
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=no-reply@tudominio.cl
EMAIL_FROM_NAME=Admin Club
```

`EMAIL_FROM` **debe** ser una dirección del dominio que verificaste en el paso 1 — Resend rechaza
el envío si el remitente no pertenece a un dominio verificado en tu cuenta.

## 4. Qué correos ya están conectados

- **Verificar correo** (al registrarse) — `email.service.js#sendVerificationEmail`.
- **Recuperar/crear contraseña** (incluye el flujo de "crear contraseña" para cuentas de Google
  sin contraseña propia, ver `GOOGLE_LOGIN_SETUP.md`) — `sendPasswordResetEmail`.
- **Bienvenida** (al registrarse por correo o al crear una cuenta nueva con Google) —
  `sendWelcomeEmail`.

Los tres usan branding genérico de Admin Club (`renderPlatformEmail` en
`api/helpers/emailTemplate.js`) — son acciones a nivel de **usuario**, no de un club específico
(un usuario puede pertenecer a varios clubes, así que no hay un logo/color único que usar ahí).

## 5. Plantillas con el color/logo de cada club

`api/helpers/emailTemplate.js#renderClubEmail({ club, title, bodyHtml, ctaText?, ctaUrl? })` ya
está listo y usa el logo y color primario del club (mismo cálculo de contraste de texto que usa la
app, portado en `api/helpers/emailBrand.js`). Hoy la única función que la usa es
`email.service.js#sendInvitationEmail(toEmail, club, code)` — **existe y funciona, pero todavía no
tiene ningún llamador**: el modelo de invitación actual no exige un correo destinatario
obligatorio, así que engancharla es una decisión de producto aparte (¿se envía siempre que se crea
una invitación con correo? ¿solo si se marca una casilla?) que no estaba pedida explícitamente.
Cuando se decida, alcanza con llamar `emailService.sendInvitationEmail(...)` desde
`invitations.service.js` en el punto donde se cree la invitación.

## 6. Nota sobre desarrollo local — imágenes en el correo

El logo de un club se referencia con una URL absoluta calculada a partir de `PUBLIC_URL` (ver
`api/helpers/mediaUrl.js`). Si `PUBLIC_URL` apunta a `http://localhost:3000` (el default en
desarrollo), un cliente de correo real (Gmail, Outlook, etc.) **no puede** cargar esa imagen — no
tiene acceso a tu máquina. Para probar plantillas de club con logo real hace falta que
`PUBLIC_URL` apunte a algo accesible desde internet: un túnel (ngrok, Cloudflare Tunnel) o
directamente probar contra un entorno de staging/producción.

## 7. Probar

```
cd api
# con RESEND_API_KEY ya configurada
```

Dispara "¿Olvidaste tu contraseña?" desde el login con un correo real y confirma que llega
(antes de configurar esto, solo quedaba impreso en la consola del servidor).
