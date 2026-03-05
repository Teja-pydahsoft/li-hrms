const PayrollRecord = require('../model/PayrollRecord');
const PayrollTransaction = require('../model/PayrollTransaction');
const Employee = require('../../employees/model/Employee');
const User = require('../../users/model/User');
const Settings = require('../../settings/model/Settings');
const Loan = require('../../loans/model/Loan');
const payrollCalculationService = require('../services/payrollCalculationService');
const payrollCalculationFromOutputColumnsService = require('../services/payrollCalculationFromOutputColumnsService');
const XLSX = require('xlsx');
const PayRegisterSummary = require('../../pay-register/model/PayRegisterSummary');
const MonthlyAttendanceSummary = require('../../attendance/model/MonthlyAttendanceSummary');
const PayrollConfiguration = require('../model/PayrollConfiguration');
const outputColumnService = require('../services/outputColumnService');
const ArrearsPayrollIntegrationService = require('../../arrears/services/arrearsPayrollIntegrationService');
const DeductionPayrollIntegrationService = require('../../manual-deductions/services/deductionPayrollIntegrationService');
/**
 * Payroll Controller
 * Handles payroll calculation, retrieval, and processing
 */

/**
 * @desc    Calculate payroll for an employee
 * @route   POST /api/payroll/calculate
 * @access  Private (Super Admin, Sub Admin, HR)
 */
// Shared payslip assembler (used by calculate & getPayslip)
async function buildPayslipData(employeeId, month) {
  const payrollRecord = await PayrollRecord.findOne({
    employeeId,
    month,
  }).populate({
    path: 'employeeId',
    select:
      'employee_name emp_no department_id division_id designation_id gross_salary location bank_account_no bank_name salary_mode doj pf_number esi_number',
    populate: [
      { path: 'department_id', select: 'name' },
      { path: 'division_id', select: 'name' },
      { path: 'designation_id', select: 'name' },
    ],
  });

  if (!payrollRecord) {
    throw new Error('Payslip not found. Please calculate payroll first.');
  }

  // Try pay register summary for rich totals; fallback to attendance summary
  const payRegisterSummary = await PayRegisterSummary.findOne({ employeeId, month });
  const attendanceSummary = await MonthlyAttendanceSummary.findOne({ employeeId, month });

  // Extract employee data with properly populated references
  const employee = payrollRecord.employeeId;

  // Department name
  let departmentName = 'N/A';
  if (employee?.department_id) {
    if (typeof employee.department_id === 'object' && employee.department_id.name) {
      departmentName = employee.department_id.name;
    } else if (employee.department_id.toString) {
      const Department = require('../../departments/model/Department');
      const dept = await Department.findById(employee.department_id).select('name');
      if (dept) departmentName = dept.name;
    }
  }

  // Division name
  let divisionName = 'N/A';
  if (employee?.division_id) {
    if (typeof employee.division_id === 'object' && employee.division_id.name) {
      divisionName = employee.division_id.name;
    } else if (employee.division_id.toString) {
      const Division = require('../../departments/model/Division');
      const div = await Division.findById(employee.division_id).select('name');
      if (div) divisionName = div.name;
    }
  }

  // Designation name
  let designationName = 'N/A';
  if (employee?.designation_id) {
    if (typeof employee.designation_id === 'object' && employee.designation_id.name) {
      designationName = employee.designation_id.name;
    } else if (employee.designation_id.toString) {
      const Designation = require('../../departments/model/Designation');
      const desig = await Designation.findById(employee.designation_id).select('name');
      if (desig) designationName = desig.name;
    }
  }

  const perDay = payrollRecord.earnings.perDayBasicPay || 0;
  const payableShifts = payrollRecord.totalPayableShifts || 0;
  const presentDays =
    payRegisterSummary?.totals?.totalPresentDays ?? attendanceSummary?.totalPresentDays ?? null;
  const paidLeaveDays =
    payRegisterSummary?.totals?.totalPaidLeaveDays ??
    attendanceSummary?.paidLeaves ??
    attendanceSummary?.totalPaidLeaveDays ??
    null;
  const odDays =
    payRegisterSummary?.totals?.totalODDays ?? attendanceSummary?.totalODs ?? null;
  const otHours =
    payRegisterSummary?.totals?.totalOTHours ??
    attendanceSummary?.totalOTHours ??
    payrollRecord.earnings.otHours ??
    0;
  const monthDays = payrollRecord.totalDaysInMonth;
  // Incentive = extra days only (payableShifts - present - paidLeave). Do NOT use (payableShifts - presentDays)
  // or paid leave days would be counted twice: once in paidLeaveSalary and again in incentive.
  // OD is already subsumed in presentDays in pay register, so we don't subtract it here.
  const incentiveDays =
    presentDays !== null && paidLeaveDays !== null
      ? Math.max(0, payableShifts - presentDays - (paidLeaveDays || 0))
      : (payrollRecord.attendance?.extraDays || 0);

  const earnedSalary =
    presentDays !== null ? perDay * presentDays : payrollRecord.earnings.payableAmount;
  const paidLeaveSalary = paidLeaveDays !== null ? perDay * paidLeaveDays : 0;
  // Present days already include OD days; do not add OD again (no separate odSalary in gross).
  const odSalary = 0;
  const incentive = incentiveDays !== null ? perDay * incentiveDays : payrollRecord.earnings.incentive;

  const totalAllowances = payrollRecord.earnings.totalAllowances || 0;
  const otPay = payrollRecord.earnings.otPay || 0;
  const grossSalary = earnedSalary + paidLeaveSalary + odSalary + incentive + otPay + totalAllowances;

  const payslip = {
    month: payrollRecord.monthName,
    monthNumber: payrollRecord.monthNumber,
    year: payrollRecord.year,
    employee: {
      emp_no: payrollRecord.emp_no,
      name: employee?.employee_name || 'N/A',
      department: departmentName,
      division: divisionName,
      designation: designationName,
      location: employee?.location || '',
      bank_account_no: employee?.bank_account_no || '',
      bank_name: employee?.bank_name || '',
      payment_mode: employee?.salary_mode || '',
      date_of_joining: employee?.doj || '',
      pf_number: employee?.pf_number || '',
      esi_number: employee?.esi_number || '',
    },
    attendance: {
      // Use new attendance breakdown if available, fallback to old fields
      totalDaysInMonth: payrollRecord.attendance?.totalDaysInMonth || monthDays,
      monthDays: payrollRecord.attendance?.totalDaysInMonth || monthDays,
      presentDays: payrollRecord.attendance?.presentDays || presentDays,
      paidLeaveDays: payrollRecord.attendance?.paidLeaveDays || paidLeaveDays,
      odDays: payrollRecord.attendance?.odDays || odDays,
      weeklyOffs: payrollRecord.attendance?.weeklyOffs || 0,
      holidays: payrollRecord.attendance?.holidays || 0,
      absentDays: payrollRecord.attendance?.absentDays || 0,
      payableShifts: payrollRecord.attendance?.payableShifts || payableShifts,
      extraDays: payrollRecord.attendance?.extraDays || 0,
      totalPaidDays: payrollRecord.attendance?.totalPaidDays || 0,
      // Late/attendance deducting days (days deducted due to late-in/early-out)
      attendanceDeductionDays: payrollRecord.deductions?.attendanceDeductionBreakdown?.daysDeducted ?? 0,
      // Final paid days = total paid days minus attendance deduction days
      finalPaidDays: Math.max(0, (payrollRecord.attendance?.totalPaidDays ?? payrollRecord.attendance?.paidDays ?? 0) - (payrollRecord.deductions?.attendanceDeductionBreakdown?.daysDeducted ?? 0)),
      otHours: payrollRecord.attendance?.otHours || otHours,
      otDays: payrollRecord.attendance?.otDays || 0,
      earnedSalary: payrollRecord.attendance?.earnedSalary || earnedSalary,
      lopDays: payRegisterSummary?.totals?.totalLopDays || 0,
      incentiveDays: incentiveDays, // Keep for backward compatibility
      workingDays: null, // Can be derived if needed
    },
    earnings: {
      basicPay: payrollRecord.earnings.basicPay,
      perDay,
      earnedSalary,
      paidLeaveSalary,
      odSalary,
      incentive,
      otPay,
      allowances: payrollRecord.earnings.allowances,
      totalAllowances,
      allowancesCumulative: payrollRecord.earnings.allowancesCumulative ?? totalAllowances,
      grossSalary,
    },
    deductions: {
      attendanceDeduction: payrollRecord.deductions.attendanceDeduction,
      attendanceDeductionBreakdown: payrollRecord.deductions.attendanceDeductionBreakdown || {},
      permissionDeduction: payrollRecord.deductions.permissionDeduction,
      leaveDeduction: payrollRecord.deductions.leaveDeduction,
      otherDeductions: payrollRecord.deductions.otherDeductions,
      totalOtherDeductions: payrollRecord.deductions.totalOtherDeductions,
      statutoryDeductions: payrollRecord.deductions.statutoryDeductions || [],
      totalStatutoryEmployee: payrollRecord.deductions.totalStatutoryEmployee,
      statutoryCumulative: payrollRecord.deductions.statutoryCumulative,
      deductionsCumulative: payrollRecord.deductions.deductionsCumulative ?? payrollRecord.deductions.totalDeductions,
      totalDeductions: payrollRecord.deductions.totalDeductions,
    },
    loanAdvance: {
      totalEMI: payrollRecord.loanAdvance.totalEMI,
      advanceDeduction: payrollRecord.loanAdvance.advanceDeduction,
    },
    arrears: {
      arrearsAmount: payrollRecord.arrearsAmount || 0,
      arrearsSettlements: payrollRecord.arrearsSettlements || [],
    },
    manualDeductions: {
      manualDeductionsAmount: payrollRecord.manualDeductionsAmount || 0,
      deductionSettlements: payrollRecord.deductionSettlements || [],
    },
    netSalary: payrollRecord.netSalary,
    totalPayableShifts: payrollRecord.totalPayableShifts,
    // Present days already include OD; do not add OD again in paid days.
    paidDays: payrollRecord.attendance?.paidDays || (presentDays + (payRegisterSummary?.totals?.totalWeeklyOffs || 0) + (payRegisterSummary?.totals?.totalHolidays || 0) + (paidLeaveDays || 0)),
    // Late/attendance deducting days (days deducted due to late-in/early-out rules)
    attendanceDeductionDays: (payrollRecord.deductions?.attendanceDeductionBreakdown?.daysDeducted ?? 0),
    // Final paid days = paid days minus attendance deduction days (clear picture for user)
    finalPaidDays: Math.max(0, (payrollRecord.attendance?.paidDays ?? (presentDays + (payRegisterSummary?.totals?.totalWeeklyOffs || 0) + (payRegisterSummary?.totals?.totalHolidays || 0) + (paidLeaveDays || 0))) - (payrollRecord.deductions?.attendanceDeductionBreakdown?.daysDeducted ?? 0)),
    roundOff: payrollRecord.roundOff || 0,
    status: payrollRecord.status,
  };

  return { payrollRecord, payslip };
}

/**
 * Build Excel row with normalized columns (all employees have same columns)
 * @param {Object} payslip - Payslip data
 * @param {Set} allAllowanceNames - All unique allowance names across all employees
 * @param {Set} allDeductionNames - All unique deduction names across all employees
 * @param {Number} serialNo - Serial number for S.No column
 */
function buildPayslipExcelRowsNormalized(payslip, allAllowanceNames, allDeductionNames, serialNo) {
  const row = {
    'S.No': serialNo,
    'Employee Code': payslip.employee.emp_no || '',
    'Name': payslip.employee.name || '',
    'Designation': payslip.employee.designation || '',
    'Department': payslip.employee.department || '',
    'Division': payslip.employee.division || '',
    'Date of Joining': payslip.employee.date_of_joining ? new Date(payslip.employee.date_of_joining).toLocaleDateString() : '',
    'Payment Mode': payslip.employee.payment_mode || '',
    'Bank Name': payslip.employee.bank_name || '',
    'Bank Account No': payslip.employee.bank_account_no || '',
    'BASIC': payslip.earnings.basicPay || 0,
  };

  // Create a map of employee's allowances for quick lookup
  const employeeAllowances = {};
  if (payslip.earnings && Array.isArray(payslip.earnings.allowances)) {
    payslip.earnings.allowances.forEach(allowance => {
      if (allowance && allowance.name) {
        employeeAllowances[allowance.name] = allowance.amount || 0;
      }
    });
  }

  // Add ALL allowance columns (with 0 if employee doesn't have it)
  allAllowanceNames.forEach(allowanceName => {
    row[allowanceName] = employeeAllowances[allowanceName] || 0;
  });

  row['TOTAL GROSS SALARY'] = payslip.earnings.grossSalary || 0;

  // Attendance
  row['Month Days'] = payslip.attendance?.monthDays || payslip.attendance?.totalDaysInMonth || 0;
  row['Present Days'] = payslip.attendance?.presentDays || 0;
  row['Week Offs'] = payslip.attendance?.weeklyOffs || 0;
  row['Paid Leaves'] = payslip.attendance?.paidLeaveDays || 0;
  row['OD Days'] = payslip.attendance?.odDays || 0;
  row['Absents'] = payslip.attendance?.absentDays || 0;
  row['LOP\'s'] = payslip.attendance?.lopDays || 0;
  row['Payable Shifts'] = payslip.attendance?.payableShifts || 0;
  row['Extra Days'] = payslip.attendance?.extraDays || 0;
  row['Total Paid Days'] = payslip.paidDays || 0;
  row['Attendance Deduction Days'] = payslip.attendanceDeductionDays ?? payslip.attendance?.attendanceDeductionDays ?? 0;
  row['Final Paid Days'] = Math.max((row['Total Paid Days'] - (row['Attendance Deduction Days'] || 0)), 0);

  // Net earnings
  row['Net Basic'] = payslip.attendance?.earnedSalary || payslip.earnings.earnedSalary || 0;

  // Add ALL net allowance columns (with 0 if employee doesn't have it)
  allAllowanceNames.forEach(allowanceName => {
    row[`Net ${allowanceName}`] = employeeAllowances[allowanceName] || 0;
  });

  row['Total Earnings'] = (payslip.attendance?.earnedSalary || 0) + (payslip.earnings.totalAllowances || 0);

  // Create a map of employee's deductions for quick lookup
  const employeeDeductions = {};
  if (payslip.deductions && Array.isArray(payslip.deductions.otherDeductions)) {
    payslip.deductions.otherDeductions.forEach(deduction => {
      if (deduction && deduction.name) {
        employeeDeductions[deduction.name] = deduction.amount || 0;
      }
    });
  }

  // Add ALL deduction columns (with 0 if employee doesn't have it)
  allDeductionNames.forEach(deductionName => {
    row[deductionName] = employeeDeductions[deductionName] || 0;
  });

  row['Fines'] = 0;
  row['Salary Advance'] = payslip.loanAdvance?.advanceDeduction || 0;
  row['Total Deductions'] = payslip.deductions?.totalDeductions || 0;

  // OT & Incentives
  row['OT Days'] = payslip.attendance?.otDays || 0;
  row['OT Hours'] = payslip.attendance?.otHours || 0;
  row['OT Amount'] = payslip.earnings?.otPay || 0;
  row['Incentives'] = (payslip.earnings?.incentive || 0) + (payslip.extraDaysPay || 0);
  row['Other Amount'] = 0;
  row['Total Other Earnings'] = (row['OT Amount']) + (row['Incentives']);

  // Arrears
  row['Arrears'] = payslip.arrears?.arrearsAmount || 0;

  // Final
  row['NET SALARY'] = payslip.netSalary || 0;
  row['Round Off'] = payslip.roundOff || 0;
  row['FINAL SALARY'] = payslip.netSalary || 0;

  return row;
}

/**
 * Build Excel row for single payslip (backward compatibility)
 */
function buildPayslipExcelRows(payslip) {
  // For single payslip export, collect allowances/deductions from that payslip only
  const allAllowanceNames = new Set();
  const allDeductionNames = new Set();

  if (Array.isArray(payslip.earnings?.allowances)) {
    payslip.earnings.allowances.forEach(a => allAllowanceNames.add(a.name));
  }
  if (Array.isArray(payslip.deductions?.otherDeductions)) {
    payslip.deductions.otherDeductions.forEach(d => allDeductionNames.add(d.name));
  }

  return [buildPayslipExcelRowsNormalized(payslip, allAllowanceNames, allDeductionNames, 1)];
}

// OLD FUNCTION (kept for reference, not used)
function buildPayslipExcelRowsOld(payslip) {
  // Build row with dynamic allowances and deductions
  const row = {
    // Employee Information
    'S.No': '', // Will be added during loop
    'Employee Code': payslip.employee.emp_no || '',
    'Name': payslip.employee.name || '',
    'Designation': payslip.employee.designation || '',
    'Department': payslip.employee.department || '',
    'Division': '', // Add if available in future

    // Basic Salary
    'BASIC': payslip.earnings.basicPay || 0,
  };

  // ===== DYNAMIC ALLOWANCES (Gross) =====
  // Add each allowance as a separate column (e.g., "DA", "HRA", "CONV", etc.)
  if (Array.isArray(payslip.earnings.allowances)) {
    payslip.earnings.allowances.forEach(allowance => {
      const columnName = allowance.name || 'Unknown Allowance';
      row[columnName] = allowance.amount || 0;
    });
  }

  // Total Gross Salary
  row['TOTAL GROSS SALARY'] = payslip.earnings.grossSalary || 0;

  // ===== ATTENDANCE BREAKDOWN =====
  row['Month Days'] = payslip.attendance?.monthDays || payslip.attendance?.totalDaysInMonth || 0;
  row['Present Days'] = payslip.attendance?.presentDays || 0;
  row['Week Offs'] = payslip.attendance?.weeklyOffs || 0;
  row['Paid Leaves'] = payslip.attendance?.paidLeaveDays || 0;
  row['OD Days'] = payslip.attendance?.odDays || 0;
  row['Absents'] = payslip.attendance?.absentDays || 0;
  row['LOP\'s'] = 0; // Loss of Pay - can be calculated if needed
  row['Payable Shifts'] = payslip.attendance?.payableShifts || 0;
  row['Extra Days'] = payslip.attendance?.extraDays || 0;
  row['Total Paid Days'] = payslip.attendance?.totalPaidDays || 0;
  row['Attendance Deduction Days'] = payslip.attendanceDeductionDays ?? payslip.attendance?.attendanceDeductionDays ?? 0;
  row['Final Paid Days'] = payslip.finalPaidDays ?? payslip.attendance?.finalPaidDays ?? Math.max(0, (payslip.attendance?.totalPaidDays || 0) - (row['Attendance Deduction Days'] || 0));

  // ===== NET EARNINGS (Based on Attendance) =====
  row['Net Basic'] = payslip.attendance?.earnedSalary || payslip.earnings.earnedSalary || 0;

  // Add Net Allowances (same as gross allowances in most cases, but can be prorated)
  if (Array.isArray(payslip.earnings.allowances)) {
    payslip.earnings.allowances.forEach(allowance => {
      const netColumnName = `Net ${allowance.name}`;
      row[netColumnName] = allowance.amount || 0;
    });
  }

  row['Total Earnings'] = (payslip.attendance?.earnedSalary || 0) + (payslip.earnings.totalAllowances || 0);

  // ===== DYNAMIC DEDUCTIONS =====
  // Add each deduction as a separate column (e.g., "PF", "ESI", "Prof.Tax", etc.)
  if (Array.isArray(payslip.deductions?.otherDeductions)) {
    payslip.deductions.otherDeductions.forEach(deduction => {
      const columnName = deduction.name || 'Unknown Deduction';
      row[columnName] = deduction.amount || 0;
    });
  }

  // Other standard deductions
  row['Fines'] = 0; // Add if available
  row['Salary Advance'] = payslip.loanAdvance?.advanceDeduction || 0;
  row['Total Deductions'] = payslip.deductions?.totalDeductions || 0;

  // ===== OT & INCENTIVES =====
  row['OT Days'] = payslip.attendance?.otDays || 0;
  row['OT Hours'] = payslip.attendance?.otHours || 0;
  row['OT Amount'] = payslip.earnings?.otPay || 0;
  row['Incentives'] = payslip.earnings?.incentive || 0;
  row['Other Amount'] = 0; // Add if available
  row['Total Other Earnings'] = (payslip.earnings?.otPay || 0) + (payslip.earnings?.incentive || 0);

  // ===== ARREARS =====
  row['Arrears'] = payslip.arrears?.arrearsAmount || 0;

  // ===== FINAL SALARY =====
  row['NET SALARY'] = payslip.netSalary || 0;
  row['Round Off'] = 0; // Add rounding logic if needed
  row['FINAL SALARY'] = Math.round(payslip.netSalary || 0);

  return [row];
}

exports.calculatePayroll = async (req, res) => {
  try {
    const { employeeId, month } = req.body;

    if (!employeeId || !month) {
      return res.status(400).json({
        success: false,
        message: 'Employee ID and month are required',
      });
    }

    // Validate month format
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        message: 'Month must be in YYYY-MM format',
      });
    }

    // Strategy: dynamic = outputColumns-driven; legacy = payregister+legacy; default = new (payregister).
    const strategy = req.query.strategy || 'new';
    const useDynamic = strategy === 'dynamic';
    const useLegacy = strategy === 'legacy';

    let result;
    if (useDynamic) {
      const config = await PayrollConfiguration.get();
      const outputColumns = Array.isArray(config?.outputColumns) ? config.outputColumns : [];
      if (outputColumns.length > 0) {
        result = await payrollCalculationFromOutputColumnsService.calculatePayrollFromOutputColumns(
          employeeId,
          month,
          req.user._id,
          { source: 'payregister', arrearsSettlements: req.body.arrears || [], deductionSettlements: req.body.deductions || [] }
        );
        result = { payrollRecord: result.payrollRecord, batchId: result.batchId, payslip: result.payslip };
      } else {
        const options = { source: 'payregister', arrearsSettlements: req.body.arrears || [], deductionSettlements: req.body.deductions || [] };
        result = await payrollCalculationService.calculatePayrollNew(employeeId, month, req.user._id, options);
      }
    } else {
      const options = {
        source: useLegacy ? 'all' : 'payregister',
        arrearsSettlements: req.body.arrears || [],
        deductionSettlements: req.body.deductions || [],
      };
      result = await payrollCalculationService.calculatePayrollNew(employeeId, month, req.user._id, options);
    }

    // If export is requested, return Excel immediately
    if (req.query.export === 'excel') {
      const { payslip } = await buildPayslipData(employeeId, month);
      const rows = buildPayslipExcelRows(payslip);
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'Payslip');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      const filename = `payslip_${payslip.employee.emp_no || employeeId}_${month}.xlsx`;
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(buf);
    }

    // Convert mongoose ref to object if needed to merge properties
    const responseData = result.payrollRecord.toObject ? result.payrollRecord.toObject() : result.payrollRecord;

    if (result.batchId) {
      responseData.batchId = result.batchId;
      responseData.payrollBatchId = result.batchId; // Also set standard field
    }

    res.status(200).json({
      success: true,
      message: 'Payroll calculated successfully',
      data: responseData,
    });
  } catch (error) {
    console.error('Error calculating payroll:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error calculating payroll',
      error: error.message,
      code: error.code,
      batchId: error.batchId
    });
  }
};

/**
 * @desc    Export payroll payslips to Excel for the selected employees/month
 * @route   GET /api/payroll/export
 * @access  Private (Super Admin, Sub Admin, HR)
 */
exports.exportPayrollExcel = async (req, res) => {
  try {
    const { month, departmentId, divisionId, status, search, employeeIds, strategy } = req.query;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        message: 'Month (YYYY-MM) is required',
      });
    }

    let targetEmployeeIds = [];
    if (employeeIds) {
      targetEmployeeIds = String(employeeIds)
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    } else {
      // Build Employee Query based on filters
      const employeeQuery = { ...req.scopeFilter };
      if (departmentId) employeeQuery.department_id = departmentId;
      if (divisionId) employeeQuery.division_id = divisionId;

      if (status === 'active') {
        employeeQuery.is_active = true;
      } else if (status === 'inactive') {
        employeeQuery.is_active = false;
      }

      if (search) {
        employeeQuery.$or = [
          { employee_name: { $regex: search, $options: 'i' } },
          { emp_no: { $regex: search, $options: 'i' } }
        ];
      }

      const emps = await Employee.find(employeeQuery).select('_id');
      targetEmployeeIds = emps.map((e) => e._id.toString());
    }

    const config = await PayrollConfiguration.get();
    const useDynamicExport = String(strategy || '').toLowerCase() === 'dynamic';
    const rawColumns = Array.isArray(config?.outputColumns) ? config.outputColumns : [];
    const hasOutputColumns = rawColumns.length > 0;

    // When strategy=dynamic and we have output columns, use the same data source as the paysheet:
    // compute payslips via the dynamic engine (no PayrollRecord required). Export will match display.
    if (useDynamicExport && hasOutputColumns) {
      if (targetEmployeeIds.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No employees in scope. Apply filters or select employees to export.',
        });
      }
      const userId = req.user?._id?.toString() || req.user?.id;
      const payslips = [];
      for (const empId of targetEmployeeIds) {
        try {
          // Fetch pending arrears and manual deductions so export reflects same values as pay register calculation
          let arrearsSettlements = [];
          let deductionSettlements = [];
          try {
            const pendingArrears = await ArrearsPayrollIntegrationService.getPendingArrearsForPayroll(empId);
            if (pendingArrears && pendingArrears.length > 0) {
              arrearsSettlements = pendingArrears.map((ar) => ({ arrearId: ar.id, amount: ar.remainingAmount || 0 }));
            }
            const pendingDeductions = await DeductionPayrollIntegrationService.getPendingDeductionsForPayroll(empId);
            if (pendingDeductions && pendingDeductions.length > 0) {
              deductionSettlements = pendingDeductions.map((d) => ({ deductionId: d.id, amount: d.remainingAmount || 0 }));
            }
          } catch (fetchErr) {
            console.error(`Error fetching arrears/deductions for export (employee ${empId}):`, fetchErr.message);
          }
          const result = await payrollCalculationFromOutputColumnsService.calculatePayrollFromOutputColumns(
            empId,
            month,
            userId,
            { source: 'payregister', arrearsSettlements, deductionSettlements }
          );
          if (result?.payslip) {
            const slip = result.payslip;
            payslips.push(slip && typeof slip.toObject === 'function' ? slip.toObject() : slip);
          }
        } catch (err) {
          console.error(`Error calculating payroll for export (employee ${empId}):`, err.message);
        }
      }
      if (payslips.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No payslip data available to export. Ensure pay register is filled and try again.',
        });
      }
      const allAllowanceNames = new Set();
      const allDeductionNames = new Set();
      const allStatutoryCodes = new Set();
      payslips.forEach((p) => {
        (p.earnings?.allowances || []).forEach((a) => { if (a && a.name) allAllowanceNames.add(a.name); });
        (p.deductions?.otherDeductions || []).forEach((d) => { if (d && d.name) allDeductionNames.add(d.name); });
        (p.deductions?.statutoryDeductions || []).forEach((s) => {
          if (s && (s.code || s.name)) allStatutoryCodes.add(String(s.code || s.name).trim());
        });
      });
      const outputColumns = rawColumns.map((c, i) => {
        const doc = c && typeof c.toObject === 'function' ? c.toObject() : (c && typeof c === 'object' ? { ...c } : {});
        return {
          header: doc.header != null && String(doc.header).trim() ? String(doc.header).trim() : `Column ${i}`,
          source: doc.source === 'formula' ? 'formula' : 'field',
          field: doc.field != null ? String(doc.field) : '',
          formula: doc.formula != null ? String(doc.formula) : '',
          order: typeof doc.order === 'number' ? doc.order : i,
        };
      });
      const expandedColumns = outputColumnService.expandOutputColumnsWithBreakdown(
        outputColumns,
        allAllowanceNames,
        allDeductionNames,
        allStatutoryCodes
      );
      const rows = payslips.map((payslip, index) => {
        const rowData = outputColumnService.buildRowFromOutputColumns(payslip, expandedColumns, index + 1);
        return { 'S.No': index + 1, ...rowData };
      });
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'Payslips');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const filename = `payslips_${month}${departmentId ? `_dept_${departmentId}` : ''}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(buf);
    }

    const query = { month };
    if (targetEmployeeIds.length > 0) {
      query.employeeId = { $in: targetEmployeeIds };
    }

    const payrollRecords = await PayrollRecord.find(query)
      .populate({
        path: 'employeeId',
        select:
          'employee_name emp_no department_id division_id designation_id gross_salary location bank_account_no bank_name salary_mode doj pf_number esi_number',
        populate: [
          { path: 'department_id', select: 'name' },
          { path: 'division_id', select: 'name' },
          { path: 'designation_id', select: 'name' },
        ],
      })
      .lean();

    if (!payrollRecords || payrollRecords.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No payroll records found for export. Please calculate payroll first.',
      });
    }

    // Bulk fetch summaries for performance
    const employeeIdList = payrollRecords.map(pr => pr.employeeId?._id || pr.employeeId);
    const [summaries, attendanceSummaries] = await Promise.all([
      PayRegisterSummary.find({ month, employeeId: { $in: employeeIdList } }).lean(),
      MonthlyAttendanceSummary.find({ month, employeeId: { $in: employeeIdList } }).lean()
    ]);

    // Create maps for quick lookup
    const summaryMap = new Map(summaries.map(s => [s.employeeId.toString(), s]));
    const attMap = new Map(attendanceSummaries.map(a => [a.employeeId.toString(), a]));

    // Step 1: Build all payslip data objects in-memory (no DB calls here)
    const payslips = payrollRecords.map((payrollRecord) => {
      try {
        const employee = payrollRecord.employeeId;
        const employeeIdStr = (employee?._id || employee)?.toString();
        if (!employeeIdStr) return null;

        const payRegisterSummary = summaryMap.get(employeeIdStr);
        const attendanceSummary = attMap.get(employeeIdStr);

        // Department/Division/Designation names
        const departmentName = employee?.department_id?.name || 'N/A';
        const divisionName = employee?.division_id?.name || 'N/A';
        const designationName = employee?.designation_id?.name || 'N/A';

        const perDay = payrollRecord.earnings?.perDayBasicPay || 0;
        const payableShifts = payrollRecord.totalPayableShifts || 0;
        const presentDays =
          payRegisterSummary?.totals?.totalPresentDays ?? attendanceSummary?.totalPresentDays ?? null;
        const paidLeaveDays =
          payRegisterSummary?.totals?.totalPaidLeaveDays ??
          attendanceSummary?.paidLeaves ??
          attendanceSummary?.totalPaidLeaveDays ??
          null;
        const odDays =
          payRegisterSummary?.totals?.totalODDays ?? attendanceSummary?.totalODs ?? null;
        const otHours =
          payRegisterSummary?.totals?.totalOTHours ??
          attendanceSummary?.totalOTHours ??
          payrollRecord.earnings?.otHours ??
          0;
        const monthDays = payrollRecord.totalDaysInMonth;

        const incentiveDays =
          presentDays !== null && paidLeaveDays !== null
            ? Math.max(0, payableShifts - presentDays - (paidLeaveDays || 0))
            : (payrollRecord.attendance?.extraDays || 0);

        const earnedSalary =
          presentDays !== null ? perDay * presentDays : (payrollRecord.earnings?.payableAmount || 0);
        const paidLeaveSalary = paidLeaveDays !== null ? perDay * paidLeaveDays : 0;
        // Present days already include OD; do not add OD again (no separate odSalary in gross).
        const odSalary = 0;
        const incentive = incentiveDays !== null ? perDay * incentiveDays : (payrollRecord.earnings?.incentive || 0);

        const totalAllowances = payrollRecord.earnings?.totalAllowances || 0;
        const otPay = payrollRecord.earnings?.otPay || 0;

        // Present days already include OD; do not add OD again in paid days.
        const paidDays = payrollRecord.attendance?.paidDays || (
          (presentDays || 0) +
          (payRegisterSummary?.totals?.totalWeeklyOffs || 0) +
          (payRegisterSummary?.totals?.totalHolidays || 0) +
          (paidLeaveDays || 0)
        );
        const attendanceDeductionDays = (payrollRecord.deductions?.attendanceDeductionBreakdown?.daysDeducted ?? 0);
        const finalPaidDays = Math.max(0, paidDays - attendanceDeductionDays);

        return {
          month: payrollRecord.monthName,
          monthNumber: payrollRecord.monthNumber,
          year: payrollRecord.year,
          employee: {
            emp_no: payrollRecord.emp_no,
            name: employee?.employee_name || 'N/A',
            department: departmentName,
            division: divisionName,
            designation: designationName,
            location: employee?.location || '',
            bank_account_no: employee?.bank_account_no || '',
            bank_name: employee?.bank_name || '',
            payment_mode: employee?.salary_mode || '',
            date_of_joining: employee?.doj || '',
            pf_number: employee?.pf_number || '',
            esi_number: employee?.esi_number || '',
          },
          attendance: {
            totalDaysInMonth: payrollRecord.attendance?.totalDaysInMonth || monthDays,
            presentDays: payrollRecord.attendance?.presentDays || presentDays,
            paidLeaveDays: payrollRecord.attendance?.paidLeaveDays || paidLeaveDays,
            odDays: payrollRecord.attendance?.odDays || odDays,
            weeklyOffs: payrollRecord.attendance?.weeklyOffs || 0,
            holidays: payrollRecord.attendance?.holidays || 0,
            absentDays: payrollRecord.attendance?.absentDays || 0,
            payableShifts: payrollRecord.attendance?.payableShifts || payableShifts,
            extraDays: payrollRecord.attendance?.extraDays || 0,
            totalPaidDays: payrollRecord.attendance?.totalPaidDays || 0,
            attendanceDeductionDays: attendanceDeductionDays,
            finalPaidDays: finalPaidDays,
            otHours: payrollRecord.attendance?.otHours || otHours,
            otDays: payrollRecord.attendance?.otDays || 0,
            earnedSalary: payrollRecord.attendance?.earnedSalary || earnedSalary,
            lopDays: payRegisterSummary?.totals?.totalLopDays || 0,
            elUsedInPayroll: payrollRecord.elUsedInPayroll ?? 0,
          },
          earnings: {
            ...payrollRecord.earnings,
            earnedSalary,
            paidLeaveSalary,
            odSalary,
            incentive,
            otPay,
            totalAllowances,
            grossSalary: (earnedSalary + paidLeaveSalary + odSalary + incentive + otPay + totalAllowances) // odSalary is 0 (present includes OD)
          },
          deductions: payrollRecord.deductions || {},
          loanAdvance: payrollRecord.loanAdvance || {},
          arrears: {
            arrearsAmount: payrollRecord.arrearsAmount || 0,
            arrearsSettlements: payrollRecord.arrearsSettlements || [],
          },
          netSalary: payrollRecord.netSalary,
          roundOff: payrollRecord.roundOff || 0,
          paidDays: paidDays,
          attendanceDeductionDays: attendanceDeductionDays,
          finalPaidDays: finalPaidDays,
          status: payrollRecord.status,
        };
      } catch (err) {
        console.error(`Error processing payslip for export (Emp: ${payrollRecord.emp_no}):`, err);
        return null;
      }
    }).filter(Boolean);

    if (payslips.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No payslip data available to export. (Internal generation failure)',
      });
    }

    // Step 2: Collect ALL unique allowances, deductions, and statutory codes across all employees
    const allAllowanceNames = new Set();
    const allDeductionNames = new Set();
    const allStatutoryCodes = new Set();

    payslips.forEach(payslip => {
      if (Array.isArray(payslip.earnings?.allowances)) {
        payslip.earnings.allowances.forEach(allowance => {
          if (allowance.name) allAllowanceNames.add(allowance.name);
        });
      }
      if (Array.isArray(payslip.deductions?.otherDeductions)) {
        payslip.deductions.otherDeductions.forEach(deduction => {
          if (deduction.name) allDeductionNames.add(deduction.name);
        });
      }
      if (Array.isArray(payslip.deductions?.statutoryDeductions)) {
        payslip.deductions.statutoryDeductions.forEach(s => {
          if (s && (s.code || s.name)) allStatutoryCodes.add(String(s.code || s.name).trim());
        });
      }
    });

    console.log(`\n📊 Excel Export: Found ${allAllowanceNames.size} unique allowances, ${allDeductionNames.size} deductions, ${allStatutoryCodes.size} statutory for ${payslips.length} employees`);
    console.log(`Allowances: ${Array.from(allAllowanceNames).join(', ')}`);
    console.log(`Deductions: ${Array.from(allDeductionNames).join(', ')}`);
    console.log(`Statutory: ${Array.from(allStatutoryCodes).join(', ')}\n`);

    // Step 3: Build rows – when caller sends strategy=dynamic, export using dynamic output columns
    //         (from PayrollConfiguration.outputColumns) with breakdown columns before each cumulative.
    // config, useDynamicExport, hasOutputColumns already declared above (dynamic path returns early).
    let rows;
    if (useDynamicExport && hasOutputColumns) {
      const expandedColumns = outputColumnService.expandOutputColumnsWithBreakdown(
        config.outputColumns,
        allAllowanceNames,
        allDeductionNames,
        allStatutoryCodes
      );
      rows = payslips.map((payslip, index) =>
        outputColumnService.buildRowFromOutputColumns(payslip, expandedColumns, index + 1)
      );
    } else {
      rows = payslips.map((payslip, index) =>
        buildPayslipExcelRowsNormalized(payslip, allAllowanceNames, allDeductionNames, index + 1)
      );
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Payslips');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const filename = `payslips_${month}${departmentId ? `_dept_${departmentId}` : ''}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buf);
  } catch (error) {
    console.error('Error exporting payroll:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error exporting payroll',
      error: error.message,
    });
  }
};

/**
 * Build payslip-shaped object from a PayrollRecord (with populated employeeId) for outputColumnService.
 */
function recordToPayslip(record) {
  const emp = record.employeeId || {};
  const toObj = (x) => (x && typeof x.toObject === 'function' ? x.toObject() : x);
  const empObj = toObj(emp);
  return {
    employee: {
      emp_no: record.emp_no || empObj?.emp_no || '',
      name: empObj?.employee_name || [empObj?.first_name, empObj?.last_name].filter(Boolean).join(' ') || 'N/A',
      designation: empObj?.designation_id?.name || empObj?.designation_id || '',
      department: empObj?.department_id?.name || empObj?.department_id || 'N/A',
      division: empObj?.division_id?.name || empObj?.division_id || 'N/A',
    },
    attendance: record.attendance && typeof record.attendance.toObject === 'function' ? record.attendance.toObject() : (record.attendance || {}),
    earnings: record.earnings && typeof record.earnings.toObject === 'function' ? record.earnings.toObject() : (record.earnings || {}),
    deductions: record.deductions && typeof record.deductions.toObject === 'function' ? record.deductions.toObject() : (record.deductions || {}),
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

/**
 * @desc    Get paysheet data (headers + rows) for table display – uses same output columns as Excel export.
 *          source=existing: return existing PayrollRecords for the month (no calculation). Filters applied on data.
 *          No source or source=calculate: run dynamic/legacy calculation for scope and return fresh data.
 * @route   GET /api/payroll/paysheet
 * @query   month (YYYY-MM), departmentId?, divisionId?, status?, search?, employeeIds?, source? (existing | calculate)
 * @access  Private
 */
exports.getPaysheetData = async (req, res) => {
  try {
    const { month, departmentId, divisionId, status, search, employeeIds, source } = req.query;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        message: 'Month (YYYY-MM) is required',
      });
    }

    const config = await PayrollConfiguration.get();
    const rawColumns = Array.isArray(config?.outputColumns) ? config.outputColumns : [];
    const outputColumns = rawColumns.map((c, i) => {
      const doc = c && typeof c.toObject === 'function' ? c.toObject() : (c && typeof c === 'object' ? { ...c } : {});
      return {
        header: doc.header != null && String(doc.header).trim() ? String(doc.header).trim() : `Column ${i}`,
        source: doc.source === 'formula' ? 'formula' : 'field',
        field: doc.field != null ? String(doc.field) : '',
        formula: doc.formula != null ? String(doc.formula) : '',
        order: typeof doc.order === 'number' ? doc.order : i,
      };
    });

    const useExisting = String(source || '').toLowerCase() === 'existing';

    if (useExisting && outputColumns.length > 0) {
      // Return existing PayrollRecords only – no calculation. Filters applied on records.
      // Respect resignation: same as pay register – include only active employees or those who left in this payroll month.
      const { getPayrollDateRange } = require('../../shared/utils/dateUtils');
      const [yearNum, monthNum] = month.split('-').map(Number);
      const { startDate: rangeStartStr, endDate: rangeEndStr } = await getPayrollDateRange(yearNum, monthNum);
      const payrollRangeStart = new Date(rangeStartStr + 'T00:00:00.000Z');
      const payrollRangeEnd = new Date(rangeEndStr + 'T23:59:59.999Z');

      const records = await PayrollRecord.find({ month })
        .populate({
          path: 'employeeId',
          select: 'employee_name emp_no first_name last_name department_id division_id designation_id leftDate',
          populate: [
            { path: 'department_id', select: 'name' },
            { path: 'division_id', select: 'name' },
            { path: 'designation_id', select: 'name' },
          ],
        })
        .sort({ emp_no: 1 })
        .lean();

      let filtered = records;
      // Filter by department, division, search
      if (departmentId || divisionId || search) {
        filtered = filtered.filter((r) => {
          const emp = r.employeeId;
          if (!emp) return false;
          if (departmentId && (emp.department_id?._id?.toString() || emp.department_id?.toString()) !== departmentId) return false;
          if (divisionId && (emp.division_id?._id?.toString() || emp.division_id?.toString()) !== divisionId) return false;
          if (search) {
            const term = String(search).toLowerCase();
            const name = (emp.employee_name || [emp.first_name, emp.last_name].filter(Boolean).join(' ') || '').toLowerCase();
            const no = (emp.emp_no || r.emp_no || '').toLowerCase();
            if (!name.includes(term) && !no.includes(term)) return false;
          }
          return true;
        });
      }
      // Respect resignation: exclude employees who left before this payroll month
      filtered = filtered.filter((r) => {
        const emp = r.employeeId;
        if (!emp) return false;
        const left = emp.leftDate;
        if (!left) return true;
        const leftDate = left instanceof Date ? left : new Date(left);
        return leftDate >= payrollRangeStart && leftDate <= payrollRangeEnd;
      });

      const payslips = filtered.map((r) => recordToPayslip(r));
      if (payslips.length === 0) {
        return res.status(200).json({
          success: true,
          data: { headers: ['S.No', ...outputColumns.map((c) => c.header || 'Column')], rows: [] },
          message: 'No existing payroll records for this month. Use "Load paysheet" to calculate.',
        });
      }

      const allAllowanceNames = new Set();
      const allDeductionNames = new Set();
      const allStatutoryCodes = new Set();
      payslips.forEach((p) => {
        (p.earnings?.allowances || []).forEach((a) => { if (a && a.name) allAllowanceNames.add(a.name); });
        (p.deductions?.otherDeductions || []).forEach((d) => { if (d && d.name) allDeductionNames.add(d.name); });
        (p.deductions?.statutoryDeductions || []).forEach((s) => {
          if (s && (s.code || s.name)) allStatutoryCodes.add(String(s.code || s.name).trim());
        });
      });
      const expandedColumns = outputColumnService.expandOutputColumnsWithBreakdown(
        outputColumns,
        allAllowanceNames,
        allDeductionNames,
        allStatutoryCodes
      );
      const rows = payslips.map((payslip, index) => {
        const rowData = outputColumnService.buildRowFromOutputColumns(payslip, expandedColumns, index + 1);
        return { 'S.No': index + 1, ...rowData };
      });
      const headers = rows.length > 0
        ? ['S.No', ...Object.keys(rows[0]).filter((k) => k !== 'S.No')]
        : ['S.No', ...expandedColumns.map((c) => c.header || 'Column')];

      return res.status(200).json({
        success: true,
        data: { headers, rows },
        source: 'existing',
      });
    }

    // Calculate path: resolve employee list and run calculation
    let targetEmployeeIds = [];
    if (employeeIds) {
      targetEmployeeIds = String(employeeIds)
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    } else {
      const employeeQuery = { ...req.scopeFilter };
      if (departmentId) employeeQuery.department_id = departmentId;
      if (divisionId) employeeQuery.division_id = divisionId;
      if (status === 'active') employeeQuery.is_active = true;
      else if (status === 'inactive') employeeQuery.is_active = false;
      // Respect resignation (same as pay register): only active or left in this payroll month; skip when status=inactive
      if (status !== 'inactive') {
        const { getPayrollDateRange } = require('../../shared/utils/dateUtils');
        const [y, m] = month.split('-').map(Number);
        const { startDate: startStr, endDate: endStr } = await getPayrollDateRange(y, m);
        const rangeStart = new Date(startStr + 'T00:00:00.000Z');
        const rangeEnd = new Date(endStr + 'T23:59:59.999Z');
        const resignationOr = { $or: [ { is_active: true, leftDate: null }, { leftDate: { $gte: rangeStart, $lte: rangeEnd } } ] };
        if (search) {
          employeeQuery.$and = [
            { $or: [ { employee_name: { $regex: search, $options: 'i' } }, { emp_no: { $regex: search, $options: 'i' } } ] },
            resignationOr,
          ];
        } else {
          Object.assign(employeeQuery, resignationOr);
        }
      } else if (search) {
        employeeQuery.$or = [
          { employee_name: { $regex: search, $options: 'i' } },
          { emp_no: { $regex: search, $options: 'i' } },
        ];
      }
      const emps = await Employee.find(employeeQuery).select('_id');
      targetEmployeeIds = emps.map((e) => e._id.toString());
    }

    if (targetEmployeeIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: { headers: [], rows: [] },
        message: 'No employees in scope. Apply filters or select employees.',
      });
    }

    const userId = req.user?._id?.toString() || req.user?.id;
    let rows = [];
    let headers = [];

    if (outputColumns.length > 0) {
      const payslips = [];
      for (let index = 0; index < targetEmployeeIds.length; index++) {
        const empId = targetEmployeeIds[index];
        try {
          const result = await payrollCalculationFromOutputColumnsService.calculatePayrollFromOutputColumns(
            empId,
            month,
            userId,
            { source: 'payregister', arrearsSettlements: [] }
          );
          if (result?.payslip) {
            const slip = result.payslip;
            payslips.push(slip && typeof slip.toObject === 'function' ? slip.toObject() : slip);
          }
        } catch (err) {
          console.error(`Error calculating payroll for paysheet (employee ${empId}):`, err.message);
        }
      }
      if (payslips.length > 0) {
        const allAllowanceNames = new Set();
        const allDeductionNames = new Set();
        const allStatutoryCodes = new Set();
        payslips.forEach((p) => {
          (p.earnings?.allowances || []).forEach((a) => { if (a && a.name) allAllowanceNames.add(a.name); });
          (p.deductions?.otherDeductions || []).forEach((d) => { if (d && d.name) allDeductionNames.add(d.name); });
          (p.deductions?.statutoryDeductions || []).forEach((s) => {
            if (s && (s.code || s.name)) allStatutoryCodes.add(String(s.code || s.name).trim());
          });
        });
        const expandedColumns = outputColumnService.expandOutputColumnsWithBreakdown(
          outputColumns,
          allAllowanceNames,
          allDeductionNames,
          allStatutoryCodes
        );
        rows = payslips.map((payslip, index) => {
          const rowData = outputColumnService.buildRowFromOutputColumns(payslip, expandedColumns, index + 1);
          return { 'S.No': index + 1, ...rowData };
        });
        headers = rows.length > 0
          ? ['S.No', ...Object.keys(rows[0]).filter((k) => k !== 'S.No')]
          : ['S.No', ...expandedColumns.map((c) => c.header || 'Column')];
      }
    } else {
      const payslips = [];
      for (const empId of targetEmployeeIds) {
        try {
          const result = await payrollCalculationService.calculatePayrollNew(
            empId, month, userId, { source: 'payregister', arrearsSettlements: [] }
          );
          if (result?.payslip) payslips.push(result.payslip);
        } catch (err) {
          console.error(`Error calculating payroll for paysheet (employee ${empId}):`, err.message);
        }
      }
      if (payslips.length > 0) {
        const allAllowanceNames = new Set();
        const allDeductionNames = new Set();
        payslips.forEach((p) => {
          (p.earnings?.allowances || []).forEach((a) => { if (a.name) allAllowanceNames.add(a.name); });
          (p.deductions?.otherDeductions || []).forEach((d) => { if (d.name) allDeductionNames.add(d.name); });
        });
        rows = payslips.map((p, i) => buildPayslipExcelRowsNormalized(p, allAllowanceNames, allDeductionNames, i + 1));
        headers = rows.length > 0 ? Object.keys(rows[0]) : [];
      }
    }

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: { headers: [], rows: [] },
        message: 'No payslip data available after calculation.',
      });
    }

    return res.status(200).json({
      success: true,
      data: { headers, rows },
    });
  } catch (error) {
    console.error('Error getting paysheet data:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error loading paysheet',
      error: error.message,
    });
  }
};

/**
 * @desc    Get payroll record by ID
 * @route   GET /api/payroll/record/:id
 * @access  Private
 */
exports.getPayrollRecordById = async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`[GET /payroll/record/${id}] Fetching payroll record...`);

    const payrollRecord = await PayrollRecord.findById(id)
      .populate({
        path: 'employeeId',
        select: 'employee_name emp_no department_id designation_id location bank_account_no pf_number esi_number uan_number pan_number',
        populate: [
          { path: 'department_id', select: 'name' },
          { path: 'designation_id', select: 'name' }
        ]
      })
      .populate('attendanceSummaryId')
      .populate('calculationMetadata.calculatedBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('processedBy', 'name email');

    if (!payrollRecord) {
      console.warn(`[GET /payroll/record/${id}] Payroll record NOT FOUND in database`);
      return res.status(404).json({
        success: false,
        message: 'Payroll record not found',
      });
    }

    res.status(200).json({
      success: true,
      data: payrollRecord,
    });
  } catch (error) {
    console.error('Error fetching payroll record by ID:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching payroll record',
      error: error.message,
    });
  }
};

/**
 * @desc    Get payroll record for an employee
 * @route   GET /api/payroll/:employeeId/:month
 * @access  Private
 */
exports.getPayrollRecord = async (req, res) => {
  try {
    const { employeeId, month } = req.params;

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        message: 'Month must be in YYYY-MM format',
      });
    }

    const payrollRecord = await PayrollRecord.findOne({
      employeeId,
      month,
    })
      .populate({
        path: 'employeeId',
        select: 'employee_name emp_no department_id designation_id location bank_account_no pf_number esi_number',
        populate: [
          { path: 'department_id', select: 'name' },
          { path: 'designation_id', select: 'name' }
        ]
      })
      .populate('attendanceSummaryId')
      .populate('calculationMetadata.calculatedBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('processedBy', 'name email');

    if (!payrollRecord) {
      return res.status(404).json({
        success: false,
        message: 'Payroll record not found',
      });
    }

    res.status(200).json({
      success: true,
      data: payrollRecord,
    });
  } catch (error) {
    console.error('Error fetching payroll record:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payroll record',
      error: error.message,
    });
  }
};

/**
 * @desc    Get payroll records for multiple employees
 * @route   GET /api/payroll
 * @access  Private
 */
exports.getPayrollRecords = async (req, res) => {
  try {
    const { month, employeeId, departmentId, status } = req.query;

    const query = { ...req.scopeFilter };

    // Debugging Payslip Issue
    console.log('[getPayrollRecords] Params:', { month, employeeId, departmentId, status });
    console.log('[getPayrollRecords] User Role:', req.user.role);
    console.log('[getPayrollRecords] Scope:', JSON.stringify(req.scopeFilter));
    console.log('[getPayrollRecords] Initial Query:', JSON.stringify(query));

    // Role-based filtering
    const isAdmin = ['super_admin', 'sub_admin', 'hr'].includes(req.user.role);

    if (month) {
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({
          success: false,
          message: 'Month must be in YYYY-MM format',
        });
      }
      query.month = month;
    }

    if (employeeId) {
      query.employeeId = employeeId;
    } else if (!isAdmin) {
      // If not admin and no employeeId is provided, force employee filter to current user's employeeId
      if (!req.user.employee) {
        return res.status(403).json({ success: false, message: 'Access denied: No employee profile found' });
      }
      query.employeeId = req.user.employee;
    }

    // Secondary security check for non-admins
    if (!isAdmin && query.employeeId && query.employeeId.toString() !== req.user.employee?.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied: You can only view your own records' });
    }

    if (status) {
      query.status = status;
    }

    // Apply Payslip Settings for non-admins
    if (!isAdmin) {
      // 1. Check if release is required
      const releaseRequiredSetting = await Settings.findOne({ key: 'payslip_release_required' });
      if (releaseRequiredSetting && releaseRequiredSetting.value === true) {
        query.isReleased = true;
      }

      // 2. Filter by history window
      const historyMonthsSetting = await Settings.findOne({ key: 'payslip_history_months' });
      if (historyMonthsSetting && historyMonthsSetting.value > 0) {
        const monthsOffset = parseInt(historyMonthsSetting.value);
        const cutoffDate = new Date();
        cutoffDate.setMonth(cutoffDate.getMonth() - monthsOffset);

        const cutoffMonth = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}`;
        query.month = { ...query.month, $gte: cutoffMonth };
      }
    }

    // If departmentId or divisionId is provided, filter by employees in that scope
    let employeeIds = null;
    if (departmentId || (req.query.divisionId)) {
      const empQuery = { ...req.scopeFilter };
      if (departmentId) empQuery.department_id = departmentId;
      if (req.query.divisionId) empQuery.division_id = req.query.divisionId;

      const employees = await Employee.find(empQuery).select('_id');
      employeeIds = employees.map((emp) => emp._id);

      if (employeeIds.length === 0) {
        return res.status(200).json({
          success: true,
          count: 0,
          data: [],
        });
      }
      // If we already have a list of employeeIds (from specific employee filter), intersection is needed
      if (query.employeeId) {
        // query.employeeId might be a single ID or $in array. 
        // For simplicity, if both filters exist, we can just add $in with the intersection, 
        // but since query.employeeId usually comes from direct selection, it's safer to just let the $in overlap happen or 
        // simpler: if specific employee is selected, ignore list filter? No, user might select emp + div. 
        // Let's use $in intersection logic if needed, but Mongoose doesn't support implicit AND on same field easily in basic object.
        // Actually line 678 sets query.employeeId = employeeId. 
        // If employeeId is passed, we probably don't need to filter by div/dept for discovery, but for validation.
        // Let's assume if employeeId is passed, we check if they are in the list.
        const validIds = new Set(employeeIds.map(id => id.toString()));
        if (Array.isArray(query.employeeId.$in)) {
          query.employeeId.$in = query.employeeId.$in.filter(id => validIds.has(id.toString()));
        } else if (query.employeeId && !validIds.has(query.employeeId.toString())) {
          // Employee not in the selected division/dept
          return res.status(200).json({ success: true, count: 0, data: [] });
        }
      } else {
        query.employeeId = { $in: employeeIds };
      }
    }

    const payrollRecords = await PayrollRecord.find(query)
      .populate({
        path: 'employeeId',
        select: 'employee_name emp_no department_id designation_id location bank_account_no pf_number esi_number',
        populate: [
          { path: 'department_id', select: 'name' },
          { path: 'designation_id', select: 'name' }
        ]
      })
      .sort({ month: -1, emp_no: 1 })
      .limit(1000); // Limit to prevent large queries

    console.log(`[getPayrollRecords] Final Query executed:`, JSON.stringify(query));
    console.log(`[getPayrollRecords] Found ${payrollRecords.length} records.`);

    res.status(200).json({
      success: true,
      count: payrollRecords.length,
      data: payrollRecords,
    });
  } catch (error) {
    console.error('Error fetching payroll records:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payroll records',
      error: error.message,
    });
  }
};

/**
 * @desc    Get payroll transactions for a payroll record
 * @route   GET /api/payroll/:payrollRecordId/transactions
 * @access  Private
 */
exports.getPayrollTransactions = async (req, res) => {
  try {
    const { payrollRecordId } = req.params;

    const transactions = await PayrollTransaction.find({
      payrollRecordId,
    }).sort({ createdAt: 1 });

    res.status(200).json({
      success: true,
      count: transactions.length,
      data: transactions,
    });
  } catch (error) {
    console.error('Error fetching payroll transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payroll transactions',
      error: error.message,
    });
  }
};

/**
 * @desc    Approve payroll record
 * @route   PUT /api/payroll/:payrollRecordId/approve
 * @access  Private (Super Admin, Sub Admin, HR)
 */
exports.approvePayroll = async (req, res) => {
  try {
    const { payrollRecordId } = req.params;
    const { comments } = req.body;

    const payrollRecord = await PayrollRecord.findById(payrollRecordId);

    if (!payrollRecord) {
      return res.status(404).json({
        success: false,
        message: 'Payroll record not found',
      });
    }

    if (payrollRecord.status === 'processed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot approve already processed payroll',
      });
    }

    payrollRecord.status = 'approved';
    payrollRecord.approvedBy = req.user._id;
    payrollRecord.approvedAt = new Date();
    payrollRecord.approvedComments = comments || null;

    await payrollRecord.save();

    res.status(200).json({
      success: true,
      message: 'Payroll approved successfully',
      data: payrollRecord,
    });
  } catch (error) {
    console.error('Error approving payroll:', error);
    res.status(500).json({
      success: false,
      message: 'Error approving payroll',
      error: error.message,
    });
  }
};

/**
 * @desc    Process payroll (update loan/advance records)
 * @route   PUT /api/payroll/:payrollRecordId/process
 * @access  Private (Super Admin, Sub Admin, HR)
 */
exports.processPayroll = async (req, res) => {
  try {
    const { payrollRecordId } = req.params;

    const result = await payrollCalculationService.processPayroll(
      payrollRecordId,
      req.user._id
    );

    res.status(200).json({
      success: true,
      message: 'Payroll processed successfully',
      data: result.payrollRecord,
    });
  } catch (error) {
    console.error('Error processing payroll:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error processing payroll',
      error: error.message,
    });
  }
};

/**
 * @desc    Get payslip for an employee
 * @route   GET /api/payroll/payslip/:employeeId/:month
 * @access  Private
 */
exports.getPayslip = async (req, res) => {
  try {
    const { employeeId, month } = req.params;

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        message: 'Month must be in YYYY-MM format',
      });
    }

    // Check permissions
    const isAdmin = ['super_admin', 'sub_admin', 'hr'].includes(req.user.role);
    if (!isAdmin && employeeId.toString() !== req.user.employee?.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Verify settings for non-admins
    if (!isAdmin) {
      const payrollRecord = await PayrollRecord.findOne({ employeeId, month });
      if (!payrollRecord) {
        return res.status(404).json({ success: false, message: 'Payslip not found' });
      }

      // Check Release status
      const releaseRequiredSetting = await Settings.findOne({ key: 'payslip_release_required' });
      if (releaseRequiredSetting && releaseRequiredSetting.value === true && !payrollRecord.isReleased) {
        return res.status(403).json({ success: false, message: 'Payslip not yet released' });
      }

      // Check History months
      const historyMonthsSetting = await Settings.findOne({ key: 'payslip_history_months' });
      if (historyMonthsSetting && historyMonthsSetting.value > 0) {
        const monthsOffset = parseInt(historyMonthsSetting.value);
        const cutoffDate = new Date();
        cutoffDate.setMonth(cutoffDate.getMonth() - monthsOffset);
        const cutoffMonth = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}`;

        if (month < cutoffMonth) {
          return res.status(403).json({ success: false, message: 'Historical payslip access limit exceeded' });
        }
      }
    }

    const { payslip } = await buildPayslipData(employeeId, month);

    res.status(200).json({
      success: true,
      data: payslip,
    });
  } catch (error) {
    console.error('Error fetching payslip:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payslip',
      error: error.message,
    });
  }
};

/**
 * @desc    Get payslip data for download (tracks download count)
 * @route   GET /api/payroll/download/:employeeId/:month
 * @access  Private
 */
exports.downloadPayslip = async (req, res) => {
  try {
    const { employeeId, month } = req.params;

    // Permissions check
    const isAdmin = ['super_admin', 'sub_admin', 'hr'].includes(req.user.role);
    if (!isAdmin && employeeId.toString() !== req.user.employee?.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const payrollRecord = await PayrollRecord.findOne({ employeeId, month });
    if (!payrollRecord) {
      return res.status(404).json({ success: false, message: 'Payroll record not found' });
    }

    // Check download limits for non-admins
    if (!isAdmin) {
      const downloadLimitSetting = await Settings.findOne({ key: 'payslip_download_limit' });
      const limit = downloadLimitSetting ? parseInt(downloadLimitSetting.value) : 0;

      if (limit > 0 && (payrollRecord.downloadCount || 0) >= limit) {
        return res.status(403).json({
          success: false,
          message: `Download limit reached (${limit}). Please contact HR for assistance.`
        });
      }

      // Increment download count
      payrollRecord.downloadCount = (payrollRecord.downloadCount || 0) + 1;
      await payrollRecord.save();
    }

    const { payslip } = await buildPayslipData(employeeId, month);

    res.status(200).json({
      success: true,
      message: 'Download tracked successfully',
      data: payslip,
      downloadCount: payrollRecord.downloadCount,
    });
  } catch (error) {
    console.error('Error tracking payslip download:', error);
    res.status(500).json({
      success: false,
      message: 'Error tracking download',
      error: error.message,
    });
  }
};

/**
 * @desc    Release payslips for a specific month/department
 * @route   PUT /api/payroll/release
 * @access  Private (Super Admin, Sub Admin, HR)
 */
exports.releasePayslips = async (req, res) => {
  try {
    const { month, departmentId, employeeIds } = req.body;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        message: 'Month (YYYY-MM) is required',
      });
    }

    const query = { month, status: { $in: ['approved', 'processed'] } };

    if (employeeIds && Array.isArray(employeeIds) && employeeIds.length > 0) {
      query.employeeId = { $in: employeeIds };
    } else if (departmentId) {
      // Find employees in department
      const employees = await Employee.find({ department_id: departmentId }).select('_id');
      const deptEmpIds = employees.map(e => e._id);
      query.employeeId = { $in: deptEmpIds };
    }

    const updateResult = await PayrollRecord.updateMany(
      query,
      { $set: { isReleased: true } }
    );

    res.status(200).json({
      success: true,
      message: `Released ${updateResult.modifiedCount} payslips for ${month}`,
      modifiedCount: updateResult.modifiedCount,
    });
  } catch (error) {
    console.error('Error releasing payslips:', error);
    res.status(500).json({
      success: false,
      message: 'Error releasing payslips',
      error: error.message,
    });
  }
};

/**
 * @desc    Recalculate payroll for an employee
 * @route   POST /api/payroll/recalculate
 * @access  Private (Super Admin, Sub Admin, HR)
 */
exports.recalculatePayroll = async (req, res) => {
  try {
    const { employeeId, month } = req.body;

    if (!employeeId || !month) {
      return res.status(400).json({
        success: false,
        message: 'Employee ID and month are required',
      });
    }

    // Check if payroll record exists
    const existingRecord = await PayrollRecord.findOne({ employeeId, month });

    if (existingRecord && existingRecord.status === 'processed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot recalculate processed payroll',
      });
    }

    // Calculate payroll
    const result = await payrollCalculationService.calculatePayroll(
      employeeId,
      month,
      req.user._id
    );

    res.status(200).json({
      success: true,
      message: 'Payroll recalculated successfully',
      data: result.payrollRecord,
    });
  } catch (error) {
    console.error('Error recalculating payroll:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error recalculating payroll',
      error: error.message,
    });
  }
};

/**
 * @desc    Get payroll transactions with analytics for a month
 * @route   GET /api/payroll/transactions/analytics
 * @access  Private
 */
exports.getPayrollTransactionsWithAnalytics = async (req, res) => {
  try {
    const { month, employeeId, departmentId } = req.query;

    if (!month) {
      return res.status(400).json({
        success: false,
        message: 'Month is required (YYYY-MM format)',
      });
    }

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        message: 'Month must be in YYYY-MM format',
      });
    }

    // Build query for payroll records
    const payrollQuery = { month };
    if (employeeId) {
      payrollQuery.employeeId = employeeId;
    }
    if (departmentId) {
      const employees = await Employee.find({ department_id: departmentId }).select('_id');
      const employeeIds = employees.map((emp) => emp._id);
      if (employeeIds.length === 0) {
        return res.status(200).json({
          success: true,
          transactions: [],
          analytics: {
            totalEarnings: 0,
            totalDeductions: 0,
            totalNetSalary: 0,
            salaryAdvanceRecovered: 0,
            loanRecovered: 0,
            totalRemainingLoans: 0,
            totalRemainingSalaryAdvances: 0,
          },
        });
      }
      payrollQuery.employeeId = { $in: employeeIds };
    }

    // Get all payroll records for the month
    const payrollRecords = await PayrollRecord.find(payrollQuery)
      .populate({
        path: 'employeeId',
        select: 'employee_name emp_no department_id designation_id pf_number esi_number',
        populate: [
          { path: 'department_id', select: 'name' },
          { path: 'designation_id', select: 'name' }
        ]
      })
      .select('_id employeeId emp_no month');

    const payrollRecordIds = payrollRecords.map((record) => record._id);

    // Get all transactions for these payroll records
    const transactions = await PayrollTransaction.find({
      payrollRecordId: { $in: payrollRecordIds },
    })
      .populate('employeeId', 'employee_name emp_no')
      .populate('payrollRecordId', 'month')
      .sort({ createdAt: 1 });

    // Calculate analytics
    let totalEarnings = 0;
    let totalDeductions = 0;
    let totalNetSalary = 0;
    let salaryAdvanceRecovered = 0;
    let loanRecovered = 0;

    // Process transactions
    transactions.forEach((transaction) => {
      if (transaction.category === 'earning') {
        totalEarnings += Math.abs(transaction.amount);
      } else if (transaction.category === 'deduction') {
        totalDeductions += Math.abs(transaction.amount);
      }

      if (transaction.transactionType === 'salary_advance') {
        salaryAdvanceRecovered += Math.abs(transaction.amount);
      } else if (transaction.transactionType === 'loan_emi') {
        loanRecovered += Math.abs(transaction.amount);
      } else if (transaction.transactionType === 'net_salary') {
        totalNetSalary += Math.abs(transaction.amount);
      }
    });

    // Calculate total remaining loans and salary advances
    // Get all active loans and salary advances
    const activeLoans = await Loan.find({
      requestType: 'loan',
      status: { $in: ['active', 'disbursed'] },
      isActive: true,
    }).select('repayment.remainingBalance amount');

    const activeSalaryAdvances = await Loan.find({
      requestType: 'salary_advance',
      status: { $in: ['active', 'disbursed'] },
      isActive: true,
    }).select('repayment.remainingBalance amount');

    const totalRemainingLoans = activeLoans.reduce(
      (sum, loan) => sum + (loan.repayment?.remainingBalance || loan.amount || 0),
      0
    );

    const totalRemainingSalaryAdvances = activeSalaryAdvances.reduce(
      (sum, advance) => sum + (advance.repayment?.remainingBalance || advance.amount || 0),
      0
    );

    // Format transactions for response
    const formattedTransactions = transactions.map((transaction) => ({
      _id: transaction._id,
      employeeName: transaction.employeeId?.employee_name || 'N/A',
      emp_no: transaction.emp_no,
      transactionType: transaction.transactionType,
      category: transaction.category,
      description: transaction.description,
      amount: transaction.amount,
      month: transaction.month,
      createdAt: transaction.createdAt,
      details: transaction.details,
    }));

    res.status(200).json({
      success: true,
      month,
      transactions: formattedTransactions,
      analytics: {
        totalEarnings: Math.round(totalEarnings * 100) / 100,
        totalDeductions: Math.round(totalDeductions * 100) / 100,
        totalNetSalary: Math.round(totalNetSalary * 100) / 100,
        salaryAdvanceRecovered: Math.round(salaryAdvanceRecovered * 100) / 100,
        loanRecovered: Math.round(loanRecovered * 100) / 100,
        totalRemainingLoans: Math.round(totalRemainingLoans * 100) / 100,
        totalRemainingSalaryAdvances: Math.round(totalRemainingSalaryAdvances * 100) / 100,
        totalRecords: payrollRecords.length,
        totalTransactions: transactions.length,
      },
    });
  } catch (error) {
    console.error('Error fetching payroll transactions with analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payroll transactions with analytics',
      error: error.message,
    });
  }
};

/**
 * @desc    Bulk calculate payroll for employees matching filters
 * @route   POST /api/payroll/bulk-calculate
 * @access  Private (Super Admin, Sub Admin, HR)
 */
exports.calculatePayrollBulk = async (req, res) => {
  try {
    const { month, divisionId, departmentId, strategy } = req.body;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        message: 'Month (YYYY-MM) is required',
      });
    }

    // Include active employees + employees who left in this payroll month
    const { getPayrollDateRange } = require('../../shared/utils/dateUtils');
    const [year, monthNum] = month.split('-').map(Number);
    const { startDate, endDate } = await getPayrollDateRange(year, monthNum);
    // Use UTC boundaries so "26 Dec–25 Jan" excludes 25 Dec left (avoids TZ shifting 26 Dec 00:00 local into 25 Dec UTC).
    const leftStart = new Date(startDate + 'T00:00:00.000Z');
    const leftEnd = new Date(endDate + 'T23:59:59.999Z');

    console.log('[Bulk Payroll] Req.scopeFilter:', JSON.stringify(req.scopeFilter));

    const query = { ...req.scopeFilter };
    if (divisionId) query.division_id = divisionId;
    if (departmentId) query.department_id = departmentId;
    query.$or = [
      { is_active: true, leftDate: null },
      { leftDate: { $gte: leftStart, $lte: leftEnd } },
    ];

    console.log('[Bulk Payroll] Final Query (incl. left in month):', JSON.stringify(query));
    console.log('[Bulk Payroll] Filters - Division:', divisionId, 'Department:', departmentId, 'Month:', month);

    const employees = await Employee.find(query).select('_id');

    console.log('[Bulk Payroll] Found employees:', employees.length);

    if (!employees || employees.length === 0) {
      return res.status(200).json({
        success: false,
        message: 'No employees found matching the filters (active or left in this payroll month)',
      });
    }

    const employeeIds = employees.map((e) => e._id.toString());
    const { payrollQueue } = require('../../shared/jobs/queueManager');
    const job = await payrollQueue.add('payroll_bulk_calculate', {
      action: 'payroll_bulk_calculate',
      month,
      divisionId: divisionId === 'all' ? undefined : divisionId,
      departmentId: departmentId === 'all' ? undefined : departmentId,
      strategy,
      userId: req.user._id,
      employeeIds
    });

    res.status(202).json({
      success: true,
      status: 'queued',
      message: 'Bulk payroll calculation queued',
      jobId: job.id,
      data: {
        totalEmployees: employees.length
      }
    });

  } catch (error) {
    console.error('Error in bulk payroll calculation:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error during bulk calculation',
    });
  }
};

/**
 * @desc    Get attendance data for a range of months for an employee (for incremental arrears proration).
 * Uses Pay Register Summary (attendance source) first; falls back to PayrollRecord if no pay register for that month.
 * @route   GET /api/payroll/attendance-range
 * @access  Private
 */
function getMonthsInRange(startMonth, endMonth) {
  const [startYear, startM] = startMonth.split('-').map(Number);
  const [endYear, endM] = endMonth.split('-').map(Number);
  const months = [];
  let y = startYear;
  let m = startM;
  while (y < endYear || (y === endYear && m <= endM)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

exports.getAttendanceDataRange = async (req, res) => {
  try {
    const { employeeId, startMonth, endMonth } = req.query;

    if (!employeeId || !startMonth || !endMonth) {
      return res.status(400).json({
        success: false,
        message: 'Employee ID, start month, and end month are required'
      });
    }

    const months = getMonthsInRange(startMonth, endMonth);
    if (months.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    // Primary: Pay Register Summary (attendance / pay register – exists as soon as register is filled)
    const payRegisters = await PayRegisterSummary.find({
      employeeId,
      month: { $in: months }
    }).select('month totalDaysInMonth totals.totalPayableShifts totals.totalPresentDays totals.totalPaidLeaveDays totals.totalWeeklyOffs totals.totalHolidays').lean();

    // Fallback: PayrollRecord (only exists after payroll run for that month)
    const payrollRecords = await PayrollRecord.find({
      employeeId,
      month: { $in: months }
    }).select('month totalDaysInMonth attendance.totalPaidDays').lean();

    const byMonthPR = Object.fromEntries((payRegisters || []).map((r) => [r.month, r]));
    const byMonthPayroll = Object.fromEntries((payrollRecords || []).map((r) => [r.month, r]));

    const data = months.map((month) => {
      const pr = byMonthPR[month];
      const payroll = byMonthPayroll[month];
      let totalDaysInMonth = 0;
      let totalPaidDays = 0;

      if (pr) {
        totalDaysInMonth = Number(pr.totalDaysInMonth) || 0;
        const tot = pr.totals || {};
        const payable = tot.totalPayableShifts;
        totalPaidDays = Number.isFinite(payable) ? payable : (Number(tot.totalPresentDays) || 0) + (Number(tot.totalPaidLeaveDays) || 0) + (Number(tot.totalWeeklyOffs) || 0) + (Number(tot.totalHolidays) || 0);
      } else if (payroll) {
        totalDaysInMonth = Number(payroll.totalDaysInMonth) || 0;
        totalPaidDays = Number(payroll.attendance?.totalPaidDays) || 0;
      }
      if (totalDaysInMonth <= 0) {
        const [y, m] = month.split('-').map(Number);
        totalDaysInMonth = new Date(y, m, 0).getDate();
      }

      return {
        month,
        totalDaysInMonth: Number(totalDaysInMonth),
        attendance: { totalPaidDays: Number(totalPaidDays) }
      };
    });

    res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error fetching attendance data range:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching attendance data range',
      error: error.message
    });
  }
};
