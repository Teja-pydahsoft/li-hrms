/**
 * Employee Leave Initialization Service
 * Handles prorated leave allocation for new employees based on their date of joining
 */

const Employee = require('../../employees/model/Employee');
const LeavePolicySettings = require('../../settings/model/LeavePolicySettings');
const leaveRegisterService = require('./leaveRegisterService');
const dateCycleService = require('./dateCycleService');
const { createISTDate } = require('../../shared/utils/dateUtils');

/**
 * Full years of experience from DOJ to asOfDate (inclusive of asOfDate).
 * Copied from annualCLResetService.js for consistency
 */
function yearsOfExperience(doj, asOfDate) {
    if (!doj) return 0;
    const start = new Date(doj);
    const end = new Date(asOfDate);
    if (end < start) return 0;
    const years = (end.getFullYear() - start.getFullYear()) +
        ((end.getMonth() - start.getMonth()) * 12 + (end.getDate() - start.getDate())) / 365.25;
    return Math.floor(years);
}

/**
 * Get casual leave entitlement for employee: from experience tiers if configured, else default.
 * Copied from annualCLResetService.js for consistency
 */
function getCasualLeaveEntitlement(settings, doj, asOfDate) {
    const defaultCL = settings.annualCLReset.resetToBalance ?? 12;
    const tiers = settings.annualCLReset.casualLeaveByExperience;
    if (!Array.isArray(tiers) || tiers.length === 0) return defaultCL;
    const years = yearsOfExperience(doj, asOfDate);
    const sorted = [...tiers].sort((a, b) => (a.minYears || 0) - (b.minYears || 0));
    for (const t of sorted) {
        const min = t.minYears ?? 0;
        const max = t.maxYears ?? 999;
        if (years >= min && years < max) return t.casualLeave ?? defaultCL;
    }
    return defaultCL;
}

/**
 * Calculate remaining months in financial year from a given date
 * Now respects payroll cycle start/end dates
 */
async function calculateRemainingMonthsInFY(dateOfJoining) {
    try {
        const financialYear = await dateCycleService.getFinancialYearForDate(dateOfJoining);

        // Get payroll cycle settings to respect monthly boundaries
        const payrollCycle = await dateCycleService.getPayrollCycleSettings();

        // Calculate months from DOJ to end of financial year
        const fyEnd = new Date(financialYear.endDate);
        const doj = new Date(dateOfJoining);

        // If using payroll cycles, calculate based on payroll periods
        if (payrollCycle && payrollCycle.enabled) {
            // Calculate remaining payroll periods in the financial year
            const remainingPeriods = dateCycleService.calculateRemainingPayrollPeriodsInFY(doj, fyEnd, payrollCycle);
            return {
                remainingMonths: remainingPeriods,
                totalMonthsInFY: 12, // Still 12 periods even with custom cycles
                financialYear,
                usedPayrollCycle: true
            };
        }

        // Fallback to calendar months
        const monthsRemaining = (fyEnd.getFullYear() - doj.getFullYear()) * 12 +
                               (fyEnd.getMonth() - doj.getMonth());

        const remainingMonths = Math.max(0, monthsRemaining);

        return {
            remainingMonths,
            totalMonthsInFY: 12,
            financialYear,
            usedPayrollCycle: false
        };
    } catch (error) {
        console.error('[EmployeeLeaveInit] Error calculating remaining months:', error);
        // Fallback to 12 months if calculation fails
        return {
            remainingMonths: 12,
            totalMonthsInFY: 12,
            financialYear: null,
            usedPayrollCycle: false
        };
    }
}

/**
 * Initialize prorated CL for a new employee
 */
async function initializeEmployeeCL(employeeId) {
    try {
        console.log(`[EmployeeLeaveInit] Initializing prorated CL for employee ${employeeId}`);

        // Get employee details
        const employee = await Employee.findById(employeeId)
            .select('_id emp_no employee_name department_id division_id doj designation department')
            .populate('department_id', 'name')
            .populate('division_id', 'name');

        if (!employee) {
            throw new Error('Employee not found');
        }

        if (!employee.doj) {
            console.log(`[EmployeeLeaveInit] No DOJ found for employee ${employee.emp_no}, skipping CL initialization`);
            return { success: false, message: 'No date of joining found' };
        }

        // Get leave policy settings
        const settings = await LeavePolicySettings.getSettings();

        if (!settings.annualCLReset.enabled) {
            console.log(`[EmployeeLeaveInit] Annual CL reset disabled, skipping prorated CL initialization`);
            return { success: false, message: 'Annual CL reset is disabled' };
        }

        // Calculate remaining months in financial year
        const { remainingMonths, totalMonthsInFY } = await calculateRemainingMonthsInFY(employee.doj);

        if (remainingMonths <= 0) {
            console.log(`[EmployeeLeaveInit] No remaining months in FY for employee ${employee.emp_no}`);
            return { success: true, message: 'No prorated CL needed - FY already ended', proratedCL: 0 };
        }

        // Get full annual entitlement
        const fullAnnualEntitlement = getCasualLeaveEntitlement(settings, employee.doj, employee.doj);

        // Calculate prorated CL (raw calculation)
        const rawProratedCL = (fullAnnualEntitlement * remainingMonths / totalMonthsInFY);

        // Round to nearest 0.5 increment to get clean decimal values
        // 0.6, 0.7, 0.8, 0.2, 0.3, 0.4 become 0.5 or 1.0
        const proratedCL = Math.round(rawProratedCL * 2) / 2;

        // Apply monthly limit constraints from leave policy settings
        const monthlyLimitSettings = settings.monthlyLimitSettings || {};
        const maxUsableLimit = monthlyLimitSettings.maxUsableLimit || 4; // Default master cap
        const defaultMonthlyCap = monthlyLimitSettings.defaultMonthlyCap || 1; // Default monthly cap

        // Ensure prorated CL doesn't exceed reasonable monthly usage limits
        // For prorated allocation, we allow up to the max usable limit per month
        const maxReasonableProrated = Math.min(proratedCL, maxUsableLimit * remainingMonths);

        // Final prorated CL (capped and rounded)
        const finalProratedCL = Math.min(proratedCL, maxReasonableProrated);

        console.log(`[EmployeeLeaveInit] Employee ${employee.emp_no}: Full entitlement=${fullAnnualEntitlement}, Remaining months=${remainingMonths}/${totalMonthsInFY}, Raw prorated=${rawProratedCL.toFixed(2)}, Rounded=${proratedCL}, Capped=${finalProratedCL}`);

        // Check if employee already has CL transactions (avoid duplicate initialization)
        const existingCLTransactions = await leaveRegisterService.getLeaveRegister(employeeId, 'CL');
        if (existingCLTransactions && existingCLTransactions.length > 0) {
            console.log(`[EmployeeLeaveInit] Employee ${employee.emp_no} already has CL transactions, skipping initialization`);
            return { success: true, message: 'CL already initialized', proratedCL: 0 };
        }

        // Create initial CL transaction
        await leaveRegisterService.addTransaction({
            employeeId: employee._id,
            empNo: employee.emp_no,
            employeeName: employee.employee_name,
            designation: employee.designation || 'N/A',
            department: employee.department_id?.name || employee.department || 'N/A',
            divisionId: employee.division_id?._id,
            departmentId: employee.department_id?._id,
            dateOfJoining: employee.doj,
            employmentStatus: employee.is_active ? 'active' : 'inactive',
            leaveType: 'CL',
            transactionType: 'ADJUSTMENT',
            startDate: employee.doj,
            endDate: employee.doj,
            days: finalProratedCL,
            reason: `New Employee CL Allocation: ${finalProratedCL} days prorated for ${remainingMonths} remaining months in FY (${fullAnnualEntitlement} annual entitlement, rounded to nearest 0.5)`,
            status: 'APPROVED',
            autoGenerated: true,
            autoGeneratedType: 'NEW_EMPLOYEE_PRORATED_CL'
        });

        console.log(`[EmployeeLeaveInit] Successfully initialized ${finalProratedCL} prorated CL for employee ${employee.emp_no}`);

        return {
            success: true,
            message: `Prorated CL initialized: ${finalProratedCL} days`,
            proratedCL: finalProratedCL,
            fullAnnualEntitlement,
            remainingMonths,
            totalMonthsInFY,
            rawProratedCL: rawProratedCL.toFixed(2),
            roundedProratedCL: proratedCL,
            cappedProratedCL: finalProratedCL
        };

    } catch (error) {
        console.error(`[EmployeeLeaveInit] Error initializing CL for employee ${employeeId}:`, error);
        return {
            success: false,
            message: error.message,
            error: error.message
        };
    }
}

/**
 * Initialize leave balances for a new employee (called after employee creation)
 */
async function initializeEmployeeLeaves(employeeId) {
    try {
        console.log(`[EmployeeLeaveInit] Starting leave initialization for new employee ${employeeId}`);

        const results = {
            success: true,
            clInitialization: null,
            message: ''
        };

        // Initialize prorated CL
        const clResult = await initializeEmployeeCL(employeeId);
        results.clInitialization = clResult;

        if (!clResult.success) {
            results.success = false;
            results.message = `CL initialization failed: ${clResult.message}`;
        } else {
            results.message = clResult.message;
        }

        console.log(`[EmployeeLeaveInit] Completed leave initialization for employee ${employeeId}:`, results);

        return results;

    } catch (error) {
        console.error(`[EmployeeLeaveInit] Error in initializeEmployeeLeaves for ${employeeId}:`, error);
        return {
            success: false,
            message: error.message,
            error: error.message
        };
    }
}

module.exports = {
    initializeEmployeeLeaves,
    initializeEmployeeCL,
    calculateRemainingMonthsInFY,
    getCasualLeaveEntitlement
};