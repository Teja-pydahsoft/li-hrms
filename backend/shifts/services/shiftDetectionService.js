/**
 * Shift Detection Service
 * Automatically detects and assigns shifts to attendance records
 * Priority: Pre-Scheduled → Designation → Department → General Shifts
 */

const Employee = require('../../employees/model/Employee');
const Department = require('../../departments/model/Department');
const Designation = require('../../departments/model/Designation');
const Division = require('../../departments/model/Division');
const Shift = require('../model/Shift');
const PreScheduledShift = require('../model/PreScheduledShift');
const ConfusedShift = require('../model/ConfusedShift');
const AttendanceDaily = require('../../attendance/model/AttendanceDaily');
const Settings = require('../../settings/model/Settings');
const { extractISTComponents, createISTDate } = require('../../shared/utils/dateUtils');

/**
 * Convert time string (HH:mm) to minutes from midnight
 */
const timeToMinutes = (timeStr) => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
};

/**
 * Calculate time difference between punch time and shift start time
 * Handles overnight shifts correctly by considering date context
 * @param {Date} punchTime - The actual punch time (with date)
 * @param {String} shiftStartTime - Shift start time (HH:mm)
 * @param {String} date - Date string (YYYY-MM-DD) - the attendance date
 * @returns {Number} - Time difference in minutes (absolute value)
 */
/**
 * Helper to construct a Date object for a specific date and time in the target timezone (default IST)
 * Ensures consistency regardless of server timezone (UTC, etc)
 */
// DEPRECATED: Replaced by shared createISTDate in dateUtils
const createDateWithOffset = (dateStr, timeStr, offset = '+05:30') => {
  return createISTDate(dateStr, timeStr);
};

/**
 * Calculate time difference between punch time and shift start time
 * Handles overnight shifts correctly by considering date context
 * @param {Date} punchTime - The actual punch time (with date)
 * @param {String} shiftStartTime - Shift start time (HH:mm)
 * @param {String} date - Date string (YYYY-MM-DD) - the attendance date
 * @returns {Number} - Time difference in minutes (absolute value)
 */
const calculateTimeDifference = (punchTime, shiftStartTime, date) => {
  // Get punch time components in IST correctly
  const { hour, minute } = extractISTComponents(punchTime);
  const punchMinutes = (hour % 24) * 60 + minute;
  const punchDate = new Date(punchTime);

  // Get shift start time components
  const [shiftStartHour, shiftStartMin] = shiftStartTime.split(':').map(Number);

  // Create shift start time on the attendance date using Explicit Offset
  const shiftStartDate = createDateWithOffset(date, shiftStartTime);

  // Calculate difference in milliseconds, then convert to minutes
  let differenceMs = Math.abs(punchDate.getTime() - shiftStartDate.getTime());
  let differenceMinutes = differenceMs / (1000 * 60);

  // Handle overnight shifts - if shift starts late (20:00+) and punch is early morning (before 12:00)
  // Consider it might be for the shift that started the previous evening
  // Note: shiftStartHour is local (e.g. 20), punchDate.getHours() is server local (UTC or IST)
  // Logic simplified: Check previous day
  if (shiftStartHour >= 20) {
    // Check if punch is actually closer to "Yesterday's Shift"
    const { year, month, day } = extractISTComponents(date);
    const d = createISTDate(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    d.setDate(d.getDate() - 1);
    const { dateStr: prevDateStr } = extractISTComponents(d);

    const prevShiftStart = createDateWithOffset(prevDateStr, shiftStartTime);
    const prevDiff = Math.abs(punchDate.getTime() - prevShiftStart.getTime()) / (1000 * 60);

    if (prevDiff < differenceMinutes) {
      differenceMinutes = prevDiff;
    }
  }

  // If difference is more than 12 hours for non-overnight shifts, consider it might be wrapping around
  // But for overnight shifts, we already handled it above
  if (differenceMinutes > 12 * 60 && shiftStartHour < 20) {
    differenceMinutes = 24 * 60 - differenceMinutes;
  }

  return differenceMinutes;
};


/**
 * Check if a time falls within a shift window (DEPRECATED - kept for backward compatibility)
 * Grace period is now only used for late-in calculation, not matching
 * @param {Date} punchTime - The actual punch time
 * @param {String} shiftStartTime - Shift start time (HH:mm)
 * @param {Number} gracePeriodMinutes - Grace period in minutes (not used for matching)
 * @returns {Boolean} - True if within window
 */
const isWithinShiftWindow = (punchTime, shiftStartTime, gracePeriodMinutes = 15) => {
  // This function is deprecated - matching now uses proximity, not grace period
  const istPunch = new Date(punchTime.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const punchMinutes = istPunch.getHours() * 60 + istPunch.getMinutes();
  const shiftStartMinutes = timeToMinutes(shiftStartTime);
  const graceEndMinutes = shiftStartMinutes + gracePeriodMinutes;

  // Handle overnight shifts
  if (graceEndMinutes >= 24 * 60) {
    return punchMinutes >= shiftStartMinutes || punchMinutes <= (graceEndMinutes % (24 * 60));
  }

  return punchMinutes >= shiftStartMinutes && punchMinutes <= graceEndMinutes;
};

/**
 * Filter shift configurations based on employee gender
 * Handles both new config objects and legacy ID arrays
 * @param {Array} shiftConfigs - Array of shift configs ({shiftId, gender}) or IDs
 * @param {String} employeeGender - Employee's gender (Male/Female/Other)
 * @returns {Array} - Array of Shift IDs
 */
const filterShiftsByGender = (shiftConfigs, employeeGender) => {
  if (!shiftConfigs || !Array.isArray(shiftConfigs) || shiftConfigs.length === 0) {
    return [];
  }

  // Check data structure (Config Object vs Legacy ID)
  const isConfigObject = shiftConfigs[0].shiftId !== undefined;

  if (!isConfigObject) {
    // Legacy: Array of IDs -> No gender restriction (Backward Compatibility)
    return shiftConfigs;
  }

  // New Structure: Filter by gender
  return shiftConfigs
    .filter(config => {
      if (!config || !config.shiftId) return false;

      // If no gender specified or 'All', allow it
      if (!config.gender || config.gender === 'All') return true;

      // Use case-insensitive match just in case
      return config.gender.toLowerCase() === (employeeGender || '').toLowerCase();
    })
    .map(config => config.shiftId);
};

/**
 * Get shifts for employee based on priority
 * Priority: Pre-Scheduled → Designation → Department → Division → Global
 * @param {String} employeeNumber
 * @param {String} date - YYYY-MM-DD
 * @param {Object} options - { rosterStrictWhenPresent } when true, if roster exists use ONLY roster
 */
const getShiftsForEmployee = async (employeeNumber, date, options = {}) => {
  try {
    const rosterStrictWhenPresent = options.rosterStrictWhenPresent === true;

    // Get employee details with all organizational links
    const employee = await Employee.findOne({ emp_no: employeeNumber })
      .populate('division_id')
      .populate('department_id')
      .populate('designation_id');

    if (!employee) {
      return { shifts: [], source: 'none' };
    }

    const division_id = employee.division_id?._id;
    const department_id = employee.department_id?._id;
    const designation_id = employee.designation_id?._id;
    const employeeGender = employee.gender;

    if (!division_id) {
      console.warn(`[ShiftDetection] Employee ${employeeNumber} has no division_id assigned.`);
    }

    // 0. Check DOJ and LeftDate (Joining and Resignation Boundaries)
    if (employee.doj) {
      const dojStr = extractISTComponents(employee.doj).dateStr;
      if (date < dojStr) {
        console.log(`[ShiftDetection] Skipping shifts for ${employeeNumber} on ${date}: Before joining (${dojStr})`);
        return { shifts: [], source: 'before_joining' };
      }
    }

    if (employee.leftDate) {
      const leftStr = extractISTComponents(employee.leftDate).dateStr;
      if (date > leftStr) {
        console.log(`[ShiftDetection] Skipping shifts for ${employeeNumber} on ${date}: After resignation (${leftStr})`);
        return { shifts: [], source: 'resigned' };
      }
    }

    const allCandidateShifts = new Map();
    let rosteredShift = null;
    let rosterRecordId = null;

    // 1. Check pre-scheduled shift (Tier 1 - Highest Priority)
    const preScheduled = await PreScheduledShift.findOne({
      employeeNumber: employeeNumber.toUpperCase(),
      date: date,
    }).populate('shiftId');

    if (preScheduled && preScheduled.shiftId) {
      rosteredShift = preScheduled.shiftId;
      rosterRecordId = preScheduled._id;
      const s = preScheduled.shiftId.toObject ? preScheduled.shiftId.toObject() : { ...preScheduled.shiftId };
      s.sourcePriority = 1; // Highest Priority
      allCandidateShifts.set(s._id.toString(), s);
      // Roster strict: when roster exists, use ONLY roster; do not add organizational shifts
      if (rosterStrictWhenPresent) {
        return {
          shifts: Array.from(allCandidateShifts.values()),
          source: 'pre_scheduled',
          rosteredShiftId: rosteredShift._id,
          rosterRecordId: rosterRecordId,
        };
      }
    }

    // 2. Designation shifts (Context-Specific & Division Defaults)
    if (designation_id && employee.designation_id) {
      let shiftIds = [];
      const desig = employee.designation_id;

      // Tier 2: (Division + Department) Specific Override
      if (division_id && department_id && desig.departmentShifts) {
        const contextOverride = desig.departmentShifts.find(
          ds => ds.division?.toString() === division_id.toString() &&
            ds.department?.toString() === department_id.toString()
        );
        if (contextOverride && contextOverride.shifts?.length > 0) {
          shiftIds = filterShiftsByGender(contextOverride.shifts, employeeGender);
        }
      }

      // Tier 3: Division-Global Designation Default
      if (shiftIds.length === 0 && division_id && desig.divisionDefaults) {
        const divisionDefault = desig.divisionDefaults.find(
          dd => dd.division?.toString() === division_id.toString()
        );
        if (divisionDefault && divisionDefault.shifts?.length > 0) {
          shiftIds = filterShiftsByGender(divisionDefault.shifts, employeeGender);
        }
      }

      // Tier 4: Backward Compatibility Fallback (Global designation shifts)
      if (shiftIds.length === 0 && !division_id && desig.shifts?.length > 0) {
        shiftIds = filterShiftsByGender(desig.shifts, employeeGender);
      }

      if (shiftIds.length > 0) {
        const designationShifts = await Shift.find({ _id: { $in: shiftIds }, isActive: true });
        designationShifts.forEach(s => {
          s.sourcePriority = 2; // Designation Priority
          allCandidateShifts.set(s._id.toString(), s);
        });
      }
    }

    // 3. Department shifts (Tier 3)
    if (department_id && employee.department_id) {
      let deptShiftIds = [];
      const dept = employee.department_id;

      if (division_id && dept.divisionDefaults) {
        const divDeptDefault = dept.divisionDefaults.find(
          dd => dd.division?.toString() === division_id.toString()
        );
        if (divDeptDefault && divDeptDefault.shifts?.length > 0) {
          deptShiftIds = filterShiftsByGender(divDeptDefault.shifts, employeeGender);
        }
      }

      if (deptShiftIds.length === 0 && !division_id && dept.shifts?.length > 0) {
        deptShiftIds = filterShiftsByGender(dept.shifts, employeeGender);
      }

      if (deptShiftIds.length > 0) {
        const departmentShifts = await Shift.find({ _id: { $in: deptShiftIds }, isActive: true });
        departmentShifts.forEach(s => {
          if (!allCandidateShifts.has(s._id.toString())) {
            s.sourcePriority = 3; // Department Priority
            allCandidateShifts.set(s._id.toString(), s);
          }
        });
      }
    }

    // 4. Division Baseline Shifts (Tier 4)
    if (allCandidateShifts.size === 0 && division_id && employee.division_id) {
      const division = employee.division_id;
      if (division.shifts && division.shifts.length > 0) {
        const filteredDivisionShifts = filterShiftsByGender(division.shifts, employeeGender);
        const divisionShifts = await Shift.find({ _id: { $in: filteredDivisionShifts }, isActive: true });
        divisionShifts.forEach(s => {
          s.sourcePriority = 4; // Division Priority
          allCandidateShifts.set(s._id.toString(), s);
        });
      }
    }

    // 5. Global Fallback (Tier 5)
    if (allCandidateShifts.size === 0) {
      const generalShifts = await Shift.find({ isActive: true });
      generalShifts.forEach(s => {
        s.sourcePriority = 5; // Global Priority
        allCandidateShifts.set(s._id.toString(), s);
      });
    }

    return {
      shifts: Array.from(allCandidateShifts.values()),
      source: rosteredShift ? 'pre_scheduled' : 'organizational',
      rosteredShiftId: rosteredShift?._id || null,
      rosterRecordId: rosterRecordId,
    };

  } catch (error) {
    console.error('Error getting shifts for employee:', error);
    return { shifts: [], source: 'none' };
  }
};

/**
 * Find candidate shifts based on proximity to in-time (not grace period)
 * @param {Date} inTime - Employee's in-time
 * @param {Array} shifts - Array of shift objects
 * @param {String} date - Date string (YYYY-MM-DD) - the attendance date
 * @param {Number} toleranceHours - Maximum hours difference to consider (default 3 hours)
 */
const findCandidateShifts = (inTime, shifts, date, toleranceHours = 3) => {
  const candidates = [];
  const toleranceMinutes = toleranceHours * 60;
  const preferredMaxDifference = 35;

  // Use IST context for minutes comparison
  const istInTime = new Date(inTime.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const inMinutes = istInTime.getHours() * 60 + istInTime.getMinutes();

  for (const shift of shifts) {
    const difference = calculateTimeDifference(inTime, shift.startTime, date);

    if (difference <= toleranceMinutes) {
      const shiftStartMinutes = timeToMinutes(shift.startTime);
      let isStartBeforeLog = false;

      // Handle overnight shifts
      if (shiftStartMinutes >= 20 * 60 && inMinutes < 12 * 60) {
        isStartBeforeLog = true;
      } else {
        isStartBeforeLog = shiftStartMinutes <= inMinutes;
      }

      const isPreferred = isStartBeforeLog && difference <= preferredMaxDifference;

      candidates.push({
        shiftId: shift._id,
        shiftName: shift.name,
        startTime: shift.startTime,
        endTime: shift.endTime,
        duration: shift.duration,
        gracePeriod: shift.gracePeriod || 15,
        differenceMinutes: difference,
        isStartBeforeLog: isStartBeforeLog,
        isPreferred: isPreferred,
        sourcePriority: shift.sourcePriority || 99,
        matchReason: `In-time ${istInTime.toLocaleTimeString()} is ${difference.toFixed(1)} minutes from shift ${shift.name} start (${shift.startTime})`,
      });
    }
  }

  return candidates.sort((a, b) => {
    // 1. HARD PRIORITY: Rostered Shift (Priority 1) always wins if it's a candidate
    // This satisfies "assign rostered shift only" while allowing fallbacks if roster is far away
    if (a.sourcePriority === 1 && b.sourcePriority !== 1) return -1;
    if (a.sourcePriority !== 1 && b.sourcePriority === 1) return 1;

    // 2. Standard proximity sorting for organizational/fallback shifts
    if (a.isPreferred && !b.isPreferred) return -1;
    if (!a.isPreferred && b.isPreferred) return 1;
    if (a.isStartBeforeLog && !b.isStartBeforeLog) return -1;
    if (!a.isStartBeforeLog && b.isStartBeforeLog) return 1;
    if (Math.abs(a.differenceMinutes - b.differenceMinutes) > 0.1) {
      return a.differenceMinutes - b.differenceMinutes;
    }
    return (a.sourcePriority || 99) - (b.sourcePriority || 99);
  });
};

/**
 * Check if arrival time is ambiguous (could match multiple shifts)
 */
const isAmbiguousArrival = (inTime, candidateShifts, ambiguityThresholdMinutes = 30) => {
  if (candidateShifts.length <= 1) return false;
  if (candidateShifts[0].isPreferred) return false;

  const topDistance = candidateShifts[0].differenceMinutes;
  const secondDistance = candidateShifts[1].differenceMinutes;

  if (Math.abs(secondDistance - topDistance) < ambiguityThresholdMinutes) {
    if (candidateShifts[0].isStartBeforeLog && !candidateShifts[1].isStartBeforeLog) {
      return false;
    }
    return true;
  }

  if (candidateShifts.length >= 2) {
    if (candidateShifts[0].isPreferred) return false;

    const shift1Start = timeToMinutes(candidateShifts[0].startTime);
    const shift2Start = timeToMinutes(candidateShifts[1].startTime);
    const istInTime = new Date(inTime.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const inMinutes = istInTime.getHours() * 60 + istInTime.getMinutes();

    const minStart = Math.min(shift1Start, shift2Start);
    const maxStart = Math.max(shift1Start, shift2Start);

    if (maxStart - minStart > 12 * 60) {
      if ((inMinutes >= minStart && inMinutes <= 23 * 60) || (inMinutes >= 0 && inMinutes <= maxStart)) {
        const distToMin = Math.min(Math.abs(inMinutes - minStart), 24 * 60 - Math.abs(inMinutes - minStart));
        const distToMax = Math.min(Math.abs(inMinutes - maxStart), 24 * 60 - Math.abs(inMinutes - maxStart));
        if (Math.abs(distToMin - distToMax) < ambiguityThresholdMinutes) {
          if (candidateShifts[0].isStartBeforeLog && !candidateShifts[1].isStartBeforeLog) return false;
          return true;
        }
      }
    } else {
      if (inMinutes > minStart && inMinutes < maxStart) {
        const distToMin = inMinutes - minStart;
        const distToMax = maxStart - inMinutes;
        if (Math.abs(distToMin - distToMax) < ambiguityThresholdMinutes) {
          if (candidateShifts[0].isStartBeforeLog && !candidateShifts[1].isStartBeforeLog) return false;
          return true;
        }
      }
    }
  }
  return false;
};

/**
 * Use out-time to disambiguate between candidate shifts
 */
const disambiguateWithOutTime = (inTime, outTime, candidateShifts, date, toleranceMinutes = 60) => {
  if (!outTime || candidateShifts.length === 0) return null;
  if (candidateShifts.length === 1) return candidateShifts[0];

  const scoredCandidates = candidateShifts.map(candidate => {
    const inTimeScore = candidate.differenceMinutes;
    // Use createDateWithOffset to correctly compare out-time against Shift End
    const shiftEndDate = createDateWithOffset(date, candidate.endTime);

    // Check overnight
    const shiftStartMinutes = timeToMinutes(candidate.startTime);
    const shiftEndMinutes = timeToMinutes(candidate.endTime);
    if (shiftEndMinutes < shiftStartMinutes) {
      shiftEndDate.setDate(shiftEndDate.getDate() + 1);
    }

    const outTimeDiffMs = Math.abs(outTime.getTime() - shiftEndDate.getTime());
    const outTimeScore = outTimeDiffMs / (1000 * 60);

    // PRIORITY BOOST: If this is a rostered shift (Priority 1), reduce its score significantly.
    // This acts as a strong tie-breaker.
    const priorityMultiplier = (candidate.sourcePriority === 1) ? 0.3 : 1.0;

    const rawCombinedScore = (inTimeScore * 0.6) + (outTimeScore * 0.4);
    const combinedScore = rawCombinedScore * priorityMultiplier;

    return { ...candidate, outTimeScore, combinedScore };
  });

  scoredCandidates.sort((a, b) => a.combinedScore - b.combinedScore);

  if (scoredCandidates.length >= 2) {
    const top = scoredCandidates[0];
    const second = scoredCandidates[1];

    // RULE 1: If the top match is a Rostered Shift (Priority 1) and the second is not,
    // we take the roster match unless the second one is a "perfect" out-time match while the roster is way off.
    if (top.sourcePriority === 1 && second.sourcePriority !== 1) {
      // Only stay confused if the second one is much closer to out-time (by 60+ mins)
      if (second.outTimeScore < top.outTimeScore - 60) return null;
      return top;
    }

    // RULE 2: Relaxed Threshold for Organizational Shifts
    // If one match is "clear' (matches out-time closely while others don't), accept it.
    // We reduce the threshold from 30 to 15 if the top match is very close to out-time (within 30 mins).
    const dynamicThreshold = (top.outTimeScore < 30) ? 15 : toleranceMinutes * 0.5;
    if (second.combinedScore - top.combinedScore > dynamicThreshold) return top;

    return null;
  }
  return scoredCandidates[0];
};

/**
 * Find matching shifts based on in-time proximity (DEPRECATED - use findCandidateShifts instead)
 */
const findMatchingShifts = (inTime, shifts) => {
  const matches = [];
  const istInTime = new Date(inTime.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

  // Reuse broken logic for deprecated (actually we can just proxy or fix)
  // Let's fix it slightly to use isWithinShiftWindow which we updated
  for (const shift of shifts) {
    const gracePeriod = shift.gracePeriod || 15;
    if (isWithinShiftWindow(inTime, shift.startTime, gracePeriod)) {
      matches.push({
        shiftId: shift._id,
        shiftName: shift.name,
        startTime: shift.startTime,
        endTime: shift.endTime,
        gracePeriod: gracePeriod,
        matchReason: `In-time matches shift ${shift.name} (${shift.startTime})`,
      });
    }
  }
  return matches;
};

/**
 * Find matching shifts based on out-time (for secondary matching)
 */
const findMatchingShiftsByOutTime = (outTime, shifts, toleranceMinutes = 30) => {
  if (!outTime) return [];

  const matches = [];
  const istOutTime = new Date(outTime.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const outMinutes = istOutTime.getHours() * 60 + istOutTime.getMinutes();

  for (const shift of shifts) {
    const shiftEndMinutes = timeToMinutes(shift.endTime);
    let difference = Math.abs(outMinutes - shiftEndMinutes);

    if (difference > 12 * 60) {
      difference = 24 * 60 - difference;
    }

    if (difference <= toleranceMinutes) {
      matches.push({
        shiftId: shift._id,
        shiftName: shift.name,
        startTime: shift.startTime,
        endTime: shift.endTime,
        differenceMinutes: difference,
        matchReason: `Out-time matches shift ${shift.name} end time (${shift.endTime})`,
      });
    }
  }
  return matches.sort((a, b) => a.differenceMinutes - b.differenceMinutes);
};


/**
 * Calculate late-in minutes (handles overnight shifts correctly)
 * @param {Date} inTime - Actual in-time
 * @param {String} shiftStartTime - Shift start time (HH:mm)
 * @param {Number} shiftGracePeriod - Grace period from shift definition
 * @param {String} date - Date string (YYYY-MM-DD) - the attendance date (shift start date)
 * @param {Number} globalGracePeriod - Global grace period from settings
 * @returns {Number} - Minutes late (0 if on time or within grace period)
 */
const calculateLateIn = (inTime, shiftStartTime, shiftGracePeriod = 15, date = null, globalGracePeriod = null) => {
  if (!inTime) return 0;

  // Priority: Global Settings (dynamic) > Shift Setting > Default 15
  const effectiveGrace = globalGracePeriod !== null ? globalGracePeriod : (shiftGracePeriod || 15);

  const inTimeDate = new Date(inTime);
  const [shiftStartHour, shiftStartMin] = shiftStartTime.split(':').map(Number);

  // Create shift start date based on the attendance date
  // If date is not provided, we extract it from inTime (converting to IST string)
  let dateStr = date;
  if (!dateStr) {
    // Convert inTime to IST YYYY-MM-DD
    const istDate = new Date(inTimeDate.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    dateStr = `${istDate.getFullYear()}-${String(istDate.getMonth() + 1).padStart(2, '0')}-${String(istDate.getDate()).padStart(2, '0')}`;
  }

  let shiftStartDate = createDateWithOffset(dateStr, shiftStartTime);

  // Check if this is an overnight shift (starts at 20:00 or later)
  const isOvernightShift = shiftStartHour >= 20;

  // Calculate difference
  let diffMs = inTimeDate.getTime() - shiftStartDate.getTime();
  let diffMinutes = diffMs / (1000 * 60);

  // Handle overnight shifts - in-time might be on next day or previous day match
  if (isOvernightShift) {
    // Check previous day shift start
    const prevDate = new Date(dateStr);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().split('T')[0];
    const prevShiftStart = createDateWithOffset(prevDateStr, shiftStartTime);

    const prevDiffMs = inTimeDate.getTime() - prevShiftStart.getTime();
    const prevDiffMinutes = prevDiffMs / (1000 * 60);

    // If previous day match is positive and reasonable (< 16 hours), use it
    if (prevDiffMinutes >= 0 && prevDiffMinutes < 16 * 60) {
      diffMinutes = prevDiffMinutes;
    }
    // If current day match is negative (early), it stays 0
  }

  // Apply grace period
  if (diffMinutes <= effectiveGrace) {
    return 0; // On time or within grace period
  }

  return Math.round((diffMinutes - effectiveGrace) * 100) / 100; // Round to 2 decimals
};

/**
 * Calculate early-out minutes (handles overnight shifts correctly)
 * @param {Date} outTime - Actual out-time
 * @param {String} shiftEndTime - Shift end time (HH:mm)
 * @param {String} shiftStartTime - Shift start time (HH:mm) - needed to detect overnight
 * @param {String} date - Date string (YYYY-MM-DD) - the attendance date (shift start date)
 * @param {Number} globalGracePeriod - Global grace period from settings
 * @returns {Number} - Minutes early (0 if on time or late), null if outTime not provided
 */
const calculateEarlyOut = (outTime, shiftEndTime, shiftStartTime = null, date = null, globalGracePeriod = 15) => {
  if (!outTime) return null;

  const effectiveGrace = globalGracePeriod !== null ? globalGracePeriod : 15;
  const outTimeDate = new Date(outTime);
  const [shiftEndHour, shiftEndMin] = shiftEndTime.split(':').map(Number);
  const shiftStartHour = shiftStartTime ? parseInt(shiftStartTime.split(':')[0]) : null;

  // Check if this is an overnight shift (end time < start time OR explicit night hours)
  // Simple check: if End < Start, it's overnight.
  const isOvernight = shiftStartHour !== null && shiftEndHour < shiftStartHour;

  // Create shift end date
  let dateStr = date;
  if (!dateStr) {
    const istDate = new Date(outTimeDate.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    dateStr = `${istDate.getFullYear()}-${String(istDate.getMonth() + 1).padStart(2, '0')}-${String(istDate.getDate()).padStart(2, '0')}`;
  }

  let shiftEndDate = createDateWithOffset(dateStr, shiftEndTime);

  if (isOvernight) {
    // For overnight shifts, end time is typically on the next day relative to shift start
    // We need to add 1 day to the shift end date
    shiftEndDate = new Date(shiftEndDate.getTime() + 24 * 60 * 60 * 1000);

    // Edge case: if outTime is actually late night (current day) vs early morning (next day)
    // Check if outTime is closer to "Same Day End" (unlikely for strict overnight but possible)
    // Actually standardizing on "Next Day" is safer for Shift End of overnight shift.
  }

  // Calculate difference: ShiftEnd - OutTime
  const diffMs = shiftEndDate.getTime() - outTimeDate.getTime();
  const diffMinutes = diffMs / (1000 * 60);

  // Apply grace period
  if (diffMinutes <= effectiveGrace) {
    return 0; // On time or within grace
  }

  return Math.round((diffMinutes - effectiveGrace) * 100) / 100;
};

/**
 * Check for out-time on next day for night shifts
 * @param {String} employeeNumber - Employee number
 * @param {String} date - Current date (YYYY-MM-DD)
 * @param {Object} shift - Shift object
 * @returns {Date|null} - Out-time if found on next day
 */
const checkNextDayOutTime = async (employeeNumber, date, shift) => {
  try {
    // Check if shift is overnight (starts at night, ends next morning)
    const [shiftStartHour] = shift.startTime.split(':').map(Number);
    const [shiftEndHour] = shift.endTime.split(':').map(Number);
    const isOvernight = shiftStartHour >= 20 || (shiftStartHour >= 0 && shiftEndHour < shiftStartHour);

    if (!isOvernight) {
      return null; // Not an overnight shift
    }

    // Calculate next day
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);
    const nextDateStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;

    // Check next day's attendance record for early out-time
    const AttendanceDaily = require('../../attendance/model/AttendanceDaily');
    const nextDayRecord = await AttendanceDaily.findOne({
      employeeNumber: employeeNumber.toUpperCase(),
      date: nextDateStr,
    });

    if (nextDayRecord && nextDayRecord.outTime) {
      const outTime = new Date(nextDayRecord.outTime);
      const outTimeHour = outTime.getHours();

      // If out-time is early morning (before 12 PM), it likely belongs to the night shift
      if (outTimeHour < 12) {
        // Check if this out-time hasn't been assigned to a shift yet or belongs to this night shift
        // We'll return it so it can be used for the night shift calculation
        return outTime;
      }
    }

    return null;
  } catch (error) {
    console.error('Error checking next day out-time:', error);
    return null;
  }
};

/**
 * Detect and assign shift to attendance record
 * NEW LOGIC: Always match to closest shift unless ambiguous
 * ConfusedShift only when: same start time with no out-time, or ambiguous arrival
 * @param {String} employeeNumber - Employee number
 * @param {Date} inTime - In-time
 * @param {Date} outTime - Out-time (optional)
 * @param {Object} globalConfig - Global settings (optional)
 * @returns {Object} - Detection result
 */
const detectAndAssignShift = async (employeeNumber, date, inTime, outTime = null, globalConfig = {}) => {
  const globalLateInGrace = globalConfig.late_in_grace_time ?? null;
  const globalEarlyOutGrace = globalConfig.early_out_grace_time ?? null;
  const processingMode = globalConfig.processingMode || {};
  const shiftOptions = { rosterStrictWhenPresent: processingMode.rosterStrictWhenPresent === true };
  try {
    if (!inTime) {
      return {
        success: false,
        message: 'In-time is required for shift detection',
      };
    }

    // Get shifts for employee (with roster strict when configured)
    const { shifts, source, rosteredShiftId, rosterRecordId } = await getShiftsForEmployee(employeeNumber, date, shiftOptions);

    // If no out-time provided, check for overnight shift and look for out-time on next day
    if (!outTime && shifts.length > 0) {
      // Check if any shift is a night shift and look for out-time on next day
      for (const shift of shifts) {
        const [shiftStartHour] = shift.startTime.split(':').map(Number);
        if (shiftStartHour >= 20) {
          // This is likely a night shift, check next day for out-time
          const nextDayOutTime = await checkNextDayOutTime(employeeNumber, date, shift);
          if (nextDayOutTime) {
            outTime = nextDayOutTime;
            break; // Use the first found out-time
          }
        }
      }
    }

    if (shifts.length === 0) {
      return {
        success: false,
        message: 'No shifts found for employee',
        assignedShift: null,
      };
    }

    // Helper to update roster record with discipline tracking
    const updateRosterTracking = async (detectedShiftId) => {
      if (rosterRecordId) {
        const PreScheduledShift = require('../model/PreScheduledShift');
        const isDeviation = rosteredShiftId && rosteredShiftId.toString() !== detectedShiftId.toString();
        await PreScheduledShift.findByIdAndUpdate(rosterRecordId, {
          actualShiftId: detectedShiftId,
          isDeviation: !!isDeviation,
          // Note: attendanceDailyId will be updated by the caller after saving the record
        });
      }
    };

    // Step 1: Find candidate shifts by proximity (within 3 hours tolerance)
    const candidateShifts = findCandidateShifts(inTime, shifts, date, 3);

    // Step 2: If no candidates found, still try to match to nearest shift (fallback)
    if (candidateShifts.length === 0) {
      // Find nearest shift regardless of tolerance
      let nearestShift = null;
      let minDifference = Infinity;

      for (const shift of shifts) {
        const difference = calculateTimeDifference(inTime, shift.startTime, date);
        if (difference < minDifference) {
          minDifference = difference;
          nearestShift = shift;
        }
      }

      if (nearestShift) {
        // If no out-time and this is a night shift, check next day
        let actualOutTime = outTime;
        if (!actualOutTime) {
          const [shiftStartHour] = nearestShift.startTime.split(':').map(Number);
          if (shiftStartHour >= 20) {
            const nextDayOutTime = await checkNextDayOutTime(employeeNumber, date, nearestShift);
            if (nextDayOutTime) {
              actualOutTime = nextDayOutTime;
            }
          }
        }

        const lateInMinutes = calculateLateIn(inTime, nearestShift.startTime, nearestShift.gracePeriod || 15, date, globalLateInGrace);
        const earlyOutMinutes = actualOutTime ? calculateEarlyOut(actualOutTime, nearestShift.endTime, nearestShift.startTime, date, globalEarlyOutGrace) : null;

        await updateRosterTracking(nearestShift._id);

        return {
          success: true,
          assignedShift: nearestShift._id,
          shiftName: nearestShift.name,
          shiftStartTime: nearestShift.startTime,
          shiftEndTime: nearestShift.endTime,
          source: `${source}_nearest_fallback`,
          lateInMinutes: lateInMinutes > 0 ? lateInMinutes : null,
          earlyOutMinutes: earlyOutMinutes && earlyOutMinutes > 0 ? earlyOutMinutes : null,
          isLateIn: lateInMinutes > 0,
          isEarlyOut: earlyOutMinutes && earlyOutMinutes > 0,
          expectedHours: nearestShift.duration,
          matchMethod: 'nearest_fallback',
          rosterRecordId: rosterRecordId,
        };
      }
    }

    // Step 3: Single candidate - always match it
    if (candidateShifts.length === 1) {
      const candidate = candidateShifts[0];
      const shift = shifts.find(s => s._id.toString() === candidate.shiftId.toString());

      if (!shift) {
        return {
          success: false,
          message: 'Shift not found',
        };
      }

      // If no out-time and this is a night shift, check next day again
      if (!outTime) {
        const [shiftStartHour] = shift.startTime.split(':').map(Number);
        if (shiftStartHour >= 20) {
          const nextDayOutTime = await checkNextDayOutTime(employeeNumber, date, shift);
          if (nextDayOutTime) {
            outTime = nextDayOutTime;
          }
        }
      }

      const lateInMinutes = calculateLateIn(inTime, shift.startTime, shift.gracePeriod || 15, date, globalLateInGrace);
      const earlyOutMinutes = outTime ? calculateEarlyOut(outTime, shift.endTime, shift.startTime, date, globalEarlyOutGrace) : null;

      await updateRosterTracking(shift._id);

      return {
        success: true,
        assignedShift: shift._id,
        shiftName: shift.name,
        shiftStartTime: shift.startTime,
        shiftEndTime: shift.endTime,
        source: source,
        lateInMinutes: lateInMinutes > 0 ? lateInMinutes : null,
        earlyOutMinutes: earlyOutMinutes && earlyOutMinutes > 0 ? earlyOutMinutes : null,
        isLateIn: lateInMinutes > 0,
        isEarlyOut: earlyOutMinutes && earlyOutMinutes > 0,
        expectedHours: shift.duration,
        matchMethod: 'proximity_single',
        outTimeFoundOnNextDay: outTime && outTime !== inTime, // Flag if we found out-time on next day
        rosterRecordId: rosterRecordId,
      };
    }

    // Step 4: Multiple candidates - check for ambiguity
    if (candidateShifts.length > 1) {
      // Check if all candidates have the same start time
      const allSameStartTime = candidateShifts.every(c => c.startTime === candidateShifts[0].startTime);

      if (allSameStartTime) {
        // Multiple shifts with same start time
        if (!outTime) {
          // No out-time available - CHECK ROSTER FIRST
          const rosteredCandidate = candidateShifts.find(c => c.sourcePriority === 1);
          if (rosteredCandidate) {
            const shift = shifts.find(s => s._id.toString() === rosteredCandidate.shiftId.toString());
            if (shift) {
              const lateInMinutes = calculateLateIn(inTime, shift.startTime, shift.gracePeriod || 15, date, globalLateInGrace);
              await updateRosterTracking(shift._id);
              return {
                success: true,
                assignedShift: shift._id,
                shiftName: shift.name,
                shiftStartTime: shift.startTime,
                shiftEndTime: shift.endTime,
                source: `${source}_roster_blind`, // Blind match because no out-time
                lateInMinutes: lateInMinutes > 0 ? lateInMinutes : null,
                earlyOutMinutes: null,
                isLateIn: lateInMinutes > 0,
                isEarlyOut: false,
                expectedHours: shift.duration,
                matchMethod: 'roster_blind',
                rosterRecordId: rosterRecordId,
              };
            }
          }

          // No out-time available - create ConfusedShift
          const confusedShiftData = {
            employeeNumber: employeeNumber.toUpperCase(),
            date: date,
            inTime: inTime,
            outTime: outTime,
            possibleShifts: candidateShifts.map(c => ({
              shiftId: c.shiftId,
              shiftName: c.shiftName,
              startTime: c.startTime,
              endTime: c.endTime,
              matchReason: c.matchReason,
            })),
            status: 'pending',
            requiresManualSelection: true,
          };

          await ConfusedShift.findOneAndUpdate(
            { employeeNumber: employeeNumber.toUpperCase(), date: date },
            confusedShiftData,
            { upsert: true, new: true }
          );

          return {
            success: false,
            confused: true,
            message: 'Multiple shifts with same start time - out-time needed to distinguish',
            possibleShifts: candidateShifts,
            requiresManualSelection: true,
          };
        } else {
          // Out-time available - try to disambiguate

          // PRE-STEP: If exactly one candidate is Rostered (Priority 1), check if it's "reasonable"
          // If the rostered shift out-time match is within tolerance, prioritize it over stay confused.
          const rosteredCandidate = candidateShifts.find(c => c.sourcePriority === 1);
          if (rosteredCandidate) {
            const shiftEndDate = createDateWithOffset(date, rosteredCandidate.endTime);
            const shiftStartMinutes = timeToMinutes(rosteredCandidate.startTime);
            const shiftEndMinutes = timeToMinutes(rosteredCandidate.endTime);
            if (shiftEndMinutes < shiftStartMinutes) shiftEndDate.setDate(shiftEndDate.getDate() + 1);

            const outTimeDiffMins = Math.abs(outTime.getTime() - shiftEndDate.getTime()) / (1000 * 60);

            // If rostered shift out-time is within 90 mins, we can trust it as a "clear intention"
            // especially since we have no other better information.
            if (outTimeDiffMins < 90) {
              const shift = shifts.find(s => s._id.toString() === rosteredCandidate.shiftId.toString());
              if (shift) {
                const lateInMinutes = calculateLateIn(inTime, shift.startTime, shift.gracePeriod || 15, date, globalLateInGrace);
                const earlyOutMinutes = calculateEarlyOut(outTime, shift.endTime, shift.startTime, date, globalEarlyOutGrace);
                await updateRosterTracking(shift._id);
                return {
                  success: true,
                  assignedShift: shift._id,
                  shiftName: shift.name,
                  shiftStartTime: shift.startTime,
                  shiftEndTime: shift.endTime,
                  source: `${source}_roster_priority`,
                  lateInMinutes: lateInMinutes > 0 ? lateInMinutes : null,
                  earlyOutMinutes: earlyOutMinutes && earlyOutMinutes > 0 ? earlyOutMinutes : null,
                  isLateIn: lateInMinutes > 0,
                  isEarlyOut: earlyOutMinutes && earlyOutMinutes > 0,
                  expectedHours: shift.duration,
                  matchMethod: 'roster_priority',
                  rosterRecordId: rosterRecordId,
                };
              }
            }
          }

          const bestMatch = disambiguateWithOutTime(inTime, outTime, candidateShifts, date);

          if (bestMatch) {
            const shift = shifts.find(s => s._id.toString() === bestMatch.shiftId.toString());
            if (shift) {
              const lateInMinutes = calculateLateIn(inTime, shift.startTime, shift.gracePeriod || 15, date, globalLateInGrace);
              const earlyOutMinutes = calculateEarlyOut(outTime, shift.endTime, shift.startTime, date, globalEarlyOutGrace);

              await updateRosterTracking(shift._id);

              return {
                success: true,
                assignedShift: shift._id,
                shiftName: shift.name,
                shiftStartTime: shift.startTime,
                shiftEndTime: shift.endTime,
                source: `${source}_outtime_disambiguated`,
                lateInMinutes: lateInMinutes > 0 ? lateInMinutes : null,
                earlyOutMinutes: earlyOutMinutes && earlyOutMinutes > 0 ? earlyOutMinutes : null,
                isLateIn: lateInMinutes > 0,
                isEarlyOut: earlyOutMinutes && earlyOutMinutes > 0,
                expectedHours: shift.duration,
                matchMethod: 'outtime_disambiguated',
                rosterRecordId: rosterRecordId,
              };
            }
          }

          // Still ambiguous even with out-time - create ConfusedShift
          const confusedShiftData = {
            employeeNumber: employeeNumber.toUpperCase(),
            date: date,
            inTime: inTime,
            outTime: outTime,
            possibleShifts: candidateShifts.map(c => ({
              shiftId: c.shiftId,
              shiftName: c.shiftName,
              startTime: c.startTime,
              endTime: c.endTime,
              matchReason: c.matchReason,
            })),
            status: 'pending',
            requiresManualSelection: true,
          };

          await ConfusedShift.findOneAndUpdate(
            { employeeNumber: employeeNumber.toUpperCase(), date: date },
            confusedShiftData,
            { upsert: true, new: true }
          );

          return {
            success: false,
            confused: true,
            message: 'Multiple shifts with same start time - out-time did not help distinguish',
            possibleShifts: candidateShifts,
            requiresManualSelection: true,
          };
        }
      } else {
        // Different start times - check if arrival is ambiguous
        const isAmbiguous = isAmbiguousArrival(inTime, candidateShifts);

        if (isAmbiguous) {
          // Ambiguous arrival - try to use out-time to disambiguate
          if (outTime) {
            const bestMatch = disambiguateWithOutTime(inTime, outTime, candidateShifts, date);

            if (bestMatch) {
              const shift = shifts.find(s => s._id.toString() === bestMatch.shiftId.toString());
              if (shift) {
                const lateInMinutes = calculateLateIn(inTime, shift.startTime, shift.gracePeriod || 15, date, globalLateInGrace);
                const earlyOutMinutes = calculateEarlyOut(outTime, shift.endTime, shift.startTime, date, globalEarlyOutGrace);

                await updateRosterTracking(shift._id);

                return {
                  success: true,
                  assignedShift: shift._id,
                  shiftName: shift.name,
                  shiftStartTime: shift.startTime,
                  shiftEndTime: shift.endTime,
                  source: `${source}_outtime_disambiguated`,
                  lateInMinutes: lateInMinutes > 0 ? lateInMinutes : null,
                  earlyOutMinutes: earlyOutMinutes && earlyOutMinutes > 0 ? earlyOutMinutes : null,
                  isLateIn: lateInMinutes > 0,
                  isEarlyOut: earlyOutMinutes && earlyOutMinutes > 0,
                  expectedHours: shift.duration,
                  matchMethod: 'outtime_disambiguated_ambiguous',
                  rosterRecordId: rosterRecordId,
                };
              }
            }
          }

          // Still ambiguous - create ConfusedShift
          const confusedShiftData = {
            employeeNumber: employeeNumber.toUpperCase(),
            date: date,
            inTime: inTime,
            outTime: outTime,
            possibleShifts: candidateShifts.map(c => ({
              shiftId: c.shiftId,
              shiftName: c.shiftName,
              startTime: c.startTime,
              endTime: c.endTime,
              matchReason: c.matchReason,
            })),
            status: 'pending',
            requiresManualSelection: true,
          };

          await ConfusedShift.findOneAndUpdate(
            { employeeNumber: employeeNumber.toUpperCase(), date: date },
            confusedShiftData,
            { upsert: true, new: true }
          );

          return {
            success: false,
            confused: true,
            message: outTime
              ? 'Ambiguous arrival time - out-time did not help distinguish'
              : 'Ambiguous arrival time - out-time needed to distinguish',
            possibleShifts: candidateShifts,
            requiresManualSelection: true,
          };
        } else {
          // Not ambiguous - match to closest shift
          const bestMatch = candidateShifts[0];
          const shift = shifts.find(s => s._id.toString() === bestMatch.shiftId.toString());

          if (shift) {
            const lateInMinutes = calculateLateIn(inTime, shift.startTime, shift.gracePeriod || 15, date, globalLateInGrace);
            const earlyOutMinutes = outTime ? calculateEarlyOut(outTime, shift.endTime, shift.startTime, date, globalEarlyOutGrace) : null;

            await updateRosterTracking(shift._id);

            return {
              success: true,
              assignedShift: shift._id,
              shiftName: shift.name,
              shiftStartTime: shift.startTime,
              shiftEndTime: shift.endTime,
              source: source,
              lateInMinutes: lateInMinutes > 0 ? lateInMinutes : null,
              earlyOutMinutes: earlyOutMinutes && earlyOutMinutes > 0 ? earlyOutMinutes : null,
              isLateIn: lateInMinutes > 0,
              isEarlyOut: earlyOutMinutes && earlyOutMinutes > 0,
              expectedHours: shift.duration,
              matchMethod: 'proximity_closest',
              rosterRecordId: rosterRecordId,
            };
          }
        }
      }
    }

    // Fallback: Should not reach here, but if we do, return error
    return {
      success: false,
      message: 'Unexpected error in shift detection',
    };

  } catch (error) {
    console.error('Error in shift detection:', error);
    return {
      success: false,
      message: error.message || 'Error detecting shift',
    };
  }
};

/**
 * Manually assign shift to confused record
 * @param {String} confusedShiftId - Confused shift record ID
 * @param {String} shiftId - Shift ID to assign
 * @param {String} userId - User ID who is assigning
 * @param {String} comments - Optional comments
 * @returns {Object} - Result
 */
const resolveConfusedShift = async (confusedShiftId, shiftId, userId, comments = null) => {
  try {
    const confusedShift = await ConfusedShift.findById(confusedShiftId);
    if (!confusedShift) {
      return {
        success: false,
        message: 'Confused shift record not found',
      };
    }

    if (confusedShift.status !== 'pending') {
      return {
        success: false,
        message: 'This record has already been resolved',
      };
    }

    const shift = await Shift.findById(shiftId);
    if (!shift) {
      return {
        success: false,
        message: 'Shift not found',
      };
    }

    // Update confused shift
    confusedShift.assignedShiftId = shiftId;
    confusedShift.status = 'resolved';
    confusedShift.reviewedBy = userId;
    confusedShift.reviewedAt = new Date();
    confusedShift.reviewComments = comments;

    await confusedShift.save();

    // Update attendance record
    const attendanceRecord = await AttendanceDaily.findOne({
      employeeNumber: confusedShift.employeeNumber,
      date: confusedShift.date,
    });

    if (attendanceRecord) {
      // Fetch global general settings
      const generalConfig = await Settings.getSettingsByCategory('general');
      const globalLateInGrace = generalConfig.late_in_grace_time ?? null;
      const globalEarlyOutGrace = generalConfig.early_out_grace_time ?? null;

      const lateInMinutes = calculateLateIn(confusedShift.inTime, shift.startTime, shift.gracePeriod || 15, confusedShift.date, globalLateInGrace);
      const earlyOutMinutes = confusedShift.outTime
        ? calculateEarlyOut(confusedShift.outTime, shift.endTime, shift.startTime, confusedShift.date, globalEarlyOutGrace)
        : null;

      // Update attendance record - USE SHIFTS ARRAY
      if (!attendanceRecord.shifts) attendanceRecord.shifts = [];

      let targetShift = null;
      if (attendanceRecord.shifts.length > 0) {
        // Find the shift that matches the confused shift's in-time
        // We use a small tolerance or exact match since it comes from the same source
        targetShift = attendanceRecord.shifts.find(s => {
          const sTime = new Date(s.inTime).getTime();
          const cTime = new Date(confusedShift.inTime).getTime();
          return Math.abs(sTime - cTime) < 1000 * 60; // 1 minute tolerance
        });

        // If not found by time, and only 1 shift exists, maybe safe to assume it's that one? 
        // But strict matching is safer for multi-shift. 
        // If not found, we might need to add it?
        if (!targetShift && attendanceRecord.shifts.length === 0) {
          // Fallback logic below will handle push
        }
      }

      if (!targetShift) {
        targetShift = {
          shiftNumber: attendanceRecord.shifts.length + 1,
          inTime: confusedShift.inTime, // Use confused shift time
          outTime: confusedShift.outTime // Use confused shift time
        };
        attendanceRecord.shifts.push(targetShift);
      }

      targetShift.shiftId = shiftId;
      targetShift.shiftName = shift.name;
      targetShift.shiftStartTime = shift.startTime;
      targetShift.shiftEndTime = shift.endTime;
      targetShift.lateInMinutes = lateInMinutes > 0 ? lateInMinutes : 0;
      targetShift.earlyOutMinutes = earlyOutMinutes && earlyOutMinutes > 0 ? earlyOutMinutes : 0;
      targetShift.isLateIn = lateInMinutes > 0;
      targetShift.isEarlyOut = earlyOutMinutes && earlyOutMinutes > 0;
      targetShift.expectedHours = shift.duration;
      targetShift.status = 'complete'; // Assumed since resolved

      // Update root status if needed
      if (attendanceRecord.status === 'ABSENT' || !attendanceRecord.status) {
        attendanceRecord.status = 'PRESENT';
      }

      await attendanceRecord.save();
    }

    return {
      success: true,
      message: 'Shift assigned successfully',
      data: confusedShift,
    };

  } catch (error) {
    console.error('Error resolving confused shift:', error);
    return {
      success: false,
      message: error.message || 'Error resolving confused shift',
    };
  }
};

/**
 * Sync shifts for existing attendance records that don't have shifts assigned
 * @param {String} startDate - Start date (optional)
 * @param {String} endDate - End date (optional)
 * @returns {Object} - Sync statistics
 */
const syncShiftsForExistingRecords = async (startDate = null, endDate = null) => {
  const stats = {
    success: false,
    processed: 0,
    assigned: 0,
    confused: 0,
    errors: [],
    message: '',
  };

  try {
    // Build query for records without shiftId
    const query = { shiftId: { $exists: false } };

    if (startDate && endDate) {
      query.date = { $gte: startDate, $lte: endDate };
    }

    // Get all attendance records without shifts
    const records = await AttendanceDaily.find(query).sort({ date: -1 });

    // Fetch global general settings
    const generalConfig = await Settings.getSettingsByCategory('general');

    stats.processed = records.length;

    for (const record of records) {
      try {
        if (!record.inTime) {
          // No in-time, skip
          continue;
        }

        // Detect and assign shift
        const result = await detectAndAssignShift(
          record.employeeNumber,
          record.date,
          record.inTime,
          record.outTime || null,
          generalConfig
        );

        if (result.success && result.assignedShift) {
          // Update record with shift assignment
          // Update record with shift assignment - USE SHIFTS ARRAY
          if (!record.shifts) record.shifts = [];

          let targetShift;
          if (record.shifts.length > 0) {
            targetShift = record.shifts[0];
          } else {
            targetShift = {
              shiftNumber: 1,
              inTime: record.inTime, // Legacy root inTime
              outTime: record.outTime, // Legacy root outTime
              // We should ideally ensure inTime/outTime are set on shift
            };
            record.shifts.push(targetShift);
          }

          targetShift.shiftId = result.assignedShift;
          targetShift.shiftName = result.shiftName;
          targetShift.shiftStartTime = result.shiftStartTime;
          targetShift.shiftEndTime = result.shiftEndTime;
          targetShift.lateInMinutes = result.lateInMinutes || 0;
          targetShift.earlyOutMinutes = result.earlyOutMinutes || 0;
          targetShift.isLateIn = result.isLateIn || false;
          targetShift.isEarlyOut = result.isEarlyOut || false;
          targetShift.expectedHours = result.expectedHours;
          targetShift.status = record.outTime ? 'complete' : 'incomplete';

          // Clean up root fields if migration didn't catch them?
          // Maybe unsafe to unset here without explicit migration logic, but we are "syncing shifts".
          // Let's just save.

          await record.save();
          stats.assigned++;
        } else if (result.confused) {
          // Confused shift record already created by detectAndAssignShift
          stats.confused++;
        }

      } catch (error) {
        stats.errors.push(`Error processing ${record.employeeNumber} on ${record.date}: ${error.message}`);
        console.error(`Error processing record ${record._id}:`, error);
      }
    }

    stats.success = true;
    stats.message = `Processed ${stats.processed} records: ${stats.assigned} assigned, ${stats.confused} flagged for review`;

  } catch (error) {
    console.error('Error in syncShiftsForExistingRecords:', error);
    stats.errors.push(error.message);
    stats.message = 'Error syncing shifts';
  }

  return stats;
};

/**
 * Auto-assign nearest shift based on in-time
 * This is a separate function that finds the shift with start time closest to the in-time
 * Used for confused shifts auto-assignment
 * @param {String} employeeNumber - Employee number
 * @param {String} date - Date (YYYY-MM-DD)
 * @param {Date} inTime - In-time
 * @param {Date} outTime - Out-time (optional)
 * @returns {Object} - Assignment result
 */
const autoAssignNearestShift = async (employeeNumber, date, inTime, outTime = null) => {
  try {
    if (!inTime) {
      return {
        success: false,
        message: 'In-time is required for auto-assignment',
      };
    }

    // Get all available shifts (not just possible ones)
    const { shifts } = await getShiftsForEmployee(employeeNumber, date);

    if (shifts.length === 0) {
      return {
        success: false,
        message: 'No shifts available for auto-assignment',
      };
    }

    // Use the existing findCandidateShifts logic which handles:
    // 1. Proximity matching (preferred shifts within 35 min)
    // 2. Start-before-log preference
    // 3. Source priority tie-breaking (Designation > Department > Division > Global)
    const candidates = findCandidateShifts(inTime, shifts, date);

    if (candidates.length === 0) {
      return {
        success: false,
        message: 'No matching shifts found within tolerance',
      };
    }

    // Get the best candidate (already sorted by preference + priority)
    const bestCandidate = candidates[0];
    const nearestShift = shifts.find(s => s._id.toString() === bestCandidate.shiftId.toString());

    if (!nearestShift) {
      return {
        success: false,
        message: 'Could not find nearest shift',
      };
    }

    // Fetch global general settings
    const generalConfig = await Settings.getSettingsByCategory('general');
    const globalLateInGrace = generalConfig.late_in_grace_time ?? null;
    const globalEarlyOutGrace = generalConfig.early_out_grace_time ?? null;

    // Calculate late-in and early-out
    const lateInMinutes = calculateLateIn(inTime, nearestShift.startTime, nearestShift.gracePeriod || 15, date, globalLateInGrace);
    const earlyOutMinutes = outTime ? calculateEarlyOut(outTime, nearestShift.endTime, nearestShift.startTime, date, globalEarlyOutGrace) : null;

    return {
      success: true,
      assignedShift: nearestShift._id,
      shiftName: nearestShift.name,
      shiftStartTime: nearestShift.startTime,
      shiftEndTime: nearestShift.endTime,
      source: 'auto_assign_nearest',
      sourcePriority: nearestShift.sourcePriority || 99,
      lateInMinutes: lateInMinutes > 0 ? lateInMinutes : null,
      earlyOutMinutes: earlyOutMinutes && earlyOutMinutes > 0 ? earlyOutMinutes : null,
      isLateIn: lateInMinutes > 0,
      isEarlyOut: earlyOutMinutes && earlyOutMinutes > 0,
      expectedHours: nearestShift.duration,
      differenceMinutes: bestCandidate.differenceMinutes,
      isPreferred: bestCandidate.isPreferred,
    };

  } catch (error) {
    console.error('Error in auto-assign nearest shift:', error);
    return {
      success: false,
      message: error.message || 'Error auto-assigning nearest shift',
    };
  }
};

module.exports = {
  detectAndAssignShift,
  resolveConfusedShift,
  getShiftsForEmployee,
  findMatchingShifts,
  findMatchingShiftsByOutTime,
  findCandidateShifts,
  isAmbiguousArrival,
  disambiguateWithOutTime,
  calculateTimeDifference,
  calculateLateIn,
  calculateEarlyOut,
  isWithinShiftWindow,
  createDateWithOffset,
  syncShiftsForExistingRecords,
  autoAssignNearestShift,
  timeToMinutes
};

