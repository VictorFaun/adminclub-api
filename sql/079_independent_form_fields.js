/* eslint-disable no-await-in-loop, no-continue */
// ============================================================================
// 079: cada ficha tiene sus propios campos (ya no se comparten entre fichas).
//
// Hasta ahora un campo podía estar en varias fichas y guardaba un solo valor por miembro. Desde
// acá cada campo pertenece a UNA ficha. Los que estaban en varias se separan:
//   * Se queda en la ficha donde se agregó primero (la más antigua: member_form_fields no guarda
//     fecha, y un campo no pudo estar en una ficha antes de que existiera) con su uso especial.
//   * Cada otra ficha recibe una copia independiente (mismo nombre, tipo y opciones; código
//     nuevo; SIN uso especial: queda como campo normal, el uso sigue solo en la primera) con los valores de cada
//     miembro, sus documentos e imágenes (archivos copiados, para que borrar uno no borre el otro),
//     sus versiones guardadas (sql/078) y las solicitudes pendientes apuntando a la copia.
//   * Las condiciones "solo si otro campo tiene un valor" de esa ficha pasan a mirar la copia.
// Al final, member_form_fields.field_id queda único: un campo no puede volver a estar en dos fichas.
// ============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');

const PRIVATE_ROOT = path.join(__dirname, '..', 'private_uploads');
const UPLOAD_ROOT = path.join(__dirname, '..', env.upload.dir);

const parse = (v, fallback) => {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};

/** Copia un archivo con un nombre nuevo en la misma carpeta; devuelve la ruta relativa nueva. */
function copyFile(root, relative, prefix = '') {
  const clean = String(relative).replace(/^\/?uploads\//, '');
  const source = path.join(root, clean);
  if (!source.startsWith(root) || !fs.existsSync(source)) return null;
  const target = path.join(path.dirname(clean), `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(clean)}`);
  fs.copyFileSync(source, path.join(root, target));
  return prefix + target.split(path.sep).join('/');
}

/** Valor de un campo de imagen (una URL o JSON con varias) con cada imagen copiada. */
function copyImageValue(value) {
  if (!value) return value;
  const list = String(value).startsWith('[') ? parse(value, []) : [value];
  const copied = list.map((url) => (/^https?:\/\//i.test(url) ? url : copyFile(UPLOAD_ROOT, url, '/uploads/') || url));
  return String(value).startsWith('[') ? JSON.stringify(copied) : copied[0];
}

module.exports = async (conn) => {
  await conn.beginTransaction();
  try {
    await split(conn);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  }
  // Un campo, una ficha.
  const [[idx]] = await conn.query("SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'member_form_fields' AND index_name = 'uk_mff_field'");
  if (!idx.n) await conn.query('ALTER TABLE member_form_fields ADD UNIQUE KEY uk_mff_field (field_id)');
};

async function split(conn) {
  const [rows] = await conn.query(
    `SELECT ff.field_id, ff.form_id
     FROM member_form_fields ff
     INNER JOIN member_forms f ON f.id = ff.form_id
     WHERE ff.field_id IN (SELECT field_id FROM (SELECT field_id FROM member_form_fields GROUP BY field_id HAVING COUNT(*) > 1) x)
     ORDER BY ff.field_id, f.created_at ASC, f.id ASC`
  );
  const byField = new Map();
  for (const r of rows) {
    if (!byField.has(r.field_id)) byField.set(r.field_id, []);
    byField.get(r.field_id).push(r.form_id);
  }
  console.log(`[079] Campos compartidos: ${byField.size}`);

  // Por ficha: campo original → copia (ids, códigos, documentos).
  const perForm = new Map();
  const formMap = (formId) => {
    if (!perForm.has(formId)) perForm.set(formId, { ids: new Map(), codes: new Map(), docs: new Map() });
    return perForm.get(formId);
  };

  for (const [fieldId, formIds] of byField) {
    const [[field]] = await conn.query('SELECT * FROM member_fields WHERE id = ?', [fieldId]);
    if (!field) continue;
    for (const formId of formIds.slice(1)) {
      // Código nuevo libre en el club.
      let n = 2;
      let code = `${field.code}-${n}`;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const [[taken]] = await conn.query('SELECT id FROM member_fields WHERE club_id = ? AND code = ?', [field.club_id, code]);
        if (!taken) break;
        n += 1;
        code = `${field.code}-${n}`;
      }
      const [res] = await conn.query(
        `INSERT INTO member_fields (club_id, code, label, field_type, role, options, settings, help_text, is_required, in_public_form, sort_order)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
        [field.club_id, code, field.label, field.field_type, field.options, field.settings, field.help_text, field.is_required, field.in_public_form, field.sort_order]
      );
      const copyId = res.insertId;
      const map = formMap(formId);
      map.ids.set(fieldId, copyId);
      map.codes.set(field.code, code);
      await conn.query('UPDATE member_form_fields SET field_id = ? WHERE form_id = ? AND field_id = ?', [copyId, formId, fieldId]);

      // Valores de cada miembro (las imágenes, con su archivo copiado).
      // Solo de quienes responden esa ficha.
      const [values] = await conn.query('SELECT v.member_id, v.value FROM member_field_values v INNER JOIN member_form_members mfm ON mfm.member_id = v.member_id AND mfm.form_id = ? WHERE v.field_id = ?', [formId, fieldId]);
      for (const v of values) {
        const value = field.field_type === 'image' ? copyImageValue(v.value) : v.value;
        await conn.query('INSERT INTO member_field_values (member_id, field_id, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)', [v.member_id, copyId, value]);
      }

      // Documentos (archivo copiado).
      const [docs] = await conn.query('SELECT d.* FROM member_documents d INNER JOIN member_form_members mfm ON mfm.member_id = d.member_id AND mfm.form_id = ? WHERE d.field_id = ?', [formId, fieldId]);
      for (const d of docs) {
        const filePath = copyFile(PRIVATE_ROOT, d.file_path);
        if (!filePath) continue;
        const [ins] = await conn.query(
          `INSERT INTO member_documents (uuid, club_id, member_id, field_id, name, file_path, mime_type, size_bytes, uploaded_by, archived_at, created_at)
           VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [d.club_id, d.member_id, copyId, d.name, filePath, d.mime_type, d.size_bytes, d.uploaded_by, d.archived_at, d.created_at]
        );
        map.docs.set(d.id, ins.insertId);
      }

      // Archivos de solicitudes pendientes que responden esta ficha y no la dueña.
      const [appFiles] = await conn.query(
        `SELECT af.id, a.form_ids FROM member_application_files af
         INNER JOIN member_applications a ON a.id = af.application_id
         WHERE af.field_id = ? AND a.status = 'pending'`,
        [fieldId]
      );
      for (const af of appFiles) {
        const ids = parse(af.form_ids, []).map(Number);
        if (ids.includes(formId) && !ids.includes(formIds[0])) await conn.query('UPDATE member_application_files SET field_id = ? WHERE id = ?', [copyId, af.id]);
      }
    }
  }

  for (const [formId, map] of perForm) {
    // Condiciones de los campos de la ficha que miraban un campo ahora copiado.
    const [fields] = await conn.query('SELECT mf.id, mf.settings FROM member_fields mf INNER JOIN member_form_fields ff ON ff.field_id = mf.id WHERE ff.form_id = ?', [formId]);
    for (const f of fields) {
      const settings = parse(f.settings, null);
      const cond = settings?.condition;
      if (cond?.type === 'field_eq' && map.codes.has(cond.field)) {
        settings.condition = { ...cond, field: map.codes.get(cond.field) };
        await conn.query('UPDATE member_fields SET settings = ? WHERE id = ?', [JSON.stringify(settings), f.id]);
      }
    }

    // Versiones guardadas de esta ficha: valores y documentos pasan a la copia.
    const [versions] = await conn.query('SELECT id, snapshot FROM member_form_versions WHERE form_id = ? AND snapshot IS NOT NULL', [formId]);
    for (const v of versions) {
      const snap = parse(v.snapshot, null);
      if (!snap) continue;
      const remapKeys = (obj, fn = (x) => x) => Object.fromEntries(Object.entries(obj || {}).map(([k, val]) => [String(map.ids.get(Number(k)) ?? k), fn(val)]));
      snap.values = remapKeys(snap.values);
      snap.documents = remapKeys(snap.documents, (ids) => ids.map((id) => map.docs.get(Number(id)) ?? id));
      await conn.query('UPDATE member_form_versions SET snapshot = ? WHERE id = ?', [JSON.stringify(snap), v.id]);
    }

    // Solicitudes pendientes de esta ficha: la respuesta también con el código de la copia.
    const [apps] = await conn.query("SELECT id, fields, form_ids FROM member_applications WHERE status = 'pending'");
    for (const a of apps) {
      if (!parse(a.form_ids, []).map(Number).includes(formId)) continue;
      const fields = parse(a.fields, {});
      let changed = false;
      for (const [oldCode, newCode] of map.codes) {
        if (Object.prototype.hasOwnProperty.call(fields, oldCode) && !Object.prototype.hasOwnProperty.call(fields, newCode)) {
          fields[newCode] = fields[oldCode];
          changed = true;
        }
      }
      if (changed) await conn.query('UPDATE member_applications SET fields = ? WHERE id = ?', [JSON.stringify(fields), a.id]);
    }
  }

  console.log(`[079] Copias creadas: ${[...perForm.values()].reduce((n, m) => n + m.ids.size, 0)}`);

  // Invitaciones con fichas: la del Identificador va siempre (memberForms.service.js#withIdentifierForm).
  // Una invitación con solo una ficha que perdió el uso especial (ej. "Ficha sub 18") quedaría sin
  // identificador ni nombre: se le suma la ficha que lo tiene.
  const [added] = await conn.query(
    `INSERT INTO invitation_forms (invitation_id, form_id)
     SELECT DISTINCT inv.invitation_id, idf.form_id
     FROM invitation_forms inv
     INNER JOIN invitations i ON i.id = inv.invitation_id
     INNER JOIN member_fields mf ON mf.club_id = i.club_id AND mf.role = 'identifier'
     INNER JOIN member_form_fields idf ON idf.field_id = mf.id
     WHERE NOT EXISTS (SELECT 1 FROM invitation_forms x WHERE x.invitation_id = inv.invitation_id AND x.form_id = idf.form_id)`
  );
  console.log(`[079] Invitaciones que suman la ficha del identificador: ${added.affectedRows}`);
}
