const asyncHandler = require('../helpers/asyncHandler');
const { sendWorkbook } = require('../helpers/excel');
const debtRemindersService = require('../services/debtReminders.service');
const receiptsService = require('../services/receipts.service');
const paymentsRepository = require('../repositories/payments.repository');
const AppError = require('../helpers/AppError');
const ApiResponse = require('../helpers/ApiResponse');
const paymentsService = require('../services/payments.service');

const dashboard = asyncHandler(async (req, res) => {
  const data = await paymentsService.getDashboard(req.club.id, req.authContext, req.user.id);
  return ApiResponse.ok(res, data, 'Resumen de tesorería obtenido correctamente.');
});

const listForMember = asyncHandler(async (req, res) => {
  const data = await paymentsService.listForMember(req.club.id, Number(req.params.memberId), req.user.id, req.authContext);
  return ApiResponse.ok(res, data, 'Pagos obtenidos correctamente.');
});

/** Matriz de un cobro a Excel: una fila por miembro, una columna por período (monto pagado o estado). */
const remindersPreview = asyncHandler(async (req, res) => {
  const data = await debtRemindersService.preview(req.club.id, req.query.chargeId ? Number(req.query.chargeId) : null);
  return ApiResponse.ok(res, data, 'Deudores obtenidos correctamente.');
});

const updateRemindersSettings = asyncHandler(async (req, res) => {
  const data = await debtRemindersService.updateSettings(req.club.id, req.body || {}, req.user.id);
  return ApiResponse.ok(res, data, 'Recordatorios actualizados correctamente.');
});

const sendReminders = asyncHandler(async (req, res) => {
  const data = await debtRemindersService.send(req.club.id, req.user.id, req.body?.chargeId ? Number(req.body.chargeId) : null);
  return ApiResponse.ok(res, data, `Se enviaron ${data.sent} recordatorios.`);
});

const receipt = asyncHandler(async (req, res) => {
  const payment = await paymentsRepository.findActiveById(Number(req.params.id));
  if (!payment || payment.club_id !== req.club.id) throw AppError.notFound('Pago no encontrado.');
  await paymentsService.assertMemberPaymentsAccessible(req.club.id, payment.member_id, req.user.id, req.authContext);
  const { buffer, filename } = await receiptsService.buildPdf(req.club.id, [payment.id]);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  return res.send(buffer);
});

const chargeMatrixExport = asyncHandler(async (req, res) => {
  const m = await paymentsService.getChargeMatrix(req.club.id, Number(req.params.chargeId), { year: req.query.year ? Number(req.query.year) : undefined }, req.user.id, req.authContext);
  const STATUS = { paid: 'Pagado', partial: 'Abonado', pending: 'Pendiente', overdue: 'Atrasado', exempt: 'Congelado', not_applicable: 'No aplica', upcoming: '' };
  const periods = m.periods || [];
  const columns = [{ header: 'Miembro', width: 28 }, ...periods.map((p) => ({ header: p.label, width: 14 })), { header: 'Pagado', type: 'money', width: 14 }, { header: 'Deuda vencida', type: 'money', width: 14 }];
  const rows = m.rows.map((r) => {
    let paid = 0;
    let debt = 0;
    const cells = periods.map((p) => {
      const c = r.cells[p.key];
      if (!c) return '';
      paid += Number(c.paidAmount || 0);
      if (c.displayStatus === 'overdue' || (c.displayStatus === 'partial' && new Date(c.dueDate) < new Date())) debt += Math.max(0, Number(c.amount) - Number(c.paidAmount || 0));
      if (c.displayStatus === 'paid') return Number(c.paidAmount || c.amount);
      if (c.displayStatus === 'partial') return `Abonado ${Number(c.paidAmount).toLocaleString('es-CL')} de ${Number(c.amount).toLocaleString('es-CL')}`;
      return STATUS[c.displayStatus] ?? c.displayStatus;
    });
    return [r.memberName + (r.inactive ? ' (retirado)' : ''), ...cells, paid, debt];
  });
  const name = `${m.charge.name}${m.year ? ' ' + m.year : ''}`;
  return sendWorkbook(res, `${name}.xlsx`, [{ name: name.slice(0, 31), columns, rows, freezeColumns: 1, notes: ['Números = monto pagado del período.'] }]);
});

const chargeMatrix = asyncHandler(async (req, res) => {
  const data = await paymentsService.getChargeMatrix(
    req.club.id,
    Number(req.params.chargeId),
    { anchor: req.query.anchor, columns: req.query.columns ? Number(req.query.columns) : undefined, year: req.query.year ? Number(req.query.year) : undefined },
    req.user.id,
    req.authContext
  );
  return ApiResponse.ok(res, data, 'Estado del cobro obtenido correctamente.');
});

const ensureInstance = asyncHandler(async (req, res) => {
  const data = await paymentsService.ensureInstance(
    req.club.id,
    Number(req.params.chargeId),
    Number(req.params.memberId),
    req.body.periodKey,
    req.user.id,
    req.authContext
  );
  return ApiResponse.ok(res, data, 'Período preparado correctamente.');
});

const listForInstance = asyncHandler(async (req, res) => {
  const data = await paymentsService.listForInstance(req.club.id, Number(req.params.instanceId), req.user.id, req.authContext);
  return ApiResponse.ok(res, data, 'Pagos del período obtenidos correctamente.');
});

// PAYMENT_CREATED se registra en payments.service.js#create (con el id real), no acá.
const create = asyncHandler(async (req, res) => {
  const payment = await paymentsService.create(req.club.id, req.body, req.user.id, req.authContext);
  return ApiResponse.created(res, payment, 'Pago registrado correctamente.');
});

const update = asyncHandler(async (req, res) => {
  const payment = await paymentsService.update(req.club.id, Number(req.params.id), req.body, req.user.id, req.authContext);
  return ApiResponse.ok(res, payment, 'Pago actualizado correctamente.');
});

const remove = asyncHandler(async (req, res) => {
  await paymentsService.remove(req.club.id, Number(req.params.id), req.user.id, req.authContext);
  return ApiResponse.ok(res, null, 'Pago eliminado correctamente.');
});

const exemptInstance = asyncHandler(async (req, res) => {
  await paymentsService.exemptInstance(req.club.id, Number(req.params.instanceId), req.body.reason, req.body.type, req.user.id, req.authContext);
  return ApiResponse.ok(res, null, 'Período marcado correctamente.');
});

const unexemptInstance = asyncHandler(async (req, res) => {
  await paymentsService.unexemptInstance(req.club.id, Number(req.params.instanceId), req.user.id, req.authContext);
  return ApiResponse.ok(res, null, 'Exención eliminada correctamente.');
});

const exemptMany = asyncHandler(async (req, res) => {
  const result = await paymentsService.exemptMany(
    req.club.id,
    req.body.instanceIds,
    req.body.reason,
    req.body.type,
    req.user.id,
    req.authContext
  );
  return ApiResponse.ok(res, result, 'Períodos marcados correctamente.');
});

const listSettlements = asyncHandler(async (req, res) => {
  const data = await paymentsService.listSettlements(
    req.club.id,
    Number(req.params.chargeId),
    req.params.periodKey,
    Number(req.query.responsibleMemberId),
    req.user.id,
    req.authContext
  );
  return ApiResponse.ok(res, data, 'Transferencias obtenidas correctamente.');
});

const createSettlement = asyncHandler(async (req, res) => {
  const data = await paymentsService.createSettlement(req.club.id, Number(req.params.chargeId), req.body, req.user.id, req.authContext);
  return ApiResponse.created(res, data, 'Transferencia registrada correctamente.');
});

const updateSettlement = asyncHandler(async (req, res) => {
  const data = await paymentsService.updateSettlement(req.club.id, Number(req.params.id), req.body, req.user.id, req.authContext);
  return ApiResponse.ok(res, data, 'Transferencia actualizada correctamente.');
});

const removeSettlement = asyncHandler(async (req, res) => {
  await paymentsService.removeSettlement(req.club.id, Number(req.params.id), req.user.id, req.authContext);
  return ApiResponse.ok(res, null, 'Transferencia eliminada correctamente.');
});

module.exports = {
  remindersPreview,
  updateRemindersSettings,
  sendReminders,
  receipt,
  chargeMatrixExport,
  dashboard,
  listForMember,
  chargeMatrix,
  ensureInstance,
  listForInstance,
  create,
  update,
  remove,
  exemptInstance,
  unexemptInstance,
  exemptMany,
  listSettlements,
  createSettlement,
  updateSettlement,
  removeSettlement,
};
