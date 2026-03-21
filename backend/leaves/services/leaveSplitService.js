const Leave = require('../model/Leave');
const LeaveSplit = require('../model/LeaveSplit');
const LeaveSettings = require('../model/LeaveSettings');
const Employee = require('../../employees/model/Employee');
const { getFinancialYear, getLeaveNature } = require('./leaveBalanceService');

/**
 * Get all dates between fromDate and toDate (inclusive)
 * @param {Date} fromDate - Start date
 * @param {Date} toDate - End date
 * @param {Boolean} isHalfDay - Is the original leave a half-day?
 * @param {String} halfDayType - 'first_half' or 'second_half' (if isHalfDay is true)
 * @returns {Array} Array of date objects with day info
 */
function getDateRange(fromDate, toDate, isHalfDay = false, halfDayType = null) {
  const dates = [];
  const start = new Date(fromDate);
  const end = new Date(toDate);
  
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  let currentDate = new Date(start);
  
  while (currentDate <= end) {
    const dateCopy = new Date(currentDate);
    
    // If it's a single half-day leave
    if (isHalfDay && start.getTime() === end.getTime()) {
      dates.push({
        date: dateCopy,
        isHalfDay: true,
        halfDayType: halfDayType || 'first_half',
        numberOfDays: 0.5,
      });
    } else {
      // Full day
      dates.push({
        date: dateCopy,
        isHalfDay: false,
        halfDayType: null,
        numberOfDays: 1,
      });
    }
    
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return dates;
}

/**
 * Validate split data
 * @param {String} leaveId - Leave ID
 * @param {Array} splits - Array of split objects
 * @returns {Object} { isValid: Boolean, errors: Array, warnings: Array }
 */
async function validateSplits(leaveId, splits) {
  const errors = [];
  const warnings = [];

  try {
    // Get original leave
    const leave = await Leave.findById(leaveId).populate('employeeId', 'emp_no allottedLeaves');
    if (!leave) {
      return { isValid: false, errors: ['Leave not found'], warnings: [] };
    }

    // Get date range for original leave
    const originalDates = getDateRange(leave.fromDate, leave.toDate, leave.isHalfDay, leave.halfDayType);
    const originalTotalDays = leave.numberOfDays;

    // Validate splits
    let totalSplitDays = 0;
    const dateMap = new Map(); // Track which dates are covered

    for (const split of splits) {
      // Validate required fields
      if (!split.date) {
        errors.push('Split missing date');
        continue;
      }
      if (!split.leaveType) {
        errors.push(`Split for ${split.date} missing leave type`);
        continue;
      }
      if (split.status !== 'approved' && split.status !== 'rejected') {
        errors.push(`Split for ${split.date} has invalid status: ${split.status}`);
        continue;
      }

      // Calculate days for this split
      const splitDays = split.isHalfDay ? 0.5 : 1;
      if (split.status === 'approved') {
        totalSplitDays += splitDays;
      }

      // Check if date is within original leave range
      const splitDate = new Date(split.date);
      splitDate.setHours(0, 0, 0, 0);
      
      const isInRange = originalDates.some(od => {
        const odDate = new Date(od.date);
        odDate.setHours(0, 0, 0, 0);
        return odDate.getTime() === splitDate.getTime();
      });

      if (!isInRange) {
        errors.push(`Split date ${split.date} is outside original leave range (${leave.fromDate.toISOString().split('T')[0]} to ${leave.toDate.toISOString().split('T')[0]})`);
        continue;
      }

      // Check for duplicate dates (same date, same half-day)
      const dateKey = `${split.date}_${split.isHalfDay ? split.halfDayType : 'full'}`;
      if (dateMap.has(dateKey)) {
        errors.push(`Duplicate split for ${split.date}${split.isHalfDay ? ` (${split.halfDayType})` : ''}`);
        continue;
      }
      dateMap.set(dateKey, split);

      // Validate half-day logic
      if (split.isHalfDay && !split.halfDayType) {
        errors.push(`Split for ${split.date} is marked as half-day but missing halfDayType`);
        continue;
      }

      // Check leave balance if approved
      if (split.status === 'approved') {
        const balanceCheck = await checkLeaveBalance(leave.employeeId, split.leaveType, splitDays);
        if (!balanceCheck.hasBalance) {
          warnings.push(`Insufficient balance for ${split.leaveType} on ${split.date}: ${balanceCheck.message}`);
        }
      }
    }

    // Validate total days
    if (totalSplitDays > originalTotalDays) {
      errors.push(`Total approved split days (${totalSplitDays}) exceeds original leave days (${originalTotalDays})`);
    }

    // Check if all original dates are covered
    const coveredDates = new Set();
    splits.forEach(split => {
      const dateKey = `${new Date(split.date).toISOString().split('T')[0]}_${split.isHalfDay ? split.halfDayType : 'full'}`;
      coveredDates.add(dateKey);
    });

    // For half-day original leave, check if the specific half is covered
    if (leave.isHalfDay) {
      const originalDateKey = `${leave.fromDate.toISOString().split('T')[0]}_${leave.halfDayType}`;
      if (!coveredDates.has(originalDateKey)) {
        warnings.push('Original half-day is not covered in splits');
      }
    } else {
      // For full-day leaves, check if all dates are covered
      originalDates.forEach(od => {
        const dateKey = `${od.date.toISOString().split('T')[0]}_${od.isHalfDay ? od.halfDayType : 'full'}`;
        if (!coveredDates.has(dateKey)) {
          warnings.push(`Date ${od.date.toISOString().split('T')[0]} is not covered in splits`);
        }
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      totalSplitDays,
      originalTotalDays,
    };
  } catch (error) {
    console.error('Error validating splits:', error);
    return {
      isValid: false,
      errors: [error.message || 'Error validating splits'],
      warnings: [],
    };
  }
}

/**
 * Check leave balance for a specific leave type and days
 * @param {ObjectId} employeeId - Employee ID
 * @param {String} leaveType - Leave type code
 * @param {Number} days - Number of days (can be 0.5 for half-day)
 * @returns {Object} { hasBalance: Boolean, message: String, balance: Number }
 */
async function checkLeaveBalance(employeeId, leaveType, days) {
  try {
    const employee = await Employee.findById(employeeId).select('allottedLeaves emp_no');
    if (!employee) {
      return { hasBalance: false, message: 'Employee not found', balance: 0 };
    }

    // Get leave nature from settings
    const nature = await getLeaveNature(leaveType);

    // For without_pay and lop, check allottedLeaves balance
    if (nature === 'without_pay' || nature === 'lop') {
      const { getCurrentLeaveBalance } = require('./leaveBalanceService');
      const balance = await getCurrentLeaveBalance(employeeId);
      
      if (balance.balance < days) {
        return {
          hasBalance: false,
          message: `Insufficient balance. Available: ${balance.balance} days, Required: ${days} days`,
          balance: balance.balance,
        };
      }

      return {
        hasBalance: true,
        message: `Balance available: ${balance.balance} days`,
        balance: balance.balance,
      };
    }

    // For paid leaves, check against maxDaysPerYear from settings
    const settings = await LeaveSettings.getActiveSettings('leave');
    if (settings && settings.types) {
      const leaveTypeConfig = settings.types.find(t => t.code === leaveType && t.isActive);
      if (leaveTypeConfig && leaveTypeConfig.maxDaysPerYear) {
        // Get current year usage for this leave type
        const currentYear = new Date().getFullYear();
        const yearStart = new Date(currentYear, 0, 1);
        const yearEnd = new Date(currentYear, 11, 31, 23, 59, 59);

        const approvedSplits = await LeaveSplit.find({
          employeeId,
          leaveType,
          status: 'approved',
          date: { $gte: yearStart, $lte: yearEnd },
        });

        const usedDays = approvedSplits.reduce((sum, split) => sum + (split.numberOfDays || 0), 0);
        const available = leaveTypeConfig.maxDaysPerYear - usedDays;

        if (available < days) {
          return {
            hasBalance: false,
            message: `Insufficient balance. Available: ${available} days, Required: ${days} days (Max: ${leaveTypeConfig.maxDaysPerYear} days/year)`,
            balance: available,
          };
        }

        return {
          hasBalance: true,
          message: `Balance available: ${available} days`,
          balance: available,
        };
      }
    }

    // If no limit configured, allow
    return {
      hasBalance: true,
      message: 'No limit configured for this leave type',
      balance: Infinity,
    };
  } catch (error) {
    console.error('Error checking leave balance:', error);
    return {
      hasBalance: false,
      message: error.message || 'Error checking balance',
      balance: 0,
    };
  }
}

/**
 * Create splits for a leave
 * @param {String} leaveId - Leave ID
 * @param {Array} splits - Array of split objects
 * @param {Object} approver - User object who is creating splits
 * @returns {Object} { success: Boolean, data: Array, errors: Array }
 */
async function createSplits(leaveId, splits, approver) {
  try {
    // Get original leave
    const leave = await Leave.findById(leaveId).populate('employeeId', 'emp_no');
    if (!leave) {
      return { success: false, errors: ['Leave not found'] };
    }

    // Validate splits
    const validation = await validateSplits(leaveId, splits);
    if (!validation.isValid) {
      return { success: false, errors: validation.errors, warnings: validation.warnings };
    }

    // Delete existing splits for this leave (if re-splitting)
    await LeaveSplit.deleteMany({ leaveId });

    // Create new splits
    const createdSplits = [];
    const financialYear = await getFinancialYear(new Date());

    for (const splitData of splits) {
      const splitDate = new Date(splitData.date);
      splitDate.setHours(0, 0, 0, 0);

      const year = splitDate.getFullYear();
      const monthNum = splitDate.getMonth() + 1;
      const month = `${year}-${String(monthNum).padStart(2, '0')}`;

      // Get leave nature
      const nature = await getLeaveNature(splitData.leaveType);

      const split = await LeaveSplit.create({
        leaveId,
        employeeId: leave.employeeId._id,
        emp_no: leave.emp_no,
        date: splitDate,
        leaveType: splitData.leaveType.toUpperCase(),
        leaveNature: nature,
        isHalfDay: splitData.isHalfDay || false,
        halfDayType: splitData.halfDayType || null,
        status: splitData.status || 'approved',
        originalLeaveType: leave.leaveType.toUpperCase(),
        numberOfDays: splitData.isHalfDay ? 0.5 : 1,
        splitBy: approver._id,
        splitByName: approver.name,
        splitByRole: approver.role,
        splitAt: new Date(),
        notes: splitData.notes || null,
        financialYear,
        month,
      });

      createdSplits.push(split);
    }

    // Update leave with split information
    leave.splitStatus = 'split_approved';
    leave.splitBy = approver._id;
    leave.splitByName = approver.name;
    leave.splitByRole = approver.role;
    leave.splitAt = new Date();
    leave.splitNotes = splits.find(s => s.notes)?.notes || null;

    // Add to split history
    if (!leave.splitHistory) {
      leave.splitHistory = [];
    }
    leave.splitHistory.push({
      action: 'split_created',
      actionBy: approver._id,
      actionByName: approver.name,
      actionByRole: approver.role,
      actionAt: new Date(),
      originalDays: leave.numberOfDays,
      splits: splits.map(s => ({
        date: new Date(s.date),
        leaveType: s.leaveType,
        isHalfDay: s.isHalfDay || false,
        halfDayType: s.halfDayType || null,
        status: s.status,
        numberOfDays: s.isHalfDay ? 0.5 : 1,
      })),
      notes: splits.find(s => s.notes)?.notes || null,
    });

    // Preserve original leave type if not already set
    if (!leave.originalLeaveType) {
      leave.originalLeaveType = leave.leaveType;
    }

    await leave.save();

    // Update monthly leave records for approved splits
    const { updateMonthlyRecordOnLeaveAction } = require('./leaveBalanceService');
    for (const split of createdSplits) {
      if (split.status === 'approved') {
        // Create a temporary leave-like object for the update function
        const tempLeave = {
          _id: split._id,
          employeeId: split.employeeId,
          emp_no: split.emp_no,
          fromDate: split.date,
          toDate: split.date,
          numberOfDays: split.numberOfDays,
          isHalfDay: split.isHalfDay,
          halfDayType: split.halfDayType,
          leaveType: split.leaveType,
          status: 'approved',
        };
        await updateMonthlyRecordOnLeaveAction(tempLeave, 'approved');
      }
    }

    return {
      success: true,
      data: createdSplits,
      warnings: validation.warnings,
    };
  } catch (error) {
    console.error('Error creating splits:', error);
    return {
      success: false,
      errors: [error.message || 'Failed to create splits'],
    };
  }
}

/**
 * Get splits for a leave
 * @param {String} leaveId - Leave ID
 * @returns {Array} Array of LeaveSplit documents
 */
async function getSplits(leaveId) {
  try {
    const splits = await LeaveSplit.find({ leaveId })
      .populate('splitBy', 'name email role')
      .sort({ date: 1, isHalfDay: 1, halfDayType: 1 });
    return splits;
  } catch (error) {
    console.error('Error getting splits:', error);
    return [];
  }
}

/**
 * Update a single split
 * @param {String} splitId - Split ID
 * @param {Object} updateData - Data to update
 * @param {Object} approver - User making the update
 * @returns {Object} { success: Boolean, data: LeaveSplit, errors: Array }
 */
async function updateSplit(splitId, updateData, approver) {
  try {
    const split = await LeaveSplit.findById(splitId);
    if (!split) {
      return { success: false, errors: ['Split not found'] };
    }

    // Validate if updating leave type and status
    if (updateData.leaveType || updateData.status === 'approved') {
      const days = updateData.isHalfDay !== undefined ? (updateData.isHalfDay ? 0.5 : 1) : split.numberOfDays;
      const leaveType = updateData.leaveType || split.leaveType;
      
      const balanceCheck = await checkLeaveBalance(split.employeeId, leaveType, days);
      if (!balanceCheck.hasBalance && updateData.status === 'approved') {
        return {
          success: false,
          errors: [balanceCheck.message],
        };
      }
    }

    // Update split
    if (updateData.leaveType) {
      const nature = await getLeaveNature(updateData.leaveType);
      split.leaveType = updateData.leaveType.toUpperCase();
      split.leaveNature = nature;
    }
    if (updateData.status !== undefined) split.status = updateData.status;
    if (updateData.isHalfDay !== undefined) split.isHalfDay = updateData.isHalfDay;
    if (updateData.halfDayType !== undefined) split.halfDayType = updateData.halfDayType;
    if (updateData.notes !== undefined) split.notes = updateData.notes;
    
    split.numberOfDays = split.isHalfDay ? 0.5 : 1;
    await split.save();

    // Update leave split history
    const leave = await Leave.findById(split.leaveId);
    if (leave && leave.splitHistory) {
      leave.splitHistory.push({
        action: 'split_modified',
        actionBy: approver._id,
        actionByName: approver.name,
        actionByRole: approver.role,
        actionAt: new Date(),
        splits: [{
          date: split.date,
          leaveType: split.leaveType,
          isHalfDay: split.isHalfDay,
          halfDayType: split.halfDayType,
          status: split.status,
          numberOfDays: split.numberOfDays,
        }],
        notes: `Split modified: ${JSON.stringify(updateData)}`,
      });
      await leave.save();
    }

    return {
      success: true,
      data: split,
    };
  } catch (error) {
    console.error('Error updating split:', error);
    return {
      success: false,
      errors: [error.message || 'Failed to update split'],
    };
  }
}

/**
 * Delete a split
 * @param {String} splitId - Split ID
 * @returns {Object} { success: Boolean, errors: Array }
 */
async function deleteSplit(splitId) {
  try {
    const split = await LeaveSplit.findById(splitId);
    if (!split) {
      return { success: false, errors: ['Split not found'] };
    }

    await LeaveSplit.findByIdAndDelete(splitId);
    return { success: true };
  } catch (error) {
    console.error('Error deleting split:', error);
    return {
      success: false,
      errors: [error.message || 'Failed to delete split'],
    };
  }
}

/**
 * Get split summary for a leave
 * @param {String} leaveId - Leave ID
 * @returns {Object} Summary object
 */
async function getSplitSummary(leaveId) {
  try {
    const leave = await Leave.findById(leaveId);
    if (!leave) {
      return null;
    }

    const splits = await getSplits(leaveId);
    
    const summary = {
      originalDays: leave.numberOfDays,
      originalLeaveType: leave.originalLeaveType || leave.leaveType,
      totalSplits: splits.length,
      approvedDays: 0,
      rejectedDays: 0,
      breakdown: {},
    };

    splits.forEach(split => {
      if (split.status === 'approved') {
        summary.approvedDays += split.numberOfDays;
      } else {
        summary.rejectedDays += split.numberOfDays;
      }

      const key = `${split.leaveType}_${split.status}`;
      if (!summary.breakdown[key]) {
        summary.breakdown[key] = {
          leaveType: split.leaveType,
          status: split.status,
          days: 0,
        };
      }
      summary.breakdown[key].days += split.numberOfDays;
    });

    return summary;
  } catch (error) {
    console.error('Error getting split summary:', error);
    return null;
  }
}

module.exports = {
  getDateRange,
  validateSplits,
  checkLeaveBalance,
  createSplits,
  getSplits,
  updateSplit,
  deleteSplit,
  getSplitSummary,
};

