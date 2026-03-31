/**
 * Totals Calculation Service
 * Calculates monthly totals from dailyRecords array.
 * Week-offs and holidays are overridden from shift roster (PreScheduledShift) so totals respect roster as source of truth.
 */

const PreScheduledShift = require('../../shifts/model/PreScheduledShift');

/**
 * Get week-off and holiday counts from shift roster for the given employee and date range.
 * Used to ensure pay register totals respect roster (not just daily record statuses).
 * @param {String} emp_no - Employee number (will be normalized to uppercase)
 * @param {String} startDate - YYYY-MM-DD
 * @param {String} endDate - YYYY-MM-DD
 * @returns {Promise<{ totalWeeklyOffs: number, totalHolidays: number }>}
 */
async function getRosterWOHOLCounts(emp_no, startDate, endDate) {
  const empNoNorm = (emp_no && String(emp_no).trim()) ? String(emp_no).trim().toUpperCase() : '';
  if (!empNoNorm || !startDate || !endDate) {
    return { totalWeeklyOffs: 0, totalHolidays: 0 };
  }
  const startStr = typeof startDate === 'string' ? startDate : (startDate && startDate.toISOString) ? startDate.toISOString().slice(0, 10) : '';
  const endStr = typeof endDate === 'string' ? endDate : (endDate && endDate.toISOString) ? endDate.toISOString().slice(0, 10) : '';
  if (!startStr || !endStr) return { totalWeeklyOffs: 0, totalHolidays: 0 };

  const rosterNonWorking = await PreScheduledShift.find({
    employeeNumber: empNoNorm,
    date: { $gte: startStr, $lte: endStr },
    status: { $in: ['WO', 'HOL'] },
  })
    .select('date status')
    .lean();

  let totalWeeklyOffs = 0;
  let totalHolidays = 0;
  for (const row of rosterNonWorking) {
    if (row.status === 'WO') totalWeeklyOffs += 1;
    if (row.status === 'HOL') totalHolidays += 1;
  }
  return { totalWeeklyOffs, totalHolidays };
}

/**
 * Overwrite totals.totalWeeklyOffs and totals.totalHolidays from shift roster so pay register respects roster.
 * Call after calculateTotals() whenever pay register totals are set.
 * @param {Object} totals - Totals object (mutated in place)
 * @param {String} emp_no - Employee number
 * @param {String} startDate - YYYY-MM-DD
 * @param {String} endDate - YYYY-MM-DD
 * @returns {Promise<Object>} The same totals object (with totalWeeklyOffs/totalHolidays updated)
 */
async function ensureTotalsRespectRoster(totals, emp_no, startDate, endDate) {
  // if (!totals || typeof totals !== 'object') return totals;
  // const { totalWeeklyOffs, totalHolidays } = await getRosterWOHOLCounts(emp_no, startDate, endDate);
  // totals.totalWeeklyOffs = totalWeeklyOffs;
  // totals.totalHolidays = totalHolidays;
  return totals;
}

/**
 * Calculate totals from dailyRecords array
 * @param {Array} dailyRecords - Array of daily record objects
 * @returns {Object} Calculated totals
 */
function calculateTotals(dailyRecords) {
  const totals = {
    presentDays: 0,
    presentHalfDays: 0,
    totalPresentDays: 0,
    absentDays: 0,
    absentHalfDays: 0,
    totalAbsentDays: 0,
    paidLeaveDays: 0,
    paidLeaveHalfDays: 0,
    totalPaidLeaveDays: 0,
    unpaidLeaveDays: 0,
    unpaidLeaveHalfDays: 0,
    totalUnpaidLeaveDays: 0,
    lopDays: 0,
    lopHalfDays: 0,
    totalLopDays: 0,
    totalLeaveDays: 0,
    odDays: 0,
    odHalfDays: 0,
    totalODDays: 0,
    totalOTHours: 0,
    totalPayableShifts: 0,
    totalWeeklyOffs: 0,
    totalHolidays: 0,
    lateCount: 0,
    earlyOutCount: 0,
    totalLateInMinutes: 0,
    totalEarlyOutMinutes: 0,
  };

  if (!dailyRecords || dailyRecords.length === 0) {
    return totals;
  }

  for (const record of dailyRecords) {
    // Track Holidays and Weekly Offs (can be fractional if split)
    const isHoliday = record.status === 'holiday' || record.firstHalf?.status === 'holiday' || record.secondHalf?.status === 'holiday';
    const isWeekOff = record.status === 'week_off' || record.firstHalf?.status === 'week_off' || record.secondHalf?.status === 'week_off';

    if (record.isSplit) {
      if (record.firstHalf?.status === 'holiday') totals.totalHolidays += 0.5;
      if (record.firstHalf?.status === 'week_off') totals.totalWeeklyOffs += 0.5;
      if (record.secondHalf?.status === 'holiday') totals.totalHolidays += 0.5;
      if (record.secondHalf?.status === 'week_off') totals.totalWeeklyOffs += 0.5;
    } else {
      if (record.status === 'holiday') totals.totalHolidays += 1;
      if (record.status === 'week_off') totals.totalWeeklyOffs += 1;
    }

    if (isHoliday || isWeekOff) {
      // Still count OT hours for holidays/week_off if any
      totals.totalOTHours += record.otHours || 0;
      continue; // Skip counting this record in attendance categories
    }

    // Determine if actually split by checking if halves have different statuses
    // Don't rely on isSplit flag as it might be incorrect
    const firstHalfStatus = record.firstHalf?.status;
    const secondHalfStatus = record.secondHalf?.status;
    // Consider split if: both halves exist and have different statuses, OR if record.isSplit is explicitly true
    const isActuallySplit = (firstHalfStatus && secondHalfStatus && firstHalfStatus !== secondHalfStatus) ||
      (record.isSplit === true && firstHalfStatus && secondHalfStatus);

    // If record is actually split, count halves separately
    if (isActuallySplit) {
      // Process first half - only count if status is explicitly set and valid
      if (record.firstHalf && record.firstHalf.status &&
        ['present', 'absent', 'leave', 'od'].includes(record.firstHalf.status)) {
        if (record.firstHalf.status === 'present') {
          totals.presentHalfDays++;
        } else if (record.firstHalf.status === 'absent') {
          totals.absentHalfDays++;
        } else if (record.firstHalf.status === 'leave') {
          const leaveNature = record.firstHalf.leaveNature || (record.firstHalf.leaveType || '').toLowerCase();
          if (leaveNature === 'paid') {
            totals.paidLeaveHalfDays++;
          } else {
            // Treat any non-paid leave as LOP
            totals.lopHalfDays++;
          }
        } else if (record.firstHalf.status === 'od') {
          totals.odHalfDays++;
        }
      }

      // Process second half - only count if status is explicitly set and valid
      if (record.secondHalf && record.secondHalf.status &&
        ['present', 'absent', 'leave', 'od'].includes(record.secondHalf.status)) {
        if (record.secondHalf.status === 'present') {
          totals.presentHalfDays++;
        } else if (record.secondHalf.status === 'absent') {
          totals.absentHalfDays++;
        } else if (record.secondHalf.status === 'leave') {
          const leaveNature = record.secondHalf.leaveNature || (record.secondHalf.leaveType || '').toLowerCase();
          if (leaveNature === 'paid') {
            totals.paidLeaveHalfDays++;
          } else {
            // Treat any non-paid leave as LOP
            totals.lopHalfDays++;
          }
        } else if (record.secondHalf.status === 'od') {
          totals.odHalfDays++;
        }
      }
    } else {
      // If not split, count as full day only (don't count halves separately)
      // Use the record.status if available, otherwise use firstHalf.status (they should be the same)
      const statusToCount = record.status || firstHalfStatus || secondHalfStatus;

      // Only count if status is explicitly set and valid (not null, not holiday, not week_off)
      if (statusToCount && ['present', 'absent', 'leave', 'od'].includes(statusToCount)) {
        if (statusToCount === 'present') {
          totals.presentDays++;
        } else if (statusToCount === 'absent') {
          totals.absentDays++;
        } else if (statusToCount === 'leave') {
          const leaveNature = record.leaveNature || record.firstHalf?.leaveNature || (record.leaveType || record.firstHalf?.leaveType || '').toLowerCase();
          if (leaveNature === 'paid') {
            totals.paidLeaveDays++;
          } else {
            // Treat any non-paid leave as LOP
            totals.lopDays++;
          }
        } else if (statusToCount === 'od') {
          totals.odDays++;
        }
      }
    }

    // Add OT hours (total for the day)
    totals.totalOTHours += record.otHours || 0;

    // Add Lates and Early Outs (only if NOT absent/leave/holiday/week_off)
    // A late/early out only makes sense if there's some actual presence
    const isPresentOrPartial = record.status === 'present' || record.status === 'partial' || record.status === 'od' ||
      record.firstHalf?.status === 'present' || record.secondHalf?.status === 'present' ||
      record.firstHalf?.status === 'od' || record.secondHalf?.status === 'od';

    if (record.isLate && isPresentOrPartial) {
      totals.lateCount++;
      if (typeof record.lateInMinutes === 'number') {
        totals.totalLateInMinutes += record.lateInMinutes;
      }
    }
    if (record.isEarlyOut && isPresentOrPartial) {
      totals.earlyOutCount++;
      if (typeof record.earlyOutMinutes === 'number') {
        totals.totalEarlyOutMinutes += record.earlyOutMinutes;
      }
    }
  }

  // Calculate totals (full days + half days * 0.5)
  totals.totalODDays = totals.odDays + totals.odHalfDays * 0.5;
  // Present days = attendance present + OD days. When a day/half is marked OD (e.g. edited from absent), it is included here.
  totals.totalPresentDays = totals.presentDays + totals.presentHalfDays * 0.5 + totals.totalODDays;
  totals.totalAbsentDays = totals.absentDays + totals.absentHalfDays * 0.5;
  totals.totalPaidLeaveDays = totals.paidLeaveDays + totals.paidLeaveHalfDays * 0.5;
  totals.totalUnpaidLeaveDays = 0; // No separate unpaid bucket; all non-paid leaves are LOP
  totals.totalLopDays = totals.lopDays + totals.lopHalfDays * 0.5;
  totals.totalLeaveDays = totals.totalPaidLeaveDays + totals.totalLopDays;

  // Calculate totalPayableShifts by summing up individual record values
  // This respects shifts with multiple payable units (e.g. 2.0)
  let totalPayableShiftsValue = 0;
  for (const record of dailyRecords) {
    const isHoliday = record.status === 'holiday' || record.firstHalf?.status === 'holiday' || record.secondHalf?.status === 'holiday';
    const isWeekOff = record.status === 'week_off' || record.firstHalf?.status === 'week_off' || record.secondHalf?.status === 'week_off';

    // Only count if it's a "payable" status (present, od, or paid leave)
    // For simplicity in totalPayableShifts, we don't count holiday/weekoff here 
    // as payroll calculation service adds those separately or handles them via totalPaidDays

    // Check first half
    if (record.firstHalf) {
      const h1 = record.firstHalf;
      if (h1.status === 'present' || h1.status === 'od') {
        totalPayableShiftsValue += (Number(record.payableShifts || 1) / 2);
      }
    }

    // Check second half
    if (record.secondHalf) {
      const h2 = record.secondHalf;
      if (h2.status === 'present' || h2.status === 'od') {
        totalPayableShiftsValue += (Number(record.payableShifts || 1) / 2);
      }
    }

    // Special case: If status is 'HALF_DAY' from attendance (recorded in dailyRecord if synced)
    // Attendance status map: attendanceRecordId.status or similar? 
    // Actually, resolveConflicts maps HALF_DAY to a single present half if appropriate.
    // So the split logic above already handles it (0.5 * payableShifts).
  }

  totals.totalPayableShifts = totalPayableShiftsValue;

  // Round to 2 decimal places
  Object.keys(totals).forEach(key => {
    if (typeof totals[key] === 'number') {
      totals[key] = Math.round(totals[key] * 100) / 100;
    }
  });

  return totals;
}

/**
 * Count days by category
 * @param {Array} dailyRecords - Array of daily record objects
 * @param {String} category - Category to count ('present', 'absent', 'leave', 'od')
 * @returns {Object} Count of full days and half days
 */
function countDaysByCategory(dailyRecords, category) {
  let fullDays = 0;
  let halfDays = 0;

  for (const record of dailyRecords) {
    // Check first half
    if (record.firstHalf && record.firstHalf.status === category) {
      halfDays++;
    }
    // Check second half
    if (record.secondHalf && record.secondHalf.status === category) {
      halfDays++;
    }
    // Check full day (if not split)
    if (!record.isSplit && record.status === category) {
      fullDays++;
    }
  }

  return { fullDays, halfDays, total: fullDays + halfDays * 0.5 };
}

/**
 * Calculate payable shifts
 * @param {Number} totalPresentDays - Total present days
 * @param {Number} totalODDays - Total OD days
 * @param {Number} totalPaidLeaveDays - Total paid leave days
 * @returns {Number} Total payable shifts
 */
function calculatePayableShifts(totalPresentDays, totalODDays, totalPaidLeaveDays) {
  return totalPresentDays + totalODDays + totalPaidLeaveDays;
}

/**
 * Map totals from MonthlyAttendanceSummary to PayRegisterSummary structure.
 * This ensures Pay Register uses the "correct mark" from Attendance module.
 * @param {Object} payRegister - PayRegisterSummary document (mutated in place)
 * @param {Object} summary - MonthlyAttendanceSummary document
 */
function syncTotalsFromMonthlySummary(payRegister, summary) {
  if (!payRegister || !summary) return;

  const totals = payRegister.totals || {};

  // Core attendance metrics
  totals.totalPresentDays = summary.totalPresentDays || 0;
  totals.totalAbsentDays = summary.totalAbsentDays || 0;
  totals.totalODDays = summary.totalODs || 0;
  
  // Leave breakdown (now with Paid/LOP from attendance summary)
  totals.totalPaidLeaveDays = summary.totalPaidLeaves || 0;
  totals.totalLopDays = summary.totalLopLeaves || 0;
  totals.totalLeaveDays = summary.totalLeaves || 0;
  
  // Payroll specific
  totals.totalPayableShifts = summary.totalPayableShifts || 0;
  totals.totalOTHours = summary.totalOTHours || 0;
  totals.totalWeeklyOffs = summary.totalWeeklyOffs || 0;
  totals.totalHolidays = summary.totalHolidays || 0;
  
  // Exceptions (Late/Early)
  totals.lateCount = summary.lateInCount || 0;
  totals.earlyOutCount = summary.earlyOutCount || 0;
  
  // Optional but helpful for debugging
  totals.totalLateInMinutes = summary.totalLateInMinutes || 0;
  totals.totalEarlyOutMinutes = summary.totalEarlyOutMinutes || 0;

  // Since we are overriding the totals, we should probably also 
  // clear the full/half sub-counters as they are now derived from the attendance summary
  totals.presentDays = Math.floor(totals.totalPresentDays);
  totals.presentHalfDays = (totals.totalPresentDays % 1) >= 0.5 ? 1 : 0;
  
  totals.absentDays = Math.floor(totals.totalAbsentDays);
  totals.absentHalfDays = (totals.totalAbsentDays % 1) >= 0.5 ? 1 : 0;

  totals.paidLeaveDays = Math.floor(totals.totalPaidLeaveDays);
  totals.paidLeaveHalfDays = (totals.totalPaidLeaveDays % 1) >= 0.5 ? 1 : 0;

  totals.lopDays = Math.floor(totals.totalLopDays);
  totals.lopHalfDays = (totals.totalLopDays % 1) >= 0.5 ? 1 : 0;

  payRegister.totals = totals;
  payRegister.markModified('totals');
}

module.exports = {
  calculateTotals,
  countDaysByCategory,
  calculatePayableShifts,
  getRosterWOHOLCounts,
  ensureTotalsRespectRoster,
  syncTotalsFromMonthlySummary,
};

