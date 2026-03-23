/**
 * Conflict Validation Service
 * Validates conflicts between Leave, OD, OT, and Permission requests
 */

const Leave = require('../../leaves/model/Leave');
const OD = require('../../leaves/model/OD');
const OT = require('../../overtime/model/OT');
const Permission = require('../../permissions/model/Permission');
const AttendanceDaily = require('../../attendance/model/AttendanceDaily');

/**
 * Check if a date falls within a date range
 * @param {String|Date} date - Date to check (YYYY-MM-DD or Date object)
 * @param {Date} fromDate - Start date
 * @param {Date} toDate - End date
 * @returns {Boolean}
 */
const isDateInRange = (date, fromDate, toDate) => {
  const checkDate = typeof date === 'string' ? new Date(date) : date;
  const from = new Date(fromDate);
  const to = new Date(toDate);

  // Use UTC for consistent comparison regardless of server timezone
  from.setUTCHours(0, 0, 0, 0);
  to.setUTCHours(23, 59, 59, 999);
  checkDate.setUTCHours(12, 0, 0, 0); // Set to noon for date-only comparison

  return checkDate >= from && checkDate <= to;
};

/**
 * Check if two dates are the same day (ignoring time)
 * @param {Date} date1 - First date
 * @param {Date} date2 - Second date
 * @returns {Boolean}
 */
const isSameDay = (date1, date2) => {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return d1.getUTCFullYear() === d2.getUTCFullYear() &&
    d1.getUTCMonth() === d2.getUTCMonth() &&
    d1.getUTCDate() === d2.getUTCDate();
};

/**
 * Check if two half-day requests conflict
 * @param {Boolean} isHalfDay1 - Is first request half day
 * @param {String} halfDayType1 - Half day type of first request ('first_half', 'second_half', null)
 * @param {Boolean} isHalfDay2 - Is second request half day
 * @param {String} halfDayType2 - Half day type of second request ('first_half', 'second_half', null)
 * @returns {Boolean} - true if they conflict
 */
const checkHalfDayConflict = (isHalfDay1, halfDayType1, isHalfDay2, halfDayType2) => {
  // If neither is half day, they conflict (both full day)
  if (!isHalfDay1 && !isHalfDay2) {
    return true;
  }

  // If one is full day and other is half day, they conflict
  if ((!isHalfDay1 && isHalfDay2) || (isHalfDay1 && !isHalfDay2)) {
    return true;
  }

  // Both are half day - check if same half
  if (isHalfDay1 && isHalfDay2) {
    // If same half type, they conflict
    if (halfDayType1 === halfDayType2) {
      return true;
    }
    // Different halves (first_half vs second_half) - no conflict
    return false;
  }

  return false;
};

/**
 * Check if employee has an approved or pending Leave on a date
 * @param {String} employeeId - Employee ID
 * @param {String} employeeNumber - Employee number
 * @param {String} date - Date to check (YYYY-MM-DD)
 * @param {Boolean} approvedOnly - If true, only check approved records (for creation). If false, check all (for approval)
 * @returns {Object} - { hasLeave: boolean, leave: Leave|null }
 */
const checkLeaveConflict = async (employeeId, employeeNumber, date, approvedOnly = false) => {
  try {
    const statusFilter = approvedOnly
      ? ['approved'] // Only approved for creation
      : ['pending', 'hod_approved', 'hr_approved', 'approved']; // All for approval

    const leaves = await Leave.find({
      $or: [
        { employeeId: employeeId },
        { emp_no: employeeNumber.toUpperCase() }
      ],
      status: { $in: statusFilter },
      isActive: true,
    });

    for (const leave of leaves) {
      if (isDateInRange(date, leave.fromDate, leave.toDate)) {
        return {
          hasLeave: true,
          leave: leave,
          message: `Employee has a ${leave.status} leave from ${leave.fromDate.toLocaleDateString()} to ${leave.toDate.toLocaleDateString()}`,
        };
      }
    }

    return {
      hasLeave: false,
      leave: null,
    };
  } catch (error) {
    console.error('Error checking leave conflict:', error);
    return {
      hasLeave: false,
      leave: null,
      error: error.message,
    };
  }
};

/**
 * Check if employee has an approved or pending OD on a date
 * @param {String} employeeId - Employee ID
 * @param {String} employeeNumber - Employee number
 * @param {String} date - Date to check (YYYY-MM-DD)
 * @param {Boolean} approvedOnly - If true, only check approved records (for creation). If false, check all (for approval)
 * @returns {Object} - { hasOD: boolean, od: OD|null }
 */
const checkODConflict = async (employeeId, employeeNumber, date, approvedOnly = false) => {
  try {
    const statusFilter = approvedOnly
      ? ['approved'] // Only approved for creation
      : ['pending', 'hod_approved', 'hr_approved', 'approved']; // All for approval

    const ods = await OD.find({
      $or: [
        { employeeId: employeeId },
        { emp_no: employeeNumber.toUpperCase() }
      ],
      status: { $in: statusFilter },
      isActive: true,
    });

    for (const od of ods) {
      if (isDateInRange(date, od.fromDate, od.toDate)) {
        return {
          hasOD: true,
          od: od,
          message: `Employee has a ${od.status} OD from ${od.fromDate.toLocaleDateString()} to ${od.toDate.toLocaleDateString()}`,
        };
      }
    }

    return {
      hasOD: false,
      od: null,
    };
  } catch (error) {
    console.error('Error checking OD conflict:', error);
    return {
      hasOD: false,
      od: null,
      error: error.message,
    };
  }
};

/**
 * Check if employee has attendance for a date
 * @param {String} employeeNumber - Employee number
 * @param {String} date - Date to check (YYYY-MM-DD)
 * @returns {Object} - { hasAttendance: boolean, attendance: AttendanceDaily|null }
 */
const checkAttendanceExists = async (employeeNumber, date) => {
  try {
    const attendance = await AttendanceDaily.findOne({
      employeeNumber: employeeNumber.toUpperCase(),
      date: date,
    });

    if (!attendance) {
      return {
        hasAttendance: false,
        attendance: null,
        message: 'No attendance record found for this date',
      };
    }

    // We no longer require an in-time to create a permission request, as requested by the user.
    // However, if there are shifts, we can still capture the first one's inTime for reference if we wanted to.

    // Just return success if the attendance record exists for the date
    return {
      hasAttendance: true,
      attendance: attendance,
    };
  } catch (error) {
    console.error('Error checking attendance:', error);
    return {
      hasAttendance: false,
      attendance: null,
      error: error.message,
    };
  }
};

/**
 * Validate OT request - check conflicts and attendance
 * @param {String} employeeId - Employee ID
 * @param {String} employeeNumber - Employee number
 * @param {String} date - Date (YYYY-MM-DD)
 * @returns {Object} - Validation result
 */
const validateOTRequest = async (employeeId, employeeNumber, date) => {
  const errors = [];
  const warnings = [];

  // Check attendance
  const attendanceCheck = await checkAttendanceExists(employeeNumber, date);
  if (!attendanceCheck.hasAttendance) {
    errors.push(attendanceCheck.message || 'Attendance record not found or incomplete');
  }

  // Check Leave conflict
  const leaveCheck = await checkLeaveConflict(employeeId, employeeNumber, date);
  if (leaveCheck.hasLeave) {
    errors.push(leaveCheck.message || 'Employee has a leave on this date');
  }

  // Check OD conflict
  const odCheck = await checkODConflict(employeeId, employeeNumber, date);
  if (odCheck.hasOD) {
    errors.push(odCheck.message || 'Employee has an OD on this date');
  }

  return {
    isValid: errors.length === 0,
    errors: errors,
    warnings: warnings,
    attendance: attendanceCheck.attendance,
    leave: leaveCheck.leave,
    od: odCheck.od,
  };
};

/**
 * Validate Permission request - check conflicts and attendance
 * @param {String} employeeId - Employee ID
 * @param {String} employeeNumber - Employee number
 * @param {String} date - Date (YYYY-MM-DD)
 * @returns {Object} - Validation result
 */
const validatePermissionRequest = async (employeeId, employeeNumber, date) => {
  const errors = [];
  const warnings = [];

  // Check attendance (required for permission)
  const attendanceCheck = await checkAttendanceExists(employeeNumber, date);
  if (!attendanceCheck.hasAttendance) {
    errors.push(attendanceCheck.message || 'No attendance record found or employee has no in-time for this date');
  }

  // Check Leave conflict
  const leaveCheck = await checkLeaveConflict(employeeId, employeeNumber, date);
  if (leaveCheck.hasLeave) {
    errors.push(leaveCheck.message || 'Employee has a leave on this date');
  }

  // Check OD conflict
  const odCheck = await checkODConflict(employeeId, employeeNumber, date);
  if (odCheck.hasOD) {
    errors.push(odCheck.message || 'Employee has an OD on this date');
  }

  return {
    isValid: errors.length === 0,
    errors: errors,
    warnings: warnings,
    attendance: attendanceCheck.attendance,
    leave: leaveCheck.leave,
    od: odCheck.od,
  };
};

/**
 * Validate Leave request - check OD conflict with half-day support
 * @param {String} employeeId - Employee ID
 * @param {String} employeeNumber - Employee number
 * @param {Date} fromDate - Start date
 * @param {Date} toDate - End date
 * @param {Boolean} isHalfDay - Is this a half-day leave
 * @param {String} halfDayType - Half day type ('first_half', 'second_half', null)
 * @param {Boolean} approvedOnly - If true, only check approved records (for creation). If false, check all (for approval)
 * @returns {Object} - Validation result
 */
const validateLeaveRequest = async (employeeId, employeeNumber, fromDate, toDate, isHalfDay = false, halfDayType = null, approvedOnly = true, excludeId = null) => {
  const errors = [];
  const warnings = [];

  // Normalize dates for robust comparison
  const start = new Date(fromDate);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setUTCHours(23, 59, 59, 999);

  // Resolve status list: for creation, block both pending AND approved records
  const statusFilter = ['pending', 'reporting_manager_approved', 'hod_approved', 'manager_approved', 'hr_approved', 'principal_approved', 'approved'];

  // 1. Validate against OD conflicts
  const ods = await OD.find({
    $or: [
      { employeeId: employeeId },
      { emp_no: employeeNumber.toUpperCase() }
    ],
    status: { $in: statusFilter },
    isActive: true,
    // Optimization: Only fetch potentially overlapping records
    fromDate: { $lte: end },
    toDate: { $gte: start },
  });

  const conflictingODs = [];

  // Check each OD for conflicts
  for (const od of ods) {
    const odStart = new Date(od.fromDate);
    odStart.setUTCHours(0, 0, 0, 0);
    const odEnd = new Date(od.toDate);
    odEnd.setUTCHours(23, 59, 59, 999);

    // Check if date ranges overlap (already filtered by query, but verifying with normalized times)
    if (start <= odEnd && end >= odStart) {
      // If leave is single day and half day, check day-by-day
      if (isSameDay(fromDate, toDate) && isHalfDay) {
        // Single day half-day leave - check if OD is on same day
        if (isSameDay(fromDate, od.fromDate) && isSameDay(fromDate, od.toDate)) {
          // Same day - check half-day conflict
          if (checkHalfDayConflict(isHalfDay, halfDayType, od.isHalfDay, od.halfDayType)) {
            conflictingODs.push(od);
            const statusText = od.status === 'approved' ? 'approved' : 'pending';
            errors.push(`Employee has a ${statusText} OD on ${od.fromDate.toLocaleDateString()} that conflicts with this leave (${isHalfDay ? (halfDayType === 'first_half' ? 'First Half' : 'Second Half') : 'Full Day'} vs ${od.isHalfDay ? (od.halfDayType === 'first_half' ? 'First Half' : 'Second Half') : 'Full Day'})`);
          }
          // If different halves, no conflict - continue to next OD
        } else {
          // OD spans multiple days or different day - conflict
          conflictingODs.push(od);
          const statusText = od.status === 'approved' ? 'approved' : 'pending';
          errors.push(`Employee has a ${statusText} OD from ${od.fromDate.toLocaleDateString()} to ${od.toDate.toLocaleDateString()} that conflicts with this leave period`);
        }
      } else {
        // Multi-day leave or full-day leave - check each day in overlapping range
        const startDate = fromDate > od.fromDate ? fromDate : od.fromDate;
        const endDate = toDate < od.toDate ? toDate : od.toDate;

        // If leave is single day full day, check if OD is on same day
        if (isSameDay(fromDate, toDate) && !isHalfDay) {
          // Full day leave - conflicts with any OD on same day
          if (isSameDay(fromDate, od.fromDate) && isSameDay(fromDate, od.toDate)) {
            conflictingODs.push(od);
            const statusText = od.status === 'approved' ? 'approved' : 'pending';
            errors.push(`Employee has a ${statusText} OD on ${od.fromDate.toLocaleDateString()} that conflicts with this full-day leave`);
          }
        } else {
          // Multi-day leave - conflicts with any overlapping OD
          conflictingODs.push(od);
          const statusText = od.status === 'approved' ? 'approved' : 'pending';
          errors.push(`Employee has a ${statusText} OD from ${od.fromDate.toLocaleDateString()} to ${od.toDate.toLocaleDateString()} that conflicts with this leave period`);
        }
      }
    }
  }

  // 2. Validate against OTHER LEAVE conflicts (Same type)
  const leaves = await Leave.find({
    $or: [
      { employeeId: employeeId },
      { emp_no: employeeNumber.toUpperCase() }
    ],
    status: { $in: statusFilter },
    isActive: true,
    // Optimization: Only fetch potentially overlapping records
    fromDate: { $lte: end },
    toDate: { $gte: start },
  });

  const conflictingLeaves = [];

  for (const leave of leaves) {
    // Skip if it's the current application being updated
    if (excludeId && String(leave._id) === String(excludeId)) continue;

    const leaveStart = new Date(leave.fromDate);
    leaveStart.setUTCHours(0, 0, 0, 0);
    const leaveEnd = new Date(leave.toDate);
    leaveEnd.setUTCHours(23, 59, 59, 999);

    // Check if date ranges overlap
    if (start <= leaveEnd && end >= leaveStart) {
      if (isSameDay(fromDate, toDate) && leave.isHalfDay && isHalfDay) {
        // Both are half-day on same day - check for half-day conflict
        if (checkHalfDayConflict(isHalfDay, halfDayType, leave.isHalfDay, leave.halfDayType)) {
          conflictingLeaves.push(leave);
          const statusText = leave.status === 'approved' ? 'approved' : 'pending';
          errors.push(`Employee has a ${statusText} leave on ${leave.fromDate.toLocaleDateString()} that conflicts with this request (${isHalfDay ? (halfDayType === 'first_half' ? 'First Half' : 'Second Half') : 'Full Day'} vs ${leave.isHalfDay ? (leave.halfDayType === 'first_half' ? 'First Half' : 'Second Half') : 'Full Day'})`);
        }
      } else {
        // Overlap with another leave (non-half-day or spanning multiple days)
        conflictingLeaves.push(leave);
        const statusText = leave.status === 'approved' ? 'approved' : 'pending';
        errors.push(`Employee has a ${statusText} leave from ${leave.fromDate.toLocaleDateString()} to ${leave.toDate.toLocaleDateString()} that conflicts with this request period`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors: errors,
    warnings: warnings,
    conflictingODs: conflictingODs,
    conflictingLeaves: conflictingLeaves,
  };
};

/**
 * Validate OD request - check Leave conflict with half-day support
 * @param {String} employeeId - Employee ID
 * @param {String} employeeNumber - Employee number
 * @param {Date} fromDate - Start date
 * @param {Date} toDate - End date
 * @param {Boolean} isHalfDay - Is this a half-day OD
 * @param {String} halfDayType - Half day type ('first_half', 'second_half', null)
 * @param {Boolean} approvedOnly - If true, only check approved records (for creation). If false, check all (for approval)
 * @returns {Object} - Validation result
 */
const validateODRequest = async (employeeId, employeeNumber, fromDate, toDate, isHalfDay = false, halfDayType = null, approvedOnly = true, excludeId = null) => {
  const errors = [];
  const warnings = [];

  // Normalize dates for robust comparison
  const start = new Date(fromDate);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setUTCHours(23, 59, 59, 999);

  // Resolve status list: for creation, block both pending AND approved records
  const statusFilter = ['pending', 'reporting_manager_approved', 'hod_approved', 'manager_approved', 'hr_approved', 'principal_approved', 'approved'];

  // 1. Validate against Leave conflicts
  const leaves = await Leave.find({
    $or: [
      { employeeId: employeeId },
      { emp_no: employeeNumber.toUpperCase() }
    ],
    status: { $in: statusFilter },
    isActive: true,
    // Optimization: Only fetch potentially overlapping records
    fromDate: { $lte: end },
    toDate: { $gte: start },
  });

  const conflictingLeaves = [];

  // Check each Leave for conflicts
  for (const leave of leaves) {
    const leaveStart = new Date(leave.fromDate);
    leaveStart.setUTCHours(0, 0, 0, 0);
    const leaveEnd = new Date(leave.toDate);
    leaveEnd.setUTCHours(23, 59, 59, 999);

    // Check if date ranges overlap
    if (start <= leaveEnd && end >= leaveStart) {
      // If OD is single day and half day, check day-by-day
      if (isSameDay(fromDate, toDate) && isHalfDay) {
        // Single day half-day OD - check if Leave is on same day
        if (isSameDay(fromDate, leave.fromDate) && isSameDay(fromDate, leave.toDate)) {
          // Same day - check half-day conflict
          if (checkHalfDayConflict(isHalfDay, halfDayType, leave.isHalfDay, leave.halfDayType)) {
            conflictingLeaves.push(leave);
            const statusText = leave.status === 'approved' ? 'approved' : 'pending';
            errors.push(`Employee has a ${statusText} leave on ${leave.fromDate.toLocaleDateString()} that conflicts with this OD (${isHalfDay ? (halfDayType === 'first_half' ? 'First Half' : 'Second Half') : 'Full Day'} vs ${leave.isHalfDay ? (leave.halfDayType === 'first_half' ? 'First Half' : 'Second Half') : 'Full Day'})`);
          }
          // If different halves, no conflict - continue to next Leave
        } else {
          // Leave spans multiple days or different day - conflict
          conflictingLeaves.push(leave);
          const statusText = leave.status === 'approved' ? 'approved' : 'pending';
          errors.push(`Employee has a ${statusText} leave from ${leave.fromDate.toLocaleDateString()} to ${leave.toDate.toLocaleDateString()} that conflicts with this OD period`);
        }
      } else {
        // Multi-day OD or full-day OD - check each day in overlapping range
        const startDate = fromDate > leave.fromDate ? fromDate : leave.fromDate;
        const endDate = toDate < leave.toDate ? toDate : leave.toDate;

        // If OD is single day full day, check if Leave is on same day
        if (isSameDay(fromDate, toDate) && !isHalfDay) {
          // Full day OD - conflicts with any Leave on same day
          if (isSameDay(fromDate, leave.fromDate) && isSameDay(fromDate, leave.toDate)) {
            conflictingLeaves.push(leave);
            const statusText = leave.status === 'approved' ? 'approved' : 'pending';
            errors.push(`Employee has a ${statusText} leave on ${leave.fromDate.toLocaleDateString()} that conflicts with this full-day OD`);
          }
        } else {
          // Multi-day OD - conflicts with any overlapping Leave
          conflictingLeaves.push(leave);
          const statusText = leave.status === 'approved' ? 'approved' : 'pending';
          errors.push(`Employee has a ${statusText} leave from ${leave.fromDate.toLocaleDateString()} to ${leave.toDate.toLocaleDateString()} that conflicts with this OD period`);
        }
      }
    }
  }

  // 2. Validate against OTHER OD conflicts (Same type)
  const ods = await OD.find({
    $or: [
      { employeeId: employeeId },
      { emp_no: employeeNumber.toUpperCase() }
    ],
    status: { $in: statusFilter },
    isActive: true,
    // Optimization: Only fetch potentially overlapping records
    fromDate: { $lte: end },
    toDate: { $gte: start },
  });

  const conflictingODs = [];

  for (const od of ods) {
    // Skip if it's the current application being updated
    if (excludeId && String(od._id) === String(excludeId)) continue;

    const odStart = new Date(od.fromDate);
    odStart.setUTCHours(0, 0, 0, 0);
    const odEnd = new Date(od.toDate);
    odEnd.setUTCHours(23, 59, 59, 999);

    // Check if date ranges overlap
    if (start <= odEnd && end >= odStart) {
      if (isSameDay(fromDate, toDate) && od.isHalfDay && isHalfDay) {
        // Both are half-day on same day - check for half-day conflict
        if (checkHalfDayConflict(isHalfDay, halfDayType, od.isHalfDay, od.halfDayType)) {
          conflictingODs.push(od);
          const statusText = od.status === 'approved' ? 'approved' : 'pending';
          errors.push(`Employee has a ${statusText} OD on ${od.fromDate.toLocaleDateString()} that conflicts with this request (${isHalfDay ? (halfDayType === 'first_half' ? 'First Half' : 'Second Half') : 'Full Day'} vs ${od.isHalfDay ? (od.halfDayType === 'first_half' ? 'First Half' : 'Second Half') : 'Full Day'})`);
        }
      } else {
        // Overlap with another OD (non-half-day or spanning multiple days)
        conflictingODs.push(od);
        const statusText = od.status === 'approved' ? 'approved' : 'pending';
        errors.push(`Employee has a ${statusText} OD from ${od.fromDate.toLocaleDateString()} to ${od.toDate.toLocaleDateString()} that conflicts with this request period`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors: errors,
    warnings: warnings,
    conflictingLeaves: conflictingLeaves,
    conflictingODs: conflictingODs,
  };
};

/**
 * Get approved leave/OD info for a specific date (for frontend display)
 * @param {String} employeeId - Employee ID
 * @param {String} employeeNumber - Employee number
 * @param {String} date - Date to check (YYYY-MM-DD)
 * @returns {Object} - { hasLeave: boolean, hasOD: boolean, leaveInfo: object|null, odInfo: object|null }
 */
const getApprovedRecordsForDate = async (employeeId, employeeNumber, date) => {
  try {
    const checkDate = typeof date === 'string' ? new Date(date) : date;
    checkDate.setUTCHours(12, 0, 0, 0);

    // Check for approved Leave (only approved for creation dialog)
    const leaves = await Leave.find({
      $or: [
        { employeeId: employeeId },
        { emp_no: employeeNumber?.toUpperCase() }
      ],
      status: 'approved',
      isActive: true,
    });

    let leaveInfo = null;
    for (const leave of leaves) {
      if (isDateInRange(checkDate, leave.fromDate, leave.toDate)) {
        leaveInfo = {
          id: leave._id,
          status: leave.status,
          isHalfDay: leave.isHalfDay,
          halfDayType: leave.halfDayType,
          fromDate: leave.fromDate,
          toDate: leave.toDate,
        };
        break;
      }
    }

    // Check for approved OD (only approved for creation dialog)
    const ods = await OD.find({
      $or: [
        { employeeId: employeeId },
        { emp_no: employeeNumber?.toUpperCase() }
      ],
      status: 'approved',
      isActive: true,
    });

    let odInfo = null;
    for (const od of ods) {
      if (isDateInRange(checkDate, od.fromDate, od.toDate)) {
        odInfo = {
          id: od._id,
          status: od.status,
          isHalfDay: od.isHalfDay,
          halfDayType: od.halfDayType,
          fromDate: od.fromDate,
          toDate: od.toDate,
        };
        break;
      }
    }

    return {
      hasLeave: leaveInfo !== null,
      hasOD: odInfo !== null,
      leaveInfo: leaveInfo,
      odInfo: odInfo,
    };
  } catch (error) {
    console.error('Error getting approved records for date:', error);
    return {
      hasLeave: false,
      hasOD: false,
      leaveInfo: null,
      odInfo: null,
      error: error.message,
    };
  }
};

module.exports = {
  checkLeaveConflict,
  checkODConflict,
  checkAttendanceExists,
  validateOTRequest,
  validatePermissionRequest,
  validateLeaveRequest,
  validateODRequest,
  getApprovedRecordsForDate,
};

