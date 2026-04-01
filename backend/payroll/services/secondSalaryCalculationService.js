const PayRegisterSummary = require('../../pay-register/model/PayRegisterSummary');
const Employee = require('../../employees/model/Employee');
const Department = require('../../departments/model/Department');
const SecondSalaryRecord = require('../model/SecondSalaryRecord');
const SecondSalaryBatch = require('../model/SecondSalaryBatch');

const secondSalaryBasicPayService = require('./secondSalaryBasicPayService');
const secondSalaryOTPayService = require('./secondSalaryOTPayService');
const secondSalaryAllowanceService = require('./secondSalaryAllowanceService');
const secondSalaryDeductionService = require('./secondSalaryDeductionService');
const secondSalaryLoanAdvanceService = require('./secondSalaryLoanAdvanceService');
const SecondSalaryBatchService = require('./secondSalaryBatchService');
const allowanceDeductionResolverService = require('./allowanceDeductionResolverService');
const statutoryDeductionService = require('./statutoryDeductionService');

/**
 * Normalize overrides (same logic as regular payroll)
 */
const normalizeOverrides = (list, fallbackCategory) => {
    if (!Array.isArray(list)) return [];
    return list
        .filter(ov => ov && (ov.masterId || ov.name))
        .map((ov) => {
            // Use toObject() if it's a Mongoose subdocument, otherwise spread properties
            const override = (ov && typeof ov.toObject === 'function') ? ov.toObject() : { ...ov };

            override.category = override.category || fallbackCategory;
            if (override.amount === undefined || override.amount === null) {
                override.amount = (override.overrideAmount !== undefined && override.overrideAmount !== null)
                    ? override.overrideAmount
                    : 0;
            }
            override.amount = parseFloat(override.amount) || 0;
            return override;
        });
};


/**
 * Main Second Salary Calculation Service
 * Replicates the robust Pay Register calculation logic for 2nd Salary
 */

/**
 * Calculate second salary for an employee
 */
async function calculateSecondSalary(employeeId, month, userId, sharedContext = null) {
    try {
        const employee = await Employee.findById(employeeId).populate('department_id designation_id division_id');
        if (!employee) throw new Error('Employee not found');

        // User requirement: use second_salary as base
        if (!employee.second_salary || employee.second_salary <= 0) {
            console.warn(`[SecondSalary] Warning: Employee ${employee.emp_no} has invalid second salary (${employee.second_salary}). Proceeding with 0.`);
        }

        const payRegisterSummary = await PayRegisterSummary.findOne({ employeeId, month });

        let attendanceSummary;

        if (payRegisterSummary) {
            // Use PayRegisterSummary as source of truth
            console.log('[SecondSalary] Using PayRegisterSummary as source of truth');
            attendanceSummary = {
                totalPayableShifts: payRegisterSummary.totals?.totalPayableShifts || 0,
                totalOTHours: payRegisterSummary.totals?.totalOTHours || 0,
                totalLeaveDays: payRegisterSummary.totals?.totalLeaveDays || 0,
                totalODDays: payRegisterSummary.totals?.totalODDays || 0,
                totalLopDays: payRegisterSummary.totals?.totalLopDays || 0,
                totalPresentDays: payRegisterSummary.totals?.totalPresentDays || 0,
                totalDaysInMonth: payRegisterSummary.totalDaysInMonth || 30,
                totalPaidLeaveDays: payRegisterSummary.totals?.totalPaidLeaveDays || 0,
                totalWeeklyOffs: payRegisterSummary.totals?.totalWeeklyOffs || 0,
                totalHolidays: payRegisterSummary.totals?.totalHolidays || 0,
                extraDays: payRegisterSummary.totals?.extraDays || 0,
                lateCount: (payRegisterSummary.totals?.lateCount || 0) + (payRegisterSummary.totals?.earlyOutCount || 0) || 0,
            };
        } else {
            // Fall back to MonthlyAttendanceSummary (matching regular payroll)
            console.log('[SecondSalary] Using MonthlyAttendanceSummary (PayRegisterSummary not found)');
            const MonthlyAttendanceSummary = require('../../attendance/model/MonthlyAttendanceSummary');
            const doc = await MonthlyAttendanceSummary.findOne({ employeeId, month });
            if (!doc) {
                throw new Error(`Attendance summary not found for month ${month}`);
            }
            attendanceSummary = {
                totalPayableShifts: doc.totalPayableShifts || 0,
                totalOTHours: doc.totalOTHours || 0,
                totalLeaveDays: doc.totalLeaves || 0,
                totalODDays: doc.totalODs || 0,
                totalLopDays: 0, // Fallback
                totalPresentDays: doc.totalPresentDays || 0,
                totalDaysInMonth: doc.totalDaysInMonth || 30,
                totalPaidLeaveDays: doc.totalPaidLeaves || doc.totalLeaves || 0, // Prefer totalPaidLeaves if available
                totalWeeklyOffs: 0,
                totalHolidays: 0,
                extraDays: 0,
                lateCount: 0
            };
        }

        const departmentId = employee.department_id?._id || employee.department_id;
        const divisionId = employee.division_id?._id || employee.division_id;

        if (!departmentId) {
            throw new Error(`Employee ${employee.emp_no} has no department assigned. Calculation aborted.`);
        }

        // Optimization: Use shared department object if available
        let department;
        if (sharedContext && sharedContext.department && sharedContext.department._id.toString() === departmentId.toString()) {
            department = sharedContext.department;
        } else {
            department = await Department.findById(departmentId);
        }

        // Get leave policy settings for EL-as-paid feature (Parity with Regular Payroll)
        const LeavePolicySettings = require('../../settings/model/LeavePolicySettings');
        let elUsedInPayroll = 0;
        // NOTE: totalPayableShifts from PayRegisterSummary already includes paid leave days
        // (it is computed as present + OD + paid leaves in the regular payroll flow).
        // Do NOT add paidLeaveDays again — that was causing paid leaves to be counted twice.
        let paidLeaveDays = attendanceSummary.totalPaidLeaveDays || 0;
        let payableShifts = attendanceSummary.totalPayableShifts || 0;
        const monthDays = attendanceSummary.totalDaysInMonth;

        try {
            const policy = await LeavePolicySettings.getSettings();
            if (policy.earnedLeave && policy.earnedLeave.useAsPaidInPayroll !== false) {
                const elBalance = Math.max(0, Number(employee.paidLeaves) || 0);
                if (elBalance > 0) {
                    elUsedInPayroll = Math.min(elBalance, monthDays);
                    // Add EL to both buckets
                    payableShifts = payableShifts + elUsedInPayroll;
                    paidLeaveDays = paidLeaveDays + elUsedInPayroll;
                }
            }
        } catch (e) {
            console.warn('[SecondSalary] LeavePolicySettings check failed:', e.message);
        }

        const modifiedAttendanceSummary = {
            ...attendanceSummary,
            totalPayableShifts: payableShifts,
            totalPaidLeaveDays: paidLeaveDays,
            elUsedInPayroll
        };

        const attendanceData = {
            presentDays: modifiedAttendanceSummary.totalPresentDays || 0,
            paidLeaveDays: modifiedAttendanceSummary.totalPaidLeaveDays || 0,
            odDays: modifiedAttendanceSummary.totalODDays || 0,
            monthDays: modifiedAttendanceSummary.totalDaysInMonth,
        };

        // Batch Validation
        const existingBatch = await SecondSalaryBatch.findOne({
            department: departmentId,
            division: divisionId,
            month
        });

        if (existingBatch) {
            if (['freeze', 'complete'].includes(existingBatch.status)) {
                const error = new Error(`2nd Salary payroll for ${month} is ${existingBatch.status}. Recalculation is not allowed.`);
                error.code = 'BATCH_LOCKED';
                error.batchId = existingBatch._id;
                throw error;
            }
            if (existingBatch.status === 'approved') {
                if (!existingBatch.hasValidRecalculationPermission()) {
                    const error = new Error(`2nd Salary payroll for ${month} is approved. Recalculation requires permission.`);
                    error.code = 'BATCH_LOCKED';
                    error.batchId = existingBatch._id;
                    throw error;
                }
                // Single-use permission
                existingBatch.consumeRecalculationPermission?.();
                await existingBatch.save();
            }
        }

        console.log(`\n========== SECOND SALARY CALCULATION START (${employee.emp_no}) ==========`);

        // 1. Basic Pay Calculation (using second_salary)
        const basicPayResult = secondSalaryBasicPayService.calculateBasicPay(employee, modifiedAttendanceSummary);

        const basicPay = basicPayResult.basicPay || 0;
        const extraDays = basicPayResult.extraDays || 0;
        const totalPaidDays = basicPayResult.totalPaidDays;
        const perDaySalary = basicPayResult.perDayBasicPay;
        const earnedSalary = basicPayResult.basePayForWork;
        const incentiveAmount = basicPayResult.incentive;

        // 2. OT Pay Calculation
        const otPayResult = await secondSalaryOTPayService.calculateOTPay(
            attendanceSummary.totalOTHours || 0,
            departmentId.toString(),
            divisionId?.toString()
        );
        const otPay = otPayResult.otPay || 0;

        // 3. Base Gross for deductions
        let grossAmountSalary = earnedSalary + otPay;

        const attendanceDataForProration = {
            presentDays: modifiedAttendanceSummary.totalPresentDays || 0,
            paidLeaveDays: modifiedAttendanceSummary.totalPaidLeaveDays || 0,
            odDays: modifiedAttendanceSummary.totalODDays || 0,
            monthDays: modifiedAttendanceSummary.totalDaysInMonth,
        };

        // Pass 1: Basic-based allowances
        const basicBasedAllowances = await secondSalaryAllowanceService.calculateAllowances(
            departmentId.toString(),
            basicPayResult.basicPay,
            null, // grossSalary not available yet
            false,
            attendanceDataForProration,
            divisionId?.toString()
        );

        const currentGross = basicPay + basicBasedAllowances.reduce((sum, a) => sum + (a.amount || 0), 0) + otPay;

        // Pass 2: Gross-based allowances
        const grossBasedAllowances = await secondSalaryAllowanceService.calculateAllowances(
            departmentId.toString(),
            basicPayResult.basicPay,
            currentGross,
            true, // second pass
            attendanceDataForProration,
            divisionId?.toString()
        );

        const allAllowances = [...basicBasedAllowances, ...grossBasedAllowances];

        // Deduplicate base allowances
        const uniqueAllowances = [];
        const seenAllowanceKeys = new Set();
        allAllowances.forEach(a => {
            const key = a.masterId ? `id_${a.masterId.toString()}` : `name_${a.name.toLowerCase()}`;
            if (!seenAllowanceKeys.has(key)) {
                uniqueAllowances.push(a);
                seenAllowanceKeys.add(key);
            }
        });

        // Merge with employee overrides
        // Optimization: Use shared includeMissing flag if available
        let includeMissing;
        if (sharedContext && sharedContext.includeMissing !== undefined) {
            includeMissing = sharedContext.includeMissing;
        } else {
            includeMissing = await allowanceDeductionResolverService.getIncludeMissingFlag(departmentId, divisionId);
        }

        const allowanceOverrides = normalizeOverrides(employee.employeeAllowances || [], 'allowance');

        console.log(`\n--- Normalized Second Salary Allowance Overrides: ${allowanceOverrides.length} items ---`);
        allowanceOverrides.forEach((ov, idx) => {
            console.log(`  [${idx + 1}] ${ov.name} (masterId: ${ov.masterId}, amount: ${ov.amount})`);
        });

        const mergedAllowances = allowanceDeductionResolverService.mergeWithOverrides(uniqueAllowances, allowanceOverrides, includeMissing);

        console.log(`\n--- Merged Second Salary Allowances: ${mergedAllowances.length} items (includeMissing: ${includeMissing}) ---`);
        mergedAllowances.forEach((m, idx) => {
            console.log(`  [${idx + 1}] ${m.name}: ${m.amount} ${m.isEmployeeOverride ? '(OVERRIDDEN)' : ''}`);
        });

        const totalAllowances = secondSalaryAllowanceService.calculateTotalAllowances(mergedAllowances);
        grossAmountSalary += totalAllowances;

        // 5. Deductions (second salary uses its own deduction service; employee flags respected there)
        // 5a. Attendance Deductions (Lates/Early Outs)
        const attendanceDeductionResult = await secondSalaryDeductionService.calculateAttendanceDeduction(
            employeeId,
            month,
            departmentId.toString(),
            perDaySalary,
            divisionId?.toString(),
            { employee }
        );

        // 5b. Permission Deductions
        const permissionDeductionResult = await secondSalaryDeductionService.calculatePermissionDeduction(
            employeeId,
            month,
            departmentId.toString(),
            perDaySalary,
            divisionId?.toString(),
            { employee }
        );

        // Leave deduction is calculated for record-keeping but proration is handled in basicPay
        const leaveDeductionResult = secondSalaryDeductionService.calculateLeaveDeduction(
            attendanceSummary.totalLeaveDays || 0,
            attendanceSummary.totalPaidLeaveDays || 0, // Use summarized paid leaves
            modifiedAttendanceSummary.totalDaysInMonth,
            basicPayResult.basicPay
        );

        // Attendance and Permission deductions are separate line items
        // We include them in totalDeductions for parity if they are considered "net" reductions
        // BUT for report parity, we might need ONLY otherDeductions
        let totalDeductions =
            (attendanceDeductionResult.attendanceDeduction || 0) +
            (permissionDeductionResult.permissionDeduction || 0);
        // Note: we DO NOT add leaveDeduction here because basic is already prorated.

        // Other Deductions from Master
        const baseDeductions = await secondSalaryDeductionService.calculateOtherDeductions(
            departmentId.toString(),
            basicPayResult.basicPay,
            grossAmountSalary,
            attendanceDataForProration,
            divisionId?.toString()
        );

        const deductionOverrides = normalizeOverrides(employee.employeeDeductions || [], 'deduction');

        console.log(`\n--- Normalized Second Salary Deduction Overrides: ${deductionOverrides.length} items ---`);
        deductionOverrides.forEach((ov, idx) => {
            console.log(`  [${idx + 1}] ${ov.name} (masterId: ${ov.masterId}, amount: ${ov.amount})`);
        });

        const mergedDeductions = allowanceDeductionResolverService.mergeWithOverrides(baseDeductions, deductionOverrides, includeMissing);

        console.log(`\n--- Merged Second Salary Deductions: ${mergedDeductions.length} items (includeMissing: ${includeMissing}) ---`);
        mergedDeductions.forEach((m, idx) => {
            console.log(`  [${idx + 1}] ${m.name}: ${m.amount} ${m.isEmployeeOverride ? '(OVERRIDDEN)' : ''}`);
        });

        const totalOtherDeductions = secondSalaryDeductionService.calculateTotalOtherDeductions(mergedDeductions);
        totalDeductions += totalOtherDeductions;

        const grossBeforeStatutory = grossAmountSalary + incentiveAmount;
        const statutoryResult = await statutoryDeductionService.calculateStatutoryDeductions({
            basicPay,
            grossSalary: grossBeforeStatutory,
            earnedSalary,
            dearnessAllowance: 0,
            employee,
            paidDays: totalPaidDays,
            totalDaysInMonth: modifiedAttendanceSummary.totalDaysInMonth,
            allSalaries: {},
        });
        const statutoryTotal = statutoryResult.totalEmployeeShare || 0;
        totalDeductions += statutoryTotal;

        // 6. Loans & Advances
        // We deduct them for netSalary calculation, but they are NOT part of "Total Deductions" summary
        const loanAdvanceResult = await secondSalaryLoanAdvanceService.calculateLoanAdvance(
            employeeId,
            month,
            Math.max(0, grossAmountSalary - totalDeductions)
        );

        // ADD loan EMI and advance deduction to totalDeductions for summary parity
        totalDeductions += (loanAdvanceResult.totalEMI || 0) + (loanAdvanceResult.advanceDeduction || 0);

        // 7. Final Net Salary
        const baseNet = Math.max(0, grossAmountSalary - totalDeductions);
        let netSalary = baseNet + incentiveAmount; // Add incentive (extra days pay)

        // Round off
        const exactNet = netSalary;
        const roundedNet = Math.ceil(exactNet);
        const roundOff = Number((roundedNet - exactNet).toFixed(2));

        // 8. Create/Update Record
        const [yearStr, monthStr] = month.split('-');
        const year = parseInt(yearStr);
        const monthNum = parseInt(monthStr);
        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        const monthName = `${monthNames[monthNum - 1]} ${year}`;
        const totalDaysInMonth = attendanceSummary.totalDaysInMonth;

        let record = await SecondSalaryRecord.findOne({ employeeId, month });
        if (!record) {
            record = new SecondSalaryRecord({
                employeeId,
                emp_no: employee.emp_no,
                month,
                monthName,
                year,
                monthNumber: monthNum,
                totalDaysInMonth,
            });
        } else {
            record.monthName = monthName;
            record.totalDaysInMonth = totalDaysInMonth;
        }

        // Set fields
        record.set('totalPayableShifts', modifiedAttendanceSummary.totalPayableShifts);
        record.set('netSalary', roundedNet);
        record.set('payableAmountBeforeAdvance', grossAmountSalary);
        record.set('roundOff', roundOff);
        record.set('status', 'calculated');
        record.set('division_id', divisionId);

        // Attendance Breakdown
        record.set('attendance', {
            totalDaysInMonth: attendanceSummary.totalDaysInMonth,
            presentDays: attendanceSummary.totalPresentDays,
            paidLeaveDays: attendanceSummary.totalPaidLeaveDays,
            odDays: attendanceSummary.totalODDays,
            weeklyOffs: attendanceSummary.totalWeeklyOffs,
            holidays: attendanceSummary.totalHolidays,
            absentDays: Math.max(0, attendanceSummary.totalDaysInMonth - (attendanceSummary.totalPresentDays + attendanceSummary.totalWeeklyOffs + attendanceSummary.totalHolidays + attendanceSummary.totalPaidLeaveDays)), // Removed totalODDays (already in presentDays)
            payableShifts: modifiedAttendanceSummary.totalPayableShifts,
            extraDays: extraDays,
            totalPaidDays: totalPaidDays,
            paidDays: totalPaidDays - extraDays, // Base paid days
            otHours: attendanceSummary.totalOTHours || 0,
            otDays: (otPayResult.eligibleOTHours || 0) / 8, // Roughly
            earnedSalary: earnedSalary,
            lopDays: (attendanceSummary.totalLopDays || 0) + (leaveDeductionResult.breakdown?.unpaidLeaves || 0),
            elUsedInPayroll: modifiedAttendanceSummary.elUsedInPayroll || 0
        });

        // Earnings
        record.set('earnings.secondSalaryAmount', basicPay);
        record.set('earnings.basicPay', basicPay);
        record.set('earnings.perDayBasicPay', perDaySalary);
        record.set('earnings.payableAmount', earnedSalary);
        record.set('earnings.incentive', incentiveAmount);
        record.set('earnings.otPay', otPay);
        record.set('earnings.otHours', otPayResult.otHours);
        record.set('earnings.otRatePerHour', otPayResult.otPayPerHour);
        record.set('earnings.totalAllowances', totalAllowances);
        record.set('earnings.allowances', mergedAllowances);
        record.set('earnings.grossSalary', grossAmountSalary + incentiveAmount);

        // Deductions Breakdown
        record.set('deductions.attendanceDeduction', attendanceDeductionResult.attendanceDeduction);
        record.set('deductions.attendanceDeductionBreakdown', attendanceDeductionResult.breakdown);
        record.set('deductions.permissionDeduction', permissionDeductionResult.permissionDeduction);
        record.set('deductions.permissionDeductionBreakdown', permissionDeductionResult.breakdown);
        record.set('deductions.leaveDeduction', 0); // Set to 0 for parity as basic is prorated
        record.set('deductions.leaveDeductionBreakdown', leaveDeductionResult.breakdown);
        record.set('deductions.totalOtherDeductions', totalOtherDeductions);
        record.set('deductions.otherDeductions', mergedDeductions);
        record.set(
            'deductions.statutoryDeductions',
            (statutoryResult.breakdown || []).map((s) => ({
                name: s.name,
                code: s.code,
                employeeAmount: s.employeeAmount,
                employerAmount: s.employerAmount,
            }))
        );
        record.set('deductions.statutoryCumulative', statutoryTotal);
        record.set('deductions.totalStatutoryEmployee', statutoryTotal);
        record.set('deductions.totalDeductions', totalDeductions);

        // Loans
        record.set('loanAdvance.totalEMI', loanAdvanceResult.totalEMI);
        record.set('loanAdvance.emiBreakdown', loanAdvanceResult.emiBreakdown);
        record.set('loanAdvance.advanceDeduction', loanAdvanceResult.advanceDeduction);
        record.set('loanAdvance.advanceBreakdown', loanAdvanceResult.advanceBreakdown);

        await record.save();

        // 9. Batch Management
        let batch = await SecondSalaryBatch.findOne({ department: departmentId, division: divisionId, month });
        if (!batch) {
            batch = await SecondSalaryBatchService.createBatch(departmentId, divisionId, month, userId);
        }
        if (batch) {
            await SecondSalaryBatchService.addPayrollToBatch(batch._id, record._id);
        }

        console.log(`✓ Second salary calculated and saved for ${employee.emp_no}. Net: ${roundedNet}`);
        console.log(`========== SECOND SALARY CALCULATION END ========== \n`);

        return {
            success: true,
            record,
            batchId: batch?._id
        };

    } catch (error) {
        console.error('Error in calculateSecondSalary:', error);
        throw error;
    }
}

/**
 * 2nd salary for pay register / bulk: use dynamic output-column engine when strategy=dynamic and config has columns;
 * otherwise legacy second-salary pipeline.
 */
async function calculateSecondSalaryForPayRegister(employeeId, month, userId, strategy, sharedContext = null) {
    const useDynamic = String(strategy || '').toLowerCase() === 'dynamic';
    if (useDynamic) {
        const PayrollConfiguration = require('../model/PayrollConfiguration');
        const payrollCalculationFromOutputColumnsService = require('./payrollCalculationFromOutputColumnsService');
        const ArrearsPayrollIntegrationService = require('../../arrears/services/arrearsPayrollIntegrationService');
        const DeductionPayrollIntegrationService = require('../../manual-deductions/services/deductionPayrollIntegrationService');
        const config = await PayrollConfiguration.get();
        const outputColumns = Array.isArray(config?.outputColumns) ? config.outputColumns : [];
        if (outputColumns.length > 0) {
            let arrearsSettlements = [];
            let deductionSettlements = [];
            try {
                const pendingArrears = await ArrearsPayrollIntegrationService.getPendingArrearsForPayroll(employeeId);
                if (pendingArrears && pendingArrears.length > 0) {
                    arrearsSettlements = pendingArrears.map((ar) => ({
                        arrearId: ar.id,
                        amount: ar.remainingAmount || 0,
                    }));
                }
            } catch (err) {
                console.error(`[SecondSalary] Failed fetching pending arrears for ${employeeId}:`, err.message);
            }
            try {
                const pendingDeductions = await DeductionPayrollIntegrationService.getPendingDeductionsForPayroll(employeeId);
                if (pendingDeductions && pendingDeductions.length > 0) {
                    deductionSettlements = pendingDeductions.map((d) => ({
                        deductionId: d.id,
                        amount: d.remainingAmount || 0,
                    }));
                }
            } catch (err) {
                console.error(`[SecondSalary] Failed fetching pending deductions for ${employeeId}:`, err.message);
            }

            return payrollCalculationFromOutputColumnsService.calculatePayrollFromOutputColumns(
                employeeId.toString(),
                month,
                userId,
                {
                    secondSalaryBasis: true,
                    source: 'payregister',
                    arrearsSettlements,
                    deductionSettlements,
                }
            );
        }
    }
    return calculateSecondSalary(employeeId, month, userId, sharedContext);
}

module.exports = {
    calculateSecondSalary,
    calculateSecondSalaryForPayRegister,
};
