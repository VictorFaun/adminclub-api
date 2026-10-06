const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const treasurySettingsService = require('../services/treasurySettings.service');
const treasuryAccountsService = require('../services/treasuryAccounts.service');

const getStatusColors = asyncHandler(async (req, res) => {
  const colors = await treasurySettingsService.getStatusColors(req.club.id);
  return ApiResponse.ok(res, colors, 'Colores de estado obtenidos correctamente.');
});

const updateStatusColors = asyncHandler(async (req, res) => {
  const colors = await treasurySettingsService.updateStatusColors(req.club.id, req.body.colors, req.user.id);
  return ApiResponse.ok(res, colors, 'Colores de estado actualizados correctamente.');
});

const getMonthPolicy = asyncHandler(async (req, res) => {
  const data = await treasurySettingsService.getMonthPolicy(req.club.id);
  return ApiResponse.ok(res, data, 'Política obtenida correctamente.');
});

const updateMonthPolicy = asyncHandler(async (req, res) => {
  const data = await treasurySettingsService.updateMonthPolicy(req.club.id, req.body, req.user.id);
  return ApiResponse.ok(res, data, 'Política actualizada: los períodos sin pagos se recalcularon.');
});

// --- Cuentas de Tesorería ---
const listAccounts = asyncHandler(async (req, res) => {
  const data = await treasuryAccountsService.list(req.club.id);
  return ApiResponse.ok(res, data, 'Cuentas obtenidas correctamente.');
});

const createAccount = asyncHandler(async (req, res) => {
  const data = await treasuryAccountsService.create(req.club.id, req.body, req.user.id);
  return ApiResponse.created(res, data, 'Cuenta creada correctamente.');
});

const updateAccount = asyncHandler(async (req, res) => {
  const data = await treasuryAccountsService.update(req.club.id, Number(req.params.id), req.body, req.user.id);
  return ApiResponse.ok(res, data, 'Cuenta actualizada correctamente.');
});

const accountUsage = asyncHandler(async (req, res) => {
  const data = await treasuryAccountsService.usage(req.club.id, Number(req.params.id));
  return ApiResponse.ok(res, data, 'Uso de la cuenta obtenido correctamente.');
});

const deleteAccount = asyncHandler(async (req, res) => {
  await treasuryAccountsService.remove(req.club.id, Number(req.params.id), { transferToAccountId: req.body?.transferToAccountId ?? null }, req.user.id);
  return ApiResponse.ok(res, null, 'Cuenta eliminada correctamente.');
});

const accountBalances = asyncHandler(async (req, res) => {
  const data = await treasuryAccountsService.balances(req.club.id);
  return ApiResponse.ok(res, data, 'Saldos obtenidos correctamente.');
});

const listTransfers = asyncHandler(async (req, res) => {
  const data = await treasuryAccountsService.listTransfers(req.club.id);
  return ApiResponse.ok(res, data, 'Transferencias obtenidas correctamente.');
});

const createTransfer = asyncHandler(async (req, res) => {
  const data = await treasuryAccountsService.transfer(req.club.id, req.body, req.user.id);
  return ApiResponse.created(res, data, 'Transferencia registrada correctamente.');
});

module.exports = {
  getMonthPolicy,
  updateMonthPolicy,
  getStatusColors,
  updateStatusColors,
  listAccounts,
  createAccount,
  updateAccount,
  accountUsage,
  deleteAccount,
  accountBalances,
  listTransfers,
  createTransfer,
};
