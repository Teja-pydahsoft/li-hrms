const MonthlyLeaveRecord = require('../model/MonthlyLeaveRecord');
const Leave = require('../model/Leave');
const LeaveSettings = require('../model/LeaveSettings');
const Employee = require('../../employees/model/Employee');
const { createISTDate, extractISTComponents } = require('../../shared/utils/dateUtils');
const dateCycleService = require('./dateCycleService');

/**
 * Get financial year from a date
 * @param {Date} date - Date to get financial year for
 * @returns {Promise<String>} Financial year in format "YYYY-YYYY" (e.g., "2024-2025")
 */
async function getFinancialYear(date) {
  const periodInfo = await dateCycleService.getFinancialYearForDate(date);
  return periodInfo.name;
}

/**
 * Get or create monthly leave record for an employee and month
 * @param {String} employeeId - Employee ID
 * @param {String} emp_no - Employee number
 * @param {Date} date - Date to get month for
 * @returns {Object} MonthlyLeaveRecord
 */
async function getOrCreateMonthlyRecord(employeeId, emp_no, date) {
  const { year, month: monthNumber, dateStr } = extractISTComponents(date);
  const month = dateStr.substring(0, 7); // YYYY-MM
  const financialYear = await getFinancialYear(date);

  let record = await MonthlyLeaveRecord.findOne({
    employeeId,
    month,
  });

  if (!record) {
    record = await MonthlyLeaveRecord.create({
      employeeId,
      emp_no,
      month,
      year,
      monthNumber,
      financialYear,
      leaveIds: [],
      summary: {
        totalLeaves: 0,
        paidLeaves: 0,
        withoutPayLeaves: 0,
        lopLeaves: 0,
        leaveTypesBreakdown: [],
        leaveNaturesBreakdown: [],
      },
    });
  }

  return record;
}

/**
 * Get leave nature from leave object or leave type settings
 * @param {String|Object} leaveTypeOrLeave - Leave type code or Leave object
 * @returns {String} Leave nature ('paid', 'lop', or 'without_pay')
 */
async function getLeaveNature(leaveTypeOrLeave) {
  try {
    // If it's a Leave object with leaveNature field, use that first
    if (typeof leaveTypeOrLeave === 'object' && leaveTypeOrLeave.leaveNature) {
      return leaveTypeOrLeave.leaveNature;
    }

    // Otherwise, derive from leave type settings
    const leaveType = typeof leaveTypeOrLeave === 'string'
      ? leaveTypeOrLeave
      : leaveTypeOrLeave.leaveType;

    const settings = await LeaveSettings.getActiveSettings('leave');
    if (!settings || !settings.types) {
      return 'paid'; // Default to paid if settings not found
    }

    const leaveTypeConfig = settings.types.find(
      (t) => t.code === leaveType && t.isActive
    );

    if (!leaveTypeConfig) {
      return 'paid'; // Default to paid if leave type not found
    }

    return leaveTypeConfig.leaveNature || (leaveTypeConfig.isPaid ? 'paid' : 'without_pay');
  } catch (error) {
    console.error('Error getting leave nature:', error);
    return 'paid'; // Default to paid on error
  }
}

/**
 * Recalculate monthly leave record summary
 * @param {String} employeeId - Employee ID
 * @param {String} month - Month in format "YYYY-MM"
 * @returns {Object} Updated MonthlyLeaveRecord
 */
async function recalculateMonthlyRecord(employeeId, month) {
  const record = await MonthlyLeaveRecord.findOne({ employeeId, month });
  if (!record) {
    return null;
  }

  // Get all approved leaves for this month
  const [year, monthNum] = month.split('-').map(Number);
  const startDate = createISTDate(`${year}-${String(monthNum).padStart(2, '0')}-01`);

  const nextMonthYear = monthNum === 12 ? year + 1 : year;
  const nextMonthNum = monthNum === 12 ? 1 : monthNum + 1;
  const nextMonthFirstDay = createISTDate(`${nextMonthYear}-${String(nextMonthNum).padStart(2, '0')}-01`);
  const endDate = new Date(nextMonthFirstDay.getTime() - 1000);

  // Get regular approved leaves (non-split)
  const leaves = await Leave.find({
    employeeId,
    status: 'approved',
    isActive: true,
    splitStatus: { $in: [null, ''] }, // Only non-split leaves
    $or: [
      {
        fromDate: { $lte: endDate },
        toDate: { $gte: startDate },
      },
    ],
  }).populate('employeeId', 'emp_no');

  // Get approved leave splits for this month
  const LeaveSplit = require('../model/LeaveSplit');
  const splits = await LeaveSplit.find({
    employeeId,
    status: 'approved',
    month,
  }).populate('leaveId', 'leaveType');

  // Initialize summary
  const summary = {
    totalLeaves: 0,
    paidLeaves: 0,
    withoutPayLeaves: 0,
    lopLeaves: 0,
    leaveTypesBreakdown: [],
    leaveNaturesBreakdown: [],
  };

  const leaveIds = [];
  const leaveTypeMap = new Map();
  const natureMap = new Map();

  // Process each leave
  for (const leave of leaves) {
    // Check if this leave falls within the month
    const leaveStart = createISTDate(extractISTComponents(leave.fromDate).dateStr, '00:00');
    const leaveEnd = createISTDate(extractISTComponents(leave.toDate).dateStr, '23:59');

    let daysInMonth = 0;
    let currentDate = new Date(leaveStart);
    while (currentDate <= leaveEnd) {
      const { year: currentYear, month: currentMonth } = extractISTComponents(currentDate);
      if (currentYear === year && currentMonth === monthNum) {
        daysInMonth += leave.isHalfDay ? 0.5 : 1;
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    if (daysInMonth === 0) {
      continue; // This leave doesn't fall in this month
    }

    leaveIds.push(leave._id);

    // Get leave nature - prioritize leave.leaveNature if set
    const nature = await getLeaveNature(leave);
    const leaveTypeName = leave.leaveType; // You can enhance this to get actual name from settings

    // Update totals
    summary.totalLeaves += daysInMonth;
    if (nature === 'paid') {
      summary.paidLeaves += daysInMonth;
    } else if (nature === 'lop') {
      summary.lopLeaves += daysInMonth;
    } else if (nature === 'without_pay') {
      summary.withoutPayLeaves += daysInMonth;
    }

    // Update leave type breakdown
    if (!leaveTypeMap.has(leave.leaveType)) {
      leaveTypeMap.set(leave.leaveType, {
        leaveType: leave.leaveType,
        leaveTypeName,
        days: 0,
        nature,
        leaveIds: [],
      });
    }
    const typeBreakdown = leaveTypeMap.get(leave.leaveType);
    typeBreakdown.days += daysInMonth;
    if (!typeBreakdown.leaveIds.includes(leave._id)) {
      typeBreakdown.leaveIds.push(leave._id);
    }

    // Update nature breakdown
    if (!natureMap.has(nature)) {
      natureMap.set(nature, {
        nature,
        days: 0,
        leaveIds: [],
      });
    }
    const natureBreakdown = natureMap.get(nature);
    natureBreakdown.days += daysInMonth;
    if (!natureBreakdown.leaveIds.includes(leave._id)) {
      natureBreakdown.leaveIds.push(leave._id);
    }
  }

  // Process leave splits (split-approved leaves)
  for (const split of splits) {
    const { year: splitYear, month: splitMonth } = extractISTComponents(split.date);

    // Only process splits for this month
    if (splitYear !== year || splitMonth !== monthNum) {
      continue;
    }

    const splitDays = split.numberOfDays || (split.isHalfDay ? 0.5 : 1);

    // Add split leave ID if not already added
    if (split.leaveId && !leaveIds.includes(split.leaveId._id)) {
      leaveIds.push(split.leaveId._id);
    }

    // Update totals
    summary.totalLeaves += splitDays;
    if (split.leaveNature === 'paid') {
      summary.paidLeaves += splitDays;
    } else if (split.leaveNature === 'lop') {
      summary.lopLeaves += splitDays;
    } else if (split.leaveNature === 'without_pay') {
      summary.withoutPayLeaves += splitDays;
    }

    // Update leave type breakdown
    if (!leaveTypeMap.has(split.leaveType)) {
      const settings = await LeaveSettings.getActiveSettings('leave');
      const leaveTypeConfig = settings?.types?.find(t => t.code === split.leaveType);
      leaveTypeMap.set(split.leaveType, {
        leaveType: split.leaveType,
        leaveTypeName: leaveTypeConfig?.name || split.leaveType,
        days: 0,
        nature: split.leaveNature,
        leaveIds: [],
      });
    }
    const typeBreakdown = leaveTypeMap.get(split.leaveType);
    typeBreakdown.days += splitDays;
    if (split.leaveId && !typeBreakdown.leaveIds.includes(split.leaveId._id)) {
      typeBreakdown.leaveIds.push(split.leaveId._id);
    }

    // Update nature breakdown
    if (!natureMap.has(split.leaveNature)) {
      natureMap.set(split.leaveNature, {
        nature: split.leaveNature,
        days: 0,
        leaveIds: [],
      });
    }
    const natureBreakdown = natureMap.get(split.leaveNature);
    natureBreakdown.days += splitDays;
    if (split.leaveId && !natureBreakdown.leaveIds.includes(split.leaveId._id)) {
      natureBreakdown.leaveIds.push(split.leaveId._id);
    }
  }

  // Convert maps to arrays
  summary.leaveTypesBreakdown = Array.from(leaveTypeMap.values());
  summary.leaveNaturesBreakdown = Array.from(natureMap.values());

  // Update record
  record.leaveIds = leaveIds;
  record.summary = summary;
  await record.save();

  return record;
}

/**
 * Update monthly leave record when a leave is approved/rejected/cancelled
 * @param {Object} leave - Leave document
 * @param {String} action - 'approved', 'rejected', or 'cancelled'
 */
async function updateMonthlyRecordOnLeaveAction(leave, action) {
  try {
    if (!leave.employeeId || !leave.fromDate || !leave.toDate) {
      console.error('Invalid leave data for monthly record update');
      return;
    }

    const employee = await Employee.findById(leave.employeeId).select('emp_no');
    if (!employee) {
      console.error('Employee not found for leave:', leave._id);
      return;
    }

    // Get all months this leave spans
    const { year: startYear, month: startMonth } = extractISTComponents(leave.fromDate);
    const { year: endYear, month: endMonthNum } = extractISTComponents(leave.toDate);
    const months = new Set();

    let currentDate = createISTDate(`${startYear}-${String(startMonth).padStart(2, '0')}-01`);
    const endBoundary = createISTDate(`${endYear}-${String(endMonthNum).padStart(2, '0')}-01`);

    while (currentDate <= endBoundary) {
      const { year, month: monthNum } = extractISTComponents(currentDate);
      const month = `${year}-${String(monthNum).padStart(2, '0')}`;
      months.add(month);
      currentDate.setMonth(currentDate.getMonth() + 1);
      currentDate.setDate(1); // Move to first day of next month
    }

    // Recalculate for each affected month
    for (const month of months) {
      if (action === 'approved') {
        // Recalculate to include this leave
        await recalculateMonthlyRecord(leave.employeeId, month);
      } else if (action === 'rejected' || action === 'cancelled') {
        // Recalculate to exclude this leave
        await recalculateMonthlyRecord(leave.employeeId, month);
      }
    }
  } catch (error) {
    console.error('Error updating monthly leave record:', error);
  }
}

/**
 * Calculate current leave balance for without_pay leaves
 * @param {String} employeeId - Employee ID
 * @param {String} financialYear - Financial year (e.g., "2024-2025")
 * @returns {Object} Balance information
 */
async function calculateLeaveBalance(employeeId, financialYear) {
  try {
    const employee = await Employee.findById(employeeId).select('allottedLeaves emp_no');
    if (!employee) {
      throw new Error('Employee not found');
    }

    // Get all monthly records for this financial year
    const records = await MonthlyLeaveRecord.find({
      employeeId,
      financialYear,
    });

    // Sum all without_pay and lop leaves
    let totalWithoutPayLeaves = 0;
    for (const record of records) {
      totalWithoutPayLeaves += record.summary.withoutPayLeaves || 0;
      totalWithoutPayLeaves += record.summary.lopLeaves || 0;
    }

    const allottedLeaves = employee.allottedLeaves || 0;
    const balance = Math.max(0, allottedLeaves - totalWithoutPayLeaves);
    const used = totalWithoutPayLeaves;

    return {
      employeeId,
      emp_no: employee.emp_no,
      financialYear,
      allottedLeaves,
      used,
      balance,
      available: balance,
    };
  } catch (error) {
    console.error('Error calculating leave balance:', error);
    throw error;
  }
}

/**
 * Get leave balance for current financial year
 * @param {String} employeeId - Employee ID
 * @returns {Object} Balance information
 */
async function getCurrentLeaveBalance(employeeId) {
  const currentDate = new Date();
  const financialYear = await getFinancialYear(currentDate);
  return calculateLeaveBalance(employeeId, financialYear);
}

module.exports = {
  getFinancialYear,
  getOrCreateMonthlyRecord,
  getLeaveNature,
  recalculateMonthlyRecord,
  updateMonthlyRecordOnLeaveAction,
  calculateLeaveBalance,
  getCurrentLeaveBalance,
};


