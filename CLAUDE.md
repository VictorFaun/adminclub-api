# CLAUDE.md

Este archivo guía a Claude Code cuando trabaja en `api/` (backend de Mi Club).

## Qué es esto

API REST en Node.js + Express + MySQL para administrar clubes: **multi-tenant** (un usuario puede
pertenecer a varios clubes) con **roles y permisos 100% dinámicos** (nada hardcodeado tipo
`if role === 'admin'`; todo se resuelve contra la tabla de funcionalidades en cada request).
Ver también [README.md](README.md), que documenta el listado completo de endpoints.

## Comandos

```bash
npm install
cp .env.example .env        # completar credenciales de MySQL y secretos JWT
npm run db:migrate          # aplica sql/001_schema.sql ... sql/00N_*.sql
npm run db:seed             # funcionalidades/roles globales + Super Admin + Club Demo
npm run dev                 # node --watch server.js (recarga automática)
npm start                   # producción
npm run lint                # eslint .
```

No hay suite de tests configurada (no hay `npm test`).

Credenciales del seed: `admin@adminclub.dev` / `Admin123!` — **cambiar `SEED_SUPER_ADMIN_EMAIL` /
`SEED_SUPER_ADMIN_PASSWORD` en `.env` antes de sembrar cualquier entorno real.**

## Arquitectura: flujo de una petición

```
routes/*.routes.js → middlewares (auth, club, permisos, validación) → controllers/*.controller.js
  → services/*.service.js (lógica de negocio) → repositories/*.repository.js (SQL) → MySQL
```

Cada capa tiene una responsabilidad única y **no se salta**:

- **routes/**: solo encadena middlewares + controller. Cero lógica.
- **controllers/**: `req` → llama al service → `ApiResponse`. Cero lógica de negocio, cero SQL.
- **services/**: toda la lógica de negocio (reglas, validaciones de dominio, transacciones,
  auditoría). Trabaja con filas crudas de MySQL (snake_case) y expone DTOs vía un método `toDto()`
  que convierte a camelCase para el frontend.
- **repositories/**: única capa que ejecuta SQL. Extienden `BaseRepository` (CRUD genérico:
  `findById`, `insert`, `updateById`, `deleteById`, `count`) y añaden queries propias. **Siempre
  parametrizadas** (`?` o `:named` con `namedPlaceholders: true`) — nunca concatenar valores de
  usuario en el SQL.
- **models/**: clases con un solo método estático `fromRow(row)` que mapea una fila MySQL a un
  objeto de dominio. Uso limitado hoy (varios services hacen el mapeo inline con `toDto()`); si
  agregás un modelo nuevo, seguí el mismo patrón mínimo.
- **validations/**: arrays de `express-validator` (`body/param/query`) por módulo, consumidos por
  `handleValidation` (middleware).

## Middlewares clave (orden importa)

Para una ruta autenticada y con permiso, el orden estándar es:

```js
router.use(authMiddleware, clubContextMiddleware);
router.get('/', requireFunction(FUNCTIONS.VIEW_X), validation.listX, handleValidation, controller.list);
router.post('/', requireFunction(FUNCTIONS.CREATE_X), sanitizeBody, validation.createX, handleValidation, controller.create);
```

- `authMiddleware` — valida el JWT y **relee el usuario desde la BD en cada request** (así una
  suspensión aplica al instante, sin esperar a que expire el access token). Adjunta `req.user`.
- `clubContextMiddleware` — resuelve el club activo desde el header `X-Club-Id` (o `:clubId` de
  ruta), valida que esté activo y que el usuario sea miembro activo (o tenga `VIEW_ALL_CLUBS` /
  sea Super Admin, en modo solo-lectura). Adjunta `req.club` y `req.membership`.
- `requireFunction(...codes)` (middlewares/permission.middleware.js) — exige que el usuario tenga
  al menos una de las funcionalidades indicadas **en el club activo**. Construye
  `req.authContext` vía `permission.service.js` (única fuente de verdad de autorización).
- `sanitizeBody` — sanitiza `req.body` contra XSS (antes de validar).
- `handleValidation` — corta con 422 + `details` si `express-validator` encontró errores.
- `audit.middleware.js` (`audit(action, entityType, getEntityId?)`) — opcional, registra auditoría
  fire-and-forget cuando la respuesta termina en 2xx. La mayoría de los módulos prefieren loguear
  auditoría explícitamente desde el service (más control sobre qué se registra); usar el
  middleware solo para acciones simples.

**Regla de oro de seguridad:** el backend nunca confía en el frontend. Todo permiso se recalcula
en cada request desde la base de datos (`permission.service.js#buildAuthorizationContext`); si un
body trae un campo que implica un privilegio (p. ej. `defaultRoleId` al crear una invitación), el
service debe revalidar que el actor tenga la funcionalidad correspondiente y descartar el valor si
no la tiene (ver `invitations.service.js#create`).

## Helpers que hay que usar siempre

- `helpers/asyncHandler.js` — envolver todo controller/middleware async (evita try/catch repetido;
  reenvía rechazos a `next()`).
- `helpers/AppError.js` — todo error de negocio se lanza como `AppError.badRequest/notFound/
  conflict/forbidden/unprocessable(...)`. `error.middleware.js` (al final de `app.js`) lo traduce a
  `{ success:false, message, details? }` con el status code correcto. También mapea errores
  conocidos de JWT, MySQL (`ER_DUP_ENTRY`, FKs) y Multer a `AppError` automáticamente.
- `helpers/ApiResponse.js` — toda respuesta exitosa pasa por `ApiResponse.ok/created/paginated`.
  Sobre estándar: `{ success, message, data, meta? }`.
- `helpers/pagination.js` — `parsePagination(query, sortableColumns)` /
  `buildMeta({page, limit, total})`. `sortableColumns` es una whitelist obligatoria (evita SQL
  injection en `ORDER BY`, que no se puede parametrizar con `?`).
- `config/database.js` — `pool` (queries sueltas) y `withTransaction(callback)` para operaciones
  multi-tabla que deben ser atómicas.
- `config/env.js` — única puerta de entrada a `process.env`. Ningún otro módulo debe leer
  `process.env` directamente.
- `config/constants.js` — todos los "magic strings" del dominio (`FUNCTIONS`, `USER_STATUS`,
  `CLUB_STATUS`, etc.). Los códigos de `FUNCTIONS` son el catálogo de permisos.

## Convenciones

- SQL en snake_case (`club_id`, `created_at`); DTOs hacia el frontend en camelCase — la conversión
  vive en el service (`toDto`), nunca se filtra snake_case hacia afuera.
- Zona horaria: MySQL se fuerza a UTC por conexión (`config/database.js`); todas las fechas se
  guardan/comparan en UTC.
- Archivos subidos (`uploads/`): usar `middlewares/upload.middleware.js#uploadFor(subdir)`. SVG
  está deliberadamente prohibido (riesgo XSS almacenado, se sirven estáticos tal cual). La
  extensión del archivo se deriva del `mimetype` validado, nunca de `originalname`.
- Rate limiting general ya aplicado globalmente en `app.js` vía `env.apiPrefix`; endpoints de auth
  sensibles pueden necesitar un rate limit más estricto (`authRateLimitMax`) — ver
  `middlewares/rateLimit.middleware.js`.
- Actualizaciones concurrentes sobre contadores/estado (ver `invitations.repository.js#claimUse`):
  cuando dos requests pueden competir por el mismo recurso, resolver con un único `UPDATE`
  atómico que incluya la condición en el `WHERE`, no con un `SELECT` de chequeo seguido de un
  `UPDATE` separado.

## Checklist para agregar un módulo nuevo (ej. "eventos")

1. **SQL**: nuevo archivo `sql/0NN_descripcion.sql` (nunca editar migraciones ya aplicadas), correr
   `npm run db:migrate`.
2. **Funcionalidades**: agregar los códigos de permiso nuevos a `config/constants.js#FUNCTIONS` y
   sembrarlos en la tabla de funcionalidades (seed o migración) si deben quedar asignables a roles.
3. **repositories/eventos.repository.js**: `class EventosRepository extends BaseRepository` +
   queries propias, parametrizadas.
4. **services/eventos.service.js**: lógica de negocio, `toDto()`, auditoría con
   `auditRepository.logAction(...)` en creaciones/cambios de estado relevantes.
5. **validations/eventos.validation.js**: arrays de `express-validator` por endpoint.
6. **controllers/eventos.controller.js**: funciones delgadas envueltas en `asyncHandler`, cada una
   llama al service y responde con `ApiResponse`.
7. **routes/eventos.routes.js**: `router.use(authMiddleware, clubContextMiddleware)` +
   `requireFunction(FUNCTIONS.X)` por endpoint + `sanitizeBody` en POST/PUT + `validation.x` +
   `handleValidation` + `controller.x`.
8. Registrar el router en **routes/index.js**: `router.use('/eventos', require('./eventos.routes'))`.
9. Actualizar el listado de endpoints en **README.md**.

## Archivos privados y jobs

- Archivos que NO deben ser públicos (documentos de miembros, comprobantes de pago) van con `middlewares/privateUpload.middleware.js` a `private_uploads/` (fuera de `/uploads`, que se sirve estático) y se entregan solo por un endpoint autenticado que revalida el acceso.
- Endpoints públicos (sin `authMiddleware`) hoy: `/public/pay/:code` (página pública del club: la persona se identifica con su RUT y ve, en pestañas, solo las secciones activadas en Configuración → Página pública — Tesorería, Asistencia y las fichas publicadas, sin archivos ni campos sensibles; ver `publicPage.service.js` y sql/076) y `/public/join/:code` (formulario de una invitación sin cuenta) — siempre con rate limit y sin revelar más que lo mínimo.
- Crons: `cron/birthdayEmails.cron.js` (cada 5 min) envía cada aviso de cumpleaños de cada usuario (varios por día, por grupos; ver `birthdays.service.js`) una vez al día; `cron/calendarReminders.cron.js` (cada minuto) envía los recordatorios de eventos (`calendar_event_reminders`, varios por evento).
- Comprobantes de pago: al enviarse, aviso (app, push y correo) a quienes ven comprobantes (`paymentProofs.service.js#_notifyNewProof`); al aprobar/rechazar, `paymentNotices.service.js` manda UN correo por dirección (ficha + cuentas del miembro y apoderados; aprobado con el recibo PDF adjunto) y la notificación de la app sin correo (`sendEmail: false`). Un pago registrado directamente por tesorería no avisa a nadie.
- Notificaciones: `notificationsService.notifyUser` crea la notificación + push + correo (`sendEmail: false` para omitir el correo). Pasarle `category` (`birthday`, `event`, `members`, `payments`, `trainings`, `invitation`, `general`; ver sql/070) para que se pueda filtrar en la pestaña Notificaciones.
- Fichas por código de invitación: `POST /members/me` ya no crea el miembro, deja una solicitud (`member_applications.user_id`) que se aprueba en Solicitudes; hasta entonces la membresía sigue con `requires_profile_completion` y `pending_form_ids` (ver `memberApplications.service.js#submitForAccount`).
- Varias fichas (sql/072, sql/079): `member_forms` es una selección ordenada de campos del catálogo (`member_form_fields`). Cada campo es de UNA sola ficha (`uk_mff_field`): dos fichas pueden tener un campo con el mismo nombre (código con sufijo, ej. `telefono-2`) y son independientes. Usos especiales (sql/083): nombres e Identificador van una vez en el club; los `perForm` de `helpers/memberFieldTypes.js#ROLES` (nacimiento, foto de cumpleaños, avatar, correo, teléfono) una vez por ficha — la vista `member_profiles` toma el primero respondido (fichas que responde el miembro, la del identificador primero, luego el orden de las fichas; con `ROW_NUMBER()`, sql/085: no concatenar texto con el valor para ordenar, en MySQL 8 falla por mezcla de colaciones), así que para estos roles no usar `catalog.find(role)` como si hubiera uno solo; la ficha que tiene el Identificador va SIEMPRE que se elijan fichas (`memberForms.service.js#withIdentifierForm`, aplicado en `resolveIds`, alta de miembros, invitaciones, importación y asignación; no se puede quitar a quien responde otras). Como respaldo, `members.service.js#identifierFrom` reconoce por un campo del mismo tipo y nombre que el identificador. Las migraciones pueden ser `.js` (`sql/079_*.js`, exporta `async (connection) => {}`). `member_form_members` = qué fichas responde cada miembro; toda validación de la ficha va acotada a esas fichas (`members.service.js#_prepareFieldValues` con `formIds`, `memberForms.service.js#fieldsOf`).
- Versiones de las fichas (sql/078, `memberFormVersions.service.js`): cada (miembro, ficha) tiene su historial en `member_form_versions`. La principal (`snapshot` NULL; por defecto la última) = los datos vigentes (member_field_values + documentos sin `archived_at`), así que las correcciones la actualizan sin más; `startNew` congela la vigente y abre otra (al aceptar una solicitud de alguien que ya era miembro, o al editar con `newVersion: true`). `activate` (`POST /members/:id/form-versions/:versionId/activate`) hace principal a una anterior sin copiarla: sus datos pasan a la ficha y la que era principal se congela. Al borrar la principal pasa a serlo la más reciente que queda. Imágenes y documentos se comparten entre versiones: para sacarlos de la ficha usar `retireImage` / `retireDocument` (archivan o borran según si alguna versión los usa), nunca borrar el archivo directo.
- Editar fichas / campos específicos (sql/080): EDIT_MEMBER_FORMS_SCOPED + `role_member_form_scope` y EDIT_MEMBER_FIELD_VALUES_SCOPED + `role_member_field_scope`. Solo datos (`PUT /members/:id/fields`, con `newVersion`), sobre los miembros que el actor puede ver; `members.service.js#editScope` dice qué campos (`all: true` con EDIT_MEMBERS). No cubre imágenes/documentos ni estado, grupos, fichas o cuenta.
- Partes del detalle del miembro (sql/081): ver a un miembro (VIEW_MEMBERS/_SCOPED) ya no trae todo. Datos de fichas: VIEW_MEMBER_FORM_DATA (todas) o VIEW_MEMBER_FORM_DATA_SCOPED + `role_member_view_form_scope` (viaja como `editScope.viewFormIds` del rol); EDIT_MEMBERS y lo que el rol puede editar también se ve. Lo aplica `helpers/sensitiveFields.js` (`formViewScope`/`hiddenFieldsOf`, junto con los sensibles) en detalle, listado, búsqueda, versiones, documentos y exportación; las solicitudes usan `sensitiveOnly`. Cuenta vinculada: VIEW_MEMBER_ACCOUNT (vincular: LINK_MEMBER_USER). Apoderados: VIEW_/EDIT_MEMBER_GUARDIANS. "En el club" (estado, ingreso, historial): VIEW_/EDIT_MEMBER_MEMBERSHIP, que se edita por `PUT /members/:id/membership` (`PUT /members/:id` ignora status/joinedOn/statusDate sin ese permiso). `members.controller.js#present` quita del DTO cuenta, historial y grupos sin su permiso. El authContext trae `userId`.
- Inscripción con apoderado (sql/082): `invitations.form_settings.guardian = { enabled, formIds }` (siempre con la ficha del identificador). El formulario (público y de cuenta) manda `guardianFields` + archivos `gfile_<id>` + `guardianRelation`; queda una segunda solicitud con `guardian_of_id` → la principal. No sale sola en el listado (va en `guardian` de la suya), no cuenta como pendiente y se acepta/rechaza solo junto con la principal: al aceptar se crea el miembro apoderado (o se suma al que tenga ese identificador) y se vincula en `member_guardians`. Mensaje, grupo y consentimientos de la invitación ahora se piden también a las cuentas (`_accountOptions`).
- Apoderados = miembros vinculados a otro miembro (`member_guardians.guardian_member_id`); la cuenta es opcional. Para una cuenta usar `members.service.js#ensureForAccount` (su registro o uno nuevo, nunca dos).
- Invitaciones: `requires_account` y `invitation_forms` son independientes (al menos una). `clubs.service.js#joinByCode` rechaza las que no exigen cuenta: esas solo sirven por su enlace público (`/public/join/:code`), que consume el uso con `claimUse` en la misma transacción que crea la solicitud. Lo que además pregunta ese enlace (mensaje para el club, categoría y qué consentimientos) es de cada invitación (`invitations.form_settings`, sql/077, `invitationFormSettings.service.js`); NULL = las opciones que tenía el club antes.

## RUT

Formato canónico único: `12345678-9` (sin puntos, con guion, verificador en mayúscula). `helpers/rut.js` normaliza/valida; `validations/members.validation.js#rutRule` lo aplica a todo RUT que entra por la API (acepta variantes y las guarda canónicas) y la migración 043 convirtió los existentes. Cualquier campo RUT nuevo debe usar `rutRule`/`normalizeRut`.

## No hacer

- No leer `process.env` fuera de `config/env.js`.
- No escribir SQL con interpolación de strings — siempre placeholders.
- No poner lógica de negocio en controllers ni SQL en services.
- No confiar en ningún campo del body que implique un permiso sin revalidarlo server-side.
- No usar `git` en este directorio para operaciones que crucen a `app/` — son dos repos Git
  independientes (`api/.git` y `app/.git`), aunque compartan carpeta padre.
