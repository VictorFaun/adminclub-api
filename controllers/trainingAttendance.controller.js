const asyncHandler = require('../helpers/asyncHandler');
const { sendWorkbook } = require('../helpers/excel');
const ApiResponse = require('../helpers/ApiResponse');
const trainingAttendanceService = require('../services/trainingAttendance.service');

const listForMember = asyncHandler(async (req, res) => {
  const data = await trainingAttendanceService.listForMember(req.club.id, Number(req.params.memberId), req.user.id, req.authContext);
  return ApiResponse.ok(res, data, 'Asistencia obtenida correctamente.');
});

/** Asistencia de un entrenamiento a Excel: todas las sesiones hasta hoy + % de asistencia. */
const trainingMatrixExport = asyncHandler(async (req, res) => {
  const m = await trainingAttendanceService.getAttendanceMatrix(req.club.id, Number(req.params.trainingId), { all: true }, req.user.id, req.authContext);
  const STATUS = { attended: 'Asistió', absent: 'No asistió', pending: '', frozen: 'Congelado', not_applicable: 'No aplica' };
  const columns = [{ header: 'Miembro', width: 28 }, ...m.sessionDates.map((d) => ({ header: d.split('-').reverse().join('-'), width: 12 })), { header: 'Asistencias', width: 12 }, { header: '% asistencia', width: 12 }];
  const rows = m.rows.map((r) => {
    let attended = 0;
    let counted = 0;
    const cells = m.sessionDates.map((d) => {
      const c = r.cells[d];
      if (!c) return '';
      if (c.displayStatus === 'attended') attended += 1;
      if (c.displayStatus === 'attended' || c.displayStatus === 'absent') counted += 1;
      return STATUS[c.displayStatus] ?? c.displayStatus;
    });
    return [r.memberName + (r.inactive ? ' (retirado)' : ''), ...cells, attended, counted ? Math.round((attended / counted) * 100) / 100 : null];
  });
  return sendWorkbook(res, `Asistencia ${m.training.name}.xlsx`, [{ name: m.training.name.slice(0, 31), columns, rows, freezeColumns: 1 }]);
});

const trainingMatrix = asyncHandler(async (req, res) => {
  const data = await trainingAttendanceService.getAttendanceMatrix(
    req.club.id,
    Number(req.params.trainingId),
    { offset: req.query.offset ? Number(req.query.offset) : undefined, columns: req.query.columns ? Number(req.query.columns) : undefined },
    req.user.id,
    req.authContext
  );
  return ApiResponse.ok(res, data, 'Estado del entrenamiento obtenido correctamente.');
});

const markSession = asyncHandler(async (req, res) => {
  const data = await trainingAttendanceService.markSession(
    req.club.id,
    Number(req.params.trainingId),
    req.params.date,
    Array.isArray(req.body.marks) ? req.body.marks : [],
    req.user.id,
    req.authContext
  );
  return ApiResponse.ok(res, data, 'Asistencia guardada correctamente.');
});

const trainingStats = asyncHandler(async (req, res) => {
  const data = await trainingAttendanceService.getTrainingStats(req.club.id, Number(req.params.trainingId), req.user.id, req.authContext);
  return ApiResponse.ok(res, data, 'Estadísticas obtenidas correctamente.');
});

const markAttendance = asyncHandler(async (req, res) => {
  const data = await trainingAttendanceService.markAttendance(
    req.club.id,
    Number(req.params.trainingId),
    Number(req.params.memberId),
    req.body.sessionDate,
    { status: req.body.status, exemptType: req.body.exemptType, exemptReason: req.body.exemptReason },
    req.user.id,
    req.authContext
  );
  return ApiResponse.ok(res, data, 'Asistencia actualizada correctamente.');
});

const addSession = asyncHandler(async (req, res) => {
  const data = await trainingAttendanceService.addSession(req.club.id, Number(req.params.trainingId), req.body, req.user.id, req.authContext);
  return ApiResponse.created(res, data, 'Día agregado correctamente.');
});

const updateSession = asyncHandler(async (req, res) => {
  const data = await trainingAttendanceService.updateSession(req.club.id, Number(req.params.trainingId), req.params.date, req.body, req.user.id, req.authContext);
  return ApiResponse.ok(res, data, 'Día actualizado correctamente.');
});

const cancelSession = asyncHandler(async (req, res) => {
  await trainingAttendanceService.cancelSession(req.club.id, Number(req.params.trainingId), req.params.date, req.body, req.user.id, req.authContext);
  return ApiResponse.ok(res, null, 'Día cancelado correctamente.');
});

const restoreSession = asyncHandler(async (req, res) => {
  await trainingAttendanceService.restoreSession(req.club.id, Number(req.params.trainingId), req.params.date, req.user.id, req.authContext);
  return ApiResponse.ok(res, null, 'Día restaurado correctamente.');
});

const cancelledSessions = asyncHandler(async (req, res) => {
  const data = await trainingAttendanceService.listCancelledSessions(req.club.id, Number(req.params.trainingId), req.user.id, req.authContext);
  return ApiResponse.ok(res, data, 'Días cancelados obtenidos correctamente.');
});

module.exports = {
  trainingMatrixExport, listForMember, trainingMatrix, markAttendance, markSession, trainingStats, addSession, updateSession, cancelSession, restoreSession, cancelledSessions };
