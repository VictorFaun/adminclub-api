const memberGroupsRepository = require('../repositories/memberGroups.repository');
const membersRepository = require('../repositories/members.repository');
const auditRepository = require('../repositories/audit.repository');
const AppError = require('../helpers/AppError');
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
      status: row.status,
      groups: (groupsByMember[row.id] || []).map((g) => ({ id: g.id, name: g.name, color: g.color })),
    }));
    return { items, meta: buildMeta({ page, limit, total }) };
  }

  async addMembers(clubId, groupId, memberIds, actorId) {
    const group = await memberGroupsRepository.findByIdInClub(groupId, clubId);
    if (!group) throw AppError.notFound('Grupo no encontrado.');
    const found = await membersRepository.findByIds(memberIds, clubId);
    if (found.length !== memberIds.length) throw AppError.badRequest('Uno o más miembros no pertenecen a este club.');

    await memberGroupsRepository.addMembers(groupId, memberIds);
    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'MEMBER_GROUP_MEMBERS_ADDED',
      entityType: 'member_group',
      entityId: groupId,
      changes: { added: memberIds },
    });
  }

  async removeMember(clubId, groupId, memberId, actorId) {
    const group = await memberGroupsRepository.findByIdInClub(groupId, clubId);
    if (!group) throw AppError.notFound('Grupo no encontrado.');
    await memberGroupsRepository.removeMember(groupId, memberId);
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
