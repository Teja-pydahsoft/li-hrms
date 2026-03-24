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
 *    - Pre-scheduled roster wins when present; otherwise use organizational shift pool from getShiftsForEmployee.
 *    - Multiple pool shifts: pick the shift that best matches punch times (then same ±3h windows).
 *    - All punches are considered (including type null / thumb-only); log IN/OUT type is not used for pairing.
 *    - IN/OUT from proximity to shift start / shift end (± 3 hours).
 *    - Overnight: next-calendar-day punches only within shift end ± 3h enter the pool; OUT fallback can use later punches in that window.
 *    - First punch on today in [00:00, previous overnight shift end + 1hr] is reserved as prior day's OUT when applicable.
 *    - If no shift can be resolved from roster or pool, fall back to type-agnostic first/last punch on the date (and next day if needed).
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
 * Parse HH:MM to a Date on refDate (IST). If isNextDay, use next calendar day.
 */
function timeStringToDate(timeStr, refDateStr, isNextDay = false) {
  if (!timeStr || !refDateStr) return null;
  let dateStr = refDateStr;
  if (isNextDay) {
    const d = new Date(refDateStr + 'T12:00:00+05:30');
    d.setDate(d.getDate() + 1);
    dateStr = extractISTComponents(d).dateStr;
  }
  const [hours, mins] = timeStr.split(':').map(Number);
  const h = String(hours ?? 0).padStart(2, '0');
  const m = String(mins ?? 0).padStart(2, '0');
  return new Date(`${dateStr}T${h}:${m}:00+05:30`);
}

/**
 * Overlap between two time ranges in minutes.
 */
function getOverlapMinutes(startA, endA, startB, endB) {
  if (!startA || !endA || !startB || !endB) return 0;
  const start = Math.max(startA.getTime(), startB.getTime());
  const end = Math.min(endA.getTime(), endB.getTime());
  return Math.max(0, (end - start) / (1000 * 60));
}

/**
 * Reserve first punch on `date` that belongs to previous calendar day's overnight shift end window.
 */
function computeReservedOvernightOutPunch(date, allPunches, prevShifts) {
  if (!prevShifts || prevShifts.length === 0 || !allPunches?.length) return null;
  const punchesOnDateOnly = allPunches
    .filter(p => extractISTComponents(new Date(p.timestamp)).dateStr === date)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  if (punchesOnDateOnly.length === 0) return null;
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
    const firstInWindow = punchesOnDateOnly.find(p => new Date(p.timestamp) <= windowEndToday);
    if (firstInWindow) return firstInWindow;
  }
  return null;
}

/**
 * Build IN/OUT pair for one shift (roster or pool). Uses punch times vs shift boundaries, not log type.
 */
function buildShiftAwarePairForShiftDef(date, allPunches, shift, reservedOvernightOutPunch) {
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

  const SHIFT_WINDOW_GRACE_HOURS = 3;
  const windowGraceMs = SHIFT_WINDOW_GRACE_HOURS * 60 * 60 * 1000;
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
    const withinStartWindow = distStart <= windowGraceMs;
    const withinEndWindow = distEnd <= windowGraceMs;
    if (distStart <= distEnd && withinStartWindow) {
      inCandidates.push(p);
    } else if (distEnd < distStart && withinEndWindow) {
      outCandidates.push(p);
    }
  }

  inCandidates.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  outCandidates.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  let inPunch = inCandidates.length ? inCandidates[0] : null;
  let outPunch = outCandidates.length ? outCandidates[outCandidates.length - 1] : null;

  if (inPunch && outPunch && new Date(outPunch.timestamp) <= new Date(inPunch.timestamp)) {
    const inDist = Math.abs(new Date(inPunch.timestamp) - shiftStartDate);
    const outDist = Math.abs(new Date(outPunch.timestamp) - shiftEndDate);
    if (inDist <= outDist) outPunch = null;
    else inPunch = null;
  }

  let fallbackInUsed = false;
  let fallbackOutUsed = false;

  if (!inPunch) {
    const onDate = punchesInWindow
      .filter(p => extractISTComponents(new Date(p.timestamp)).dateStr === date && !isReserved(p))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    if (onDate.length > 0) {
      inPunch = onDate[0];
      fallbackInUsed = true;
    }
  }

  if (inPunch && !outPunch) {
    const inMs = new Date(inPunch.timestamp).getTime();
    const MIN_OUT_GAP_MS = 30 * 60 * 1000;
    const laterPunches = punchesInWindow
      .filter(p => !isReserved(p) && new Date(p.timestamp).getTime() > (inMs + MIN_OUT_GAP_MS))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    if (laterPunches.length > 0) {
      outPunch = laterPunches[laterPunches.length - 1];
      fallbackOutUsed = true;
    }
  }

  if (!inPunch && !outPunch) return null;

  const firstInTime = inPunch ? new Date(inPunch.timestamp) : null;
  const lastOutTime = outPunch ? new Date(outPunch.timestamp) : null;
  let distScore = Number.MAX_SAFE_INTEGER;
  if (inPunch && outPunch) {
    distScore = Math.abs(new Date(inPunch.timestamp) - shiftStartDate)
      + Math.abs(new Date(outPunch.timestamp) - shiftEndDate);
  } else if (inPunch) {
    distScore = Math.abs(new Date(inPunch.timestamp) - shiftStartDate) + 1e12;
  } else if (outPunch) {
    distScore = Math.abs(new Date(outPunch.timestamp) - shiftEndDate) + 1e12;
  }

  return {
    inPunch,
    outPunch,
    firstInTime,
    lastOutTime,
    fallbackInUsed,
    fallbackOutUsed,
    distScore,
    hasFullPair: !!(inPunch && outPunch),
    sourcePriority: shift.sourcePriority ?? 99,
  };
}

function pickBestShiftAwarePair(candidates) {
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    if (a.hasFullPair !== b.hasFullPair) return a.hasFullPair ? -1 : 1;
    if (a.sourcePriority !== b.sourcePriority) return a.sourcePriority - b.sourcePriority;
    return a.distScore - b.distScore;
  });
  const best = candidates[0];
  return {
    inPunch: best.inPunch,
    outPunch: best.outPunch,
    firstInTime: best.firstInTime,
    lastOutTime: best.lastOutTime,
    fallbackInUsed: best.fallbackInUsed,
    fallbackOutUsed: best.fallbackOutUsed,
  };
}

/**
 * No shift from roster/pool: first/last punch on date (and next day if needed). No log type.
 */
function getTypeAgnosticPoolFallbackPair(date, allPunches) {
  const MIN_GAP_MS = 30 * 60 * 1000;
  const nextDay = nextDateStr(date);
  const onDate = allPunches
    .filter(p => extractISTComponents(new Date(p.timestamp)).dateStr === date)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  if (onDate.length === 0) return null;
  const first = onDate[0];
  const lastSameDay = onDate[onDate.length - 1];
  if (onDate.length >= 2 && new Date(lastSameDay.timestamp).getTime() > new Date(first.timestamp).getTime() + MIN_GAP_MS) {
    return {
      inPunch: first,
      outPunch: lastSameDay,
      firstInTime: new Date(first.timestamp),
      lastOutTime: new Date(lastSameDay.timestamp),
      fallbackInUsed: true,
      fallbackOutUsed: true,
    };
  }
  const inMs = new Date(first.timestamp).getTime();
  const onNext = allPunches
    .filter(p => extractISTComponents(new Date(p.timestamp)).dateStr === nextDay)
    .filter(p => new Date(p.timestamp).getTime() > inMs + MIN_GAP_MS)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  if (onNext.length > 0) {
    const outPunch = onNext[onNext.length - 1];
    return {
      inPunch: first,
      outPunch,
      firstInTime: new Date(first.timestamp),
      lastOutTime: new Date(outPunch.timestamp),
      fallbackInUsed: true,
      fallbackOutUsed: true,
    };
  }
  if (onDate.length >= 2) {
    return {
      inPunch: first,
      outPunch: lastSameDay,
      firstInTime: new Date(first.timestamp),
      lastOutTime: new Date(lastSameDay.timestamp),
      fallbackInUsed: true,
      fallbackOutUsed: true,
    };
  }
  return {
    inPunch: first,
    outPunch: null,
    firstInTime: new Date(first.timestamp),
    lastOutTime: null,
    fallbackInUsed: true,
    fallbackOutUsed: false,
  };
}

function toShiftAwarePairResult(obj) {
  if (!obj) return null;
  return {
    inPunch: obj.inPunch,
    outPunch: obj.outPunch,
    firstInTime: obj.firstInTime,
    lastOutTime: obj.lastOutTime,
    fallbackInUsed: obj.fallbackInUsed,
    fallbackOutUsed: obj.fallbackOutUsed,
  };
}

async function getShiftAwareInOutPair(employeeNumber, date, allPunches, processingMode) {
  if (!allPunches || allPunches.length === 0) return null;
  const shiftOptions = { rosterStrictWhenPresent: true };
  const { shifts, source } = await getShiftsForEmployee(employeeNumber, date, shiftOptions);

  const prevDate = (() => { const d = new Date(date + 'T12:00:00+05:30'); d.setDate(d.getDate() - 1); return extractISTComponents(d).dateStr; })();
  const { shifts: prevShifts } = await getShiftsForEmployee(employeeNumber, prevDate, shiftOptions);
  const reservedOvernightOutPunch = computeReservedOvernightOutPunch(date, allPunches, prevShifts);

  if (!shifts || shifts.length === 0) {
    return getTypeAgnosticPoolFallbackPair(date, allPunches);
  }

  if (source === 'pre_scheduled' || shifts.length === 1) {
    const single = buildShiftAwarePairForShiftDef(date, allPunches, shifts[0], reservedOvernightOutPunch);
    return toShiftAwarePairResult(single) || getTypeAgnosticPoolFallbackPair(date, allPunches);
  }

  const built = shifts
    .map(s => buildShiftAwarePairForShiftDef(date, allPunches, s, reservedOvernightOutPunch))
    .filter(Boolean);
  const best = pickBestShiftAwarePair(built);
  return best || getTypeAgnosticPoolFallbackPair(date, allPunches);
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
    const appendPairingNote = (base, msg) => {
      if (!msg) return base || null;
      if (!base) return msg;
      if (String(base).includes(msg)) return base;
      return `${base} | ${msg}`;
    };

  try {
    const validLogs = (rawLogs || []).filter(l => l && l.timestamp);
    const sortedLogs = validLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // DEDUPLICATION: Ignore punches within 5 minutes of each other (double-tap / accidental repeat)
    const DEDUP_WINDOW_MS = 5 * 60 * 1000;
    const allPunches = [];
    for (const p of sortedLogs) {
      const last = allPunches[allPunches.length - 1];
      if (last && (new Date(p.timestamp) - new Date(last.timestamp)) < DEDUP_WINDOW_MS) {
        continue;
      }
      allPunches.push(p);
    }

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
        const fallbackMsgs = [];
        if (pair.fallbackInUsed) fallbackMsgs.push('SingleShift pairing fallback used for IN');
        if (pair.fallbackOutUsed) fallbackMsgs.push('SingleShift pairing fallback used for OUT');
        if (fallbackMsgs.length > 0) {
          const existing = await AttendanceDaily.findOne({ employeeNumber, date }).select('notes').lean();
          const msg = fallbackMsgs.join(' & ');
          const merged = appendPairingNote(existing?.notes || null, msg);
          await AttendanceDaily.findOneAndUpdate(
            { employeeNumber, date },
            { $set: { notes: merged } },
            { upsert: true, new: false }
          );
        }
      }
    }

    // Strict ON only: supplement missing IN/OUT from log operation type (first IN, last OUT on date;
    // overnight next-day OUT typed as OUT). When strict is OFF, pairing is time+roster only —
    // never override or fill from punch type, which devices often mislabel.
    if (strict) {
      const typedIns = targetDatePunches.filter(isIN);
      const typedOuts = targetDatePunches.filter(isOUT);

      if (!firstInTime && typedIns.length) {
        firstInTime = new Date(typedIns[0].timestamp);
        inPunchRecord = typedIns[0];
      }
      if (!lastOutTime && typedOuts.length) {
        lastOutTime = new Date(typedOuts[typedOuts.length - 1].timestamp);
        outPunchRecord = typedOuts[typedOuts.length - 1];
      }

      // Next-calendar-day typed OUT — only for overnight shifts (shift end is on next day).
      // Day shifts must OUT on same date; otherwise we incorrectly paired "tomorrow morning" OUT.
      if (firstInTime && !lastOutTime) {
        const rosterFirst = { rosterStrictWhenPresent: true };
        const { shifts } = await getShiftsForEmployee(employeeNumber, date, rosterFirst);
        if (shifts?.length > 0 && shifts[0].startTime && shifts[0].endTime) {
          const endMins = timeToMinutes(shifts[0].endTime);
          const startMins = timeToMinutes(shifts[0].startTime);
          const isOvernight = endMins <= startMins || (startMins >= 20 * 60 && endMins < 12 * 60);
          if (isOvernight) {
            const nextDay = nextDateStr(date);
            const nextDayPunches = allPunches.filter(p => {
              const { dateStr } = extractISTComponents(new Date(p.timestamp));
              return dateStr === nextDay;
            });
            const nextDayOuts = nextDayPunches.filter(isOUT);
            if (nextDayOuts.length) {
              const nextDayFirstOut = new Date(nextDayOuts[0].timestamp);
              if (nextDayFirstOut > firstInTime) {
                const shiftEndOnNext = createISTDate(nextDay, shifts[0].endTime);
                const graceMs = 3 * 60 * 60 * 1000;
                const withinGrace =
                  Math.abs(nextDayFirstOut.getTime() - shiftEndOnNext.getTime()) <= graceMs;
                if (withinGrace) {
                  lastOutTime = nextDayFirstOut;
                  outPunchRecord = nextDayOuts[0];
                }
              }
            }
          }
        }
      }
    }

    // Only IN, no OUT yet → PARTIAL
    if (firstInTime && !lastOutTime) {
      const inMs = firstInTime.getTime();
      const inPunch =
        inPunchRecord
        || allPunches.find(p => new Date(p.timestamp).getTime() === inMs)
        || (strict ? targetDatePunches.filter(isIN)[0] : null);
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
      basePayable: 1, // Default base
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

      // Hour-based OD gap-fill: add OD time not covered by punches to working hours; waive early-out if OD covers gap
      const dayStart = new Date(`${date}T00:00:00+05:30`);
      const dayEnd = new Date(`${date}T23:59:59.999+05:30`);
      let approvedODs = [];
      try {
        approvedODs = await OD.find({
          emp_no: employeeNumber,
          status: 'approved',
          isActive: true,
          fromDate: { $lte: dayEnd },
          toDate: { $gte: dayStart },
        }).select('odType_extended odStartTime odEndTime durationHours').lean();
      } catch (e) {
        // ignore
      }
      if (approvedODs && approvedODs.length > 0 && pShift.shiftStartTime && pShift.shiftEndTime) {
        const isOvernight = timeToMinutes(pShift.shiftEndTime) < timeToMinutes(pShift.shiftStartTime);
        const shiftStartDate = timeStringToDate(pShift.shiftStartTime, date, false);
        const shiftEndDate = timeStringToDate(pShift.shiftEndTime, date, isOvernight);
        const punchIn = firstInTime instanceof Date ? firstInTime : new Date(firstInTime);
        const punchOut = lastOutTime instanceof Date ? lastOutTime : new Date(lastOutTime);
        let addedOdMinutes = 0;
        for (const od of approvedODs) {
          if (od.odType_extended === 'hours' && od.odStartTime && od.odEndTime) {
            const odEndNextDay = timeToMinutes(od.odEndTime) <= timeToMinutes(od.odStartTime);
            const odStart = timeStringToDate(od.odStartTime, date, false);
            const odEnd = timeStringToDate(od.odEndTime, date, odEndNextDay);
            const odInShiftOverlap = getOverlapMinutes(shiftStartDate, shiftEndDate, odStart, odEnd);
            const odInPunchOverlap = getOverlapMinutes(punchIn, punchOut, odStart, odEnd);
            addedOdMinutes += Math.max(0, odInShiftOverlap - odInPunchOverlap);
            // Waive early-out when OD end covers shift end; set to 0
            if (pShift.isEarlyOut && odStart <= punchOut && odEnd >= shiftEndDate) {
              pShift.isEarlyOut = false;
              pShift.earlyOutMinutes = 0;
            }
            // Waive late-in when OD start is at or before shift start
            if (pShift.isLateIn && odStart <= shiftStartDate && odEnd >= punchIn) {
              pShift.isLateIn = false;
              pShift.lateInMinutes = 0;
            }
          }
        }
        const addedOdHours = Math.round((addedOdMinutes / 60) * 100) / 100;
        pShift.odHours = addedOdHours;
        pShift.workingHours = Math.round((punchHours + addedOdHours) * 100) / 100;
      }

      const basePayable = (assignedShiftDef?.payableShifts ?? 1);
      pShift.basePayable = basePayable;
      const statusDuration = punchHours + (pShift.odHours || 0); // Use punch + OD gap-fill for status

      if (statusDuration >= expectedHours * 0.9) {
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
      totalWorkingHours: pShift.workingHours,
      totalOTHours: 0, // Only set when OT is approved via Convert to OT
      extraHours,
      payableShifts: totalPayableShifts,
      status,
      lastSyncedAt: new Date(),
      totalLateInMinutes: pShift.lateInMinutes || 0,
      totalEarlyOutMinutes: pShift.earlyOutMinutes ?? 0,
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
    basePayable: 1,
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
    pShift.basePayable = shiftAssignment.basePayable ?? 1;
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
