/**
 * Tipos de campo de la ficha de miembro y "usos especiales" (ver sql/052_member_form_fully_custom.sql).
 * La ficha es 100% configurable: todos los datos del miembro son campos; un campo puede además
 * tener un uso especial para que el resto de la app sepa qué es (nombre, identificador, etc.).
 */
const AppError = require('./AppError');
const { normalizeRut } = require('./rut');

const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'boolean', 'select', 'radio', 'multiselect', 'email', 'phone', 'rut', 'address', 'image', 'file', 'section'];
/** Tipos con lista de opciones. */
const OPTION_TYPES = ['select', 'radio', 'multiselect'];
/** Tipos cuyo valor se sube como archivo (no van en el JSON de la ficha). */
const UPLOAD_TYPES = ['image', 'file'];
/** Tipos que no guardan ningún valor (solo ordenan el formulario). */
const LAYOUT_TYPES = ['section'];
/** Condiciones para mostrar un campo (o una sección entera). */
const CONDITION_TYPES = ['age_lt', 'age_gte', 'field_eq'];

/** Proporciones de recorte permitidas para los campos de imagen. */
const IMAGE_ASPECTS = ['1:1', '4:5', '9:16', '16:9'];

/** Formatos que puede aceptar un campo de documento (cada uno con sus mimetypes). */
const DOC_FORMATS = {
  pdf: { label: 'PDF', mimes: ['application/pdf'] },
  image: { label: 'Imagen (JPG, PNG, WEBP)', mimes: ['image/png', 'image/jpeg', 'image/webp'] },
  word: { label: 'Word', mimes: ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  excel: { label: 'Excel', mimes: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] },
};
const MAX_FILES_MULTIPLE = 5;

/** Ajustes propios del tipo (`member_fields.settings`), con valores por defecto. */
function parseSettings(field) {
  // Siempre devuelve un objeto (los tipos sin ajustes → {}).
  let raw = field.settings;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  return normalizeSettings(field.field_type, raw, field.role) || {};
}

/** Usos especiales de imagen con proporción obligatoria (y siempre una sola imagen). */
const FIXED_IMAGE_ROLES = { birthday_photo: '9:16', avatar: '1:1' };

/** `{ type: 'age_lt'|'age_gte', value: años }` o `{ type: 'field_eq', field: código, value: texto }`. */
function normalizeCondition(raw) {
  if (!raw || typeof raw !== 'object' || !CONDITION_TYPES.includes(raw.type)) return null;
  if (raw.type === 'field_eq') {
    const field = String(raw.field || '').trim().slice(0, 60);
    if (!field) return null;
    return { type: 'field_eq', field, value: String(raw.value ?? '').trim().slice(0, 120) };
  }
  const value = Math.round(Number(raw.value));
  if (!Number.isFinite(value) || value < 1 || value > 120) return null;
  return { type: raw.type, value };
}

/** Edad (años cumplidos) a una fecha de referencia, desde 'YYYY-MM-DD'. */
function ageAt(birthDate, reference = new Date()) {
  if (!birthDate) return null;
  const [y, m, d] = String(birthDate).slice(0, 10).split('-').map(Number);
  if (!y) return null;
  let age = reference.getUTCFullYear() - y;
  if (reference.getUTCMonth() + 1 < m || (reference.getUTCMonth() + 1 === m && reference.getUTCDate() < d)) age -= 1;
  return age;
}

/**
 * ¿Se muestra el campo con estos valores? (`values` = { código: valor }). Sin condición → sí.
 * Edad: según el campo con uso "fecha de nacimiento"; sin fecha todavía, se muestra.
 * `sectionCondition`: la condición de la sección a la que pertenece (vale para todos sus campos).
 */
function isFieldVisible(field, values, catalog, sectionCondition = null) {
  const own = parseSettings(field).condition || null;
  for (const condition of [sectionCondition, own]) {
    if (!condition) continue;
    if (condition.type === 'field_eq') {
      const raw = values[condition.field];
      const list = Array.isArray(raw) ? raw.map(String) : raw === null || raw === undefined ? [] : [String(raw)];
      if (!list.includes(condition.value)) return false;
    } else {
      const birthField = catalog.find((f) => f.role === 'birth_date');
      const age = ageAt(birthField ? values[birthField.code] : null);
      if (age === null) continue;
      if (condition.type === 'age_lt' && !(age < condition.value)) return false;
      if (condition.type === 'age_gte' && !(age >= condition.value)) return false;
    }
  }
  return true;
}

/** Condición de la sección a la que pertenece cada campo (por id), según el orden de la ficha. */
function sectionConditions(catalog) {
  const map = new Map();
  let current = null;
  for (const f of [...catalog].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)) {
    if (f.field_type === 'section') {
      current = parseSettings(f).condition || null;
      continue;
    }
    map.set(f.id, current);
  }
  return map;
}

/** Anchos posibles de un campo en la grilla del formulario/ficha (fracción de la fila). */
const FIELD_WIDTHS = ['1/4', '1/3', '1/2', '2/3', '3/4', 'full'];

/**
 * Valida/normaliza los ajustes de un campo. Cualquier tipo: `width` (ancho en la grilla; sin él,
 * el automático del tipo). Imagen: proporción y si admite varias; documento: formatos y si admite
 * varios. `null` si no hay nada que guardar.
 */
function normalizeSettings(fieldType, raw, role = null) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  if (FIELD_WIDTHS.includes(s.width) && fieldType !== 'section') out.width = s.width;
  // Sensible: solo lo ven/editan quienes tienen VIEW_SENSITIVE_MEMBER_FIELDS.
  if (s.sensitive && fieldType !== 'section') out.sensitive = true;
  // Condición para mostrarlo (en una sección, vale para todos sus campos).
  const condition = normalizeCondition(s.condition);
  if (condition) out.condition = condition;
  if (fieldType === 'image') {
    // Las fotos con uso especial son siempre UNA y con proporción fija: la de cumpleaños, la de
    // la plantilla (9:16); la de perfil, cuadrada (avatares).
    const fixed = FIXED_IMAGE_ROLES[role];
    out.aspect = fixed ? fixed : IMAGE_ASPECTS.includes(s.aspect) ? s.aspect : '1:1';
    out.multiple = fixed ? false : !!s.multiple;
  }
  if (fieldType === 'file') {
    const formats = Array.isArray(s.formats) ? [...new Set(s.formats.filter((f) => DOC_FORMATS[f]))] : [];
    out.formats = formats.length ? formats : ['pdf', 'image', 'word'];
    out.multiple = !!s.multiple;
  }
  return Object.keys(out).length ? out : null;
}

/** Máximo de archivos de un campo de imagen o documento (1, o 5 si admite varios). */
function maxFilesOf(field) {
  return parseSettings(field).multiple ? MAX_FILES_MULTIPLE : 1;
}

/** Valor guardado de un campo de imagen → lista de URLs (una sola: texto; varias: JSON). */
function imageList(value) {
  if (!value) return [];
  if (String(value).startsWith('[')) {
    try {
      return JSON.parse(value).filter(Boolean).map(String);
    } catch {
      return [];
    }
  }
  return [String(value)];
}

/** Mimetypes aceptados por un campo de documento. */
function acceptedMimes(field) {
  return parseSettings(field).formats.flatMap((f) => DOC_FORMATS[f].mimes);
}

/** Usos especiales: qué tipos admite cada uno. Un uso por club. */
const ROLES = {
  first_name: { label: 'Nombre', types: ['text'] },
  middle_name: { label: 'Segundo nombre', types: ['text'] },
  last_name: { label: 'Apellido', types: ['text'] },
  second_last_name: { label: 'Segundo apellido', types: ['text'] },
  identifier: { label: 'Identificador (RUT, DNI…)', types: ['rut', 'text', 'number'] },
  birth_date: { label: 'Fecha de nacimiento', types: ['date'] },
  email: { label: 'Correo de contacto', types: ['email'] },
  phone: { label: 'Teléfono de contacto', types: ['phone'] },
  birthday_photo: { label: 'Foto para cumpleaños', types: ['image'] },
  avatar: { label: 'Foto de perfil (avatar)', types: ['image'] },
};

/** Ficha sugerida: se precarga en cada club nuevo y se puede restaurar desde Configuración. */
const SUGGESTED_FIELDS = [
  { code: 'nombre', label: 'Primer nombre', fieldType: 'text', role: 'first_name', isRequired: true },
  { code: 'segundo-nombre', label: 'Segundo nombre', fieldType: 'text', role: 'middle_name' },
  { code: 'apellido', label: 'Primer apellido', fieldType: 'text', role: 'last_name', isRequired: true },
  { code: 'segundo-apellido', label: 'Segundo apellido', fieldType: 'text', role: 'second_last_name' },
  { code: 'rut', label: 'RUT', fieldType: 'rut', role: 'identifier' },
  { code: 'fecha-nacimiento', label: 'Fecha de nacimiento', fieldType: 'date', role: 'birth_date' },
  { code: 'correo', label: 'Correo', fieldType: 'email', role: 'email' },
  { code: 'telefono', label: 'Teléfono', fieldType: 'phone', role: 'phone' },
  { code: 'foto-perfil', label: 'Foto de perfil', fieldType: 'image', role: 'avatar', settings: { aspect: '1:1' } },
  { code: 'foto', label: 'Foto para cumpleaños', fieldType: 'image', role: 'birthday_photo', settings: { aspect: '9:16' } },
  { code: 'documentos', label: 'Documentos', fieldType: 'file', role: null, settings: { formats: ['pdf', 'image', 'word'], multiple: true } },
];

const MAX_LENGTH = { text: 255, textarea: 2000, email: 255, phone: 30, address: 1000, number: 30 };

const parseOptions = (field) => {
  const raw = field.options;
  if (Array.isArray(raw)) return raw.map(String);
  if (!raw) return [];
  try {
    return JSON.parse(raw).map(String);
  } catch {
    return [];
  }
};

/**
 * Normaliza y valida el valor de un campo (fila de member_fields) según su tipo. Devuelve el
 * string a guardar, o `null` si está vacío. Lanza 400 con un mensaje claro si no es válido.
 */
function normalizeValue(field, raw) {
  const type = field.field_type;
  if (UPLOAD_TYPES.includes(type) || LAYOUT_TYPES.includes(type)) return undefined; // se suben aparte / no guardan valor
  const label = field.label;
  if (raw === undefined || raw === null) return null;

  if (type === 'boolean') {
    if (raw === true || raw === 'true' || raw === 1 || raw === '1') return 'true';
    if (raw === false || raw === 'false' || raw === 0 || raw === '0' || raw === '') return 'false';
    throw AppError.badRequest(`Valor inválido para "${label}".`);
  }
  if (type === 'multiselect') {
    let list = raw;
    if (typeof raw === 'string') {
      try {
        list = raw.trim() ? JSON.parse(raw) : [];
      } catch {
        list = raw.split(',');
      }
    }
    if (!Array.isArray(list)) throw AppError.badRequest(`Valor inválido para "${label}".`);
    const options = parseOptions(field);
    const values = [...new Set(list.map((v) => String(v).trim()).filter(Boolean))];
    const invalid = values.filter((v) => !options.includes(v));
    if (invalid.length) throw AppError.badRequest(`Valor inválido para "${label}": ${invalid.join(', ')}.`);
    return values.length ? JSON.stringify(values) : null;
  }

  const value = String(raw).trim();
  if (!value) return null;
  if (value.length > (MAX_LENGTH[type] ?? 255)) throw AppError.badRequest(`"${label}" es demasiado largo.`);

  switch (type) {
    case 'number': {
      const n = Number(value.replace(',', '.'));
      if (!Number.isFinite(n)) throw AppError.badRequest(`"${label}" debe ser un número.`);
      return String(n);
    }
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(new Date(value.slice(0, 10)).getTime())) throw AppError.badRequest(`"${label}" no es una fecha válida.`);
      return value.slice(0, 10);
    }
    case 'select':
    case 'radio':
      if (!parseOptions(field).includes(value)) throw AppError.badRequest(`Valor inválido para "${label}".`);
      return value;
    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw AppError.badRequest(`"${label}" no es un correo válido.`);
      return value.toLowerCase();
    case 'rut': {
      const rut = normalizeRut(value);
      if (!rut) throw AppError.badRequest(`"${label}" no es un RUT válido. Escríbelo así: 12345678-9.`);
      return rut;
    }
    default:
      return value;
  }
}

/** Forma comparable de un identificador (para buscarlo en la página pública / evitar duplicados). */
function normalizeIdentifier(field, raw) {
  if (raw === undefined || raw === null) return null;
  if (field.field_type === 'rut') return normalizeRut(raw);
  const value = String(raw).trim();
  return value ? value.toUpperCase() : null;
}

module.exports = {
  FIELD_TYPES,
  OPTION_TYPES,
  UPLOAD_TYPES,
  LAYOUT_TYPES,
  CONDITION_TYPES,
  isFieldVisible,
  sectionConditions,
  ageAt,
  ROLES,
  SUGGESTED_FIELDS,
  IMAGE_ASPECTS,
  FIELD_WIDTHS,
  DOC_FORMATS,
  MAX_FILES_MULTIPLE,
  normalizeValue,
  normalizeIdentifier,
  parseOptions,
  parseSettings,
  normalizeSettings,
  acceptedMimes,
  maxFilesOf,
  imageList,
};
