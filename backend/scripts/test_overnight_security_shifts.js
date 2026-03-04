/**
 * Test overnight shifts: A-Security, B-Security, C-Security
 * - Fetches these shifts from DB (by name pattern)
 * - Gets roster + raw logs for employees on those shifts
 * - Runs single-shift detection and reports if IN/OUT pairing is correct for overnight
 *
 * Usage: node scripts/test_overnight_security_shifts.js [START_DATE] [END_DATE] [EMP_NO]
 *   EMP_NO optional: test only this employee (e.g. 2118 for C-SECURITY overnight).
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const { extractISTComponents } = require('../shared/utils/dateUtils');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/hrms';

function formatDate(d) {
  return extractISTComponents(d instanceof Date ? d : new Date(d)).dateStr;
}

function timeStr(d) {
  const x = d instanceof Date ? d : new Date(d);
  return x.toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' });
}

async function main() {
  const args = process.argv.slice(2);
  const startStr = args[0] || formatDate(new Date());
  const endStr = args[1] || startStr;
  const filterEmpNo = args[2] ? String(args[2]).toUpperCase() : null;

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  OVERNIGHT SECURITY SHIFTS TEST (A-Security, B-Security, C-Security)');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log('  Date range:', startStr, '—', endStr);
  console.log('');

  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('✅ Connected to MongoDB.\n');

  const Shift = require('../shifts/model/Shift');
  const PreScheduledShift = require('../shifts/model/PreScheduledShift');
  const AttendanceRawLog = require('../attendance/model/AttendanceRawLog');
  const AttendanceSettings = require('../attendance/model/AttendanceSettings');
  const Settings = require('../settings/model/Settings');
  const { processMultiShiftAttendance } = require('../attendance/services/multiShiftProcessingService');

  // 1. Find security shifts (A-Security, B-Security, C-Security or name containing "security")
  const securityShifts = await Shift.find({
    name: { $regex: /security/i },
    isActive: true,
  }).lean();
  console.log('─── Security shifts in DB ───');
  if (securityShifts.length === 0) {
    console.log('  No shifts with name containing "security" found.');
    await mongoose.disconnect();
    return;
  }
  securityShifts.forEach((s) => {
    const startM = (s.startTime || '').split(':').map(Number);
    const endM = (s.endTime || '').split(':').map(Number);
    const startMins = (startM[0] || 0) * 60 + (startM[1] || 0);
    const endMins = (endM[0] || 0) * 60 + (endM[1] || 0);
    const overnight = endMins <= startMins || (startMins >= 20 * 60 && endMins < 12 * 60);
    console.log(`  ${s.name}: ${s.startTime} – ${s.endTime} (${s.duration}h) ${overnight ? ' [OVERNIGHT]' : ''}`);
  });
  console.log('');

  const securityShiftIds = securityShifts.map((s) => s._id);
  const overnightShiftIds = securityShifts.filter((s) => {
    const [sh, sm] = (s.startTime || '0:0').split(':').map(Number);
    const [eh, em] = (s.endTime || '0:0').split(':').map(Number);
    const smin = sh * 60 + sm;
    const emin = eh * 60 + em;
    return emin <= smin || (smin >= 20 * 60 && emin < 12 * 60);
  }).map((s) => s._id.toString());

  // 2. Roster: employees on these shifts in date range
  const roster = await PreScheduledShift.find({
    shiftId: { $in: securityShiftIds },
    date: { $gte: startStr, $lte: endStr },
  })
    .populate('shiftId', 'name startTime endTime duration')
    .lean();

  console.log('─── Roster entries (security shifts) ───');
  console.log('  Count:', roster.length);

  let empDates = new Map();
  if (roster.length > 0) {
    roster.forEach((r) => {
      const emp = (r.employeeNumber || '').toUpperCase();
      if (!emp) return;
      if (!empDates.has(emp)) empDates.set(emp, []);
      const dates = empDates.get(emp);
      if (!dates.includes(r.date)) dates.push(r.date);
    });
  }

  const startDate = new Date(startStr + 'T00:00:00+05:30');
  const endDate = new Date(endStr + 'T23:59:59+05:30');

  // If no roster: find employees with raw logs that span two days (possible overnight) in range
  if (empDates.size === 0) {
    console.log('  No roster in range. Looking for raw logs that span midnight (overnight-style)...');
    const allLogsInRange = await AttendanceRawLog.find({
      timestamp: { $gte: startDate, $lte: endDate },
    }).sort({ employeeNumber: 1, timestamp: 1 }).lean();
    const nextDayEnd = new Date(endStr + 'T23:59:59+05:30');
    nextDayEnd.setDate(nextDayEnd.getDate() + 1);
    const logsNextDay = await AttendanceRawLog.find({
      timestamp: { $gte: new Date(startStr + 'T00:00:00+05:30'), $lte: nextDayEnd },
    }).lean();
    const byEmpDate = new Map();
    allLogsInRange.forEach((l) => {
      const e = (l.employeeNumber || '').toUpperCase();
      const d = formatDate(l.timestamp);
      if (!byEmpDate.has(e)) byEmpDate.set(e, new Set());
      byEmpDate.get(e).add(d);
    });
    const employeesWithTwoDays = [];
    byEmpDate.forEach((dates, emp) => {
      const arr = [...dates].sort();
      for (let i = 1; i < arr.length; i++) {
        const prev = new Date(arr[i - 1]);
        const curr = new Date(arr[i]);
        if ((curr - prev) / (24 * 60 * 60 * 1000) === 1) {
          employeesWithTwoDays.push({ emp, date: arr[i - 1] });
          break;
        }
      }
    });
    employeesWithTwoDays.slice(0, 30).forEach(({ emp, date }) => {
      if (!empDates.has(emp)) empDates.set(emp, []);
      if (!empDates.get(emp).includes(date)) empDates.get(emp).push(date);
    });
    if (empDates.size === 0 && !filterEmpNo) {
      console.log('  No employees with consecutive-day punches found. Exiting.');
      await mongoose.disconnect();
      return;
    }
    if (empDates.size > 0) console.log('  Using employees with punches on consecutive days for test:', empDates.size);
  }
  if (filterEmpNo) {
    const datesInRange = [];
    for (let d = new Date(startStr); d <= new Date(endStr + 'T12:00:00'); d.setDate(d.getDate() + 1)) {
      datesInRange.push(formatDate(d));
    }
    empDates.set(filterEmpNo, datesInRange);
    console.log('  Filtering to emp', filterEmpNo, '; dates in range:', datesInRange.length);
  }
  const employees = [...empDates.keys()];
  console.log('  Unique employees to check:', employees.length);
  console.log('');

  // 3. Ensure single_shift + strict disabled
  let settings = await AttendanceSettings.getSettings();
  if (!settings.processingMode) settings.processingMode = {};
  settings.processingMode.mode = 'single_shift';
  settings.processingMode.strictCheckInOutOnly = false;
  await settings.save();

  const endDatePlusOne = new Date(endDate);
  endDatePlusOne.setDate(endDatePlusOne.getDate() + 1);

  // 4. Fetch raw logs for these employees (date range + next day for overnight OUT)
  const rawLogs = await AttendanceRawLog.find({
    employeeNumber: { $in: employees },
    timestamp: { $gte: startDate, $lte: endDatePlusOne },
  })
    .sort({ employeeNumber: 1, timestamp: 1 })
    .lean();

  console.log('─── Raw logs (security employees, date range + next day) ───');
  console.log('  Total punches:', rawLogs.length);
  const byEmp = {};
  rawLogs.forEach((l) => {
    const e = (l.employeeNumber || '').toUpperCase();
    if (!byEmp[e]) byEmp[e] = [];
    byEmp[e].push(l);
  });
  console.log('');

  const generalConfig = (await Settings.getSettingsByCategory?.('general')) || {};

  // 5. For each employee+date with security roster, show raw punches and run detection
  console.log('─── Per employee/date: raw punches vs detected IN/OUT ───\n');

  let issues = 0;
  for (const empNo of employees) {
    const dates = empDates.get(empNo) || [];
    const logs = byEmp[empNo] || [];
    for (const date of dates.sort()) {
      const rosterEntry = roster.find((r) => r.employeeNumber === empNo && r.date === date);
      const shift = rosterEntry?.shiftId;
      const shiftName = shift?.name || '-';
      const shiftStart = shift?.startTime || '-';
      const shiftEnd = shift?.endTime || '-';

      const nextDayStr = (() => {
        const d = new Date(date + 'T12:00:00+05:30');
        d.setDate(d.getDate() + 1);
        return formatDate(d);
      })();
      const nextDay = nextDayStr;
      const dayLogs = logs.filter((l) => {
        const d = formatDate(l.timestamp);
        return d === date || d === nextDay;
      });
      if (dayLogs.length === 0) continue;

      const allLogsForProc = logs.map((l) => ({
        timestamp: l.timestamp,
        type: l.type,
        punch_state: l.type === 'IN' ? 0 : l.type === 'OUT' ? 1 : null,
        _id: l._id,
      }));

      const result = await processMultiShiftAttendance(empNo, date, allLogsForProc, generalConfig);
      const dr = result?.dailyRecord;
      const s1 = dr?.shifts?.[0];
      const detIn = s1?.inTime ? timeStr(s1.inTime) : '-';
      const detOut = s1?.outTime ? timeStr(s1.outTime) : '-';
      const status = dr?.status ?? '-';
      const assignedName = s1?.shiftName ?? '-';

      const overnightShift = shiftStart && shiftEnd && (() => {
        const [sh, sm] = (shiftStart || '0:0').split(':').map(Number);
        const [eh, em] = (shiftEnd || '0:0').split(':').map(Number);
        const smin = sh * 60 + sm;
        const emin = eh * 60 + em;
        return emin <= smin || (smin >= 20 * 60 && emin < 12 * 60);
      })();

      console.log(`  Emp ${empNo} | ${date} | Shift: ${shiftName} (${shiftStart}–${shiftEnd}) ${overnightShift ? '[OVERNIGHT]' : ''}`);
      console.log('    Raw punches:');
      dayLogs.forEach((p) => {
        const d = formatDate(p.timestamp);
        const t = timeStr(p.timestamp);
        console.log(`      ${d} ${t}  type=${p.type ?? 'null'}`);
      });
      console.log(`    Detected: IN=${detIn}  OUT=${detOut}  status=${status}  assigned=${assignedName}`);

      if (overnightShift) {
        const outOnNextDay = s1?.outTime && formatDate(s1.outTime) === nextDay;
        if (!s1?.outTime) {
          console.log('    ⚠ OUT missing for overnight shift (expected OUT next day at shift end)');
          issues++;
        } else if (!outOnNextDay && status !== 'PARTIAL') {
          const outDate = s1.outTime ? formatDate(s1.outTime) : '';
          if (outDate !== date && outDate !== nextDay) {
            console.log('    ⚠ Overnight: OUT date is ' + outDate + ' (expected ' + nextDay + ')');
            issues++;
          }
        }
      }
      console.log('');
    }
  }

  console.log('─── Summary ───');
  console.log('  Security shifts:', securityShifts.map((s) => s.name).join(', '));
  console.log('  Employees checked:', employees.length);
  if (issues > 0) console.log('  Issues noted:', issues);
  console.log('\n═══════════════════════════════════════════════════════════════\n');

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
