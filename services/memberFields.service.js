const memberFieldsRepository = require('../repositories/memberFields.repository');
const auditRepository = require('../repositories/audit.repository');
const AppError = require('../helpers/AppError');
const slugify = require('../utils/slugify');
const { diffValue, buildDiff } = require('../helpers/auditDiff');

const FIELD_TYPES = ['text', 'number', 'date', 'boolean', 'select'];

class MemberFieldsService {
  toDto(field) {
    return {
      id: field.id,
      clubId: field.club_id,
      code: field.code,
      label: field.label,
      fieldType: field.field_type,
      options: Array.isArray(field.options) ? field.options : field.options ? JSON.parse(field.options) : null,
      isRequired: !!field.is_required,
      sortOrder: field.sort_order,
      createdAt: field.created_at,
    };
  }

  async listForClub(clubId) {
    const rows = await memberFieldsRepository.findByClub(clubId);
    return rows.map((r) => this.toDto(r));
  }

  _validateOptions(fieldType, options) {
    if (fieldType !== 'select') return null;
    if (!Array.isArray(options) || !options.length) {
      throw AppError.badRequest('Un campo de tipo "select" necesita al menos una opción.');
    }
    return JSON.stringify(options.map((o) => String(o)));
  }

  async create(clubId, { code, label, fieldType, options, isRequired, sortOrder }, actorId) {
    if (!FIELD_TYPES.includes(fieldType)) throw AppError.badRequest('Tipo de campo inválido.');
    const normalizedCode = slugify(code || label);
    if (!normalizedCode) throw AppError.badRequest('No se pudo generar un código válido para este campo.');
    if (await memberFieldsRepository.findByCode(clubId, normalizedCode)) {
      throw AppError.conflict('Ya existe un campo personalizado con este código en el club.');
    }

    const id = await memberFieldsRepository.createField({
      clubId,
      code: normalizedCode,
      label,
      fieldType,
      options: this._validateOptions(fieldType, options),
      isRequired: isRequired ? 1 : 0,
      sortOrder: sortOrder || 0,
    });

    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_FIELD_CREATED', entityType: 'member_field', entityId: id, changes: { label, fieldType } });

    return this.toDto(await memberFieldsRepository.findById(id));
  }

  async update(clubId, fieldId, { label, fieldType, options, isRequired, sortOrder }, actorId) {
    const field = await memberFieldsRepository.findById(fieldId);
    if (!field || field.club_id !== clubId) throw AppError.notFound('Campo personalizado no encontrado.');

    const resolvedType = fieldType || field.field_type;
    if (fieldType && !FIELD_TYPES.includes(fieldType)) throw AppError.badRequest('Tipo de campo inválido.');

    const updates = {};
    if (label !== undefined) updates.label = label;
    if (fieldType !== undefined) updates.field_type = fieldType;
    if (options !== undefined || fieldType !== undefined) {
      // `field.options` (si se reusa el valor ya guardado) puede venir del driver ya parseado a
      // array (mysql2 auto-parsea columnas JSON) — se normaliza igual por si no lo estuviera.
      const existingOptions = Array.isArray(field.options) ? field.options : field.options ? JSON.parse(field.options) : null;
      updates.options = this._validateOptions(resolvedType, options !== undefined ? options : existingOptions);
    }
    if (isRequired !== undefined) updates.is_required = isRequired ? 1 : 0;
    if (sortOrder !== undefined) updates.sort_order = sortOrder;

    if (Object.keys(updates).length) await memberFieldsRepository.updateById(fieldId, updates);

    const changes = buildDiff({
      label: updates.label !== undefined ? diffValue(field.label, updates.label) : undefined,
      fieldType: updates.field_type !== undefined ? diffValue(field.field_type, updates.field_type) : undefined,
    });
    if (changes) {
      await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_FIELD_UPDATED', entityType: 'member_field', entityId: fieldId, changes });
    }

    return this.toDto(await memberFieldsRepository.findById(fieldId));
  }

  async remove(clubId, fieldId, actorId) {
    const field = await memberFieldsRepository.findById(fieldId);
    if (!field || field.club_id !== clubId) throw AppError.notFound('Campo personalizado no encontrado.');
    await memberFieldsRepository.deleteField(fieldId, clubId);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_FIELD_DELETED', entityType: 'member_field', entityId: fieldId, changes: { label: field.label } });
  }
}

module.exports = new MemberFieldsService();
