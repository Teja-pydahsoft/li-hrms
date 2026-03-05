/**
 * Read-only verification: week-offs and holidays are taken from shift roster in
 * - Monthly attendance summary (summaryCalculationService)
 * - Pay register totals (totalsCalculationService.ensureTotalsRespectRoster)
 *
 * Usage (from backend):
 *   node scripts/verify_wo_hol_from_roster.js
 *   MONTH=2026-02 node scripts/verify_wo_hol_from_roster.js
 *   MONTH=2026-02 SAMPLE=10 node scripts/verify_wo_hol_from_roster.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const dateCycleService = require('../leaves/services/dateCycleService');
const { getPayrollDateRange } = require('../shared/utils/dateUtils');
const { getRosterWOHOLCounts } = require('../pay-register/services/totalsCalculationService');
const PreScheduledShift = require('../shifts/model/PreScheduledShift');
const MonthlyAttendanceSummary = require('../attendance/model/MonthlyAttendanceSummary');
const PayRegisterSummary = require('../pay-register/model/PayRegisterSummary');

function extractDateStr(val) {
  if (!val) return '';
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10);
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);

  const month = process.env.MONTH || (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    console.error('Invalid MONTH (use YYYY-MM)');
    process.exit(1);
  }
  const [year, monthNum] = month.split('-').map(Number);
  const sampleSize = Math.max(1, parseInt(process.env.SAMPLE || '15', 10));

  // Period used by monthly summary (dateCycleService)
  const anchor = new Date(year, monthNum - 1, 15);
  const periodInfo = await dateCycleService.getPeriodInfo(anchor);
  const summaryStart = extractDateStr(periodInfo.payrollCycle.startDate);
  const summaryEnd = extractDateStr(periodInfo.payrollCycle.endDate);

  // Period used by pay register (getPayrollDateRange)
  const { startDate: prStart, endDate: prEnd } = await getPayrollDateRange(year, monthNum);

  console.log('=== WO/HOL from roster verification ===\n');
  console.log('Month:', month);
  console.log('Monthly summary period (dateCycleService):', summaryStart, '..', summaryEnd);
  console.log('Pay register period (getPayrollDateRange):', prStart, '..', prEnd);
  if (summaryStart !== prStart || summaryEnd !== prEnd) {
    console.log('(Note: period definitions differ; comparison uses each flow’s own period.)');
  }
  console.log('');

  // Employees that have either a monthly summary or pay register for this month
  const summaryEmpIds = (await MonthlyAttendanceSummary.find({ month }).select('employeeId emp_no').lean()).map(s => s.employeeId.toString());
  const prEmpIds = (await PayRegisterSummary.find({ month }).select('employeeId emp_no').lean()).map(p => p.employeeId.toString());
  const allIds = [...new Set([...summaryEmpIds, ...prEmpIds])];
  const sampleIds = allIds.slice(0, sampleSize);

  let summaryOk = 0, summaryFail = 0, summaryMissing = 0;
  let prOk = 0, prFail = 0, prMissing = 0;

  for (const empId of sampleIds) {
    const summary = await MonthlyAttendanceSummary.findOne({ employeeId: empId, month }).select('emp_no totalWeeklyOffs totalHolidays').lean();
    const pr = await PayRegisterSummary.findOne({ employeeId: empId, month }).select('emp_no startDate endDate totals').lean();

    const empNo = summary?.emp_no || pr?.emp_no;
    if (!empNo) continue;

    // Roster counts for monthly summary period (same as summaryCalculationService)
    const rosterForSummary = await getRosterWOHOLCounts(empNo, summaryStart, summaryEnd);
    const rosterWO = rosterForSummary.totalWeeklyOffs;
    const rosterHOL = rosterForSummary.totalHolidays;

    // Monthly summary check
    if (!summary) {
      summaryMissing++;
    } else {
      const match = summary.totalWeeklyOffs === rosterWO && summary.totalHolidays === rosterHOL;
      if (match) summaryOk++; else summaryFail++;
      if (!match) {
        console.log(`[Monthly Summary] emp_no=${empNo}: stored WO=${summary.totalWeeklyOffs} HOL=${summary.totalHolidays} | roster WO=${rosterWO} HOL=${rosterHOL} ${match ? 'OK' : 'MISMATCH'}`);
      }
    }

    // Roster counts for pay register period (same as ensureTotalsRespectRoster)
    const prStartStr = pr?.startDate ? extractDateStr(pr.startDate) : prStart;
    const prEndStr = pr?.endDate ? extractDateStr(pr.endDate) : prEnd;
    const rosterForPR = await getRosterWOHOLCounts(empNo, prStartStr, prEndStr);

    if (!pr) {
      prMissing++;
    } else {
      const tw = pr.totals?.totalWeeklyOffs ?? 0;
      const th = pr.totals?.totalHolidays ?? 0;
      const match = tw === rosterForPR.totalWeeklyOffs && th === rosterForPR.totalHolidays;
      if (match) prOk++; else prFail++;
      if (!match) {
        console.log(`[Pay Register]   emp_no=${empNo}: stored WO=${tw} HOL=${th} | roster WO=${rosterForPR.totalWeeklyOffs} HOL=${rosterForPR.totalHolidays} ${match ? 'OK' : 'MISMATCH'}`);
      }
    }
  }

  console.log('\n--- Result ---');
  console.log('Monthly summary: OK=', summaryOk, ' Mismatch=', summaryFail, ' No summary=', summaryMissing);
  console.log('Pay register:   OK=', prOk, ' Mismatch=', prFail, ' No register=', prMissing);
  if (summaryFail === 0 && prFail === 0) {
    console.log('\nRoster WO/HOL is correctly applied in both monthly summary and pay register.');
  } else {
    console.log('\nSome mismatches found. Fix: ensure summary recalc and pay register totals use roster (PreScheduledShift).');
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
