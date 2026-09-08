const trainingsRepository = require('../repositories/trainings.repository');
const trainingAttendancesRepository = require('../repositories/trainingAttendances.repository');
const membersRepository = require('../repositories/members.repository');
const membersService = require('./members.service');
const auditRepository = require('../repositories/audit.repository');
const permissionService = require('./permission.service');
const AppError = require('../helpers/AppError');
const { pool } = require('../config/database');
const { FUNCTIONS } = require('../config/constants');

// Ventana rodante de generación: bastante más ancha que "actual+siguiente" de Cobros porque acá
// la granularidad es semanal, no mensual — hace falta ventana para que la matriz tenga columnas
// suficientes sin depender de que el cron corra todos los días.
const GENERATION_WINDOW_DAYS = 56;
const MIN_WINDOW_SIZE = 1;
const MAX_WINDOW_SIZE = 18;
const DEFAULT_WINDOW_SIZE = 12;
const MARKABLE_STATUSES = ['pending', 'attended', 'absent', 'exempt'];

const pad = (n) => String(n).padStart(2, '0');
function formatDateOnly(date) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
/** JS `getUTCDay()` es 0=domingo..6=sábado; ISO (usado en `training_schedules.day_of_week`) es
 * 1=lunes..7=domingo. */
function isoDayOfWeek(date) {
  const jsDay = date.getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

/**
 * Mirror de chargeInstances.service.js + payments.service.js para lo que aplica a asistencia:
 * generación idempotente de sesiones (`INSERT IGNORE`), acceso acotado por responsable
 * (entrenador) con prioridad de grupo, y una matriz miembro×fecha en vez de miembro×período.
 * Sin dinero de por medio: una marca de asistencia es una sola mutación (no hay "abono parcial"
 * ni "a quién se le paga").
 */
class TrainingAttendanceService {
  /** "Primer nombre + primer apellido" — mismo criterio que payments.service.js#_shortName. */
  _shortName(m) {
    return [m.first_name, m.last_name].filter(Boolean).join(' ');
  }

  /** `exempt` se abre en dos etiquetas según `exempt_type`, igual criterio que
   * payments.service.js#_resolveDisplayStatus — acá no hay "overdue" calculado (no se pidió). */
  _resolveDisplayStatus(row) {
    if (row.status === 'exempt') return row.exempt_type === 'not_applicable' ? 'not_applicable' : 'frozen';
    return row.status;
  }

  _matrixCellToDto(row) {
    return {
      id: row.id,
      sessionDate: formatDateOnly(row.session_date),
      status: row.status,
      displayStatus: this._resolveDisplayStatus(row),
      exemptReason: row.exempt_reason,
      exemptType: row.exempt_type,
    };
  }

  _virtualCellToDto(sessionDate) {
    return { id: null, sessionDate, status: 'pending', displayStatus: 'pending', exemptReason: null, exemptType: null };
  }

  _attendanceToDto(row) {
    return {
      id: row.id,
      uuid: row.uuid,
      trainingId: row.training_id,
      trainingName: row.training_name,
      trainingColor: row.training_color,
      sessionDate: formatDateOnly(row.session_date),
      status: row.status,
      displayStatus: this._resolveDisplayStatus(row),
      exemptReason: row.exempt_reason,
      exemptType: row.exempt_type,
    };
  }

  // --- Generación de sesiones (mirror de chargeInstances.service.js) ---

  /** Fechas de sesión dentro de la ventana rodante, respetando `start_date`/`end_date` — mismo
   * criterio de "no generar fuera de la ventana en que el entrenamiento corresponde" que
   * chargeInstances.service.js#_computePeriods. */
  _computeSessionDates(schedules, startDate, endDate, referenceDate = new Date()) {
    const today = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
    const rangeStart = new Date(Math.max(today.getTime(), new Date(startDate).getTime()));
    const windowEnd = new Date(today.getTime() + GENERATION_WINDOW_DAYS * 86400000);
    const rangeEnd = endDate ? new Date(Math.min(windowEnd.getTime(), new Date(endDate).getTime())) : windowEnd;
    if (rangeEnd < rangeStart) return [];

    const scheduleDays = new Set(schedules.map((s) => s.dayOfWeek));
    const dates = [];
    const cursor = new Date(rangeStart);
    while (cursor <= rangeEnd) {
      if (scheduleDays.has(isoDayOfWeek(cursor))) dates.push(formatDateOnly(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
  }

  async generateForTraining(trainingId, referenceDate = new Date()) {
    const training = await trainingsRepository.findActiveById(trainingId);
    // Un entrenamiento archivado/inactivo no debe seguir generando sesiones en silencio — mismo
    // criterio que chargeInstances.service.js#generateForCharge.
    if (!training || training.status !== 'active' || training.archived_at) return 0;

    const [schedules, memberIds] = await Promise.all([trainingsRepository.getSchedules(trainingId), trainingsRepository.expandTargetMemberIds(trainingId)]);
    if (!schedules.length || !memberIds.length) return 0;

    const dates = this._computeSessionDates(schedules, training.start_date, training.end_date, referenceDate);
    if (!dates.length) return 0;

    const rows = [];
    for (const sessionDate of dates) {
      for (const memberId of memberIds) rows.push({ trainingId, memberId, sessionDate });
    }
    return trainingAttendancesRepository.bulkInsertIgnore(rows);
  }

  /** Crea (idempotente) la fila de UN miembro/fecha si todavía no existe — usado al marcar
   * asistencia sobre una celda virtual (ej. un miembro agregado después de la última
   * generación). Mismo patrón que chargeInstances.service.js#ensureInstance. */
  async ensureAttendance(trainingId, memberId, sessionDate) {
    await trainingAttendancesRepository.bulkInsertIgnore([{ trainingId, memberId, sessionDate }]);
    return trainingAttendancesRepository.findByTrainingMemberDate(trainingId, memberId, sessionDate);
  }

  /** `clubId` opcional: sin él, recorre todos los clubes (cron diario). */
  async generateDueTrainings(clubId = null) {
    const trainings = clubId ? await trainingsRepository.findActiveByClubForGeneration(clubId) : await trainingsRepository.findAllActiveForGeneration();
    let total = 0;
    for (const training of trainings) {
      // eslint-disable-next-line no-await-in-loop
      total += await this.generateForTraining(training.id);
    }
    return total;
  }

  // --- Acceso (mirror de payments.service.js) ---

  async _resolveAccess(authContext, actorId, clubId) {
    if (permissionService.hasFunction(authContext, FUNCTIONS.VIEW_ATTENDANCE)) return { full: true, memberIds: null };
    const memberIds = await trainingAttendancesRepository.findAccessibleMemberIds(actorId, clubId);
    return { full: false, memberIds };
  }

  _assertAccessible(access, memberId) {
    if (access.full) return;
    if (!access.memberIds.includes(memberId)) throw AppError.notFound('Miembro no encontrado.');
  }

  async getVisibleMemberIds(authContext, actorId, clubId) {
    const [memberAccess, attendanceAccess] = await Promise.all([
      membersService.resolveAccessForController(authContext, actorId, clubId),
      this._resolveAccess(authContext, actorId, clubId),
    ]);
    if (memberAccess.full && attendanceAccess.full) return null;
    if (memberAccess.full) return attendanceAccess.memberIds;
    if (attendanceAccess.full) return memberAccess.memberIds;
    const set = new Set(attendanceAccess.memberIds);
    return memberAccess.memberIds.filter((id) => set.has(id));
  }

  async assertMemberAttendanceAccessible(clubId, memberId, actorId, authContext) {
    await membersService.getById(clubId, memberId, authContext, actorId);
    const access = await this._resolveAccess(authContext, actorId, clubId);
    this._assertAccessible(access, memberId);
    return access;
  }

  /** Camino combinado para ver/marcar la asistencia de UN miembro puntual — además del camino
   * normal, acepta ser el responsable RESUELTO (con prioridad de grupo) para ESE miembro
   * puntual, mismo patrón que payments.service.js#assertChargeMemberPaymentAccessible. */
  async assertTrainingMemberAccessible(training, memberId, actorId, authContext) {
    const member = await membersRepository.findByUserId(actorId, training.club_id);
    if (member) {
      const resolved = await trainingsRepository.resolveResponsibles(training.id, [memberId]);
      if (resolved.get(memberId)?.memberId === member.id) return;
    }
    await this.assertMemberAttendanceAccessible(training.club_id, memberId, actorId, authContext);
  }

  /** ¿A quién de los participantes de ESTE entrenamiento puede ver el actor? Mismo mirror que
   * payments.service.js#_resolveChargeParticipants — un responsable sin rol ve SOLO los
   * miembros cuyo responsable resuelto sea él (acotado a su grupo, o a todos si no tiene uno). */
  async _resolveTrainingParticipants(training, actorId, authContext) {
    const participantIds = await trainingsRepository.expandTargetMemberIds(training.id);
    if (permissionService.hasAnyFunction(authContext, [FUNCTIONS.VIEW_ATTENDANCE, FUNCTIONS.VIEW_ATTENDANCE_SCOPED])) {
      const visibleMemberIds = await this.getVisibleMemberIds(authContext, actorId, training.club_id);
      const memberIds = visibleMemberIds === null ? participantIds : participantIds.filter((id) => visibleMemberIds.includes(id));
      return { memberIds, scopedToMemberId: null };
    }
    const member = await membersRepository.findByUserId(actorId, training.club_id);
    if (!member || !(await trainingsRepository.isAnyResponsible(training.id, member.id))) {
      throw AppError.forbidden('No tienes permiso para ver este entrenamiento.');
    }
    const resolved = await trainingsRepository.resolveResponsibles(training.id, participantIds);
    const memberIds = participantIds.filter((id) => resolved.get(id)?.memberId === member.id);
    return { memberIds, scopedToMemberId: member.id };
  }

  // --- Matriz miembro×fecha ---

  /** Ventana de fechas mostrada — a diferencia de charges.service.js#_matrixPeriods (que CALCULA
   * períodos con una fórmula de calendario, así que puede "correr" el ancla exactamente 1 unidad
   * con solo aritmética de fechas), acá las fechas de sesión son irregulares (días de la semana
   * configurables, no mensual/anual) — no hay fórmula que las prediga sin consultar la BD. Se
   * pagina por PÁGINA COMPLETA en vez de "1 columna corrida": `offset` es un entero (0 = la
   * página que incluye hoy, ±1 = página siguiente/anterior completa), sin fechas de por medio —
   * evita que el frontend tenga que conocer la lista completa de fechas reales solo para
   * calcular "la fecha 1 posición antes/después". */
  async _matrixSessionDates(trainingId, offset, columns) {
    const [rows] = await pool.query('SELECT DISTINCT session_date FROM training_attendances WHERE training_id = ? ORDER BY session_date ASC', [
      trainingId,
    ]);
    const dates = rows.map((r) => formatDateOnly(r.session_date));
    if (!dates.length) return { dates: [], canGoBack: false, canGoForward: false };

    const size = Math.max(MIN_WINDOW_SIZE, Math.min(MAX_WINDOW_SIZE, columns || DEFAULT_WINDOW_SIZE));
    const todayStr = formatDateOnly(new Date());
    let todayIdx = dates.findIndex((d) => d >= todayStr);
    if (todayIdx === -1) todayIdx = dates.length;

    let startIdx = todayIdx + (offset || 0) * size;
    startIdx = Math.max(0, Math.min(startIdx, dates.length - 1));
    const endIdx = Math.min(dates.length - 1, startIdx + size - 1);
    return { dates: dates.slice(startIdx, endIdx + 1), canGoBack: startIdx > 0, canGoForward: endIdx < dates.length - 1 };
  }

  async getAttendanceMatrix(clubId, trainingId, { offset, columns } = {}, actorId, authContext) {
    const training = await trainingsRepository.findActiveById(trainingId);
    if (!training || training.club_id !== clubId) throw AppError.notFound('Entrenamiento no encontrado.');

    const trainingDto = {
      id: training.id,
      name: training.name,
      color: training.color,
      status: training.status,
      responsibles: (await trainingsRepository.getResponsibleMembers(training.id)).map((r) => ({
        memberId: r.memberId,
        memberName: r.memberName,
        groupId: r.groupId,
        groupName: r.groupName,
      })),
    };

    const { dates, canGoBack, canGoForward } = await this._matrixSessionDates(trainingId, offset || 0, columns || null);
    const { memberIds } = await this._resolveTrainingParticipants(training, actorId, authContext);

    if (!memberIds.length || !dates.length) return { training: trainingDto, sessionDates: dates, canGoBack, canGoForward, rows: [] };

    const [members, attendances] = await Promise.all([
      membersRepository.findNamesByIds(memberIds, clubId),
      trainingAttendancesRepository.findForTrainingAndMembers(trainingId, memberIds),
    ]);

    const cellLookup = new Map();
    for (const att of attendances) {
      const dateKey = formatDateOnly(att.session_date);
      if (!cellLookup.has(att.member_id)) cellLookup.set(att.member_id, new Map());
      cellLookup.get(att.member_id).set(dateKey, att);
    }

    const rows = members
      .map((m) => ({
        memberId: m.id,
        memberName: this._shortName(m),
        groupIds: m.group_ids ? m.group_ids.split(',').map(Number) : [],
        cells: dates.reduce((acc, d) => {
          const att = cellLookup.get(m.id)?.get(d);
          acc[d] = att ? this._matrixCellToDto(att) : this._virtualCellToDto(d);
          return acc;
        }, {}),
      }))
      .sort((a, b) => a.memberName.localeCompare(b.memberName));

    return { training: trainingDto, sessionDates: dates, canGoBack, canGoForward, rows };
  }

  /** Marca la asistencia de UN miembro en UNA fecha puntual — crea la fila si todavía no existe
   * (celda virtual). `status`: 'pending' (deshace la marca) | 'attended' | 'absent' | 'exempt'
   * (con `exemptType`: 'frozen'|'not_applicable'). */
  async markAttendance(clubId, trainingId, memberId, sessionDate, data, actorId, authContext) {
    const training = await trainingsRepository.findActiveById(trainingId);
    if (!training || training.club_id !== clubId) throw AppError.notFound('Entrenamiento no encontrado.');
    await this.assertTrainingMemberAccessible(training, memberId, actorId, authContext);

    const participantIds = await trainingsRepository.expandTargetMemberIds(trainingId);
    if (!participantIds.includes(memberId)) throw AppError.badRequest('Este miembro no participa de este entrenamiento.');

    if (!MARKABLE_STATUSES.includes(data.status)) throw AppError.badRequest('Estado de asistencia inválido.');

    const row = await this.ensureAttendance(trainingId, memberId, sessionDate);
    await trainingAttendancesRepository.markAttendance(row.id, {
      status: data.status,
      exemptType: data.exemptType,
      exemptReason: data.exemptReason,
      markedBy: actorId,
    });

    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'ATTENDANCE_MARKED',
      entityType: 'training_attendance',
      entityId: row.id,
      changes: { status: data.status, sessionDate },
    });

    const updated = await trainingAttendancesRepository.findActiveById(row.id);
    return this._matrixCellToDto(updated);
  }

  // --- Ficha de un miembro (pestañas por entrenamiento) ---

  async listForMember(clubId, memberId, actorId, authContext) {
    await this.assertMemberAttendanceAccessible(clubId, memberId, actorId, authContext);
    const rows = await trainingAttendancesRepository.findForMember(memberId);
    return { attendances: rows.map((r) => this._attendanceToDto(r)) };
  }
}

module.exports = new TrainingAttendanceService();
