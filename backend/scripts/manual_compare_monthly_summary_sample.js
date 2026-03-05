/**
 * Read-only manual vs stored monthly summary comparison for a sample of employees.
 *
 * - Does NOT recalculate or update any summary.
 * - Manual totals are computed from AttendanceDaily/Leave/OD/PreScheduledShift
 *   using current summary service behavior.
 *
 * Usage (from backend):
 *   node scripts/manual_compare_monthly_summary_sample.js
 *   MONTH=2026-02 node scripts/manual_compare_monthly_summary_sample.js
 *   MONTH=2026-02 SAMPLE_SIZE=25 node scripts/manual_compare_monthly_summary_sample.js
 *   MONTH=2026-02 OFFSET=25 SAMPLE_SIZE=25 node scripts/manual_compare_monthly_summary_sample.js
 *   MONTH=2026-02 DIVISION=pydahsoft SAMPLE_SIZE=30 node scripts/manual_compare_monthly_summary_sample.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { createISTDate, extractISTComponents, getAllDatesInRange } = require('../shared/utils/dateUtils');
const dateCycleService = require('../leaves/services/dateCycleService');

const AttendanceDaily = require('../attendance/model/AttendanceDaily');
const Leave = require('../leaves/model/Leave');
const OD = require('../leaves/model/OD');
const PreScheduledShift = require('../shifts/model/PreScheduledShift');
const MonthlyAttendanceSummary = require('../attendance/model/MonthlyAttendanceSummary');
const Division = require('../departments/model/Division');
const Employee = require('../employees/model/Employee');
const { calculateMonthlyEarlyOutDeductions } = require('../attendance/services/earlyOutDeductionService');

const KEYS = [
  'totalDaysInMonth', 'totalPresentDays', 'totalPayableShifts', 'totalLeaves', 'totalODs',
  'totalWeeklyOffs', 'totalHolidays',
  'lateInCount', 'totalLateInMinutes', 'lateOrEarlyCount', 'totalLateOrEarlyMinutes',
  'earlyOutCount', 'totalEarlyOutMinutes', 'totalEarlyOutDeductionDays', 'totalEarlyOutDeductionAmount',
];

function toDateStr(value) {
  if (!value) return '';
  if (value instanceof Date) return extractISTComponents(value).dateStr;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return extractISTComponents(new Date(raw)).dateStr;
}

function round(value, decimals = 2) {
  const p = Math.pow(10, decimals);
  return Math.round((Number(value) || 0) * p) / p;
}

function pick(summary) {
  if (!summary) return null;
  return KEYS.reduce((acc, k) => {
    acc[k] = summary[k] ?? 0;
    return acc;
  }, {});
}

function diff(stored, manual) {
  const out = {};
  for (const k of KEYS) {
    const a = Number(stored?.[k] ?? 0);
    const b = Number(manual?.[k] ?? 0);
    out[k] = round(a - b, 2);
  }
  return out;
}

function isMatch(stored, manual) {
  if (!stored || !manual) return false;
  return KEYS.every((k) => Math.abs((Number(stored[k]) || 0) - (Number(manual[k]) || 0)) <= 0.01);
}

async function manualTotals(employeeId, empNo, startDateStr, endDateStr, year, monthNumber) {
  const payrollStart = createISTDate(startDateStr);
  const payrollEnd = createISTDate(endDateStr);
  const empNoNorm = String(empNo || '').trim().toUpperCase();

  const [dailies, leaves, ods, rosterNonWorking] = await Promise.all([
    AttendanceDaily.find({
      employeeNumber: empNoNorm,
      date: { $gte: startDateStr, $lte: endDateStr },
    }).select('date status payableShifts shifts totalLateInMinutes').lean(),
    Leave.find({
      employeeId,
      status: 'approved',
      isActive: true,
      $or: [{ fromDate: { $lte: payrollEnd }, toDate: { $gte: payrollStart } }],
    }).select('fromDate toDate isHalfDay').lean(),
    OD.find({
      employeeId,
      status: 'approved',
      isActive: true,
      $or: [{ fromDate: { $lte: payrollEnd }, toDate: { $gte: payrollStart } }],
    }).select('fromDate toDate isHalfDay odType_extended').lean(),
    PreScheduledShift.find({
      employeeNumber: empNoNorm,
      date: { $gte: startDateStr, $lte: endDateStr },
      status: { $in: ['WO', 'HOL'] },
    }).select('date status').lean(),
  ]);

  const weekOffDates = new Set();
  const holidayDates = new Set();
  const nonWorkingRosterDates = new Set();
  for (const row of rosterNonWorking) {
    const d = toDateStr(row.date);
    if (!d) continue;
    nonWorkingRosterDates.add(d);
    if (row.status === 'WO') weekOffDates.add(d);
    if (row.status === 'HOL') holidayDates.add(d);
  }

  let totalPresentDaysFromDailies = 0;
  let totalPayableShiftsFromDailies = 0;
  let lateInCount = 0;
  let totalLateInMinutes = 0;

  for (const r of dailies) {
    const day = toDateStr(r.date);
    const rosterBlocked = nonWorkingRosterDates.has(day);
    if (r.status === 'WEEK_OFF' || r.status === 'HOLIDAY' || rosterBlocked) continue;

    if (r.status === 'PRESENT') totalPresentDaysFromDailies += 1;
    else if (r.status === 'HALF_DAY') totalPresentDaysFromDailies += 0.5;

    let dayPayable = Number(r.payableShifts ?? 0);
    if (dayPayable === 0 && Array.isArray(r.shifts) && r.shifts.length > 0) {
      dayPayable = r.shifts.reduce((sum, s) => sum + (Number(s.payableShift) || 0), 0);
    }
    totalPayableShiftsFromDailies += dayPayable;

    if (r.status === 'PRESENT') {
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
  }

  // Leave days: only in period; each calendar day counted once (overlapping leaves not double-counted)
  const leaveDaysInPeriod = new Map();
  for (const leave of leaves) {
    let d = createISTDate(extractISTComponents(leave.fromDate).dateStr, '00:00');
    const to = createISTDate(extractISTComponents(leave.toDate).dateStr, '23:59');
    const contrib = leave.isHalfDay ? 0.5 : 1;
    while (d <= to) {
      const dayStr = toDateStr(d);
      if (dayStr >= startDateStr && dayStr <= endDateStr) {
        const existing = leaveDaysInPeriod.get(dayStr) || 0;
        leaveDaysInPeriod.set(dayStr, Math.max(existing, contrib));
      }
      d.setDate(d.getDate() + 1);
    }
  }
  let totalLeaves = Array.from(leaveDaysInPeriod.values()).reduce((s, c) => s + c, 0);

  const odDaysInPeriod = new Map();
  for (const od of ods) {
    if (od.odType_extended === 'hours') continue;
    let d = createISTDate(extractISTComponents(od.fromDate).dateStr, '00:00');
    const to = createISTDate(extractISTComponents(od.toDate).dateStr, '23:59');
    const contrib = od.isHalfDay ? 0.5 : 1;
    while (d <= to) {
      const dayStr = toDateStr(d);
      if (dayStr >= startDateStr && dayStr <= endDateStr) {
        const existing = odDaysInPeriod.get(dayStr) || 0;
        odDaysInPeriod.set(dayStr, Math.max(existing, contrib));
      }
      d.setDate(d.getDate() + 1);
    }
  }
  let totalODs = Array.from(odDaysInPeriod.values()).reduce((s, c) => s + c, 0);

  const datesWithAttendance = new Set((dailies || []).map((r) => toDateStr(r.date)));
  let odOnlyPresentDays = 0;
  for (const od of ods) {
    if (od.odType_extended === 'hours') continue;
    const contrib = od.isHalfDay ? 0.5 : 1;
    let d = new Date(`${extractISTComponents(od.fromDate).dateStr}T12:00:00Z`);
    const to = new Date(`${extractISTComponents(od.toDate).dateStr}T12:00:00Z`);
    while (d <= to) {
      const day = toDateStr(d);
      if (day >= startDateStr && day <= endDateStr && !datesWithAttendance.has(day)) {
        odOnlyPresentDays += contrib;
      }
      d.setDate(d.getDate() + 1);
    }
  }

  const earlyOut = await calculateMonthlyEarlyOutDeductions(empNoNorm, year, monthNumber);
  const totalLateOrEarlyMinutes = round(round(totalLateInMinutes, 2) + Number(earlyOut.totalEarlyOutMinutes || 0), 2);

  return {
    totalDaysInMonth: getAllDatesInRange(startDateStr, endDateStr).length,
    totalPresentDays: round(totalPresentDaysFromDailies + totalODs, 1),
    totalPayableShifts: round(totalPayableShiftsFromDailies + odOnlyPresentDays, 2),
    totalLeaves: round(totalLeaves, 1),
    totalODs: round(totalODs, 1),
    totalWeeklyOffs: weekOffDates.size,
    totalHolidays: holidayDates.size,
    lateInCount: Number(lateInCount || 0),
    totalLateInMinutes: round(totalLateInMinutes, 2),
    lateOrEarlyCount: Number(lateInCount || 0) + Number(earlyOut.earlyOutCount || 0),
    totalLateOrEarlyMinutes,
    earlyOutCount: Number(earlyOut.earlyOutCount || 0),
    totalEarlyOutMinutes: round(earlyOut.totalEarlyOutMinutes || 0, 2),
    totalEarlyOutDeductionDays: round(earlyOut.totalDeductionDays || 0, 2),
    totalEarlyOutDeductionAmount: round(earlyOut.totalDeductionAmount || 0, 2),
  };
}

async function run() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');
  await mongoose.connect(process.env.MONGODB_URI);

  const sampleSize = Math.max(1, Number(process.env.SAMPLE_SIZE || 25));
  const offset = Math.max(0, Number(process.env.OFFSET || 0));

  let month = process.env.MONTH;
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    const now = new Date();
    month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  const [year, monthNumber] = month.split('-').map(Number);

  const anchor = createISTDate(`${year}-${String(monthNumber).padStart(2, '0')}-15`);
  const periodInfo = await dateCycleService.getPeriodInfo(anchor);
  const startDateStr = extractISTComponents(periodInfo.payrollCycle.startDate).dateStr;
  const endDateStr = extractISTComponents(periodInfo.payrollCycle.endDate).dateStr;

  let filter = { month };
  const divisionNameOrCode = (process.env.DIVISION || '').trim();
  if (divisionNameOrCode) {
    const escaped = divisionNameOrCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const div = await Division.findOne({
      $or: [{ name: new RegExp(`^${escaped}$`, 'i') }, { code: divisionNameOrCode.toUpperCase() }],
    }).select('_id name code').lean();
    if (!div) throw new Error(`Division not found: ${divisionNameOrCode}`);
    const empIds = (await Employee.find({ division_id: div._id, is_active: true }).select('_id').lean()).map((e) => e._id);
    filter.employeeId = { $in: empIds };
  }

  const summaries = await MonthlyAttendanceSummary.find(filter)
    .select('employeeId emp_no month totalDaysInMonth totalPresentDays totalPayableShifts totalLeaves totalODs totalWeeklyOffs totalHolidays lateInCount totalLateInMinutes lateOrEarlyCount totalLateOrEarlyMinutes earlyOutCount totalEarlyOutMinutes totalEarlyOutDeductionDays totalEarlyOutDeductionAmount')
    .sort({ emp_no: 1 })
    .skip(offset)
    .limit(sampleSize)
    .lean();

  console.log(`Month: ${month} | Payroll Period: ${startDateStr}..${endDateStr}`);
  console.log(`Sample requested: ${sampleSize} | Offset: ${offset} | Loaded: ${summaries.length}`);
  console.log('');

  let matched = 0;
  let mismatched = 0;
  const mismatchRows = [];

  for (const s of summaries) {
    const stored = pick(s);
    const manual = await manualTotals(s.employeeId, s.emp_no, startDateStr, endDateStr, year, monthNumber);
    const ok = isMatch(stored, manual);
    if (ok) {
      matched += 1;
    } else {
      mismatched += 1;
      mismatchRows.push({
        emp_no: s.emp_no,
        delta: diff(stored, manual),
        stored,
        manual,
      });
    }
  }

  console.log(`Matched: ${matched}`);
  console.log(`Mismatched: ${mismatched}`);
  console.log('');

  if (mismatchRows.length > 0) {
    console.log('--- Mismatch Details ---');
    mismatchRows.forEach((m) => {
      console.log(`\nEmployee: ${m.emp_no}`);
      console.log('Delta (stored - manual):', JSON.stringify(m.delta));
      console.log('Stored:', JSON.stringify(m.stored));
      console.log('Manual:', JSON.stringify(m.manual));
    });
  } else {
    console.log('All sampled employees match.');
  }

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('manual_compare_monthly_summary_sample failed:', err.message);
  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }
  process.exit(1);
});

