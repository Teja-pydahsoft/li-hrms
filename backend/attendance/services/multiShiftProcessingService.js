/**
 * Multi-Shift Attendance Processing Service
 * Integrates multi-shift detection into attendance processing pipeline
 * Supports dual-mode: multi_shift (iterative split) and single_shift per ATTENDANCE_DUAL_MODE_DESIGN.md
 */

const AttendanceDaily = require('../model/AttendanceDaily');
const AttendanceSettings = require('../model/AttendanceSettings');
const { isSameDay, findNextOut } = require('./multiShiftDetectionService');
const { processSmartINDetection } = require('./smartINDetectionService');
const { detectAndAssignShift, getShiftsForEmployee, calculateTimeDifference, calculateLateIn, calculateEarlyOut, timeToMinutes } = require('../../shifts/services/shiftDetectionService');
const { getPunchesForPairing } = require('./punchFilteringHelper');
const { processSingleShiftAttendance } = require('./singleShiftProcessingService');
const Employee = require('../../employees/model/Employee');
const OD = require('../../leaves/model/OD');

const { extractISTComponents, createISTDate } = require('../../shared/utils/dateUtils');

const formatDate = (date) => {
    return extractISTComponents(date).dateStr;
};

/**
 * Calculate overlap between two time ranges in minutes
 */
function getOverlapMinutes(startA, endA, startB, endB) {
    if (!startA || !endA || !startB || !endB) return 0;
    const start = Math.max(startA.getTime(), startB.getTime());
    const end = Math.min(endA.getTime(), endB.getTime());
    const overlap = Math.max(0, end - start);
    return overlap / (1000 * 60);
}

/**
 * Find the next shift whose start is >= prevEnd (handles overnight chains e.g. 9-6, 9-6, 6-9)
 * Design: "Among shifts whose start time >= previous shift end time, pick the one closest to that boundary"
 * Uses attendance date as base; considers shift start on same day and next day for overnight spans
 * @param {Date} prevEnd - Previous segment end
 * @param {Array} shiftsList - Candidate shifts
 * @param {String} date - Attendance date YYYY-MM-DD
 * @param {Object} excludeShift - Optional shift to exclude (already used)
 */
function findNextShiftAfter(prevEnd, shiftsList, date, excludeShift = null) {
    if (!shiftsList?.length || !prevEnd) return null;
    let best = null;
    let bestDiffMs = Infinity;
    const dateStr = typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/) ? date : formatDate(date);
    const prevEndMs = prevEnd.getTime();
    const excludeId = excludeShift?._id?.toString?.();

    for (const s of shiftsList) {
        if (excludeId && s._id?.toString?.() === excludeId) continue;
        const startOnDate = timeStringToDate(s.startTime, dateStr, false);
        const startNextDay = timeStringToDate(s.startTime, dateStr, true);

        for (const startDate of [startOnDate, startNextDay]) {
            if (!startDate) continue;
            if (startDate.getTime() < prevEndMs) continue;
            const diffMs = startDate.getTime() - prevEndMs;
            if (diffMs < bestDiffMs) {
                bestDiffMs = diffMs;
                best = s;
            }
        }
    }
    return best;
}

/**
 * Shift-aware First-IN / Last-OUT collapse (when strict is OFF)
 * For multi-thumbers: take first punch as IN, last punch in window as OUT.
 * Window = [firstPunch, shiftEnd + postShiftOutMarginHours]
 * Keeps half-day, early-out, and OT within margin.
 */
function getEffectiveInOutForShift(punches, shift, date, postShiftOutMarginHours = 4) {
    if (!punches?.length || !shift) return null;
    const sorted = [...punches].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const firstPunch = new Date(sorted[0].timestamp);
    const lastPunch = new Date(sorted[sorted.length - 1].timestamp);

    const shiftStartDate = timeStringToDate(shift.startTime, date, false);
    const isOvernight = timeToMinutes(shift.endTime) < timeToMinutes(shift.startTime);
    const shiftEndDate = timeStringToDate(shift.endTime, date, isOvernight);
    const windowEnd = new Date(shiftEndDate.getTime() + postShiftOutMarginHours * 60 * 60 * 1000);

    const windowStart = firstPunch;
    const punchesInWindow = sorted.filter(p => {
        const t = new Date(p.timestamp).getTime();
        return t >= windowStart.getTime() && t <= windowEnd.getTime();
    });

    if (punchesInWindow.length === 0) return null;

    // Respect log type: use first IN and last OUT in window when type is set
    const firstIn = punchesInWindow.find(p => p.type === 'IN');
    const lastOut = [...punchesInWindow].reverse().find(p => p.type === 'OUT');
    const effectiveIn = firstIn || punchesInWindow[0];
    const effectiveOut = lastOut || punchesInWindow[punchesInWindow.length - 1];
    return {
        effectiveIn,
        effectiveOut,
        effectiveInTime: new Date(effectiveIn.timestamp),
        effectiveOutTime: new Date(effectiveOut.timestamp),
    };
}

/**
 * Helper to parse HH:MM to a Date object on a specific refernce date (TIMEZONE AWARE)
 * Ensures Shift Times are always interpreted as IST
 */
function timeStringToDate(timeStr, refDate, isNextDay = false) {
    if (!timeStr) return null;

    // Extract YYYY-MM-DD from refDate
    // We must ensure we get the date part in IST context, not UTC
    // const d = new Date(refDate);
    // const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // Better: If refDate is a string (YYYY-MM-DD), use it directly
    let dateStr;
    if (typeof refDate === 'string' && refDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
        dateStr = refDate;
    } else {
        dateStr = extractISTComponents(refDate).dateStr;
    }

    // Construct timestamp with offset
    // YYYY-MM-DD + T + HH:mm + :00 + +05:30
    const [hours, mins] = timeStr.split(':');
    let targetDateStr = dateStr;

    if (isNextDay) {
        const d = new Date(dateStr);
        d.setDate(d.getDate() + 1);
        targetDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    return new Date(`${targetDateStr}T${hours}:${mins}:00+05:30`);
}

/**
 * Process multi-shift attendance for a single employee on a single date
 * @param {String} employeeNumber - Employee number
 * @param {String} date - Date in YYYY-MM-DD format
 * @param {Array} rawLogs - All raw logs for this employee (sorted chronologically)
 * @param {Object} generalConfig - General settings
 * @returns {Promise<Object>} Processing result
 */
async function processMultiShiftAttendance(employeeNumber, date, rawLogs, generalConfig, pairedOutIds = new Set()) {

    try {
        // Resolve processing mode and apply punch filtering (strictCheckInOutOnly)
        const attendanceSettings = await AttendanceSettings.getSettings();
        const processingMode = AttendanceSettings.getProcessingMode(attendanceSettings);
        const filteredRawLogs = getPunchesForPairing((rawLogs || []).filter(l => l && l.timestamp), attendanceSettings);

        if (processingMode.mode === 'single_shift') {
            const result = await processSingleShiftAttendance(employeeNumber, date, filteredRawLogs, generalConfig, processingMode);
            return result;
        }

        // Step 1: Detect, Pair AND Assign Shifts (Integrated Loop)
        const { isSameDay } = require('./multiShiftDetectionService');
        const MAX_SHIFTS = processingMode.maxShiftsPerDay ?? 3;
        const splitThresholdHours = processingMode.continuousSplitThresholdHours ?? 14;
        const splitMinGapHours = processingMode.splitMinGapHours ?? 3;

        // Prepare Raw Logs (already filtered by getPunchesForPairing above)
        let sortedPunches = filteredRawLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        // DEDUPLICATION: Ignore punches within 5 minutes of each other (double-tap / accidental repeat)
        const DEDUP_WINDOW_MS = 5 * 60 * 1000;
        const deduplicatedPunches = [];
        for (const p of sortedPunches) {
            const last = deduplicatedPunches[deduplicatedPunches.length - 1];
            if (last && (new Date(p.timestamp) - new Date(last.timestamp)) < DEDUP_WINDOW_MS) {
                continue; // Skip double-taps
            }
            deduplicatedPunches.push(p);
        }

        // Respect log type: only CHECK-IN (type IN) starts a shift; only CHECK-OUT (type OUT) ends it.
        const punchesOnDate = deduplicatedPunches.filter(p => isSameDay(new Date(p.timestamp), date));
        const insOnDate = punchesOnDate.filter(p => p.type === 'IN');
        const outsOnDate = punchesOnDate.filter(p => p.type === 'OUT');
        let targetDatePunches = insOnDate; // Only IN punches can start a shift
        const allOutsFull = deduplicatedPunches.filter(p => p.type === 'OUT'); // Only OUT punches can end a shift
        const postShiftOutMarginHours = processingMode.postShiftOutMarginHours ?? 4;

        // NON-STRICT: Shift-aware First-IN / Last-OUT collapse (multi-thumbers, half-day, early-out)
        // Only collapse when span is within one shift (~14h); use first IN and last OUT on date by log type.
        let effectiveOutOverride = null;
        const firstInOnDate = insOnDate[0];
        const lastOutOnDate = outsOnDate.length ? outsOnDate[outsOnDate.length - 1] : null;
        const spanHours = (firstInOnDate && lastOutOnDate)
            ? (new Date(lastOutOnDate.timestamp) - new Date(firstInOnDate.timestamp)) / (60 * 60 * 1000)
            : 0;
        if (!processingMode.strictCheckInOutOnly && firstInOnDate && lastOutOnDate && spanHours >= 0 && spanHours < (processingMode.continuousSplitThresholdHours ?? 14)) {
            const configWithMode = { ...generalConfig, processingMode };
            const assignResult = await detectAndAssignShift(
                employeeNumber, date,
                firstInOnDate.timestamp, lastOutOnDate.timestamp,
                configWithMode
            );
            if (assignResult?.success && assignResult?.assignedShift) {
                const Shift = require('../../shifts/model/Shift');
                const shiftDef = await Shift.findById(assignResult.assignedShift).lean();
                if (shiftDef) {
                    const effective = getEffectiveInOutForShift(
                        punchesOnDate, shiftDef, date, postShiftOutMarginHours
                    );
                    if (effective && effective.effectiveIn !== effective.effectiveOut) {
                        targetDatePunches = [effective.effectiveIn];
                        effectiveOutOverride = effective.effectiveOut;
                    }
                }
            }
        }

        const configWithMode = { ...generalConfig, processingMode };

        // Step 2: Get employee ID & ODs (Moved up for context)
        const employee = await Employee.findOne({ emp_no: employeeNumber.toUpperCase() }).select('_id department_id division_id');
        const employeeId = employee ? employee._id : null;

        let odHours = 0;
        let odDetails = null;
        let approvedODs = [];

        if (employeeId) {
            const { createDateWithOffset } = require('../../shifts/services/shiftDetectionService');
            const dayStart = createDateWithOffset(date, '00:00');
            const dayEnd = createDateWithOffset(date, '23:59');
            dayEnd.setSeconds(59, 999);

            approvedODs = await OD.find({
                employeeId,
                status: 'approved',
                $or: [
                    { fromDate: { $lte: dayEnd }, toDate: { $gte: dayStart } }
                ],
                isActive: true
            });

            for (const od of approvedODs) {
                if (!odDetails) {
                    odDetails = {
                        odStartTime: od.startTime,
                        odEndTime: od.endTime,
                        durationHours: od.durationHours,
                        odType: od.odType_extended || (od.isHalfDay ? 'half_day' : 'full_day'),
                        odId: od._id,
                        approvedAt: od.updatedAt,
                        approvedBy: od.approvedBy
                    };
                }
                if (od.odType_extended === 'hours') {
                    odHours += od.durationHours || 0;
                } else if (od.odType_extended === 'half_day' || od.isHalfDay) {
                    odHours += 4.5;
                } else {
                    odHours += 9;
                }
            }
        }

        const processedShifts = [];
        let blockUntilTime = null; // The timestamp until which we ignore new IN punches
        let shiftCounter = 0;

        for (let i = 0; i < targetDatePunches.length; i++) {
            if (shiftCounter >= MAX_SHIFTS) break;

            const currentIn = targetDatePunches[i];
            const currentInTime = new Date(currentIn.timestamp);

            if (isNaN(currentInTime.getTime())) {
                console.warn(`[Smart-Pair] Invalid timestamp for employee ${employeeNumber} at index ${i}: ${currentIn.timestamp}`);
                continue;
            }

            // 1. Smart Filtering Check
            if (blockUntilTime && currentInTime <= blockUntilTime) {
                console.log(`[Smart-Pair] Skipping punch at ${currentIn.timestamp} (Locked until ${blockUntilTime})`);
                continue;
            }

            // 2. Initial Pair Detection (Closest next punch)
            // 36h window covers: 24hr shifts (9AM Day1→9AM Day2 = 24h), 9AM-9PM/9PM-9AM split
            // spans up to 36h from first IN. This must match the spec requirement.
            const MAX_WINDOW_MS = 36 * 60 * 60 * 1000;
            let nextOut = effectiveOutOverride && i === 0
                ? effectiveOutOverride
                : allOutsFull.find(p => {
                    const tDiff = new Date(p.timestamp) - currentInTime;
                    if (tDiff <= 0 || tDiff > MAX_WINDOW_MS || pairedOutIds.has(String(p._id || p.id))) return false;

                    // Prevent cross-day stealing: if there's an IN punch between currentIn and this OUT
                    // that is >= 12 hours after currentIn, don't pair.
                    const stealingIn = deduplicatedPunches.find(inP => 
                        inP.type === 'IN' && 
                        new Date(inP.timestamp) > currentInTime &&
                        new Date(inP.timestamp) < new Date(p.timestamp) &&
                        (new Date(inP.timestamp) - currentInTime) >= 12 * 60 * 60 * 1000
                    );
                    
                    return !stealingIn;
                });

            // --- ITERATIVE SPLIT (Design: 14h+3h first, 3h gap + half-day for 2nd/3rd) ---
            const durationMsNormal = nextOut ? (new Date(nextOut.timestamp) - currentInTime) : 0;
            const durationHours = durationMsNormal / (60 * 60 * 1000);
            const outTime = nextOut ? new Date(nextOut.timestamp) : null;

            if (nextOut && durationHours >= splitThresholdHours) {
                try {
                    const shiftOptions = { rosterStrictWhenPresent: processingMode.rosterStrictWhenPresent };
                    const { shifts: shiftsList } = await getShiftsForEmployee(employeeNumber, date, shiftOptions);

                    const findShiftStartingNear = (time, list) => {
                        return list.find(s => {
                            const diff = calculateTimeDifference(time, s.startTime, date);
                            return diff <= 60;
                        });
                    };

                    const firstShift = findShiftStartingNear(currentInTime, shiftsList);
                    if (!firstShift) {
                        // No first shift match - fall through to normal assignment
                    } else {
                        // Detect 24hr shift: startTime === endTime OR shift duration >= 24h
                        // In both cases end is on the NEXT day relative to IN time
                        const is24hrShift = (
                            firstShift.startTime === firstShift.endTime ||
                            (firstShift.duration != null && firstShift.duration >= 24)
                        );
                        const firstShiftIsOvernight = is24hrShift
                            ? true  // 24hr shift always ends next day
                            : timeToMinutes(firstShift.endTime) < timeToMinutes(firstShift.startTime);
                        const firstEndDate = timeStringToDate(firstShift.endTime, date, firstShiftIsOvernight);
                        const gapHours = (outTime.getTime() - firstEndDate.getTime()) / (60 * 60 * 1000);

                        console.log(`[MultiShift] firstShift=${firstShift.name}, is24hr=${is24hrShift}, firstEndDate=${firstEndDate.toISOString()}, gapHours=${gapHours.toFixed(2)}`);

                        // First segment: full rule - duration >= threshold, OUT > shift1 end, gap > 3h
                        const fullSplitHolds = outTime > firstEndDate && gapHours > splitMinGapHours;

                        if (fullSplitHolds) {
                            const splitSegments = [];
                            let prevEnd = firstEndDate;
                            let prevShift = firstShift;
                            let remainderOut = outTime;
                            let segmentIdx = 0;

                            splitSegments.push({
                                assignedShift: firstShift,
                                inTime: currentIn.timestamp,
                                outTime: firstEndDate.toISOString(),
                            });

                            segmentIdx++;
                            while (segmentIdx < MAX_SHIFTS) {
                                const segmentStart = prevEnd;
                                const spanHours = (remainderOut.getTime() - segmentStart.getTime()) / (60 * 60 * 1000);
                                const nextShift = findNextShiftAfter(segmentStart, shiftsList, date, prevShift);
                                if (!nextShift) break;

                                const segDateStr = formatDate(segmentStart);
                                // Detect 24hr shift: startTime === endTime OR shift duration >= 24h
                                const isNext24hrShift = (
                                    nextShift.startTime === nextShift.endTime ||
                                    (nextShift.duration != null && nextShift.duration >= 24)
                                );
                                const nextShiftIsOvernight = isNext24hrShift
                                    ? true
                                    : timeToMinutes(nextShift.endTime) < timeToMinutes(nextShift.startTime);
                                const nextEndDate = timeStringToDate(nextShift.endTime, segDateStr, nextShiftIsOvernight);
                                const nextGapHours = (remainderOut.getTime() - nextEndDate.getTime()) / (60 * 60 * 1000);

                                const halfDayHours = (nextShift.duration || 8) / 2;
                                const hasHalfDay = spanHours >= halfDayHours;

                                if (!hasHalfDay) {
                                    // Undergoes as extra hours - add to previous segment
                                    const prevSeg = splitSegments[splitSegments.length - 1];
                                    const extraHrs = Math.round(spanHours * 100) / 100;
                                    prevSeg.extraHours = (prevSeg.extraHours || 0) + extraHrs;
                                    break;
                                }

                                splitSegments.push({
                                    assignedShift: nextShift,
                                    inTime: segmentStart.toISOString(),
                                    outTime: nextGapHours > splitMinGapHours && remainderOut > nextEndDate ? nextEndDate.toISOString() : remainderOut.toISOString(),
                                    extraHours: 0,
                                });

                                if (nextGapHours <= splitMinGapHours || remainderOut <= nextEndDate) break;
                                prevEnd = nextEndDate;
                                prevShift = nextShift;
                                segmentIdx++;
                            }

                            const basePayablePerShift = (s) => (s.payableShifts !== undefined && s.payableShifts != null ? Number(s.payableShifts) : 1);
                            for (const split of splitSegments) {
                                if (shiftCounter >= MAX_SHIFTS) break;
                                shiftCounter++;
                                const sIn = new Date(split.inTime);
                                const sOut = new Date(split.outTime);
                                const sDuration = sOut - sIn;
                                const sWorkingHours = Math.round((sDuration / 3600000) * 100) / 100;
                                const expectedH = split.assignedShift.duration || 8;
                                const extraH = Math.max(0, sWorkingHours - expectedH);
                                const effectiveWorking = sWorkingHours + (split.extraHours || 0);

                                // Status & payable per segment: PRESENT = full, HALF_DAY = 0.5, ABSENT = 0
                                let segStatus = 'PRESENT';
                                let segPayable = basePayablePerShift(split.assignedShift);
                                const statusRatio = expectedH > 0 ? effectiveWorking / expectedH : 1;
                                if (statusRatio >= 0.75) {
                                    segStatus = 'PRESENT';
                                    segPayable = basePayablePerShift(split.assignedShift);
                                } else if (statusRatio >= 0.40) {
                                    segStatus = 'HALF_DAY';
                                    segPayable = basePayablePerShift(split.assignedShift) * 0.5;
                                } else {
                                    segStatus = 'ABSENT';
                                    segPayable = 0;
                                }

                                const shiftStart = timeStringToDate(split.assignedShift.startTime, formatDate(sIn), false);
                                const isOvernightSeg = timeToMinutes(split.assignedShift.endTime) < timeToMinutes(split.assignedShift.startTime);
                                const shiftEnd = timeStringToDate(split.assignedShift.endTime, formatDate(sIn), isOvernightSeg);
                                const lateInMs = sIn < shiftStart ? 0 : (sIn.getTime() - shiftStart.getTime());
                                const earlyOutMs = (sOut && sOut < shiftEnd) ? (shiftEnd.getTime() - sOut.getTime()) : 0;
                                // Half-day loss is the penalty; do not also count early-out (avoid double penalty)
                                const segEarlyOutMs = segStatus === 'HALF_DAY' ? 0 : earlyOutMs;
                                const segEarlyOutMinutes = segStatus === 'HALF_DAY' ? 0 : Math.round(earlyOutMs / 60000);

                                const pSplitShift = {
                                    shiftNumber: shiftCounter,
                                    inTime: split.inTime,
                                    outTime: split.outTime,
                                    duration: Math.round(sDuration / 60000),
                                    punchHours: sWorkingHours,
                                    workingHours: Math.round((sWorkingHours + (split.extraHours || 0)) * 100) / 100,
                                    odHours: 0,
                                    extraHours: Math.round((extraH + (split.extraHours || 0)) * 100) / 100,
                                    otHours: 0,
                                    status: segStatus,
                                    inPunchId: currentIn._id || currentIn.id,
                                    outPunchId: nextOut ? (nextOut._id || nextOut.id) : null,
                                    shiftId: split.assignedShift._id,
                                    shiftName: split.assignedShift.name,
                                    shiftStartTime: split.assignedShift.startTime,
                                    shiftEndTime: split.assignedShift.endTime,
                                    expectedHours: expectedH,
                                    isLateIn: lateInMs > 0,
                                    lateInMinutes: Math.round(lateInMs / 60000),
                                    isEarlyOut: segEarlyOutMs > 0,
                                    earlyOutMinutes: segEarlyOutMinutes,
                                    payableShift: segPayable,
                                };
                                processedShifts.push(pSplitShift);
                            }
                            blockUntilTime = new Date(nextOut.timestamp);
                            continue;
                        }
                    }
                } catch (e) { console.error("[MultiShift] Iterative Split Error", e); }
            }

            // 3. Shift Assignment & Fallback Refinement
            let shiftAssignment = null;
            let assignedShiftDef = null;
            try {
                shiftAssignment = await detectAndAssignShift(
                    employeeNumber,
                    date,
                    currentIn.timestamp,
                    nextOut ? nextOut.timestamp : null,
                    configWithMode
                );

                // If NO shift matched and we have a nextOut, check the 1-hour rule
                if ((!shiftAssignment || !shiftAssignment.success) && nextOut) {
                    const tDiff = new Date(nextOut.timestamp) - currentInTime;
                    if (tDiff < 60 * 60 * 1000) {
                        // User requirement: If no shift, ignore for 1 hour
                        console.log(`[Smart-Pair] No shift and punch at ${nextOut.timestamp} is < 1hr. Skipping it as OUT.`);

                        // Re-search for nextOut after 1 hour
                        nextOut = allOutsFull.find(p => {
                            const tDiff2 = new Date(p.timestamp) - currentInTime;
                            if (tDiff2 < 60 * 60 * 1000 || tDiff2 > MAX_WINDOW_MS || pairedOutIds.has(String(p._id || p.id))) return false;
                            
                            const stealingIn = deduplicatedPunches.find(inP => 
                                inP.type === 'IN' && 
                                new Date(inP.timestamp) > currentInTime &&
                                new Date(inP.timestamp) < new Date(p.timestamp) &&
                                (new Date(inP.timestamp) - currentInTime) >= 12 * 60 * 60 * 1000
                            );
                            
                            return !stealingIn;
                        });

                        // Try assignment again with the better OUT (if found)
                        if (nextOut) {
                            shiftAssignment = await detectAndAssignShift(
                                employeeNumber,
                                date,
                                currentIn.timestamp,
                                nextOut.timestamp,
                                configWithMode
                            );
                        }
                    }
                }

                // Fetch Shift Def for Payable Value
                if (shiftAssignment && shiftAssignment.assignedShift) {
                    const Shift = require('../../shifts/model/Shift');
                    assignedShiftDef = await Shift.findById(shiftAssignment.assignedShift).select('payableShifts duration');
                }

            } catch (e) {
                console.error("Assignment Error", e);
            }

            // 4. Determine Block Time for NEXT iteration
            if (shiftAssignment && shiftAssignment.success && shiftAssignment.shiftEndTime) {
                const shiftEnd = timeStringToDate(shiftAssignment.shiftEndTime, date, shiftAssignment.shiftEndTime < shiftAssignment.shiftStartTime);
                const outTime = nextOut ? new Date(nextOut.timestamp) : null;
                // Allow starting a new shift immediately after an early OUT by using outTime if available
                blockUntilTime = outTime || shiftEnd;
            } else {
                // FALLBACK Block: If no shift, block for 1 hour from current In
                const fallbackBlock = new Date(currentInTime.getTime() + 60 * 60 * 1000);
                const outTime = nextOut ? new Date(nextOut.timestamp) : null;
                blockUntilTime = outTime || fallbackBlock;
            }

            if (nextOut) {
                pairedOutIds.add(String(nextOut._id || nextOut.id));
            }

            // 5. Construct Processed Shift Object (payableShift default 0; set from status below when assignment succeeds)
            shiftCounter++;
            const durationMs = nextOut ? (new Date(nextOut.timestamp) - currentInTime) : 0;

            const pShift = {
                shiftNumber: shiftCounter,
                inTime: currentIn.timestamp,
                outTime: nextOut ? nextOut.timestamp : null,
                duration: Math.round(durationMs / 60000),
                punchHours: Math.round((durationMs / 3600000) * 100) / 100,
                workingHours: Math.round((durationMs / 3600000) * 100) / 100,
                odHours: 0,
                extraHours: 0,
                otHours: 0,
                status: nextOut ? 'complete' : 'incomplete',
                payableShift: 0,
                inPunchId: currentIn._id || currentIn.id,
                outPunchId: nextOut ? (nextOut._id || nextOut.id) : null
            };

            // 6. Enrich with Assignment Data
            if (shiftAssignment && shiftAssignment.success) {
                pShift.shiftId = shiftAssignment.assignedShift;
                pShift.shiftName = shiftAssignment.shiftName;
                pShift.shiftStartTime = shiftAssignment.shiftStartTime;
                pShift.shiftEndTime = shiftAssignment.shiftEndTime;
                pShift.lateInMinutes = shiftAssignment.lateInMinutes;
                pShift.earlyOutMinutes = shiftAssignment.earlyOutMinutes;
                pShift.isLateIn = shiftAssignment.isLateIn;
                pShift.isEarlyOut = shiftAssignment.isEarlyOut;

                // Calculate Extra Hours
                if (assignedShiftDef && assignedShiftDef.duration) {
                    const extra = pShift.workingHours - assignedShiftDef.duration;
                    if (extra > 0) {
                        pShift.extraHours = Math.round(extra * 100) / 100;
                    }
                }

                // GAP-FILLING OD LOGIC
                if (approvedODs && approvedODs.length > 0) {
                    const shiftStart = timeStringToDate(shiftAssignment.shiftStartTime, date);
                    const shiftEnd = timeStringToDate(shiftAssignment.shiftEndTime, date, shiftAssignment.shiftEndTime < shiftAssignment.shiftStartTime);

                    const punchIn = new Date(pShift.inTime);
                    const punchOut = pShift.outTime ? new Date(pShift.outTime) : null;

                    let addedOdMinutes = 0;

                    for (const od of approvedODs) {
                        if (od.odType_extended === 'hours' && od.odStartTime && od.odEndTime) {
                            const odStart = timeStringToDate(od.odStartTime, date);
                            const odEnd = timeStringToDate(od.odEndTime, date, od.odEndTime < od.odStartTime);

                            // 1. Calculate Overlap between OD and Shift range
                            const odInShiftOverlap = getOverlapMinutes(shiftStart, shiftEnd, odStart, odEnd);

                            // 2. Calculate portion of OD already covered by Punches
                            let odInPunchOverlap = 0;
                            if (punchIn && punchOut) {
                                odInPunchOverlap = getOverlapMinutes(punchIn, punchOut, odStart, odEnd);
                            }

                            // 3. Gap Hours = (OD in Shift) - (OD in Punch)
                            const gapMinutes = Math.max(0, odInShiftOverlap - odInPunchOverlap);
                            addedOdMinutes += gapMinutes;

                            // 4. Check for Penalty Waiver (approved OD timings cover shift start/end)
                            if (pShift.isLateIn && odStart <= shiftStart && odEnd >= punchIn) {
                                pShift.isLateIn = false;
                                pShift.lateInMinutes = 0;
                            }
                            if (pShift.isEarlyOut && punchOut && odStart <= punchOut && odEnd >= shiftEnd) {
                                pShift.isEarlyOut = false;
                                pShift.earlyOutMinutes = 0;
                            }
                        }
                    }

                    const addedOdHours = Math.round((addedOdMinutes / 60) * 100) / 100;
                    pShift.odHours = addedOdHours;
                    pShift.workingHours = Math.round((pShift.punchHours + addedOdHours) * 100) / 100;
                }

                // Calculate Status based on rules
                const expectedDuration = (shiftAssignment && shiftAssignment.expectedHours) || 8;

                // Calculate Effective Duration for Status Determination
                const shiftStart = (pShift.shiftStartTime) ? timeStringToDate(pShift.shiftStartTime, date) : null;
                const shiftEnd = (pShift.shiftEndTime) ? timeStringToDate(pShift.shiftEndTime, date, pShift.shiftEndTime < pShift.shiftStartTime) : null;

                const punchIn = new Date(pShift.inTime);
                const punchOut = pShift.outTime ? new Date(pShift.outTime) : null;

                let statusDuration = 0;
                if (punchIn && punchOut && shiftStart) {
                    const effectiveIn = new Date(Math.max(punchIn.getTime(), shiftStart.getTime()));
                    const effectiveOut = punchOut;
                    statusDuration = Math.max(0, (effectiveOut - effectiveIn) / 3600000);
                } else if (punchIn && punchOut) {
                    statusDuration = pShift.workingHours;
                }

                statusDuration += (pShift.odHours || 0);
                pShift.expectedHours = expectedDuration;

                // Determine Base Payable Value
                const basePayable = (assignedShiftDef && assignedShiftDef.payableShifts !== undefined) ? assignedShiftDef.payableShifts : 1;

                // Extra Hours Calculation (moved out for fallback usage)
                const refDuration = (assignedShiftDef && assignedShiftDef.duration) || 8;
                if (pShift.workingHours > refDuration) {
                    pShift.extraHours = Math.round((pShift.workingHours - refDuration) * 100) / 100;
                }

                // Thresholds: > 75% = PRESENT, 40%-75% = HALF_DAY, < 40% = ABSENT
                if (statusDuration >= (expectedDuration * 0.75)) {
                    pShift.status = 'PRESENT';
                    pShift.payableShift = basePayable;
                } else if (statusDuration >= (expectedDuration * 0.40)) {
                    pShift.status = 'HALF_DAY';
                    pShift.payableShift = basePayable * 0.5;
                    // Half-day loss is the penalty; do not also count early-out in aggregates (avoid double penalty)
                    pShift.earlyOutMinutes = null;
                    pShift.isEarlyOut = false;
                } else {
                    pShift.status = 'ABSENT';
                    pShift.payableShift = 0;
                }

                console.log(`[MultiShift] Processing segment ${shiftCounter} for ${employeeNumber}: statusDuration=${statusDuration.toFixed(2)}, Expected=${expectedDuration}`);
                console.log(`[MultiShift] Segment ${shiftCounter} Status: ${pShift.status}, Payable: ${pShift.payableShift}`);
            }

            processedShifts.push(pShift);
        }

        // Step 5: Calculate daily totals
        const totals = calculateDailyTotals(processedShifts);

        // Step 6: Determine overall status
        const totalPayableShifts = processedShifts.reduce((sum, s) => sum + (s.payableShift || 0), 0);

        // Check for any Present shift
        const hasPresentShift = processedShifts.some(s => s.status === 'complete' || s.status === 'PRESENT' || (s.payableShift && s.payableShift >= 1));

        let status = 'ABSENT';

        if (processedShifts.length > 0) {
            if (hasPresentShift || totalPayableShifts >= 0.95) {
                status = 'PRESENT';
            } else if (totalPayableShifts >= 0.45 || processedShifts.some(s => s.status === 'HALF_DAY')) {
                status = 'HALF_DAY';
            } else {
                const hasIncomplete = processedShifts.some(s => !s.outTime);
                status = hasIncomplete ? 'PARTIAL' : 'ABSENT';
            }
        }

        // Step 7: Prepare update data for AttendanceDaily
        const updateData = {
            // Multi-shift fields
            shifts: processedShifts,
            totalShifts: totals.totalShifts,
            totalWorkingHours: totals.totalWorkingHours,
            totalOTHours: totals.totalOTHours,
            extraHours: totals.totalExtraHours,
            payableShifts: totalPayableShifts,

            // Backward compatibility fields (Metrics)
            odHours,
            odDetails,
            status,
            lastSyncedAt: new Date(),

            // Primary shift fields (from first shift)
            // shiftId, lateInMinutes, etc. removed - using shifts array

            // New Aggregate Fields (if not already handled by pre-save, but good to set explicitly if we have them)
            totalLateInMinutes: processedShifts.reduce((acc, s) => acc + (s.lateInMinutes || 0), 0),
            totalEarlyOutMinutes: processedShifts.reduce((acc, s) => acc + (s.earlyOutMinutes || 0), 0),
            totalExpectedHours: processedShifts.reduce((acc, s) => acc + (s.expectedHours || 0), 0),

            otHours: totals.totalOTHours,
        };

        // Step 8: Update or create daily record
        console.log(`[Multi-Shift Processing] Updating daily record with ${totals.totalShifts} shift(s)`);

        let dailyRecord = await AttendanceDaily.findOne({ employeeNumber, date });

        if (!dailyRecord) {
            dailyRecord = new AttendanceDaily({
                employeeNumber,
                date,
                shifts: processedShifts,
                ...updateData
            });
        } else {
            // Update individual fields
            Object.keys(updateData).forEach(key => {
                dailyRecord[key] = updateData[key];
            });
        }

        // Standardize source tracking
        if (!dailyRecord.source) dailyRecord.source = [];
        if (!dailyRecord.source.includes('biometric-realtime')) {
            dailyRecord.source.push('biometric-realtime');
        }

        // Trigger hooks via .save() — monthly summary is recalculated in background by post-save hook
        await dailyRecord.save();

        console.log(`[Multi-Shift Processing] ✓ Daily record updated and hooks triggered successfully`);
        return {
            success: true,
            dailyRecord,
            shiftsProcessed: totals.totalShifts,
            totalHours: totals.totalWorkingHours,
            totalOT: totals.totalOTHours,
        };

    } catch (error) {
        console.error(`[Multi-Shift Processing] Error:`, error);
        return {
            success: false,
            error: error.message,
        };
    }
}

/**
 * Helper to calculate daily totals from processed shifts
 */
function calculateDailyTotals(shifts) {
    let totalWorkingHours = 0;
    let totalOTHours = 0;
    let totalExtraHours = 0;
    let firstInTime = null;
    let lastOutTime = null;

    if (shifts && shifts.length > 0) {
        // Sort by inTime to be safe
        const sorted = [...shifts].sort((a, b) => new Date(a.inTime) - new Date(b.inTime));

        firstInTime = sorted[0].inTime;
        lastOutTime = sorted[sorted.length - 1].outTime;

        for (const shift of shifts) {
            totalWorkingHours += (parseFloat(shift.workingHours) || 0);
            totalOTHours += (parseFloat(shift.otHours) || 0);
            totalExtraHours += (parseFloat(shift.extraHours) || 0);
        }
    }

    return {
        totalShifts: shifts.length,
        totalWorkingHours: Math.round(totalWorkingHours * 100) / 100,
        totalOTHours: Math.round(totalOTHours * 100) / 100,
        totalExtraHours: Math.round(totalExtraHours * 100) / 100,
        firstInTime,
        lastOutTime
    };
}

/**
 * Process multiple employees and dates with multi-shift support
 * @param {Object} logsByEmployee - Logs grouped by employee
 * @param {Object} generalConfig - General settings
 * @returns {Promise<Object>} Processing statistics
 */
async function processMultiShiftBatch(logsByEmployee, generalConfig) {
    const stats = {
        employeesProcessed: 0,
        datesProcessed: 0,
        totalShiftsCreated: 0,
        errors: [],
    };

    for (const [employeeNumber, logs] of Object.entries(logsByEmployee)) {
        try {
            // Group logs by date
            const logsByDate = {};

            for (const log of logs) {
                const date = formatDate(log.timestamp);
                if (!logsByDate[date]) {
                    logsByDate[date] = [];
                }
                logsByDate[date].push(log);
            }

            // Cross-day OUT injection: for overnight/24hr shifts, the OUT punch on date+1
            // must be available when processing date. Without this, allOutsFull won't contain
            // the next-day OUT and the shift stays 'incomplete'.
            // Logic: for each date, also attach OUT punches from the next calendar date.
            const allDates = Object.keys(logsByDate).sort();
            for (const date of allDates) {
                // Build next date string
                const [y, m, d] = date.split('-').map(Number);
                const nextDt = new Date(Date.UTC(y, m - 1, d + 1));
                const nextDateStr = `${nextDt.getUTCFullYear()}-${String(nextDt.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDt.getUTCDate()).padStart(2, '0')}`;
                const nextDayLogs = logsByDate[nextDateStr];
                if (nextDayLogs && nextDayLogs.length > 0) {
                    const nextDayOuts = nextDayLogs.filter(l => l.type === 'OUT' || l.punch_state === 1 || l.punch_state === '1');
                    if (nextDayOuts.length > 0) {
                        // Only inject OUTs within 36h of earliest IN on current date
                        const currentIns = logsByDate[date].filter(l => l.type === 'IN' || l.punch_state === 0 || l.punch_state === '0');
                        const earliestIn = currentIns.length > 0
                            ? new Date(Math.min(...currentIns.map(l => new Date(l.timestamp).getTime())))
                            : null;
                        const MAX_CROSS_DAY_MS = 36 * 60 * 60 * 1000;
                        const eligibleOuts = earliestIn
                            ? nextDayOuts.filter(l => {
                                const diff = new Date(l.timestamp).getTime() - earliestIn.getTime();
                                return diff > 0 && diff <= MAX_CROSS_DAY_MS;
                            })
                            : nextDayOuts;
                        if (eligibleOuts.length > 0) {
                            // Avoid duplicates
                            const existingIds = new Set(logsByDate[date].map(l => String(l._id || l.id || l.timestamp)));
                            const toAdd = eligibleOuts.filter(l => !existingIds.has(String(l._id || l.id || l.timestamp)));
                            logsByDate[date] = [...logsByDate[date], ...toAdd];
                            console.log(`[MultiShift-Batch] Injected ${toAdd.length} next-day OUT(s) from ${nextDateStr} into ${date} for ${employeeNumber}`);
                        }
                    }
                }
            }

            const pairedOutIds = new Set();
            
            // Process each date
            for (const [date, dateLogs] of Object.entries(logsByDate)) {
                const result = await processMultiShiftAttendance(
                    employeeNumber,
                    date,
                    dateLogs, // Pass enriched logs (includes cross-day OUTs)
                    generalConfig,
                    pairedOutIds
                );


                if (result.success) {
                    stats.datesProcessed++;
                    stats.totalShiftsCreated += result.shiftsProcessed || 0;
                } else {
                    stats.errors.push(`${employeeNumber} on ${date}: ${result.error || result.reason}`);
                }
            }

            stats.employeesProcessed++;

        } catch (error) {
            stats.errors.push(`Error processing ${employeeNumber}: ${error.message}`);
        }
    }

    return stats;
}

module.exports = {
    processMultiShiftAttendance,
    processMultiShiftBatch,
    formatDate,
};
