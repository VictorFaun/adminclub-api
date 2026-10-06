/**
 * Datos de una cuenta de destino de pagos (transferencia). Misma forma para las cuentas de
 * Tesorería (`treasury_accounts`, una columna por campo) y para la cuenta de un responsable de
 * cobro (`charge_responsible_members.account`, JSON).
 */
const ACCOUNT_FIELDS = {
  bankName: 100,
  accountType: 60,
  accountNumber: 60,
  holderName: 150,
  holderRut: 12,
  email: 150,
  notes: 500,
};

/** Limpia lo que llega de la API: solo campos conocidos, recortados; `null` si no trae nada. */
function normalizeAccount(input) {
  if (!input || typeof input !== 'object') return null;
  const account = {};
  for (const [field, max] of Object.entries(ACCOUNT_FIELDS)) {
    const value = input[field] == null ? '' : String(input[field]).trim().slice(0, max);
    account[field] = value || null;
  }
  return Object.values(account).some(Boolean) ? account : null;
}

/** La columna JSON llega ya parseada (MySQL) o como texto (MariaDB). */
function parseAccount(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return normalizeAccount(raw);
  try {
    return normalizeAccount(JSON.parse(raw));
  } catch {
    return null;
  }
}

function treasuryAccountToDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    bankName: row.bank_name,
    accountType: row.account_type,
    accountNumber: row.account_number,
    holderName: row.holder_name,
    holderRut: row.holder_rut,
    email: row.email,
    notes: row.notes,
  };
}

/** Nombre de la cuenta que todo club tiene siempre (se crea con el club, sin datos). */
const DEFAULT_TREASURY_ACCOUNT_NAME = 'Cuenta principal';

module.exports = { DEFAULT_TREASURY_ACCOUNT_NAME, ACCOUNT_FIELDS, normalizeAccount, parseAccount, treasuryAccountToDto };
