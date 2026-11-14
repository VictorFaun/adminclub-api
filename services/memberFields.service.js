const memberFieldsRepository = require('../repositories/memberFields.repository');
const memberFormsService = require('./memberForms.service');
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
      roles: Object.entries(ROLES).map(([key, r]) => ({ key, label: r.label, types: r.types, perForm: !!r.perForm })),
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

  /**
   * `formId`: ficha del campo. Los nombres y el identificador van una sola vez en el club; los
   * usos `perForm` (nacimiento, fotos, contacto) una vez por ficha (sql/083).
   */
  async _validateRole(clubId, role, fieldType, excludeId = null, formId = null, conn = undefined) {
    if (role === null || role === undefined || role === '') return null;
    const def = ROLES[role];
    if (!def) throw AppError.badRequest('Uso especial inválido.');
    if (!def.types.includes(fieldType)) {
      throw AppError.badRequest(`El uso "${def.label}" no es compatible con este tipo de campo.`);
    }
    const formOf = await memberFormsService.formOfFields(clubId, conn);
    const others = (await memberFieldsRepository.findByClub(clubId, conn)).filter((f) => f.role === role && f.id !== excludeId);
    const existing = def.perForm ? others.find((f) => formId && formOf.get(f.id)?.id === formId) : others[0];
    if (existing) {
      const form = formOf.get(existing.id);
      throw AppError.conflict(
        def.perForm
          ? `Esta ficha ya tiene el uso "${def.label}" (campo "${existing.label}"). Va una vez por ficha: quítaselo a ese campo para ponerlo en este.`
          : `El uso "${def.label}" ya está en ${form ? `«${form.name}»` : 'otra ficha'} (campo "${existing.label}"). Va una sola vez en el club: elimínalo o quítale el uso allá para ponerlo acá.`
      );
    }
    return role;
  }

  /** Código libre en el club: el del nombre o, si ya lo usa un campo de otra ficha, con sufijo
   * (cada ficha es independiente: dos pueden tener un "Teléfono"). En la misma ficha, no se repite. */
  async _freeCode(clubId, base, label, formId, conn) {
    const formOf = await memberFormsService.formOfFields(clubId, conn);
    const catalog = await memberFieldsRepository.findByClub(clubId, conn);
    const norm = (v) => String(v ?? '').trim().toLowerCase();
    if (formId && catalog.some((f) => formOf.get(f.id)?.id === formId && norm(f.label) === norm(label))) {
      throw AppError.conflict('Ya existe un campo con ese nombre en esta ficha.');
    }
    const codes = new Set(catalog.map((f) => f.code));
    if (!codes.has(base)) return base;
    let n = 2;
    while (codes.has(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
  }

  _settingsJson(fieldType, settings, role) {
    const s = normalizeSettings(fieldType, settings, role);
    return s ? JSON.stringify(s) : null;
  }

  /** `formId`: ficha a la que se agrega el campo (al final); sin indicarla, a las fichas por defecto. */
  async create(clubId, { code, label, fieldType, role, options, settings, helpText, isRequired, inPublicForm, sortOrder, formId }, actorId, conn) {
    if (!FIELD_TYPES.includes(fieldType)) throw AppError.badRequest('Tipo de campo inválido.');
    const base = slugify(code || label);
    if (!base) throw AppError.badRequest('No se pudo generar un código válido para este campo.');
    const targetFormId = await memberFormsService.targetFormId(clubId, formId, conn);
    const normalizedCode = await this._freeCode(clubId, base, label, targetFormId, conn);
    const id = await memberFieldsRepository.createField(
      {
        clubId,
        code: normalizedCode,
        label: String(label).trim(),
        fieldType,
        role: await this._validateRole(clubId, role, fieldType, null, targetFormId, conn),
        options: this._validateOptions(fieldType, options),
        settings: this._settingsJson(fieldType, settings, role),
        helpText: helpText ? String(helpText).trim().slice(0, 255) || null : null,
        isRequired: isRequired ? 1 : 0,
        inPublicForm: inPublicForm === false ? 0 : 1,
        sortOrder: sortOrder || (await memberFieldsRepository.nextSortOrder(clubId, conn)),
      },
      conn
    );
    await memberFormsService.attachField(clubId, id, targetFormId, conn);
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
      const formId = (await memberFormsService.formOfFields(clubId)).get(fieldId)?.id ?? null;
      updates.role = await this._validateRole(clubId, role !== undefined ? role : field.role, resolvedType, fieldId, formId);
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
  async addSuggested(clubId, actorId, conn, targetFormId = null) {
    const existing = await memberFieldsRepository.findByClub(clubId, conn);
    let added = 0;
    // A la ficha indicada (la que se está editando) o a la por defecto (la crea si no hay ninguna).
    const formId = targetFormId ? Number(targetFormId) : await memberFormsService.ensureDefault(clubId, conn);
    // Lo que esa ficha ya tiene (por nombre): no se repite. Los usos especiales tampoco: los de
    // una vez por ficha si ya están en esta; los demás (nombres, identificador) si están en cualquiera.
    const formOf = await memberFormsService.formOfFields(clubId, conn);
    const inForm = new Set(existing.filter((f) => formOf.get(f.id)?.id === formId).map((f) => f.label.trim().toLowerCase()));
    const roles = new Set(existing.filter((f) => f.role && (!ROLES[f.role]?.perForm || formOf.get(f.id)?.id === formId)).map((f) => f.role));
    const codes = new Set(existing.map((f) => f.code));
    for (const s of SUGGESTED_FIELDS) {
      if (inForm.has(s.label.toLowerCase()) || (s.role && roles.has(s.role))) continue;
      let code = s.code;
      for (let n = 2; codes.has(code); n += 1) code = `${s.code}-${n}`;
      codes.add(code);
      // eslint-disable-next-line no-await-in-loop
      const fieldId = await memberFieldsRepository.createField(
        {
          clubId,
          code,
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
      // eslint-disable-next-line no-await-in-loop
      await memberFormsService.attachField(clubId, fieldId, formId, conn);
      added += 1;
    }
    if (added && actorId) {
      await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_FIELDS_SUGGESTED_ADDED', entityType: 'member_field', entityId: clubId, changes: { added } });
    }
    return { added, fields: await this.listForClub(clubId) };
  }
}

module.exports = new MemberFieldsService();
