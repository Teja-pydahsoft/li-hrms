/**
 * 1. Manually calculate summary from raw data (OD, Leave, AttendanceDaily) for emp 272, period 26 Jan - 25 Feb.
 * 2. Delete monthly summary for 272 (both 2026-01 and 2026-02 - period can be stored under either), recalc through service.
 * 3. Compare and report difference.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const OD = require('../leaves/model/OD');
const Leave = require('../leaves/model/Leave');
const AttendanceDaily = require('../attendance/model/AttendanceDaily');
const Employee = require('../employees/model/Employee');
const MonthlyAttendanceSummary = require('../attendance/model/MonthlyAttendanceSummary');
const { calculateMonthlySummary } = require('../attendance/services/summaryCalculationService');
const { createISTDate, extractISTComponents, getAllDatesInRange } = require('../shared/utils/dateUtils');
const dateCycleService = require('../leaves/services/dateCycleService');

const empNo = '272';
const startStr = '2026-01-26';
const endStr = '2026-02-25';
const startDate = new Date(startStr + 'T00:00:00+05:30');
const endDate = new Date(endStr + 'T23:59:59+05:30');

function toDateStr(d) {
  return extractISTComponents(d).dateStr;
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);

  const emp = await Employee.findOne({ emp_no: empNo }).select('_id emp_no').lean();
  if (!emp) {
    console.log('Employee 272 not found');
    process.exit(1);
  }

  const ods = await OD.find({
    employeeId: emp._id,
    status: 'approved',
    isActive: true,
    $or: [{ fromDate: { $lte: endDate }, toDate: { $gte: startDate } }],
  })
    .select('fromDate toDate isHalfDay odType_extended')
    .lean();

  const leaves = await Leave.find({
    employeeId: emp._id,
    status: 'approved',
    isActive: true,
    $or: [{ fromDate: { $lte: endDate }, toDate: { $gte: startDate } }],
  })
    .select('fromDate toDate isHalfDay')
    .lean();

  const dailies = await AttendanceDaily.find({
    employeeNumber: empNo.toUpperCase(),
    date: { $gte: startStr, $lte: endStr },
  })
    .select('date status payableShifts shifts')
    .lean();

  // Present days: only PRESENT (1) and HALF_DAY (0.5). PARTIAL/ABSENT do not count (same as summary service).
  let totalPresentDaysFromDailies = 0;
  let totalPayableShiftsFromDailies = 0;
  for (const r of dailies) {
    if (r.status === 'WEEK_OFF' || r.status === 'HOLIDAY') continue;
    if (r.status === 'PRESENT') totalPresentDaysFromDailies += 1;
    else if (r.status === 'HALF_DAY') totalPresentDaysFromDailies += 0.5;
    // PARTIAL, ABSENT: do not add to present days
    let dayPay = Number(r.payableShifts ?? 0);
    if (dayPay === 0 && Array.isArray(r.shifts) && r.shifts.length > 0) {
      dayPay = r.shifts.reduce((sum, s) => sum + (Number(s.payableShift) || 0), 0);
    }
    totalPayableShiftsFromDailies += dayPay;
  }

  let totalLeaveDays = 0;
  for (const leave of leaves) {
    const leaveStart = createISTDate(toDateStr(leave.fromDate), '00:00');
    const leaveEnd = createISTDate(toDateStr(leave.toDate), '23:59');
    let currentDate = new Date(leaveStart);
    while (currentDate <= leaveEnd) {
      const ds = toDateStr(currentDate);
      if (ds >= startStr && ds <= endStr) totalLeaveDays += leave.isHalfDay ? 0.5 : 1;
      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  let totalODDays = 0;
  for (const od of ods) {
    if (od.odType_extended === 'hours') continue;
    const odStart = createISTDate(toDateStr(od.fromDate), '00:00');
    const odEnd = createISTDate(toDateStr(od.toDate), '23:59');
    let currentDate = new Date(odStart);
    while (currentDate <= odEnd) {
      const ds = toDateStr(currentDate);
      if (ds >= startStr && ds <= endStr) totalODDays += od.isHalfDay ? 0.5 : 1;
      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  const datesWithAttendance = new Set(dailies.map((r) => String(r.date).trim()));
  let odOnlyPresentDays = 0;
  for (const od of ods) {
    if (od.odType_extended === 'hours') continue;
    const contrib = od.isHalfDay ? 0.5 : 1;
    let d = new Date(extractISTComponents(od.fromDate).dateStr + 'T12:00:00Z');
    const odEnd = new Date(extractISTComponents(od.toDate).dateStr + 'T12:00:00Z');
    while (d <= odEnd) {
      const ds = toDateStr(d);
      if (ds >= startStr && ds <= endStr && !datesWithAttendance.has(ds)) odOnlyPresentDays += contrib;
      d.setDate(d.getDate() + 1);
    }
  }

  // Present days = attendance (PRESENT + HALF_DAY only) + all OD days (same as summary service)
  const manual = {
    totalDaysInMonth: getAllDatesInRange(startStr, endStr).length,
    totalPresentDays: Math.round((totalPresentDaysFromDailies + totalODDays) * 10) / 10,
    totalPayableShifts: Math.round((totalPayableShiftsFromDailies + odOnlyPresentDays) * 100) / 100,
    totalLeaves: Math.round(totalLeaveDays * 10) / 10,
    totalODs: Math.round(totalODDays * 10) / 10,
  };

  console.log('=== PERIOD 2026-01-26 .. 2026-02-25 ===\n');
  console.log('=== MANUAL CALC FROM RAW DATA ===');
  console.log('ODs in range:', ods.length, ods.map((o) => ({ d: toDateStr(o.fromDate), half: o.isHalfDay, type: o.odType_extended })));
  console.log('totalDaysInMonth:', manual.totalDaysInMonth);
  console.log('totalPresentDays:', manual.totalPresentDays);
  console.log('totalPayableShifts:', manual.totalPayableShifts);
  console.log('totalLeaves:', manual.totalLeaves);
  console.log('totalODs:', manual.totalODs);

  await MonthlyAttendanceSummary.deleteMany({ emp_no: empNo });
  console.log('\n=== RECALC VIA SERVICE (2026-02 and 2026-01) ===');
  await calculateMonthlySummary(emp._id, emp.emp_no, 2026, 2);
  await calculateMonthlySummary(emp._id, emp.emp_no, 2026, 1);

  const summary202602 = await MonthlyAttendanceSummary.findOne({ emp_no: empNo, month: '2026-02' }).lean();
  const summary202601 = await MonthlyAttendanceSummary.findOne({ emp_no: empNo, month: '2026-01' }).lean();
  const summary = summary202602 || summary202601;
  if (!summary) {
    console.log('No summary found for 272');
    await mongoose.disconnect();
    return;
  }

  const service = {
    month: summary.month,
    totalDaysInMonth: summary.totalDaysInMonth,
    totalPresentDays: summary.totalPresentDays,
    totalPayableShifts: summary.totalPayableShifts,
    totalLeaves: summary.totalLeaves,
    totalODs: summary.totalODs,
  };
  console.log('Summary month:', service.month);
  console.log('totalDaysInMonth:', service.totalDaysInMonth);
  console.log('totalPresentDays:', service.totalPresentDays);
  console.log('totalPayableShifts:', service.totalPayableShifts);
  console.log('totalLeaves:', service.totalLeaves);
  console.log('totalODs:', service.totalODs);

  console.log('\n=== DIFFERENCE (Manual - Service) ===');
  const diff = (a, b) => Math.round((a - b) * 100) / 100;
  console.log('totalDaysInMonth:', diff(manual.totalDaysInMonth, service.totalDaysInMonth));
  console.log('totalPresentDays:', diff(manual.totalPresentDays, service.totalPresentDays));
  console.log('totalPayableShifts:', diff(manual.totalPayableShifts, service.totalPayableShifts));
  console.log('totalLeaves:', diff(manual.totalLeaves, service.totalLeaves));
  console.log('totalODs:', diff(manual.totalODs, service.totalODs));

  const match =
    manual.totalDaysInMonth === service.totalDaysInMonth &&
    manual.totalPresentDays === service.totalPresentDays &&
    Math.abs(manual.totalPayableShifts - service.totalPayableShifts) < 0.01 &&
    manual.totalLeaves === service.totalLeaves &&
    manual.totalODs === service.totalODs;
  console.log(match ? '\n*** MATCH ***' : '\n*** MISMATCH ***');

  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
