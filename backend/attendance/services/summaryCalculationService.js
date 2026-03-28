const AttendanceDaily = require('../model/AttendanceDaily');
const Leave = require('../../leaves/model/Leave');
const LeaveSplit = require('../../leaves/model/LeaveSplit');
const OD = require('../../leaves/model/OD');
const MonthlyAttendanceSummary = require('../model/MonthlyAttendanceSummary');
const PreScheduledShift = require('../../shifts/model/PreScheduledShift');
const Shift = require('../../shifts/model/Shift');
const { createISTDate, extractISTComponents, getAllDatesInRange } = require('../../shared/utils/dateUtils');
const dateCycleService = require('../../leaves/services/dateCycleService');
const Employee = require('../../employees/model/Employee');
const deductionService = require('../../payroll/services/deductionService');
const { getAbsentDeductionSettings } = require('../../payroll/services/allowanceDeductionResolverService');

function defaultAttendancePolicyDeductionBreakdown() {
  return {
    lateInsCount: 0,
    earlyOutsCount: 0,
    combinedCount: 0,
    freeAllowedPerMonth: 0,
    effectiveCount: 0,
    daysDeducted: 0,
    lateEarlyDaysDeducted: 0,
    absentExtraDays: 0,
    absentDays: 0,
    lopDaysPerAbsent: null,
    deductionType: null,
    calculationMode: null,
  };
}

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
    // IMPORTANT: endDate must be inclusive until end-of-day IST.
    // If we use 00:00 for endDate, Date comparisons ($lte) can drop leaves/splits
    // that occur later on the last day due to UTC storage offsets.
    const startDate = createISTDate(startDateStr, '00:00');
    const endDate = createISTDate(endDateStr, '23:59');

    // Month days = exact number of days in the pay period (fully respects pay cycle e.g. 25 Jan–26 Feb = 33 days)
    const periodDays = getAllDatesInRange(startDateStr, endDateStr).length;
    summary.totalDaysInMonth = Math.round(periodDays);
    const todayIstStr = extractISTComponents(new Date()).dateStr;

    // Initialize contributing dates tracker
    const contributingDates = {
      present: [],
      leaves: [],
      ods: [],
      weeklyOffs: [],
      holidays: [],
      payableShifts: [],
      otHours: [],
      extraHours: [],
      lateIn: [],
      earlyOut: [],
      permissions: [],
      absent: [],
    };

    // Normalize emp_no so we match AttendanceDaily.employeeNumber (schema uses uppercase)
    const empNoNorm = (emp_no && String(emp_no).trim()) ? String(emp_no).toUpperCase() : emp_no;

    // 0. Fetch employee joining/resignation dates to respect boundaries
    const employeeInfoForBoundaries = await Employee.findById(employeeId).select('doj leftDate').lean();
    const dojStrBound = employeeInfoForBoundaries?.doj ? extractISTComponents(employeeInfoForBoundaries.doj).dateStr : null;
    const leftDateStrBound = employeeInfoForBoundaries?.leftDate ? extractISTComponents(employeeInfoForBoundaries.leftDate).dateStr : null;

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

    // --- DAILY MERGE ENGINE ---
    const dailyStatsMap = new Map();
    const allDates = getAllDatesInRange(startDateStr, endDateStr);
    for (const dStr of allDates) {
      dailyStatsMap.set(dStr, {
        date: dStr,
        attendance: null,
        ods: [],
        leaves: [],
        isWO: false, // Will be set from rosterNonWorking
        isHOL: false, // Will be set from rosterNonWorking
        // Results for this day
        present: 0,
        payable: 0,
        lateIn: 0,
        earlyOut: 0,
        lateInWaved: false,
        earlyOutWaved: false,
        isExtra: false,
      });
    }

    // 2. Total week-offs and holidays in period from shift roster (source of truth).
    //    This avoids depending on whether AttendanceDaily statuses were synced/overridden.
    const rosterNonWorking = await PreScheduledShift.find({
      employeeNumber: empNoNorm,
      date: { $gte: startDateStr, $lte: endDateStr },
      status: { $in: ['WO', 'HOL'] },
    }).select('date status').lean();

    const weekOffDates = new Set();
    const holidayDates = new Set();
    for (const row of rosterNonWorking) {
      const dateKey = toNormalizedDateStr(row?.date);
      if (!dateKey) continue;
      if (dailyStatsMap.has(dateKey)) {
        if (row.status === 'WO') {
          dailyStatsMap.get(dateKey).isWO = true;
          weekOffDates.add(dateKey);
        }
        if (row.status === 'HOL') {
          dailyStatsMap.get(dateKey).isHOL = true;
          holidayDates.add(dateKey);
        }
      }
    }
    summary.totalWeeklyOffs = weekOffDates.size;
    summary.totalHolidays = holidayDates.size;
    contributingDates.weeklyOffs = Array.from(weekOffDates).map(date => ({ date, value: 1, label: 'WO' }));
    contributingDates.holidays = Array.from(holidayDates).map(date => ({ date, value: 1, label: 'HOL' }));

    // 4. Get approved leaves for this month (Using .lean() and projections)
    const approvedLeaves = await Leave.find({
      employeeId,
      status: 'approved',
      // Do NOT count split leaves here; they are handled day-by-day via LeaveSplit.
      splitStatus: { $in: [null, ''] },
      $or: [
        {
          fromDate: { $lte: endDate },
          toDate: { $gte: startDate },
        },
      ],
      isActive: true,
    }).select('fromDate toDate isHalfDay halfDayType leaveType leaveNature numberOfDays').lean();

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
    }).select('fromDate toDate isHalfDay odType_extended halfDayType').lean(); // Added halfDayType

    // 4b. Get approved split leaves for this period (so leave totals are correct)
    const approvedLeaveSplits = await LeaveSplit.find({
      employeeId,
      status: 'approved',
      date: { $gte: startDate, $lte: endDate },
    }).select('date isHalfDay halfDayType numberOfDays leaveType leaveNature').lean();

    // Fill map from DB results
    for (const rec of attendanceRecords) {
      const dStr = toNormalizedDateStr(rec.date);
      if (dailyStatsMap.has(dStr)) {
        dailyStatsMap.get(dStr).attendance = rec;
      }
    }
    for (const od of approvedODs) {
      if (od.odType_extended === 'hours') continue;
      const start = toNormalizedDateStr(od.fromDate);
      const end = toNormalizedDateStr(od.toDate);
      const range = getAllDatesInRange(start, end);
      for (const dStr of range) {
        if (dailyStatsMap.has(dStr)) {
          dailyStatsMap.get(dStr).ods.push(od);
        }
      }
    }
    for (const lv of approvedLeaves) {
      const start = toNormalizedDateStr(lv.fromDate);
      const end = toNormalizedDateStr(lv.toDate);
      const range = getAllDatesInRange(start, end);
      for (const dStr of range) {
        if (dailyStatsMap.has(dStr)) {
          dailyStatsMap.get(dStr).leaves.push(lv);
        }
      }
    }

    for (const split of approvedLeaveSplits) {
      const dStr = toNormalizedDateStr(split.date);
      const day = dailyStatsMap.get(dStr);
      if (!day) continue;
      day.leaves.push({
        // Keep the minimal shape used below (isHalfDay + leaveType).
        isHalfDay: split.isHalfDay,
        numberOfDays: split.numberOfDays,
        leaveType: split.leaveType,
        leaveNature: split.leaveNature,
      });
    }

    // Process each day
    let totalPresentDays = 0;
    let totalPayableShifts = 0;
    let totalLateInMinutes = 0;
    let lateInCount = 0;
    let totalEarlyOutMinutes = 0;
    let earlyOutCount = 0;
    let totalLeaveDays = 0;
    let totalODDays = 0;

    for (const [dStr, day] of dailyStatsMap) {
      // 1. Leaves (Priority - if leave is taken, it counts as leave)
      if (day.leaves.length > 0) {
        // Sum all leave units on the same date (multiple 0.5 leaves can make 1.0)
        // and cap to 1.0 day because payroll works per-day (or per-half) capacity.
        const leaveContribRaw = day.leaves.reduce((sum, l) => {
          if (typeof l.numberOfDays === 'number') return sum + l.numberOfDays;
          return sum + (l.isHalfDay ? 0.5 : 1);
        }, 0);
        const leaveContrib = Math.min(1, leaveContribRaw);
        const firstLeave = day.leaves[0];
        if (!contributingDates.leaves.some(cd => cd.date === dStr)) {
          contributingDates.leaves.push({
            date: dStr,
            value: leaveContrib,
            label: `${firstLeave.leaveType || 'L'} (${leaveContrib})`
          });
        }
        totalLeaveDays += leaveContrib;
      }

      // 2. ODs & Attendance Merge (Half-Aware)
      let attFirst = 0, attSecond = 0;
      let odFirst = 0, odSecond = 0;

      // Base from Attendance
      if (day.attendance && !day.isWO && !day.isHOL) {
        const status = day.attendance.status;
        if (status === 'PRESENT') {
          attFirst = 0.5; attSecond = 0.5;
        } else if (status === 'HALF_DAY') {
          // Detect which half was worked based on which penalty is higher.
          const eo = Number(day.attendance.totalEarlyOutMinutes) || 0;
          const li = Number(day.attendance.totalLateInMinutes) || 0;
          if (eo > li) attFirst = 0.5;
          else if (li > eo) attSecond = 0.5;
          else attFirst = 0.5; // Default to first half if we can't tell
        }
        // PARTIAL/ABSENT: base is 0.0 per user request
      }

      // Overlay ODs
      if (day.ods.length > 0 && !day.isWO && !day.isHOL) {
        for (const od of day.ods) {
          if (!od.isHalfDay || od.odType_extended === 'full_day') {
            odFirst = 0.5; odSecond = 0.5;
            day.lateInWaved = true;
            day.earlyOutWaved = true;
          } else if (od.halfDayType === 'first_half') {
            odFirst = 0.5;
            day.lateInWaved = true;
          } else if (od.halfDayType === 'second_half') {
            odSecond = 0.5;
            day.earlyOutWaved = true;
          } else {
            odFirst = 0.5; // Default half-day OD to first half
            day.lateInWaved = true;
          }
        }
        if (!contributingDates.ods.some(cd => cd.date === dStr)) {
          contributingDates.ods.push({ date: dStr, value: odFirst + odSecond, label: 'OD' });
        }
        totalODDays += (odFirst + odSecond);
      }

      // Merge and Cap - this handles PARTIAL + OD correctly (0.0 + 0.5 = 0.5)
      const dayFirst = attFirst;
      const daySecond = attSecond;
      const dayPresent = Math.min(dayFirst + daySecond, 1.0);
      // Use AttendanceDaily payables as source of truth for aggregation.
      // Prefer the higher of:
      // - attendance.payableShifts (aggregated daily value)
      // - sum of shift-level payableShift (multi-shift granular value)
      // Fallback to merged half-day logic when neither is available.
      let dayPayable = dayPresent;
      if (day.attendance && !day.isWO && !day.isHOL) {
        const attendancePayable = Number(day.attendance.payableShifts);
        const shifts = Array.isArray(day.attendance.shifts) ? day.attendance.shifts : [];
        const shiftLevelPayable = shifts.reduce((sum, s) => sum + (Number(s?.payableShift) || 0), 0);
        const candidates = [dayPresent];
        if (Number.isFinite(attendancePayable) && attendancePayable >= 0) candidates.push(attendancePayable);
        if (Number.isFinite(shiftLevelPayable) && shiftLevelPayable >= 0) candidates.push(shiftLevelPayable);
        dayPayable = Math.round(Math.max(...candidates) * 100) / 100;
      }

      if (dayPresent > 0 || dayPayable > 0) {
        totalPresentDays += dayPresent;
        if (!contributingDates.present.some(cd => cd.date === dStr)) {
          contributingDates.present.push({ date: dStr, value: dayPresent, label: 'P' });
        }
        if (!contributingDates.payableShifts.some(cd => cd.date === dStr)) {
          contributingDates.payableShifts.push({ date: dStr, value: dayPayable, label: 'Pay' });
        }
        totalPayableShifts += dayPayable;
      }

      // Absent = each working-day half not covered by leave, OD, or attendance (present / worked half).
      // Examples: half-day leave + no other credit → 0.5 absent; half-day OD + no attendance on other half → 0.5 absent.
      if (!day.isWO && !day.isHOL && dStr <= todayIstStr) {
        // Boundary Check: If date is before joining or after resignation, it's not "Absent"
        if (dojStrBound && dStr < dojStrBound) continue;
        if (leftDateStrBound && dStr > leftDateStrBound) continue;

        let leaveFirst = 0;
        let leaveSecond = 0;
        for (const l of day.leaves) {
          if (l.isHalfDay) {
            if (l.halfDayType === 'second_half') leaveSecond = Math.max(leaveSecond, 0.5);
            else leaveFirst = Math.max(leaveFirst, 0.5);
            continue;
          }
          const nd = typeof l.numberOfDays === 'number' ? l.numberOfDays : null;
          if (nd != null && nd >= 1) {
            leaveFirst = 0.5;
            leaveSecond = 0.5;
          } else if (nd != null && nd > 0 && nd < 1) {
            if (l.halfDayType === 'second_half') leaveSecond = Math.max(leaveSecond, 0.5);
            else leaveFirst = Math.max(leaveFirst, 0.5);
          } else {
            leaveFirst = 0.5;
            leaveSecond = 0.5;
          }
        }

        const mergedFirst = Math.max(attFirst, odFirst, leaveFirst);
        const mergedSecond = Math.max(attSecond, odSecond, leaveSecond);
        const dayCovered = Math.min(mergedFirst + mergedSecond, 1.0);
        const absentPortion = Math.round(Math.max(0, 1.0 - dayCovered) * 100) / 100;

        if (absentPortion > 0 && !contributingDates.absent.some(cd => cd.date === dStr)) {
          contributingDates.absent.push({ date: dStr, value: absentPortion, label: '' });
        }
      }

      // 3. Lates & Early Outs (only on PRESENT days)
      if (day.attendance && day.attendance.status === 'PRESENT' && !day.isWO && !day.isHOL) {
        const shifts = Array.isArray(day.attendance.shifts) ? day.attendance.shifts : [];

        // Late In
        let dayLateMin = (shifts.length > 0)
          ? shifts.reduce((sum, s) => sum + (Number(s.lateInMinutes) || 0), 0)
          : (Number(day.attendance.totalLateInMinutes) || 0);

        if (dayLateMin > 0 && !day.lateInWaved) {
          totalLateInMinutes += dayLateMin;
          lateInCount++;
        }

        // Early Out
        let dayEarlyMin = (shifts.length > 0)
          ? shifts.reduce((sum, s) => sum + (Number(s.earlyOutMinutes) || 0), 0)
          : (Number(day.attendance.totalEarlyOutMinutes) || 0);

        if (dayEarlyMin > 0 && !day.earlyOutWaved) {
          totalEarlyOutMinutes += dayEarlyMin;
          earlyOutCount++;
        }

        // Combined Highlighting Contribution (Late + Early)
        const isLate = dayLateMin > 0 && !day.lateInWaved;
        const isEarly = dayEarlyMin > 0 && !day.earlyOutWaved;

        if (isLate || isEarly) {
          let countContribution = 0;
          if (isLate) countContribution++;
          if (isEarly) countContribution++;

          contributingDates.lateIn.push({
            date: dStr,
            value: countContribution,
            label: countContribution === 2 ? 'L+E' : (isLate ? 'Late' : 'Early')
          });
          // Also set in earlyOut for backwards compatibility/consistency if needed, 
          // but clicking "Lates" (lateIn category) will show both now.
          contributingDates.earlyOut.push({
            date: dStr,
            value: countContribution,
            label: countContribution === 2 ? 'L+E' : (isLate ? 'Late' : 'Early')
          });
        }
      }
    }

    summary.totalPresentDays = Math.round(totalPresentDays * 100) / 100;
    summary.totalPayableShifts = Math.round(totalPayableShifts * 100) / 100;
    summary.totalLeaves = Math.round(totalLeaveDays * 100) / 100;
    summary.totalODs = Math.round(totalODDays * 100) / 100;
    const totalAbsentDays = contributingDates.absent.reduce((s, cd) => s + (Number(cd.value) || 0), 0);
    summary.totalAbsentDays = Math.round(totalAbsentDays * 100) / 100;
    summary.totalLateInMinutes = Math.round(totalLateInMinutes * 100) / 100;
    summary.lateInCount = lateInCount;
    summary.totalEarlyOutMinutes = Math.round(totalEarlyOutMinutes * 100) / 100;
    summary.earlyOutCount = earlyOutCount;

    // 7. Calculate total OT hours
    const OT = require('../../overtime/model/OT');
    const approvedOTs = await OT.find({
      employeeId,
      status: 'approved',
      otHours: { $gt: 0 },
      date: { $gte: startDateStr, $lte: endDateStr },
    }).select('date otHours').lean();

    let totalOTHours = 0;
    for (const ot of approvedOTs) {
      totalOTHours += ot.otHours || 0;
      const otDate = toNormalizedDateStr(ot.date);
      if (otDate && !contributingDates.otHours.some(cd => cd.date === otDate)) {
        contributingDates.otHours.push({
          date: otDate,
          value: ot.otHours,
          label: `OT (${ot.otHours})`
        });
      }
    }
    summary.totalOTHours = Math.round(totalOTHours * 100) / 100;

    // 8. Calculate total extra hours
    let totalExtraHours = 0;
    for (const record of attendanceRecords) {
      if (record.extraHours > 0) {
        totalExtraHours += record.extraHours || 0;
        const recordDate = toNormalizedDateStr(record.date);
        if (!contributingDates.extraHours.some(cd => cd.date === recordDate)) {
          contributingDates.extraHours.push({
            date: recordDate,
            value: record.extraHours,
            label: `Ex (${record.extraHours})`
          });
        }
      }
    }
    summary.totalExtraHours = Math.round(totalExtraHours * 100) / 100;

    // 9. Calculate total permission hours
    const Permission = require('../../permissions/model/Permission');
    const approvedPermissions = await Permission.find({
      employeeId,
      status: 'approved',
      date: { $gte: startDateStr, $lte: endDateStr },
      isActive: true,
    }).select('permissionHours').lean();

    let totalPermissionHours = 0;
    for (const permission of approvedPermissions) {
      totalPermissionHours += permission.permissionHours || 0;
      const permDate = toNormalizedDateStr(permission.date);
      if (permDate && !contributingDates.permissions.some(cd => cd.date === permDate)) {
        contributingDates.permissions.push({ date: permDate, value: permission.permissionHours, label: 'Perm' });
      }
    }
    summary.totalPermissionHours = Math.round(totalPermissionHours * 100) / 100;
    summary.totalPermissionCount = approvedPermissions.length;

    // Early Out Deductions Summary
    let totalEarlyOutDeductionDays = 0;
    let totalEarlyOutDeductionAmount = 0;
    const earlyOutDeductionBreakdown = { quarter_day: 0, half_day: 0, full_day: 0, custom_amount: 0 };

    for (const rec of attendanceRecords) {
      const deduction = rec.earlyOutDeduction;
      if (deduction && deduction.deductionApplied) {
        totalEarlyOutDeductionDays += (Number(deduction.deductionDays) || 0);
        totalEarlyOutDeductionAmount += (Number(deduction.deductionAmount) || 0);
        if (deduction.deductionType && earlyOutDeductionBreakdown[deduction.deductionType] !== undefined) {
          earlyOutDeductionBreakdown[deduction.deductionType] += (Number(deduction.deductionDays) || 0);
        }
        if (Number(deduction.deductionAmount) > 0) earlyOutDeductionBreakdown.custom_amount += Number(deduction.deductionAmount);
      }
    }

    summary.totalEarlyOutDeductionDays = Math.round(totalEarlyOutDeductionDays * 100) / 100;
    summary.totalEarlyOutDeductionAmount = Math.round(totalEarlyOutDeductionAmount * 100) / 100;
    summary.earlyOutDeductionBreakdown = {
      quarter_day: Math.round(earlyOutDeductionBreakdown.quarter_day * 100) / 100,
      half_day: Math.round(earlyOutDeductionBreakdown.half_day * 100) / 100,
      full_day: Math.round(earlyOutDeductionBreakdown.full_day * 100) / 100,
      custom_amount: Math.round(earlyOutDeductionBreakdown.custom_amount * 100) / 100,
    };

    summary.totalLateOrEarlyMinutes = Math.round((summary.totalLateInMinutes + summary.totalEarlyOutMinutes) * 100) / 100;
    summary.lateOrEarlyCount = summary.lateInCount + summary.earlyOutCount;

    // Policy attendance deduction (aligned with payroll deductionService — late/early counts + absent extra)
    let policyDedDays = 0;
    let policyBreakdown = defaultAttendancePolicyDeductionBreakdown();
    try {
      const employee = await Employee.findById(employeeId)
        .select(
          'gross_salary department_id division_id applyAttendanceDeduction deductLateIn deductEarlyOut deductAbsent'
        )
        .lean();
      if (employee && employee.department_id) {
        const monthStr = `${year}-${String(monthNumber).padStart(2, '0')}`;
        const gross = Number(employee.gross_salary) || 0;
        const perDayBasicPay =
          summary.totalDaysInMonth > 0
            ? Math.round((gross / summary.totalDaysInMonth) * 100) / 100
            : 0;
        const absentSettings = await getAbsentDeductionSettings(
          String(employee.department_id),
          employee.division_id ? String(employee.division_id) : null
        );
        const attDed = await deductionService.calculateAttendanceDeduction(
          employeeId,
          monthStr,
          String(employee.department_id),
          perDayBasicPay,
          employee.division_id ? String(employee.division_id) : null,
          {
            absentDays: summary.totalAbsentDays,
            enableAbsentDeduction: absentSettings.enableAbsentDeduction,
            lopDaysPerAbsent: absentSettings.lopDaysPerAbsent,
            employee,
          }
        );
        const b = attDed.breakdown || {};
        policyDedDays = Number(b.daysDeducted) || 0;
        policyBreakdown = {
          ...defaultAttendancePolicyDeductionBreakdown(),
          lateInsCount: Number(b.lateInsCount) || 0,
          earlyOutsCount: Number(b.earlyOutsCount) || 0,
          combinedCount: Number(b.combinedCount) || 0,
          freeAllowedPerMonth: Number(b.freeAllowedPerMonth) || 0,
          effectiveCount: Number(b.effectiveCount) || 0,
          daysDeducted: Number(b.daysDeducted) || 0,
          lateEarlyDaysDeducted: Number(b.lateEarlyDaysDeducted) || 0,
          absentExtraDays: Number(b.absentExtraDays) || 0,
          absentDays: Number(b.absentDays) || 0,
          lopDaysPerAbsent: b.lopDaysPerAbsent != null ? Number(b.lopDaysPerAbsent) : null,
          deductionType: b.deductionType != null ? String(b.deductionType) : null,
          calculationMode: b.calculationMode != null ? String(b.calculationMode) : null,
        };
      }
    } catch (err) {
      console.error('Policy attendance deduction for monthly summary failed:', err.message);
    }
    summary.totalAttendanceDeductionDays = Math.round(policyDedDays * 100) / 100;
    summary.attendanceDeductionBreakdown = policyBreakdown;

    summary.contributingDates = contributingDates;
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

