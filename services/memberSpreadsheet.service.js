const membersRepository = require('../repositories/members.repository');
const memberFieldsRepository = require('../repositories/memberFields.repository');
const memberFormsRepository = require('../repositories/memberForms.repository');
const memberGroupsRepository = require('../repositories/memberGroups.repository');
const memberMembershipsRepository = require('../repositories/memberMemberships.repository');
const membersService = require('./members.service');
const memberFormsService = require('./memberForms.service');
const memberFormVersionsRepository = require('../repositories/memberFormVersions.repository');
const AppError = require('../helpers/AppError');
const { readFirstSheet } = require('../helpers/excel');
const { canSeeSensitive, hiddenFieldsOf, formViewScope } = require('../helpers/sensitiveFields');
const permissionService = require('./permission.service');
const { FUNCTIONS } = require('../config/constants');
const { UPLOAD_TYPES, LAYOUT_TYPES, parseSettings, parseOptions, normalizeValue, isFieldVisible, sectionConditions } = require('../helpers/memberFieldTypes');
const { toDateOnly } = require('../helpers/membership');

const FORMS_COL = 'Fichas';
const STATUS_COL = 'Estado';
const GROUPS_COL = 'Grupos';
const JOINED_COL = 'Fecha de ingreso';
const MAX_IMPORT_ROWS = 2000;

/** Normaliza un encabezado para compararlo: minúsculas, sin tildes, sin "*" ni espacios extra. */
const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** ¿Dos nombres de personas distintas? Coinciden si comparten al menos dos palabras (o una, si
 * alguno tiene una sola): "Sofía Navarro" ≈ "Sofía Andrea Navarro Pérez", no ≈ "Marcela Soto". */
function namesDiffer(a, b) {
  const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 1));
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return false;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared < Math.min(2, x.size, y.size);
}

/** Fecha desde una celda de Excel: Date, "dd-mm-aaaa", "dd/mm/aaaa" o "aaaa-mm-dd". */
function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return toDateOnly(value);
  if (typeof value === 'number') return toDateOnly(new Date(Math.round((value - 25569) * 86400000)));
  const s = String(value).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s; // que lo rechace la validación de la ficha con un mensaje claro
}

/**
 * Exportar la lista de miembros a Excel e importar miembros desde una planilla. Las columnas son
 * los campos de las fichas (agrupados por la(s) ficha(s) a que pertenecen, con una fila de colores
 * arriba del encabezado), más Estado, Grupos y Fecha de ingreso. Con varias fichas (sql/072), al
 * importar se eligen las fichas que responden las personas de la planilla (las por defecto si no
 * se eligen) y cada fila se valida contra ellas, igual que un alta manual. Una planilla antigua con
 * la columna "Fichas" la sigue respetando fila por fila.
 */
/** Valor legible para la revisión de la importación (Sí/No, fechas dd-mm-aaaa, listas). */
function showValue(field, value) {
  if (value === null || value === undefined || value === '') return '';
  if (field.field_type === 'boolean') return value === true || value === 'true' ? 'Sí' : 'No';
  if (field.field_type === 'date') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    return m ? `${m[3]}-${m[2]}-${m[1]}` : String(value);
  }
  if (Array.isArray(value)) return value.join(', ');
  if (field.field_type === 'multiselect' && String(value).startsWith('[')) {
    try {
      return JSON.parse(value).join(', ');
    } catch {
      return String(value);
    }
  }
  return String(value);
}

class MemberSpreadsheetService {
  /**
   * Obligatorios de las fichas `formIds` que quedarían vacíos para alguien que ya es miembro: ni en
   * la planilla ni en lo que ya tenía (respeta las condiciones "solo si…" de cada campo).
   */
  _missingRequired(catalog, formIds, byForm, rowFields, current) {
    const ids = new Set(formIds.flatMap((id) => byForm[id] || []));
    const fields = catalog.filter((f) => ids.has(f.id));
    const merged = {};
    for (const f of catalog) {
      const v = rowFields[f.code] !== undefined && rowFields[f.code] !== '' ? rowFields[f.code] : current[f.id];
      if (v !== undefined && v !== null && v !== '') merged[f.code] = v;
    }
    const sections = sectionConditions(fields);
    return fields
      .filter((f) => f.is_required && !UPLOAD_TYPES.includes(f.field_type) && !LAYOUT_TYPES.includes(f.field_type))
      .filter((f) => isFieldVisible(f, merged, catalog, sections.get(f.id)))
      .filter((f) => merged[f.code] === undefined || (f.field_type === 'boolean' && String(merged[f.code]) !== 'true'))
      .map((f) => f.label);
  }

  /** Campos que van como columna: datos (sin imágenes, archivos ni secciones); sensibles solo con permiso. */
  _dataFields(catalog, allowSensitive) {
    return catalog.filter((f) => !UPLOAD_TYPES.includes(f.field_type) && !LAYOUT_TYPES.includes(f.field_type) && (allowSensitive || !parseSettings(f).sensitive));
  }

  /**
   * Campos de datos en el orden de las fichas `formIds` (todas si es null), sin repetir. Con todas,
   * al final van los que no están en ninguna ficha (si los hubiera), para no perder datos.
   */
  async _orderedFields(clubId, allowSensitive, formIds = null) {
    const forms = await memberFormsRepository.findByClub(clubId);
    const ids = formIds ?? forms.map((f) => f.id);
    const ordered = await memberFormsService.fieldsOf(clubId, ids);
    if (!formIds) {
      const seen = new Set(ordered.map((f) => f.id));
      ordered.push(...(await memberFieldsRepository.findByClub(clubId)).filter((f) => !seen.has(f.id)));
    }
    return this._dataFields(ordered, allowSensitive);
  }

  /**
   * Ordena los campos por la combinación de fichas (de las mostradas) en que está cada uno y arma
   * los grupos para la fila de arriba del encabezado: primero los que están en todas, después los
   * compartidos por varias y al final los de una sola ficha (en el orden de las fichas). Con una
   * sola combinación no hay grupos (no aportan nada).
   * Devuelve `{ fields, groups: [{ label, span }] }` (`groups` solo de los campos).
   */
  async _groupByForms(clubId, fields, shownFormIds) {
    const [forms, byForm] = await Promise.all([memberFormsRepository.findByClub(clubId), memberFormsRepository.fieldIdsByForm(clubId)]);
    const shown = forms.filter((f) => shownFormIds.includes(f.id));
    const order = new Map(shown.map((f, i) => [f.id, i]));
    const keyOf = (field) => shown.filter((f) => (byForm[f.id] || []).includes(field.id)).map((f) => f.id);
    const buckets = new Map();
    for (const field of fields) {
      const ids = keyOf(field);
      const key = ids.join(',');
      if (!buckets.has(key)) buckets.set(key, { ids, fields: [] });
      buckets.get(key).fields.push(field);
    }
    const sorted = [...buckets.values()].sort((a, b) => b.ids.length - a.ids.length || (order.get(a.ids[0]) ?? 99) - (order.get(b.ids[0]) ?? 99));
    const name = new Map(shown.map((f) => [f.id, f.name]));
    const label = (ids) => (!ids.length ? 'Sin ficha' : ids.length === forms.length && forms.length > 1 ? 'Todas las fichas' : ids.map((id) => name.get(id)).join(' · '));
    return {
      fields: sorted.flatMap((b) => b.fields),
      groups: sorted.length > 1 ? sorted.map((b) => ({ label: label(b.ids), span: b.fields.length })) : null,
    };
  }

  /** `{ fieldId: ['Ficha A', ...] }`: en qué fichas está cada campo (para las instrucciones). */
  async _formsByField(clubId) {
    const [forms, byForm] = await Promise.all([memberFormsRepository.findByClub(clubId), memberFormsRepository.fieldIdsByForm(clubId)]);
    const map = {};
    for (const form of forms) for (const id of byForm[form.id] || []) (map[id] = map[id] || []).push(form.name);
    return map;
  }

  _cellValue(field, raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    switch (field.field_type) {
      case 'date': {
        const d = new Date(`${String(raw).slice(0, 10)}T12:00:00Z`);
        return Number.isNaN(d.getTime()) ? String(raw) : d;
      }
      case 'number':
        return Number.isFinite(Number(raw)) ? Number(raw) : String(raw);
      case 'boolean':
        return raw === 'true' ? 'Sí' : 'No';
      case 'multiselect':
        try {
          return JSON.parse(raw).join(', ');
        } catch {
          return String(raw);
        }
      case 'address':
        try {
          return JSON.parse(raw).text ?? String(raw);
        } catch {
          return String(raw);
        }
      default:
        return String(raw);
    }
  }

  /**
   * Hoja con los miembros que coinciden con los mismos filtros del listado. Con el filtro de una
   * ficha (`formId`), solo sus miembros y sus campos; si no, todos los campos agrupados por ficha.
   */
  async exportSheet(clubId, query, authContext, actorId) {
    const access = await membersService._resolveAccess(authContext, actorId, clubId);
    const filters = await membersService._listFilters(clubId, query, authContext);
    const formId = query.formId ? Number(query.formId) : null;
    const { rows } = await membersRepository.paginateByClub(clubId, {
      limit: 20000,
      offset: 0,
      sortBy: 'first_name',
      sortOrder: 'ASC',
      search: query.search,
      status: query.status,
      groupId: query.groupId ? Number(query.groupId) : null,
      formId,
      // Filtrar por cuenta vinculada es verla (sql/081).
      linked: permissionService.hasAnyFunction(authContext, [FUNCTIONS.VIEW_MEMBER_ACCOUNT, FUNCTIONS.LINK_MEMBER_USER]) ? query.linked : undefined,
      memberIds: access.full ? null : access.memberIds,
      ...filters,
    });
    const ids = rows.map((r) => r.id);
    const [forms, groupsByMember, valuesByMember, memberships] = await Promise.all([
      memberFormsRepository.findByClub(clubId),
      membersRepository.getGroupsForMembers(ids),
      membersRepository.getFieldValuesForMembers(ids),
      memberMembershipsRepository.findByMembers(ids),
    ]);
    const formName = new Map(forms.map((f) => [f.id, f.name]));
    // Solo los campos de las fichas que puede ver, y grupos / ingreso con su permiso (sql/081).
    const hidden = new Set((await hiddenFieldsOf(clubId, authContext)).map((f) => f.id));
    const scope = await formViewScope(clubId, authContext);
    const ordered = (await this._orderedFields(clubId, canSeeSensitive(authContext), formId ? [formId] : null)).filter((f) => !hidden.has(f.id));
    const shownForms = formId ? [formId] : forms.map((f) => f.id).filter((id) => scope.all || scope.formIds.includes(id));
    const { fields, groups } = await this._groupByForms(clubId, ordered, shownForms);
    const seeGroups = permissionService.hasAnyFunction(authContext, [FUNCTIONS.VIEW_MEMBER_GROUPS, FUNCTIONS.MANAGE_MEMBER_GROUPS]);
    const seeJoined = permissionService.hasAnyFunction(authContext, [FUNCTIONS.VIEW_MEMBER_MEMBERSHIP, FUNCTIONS.EDIT_MEMBER_MEMBERSHIP]);
    const columns = [
      { header: 'Nombre completo', width: 30 },
      ...fields.map((f) => ({ header: f.label, type: f.field_type === 'date' ? 'date' : undefined })),
      { header: STATUS_COL, width: 10 },
      ...(seeGroups ? [{ header: GROUPS_COL, width: 24 }] : []),
      ...(seeJoined ? [{ header: JOINED_COL, type: 'date', width: 14 }] : []),
    ];
    const data = rows.map((m) => {
      const byField = new Map((valuesByMember[m.id] || []).map((v) => [v.field_id, v.value]));
      const joined = memberships.get(m.id)?.[0]?.startedOn ?? null;
      return [
        membersService._fullName(m),
        ...fields.map((f) => this._cellValue(f, byField.get(f.id))),
        m.status === 'active' ? 'Activo' : 'Inactivo',
        ...(seeGroups ? [(groupsByMember[m.id] || []).map((g) => g.name).join(', ')] : []),
        ...(seeJoined ? [joined ? new Date(`${toDateOnly(joined)}T12:00:00Z`) : null] : []),
      ];
    });
    const sheetName = formId && formName.has(formId) ? formName.get(formId).slice(0, 31) : 'Miembros';
    // Fila de grupos: a qué ficha(s) pertenece cada columna de datos.
    const sheetGroups = groups ? [{ label: '', span: 1 }, ...groups, { label: '', span: 1 + (seeGroups ? 1 : 0) + (seeJoined ? 1 : 0) }] : null;
    return { name: sheetName, columns, rows: data, groups: sheetGroups, freezeColumns: 1 };
  }

  /**
   * Planilla de ejemplo para importar: encabezados de las fichas + hoja de instrucciones.
   * `formIds`: planilla para esas fichas (sus campos y sus obligatorios con "*"); vacío = las
   * fichas por defecto del club (lo que recibe una fila sin la columna "Fichas").
   */
  async templateSheets(clubId, authContext, formIds = []) {
    const forms = await memberFormsRepository.findByClub(clubId);
    // Las fichas elegidas o, sin elegir, todas (no hay fichas por defecto, sql/086).
    const chosen = formIds.length ? forms.filter((f) => formIds.includes(f.id)) : [];
    const targetIds = (chosen.length ? chosen : forms).map((f) => f.id);
    const target = forms.filter((f) => targetIds.includes(f.id));
    const ordered = await this._orderedFields(clubId, canSeeSensitive(authContext), target.map((f) => f.id));
    const { fields, groups: formGroups } = await this._groupByForms(clubId, ordered, target.map((f) => f.id));
    const formsByField = await this._formsByField(clubId);
    const groups = await memberGroupsRepository.findOptions(clubId);
    const formNames = target.map((f) => f.name).join(', ');
    const headers = [...fields.map((f) => (f.is_required ? `${f.label} *` : f.label)), STATUS_COL, GROUPS_COL, JOINED_COL];
    const typeText = (f) =>
      ({
        text: 'Texto',
        textarea: 'Texto largo',
        number: 'Número',
        date: 'Fecha (dd-mm-aaaa)',
        boolean: 'Sí / No',
        select: 'Una opción',
        radio: 'Una opción',
        multiselect: 'Varias opciones separadas por coma',
        email: 'Correo',
        phone: 'Teléfono',
        rut: 'RUT (12345678-9)',
        address: 'Dirección',
      })[f.field_type] || 'Texto';
    return [
      {
        name: 'Miembros',
        columns: headers.map((h) => ({ header: h })),
        rows: [],
        groups: formGroups ? [...formGroups, { label: '', span: 3 }] : null,
      },
      {
        name: 'Instrucciones',
        columns: [{ header: 'Columna', width: 30 }, { header: 'Qué poner', width: 40 }, { header: 'Fichas', width: 30 }, { header: 'Opciones válidas', width: 60 }],
        rows: [
          ...fields.map((f) => [f.label + (f.is_required ? ' (obligatorio)' : ''), typeText(f), (formsByField[f.id] || []).join(', '), parseOptions(f).join(', ')]),
          [STATUS_COL, 'Activo o Inactivo (vacío = Activo)', '', 'Activo, Inactivo'],
          [GROUPS_COL, 'Nombres de los grupos separados por coma', '', (groups || []).map((g) => g.name).join(', ')],
          [JOINED_COL, 'Fecha en que entró al club (dd-mm-aaaa)', '', ''],
        ],
        notes: [
          `Planilla para: ${formNames}. Una fila por persona. No cambies los encabezados de la hoja "Miembros".`,
          `Al importar, elige las mismas fichas (${formNames}): todas las personas de la planilla quedan con ellas y se les piden sus obligatorios (*).`,
          'La fila de colores sobre los encabezados indica a qué ficha(s) pertenece cada columna; no hace falta borrarla.',
          'Las imágenes y documentos se suben después, desde cada ficha.',
          'El identificador (ej. el RUT) solo es obligatorio si la ficha lo marca así. Si viene y ya es de un miembro, al revisar se elige si sus datos se guardan como versión nueva de sus fichas.',
        ],
      },
    ];
  }

  /**
   * Importa miembros desde un .xlsx. `dryRun`: solo revisa y devuelve qué filas se crearían y
   * cuáles tienen errores (sin guardar nada). Sin `dryRun` crea las filas válidas y omite las demás.
   * Cada fila se valida contra SUS fichas (columna "Fichas"; vacía = las por defecto), lo mismo en
   * la revisión que al crear. Un dato de un campo que no es de sus fichas es un error (no se pierde
   * en silencio).
   */
  /**
   * `formIds`: fichas que responden las personas de la planilla (la columna "Fichas" manda).
   * Revisión (`dryRun`): por fila, los datos que se crearían (`values`), lo que cambia si ya es
   * miembro (`changes`, antes → después) y los obligatorios que faltan (`missing`: esa fila no se
   * sube). El identificador solo se exige si la ficha lo marca obligatorio. Al confirmar, una fila de
   * alguien que ya es miembro se guarda solo si su número viene en `updateRows` (versión nueva de
   * las fichas que tenía; las que no tenía se le agregan).
   */
  async importFile(clubId, buffer, { dryRun, formIds = [], updateRows = [] }, actorId, authContext) {
    const canUpdate = permissionService.hasFunction(authContext, FUNCTIONS.EDIT_MEMBERS);
    // El encabezado es la fila con "Fichas" o algún campo; la de grupos (si viene) se salta.
    const knownHeaders = new Set([FORMS_COL, STATUS_COL, GROUPS_COL, JOINED_COL].map(norm));
    const catalogForHeaders = await memberFieldsRepository.findByClub(clubId);
    for (const f of catalogForHeaders) knownHeaders.add(norm(f.label)).add(norm(f.code));
    const isHeaderRow = (texts) => texts.some((t) => t && knownHeaders.has(norm(t)));
    const { headers, rows, groupRow } = await readFirstSheet(buffer, { isHeaderRow }).catch(() => {
      throw AppError.badRequest('No se pudo leer el archivo. Sube la planilla en formato .xlsx.');
    });
    if (!rows.length) throw AppError.badRequest('La planilla no tiene filas con datos.');
    if (rows.length > MAX_IMPORT_ROWS) throw AppError.badRequest(`Máximo ${MAX_IMPORT_ROWS} filas por importación.`);

    const allowSensitive = canSeeSensitive(authContext);
    const catalog = await memberFieldsRepository.findByClub(clubId);
    const fields = this._dataFields(catalog, allowSensitive);
    const groups = await memberGroupsRepository.findOptions(clubId);
    const forms = await memberFormsRepository.findByClub(clubId);
    const chosen = formIds.length ? forms.filter((f) => formIds.includes(f.id)).map((f) => f.id) : [];
    // Fichas de las filas sin columna "Fichas": las elegidas al importar (no hay fichas por defecto).
    const defaultFormIds = chosen;
    const byForm = await memberFormsRepository.fieldIdsByForm(clubId);

    // Columna → campo (por nombre o código; sin importar tildes, mayúsculas ni "*"). Cada ficha
    // tiene sus propios campos (sql/079) y dos pueden tener uno con el mismo nombre: manda la fila
    // de fichas sobre el encabezado (la de la planilla de ejemplo / exportada) y, si no viene, el
    // orden de las fichas elegidas y después el de las demás.
    const formOfField = new Map();
    for (const form of forms) for (const id of byForm[form.id] || []) formOfField.set(id, form.id);
    const rank = new Map([...defaultFormIds, ...forms.map((f) => f.id).filter((id) => !defaultFormIds.includes(id))].map((id, i) => [id, i]));
    const candidates = [...fields].sort((a, b) => (rank.get(formOfField.get(a.id)) ?? 999) - (rank.get(formOfField.get(b.id)) ?? 999));
    const used = new Set();
    const mapping = headers.map((h, i) => {
      const n = norm(h);
      if (!n) return null;
      if (n === norm(FORMS_COL)) return { kind: 'forms' };
      if (n === norm(STATUS_COL)) return { kind: 'status' };
      if (n === norm(GROUPS_COL)) return { kind: 'groups' };
      if (n === norm(JOINED_COL)) return { kind: 'joined' };
      const groupForm = groupRow?.[i] ? forms.find((f) => norm(f.name) === norm(groupRow[i])) : null;
      const pool = groupForm ? candidates.filter((f) => formOfField.get(f.id) === groupForm.id) : candidates;
      // En el orden de prioridad (fichas elegidas primero), por nombre o código.
      const field = pool.find((f) => !used.has(f.id) && (norm(f.label) === n || norm(f.code) === n));
      if (field) used.add(field.id);
      return field ? { kind: 'field', field } : null;
    });
    const unknownColumns = headers.filter((h, i) => h && !mapping[i]);
    if (!mapping.some((m) => m?.kind === 'field')) throw AppError.badRequest('Ninguna columna coincide con los campos de la ficha. Descarga la planilla de ejemplo.');

    // Nombre para el resumen: el campo con ese uso o, si la fila es de otra ficha, el de igual nombre.
    let rowFields = {};
    // De cada uso, el primero respondido (puede haber uno por ficha, sql/086).
    const nameFrom = (role) => {
      const own = catalog.filter((x) => x.role === role);
      const labels = new Set(own.map((x) => norm(x.label)));
      return own.map((x) => rowFields[x.code]).find(Boolean) || catalog.filter((x) => !x.role && labels.has(norm(x.label))).map((x) => rowFields[x.code]).find(Boolean) || null;
    };
    const seenIdentifiers = new Map();
    const formName = new Map(forms.map((f) => [f.id, f.name]));
    const results = [];
    for (const { rowNumber, values } of rows) {
      const data = { fields: {}, status: 'active', groupIds: [], joinedOn: null, formIds: null };
      rowFields = data.fields;
      const problems = [];
      mapping.forEach((m, i) => {
        if (!m) return;
        const raw = values[i];
        const text = raw === null || raw === undefined ? '' : raw instanceof Date ? raw : String(raw).trim();
        if (m.kind === 'forms') {
          const names = String(text || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);
          if (!names.length) return;
          data.formIds = [];
          for (const name of names) {
            const form = forms.find((f) => norm(f.name) === norm(name));
            if (form) data.formIds.push(form.id);
            else problems.push(`La ficha "${name}" no existe.`);
          }
        } else if (m.kind === 'status') {
          if (text && !['activo', 'inactivo'].includes(norm(text))) problems.push(`Estado "${text}" no es válido (Activo o Inactivo).`);
          if (norm(text) === 'inactivo') data.status = 'inactive';
        } else if (m.kind === 'groups') {
          for (const name of String(text || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
            const g = groups.find((x) => norm(x.name) === norm(name));
            if (g) data.groupIds.push(g.id);
            else problems.push(`El grupo "${name}" no existe.`);
          }
        } else if (m.kind === 'joined') {
          data.joinedOn = parseDate(raw);
        } else {
          const f = m.field;
          if (text === '') return;
          let value = text;
          if (f.field_type === 'date') value = parseDate(raw);
          else if (f.field_type === 'boolean') value = ['si', 'sí', 'true', '1', 'x', 'yes'].includes(norm(text)) ? 'true' : 'false';
          else if (f.field_type === 'multiselect') value = String(text).split(/[,;]/).map((x) => x.trim()).filter(Boolean);
          else if (f.field_type === 'number') value = typeof raw === 'number' ? raw : String(text).replace(',', '.');
          else value = String(text);
          data.fields[f.code] = value;
        }
      });

      // Fichas de la fila (vacía = las por defecto) y datos que no son de ellas.
      const rowFormIds = data.formIds?.length ? [...new Set(data.formIds)] : defaultFormIds;
      data.formIds = rowFormIds;
      const allowed = new Set(rowFormIds.flatMap((id) => byForm[id] || []));
      const outside = fields.filter((f) => Object.prototype.hasOwnProperty.call(data.fields, f.code) && !allowed.has(f.id));
      if (outside.length) {
        const names = rowFormIds.map((id) => formName.get(id)).join(', ') || 'ninguna';
        problems.push(`${outside.map((f) => `"${f.label}" (${formName.get(formOfField.get(f.id)) ?? 'sin ficha'})`).join(', ')} no ${outside.length === 1 ? 'es' : 'son'} de las fichas elegidas (${names}): elige también su ficha al importar o deja ${outside.length === 1 ? 'esa celda vacía' : 'esas celdas vacías'}.`);
      }

      // Identificador: solo si la ficha lo pide obligatorio (lo valida _prepareFieldValues). Si
      // viene, no puede repetirse en la planilla, y si ya es de un miembro la fila puede ir como
      // versión nueva de sus fichas (se elige en la revisión).
      const { value: identifier, field: idField } = await membersService.identifierFrom(clubId, data.fields);
      let existing = null;
      if (identifier) {
        if (seenIdentifiers.has(identifier)) problems.push(`${idField?.label ?? 'Identificador'} repetido (también en la fila ${seenIdentifiers.get(identifier)}).`);
        else seenIdentifiers.set(identifier, rowNumber);
        existing = await membersService.findByIdentifier(clubId, data.fields);
        if (existing && !canUpdate) problems.push(`Ya es miembro (${membersService._fullName(existing)}) y no tienes permiso para editar miembros.`);
      }

      // Datos que tiene hoy (si ya es miembro): para ver qué cambia y qué obligatorio sigue faltando.
      const current = existing ? Object.fromEntries((await membersRepository.getFieldValues(existing.id)).map((v) => [v.field_id, v.value])) : {};
      let missing = [];
      if (!problems.length) {
        try {
          // Mismas reglas que al crear: los campos y obligatorios de SUS fichas.
          await membersService._prepareFieldValues(clubId, data.fields, existing ? { requireAll: false, allowSensitive, formIds: rowFormIds, memberId: existing.id } : { requireAll: true, allowSensitive, formIds: rowFormIds });
        } catch (e) {
          if (e.details?.missing) missing = e.details.missing;
          else problems.push(e.message);
        }
        // Ya es miembro: un obligatorio vacío en la planilla vale si ya lo tenía.
        if (existing && !problems.length) missing = this._missingRequired(catalog, rowFormIds, byForm, data.fields, current);
      }
      const name = membersService._fullName({ first_name: nameFrom('first_name'), last_name: nameFrom('last_name') });
      const formsText = rowFormIds.map((id) => formName.get(id)).filter(Boolean).join(', ');
      // Lo que se guardaría: datos nuevos o, si ya es miembro, solo lo que cambia (antes → después).
      const formOfFieldId = new Map(Object.entries(byForm).flatMap(([fid, ids]) => ids.map((id) => [id, Number(fid)])));
      const entries = Object.entries(data.fields)
        .map(([code, raw]) => {
          const field = catalog.find((f) => f.code === code);
          if (!field) return null;
          let to;
          try {
            to = normalizeValue(field, raw);
          } catch {
            to = raw;
          }
          return { field, to };
        })
        .filter(Boolean);
      const label = (field) => (rowFormIds.length > 1 ? `${field.label} (${formName.get(formOfFieldId.get(field.id)) ?? ''})` : field.label);
      const newValues = existing ? [] : entries.map(({ field, to }) => ({ label: label(field), value: showValue(field, to) })).filter((v) => v.value);
      const changes = existing
        ? entries
            .filter(({ field, to }) => String(to ?? '') !== String(current[field.id] ?? '') && to !== undefined)
            .map(({ field, to }) => ({ label: label(field), from: showValue(field, current[field.id]) || '—', to: showValue(field, to) || '—' }))
        : [];
      // Ya es miembro: qué pasa con cada ficha (versión nueva o se le agrega).
      let match = null;
      if (existing) {
        const [has, counts] = await Promise.all([memberFormsRepository.formIdsForMember(existing.id), memberFormVersionsRepository.countsByMembers([existing.id])]);
        const fullName = membersService._fullName(existing);
        match = {
          id: existing.id,
          fullName,
          // Mismo identificador pero otro nombre (ej. un RUT mal escrito): se avisa antes de confirmar.
          nameDiffers: namesDiffer(name, fullName),
          forms: rowFormIds.map((id) => ({ formId: id, name: formName.get(id), hasForm: has.includes(id), nextVersion: has.includes(id) ? (counts[existing.id]?.[id] ?? 1) + 1 : 1 })),
        };
      }
      const detail = { values: newValues, changes, missing };
      if (problems.length || missing.length) {
        results.push({ row: rowNumber, name, forms: formsText, ok: false, errors: problems, existing: match, ...detail });
        continue;
      }
      if (dryRun) {
        results.push({ row: rowNumber, name, forms: formsText, ok: true, errors: [], existing: match, ...detail });
        continue;
      }
      if (existing) {
        // Solo si se eligió al confirmar; si no, queda como estaba.
        if (!updateRows.includes(rowNumber)) {
          results.push({ row: rowNumber, name, forms: formsText, ok: true, skipped: true, errors: [], existing: match, ...detail });
          continue;
        }
        try {
          await membersService.applySubmission(clubId, existing.id, data.fields, rowFormIds, actorId, { newVersion: true, source: 'import' });
          if (data.groupIds.length) {
            const current = (await membersRepository.getGroupsForMember(existing.id)).map((g) => g.id);
            await membersRepository.setGroups(existing.id, [...new Set([...current, ...data.groupIds])]);
          }
          results.push({ row: rowNumber, name, forms: formsText, ok: true, updated: true, errors: [], existing: match, memberId: existing.id, ...detail });
        } catch (e) {
          results.push({ row: rowNumber, name, forms: formsText, ok: false, errors: [e.message], existing: match });
        }
        continue;
      }
      try {
        const member = await membersService.create(clubId, data, actorId, { allowSensitive });
        results.push({ row: rowNumber, name, forms: formsText, ok: true, errors: [], memberId: member.id, ...detail });
      } catch (e) {
        results.push({ row: rowNumber, name, forms: formsText, ok: false, errors: [e.message] });
      }
    }
    return {
      dryRun: !!dryRun,
      total: results.length,
      // Filas que crean un miembro nuevo (en la revisión: listas; al importar: creados).
      valid: results.filter((r) => r.ok && !r.existing).length,
      // Filas de personas que ya son miembros (en la revisión: se pueden guardar como versión nueva).
      existing: results.filter((r) => r.ok && r.existing).length,
      updated: results.filter((r) => r.updated).length,
      skipped: results.filter((r) => r.skipped).length,
      invalid: results.filter((r) => !r.ok).length,
      unknownColumns,
      results,
    };
  }
}

module.exports = new MemberSpreadsheetService();
