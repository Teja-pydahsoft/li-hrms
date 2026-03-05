/**
 * ============================================================
 * CONVERT ATTENDANCE DAILY: ROSTER WEEK-OFF → STATUS WEEK_OFF (PRESERVE PUNCHES)
 * ============================================================
 *
 * For each day where the shift roster has status WO (week off):
 * - If AttendanceDaily exists and is currently PRESENT / HALF_DAY / PARTIAL / etc.
 *   (i.e. not already WEEK_OFF), set status = WEEK_OFF and payableShifts = 0.
 * - Do NOT clear or overwrite shifts: punches and shift details are preserved.
 * - Present days / payable shifts will not include these days (same as holiday).
 *
 * Same idea as holiday: roster is source of truth; we mark the day as week off
 * but keep punch and shift data for record.
 *
 * Usage (from backend folder):
 *   node scripts/convert_wo_days_from_roster_preserve_punches.js   # default: Feb payroll period (e.g. 26 Jan–25 Feb)
 *   MONTH=2026-02 node scripts/convert_wo_days_from_roster_preserve_punches.js
 *   START=2026-01-26 END=2026-02-25 node scripts/convert_wo_days_from_roster_preserve_punches.js
 *
 * Env:
 *   MONTH  - YYYY-MM: use that month's payroll cycle (default when unset: current year Feb, e.g. 2026-02)
 *   START  - YYYY-MM-DD: override range start (use with END)
 *   END    - YYYY-MM-DD: override range end
 *   DRY=1  - only report what would be updated, do not save
 * ============================================================
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const PreScheduledShift = require('../shifts/model/PreScheduledShift');
const AttendanceDaily = require('../attendance/model/AttendanceDaily');
const { getPayrollDateRange } = require('../shared/utils/dateUtils');

function hasPunches(daily) {
  if (!daily) return false;
  if (daily.shifts && Array.isArray(daily.shifts) && daily.shifts.length > 0) {
    if (daily.shifts.some((s) => s && s.inTime)) return true;
  }
  return false;
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI not set in .env');
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.\n');

  let startDate, endDate;
  const envStart = process.env.START;
  const envEnd = process.env.END;
  if (envStart && envEnd && /^\d{4}-\d{2}-\d{2}$/.test(envStart) && /^\d{4}-\d{2}-\d{2}$/.test(envEnd)) {
    startDate = envStart;
    endDate = envEnd;
    console.log('Using date range from env: %s to %s\n', startDate, endDate);
  } else {
    let monthStr = process.env.MONTH;
    if (!monthStr || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthStr)) {
      // Default: February payroll period (e.g. 26 Jan–25 Feb)
      const year = new Date().getFullYear();
      monthStr = `${year}-02`;
      console.log('No MONTH/START/END set → using Feb period: %s\n', monthStr);
    }
    const [year, monthNum] = monthStr.split('-').map(Number);
    const range = await getPayrollDateRange(year, monthNum);
    startDate = range.startDate;
    endDate = range.endDate;
    console.log('Month %s → payroll cycle: %s to %s\n', monthStr, startDate, endDate);
  }

  const dryRun = process.env.DRY === '1';
  if (dryRun) console.log('DRY RUN: no changes will be saved.\n');

  // Roster entries with WO only (we are converting to week off; holiday is already handled similarly)
  const rosterWO = await PreScheduledShift.find({
    date: { $gte: startDate, $lte: endDate },
    status: 'WO',
  })
    .select('employeeNumber date')
    .lean();

  console.log('Roster WO entries in range: %s\n', rosterWO.length);
  if (rosterWO.length === 0) {
    console.log('Nothing to do.');
    await mongoose.disconnect();
    process.exit(0);
  }

  let updated = 0;
  let skippedAlreadyWO = 0;
  let skippedNoDaily = 0;

  for (const row of rosterWO) {
    const empNo = (row.employeeNumber && String(row.employeeNumber).trim())
      ? String(row.employeeNumber).trim().toUpperCase()
      : '';
    const dateStr = row.date && String(row.date).slice(0, 10);
    if (!empNo || !dateStr) continue;

    const daily = await AttendanceDaily.findOne({ employeeNumber: empNo, date: dateStr });
    if (!daily) {
      skippedNoDaily++;
      continue;
    }
    if (daily.status === 'WEEK_OFF') {
      skippedAlreadyWO++;
      continue;
    }

    if (dryRun) {
      console.log('[DRY] Would set WEEK_OFF | emp_no=%s date=%s current status=%s payableShifts=%s', empNo, dateStr, daily.status, daily.payableShifts);
      updated++;
      continue;
    }

    daily.status = 'WEEK_OFF';
    daily.payableShifts = 0;
    if (daily.totalWorkingHours > 0 || hasPunches(daily)) {
      const remark = 'Worked on Week Off';
      if (!daily.notes) daily.notes = remark;
      else if (!daily.notes.includes(remark)) daily.notes = `${daily.notes} | ${remark}`;
    }
    await daily.save();
    updated++;
  }

  console.log('Result:');
  console.log('  Updated to WEEK_OFF (shifts/punches preserved): %s', updated);
  console.log('  Skipped (already WEEK_OFF): %s', skippedAlreadyWO);
  console.log('  Skipped (no AttendanceDaily): %s', skippedNoDaily);
  if (dryRun && updated > 0) console.log('\nRe-run without DRY=1 to apply changes.');
  console.log('\nDone.\n');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
