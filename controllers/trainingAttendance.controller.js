const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const trainingAttendanceService = require('../services/trainingAttendance.service');

const listForMember = asyncHandler(async (req, res) => {
  const data = await trainingAttendanceService.listForMember(req.club.id, Number(req.params.memberId), req.user.id, req.authContext);
  return ApiResponse.ok(res, data, 'Asistencia obtenida correctamente.');
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

module.exports = { listForMember, trainingMatrix, markAttendance };
