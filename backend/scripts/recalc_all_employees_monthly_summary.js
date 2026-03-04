/**
 * Recalculate monthly summary for ALL active employees for a given month.
 * Populates totalDaysInMonth (pay period length), totalWeeklyOffs, totalHolidays,
 * totalPresentDays, totalPayableShifts, etc., so you can verify the monthly summary.
 *
 * Usage (from backend folder):
 *   node scripts/recalc_all_employees_monthly_summary.js
 *   MONTH=2026-02 node scripts/recalc_all_employees_monthly_summary.js
 *   CLEAR_FIRST=1 node scripts/recalc_all_employees_monthly_summary.js   # delete ALL summaries then recalc for MONTH (or current month)
 *   CLEAR_FIRST=1 MONTH=2025-03 node scripts/recalc_all_employees_monthly_summary.js
 *
 * MONTH = YYYY-MM (calendar month). Pay period is resolved from payroll settings
 * (e.g. 26th–25th or 1st–31st) so the summary reflects the correct cycle.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { calculateAllEmployeesSummary, deleteAllMonthlySummaries } = require('../attendance/services/summaryCalculationService');

async function run() {
  try {
    console.log('Connecting to MongoDB...');
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected.\n');

    let monthStr = process.env.MONTH;
    if (!monthStr || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthStr)) {
      const now = new Date();
      monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      console.log('Using current month:', monthStr);
    } else {
      console.log('Using MONTH:', monthStr);
    }
    const [year, monthNumber] = monthStr.split('-').map(Number);

    const clearFirst = process.env.CLEAR_FIRST === '1' || process.env.CLEAR_FIRST === 'true';
    if (clearFirst) {
      console.log('CLEAR_FIRST=1: Deleting ALL monthly attendance summaries...');
      const { deletedCount } = await deleteAllMonthlySummaries();
      console.log('Deleted', deletedCount, 'summary/summaries.\n');
    }

    console.log('\nRecalculating monthly summary for ALL active employees...');
    console.log('Year:', year, 'Month:', monthNumber, '(' + monthStr + ')\n');

    const results = await calculateAllEmployeesSummary(year, monthNumber);

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    console.log('\n--- Done ---');
    console.log('Total:', results.length, '| Success:', successCount, '| Failed:', failureCount);

    if (failureCount > 0) {
      console.log('\nFailed employees:');
      results.filter((r) => !r.success).forEach((r) => console.log('  ', r.employee, r.error));
    }

    if (successCount > 0 && results[0].summary) {
      const s = results.find((r) => r.success)?.summary;
      console.log('\nSample summary (first success):', s?.emp_no, {
        month: s?.month,
        totalDaysInMonth: s?.totalDaysInMonth,
        totalWeeklyOffs: s?.totalWeeklyOffs,
        totalHolidays: s?.totalHolidays,
        totalPresentDays: s?.totalPresentDays,
        totalPayableShifts: s?.totalPayableShifts,
      });
    }

    console.log('\nYou can verify via GET /api/attendance/monthly-summary?month=' + monthStr);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();
