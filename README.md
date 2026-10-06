# Admin Club — API

API REST modular para una plataforma de administración de clubes, multi-tenant (multi-club) con roles y permisos 100% dinámicos. Construida con Node.js, Express y MySQL.

## Stack tecnológico

- **Node.js + Express** — servidor HTTP y enrutamiento
- **MySQL** (`mysql2/promise`) — base de datos relacional, queries parametrizadas
- **JWT** (`jsonwebtoken`) — access tokens de corta duración + refresh tokens rotativos
- **bcrypt** — hash de contraseñas
- **express-validator** — validación de datos de entrada
- **Helmet, CORS, hpp, express-rate-limit, xss** — capas de seguridad HTTP
- **multer** — subida de archivos (logos, banners, avatares)
- **socket.io** — notificaciones en tiempo real
- **node-cron** — tareas periódicas de limpieza

## Estructura de carpetas

```
api/
├── config/          Configuración central (env, base de datos, CORS, constantes, roles por defecto)
├── database/        Scripts ejecutables: migrate.js (aplica el SQL) y seed.js (datos iniciales)
├── sql/             Scripts SQL: esquema (001) y seed de funcionalidades/roles globales (002)
├── models/          Formas de dominio: mapean filas de MySQL (snake_case) a objetos camelCase
├── repositories/    Acceso a datos: única capa que ejecuta queries SQL contra MySQL
├── services/        Lógica de negocio: reglas, validaciones de dominio, orquestación de repositorios
├── controllers/     Reciben la petición HTTP, llaman al service correspondiente y arman la respuesta
├── routes/          Definen los endpoints de cada módulo y encadenan los middlewares necesarios
├── middlewares/      Piezas transversales: autenticación, permisos, club activo, validación, errores, etc.
├── validations/     Reglas de validación (express-validator) por módulo
├── helpers/         Utilidades reusables: ApiResponse, AppError, asyncHandler, tokens, paginación, logger
├── utils/           Utilidades puntuales: slugify, sanitización de texto
├── sockets/         Configuración de Socket.IO (notificaciones en tiempo real)
├── cron/            Tareas programadas (limpieza de tokens/invitaciones expiradas)
├── uploads/         Archivos subidos por los usuarios (logos, banners, avatares)
├── logs/            Logs de la aplicación
├── app.js           Configuración de Express (middlewares globales, montaje de rutas)
└── server.js        Punto de entrada: arranca el servidor HTTP, sockets y tareas cron
```

### Flujo de una petición

```
routes/*.routes.js → middlewares (auth, club, permisos, validación) → controllers/*.controller.js
  → services/*.service.js (lógica de negocio) → repositories/*.repository.js (SQL) → MySQL
```

- **routes**: solo reciben la petición y encadenan middlewares + controller. No contienen lógica.
- **controllers**: solo reciben y responden (`req` → `service` → `ApiResponse`). No contienen lógica de negocio.
- **services**: toda la lógica de negocio vive aquí (reglas, validaciones, transacciones).
- **repositories**: única capa que toca la base de datos, con queries parametrizadas.
- **middlewares clave**:
  - `auth.middleware.js` — valida el JWT y adjunta `req.user` (releyendo el usuario desde la BD en cada request).
  - `club.middleware.js` — resuelve el club activo (header `X-Club-Id`) y valida que el usuario sea miembro.
  - `permission.middleware.js` — exige que el usuario tenga la(s) funcionalidad(es) requerida(s) en el club activo.
  - El backend **nunca confía en el frontend**: todo permiso se recalcula en cada request desde la base de datos.

## Puesta en marcha

```bash
npm install
cp .env.example .env        # ajustar credenciales de MySQL si es necesario
npm run db:migrate          # crea las tablas (api/sql/001_schema.sql)
npm run db:seed             # crea funcionalidades/roles globales + Super Admin + Club Demo
npm run dev                 # levanta el servidor con recarga automática
```

Credenciales creadas por el seed: `admin@adminclub.dev` / `Admin123!`

## Listado de endpoints

Prefijo base: `/api/v1`. Salvo que se indique "público", todos los endpoints requieren el header `Authorization: Bearer <token>`. Los endpoints marcados con un código `VIEW_*`/`EDIT_*`/etc. además requieren que el usuario tenga esa funcionalidad habilitada en el club activo (header `X-Club-Id`).

### Autenticación (`/auth`)

| Método y ruta | Descripción | Requiere |
|---|---|---|
| `POST /auth/register` | Registra un nuevo usuario en la plataforma | Público |
| `POST /auth/login` | Inicia sesión y entrega access token + refresh token | Público |
| `POST /auth/refresh` | Renueva el access token usando el refresh token | Público |
| `POST /auth/logout` | Cierra la sesión actual (revoca el refresh token) | Público |
| `POST /auth/logout-all` | Cierra todas las sesiones activas del usuario | Autenticado |
| `POST /auth/forgot-password` | Envía instrucciones para restablecer la contraseña | Público |
| `POST /auth/reset-password` | Restablece la contraseña usando el token recibido por correo | Público |
| `POST /auth/verify-email` | Verifica el correo electrónico con el token recibido | Público |
| `POST /auth/verify-email/resend` | Reenvía el correo de verificación de cuenta | Autenticado |
| `GET /auth/me` | Obtiene el usuario, club activo, roles y funcionalidades del usuario autenticado | Autenticado |
| `PUT /auth/change-password` | Cambia la contraseña del usuario autenticado | Autenticado |
| `PUT /auth/default-club` | Define el club predeterminado del usuario | Autenticado |

### Usuarios (`/users`)

| Método y ruta | Descripción | Requiere |
|---|---|---|
| `GET /users/me` | Obtiene el perfil propio | Autenticado |
| `PUT /users/me` | Actualiza el perfil propio (nombre de usuario, teléfono) | Autenticado |
| `POST /users/me/avatar` | Sube/actualiza la foto de perfil propia | Autenticado |
| `GET /users` | Lista los miembros del club activo (búsqueda, filtros, paginación) | `VIEW_USERS` |
| `GET /users/:id` | Obtiene el detalle de un usuario del club activo | `VIEW_USERS` |
| `GET /users/:id/activity` | Obtiene el historial de actividad/auditoría de un usuario | `VIEW_USERS` |
| `PUT /users/:id` | Edita los datos de un usuario del club | `EDIT_USERS` |
| `PUT /users/:id/status` | Suspende o reactiva a un usuario en el club | `SUSPEND_USERS` |
| `PUT /users/:id/roles` | Reemplaza los roles asignados a un usuario en el club | `ASSIGN_USER_ROLES` |
| `DELETE /users/:id` | RETIRA a un usuario del club activo (membresía `withdrawn`, no borra datos; reversible con `PUT /users/:id/status`). Body opcional `memberAction`: `keep` \| `deactivate` \| `delete` — qué hacer con su ficha de miembro | `DELETE_USERS` |
| `GET /users/platform` | Lista TODOS los usuarios de la plataforma, sin importar club (búsqueda, filtros, paginación) | `VIEW_ALL_USERS` |
| `PUT /users/platform/:id` | Edita los datos básicos de cualquier usuario de la plataforma | `EDIT_ALL_USERS` |
| `PUT /users/platform/:id/status` | Suspende o reactiva la cuenta global de cualquier usuario de la plataforma | `SUSPEND_ALL_USERS` |

### Clubes (`/clubs`)

| Método y ruta | Descripción | Requiere |
|---|---|---|
| `GET /clubs/public` | Lista clubes públicos disponibles para descubrir/unirse | Autenticado |
| `POST /clubs/join-by-code` | Une al usuario a un club mediante un código de invitación o el código propio del club | Autenticado |
| `POST /clubs/:clubId/request-access` | Envía una solicitud de acceso a un club público | Autenticado |
| `POST /clubs` | Crea un nuevo club (cualquier usuario autenticado puede fundar uno; queda como Administrador) | Autenticado |
| `GET /clubs` | Lista todos los clubes de la plataforma (administración global) | Rol global `SUPER_ADMIN`/`DEVELOPER`/`SUPPORT` |
| `GET /clubs/:clubId` | Obtiene el detalle del club activo | `VIEW_CLUB` |
| `PUT /clubs/:clubId` | Actualiza nombre, descripción, colores, tema o visibilidad del club | `EDIT_CLUB` |
| `DELETE /clubs/:clubId` | Elimina (baja lógica) el club activo | `DELETE_CLUB` |
| `POST /clubs/:clubId/logo` | Sube/actualiza el logo del club | `EDIT_CLUB` |
| `POST /clubs/:clubId/banner` | Sube/actualiza el banner del club | `EDIT_CLUB` |
| `POST /clubs/:clubId/regenerate-invite-code` | Regenera el código de invitación permanente del club | `EDIT_CLUB` |
| `GET /clubs/:clubId/stats` | Obtiene estadísticas del club (usuarios, roles, invitaciones, actividad reciente) | `VIEW_DASHBOARD` |
| `GET /clubs/:clubId/join-requests` | Lista las solicitudes de acceso pendientes al club | `MANAGE_JOIN_REQUESTS` |
| `PUT /clubs/:clubId/join-requests/:requestId` | Aprueba o rechaza una solicitud de acceso | `MANAGE_JOIN_REQUESTS` |

### Roles (`/roles`)

| Método y ruta | Descripción | Requiere |
|---|---|---|
| `GET /roles` | Lista los roles del club activo | `VIEW_ROLES` |
| `GET /roles/:id` | Obtiene el detalle de un rol (incluye sus funcionalidades) | `VIEW_ROLES` |
| `POST /roles` | Crea un nuevo rol con su conjunto de funcionalidades | `CREATE_ROLE` |
| `PUT /roles/:id` | Edita un rol existente (nombre, color, funcionalidades) | `EDIT_ROLE` |
| `POST /roles/:id/duplicate` | Duplica un rol existente con un nuevo nombre | `CREATE_ROLE` |
| `DELETE /roles/:id` | Elimina un rol (bloqueado si es de sistema o tiene usuarios asignados) | `DELETE_ROLE` |

### Funcionalidades (`/functions`)

| Método y ruta | Descripción | Requiere |
|---|---|---|
| `GET /functions` | Obtiene el catálogo de funcionalidades del sistema, agrupado por categoría (usado al crear/editar roles) | `VIEW_FUNCTIONS` |

### Permisos (`/permissions`)

| Método y ruta | Descripción | Requiere |
|---|---|---|
| `GET /permissions/me` | Obtiene el contexto de autorización del usuario (roles + funcionalidades) en el club activo | Autenticado |

### Invitaciones (`/invitations`)

| Método y ruta | Descripción | Requiere |
|---|---|---|
| `GET /invitations` | Lista las invitaciones creadas en el club activo | `VIEW_INVITATIONS` |
| `POST /invitations` | Crea una invitación (con límite de usos, expiración y rol por defecto opcionales) | `CREATE_INVITATIONS` |
| `PUT /invitations/:id` | Edita una invitación (usos máximos, expiración, rol, nota, ficha requerida); recalcula su estado | `EDIT_INVITATIONS` |
| `PUT /invitations/:id/revoke` | Revoca una invitación activa | `REVOKE_INVITATIONS` |

### Miembros — fichas, cumpleaños, documentos (`/members`)

| Método y ruta | Descripción | Requiere |
|---|---|---|
| `GET /members/birthdays?days=30` | Próximos cumpleaños de miembros activos (respeta el alcance del actor) | `VIEW_MEMBERS` / `VIEW_MEMBERS_SCOPED` |
| `GET\|PUT /members/birthdays/settings` | Preferencia PROPIA del correo de cumpleaños (`enabled`, `daysBefore`) | `VIEW_MEMBERS` / `_SCOPED` |
| `POST /members/birthdays/send-me` | Se envía a sí mismo el correo con los próximos cumpleaños (foto + datos) | `VIEW_MEMBERS` / `_SCOPED` |
| `POST\|DELETE /members/:id/photo` | Sube/quita la foto de la ficha (pública, para plantillas de cumpleaños) | `EDIT_MEMBERS` |
| `GET\|POST /members/:id/documents` | Lista / sube documentos adjuntos (PRIVADOS, `private_uploads/`, hasta 10MB) | `VIEW_MEMBERS` · `EDIT_MEMBERS` |
| `GET /members/:id/documents/:docId/download` | Descarga autenticada de un documento | `VIEW_MEMBERS` / `_SCOPED` |
| `DELETE /members/:id/documents/:docId` | Elimina un documento | `EDIT_MEMBERS` |
| `GET\|PUT /members/fields/defaults` | Campos por defecto de la ficha (etiqueta / obligatorio / visible) | lectura: `VIEW_MEMBER_FIELDS`, `VIEW_MEMBERS`… · escritura: `EDIT_MEMBER_FIELDS` |

### Comprobantes de pago (`/payment-proofs`) y vista pública (`/public/pay`)

| Método y ruta | Descripción | Requiere |
|---|---|---|
| `GET /public/pay/:code` | **Sin sesión.** Bienvenida del club (nombre, logo, banner, colores). 404 si el club no activó la página (Tesorería → Configuración) | Rate limit por IP |
| `GET /public/pay/:code/lookup?rut=` | **Sin sesión.** Cobros de quien tenga ese RUT (miembro activo): atrasados, pendientes y cobros recurrentes activos. RUT inexistente/mal escrito → `200 { found:false }` (nunca error) | Rate limit estricto (20/15 min) |
| `POST /public/pay/:code/proofs` | **Sin sesión.** Sube un comprobante (`rut`, `chargeInstanceId`, `amount`, imagen/PDF ≤ 8MB) → queda `pending` | Rate limit estricto |
| `GET|PUT /payment-proofs/settings` | Activa/desactiva la página pública de pagos del club | `VIEW_TREASURY_SETTINGS` · `EDIT_TREASURY_SETTINGS` |
| `GET /payment-proofs?status=` · `/pending-count` | Lista / cuenta comprobantes del club (respeta alcance) | `VIEW_PAYMENTS` / `_SCOPED` |
| `GET /payment-proofs/:id/file` | Descarga autenticada del comprobante | `VIEW_PAYMENTS` / `_SCOPED` |
| `POST /payment-proofs/:id/approve` · `/reject` | Aprueba (registra el pago real) o rechaza con motivo | `CREATE_PAYMENTS` |

### Gastos — detalle de categoría
`GET /expense-categories/:id/summary` (`VIEW_EXPENSES`): totales, gastos asociados, serie mensual de pagos y últimos pagos.

### Entrenamientos — días especiales (`/attendance/trainings/:id/sessions`)
`POST` agrega un día (recuperación / día manual), `PUT /:date` cambia hora/nota, `POST /:date/cancel` y `/:date/restore`, `GET /cancelled`. Requieren `EDIT_TRAININGS` / `MARK_ATTENDANCE` o ser el entrenador responsable.

### Configuración (`/settings`)

| Método y ruta | Descripción | Requiere |
|---|---|---|
| `GET /settings` | Obtiene la configuración clave/valor del club activo | `MANAGE_SETTINGS` |
| `PUT /settings` | Actualiza la configuración clave/valor del club activo | `MANAGE_SETTINGS` |

### Notificaciones (`/notifications`)

| Método y ruta | Descripción | Requiere |
|---|---|---|
| `GET /notifications` | Lista las notificaciones del usuario autenticado (paginado, con conteo de no leídas) | Autenticado |
| `PUT /notifications/:id/read` | Marca una notificación propia como leída | Autenticado |
| `PUT /notifications/read-all` | Marca todas las notificaciones propias como leídas | Autenticado |
| `POST /notifications/broadcast` | Envía una notificación a todos los miembros activos del club | `MANAGE_NOTIFICATIONS` |

### Dashboard (`/dashboard`)

| Método y ruta | Descripción | Requiere |
|---|---|---|
| `GET /dashboard` | Obtiene el resumen general del club (conteos de usuarios/roles/invitaciones + actividad reciente) | `VIEW_DASHBOARD` |
| `GET /dashboard/audit-logs` | Obtiene el registro de auditoría (acciones administrativas) del club | `VIEW_AUDIT_LOGS` |

### Otros

| Método y ruta | Descripción | Requiere |
|---|---|---|
| `GET /health` | Verificación de estado de la API (health check) | Público |

## Formato de respuesta

Todas las respuestas siguen el mismo sobre estándar:

```json
{
  "success": true,
  "message": "Operación realizada correctamente.",
  "data": {},
  "meta": { "pagination": { "page": 1, "limit": 20, "total": 42 } }
}
```

Los errores devuelven `success: false` y un `message` descriptivo; los errores de validación (422) incluyen además un arreglo `details` con el campo y mensaje de cada error.
