const memberGroupsRepository = require('../repositories/memberGroups.repository');
const membersRepository = require('../repositories/members.repository');
const auditRepository = require('../repositories/audit.repository');
const AppError = require('../helpers/AppError');
const todayISO = () => new Date().toISOString().slice(0, 10);
const { toAbsoluteMediaUrl } = require('../helpers/mediaUrl');
const { parsePagination, buildMeta } = require('../helpers/pagination');
const { diffValue, buildDiff } = require('../helpers/auditDiff');

class MemberGroupsService {
  toDto(group) {
    return {
      id: group.id,
      uuid: group.uuid,
      clubId: group.club_id,
      name: group.name,
      description: group.description,
      color: group.color,
      membersCount: Number(group.members_count ?? 0),
      createdAt: group.created_at,
    };
  }

  async listForClub(clubId) {
    const rows = await memberGroupsRepository.findByClub(clubId);
    return rows.map((r) => this.toDto(r));
  }

  async findOptions(clubId) {
    return memberGroupsRepository.findOptions(clubId);
  }

  async getById(clubId, groupId) {
    const group = await memberGroupsRepository.findByIdInClub(groupId, clubId);
    if (!group) throw AppError.notFound('Grupo no encontrado.');
    const membersCount = await memberGroupsRepository.countMembers(groupId);
    return this.toDto({ ...group, members_count: membersCount });
  }

  async create(clubId, { name, description, color }, actorId) {
    if (await memberGroupsRepository.findByNameInClub(name, clubId)) {
      throw AppError.conflict('Ya existe un grupo con este nombre en el club.');
    }
    const id = await memberGroupsRepository.createGroup({ clubId, name, description: description || null, color: color || '#6366F1' });
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_GROUP_CREATED', entityType: 'member_group', entityId: id, changes: { name } });
    return this.getById(clubId, id);
  }

  async update(clubId, groupId, { name, description, color }, actorId) {
    const group = await memberGroupsRepository.findByIdInClub(groupId, clubId);
    if (!group) throw AppError.notFound('Grupo no encontrado.');

    if (name && name !== group.name) {
      const existing = await memberGroupsRepository.findByNameInClub(name, clubId, groupId);
      if (existing) throw AppError.conflict('Ya existe un grupo con este nombre en el club.');
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description || null;
    if (color !== undefined) updates.color = color;
    if (Object.keys(updates).length) await memberGroupsRepository.updateById(groupId, updates);

    const changes = buildDiff({
      name: updates.name !== undefined ? diffValue(group.name, updates.name) : undefined,
      description: updates.description !== undefined ? diffValue(group.description, updates.description) : undefined,
      color: updates.color !== undefined ? diffValue(group.color, updates.color) : undefined,
    });
    if (changes) {
      await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_GROUP_UPDATED', entityType: 'member_group', entityId: groupId, changes });
    }

    return this.getById(clubId, groupId);
  }

  async remove(clubId, groupId, actorId) {
    const group = await memberGroupsRepository.findByIdInClub(groupId, clubId);
    if (!group) throw AppError.notFound('Grupo no encontrado.');
    await memberGroupsRepository.deleteById(groupId);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_GROUP_DELETED', entityType: 'member_group', entityId: groupId, changes: { name: group.name } });
  }

  async listMembers(clubId, groupId, query) {
    const group = await memberGroupsRepository.findByIdInClub(groupId, clubId);
    if (!group) throw AppError.notFound('Grupo no encontrado.');
    const { limit, offset, page } = parsePagination(query, ['first_name']);
    const { rows, total } = await memberGroupsRepository.paginateMembers(groupId, { limit, offset });

    const ids = rows.map((r) => r.id);
    const groupsByMember = await membersRepository.getGroupsForMembers(ids);
    const items = rows.map((row) => ({
      id: row.id,
      fullName: [row.first_name, row.middle_name, row.last_name, row.second_last_name].filter(Boolean).join(' '),
      email: row.email,
      avatarUrl: row.avatar_url ? toAbsoluteMediaUrl(row.avatar_url) : null,
      status: row.status,
      groups: (groupsByMember[row.id] || []).map((g) => ({ id: g.id, name: g.name, color: g.color })),
    }));
    return { items, meta: buildMeta({ page, limit, total }) };
  }

  /** `since` ('YYYY-MM-DD'): desde cuándo están en el grupo (se les cobra desde ese mes). */
  async addMembers(clubId, groupId, memberIds, actorId, since = null) {
    const group = await memberGroupsRepository.findByIdInClub(groupId, clubId);
    if (!group) throw AppError.notFound('Grupo no encontrado.');
    const found = await membersRepository.findByIds(memberIds, clubId);
    if (found.length !== memberIds.length) throw AppError.badRequest('Uno o más miembros no pertenecen a este club.');

    await memberGroupsRepository.addMembers(groupId, memberIds, undefined, since);
    // Los agregados reciben ya los períodos de los cobros/entrenamientos de ese grupo (desde
    // `since`) y sus pendientes sin movimientos toman el precio nuevo (ej. entró a Directiva).
    await require('../helpers/regeneratePeriods').regeneratePeriods(clubId); // eslint-disable-line global-require
    for (const memberId of memberIds) await this._syncCharges(clubId, memberId, { since: since || todayISO() }); // eslint-disable-line no-await-in-loop
    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'MEMBER_GROUP_MEMBERS_ADDED',
      entityType: 'member_group',
      entityId: groupId,
      changes: { added: memberIds },
    });
  }

  /** Deja a UN miembro exactamente en los grupos indicados (ficha del miembro, pestaña Grupos):
   * agrega los que faltan y quita los que sobran, y regenera los períodos una sola vez. */
  /** `since`: desde cuándo está en los grupos que se agregan; `until`: hasta cuándo estuvo en los que se quitan. */
  /** Ajusta sus cobros al cambio de grupos (ver chargeInstances.service.js#syncMemberAfterGroupChange). */
  async _syncCharges(clubId, memberId, dates) {
    // eslint-disable-next-line global-require
    return require('./chargeInstances.service').syncMemberAfterGroupChange(clubId, memberId, dates);
  }

  async setMemberGroups(clubId, memberId, groupIds, actorId, { since = null, until = null } = {}) {
    const ids = [...new Set(groupIds.map(Number))];
    const valid = await memberGroupsRepository.findByIds(ids, clubId);
    if (valid.length !== ids.length) throw AppError.badRequest('Uno o más grupos no pertenecen a este club.');

    const current = ((await membersRepository.getGroupsForMembers([memberId]))[memberId] || []).map((g) => g.id);
    const toAdd = ids.filter((id) => !current.includes(id));
    const toRemove = current.filter((id) => !ids.includes(id));
    for (const groupId of toAdd) {
      await memberGroupsRepository.addMembers(groupId, [memberId], undefined, since); // eslint-disable-line no-await-in-loop
      // eslint-disable-next-line no-await-in-loop
      await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_GROUP_MEMBERS_ADDED', entityType: 'member_group', entityId: groupId, changes: { added: [memberId] } });
    }
    for (const groupId of toRemove) {
      await memberGroupsRepository.removeMember(groupId, memberId); // eslint-disable-line no-await-in-loop
      // eslint-disable-next-line no-await-in-loop
      await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_GROUP_MEMBER_REMOVED', entityType: 'member_group', entityId: groupId, changes: { removed: memberId } });
    }
    // Los agregados reciben ya los períodos de los cobros/entrenamientos de esos grupos.
    if (toAdd.length) await require('../helpers/regeneratePeriods').regeneratePeriods(clubId); // eslint-disable-line global-require
    let charges = null;
    if (toAdd.length || toRemove.length) {
      charges = await this._syncCharges(clubId, memberId, { since: toAdd.length ? since || todayISO() : null, until: toRemove.length ? until || todayISO() : null });
    }
    return { added: toAdd.length, removed: toRemove.length, charges };
  }

  /** `until` ('YYYY-MM-DD'): hasta cuándo estuvo en el grupo (lo que vence después, sin
   * movimientos, se le quita de los cobros de ese grupo). */
  async removeMember(clubId, groupId, memberId, actorId, until = null) {
    const group = await memberGroupsRepository.findByIdInClub(groupId, clubId);
    if (!group) throw AppError.notFound('Grupo no encontrado.');
    await memberGroupsRepository.removeMember(groupId, memberId);
    await this._syncCharges(clubId, memberId, { until: until || todayISO() });
    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'MEMBER_GROUP_MEMBER_REMOVED',
      entityType: 'member_group',
      entityId: groupId,
      changes: { removed: memberId },
    });
  }
}

module.exports = new MemberGroupsService();
