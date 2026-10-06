const membersRepository = require('../repositories/members.repository');
const memberFieldsRepository = require('../repositories/memberFields.repository');
const memberGroupsRepository = require('../repositories/memberGroups.repository');
const chargeInstancesRepository = require('../repositories/chargeInstances.repository');
const memberMembershipsRepository = require('../repositories/memberMemberships.repository');
const trainingAttendancesRepository = require('../repositories/trainingAttendances.repository');
const { COVERAGE_REASONS, LEGACY_INACTIVE_REASON, chargePeriodReason, proratedAmount, dateReason, toDateOnly } = require('../helpers/membership');
const clubPolicyService = require('./clubPolicy.service');
const settingsRepository = require('../repositories/settings.repository');
const { canSeeSensitive } = require('../helpers/sensitiveFields');
const chargesRepository = require('../repositories/charges.repository');
const { regeneratePeriods } = require('../helpers/regeneratePeriods');
const { UPLOAD_TYPES, LAYOUT_TYPES, normalizeValue, normalizeIdentifier, isFieldVisible, sectionConditions } = require('../helpers/memberFieldTypes');
const usersRepository = require('../repositories/users.repository');
const auditRepository = require('../repositories/audit.repository');
const permissionService = require('./permission.service');
const AppError = require('../helpers/AppError');
const { withTransaction } = require('../config/database');
const { parsePagination, buildMeta } = require('../helpers/pagination');
const { diffValue, buildDiff } = require('../helpers/auditDiff');
const { FUNCTIONS, USER_CLUB_STATUS } = require('../config/constants');
const { toAbsoluteMediaUrl, deleteUploadedFile } = require('../helpers/mediaUrl');
const { resolvePrivatePath, deletePrivateFile } = require('../middlewares/privateUpload.middleware');
const { collectUploads, assertDocuments, discard, moveToPublic, moveToPrivate } = require('../helpers/memberUploads');
const { parseSettings, maxFilesOf, imageList } = require('../helpers/memberFieldTypes');

const SORTABLE = ['created_at', 'first_name', 'last_name', 'status'];

/** club_settings: códigos de los campos que muestra el listado de miembros. */
const LIST_COLUMNS_KEY = 'member_list_columns';

class MembersService {
  /** Nombre a mostrar: los campos con uso Nombre/Apellido (ver helpers/memberFieldTypes.js#ROLES);
   * si el club no tiene o están vacíos, "Miembro #id" para que nunca quede en blanco. */
  _fullName(m) {
    return [m.first_name, m.middle_name, m.last_name, m.second_last_name].filter(Boolean).join(' ') || `Miembro #${m.id}`;
  }

  /** "Primer nombre + primer apellido" — nombre corto para vistas de pagos (espacio angosto,
   * ver member-payments.page.html); el resto de la app sigue usando `fullName`. */
  _shortName(m) {
    return [m.first_name, m.last_name].filter(Boolean).join(' ') || `Miembro #${m.id}`;
  }

  /** Valor de un campo tal como lo entrega la API: selección múltiple → arreglo; imagen → URL. */
  _fieldValueDto(field, value) {
    if (value === null || value === undefined) return null;
    if (field.field_type === 'multiselect') {
      try {
        return JSON.parse(value);
      } catch {
        return [];
      }
    }
    if (field.field_type === 'image') {
      // Varias imágenes → arreglo de URLs; una sola → la URL.
      const urls = imageList(value).map((u) => toAbsoluteMediaUrl(u));
      return parseSettings(field).multiple ? urls : urls[0] ?? null;
    }
    return value;
  }

  /** Guarda la lista de imágenes de un campo (una sola: texto; varias: JSON; vacía: borra el valor). */
  async _saveImages(memberId, field, urls) {
    if (!urls.length) return membersRepository.deleteFieldValues(memberId, [field.id]);
    return membersRepository.upsertFieldValues(memberId, { [field.id]: parseSettings(field).multiple ? JSON.stringify(urls) : urls[0] });
  }

  toDto(member, { groups = [], fieldValues = [], fieldsCatalog = [], linkedUsername = null, memberships = undefined } = {}) {
    // Todos los datos del miembro son campos de su ficha: `fields` = { código: valor }. Los de
    // "archivos" no van acá (se listan aparte, ver listDocuments).
    const valueByField = new Map(fieldValues.map((v) => [v.field_id, v.value]));
    const fields = {};
    for (const field of fieldsCatalog) {
      if (field.field_type === 'file') continue;
      fields[field.code] = this._fieldValueDto(field, valueByField.get(field.id));
    }

    return {
      id: member.id,
      uuid: member.uuid,
      clubId: member.club_id,
      // Atajos de solo lectura a los campos con uso especial (nombre, identificador, contacto,
      // nacimiento, foto) — se editan como cualquier campo, vía `fields`.
      firstName: member.first_name ?? null,
      middleName: member.middle_name ?? null,
      lastName: member.last_name ?? null,
      secondLastName: member.second_last_name ?? null,
      fullName: this._fullName(member),
      shortName: this._shortName(member),
      email: member.email ?? null,
      phone: member.phone ?? null,
      rut: member.rut ?? null,
      birthDate: member.birth_date ?? null,
      // Foto de perfil (avatares, cabecera de la ficha) y foto para cumpleaños (plantillas): separadas.
      avatarUrl: member.avatar_url ? toAbsoluteMediaUrl(member.avatar_url) : null,
      birthdayPhotoUrl: member.birthday_photo_url ? toAbsoluteMediaUrl(member.birthday_photo_url) : null,
      status: member.status,
      // Historial de pertenencia (solo en el detalle): [{ id, startedOn, endedOn }], del más antiguo al más nuevo.
      ...(memberships !== undefined ? { memberships, joinedOn: memberships[0]?.startedOn ?? null } : {}),
      userId: member.user_id,
      linkedUsername,
      groups: groups.map((g) => ({ id: g.id, name: g.name, color: g.color })),
      fields,
      createdAt: member.created_at,
    };
  }

  /** `full: true` = ve todos los miembros del club (VIEW_MEMBERS). Si no, `memberIds` es la
   * whitelist exacta que puede ver/editar/eliminar/vincular (unión de scope de sus roles en
   * este club, ver members.repository.js#findAccessibleMemberIds). */
  async _resolveAccess(authContext, actorId, clubId) {
    if (permissionService.hasFunction(authContext, FUNCTIONS.VIEW_MEMBERS)) return { full: true, memberIds: null };
    const memberIds = await membersRepository.findAccessibleMemberIds(actorId, clubId);
    return { full: false, memberIds };
  }

  _assertAccessible(access, memberId) {
    if (access.full) return;
    if (!access.memberIds.includes(memberId)) throw AppError.notFound('Miembro no encontrado.');
  }

  /** Envoltorio público de `_resolveAccess` — lo usa payments.service.js (que ya importa este
   * servicio) para intersectar el scope de Miembros con el de Pagos al armar vistas agregadas
   * como la matriz de estado por cobro (getChargeMatrix). Este servicio NUNCA importa
   * payments.service.js de vuelta (el import va en un solo sentido) — por eso el cálculo se
   * expone acá como método público en vez de vivir del otro lado. */
  async resolveAccessForController(authContext, actorId, clubId) {
    return this._resolveAccess(authContext, actorId, clubId);
  }

  /** Cambia el estado de un miembro y mantiene coherentes los cobros: al pasar a inactivo
   * (archivado) se congelan sus cobros futuros pendientes y deja de recibir nuevos; al
   * reactivarlo se descongelan. Punto único para hacerlo, usado tanto por la edición manual del
   * miembro como al retirar/reactivar su cuenta de usuario. No hace nada si el estado no cambia. */
  async applyStatus(member, status, actorId, conn, statusDate = null) {
    const today = toDateOnly(new Date());
    const date = statusDate ? toDateOnly(statusDate) : today;
    const periods = await memberMembershipsRepository.findByMember(member.id, conn);
    const open = periods.find((p) => !p.endedOn);
    const last = periods[periods.length - 1];

    if (member.status === status) {
      // Mismo estado + fecha: corrige la fecha del cambio vigente (la fecha de retiro de un
      // inactivo, o desde cuándo volvió un activo reincorporado).
      if (!statusDate) return;
      if (status === 'inactive' && last) {
        if (last.startedOn && date < last.startedOn) throw AppError.badRequest('La fecha de retiro no puede ser anterior a su última incorporación.');
        await memberMembershipsRepository.setEnd(last.id, date, conn);
        await membersRepository.updateById(member.id, { deactivated_at: new Date(`${date}T12:00:00Z`) }, conn);
      } else if (status === 'active' && open && open.startedOn) {
        const prev = periods[periods.length - 2];
        if (prev?.endedOn && date <= prev.endedOn) throw AppError.badRequest('La fecha de reincorporación debe ser posterior a su último retiro.');
        await memberMembershipsRepository.setStart(open.id, date, conn);
      } else {
        return;
      }
      await this.syncCoverage(member.id, actorId, conn);
      return;
    }

    if (status === 'inactive') {
      // Retiro: se cierra el período vigente en la fecha indicada.
      if (open?.startedOn && date < open.startedOn) throw AppError.badRequest('La fecha de retiro no puede ser anterior a su incorporación.');
      if (open) await memberMembershipsRepository.setEnd(open.id, date, conn);
      else await memberMembershipsRepository.setEnd((await memberMembershipsRepository.create(member.id, null, conn)), date, conn);
      await membersRepository.updateById(member.id, { status, deactivated_at: new Date(`${date}T12:00:00Z`) }, conn);
    } else {
      // Reincorporación: nuevo período desde la fecha indicada (posterior al último retiro).
      if (last?.endedOn && date <= last.endedOn) throw AppError.badRequest('La fecha de reincorporación debe ser posterior a su último retiro.');
      await memberMembershipsRepository.create(member.id, date, conn);
      await membersRepository.updateById(member.id, { status, deactivated_at: null }, conn);
    }
    await this.syncCoverage(member.id, actorId, conn);
  }

  /** Fecha de ingreso = inicio de su PRIMER período en el club (`null` = desde siempre). */
  async setJoinedOn(memberId, joinedOn, actorId, conn) {
    const periods = await memberMembershipsRepository.findByMember(memberId, conn);
    const first = periods[0];
    const date = joinedOn ? toDateOnly(joinedOn) : null;
    if (!first) {
      await memberMembershipsRepository.create(memberId, date, conn);
    } else {
      if (date && first.endedOn && date > first.endedOn) throw AppError.badRequest('La fecha de ingreso no puede ser posterior a su primer retiro.');
      if (first.startedOn === date) return;
      await memberMembershipsRepository.setStart(first.id, date, conn);
    }
    await this.syncCoverage(memberId, actorId, conn);
  }

  /**
   * Alinea los períodos YA generados (cobros y asistencias) con el historial de pertenencia: lo
   * pendiente que cae fuera queda "no aplica — Retirado"; lo que se había marcado así y ahora sí le
   * corresponde (ej. se corrigió la fecha o volvió) vuelve a pendiente. Lo pagado o marcado a mano
   * no se toca.
   */
/** Recalcula los "no aplica" y montos prorrateados de TODOS los miembros del club (p. ej. al
   * cambiar la política del mes de ingreso/retiro) y genera los períodos que ahora correspondan. */
  async resyncClubCoverage(clubId, actorId) {
    const ids = await membersRepository.findIdsByClub(clubId);
    for (const id of ids) await this.syncCoverage(id, actorId);
    // eslint-disable-next-line global-require
    await require('./chargeInstances.service').generateDueInstances(clubId);
    return ids.length;
  }

  async syncCoverage(memberId, actorId, conn) {
    const intervals = await memberMembershipsRepository.findByMember(memberId, conn);

    // Agrupa por motivo ("Retirado" / "Antes de su ingreso") para marcarlos en lote.
    const byReason = () => new Map();
    const instances = await chargeInstancesRepository.findCoverageCandidates(memberId, [...COVERAGE_REASONS, LEGACY_INACTIVE_REASON], conn);
    const toMark = byReason();
    const toRestore = [];
    const policy = instances.length ? await clubPolicyService.getMonthPolicy(instances[0].club_id) : null;
    const toReprice = [];
    for (const i of instances) {
      const reason = chargePeriodReason(intervals, i.recurrence, i.period_label, i.due_date, policy);
      // Política proporcional: un mes de ingreso/retiro sin pagos se ajusta al monto que corresponde.
      // (incluye los que vuelven a aplicar: estaban como 'no aplica' y se restauran).
      if (!reason && i.recurrence === 'monthly') toReprice.push(i);
      if (i.status === 'pending' && reason) toMark.set(reason, [...(toMark.get(reason) || []), i.id]);
      else if (i.status === 'exempt' && !reason) toRestore.push(i.id);
      else if (i.status === 'exempt' && reason && reason !== i.exempt_reason) toMark.set(reason, [...(toMark.get(reason) || []), i.id]);
    }
    for (const [reason, ids] of toMark) await chargeInstancesRepository.markRetired(ids, reason, actorId, conn);
    if (toReprice.length) {
      const base = new Map();
      for (const i of toReprice) {
        if (!base.has(i.charge_id)) base.set(i.charge_id, (await chargesRepository.resolveAmounts(i.charge_id, [memberId], i.charge_amount, conn)).get(memberId));
        const amount = proratedAmount(base.get(i.charge_id), intervals, 'monthly', i.period_label, policy);
        if (Number(amount) !== Number(i.amount)) await chargeInstancesRepository.updateAmount(i.id, amount, conn);
      }
    }
    await chargeInstancesRepository.unmarkRetired(toRestore, conn);

    const attendances = await trainingAttendancesRepository.findCoverageCandidates(memberId, COVERAGE_REASONS, conn);
    const attMark = byReason();
    const attRestore = [];
    for (const a of attendances) {
      const reason = dateReason(intervals, a.session_date);
      if (a.status === 'pending' && reason) attMark.set(reason, [...(attMark.get(reason) || []), a.id]);
      else if (a.status === 'exempt' && !reason) attRestore.push(a.id);
      else if (a.status === 'exempt' && reason && reason !== a.exempt_reason) attMark.set(reason, [...(attMark.get(reason) || []), a.id]);
    }
    for (const [reason, ids] of attMark) await trainingAttendancesRepository.markRetired(ids, reason, actorId, conn);
    await trainingAttendancesRepository.unmarkRetired(attRestore, conn);
  }

  async _assertUserLinkable(clubId, targetUserId, excludeMemberId = null) {
    const membership = await usersRepository.findMembership(targetUserId, clubId);
    if (!membership || membership.status !== USER_CLUB_STATUS.ACTIVE) {
      throw AppError.badRequest('El usuario debe ser miembro activo de este club para poder vincularlo.');
    }
    const existing = await membersRepository.findByUserId(targetUserId, clubId);
    if (existing && existing.id !== excludeMemberId) {
      throw AppError.conflict('Este usuario ya está vinculado a otro miembro de este club.');
    }
  }

  /**
   * Valida y normaliza los valores de la ficha (`fields` = { código: valor }) contra los campos
   * del club. Devuelve qué guardar y qué borrar. `requireAll`: exige todos los obligatorios
   * (alta); en una edición solo se exige que un obligatorio que VIENE no quede vacío. Revisa que
   * el identificador no lo tenga otro miembro del club.
   */
  async _prepareFieldValues(clubId, fields, { requireAll, memberId = null, publicOnly = false, allowSensitive = true } = {}) {
    // `publicOnly`: formulario público — solo se aceptan (y exigen) los campos marcados para él.
    const catalog = (await memberFieldsRepository.findByClub(clubId)).filter((f) => !publicOnly || f.in_public_form);
    const byCode = new Map(catalog.map((f) => [f.code, f]));
    const input = fields && typeof fields === 'object' ? fields : {};

    const unknown = Object.keys(input).filter((code) => !byCode.has(code));
    if (unknown.length) throw AppError.badRequest(`Campos inválidos: ${unknown.join(', ')}.`);
    // Sin permiso para datos sensibles: esos campos ni se leen ni se exigen (quedan como estaban).
    const isSensitive = (f) => !!parseSettings(f).sensitive;
    // Visibilidad condicional (ej. "Apoderado" solo para menores): un campo oculto no se exige.
    // Se evalúa con lo enviado + lo que el miembro ya tenía guardado.
    const current = memberId ? Object.fromEntries((await membersRepository.getFieldValues(memberId)).map((v) => [catalog.find((f) => f.id === v.field_id)?.code, v.value])) : {};
    const merged = { ...current, ...input };
    const sectionOf = sectionConditions(catalog);

    const set = {};
    const clear = [];
    const missing = [];
    for (const field of catalog) {
      if (UPLOAD_TYPES.includes(field.field_type) || LAYOUT_TYPES.includes(field.field_type)) continue;
      if (!allowSensitive && isSensitive(field)) continue;
      const visible = isFieldVisible(field, merged, catalog, sectionOf.get(field.id));
      const provided = Object.prototype.hasOwnProperty.call(input, field.code);
      if (!provided) {
        if (requireAll && field.is_required && visible) missing.push(field.label);
        continue;
      }
      const value = normalizeValue(field, input[field.code]);
      const empty = value === null || (field.field_type === 'boolean' && value === 'false' && field.is_required);
      if (empty && field.is_required && visible) missing.push(field.label);
      if (value === null) clear.push(field.id);
      else set[field.id] = value;

      if (field.role === 'identifier' && value !== null) {
        const normalized = String(normalizeIdentifier(field, value)).toUpperCase();
        if (await memberFieldsRepository.identifierExists(clubId, field.id, normalized, memberId)) {
          throw AppError.conflict(`Ya existe un miembro con ese ${field.label} en el club.`);
        }
      }
    }
    if (missing.length) throw AppError.badRequest(`Faltan campos obligatorios: ${missing.join(', ')}.`);
    return { set, clear };
  }

  /** Comprobación del formulario público / autoregistro (mismas reglas, sin guardar). */
  async validateFields(clubId, fields, { publicOnly = false } = {}) {
    return this._prepareFieldValues(clubId, fields, { requireAll: true, publicOnly });
  }

  async _buildDto(member) {
    const [groups, fieldValues, fieldsCatalog, linkedUser, memberships] = await Promise.all([
      membersRepository.getGroupsForMember(member.id),
      membersRepository.getFieldValues(member.id),
      memberFieldsRepository.findByClub(member.club_id),
      member.user_id ? usersRepository.findById(member.user_id) : null,
      memberMembershipsRepository.findByMember(member.id),
    ]);
    return this.toDto(member, { groups, fieldValues, fieldsCatalog, linkedUsername: linkedUser?.username ?? null, memberships });
  }

/**
   * Filtros por campos de la ficha desde la query: `fields` = JSON `{ código: valor | [valores] }`.
   * Además, los ids de campos sensibles que el actor no puede ver (no entran en la búsqueda).
   */
  async _listFilters(clubId, query, authContext) {
    const catalog = await memberFieldsRepository.findByClub(clubId);
    const allowSensitive = canSeeSensitive(authContext);
    const hiddenFieldIds = allowSensitive ? [] : catalog.filter((f) => parseSettings(f).sensitive).map((f) => f.id);
    let raw = {};
    try {
      raw = typeof query.fields === 'string' ? JSON.parse(query.fields) : query.fields && typeof query.fields === 'object' ? query.fields : {};
    } catch {
      raw = {};
    }
    const fieldFilters = [];
    for (const [code, value] of Object.entries(raw || {})) {
      const field = catalog.find((f) => f.code === code);
      if (!field || hiddenFieldIds.includes(field.id) || UPLOAD_TYPES.includes(field.field_type) || LAYOUT_TYPES.includes(field.field_type)) continue;
      const values = (Array.isArray(value) ? value : [value]).map((v) => String(v ?? '').trim()).filter(Boolean).slice(0, 20);
      if (!values.length) continue;
      const type = ['select', 'radio'].includes(field.field_type) ? 'option' : field.field_type === 'multiselect' ? 'multiselect' : field.field_type === 'boolean' ? 'boolean' : field.field_type === 'rut' ? 'option' : 'text';
      fieldFilters.push({ fieldId: field.id, type, values: field.field_type === 'rut' ? values.map((v) => v.replace(/\./g, '').toUpperCase()) : values });
    }
    return { fieldFilters, hiddenFieldIds };
  }

  // ---------------------------------------------------------------- columnas del listado
  /** Campos que muestra el listado de miembros (tarjetas y tabla), elegidos por el club. */
  async getListSettings(clubId) {
    const catalog = await memberFieldsRepository.findByClub(clubId);
    const settings = await settingsRepository.findAllByClub(clubId);
    let columns = null;
    try {
      columns = JSON.parse(settings[LIST_COLUMNS_KEY] || 'null');
    } catch {
      columns = null;
    }
    const valid = (code) => catalog.some((f) => f.code === code && !LAYOUT_TYPES.includes(f.field_type) && f.field_type !== 'file');
    if (!Array.isArray(columns)) {
      // Por defecto: lo de siempre (identificador, correo, teléfono, nacimiento).
      columns = ['identifier', 'email', 'phone', 'birth_date'].map((role) => catalog.find((f) => f.role === role)?.code).filter(Boolean);
    }
    return { columns: columns.filter(valid) };
  }

  async updateListSettings(clubId, { columns }, actorId) {
    const catalog = await memberFieldsRepository.findByClub(clubId);
    const clean = [...new Set((columns || []).map(String))].filter((code) => catalog.some((f) => f.code === code && !LAYOUT_TYPES.includes(f.field_type) && f.field_type !== 'file')).slice(0, 12);
    await settingsRepository.upsertMany(clubId, { [LIST_COLUMNS_KEY]: JSON.stringify(clean) });
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_LIST_COLUMNS_UPDATED', entityType: 'club', entityId: clubId, changes: { columns: clean } });
    return this.getListSettings(clubId);
  }

  async listForClub(clubId, query, authContext, actorId) {
    const { limit, offset, sortBy, sortOrder, page } = parsePagination(query, SORTABLE);
    const access = await this._resolveAccess(authContext, actorId, clubId);

    const { rows, total } = await membersRepository.paginateByClub(clubId, {
      limit,
      offset,
      sortBy,
      sortOrder,
      search: query.search,
      status: query.status,
      groupId: query.groupId ? Number(query.groupId) : null,
      linked: query.linked,
      memberIds: access.full ? null : access.memberIds,
      ...(await this._listFilters(clubId, query, authContext)),
    });

    const ids = rows.map((r) => r.id);
    const [groupsByMember, fieldValuesByMember, fieldsCatalog] = await Promise.all([
      membersRepository.getGroupsForMembers(ids),
      membersRepository.getFieldValuesForMembers(ids),
      memberFieldsRepository.findByClub(clubId),
    ]);

    const items = rows.map((row) =>
      this.toDto(row, {
        groups: groupsByMember[row.id] || [],
        fieldValues: fieldValuesByMember[row.id] || [],
        fieldsCatalog,
      })
    );
    return { items, meta: buildMeta({ page, limit, total }) };
  }

  async getById(clubId, memberId, authContext, actorId) {
    const member = await membersRepository.findActiveById(memberId);
    if (!member || member.club_id !== clubId) throw AppError.notFound('Miembro no encontrado.');
    const access = await this._resolveAccess(authContext, actorId, clubId);
    this._assertAccessible(access, memberId);
    return this._buildDto(member);
  }

  async findOptions(clubId) {
    const rows = await membersRepository.findOptions(clubId);
    return rows.map((r) => ({
      id: r.id,
      fullName: this._fullName(r),
      groupIds: r.group_ids ? r.group_ids.split(',').map(Number) : [],
    }));
  }

  /** `publicOnly`: alta desde una solicitud del formulario público — solo se exigen los
   * obligatorios que la persona veía (el resto se completa después en la ficha). */
  async create(clubId, data, actorId, { publicOnly = false, allowSensitive = true } = {}) {
    if (data.joinedOn && toDateOnly(data.joinedOn) > toDateOnly(new Date(Date.now() + 366 * 86400000))) {
      throw AppError.badRequest('La fecha de ingreso no es válida.');
    }
    if (data.userId) await this._assertUserLinkable(clubId, data.userId);

    let groupIds = [];
    if (data.groupIds?.length) {
      const found = await memberGroupsRepository.findByIds(data.groupIds, clubId);
      if (found.length !== data.groupIds.length) throw AppError.badRequest('Uno o más grupos no pertenecen a este club.');
      groupIds = data.groupIds;
    }

    // Se valida siempre (no solo "si vino fields"): un obligatorio omitido también se rechaza.
    const values = await this._prepareFieldValues(clubId, data.fields || {}, { requireAll: true, publicOnly, allowSensitive });

    const memberId = await withTransaction(async (conn) => {
      const id = await membersRepository.createMember(
        {
          clubId,
          userId: data.userId || null,
          status: data.status || 'active',
          createdBy: actorId,
        },
        conn
      );
      if (groupIds.length) await membersRepository.setGroups(id, groupIds, conn);
      if (Object.keys(values.set).length) await membersRepository.upsertFieldValues(id, values.set, conn);
      // Historial de pertenencia: activo desde su fecha de ingreso (sin fecha = desde siempre).
      // Lo anterior al ingreso le sale "no aplica" en cobros y asistencia (ver helpers/membership.js).
      const joinedOn = data.joinedOn ? toDateOnly(data.joinedOn) : null;
      const membershipId = await memberMembershipsRepository.create(id, joinedOn, conn);
      if ((data.status || 'active') === 'inactive') {
        const today = toDateOnly(new Date());
        await memberMembershipsRepository.setEnd(membershipId, joinedOn && joinedOn > today ? joinedOn : today, conn);
      }
      await this.syncCoverage(id, actorId, conn);
      return id;
    });
    await regeneratePeriods(clubId);

    const created = await membersRepository.findActiveById(memberId);
    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'MEMBER_CREATED',
      entityType: 'member',
      entityId: memberId,
      changes: { fullName: this._fullName(created) },
    });

    return this._buildDto(created);
  }

  /** Autoservicio (POST /members/me) — única forma de crear un member SIN requireFunction (ver
   * middlewares/permission.middleware.js#assertProfileNotPending y api/CLAUDE.md). Solo
   * utilizable por alguien cuya membresía quedó marcada `requires_profile_completion` al unirse
   * con una invitación configurada así (`clubs.service.js#joinByCode`) — cualquier otro usuario
   * activo normal no tiene nada que "completar" acá. */
  async createSelf(clubId, userId, data, files = []) {
    const membership = await usersRepository.findMembership(userId, clubId);
    if (!membership?.requires_profile_completion) {
      discard(files);
      throw AppError.conflict('No tienes una ficha pendiente por completar.');
    }

    // Reintentable: si un envío anterior ya creó el member pero se cortó antes de limpiar el
    // flag (o el cliente reintenta tras un corte de red), no se debe fallar con "ya vinculado" —
    // se reusa lo que ya exista y solo se limpia el flag.
    let member = await membersRepository.findByUserId(userId, clubId);
    if (!member) {
      // Whitelist explícita (no un simple `...data`): `status`/`groupIds` son
      // administrativos — `validations/members.validation.js#createMemberSelf` ya no los
      // define, pero acá es la fuente de verdad real (mismo criterio que
      // invitations.service.js#create con `defaultRoleId`: nunca confiar en que el body no
      // los traiga solo porque el frontend no los muestra).
      const safeData = {
        fields: data.fields,
        userId,
        // Entra al club hoy (al completar su ficha desde una invitación).
        joinedOn: toDateOnly(new Date()),
      };
      // Imágenes y archivos: mismas reglas que el resto (obligatorios incluidos).
      const uploads = collectUploads(await memberFieldsRepository.findByClub(clubId), files, { requireAll: true });
      try {
        await this.create(clubId, safeData, userId);
      } catch (error) {
        discard(files);
        throw error;
      }
      member = await membersRepository.findByUserId(userId, clubId);
      await this.attachUploads(clubId, member.id, uploads, userId);
      // Se relee: la respuesta debe traer ya la foto de perfil / cumpleaños recién adjuntada.
      member = await membersRepository.findByUserId(userId, clubId);
    } else {
      discard(files);
    }

    await usersRepository.setRequiresProfileCompletion(userId, clubId, false);
    return this._buildDto(member);
  }

  async update(clubId, memberId, data, actorId, authContext) {
    const member = await membersRepository.findActiveById(memberId);
    if (!member || member.club_id !== clubId) throw AppError.notFound('Miembro no encontrado.');
    const access = await this._resolveAccess(authContext, actorId, clubId);
    this._assertAccessible(access, memberId);
    // El estado no se guarda directo: pasa por applyStatus (historial de pertenencia y cobros).

    let groupIds = null;
    if (data.groupIds !== undefined) {
      if (data.groupIds.length) {
        const found = await memberGroupsRepository.findByIds(data.groupIds, clubId);
        if (found.length !== data.groupIds.length) throw AppError.badRequest('Uno o más grupos no pertenecen a este club.');
      }
      groupIds = data.groupIds;
    }

    // Sin permiso para datos sensibles, esos campos no se tocan aunque vengan en el body.
    const allowSensitive = canSeeSensitive(authContext);
    const values = data.fields !== undefined ? await this._prepareFieldValues(clubId, data.fields, { requireAll: false, memberId, allowSensitive }) : null;

    await withTransaction(async (conn) => {
      if (data.status !== undefined || data.statusDate) await this.applyStatus(member, data.status ?? member.status, actorId, conn, data.statusDate || null);
      if (data.joinedOn !== undefined) await this.setJoinedOn(memberId, data.joinedOn, actorId, conn);
      if (groupIds !== null) await membersRepository.setGroups(memberId, groupIds, conn);
      if (values) {
        if (Object.keys(values.set).length) await membersRepository.upsertFieldValues(memberId, values.set, conn);
        await membersRepository.deleteFieldValues(memberId, values.clear, conn);
      }
    });

    if (groupIds !== null || data.status !== undefined || data.statusDate || data.joinedOn !== undefined) await regeneratePeriods(clubId);

    const updated = await membersRepository.findActiveById(memberId);
    const changes = buildDiff({
      fullName: diffValue(this._fullName(member), this._fullName(updated)),
      status: data.status !== undefined ? diffValue(member.status, data.status) : undefined,
      fields: values ? diffValue(null, `${Object.keys(values.set).length + values.clear.length} campo(s)`) : undefined,
    });
    if (changes) {
      await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_UPDATED', entityType: 'member', entityId: memberId, changes });
    }

    return this._buildDto(updated);
  }

  async remove(clubId, memberId, actorId, authContext) {
    const member = await membersRepository.findActiveById(memberId);
    if (!member || member.club_id !== clubId) throw AppError.notFound('Miembro no encontrado.');
    const access = await this._resolveAccess(authContext, actorId, clubId);
    this._assertAccessible(access, memberId);

    await membersRepository.softDelete(memberId);
    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'MEMBER_DELETED',
      entityType: 'member',
      entityId: memberId,
      changes: { fullName: this._fullName(member) },
    });
  }

  /** Miembro accesible para el actor, o 404 — base común de foto/documentos. */
  async _getAccessibleMember(clubId, memberId, actorId, authContext) {
    const member = await membersRepository.findActiveById(memberId);
    if (!member || member.club_id !== clubId) throw AppError.notFound('Miembro no encontrado.');
    const access = await this._resolveAccess(authContext, actorId, clubId);
    this._assertAccessible(access, memberId);
    return member;
  }

  /**
   * Pasa a la ficha las imágenes/archivos recibidos con un formulario (inscripción pública o
   * autoregistro): `uploads` = `[{ field, files: [{ file_path, name, mime_type, size_bytes }] }]`
   * con rutas privadas temporales. Imagen → carpeta pública + valor del campo; archivos →
   * documentos privados de la ficha.
   */
  async attachUploads(clubId, memberId, uploads, actorId) {
    for (const { field, files } of uploads || []) {
      if (field.field_type === 'image') {
        const max = maxFilesOf(field);
        const urls = files
          .slice(0, max)
          .map((f) => moveToPublic(f.file_path, 'member-photos'))
          .filter(Boolean);
        for (const extra of files.slice(max)) deletePrivateFile(extra.file_path);
        if (urls.length) await this._saveImages(memberId, field, urls);
        continue;
      }
      for (const file of files) {
        const filePath = moveToPrivate(file.file_path, 'member-documents');
        if (!filePath) continue;
        await membersRepository.createDocument({
          clubId,
          memberId,
          fieldId: field.id,
          name: file.name,
          filePath,
          mimeType: file.mime_type,
          sizeBytes: file.size_bytes,
          uploadedBy: actorId,
        });
      }
    }
  }

  /** Campo del club de un tipo dado (imagen/archivos), o 404. */
  async _uploadField(clubId, fieldId, type) {
    const field = await memberFieldsRepository.findById(fieldId);
    if (!field || field.club_id !== clubId || field.field_type !== type) throw AppError.notFound('Campo no encontrado.');
    return field;
  }

  /** Sube la imagen de un campo de tipo "imagen" (ej. la foto). Reemplaza la anterior. */
  async setImage(clubId, memberId, fieldId, file, actorId, authContext) {
    await this._getAccessibleMember(clubId, memberId, actorId, authContext);
    const field = await this._uploadField(clubId, fieldId, 'image');
    if (!file) throw AppError.badRequest('Debes adjuntar una imagen.');
    const current = imageList((await membersRepository.getFieldValues(memberId)).find((v) => v.field_id === field.id)?.value);
    const url = `/uploads/member-photos/${file.filename}`;
    if (parseSettings(field).multiple) {
      // Varias: se agrega a la lista (hasta el máximo).
      if (current.length >= maxFilesOf(field)) {
        deleteUploadedFile(url);
        throw AppError.badRequest(`${field.label}: máximo ${maxFilesOf(field)} imágenes.`);
      }
      await this._saveImages(memberId, field, [...current, url]);
    } else {
      // Una sola: reemplaza a la anterior.
      await this._saveImages(memberId, field, [url]);
      for (const old of current) deleteUploadedFile(old);
    }
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_UPDATED', entityType: 'member', entityId: memberId, changes: { [field.label]: { from: null, to: 'actualizada' } } });
    return { url: toAbsoluteMediaUrl(url) };
  }

  /** Quita una imagen del campo (`url`: cuál, si admite varias) o todas. */
  async removeImage(clubId, memberId, fieldId, actorId, authContext, url = null) {
    await this._getAccessibleMember(clubId, memberId, actorId, authContext);
    const field = await this._uploadField(clubId, fieldId, 'image');
    const current = imageList((await membersRepository.getFieldValues(memberId)).find((v) => v.field_id === field.id)?.value);
    const relative = url ? String(url).replace(/^https?:\/\/[^/]+/, '') : null;
    const removed = relative ? current.filter((u) => u === relative) : current;
    await this._saveImages(memberId, field, current.filter((u) => !removed.includes(u)));
    for (const old of removed) deleteUploadedFile(old);
  }

  _documentDto(d) {
    return {
      id: d.id,
      uuid: d.uuid,
      memberId: d.member_id,
      fieldId: d.field_id ?? null,
      name: d.name,
      mimeType: d.mime_type,
      sizeBytes: d.size_bytes,
      uploadedBy: d.uploaded_by,
      uploadedByUsername: d.uploaded_by_username ?? null,
      createdAt: d.created_at,
    };
  }

  async listDocuments(clubId, memberId, actorId, authContext) {
    await this._getAccessibleMember(clubId, memberId, actorId, authContext);
    const rows = await membersRepository.findDocuments(memberId);
    return rows.map((d) => this._documentDto(d));
  }

  /** Adjunta un archivo a un campo de tipo "archivos" de la ficha. */
  async addDocument(clubId, memberId, fieldId, file, name, actorId, authContext) {
    await this._getAccessibleMember(clubId, memberId, actorId, authContext);
    let field;
    try {
      field = await this._uploadField(clubId, Number(fieldId), 'file');
      if (!file) throw AppError.badRequest('Debes adjuntar un archivo.');
      assertDocuments(field, [file]);
    } catch (error) {
      if (file) deletePrivateFile(`member-documents/${file.filename}`);
      throw error;
    }
    // Campo de un solo documento: el nuevo reemplaza al anterior.
    if (!parseSettings(field).multiple) {
      for (const old of (await membersRepository.findDocuments(memberId)).filter((d) => d.field_id === field.id)) {
        await membersRepository.deleteDocument(old.id);
        deletePrivateFile(old.file_path);
      }
    }
    const id = await membersRepository.createDocument({
      clubId,
      memberId,
      fieldId: field.id,
      name: (name || file.originalname || 'Documento').slice(0, 160),
      filePath: `member-documents/${file.filename}`,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedBy: actorId,
    });
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_UPDATED', entityType: 'member', entityId: memberId, changes: { document: { from: null, to: name || file.originalname } } });
    return this._documentDto(await membersRepository.findDocument(id));
  }

  async removeDocument(clubId, memberId, documentId, actorId, authContext) {
    await this._getAccessibleMember(clubId, memberId, actorId, authContext);
    const doc = await membersRepository.findDocument(documentId);
    if (!doc || doc.member_id !== memberId) throw AppError.notFound('Documento no encontrado.');
    await membersRepository.deleteDocument(documentId);
    deletePrivateFile(doc.file_path);
  }

  /** Datos para entregar el archivo (ruta absoluta + nombre) tras revalidar el acceso al miembro. */
  async getDocumentFile(clubId, memberId, documentId, actorId, authContext) {
    await this._getAccessibleMember(clubId, memberId, actorId, authContext);
    const doc = await membersRepository.findDocument(documentId);
    if (!doc || doc.member_id !== memberId) throw AppError.notFound('Documento no encontrado.');
    const absolutePath = resolvePrivatePath(doc.file_path);
    if (!absolutePath) throw AppError.notFound('Documento no encontrado.');
    return { absolutePath, name: doc.name, mimeType: doc.mime_type };
  }

  async linkUser(clubId, memberId, targetUserId, actorId, authContext) {
    const member = await membersRepository.findActiveById(memberId);
    if (!member || member.club_id !== clubId) throw AppError.notFound('Miembro no encontrado.');
    const access = await this._resolveAccess(authContext, actorId, clubId);
    this._assertAccessible(access, memberId);

    if (targetUserId) {
      await this._assertUserLinkable(clubId, targetUserId, memberId);
    }

    await membersRepository.updateById(memberId, { user_id: targetUserId || null });
    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: targetUserId ? 'MEMBER_USER_LINKED' : 'MEMBER_USER_UNLINKED',
      entityType: 'member',
      entityId: memberId,
      changes: diffValue(member.user_id, targetUserId || null) ? { userId: diffValue(member.user_id, targetUserId || null) } : null,
    });

    return this._buildDto(await membersRepository.findActiveById(memberId));
  }

  /** Próximos cumpleaños (miembros activos) dentro de `days` días, respetando el scope del actor.
   * `search`/`groupId` son los mismos filtros que el listado general de miembros. */
  async listUpcomingBirthdays(clubId, days, authContext, actorId, { search, groupId } = {}) {
    const access = await this._resolveAccess(authContext, actorId, clubId);
    const rows = await membersRepository.findUpcomingBirthdays(clubId, days, access.full ? null : access.memberIds, { search, groupId });
    const groupsByMember = await membersRepository.getGroupsForMembers(rows.map((m) => m.id));
    return rows.map((m) => ({
      id: m.id,
      fullName: this._fullName(m),
      shortName: this._shortName(m),
      birthDate: m.birth_date,
      daysUntil: Number(m.days_until),
      email: m.email,
      avatarUrl: m.avatar_url ? toAbsoluteMediaUrl(m.avatar_url) : null,
      birthdayPhotoUrl: m.birthday_photo_url ? toAbsoluteMediaUrl(m.birthday_photo_url) : null,
      groups: (groupsByMember[m.id] || []).map((g) => ({ id: g.id, name: g.name, color: g.color })),
    }));
  }

  async getDashboard(clubId, authContext, actorId) {
    const access = await this._resolveAccess(authContext, actorId, clubId);

    const [total, active, inactive, groups] = await Promise.all([
      access.full ? membersRepository.countByClub(clubId) : Promise.resolve(access.memberIds.length),
      access.full ? membersRepository.countByClubAndStatus(clubId, 'active') : Promise.resolve(null),
      access.full ? membersRepository.countByClubAndStatus(clubId, 'inactive') : Promise.resolve(null),
      memberGroupsRepository.findByClub(clubId),
    ]);

    let recentActivity = [];
    if (access.full) {
      recentActivity = await auditRepository.recentActivityByEntityTypes(clubId, ['member', 'member_group'], 10);
    } else if (access.memberIds.length) {
      // Sin acceso completo: se excluye 'member_group' de la query (no se sabe si el actor
      // tiene VIEW_MEMBER_GROUPS) y además se filtra en memoria a solo los miembros que
      // puede ver — la query ya trae más de las 10 que se van a mostrar (30) para no
      // quedarse corto una vez aplicado ese segundo filtro.
      const rows = await auditRepository.recentActivityByEntityTypes(clubId, ['member'], 30);
      recentActivity = rows.filter((row) => access.memberIds.includes(Number(row.entity_id))).slice(0, 10);
    }

    return {
      membersCount: total,
      activeCount: active,
      inactiveCount: inactive,
      groupsCount: groups.length,
      recentActivity,
    };
  }
}

module.exports = new MembersService();
