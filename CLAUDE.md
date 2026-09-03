# CLAUDE.md

Este archivo guía a Claude Code cuando trabaja en `api/` (backend de Admin Club).

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

## No hacer

- No leer `process.env` fuera de `config/env.js`.
- No escribir SQL con interpolación de strings — siempre placeholders.
- No poner lógica de negocio en controllers ni SQL en services.
- No confiar en ningún campo del body que implique un permiso sin revalidarlo server-side.
- No usar `git` en este directorio para operaciones que crucen a `app/` — son dos repos Git
  independientes (`api/.git` y `app/.git`), aunque compartan carpeta padre.
