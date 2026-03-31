const AttendanceDaily = require('../../attendance/model/AttendanceDaily');
const Leave = require('../../leaves/model/Leave');
const LeaveSplit = require('../../leaves/model/LeaveSplit');
const OD = require('../../leaves/model/OD');
const OT = require('../../overtime/model/OT');
const PreScheduledShift = require('../../shifts/model/PreScheduledShift');
const LeaveSettings = require('../../leaves/model/LeaveSettings');
const LeavePolicySettings = require('../../settings/model/LeavePolicySettings');
const Shift = require('../../shifts/model/Shift');
const MonthlyAttendanceSummary = require('../../attendance/model/MonthlyAttendanceSummary');
const summaryCalculationService = require('../../attendance/services/summaryCalculationService');
const { getPayrollDateRange, getAllDatesInRange } = require('../../shared/utils/dateUtils');

/**
 * Auto Population Service
 * Populates pay register from existing data sources
 */

/**
 * Get leave nature from leave type.
 * For EL: when "Use EL as paid in payroll" is ON, return 'lop' (availed EL does not add to pay register; pay comes from balance in payroll). When OFF, use the nature defined in Leave Types (paid/lop).
 */
async function getLeaveNature(leaveType) {
  try {
    if (leaveType && String(leaveType).toUpperCase() === 'EL') {
      const policy = await LeavePolicySettings.getSettings();
      if (policy.earnedLeave && policy.earnedLeave.useAsPaidInPayroll === true) {
        return 'lop';
      }
      // When OFF: use nature defined at leave type (fall through to Leave Settings)
    }

    const leaveSettings = await LeaveSettings.findOne({ type: 'leave', isActive: true });
    if (!leaveSettings || !leaveSettings.types) {
      return 'paid'; // Default
    }

    const leaveTypeConfig = leaveSettings.types.find(
      (lt) => lt.code.toUpperCase() === leaveType.toUpperCase() && lt.isActive
    );

    if (leaveTypeConfig) {
      return leaveTypeConfig.leaveNature || 'paid';
    }

    return 'paid'; // Default
  } catch (error) {
    console.error('Error getting leave nature:', error);
    return 'paid'; // Default
  }
}

/**
 * Fetch attendance data for employee and date range
 * @param {String} emp_no - Employee number
 * @param {String} startDate - YYYY-MM-DD
 * @param {String} endDate - YYYY-MM-DD
 * @returns {Object} Map of date -> attendance record
 */
async function fetchAttendanceData(emp_no, startDate, endDate) {
  const attendanceRecords = await AttendanceDaily.find({
    employeeNumber: emp_no,
    date: { $gte: startDate, $lte: endDate },
  }).populate('shifts.shiftId', 'name payableShifts');

  const attendanceMap = {};
  attendanceRecords.forEach((record) => {
    attendanceMap[record.date] = record;
  });

  return attendanceMap;
}

/**
 * Fetch leave data for employee and date range
 * @param {String} employeeId - Employee ID
 * @param {String} startDate - YYYY-MM-DD
 * @param {String} endDate - YYYY-MM-DD
 * @returns {Object} Map of date -> leave data
 */
async function fetchLeaveData(employeeId, startDate, endDate, payrollMonth) {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  // Fetch approved leaves overlapping the range
  const leaves = await Leave.find({
    employeeId,
    status: { $in: ['approved', 'hr_approved', 'hod_approved'] },
    isActive: true,
    $or: [
      { fromDate: { $lte: end }, toDate: { $gte: start } },
    ],
  });

  // Fetch leave splits for the payroll month
  const leaveSplits = await LeaveSplit.find({
    employeeId,
    month: payrollMonth,
    status: 'approved',
  });

  const leaveMap = {};

  // Process full leaves
  for (const leave of leaves) {
    const fromDate = new Date(leave.fromDate);
    const toDate = new Date(leave.toDate);

    let currentDate = new Date(fromDate);
    while (currentDate <= toDate) {
      const dateStr = currentDate.toISOString().split('T')[0];

      // Check if this date is within the target range
      if (dateStr >= startDate && dateStr <= endDate) {
        if (!leaveMap[dateStr]) {
          leaveMap[dateStr] = {
            leaveIds: [],
            leaveSplitIds: [],
            isHalfDay: leave.isHalfDay,
            halfDayType: leave.halfDayType,
            leaveType: leave.leaveType,
            originalLeaveType: leave.originalLeaveType || leave.leaveType,
          };
        }

        leaveMap[dateStr].leaveIds.push(leave._id);
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  // Process leave splits (these override full leaves for specific dates)
  for (const split of leaveSplits) {
    const dateStr = split.date.toISOString().split('T')[0];

    if (dateStr >= startDate && dateStr <= endDate) {
      if (!leaveMap[dateStr]) {
        leaveMap[dateStr] = {
          leaveIds: [],
          leaveSplitIds: [],
          isHalfDay: false,
          halfDayType: null,
          leaveType: null,
          originalLeaveType: null,
        };
      }

      leaveMap[dateStr].leaveSplitIds.push(split._id);
      leaveMap[dateStr].isHalfDay = split.isHalfDay;
      leaveMap[dateStr].halfDayType = split.halfDayType;
      leaveMap[dateStr].leaveType = split.leaveType;
      leaveMap[dateStr].leaveNature = split.leaveNature;
    }
  }

  return leaveMap;
}

/**
 * Fetch OD data for employee and date range
 * @param {String} employeeId - Employee ID
 * @param {String} startDate - YYYY-MM-DD
 * @param {String} endDate - YYYY-MM-DD
 * @returns {Object} Map of date -> OD data
 */
async function fetchODData(employeeId, startDate, endDate) {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  const ods = await OD.find({
    employeeId,
    status: { $in: ['approved', 'hr_approved', 'hod_approved'] },
    isActive: true,
    $or: [
      { fromDate: { $lte: end }, toDate: { $gte: start } },
    ],
  });

  const odMap = {};

  for (const od of ods) {
    const fromDate = new Date(od.fromDate);
    const toDate = new Date(od.toDate);

    let currentDate = new Date(fromDate);
    while (currentDate <= toDate) {
      const dateStr = currentDate.toISOString().split('T')[0];

      if (dateStr >= startDate && dateStr <= endDate) {
        if (!odMap[dateStr]) {
          odMap[dateStr] = {
            odIds: [],
            isHalfDay: od.isHalfDay,
            halfDayType: od.halfDayType,
            odType: od.odType,
          };
        }

        odMap[dateStr].odIds.push(od._id);
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  return odMap;
}

/**
 * Fetch OT data for employee and date range
 * @param {String} employeeId - Employee ID
 * @param {String} startDate - YYYY-MM-DD
 * @param {String} endDate - YYYY-MM-DD
 * @returns {Object} Map of date -> OT hours
 */
async function fetchOTData(employeeId, startDate, endDate) {
  const ots = await OT.find({
    employeeId,
    status: 'approved',
    date: { $gte: startDate, $lte: endDate },
  });

  const otMap = {};
  ots.forEach((ot) => {
    const dateStr = ot.date;
    if (!otMap[dateStr]) {
      otMap[dateStr] = {
        otIds: [],
        totalHours: 0,
      };
    }
    otMap[dateStr].otIds.push(ot._id);
    otMap[dateStr].totalHours += ot.otHours || 0;
  });

  return otMap;
}

/**
 * Fetch shift data for employee and date range
 * @param {String} emp_no - Employee number
 * @param {String} startDate - YYYY-MM-DD
 * @param {String} endDate - YYYY-MM-DD
 * @returns {Object} Map of date -> shift data
 */
async function fetchShiftData(emp_no, startDate, endDate) {
  const preScheduledShifts = await PreScheduledShift.find({
    employeeNumber: emp_no,
    date: { $gte: startDate, $lte: endDate },
  }).populate('shiftId', 'name payableShifts');

  const shiftMap = {};
  preScheduledShifts.forEach((ps) => {
    if (ps.shiftId) {
      shiftMap[ps.date] = {
        shiftId: ps.shiftId._id,
        shiftName: ps.shiftId.name,
        payableShifts: ps.shiftId.payableShifts || 1,
        status: ps.status // Might be null or 'WO' or 'HOL'
      };
    } else if (ps.status === 'WO' || ps.status === 'HOL') {
      shiftMap[ps.date] = {
        shiftId: null,
        shiftName: ps.status === 'WO' ? 'Week Off' : 'Holiday',
        payableShifts: 0,
        status: ps.status
      };
    }
  });

  return shiftMap;
}

/**
 * Resolve conflicts and determine status for a date
 */
async function resolveConflicts(dateData) {
  const { attendance, leave, od, shift, lateInMinutes, earlyOutMinutes } = dateData;
  const isHoliday = shift?.status === 'HOL';
  const isWeekOff = shift?.status === 'WO';

  const defaultStatus = isHoliday ? 'holiday' : (isWeekOff ? 'week_off' : 'absent');
  let firstHalf = { status: defaultStatus, leaveType: null, isOD: false };
  let secondHalf = { status: defaultStatus, leaveType: null, isOD: false };

  if (leave) {
    const leaveNature = leave.leaveNature || await getLeaveNature(leave.leaveType);

    if (leave.isHalfDay) {
      if (leave.halfDayType === 'first_half') {
        firstHalf.status = 'leave';
        firstHalf.leaveType = leaveNature;
      } else if (leave.halfDayType === 'second_half') {
        secondHalf.status = 'leave';
        secondHalf.leaveType = leaveNature;
      }
    } else {
      firstHalf.status = 'leave';
      firstHalf.leaveType = leaveNature;
      secondHalf.status = 'leave';
      secondHalf.leaveType = leaveNature;
    }
  }

  const isNonWorking = (status) => ['absent', 'week_off', 'holiday'].includes(status);

  if (od && (!leave || (leave.isHalfDay && od.isHalfDay && leave.halfDayType !== od.halfDayType))) {
    if (od.isHalfDay) {
      if (od.halfDayType === 'first_half' && isNonWorking(firstHalf.status)) {
        firstHalf.status = 'od';
        firstHalf.isOD = true;
      } else if (od.halfDayType === 'second_half' && isNonWorking(secondHalf.status)) {
        secondHalf.status = 'od';
        secondHalf.isOD = true;
      }
    } else {
      if (isNonWorking(firstHalf.status)) {
        firstHalf.status = 'od';
        firstHalf.isOD = true;
      }
      if (isNonWorking(secondHalf.status)) {
        secondHalf.status = 'od';
        secondHalf.isOD = true;
      }
    }
  }

  // Only PRESENT and HALF_DAY count as present (align with attendance summary; PARTIAL is not counted as present)
  if (attendance && (attendance.status === 'PRESENT' || attendance.status === 'HALF_DAY')) {
    if (attendance.status === 'HALF_DAY') {
      const eo = Number(earlyOutMinutes) || 0;
      const li = Number(lateInMinutes) || 0;

      if (eo > 120) {
        if (isNonWorking(firstHalf.status)) firstHalf.status = 'present';
      } else if (li > 120) {
        if (isNonWorking(secondHalf.status)) secondHalf.status = 'present';
      } else {
        if (isNonWorking(firstHalf.status)) firstHalf.status = 'present'; // Default
      }
    } else {
      if (isNonWorking(firstHalf.status)) {
        firstHalf.status = 'present';
      }
      if (isNonWorking(secondHalf.status)) {
        secondHalf.status = 'present';
      }
    }
  }

  return { firstHalf, secondHalf };
}

/**
 * Populate pay register from all sources
 * @param {String} employeeId - Employee ID
 * @param {String} emp_no - Employee number
 * @param {Number} year - Year
 * @param {Number} monthNumber - Month number (1-12)
 * @returns {Array} Array of dailyRecords
 */
async function populatePayRegisterFromSources(employeeId, emp_no, year, monthNumber) {
  const month = `${year}-${String(monthNumber).padStart(2, '0')}`;
  const { startDate, endDate } = await getPayrollDateRange(year, monthNumber);
  const dates = getAllDatesInRange(startDate, endDate);

  // Fetch all data sources
  const [attendanceMap, leaveMap, odMap, otMap, shiftMap] = await Promise.all([
    fetchAttendanceData(emp_no, startDate, endDate),
    fetchLeaveData(employeeId, startDate, endDate, month),
    fetchODData(employeeId, startDate, endDate),
    fetchOTData(employeeId, startDate, endDate),
    fetchShiftData(emp_no, startDate, endDate),
  ]);

  const dailyRecords = [];

  for (const date of dates) {
    const attendance = attendanceMap[date];
    const leave = leaveMap[date];
    const od = odMap[date];
    const ot = otMap[date];
    const shift = shiftMap[date] || (attendance?.shiftId ? {
      shiftId: attendance.shiftId._id,
      shiftName: attendance.shiftId.name,
      payableShifts: attendance.shiftId.payableShifts || 1,
    } : null);

    // Late/early-out: use only the first segment (first shift) when employee has multiple shifts
    const firstShift = Array.isArray(attendance?.shifts) && attendance.shifts.length > 0 ? attendance.shifts[0] : null;
    let isLate = firstShift
      ? Boolean(firstShift.isLateIn || (typeof firstShift.lateInMinutes === 'number' && firstShift.lateInMinutes > 0))
      : Boolean(attendance?.isLateIn || (typeof attendance?.totalLateInMinutes === 'number' && attendance.totalLateInMinutes > 0));
    let isEarlyOut = firstShift
      ? Boolean(firstShift.isEarlyOut || (typeof firstShift.earlyOutMinutes === 'number' && firstShift.earlyOutMinutes > 0))
      : Boolean(attendance?.isEarlyOut || (typeof attendance?.totalEarlyOutMinutes === 'number' && attendance.totalEarlyOutMinutes > 0));
    let lateInMinutes = firstShift
      ? (typeof firstShift.lateInMinutes === 'number' ? firstShift.lateInMinutes : 0)
      : (typeof attendance?.totalLateInMinutes === 'number' ? attendance.totalLateInMinutes : 0);
    let earlyOutMinutes = firstShift
      ? (typeof firstShift.earlyOutMinutes === 'number' ? firstShift.earlyOutMinutes : 0)
      : (typeof attendance?.totalEarlyOutMinutes === 'number' ? attendance.totalEarlyOutMinutes : 0);

    const { firstHalf, secondHalf } = await resolveConflicts({
      attendance,
      leave,
      od,
      shift,
      lateInMinutes,
      earlyOutMinutes,
    });

    const isSplit = firstHalf.status !== secondHalf.status;
    const status = isSplit ? null : (firstHalf.status || 'absent');
    const leaveType = isSplit ? null : (firstHalf.leaveType || null);
    const isOD = isSplit ? false : (firstHalf.isOD || false);

    // Apply OD/Leave Waiver Logic: If OD or Leave covers the half, waive Lates/Early Outs respectively
    if (firstHalf.isOD || firstHalf.status === 'od' || firstHalf.status === 'leave') {
      isLate = false;
      lateInMinutes = 0;
    }
    if (secondHalf.isOD || secondHalf.status === 'od' || secondHalf.status === 'leave') {
      isEarlyOut = false;
      earlyOutMinutes = 0;
    }

    const dailyRecord = {
      date,
      firstHalf: {
        status: firstHalf.status,
        leaveType: firstHalf.leaveType,
        isOD: firstHalf.isOD,
        otHours: 0,
        shiftId: shift?.shiftId || null,
        remarks: null,
      },
      secondHalf: {
        status: secondHalf.status,
        leaveType: secondHalf.leaveType,
        isOD: secondHalf.isOD,
        otHours: 0,
        shiftId: shift?.shiftId || null,
        remarks: null,
      },
      status,
      leaveType,
      isOD,
      isSplit,
      shiftId: shift?.shiftId || null,
      shiftName: shift?.shiftName || null,
      payableShifts: shift?.payableShifts || 1,
      otHours: ot?.totalHours || 0,
      attendanceRecordId: attendance?._id || null,
      leaveIds: leave?.leaveIds || [],
      leaveSplitIds: leave?.leaveSplitIds || [],
      odIds: od?.odIds || [],
      otIds: ot?.otIds || [],
      isLate,
      isEarlyOut,
      lateInMinutes,
      earlyOutMinutes,
      remarks: null,
    };

    dailyRecords.push(dailyRecord);
  }

  return dailyRecords;
}

/**
 * Get or calculate monthly attendance summary for the employee
 * @param {String} employeeId 
 * @param {String} emp_no 
 * @param {Number} year 
 * @param {Number} monthNumber 
 * @returns {Promise<Object>} MonthlyAttendanceSummary document
 */
async function getSummaryData(employeeId, emp_no, year, monthNumber) {
  const month = `${year}-${String(monthNumber).padStart(2, '0')}`;
  
  // 1. Try to find existing summary
  let summary = await MonthlyAttendanceSummary.findOne({ employeeId, month });
  
  // 2. If not present, trigger calculation
  if (!summary) {
    console.log(`[Pay Register Sync] Summary not found for ${emp_no} ${month}. Triggering calculation...`);
    summary = await summaryCalculationService.calculateMonthlySummary(employeeId, emp_no, year, monthNumber);
  } else {
    console.log(`[Pay Register Sync] Using existing summary for ${emp_no} ${month}.`);
  }
  
  return summary;
}

module.exports = {
  populatePayRegisterFromSources,
  fetchAttendanceData,
  fetchLeaveData,
  fetchODData,
  fetchOTData,
  fetchShiftData,
  resolveConflicts,
  getLeaveNature,
  getSummaryData,
};
