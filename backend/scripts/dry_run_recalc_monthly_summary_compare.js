/**
 * DRY RUN + RECALC + COMPARE (production-safe: no deletes)
 *
 * 1. Get all monthly summaries for MONTH and STORE their current totals (original).
 * 2. Recalculate each summary via calculateMonthlySummary (script recalc).
 * 3. For each employee, manually compute totals from raw data (AttendanceDaily, Leave, OD) over the same payroll period.
 * 4. Compare: ORIGINAL vs AFTER_RECALC vs MANUAL. Report differences and whether script matches manual.
 *
 * Usage (from backend folder):
 *   node scripts/dry_run_recalc_monthly_summary_compare.js
 *   MONTH=2026-02 node scripts/dry_run_recalc_monthly_summary_compare.js
 *   MONTH=2026-02 DRY_RUN_LIMIT=10 node scripts/dry_run_recalc_monthly_summary_compare.js   # only first 10 employees (faster, for quick check)
 *   MONTH=2026-02 DIVISION=pydahsoft node scripts/dry_run_recalc_monthly_summary_compare.js   # only employees in division (name or code)
 *
 * Does NOT delete any data. Step 2 does recalc and SAVE (overwrites summary docs); original totals are already stored in step 1 for comparison.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { createISTDate, extractISTComponents, getAllDatesInRange } = require('../shared/utils/dateUtils');
const dateCycleService = require('../leaves/services/dateCycleService');
const AttendanceDaily = require('../attendance/model/AttendanceDaily');
const Leave = require('../leaves/model/Leave');
const OD = require('../leaves/model/OD');
const MonthlyAttendanceSummary = require('../attendance/model/MonthlyAttendanceSummary');
const { calculateMonthlySummary } = require('../attendance/services/summaryCalculationService');
const Division = require('../departments/model/Division');
const Employee = require('../employees/model/Employee');
const { calculateMonthlyEarlyOutDeductions } = require('../attendance/services/earlyOutDeductionService');

function toNormalizedDateStr(val) {
  if (!val) return '';
  if (val instanceof Date) return extractISTComponents(val).dateStr;
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return extractISTComponents(new Date(val)).dateStr;
}

/** Pick totals we care about for comparison (includes late-in, early-out, late-or-early) */
function pickTotals(s) {
  if (!s) return null;
  return {
    totalDaysInMonth: s.totalDaysInMonth,
    totalPresentDays: s.totalPresentDays,
    totalPayableShifts: s.totalPayableShifts,
    totalLeaves: s.totalLeaves,
    totalODs: s.totalODs,
    totalWeeklyOffs: s.totalWeeklyOffs,
    totalHolidays: s.totalHolidays,
    lateInCount: s.lateInCount,
    totalLateInMinutes: s.totalLateInMinutes,
    lateOrEarlyCount: s.lateOrEarlyCount,
    totalLateOrEarlyMinutes: s.totalLateOrEarlyMinutes,
    earlyOutCount: s.earlyOutCount,
    totalEarlyOutMinutes: s.totalEarlyOutMinutes,
    totalEarlyOutDeductionDays: s.totalEarlyOutDeductionDays,
    totalEarlyOutDeductionAmount: s.totalEarlyOutDeductionAmount,
  };
}

/**
 * Manual calculation from raw data (same logic as summaryCalculationService).
 * Early-out uses calendar month and PRESENT-only (not HALF_DAY/PARTIAL), matching earlyOutDeductionService.
 */
async function manualCalculateTotals(employeeId, emp_no, startDateStr, endDateStr, year, monthNumber) {
  const payrollStart = createISTDate(startDateStr);
  const payrollEnd = createISTDate(endDateStr);
  const empNoNorm = (emp_no && String(emp_no).trim()) ? String(emp_no).toUpperCase() : emp_no;

  const [dailies, leaves, ods] = await Promise.all([
    AttendanceDaily.find({
      employeeNumber: empNoNorm,
      date: { $gte: startDateStr, $lte: endDateStr },
    })
      .select('date status payableShifts shifts totalLateInMinutes totalEarlyOutMinutes')
      .lean(),
    Leave.find({
      employeeId,
      status: 'approved',
      isActive: true,
      $or: [{ fromDate: { $lte: payrollEnd }, toDate: { $gte: payrollStart } }],
    })
      .select('fromDate toDate isHalfDay')
      .lean(),
    OD.find({
      employeeId,
      status: 'approved',
      isActive: true,
      $or: [{ fromDate: { $lte: payrollEnd }, toDate: { $gte: payrollStart } }],
    })
      .select('fromDate toDate isHalfDay odType_extended')
      .lean(),
  ]);

  let totalWeeklyOffs = 0;
  let totalHolidays = 0;
  let totalPresentDaysFromDailies = 0;
  let totalPayableShiftsFromDailies = 0;
  for (const r of dailies) {
    if (r.status === 'WEEK_OFF') totalWeeklyOffs += 1;
    else if (r.status === 'HOLIDAY') totalHolidays += 1;
    if (r.status === 'WEEK_OFF' || r.status === 'HOLIDAY') continue;
    if (r.status === 'PRESENT') totalPresentDaysFromDailies += 1;
    else if (r.status === 'HALF_DAY') totalPresentDaysFromDailies += 0.5;
    let dayPay = Number(r.payableShifts ?? 0);
    if (dayPay === 0 && Array.isArray(r.shifts) && r.shifts.length > 0) {
      dayPay = r.shifts.reduce((sum, s) => sum + (Number(s.payableShift) || 0), 0);
    }
    totalPayableShiftsFromDailies += dayPay;
  }

  let totalLeaveDays = 0;
  for (const leave of leaves) {
    const leaveStart = createISTDate(extractISTComponents(leave.fromDate).dateStr, '00:00');
    const leaveEnd = createISTDate(extractISTComponents(leave.toDate).dateStr, '23:59');
    let currentDate = new Date(leaveStart);
    while (currentDate <= leaveEnd) {
      if (currentDate >= payrollStart && currentDate <= payrollEnd) {
        totalLeaveDays += leave.isHalfDay ? 0.5 : 1;
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  let totalODDays = 0;
  for (const od of ods) {
    if (od.odType_extended === 'hours') continue;
    const odStart = createISTDate(extractISTComponents(od.fromDate).dateStr, '00:00');
    const odEnd = createISTDate(extractISTComponents(od.toDate).dateStr, '23:59');
    let currentDate = new Date(odStart);
    while (currentDate <= odEnd) {
      if (currentDate >= payrollStart && currentDate <= payrollEnd) {
        totalODDays += od.isHalfDay ? 0.5 : 1;
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  const datesWithAttendance = new Set(dailies.map((r) => toNormalizedDateStr(r.date)));
  let odOnlyPresentDays = 0;
  for (const od of ods) {
    if (od.odType_extended === 'hours') continue;
    const contrib = od.isHalfDay ? 0.5 : 1;
    let d = new Date(extractISTComponents(od.fromDate).dateStr + 'T12:00:00Z');
    const odEnd = new Date(extractISTComponents(od.toDate).dateStr + 'T12:00:00Z');
    while (d <= odEnd) {
      const dateStr = toNormalizedDateStr(d);
      if (dateStr >= startDateStr && dateStr <= endDateStr && !datesWithAttendance.has(dateStr)) {
        odOnlyPresentDays += contrib;
      }
      d.setDate(d.getDate() + 1);
    }
  }

  const totalPresentDays = Math.round((totalPresentDaysFromDailies + totalODDays) * 10) / 10;
  const totalPayableShifts = Math.round((totalPayableShiftsFromDailies + odOnlyPresentDays) * 100) / 100;
  const periodDays = getAllDatesInRange(startDateStr, endDateStr).length;

  // Late-in: PRESENT days only, from dailies in payroll period
  let lateInCount = 0;
  let totalLateInMinutes = 0;
  for (const r of dailies) {
    if (r.status !== 'PRESENT') continue;
    const shifts = Array.isArray(r.shifts) ? r.shifts : [];
    let dayLate = 0;
    if (shifts.length > 0) {
      for (const s of shifts) {
        if (s.lateInMinutes != null && s.lateInMinutes > 0) dayLate += Number(s.lateInMinutes);
      }
    } else {
      dayLate = Number(r.totalLateInMinutes) || 0;
    }
    if (dayLate > 0) {
      totalLateInMinutes += dayLate;
      lateInCount += 1;
    }
  }
  totalLateInMinutes = Math.round(totalLateInMinutes * 100) / 100;

  // Early-out: same logic as earlyOutDeductionService (calendar month, PRESENT-only). Call service to match exactly.
  let earlyOutCount = 0;
  let totalEarlyOutMinutes = 0;
  let totalEarlyOutDeductionDays = 0;
  let totalEarlyOutDeductionAmount = 0;
  if (year != null && monthNumber != null) {
    const earlyOutResult = await calculateMonthlyEarlyOutDeductions(emp_no, year, monthNumber);
    earlyOutCount = earlyOutResult.earlyOutCount ?? 0;
    totalEarlyOutMinutes = earlyOutResult.totalEarlyOutMinutes ?? 0;
    totalEarlyOutDeductionDays = earlyOutResult.totalDeductionDays ?? 0;
    totalEarlyOutDeductionAmount = earlyOutResult.totalDeductionAmount ?? 0;
  }

  // Late-or-early = late-in + early-out (sum of the two, no separate counting)
  const lateOrEarlyCount = lateInCount + earlyOutCount;
  const totalLateOrEarlyMinutes = Math.round((totalLateInMinutes + totalEarlyOutMinutes) * 100) / 100;

  return {
    totalDaysInMonth: periodDays,
    totalPresentDays,
    totalPayableShifts,
    totalLeaves: Math.round(totalLeaveDays * 10) / 10,
    totalODs: Math.round(totalODDays * 10) / 10,
    totalWeeklyOffs,
    totalHolidays,
    lateInCount,
    totalLateInMinutes,
    lateOrEarlyCount,
    totalLateOrEarlyMinutes,
    earlyOutCount,
    totalEarlyOutMinutes,
    totalEarlyOutDeductionDays,
    totalEarlyOutDeductionAmount,
  };
}

const COMPARE_KEYS = [
  'totalDaysInMonth', 'totalPresentDays', 'totalPayableShifts', 'totalLeaves', 'totalODs',
  'totalWeeklyOffs', 'totalHolidays',
  'lateInCount', 'totalLateInMinutes', 'lateOrEarlyCount', 'totalLateOrEarlyMinutes',
  'earlyOutCount', 'totalEarlyOutMinutes', 'totalEarlyOutDeductionDays', 'totalEarlyOutDeductionAmount',
];

function totalsEqual(a, b) {
  if (!a || !b) return false;
  for (const k of COMPARE_KEYS) {
    const va = a[k];
    const vb = b[k];
    if (typeof va === 'number' && typeof vb === 'number') {
      if (Math.abs(va - vb) > 0.01) return false;
    } else if (va !== vb) return false;
  }
  return true;
}

function diffTotals(label, a, b) {
  const out = {};
  for (const k of COMPARE_KEYS) {
    const va = a && a[k];
    const vb = b && b[k];
    if (typeof va === 'number' && typeof vb === 'number') {
      out[k] = Math.round((va - vb) * 100) / 100;
    } else {
      out[k] = va === vb ? '=' : { orig: va, other: vb };
    }
  }
  return out;
}

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  let monthStr = process.env.MONTH;
  if (!monthStr || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthStr)) {
    const now = new Date();
    monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    console.log('Using current month:', monthStr);
  } else {
    console.log('Using MONTH:', monthStr);
  }
  const [year, monthNumber] = monthStr.split('-').map(Number);
  const limitNum = process.env.DRY_RUN_LIMIT ? parseInt(process.env.DRY_RUN_LIMIT, 10) : null;
  if (limitNum) console.log('DRY_RUN_LIMIT=', limitNum, '(only first', limitNum, 'employees)\n');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.\n');

  console.log('--- STEP 0: Resolve payroll period (requires DB for settings e.g. 26-25) ---');
  const periodInfo = await dateCycleService.getPeriodInfo(createISTDate(`${year}-${String(monthNumber).padStart(2, '0')}-15`));
  const startDateStr = extractISTComponents(periodInfo.payrollCycle.startDate).dateStr;
  const endDateStr = extractISTComponents(periodInfo.payrollCycle.endDate).dateStr;
  console.log('Period:', startDateStr, '..', endDateStr, '\n');

  // --- STEP 0b: Optional division filter (DIVISION=pydahsoft → only employees in that division)
  let divisionFilter = { month: monthStr };
  const divisionNameOrCode = (process.env.DIVISION || process.env.DIVISION_NAME || '').trim();
  if (divisionNameOrCode) {
    const div = await Division.findOne({
      $or: [
        { name: new RegExp('^' + divisionNameOrCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') },
        { code: divisionNameOrCode.toUpperCase() },
      ],
    }).select('_id name code').lean();
    if (!div) {
      console.error('Division not found for:', divisionNameOrCode);
      process.exit(1);
    }
    const divisionEmployeeIds = await Employee.find({ division_id: div._id, is_active: true }).select('_id').lean();
    const empIds = divisionEmployeeIds.map((e) => e._id);
    divisionFilter = { month: monthStr, employeeId: { $in: empIds } };
    console.log('--- Division filter: "' + (div.name || div.code) + '" →', empIds.length, 'employees\n');
  }

  // --- STEP 1: Get all monthly summaries for this month (optionally by division); store original totals (no delete)
  console.log('--- STEP 1: Load existing summaries and STORE original totals (no delete) ---');
  const summariesBefore = await MonthlyAttendanceSummary.find(divisionFilter)
    .select('employeeId emp_no month totalDaysInMonth totalPresentDays totalPayableShifts totalLeaves totalODs totalWeeklyOffs totalHolidays lateInCount totalLateInMinutes lateOrEarlyCount totalLateOrEarlyMinutes earlyOutCount totalEarlyOutMinutes totalEarlyOutDeductionDays totalEarlyOutDeductionAmount')
    .lean();

  const originalByEmp = new Map();
  for (const s of summariesBefore) {
    originalByEmp.set(String(s.emp_no), { employeeId: s.employeeId, emp_no: s.emp_no, totals: pickTotals(s) });
  }
  const toProcess = limitNum ? summariesBefore.slice(0, limitNum) : summariesBefore;
  console.log('Stored original totals for', summariesBefore.length, 'employees. Will process', toProcess.length, 'for recalc/compare.\n');

  // --- STEP 2: Recalculate each summary via service (overwrites in DB)
  console.log('--- STEP 2: Recalculate each summary via calculateMonthlySummary ---');
  let recalcOk = 0;
  let recalcFail = 0;
  for (const s of toProcess) {
    try {
      await calculateMonthlySummary(s.employeeId, s.emp_no, year, monthNumber);
      recalcOk++;
    } catch (err) {
      console.error('Recalc failed', s.emp_no, err.message);
      recalcFail++;
    }
  }
  console.log('Recalc done. Success:', recalcOk, '| Failed:', recalcFail, '\n');

  // --- STEP 3: Load after-recalc totals from DB
  console.log('--- STEP 3: Load after-recalc totals from DB ---');
  const summariesAfter = await MonthlyAttendanceSummary.find(divisionFilter)
    .select('emp_no totalDaysInMonth totalPresentDays totalPayableShifts totalLeaves totalODs totalWeeklyOffs totalHolidays lateInCount totalLateInMinutes lateOrEarlyCount totalLateOrEarlyMinutes earlyOutCount totalEarlyOutMinutes totalEarlyOutDeductionDays totalEarlyOutDeductionAmount')
    .lean();
  const afterByEmp = new Map();
  for (const s of summariesAfter) {
    afterByEmp.set(String(s.emp_no), pickTotals(s));
  }
  console.log('Loaded after-recalc for', summariesAfter.length, 'summaries.\n');

  // --- STEP 4: Manual calculation from raw data for each employee
  console.log('--- STEP 4: Manual calculation from raw data (same period) ---');
  const manualByEmp = new Map();
  for (const s of toProcess) {
    try {
      const manual = await manualCalculateTotals(s.employeeId, s.emp_no, startDateStr, endDateStr, year, monthNumber);
      manualByEmp.set(String(s.emp_no), manual);
    } catch (err) {
      console.error('Manual calc failed', s.emp_no, err.message);
      manualByEmp.set(String(s.emp_no), null);
    }
  }
  console.log('Manual calc done for', summariesBefore.length, 'employees.\n');

  // --- STEP 5: Compare all three
  console.log('========== COMPARISON: ORIGINAL vs AFTER_RECALC vs MANUAL ==========\n');

  let matchAllThree = 0;
  let originalVsRecalcDiff = 0;
  let recalcVsManualDiff = 0;
  const mismatches = [];

  for (const s of toProcess) {
    const empNo = String(s.emp_no);
    const orig = originalByEmp.get(empNo)?.totals;
    const after = afterByEmp.get(empNo);
    const manual = manualByEmp.get(empNo);

    const origEqRecalc = totalsEqual(orig, after);
    const recalcEqManual = totalsEqual(after, manual);
    if (origEqRecalc && recalcEqManual) matchAllThree++;
    if (!origEqRecalc) originalVsRecalcDiff++;
    if (!recalcEqManual) recalcVsManualDiff++;

    if (!recalcEqManual || !origEqRecalc) {
      mismatches.push({
        emp_no: empNo,
        original: orig,
        afterRecalc: after,
        manual,
        origVsRecalc: origEqRecalc ? 'MATCH' : diffTotals('orig-recalc', orig, after),
        recalcVsManual: recalcEqManual ? 'MATCH' : diffTotals('recalc-manual', after, manual),
      });
    }
  }

  // Summary table: first 15 of compared set (main totals)
  console.log('Sample (first 15 of compared) — O=Original, R=After Recalc, M=Manual');
  console.log('emp_no  | totalDaysInMonth | totalPresentDays | totalPayableShifts | totalLeaves | totalODs | WO | Hol');
  console.log('        | O   R   M        | O    R    M      | O     R     M       | O   R   M   | O  R  M  | ...');
  for (let i = 0; i < Math.min(15, toProcess.length); i++) {
    const s = toProcess[i];
    const empNo = String(s.emp_no);
    const o = originalByEmp.get(empNo)?.totals;
    const r = afterByEmp.get(empNo);
    const m = manualByEmp.get(empNo);
    const line = [
      empNo.padEnd(7),
      [o?.totalDaysInMonth, r?.totalDaysInMonth, m?.totalDaysInMonth].join(' ').padEnd(12),
      [o?.totalPresentDays, r?.totalPresentDays, m?.totalPresentDays].join(' ').padEnd(14),
      [o?.totalPayableShifts, r?.totalPayableShifts, m?.totalPayableShifts].join(' ').padEnd(16),
      [o?.totalLeaves, r?.totalLeaves, m?.totalLeaves].join(' ').padEnd(10),
      [o?.totalODs, r?.totalODs, m?.totalODs].join(' ').padEnd(8),
      [o?.totalWeeklyOffs, r?.totalWeeklyOffs, m?.totalWeeklyOffs].join(' '),
      [o?.totalHolidays, r?.totalHolidays, m?.totalHolidays].join(' '),
    ].join(' | ');
    console.log(line);
  }
  // Late-in (PRESENT-only)
  console.log('\n--- Late-in (PRESENT days only) — O=Original, R=After Recalc, M=Manual ---');
  console.log('emp_no  | lateInCount      | totalLateInMinutes');
  for (let i = 0; i < Math.min(15, toProcess.length); i++) {
    const s = toProcess[i];
    const empNo = String(s.emp_no);
    const o = originalByEmp.get(empNo)?.totals;
    const r = afterByEmp.get(empNo);
    const m = manualByEmp.get(empNo);
    console.log(empNo.padEnd(7), '|', [o?.lateInCount, r?.lateInCount, m?.lateInCount].join(' ').padEnd(16), '|', [o?.totalLateInMinutes, r?.totalLateInMinutes, m?.totalLateInMinutes].join(' '));
  }
  // Late-or-early = lateInCount + earlyOutCount, totalLateOrEarlyMinutes = totalLateIn + totalEarlyOut
  console.log('\n--- Late-or-early (= late-in + early-out) — O=Original, R=After Recalc, M=Manual ---');
  console.log('emp_no  | lateOrEarlyCount | totalLateOrEarlyMinutes');
  for (let i = 0; i < Math.min(15, toProcess.length); i++) {
    const s = toProcess[i];
    const empNo = String(s.emp_no);
    const o = originalByEmp.get(empNo)?.totals;
    const r = afterByEmp.get(empNo);
    const m = manualByEmp.get(empNo);
    console.log(empNo.padEnd(7), '|', [o?.lateOrEarlyCount, r?.lateOrEarlyCount, m?.lateOrEarlyCount].join(' ').padEnd(16), '|', [o?.totalLateOrEarlyMinutes, r?.totalLateOrEarlyMinutes, m?.totalLateOrEarlyMinutes].join(' '));
  }
  // Early-out (PRESENT-only)
  console.log('\n--- Early-out (PRESENT days only; not HALF_DAY/PARTIAL) — O=Original, R=After Recalc, M=Manual ---');
  console.log('emp_no  | earlyOutCount    | totalEarlyOutMinutes | totalEarlyOutDeductionDays | totalEarlyOutDeductionAmount');
  for (let i = 0; i < Math.min(15, toProcess.length); i++) {
    const s = toProcess[i];
    const empNo = String(s.emp_no);
    const o = originalByEmp.get(empNo)?.totals;
    const r = afterByEmp.get(empNo);
    const m = manualByEmp.get(empNo);
    const line = [
      empNo.padEnd(7),
      [o?.earlyOutCount, r?.earlyOutCount, m?.earlyOutCount].join(' ').padEnd(16),
      [o?.totalEarlyOutMinutes, r?.totalEarlyOutMinutes, m?.totalEarlyOutMinutes].join(' ').padEnd(20),
      [o?.totalEarlyOutDeductionDays, r?.totalEarlyOutDeductionDays, m?.totalEarlyOutDeductionDays].join(' ').padEnd(26),
      [o?.totalEarlyOutDeductionAmount, r?.totalEarlyOutDeductionAmount, m?.totalEarlyOutDeductionAmount].join(' '),
    ].join(' | ');
    console.log(line);
  }

  console.log('\n========== SUMMARY ==========');
  console.log('Total employees compared (recalc + manual):', toProcess.length);
  console.log('All three match (Original = After Recalc = Manual):', matchAllThree);
  console.log('Original ≠ After Recalc (recalc changed something):', originalVsRecalcDiff);
  console.log('After Recalc ≠ Manual (script recalc does not match manual logic):', recalcVsManualDiff);

  if (mismatches.length > 0) {
    console.log('\n--- Mismatch details (Recalc vs Manual) ---');
    for (const row of mismatches.slice(0, 25)) {
      console.log('\nemp_no:', row.emp_no);
      if (!totalsEqual(row.afterRecalc, row.manual)) {
        console.log('  After Recalc:', row.afterRecalc);
        console.log('  Manual:      ', row.manual);
        console.log('  Diff (R - M):', row.recalcVsManual);
      }
      if (!totalsEqual(row.original, row.afterRecalc)) {
        console.log('  Original vs Recalc diff:', row.origVsRecalc);
      }
    }
    if (mismatches.length > 25) {
      console.log('\n... and', mismatches.length - 25, 'more mismatches.');
    }
  }

  console.log('\n--- Changes seen (what recalc did) ---');
  if (originalVsRecalcDiff === 0) {
    console.log('Recalc did not change any totals (Original = After Recalc for all).');
  } else {
    console.log('Recalc changed', originalVsRecalcDiff, 'employee(s). See mismatch details above for Original vs Recalc.');
  }

  console.log('\n--- Script vs Manual ---');
  if (recalcVsManualDiff === 0) {
    console.log('Script recalc and manual calculation MATCH for all employees.');
  } else {
    console.log('Script recalc and manual calculation DIFFER for', recalcVsManualDiff, 'employee(s). See mismatch details above.');
  }

  await mongoose.disconnect();
  console.log('\nDone. No data was deleted.');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
