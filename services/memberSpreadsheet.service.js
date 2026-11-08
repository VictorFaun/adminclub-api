const membersRepository = require('../repositories/members.repository');
const memberFieldsRepository = require('../repositories/memberFields.repository');
const memberFormsRepository = require('../repositories/memberForms.repository');
const memberGroupsRepository = require('../repositories/memberGroups.repository');
const memberMembershipsRepository = require('../repositories/memberMemberships.repository');
const membersService = require('./members.service');
const memberFormsService = require('./memberForms.service');
const AppError = require('../helpers/AppError');
const { readFirstSheet } = require('../helpers/excel');
const { canSeeSensitive } = require('../helpers/sensitiveFields');
const { UPLOAD_TYPES, LAYOUT_TYPES, parseSettings, parseOptions } = require('../helpers/memberFieldTypes');
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
class MemberSpreadsheetService {
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
      linked: query.linked,
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
    const ordered = await this._orderedFields(clubId, canSeeSensitive(authContext), formId ? [formId] : null);
    const { fields, groups } = await this._groupByForms(clubId, ordered, formId ? [formId] : forms.map((f) => f.id));
    const columns = [
      { header: 'Nombre completo', width: 30 },
      ...fields.map((f) => ({ header: f.label, type: f.field_type === 'date' ? 'date' : undefined })),
      { header: STATUS_COL, width: 10 },
      { header: GROUPS_COL, width: 24 },
      { header: JOINED_COL, type: 'date', width: 14 },
    ];
    const data = rows.map((m) => {
      const byField = new Map((valuesByMember[m.id] || []).map((v) => [v.field_id, v.value]));
      const joined = memberships.get(m.id)?.[0]?.startedOn ?? null;
      return [
        membersService._fullName(m),
        ...fields.map((f) => this._cellValue(f, byField.get(f.id))),
        m.status === 'active' ? 'Activo' : 'Inactivo',
        (groupsByMember[m.id] || []).map((g) => g.name).join(', '),
        joined ? new Date(`${toDateOnly(joined)}T12:00:00Z`) : null,
      ];
    });
    const sheetName = formId && formName.has(formId) ? formName.get(formId).slice(0, 31) : 'Miembros';
    // Fila de grupos: a qué ficha(s) pertenece cada columna de datos.
    const sheetGroups = groups ? [{ label: '', span: 1 }, ...groups, { label: '', span: 3 }] : null;
    return { name: sheetName, columns, rows: data, groups: sheetGroups, freezeColumns: 1 };
  }

  /**
   * Planilla de ejemplo para importar: encabezados de las fichas + hoja de instrucciones.
   * `formIds`: planilla para esas fichas (sus campos y sus obligatorios con "*"); vacío = las
   * fichas por defecto del club (lo que recibe una fila sin la columna "Fichas").
   */
  async templateSheets(clubId, authContext, formIds = []) {
    const forms = await memberFormsRepository.findByClub(clubId);
    const chosen = formIds.length ? forms.filter((f) => formIds.includes(f.id)) : forms.filter((f) => f.is_default);
    const target = chosen.length ? chosen : forms.slice(0, 1);
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
  /** `formIds`: fichas que responden las personas de la planilla (sin indicar: las por defecto). */
  async importFile(clubId, buffer, { dryRun, formIds = [] }, actorId, authContext) {
    // El encabezado es la fila con "Fichas" o algún campo; la de grupos (si viene) se salta.
    const knownHeaders = new Set([FORMS_COL, STATUS_COL, GROUPS_COL, JOINED_COL].map(norm));
    const catalogForHeaders = await memberFieldsRepository.findByClub(clubId);
    for (const f of catalogForHeaders) knownHeaders.add(norm(f.label)).add(norm(f.code));
    const isHeaderRow = (texts) => texts.some((t) => t && knownHeaders.has(norm(t)));
    const { headers, rows } = await readFirstSheet(buffer, { isHeaderRow }).catch(() => {
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
    const defaultFormIds = chosen.length ? chosen : await memberFormsService.defaultIds(clubId);
    const byForm = await memberFormsRepository.fieldIdsByForm(clubId);

    // Columna → campo (por nombre o código; sin importar tildes, mayúsculas ni "*").
    const mapping = headers.map((h) => {
      const n = norm(h);
      if (!n) return null;
      if (n === norm(FORMS_COL)) return { kind: 'forms' };
      if (n === norm(STATUS_COL)) return { kind: 'status' };
      if (n === norm(GROUPS_COL)) return { kind: 'groups' };
      if (n === norm(JOINED_COL)) return { kind: 'joined' };
      const field = fields.find((f) => norm(f.label) === n || norm(f.code) === n);
      return field ? { kind: 'field', field } : null;
    });
    const unknownColumns = headers.filter((h, i) => h && !mapping[i]);
    if (!mapping.some((m) => m?.kind === 'field')) throw AppError.badRequest('Ninguna columna coincide con los campos de la ficha. Descarga la planilla de ejemplo.');

    const identifierField = catalog.find((f) => f.role === 'identifier');
    const seenIdentifiers = new Map();
    const formName = new Map(forms.map((f) => [f.id, f.name]));
    const results = [];
    for (const { rowNumber, values } of rows) {
      const data = { fields: {}, status: 'active', groupIds: [], joinedOn: null, formIds: null };
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
        problems.push(`${outside.map((f) => `"${f.label}"`).join(', ')} no ${outside.length === 1 ? 'es' : 'son'} de las fichas elegidas (${names}): elige también su ficha al importar o deja ${outside.length === 1 ? 'esa celda vacía' : 'esas celdas vacías'}.`);
      }

      // Identificador repetido dentro de la misma planilla.
      if (identifierField && data.fields[identifierField.code]) {
        const key = String(data.fields[identifierField.code]).replace(/\./g, '').toUpperCase();
        if (seenIdentifiers.has(key)) problems.push(`${identifierField.label} repetido (también en la fila ${seenIdentifiers.get(key)}).`);
        else seenIdentifiers.set(key, rowNumber);
      }

      if (!problems.length) {
        try {
          // Mismas reglas que al crear: los campos (y obligatorios) de SUS fichas.
          await membersService._prepareFieldValues(clubId, data.fields, { requireAll: true, allowSensitive, formIds: rowFormIds });
        } catch (e) {
          problems.push(e.message);
        }
      }
      const name = membersService._fullName({
        first_name: data.fields[catalog.find((f) => f.role === 'first_name')?.code],
        last_name: data.fields[catalog.find((f) => f.role === 'last_name')?.code],
      });
      const formsText = rowFormIds.map((id) => formName.get(id)).filter(Boolean).join(', ');
      if (problems.length) {
        results.push({ row: rowNumber, name, forms: formsText, ok: false, errors: problems });
        continue;
      }
      if (dryRun) {
        results.push({ row: rowNumber, name, forms: formsText, ok: true, errors: [] });
        continue;
      }
      try {
        const member = await membersService.create(clubId, data, actorId, { allowSensitive });
        results.push({ row: rowNumber, name, forms: formsText, ok: true, errors: [], memberId: member.id });
      } catch (e) {
        results.push({ row: rowNumber, name, forms: formsText, ok: false, errors: [e.message] });
      }
    }
    return {
      dryRun: !!dryRun,
      total: results.length,
      valid: results.filter((r) => r.ok).length,
      invalid: results.filter((r) => !r.ok).length,
      unknownColumns,
      results,
    };
  }
}

module.exports = new MemberSpreadsheetService();
