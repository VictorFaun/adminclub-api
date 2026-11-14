# Cambio de dominio: adminclub.thedifference.pro → miclub.thedifference.pro

Pasos para publicar la app como **Mi Club** en `miclub.thedifference.pro` sin que se pierda nada.
El dominio actual sigue funcionando y redirige al nuevo: cualquier enlace guardado, favorito,
correo enviado, enlace de pago (`/pay/…`) o de inscripción (`/inscripcion/…`) lleva a la misma
página en el dominio nuevo.

Los valores entre `<…>` son de tu servidor: reemplázalos por los que ya usa tu configuración de
nginx actual (carpeta de la web y puerto de la API).

- `/var/www/adminclub/app`: carpeta donde está publicado el build de la app (el contenido de `app/www`).
- `7000`: puerto de la API (`PORT` en el `.env`, por defecto `3000`).

---

## 1. DNS

1. En el proveedor del dominio `thedifference.pro`, crea un registro **A** para `miclub` que
   apunte a la **misma IP** que `adminclub` (si usas IPv6, también el **AAAA**).
2. Espera a que propague. Para comprobarlo, desde el servidor:

   ```bash
   dig +short miclub.thedifference.pro
   ```

   Tiene que devolver la IP del servidor.

## 2. Certificado HTTPS para el dominio nuevo

El certificado tiene que existir **antes** de poner la configuración final: esa configuración ya
lo usa, y si no existe `nginx -t` falla (y `certbot --nginx` también, porque valida la
configuración antes de empezar). Por eso se pide con un sitio temporal que solo responde la
validación de Let's Encrypt.

1. Deja nginx con la configuración que funciona hoy (si ya pegaste la nueva, restaura el respaldo):

   ```bash
   sudo cp /etc/nginx/sites-available/<archivo-actual>.bak /etc/nginx/sites-available/<archivo-actual>
   ```

2. Crea el sitio temporal `/etc/nginx/sites-available/miclub-temporal`:

   ```nginx
   server {
       listen 80;
       listen [::]:80;
       server_name miclub.thedifference.pro;

       location ^~ /.well-known/acme-challenge/ {
           root /var/www/html;
       }
       location / {
           return 404;
       }
   }
   ```

3. Actívalo y pide el certificado:

   ```bash
   sudo mkdir -p /var/www/html/.well-known/acme-challenge
   sudo ln -s /etc/nginx/sites-available/miclub-temporal /etc/nginx/sites-enabled/miclub-temporal
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot certonly --webroot -w /var/www/html -d miclub.thedifference.pro
   ```

   Debe terminar con «Successfully received certificate» y la ruta
   `/etc/letsencrypt/live/miclub.thedifference.pro/fullchain.pem`.

4. Quita el sitio temporal (la configuración final ya responde esa validación para las
   renovaciones):

   ```bash
   sudo rm /etc/nginx/sites-enabled/miclub-temporal /etc/nginx/sites-available/miclub-temporal
   ```

No borres el certificado de `adminclub.thedifference.pro`: la redirección también va por HTTPS y
lo necesita.

Después del paso 3 (nginx), comprueba que la renovación automática funciona:

```bash
sudo certbot renew --dry-run
```

## 3. nginx

**Configuración lista para tu servidor:** [deploy/nginx-miclub.conf](deploy/nginx-miclub.conf) (ya trae la carpeta `/var/www/adminclub/app` y el puerto `7000`). Reemplaza con ella el contenido del archivo de `sites-available` que hoy tiene `adminclub`. Las secciones de abajo explican qué hace cada parte.

Respalda la configuración actual antes de tocarla:

```bash
sudo cp /etc/nginx/sites-available/<archivo-actual> /etc/nginx/sites-available/<archivo-actual>.bak
```

### 3.1 Sitio nuevo (miclub)

Copia el bloque `server { … }` que hoy sirve `adminclub.thedifference.pro` (el de `listen 443`) y
cambia en la copia:

- `server_name` → `miclub.thedifference.pro`
- `ssl_certificate` y `ssl_certificate_key` → las rutas del certificado nuevo
  (`/etc/letsencrypt/live/miclub.thedifference.pro/fullchain.pem` y `privkey.pem`)

Todo lo demás (carpeta de la web, `proxy_pass` de `/api`, `/socket.io` y `/uploads`) queda igual.

Aprovecha de agregar en ese bloque las cabeceras de caché que evitan que un celular siga con una
versión vieja de la app (la pantalla en blanco):

```nginx
# La página inicial y el service worker siempre se piden de nuevo; los JS con hash, caché larga.
location = /index.html           { root /var/www/adminclub/app; add_header Cache-Control "no-cache"; }
location = /sw.js                { root /var/www/adminclub/app; add_header Cache-Control "no-cache"; }
location = /manifest.webmanifest { root /var/www/adminclub/app; default_type application/manifest+json; add_header Cache-Control "no-cache"; }
location / {
    root /var/www/adminclub/app;
    try_files $uri $uri/ /index.html;
    add_header Cache-Control "no-cache";
}
location ~* \.(js|css|png|jpg|svg|webp|woff2?|mjs)$ {
    root /var/www/adminclub/app;
    add_header Cache-Control "public, max-age=31536000, immutable";
}
```

Si tu bloque ya tiene un `location /` con `try_files`, solo agrégale la línea `add_header`.

Agrega también la redirección de HTTP a HTTPS del dominio nuevo:

```nginx
server {
    listen 80;
    server_name miclub.thedifference.pro;
    return 301 https://miclub.thedifference.pro$request_uri;
}
```

### 3.2 Dominio antiguo (adminclub): redirige, pero sin cortar a nadie

Reemplaza el bloque `server` de `adminclub.thedifference.pro` (el de 443) por este:

```nginx
server {
    listen 443 ssl http2;
    server_name adminclub.thedifference.pro;

    ssl_certificate     /etc/letsencrypt/live/adminclub.thedifference.pro/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/adminclub.thedifference.pro/privkey.pem;

    # Transición: una pestaña que quedó abierta con la versión anterior sigue usando la API y los
    # avisos en vivo por este dominio. Se atienden igual (mismo backend), no se redirigen.
    location /api/ {
        proxy_pass http://127.0.0.1:7000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location /socket.io/ {
        proxy_pass http://127.0.0.1:7000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # El service worker NO se redirige (los navegadores rechazan un SW redirigido): así los
    # celulares que instalaron la app con el dominio antiguo reciben el SW corregido, y sus
    # notificaciones push siguen llegando.
    location = /sw.js {
        root /var/www/adminclub/app;
        add_header Cache-Control "no-cache";
    }

    # Todo lo demás (páginas, enlaces de pago e inscripción, imágenes de correos antiguos):
    # redirección permanente a la MISMA ruta y parámetros en el dominio nuevo.
    location / {
        return 301 https://miclub.thedifference.pro$request_uri;
    }
}

server {
    listen 80;
    server_name adminclub.thedifference.pro;
    return 301 https://miclub.thedifference.pro$request_uri;
}
```

`$request_uri` conserva la ruta y los parámetros: `https://adminclub.thedifference.pro/pay/huemules?x=1`
termina en `https://miclub.thedifference.pro/pay/huemules?x=1`.

### 3.3 Aplicar

```bash
sudo nginx -t          # debe decir "syntax is ok" y "test is successful"
sudo systemctl reload nginx
```

## 4. API (`.env` del servidor)

Edita el `.env` real de la API en el servidor:

```env
CLIENT_URL=https://miclub.thedifference.pro
# El dominio antiguo se mantiene en la lista durante la transición (pestañas abiertas antiguas).
CLIENT_URLS=https://miclub.thedifference.pro,https://adminclub.thedifference.pro,capacitor://localhost,ionic://localhost
PUBLIC_URL=https://miclub.thedifference.pro
EMAIL_FROM_NAME=Mi Club
```

No cambies `JWT_ISSUER` ni `REFRESH_COOKIE_NAME`: son internos, y cambiarlos cerraría todas las
sesiones. Tampoco cambia el nombre de la base de datos (`admin_club`).

`CLIENT_URL` y `PUBLIC_URL` son los que arman los enlaces de los correos (pagos, comprobantes,
recordatorios) y de las imágenes: desde ahora salen con el dominio nuevo.

Sube la versión nueva de la API y reinicia el proceso:

```bash
npm ci --omit=dev
npm run db:migrate
pm2 restart admin-club-api   # o el nombre con el que lo tengas en pm2
```

El nombre del proceso en pm2 puede seguir siendo `admin-club-api`; no se ve en ningún lado.

## 5. Web app

`app/src/environments/environment.prod.ts` ya apunta a `https://miclub.thedifference.pro`.
Compila y publica como siempre:

```bash
cd app
npm ci
npm run build -- --configuration production
# subir el contenido de app/www a /var/www/adminclub/app
```

Hazlo **después** del paso 3: la app nueva llama a la API en el dominio nuevo, que tiene que
existir antes.

## 6. Inicio de sesión con Google

En Google Cloud Console → APIs y servicios → Credenciales → el cliente OAuth de la app:

- **Orígenes de JavaScript autorizados**: agrega `https://miclub.thedifference.pro`.
- Si hay **URIs de redireccionamiento autorizados** con el dominio antiguo, agrega la misma ruta
  con el dominio nuevo.

Deja también el dominio antiguo en la lista mientras dure la transición. Los cambios de Google
pueden tardar unos minutos en aplicarse.

## 7. Verificación

Desde cualquier computador:

```bash
# Redirige a la misma ruta (debe responder 301 y Location con miclub):
curl -sI https://adminclub.thedifference.pro/pay/huemules | grep -iE "^HTTP|^location"
curl -sI "https://adminclub.thedifference.pro/inscripcion/ABC123?ref=wsp" | grep -iE "^HTTP|^location"
curl -sI http://adminclub.thedifference.pro/ | grep -iE "^HTTP|^location"

# La API responde en los dos dominios (200):
curl -s https://miclub.thedifference.pro/api/v1/health
curl -s https://adminclub.thedifference.pro/api/v1/health
```

En el navegador:

1. Abre `https://miclub.thedifference.pro`: el título de la pestaña dice **Mi Club** y abajo en
   el menú lateral aparece **Mi Club · v1.1.2**.
2. Inicia sesión con correo y con Google.
3. Abre un enlace de pago antiguo (`https://adminclub.thedifference.pro/pay/<código>`): debe
   terminar en la misma página con el dominio nuevo.
4. Envía un comprobante de prueba y revisa que el correo traiga enlaces con `miclub`.

## 8. Qué notan las personas

- **Sesión**: el navegador guarda la sesión por dominio, así que en `miclub` cada persona inicia
  sesión una vez. Sus datos no cambian.
- **App instalada en el celular** desde el dominio antiguo: sigue abriendo (la redirige al
  dominio nuevo), pero conviene que la vuelvan a instalar desde `miclub.thedifference.pro` para
  que el ícono quede con el nombre Mi Club.
- **Notificaciones push**: los avisos del dominio antiguo siguen llegando (ver `/sw.js` en el
  paso 3.2). En el dominio nuevo, cada persona las activa de nuevo desde su perfil la primera
  vez: el permiso del navegador es por dominio.
- **Enlaces ya compartidos** (pago, inscripción, invitaciones, correos antiguos): siguen
  funcionando por la redirección.

## 9. Después de la transición (unos 3 meses)

Cuando ya nadie use la versión antigua (puedes revisar en los logs de nginx si siguen llegando
peticiones a `adminclub…/api/`):

1. En el bloque de `adminclub`, quita los `location /api/` y `location /socket.io/`. Deja la
   redirección y el `/sw.js` para siempre: no cuestan nada y mantienen vivos los enlaces antiguos.
2. Quita `https://adminclub.thedifference.pro` de `CLIENT_URLS` y reinicia la API.
3. Quita el dominio antiguo de los orígenes autorizados de Google.

## Si algo sale mal

- Restaura el respaldo de nginx (`<archivo-actual>.bak`) y ejecuta `sudo nginx -t && sudo systemctl reload nginx`.
- Vuelve `CLIENT_URL`, `CLIENT_URLS` y `PUBLIC_URL` del `.env` a `adminclub` y reinicia la API.
- Publica de nuevo el build anterior de la app.

El dominio antiguo nunca deja de existir en ningún paso, así que volver atrás no rompe nada.
