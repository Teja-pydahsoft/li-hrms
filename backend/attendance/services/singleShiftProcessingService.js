/**
 * Single-Shift Attendance Processing Service
 * One shift per day: first IN, last OUT.
 * Per ATTENDANCE_DUAL_MODE_DESIGN.md Section 5.
 *
 * Two modes (strict IN/OUT setting):
 *
 * 1. STRICT IN/OUT ENABLED
 *    - Only punches with type IN or OUT (or punch_state 0/1) are used.
 *    - We correctly assign shifts and validate which punch is IN and which is OUT.
 *    - First IN and last OUT on the date (or next-day OUT for overnight) form the pair.
 *
 * 2. STRICT IN/OUT DISABLED (shift-aware)
 *    - All punches are considered (including type null / thumb-only).
 *    - Logs come in real time: people punch at shift start and when completing their shift.
 *    - We correlate punches to assigned shift start time (IN) and shift end time (OUT).
 *    - Classification is by proximity to shift start vs shift end; overnight OUT may be next day.
 *    - Next-day OUT is accepted if and only if it is at shift end ± 3 hours (grace).
 *    - First punch in [00:00, previous overnight shift end + 1hr] on today is reserved as that
 *      overnight's OUT and not used as today's IN.
 */

const AttendanceDaily = require('../model/AttendanceDaily');
const Employee = require('../../employees/model/Employee');
const OD = require('../../leaves/model/OD');
const { detectAndAssignShift, getShiftsForEmployee } = require('../../shifts/services/shiftDetectionService');
const { extractISTComponents, createISTDate } = require('../../shared/utils/dateUtils');

const formatDate = (date) => extractISTComponents(date).dateStr;

/** IST date string for the day after the given YYYY-MM-DD */
function nextDateStr(dateStr) {
  const d = new Date(dateStr + 'T12:00:00+05:30');
  d.setDate(d.getDate() + 1);
  return extractISTComponents(d).dateStr;
}

/**
 * Time string (HH:mm) to minutes from midnight.
 */
function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * When strict IN/OUT is disabled: use assigned shift timings to decide which punch is IN and which is OUT.
 * All punches (including type null / thumb-only) are considered. Each punch is classified by proximity to
 * shift start (IN) or shift end (OUT). Overnight: shift end is next day, so next-day punch at shift end = OUT.
 *
 * Rule: First punch on today's date in the window [00:00, previous overnight shift end + 1 hour] is the
 * OUT of that overnight — do not use it as today's IN. So we only accept today's IN after shift end + 1 hour.
 * (Real-time logs: OUT comes at shift end; next shift IN comes at least after that.)
 */
async function getShiftAwareInOutPair(employeeNumber, date, allPunches, processingMode) {
  if (!allPunches || allPunches.length === 0) return null;
  const shiftOptions = { rosterStrictWhenPresent: processingMode?.rosterStrictWhenPresent === true };
  const { shifts } = await getShiftsForEmployee(employeeNumber, date, shiftOptions);
  if (!shifts || shifts.length === 0) return null;

  const shift = shifts[0];
  const startTime = shift.startTime;
  const endTime = shift.endTime;
  if (!startTime || !endTime) return null;

  const startMins = timeToMinutes(startTime);
  const endMins = timeToMinutes(endTime);
  const isOvernight = endMins <= startMins || (startMins >= 20 * 60 && endMins < 12 * 60);

  const shiftStartDate = createISTDate(date, startTime);
  const shiftEndDate = isOvernight
    ? createISTDate(nextDateStr(date), endTime)
    : createISTDate(date, endTime);

  const nextDay = nextDateStr(date);
  const OVERNIGHT_OUT_GRACE_HOURS = 3;
  const graceMs = OVERNIGHT_OUT_GRACE_HOURS * 60 * 60 * 1000;
  const punchesInWindow = allPunches.filter(p => {
    const { dateStr } = extractISTComponents(new Date(p.timestamp));
    if (dateStr === date) return true;
    if (isOvernight && dateStr === nextDay) {
      const t = new Date(p.timestamp).getTime();
      const endMs = shiftEndDate.getTime();
      return Math.abs(t - endMs) <= graceMs;
    }
    return false;
  });
  if (punchesInWindow.length === 0) return null;

  // Previous day's overnight OUT lands on today in [00:00, endTime+1hr]. Reserve that first punch so we don't use it as today's IN.
  const prevDate = (() => { const d = new Date(date + 'T12:00:00+05:30'); d.setDate(d.getDate() - 1); return extractISTComponents(d).dateStr; })();
  const { shifts: prevShifts } = await getShiftsForEmployee(employeeNumber, prevDate, shiftOptions);
  let reservedOvernightOutPunch = null;
  if (prevShifts && prevShifts.length > 0) {
    for (const s of prevShifts) {
      const pe = (s.endTime || '').split(':').map(Number);
      const pendMins = (pe[0] || 0) * 60 + (pe[1] || 0);
      const ps = (s.startTime || '').split(':').map(Number);
      const pstartMins = (ps[0] || 0) * 60 + (ps[1] || 0);
      const prevIsOvernight = pendMins <= pstartMins || (pstartMins >= 20 * 60 && pendMins < 12 * 60);
      if (!prevIsOvernight) continue;
      const windowEndMins = pendMins + 60;
      const windowEndHour = Math.floor(windowEndMins / 60) % 24;
      const windowEndMin = windowEndMins % 60;
      const windowEndTimeStr = `${String(windowEndHour).padStart(2, '0')}:${String(windowEndMin).padStart(2, '0')}`;
      const windowEndToday = createISTDate(date, windowEndTimeStr);
      const punchesOnDateOnly = punchesInWindow.filter(p => extractISTComponents(new Date(p.timestamp)).dateStr === date);
      punchesOnDateOnly.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const firstInWindow = punchesOnDateOnly.find(p => new Date(p.timestamp) <= windowEndToday);
      if (firstInWindow) {
        reservedOvernightOutPunch = firstInWindow;
        break;
      }
    }
  }

  const inCandidates = [];
  const outCandidates = [];
  const isReserved = (p) => {
    if (!reservedOvernightOutPunch) return false;
    if (p === reservedOvernightOutPunch) return true;
    const a = p._id || p.id;
    const b = reservedOvernightOutPunch._id || reservedOvernightOutPunch.id;
    return a != null && b != null && String(a) === String(b);
  };
  for (const p of punchesInWindow) {
    if (isReserved(p)) continue;
    const t = new Date(p.timestamp).getTime();
    const distStart = Math.abs(t - shiftStartDate.getTime());
    const distEnd = Math.abs(t - shiftEndDate.getTime());
    if (distStart <= distEnd) {
      inCandidates.push(p);
    } else {
      outCandidates.push(p);
    }
  }

  if (inCandidates.length === 0 || outCandidates.length === 0) return null;
  inCandidates.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  outCandidates.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const inPunch = inCandidates[0];
  const outPunch = outCandidates[outCandidates.length - 1];
  const inTime = new Date(inPunch.timestamp);
  const outTime = new Date(outPunch.timestamp);
  if (outTime <= inTime) return null;
  return { inPunch, outPunch, firstInTime: inTime, lastOutTime: outTime };
}

/**
 * Compute working duration for OT: clamp to shift window so early arrival does not inflate OT.
 * - Effective IN = later of (shift start, first punch IN) — early arrival excluded
 * - Effective OUT = last punch OUT (no cap) — leaving after shift end = real OT
 * Duration = effectiveOut - effectiveIn
 */
function getEffectiveWorkingDuration(firstInTime, lastOutTime, shiftStartTime, shiftEndTime, date) {
  if (!shiftStartTime || !shiftEndTime) {
    const rawMs = lastOutTime - firstInTime;
    return Math.round((rawMs / 3600000) * 100) / 100;
  }
  const shiftStartDate = createISTDate(date, shiftStartTime);
  const effectiveIn = firstInTime < shiftStartDate ? shiftStartDate : firstInTime;
  const effectiveOut = lastOutTime;
  if (effectiveOut <= effectiveIn) return 0;
  const ms = effectiveOut.getTime() - effectiveIn.getTime();
  return Math.round((ms / 3600000) * 100) / 100;
}

/**
 * Process single-shift attendance for one employee on one date
 * @param {String} employeeNumber
 * @param {String} date - YYYY-MM-DD
 * @param {Array} rawLogs - All raw logs (will filter by date and pairing rules)
 * @param {Object} generalConfig - General settings
 * @param {Object} processingMode - From AttendanceSettings.getProcessingMode
 * @returns {Promise<Object>} { success, dailyRecord, ... }
 */
async function processSingleShiftAttendance(employeeNumber, date, rawLogs, generalConfig, processingMode = {}) {
  try {
    const validLogs = (rawLogs || []).filter(l => l && l.timestamp);
    const allPunches = validLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const targetDatePunches = allPunches.filter(p => {
      const d = new Date(p.timestamp);
      const { dateStr } = extractISTComponents(d);
      return dateStr === date;
    });

    const isIN = (p) => p.type === 'IN' || p.punch_state === 0 || p.punch_state === '0';
    const isOUT = (p) => p.type === 'OUT' || p.punch_state === 1 || p.punch_state === '1';

    let firstInTime = null;
    let lastOutTime = null;
    let inPunchRecord = null;
    let outPunchRecord = null;

    const strict = processingMode.strictCheckInOutOnly !== false;

    // Strict OFF: shift-aware — correlate punches to shift start (IN) and shift end (OUT); real-time safe.
    // Strict ON: use only typed IN/OUT, validate and assign correctly.
    if (!strict) {
      const pair = await getShiftAwareInOutPair(employeeNumber, date, allPunches, processingMode);
      if (pair) {
        firstInTime = pair.firstInTime;
        lastOutTime = pair.lastOutTime;
        inPunchRecord = pair.inPunch;
        outPunchRecord = pair.outPunch;
      }
    }

    // Fallback (strict ON or no shift-aware pair): typed IN/OUT only — first IN, last OUT; overnight next-day OUT.
    if (!firstInTime || !lastOutTime) {
      const ins = targetDatePunches.filter(isIN);
      const outs = targetDatePunches.filter(isOUT);
      firstInTime = ins.length ? new Date(ins[0].timestamp) : null;
      lastOutTime = outs.length ? new Date(outs[outs.length - 1].timestamp) : null;
      inPunchRecord = ins.length ? ins[0] : null;
      outPunchRecord = outs.length ? outs[outs.length - 1] : null;

      if (firstInTime && (!lastOutTime || lastOutTime <= firstInTime)) {
        const nextDay = nextDateStr(date);
        const nextDayPunches = allPunches.filter(p => {
          const { dateStr } = extractISTComponents(new Date(p.timestamp));
          return dateStr === nextDay;
        });
        const nextDayOuts = nextDayPunches.filter(isOUT);
        if (nextDayOuts.length) {
          const nextDayFirstOut = new Date(nextDayOuts[0].timestamp);
          if (nextDayFirstOut > firstInTime) {
            const shiftOptions = { rosterStrictWhenPresent: processingMode?.rosterStrictWhenPresent === true };
            const { shifts } = await getShiftsForEmployee(employeeNumber, date, shiftOptions);
            let withinGrace = true;
            if (shifts && shifts.length > 0 && shifts[0].endTime) {
              const endMins = timeToMinutes(shifts[0].endTime);
              const startMins = timeToMinutes(shifts[0].startTime || '00:00');
              const isOvernight = endMins <= startMins || (startMins >= 20 * 60 && endMins < 12 * 60);
              if (isOvernight) {
                const shiftEndOnNext = createISTDate(nextDay, shifts[0].endTime);
                const graceMs = 3 * 60 * 60 * 1000;
                withinGrace = Math.abs(nextDayFirstOut.getTime() - shiftEndOnNext.getTime()) <= graceMs;
              }
            }
            if (withinGrace) {
              lastOutTime = nextDayFirstOut;
              outPunchRecord = nextDayOuts[0];
            }
          }
        }
      }
    }

    // Only IN, no OUT yet → PARTIAL
    if (firstInTime && !lastOutTime) {
      const inPunch = inPunchRecord || targetDatePunches.filter(isIN)[0];
      if (!inPunch) {
        const updateData = buildEmptyUpdate(employeeNumber, date);
        const dailyRecord = await upsertDaily(employeeNumber, date, updateData);
        return { success: true, dailyRecord, shiftsProcessed: 0, totalHours: 0, totalOT: 0 };
      }
      const partialRecord = await buildAndUpsertPartialSingleShift(
        employeeNumber, date, inPunch, generalConfig, processingMode
      );
      return { success: true, dailyRecord: partialRecord, shiftsProcessed: 1, totalHours: 0, totalOT: 0 };
    }

    if (!firstInTime || !lastOutTime || lastOutTime <= firstInTime) {
      const updateData = buildEmptyUpdate(employeeNumber, date);
      const dailyRecord = await upsertDaily(employeeNumber, date, updateData);
      return { success: true, dailyRecord, shiftsProcessed: 0, totalHours: 0, totalOT: 0 };
    }

    const configWithMode = { ...generalConfig, processingMode };
    const shiftAssignment = await detectAndAssignShift(
      employeeNumber,
      date,
      firstInTime,
      lastOutTime,
      configWithMode
    );

    const Shift = require('../../shifts/model/Shift');
    const assignedShiftDef = shiftAssignment?.assignedShift
      ? await Shift.findById(shiftAssignment.assignedShift).select('payableShifts duration').lean()
      : null;

    const rawDurationMs = lastOutTime - firstInTime;
    const punchHours = Math.round((rawDurationMs / 3600000) * 100) / 100; // Display: duration since punched
    const shiftStart = shiftAssignment?.shiftStartTime || null;
    const shiftEnd = shiftAssignment?.shiftEndTime || null;
    const effectiveHours = getEffectiveWorkingDuration(
      firstInTime, lastOutTime, shiftStart, shiftEnd, date
    ); // OT only: clamp early arrival
    const expectedHours = (assignedShiftDef?.duration) || 8;
    const extraHours = effectiveHours > expectedHours ? Math.round((effectiveHours - expectedHours) * 100) / 100 : 0;

    const pShift = {
      shiftNumber: 1,
      inTime: firstInTime,
      outTime: lastOutTime,
      duration: Math.round(rawDurationMs / 60000),
      punchHours,
      workingHours: punchHours, // Display: actual duration worked since punched
      odHours: 0,
      extraHours,
      otHours: 0, // Only set when OT is approved via Convert to OT flow
      status: 'incomplete',
      inPunchId: (inPunchRecord && (inPunchRecord._id || inPunchRecord.id)) || null,
      outPunchId: (outPunchRecord && (outPunchRecord._id || outPunchRecord.id)) || null,
    };

    if (shiftAssignment?.success) {
      pShift.shiftId = shiftAssignment.assignedShift;
      pShift.shiftName = shiftAssignment.shiftName;
      pShift.shiftStartTime = shiftAssignment.shiftStartTime;
      pShift.shiftEndTime = shiftAssignment.shiftEndTime;
      pShift.lateInMinutes = shiftAssignment.lateInMinutes;
      pShift.earlyOutMinutes = shiftAssignment.earlyOutMinutes;
      pShift.isLateIn = shiftAssignment.isLateIn;
      pShift.isEarlyOut = shiftAssignment.isEarlyOut;
      pShift.expectedHours = shiftAssignment.expectedHours || expectedHours;

      const basePayable = (assignedShiftDef?.payableShifts ?? 1);
      const statusDuration = punchHours + (pShift.odHours || 0); // Use actual punch duration for status

      if (statusDuration >= expectedHours * 0.75) {
        pShift.status = 'PRESENT';
        pShift.payableShift = basePayable;
      } else if (statusDuration >= expectedHours * 0.40) {
        pShift.status = 'HALF_DAY';
        pShift.payableShift = basePayable * 0.5;
      } else {
        pShift.status = 'ABSENT';
        pShift.payableShift = 0;
      }
    } else {
      pShift.status = 'PRESENT';
      pShift.payableShift = 1;
    }

    const processedShifts = [pShift];
    const totalPayableShifts = pShift.payableShift || 0;
    const status = pShift.status === 'PRESENT' || totalPayableShifts >= 1 ? 'PRESENT'
      : pShift.status === 'HALF_DAY' ? 'HALF_DAY' : 'ABSENT';

    const updateData = {
      shifts: processedShifts,
      totalShifts: 1,
      totalWorkingHours: punchHours,
      totalOTHours: 0, // Only set when OT is approved via Convert to OT
      extraHours,
      payableShifts: totalPayableShifts,
      status,
      lastSyncedAt: new Date(),
      totalLateInMinutes: pShift.lateInMinutes || 0,
      totalEarlyOutMinutes: pShift.earlyOutMinutes || 0,
      totalExpectedHours: pShift.expectedHours || expectedHours,
      otHours: 0, // Display as extra hours until Convert to OT + management approval
    };

    const dailyRecord = await upsertDaily(employeeNumber, date, updateData);
    // Monthly summary is recalculated in background by AttendanceDaily post-save hook

    return {
      success: true,
      dailyRecord,
      shiftsProcessed: 1,
      totalHours: punchHours,
      totalOT: extraHours,
    };
  } catch (error) {
    console.error('[SingleShift] Error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Build and upsert a PARTIAL daily record when we have only IN (no OUT yet).
 * Realtime: IN comes first; OUT comes after shift ends. So we persist PARTIAL so UI shows "checked in".
 */
async function buildAndUpsertPartialSingleShift(employeeNumber, date, inPunch, generalConfig, processingMode) {
  const firstInTime = new Date(inPunch.timestamp);
  const configWithMode = { ...generalConfig, processingMode };
  const shiftAssignment = await detectAndAssignShift(
    employeeNumber,
    date,
    firstInTime,
    null, // no OUT yet
    configWithMode
  );

  const pShift = {
    shiftNumber: 1,
    inTime: firstInTime,
    outTime: null,
    duration: 0,
    punchHours: 0,
    workingHours: 0,
    odHours: 0,
    extraHours: 0,
    otHours: 0,
    status: 'incomplete',
    payableShift: 0,
    inPunchId: inPunch._id || inPunch.id,
    outPunchId: null,
  };

  if (shiftAssignment?.success) {
    pShift.shiftId = shiftAssignment.assignedShift;
    pShift.shiftName = shiftAssignment.shiftName;
    pShift.shiftStartTime = shiftAssignment.shiftStartTime;
    pShift.shiftEndTime = shiftAssignment.shiftEndTime;
    pShift.lateInMinutes = shiftAssignment.lateInMinutes;
    pShift.earlyOutMinutes = null;
    pShift.isLateIn = shiftAssignment.isLateIn;
    pShift.isEarlyOut = false;
    pShift.expectedHours = shiftAssignment.expectedHours ?? 8;
  }

  const updateData = {
    shifts: [pShift],
    totalShifts: 1,
    totalWorkingHours: 0,
    totalOTHours: 0,
    extraHours: 0,
    payableShifts: 0,
    status: 'PARTIAL',
    lastSyncedAt: new Date(),
    totalLateInMinutes: pShift.lateInMinutes || 0,
    totalEarlyOutMinutes: 0,
    totalExpectedHours: pShift.expectedHours || 8,
    otHours: 0,
  };

  return upsertDaily(employeeNumber, date, updateData);
}

function buildEmptyUpdate(employeeNumber, date) {
  return {
    shifts: [],
    totalShifts: 0,
    totalWorkingHours: 0,
    totalOTHours: 0,
    extraHours: 0,
    payableShifts: 0,
    status: 'ABSENT',
    lastSyncedAt: new Date(),
    totalLateInMinutes: 0,
    totalEarlyOutMinutes: 0,
    totalExpectedHours: 0,
    otHours: 0,
  };
}

async function upsertDaily(employeeNumber, date, updateData) {
  let dailyRecord = await AttendanceDaily.findOne({ employeeNumber, date });
  if (!dailyRecord) {
    dailyRecord = new AttendanceDaily({ employeeNumber, date, ...updateData });
  } else {
    Object.keys(updateData).forEach(k => { dailyRecord[k] = updateData[k]; });
  }
  if (!dailyRecord.source) dailyRecord.source = [];
  if (!dailyRecord.source.includes('biometric-realtime')) {
    dailyRecord.source.push('biometric-realtime');
  }
  await dailyRecord.save();
  return dailyRecord;
}

module.exports = { processSingleShiftAttendance };
