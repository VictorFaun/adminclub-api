const memberFormsRepository = require('../repositories/memberForms.repository');
const memberFieldsRepository = require('../repositories/memberFields.repository');
const membersRepository = require('../repositories/members.repository');
const memberGroupsRepository = require('../repositories/memberGroups.repository');
const auditRepository = require('../repositories/audit.repository');
const AppError = require('../helpers/AppError');
const { withTransaction } = require('../config/database');
const { ROLES } = require('../helpers/memberFieldTypes');

/**
 * Fichas del club (sql/072): un club puede pedir información distinta según el tipo de miembro
 * ("Ficha de jugador", "Ficha de apoderado"…). Cada ficha tiene sus propios campos (sql/079: un
 * campo pertenece a una sola ficha, member_form_fields.field_id es único); dos fichas pueden tener
 * un campo con el mismo nombre y son independientes. Desde sql/086 las fichas son libres: no hay
 * fichas "por defecto" ni una que vaya siempre, y cada uso especial (nombres, identificador…) va
 * una vez POR FICHA. Si un miembro tiene el mismo dato especial en varias, manda el orden de
 * member_role_priority (ver repeatedRoles / normalizePriority, que usan las invitaciones).
 */
class MemberFormsService {
  /** `roleOf`: id de campo → uso especial (para `roles`). */
  toDto(form, fieldIds = [], identifierFieldIds = [], roleOf = new Map()) {
    return {
      id: form.id,
      name: form.name,
      description: form.description ?? null,
      // Tiene un campo Identificador (solo informativo: ya no hace que la ficha vaya siempre).
      hasIdentifier: identifierFieldIds.some((id) => fieldIds.includes(id)),
      // Usos especiales de sus campos (ej. ['first_name', 'birth_date']): si dos fichas elegidas
      // repiten uno, el código de invitación pregunta cuál usar primero (sql/086).
      roles: [...new Set(fieldIds.map((id) => roleOf.get(id)).filter(Boolean))],
      sortOrder: form.sort_order,
      fieldIds,
      memberCount: form.member_count !== undefined ? Number(form.member_count) : undefined,
    };
  }

  async list(clubId) {
    const [forms, fieldIds, catalog] = await Promise.all([memberFormsRepository.findByClub(clubId), memberFormsRepository.fieldIdsByForm(clubId), memberFieldsRepository.findByClub(clubId)]);
    const identifierIds = catalog.filter((f) => f.role === 'identifier').map((f) => f.id);
    const roleOf = new Map(catalog.filter((f) => f.role).map((f) => [f.id, f.role]));
    return forms.map((f) => this.toDto(f, fieldIds[f.id] || [], identifierIds, roleOf));
  }

  /**
   * Usos especiales que se repiten entre las fichas `formIds`: `{ role: [formId, ...] }` (en el
   * orden de las fichas), solo los que están en dos o más.
   */
  async repeatedRoles(clubId, formIds, conn) {
    const ids = [...new Set((formIds || []).map(Number))];
    if (ids.length < 2) return {};
    const [catalog, byForm] = await Promise.all([memberFieldsRepository.findByClub(clubId, conn), memberFormsRepository.fieldIdsByForm(clubId, conn)]);
    const roleOf = new Map(catalog.filter((f) => f.role).map((f) => [f.id, f.role]));
    const out = {};
    for (const formId of ids) {
      for (const role of new Set((byForm[formId] || []).map((id) => roleOf.get(id)).filter(Boolean))) (out[role] ||= []).push(formId);
    }
    return Object.fromEntries(Object.entries(out).filter(([, list]) => list.length > 1));
  }

  /**
   * Prioridad de los datos especiales repetidos entre `formIds` (ej. dos fichas con "Foto para
   * cumpleaños"): por cada uno, el orden elegido debe tener exactamente esas fichas. Devuelve
   * `{ role: [formId, ...] }` limpio o lanza diciendo cuál falta elegir.
   */
  async normalizePriority(clubId, formIds, priority, { label = 'Las fichas' } = {}) {
    const repeated = await this.repeatedRoles(clubId, formIds);
    const out = {};
    for (const [role, forms] of Object.entries(repeated)) {
      const chosen = [...new Set((Array.isArray(priority?.[role]) ? priority[role] : []).map(Number))];
      const complete = chosen.length === forms.length && forms.every((id) => chosen.includes(id));
      if (!complete) throw AppError.badRequest(`${label} repiten «${ROLES[role]?.label ?? role}»: elige qué ficha usar primero.`);
      out[role] = chosen;
    }
    return out;
  }

  async _get(clubId, formId) {
    const form = await memberFormsRepository.findInClub(clubId, Number(formId));
    if (!form) throw AppError.notFound('Ficha no encontrada.');
    return form;
  }

  async _dto(clubId, formId) {
    return (await this.list(clubId)).find((f) => f.id === formId);
  }

  /**
   * Fichas válidas del club a partir de ids enviados por el cliente (descarta repetidos; lanza si
   * alguno no es del club). `null`/`undefined` → no se indicó (quien llama decide el defecto).
   */
  async resolveIds(clubId, formIds) {
    if (formIds === null || formIds === undefined) return null;
    const ids = [...new Set((Array.isArray(formIds) ? formIds : []).map(Number).filter(Boolean))];
    const found = await memberFormsRepository.findByIds(clubId, ids);
    if (found.length !== ids.length) throw AppError.badRequest('Una o más fichas no pertenecen a este club.');
    return ids;
  }

  /** Ficha a la que iría un campo nuevo (la indicada o la primera del club). */
  async targetFormId(clubId, formId, conn) {
    if (formId) return Number(formId);
    return (await memberFormsRepository.findByClub(clubId, conn))[0]?.id ?? null;
  }

  /** Ficha de cada campo (id de campo → ficha). */
  async formOfFields(clubId, conn) {
    const [forms, byForm] = await Promise.all([memberFormsRepository.findByClub(clubId, conn), memberFormsRepository.fieldIdsByForm(clubId, conn)]);
    const out = new Map();
    for (const form of forms) for (const id of byForm[form.id] || []) out.set(id, form);
    return out;
  }

  /**
   * Campos (filas de `member_fields`) que piden las fichas `formIds`, sin repetir y en orden: el
   * de las fichas y, dentro de cada una, el suyo. `formIds = null` → todo el catálogo.
   */
  async fieldsOf(clubId, formIds, conn) {
    const catalog = await memberFieldsRepository.findByClub(clubId, conn);
    if (formIds === null || formIds === undefined) return catalog;
    const wanted = new Set(formIds.map(Number));
    const [forms, byForm] = await Promise.all([memberFormsRepository.findByClub(clubId, conn), memberFormsRepository.fieldIdsByForm(clubId, conn)]);
    const byId = new Map(catalog.map((f) => [f.id, f]));
    const out = [];
    const seen = new Set();
    for (const form of forms) {
      if (!wanted.has(form.id)) continue;
      for (const id of byForm[form.id] || []) {
        if (seen.has(id) || !byId.has(id)) continue;
        seen.add(id);
        out.push(byId.get(id));
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ administración

  async _assertName(clubId, name, excludeId = null) {
    const clean = String(name || '').trim().slice(0, 100);
    if (!clean) throw AppError.badRequest('El nombre de la ficha es obligatorio.');
    const existing = await memberFormsRepository.findByName(clubId, clean);
    if (existing && existing.id !== excludeId) throw AppError.conflict('Ya existe una ficha con ese nombre.');
    return clean;
  }

  async create(clubId, { name, description, fieldIds }, actorId) {
    const clean = await this._assertName(clubId, name);
    // Solo campos que todavía no son de ninguna ficha (cada campo es de una sola).
    const catalog = await memberFieldsRepository.findByClub(clubId);
    const taken = new Set(Object.values(await memberFormsRepository.fieldIdsByForm(clubId)).flat());
    const own = new Set(catalog.map((f) => f.id).filter((id) => !taken.has(id)));
    const fields = [...new Set((fieldIds || []).map(Number))].filter((id) => own.has(id));
    const id = await withTransaction(async (conn) => {
      const formId = await memberFormsRepository.createForm(
        {
          clubId,
          name: clean,
          description: description ? String(description).trim().slice(0, 255) || null : null,
          sortOrder: await memberFormsRepository.nextSortOrder(clubId, conn),
        },
        conn
      );
      if (fields.length) await memberFormsRepository.setFields(formId, fields, conn);
      return formId;
    });
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_FORM_CREATED', entityType: 'member_form', entityId: id, changes: { name: clean } });
    return this._dto(clubId, id);
  }

  async update(clubId, formId, { name, description }, actorId) {
    const form = await this._get(clubId, formId);
    const updates = {};
    if (name !== undefined) updates.name = await this._assertName(clubId, name, form.id);
    if (description !== undefined) updates.description = description ? String(description).trim().slice(0, 255) || null : null;
    if (Object.keys(updates).length) await memberFormsRepository.updateById(form.id, updates);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_FORM_UPDATED', entityType: 'member_form', entityId: form.id, changes: updates });
    return this._dto(clubId, form.id);
  }

  /**
   * Elimina la ficha. Los campos que SOLO estaban en ella se eliminan también (con sus valores):
   * un campo que no está en ninguna ficha no se le pediría a nadie. El club conserva al menos una.
   */
  async remove(clubId, formId, actorId) {
    const form = await this._get(clubId, formId);
    const forms = await memberFormsRepository.findByClub(clubId);
    if (forms.length <= 1) throw AppError.conflict('El club necesita al menos una ficha.');
    const fieldIds = (await memberFormsRepository.fieldIdsByForm(clubId))[form.id] || [];
    const orphans = await memberFormsRepository.fieldsOnlyIn(fieldIds, form.id);
    await withTransaction(async (conn) => {
      for (const f of orphans) await memberFieldsRepository.deleteField(f.id, clubId, conn);
      await memberFormsRepository.deleteForm(clubId, form.id, conn);
    });
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_FORM_DELETED', entityType: 'member_form', entityId: form.id, changes: { name: form.name, deletedFields: orphans.map((f) => f.label) } });
  }

  /**
   * Orden de los campos de la ficha (`fieldIds` = lista final). Cada campo es de una sola ficha:
   * no se puede agregar el de otra, y quitar uno es eliminarlo (se pierden sus valores).
   */
  async setFields(clubId, formId, fieldIds, actorId) {
    const form = await this._get(clubId, formId);
    const catalog = await memberFieldsRepository.findByClub(clubId);
    const own = new Set(catalog.map((f) => f.id));
    const next = [...new Set((fieldIds || []).map(Number))].filter((id) => own.has(id));
    const byForm = await memberFormsRepository.fieldIdsByForm(clubId);
    const current = byForm[form.id] || [];
    const foreign = next.filter((id) => !current.includes(id) && Object.entries(byForm).some(([fid, ids]) => Number(fid) !== form.id && ids.includes(id)));
    if (foreign.length) {
      const label = catalog.find((f) => f.id === foreign[0])?.label ?? 'Ese campo';
      throw AppError.conflict(`"${label}" es de otra ficha: cada ficha tiene sus propios campos. Crea uno nuevo en esta.`);
    }
    const removed = current.filter((id) => !next.includes(id));
    const orphans = await memberFormsRepository.fieldsOnlyIn(removed, form.id);
    if (orphans.length) {
      throw AppError.conflict(`"${orphans.map((f) => f.label).join('", "')}" no está en ninguna otra ficha: elimínalo en vez de quitarlo.`);
    }
    await memberFormsRepository.setFields(form.id, next);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_FORM_FIELDS_UPDATED', entityType: 'member_form', entityId: form.id, changes: { fields: next.length } });
    return this._dto(clubId, form.id);
  }

  /** Agrega un campo (recién creado) al final de la ficha indicada o, si no se indica, de la
   * primera por defecto (un campo es de una sola ficha). */
  async attachField(clubId, fieldId, formId, conn) {
    // Con `conn`: puede correr dentro de la transacción que creó la ficha (alta de un club).
    const form = formId ? await memberFormsRepository.findInClub(clubId, Number(formId), conn) : null;
    if (formId && !form) throw AppError.notFound('Ficha no encontrada.');
    let ids = form ? [form.id] : await memberFormsRepository.findDefaultIds(clubId, conn);
    if (!ids.length) ids = (await memberFormsRepository.findByClub(clubId, conn)).slice(0, 1).map((f) => f.id);
    if (ids.length) await memberFormsRepository.appendField(ids[0], fieldId, conn);
    return ids[0] ?? null;
  }

  // ------------------------------------------------------------------ asignación

  /** Miembros a los que se les pide la ficha. */
  async members(clubId, formId) {
    const form = await this._get(clubId, formId);
    const ids = await memberFormsRepository.findMembers(form.id);
    const rows = await membersRepository.findNamesByIds(ids, clubId);
    return rows.map((r) => ({
      id: r.id,
      fullName: [r.first_name, r.middle_name, r.last_name, r.second_last_name].filter(Boolean).join(' ') || `Miembro #${r.id}`,
      status: r.status,
    }));
  }

  /** Asigna la ficha a todos los miembros, a los de ciertos grupos y/o a miembros puntuales. */
  async assign(clubId, formId, { all = false, groupIds = [], memberIds = [] } = {}, actorId) {
    const form = await this._get(clubId, formId);
    let ids = [];
    if (all) {
      ids = await membersRepository.findIdsByClub(clubId);
    } else {
      if (groupIds.length) {
        const groups = await memberGroupsRepository.findByIds(groupIds, clubId);
        if (groups.length !== groupIds.length) throw AppError.badRequest('Uno o más grupos no pertenecen a este club.');
        const options = await membersRepository.findOptions(clubId);
        const wanted = new Set(groupIds.map(Number));
        ids.push(...options.filter((m) => (m.group_ids ? m.group_ids.split(',').map(Number) : []).some((g) => wanted.has(g))).map((m) => m.id));
      }
      if (memberIds.length) ids.push(...(await membersRepository.findByIds(memberIds.map(Number), clubId)).map((m) => m.id));
    }
    const targets = [...new Set(ids)];
    const added = await memberFormsRepository.assign(form.id, targets);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_FORM_ASSIGNED', entityType: 'member_form', entityId: form.id, changes: { added } });
    return { added };
  }

  async unassign(clubId, formId, { memberIds = [] } = {}, actorId) {
    const form = await this._get(clubId, formId);
    const removed = await memberFormsRepository.unassign(form.id, memberIds.map(Number));
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_FORM_UNASSIGNED', entityType: 'member_form', entityId: form.id, changes: { removed } });
    return { removed };
  }

  /** Ficha donde agregar los campos sugeridos: la primera del club o, si no tiene, "Ficha de miembro" nueva. */
  async ensureDefault(clubId, conn) {
    const forms = await memberFormsRepository.findByClub(clubId, conn);
    if (forms.length) return forms[0].id;
    return memberFormsRepository.createForm({ clubId, name: 'Ficha de miembro', sortOrder: 1 }, conn);
  }
}

module.exports = new MemberFormsService();
