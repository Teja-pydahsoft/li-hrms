/**
 * Annual CL Reset Service
 * Handles annual casual leave balance reset at configured date (pay cycle / leave policy).
 * Resets CL to configured entitlement (default or experience-based) plus optional carry forward.
 */

const Employee = require('../../employees/model/Employee');
const LeavePolicySettings = require('../../settings/model/LeavePolicySettings');
const leaveRegisterService = require('./leaveRegisterService');
const dateCycleService = require('./dateCycleService');
const { createISTDate, getTodayISTDateString, extractISTComponents } = require('../../shared/utils/dateUtils');

/**
 * Full years of experience from DOJ to asOfDate (inclusive of asOfDate).
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
 * Get casual leave entitlement for reset: from experience tiers if configured, else default.
 */
function getCasualLeaveEntitlement(settings, doj, resetDate) {
    const defaultCL = settings.annualCLReset.resetToBalance ?? 12;
    const tiers = settings.annualCLReset.casualLeaveByExperience;
    if (!Array.isArray(tiers) || tiers.length === 0) return defaultCL;
    const years = yearsOfExperience(doj, resetDate);
    const sorted = [...tiers].sort((a, b) => (a.minYears || 0) - (b.minYears || 0));
    for (const t of sorted) {
        const min = t.minYears ?? 0;
        const max = t.maxYears ?? 999;
        if (years >= min && years < max) return t.casualLeave ?? defaultCL;
    }
    return defaultCL;
}

/**
 * Perform annual CL rollover for all active employees
 * @param {Number} targetYear - Target year for reset (optional, defaults to current financial year)
 * @returns {Object} Reset operation results
 */
async function performAnnualCLReset(targetYear = null) {
    try {
        console.log('[AnnualCLReset] Starting Annual CL Rollover process...');

        const settings = await LeavePolicySettings.getSettings();

        if (!settings.annualCLReset.enabled) {
            return {
                success: false,
                message: 'Annual CL reset is disabled in settings',
                processed: 0,
                errors: []
            };
        }

        const resetDate = await getResetDate(targetYear, settings);
        console.log(`[AnnualCLReset] Rollover execution date: ${resetDate.toISOString()}`);

        const employees = await Employee.find({ is_active: true })
            .select('_id emp_no employee_name department_id division_id doj is_active')
            .populate('department_id', 'name')
            .populate('division_id', 'name');

        const results = {
            success: true,
            resetDate,
            processed: 0,
            successCount: 0,
            errors: [],
            details: []
        };

        for (const employee of employees) {
            try {
                const resetResult = await resetEmployeeCL(employee, settings, resetDate);

                if (resetResult.success) {
                    results.successCount++;
                    results.details.push({
                        employeeId: employee._id,
                        empNo: employee.emp_no,
                        previousBalance: resetResult.previousBalance,
                        expiredAmount: resetResult.expiredAmount,
                        carryForwarded: resetResult.carryForwarded,
                        entitlement: resetResult.entitlement,
                        newBalance: resetResult.newBalance
                    });
                } else {
                    results.errors.push({ empNo: employee.emp_no, error: resetResult.error });
                }

                results.processed++;
            } catch (error) {
                results.errors.push({ empNo: employee.emp_no, error: error.message });
            }
        }

        return {
            ...results,
            message: `Annual CL Rollover completed: ${results.successCount} successful, ${results.errors.length} errors`
        };

    } catch (error) {
        console.error('[AnnualCLReset] Critical error:', error);
        return { success: false, error: error.message, message: 'Annual CL Rollover failed' };
    }
}

/**
 * Handle carry forward, expiration, and reset to entitlement for a single employee
 */
async function resetEmployeeCL(employee, settings, resetDate) {
    try {
        // 1. Get exact current balance from ledger
        const currentBalance = await leaveRegisterService.getCurrentBalance(employee._id, 'CL');

        let carryForwardAllowed = 0;
        let expiredAmount = 0;

        // 2. Carry forward bounds (only if addCarryForward and carry forward enabled)
        const addCarryForward = settings.annualCLReset.addCarryForward !== false;
        if (addCarryForward && settings.carryForward.casualLeave.enabled) {
            const maxCF = settings.carryForward.casualLeave.maxMonths || 12;
            carryForwardAllowed = Math.min(currentBalance, maxCF);
        }
        expiredAmount = Math.max(0, currentBalance - carryForwardAllowed);

        // 3. Post EXPIRY if balance exceeds carry forward limit
        if (expiredAmount > 0) {
            await leaveRegisterService.addTransaction({
                employeeId: employee._id,
                empNo: employee.emp_no,
                employeeName: employee.employee_name,
                designation: 'N/A',
                department: employee.department_id?.name || 'N/A',
                divisionId: employee.division_id?._id,
                departmentId: employee.department_id?._id,
                dateOfJoining: employee.doj,
                employmentStatus: employee.is_active ? 'active' : 'inactive',
                leaveType: 'CL',
                transactionType: 'EXPIRY',
                startDate: resetDate,
                endDate: resetDate,
                days: expiredAmount,
                reason: `Annual Reset: Unused CL above carry-forward limit. Expired ${expiredAmount} day(s).`,
                status: 'APPROVED',
                autoGenerated: true,
                autoGeneratedType: 'EXPIRY'
            });
        }

        // 4. Entitlement from settings (default or experience-based)
        const entitlement = getCasualLeaveEntitlement(settings, employee.doj, resetDate);
        const newBalance = entitlement + carryForwardAllowed;

        // 5. Post ADJUSTMENT to set CL to new year entitlement + carry forward
        await leaveRegisterService.addTransaction({
            employeeId: employee._id,
            empNo: employee.emp_no,
            employeeName: employee.employee_name,
            designation: 'N/A',
            department: employee.department_id?.name || 'N/A',
            divisionId: employee.division_id?._id,
            departmentId: employee.department_id?._id,
            dateOfJoining: employee.doj,
            employmentStatus: employee.is_active ? 'active' : 'inactive',
            leaveType: 'CL',
            transactionType: 'ADJUSTMENT',
            startDate: resetDate,
            endDate: resetDate,
            days: newBalance,
            reason: `Annual CL Reset: entitlement ${entitlement} (by experience)${carryForwardAllowed > 0 ? ` + carry forward ${carryForwardAllowed}` : ''} = ${newBalance}`,
            status: 'APPROVED',
            autoGenerated: true,
            autoGeneratedType: 'ANNUAL_RESET'
        });

        return {
            success: true,
            previousBalance: currentBalance,
            carryForwarded: carryForwardAllowed,
            expiredAmount,
            entitlement,
            newBalance
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Get reset date based on settings. All returned dates are IST midnight (createISTDate)
 * so stored transaction dates are correct regardless of server timezone.
 * When usePayrollCycleForReset is true: reset = start of first payroll period of the year.
 * E.g. calendar year + payroll 26th–25th => first period is 26 Dec (prev) to 25 Jan => reset on 26 Dec.
 */
async function getResetDate(targetYear, settings) {
    const usePayroll = settings.annualCLReset?.usePayrollCycleForReset === true;

    if (usePayroll) {
        const payroll = await dateCycleService.getPayrollCycleSettings();
        const startDay = Math.min(31, Math.max(1, payroll.startDay || 1));
        let year = targetYear;
        if (year == null) {
            const now = new Date();
            year = now.getFullYear();
        }
        // First payroll period of calendar year Y starts on: Dec (Y-1), startDay (IST).
        const resetDate = createISTDate(`${year - 1}-12-${String(startDay).padStart(2, '0')}`);
        return resetDate;
    }

    // Fixed reset month/day from leave policy (IST)
    if (targetYear) {
        return createISTDate(`${targetYear}-${String(settings.annualCLReset.resetMonth).padStart(2, '0')}-${String(settings.annualCLReset.resetDay).padStart(2, '0')}`);
    }

    const now = new Date();
    const currentYear = now.getMonth() + 1 >= settings.annualCLReset.resetMonth ?
        now.getFullYear() : now.getFullYear() - 1;

    return createISTDate(`${currentYear}-${String(settings.annualCLReset.resetMonth).padStart(2, '0')}-${String(settings.annualCLReset.resetDay).padStart(2, '0')}`);
}

/**
 * Get CL reset status for employees
 */
async function getCLResetStatus(employeeIds = null) {
    try {
        const query = { is_active: true };
        if (employeeIds && employeeIds.length > 0) {
            query._id = { $in: employeeIds };
        }

        const employees = await Employee.find(query)
            .select('_id emp_no employee_name casualLeaves department_id division_id')
            .populate('department_id', 'name')
            .populate('division_id', 'name')
            .lean();

        const settings = await LeavePolicySettings.getSettings();

        const nextDate = await getNextResetDate(settings);
        const results = employees.map(emp => ({
            employeeId: emp._id,
            empNo: emp.emp_no,
            employeeName: emp.employee_name,
            department: emp.department_id?.name,
            division: emp.division_id?.name,
            currentCL: typeof emp.casualLeaves === 'number' ? emp.casualLeaves : 0,
            nextResetDate: nextDate,
            rolloverEnabled: settings.annualCLReset.enabled,
            carryForwardEnabled: settings.carryForward.casualLeave.enabled,
            carryForwardMax: settings.carryForward.casualLeave.maxMonths || 12
        }));

        return {
            success: true,
            data: results,
            settings: {
                enabled: settings.annualCLReset.enabled,
                usePayrollCycleForReset: settings.annualCLReset.usePayrollCycleForReset,
                resetMonth: settings.annualCLReset.resetMonth,
                resetDay: settings.annualCLReset.resetDay,
                carryForwardEnabled: settings.carryForward.casualLeave.enabled,
                carryForwardMax: settings.carryForward.casualLeave.maxMonths || 12
            }
        };

    } catch (error) {
        console.error('Error getting CL reset status:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get next reset date (IST). Used by cron to compare with today (IST) so safe on UTC server.
 * When payroll-aligned: next reset = next occurrence of Dec + payroll start day (IST).
 */
async function getNextResetDate(settings) {
    if (settings.annualCLReset?.usePayrollCycleForReset === true) {
        const payroll = await dateCycleService.getPayrollCycleSettings();
        const startDay = Math.min(31, Math.max(1, payroll.startDay || 1));
        const now = new Date();
        const currentYear = now.getFullYear();
        const resetThisYear = createISTDate(`${currentYear}-12-${String(startDay).padStart(2, '0')}`);
        if (now < resetThisYear) return resetThisYear;
        return createISTDate(`${currentYear + 1}-12-${String(startDay).padStart(2, '0')}`);
    }

    const now = new Date();
    const currentYear = now.getMonth() + 1 >= settings.annualCLReset.resetMonth ?
        now.getFullYear() : now.getFullYear() - 1;

    return createISTDate(`${currentYear}-${String(settings.annualCLReset.resetMonth).padStart(2, '0')}-${String(settings.annualCLReset.resetDay).padStart(2, '0')}`);
}

/**
 * Initial CL sync from policy (manual action, not annual reset).
 * Sets each employee's CL balance to policy entitlement (+ optional carry forward from current)
 * and creates one ADJUSTMENT transaction per employee. Use after configuring leave policy
 * or to align all balances with current settings.
 * @returns {Object} { success, processed, successCount, errors, details }
 */
async function performInitialCLSync() {
    try {
        console.log('[InitialCLSync] Starting initial CL balance sync from policy...');

        const settings = await LeavePolicySettings.getSettings();
        const effectiveDate = createISTDate(getTodayISTDateString()); // IST midnight today

        const employees = await Employee.find({ is_active: true })
            .select('_id emp_no employee_name department_id division_id doj is_active')
            .populate('department_id', 'name')
            .populate('division_id', 'name');

        const results = {
            success: true,
            processed: 0,
            successCount: 0,
            errors: [],
            details: []
        };

        for (const employee of employees) {
            try {
                const syncResult = await syncEmployeeCLFromPolicy(employee, settings, effectiveDate);
                if (syncResult.success) {
                    results.successCount++;
                    results.details.push({
                        employeeId: employee._id,
                        empNo: employee.emp_no,
                        previousBalance: syncResult.previousBalance,
                        entitlement: syncResult.entitlement,
                        carryForwarded: syncResult.carryForwarded,
                        newBalance: syncResult.newBalance
                    });
                } else {
                    results.errors.push({ empNo: employee.emp_no, error: syncResult.error });
                }
                results.processed++;
            } catch (error) {
                results.errors.push({ empNo: employee.emp_no, error: error.message });
                results.processed++;
            }
        }

        return {
            ...results,
            message: `Initial CL sync completed: ${results.successCount} employees updated, ${results.errors.length} errors`
        };
    } catch (error) {
        console.error('[InitialCLSync] Critical error:', error);
        return { success: false, error: error.message, message: 'Initial CL sync failed' };
    }
}

/**
 * Set one employee's CL to policy entitlement + optional carry forward (no EXPIRY).
 */
async function syncEmployeeCLFromPolicy(employee, settings, effectiveDate) {
    try {
        const currentBalance = await leaveRegisterService.getCurrentBalance(employee._id, 'CL');
        let carryForwardAllowed = 0;
        const addCarryForward = settings.annualCLReset?.addCarryForward !== false;
        if (addCarryForward && settings.carryForward?.casualLeave?.enabled) {
            const maxCF = settings.carryForward.casualLeave.maxMonths || 12;
            carryForwardAllowed = Math.min(currentBalance, maxCF);
        }
        const { entitlement, proration } = await getInitialSyncEntitlement(settings, employee.doj, effectiveDate);
        const newBalance = entitlement + carryForwardAllowed;

        await leaveRegisterService.addTransaction({
            employeeId: employee._id,
            empNo: employee.emp_no,
            employeeName: employee.employee_name,
            designation: 'N/A',
            department: employee.department_id?.name || 'N/A',
            divisionId: employee.division_id?._id,
            departmentId: employee.department_id?._id,
            dateOfJoining: employee.doj,
            employmentStatus: employee.is_active ? 'active' : 'inactive',
            leaveType: 'CL',
            transactionType: 'ADJUSTMENT',
            startDate: effectiveDate,
            endDate: effectiveDate,
            days: newBalance,
            reason: `Initial CL sync from policy: entitlement ${entitlement}${carryForwardAllowed > 0 ? ` + carry forward ${carryForwardAllowed}` : ''} = ${newBalance}`,
            status: 'APPROVED',
            autoGenerated: true,
            autoGeneratedType: 'INITIAL_BALANCE'
        });

        return {
            success: true,
            previousBalance: currentBalance,
            entitlement,
            proration,
            carryForwarded: carryForwardAllowed,
            newBalance
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Initial-sync entitlement with proration:
 * - If DOJ is before FY start: full entitlement.
 * - If DOJ is within current FY: prorated by remaining months in FY.
 * - If DOJ is after FY end: 0.
 */
async function getInitialSyncEntitlement(settings, doj, effectiveDate) {
    const fullEntitlement = getCasualLeaveEntitlement(settings, doj, effectiveDate);
    if (!doj) {
        return {
            entitlement: fullEntitlement,
            proration: { applied: false, reason: 'missing_doj', fullEntitlement, remainingMonths: 12, totalMonths: 12 }
        };
    }

    const fy = await dateCycleService.getFinancialYearForDate(effectiveDate);
    const fyStartIst = extractISTComponents(fy.startDate);
    const fyEndIst = extractISTComponents(fy.endDate);
    const dojIst = extractISTComponents(doj);

    const dojYmd = `${dojIst.year}-${String(dojIst.month).padStart(2, '0')}-${String(dojIst.day).padStart(2, '0')}`;
    const fyStartYmd = `${fyStartIst.year}-${String(fyStartIst.month).padStart(2, '0')}-${String(fyStartIst.day).padStart(2, '0')}`;
    const fyEndYmd = `${fyEndIst.year}-${String(fyEndIst.month).padStart(2, '0')}-${String(fyEndIst.day).padStart(2, '0')}`;

    if (dojYmd > fyEndYmd) {
        return {
            entitlement: 0,
            proration: { applied: true, reason: 'joined_after_fy_end', fullEntitlement, remainingMonths: 0, totalMonths: 12 }
        };
    }
    if (dojYmd <= fyStartYmd) {
        return {
            entitlement: fullEntitlement,
            proration: { applied: false, reason: 'joined_before_fy_start', fullEntitlement, remainingMonths: 12, totalMonths: 12 }
        };
    }

    const remainingMonths = ((fyEndIst.year - dojIst.year) * 12) + (fyEndIst.month - dojIst.month) + 1;
    const safeRemaining = Math.max(0, Math.min(12, remainingMonths));
    const raw = (Number(fullEntitlement) * safeRemaining) / 12;
    const rounded = Math.round(raw * 2) / 2; // nearest 0.5

    return {
        entitlement: rounded,
        proration: {
            applied: true,
            reason: 'joined_within_fy',
            fullEntitlement,
            remainingMonths: safeRemaining,
            totalMonths: 12,
            raw,
            rounded
        }
    };
}

module.exports = {
    performAnnualCLReset,
    performInitialCLSync,
    getInitialSyncEntitlement,
    getCLResetStatus,
    getNextResetDate,
    getResetDate
};
