const membersRepository = require('../repositories/members.repository');
const memberFieldsRepository = require('../repositories/memberFields.repository');
const memberGroupsRepository = require('../repositories/memberGroups.repository');
const memberMembershipsRepository = require('../repositories/memberMemberships.repository');
const membersService = require('./members.service');
const AppError = require('../helpers/AppError');
const { readFirstSheet } = require('../helpers/excel');
const { canSeeSensitive } = require('../helpers/sensitiveFields');
const { UPLOAD_TYPES, LAYOUT_TYPES, parseSettings, parseOptions } = require('../helpers/memberFieldTypes');
const { toDateOnly } = require('../helpers/membership');

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
 * los campos de la ficha del club (en su orden), más Estado, Grupos y Fecha de ingreso.
 */
class MemberSpreadsheetService {
  /** Campos que van como columna: datos (sin imágenes, archivos ni secciones); sensibles solo con permiso. */
  _dataFields(catalog, allowSensitive) {
    return catalog.filter((f) => !UPLOAD_TYPES.includes(f.field_type) && !LAYOUT_TYPES.includes(f.field_type) && (allowSensitive || !parseSettings(f).sensitive));
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

  /** Hoja con los miembros que coinciden con los mismos filtros del listado. */
  async exportSheet(clubId, query, authContext, actorId) {
    const access = await membersService._resolveAccess(authContext, actorId, clubId);
    const filters = await membersService._listFilters(clubId, query, authContext);
    const { rows } = await membersRepository.paginateByClub(clubId, {
      limit: 20000,
      offset: 0,
      sortBy: 'first_name',
      sortOrder: 'ASC',
      search: query.search,
      status: query.status,
      groupId: query.groupId ? Number(query.groupId) : null,
      linked: query.linked,
      memberIds: access.full ? null : access.memberIds,
      ...filters,
    });
    const ids = rows.map((r) => r.id);
    const [catalog, groupsByMember, valuesByMember, memberships] = await Promise.all([
      memberFieldsRepository.findByClub(clubId),
      membersRepository.getGroupsForMembers(ids),
      membersRepository.getFieldValuesForMembers(ids),
      memberMembershipsRepository.findByMembers(ids),
    ]);
    const fields = this._dataFields(catalog, canSeeSensitive(authContext));
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
    return { name: 'Miembros', columns, rows: data, freezeColumns: 1 };
  }

  /** Planilla de ejemplo para importar: encabezados de la ficha + hoja de instrucciones. */
  async templateSheets(clubId, authContext) {
    const catalog = await memberFieldsRepository.findByClub(clubId);
    const fields = this._dataFields(catalog, canSeeSensitive(authContext));
    const groups = await memberGroupsRepository.findOptions(clubId);
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
      { name: 'Miembros', columns: headers.map((h) => ({ header: h })), rows: [] },
      {
        name: 'Instrucciones',
        columns: [{ header: 'Columna', width: 30 }, { header: 'Qué poner', width: 40 }, { header: 'Opciones válidas', width: 60 }],
        rows: [
          ...fields.map((f) => [f.label + (f.is_required ? ' (obligatorio)' : ''), typeText(f), parseOptions(f).join(', ')]),
          [STATUS_COL, 'Activo o Inactivo (vacío = Activo)', 'Activo, Inactivo'],
          [GROUPS_COL, 'Nombres de los grupos separados por coma', (groups || []).map((g) => g.name).join(', ')],
          [JOINED_COL, 'Fecha en que entró al club (dd-mm-aaaa)', ''],
        ],
        notes: ['Una fila por persona. No cambies los encabezados de la hoja "Miembros". Las imágenes y documentos se suben después, desde cada ficha.'],
      },
    ];
  }

  /**
   * Importa miembros desde un .xlsx. `dryRun`: solo revisa y devuelve qué filas se crearían y
   * cuáles tienen errores (sin guardar nada). Sin `dryRun` crea las filas válidas y omite las demás.
   */
  async importFile(clubId, buffer, { dryRun }, actorId, authContext) {
    const { headers, rows } = await readFirstSheet(buffer).catch(() => {
      throw AppError.badRequest('No se pudo leer el archivo. Sube la planilla en formato .xlsx.');
    });
    if (!rows.length) throw AppError.badRequest('La planilla no tiene filas con datos.');
    if (rows.length > MAX_IMPORT_ROWS) throw AppError.badRequest(`Máximo ${MAX_IMPORT_ROWS} filas por importación.`);

    const allowSensitive = canSeeSensitive(authContext);
    const catalog = await memberFieldsRepository.findByClub(clubId);
    const fields = this._dataFields(catalog, allowSensitive);
    const groups = await memberGroupsRepository.findOptions(clubId);

    // Columna → campo (por nombre o código; sin importar tildes, mayúsculas ni "*").
    const mapping = headers.map((h) => {
      const n = norm(h);
      if (!n) return null;
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
    const results = [];
    for (const { rowNumber, values } of rows) {
      const data = { fields: {}, status: 'active', groupIds: [], joinedOn: null };
      const problems = [];
      mapping.forEach((m, i) => {
        if (!m) return;
        const raw = values[i];
        const text = raw === null || raw === undefined ? '' : raw instanceof Date ? raw : String(raw).trim();
        if (m.kind === 'status') {
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

      // Identificador repetido dentro de la misma planilla.
      if (identifierField && data.fields[identifierField.code]) {
        const key = String(data.fields[identifierField.code]).replace(/\./g, '').toUpperCase();
        if (seenIdentifiers.has(key)) problems.push(`${identifierField.label} repetido (también en la fila ${seenIdentifiers.get(key)}).`);
        else seenIdentifiers.set(key, rowNumber);
      }

      if (!problems.length) {
        try {
          await membersService._prepareFieldValues(clubId, data.fields, { requireAll: true, allowSensitive });
        } catch (e) {
          problems.push(e.message);
        }
      }
      const name = membersService._fullName({
        first_name: data.fields[catalog.find((f) => f.role === 'first_name')?.code],
        last_name: data.fields[catalog.find((f) => f.role === 'last_name')?.code],
      });
      if (problems.length) {
        results.push({ row: rowNumber, name, ok: false, errors: problems });
        continue;
      }
      if (dryRun) {
        results.push({ row: rowNumber, name, ok: true, errors: [] });
        continue;
      }
      try {
        const member = await membersService.create(clubId, data, actorId, { allowSensitive });
        results.push({ row: rowNumber, name, ok: true, errors: [], memberId: member.id });
      } catch (e) {
        results.push({ row: rowNumber, name, ok: false, errors: [e.message] });
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
