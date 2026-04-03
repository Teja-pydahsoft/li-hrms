/**
 * End-to-end debug: run dynamic regular + second salary for one employee with arrears/manual deductions,
 * then print PayrollPayslipSnapshot rows (regular vs second).
 *
 * Usage: node scripts/debug_dynamic_payroll_second_salary.js [YYYY-MM] [departmentNameSubstring]
 *
 * Requires .env MONGODB_URI. Uses first super_admin as userId.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

// Register refs used by Employee.populate('department_id designation_id division_id')
require('../departments/model/Department');
require('../departments/model/Division');
require('../departments/model/Designation');

const PayrollConfiguration = require('../payroll/model/PayrollConfiguration');
const Employee = require('../employees/model/Employee');
const User = require('../users/model/User');
const PayRegisterSummary = require('../pay-register/model/PayRegisterSummary');
const PayrollPayslipSnapshot = require('../payroll/model/PayrollPayslipSnapshot');
const ArrearsPayrollIntegrationService = require('../arrears/services/arrearsPayrollIntegrationService');
const DeductionPayrollIntegrationService = require('../manual-deductions/services/deductionPayrollIntegrationService');
const payrollCalculationFromOutputColumnsService = require('../payroll/services/payrollCalculationFromOutputColumnsService');
const { calculateSecondSalaryForPayRegister } = require('../payroll/services/secondSalaryCalculationService');

const MONTH = process.argv[2] || '2026-03';
const DEPT_HINT = (process.argv[3] || '').trim().toLowerCase();

function log(phase, msg, obj) {
  const t = new Date().toISOString();
  if (obj !== undefined) console.log(`[${t}] [${phase}]`, msg, JSON.stringify(obj, null, 2));
  else console.log(`[${t}] [${phase}]`, msg);
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI missing');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  log('db', 'connected');

  const config = await PayrollConfiguration.get();
  const cols = Array.isArray(config?.outputColumns) ? config.outputColumns : [];
  log('config', `outputColumns count = ${cols.length}`);
  if (cols.length === 0) {
    log('STOP', 'No output columns — regular payroll will use calculatePayrollNew, not dynamic. Add columns in Payroll Configuration.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const admin = await User.findOne({ role: 'super_admin' }).select('_id').lean();
  const userId = admin?._id;
  if (!userId) {
    log('STOP', 'No super_admin user found for userId');
    await mongoose.disconnect();
    process.exit(1);
  }
  log('user', `using super_admin ${userId}`);

  // Candidates: have pay register for month, second_salary > 0
  const prsList = await PayRegisterSummary.find({ month: MONTH }).select('employeeId').lean();
  const empIds = [...new Set(prsList.map((p) => String(p.employeeId)))];
  log('payregister', `summaries for ${MONTH}: ${empIds.length} distinct employees`);

  let chosen = null;
  for (const eid of empIds) {
    const emp = await Employee.findById(eid)
      .populate('department_id', 'name')
      .select('emp_no employee_name second_salary department_id division_id')
      .lean();
    if (!emp || Number(emp.second_salary) <= 0) continue;

    if (DEPT_HINT) {
      const deptName = (emp.department_id && emp.department_id.name) ? String(emp.department_id.name).toLowerCase() : '';
      if (!deptName.includes(DEPT_HINT)) continue;
    }

    const pendingArrears = await ArrearsPayrollIntegrationService.getPendingArrearsForPayroll(eid);
    const pendingDed = await DeductionPayrollIntegrationService.getPendingDeductionsForPayroll(eid);
    const arrSum = (pendingArrears || []).reduce((s, a) => s + (Number(a.remainingAmount) || 0), 0);
    const dedSum = (pendingDed || []).reduce((s, d) => s + (Number(d.remainingAmount) || 0), 0);

    if (arrSum <= 0 && dedSum <= 0) continue;

    chosen = {
      employeeId: eid,
      emp,
      arrearsSettlements: (pendingArrears || []).map((ar) => ({ arrearId: ar.id, amount: ar.remainingAmount || 0 })),
      deductionSettlements: (pendingDed || []).map((d) => ({ deductionId: d.id, amount: d.remainingAmount || 0 })),
      arrSum,
      dedSum,
    };
    break;
  }

  if (!chosen) {
    log(
      'STOP',
      `No employee found with: pay register ${MONTH}, second_salary>0, and (pending arrears OR pending manual deductions)${
        DEPT_HINT ? `, department name contains "${DEPT_HINT}"` : ''
      }`,
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  log('chosen', `${chosen.emp.emp_no} ${chosen.emp.employee_name} dept=${chosen.emp.department_id?.name}`, {
    second_salary: chosen.emp.second_salary,
    arrearsSettlements: chosen.arrearsSettlements,
    deductionSettlements: chosen.deductionSettlements,
    arrSum: chosen.arrSum,
    dedSum: chosen.dedSum,
  });

  const settlements = {
    arrearsSettlements: chosen.arrearsSettlements,
    deductionSettlements: chosen.deductionSettlements,
  };

  log('step1', 'calculatePayrollFromOutputColumns (regular, dynamic)');
  let regResult;
  try {
    regResult = await payrollCalculationFromOutputColumnsService.calculatePayrollFromOutputColumns(
      chosen.employeeId.toString(),
      MONTH,
      userId,
      { source: 'payregister', ...settlements }
    );
    log('step1', 'OK', {
      batchId: String(regResult.batchId || ''),
      payrollRecordId: String(regResult.payrollRecord?._id || ''),
      payslipArrears: regResult.payslip?.arrears,
      payslipManual: regResult.payslip?.manualDeductionsAmount,
      netSalary: regResult.payslip?.netSalary,
    });
  } catch (e) {
    log('step1', 'FAILED', { message: e.message, code: e.code, batchId: e.batchId });
    await mongoose.disconnect();
    process.exit(1);
  }

  log('step2', 'calculateSecondSalaryForPayRegister (regularUsedDynamicOutputColumns=true, same settlements)');
  let secResult;
  try {
    secResult = await calculateSecondSalaryForPayRegister(
      chosen.employeeId.toString(),
      MONTH,
      userId,
      'dynamic',
      null,
      settlements,
      { regularUsedDynamicOutputColumns: true }
    );
    log('step2', 'OK', {
      engine: secResult.engine,
      batchId: String(secResult.batchId || ''),
      secondSalaryRecordId: String(secResult.secondSalaryRecordId || ''),
      payslipArrears: secResult.payslip?.arrears,
      payslipManual: secResult.payslip?.manualDeductionsAmount,
      netSalary: secResult.netSalary,
    });
  } catch (e) {
    log('step2', 'FAILED', { message: e.message, code: e.code, batchId: e.batchId });
    await mongoose.disconnect();
    process.exit(1);
  }

  const snapReg = await PayrollPayslipSnapshot.findOne({
    employeeId: chosen.employeeId,
    month: MONTH,
    kind: 'regular',
  }).lean();
  const snapSec = await PayrollPayslipSnapshot.findOne({
    employeeId: chosen.employeeId,
    month: MONTH,
    kind: 'second_salary',
  }).lean();

  const pick = (row) =>
    row && {
      Arrears: row.Arrears,
      TotalDeductions: row['Total Deductions'],
      StatutoryDeductions: row['Statutory Deductions'],
      NetSalary: row['Net Salary'],
      GrossSalary: row['Gross Salary'],
    };

  log('snapshots', 'after calculation', {
    regular: snapReg ? { generatedAt: snapReg.generatedAt, ...pick(snapReg.row) } : null,
    second_salary: snapSec ? { generatedAt: snapSec.generatedAt, ...pick(snapSec.row) } : null,
  });

  const ra = snapReg?.row?.Arrears;
  const sa = snapSec?.row?.Arrears;
  if (snapReg && snapSec) {
    const match = Number(ra) === Number(sa);
    log('check', `Arrears column regular vs second snapshot match: ${match}`, { regular: ra, second: sa });
  } else {
    log('check', 'Missing snapshot', {
      hasRegularSnap: !!snapReg,
      hasSecondSnap: !!snapSec,
    });
  }

  await mongoose.disconnect();
  log('done', 'disconnect');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
