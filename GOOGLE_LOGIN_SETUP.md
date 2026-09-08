# Login con Google — qué falta configurar

El código ya está completo y funcionando (backend + frontend). Lo único que falta es crear las
credenciales en Google Cloud Console y pegarlas en dos archivos. Sin hacer esto, el botón
"Continuar con Google" simplemente no aparece — el login con correo/contraseña sigue funcionando
igual, no se rompe nada.

## 1. Crear el proyecto y las credenciales en Google Cloud Console

1. Entra a [Google Cloud Console](https://console.cloud.google.com/) y crea un proyecto nuevo (o
   usa uno existente).
2. Ve a **APIs & Services → OAuth consent screen**.
   - Tipo de usuario: **External** (a menos que todos los usuarios sean de tu misma organización
     de Google Workspace).
   - Completa el nombre de la app, correo de soporte y correo de contacto del desarrollador.
   - Mientras la app esté en modo "Testing", solo las cuentas de Google que agregues como
     "Test users" van a poder iniciar sesión. Para permitir cualquier cuenta de Google, hay que
     **publicar** la app (botón "Publish app") — Google puede pedir una verificación adicional si
     pides scopes sensibles, pero este flujo solo usa el scope básico de identidad (nombre, correo,
     foto), así que normalmente no hace falta verificación.
3. Ve a **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Tipo de aplicación: **Web application**.
   - En **Authorized JavaScript origins**, agrega TODOS los orígenes desde donde se sirve el
     frontend:
     - Desarrollo local: `http://localhost:8100` (o el puerto que uses con `ionic serve`/`ng serve`).
     - Producción: `https://adminclub.thedifference.pro` (o el dominio real que uses).
   - **No hace falta** configurar "Authorized redirect URIs" — este flujo (Google Identity
     Services) no usa redirect, el token se obtiene directo en el navegador.
   - Guarda y copia el **Client ID** (termina en `.apps.googleusercontent.com`). El **Client
     Secret** que Google también genera **no se usa** — este flujo no lo necesita.

## 2. Pegar el Client ID en el backend

En `api/.env` (crearlo a partir de `api/.env.example` si todavía no existe):

```
GOOGLE_CLIENT_ID=tu-client-id.apps.googleusercontent.com
```

Es un valor **público** (no un secreto) — viaja también al frontend, así que no hay problema en
que quede visible en el bundle de la app.

## 3. Pegar el Client ID en el frontend

En `app/src/environments/environment.ts` (desarrollo) y `app/src/environments/environment.prod.ts`
(producción), reemplaza el valor vacío:

```ts
googleClientId: 'tu-client-id.apps.googleusercontent.com',
```

Puedes usar el mismo Client ID en ambos archivos siempre que hayas agregado tanto el origen de
desarrollo como el de producción en el paso 1 (Google valida el origen que hace la llamada, no
hace falta un Client ID distinto por entorno).

## 4. Correr la migración de base de datos

```
cd api
npm run db:migrate
```

Esto agrega la columna `google_id` a `users` y relaja `password_hash` para permitir cuentas sin
contraseña propia (creadas 100% desde Google).

## 5. Probar

- **Cuenta de Google nueva** (sin cuenta previa en Admin Club): al iniciar sesión con Google se
  crea una cuenta nueva automáticamente, ya verificada, sin necesidad de pasar por el registro
  normal.
- **Cuenta de Google que coincide con un correo ya registrado** (con contraseña local): al iniciar
  sesión con Google, esa cuenta se **vincula** (no se duplica) — desde ese momento se puede
  entrar tanto con la contraseña local como con Google.
- **Crear contraseña para una cuenta 100% Google**: en el perfil (`/profile`), si la cuenta no
  tiene contraseña propia, aparece "Crear contraseña" en vez de "Cambiar contraseña" — reusa el
  flujo existente de "¿Olvidaste tu contraseña?" (llega un correo con un link de un solo uso).
  Esto requiere que Resend esté configurado (ver `RESEND_EMAIL_SETUP.md`); mientras tanto, el
  correo queda solo logueado en la consola del servidor.

## Qué NO fue necesario tocar

- No se agregó ninguna librería de servidor de sesiones OAuth (`passport`, etc.) — el frontend
  obtiene el `id_token` directo de Google (Google Identity Services) y el backend solo lo verifica
  con `google-auth-library`.
- No hace falta `client_secret` en ningún lado.
- No se tocó el flujo de registro/login por correo — sigue funcionando exactamente igual.
