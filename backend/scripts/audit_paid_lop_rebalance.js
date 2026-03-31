require('dotenv').config();
const mongoose = require('mongoose');
const Monthly = require('../attendance/model/MonthlyAttendanceSummary');
const LeaveRegisterYear = require('../leaves/model/LeaveRegisterYear');
const Employee = require('../employees/model/Employee');
const dateCycleService = require('../leaves/services/dateCycleService');

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hrms', {
    serverSelectionTimeoutMS: 8000,
  });

  const monthsToAuditEnv = process.env.MONTHS;
  const monthsToAudit = monthsToAuditEnv
    ? monthsToAuditEnv.split(',').map((m) => String(m).trim()).filter(Boolean)
    : ['2026-02', '2026-03'];
  const onlyEmpNo = process.env.EMP_NO ? String(process.env.EMP_NO).trim() : null;
  const summaryQuery = { month: { $in: monthsToAudit } };
  const summaries = await Monthly.find(summaryQuery).sort({ month: 1 }).limit(2000).lean();

  const mismatches = [];
  let checked = 0;

  for (const s of summaries) {
    const totalLeaves = round2(s.totalLeaves);
    if (totalLeaves <= 0) continue;

    const employeeId = s.employeeId || s.employee?._id;
    if (!employeeId) continue;
    if (onlyEmpNo && String(s.emp_no || '') !== onlyEmpNo) continue;

    const [year, month] = String(s.month).split('-').map(Number);
    const refDate = new Date(year, month - 1, 1);
    const fy = await dateCycleService.getFinancialYearForDate(refDate);

    const register = await LeaveRegisterYear.findOne({ employeeId, financialYear: fy.name }).lean();
    const slot = register?.months?.find(
      (m) => Number(m.payrollCycleMonth) === month && Number(m.payrollCycleYear) === year
    );
    if (!slot) continue;

    const clScheduled = Number(slot.clCredits) || 0;
    const clTxnCredits = (Array.isArray(slot.transactions) ? slot.transactions : [])
      .filter(
        (t) =>
          String(t.leaveType || '').toUpperCase() === 'CL' &&
          String(t.transactionType || '').toUpperCase() === 'CREDIT'
      )
      .reduce((sum, t) => sum + (Number(t.days) || 0), 0);
    const effectiveCl = Math.max(clScheduled, clTxnCredits);
    const cap = round2(effectiveCl + (Number(slot.compensatoryOffs) || 0));
    const expectedPaid = round2(Math.min(totalLeaves, cap));
    const expectedLop = round2(Math.max(0, totalLeaves - expectedPaid));
    const gotPaid = round2(s.totalPaidLeaves);
    const gotLop = round2(s.totalLopLeaves);
    checked += 1;

    const ok = Math.abs(gotPaid - expectedPaid) < 0.001 && Math.abs(gotLop - expectedLop) < 0.001;
    if (onlyEmpNo) {
      const emp = await Employee.findById(employeeId).select('emp_no employee_name').lean();
      console.log(
        JSON.stringify({
          month: s.month,
          empNo: emp?.emp_no || s.emp_no || 'NA',
          name: emp?.employee_name || 'NA',
          totalLeaves,
          cap,
          slot: {
            clCredits: round2(slot.clCredits),
            compensatoryOffs: round2(slot.compensatoryOffs),
            elCredits: round2(slot.elCredits),
            monthlyApplyCeiling: round2(slot.monthlyApplyCeiling),
            poolCarryForwardIn: {
              cl: round2(slot.poolCarryForwardIn?.cl),
              ccl: round2(slot.poolCarryForwardIn?.ccl),
              el: round2(slot.poolCarryForwardIn?.el),
            },
          },
          gotPaid,
          expectedPaid,
          gotLop,
          expectedLop,
          ok,
        })
      );
    }
    if (!ok) {
      const emp = await Employee.findById(employeeId).select('emp_no employee_name').lean();
      mismatches.push({
        month: s.month,
        empNo: emp?.emp_no || 'NA',
        name: emp?.employee_name || 'NA',
        totalLeaves,
        cap,
        gotPaid,
        expectedPaid,
        gotLop,
        expectedLop,
      });
    }
  }

  console.log(`AUDITED_MONTHS: ${monthsToAudit.join(', ')}`);
  console.log(`SUMMARIES_FETCHED: ${summaries.length}`);
  console.log(`SUMMARIES_CHECKED_WITH_LEAVES_AND_SLOT: ${checked}`);
  console.log(`MISMATCHES: ${mismatches.length}`);
  mismatches.slice(0, 30).forEach((m) => console.log(JSON.stringify(m)));

  await mongoose.disconnect();
}

run().catch(async (e) => {
  console.error('Audit failed:', e);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
