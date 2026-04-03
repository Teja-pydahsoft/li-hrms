/**
 * Payroll calculation driven by config.outputColumns.
 * Steps = output columns in order. For each step: if field → from employee / pay register or via service; if formula → from before columns + context.
 * Result is persisted as PayrollRecord and returned as payslip + row for paysheet.
 */

const PayRegisterSummary = require('../../pay-register/model/PayRegisterSummary');
const Employee = require('../../employees/model/Employee');
const PayrollConfiguration = require('../model/PayrollConfiguration');
const PayrollRecord = require('../model/PayrollRecord');
const PayrollBatch = require('../model/PayrollBatch');
const SecondSalaryRecord = require('../model/SecondSalaryRecord');
const SecondSalaryBatch = require('../model/SecondSalaryBatch');
const SecondSalaryBatchService = require('./secondSalaryBatchService');
const PayrollPayslipSnapshot = require('../model/PayrollPayslipSnapshot');
const basicPayService = require('./basicPayService');
const otPayService = require('./otPayService');
const allowanceService = require('./allowanceService');
const deductionService = require('./deductionService');
const loanAdvanceService = require('./loanAdvanceService');
const statutoryDeductionService = require('./statutoryDeductionService');
const PayrollBatchService = require('./payrollBatchService');
const {
  getIncludeMissingFlag,
  mergeWithOverrides,
  getAbsentDeductionSettings,
  buildBaseComponents,
} = require('./allowanceDeductionResolverService');
const LeavePolicySettings = require('../../settings/model/LeavePolicySettings');
const { createISTDate, getPayrollDateRange } = require('../../shared/utils/dateUtils');
const outputColumnService = require('./outputColumnService');
const ArrearsPayrollIntegrationService = require('../../arrears/services/arrearsPayrollIntegrationService');
const DeductionIntegrationService = require('./deductionIntegrationService');
const DeductionPayrollIntegrationService = require('../../manual-deductions/services/deductionPayrollIntegrationService');

function normalizeOutputColumns(rawColumns) {
  const raw = Array.isArray(rawColumns) ? rawColumns : [];
  return raw.map((c, i) => {
    const doc = c && typeof c.toObject === 'function' ? c.toObject() : (c && typeof c === 'object' ? { ...c } : {});
    return {
      header: doc.header != null && String(doc.header).trim() ? String(doc.header).trim() : `Column ${i + 1}`,
      source: doc.source === 'formula' ? 'formula' : 'field',
      field: doc.field != null ? String(doc.field) : '',
      formula: doc.formula != null ? String(doc.formula) : '',
      order: typeof doc.order === 'number' ? doc.order : i,
    };
  });
}

function statutoryCodesFromConfig(config) {
  const out = [];
  if (config?.pf?.enabled) out.push('PF');
  if (config?.esi?.enabled) out.push('ESI');
  if (config?.professionTax?.enabled) out.push('PT');
  return out.length ? out : ['PF', 'ESI', 'PT'];
}

function buildPaysheetSnapshotData(payslip, outputColumnsNormalized, configDoc) {
  const allAllowanceNames = new Set();
  const allDeductionNames = new Set();
  const allStatutoryCodes = new Set();
  (payslip?.earnings?.allowances || []).forEach((a) => { if (a && a.name) allAllowanceNames.add(a.name); });
  (payslip?.deductions?.otherDeductions || []).forEach((d) => { if (d && d.name) allDeductionNames.add(d.name); });
  (payslip?.deductions?.statutoryDeductions || []).forEach((s) => { if (s && (s.code || s.name)) allStatutoryCodes.add(String(s.code || s.name).trim()); });
  // If breakdown is missing, still expand using enabled statutory codes so the sheet layout stays stable.
  statutoryCodesFromConfig(configDoc).forEach((c) => allStatutoryCodes.add(c));

  const expandedColumns = outputColumnService.expandOutputColumnsWithBreakdown(
    outputColumnsNormalized,
    allAllowanceNames,
    allDeductionNames,
    allStatutoryCodes
  );
  const rowData = outputColumnService.buildRowFromOutputColumns(payslip, expandedColumns, null);
  const headers = expandedColumns.map((c) => c.header || 'Column');
  return { expandedColumns, headers, rowData };
}

async function enforceBatchLock({ kind, month, departmentId, divisionId, employeeId }) {
  if (!month || !departmentId || !divisionId) return;
  if (kind === 'second_salary') {
    const batch = await SecondSalaryBatch.findOne({ department: departmentId, division: divisionId, month });
    if (batch) {
      if (['freeze', 'complete'].includes(batch.status)) {
        const error = new Error(`2nd Salary payroll for ${month} is ${batch.status}. Recalculation is not allowed.`);
        error.code = 'BATCH_LOCKED';
        error.batchId = batch._id;
        error.employeeId = employeeId;
        throw error;
      }
      if (batch.status === 'approved') {
        if (!batch.hasValidRecalculationPermission()) {
          const error = new Error(`2nd Salary payroll for ${month} is approved. Recalculation requires permission.`);
          error.code = 'BATCH_LOCKED';
          error.batchId = batch._id;
          error.employeeId = employeeId;
          throw error;
        }
        batch.consumeRecalculationPermission?.();
        await batch.save();
      }
    }
    return;
  }
  const batch = await PayrollBatch.findOne({ department: departmentId, division: divisionId, month });
  if (batch) {
    if (['freeze', 'complete'].includes(batch.status)) {
      const error = new Error(`Payroll for ${month} is ${batch.status}. Recalculation is not allowed.`);
      error.code = 'BATCH_LOCKED';
      error.batchId = batch._id;
      error.employeeId = employeeId;
      throw error;
    }
    if (batch.status === 'approved') {
      if (!batch.hasValidRecalculationPermission()) {
        const error = new Error(`Payroll for ${month} is approved. Recalculation requires permission.`);
        error.code = 'BATCH_LOCKED';
        error.batchId = batch._id;
        error.employeeId = employeeId;
        throw error;
      }
      batch.consumeRecalculationPermission?.();
      await batch.save();
    }
  }
}

/** Extract identifier-like variable names from a formula string (for demand-driven service resolution). */
function extractFormulaVariableNames(formula) {
  if (!formula || typeof formula !== 'string') return new Set();
  const trimmed = formula.trim();
  if (!trimmed) return new Set();
  const words = trimmed.split(/\s+|(?=[+\-*/(),?:])|(?<=[+\-*/(),?:])/).filter(Boolean);
  const out = new Set();
  for (const w of words) {
    if (/^\d+\.?\d*$/.test(w)) continue;
    if (/^[+\-*/(),.:?]$/.test(w)) continue;
    if (w === 'Math') continue;
    if (/^Math\.(min|max|round|floor|ceil|abs)$/.test(w)) continue;
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(w)) out.add(w);
  }
  return out;
}

/**
 * Scan output columns to determine which services are required.
 * Uses field paths and formula variable names so we only run services that are actually needed.
 */
function getRequiredServices(outputColumns) {
  const required = {
    needsBasicPay: false,
    needsOT: false,
    needsAllowances: false,
    needsAttendanceDeduction: false,
    needsStatutory: false,
    needsOtherDeductions: false,
    needsLoanAdvance: false,
    needsArrears: false,
    needsManualDeductions: false,
  };
  if (!Array.isArray(outputColumns)) return required;

  const formulaVarsNeedingBasicPay = new Set(['basicPay', 'basic_pay', 'perDayBasicPay', 'earnedSalary', 'payableAmount', 'incentive', 'salary']);
  const formulaVarsNeedingAttendanceDeduction = new Set(['attendanceDeduction', 'attendanceDeductionDays', 'attendance_deduction', 'attendance_deduction_days']);
  const formulaVarsNeedingStatutory = new Set(['statutoryCumulative', 'statutory_deductions']);
  const formulaVarsNeedingAllowances = new Set(['totalAllowances', 'allowancesCumulative', 'grossSalary', 'gross_salary', 'total_allowances']);
  const formulaVarsNeedingOT = new Set(['otPay', 'extra_hours_pay']);
  const formulaVarsNeedingOtherDeductions = new Set(['otherDeductions', 'deductionsCumulative', 'totalDeductions']);
  const formulaVarsNeedingLoan = new Set(['advanceDeduction', 'loanEMI', 'salary_advance', 'loan_recovery', 'remaining_balance']);
  const formulaVarsNeedingArrears = new Set(['arrearsAmount', 'arrears']);
  const formulaVarsNeedingManualDeductions = new Set(['manualDeductionsAmount', 'manual_deductions_amount', 'manual_deductions']);

  for (const col of outputColumns) {
    const field = (col.field || '').trim();
    const formula = (col.formula || '').trim();
    const hasFormula = formula.length > 0;

    if (hasFormula) {
      const vars = extractFormulaVariableNames(formula);
      for (const v of vars) {
        if (formulaVarsNeedingBasicPay.has(v)) required.needsBasicPay = true;
        if (formulaVarsNeedingAttendanceDeduction.has(v)) required.needsAttendanceDeduction = true;
        if (formulaVarsNeedingStatutory.has(v)) required.needsStatutory = true;
        if (formulaVarsNeedingAllowances.has(v)) required.needsAllowances = true;
        if (formulaVarsNeedingOT.has(v)) required.needsOT = true;
        if (formulaVarsNeedingOtherDeductions.has(v)) required.needsOtherDeductions = true;
        if (formulaVarsNeedingLoan.has(v)) required.needsLoanAdvance = true;
        if (formulaVarsNeedingArrears.has(v)) required.needsArrears = true;
        if (formulaVarsNeedingManualDeductions.has(v)) required.needsManualDeductions = true;
      }
    } else if (field) {
      if (field.startsWith('earnings.basicPay') || field.startsWith('earnings.perDayBasicPay') || field === 'earnings.payableAmount' || field === 'earnings.earnedSalary' || field === 'earnings.incentive') required.needsBasicPay = true;
      if (field.startsWith('earnings.ot')) required.needsOT = true;
      if (field.startsWith('earnings.allowances') || field === 'earnings.totalAllowances' || field === 'earnings.allowancesCumulative' || field === 'earnings.grossSalary') required.needsAllowances = true;
      if (field.startsWith('deductions.attendanceDeduction') || field === 'attendance.attendanceDeductionDays' || field === 'attendanceDeductionDays') required.needsAttendanceDeduction = true;
      if (field.startsWith('deductions.statutory')) required.needsStatutory = true;
      if (field.startsWith('deductions.other') || field === 'deductions.totalOtherDeductions') required.needsOtherDeductions = true;
      if (field === 'deductions.deductionsCumulative' || field === 'deductions.totalDeductions') {
        required.needsAttendanceDeduction = true;
        required.needsStatutory = true;
        required.needsOtherDeductions = true;
        required.needsLoanAdvance = true;
      }
      if (field.startsWith('loanAdvance.')) required.needsLoanAdvance = true;
      if (field.startsWith('arrears.')) required.needsArrears = true;
      if (field.startsWith('manualDeductions.') || field === 'manualDeductionsAmount') required.needsManualDeductions = true;
    }
  }
  if (required.needsAllowances || required.needsStatutory || required.needsOtherDeductions) required.needsBasicPay = true;
  if (required.needsAttendanceDeduction) required.needsBasicPay = true;
  if (required.needsOtherDeductions) {
    required.needsAttendanceDeduction = true;
    required.needsStatutory = true;
    required.needsLoanAdvance = true;
  }
  return required;
}

/**
 * Normalize employee override payloads to ensure consistent structure.
 * Mirrors the legacy payroll calculation behavior.
 */
function normalizeOverrides(list, fallbackCategory) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((ov) => ov && (ov.masterId || ov.name))
    .map((ov) => {
      const override = (ov && typeof ov.toObject === 'function') ? ov.toObject() : { ...ov };
      override.category = override.category || fallbackCategory;

      if (override.amount === undefined || override.amount === null) {
        override.amount = (override.overrideAmount !== undefined && override.overrideAmount !== null)
          ? override.overrideAmount
          : 0;
      }

      if (typeof override.amount === 'string') {
        override.amount = parseFloat(override.amount) || 0;
      } else if (typeof override.amount !== 'number') {
        override.amount = 0;
      }

      return override;
    });
}

/**
 * Run only the services that are required by output columns; fill record so we don't depend on column order.
 * Order: basicPay (uses employee.gross_salary) → OT → allowances → attendance deduction → statutory → other deductions → loanAdvance → arrears.
 * Statutory is always skipped here and run in the column loop so paid/total days can come from output columns (by config header or auto-detect by name).
 */
async function runRequiredServices(required, record, employee, employeeId, month, payRegisterSummary, attendanceSummary, departmentId, divisionId, config = null) {
  if (!record) return;

  const num = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : Number(v) || 0);

  if (required.needsBasicPay) {
    const basicPayResult = basicPayService.calculateBasicPay(employee, attendanceSummary);
    if (!record.earnings) record.earnings = {};
    record.earnings.basicPay = basicPayResult.basicPay ?? employee.gross_salary ?? 0;
    record.earnings.perDayBasicPay = basicPayResult.perDayBasicPay ?? 0;
    record.earnings.payableAmount = basicPayResult.payableAmount ?? basicPayResult.basePayForWork ?? 0;
    record.earnings.earnedSalary = record.earnings.payableAmount;
    record.earnings.incentive = basicPayResult.incentive ?? 0;
    if (!record.attendance) record.attendance = {};
    record.attendance.extraDays = basicPayResult.extraDays ?? 0;
    record.attendance.totalPaidDays = (basicPayResult.physicalUnits ?? 0) + (record.attendance.extraDays || 0);
    record.attendance.earnedSalary = record.earnings.payableAmount;
  }

  if (required.needsOT) {
    const departmentIdStr = (employee?.department_id?._id || employee?.department_id)?.toString() || departmentId?.toString();
    const otPayResult = await otPayService.calculateOTPay(attendanceSummary.totalOTHours || 0, departmentIdStr);
    if (!record.earnings) record.earnings = {};
    record.earnings.otPay = otPayResult.otPay ?? 0;
    record.earnings.otHours = attendanceSummary.totalOTHours ?? 0;
    record.earnings.otRatePerHour = otPayResult.otPayPerHour ?? 0;
  }

  if (required.needsAllowances) {
    const basicPay = num(record.earnings?.basicPay);
    const earnedSalary = num(record.earnings?.payableAmount ?? record.earnings?.earnedSalary);
    const otPay = num(record.earnings?.otPay);
    let grossSoFar = earnedSalary + otPay;
    const attendanceData = {
      presentDays: record.attendance?.presentDays ?? 0,
      paidLeaveDays: record.attendance?.paidLeaveDays ?? 0,
      odDays: record.attendance?.odDays ?? 0,
      monthDays: record.attendance?.totalDaysInMonth ?? 30,
    };
    const includeMissing = await getIncludeMissingFlag(departmentId, divisionId);
    const { allowances: baseAllowances } = await buildBaseComponents(departmentId, basicPay, attendanceData, employee?.division_id);
    const normalized = normalizeOverrides(employee?.employeeAllowances || [], 'allowance');
    const resolvedAllowances = mergeWithOverrides(baseAllowances, normalized, includeMissing);
    let totalAllowances = 0;
    const allowanceBreakdown = (resolvedAllowances || [])
      .filter((a) => a && a.name)
      .map((a) => {
        const baseAmount = (a.base || '').toLowerCase() === 'gross' ? grossSoFar : earnedSalary;
        const amount = allowanceService.calculateAllowanceAmount(a, baseAmount, grossSoFar, attendanceData);
        totalAllowances += amount;
        return { name: a.name, amount, type: a.type || 'fixed', base: (a.base || '').toLowerCase() === 'gross' ? 'gross' : 'basic' };
      });
    grossSoFar += totalAllowances;
    if (!record.earnings) record.earnings = {};
    record.earnings.allowances = allowanceBreakdown;
    record.earnings.totalAllowances = totalAllowances;
    record.earnings.allowancesCumulative = totalAllowances;
    record.earnings.grossSalary = grossSoFar;
  }

  if (required.needsAttendanceDeduction) {
    const perDaySalary = num(record.earnings?.perDayBasicPay);
    const absentDays = num(record.attendance?.absentDays);
    const absentSettings = await getAbsentDeductionSettings(departmentId || '', divisionId || null);
    const attendanceDeductionResult = await deductionService.calculateAttendanceDeduction(
      employeeId,
      month,
      departmentId,
      perDaySalary,
      employee?.division_id ?? divisionId,
      {
        employee: employee ?? undefined,
        absentDays,
        enableAbsentDeduction: absentSettings?.enableAbsentDeduction,
        lopDaysPerAbsent: absentSettings?.lopDaysPerAbsent,
      }
    );
    if (!record.deductions) record.deductions = {};
    record.deductions.attendanceDeduction = attendanceDeductionResult.attendanceDeduction ?? 0;
    record.deductions.attendanceDeductionBreakdown = attendanceDeductionResult.breakdown ?? {};
    if (!record.attendance) record.attendance = {};
    record.attendance.attendanceDeductionDays = attendanceDeductionResult.breakdown?.daysDeducted ?? 0;
  }

  // Statutory is run in the column loop so we can use output column values (config header or auto-detect by name like "Paid Days", "Present Days").
  if (required.needsStatutory) {
    // skip here; will run when statutory column is resolved, with context for paid/total days (by config or by name)
  }

  // Other deductions run in column loop so paid days can come from output column (same as statutory).
  if (required.needsOtherDeductions) {
    // skip here; will run when deduction column is resolved, with context for paid/total days
  }

  if (required.needsLoanAdvance) {
    const loanAdvanceResult = await loanAdvanceService.calculateLoanAdvance(employeeId, month);
    if (!record.loanAdvance) record.loanAdvance = {};
    record.loanAdvance.totalEMI = loanAdvanceResult.totalEMI ?? 0;
    record.loanAdvance.advanceDeduction = loanAdvanceResult.advanceDeduction ?? 0;
    record.loanAdvance.remainingBalance = loanAdvanceResult.remainingBalance ?? 0;
  }

  if (required.needsArrears) {
    try {
      const pendingArrears = await ArrearsPayrollIntegrationService.getPendingArrearsForPayroll(employeeId);
      const arrearsAmount = (pendingArrears || []).reduce((sum, ar) => sum + (ar.remainingAmount || 0), 0);
      if (!record.arrears) record.arrears = { arrearsAmount: 0, arrearsSettlements: [] };
      record.arrears.arrearsAmount = Math.round(arrearsAmount * 100) / 100;
    } catch (e) {
      if (!record.arrears) record.arrears = { arrearsAmount: 0, arrearsSettlements: [] };
      record.arrears.arrearsAmount = 0;
    }
  }

  if (required.needsManualDeductions) {
    try {
      const pending = await DeductionPayrollIntegrationService.getPendingDeductionsForPayroll(employeeId);
      const manualDeductionsAmount = Math.round(
        (pending || []).reduce((sum, d) => sum + (Number(d.remainingAmount) || 0), 0) * 100
      ) / 100;
      if (!record.manualDeductions) record.manualDeductions = { manualDeductionsAmount: 0 };
      record.manualDeductions.manualDeductionsAmount = manualDeductionsAmount;
      record.manualDeductionsAmount = manualDeductionsAmount;
    } catch (e) {
      if (!record.manualDeductions) record.manualDeductions = { manualDeductionsAmount: 0 };
      record.manualDeductions.manualDeductionsAmount = 0;
      record.manualDeductionsAmount = 0;
    }
  }

  if (required.needsAttendanceDeduction || required.needsStatutory || required.needsOtherDeductions || required.needsLoanAdvance) {
    const att = num(record.deductions?.attendanceDeduction);

    // If we need other deductions but don't have a breakdown yet, populate it once using the resolver service
    if (required.needsOtherDeductions) {
      const hasOtherBreakdown = Array.isArray(record.deductions?.otherDeductions) && record.deductions.otherDeductions.length > 0;
      if (!hasOtherBreakdown) {
        const basicPay = num(record.earnings?.basicPay);
        const earnedSalary = num(record.earnings?.payableAmount ?? record.earnings?.earnedSalary);
        const grossSalary = num(record.earnings?.grossSalary);
        const attendanceData = {
          presentDays: record.attendance?.presentDays ?? 0,
          paidLeaveDays: record.attendance?.paidLeaveDays ?? 0,
          odDays: record.attendance?.odDays ?? 0,
          monthDays: record.attendance?.totalDaysInMonth ?? 30,
        };
        const includeMissing = await getIncludeMissingFlag(departmentId, divisionId);
        const { deductions: baseDeductions } = await buildBaseComponents(
          departmentId,
          basicPay,
          attendanceData,
          employee?.division_id,
        );
        const normalized = normalizeOverrides(employee?.employeeDeductions || [], 'deduction');
        const resolvedDeductions = mergeWithOverrides(baseDeductions, normalized, includeMissing);

        let totalOther = 0;
        const otherBreakdown = (resolvedDeductions || [])
          .filter((d) => d && d.name)
          .map((d) => {
            const baseAmount = (d.base || '').toLowerCase() === 'gross' ? grossSalary : earnedSalary;
            const amount = deductionService.calculateDeductionAmount(d, baseAmount, grossSalary, attendanceData);
            totalOther += amount;
            return {
              name: d.name,
              amount,
              type: d.type || 'fixed',
              base: (d.base || '').toLowerCase() === 'gross' ? 'gross' : 'basic',
            };
          });

        if (!record.deductions) record.deductions = {};
        record.deductions.otherDeductions = otherBreakdown;
        record.deductions.totalOtherDeductions = totalOther;
        console.log('[DynamicPayroll][runRequiredServices] Populated otherDeductions from service:', otherBreakdown);
      }
    }

    // Recompute "other" from breakdown, excluding components that belong to attendance / statutory / loan / advance / manual
    const rawOther = Array.isArray(record.deductions?.otherDeductions)
      ? record.deductions.otherDeductions
      : [];
    console.log('[DynamicPayroll][runRequiredServices] Raw otherDeductions breakdown:', rawOther.map((d) => ({
      name: d?.name,
      amount: d?.amount,
    })));

    const other = rawOther
      .filter((d) => {
        if (!d) return false;
        const name = String(d.name || '').trim().toUpperCase();
        // Exclude items that are tracked separately:
        // - Attendance / late-early
        // - Absent LOP
        // - Statutory (EPF/ESI/PT) – handled via statutoryDeductions
        // - Salary advance / loan – handled via loanAdvance
        // - Manual Deduction – applied via manualDeductionsAmount
        if (name === 'MANUAL DEDUCTION') return false;
        if (name === 'ATTENDANCE DEDUCTION (LATE/EARLY)') return false;
        if (name === 'ABSENT LOP DEDUCTION') return false;
        return true;
      })
      .reduce((sum, d) => sum + (Number(d.amount) || 0), 0);

    const statutory = num(record.deductions?.statutoryCumulative); // may be 0 if prorateByColumn (filled in column loop)
    const loanEMI = num(record.loanAdvance?.totalEMI);
    const advance = num(record.loanAdvance?.advanceDeduction);

    console.log('[DynamicPayroll][runRequiredServices] Aggregated components:', {
      attendanceDeduction: att,
      otherFiltered: other,
      statutoryCumulative: statutory,
      loanEMI,
      advance,
      manualDeductionsAmount: num(record.manualDeductionsAmount),
    });

    if (!record.deductions) record.deductions = {};
    record.deductions.deductionsCumulative = other; // dynamic: only "other deductions" (allowances-deductions)
    record.deductions.totalDeductions = att + other + statutory + loanEMI + advance;
  }
}

function headerToKey(header) {
  if (!header || typeof header !== 'string') return '';
  return header.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || 'col';
}

/** Candidate column header names for "paid days" / "working days". First match in context is used for statutory proration (auto-detect by name). */
const PAID_DAYS_HEADER_CANDIDATES = [
  'Paid Days', 'Present Days', 'Working Days', 'Payable Shifts', 'Total Paid Days',
  'Paid days', 'Present days', 'Working days', 'Payable shifts',
  'totalPaidDays', 'presentDays', 'paidDays', 'workingDays', 'payableShifts',
];
/** Candidate column header names for "total days in month". */
const TOTAL_DAYS_HEADER_CANDIDATES = [
  'Month days', 'Total Days', 'Total days in month', 'Days in month', 'Month Days',
  'monthDays', 'totalDays', 'totalDaysInMonth', 'daysInMonth',
];

/** Get numeric value from context by trying candidate header names (auto-detect by name, not by config id). Returns null if none found. */
function getFromContextByHeaderNames(context, candidateHeaders) {
  if (!context || typeof context !== 'object') return null;
  for (const name of candidateHeaders) {
    const key = headerToKey(name);
    if (!key || !(key in context)) continue;
    const val = context[key];
    const num = typeof val === 'number' && !Number.isNaN(val) ? val : Number(val);
    if (!Number.isFinite(num) || num < 0) continue;
    return num;
  }
  return null;
}

/** Get paid days and total days from output column context (config header or auto-detect by name). For use by allowances and other deductions in dynamic payroll. */
function getPaidDaysAndTotalDaysFromContext(colContext, payrollConfig) {
  let paidDays = null;
  let totalDaysInMonth = null;
  const paidDaysHeader = payrollConfig && typeof payrollConfig.statutoryProratePaidDaysColumnHeader === 'string' && payrollConfig.statutoryProratePaidDaysColumnHeader.trim();
  const totalDaysHeader = payrollConfig && typeof payrollConfig.statutoryProrateTotalDaysColumnHeader === 'string' && payrollConfig.statutoryProrateTotalDaysColumnHeader.trim();
  if (paidDaysHeader && colContext && typeof colContext === 'object') {
    const key = headerToKey(paidDaysHeader);
    if (key && key in colContext) {
      const v = colContext[key];
      const n = typeof v === 'number' && !Number.isNaN(v) ? v : Number(v);
      if (Number.isFinite(n) && n >= 0) paidDays = n;
    }
  }
  if (paidDays == null && colContext) paidDays = getFromContextByHeaderNames(colContext, PAID_DAYS_HEADER_CANDIDATES);
  if (totalDaysHeader && colContext && typeof colContext === 'object') {
    const key = headerToKey(totalDaysHeader);
    if (key && key in colContext) {
      const v = colContext[key];
      const n = typeof v === 'number' && !Number.isNaN(v) ? v : Number(v);
      if (Number.isFinite(n) && n > 0) totalDaysInMonth = n;
    }
  }
  if (totalDaysInMonth == null && colContext) totalDaysInMonth = getFromContextByHeaderNames(colContext, TOTAL_DAYS_HEADER_CANDIDATES);
  return { paidDays, totalDaysInMonth };
}

/** When payroll config names a column header, return its numeric value from formula context for Profession Tax slab selection. */
function getProfessionTaxSlabBaseFromContext(colContext, payrollConfig) {
  const h = payrollConfig && typeof payrollConfig.professionTaxSlabEarningsColumnHeader === 'string' && payrollConfig.professionTaxSlabEarningsColumnHeader.trim();
  if (!h || !colContext || typeof colContext !== 'object') return undefined;
  const key = headerToKey(h);
  if (!key || !(key in colContext)) return undefined;
  const v = colContext[key];
  const n = typeof v === 'number' && !Number.isNaN(v) ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

// Aliases so formula variable names (e.g. extradays, month_days) match context keys from column headers.
function getContextKeysAndAliases(header) {
  const key = headerToKey(header);
  if (!key) return []; // skip empty
  const keys = [key];
  if (key === 'extra_days') keys.push('extradays');
  if (key === 'monthdays') keys.push('month_days', 'monthday');
  return keys;
}

function setValueByPath(obj, path, value) {
  if (!path || typeof path !== 'string') return;
  const parts = path.trim().split('.').filter(Boolean);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  if (parts.length) cur[parts[parts.length - 1]] = value;
}

function getValueByPath(obj, path) {
  return outputColumnService.getValueByPath(obj, path);
}

/**
 * Build attendance summary and payslip.attendance from PayRegister summary; apply EL logic.
 * Month days and pay-cycle alignment: use getPayrollDateRange (pay cycle start/end from settings) so
 * totalDaysInMonth and present days respect the configured pay cycle.
 */
async function buildAttendanceFromSummary(payRegisterSummary, employee, month) {
  let monthDays = 30;
  try {
    const [year, monthNum] = (month || '').split('-').map(Number);
    if (year && monthNum) {
      const range = await getPayrollDateRange(year, monthNum);
      if (range && typeof range.totalDays === 'number' && range.totalDays > 0) {
        monthDays = range.totalDays;
      } else if (payRegisterSummary.totalDaysInMonth) {
        monthDays = payRegisterSummary.totalDaysInMonth;
      }
    } else if (payRegisterSummary.totalDaysInMonth) {
      monthDays = payRegisterSummary.totalDaysInMonth;
    }
  } catch (e) {
    if (payRegisterSummary.totalDaysInMonth) monthDays = payRegisterSummary.totalDaysInMonth;
  }
  let payableShifts = payRegisterSummary.totals?.totalPayableShifts || 0;
  let paidLeaveDays = payRegisterSummary.totals?.totalPaidLeaveDays || 0;
  let elUsedInPayroll = 0;
  try {
    const policy = await LeavePolicySettings.getSettings();
    if (policy.earnedLeave && policy.earnedLeave.useAsPaidInPayroll !== false) {
      const elBalance = Math.max(0, Number(employee.paidLeaves) || 0);
      if (elBalance > 0) {
        elUsedInPayroll = Math.min(elBalance, monthDays);
        payableShifts += elUsedInPayroll;
        paidLeaveDays += elUsedInPayroll;
      }
    }
  } catch (e) { /* ignore */ }
  const presentDays = payRegisterSummary.totals?.totalPresentDays || 0;
  const odDays = payRegisterSummary.totals?.totalODDays || 0;
  const weeklyOffs = payRegisterSummary.totals?.totalWeeklyOffs || 0;
  const holidays = payRegisterSummary.totals?.totalHolidays || 0;
  const absentDays = Math.max(0, monthDays - presentDays - weeklyOffs - holidays - paidLeaveDays);
  const lopDays = payRegisterSummary.totals?.totalLopDays ?? payRegisterSummary.totals?.lopDays ?? 0;
  const otHours = payRegisterSummary.totals?.totalOTHours || 0;
  const otDays = payRegisterSummary.totals?.totalOTDays || 0;
  const lateCount = (payRegisterSummary.totals?.lateCount || 0) + (payRegisterSummary.totals?.earlyOutCount || 0);

  const attendanceSummary = {
    totalDaysInMonth: monthDays,
    totalPresentDays: presentDays,
    totalPaidLeaveDays: paidLeaveDays,
    totalODDays: odDays,
    totalWeeklyOffs: weeklyOffs,
    totalHolidays: holidays,
    totalPayableShifts: payableShifts,
    totalOTHours: otHours,
    totalOTDays: otDays,
    totalLeaveDays: payRegisterSummary.totals?.totalLeaveDays || 0,
    lateCount,
    earlyOutCount: payRegisterSummary.totals?.earlyOutCount || 0,
  };

  const attendance = {
    totalDaysInMonth: monthDays,
    presentDays,
    paidLeaveDays,
    odDays,
    weeklyOffs,
    holidays,
    absentDays,
    payableShifts,
    extraDays: payRegisterSummary.totals?.extraDays ?? 0,
    totalPaidDays: 0,
    otHours,
    otDays,
    earnedSalary: 0,
    lopDays,
    elUsedInPayroll,
    attendanceDeductionDays: 0,
  };

  return { attendanceSummary, attendance };
}

/**
 * Resolve a field value: from employee, from attendance (pay register), or by calling the right service.
 * Fills record with the computed block when a service is called.
 */
async function resolveFieldValue(fieldPath, employee, employeeId, month, payRegisterSummary, record, attendanceSummary, departmentId, divisionId, options = {}) {
  const path = (fieldPath || '').trim();
  if (!path) return 0;
  const { context: colContext, config: payrollConfig } = options;

  // attendance.attendanceDeductionDays — ensure attendance deduction is computed first (column-order independent)
  if (path === 'attendance.attendanceDeductionDays' || path === 'attendanceDeductionDays') {
    if (record.deductions?.attendanceDeductionBreakdown == null) {
      const perDaySalary = Number(record.earnings?.perDayBasicPay) || 0;
      const absentDays = Number(record.attendance?.absentDays ?? 0);
      const absentSettings = await getAbsentDeductionSettings(departmentId || '', divisionId || null);
      const attendanceDeductionResult = await deductionService.calculateAttendanceDeduction(
        employeeId,
        month,
        departmentId,
        perDaySalary,
        employee?.division_id ?? divisionId,
        {
          employee: employee ?? undefined,
          absentDays,
          enableAbsentDeduction: absentSettings?.enableAbsentDeduction,
          lopDaysPerAbsent: absentSettings?.lopDaysPerAbsent,
        }
      );
      if (!record.deductions) record.deductions = {};
      record.deductions.attendanceDeduction = attendanceDeductionResult.attendanceDeduction || 0;
      record.deductions.attendanceDeductionBreakdown = attendanceDeductionResult.breakdown || {};
      if (!record.attendance) record.attendance = {};
      record.attendance.attendanceDeductionDays = attendanceDeductionResult.breakdown?.daysDeducted ?? 0;
    }
    return Number(record.attendance?.attendanceDeductionDays ?? record.deductions?.attendanceDeductionBreakdown?.daysDeducted ?? 0);
  }

  // employee.* display fields (name, designation, emp_no, etc.) — return as-is, never coerce to number
  if (path.startsWith('employee.')) {
    const key = path.slice('employee.'.length);
    if (key.startsWith('salaries.')) {
      const fieldId = key.slice('salaries.'.length);
      const salaries = employee?.salaries;
      if (salaries && typeof salaries === 'object' && !Array.isArray(salaries) && fieldId) {
        const raw = salaries[fieldId];
        if (raw === undefined || raw === null || raw === '') return 0;
        const n = typeof raw === 'number' ? raw : Number(raw);
        return Number.isFinite(n) ? n : 0;
      }
      return 0;
    }
    const emp = record.employee || {};
    let v = emp[key];
    if (v === undefined || v === null) v = key === 'name' ? (employee?.employee_name ?? '') : (employee?.[key] ?? '');
    return v;
  }

  // arrears.* — always from service (or options.arrearsSettlements when provided)
  if (path.startsWith('arrears.')) {
    const arrearsSettlements = options.arrearsSettlements;
    let arrearsAmount = 0;
    if (arrearsSettlements && arrearsSettlements.length > 0) {
      arrearsAmount = arrearsSettlements.reduce((s, a) => s + (Number(a.amount) || 0), 0);
    } else {
      try {
        const pendingArrears = await ArrearsPayrollIntegrationService.getPendingArrearsForPayroll(employeeId);
        arrearsAmount = (pendingArrears || []).reduce((sum, ar) => sum + (ar.remainingAmount || 0), 0);
      } catch (e) {
        arrearsAmount = 0;
      }
    }
    arrearsAmount = Math.round(arrearsAmount * 100) / 100;
    if (!record.arrears) record.arrears = { arrearsAmount: 0, arrearsSettlements: [] };
    record.arrears.arrearsAmount = arrearsAmount;
    if (arrearsSettlements && arrearsSettlements.length > 0) record.arrears.arrearsSettlements = arrearsSettlements;
    return path === 'arrears.arrearsAmount' ? arrearsAmount : arrearsAmount;
  }

  // manualDeductions.* / manualDeductionsAmount — always from service (or options.deductionSettlements when provided)
  if (path.startsWith('manualDeductions.') || path === 'manualDeductionsAmount') {
    const deductionSettlements = options.deductionSettlements;
    let manualDeductionsAmount = 0;
    if (deductionSettlements && deductionSettlements.length > 0) {
      manualDeductionsAmount = deductionSettlements.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    } else {
      try {
        const pending = await DeductionPayrollIntegrationService.getPendingDeductionsForPayroll(employeeId);
        manualDeductionsAmount = (pending || []).reduce((sum, d) => sum + (d.remainingAmount || 0), 0);
      } catch (e) {
        manualDeductionsAmount = 0;
      }
    }
    if (!record.manualDeductions) record.manualDeductions = { manualDeductionsAmount: 0 };
    record.manualDeductions.manualDeductionsAmount = manualDeductionsAmount;
    record.manualDeductionsAmount = manualDeductionsAmount;
    return manualDeductionsAmount;
  }

  // Already in record (from a previous step)? Coerce only numeric paths.
  const existing = getValueByPath(record, path);
  if (existing !== '' && existing !== undefined && existing !== null) {
    if (typeof existing === 'number' && !Number.isNaN(existing)) return existing;
    const num = Number(existing);
    if (!Number.isNaN(num)) return num;
    return 0;
  }

  // attendance.* from our built attendance
  if (path.startsWith('attendance.')) {
    const val = getValueByPath(record, path);
    return typeof val === 'number' ? val : Number(val) || 0;
  }

  // earnings.basicPay, perDayBasicPay, etc. → basicPayService
  if (path.startsWith('earnings.basicPay') || path.startsWith('earnings.perDayBasicPay') || path === 'earnings.payableAmount' || path === 'earnings.incentive') {
    const basicPayResult = basicPayService.calculateBasicPay(employee, attendanceSummary);
    const basicPay = basicPayResult.basicPay || 0;
    const perDaySalary = basicPayResult.perDayBasicPay || 0;
    const earnedSalary = basicPayResult.basePayForWork || 0;
    const incentiveAmount = basicPayResult.incentive || 0;
    const extraDays = basicPayResult.incentiveDays || 0;
    const totalPaidDays = (basicPayResult.physicalUnits || 0) + extraDays;
    if (!record.earnings) record.earnings = {};
    record.earnings.basicPay = basicPay;
    record.earnings.perDayBasicPay = perDaySalary;
    record.earnings.payableAmount = earnedSalary;
    record.earnings.earnedSalary = earnedSalary;
    record.earnings.incentive = incentiveAmount;
    if (!record.attendance) record.attendance = {};
    record.attendance.extraDays = extraDays;
    record.attendance.totalPaidDays = totalPaidDays;
    record.attendance.earnedSalary = earnedSalary;
    if (path === 'earnings.basicPay') return basicPay;
    if (path === 'earnings.perDayBasicPay') return perDaySalary;
    if (path === 'earnings.payableAmount' || path === 'earnings.earnedSalary') return earnedSalary;
    if (path === 'earnings.incentive') return incentiveAmount;
    return basicPay;
  }

  // earnings.otPay, otHours, otRatePerHour
  if (path.startsWith('earnings.ot')) {
    const departmentIdStr = (employee?.department_id?._id || employee?.department_id)?.toString() || departmentId?.toString();
    const otPayResult = await otPayService.calculateOTPay(attendanceSummary.totalOTHours || 0, departmentIdStr);
    if (!record.earnings) record.earnings = {};
    record.earnings.otPay = otPayResult.otPay || 0;
    record.earnings.otHours = attendanceSummary.totalOTHours || 0;
    record.earnings.otRatePerHour = otPayResult.otPayPerHour || 0;
    if (path === 'earnings.otPay') return record.earnings.otPay;
    if (path === 'earnings.otHours') return record.earnings.otHours;
    if (path === 'earnings.otRatePerHour') return record.earnings.otRatePerHour;
    return record.earnings.otPay || 0;
  }

  // earnings.allowances, totalAllowances, allowancesCumulative, grossSalary — use paid days from output column (context) when in dynamic payroll, same as statutory
  if (path.startsWith('earnings.allowances') || path === 'earnings.totalAllowances' || path === 'earnings.allowancesCumulative' || path === 'earnings.grossSalary') {
    const basicPay = Number(record.earnings?.basicPay) || 0;
    const earnedSalary = Number(record.earnings?.payableAmount ?? record.earnings?.earnedSalary) || 0;
    const otPay = Number(record.earnings?.otPay) || 0;
    let grossSoFar = earnedSalary + otPay;
    const attendanceData = {
      presentDays: record.attendance?.presentDays ?? 0,
      paidLeaveDays: record.attendance?.paidLeaveDays ?? 0,
      odDays: record.attendance?.odDays ?? 0,
      monthDays: record.attendance?.totalDaysInMonth ?? 30,
    };
    const { paidDays: paidDaysFromCol, totalDaysInMonth: totalDaysFromCol } = getPaidDaysAndTotalDaysFromContext(colContext, payrollConfig);
    if (paidDaysFromCol != null) attendanceData.totalPaidDays = paidDaysFromCol;
    if (totalDaysFromCol != null && totalDaysFromCol > 0) {
      attendanceData.totalDaysInMonth = totalDaysFromCol;
      attendanceData.monthDays = totalDaysFromCol;
    }
    const includeMissing = await getIncludeMissingFlag(departmentId, divisionId);
    const { allowances: baseAllowances } = await buildBaseComponents(departmentId, basicPay, attendanceData, employee?.division_id);
    const normalized = normalizeOverrides(employee?.employeeAllowances || [], 'allowance');
    const resolvedAllowances = mergeWithOverrides(baseAllowances, normalized, includeMissing);
    let totalAllowances = 0;
    const allowanceBreakdown = (resolvedAllowances || [])
      .filter((a) => a && a.name)
      .map((a) => {
        const baseAmount = (a.base || '').toLowerCase() === 'gross' ? grossSoFar : earnedSalary;
        const amount = allowanceService.calculateAllowanceAmount(a, baseAmount, grossSoFar, attendanceData);
        totalAllowances += amount;
        return { name: a.name, amount, type: a.type || 'fixed', base: (a.base || '').toLowerCase() === 'gross' ? 'gross' : 'basic' };
      });
    grossSoFar += totalAllowances;
    if (!record.earnings) record.earnings = {};
    record.earnings.allowances = allowanceBreakdown;
    record.earnings.totalAllowances = totalAllowances;
    record.earnings.allowancesCumulative = totalAllowances;
    record.earnings.grossSalary = grossSoFar;
    if (path === 'earnings.totalAllowances' || path === 'earnings.allowancesCumulative') return totalAllowances;
    if (path === 'earnings.grossSalary') return grossSoFar;
    return totalAllowances;
  }

  // deductions.attendanceDeduction (employee flags respected via options.employee; absent-extra parity with main payroll)
  if (path.startsWith('deductions.attendanceDeduction')) {
    const perDaySalary = Number(record.earnings?.perDayBasicPay) || 0;
    const absentDays = Number(record.attendance?.absentDays ?? 0);
    const absentSettings = await getAbsentDeductionSettings(departmentId || '', divisionId || null);
    const attendanceDeductionResult = await deductionService.calculateAttendanceDeduction(
      employeeId,
      month,
      departmentId,
      perDaySalary,
      employee?.division_id ?? divisionId,
      {
        employee: employee ?? undefined,
        absentDays,
        enableAbsentDeduction: absentSettings?.enableAbsentDeduction,
        lopDaysPerAbsent: absentSettings?.lopDaysPerAbsent,
      }
    );
    const amt = attendanceDeductionResult.attendanceDeduction || 0;
    if (!record.deductions) record.deductions = {};
    record.deductions.attendanceDeduction = amt;
    record.deductions.attendanceDeductionBreakdown = attendanceDeductionResult.breakdown || {};
    record.attendance.attendanceDeductionDays = attendanceDeductionResult.breakdown?.daysDeducted ?? 0;
    const br = record.deductions.attendanceDeductionBreakdown || {};
    if (path === 'deductions.attendanceDeductionBreakdown.daysDeducted') {
      return Number(br.daysDeducted ?? 0);
    }
    if (path.startsWith('deductions.attendanceDeductionBreakdown.')) {
      const sub = path.slice('deductions.attendanceDeductionBreakdown.'.length);
      const v = br[sub];
      return typeof v === 'number' && !Number.isNaN(v) ? v : (Number(v) || 0);
    }
    return amt;
  }

  // deductions.otherDeductions, totalOtherDeductions — use paid days from output column (context) when in dynamic payroll, same as statutory
  if (path.startsWith('deductions.other') || path === 'deductions.totalOtherDeductions') {
    const earnedSalary = Number(record.earnings?.payableAmount ?? record.earnings?.earnedSalary) || 0;
    const grossSalary = Number(record.earnings?.grossSalary) || 0;
    const attendanceData = {
      presentDays: record.attendance?.presentDays ?? 0,
      paidLeaveDays: record.attendance?.paidLeaveDays ?? 0,
      odDays: record.attendance?.odDays ?? 0,
      monthDays: record.attendance?.totalDaysInMonth ?? 30,
    };
    const { paidDays: paidDaysFromCol, totalDaysInMonth: totalDaysFromCol } = getPaidDaysAndTotalDaysFromContext(colContext, payrollConfig);
    if (paidDaysFromCol != null) attendanceData.totalPaidDays = paidDaysFromCol;
    if (totalDaysFromCol != null && totalDaysFromCol > 0) {
      attendanceData.totalDaysInMonth = totalDaysFromCol;
      attendanceData.monthDays = totalDaysFromCol;
    }
    const includeMissing = await getIncludeMissingFlag(departmentId, divisionId);
    const { deductions: baseDeductions } = await buildBaseComponents(departmentId, record.earnings?.basicPay || 0, attendanceData, employee?.division_id);
    const normalized = normalizeOverrides(employee?.employeeDeductions || [], 'deduction');
    const resolvedDeductions = mergeWithOverrides(baseDeductions, normalized, includeMissing);
    let totalOther = 0;
    const otherBreakdown = (resolvedDeductions || [])
      .filter((d) => d && d.name)
      .map((d) => {
        const baseAmount = (d.base || '').toLowerCase() === 'gross' ? grossSalary : earnedSalary;
        const amount = deductionService.calculateDeductionAmount(d, baseAmount, grossSalary, attendanceData);
        totalOther += amount;
        return { name: d.name, amount, type: d.type || 'fixed', base: (d.base || '').toLowerCase() === 'gross' ? 'gross' : 'basic' };
      });
    const attendanceDed = Number(record.deductions?.attendanceDeduction) || 0;
    if (!record.deductions) record.deductions = {};
    record.deductions.otherDeductions = otherBreakdown;
    record.deductions.totalOtherDeductions = totalOther;
    return path === 'deductions.totalOtherDeductions' ? totalOther : totalOther;
  }

  // deductions.statutoryDeductions, statutoryCumulative
  // Paid/total days for proration: 1) explicit config header if set, 2) else auto-detect by column name (e.g. "Paid Days", "Present Days"), 3) else record.attendance.
  if (path.startsWith('deductions.statutory')) {
    const basicPay = Number(record.earnings?.basicPay) || 0;
    const grossSalary = Number(record.earnings?.grossSalary) || 0;
    const earnedSalary = Number(record.earnings?.payableAmount ?? record.earnings?.earnedSalary) || 0;
    let totalDaysInMonth = Number(record.attendance?.totalDaysInMonth) || 30;
    let paidDays;
    const paidDaysHeader = payrollConfig && typeof payrollConfig.statutoryProratePaidDaysColumnHeader === 'string' && payrollConfig.statutoryProratePaidDaysColumnHeader.trim();
    const totalDaysHeader = payrollConfig && typeof payrollConfig.statutoryProrateTotalDaysColumnHeader === 'string' && payrollConfig.statutoryProrateTotalDaysColumnHeader.trim();
    if (paidDaysHeader && colContext && typeof colContext === 'object') {
      const paidDaysKey = headerToKey(paidDaysHeader);
      const fromCol = colContext[paidDaysKey];
      paidDays = typeof fromCol === 'number' && !Number.isNaN(fromCol) ? fromCol : (Number(fromCol) || 0);
    } else {
      const autoPaid = getFromContextByHeaderNames(colContext, PAID_DAYS_HEADER_CANDIDATES);
      paidDays = autoPaid != null ? autoPaid : (
        (typeof record.attendance?.totalPaidDays === 'number' && record.attendance.totalPaidDays >= 0)
          ? record.attendance.totalPaidDays
          : ((Number(record.attendance?.presentDays) || 0) + (Number(record.attendance?.paidLeaveDays) || 0) + (Number(record.attendance?.weeklyOffs) || 0) + (Number(record.attendance?.holidays) || 0))
      );
    }
    if (totalDaysHeader && colContext && typeof colContext === 'object') {
      const totalDaysKey = headerToKey(totalDaysHeader);
      const fromCol = colContext[totalDaysKey];
      const t = typeof fromCol === 'number' && !Number.isNaN(fromCol) ? fromCol : (Number(fromCol) || 0);
      if (t > 0) totalDaysInMonth = t;
    } else {
      const autoTotal = getFromContextByHeaderNames(colContext, TOTAL_DAYS_HEADER_CANDIDATES);
      if (autoTotal != null && autoTotal > 0) totalDaysInMonth = autoTotal;
    }
    const professionTaxSlabBase = getProfessionTaxSlabBaseFromContext(colContext, payrollConfig);
    const statutoryResult = await statutoryDeductionService.calculateStatutoryDeductions({
      basicPay,
      grossSalary,
      earnedSalary,
      dearnessAllowance: 0,
      employee,
      paidDays,
      totalDaysInMonth,
      allSalaries: {},
      ...(professionTaxSlabBase !== undefined ? { professionTaxSlabBase } : {}),
    });
    const totalStatutory = statutoryResult.totalEmployeeShare || 0;
    if (!record.deductions) record.deductions = {};
    record.deductions.statutoryDeductions = (statutoryResult.breakdown || []).map((s) => ({
      name: s.name, code: s.code, employeeAmount: s.employeeAmount, employerAmount: s.employerAmount,
    }));
    record.deductions.statutoryCumulative = totalStatutory;
    record.deductions.totalStatutoryEmployee = totalStatutory;
    return totalStatutory;
  }

  // loanAdvance.totalEMI, advanceDeduction, remainingBalance (cumulative loans remaining after EMI)
  if (path.startsWith('loanAdvance.')) {
    const loanAdvanceResult = await loanAdvanceService.calculateLoanAdvance(employeeId, month);
    if (!record.loanAdvance) record.loanAdvance = {};
    record.loanAdvance.totalEMI = loanAdvanceResult.totalEMI || 0;
    record.loanAdvance.advanceDeduction = loanAdvanceResult.advanceDeduction || 0;
    record.loanAdvance.remainingBalance = loanAdvanceResult.remainingBalance ?? 0;
    if (path === 'loanAdvance.totalEMI') return record.loanAdvance.totalEMI;
    if (path === 'loanAdvance.advanceDeduction') return record.loanAdvance.advanceDeduction;
    if (path === 'loanAdvance.remainingBalance') return record.loanAdvance.remainingBalance;
    return record.loanAdvance.totalEMI || 0;
  }

  // deductions.deductionsCumulative (dynamic: only "other deductions" from allowances-deductions; excludes attendance, statutory, loan, advance, manual)
  // deductions.totalDeductions (full total for net salary: att + otherOnly + statutory + loanEMI + advance + manualDed)
  if (path === 'deductions.deductionsCumulative' || path === 'deductions.totalDeductions') {
    const att = Number(record.deductions?.attendanceDeduction) || 0;
    const statutory = Number(record.deductions?.statutoryCumulative) || 0;
    const loanEMI = Number(record.loanAdvance?.totalEMI) || 0;
    const advance = Number(record.loanAdvance?.advanceDeduction) || 0;
    const manualDed = Number(record.manualDeductionsAmount) || 0;
    console.log('[DynamicPayroll][resolveFieldValue] Raw :', record.deductions);
    // Other deductions from allowances-deductions config only:
    // exclude components that are tracked separately (attendance, absent LOP, statutory, loan/advance, manual)
    const rawOther = Array.isArray(record.deductions?.otherDeductions)
      ? record.deductions.otherDeductions
      : [];
    console.log('[DynamicPayroll][resolveFieldValue] Raw otherDeductions breakdown:', rawOther.map(d => ({
      name: d?.name,
      amount: d?.amount,
    })));

    const otherDeductionsOnly = rawOther
      .filter((d) => {
        if (!d) return false;
        const name = String(d.name || '').trim().toUpperCase();
        if (name === 'MANUAL DEDUCTION') return false;
        if (name === 'ATTENDANCE DEDUCTION (LATE/EARLY)') return false;
        if (name === 'ABSENT LOP DEDUCTION') return false;
        if (name === 'EPF' || name === 'ESI' || name === 'PROFESSION TAX' || name === 'SALARY ADVANCE') return false;
        return true;
      })
      .reduce((sum, d) => sum + (Number(d.amount) || 0), 0);

    const fullTotal = att + otherDeductionsOnly + statutory + loanEMI + advance + manualDed;

    console.log('[DynamicPayroll][resolveFieldValue] Aggregated components:', {
      attendanceDeduction: att,
      otherFiltered: otherDeductionsOnly,
      statutoryCumulative: statutory,
      loanEMI,
      advance,
      manualDeductionsAmount: manualDed,
      totalDeductions: fullTotal,
    });
    if (!record.deductions) record.deductions = {};
    // Revert to original behaviour:
    // - deductionsCumulative = only "other" deductions (after exclusions)
    // - totalDeductions = full total (for net salary)
    record.deductions.deductionsCumulative = otherDeductionsOnly;
    record.deductions.totalDeductions = fullTotal;
    return path === 'deductions.deductionsCumulative' ? otherDeductionsOnly : fullTotal;
  }

  // netSalary, roundOff (derive at end if needed)
  if (path === 'netSalary' || path === 'roundOff') {
    const gross = Number(record.earnings?.grossSalary) || 0;
    let totalDed = Number(record.deductions?.totalDeductions) || 0;
    if (totalDed === 0) {
      const att = Number(record.deductions?.attendanceDeduction) || 0;
      const statutory = Number(record.deductions?.statutoryCumulative) || 0;
      const loanEMI = Number(record.loanAdvance?.totalEMI) || 0;
      const advance = Number(record.loanAdvance?.advanceDeduction) || 0;
      const manualDed = Number(record.manualDeductionsAmount) || 0;
      const otherOnly = (record.deductions?.otherDeductions || [])
        .filter((d) => {
          if (!d) return false;
          const name = String(d.name || '').trim().toUpperCase();
          if (name === 'MANUAL DEDUCTION') return false;
          if (name === 'ATTENDANCE DEDUCTION (LATE/EARLY)') return false;
          if (name === 'ABSENT LOP DEDUCTION') return false;
          if (name === 'EPF' || name === 'ESI' || name === 'PROFESSION TAX' || name === 'SALARY ADVANCE') return false;
          return true;
        })
        .reduce((s, d) => s + (Number(d.amount) || 0), 0);
      totalDed = att + otherOnly + statutory + loanEMI + advance + manualDed;
      if (!record.deductions) record.deductions = {};
      record.deductions.deductionsCumulative = otherOnly;
      record.deductions.totalDeductions = totalDed;
    }
    const exactNet = Math.max(0, gross - totalDed);
    const roundedNet = Math.ceil(exactNet);
    const roundOffAmt = Number((roundedNet - exactNet).toFixed(2));
    record.netSalary = roundedNet;
    record.roundOff = roundOffAmt;
    return path === 'netSalary' ? roundedNet : roundOffAmt;
  }

  return getValueByPath(record, path) ?? 0;
}

/** Use second_salary as gross_salary for dynamic-engine proration (plain object for services). */
function employeeForSecondSalaryBasis(employee) {
  const base = employee && typeof employee.toObject === 'function' ? employee.toObject() : { ...(employee || {}) };
  base.gross_salary = Number(employee.second_salary) || 0;
  return base;
}

function buildAttendancePatchForSecondSalary(recordAttendance, payRegisterSummary, earnedFallback) {
  const prsTotals = payRegisterSummary?.totals || {};
  const att = recordAttendance || {};
  return {
    totalDaysInMonth: att.totalDaysInMonth ?? payRegisterSummary?.totalDaysInMonth ?? 30,
    presentDays: att.presentDays ?? 0,
    paidLeaveDays: att.paidLeaveDays ?? 0,
    odDays: att.odDays ?? 0,
    weeklyOffs: att.weeklyOffs ?? prsTotals.totalWeeklyOffs ?? 0,
    holidays: att.holidays ?? prsTotals.totalHolidays ?? 0,
    absentDays: att.absentDays ?? 0,
    payableShifts: att.payableShifts ?? prsTotals.totalPayableShifts ?? 0,
    extraDays: att.extraDays ?? 0,
    totalPaidDays: att.totalPaidDays ?? 0,
    paidDays: att.paidDays ?? att.totalPaidDays ?? 0,
    otHours: att.otHours ?? prsTotals.totalOTHours ?? 0,
    otDays: att.otDays ?? 0,
    earnedSalary: att.earnedSalary ?? earnedFallback ?? 0,
    lopDays: att.lopDays ?? 0,
    elUsedInPayroll: att.elUsedInPayroll ?? 0,
  };
}

/**
 * If Pay Register did not pass arrears settlements, pending totals may still be loaded later only when an
 * arrears FIELD column runs — formulas earlier in the list would see arrearsAmount as 0 in context.
 * Prime from pending when there are no explicit settlements (same totals resolveFieldValue would use).
 */
async function primeArrearsFromPendingIfNoSettlements(record, employeeId, arrearsSettlements) {
  if (arrearsSettlements.length) return;
  try {
    const pendingArrears = await ArrearsPayrollIntegrationService.getPendingArrearsForPayroll(employeeId);
    const arrearsAmount = Math.round(
      (pendingArrears || []).reduce((sum, ar) => sum + (Number(ar.remainingAmount) || 0), 0) * 100
    ) / 100;
    if (!record.arrears) record.arrears = { arrearsAmount: 0, arrearsSettlements: [] };
    record.arrears.arrearsAmount = arrearsAmount;
  } catch (e) {
    console.warn('[PayrollFromOutputColumns] prime arrears from pending:', e.message);
  }
}

async function persistSecondSalaryFromOutputColumns(record, employee, userId, month, payRegisterSummary) {
  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr, 10);
  const monthNum = parseInt(monthStr, 10);
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const monthName = `${monthNames[monthNum - 1]} ${year}`;
  const employeeId = employee._id;
  const totalDaysInMonth = record.attendance?.totalDaysInMonth ?? payRegisterSummary?.totalDaysInMonth ?? 30;
  const secondAmt = Number(employee.second_salary) || 0;

  let ssRecord = await SecondSalaryRecord.findOne({ employeeId, month });
  if (!ssRecord) {
    ssRecord = new SecondSalaryRecord({
      employeeId,
      emp_no: employee.emp_no,
      month,
      monthName,
      year,
      monthNumber: monthNum,
      totalDaysInMonth,
    });
  } else {
    ssRecord.monthName = monthName;
    ssRecord.totalDaysInMonth = totalDaysInMonth;
  }

  const earnedFallback = Number(record.earnings?.payableAmount ?? record.earnings?.earnedSalary) || 0;
  ssRecord.set('netSalary', Number(record.netSalary) || 0);
  ssRecord.set('roundOff', Number(record.roundOff) || 0);
  ssRecord.set('payableAmountBeforeAdvance', Number(record.earnings?.grossSalary) || 0);
  ssRecord.set('status', 'calculated');
  const divId = employee.division_id?._id ?? employee.division_id;
  const deptId = employee.department_id?._id ?? employee.department_id;
  ssRecord.set('division_id', divId);
  ssRecord.set('totalPayableShifts', record.attendance?.payableShifts ?? payRegisterSummary?.totals?.totalPayableShifts ?? 0);
  ssRecord.set('attendance', buildAttendancePatchForSecondSalary(record.attendance, payRegisterSummary, earnedFallback));
  ssRecord.set('earnings', {
    ...(record.earnings || {}),
    secondSalaryAmount: secondAmt,
    basicPay: record.earnings?.basicPay ?? secondAmt,
  });
  ssRecord.set('deductions', record.deductions || {});
  ssRecord.set('loanAdvance', record.loanAdvance || {});
  ssRecord.set('arrearsAmount', Number(record.arrears?.arrearsAmount) || 0);
  ssRecord.set('manualDeductionsAmount', Number(record.manualDeductionsAmount) || 0);
  const arrSet = record.arrears?.arrearsSettlements;
  if (Array.isArray(arrSet) && arrSet.length > 0) {
    ssRecord.set('arrearsSettlements', arrSet);
    ssRecord.markModified('arrearsSettlements');
  }
  const dedSet = record.deductionSettlements;
  if (Array.isArray(dedSet) && dedSet.length > 0) {
    ssRecord.set('deductionSettlements', dedSet);
    ssRecord.markModified('deductionSettlements');
  }
  await ssRecord.save();

  let batch = null;
  if (deptId && divId) {
    batch = await SecondSalaryBatch.findOne({ department: deptId, division: divId, month });
    if (!batch) {
      batch = await SecondSalaryBatchService.createBatch(deptId, divId, month, userId);
    }
    if (batch) {
      await SecondSalaryBatchService.addPayrollToBatch(batch._id, ssRecord._id);
    }
  }
  return { secondSalaryRecord: ssRecord, batchId: batch?._id };
}

/**
 * Calculate payroll for one employee using config.outputColumns as steps.
 * Persists PayrollRecord and returns { payrollRecord, payslip, row }.
 * options.secondSalaryBasis: use employee.second_salary as gross basis and persist SecondSalaryRecord (not PayrollRecord).
 */
async function calculatePayrollFromOutputColumns(employeeId, month, userId, options = {}) {
  const employee = await Employee.findById(employeeId).populate('department_id designation_id division_id');
  if (!employee) throw new Error('Employee not found');

  const payRegisterSummary = await PayRegisterSummary.findOne({ employeeId, month });
  if (!payRegisterSummary) throw new Error('Pay register not found for this month');

  const secondSalaryBasis = !!options.secondSalaryBasis;
  const calcEmployee = secondSalaryBasis ? employeeForSecondSalaryBasis(employee) : employee;

  const config = await PayrollConfiguration.get();
  const outputColumns = Array.isArray(config?.outputColumns) ? config.outputColumns : [];
  const sorted = [...outputColumns].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const outputColumnsNormalized = normalizeOutputColumns(sorted);

  const departmentId = (employee.department_id?._id || employee.department_id)?.toString();
  const divisionId = (employee.division_id?._id || employee.division_id)?.toString();
  await enforceBatchLock({
    kind: secondSalaryBasis ? 'second_salary' : 'regular',
    month,
    departmentId,
    divisionId,
    employeeId,
  });

  const { attendanceSummary, attendance } = await buildAttendanceFromSummary(payRegisterSummary, employee, month);

  const record = {
    month: createISTDate(`${month}-01`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }),
    monthNumber: Number(month.split('-')[1]),
    year: Number(month.split('-')[0]),
    employee: {
      emp_no: employee.emp_no || '',
      name: employee.employee_name || 'N/A',
      department: employee.department_id?.name || 'N/A',
      division: employee.division_id?.name || 'N/A',
      designation: employee.designation_id?.name || 'N/A',
      location: employee.location || '',
      bank_account_no: employee.bank_account_no || '',
      bank_name: employee.bank_name || '',
      bank_place: employee.bank_place || '',
      ifsc_code: employee.ifsc_code || '',
      payment_mode: employee.salary_mode || '',
      date_of_joining: employee.doj || '',
      pf_number: employee.pf_number || '',
      esi_number: employee.esi_number || '',
      leftDate: employee.leftDate,
    },
    attendance: { ...attendance },
    earnings: {},
    deductions: {},
    loanAdvance: {},
    arrears: { arrearsAmount: 0, arrearsSettlements: [] },
    manualDeductions: { manualDeductionsAmount: 0 },
    manualDeductionsAmount: 0,
    netSalary: 0,
    roundOff: 0,
    status: 'calculated',
  };

  // Basic pay from employee model; standard days from pay register (already in record.attendance).
  const employeeBasicPay = Number(calcEmployee.gross_salary) || 0;
  record.earnings.basicPay = employeeBasicPay;
  record.earnings.basic_pay = employeeBasicPay;

  const required = getRequiredServices(sorted);
  await runRequiredServices(required, record, calcEmployee, employeeId, month, payRegisterSummary, attendanceSummary, departmentId, divisionId, config);

  // When pay register passes selected arrears, use that sum so config/formulas see the correct amount
  const arrearsSettlements = options.arrearsSettlements || [];
  if (arrearsSettlements.length > 0) {
    const arrearsSum = arrearsSettlements.reduce((s, a) => s + (Number(a.amount) || 0), 0);
    if (!record.arrears) record.arrears = { arrearsAmount: 0, arrearsSettlements: [] };
    record.arrears.arrearsAmount = Math.round(arrearsSum * 100) / 100;
    record.arrears.arrearsSettlements = arrearsSettlements;
  }

  // Apply manual deduction settlements before column loop so outcome vars (manualDeductionsAmount) are available in config/formulas
  const deductionSettlements = options.deductionSettlements || [];
  if (deductionSettlements.length > 0) {
    try {
      await DeductionIntegrationService.addDeductionsToPayroll(record, deductionSettlements, employeeId);
      record.manualDeductions = record.manualDeductions || {};
      record.manualDeductions.manualDeductionsAmount = record.manualDeductionsAmount || 0;
    } catch (e) {
      console.error('[PayrollFromOutputColumns] Manual deductions apply error:', e.message);
    }
  }

  await primeArrearsFromPendingIfNoSettlements(record, employeeId, arrearsSettlements);

  const context = { ...outputColumnService.getContextFromPayslip(record) };
  const row = {};

  for (const col of sorted) {
    const header = col.header || 'Column';
    let val;
    const hasFormula = typeof col.formula === 'string' && col.formula.trim().length > 0;
    if (hasFormula) {
      val = outputColumnService.safeEvalFormula(col.formula, context) ?? 0;
    } else {
      const fieldPath = (col.field || '').trim();
      // Always resolve from services (and options when provided), not from the in-memory payslip/record
      val = fieldPath
        ? await resolveFieldValue(
          fieldPath, calcEmployee, employeeId, month, payRegisterSummary,
          record, attendanceSummary, departmentId, divisionId,
          {
            context,
            config,
            arrearsSettlements: options.arrearsSettlements,
            deductionSettlements: options.deductionSettlements,
          }
        )
        : 0;
      if (fieldPath) setValueByPath(record, fieldPath, val);
    }
    row[header] = val;
    const numForContext = typeof val === 'number' && !Number.isNaN(val) ? val : (Number(val) || 0);
    for (const k of getContextKeysAndAliases(header)) context[k] = numForContext;
  }

  // Recompute: deductionsCumulative = only "other deductions" (allowances-deductions); totalDeductions = full total for net
  if (record.deductions) {
    const att = Number(record.deductions.attendanceDeduction) || 0;
    const statutory = Number(record.deductions.statutoryCumulative) || 0;
    const loanEMI = Number(record.loanAdvance?.totalEMI) || 0;
    const advance = Number(record.loanAdvance?.advanceDeduction) || 0;
    const manualDed = Number(record.manualDeductionsAmount) || 0;
    const otherDeductionsOnly = (record.deductions.otherDeductions || [])
      .filter((d) => d && String(d.name || '').trim() !== 'Manual Deduction')
      .reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
    record.deductions.deductionsCumulative = otherDeductionsOnly;
    record.deductions.totalDeductions = att + otherDeductionsOnly + statutory + loanEMI + advance + manualDed;
  }

  // Ensure net and roundOff
  const gross = Number(record.earnings?.grossSalary) || 0;
  const totalDed = Number(record.deductions?.totalDeductions) || 0;
  if (record.netSalary === 0 && totalDed > 0) {
    const exactNet = Math.max(0, gross - totalDed);
    record.netSalary = Math.ceil(exactNet);
    record.roundOff = Number((record.netSalary - exactNet).toFixed(2));
  } else if (record.netSalary === 0) {
    record.netSalary = Math.ceil(gross);
    record.roundOff = 0;
  }

  if (secondSalaryBasis) {
    const { secondSalaryRecord, batchId } = await persistSecondSalaryFromOutputColumns(
      record,
      employee,
      userId,
      month,
      payRegisterSummary
    );
    try {
      const { expandedColumns, headers, rowData } = buildPaysheetSnapshotData(record, outputColumnsNormalized, config);
      await PayrollPayslipSnapshot.upsertSnapshot(
        { employeeId, month, kind: 'second_salary' },
        {
          employeeId,
          emp_no: employee.emp_no || '',
          month,
          kind: 'second_salary',
          payrollRecordId: null,
          secondSalaryRecordId: secondSalaryRecord?._id || null,
          configSnapshot: {
            configId: config?._id || null,
            configUpdatedAt: config?.updatedAt || config?.updated_at || null,
            statutoryProratePaidDaysColumnHeader: String(config?.statutoryProratePaidDaysColumnHeader || ''),
            statutoryProrateTotalDaysColumnHeader: String(config?.statutoryProrateTotalDaysColumnHeader || ''),
            professionTaxSlabEarningsColumnHeader: String(config?.professionTaxSlabEarningsColumnHeader || ''),
            outputColumns: outputColumnsNormalized,
            expandedColumns,
          },
          headers,
          row: rowData,
          generatedAt: new Date(),
          generatedBy: userId || null,
          source: 'dynamic_engine',
        }
      );
    } catch (e) {
      console.warn('[PayrollFromOutputColumns] snapshot write (2nd salary) failed:', e.message);
    }
    return {
      success: true,
      payrollRecord: null,
      secondSalaryRecord,
      batchId,
      payslip: record,
      row,
    };
  }

  // Persist PayrollRecord (same shape as previous calculation)
  let payrollRecord = await PayrollRecord.findOne({ employeeId, month });
  const monthDays = record.attendance?.totalDaysInMonth || 30;
  const payableShifts = (record.attendance?.payableShifts ?? payRegisterSummary.totals?.totalPayableShifts) || 0;
  const elUsedInPayroll = record.attendance?.elUsedInPayroll ?? 0;

  if (!payrollRecord) {
    payrollRecord = new PayrollRecord({
      employeeId,
      emp_no: employee.emp_no,
      month,
      monthName: record.month,
      year: record.year,
      monthNumber: record.monthNumber,
      totalDaysInMonth: monthDays,
    });
  }

  payrollRecord.set('totalPayableShifts', payableShifts);
  payrollRecord.set('elUsedInPayroll', elUsedInPayroll);
  payrollRecord.set('division_id', employee.division_id);
  payrollRecord.set('status', 'calculated');
  payrollRecord.set('netSalary', Number(record.netSalary) || 0);
  payrollRecord.set('roundOff', Number(record.roundOff) || 0);
  payrollRecord.set('arrearsAmount', Number(record.arrears?.arrearsAmount) || 0);
  payrollRecord.set('manualDeductionsAmount', Number(record.manualDeductionsAmount) || 0);
  if (options.arrearsSettlements && options.arrearsSettlements.length > 0) {
    payrollRecord.set('arrearsSettlements', options.arrearsSettlements);
    payrollRecord.markModified('arrearsSettlements');
  }
  if (record.deductionSettlements && record.deductionSettlements.length > 0) {
    payrollRecord.set('deductionSettlements', record.deductionSettlements);
    payrollRecord.markModified('deductionSettlements');
  }
  payrollRecord.set('attendance', record.attendance || {});
  payrollRecord.set('earnings', record.earnings || {});
  payrollRecord.set('deductions', record.deductions || {});
  payrollRecord.set('loanAdvance', record.loanAdvance || {});
  payrollRecord.markModified('attendance');
  payrollRecord.markModified('earnings');
  payrollRecord.markModified('deductions');
  payrollRecord.markModified('loanAdvance');
  await payrollRecord.save();
  try {
    const { expandedColumns, headers, rowData } = buildPaysheetSnapshotData(record, outputColumnsNormalized, config);
    await PayrollPayslipSnapshot.upsertSnapshot(
      { employeeId, month, kind: 'regular' },
      {
        employeeId,
        emp_no: employee.emp_no || '',
        month,
        kind: 'regular',
        payrollRecordId: payrollRecord?._id || null,
        secondSalaryRecordId: null,
        configSnapshot: {
          configId: config?._id || null,
          configUpdatedAt: config?.updatedAt || config?.updated_at || null,
          statutoryProratePaidDaysColumnHeader: String(config?.statutoryProratePaidDaysColumnHeader || ''),
          statutoryProrateTotalDaysColumnHeader: String(config?.statutoryProrateTotalDaysColumnHeader || ''),
          professionTaxSlabEarningsColumnHeader: String(config?.professionTaxSlabEarningsColumnHeader || ''),
          outputColumns: outputColumnsNormalized,
          expandedColumns,
        },
        headers,
        row: rowData,
        generatedAt: new Date(),
        generatedBy: userId || null,
        source: 'dynamic_engine',
      }
    );
  } catch (e) {
    console.warn('[PayrollFromOutputColumns] snapshot write (regular) failed:', e.message);
  }

  // Create or find batch and add this payroll record (same as legacy flow — batches created right after record save)
  let batchId = null;
  const deptId = employee.department_id?._id ?? employee.department_id;
  const divId = employee.division_id?._id ?? employee.division_id;
  if (deptId && divId) {
    try {
      let batch = await PayrollBatch.findOne({
        department: deptId,
        division: divId,
        month,
      });
      if (!batch) {
        batch = await PayrollBatchService.createBatch(deptId, divId, month, userId);
      }
      if (batch) {
        await PayrollBatchService.addPayrollToBatch(batch._id, payrollRecord._id);
        batchId = batch._id;
      }
    } catch (e) {
      console.error('[PayrollFromOutputColumns] Batch create/add error:', e.message);
    }
  }

  return {
    success: true,
    payrollRecord,
    batchId,
    payslip: record,
    row,
  };
}

module.exports = {
  calculatePayrollFromOutputColumns,
  buildAttendanceFromSummary,
  resolveFieldValue,
  getRequiredServices,
  extractFormulaVariableNames,
  getPaidDaysAndTotalDaysFromContext,
};
