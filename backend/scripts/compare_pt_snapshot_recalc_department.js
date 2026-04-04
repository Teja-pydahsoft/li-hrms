/**
 * For one department + month: read PayrollPayslipSnapshot PT (before), recalculate dynamic payroll,
 * compare PT after vs before and print slab-base context (configured PT earnings column vs prorated basic).
 *
 * Usage: node scripts/compare_pt_snapshot_recalc_department.js [YYYY-MM] [departmentNameSubstring] [maxEmployees]
 *
 * Requires .env MONGODB_URI. Uses first super_admin as userId.
 * May fail with BATCH_LOCKED if payroll batch is frozen/approved without recalc permission.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

require('../departments/model/Department');
require('../departments/model/Division');
require('../departments/model/Designation');

const PayrollConfiguration = require('../payroll/model/PayrollConfiguration');
const StatutoryDeductionConfig = require('../payroll/model/StatutoryDeductionConfig');
const Employee = require('../employees/model/Employee');
const User = require('../users/model/User');
const PayRegisterSummary = require('../pay-register/model/PayRegisterSummary');
const PayrollPayslipSnapshot = require('../payroll/model/PayrollPayslipSnapshot');
const payrollCalculationFromOutputColumnsService = require('../payroll/services/payrollCalculationFromOutputColumnsService');

const MONTH = process.argv[2] || '2026-03';
const DEPT_HINT = (process.argv[3] || '').trim().toLowerCase();
const MAX_EMP = Math.max(1, parseInt(process.argv[4] || '200', 10) || 200);

function ptFromRow(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.PT !== undefined && row.PT !== '') return Number(row.PT);
  for (const k of Object.keys(row)) {
    if (String(k).trim().toUpperCase() === 'PT') return Number(row[k]);
  }
  return null;
}

function ptFromPayslip(payslip) {
  const list = payslip?.deductions?.statutoryDeductions;
  if (!Array.isArray(list)) return null;
  const item = list.find((s) => s && (String(s.code).toUpperCase() === 'PT' || String(s.name).toUpperCase().includes('PROFESSION')));
  return item ? Number(item.employeeAmount) : null;
}

function slabBaseFromSnapshotRow(row, header) {
  if (!header || !row || typeof row !== 'object') return null;
  const h = String(header).trim();
  if (!h) return null;
  if (Object.prototype.hasOwnProperty.call(row, h)) {
    const v = row[h];
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI missing in backend/.env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected. Month:', MONTH, DEPT_HINT ? `dept hint: "${DEPT_HINT}"` : '(first department with pay register)');

  const config = await PayrollConfiguration.get();
  const cols = Array.isArray(config?.outputColumns) ? config.outputColumns : [];
  if (cols.length === 0) {
    console.error('No output columns — not using dynamic engine. Configure Payroll → output columns first.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const ptSlabHeader = String(config.professionTaxSlabEarningsColumnHeader || '').trim();
  console.log('\n--- Payroll config (PT-related) ---');
  console.log('professionTaxSlabEarningsColumnHeader:', ptSlabHeader || '(empty → slab from prorated basic)');
  console.log('statutoryProratePaidDaysColumnHeader:', config.statutoryProratePaidDaysColumnHeader || '(auto)');
  console.log('statutoryProrateTotalDaysColumnHeader:', config.statutoryProrateTotalDaysColumnHeader || '(auto)');

  const statCfg = await StatutoryDeductionConfig.get().catch(() => null);
  const ptEnabled = statCfg?.professionTax?.enabled;
  console.log('Statutory PT enabled:', ptEnabled);
  if (ptEnabled && Array.isArray(statCfg.professionTax.slabs)) {
    console.log('PT slabs (min → amount):', statCfg.professionTax.slabs.map((s) => `${s.min}-${s.max ?? '∞'}:${s.amount}`).join(' | '));
  }

  const admin = await User.findOne({ role: 'super_admin' }).select('_id').lean();
  const userId = admin?._id;
  if (!userId) {
    console.error('No super_admin user');
    await mongoose.disconnect();
    process.exit(1);
  }

  const prsList = await PayRegisterSummary.find({ month: MONTH }).select('employeeId').lean();
  const empIdSet = [...new Set(prsList.map((p) => String(p.employeeId)))];
  if (empIdSet.length === 0) {
    console.error('No PayRegisterSummary for month', MONTH);
    await mongoose.disconnect();
    process.exit(1);
  }

  const employees = await Employee.find({ _id: { $in: empIdSet } })
    .populate('department_id', 'name')
    .select('emp_no employee_name department_id division_id')
    .lean();

  const byDept = new Map();
  for (const emp of employees) {
    const dept = emp.department_id;
    const deptId = dept?._id ? String(dept._id) : '';
    const deptName = (dept && dept.name) ? String(dept.name) : '';
    if (!deptId) continue;
    if (DEPT_HINT && !deptName.toLowerCase().includes(DEPT_HINT)) continue;
    if (!byDept.has(deptId)) byDept.set(deptId, { name: deptName, employees: [] });
    byDept.get(deptId).employees.push(emp);
  }

  if (byDept.size === 0) {
    console.error('No employees with pay register for month after department filter.');
    await mongoose.disconnect();
    process.exit(1);
  }

  let chosen = null;
  let bestCount = 0;
  for (const [, v] of byDept) {
    if (v.employees.length > bestCount) {
      bestCount = v.employees.length;
      chosen = v;
    }
  }

  console.log('\n--- Selected department ---');
  const empAll = chosen.employees.length;
  chosen.employees = chosen.employees.slice(0, MAX_EMP);
  console.log(chosen.name, `(${empAll} with pay register; processing ${chosen.employees.length}${empAll > chosen.employees.length ? `, cap=${MAX_EMP}` : ''})`);

  const results = [];
  for (const emp of chosen.employees) {
    const eid = emp._id.toString();
    const snap = await PayrollPayslipSnapshot.findOne({
      employeeId: emp._id,
      month: MONTH,
      kind: 'regular',
    }).lean();

    const beforePt = snap ? ptFromRow(snap.row) : null;
    const beforeSlabCol = snap && ptSlabHeader ? slabBaseFromSnapshotRow(snap.row, ptSlabHeader) : null;
    const snapAt = snap?.generatedAt || null;

    let afterPt = null;
    let err = null;
    try {
      const calc = await payrollCalculationFromOutputColumnsService.calculatePayrollFromOutputColumns(eid, MONTH, userId, {});
      afterPt = ptFromPayslip(calc.payslip);
    } catch (e) {
      err = e.message || String(e);
      if (e.code) err = `${err} [${e.code}]`;
    }

    results.push({
      emp_no: emp.emp_no,
      name: emp.employee_name,
      hadSnapshot: !!snap,
      snapGeneratedAt: snapAt,
      beforePt,
      beforeSlabColumnValue: beforeSlabCol,
      afterPt,
      error: err,
    });
  }

  console.log('\n--- Per employee (before = snapshot row PT before this run; after = fresh calc) ---');
  console.table(
    results.map((r) => ({
      emp_no: r.emp_no,
      hadSnap: r.hadSnapshot,
      before_PT: r.beforePt,
      slab_col: r.beforeSlabColumnValue,
      after_PT: r.afterPt,
      same: r.error ? 'ERR' : r.beforePt == null ? 'n/a' : Number(r.beforePt) === Number(r.afterPt),
      err: r.error ? r.error.slice(0, 60) : '',
    }))
  );

  const compared = results.filter((r) => !r.error && r.beforePt != null && r.afterPt != null);
  const changed = compared.filter((r) => Number(r.beforePt) !== Number(r.afterPt));
  const unchanged = compared.filter((r) => Number(r.beforePt) === Number(r.afterPt));

  console.log('\n--- Summary ---');
  console.log('Compared (had before PT + recalc OK):', compared.length);
  console.log('Unchanged PT:', unchanged.length);
  console.log('Changed PT:', changed.length);

  if (ptSlabHeader) {
    console.log('\nReasoning (when PT earnings column is set):');
    console.log('- Slab is chosen from column "' + ptSlabHeader + '" at statutory evaluation time (value from paysheet context), not from prorated basic.');
    console.log('- If that column value differs from prorated basic, PT can differ from the old "basic-only" slab behavior.');
    console.log('- If the column value equals prorated basic (or falls in the same slab), PT usually stays the same.');
  } else {
    console.log('\nReasoning (PT earnings column empty):');
    console.log('- Slab still uses prorated basic; recalc with same inputs should match prior snapshot unless pay register / basic / days / config changed.');
  }

  if (changed.length > 0) {
    console.log('\nEmployees with PT change (sample):');
    for (const r of changed.slice(0, 8)) {
      console.log(
        `  ${r.emp_no}: ${r.beforePt} → ${r.afterPt} | snapshot slab column "${ptSlabHeader || 'n/a'}": ${r.beforeSlabColumnValue}`,
      );
    }
  }

  if (unchanged.length > 0 && changed.length === 0 && compared.length > 0) {
    console.log('\nNo PT changes: configured slab base (or prorated basic) still maps to the same slab amount for these rows.');
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
