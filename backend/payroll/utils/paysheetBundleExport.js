/**
 * Paysheet bundle: Regular + 2nd salary + Comparison (paired columns + net diff).
 */

const XLSX = require('xlsx');
const outputColumnService = require('../services/outputColumnService');

const DEFAULT_FIXED_KEYS = ['S.No', 'Employee Code', 'Name', 'Designation', 'Department', 'Division'];

function payrollRecordToPayslipShape(record) {
  const emp = record.employeeId || {};
  const toObj = (x) => (x && typeof x.toObject === 'function' ? x.toObject() : x);
  const empObj = toObj(emp);
  const rawAtt = record.attendance && typeof record.attendance.toObject === 'function' ? record.attendance.toObject() : (record.attendance || {});
  const ded = record.deductions && typeof record.deductions.toObject === 'function' ? record.deductions.toObject() : (record.deductions || {});
  const daysFromBreakdown = Number(ded?.attendanceDeductionBreakdown?.daysDeducted);
  const attendanceDeductionDays = Number.isFinite(daysFromBreakdown)
    ? daysFromBreakdown
    : (Number(rawAtt.attendanceDeductionDays) || 0);
  return {
    employee: {
      emp_no: record.emp_no || empObj?.emp_no || '',
      name: empObj?.employee_name || [empObj?.first_name, empObj?.last_name].filter(Boolean).join(' ') || 'N/A',
      designation: empObj?.designation_id?.name || empObj?.designation_id || '',
      department: empObj?.department_id?.name || empObj?.department_id || 'N/A',
      division: empObj?.division_id?.name || empObj?.division_id || 'N/A',
      location: empObj?.location || '',
      bank_account_no: empObj?.bank_account_no || '',
      bank_name: empObj?.bank_name || '',
      bank_place: empObj?.bank_place || '',
      ifsc_code: empObj?.ifsc_code || '',
      payment_mode: empObj?.salary_mode || '',
      date_of_joining: empObj?.doj || '',
      pf_number: empObj?.pf_number || '',
      esi_number: empObj?.esi_number || '',
      salaries:
        empObj?.salaries && typeof empObj.salaries === 'object' && !Array.isArray(empObj.salaries)
          ? { ...empObj.salaries }
          : {},
    },
    attendance: {
      ...rawAtt,
      attendanceDeductionDays,
    },
    attendanceDeductionDays,
    earnings: record.earnings && typeof record.earnings.toObject === 'function' ? record.earnings.toObject() : (record.earnings || {}),
    deductions: ded,
    loanAdvance: record.loanAdvance && typeof record.loanAdvance.toObject === 'function' ? record.loanAdvance.toObject() : (record.loanAdvance || {}),
    arrears: record.arrears && typeof record.arrears === 'object'
      ? (record.arrears.toObject ? record.arrears.toObject() : { ...record.arrears })
      : { arrearsAmount: Number(record.arrearsAmount) || 0, arrearsSettlements: record.arrearsSettlements || [] },
    manualDeductions: record.manualDeductions && typeof record.manualDeductions === 'object'
      ? (record.manualDeductions.toObject ? record.manualDeductions.toObject() : { ...record.manualDeductions })
      : { manualDeductionsAmount: Number(record.manualDeductionsAmount) || 0 },
    manualDeductionsAmount: Number(record.manualDeductionsAmount) || 0,
    arrearsAmount: Number(record.arrearsAmount) || 0,
    netSalary: Number(record.netSalary) || 0,
    roundOff: Number(record.roundOff) || 0,
  };
}

function secondSalaryRecordToPayslipShape(record) {
  const emp = record.employeeId || {};
  const toObj = (x) => (x && typeof x.toObject === 'function' ? x.toObject() : x);
  const empObj = toObj(emp);
  const divName = record.division_id?.name || empObj?.division_id?.name || empObj?.division_id || 'N/A';
  const rawAtt = record.attendance && typeof record.attendance.toObject === 'function' ? record.attendance.toObject() : (record.attendance || {});
  const ded = record.deductions && typeof record.deductions.toObject === 'function' ? record.deductions.toObject() : (record.deductions || {});
  const daysFromBreakdown = Number(ded?.attendanceDeductionBreakdown?.daysDeducted);
  const attendanceDeductionDays = Number.isFinite(daysFromBreakdown)
    ? daysFromBreakdown
    : (Number(rawAtt.attendanceDeductionDays) || 0);
  return {
    employee: {
      emp_no: record.emp_no || empObj?.emp_no || '',
      name: empObj?.employee_name || [empObj?.first_name, empObj?.last_name].filter(Boolean).join(' ') || 'N/A',
      designation: empObj?.designation_id?.name || empObj?.designation_id || '',
      department: empObj?.department_id?.name || empObj?.department_id || 'N/A',
      division: divName,
      location: empObj?.location || '',
      bank_account_no: empObj?.bank_account_no || '',
      bank_name: empObj?.bank_name || '',
      bank_place: empObj?.bank_place || '',
      ifsc_code: empObj?.ifsc_code || '',
      payment_mode: empObj?.salary_mode || '',
      date_of_joining: empObj?.doj || '',
      pf_number: empObj?.pf_number || '',
      esi_number: empObj?.esi_number || '',
      salaries:
        empObj?.salaries && typeof empObj.salaries === 'object' && !Array.isArray(empObj.salaries)
          ? { ...empObj.salaries }
          : {},
    },
    attendance: {
      ...rawAtt,
      attendanceDeductionDays,
    },
    attendanceDeductionDays,
    earnings: record.earnings && typeof record.earnings.toObject === 'function' ? record.earnings.toObject() : (record.earnings || {}),
    deductions: ded,
    loanAdvance: record.loanAdvance && typeof record.loanAdvance.toObject === 'function' ? record.loanAdvance.toObject() : (record.loanAdvance || {}),
    arrears: { arrearsAmount: Number(record.arrearsAmount) || 0, arrearsSettlements: [] },
    manualDeductions: { manualDeductionsAmount: 0 },
    manualDeductionsAmount: 0,
    arrearsAmount: Number(record.arrearsAmount) || 0,
    netSalary: Number(record.netSalary) || 0,
    roundOff: Number(record.roundOff) || 0,
  };
}

function emptyPayslipFromRegular(regPayslip) {
  return {
    employee: { ...(regPayslip.employee || {}) },
    attendance: {},
    earnings: {
      basicPay: 0,
      grossSalary: 0,
      totalAllowances: 0,
      allowances: [],
      otPay: 0,
      incentive: 0,
      perDayBasicPay: 0,
      earnedSalary: 0,
      payableAmount: 0,
    },
    deductions: {
      totalDeductions: 0,
      otherDeductions: [],
      statutoryDeductions: [],
      attendanceDeduction: 0,
      permissionDeduction: 0,
      leaveDeduction: 0,
    },
    loanAdvance: { totalEMI: 0, advanceDeduction: 0 },
    arrears: { arrearsAmount: 0 },
    manualDeductions: { manualDeductionsAmount: 0 },
    manualDeductionsAmount: 0,
    arrearsAmount: 0,
    netSalary: 0,
    roundOff: 0,
  };
}

function normalizeOutputColumns(rawColumns) {
  const raw = Array.isArray(rawColumns) ? rawColumns : [];
  return raw.map((c, i) => {
    const doc = c && typeof c.toObject === 'function' ? c.toObject() : (c && typeof c === 'object' ? { ...c } : {});
    return {
      header: doc.header != null && String(doc.header).trim() ? String(doc.header).trim() : `Column ${i}`,
      source: doc.source === 'formula' ? 'formula' : 'field',
      field: doc.field != null ? String(doc.field) : '',
      formula: doc.formula != null ? String(doc.formula) : '',
      order: typeof doc.order === 'number' ? doc.order : i,
    };
  });
}

function collectBreakdownSetsFromPayslips(payslips) {
  const allAllowanceNames = new Set();
  const allDeductionNames = new Set();
  const allStatutoryCodes = new Set();
  payslips.forEach((p) => {
    if (!p) return;
    (p.earnings?.allowances || []).forEach((a) => { if (a && a.name) allAllowanceNames.add(a.name); });
    (p.deductions?.otherDeductions || []).forEach((d) => { if (d && d.name) allDeductionNames.add(d.name); });
    (p.deductions?.statutoryDeductions || []).forEach((s) => {
      if (s && (s.code || s.name)) allStatutoryCodes.add(String(s.code || s.name).trim());
    });
  });
  return { allAllowanceNames, allDeductionNames, allStatutoryCodes };
}

function buildOutputColumnRows(payslipsReg, payslipsSecOrNull, outputColumnsNormalized) {
  const paired = payslipsReg.map((p, i) => [p, payslipsSecOrNull[i] || null]);
  const allPayslips = [];
  paired.forEach(([a, b]) => {
    allPayslips.push(a);
    if (b) allPayslips.push(b);
  });
  const { allAllowanceNames, allDeductionNames, allStatutoryCodes } = collectBreakdownSetsFromPayslips(allPayslips);
  const expandedColumns = outputColumnService.expandOutputColumnsWithBreakdown(
    outputColumnsNormalized,
    allAllowanceNames,
    allDeductionNames,
    allStatutoryCodes
  );
  const regularRows = payslipsReg.map((payslip, index) => {
    const rowData = outputColumnService.buildRowFromOutputColumns(payslip, expandedColumns, index + 1);
    return { 'S.No': index + 1, ...rowData };
  });
  const secondRows = payslipsReg.map((regSlip, index) => {
    const secSlip = payslipsSecOrNull[index] ? payslipsSecOrNull[index] : emptyPayslipFromRegular(regSlip);
    const rowData = outputColumnService.buildRowFromOutputColumns(secSlip, expandedColumns, index + 1);
    return { 'S.No': index + 1, ...rowData };
  });
  return { regularRows, secondRows, expandedColumns };
}

function resolveFixedAndMetricKeys(sampleRow) {
  const fixedKeys = DEFAULT_FIXED_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(sampleRow, k));
  const metricKeys = Object.keys(sampleRow).filter((k) => !fixedKeys.includes(k));
  return { fixedKeys, metricKeys };
}

function appendComparisonSheet(wb, regularRows, secondRows, netDiffResolver) {
  if (!regularRows.length) return;
  const { fixedKeys, metricKeys } = resolveFixedAndMetricKeys(regularRows[0]);
  const headerRow1 = [];
  const headerRow2 = [];
  const merges = [];
  let c = 0;
  for (const k of fixedKeys) {
    headerRow1.push(k);
    headerRow2.push('');
    merges.push({ s: { r: 0, c }, e: { r: 1, c } });
    c += 1;
  }
  for (const mk of metricKeys) {
    headerRow1.push(mk);
    headerRow1.push('');
    headerRow2.push('Regular');
    headerRow2.push('2nd salary');
    merges.push({ s: { r: 0, c }, e: { r: 0, c: c + 1 } });
    c += 2;
  }
  headerRow1.push('Δ Net (2nd − Regular)');
  headerRow2.push('');
  merges.push({ s: { r: 0, c }, e: { r: 1, c } });
  c += 1;

  const data = [headerRow1, headerRow2];
  for (let i = 0; i < regularRows.length; i++) {
    const reg = regularRows[i];
    const sec = secondRows[i] || {};
    const row = [];
    for (const k of fixedKeys) row.push(reg[k] ?? '');
    for (const mk of metricKeys) {
      row.push(reg[mk] ?? '');
      row.push(sec[mk] ?? '');
    }
    const diffFn = netDiffResolver || netDiffFromRowsDefault;
    row.push(diffFn(reg, sec, i));
    data.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!merges'] = merges;
  XLSX.utils.book_append_sheet(wb, ws, 'Comparison');
}

function writeBundleBuffer(regularRows, secondRows, netDiffResolver) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(regularRows), 'Regular');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(secondRows), '2nd salary');
  appendComparisonSheet(wb, regularRows, secondRows, netDiffResolver);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function netDiffFromRowsDefault(reg, sec) {
  const nReg = Number(reg['NET SALARY'] ?? reg['FINAL SALARY'] ?? 0);
  const nSec = Number(sec['NET SALARY'] ?? sec['FINAL SALARY'] ?? 0);
  return nSec - nReg;
}

/** PF / ESI / PT codes for paysheet column expansion when saved records have no statutory breakdown yet */
async function getStatutoryCodesForPaysheetExpansion() {
  try {
    const StatutoryDeductionConfig = require('../model/StatutoryDeductionConfig');
    const st = await StatutoryDeductionConfig.get();
    const codes = [];
    if (st?.pf?.enabled) codes.push('PF');
    if (st?.esi?.enabled) codes.push('ESI');
    if (st?.professionTax?.enabled) codes.push('PT');
    return codes.length ? codes : ['PF', 'ESI', 'PT'];
  } catch {
    return ['PF', 'ESI', 'PT'];
  }
}

/**
 * Second-salary paysheet / Excel rows aligned with Payroll Configuration outputColumns (same as regular paysheet).
 * @param {Object[]} records - SecondSalaryRecord lean docs with employeeId populated
 * @param {Object[]} outputColumnsNormalized - from normalizeOutputColumns(config.outputColumns)
 * @returns {{ headers: string[], rows: Record<string, unknown>[] }}
 */
function buildSecondSalaryPaysheetFromOutputColumns(records, outputColumnsNormalized, extraStatutoryCodes = []) {
  if (!Array.isArray(records) || records.length === 0 || !outputColumnsNormalized.length) {
    return { headers: [], rows: [] };
  }
  const payslips = records.map(secondSalaryRecordToPayslipShape);
  const { allAllowanceNames, allDeductionNames, allStatutoryCodes } = collectBreakdownSetsFromPayslips(payslips);
  const statutoryMerged = new Set(allStatutoryCodes || []);
  for (const c of extraStatutoryCodes || []) {
    const s = String(c || '').trim();
    if (s) statutoryMerged.add(s);
  }
  const expandedColumns = outputColumnService.expandOutputColumnsWithBreakdown(
    outputColumnsNormalized,
    allAllowanceNames,
    allDeductionNames,
    statutoryMerged
  );
  const rows = payslips.map((payslip, index) => {
    const rowData = outputColumnService.buildRowFromOutputColumns(payslip, expandedColumns, index + 1);
    return { 'S.No': index + 1, ...rowData };
  });
  const headers =
    rows.length > 0
      ? ['S.No', ...Object.keys(rows[0]).filter((k) => k !== 'S.No')]
      : ['S.No', ...expandedColumns.map((c) => c.header || 'Column')];
  return { headers, rows };
}

module.exports = {
  payrollRecordToPayslipShape,
  secondSalaryRecordToPayslipShape,
  emptyPayslipFromRegular,
  normalizeOutputColumns,
  buildOutputColumnRows,
  buildSecondSalaryPaysheetFromOutputColumns,
  getStatutoryCodesForPaysheetExpansion,
  writeBundleBuffer,
  netDiffFromRowsDefault,
};
