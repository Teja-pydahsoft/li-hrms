const SecondSalaryService = require('../services/secondSalaryService');
const SecondSalaryBatch = require('../model/SecondSalaryBatch');
const SecondSalaryRecord = require('../model/SecondSalaryRecord');
const Employee = require('../../employees/model/Employee');
const PayrollConfiguration = require('../model/PayrollConfiguration');
const XLSX = require('xlsx');
const { buildSecondSalaryExcelRowsNormalized } = require('../utils/secondSalaryPaysheetRows');
const {
    normalizeOutputColumns,
    buildSecondSalaryPaysheetFromOutputColumns,
    getStatutoryCodesForPaysheetExpansion,
} = require('../utils/paysheetBundleExport');

/**
 * Build Excel row for Comparison (Regular vs Second Salary)
 */
function buildComparisonExcelRow(item, serialNo) {
    const { employee, attendance, regularRecord, secondSalaryRecord, difference } = item;

    const row = {
        'S.No': serialNo,
        'Employee Code': employee.emp_no || '',
        'Name': employee.name || '',
        'Designation': employee.designation || '',
        'Department': employee.department || '',
        'Division': employee.division || '',
        'Gender': employee.gender || '',
        'Date of Joining': employee.date_of_joining ? new Date(employee.date_of_joining).toLocaleDateString() : '',
        'Bank Name': employee.bank_name || '',
        'Bank Account No': employee.bank_account_no || '',

        // Attendance Summary
        '[ATTENDANCE] Month Days': attendance?.totalDaysInMonth || 0,
        '[ATTENDANCE] Present Days': attendance?.presentDays || 0,
        '[ATTENDANCE] Week Offs': attendance?.weeklyOffs || 0,
        '[ATTENDANCE] Holidays': attendance?.holidays || 0,
        '[ATTENDANCE] Paid Leaves': attendance?.paidLeaveDays || 0,
        '[ATTENDANCE] OD Days': attendance?.odDays || 0,
        '[ATTENDANCE] Absents': attendance?.absentDays || 0,
        '[ATTENDANCE] Payable Shifts': attendance?.payableShifts || 0,
        '[ATTENDANCE] Extra Days': attendance?.extraDays || 0,
        '[ATTENDANCE] Total Paid Days': attendance?.totalPaidDays || 0,

        // Regular Salary
        '[REGULAR] Basic': regularRecord?.earnings?.basicPay || 0,
        '[REGULAR] Earned Basic': regularRecord?.earnings?.payableAmount || 0,
        '[REGULAR] Allowances': regularRecord?.earnings?.totalAllowances || 0,
        '[REGULAR] OT Pay': regularRecord?.earnings?.otPay || 0,
        '[REGULAR] Incentive': regularRecord?.earnings?.incentive || 0,
        '[REGULAR] GROSS': regularRecord?.earnings?.grossSalary || 0,
        '[REGULAR] Deductions': regularRecord?.deductions?.totalDeductions || 0,
        '[REGULAR] EMI/Advance': (regularRecord?.loanAdvance?.totalEMI || 0) + (regularRecord?.loanAdvance?.advanceDeduction || 0),
        '[REGULAR] NET SALARY': regularRecord?.netSalary || 0,

        // Second Salary
        '[SECOND] Basic': secondSalaryRecord?.earnings?.basicPay || 0,
        '[SECOND] Earned Basic': secondSalaryRecord?.earnings?.payableAmount || 0,
        '[SECOND] Allowances': secondSalaryRecord?.earnings?.totalAllowances || 0,
        '[SECOND] OT Pay': secondSalaryRecord?.earnings?.otPay || 0,
        '[SECOND] Incentive': secondSalaryRecord?.earnings?.incentive || 0,
        '[SECOND] GROSS': secondSalaryRecord?.earnings?.grossSalary || 0,
        '[SECOND] Deductions': secondSalaryRecord?.deductions?.totalDeductions || 0,
        '[SECOND] EMI/Advance': (secondSalaryRecord?.loanAdvance?.totalEMI || 0) + (secondSalaryRecord?.loanAdvance?.advanceDeduction || 0),
        '[SECOND] NET SALARY': secondSalaryRecord?.netSalary || 0,

        // Comparison
        'RETURN AMOUNT': difference || 0
    };

    return row;
}

/**
 * @desc    Run 2nd salary payroll for a department
 * @route   POST /api/second-salary/calculate
 */
exports.calculateSecondSalary = async (req, res) => {
    try {
        const { departmentId, divisionId, month } = req.body;
        const userId = req.user._id || req.user.userId || req.user.id;

        if (!month) {
            return res.status(400).json({
                success: false,
                message: 'Month is required'
            });
        }

        const result = await SecondSalaryService.runSecondSalaryPayroll({
            departmentId,
            divisionId,
            month,
            userId,
            scopeFilter: req.scopeFilter || {}
        });

        if (result.queued) {
            return res.status(202).json({
                success: true,
                message: result.message,
                data: {
                    jobId: result.jobId,
                    totalEmployees: result.totalEmployees,
                    status: 'queued'
                }
            });
        }

        res.status(201).json({
            success: true,
            message: '2nd Salary payroll calculation completed',
            data: {
                ...result.batch?._doc,
                successCount: result.successCount,
                failCount: result.failCount
            },
            summary: result.results
        });
    } catch (error) {
        console.error('Error calculating 2nd salary:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error calculating 2nd salary'
        });
    }
};

/**
 * @desc    Get all 2nd salary batches
 * @route   GET /api/second-salary/batches
 */
exports.getSecondSalaryBatches = async (req, res) => {
    try {
        const { month, departmentId, divisionId, status } = req.query;
        const filters = {};
        if (month) filters.month = month;
        if (departmentId) filters.department = departmentId;
        if (divisionId) filters.division = divisionId;
        if (status) filters.status = status;

        const batches = await SecondSalaryService.getBatches(filters);

        res.status(200).json({
            success: true,
            count: batches.length,
            data: batches
        });
    } catch (error) {
        console.error('Error fetching 2nd salary batches:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error fetching 2nd salary batches'
        });
    }
};

/**
 * @desc    Get single 2nd salary batch details
 * @route   GET /api/second-salary/batches/:id
 */
exports.getSecondSalaryBatch = async (req, res) => {
    try {
        const batch = await SecondSalaryService.getBatchDetails(req.params.id);

        if (!batch) {
            return res.status(404).json({
                success: false,
                message: 'Batch not found'
            });
        }

        res.status(200).json({
            success: true,
            data: batch
        });
    } catch (error) {
        console.error('Error fetching 2nd salary batch:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error fetching batch details'
        });
    }
};

/**
 * @desc    Update batch status (approve, freeze, complete)
 * @route   PUT /api/second-salary/batches/:id/status
 */
exports.updateBatchStatus = async (req, res) => {
    try {
        const { status, reason } = req.body;
        const userId = req.user._id || req.user.userId || req.user.id;

        if (!status) {
            return res.status(400).json({
                success: false,
                message: 'Status is required'
            });
        }

        const batch = await SecondSalaryService.updateBatchStatus(
            req.params.id,
            status,
            userId,
            reason
        );

        res.status(200).json({
            success: true,
            message: `Batch status updated to ${status}`,
            data: batch
        });
    } catch (error) {
        console.error('Error updating batch status:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Error updating status'
        });
    }
};

/**
 * @desc    Get 2nd salary records (Payslips)
 * @route   GET /api/second-salary/records
 */
exports.getSecondSalaryRecords = async (req, res) => {
    try {
        const { month, departmentId, divisionId } = req.query;
        const filters = {};
        if (month) filters.month = month;
        if (departmentId) filters.departmentId = departmentId;
        if (divisionId) filters.divisionId = divisionId;

        const records = await SecondSalaryService.getRecords(filters);

        res.status(200).json({
            success: true,
            count: records.length,
            data: records
        });
    } catch (error) {
        console.error('Error fetching 2nd salary records:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error fetching records'
        });
    }
};

/**
 * @desc    Get single 2nd salary record by ID
 * @route   GET /api/second-salary/records/:id
 */
exports.getSecondSalaryRecordById = async (req, res) => {
    try {
        const record = await SecondSalaryService.getRecordById(req.params.id);

        if (!record) {
            return res.status(404).json({
                success: false,
                message: 'Payslip record not found'
            });
        }

        res.status(200).json({
            success: true,
            data: record
        });
    } catch (error) {
        console.error('Error fetching 2nd salary record:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error fetching record'
        });
    }
};
/**
 * @desc    Get salary comparison (Regular vs 2nd Salary)
 * @route   GET /api/second-salary/comparison
 */
exports.getSalaryComparison = async (req, res) => {
    try {
        const { month, departmentId, divisionId, designationId, search } = req.query;
        const secondSalaryComparisonService = require('../services/secondSalaryComparisonService');

        if (!month) {
            return res.status(400).json({
                success: false,
                message: 'Month is required'
            });
        }

        const comparisonData = await secondSalaryComparisonService.getComparison(month, {
            departmentId,
            divisionId,
            designationId,
            search
        });

        res.status(200).json({
            success: true,
            count: comparisonData.length,
            data: comparisonData
        });
    } catch (error) {
        console.error('Error fetching salary comparison:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error fetching comparison data'
        });
    }
};
/**
 * @desc    Export 2nd salary records to Excel
 * @route   GET /api/second-salary/export
 */
exports.exportSecondSalaryExcel = async (req, res) => {
    try {
        const { month, departmentId, divisionId, employeeIds, search } = req.query;

        if (!month) {
            return res.status(400).json({
                success: false,
                message: 'Month is required'
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
            const employeeQuery = {};
            if (departmentId && departmentId !== 'all') employeeQuery.department_id = departmentId;
            if (divisionId && divisionId !== 'all') employeeQuery.division_id = divisionId;

            if (search) {
                employeeQuery.$or = [
                    { employee_name: { $regex: search, $options: 'i' } },
                    { emp_no: { $regex: search, $options: 'i' } }
                ];
            }

            const emps = await Employee.find(employeeQuery).select('_id');
            targetEmployeeIds = emps.map((e) => e._id.toString());
        }

        const query = { month };
        if (targetEmployeeIds.length > 0) {
            query.employeeId = { $in: targetEmployeeIds };
        }

        const records = await SecondSalaryRecord.find(query)
            .populate({
                path: 'employeeId',
                select:
                    'employee_name first_name last_name emp_no department_id division_id designation_id gross_salary second_salary salaries location bank_account_no bank_name bank_place ifsc_code salary_mode doj pf_number esi_number applyPF applyESI applyProfessionTax',
                populate: [
                    { path: 'department_id', select: 'name' },
                    { path: 'division_id', select: 'name' },
                    { path: 'designation_id', select: 'name' },
                ],
            })
            .populate('division_id', 'name')
            .lean();

        if (!records || records.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No 2nd salary records found for export. Please calculate first.'
            });
        }

        const config = await PayrollConfiguration.get();
        const outputColumnsNormalized = normalizeOutputColumns(config?.outputColumns);

        let rows;
        if (outputColumnsNormalized.length > 0) {
            const statutoryCodes = await getStatutoryCodesForPaysheetExpansion();
            const built = buildSecondSalaryPaysheetFromOutputColumns(records, outputColumnsNormalized, statutoryCodes);
            if (built.rows.length > 0) {
                rows = built.rows;
            }
        }
        if (!rows) {
            const allAllowanceNames = new Set();
            const allDeductionNames = new Set();
            records.forEach((record) => {
                if (Array.isArray(record.earnings?.allowances)) {
                    record.earnings.allowances.forEach((allowance) => {
                        if (allowance.name) allAllowanceNames.add(allowance.name);
                    });
                }
                if (Array.isArray(record.deductions?.otherDeductions)) {
                    record.deductions.otherDeductions.forEach((deduction) => {
                        if (deduction.name) allDeductionNames.add(deduction.name);
                    });
                }
            });
            rows = records.map((record, index) =>
                buildSecondSalaryExcelRowsNormalized(record, allAllowanceNames, allDeductionNames, index + 1)
            );
        }

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, 'Second Salary Payslips');
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const filename = `second_salary_payslips_${month}.xlsx`;
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buf);
    } catch (error) {
        console.error('Error exporting second salary:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error exporting second salary'
        });
    }
};
/**
 * @desc    Export salary comparison (Regular vs 2nd Salary) to Excel
 * @route   GET /api/second-salary/comparison/export
 */
exports.exportSalaryComparisonExcel = async (req, res) => {
    try {
        const { month, departmentId, divisionId, designationId, search } = req.query;
        const secondSalaryComparisonService = require('../services/secondSalaryComparisonService');

        if (!month) {
            return res.status(400).json({
                success: false,
                message: 'Month is required'
            });
        }

        const comparisonData = await secondSalaryComparisonService.getComparison(month, {
            departmentId,
            divisionId,
            designationId,
            search
        });

        if (!comparisonData || comparisonData.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No comparison data found for export.'
            });
        }

        // Build rows
        const rows = comparisonData.map((item, index) => buildComparisonExcelRow(item, index + 1));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);

        // Styling is limited with vanilla xlsx, so we use clear headers
        XLSX.utils.book_append_sheet(wb, ws, 'Salary Comparison');

        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const filename = `salary_comparison_${month}.xlsx`;
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buf);
    } catch (error) {
        console.error('Error exporting salary comparison:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error exporting comparison data'
        });
    }
};
