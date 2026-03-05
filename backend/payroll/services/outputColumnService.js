/**
 * Builds paysheet row from payslip + config.outputColumns (Payroll Configuration).
 *
 * Payslip is from the payroll calculation (calculatePayrollNew returns it), not from the record.
 * - FIELD: getValueByPath(payslip, col.field) — value from calculation (employee, pay register, earnings,
 *   deductions, statutory, cumulatives, loan/advance, etc.).
 * - FORMULA: value from before columns (earlier columns in config order) + context from payslip.
 *   columnContext = getContextFromPayslip(payslip) plus each previous column value by header key.
 */

const ALLOWED_FORMULA_VARS = new Set([
  'basicPay', 'grossSalary', 'netSalary', 'totalDeductions', 'roundOff',
  'presentDays', 'payableShifts', 'monthDays', 'otPay', 'incentive',
  'advanceDeduction', 'loanEMI', 'earnedSalary', 'totalAllowances',
  'allowancesCumulative', 'deductionsCumulative', 'statutoryCumulative',
  'emp_no', 'name', 'designation', 'department', 'division',
  'attendanceDeduction', 'permissionDeduction', 'leaveDeduction', 'otherDeductions',
  'arrearsAmount', 'arrears', 'manualDeductionsAmount', 'manual_deductions_amount', 'manual_deductions',
  'extraDays', 'paidLeaveDays', 'odDays', 'absentDays', 'weeklyOffs', 'holidays',
  'perDayBasicPay', 'basic_pay', 'lopDays', 'elUsedInPayroll', 'attendanceDeductionDays',
]);

function getContextFromPayslip(payslip) {
  const emp = payslip.employee || {};
  const att = payslip.attendance || {};
  const earn = payslip.earnings || {};
  const ded = payslip.deductions || {};
  const loan = payslip.loanAdvance || {};
  const arrears = payslip.arrears || {};
  const num = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    emp_no: emp.emp_no ?? '',
    name: emp.name ?? '',
    designation: emp.designation ?? '',
    department: emp.department ?? '',
    division: emp.division ?? '',
    basicPay: num(earn.basicPay),
    basic_pay: num(earn.basicPay),
    grossSalary: num(earn.grossSalary),
    netSalary: num(payslip.netSalary),
    totalDeductions: num(ded.totalDeductions),
    roundOff: num(payslip.roundOff),
    presentDays: num(att.presentDays),
    payableShifts: num(att.payableShifts),
    monthDays: num(att.totalDaysInMonth, 30),
    otPay: num(earn.otPay),
    incentive: num(earn.incentive),
    earnedSalary: num(att.earnedSalary ?? earn.earnedSalary),
    totalAllowances: num(earn.totalAllowances),
    allowancesCumulative: num(earn.allowancesCumulative ?? earn.totalAllowances),
    deductionsCumulative: num(ded.deductionsCumulative ?? ded.totalDeductions),
    statutoryCumulative: num(ded.statutoryCumulative),
    advanceDeduction: num(loan.advanceDeduction),
    loanEMI: num(loan.totalEMI),
    perDayBasicPay: num(earn.perDayBasicPay),
    attendanceDeduction: num(ded.attendanceDeduction),
    permissionDeduction: num(ded.permissionDeduction),
    leaveDeduction: num(ded.leaveDeduction),
    arrearsAmount: num(arrears.arrearsAmount ?? payslip.arrearsAmount),
    arrears: num(arrears.arrearsAmount ?? payslip.arrearsAmount),
    manualDeductionsAmount: num(payslip.manualDeductions?.manualDeductionsAmount ?? payslip.manualDeductionsAmount ?? 0),
    manual_deductions_amount: num(payslip.manualDeductions?.manualDeductionsAmount ?? payslip.manualDeductionsAmount ?? 0),
    manual_deductions: num(payslip.manualDeductions?.manualDeductionsAmount ?? payslip.manualDeductionsAmount ?? 0),
    extraDays: num(att.extraDays),
    paidLeaveDays: num(att.paidLeaveDays),
    odDays: num(att.odDays),
    absentDays: num(att.absentDays),
    weeklyOffs: num(att.weeklyOffs),
    holidays: num(att.holidays),
    lopDays: num(att.lopDays),
    elUsedInPayroll: num(payslip.attendance?.elUsedInPayroll ?? payslip.elUsedInPayroll),
    attendanceDeductionDays: num(att.attendanceDeductionDays ?? payslip.attendanceDeductionDays ?? ded.attendanceDeductionBreakdown?.daysDeducted),
    // Snake_case / alias for paysheet formulas (flow-order columns)
    month_days: num(att.totalDaysInMonth, 30),
    monthdays: num(att.totalDaysInMonth, 30),
    present_days: num(att.presentDays),
    week_offs: num(att.weeklyOffs),
    paidleaves: num(att.paidLeaveDays),
    el: num(payslip.attendance?.elUsedInPayroll ?? payslip.elUsedInPayroll),
    salary: num(earn.basicPay),
    extradays: num(att.extraDays),
    statutory_deductions: num(ded.statutoryCumulative),
    net_salary: num(payslip.netSalary),
    extra_hours_pay: num(earn.otPay),
    total_allowances: num(earn.allowancesCumulative ?? earn.totalAllowances),
    gross_salary: num(earn.grossSalary),
    salary_advance: num(loan.advanceDeduction),
    loan_recovery: num(loan.totalEMI),
    remaining_balance: num(loan.remainingBalance),
    attendance_deduction: num(ded.attendanceDeduction),
    round_off: num(payslip.roundOff),
  };
}

function headerToKey(header) {
  if (!header || typeof header !== 'string') return '';
  return header.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || 'col';
}

// Allow formula to use: numbers, +-*/(),., comma, identifiers, and ? : for ternary
// extraKeys: Set or Array of allowed variable names (e.g. context keys)
function isFormulaSafe(formula, extraKeys = null) {
  if (!formula || typeof formula !== 'string') return false;
  const trimmed = formula.trim();
  if (!trimmed) return false;
  if (!/^[\w\s+\-*/().,?:]+$/.test(trimmed)) return false;
  const extra = extraKeys instanceof Set ? extraKeys : new Set(Array.isArray(extraKeys) ? extraKeys : (extraKeys ? [extraKeys] : []));
  const words = trimmed.split(/\s+|(?=[+\-*/(),?:])|(?<=[+\-*/(),?:])/).filter(Boolean);
  const mathMethods = ['min', 'max', 'round', 'floor', 'ceil', 'abs'];
  for (const w of words) {
    if (/^\d+\.?\d*$/.test(w)) continue;
    if (/^[+\-*/(),.:?]$/.test(w)) continue;
    if (w === 'Math' || mathMethods.includes(w)) continue;
    if (/^Math\.(min|max|round|floor|ceil|abs)$/.test(w)) continue;
    if (ALLOWED_FORMULA_VARS.has(w)) continue;
    if (extra.has(w)) continue;
    return false;
  }
  return true;
}

function safeEvalFormula(formula, context) {
  const keys = Object.keys(context || {});
  const allowedSet = new Set(keys);
  if (!formula || !isFormulaSafe(formula, allowedSet)) return 0;
  try {
    const values = keys.map((k) => {
      const v = context[k];
      if (typeof v === 'number' && !Number.isNaN(v)) return v;
      const n = Number(v);
      return Number.isNaN(n) ? 0 : n;
    });
    const fn = new Function('Math', ...keys, `return (${formula});`);
    const result = fn(Math, ...values);
    if (typeof result === 'number' && !Number.isNaN(result)) return result;
    return 0;
  } catch (e) {
    return 0;
  }
}

/**
 * Resolve component amount by name/code for use in paysheet columns (flow order).
 * - earnings.allowanceAmount:Name → amount from earnings.allowances[] where name === Name
 * - deductions.otherDeductionAmount:Name → amount from deductions.otherDeductions[] where name === Name
 * - deductions.statutoryAmount:Code → employeeAmount from deductions.statutoryDeductions[] where code === Code (PF, ESI, PT)
 */
function getValueByPath(obj, path) {
  if (!path || typeof path !== 'string') return '';
  const trimmed = path.trim();
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx > 0) {
    const basePath = trimmed.slice(0, colonIdx).trim();
    const key = trimmed.slice(colonIdx + 1).trim();
    if (basePath === 'earnings.allowanceAmount' && key) {
      const allowances = obj?.earnings?.allowances;
      if (Array.isArray(allowances)) {
        const item = allowances.find((a) => a && String(a.name).trim() === key);
        return item != null && typeof item.amount === 'number' ? item.amount : 0;
      }
      return 0;
    }
    if (basePath === 'deductions.otherDeductionAmount' && key) {
      const other = obj?.deductions?.otherDeductions;
      if (Array.isArray(other)) {
        const item = other.find((d) => d && String(d.name).trim() === key);
        return item != null && typeof item.amount === 'number' ? item.amount : 0;
      }
      return 0;
    }
    if (basePath === 'deductions.statutoryAmount' && key) {
      const statutory = obj?.deductions?.statutoryDeductions;
      if (Array.isArray(statutory)) {
        const item = statutory.find((s) => s && (String(s.code).trim() === key || String(s.name).trim() === key));
        return item != null && typeof item.employeeAmount === 'number' ? item.employeeAmount : 0;
      }
      return 0;
    }
  }
  const parts = trimmed.split('.').filter(Boolean);
  let val = obj;
  for (const p of parts) {
    if (val == null) return '';
    val = val[p];
  }
  if (val === undefined || val === null) {
    // Fallbacks so field columns work when payslip has top-level only (e.g. from DB)
    if (trimmed === 'manualDeductions.manualDeductionsAmount') {
      const fallback = obj?.manualDeductionsAmount ?? obj?.manualDeductions?.manualDeductionsAmount;
      const n = Number(fallback);
      return Number.isFinite(n) ? n : 0;
    }
    if (trimmed === 'arrears.arrearsAmount') {
      const fallback = obj?.arrearsAmount ?? obj?.arrears?.arrearsAmount;
      const n = Number(fallback);
      return Number.isFinite(n) ? n : 0;
    }
    return '';
  }
  if (typeof val === 'number') return val;
  if (typeof val === 'object' && val !== null && !Array.isArray(val)) return '';
  return val;
}

/**
 * Build one row from payslip and output column config (same config as payroll flow).
 * Columns are evaluated in config order so that:
 * - FIELD: value is provided by the service and controller — getValueByPath(payslip, col.field).
 *   The payslip is built by the controller from PayrollRecord (DB), which is filled by the payroll calculation steps.
 * - FORMULA: value uses before columns (earlier columns in this list) plus context from the payslip.
 *   Dynamically, every column header becomes a formula variable: after each column we set
 *   columnContext[headerToKey(header)] = value, so later formulas can reference it (e.g. "DD Manual" -> dd_manual, "Basic Pay" -> basic_pay).
 */
function buildRowFromOutputColumns(payslip, outputColumns, serialNo = null) {
  const row = {};
  if (serialNo != null) row['S.No'] = serialNo;
  if (!Array.isArray(outputColumns) || outputColumns.length === 0) return row;

  const sorted = [...outputColumns].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const baseContext = getContextFromPayslip(payslip);
  const columnContext = { ...baseContext };
  const usedHeaders = new Set();

  for (let i = 0; i < sorted.length; i++) {
    const col = sorted[i];
    let header = (col.header && String(col.header).trim()) ? String(col.header).trim() : 'Column';
    if (header === 'Column' || usedHeaders.has(header)) {
      header = `Column ${i}`;
    }
    usedHeaders.add(header);

    let val;

    // Prefer formula when it exists, regardless of source flag – this keeps
    // older configurations working where users entered a formula but left
    // "Data source" as "Field".
    const hasFormula = typeof col.formula === 'string' && col.formula.trim().length > 0;
    if (hasFormula) {
      val = safeEvalFormula(col.formula, columnContext);
    } else {
      val = getValueByPath(payslip, col.field || '');
    }
    row[header] = val;
    const key = headerToKey(header);
    if (key) columnContext[key] = typeof val === 'number' ? val : (Number(val) || 0);
  }
  return row;
}

/**
 * Detect if a column is the "Allowances cumulative" / "Total Allowances" column (by field or header).
 */
function isAllowancesCumulativeColumn(col) {
  const field = (col.field || '').trim();
  const headerKey = headerToKey(col.header || '');
  return (
    field === 'earnings.allowancesCumulative' ||
    headerKey === 'allowances_cumulative' ||
    headerKey === 'total_allowances'
  );
}

/**
 * Detect if a column is the "Deductions cumulative" column (by field or header).
 */
function isDeductionsCumulativeColumn(col) {
  const field = (col.field || '').trim();
  const headerKey = headerToKey(col.header || '');
  return (
    field === 'deductions.deductionsCumulative' ||
    headerKey === 'deductions_cumulative'
  );
}

/**
 * Detect if a column is the "Statutory cumulative" column (by field or header).
 */
function isStatutoryCumulativeColumn(col) {
  const field = (col.field || '').trim();
  const headerKey = headerToKey(col.header || '');
  return (
    field === 'deductions.statutoryCumulative' ||
    headerKey === 'statutory_cumulative' ||
    headerKey === 'statutory_deductions'
  );
}

/**
 * Expand output columns by inserting breakdown columns before each cumulative column:
 * - Before Allowances cumulative: one column per allowance name (earnings.allowanceAmount:Name), value or 0.
 * - Before Deductions cumulative: one column per deduction name (deductions.otherDeductionAmount:Name), value or 0.
 * - Before Statutory cumulative: one column per statutory code (deductions.statutoryAmount:Code), e.g. PF, ESI, PT.
 * allAllowanceNames, allDeductionNames, allStatutoryCodes are arrays or Sets of strings (names/codes).
 * Returns new array with order 0,1,2,... so formulas that reference earlier columns still work.
 */
function expandOutputColumnsWithBreakdown(outputColumns, allAllowanceNames = [], allDeductionNames = [], allStatutoryCodes = []) {
  if (!Array.isArray(outputColumns) || outputColumns.length === 0) {
    return [];
  }
  const allowances = [...(Array.isArray(allAllowanceNames) ? allAllowanceNames : Array.from(allAllowanceNames || []))].sort((a, b) => String(a).localeCompare(String(b)));
  const deductions = [...(Array.isArray(allDeductionNames) ? allDeductionNames : Array.from(allDeductionNames || []))].sort((a, b) => String(a).localeCompare(String(b)));
  const statutoryRaw = Array.isArray(allStatutoryCodes) ? allStatutoryCodes : Array.from(allStatutoryCodes || []);
  const statutoryOrder = ['PF', 'ESI', 'PT'];
  const statutory = [...statutoryRaw].sort((a, b) => {
    const ia = statutoryOrder.indexOf(String(a).toUpperCase());
    const ib = statutoryOrder.indexOf(String(b).toUpperCase());
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return String(a).localeCompare(String(b));
  });

  const sorted = [...outputColumns].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const expanded = [];
  const seenHeaders = new Set();
  let nextOrder = 0;

  function uniqueHeader(header, order) {
    const h = (header && String(header).trim()) ? String(header).trim() : `Column ${order}`;
    if (h === 'Column' || seenHeaders.has(h)) {
      const unique = `Column ${order}`;
      seenHeaders.add(unique);
      return unique;
    }
    seenHeaders.add(h);
    return h;
  }

  for (const col of sorted) {
    if (isAllowancesCumulativeColumn(col)) {
      allowances.forEach((name) => {
        if (!name) return;
        expanded.push({
          header: String(name).trim(),
          source: 'field',
          field: `earnings.allowanceAmount:${String(name).trim()}`,
          formula: '',
          order: nextOrder++,
        });
      });
    }
    if (isDeductionsCumulativeColumn(col)) {
      deductions.forEach((name) => {
        if (!name) return;
        expanded.push({
          header: String(name).trim(),
          source: 'field',
          field: `deductions.otherDeductionAmount:${String(name).trim()}`,
          formula: '',
          order: nextOrder++,
        });
      });
    }
    if (isStatutoryCumulativeColumn(col)) {
      statutory.forEach((code) => {
        if (!code) return;
        expanded.push({
          header: String(code).trim(),
          source: 'field',
          field: `deductions.statutoryAmount:${String(code).trim()}`,
          formula: '',
          order: nextOrder++,
        });
      });
    }
    const order = nextOrder++;
    expanded.push({
      ...col,
      header: uniqueHeader(col.header, order),
      order,
    });
  }

  return expanded;
}

module.exports = {
  buildRowFromOutputColumns,
  expandOutputColumnsWithBreakdown,
  getValueByPath,
  getContextFromPayslip,
  safeEvalFormula,
};
