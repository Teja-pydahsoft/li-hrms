/**
 * Single-Shift Detection Report
 * - Reads AttendanceRawLog and PreScheduledShift (roster) from backend DB
 * - Ensures mode = single_shift, strictCheckInOutOnly = false
 * - Runs shift detection and reports results + observations
 *
 * Usage: node scripts/run_single_shift_detection_report.js [START_DATE] [END_DATE]
 *   Dates YYYY-MM-DD. Default: last 7 days from today (IST).
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const { extractISTComponents } = require('../shared/utils/dateUtils');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/hrms';

function formatDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  return extractISTComponents(date).dateStr;
}

function getDefaultDateRange() {
  const today = new Date();
  const ist = extractISTComponents(today);
  const todayStr = ist.dateStr;
  const end = new Date(todayStr + 'T23:59:59+05:30');
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  return { startStr: formatDate(start), endStr: todayStr };
}

async function main() {
  const args = process.argv.slice(2);
  const startStr = args[0] || getDefaultDateRange().startStr;
  const endStr = args[1] || getDefaultDateRange().endStr;

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  SINGLE-SHIFT DETECTION REPORT');
  console.log('  Raw logs + Roster from backend DB → detect shifts → results');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log('  Date range:', startStr, '—', endStr);
  console.log('  DB:', (MONGODB_URI || '').replace(/:[^:@]+@/, ':***@'));
  console.log('');

  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('✅ Connected to MongoDB.\n');

  const AttendanceSettings = require('../attendance/model/AttendanceSettings');
  const AttendanceRawLog = require('../attendance/model/AttendanceRawLog');
  const AttendanceDaily = require('../attendance/model/AttendanceDaily');
  const PreScheduledShift = require('../shifts/model/PreScheduledShift');
  const Shift = require('../shifts/model/Shift');
  const Settings = require('../settings/model/Settings');
  const { processMultiShiftAttendance } = require('../attendance/services/multiShiftProcessingService');

  // ─── 1. Attendance settings: ensure single_shift + strict IN/OUT disabled ───
  let settings = await AttendanceSettings.getSettings();
  const beforeMode = settings?.processingMode?.mode || 'multi_shift';
  const beforeStrict = settings?.processingMode?.strictCheckInOutOnly !== false;

  console.log('─── Attendance Settings (before) ───');
  console.log('  mode:', beforeMode);
  console.log('  strictCheckInOutOnly:', beforeStrict);
  console.log('');

  if (beforeMode !== 'single_shift' || beforeStrict) {
    if (!settings.processingMode) settings.processingMode = {};
    settings.processingMode.mode = 'single_shift';
    settings.processingMode.strictCheckInOutOnly = false;
    await settings.save();
    console.log('  Updated to: mode = single_shift, strictCheckInOutOnly = false\n');
  } else {
    console.log('  Already single_shift with strict IN/OUT disabled.\n');
  }

  // ─── 2. Fetch raw logs from backend DB ───
  const startDate = new Date(startStr + 'T00:00:00+05:30');
  const endDate = new Date(endStr + 'T23:59:59+05:30');

  const rawLogsList = await AttendanceRawLog.find({
    timestamp: { $gte: startDate, $lte: endDate },
  })
    .sort({ timestamp: 1 })
    .lean();

  console.log('─── Attendance Raw Logs (backend DB) ───');
  console.log('  Total punches:', rawLogsList.length);
  const byType = { IN: 0, OUT: 0, null: 0 };
  rawLogsList.forEach((l) => {
    if (l.type === 'IN') byType.IN++;
    else if (l.type === 'OUT') byType.OUT++;
    else byType.null++;
  });
  console.log('  By type: IN', byType.IN, ', OUT', byType.OUT, ', null/other', byType.null);
  const empCount = new Set(rawLogsList.map((l) => (l.employeeNumber || '').toUpperCase()).filter(Boolean)).size;
  console.log('  Unique employees:', empCount);
  console.log('');

  // ─── 3. Fetch roster (PreScheduledShift) for same range ───
  const roster = await PreScheduledShift.find({
    date: { $gte: startStr, $lte: endStr },
  })
    .populate('shiftId', 'name startTime endTime')
    .lean();

  console.log('─── Shift Roster (PreScheduledShift) ───');
  console.log('  Roster entries:', roster.length);
  const rosterWithShift = roster.filter((r) => r.shiftId);
  const rosterWO = roster.filter((r) => r.status === 'WO');
  const rosterHOL = roster.filter((r) => r.status === 'HOL');
  console.log('  With shift assigned:', rosterWithShift.length);
  console.log('  Week-off (WO):', rosterWO.length, ', Holiday (HOL):', rosterHOL.length);
  if (rosterWithShift.length) {
    const shiftNames = [...new Set(rosterWithShift.map((r) => r.shiftId?.name).filter(Boolean))];
    console.log('  Shift names in roster:', shiftNames.join(', '));
  }
  console.log('');

  // ─── 4. Build date list and group logs by employee ───
  const dates = [];
  for (let d = new Date(startStr); d <= new Date(endStr + 'T12:00:00'); ) {
    dates.push(formatDate(d));
    d.setDate(d.getDate() + 1);
  }

  const logsByEmp = {};
  for (const log of rawLogsList) {
    const emp = (log.employeeNumber || '').toUpperCase().trim();
    if (!emp) continue;
    const d = formatDate(log.timestamp);
    if (d < startStr || d > endStr) continue;
    if (!logsByEmp[emp]) logsByEmp[emp] = [];
    logsByEmp[emp].push({
      timestamp: log.timestamp,
      type: log.type,
      punch_state: log.type === 'IN' ? 0 : log.type === 'OUT' ? 1 : null,
      _id: log._id,
    });
  }
  for (const emp of Object.keys(logsByEmp)) {
    logsByEmp[emp].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  const generalConfig = (await Settings.getSettingsByCategory?.('general')) || {};

  // ─── 5. Run single-shift detection for each employee+date ───
  console.log('─── Running single-shift detection (strict IN/OUT disabled) ───\n');

  const results = [];
  let processed = 0;
  let errors = 0;

  for (const empNo of Object.keys(logsByEmp)) {
    const allLogs = logsByEmp[empNo];
    for (const date of dates) {
      const hasPunch = allLogs.some((l) => formatDate(l.timestamp) === date);
      if (!hasPunch) continue;

      try {
        const result = await processMultiShiftAttendance(empNo, date, allLogs, generalConfig);
        if (result && result.success) {
          processed++;
          const dr = result.dailyRecord;
          const shiftCount = dr?.shifts?.length ?? 0;
          const status = dr?.status ?? '-';
          const totalHours = dr?.totalWorkingHours ?? 0;
          const payable = dr?.payableShifts ?? 0;
          const firstShift = dr?.shifts?.[0];
          const inTime = firstShift?.inTime ? new Date(firstShift.inTime).toLocaleTimeString('en-IN', { hour12: false }) : '-';
          const outTime = firstShift?.outTime ? new Date(firstShift.outTime).toLocaleTimeString('en-IN', { hour12: false }) : firstShift ? 'pending' : '-';
          const shiftName = firstShift?.shiftName ?? '-';
          results.push({
            empNo,
            date,
            status,
            shiftCount,
            totalHours,
            payableShifts: payable,
            inTime,
            outTime,
            shiftName,
            isPartial: status === 'PARTIAL',
          });
        } else {
          errors++;
          results.push({ empNo, date, error: result?.error || 'no success' });
        }
      } catch (err) {
        errors++;
        results.push({ empNo, date, error: err.message });
      }
    }
  }

  // ─── 6. Print results table ───
  console.log('─── Detection results ───');
  console.log('  Processed:', processed, 'employee-days | Errors:', errors);
  console.log('');
  console.log('  EmpNo      | Date       | Status   | Shifts | In      | Out     | Hours | Payable | Shift');
  console.log('  -----------|------------|----------|--------|--------|--------|-------|---------|------');
  results
    .filter((r) => !r.error)
    .forEach((r) => {
      const emp = (r.empNo || '').padEnd(10);
      const date = (r.date || '').padEnd(10);
      const status = (r.status || '-').padEnd(8);
      const shifts = String(r.shiftCount ?? 0).padStart(6);
      const inT = (r.inTime || '-').padEnd(6);
      const outT = (r.outTime || '-').padEnd(6);
      const hours = (String(r.totalHours ?? 0)).padStart(5);
      const pay = (String(r.payableShifts ?? 0)).padStart(7);
      const name = (r.shiftName || '-').substring(0, 12);
      console.log(`  ${emp} | ${date} | ${status} | ${shifts} | ${inT} | ${outT} | ${hours} | ${pay} | ${name}`);
    });
  if (errors) {
    console.log('\n  Errors:');
    results.filter((r) => r.error).forEach((r) => console.log('   ', r.empNo, r.date, r.error));
  }
  console.log('');

  // ─── 7. Observations ───
  const byStatus = {};
  results.filter((r) => !r.error).forEach((r) => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
  const partialCount = results.filter((r) => r.isPartial).length;
  const presentCount = byStatus.PRESENT || 0;
  const absentCount = byStatus.ABSENT || 0;
  const halfDayCount = byStatus.HALF_DAY || 0;

  console.log('─── Observations ───');
  console.log('  • Mode: single_shift (one shift per day: first IN, last OUT).');
  console.log('  • strictCheckInOutOnly: false → logs with type null can still pair as IN/OUT by position.');
  console.log('  • Status breakdown: PRESENT', presentCount, ', PARTIAL', partialCount, ', HALF_DAY', halfDayCount, ', ABSENT', absentCount);
  if (partialCount) {
    console.log('  • PARTIAL = only IN (no OUT yet); when OUT arrives, re-run will set PRESENT/HALF_DAY/ABSENT.');
  }
  console.log('  • Roster is used by shift detection to assign shift (and for roster-strict when enabled).');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════\n');

  await mongoose.disconnect();
  console.log('Done. DB disconnected.');
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
