const membersRepository = require('../repositories/members.repository');
const memberFieldsRepository = require('../repositories/memberFields.repository');
const memberGroupsRepository = require('../repositories/memberGroups.repository');
const usersRepository = require('../repositories/users.repository');
const auditRepository = require('../repositories/audit.repository');
const permissionService = require('./permission.service');
const AppError = require('../helpers/AppError');
const { withTransaction } = require('../config/database');
const { parsePagination, buildMeta } = require('../helpers/pagination');
const { diffValue, buildDiff } = require('../helpers/auditDiff');
const { FUNCTIONS, USER_CLUB_STATUS } = require('../config/constants');

const SORTABLE = ['created_at', 'first_name', 'last_name', 'status'];

class MembersService {
  _fullName(m) {
    return [m.first_name, m.middle_name, m.last_name, m.second_last_name].filter(Boolean).join(' ');
  }

  toDto(member, { groups = [], fieldValues = [], fieldsCatalog = [], linkedUsername = null } = {}) {
    const valueByField = new Map(fieldValues.map((v) => [v.field_id, v.value]));
    const customFields = {};
    for (const field of fieldsCatalog) {
      customFields[field.code] = valueByField.has(field.id) ? valueByField.get(field.id) : null;
    }

    return {
      id: member.id,
      uuid: member.uuid,
      clubId: member.club_id,
      firstName: member.first_name,
      middleName: member.middle_name,
      lastName: member.last_name,
      secondLastName: member.second_last_name,
      fullName: this._fullName(member),
      email: member.email,
      phone: member.phone,
      rut: member.rut,
      birthDate: member.birth_date,
      status: member.status,
      userId: member.user_id,
      linkedUsername,
      groups: groups.map((g) => ({ id: g.id, name: g.name, color: g.color })),
      customFields,
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

  /** Valida `customFields` ({code: value}) contra el catálogo del club; con `requireRequired`
   * también exige que todo campo `is_required` venga con un valor no vacío (solo al crear —
   * en una edición parcial no se puede saber el estado final sin releer los ya guardados). */
  async _validateCustomFields(clubId, customFields, { requireRequired }) {
    const catalog = await memberFieldsRepository.findByClub(clubId);
    const byCode = new Map(catalog.map((f) => [f.code, f]));

    const invalidCodes = Object.keys(customFields).filter((code) => !byCode.has(code));
    if (invalidCodes.length) throw AppError.badRequest(`Campos personalizados inválidos: ${invalidCodes.join(', ')}`);

    if (requireRequired) {
      const missing = catalog.filter((f) => f.is_required && !String(customFields[f.code] ?? '').trim());
      if (missing.length) throw AppError.badRequest(`Faltan campos obligatorios: ${missing.map((f) => f.label).join(', ')}.`);
    }

    const entries = {};
    for (const [code, value] of Object.entries(customFields)) {
      const field = byCode.get(code);
      if (field.field_type === 'select' && value !== null && value !== '') {
        const options = Array.isArray(field.options) ? field.options : field.options ? JSON.parse(field.options) : [];
        if (!options.includes(value)) throw AppError.badRequest(`Valor inválido para "${field.label}".`);
      }
      entries[field.id] = value === undefined || value === '' ? null : String(value);
    }
    return entries;
  }

  async _buildDto(member) {
    const [groups, fieldValues, fieldsCatalog, linkedUser] = await Promise.all([
      membersRepository.getGroupsForMember(member.id),
      membersRepository.getFieldValues(member.id),
      memberFieldsRepository.findByClub(member.club_id),
      member.user_id ? usersRepository.findById(member.user_id) : null,
    ]);
    return this.toDto(member, { groups, fieldValues, fieldsCatalog, linkedUsername: linkedUser?.username ?? null });
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
    return rows.map((r) => ({ id: r.id, fullName: this._fullName(r) }));
  }

  async create(clubId, data, actorId) {
    if (data.rut && (await membersRepository.rutExists(data.rut, clubId))) {
      throw AppError.conflict('Ya existe un miembro con este RUT en el club.');
    }
    if (data.userId) await this._assertUserLinkable(clubId, data.userId);

    let groupIds = [];
    if (data.groupIds?.length) {
      const found = await memberGroupsRepository.findByIds(data.groupIds, clubId);
      if (found.length !== data.groupIds.length) throw AppError.badRequest('Uno o más grupos no pertenecen a este club.');
      groupIds = data.groupIds;
    }

    // Se valida siempre (no solo "si vino customFields"): si el club tiene campos
    // obligatorios y el payload los omite directamente, igual debe rechazarse — no solo
    // cuando vienen explícitamente vacíos.
    const fieldEntries = await this._validateCustomFields(clubId, data.customFields || {}, { requireRequired: true });

    const memberId = await withTransaction(async (conn) => {
      const id = await membersRepository.createMember(
        {
          clubId,
          firstName: data.firstName,
          middleName: data.middleName || null,
          lastName: data.lastName,
          secondLastName: data.secondLastName || null,
          email: data.email || null,
          phone: data.phone || null,
          rut: data.rut || null,
          birthDate: data.birthDate || null,
          userId: data.userId || null,
          status: data.status || 'active',
          createdBy: actorId,
        },
        conn
      );
      if (groupIds.length) await membersRepository.setGroups(id, groupIds, conn);
      if (Object.keys(fieldEntries).length) await membersRepository.upsertFieldValues(id, fieldEntries, conn);
      return id;
    });

    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'MEMBER_CREATED',
      entityType: 'member',
      entityId: memberId,
      changes: { fullName: this._fullName({ first_name: data.firstName, middle_name: data.middleName, last_name: data.lastName, second_last_name: data.secondLastName }) },
    });

    return this._buildDto(await membersRepository.findActiveById(memberId));
  }

  async update(clubId, memberId, data, actorId, authContext) {
    const member = await membersRepository.findActiveById(memberId);
    if (!member || member.club_id !== clubId) throw AppError.notFound('Miembro no encontrado.');
    const access = await this._resolveAccess(authContext, actorId, clubId);
    this._assertAccessible(access, memberId);

    if (data.rut !== undefined && data.rut && (await membersRepository.rutExists(data.rut, clubId, memberId))) {
      throw AppError.conflict('Ya existe un miembro con este RUT en el club.');
    }

    const updates = {};
    if (data.firstName !== undefined) updates.first_name = data.firstName;
    if (data.middleName !== undefined) updates.middle_name = data.middleName || null;
    if (data.lastName !== undefined) updates.last_name = data.lastName;
    if (data.secondLastName !== undefined) updates.second_last_name = data.secondLastName || null;
    if (data.email !== undefined) updates.email = data.email || null;
    if (data.phone !== undefined) updates.phone = data.phone || null;
    if (data.rut !== undefined) updates.rut = data.rut || null;
    if (data.birthDate !== undefined) updates.birth_date = data.birthDate || null;
    if (data.status !== undefined) updates.status = data.status;

    let groupIds = null;
    if (data.groupIds !== undefined) {
      if (data.groupIds.length) {
        const found = await memberGroupsRepository.findByIds(data.groupIds, clubId);
        if (found.length !== data.groupIds.length) throw AppError.badRequest('Uno o más grupos no pertenecen a este club.');
      }
      groupIds = data.groupIds;
    }

    const fieldEntries =
      data.customFields !== undefined ? await this._validateCustomFields(clubId, data.customFields, { requireRequired: false }) : null;

    await withTransaction(async (conn) => {
      if (Object.keys(updates).length) await membersRepository.updateById(memberId, updates, conn);
      if (groupIds !== null) await membersRepository.setGroups(memberId, groupIds, conn);
      if (fieldEntries && Object.keys(fieldEntries).length) await membersRepository.upsertFieldValues(memberId, fieldEntries, conn);
    });

    const changes = buildDiff({
      firstName: updates.first_name !== undefined ? diffValue(member.first_name, updates.first_name) : undefined,
      lastName: updates.last_name !== undefined ? diffValue(member.last_name, updates.last_name) : undefined,
      email: updates.email !== undefined ? diffValue(member.email, updates.email) : undefined,
      status: updates.status !== undefined ? diffValue(member.status, updates.status) : undefined,
    });
    if (changes) {
      await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_UPDATED', entityType: 'member', entityId: memberId, changes });
    }

    return this._buildDto(await membersRepository.findActiveById(memberId));
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
