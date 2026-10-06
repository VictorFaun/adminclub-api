const memberFieldsRepository = require('../repositories/memberFields.repository');
const auditRepository = require('../repositories/audit.repository');
const AppError = require('../helpers/AppError');
const slugify = require('../utils/slugify');
const { diffValue, buildDiff } = require('../helpers/auditDiff');
const { FIELD_TYPES, OPTION_TYPES, ROLES, SUGGESTED_FIELDS, IMAGE_ASPECTS, DOC_FORMATS, parseOptions, parseSettings, normalizeSettings } = require('../helpers/memberFieldTypes');

/**
 * Campos de la ficha de miembro: la ficha es 100% configurable (nombres, identificador, correo,
 * foto, archivos… son todos campos). Un campo puede tener un "uso especial" (`role`) para que el
 * resto de la app sepa qué es — ver helpers/memberFieldTypes.js#ROLES. Los clubes nuevos parten con
 * una ficha sugerida que se puede editar, borrar o restaurar.
 */
class MemberFieldsService {
  toDto(field) {
    return {
      id: field.id,
      clubId: field.club_id,
      code: field.code,
      label: field.label,
      fieldType: field.field_type,
      role: field.role ?? null,
      options: OPTION_TYPES.includes(field.field_type) ? parseOptions(field) : null,
      settings: parseSettings(field),
      helpText: field.help_text ?? null,
      isRequired: !!field.is_required,
      inPublicForm: !!field.in_public_form,
      sortOrder: field.sort_order,
      createdAt: field.created_at,
    };
  }

  async listForClub(clubId) {
    return (await memberFieldsRepository.findByClub(clubId)).map((r) => this.toDto(r));
  }

  /** Catálogo de tipos y usos especiales (para armar el editor de la ficha en el frontend). */
  catalog() {
    return {
      types: FIELD_TYPES,
      roles: Object.entries(ROLES).map(([key, r]) => ({ key, label: r.label, types: r.types })),
      imageAspects: IMAGE_ASPECTS,
      docFormats: Object.entries(DOC_FORMATS).map(([key, f]) => ({ key, label: f.label, mimes: f.mimes })),
    };
  }

  _validateOptions(fieldType, options) {
    if (!OPTION_TYPES.includes(fieldType)) return null;
    const list = Array.isArray(options) ? [...new Set(options.map((o) => String(o).trim()).filter(Boolean))] : [];
    if (!list.length) throw AppError.badRequest('Un campo con opciones necesita al menos una opción.');
    return JSON.stringify(list);
  }

  async _validateRole(clubId, role, fieldType, excludeId = null) {
    if (role === null || role === undefined || role === '') return null;
    const def = ROLES[role];
    if (!def) throw AppError.badRequest('Uso especial inválido.');
    if (!def.types.includes(fieldType)) {
      throw AppError.badRequest(`El uso "${def.label}" no es compatible con este tipo de campo.`);
    }
    const existing = await memberFieldsRepository.findByRole(clubId, role);
    if (existing && existing.id !== excludeId) {
      throw AppError.conflict(`Ya hay otro campo con el uso "${def.label}" ("${existing.label}"). Quítaselo primero.`);
    }
    return role;
  }

  _settingsJson(fieldType, settings, role) {
    const s = normalizeSettings(fieldType, settings, role);
    return s ? JSON.stringify(s) : null;
  }

  async create(clubId, { code, label, fieldType, role, options, settings, helpText, isRequired, inPublicForm, sortOrder }, actorId, conn) {
    if (!FIELD_TYPES.includes(fieldType)) throw AppError.badRequest('Tipo de campo inválido.');
    const normalizedCode = slugify(code || label);
    if (!normalizedCode) throw AppError.badRequest('No se pudo generar un código válido para este campo.');
    if (await memberFieldsRepository.findByCode(clubId, normalizedCode, conn)) {
      throw AppError.conflict('Ya existe un campo con ese nombre en la ficha.');
    }
    const id = await memberFieldsRepository.createField(
      {
        clubId,
        code: normalizedCode,
        label: String(label).trim(),
        fieldType,
        role: await this._validateRole(clubId, role, fieldType),
        options: this._validateOptions(fieldType, options),
        settings: this._settingsJson(fieldType, settings, role),
        helpText: helpText ? String(helpText).trim().slice(0, 255) || null : null,
        isRequired: isRequired ? 1 : 0,
        inPublicForm: inPublicForm === false ? 0 : 1,
        sortOrder: sortOrder || (await memberFieldsRepository.nextSortOrder(clubId, conn)),
      },
      conn
    );
    if (actorId !== undefined) {
      await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_FIELD_CREATED', entityType: 'member_field', entityId: id, changes: { label, fieldType } });
    }
    return this.toDto(await memberFieldsRepository.findById(id, conn));
  }

  async update(clubId, fieldId, { label, fieldType, role, options, settings, helpText, isRequired, inPublicForm, sortOrder }, actorId) {
    const field = await memberFieldsRepository.findById(fieldId);
    if (!field || field.club_id !== clubId) throw AppError.notFound('Campo no encontrado.');
    const resolvedType = fieldType || field.field_type;
    if (fieldType && !FIELD_TYPES.includes(fieldType)) throw AppError.badRequest('Tipo de campo inválido.');
    // Cambiar entre "dato" y "archivo" perdería lo guardado: se crea un campo nuevo en su lugar.
    const isUpload = (t) => t === 'image' || t === 'file';
    if (fieldType && isUpload(fieldType) !== isUpload(field.field_type)) {
      throw AppError.badRequest('No se puede convertir un campo de datos en uno de archivos (o al revés). Crea un campo nuevo.');
    }

    const updates = {};
    if (label !== undefined) updates.label = String(label).trim();
    if (fieldType !== undefined) updates.field_type = fieldType;
    if (role !== undefined || fieldType !== undefined) {
      updates.role = await this._validateRole(clubId, role !== undefined ? role : field.role, resolvedType, fieldId);
    }
    if (options !== undefined || fieldType !== undefined) {
      updates.options = this._validateOptions(resolvedType, options !== undefined ? options : parseOptions(field));
    }
    if (settings !== undefined || fieldType !== undefined) {
      updates.settings = this._settingsJson(resolvedType, settings !== undefined ? settings : parseSettings(field), updates.role !== undefined ? updates.role : field.role);
    }
    if (helpText !== undefined) updates.help_text = helpText ? String(helpText).trim().slice(0, 255) || null : null;
    if (isRequired !== undefined) updates.is_required = isRequired ? 1 : 0;
    if (inPublicForm !== undefined) updates.in_public_form = inPublicForm ? 1 : 0;
    if (sortOrder !== undefined) updates.sort_order = sortOrder;

    if (Object.keys(updates).length) await memberFieldsRepository.updateById(fieldId, updates);

    const changes = buildDiff({
      label: updates.label !== undefined ? diffValue(field.label, updates.label) : undefined,
      fieldType: updates.field_type !== undefined ? diffValue(field.field_type, updates.field_type) : undefined,
      role: updates.role !== undefined ? diffValue(field.role, updates.role) : undefined,
    });
    if (changes) {
      await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_FIELD_UPDATED', entityType: 'member_field', entityId: fieldId, changes });
    }
    return this.toDto(await memberFieldsRepository.findById(fieldId));
  }

  async reorder(clubId, ids, actorId) {
    const own = new Set((await memberFieldsRepository.findByClub(clubId)).map((f) => f.id));
    const clean = ids.map(Number).filter((id) => own.has(id));
    await memberFieldsRepository.reorder(clubId, clean);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_FIELDS_REORDERED', entityType: 'member_field', entityId: clubId, changes: null });
    return this.listForClub(clubId);
  }

  async remove(clubId, fieldId, actorId) {
    const field = await memberFieldsRepository.findById(fieldId);
    if (!field || field.club_id !== clubId) throw AppError.notFound('Campo no encontrado.');
    await memberFieldsRepository.deleteField(fieldId, clubId);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_FIELD_DELETED', entityType: 'member_field', entityId: fieldId, changes: { label: field.label } });
  }

  /**
   * Precarga la ficha sugerida (nombres, RUT, nacimiento, correo, teléfono, foto, documentos):
   * en un club nuevo, o desde Configuración para agregar los que falten. No toca los existentes:
   * se salta un sugerido si ya hay un campo con su código o con su uso especial.
   */
  async addSuggested(clubId, actorId, conn) {
    const existing = await memberFieldsRepository.findByClub(clubId, conn);
    const codes = new Set(existing.map((f) => f.code));
    const roles = new Set(existing.map((f) => f.role).filter(Boolean));
    let added = 0;
    for (const s of SUGGESTED_FIELDS) {
      if (codes.has(s.code) || (s.role && roles.has(s.role))) continue;
      // eslint-disable-next-line no-await-in-loop
      await memberFieldsRepository.createField(
        {
          clubId,
          code: s.code,
          label: s.label,
          fieldType: s.fieldType,
          role: s.role,
          options: null,
          helpText: null,
          settings: this._settingsJson(s.fieldType, s.settings, s.role),
          isRequired: s.isRequired ? 1 : 0,
          inPublicForm: s.inPublicForm === false ? 0 : 1,
          // eslint-disable-next-line no-await-in-loop
          sortOrder: await memberFieldsRepository.nextSortOrder(clubId, conn),
        },
        conn
      );
      added += 1;
    }
    if (added && actorId) {
      await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_FIELDS_SUGGESTED_ADDED', entityType: 'member_field', entityId: clubId, changes: { added } });
    }
    return { added, fields: await this.listForClub(clubId) };
  }
}

module.exports = new MemberFieldsService();
