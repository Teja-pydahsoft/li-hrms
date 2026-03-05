const AttendanceDaily = require('../model/AttendanceDaily');
const Leave = require('../../leaves/model/Leave');
const OD = require('../../leaves/model/OD');
const MonthlyAttendanceSummary = require('../model/MonthlyAttendanceSummary');
const PreScheduledShift = require('../../shifts/model/PreScheduledShift');
const Shift = require('../../shifts/model/Shift');
const { createISTDate, extractISTComponents, getAllDatesInRange } = require('../../shared/utils/dateUtils');
const dateCycleService = require('../../leaves/services/dateCycleService');

/** Normalize to YYYY-MM-DD for reliable set membership (attendance date vs OD loop date) */
function toNormalizedDateStr(val) {
  if (!val) return '';
  if (val instanceof Date) return extractISTComponents(val).dateStr;
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return extractISTComponents(new Date(val)).dateStr;
}

/**
 * Monthly summary is recalculated in the background when:
 * - An AttendanceDaily doc is saved (post-save hook defers recalc via setImmediate)
 * - An AttendanceDaily doc is updated via findOneAndUpdate (post-hook, same defer)
 * - Leave/OD approved, OT applied, permissions, etc. (call recalculateOn* directly)
 * Summaries are not triggered by insertMany/bulk writes; missing summaries are
 * calculated on demand when loading the monthly attendance view.
 */

/**
 * Calculate and update monthly attendance summary for an employee
 * @param {string} employeeId - Employee ID
 * @param {string} emp_no - Employee number
 * @param {number} year - Year (e.g., 2024)
 * @param {number} monthNumber - Month number (1-12)
 * @param {{ startDateStr?: string, endDateStr?: string }} [periodOverride] - If set, use these bounds instead of resolving from anchor (ensures correct period when recalc is triggered by a specific date)
 * @returns {Promise<Object>} Updated summary
 */
async function calculateMonthlySummary(employeeId, emp_no, year, monthNumber, periodOverride) {
  try {
    console.log('[OD-FLOW] calculateMonthlySummary called', { employeeId: employeeId?.toString(), emp_no, year, monthNumber, periodOverride: !!periodOverride });
    // Get or create summary
    const summary = await MonthlyAttendanceSummary.getOrCreate(employeeId, emp_no, year, monthNumber);

    let startDateStr, endDateStr, payrollStart, payrollEnd, startComponents, endComponents;
    if (periodOverride && periodOverride.startDateStr && periodOverride.endDateStr) {
      startDateStr = periodOverride.startDateStr;
      endDateStr = periodOverride.endDateStr;
      payrollStart = createISTDate(startDateStr);
      payrollEnd = createISTDate(endDateStr);
      startComponents = extractISTComponents(payrollStart);
      endComponents = extractISTComponents(payrollEnd);
    } else {
      // Resolve the actual period window using payroll cycle (pay-cycle aware month).
      // Anchor must fall inside the period we want so we load the correct dailies.
      // - Calendar month (1-31): (year, monthNumber) = that month → anchor = 15th of that month.
      // - Custom cycle (e.g. 26-25, startDay >= 15): For month M we want the period that ENDS in M
      //   (e.g. February → 26 Jan–25 Feb). Using 15th of the current month as anchor gives that period.
      await dateCycleService.getPayrollCycleSettings(); // ensure settings loaded
      const anchorDateStr = `${year}-${String(monthNumber).padStart(2, '0')}-15`;
      const anchorDate = createISTDate(anchorDateStr);
      const periodInfo = await dateCycleService.getPeriodInfo(anchorDate);
      payrollStart = periodInfo.payrollCycle.startDate;
      payrollEnd = periodInfo.payrollCycle.endDate;
      startComponents = extractISTComponents(payrollStart);
      endComponents = extractISTComponents(payrollEnd);
      startDateStr = startComponents.dateStr;
      endDateStr = endComponents.dateStr;
    }
    const startDate = createISTDate(startDateStr);
    const endDate = createISTDate(endDateStr);

    // Month days = exact number of days in the pay period (fully respects pay cycle e.g. 25 Jan–26 Feb = 33 days)
    const periodDays = getAllDatesInRange(startDateStr, endDateStr).length;
    summary.totalDaysInMonth = Math.round(periodDays);

    // Normalize emp_no so we match AttendanceDaily.employeeNumber (schema uses uppercase)
    const empNoNorm = (emp_no && String(emp_no).trim()) ? String(emp_no).toUpperCase() : emp_no;

    // 1. Get all attendance records for this month (fresh from DB so we see latest status/payableShifts after OD updates)
    const attendanceRecords = await AttendanceDaily.find({
      employeeNumber: empNoNorm,
      date: {
        $gte: startDateStr,
        $lte: endDateStr,
      },
    })
      .select('date status shifts totalWorkingHours extraHours totalLateInMinutes totalEarlyOutMinutes payableShifts earlyOutDeduction')
      .populate('shifts.shiftId', 'payableShifts name')
      .lean();
    console.log('[OD-FLOW] calculateMonthlySummary loaded dailies', { emp_no: empNoNorm, period: `${startDateStr}..${endDateStr}`, count: attendanceRecords.length });

    // 2. Total week-offs and holidays in period from shift roster (source of truth).
    //    This avoids depending on whether AttendanceDaily statuses were synced/overridden.
    const rosterNonWorking = await PreScheduledShift.find({
      employeeNumber: empNoNorm,
      date: { $gte: startDateStr, $lte: endDateStr },
      status: { $in: ['WO', 'HOL'] },
    }).select('date status').lean();

    const weekOffDates = new Set();
    const holidayDates = new Set();
    const nonWorkingRosterDates = new Set();
    for (const row of rosterNonWorking) {
      const dateKey = toNormalizedDateStr(row?.date);
      if (!dateKey) continue;
      nonWorkingRosterDates.add(dateKey);
      if (row.status === 'WO') weekOffDates.add(dateKey);
      if (row.status === 'HOL') holidayDates.add(dateKey);
    }
    summary.totalWeeklyOffs = weekOffDates.size;
    summary.totalHolidays = holidayDates.size;

    // 3. Calculate total present days: only PRESENT (1) and HALF_DAY (0.5). PARTIAL/ABSENT do not count as present (clearer picture).
    let totalPresentDays = 0;
    for (const record of attendanceRecords) {
      const recordDate = toNormalizedDateStr(record.date);
      if (record.status === 'WEEK_OFF' || record.status === 'HOLIDAY' || nonWorkingRosterDates.has(recordDate)) continue;
      if (record.status === 'PRESENT') {
        totalPresentDays += 1;
      } else if (record.status === 'HALF_DAY') {
        totalPresentDays += 0.5;
      }
      // PARTIAL, ABSENT: do not add to present days
    }
    summary.totalPresentDays = Math.round(totalPresentDays * 10) / 10;

    // 4. Total payable shifts = sum of each day's payableShifts. Exclude WEEK_OFF and HOLIDAY — they do not contribute payable shifts.
    let totalPayableShifts = 0;
    for (const record of attendanceRecords) {
      const recordDate = toNormalizedDateStr(record.date);
      if (record.status === 'WEEK_OFF' || record.status === 'HOLIDAY' || nonWorkingRosterDates.has(recordDate)) continue;
      let dayPayable = Number(record.payableShifts ?? 0);
      if (dayPayable === 0 && Array.isArray(record.shifts) && record.shifts.length > 0) {
        dayPayable = record.shifts.reduce((sum, s) => sum + (Number(s.payableShift) || 0), 0);
      }
      totalPayableShifts += dayPayable;
    }

    // 4. Get approved leaves for this month (Using .lean() and projections)
    const approvedLeaves = await Leave.find({
      employeeId,
      status: 'approved',
      $or: [
        {
          fromDate: { $lte: endDate },
          toDate: { $gte: startDate },
        },
      ],
      isActive: true,
    }).select('fromDate toDate isHalfDay').lean();

    // Total leave days: only days in this period; each calendar day counted once (overlapping leaves must not double-count)
    const leaveDaysInPeriod = new Map(); // dateStr -> contribution (0.5 or 1)
    for (const leave of approvedLeaves) {
      const leaveStart = createISTDate(extractISTComponents(leave.fromDate).dateStr, '00:00');
      const leaveEnd = createISTDate(extractISTComponents(leave.toDate).dateStr, '23:59');
      const contrib = leave.isHalfDay ? 0.5 : 1;

      let currentDate = new Date(leaveStart);
      while (currentDate <= leaveEnd) {
        const dayStr = toNormalizedDateStr(currentDate);
        if (dayStr >= startDateStr && dayStr <= endDateStr) {
          const existing = leaveDaysInPeriod.get(dayStr) || 0;
          leaveDaysInPeriod.set(dayStr, Math.max(existing, contrib));
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }
    const totalLeaveDays = Array.from(leaveDaysInPeriod.values()).reduce((s, c) => s + c, 0);
    summary.totalLeaves = Math.round(totalLeaveDays * 10) / 10; // Round to 1 decimal

    // 5. Get approved ODs for this month (Using .lean() and projections)
    const approvedODs = await OD.find({
      employeeId,
      status: 'approved',
      $or: [
        {
          fromDate: { $lte: endDate },
          toDate: { $gte: startDate },
        },
      ],
      isActive: true,
    }).select('fromDate toDate isHalfDay odType_extended').lean();

    // Total OD days: only days in this period; each calendar day counted once (overlapping ODs must not double-count)
    const odDaysInPeriod = new Map(); // dateStr -> contribution (0.5 or 1)
    for (const od of approvedODs) {
      if (od.odType_extended === 'hours') continue;

      const odStart = createISTDate(extractISTComponents(od.fromDate).dateStr, '00:00');
      const odEnd = createISTDate(extractISTComponents(od.toDate).dateStr, '23:59');
      const contrib = od.isHalfDay ? 0.5 : 1;

      let currentDate = new Date(odStart);
      while (currentDate <= odEnd) {
        const dayStr = toNormalizedDateStr(currentDate);
        if (dayStr >= startDateStr && dayStr <= endDateStr) {
          const existing = odDaysInPeriod.get(dayStr) || 0;
          odDaysInPeriod.set(dayStr, Math.max(existing, contrib));
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }
    const totalODDays = Array.from(odDaysInPeriod.values()).reduce((s, c) => s + c, 0);
    summary.totalODs = Math.round(totalODDays * 10) / 10; // Round to 1 decimal

    // 6. Total payable shifts: add half-day (0.5) / full-day (1) OD for days with no attendance record
    const datesWithAttendance = new Set((attendanceRecords || []).map(r => toNormalizedDateStr(r.date)));
    let odOnlyPresentDays = 0;
    for (const od of approvedODs || []) {
      if (od.odType_extended === 'hours') continue;
      const contrib = od.isHalfDay ? 0.5 : 1;
      let d = new Date(extractISTComponents(od.fromDate).dateStr + 'T12:00:00Z');
      const odEnd = new Date(extractISTComponents(od.toDate).dateStr + 'T12:00:00Z');
      while (d <= odEnd) {
        const dateStr = toNormalizedDateStr(d);
        if (dateStr >= startDateStr && dateStr <= endDateStr && !datesWithAttendance.has(dateStr)) {
          totalPayableShifts += contrib;
          odOnlyPresentDays += contrib;
        }
        d.setDate(d.getDate() + 1);
      }
    }
    // Present days = attendance (PRESENT + HALF_DAY only) + all OD days (so OD is included in present days)
    summary.totalPresentDays = Math.round((totalPresentDays + summary.totalODs) * 10) / 10;
    summary.totalPayableShifts = Math.round(totalPayableShifts * 100) / 100; // Round to 2 decimals
    console.log('[OD-FLOW] calculateMonthlySummary totals (from dailies + OD-only)', {
      emp_no,
      period: `${startDateStr}..${endDateStr}`,
      totalPresentDays: summary.totalPresentDays,
      totalPayableShifts: summary.totalPayableShifts,
      odOnlyPresentDays,
    });

    // 7. Calculate total OT hours (from approved OT requests)
    const OT = require('../../overtime/model/OT');
    const approvedOTs = await OT.find({
      employeeId,
      status: 'approved',
      date: { $gte: startDateStr, $lte: endDateStr },
      isActive: true,
    }).select('otHours').lean();

    let totalOTHours = 0;
    for (const ot of approvedOTs) {
      totalOTHours += ot.otHours || 0;
    }
    summary.totalOTHours = Math.round(totalOTHours * 100) / 100; // Round to 2 decimals

    // 8. Calculate total extra hours (from attendance records)
    let totalExtraHours = 0;
    for (const record of attendanceRecords) {
      totalExtraHours += record.extraHours || 0;
    }
    summary.totalExtraHours = Math.round(totalExtraHours * 100) / 100; // Round to 2 decimals

    // 9. Calculate total permission hours and count
    const Permission = require('../../permissions/model/Permission');
    const approvedPermissions = await Permission.find({
      employeeId,
      status: 'approved',
      date: { $gte: startDateStr, $lte: endDateStr },
      isActive: true,
    }).select('permissionHours').lean();

    let totalPermissionHours = 0;
    let totalPermissionCount = 0;
    for (const permission of approvedPermissions) {
      totalPermissionHours += permission.permissionHours || 0;
      totalPermissionCount += 1;
    }
    summary.totalPermissionHours = Math.round(totalPermissionHours * 100) / 100; // Round to 2 decimals
    summary.totalPermissionCount = totalPermissionCount;

    // 10. Calculate late-in — only on PRESENT days (same as early-out: exclude HALF_DAY, PARTIAL)
    let totalLateInMinutes = 0;
    let lateInCount = 0;
    const isPresentDay = (record) => record.status === 'PRESENT';

    for (const record of attendanceRecords) {
      if (!isPresentDay(record)) continue;

      const shifts = Array.isArray(record.shifts) ? record.shifts : [];
      let dayLateMinutes = 0;

      if (shifts.length > 0) {
        for (const s of shifts) {
          if (s.lateInMinutes != null && s.lateInMinutes > 0) {
            dayLateMinutes += Number(s.lateInMinutes);
          }
        }
      } else {
        dayLateMinutes = Number(record.totalLateInMinutes) || 0;
      }

      if (dayLateMinutes > 0) {
        totalLateInMinutes += dayLateMinutes;
        lateInCount += 1;
      }
    }

    summary.totalLateInMinutes = Math.round(totalLateInMinutes * 100) / 100;
    summary.lateInCount = lateInCount;

    // 11. Calculate early-out metrics from AttendanceDaily only (PRESENT days in payroll period).
    // This avoids calendar-month drift and keeps summary fully period-based.
    let totalEarlyOutMinutes = 0;
    let totalEarlyOutDeductionDays = 0;
    let totalEarlyOutDeductionAmount = 0;
    let earlyOutCount = 0;
    const earlyOutDeductionBreakdown = {
      quarter_day: 0,
      half_day: 0,
      full_day: 0,
      custom_amount: 0,
    };

    for (const record of attendanceRecords) {
      if (record.status !== 'PRESENT') continue;

      const shifts = Array.isArray(record.shifts) ? record.shifts : [];
      let dayEarlyOut = 0;
      if (shifts.length > 0) {
        for (const s of shifts) {
          if (s.earlyOutMinutes != null && s.earlyOutMinutes > 0) {
            dayEarlyOut += Number(s.earlyOutMinutes);
          }
        }
      } else {
        dayEarlyOut = Number(record.totalEarlyOutMinutes) || 0;
      }

      if (dayEarlyOut > 0) {
        totalEarlyOutMinutes += dayEarlyOut;
        earlyOutCount += 1;
      }

      const deduction = record.earlyOutDeduction || null;
      if (deduction && deduction.deductionApplied) {
        const deductionDays = Number(deduction.deductionDays) || 0;
        const deductionAmount = Number(deduction.deductionAmount) || 0;
        const deductionType = deduction.deductionType || null;

        if (deductionDays > 0) {
          totalEarlyOutDeductionDays += deductionDays;
          if (deductionType && earlyOutDeductionBreakdown[deductionType] !== undefined) {
            earlyOutDeductionBreakdown[deductionType] += deductionDays;
          }
        }
        if (deductionAmount > 0) {
          totalEarlyOutDeductionAmount += deductionAmount;
          // Existing summary semantics store custom amount totals in custom_amount bucket.
          earlyOutDeductionBreakdown.custom_amount += deductionAmount;
        }
      }
    }

    summary.totalEarlyOutMinutes = Math.round(totalEarlyOutMinutes * 100) / 100;
    summary.totalEarlyOutDeductionDays = Math.round(totalEarlyOutDeductionDays * 100) / 100;
    summary.totalEarlyOutDeductionAmount = Math.round(totalEarlyOutDeductionAmount * 100) / 100;
    summary.earlyOutDeductionBreakdown = {
      quarter_day: Math.round(earlyOutDeductionBreakdown.quarter_day * 100) / 100,
      half_day: Math.round(earlyOutDeductionBreakdown.half_day * 100) / 100,
      full_day: Math.round(earlyOutDeductionBreakdown.full_day * 100) / 100,
      custom_amount: Math.round(earlyOutDeductionBreakdown.custom_amount * 100) / 100,
    };
    summary.earlyOutCount = earlyOutCount;

    // Late-or-early = sum of late-in + early-out (clear, no double-meaning)
    summary.totalLateOrEarlyMinutes = Math.round((summary.totalLateInMinutes + summary.totalEarlyOutMinutes) * 100) / 100;
    summary.lateOrEarlyCount = summary.lateInCount + summary.earlyOutCount;

    // 12. Update last calculated timestamp
    summary.lastCalculatedAt = new Date();

    // 13. Save summary
    await summary.save();
    console.log('[OD-FLOW] calculateMonthlySummary saved', { emp_no, month: summary.month });

    return summary;
  } catch (error) {
    console.error(`Error calculating monthly summary for employee ${emp_no}, month ${year}-${monthNumber}:`, error);
    throw error;
  }
}

/**
 * Calculate monthly summary for all employees for a specific month
 * @param {number} year - Year
 * @param {number} monthNumber - Month number (1-12)
 * @returns {Promise<Array>} Array of updated summaries
 */
async function calculateAllEmployeesSummary(year, monthNumber) {
  try {
    const Employee = require('../../employees/model/Employee');
    const employees = await Employee.find({ is_active: { $ne: false } }).select('_id emp_no');

    const results = [];
    for (const employee of employees) {
      try {
        const summary = await calculateMonthlySummary(
          employee._id,
          employee.emp_no,
          year,
          monthNumber
        );
        results.push({ employee: employee.emp_no, success: true, summary });
      } catch (error) {
        console.error(`Error calculating summary for employee ${employee.emp_no}:`, error);
        results.push({ employee: employee.emp_no, success: false, error: error.message });
      }
    }

    return results;
  } catch (error) {
    console.error(`Error calculating all employees summary for ${year}-${monthNumber}:`, error);
    throw error;
  }
}

/**
 * Recalculate summary when attendance is updated
 * @param {string} emp_no - Employee number
 * @param {string} date - Date in YYYY-MM-DD format
 */
async function recalculateOnAttendanceUpdate(emp_no, date) {
  try {
    console.log('[OD-FLOW] recalculateOnAttendanceUpdate called', { emp_no, date });
    const Employee = require('../../employees/model/Employee');
    const empNoNorm = (emp_no && String(emp_no).trim()) ? String(emp_no).toUpperCase() : emp_no;
    const employee = await Employee.findOne({ emp_no: empNoNorm });

    if (!employee) {
      console.warn(`[OD-FLOW] Employee not found for emp_no: ${emp_no}`);
      return;
    }

    // Use payroll cycle for this specific attendance date (pay-cycle aware month)
    const baseDate = typeof date === 'string' ? createISTDate(date) : date;
    const periodInfo = await dateCycleService.getPeriodInfo(baseDate);
    const { year, month: monthNumber, startDate, endDate } = periodInfo.payrollCycle;
    const startDateStr = extractISTComponents(startDate).dateStr;
    const endDateStr = extractISTComponents(endDate).dateStr;
    console.log('[OD-FLOW] recalculateOnAttendanceUpdate period', { year, monthNumber, startDateStr, endDateStr });

    // Pass period so we always aggregate the exact cycle that contains this date (avoids anchor mismatch)
    await calculateMonthlySummary(employee._id, empNoNorm, year, monthNumber, { startDateStr, endDateStr });
    console.log('[OD-FLOW] recalculateOnAttendanceUpdate done for', emp_no, date);
  } catch (error) {
    console.error(`Error recalculating summary on attendance update for ${emp_no}, ${date}:`, error);
    // Don't throw - this is a background operation
  }
}

/**
 * Recalculate monthly summary when leave is approved
 * @param {Object} leave - Leave document
 */
async function recalculateOnLeaveApproval(leave) {
  try {
    if (!leave.employeeId || !leave.fromDate || !leave.toDate) {
      return;
    }

    const Employee = require('../../employees/model/Employee');
    const employee = await Employee.findById(leave.employeeId);
    if (!employee) {
      console.warn(`Employee not found for leave: ${leave._id}`);
      return;
    }

    // Calculate all payroll cycles affected by this leave using payroll-aware periods
    const { payrollCycle: startCycle } = await dateCycleService.getPeriodInfo(leave.fromDate);
    const { payrollCycle: endCycle } = await dateCycleService.getPeriodInfo(leave.toDate);

    let currentYear = startCycle.year;
    let currentMonth = startCycle.month;

    while (currentYear < endCycle.year || (currentYear === endCycle.year && currentMonth <= endCycle.month)) {
      await calculateMonthlySummary(employee._id, employee.emp_no, currentYear, currentMonth);

      // Move to next payroll month
      if (currentMonth === 12) {
        currentMonth = 1;
        currentYear += 1;
      } else {
        currentMonth += 1;
      }
    }
  } catch (error) {
    console.error(`Error recalculating summary on leave approval for leave ${leave._id}:`, error);
    // Don't throw - this is a background operation
  }
}

/**
 * Recalculate monthly summary when OD is approved
 * @param {Object} od - OD document
 */
async function recalculateOnODApproval(od) {
  try {
    console.log('[OD-FLOW] recalculateOnODApproval (OD model post-save)', { odId: od._id?.toString(), odType_extended: od.odType_extended });
    if (!od.employeeId || !od.fromDate || !od.toDate) {
      console.log('[OD-FLOW] recalculateOnODApproval skip: missing employeeId/fromDate/toDate');
      return;
    }

    const Employee = require('../../employees/model/Employee');
    const AttendanceDaily = require('../model/AttendanceDaily');
    const employee = await Employee.findById(od.employeeId);
    if (!employee) {
      console.warn(`Employee not found for OD: ${od._id}`);
      return;
    }

    const empNo = (od.emp_no || employee.emp_no || '').toUpperCase();
    if (!empNo) return;

    const fromStr = extractISTComponents(od.fromDate).dateStr;
    const toStr = extractISTComponents(od.toDate).dateStr;

    // Touch AttendanceDaily for hour-based OD (create/ensure daily) and for half-day OD (re-save existing dailies so pre-save runs and applies half-vs-punches logic).
    if (od.odType_extended === 'hours') {
      console.log('[OD-FLOW] recalculateOnODApproval: touching dailies (hour-based)');
      let d = new Date(fromStr);
      const toDate = new Date(toStr);
      while (d <= toDate) {
        const dateStr = extractISTComponents(d).dateStr;
        let daily = await AttendanceDaily.findOne({ employeeNumber: empNo, date: dateStr });
        if (!daily) {
          daily = new AttendanceDaily({ employeeNumber: empNo, date: dateStr, shifts: [] });
        }
        await daily.save();
        d.setDate(d.getDate() + 1);
      }
    } else if (od.odType_extended === 'half_day' || od.isHalfDay) {
      console.log('[OD-FLOW] recalculateOnODApproval: re-saving dailies for half-day OD (so half-vs-punches is applied)');
      let d = new Date(fromStr);
      const toDate = new Date(toStr);
      while (d <= toDate) {
        const dateStr = extractISTComponents(d).dateStr;
        const daily = await AttendanceDaily.findOne({ employeeNumber: empNo, date: dateStr });
        if (daily) {
          await daily.save();
        } else {
          const newDaily = new AttendanceDaily({ employeeNumber: empNo, date: dateStr, shifts: [] });
          await newDaily.save();
        }
        d.setDate(d.getDate() + 1);
      }
    }
    // Full-day OD: no daily create/update; contribution is added in monthly summary OD-only logic.

    // Recalculate monthly summaries for affected payroll cycles (half/full-day OD contribute 0.5/1 via OD-only logic in calculateMonthlySummary)
    const { payrollCycle: startCycle } = await dateCycleService.getPeriodInfo(od.fromDate);
    const { payrollCycle: endCycle } = await dateCycleService.getPeriodInfo(od.toDate);
    let currentYear = startCycle.year;
    let currentMonth = startCycle.month;

    console.log('[OD-FLOW] recalculateOnODApproval: recalc summary for cycles', { startCycle: `${startCycle.year}-${startCycle.month}`, endCycle: `${endCycle.year}-${endCycle.month}` });
    while (currentYear < endCycle.year || (currentYear === endCycle.year && currentMonth <= endCycle.month)) {
      await calculateMonthlySummary(employee._id, employee.emp_no, currentYear, currentMonth);
      if (currentMonth === 12) {
        currentMonth = 1;
        currentYear += 1;
      } else {
        currentMonth += 1;
      }
    }
    console.log('[OD-FLOW] recalculateOnODApproval done');
  } catch (error) {
    console.error(`Error recalculating summary on OD approval for OD ${od._id}:`, error);
  }
}

/**
 * Delete monthly attendance summaries (for a given month or all).
 * Use before full recalc to ensure clean state.
 * @param {{ year?: number, monthNumber?: number }} [options] - If both provided, delete only that month; otherwise delete all.
 * @returns {Promise<{ deletedCount: number }>}
 */
async function deleteAllMonthlySummaries(options = {}) {
  const { year, monthNumber } = options;
  let query = {};
  if (year != null && monthNumber != null) {
    const monthStr = `${year}-${String(monthNumber).padStart(2, '0')}`;
    query.month = monthStr;
  }
  const result = await MonthlyAttendanceSummary.deleteMany(query);
  console.log('[summaryCalculationService] deleteAllMonthlySummaries', { query, deletedCount: result.deletedCount });
  return { deletedCount: result.deletedCount };
}

module.exports = {
  calculateMonthlySummary,
  calculateAllEmployeesSummary,
  recalculateOnAttendanceUpdate,
  recalculateOnLeaveApproval,
  recalculateOnODApproval,
  deleteAllMonthlySummaries,
};

