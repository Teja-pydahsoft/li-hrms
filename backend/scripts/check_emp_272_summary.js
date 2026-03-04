/**
 * Fetch OD, Leave, AttendanceDaily for emp 272 in Feb 2026 pay period and compare with summary.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const OD = require('../leaves/model/OD');
const Leave = require('../leaves/model/Leave');
const AttendanceDaily = require('../attendance/model/AttendanceDaily');
const Employee = require('../employees/model/Employee');
const MonthlyAttendanceSummary = require('../attendance/model/MonthlyAttendanceSummary');

const empNo = '272';
const startStr = '2026-01-26';
const endStr = '2026-02-25';
const startDate = new Date(startStr + 'T00:00:00+05:30');
const endDate = new Date(endStr + 'T23:59:59+05:30');

function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
    fromDate: { $lte: endDate },
    toDate: { $gte: startDate },
  })
    .select('fromDate toDate isHalfDay halfDayType odType_extended')
    .lean();

  const leaves = await Leave.find({
    employeeId: emp._id,
    status: 'approved',
    isActive: true,
    fromDate: { $lte: endDate },
    toDate: { $gte: startDate },
  })
    .select('fromDate toDate isHalfDay')
    .lean();

  const dailies = await AttendanceDaily.find({
    employeeNumber: empNo.toUpperCase(),
    date: { $gte: startStr, $lte: endStr },
  })
    .select('date status payableShifts shifts')
    .lean();

  const summary = await MonthlyAttendanceSummary.findOne({
    emp_no: empNo,
    month: '2026-02',
  }).lean();

  console.log('=== OD RECORDS (approved, in range 2026-01-26 to 2026-02-25) ===');
  console.log('Count:', ods.length);
  ods.forEach((od, i) => {
    console.log(
      `  ${i + 1}. ${dateStr(od.fromDate)} to ${dateStr(od.toDate)} | isHalfDay: ${od.isHalfDay} | halfDayType: ${od.halfDayType || '-'} | odType_extended: ${od.odType_extended || '-'}`
    );
  });

  console.log('\n=== LEAVE RECORDS (approved, in range) ===');
  console.log('Count:', leaves.length);
  leaves.forEach((l, i) => {
    console.log(`  ${i + 1}. ${dateStr(l.fromDate)} to ${dateStr(l.toDate)} | isHalfDay: ${l.isHalfDay}`);
  });

  console.log('\n=== ATTENDANCE DAILIES (date | status | payableShifts) ===');
  let fromDailiesPresent = 0;
  let fromDailiesPayable = 0;
  dailies.forEach((d) => {
    const p = d.status === 'PRESENT' || d.status === 'PARTIAL' ? 1 : d.status === 'HALF_DAY' ? 0.5 : 0;
    const pay = Number(d.payableShifts) || 0;
    fromDailiesPresent += p;
    fromDailiesPayable += pay;
    console.log(`  ${d.date} | ${d.status} | payableShifts: ${d.payableShifts}`);
  });
  console.log('Count:', dailies.length);
  console.log('Sum from dailies: presentDays =', fromDailiesPresent, ', payableShifts =', fromDailiesPayable);

  // Manual OD days count (same logic as summary: each day in range, half=0.5 full=1, skip hours)
  let manualODDays = 0;
  for (const od of ods) {
    if (od.odType_extended === 'hours') continue;
    const odStart = new Date(od.fromDate);
    const odEnd = new Date(od.toDate);
    let d = new Date(odStart.getFullYear(), odStart.getMonth(), odStart.getDate());
    const endD = new Date(odEnd.getFullYear(), odEnd.getMonth(), odEnd.getDate());
    while (d <= endD) {
      const ds = dateStr(d);
      if (ds >= startStr && ds <= endStr) manualODDays += od.isHalfDay ? 0.5 : 1;
      d.setDate(d.getDate() + 1);
    }
  }
  console.log('\n=== MANUAL CALC FROM RAW DATA ===');
  console.log('OD days (from OD records in range):', manualODDays);
  console.log('Present days (from dailies only):', fromDailiesPresent);
  console.log('Payable shifts (from dailies only):', fromDailiesPayable);

  // OD-only days: dates that have OD but no attendance record
  const datesWithAttendance = new Set(dailies.map((r) => r.date));
  let odOnlyPresent = 0;
  for (const od of ods) {
    if (od.odType_extended === 'hours') continue;
    const contrib = od.isHalfDay ? 0.5 : 1;
    let d = new Date(od.fromDate);
    const odEnd = new Date(od.toDate);
    while (d <= odEnd) {
      const ds = dateStr(d);
      if (ds >= startStr && ds <= endStr && !datesWithAttendance.has(ds)) odOnlyPresent += contrib;
      d.setDate(d.getDate() + 1);
    }
  }
  console.log('OD-only present (days with OD but no daily):', odOnlyPresent);
  console.log('Expected total present = from dailies + OD-only =', fromDailiesPresent + odOnlyPresent);
  console.log('Expected total payable = from dailies + OD-only =', fromDailiesPayable + odOnlyPresent);

  console.log('\n=== STORED SUMMARY (2026-02) ===');
  if (summary) {
    console.log('totalPresentDays:', summary.totalPresentDays);
    console.log('totalPayableShifts:', summary.totalPayableShifts);
    console.log('totalODs:', summary.totalODs);
    console.log('totalLeaves:', summary.totalLeaves);
  } else {
    console.log('No summary found');
  }

  console.log('\n=== COMPARISON ===');
  if (summary) {
    const expectedPresent = fromDailiesPresent + odOnlyPresent;
    const expectedPayable = fromDailiesPayable + odOnlyPresent;
    console.log('totalODs: stored =', summary.totalODs, '| expected from OD records =', manualODDays, summary.totalODs === manualODDays ? 'OK' : 'MISMATCH');
    console.log('totalPresentDays: stored =', summary.totalPresentDays, '| expected =', expectedPresent, summary.totalPresentDays === expectedPresent ? 'OK' : 'MISMATCH');
    console.log('totalPayableShifts: stored =', summary.totalPayableShifts, '| expected =', expectedPayable, Math.abs((summary.totalPayableShifts || 0) - expectedPayable) < 0.01 ? 'OK' : 'MISMATCH');
  }

  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
