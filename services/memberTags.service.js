const memberTagsRepository = require('../repositories/memberTags.repository');
const membersRepository = require('../repositories/members.repository');
const auditRepository = require('../repositories/audit.repository');
const AppError = require('../helpers/AppError');
const { parsePagination, buildMeta } = require('../helpers/pagination');
const { diffValue, buildDiff } = require('../helpers/auditDiff');

class MemberTagsService {
  toDto(tag) {
    return {
      id: tag.id,
      uuid: tag.uuid,
      clubId: tag.club_id,
      name: tag.name,
      description: tag.description,
      color: tag.color,
      membersCount: Number(tag.members_count ?? 0),
      createdAt: tag.created_at,
    };
  }

  async listForClub(clubId) {
    const rows = await memberTagsRepository.findByClub(clubId);
    return rows.map((r) => this.toDto(r));
  }

  async findOptions(clubId) {
    return memberTagsRepository.findOptions(clubId);
  }

  async getById(clubId, tagId) {
    const tag = await memberTagsRepository.findByIdInClub(tagId, clubId);
    if (!tag) throw AppError.notFound('Etiqueta no encontrada.');
    const membersCount = await memberTagsRepository.countMembers(tagId);
    return this.toDto({ ...tag, members_count: membersCount });
  }

  async create(clubId, { name, description, color }, actorId) {
    if (await memberTagsRepository.findByNameInClub(name, clubId)) {
      throw AppError.conflict('Ya existe una etiqueta con este nombre en el club.');
    }
    const id = await memberTagsRepository.createTag({ clubId, name, description: description || null, color: color || '#6366F1' });
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_TAG_CREATED', entityType: 'member_tag', entityId: id, changes: { name } });
    return this.getById(clubId, id);
  }

  async update(clubId, tagId, { name, description, color }, actorId) {
    const tag = await memberTagsRepository.findByIdInClub(tagId, clubId);
    if (!tag) throw AppError.notFound('Etiqueta no encontrada.');

    if (name && name !== tag.name) {
      const existing = await memberTagsRepository.findByNameInClub(name, clubId, tagId);
      if (existing) throw AppError.conflict('Ya existe una etiqueta con este nombre en el club.');
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description || null;
    if (color !== undefined) updates.color = color;
    if (Object.keys(updates).length) await memberTagsRepository.updateById(tagId, updates);

    const changes = buildDiff({
      name: updates.name !== undefined ? diffValue(tag.name, updates.name) : undefined,
      description: updates.description !== undefined ? diffValue(tag.description, updates.description) : undefined,
      color: updates.color !== undefined ? diffValue(tag.color, updates.color) : undefined,
    });
    if (changes) {
      await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_TAG_UPDATED', entityType: 'member_tag', entityId: tagId, changes });
    }

    return this.getById(clubId, tagId);
  }

  async remove(clubId, tagId, actorId) {
    const tag = await memberTagsRepository.findByIdInClub(tagId, clubId);
    if (!tag) throw AppError.notFound('Etiqueta no encontrada.');
    await memberTagsRepository.deleteById(tagId);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_TAG_DELETED', entityType: 'member_tag', entityId: tagId, changes: { name: tag.name } });
  }

  async listMembers(clubId, tagId, query) {
    const tag = await memberTagsRepository.findByIdInClub(tagId, clubId);
    if (!tag) throw AppError.notFound('Etiqueta no encontrada.');
    const { limit, offset, page } = parsePagination(query, ['first_name']);
    const { rows, total } = await memberTagsRepository.paginateMembers(tagId, { limit, offset });

    const ids = rows.map((r) => r.id);
    const tagsByMember = await membersRepository.getTagsForMembers(ids);
    const items = rows.map((row) => ({
      id: row.id,
      fullName: [row.first_name, row.middle_name, row.last_name, row.second_last_name].filter(Boolean).join(' '),
      email: row.email,
      status: row.status,
      tags: (tagsByMember[row.id] || []).map((t) => ({ id: t.id, name: t.name, color: t.color })),
    }));
    return { items, meta: buildMeta({ page, limit, total }) };
  }

  async addMembers(clubId, tagId, memberIds, actorId) {
    const tag = await memberTagsRepository.findByIdInClub(tagId, clubId);
    if (!tag) throw AppError.notFound('Etiqueta no encontrada.');
    const found = await membersRepository.findByIds(memberIds, clubId);
    if (found.length !== memberIds.length) throw AppError.badRequest('Uno o más miembros no pertenecen a este club.');

    await memberTagsRepository.addMembers(tagId, memberIds);
    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'MEMBER_TAG_MEMBERS_ADDED',
      entityType: 'member_tag',
      entityId: tagId,
      changes: { added: memberIds },
    });
  }

  async removeMember(clubId, tagId, memberId, actorId) {
    const tag = await memberTagsRepository.findByIdInClub(tagId, clubId);
    if (!tag) throw AppError.notFound('Etiqueta no encontrada.');
    await memberTagsRepository.removeMember(tagId, memberId);
    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'MEMBER_TAG_MEMBER_REMOVED',
      entityType: 'member_tag',
      entityId: tagId,
      changes: { removed: memberId },
    });
  }
}

module.exports = new MemberTagsService();
