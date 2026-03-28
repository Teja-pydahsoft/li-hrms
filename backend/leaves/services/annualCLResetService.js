/**
 * Annual CL Reset Service
 * Handles annual casual leave balance reset at configured date (pay cycle / leave policy).
 * Resets CL to configured entitlement (default or experience-based) plus optional carry forward.
 */

const Employee = require('../../employees/model/Employee');
const Leave = require('../model/Leave');
const LeaveSplit = require('../model/LeaveSplit');
const OD = require('../model/OD');
const LeavePolicySettings = require('../../settings/model/LeavePolicySettings');
const leaveRegisterService = require('./leaveRegisterService');
const dateCycleService = require('./dateCycleService');
const leaveRegisterYearService = require('./leaveRegisterYearService');
const leaveRegisterYearLedgerService = require('./leaveRegisterYearLedgerService');
const { PENDING_PIPELINE_STATUSES } = require('./monthlyApplicationCapService');
const { createISTDate, getTodayISTDateString, extractISTComponents } = require('../../shared/utils/dateUtils');

/**
 * Full years of experience from DOJ to asOfDate (inclusive of asOfDate).
 */
function yearsOfExperience(doj, asOfDate) {
    if (!doj) return 0;
    const s = extractISTComponents(doj);
    const e = extractISTComponents(asOfDate);
    if (e.dateStr < s.dateStr) return 0;
    const years = (e.year - s.year) +
        ((e.month - s.month) * 12 + (e.day - s.day)) / 365.25;
    return Math.floor(years);
}

/**
 * Max CL days allowed to carry at annual reset / initial sync when carry is enabled.
 * Uses annualCLReset.maxCarryForwardCl when set; otherwise 12.
 */
function getMaxAnnualCarryForwardCl(settings) {
    const explicit = settings?.annualCLReset?.maxCarryForwardCl;
    if (explicit != null && Number.isFinite(Number(explicit)) && Number(explicit) >= 0) {
        return Math.min(365, Number(explicit));
    }
    return 12;
}

/**
 * First matching experience tier (by years of service at reset date), or null.
 */
function getMatchingExperienceTier(settings, doj, resetDate) {
    const defaultCL = settings.annualCLReset.resetToBalance ?? 12;
    const tiers = settings.annualCLReset.casualLeaveByExperience;
    if (!Array.isArray(tiers) || tiers.length === 0) {
        return { tier: null, defaultCL };
    }
    const years = yearsOfExperience(doj, resetDate);
    const sorted = [...tiers].sort((a, b) => (a.minYears || 0) - (b.minYears || 0));
    for (const t of sorted) {
        const min = t.minYears ?? 0;
        const max = t.maxYears ?? 999;
        if (years >= min && years < max) {
            return { tier: t, defaultCL };
        }
    }
    return { tier: null, defaultCL };
}

/**
 * Nominal annual CL from policy (tier casualLeave or default), before join pro-rata.
 * Sum of monthly grid when configured, else tier.casualLeave / default.
 */
function getCasualLeaveEntitlement(settings, doj, resetDate) {
    const { tier, defaultCL } = getMatchingExperienceTier(settings, doj, resetDate);
    if (!tier) return defaultCL;
    const grid = leaveRegisterYearService.normalizeTierMonthlyCredits(tier, defaultCL);
    return grid.reduce((a, b) => a + b, 0);
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
            .select('_id emp_no employee_name department_id division_id doj is_active compensatoryOffs')
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
                        scheduledClSubtotal: resetResult.scheduledClSubtotal,
                        scheduledClTotal: resetResult.scheduledClTotal,
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
        if (addCarryForward) {
            const maxCarry = getMaxAnnualCarryForwardCl(settings);
            carryForwardAllowed = Math.min(currentBalance, maxCarry);
        }
        expiredAmount = Math.max(0, currentBalance - carryForwardAllowed);

        // 3. Expiry above carry cap is recorded in yearlyTransactions (new FY ledger starts from scheduled credits only).

        // 4. Monthly CL grid from tier (or default split), then join rule per pay period (default: full cell if > half cycle remains)
        const { tier, defaultCL } = getMatchingExperienceTier(settings, employee.doj, resetDate);
        const monthlyGrid = leaveRegisterYearService.normalizeTierMonthlyCredits(
            tier || { casualLeave: defaultCL },
            defaultCL
        );
        const { months } = await leaveRegisterYearService.buildYearMonthSlots(
            resetDate,
            monthlyGrid,
            employee.doj,
            {}
        );
        const scheduledClSubtotal = leaveRegisterYearService.sumScheduledCl(months);
        const nominalAnnual = getCasualLeaveEntitlement(settings, employee.doj, resetDate);

        // Carry forward is added to first payroll month of the leave year (alongside tier/pro-rata credit)
        if (carryForwardAllowed > 0 && months.length > 0) {
            months[0].clCredits = (Number(months[0].clCredits) || 0) + carryForwardAllowed;
        }
        const scheduledClTotal = leaveRegisterYearService.sumScheduledCl(months);
        const newBalance = scheduledClTotal;

        // 5–6. LeaveRegisterYear only: reset-slot audit (EXPIRY + zero pool), then one CL CREDIT per payroll
        // month (months[].clCredits from tier 12-cell grid + join rules; carry folded into period 1).
        // ADJUSTMENT 0 clears the running balance from prior FY so monthly CREDITs sum to newBalance.
        const monthsPayload = months.map((m) => ({
            ...m,
            transactions: [],
        }));

        const resetSlot =
            monthsPayload.find(
                (m) =>
                    resetDate >= new Date(m.payPeriodStart) &&
                    resetDate <= new Date(m.payPeriodEnd)
            ) || monthsPayload[0];

        const resetMs = new Date(resetDate).getTime();
        if (resetSlot) {
            if (!resetSlot.transactions) resetSlot.transactions = [];
            if (expiredAmount > 0) {
                const atEx = new Date(resetMs);
                resetSlot.transactions.push({
                    at: atEx,
                    leaveType: 'CL',
                    transactionType: 'EXPIRY',
                    days: expiredAmount,
                    openingBalance: 0,
                    closingBalance: 0,
                    startDate: atEx,
                    endDate: atEx,
                    reason: `Annual reset: CL above carry-forward cap (${expiredAmount} day(s) not carried)`,
                    status: 'APPROVED',
                    autoGenerated: true,
                    autoGeneratedType: 'ANNUAL_RESET_EXPIRY',
                });
            }
            const atZero = new Date(resetMs + 1);
            resetSlot.transactions.push({
                at: atZero,
                leaveType: 'CL',
                transactionType: 'ADJUSTMENT',
                days: 0,
                openingBalance: 0,
                closingBalance: 0,
                startDate: atZero,
                endDate: atZero,
                reason: `Annual reset: close prior CL pool; per-month CL credits follow (grid + join; carry in period 1 if any)`,
                status: 'APPROVED',
                autoGenerated: true,
                autoGeneratedType: 'ANNUAL_RESET_ZERO_POOL',
            });
        }

        leaveRegisterYearService.appendMonthlyClScheduledCreditTransactions(monthsPayload, {});

        // Year-level audit (not the movement ledger — that is months[].transactions only)
        const yearlyTransactions = [];
        if (expiredAmount > 0) {
            yearlyTransactions.push({
                at: resetDate,
                transactionKind: 'EXPIRY',
                leaveType: 'CL',
                days: expiredAmount,
                reason: 'Annual Reset: CL above carry-forward limit',
            });
        }
        if (carryForwardAllowed > 0) {
            yearlyTransactions.push({
                at: resetDate,
                transactionKind: 'CARRY_FORWARD',
                leaveType: 'CL',
                days: carryForwardAllowed,
                reason: `CL carry forward folded into first payroll month (${monthsPayload[0]?.label || 'period 1'})`,
                payrollMonthIndex: 1,
                payPeriodStart: monthsPayload[0]?.payPeriodStart,
                payPeriodEnd: monthsPayload[0]?.payPeriodEnd,
                meta: { foldedIntoMonthIndex: 1 },
            });
        }
        yearlyTransactions.push({
            at: resetDate,
            transactionKind: 'ADJUSTMENT',
            leaveType: 'CL',
            days: newBalance,
            reason: `Annual reset FY opening CL pool: ${newBalance} day(s) = sum of monthly scheduled credits (see months[].transactions MONTHLY_CL_SCHEDULE).`,
            meta: {
                yearlyPolicyClScheduledTotal: scheduledClTotal,
                scheduledClSubtotal,
                nominalAnnual,
                carryForwardAllowed,
                expiredAmount,
            },
        });

        const ccoBal = typeof employee.compensatoryOffs === 'number' ? employee.compensatoryOffs : 0;
        await leaveRegisterYearService.upsertLeaveRegisterYear({
            employeeId: employee._id,
            empNo: employee.emp_no,
            employeeName: employee.employee_name,
            resetDate,
            casualBalance: newBalance,
            compensatoryOffBalance: ccoBal,
            months: monthsPayload,
            yearlyTransactions,
            yearlyPolicyClScheduledTotal: scheduledClTotal,
            source: 'ANNUAL_RESET',
        });

        await leaveRegisterYearLedgerService.recalculateRegisterBalances(employee._id, 'CL', null);

        return {
            success: true,
            previousBalance: currentBalance,
            carryForwarded: carryForwardAllowed,
            expiredAmount,
            entitlement: nominalAnnual,
            scheduledClSubtotal,
            scheduledClTotal,
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
            carryForwardEnabled: settings.annualCLReset.addCarryForward !== false,
            carryForwardMax: getMaxAnnualCarryForwardCl(settings)
        }));

        return {
            success: true,
            data: results,
            settings: {
                enabled: settings.annualCLReset.enabled,
                usePayrollCycleForReset: settings.annualCLReset.usePayrollCycleForReset,
                resetMonth: settings.annualCLReset.resetMonth,
                resetDay: settings.annualCLReset.resetDay,
                carryForwardEnabled: settings.annualCLReset.addCarryForward !== false,
                carryForwardMax: getMaxAnnualCarryForwardCl(settings)
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
            .select('_id emp_no employee_name department_id division_id doj is_active compensatoryOffs')
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
                const syncResult = await syncEmployeeCLFromPolicy(employee, settings, effectiveDate, {});
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
 * Initial sync month grid: full FY from tier + join rules, then zero clCredits for payroll periods
 * already ended on or before effectiveDate (IST). Carry (LeaveRegisterYear ledger only) folds into
 * the first still-open period. Remaining months are credited in one go via MONTHLY_CL_SCHEDULE.
 *
 * @returns {Promise<object>}
 */
async function buildInitialSyncMonthsPayload(employee, settings, effectiveDate) {
    const ledgerCLBalance = await leaveRegisterYearLedgerService.getCurrentBalanceLedgerOnly(
        employee._id,
        'CL',
        effectiveDate
    );
    const addCarryForward = settings.annualCLReset?.addCarryForward !== false;
    const maxCarry = getMaxAnnualCarryForwardCl(settings);
    const carryForwardAllowed = addCarryForward
        ? Math.min(Math.max(0, Number(ledgerCLBalance) || 0), maxCarry)
        : 0;

    const init = await getInitialSyncEntitlement(settings, employee.doj, effectiveDate);
    let { entitlement, proration, months: rawMonths } = init;

    let months =
        Array.isArray(rawMonths) && rawMonths.length > 0
            ? rawMonths
            : (await (async () => {
                  const { tier, defaultCL } = getMatchingExperienceTier(settings, employee.doj, effectiveDate);
                  const monthlyGrid = leaveRegisterYearService.normalizeTierMonthlyCredits(
                      tier || { casualLeave: defaultCL },
                      defaultCL
                  );
                  const { months: m } = await leaveRegisterYearService.buildYearMonthSlots(
                      effectiveDate,
                      monthlyGrid,
                      employee.doj,
                      {}
                  );
                  return m;
              })());

    const originals = months.map((m) => Math.round((Number(m.clCredits) || 0) * 2) / 2);
    const fullYearGridSum = originals.reduce((a, b) => a + b, 0);

    const monthsPayload = months.map((m) => ({
        ...m,
        transactions: [],
    }));

    const monthlyBreakdown = [];
    let policyRemainingGridOnly = 0;

    for (let i = 0; i < monthsPayload.length; i++) {
        const m = monthsPayload[i];
        const orig = originals[i];
        let clearedPast = false;
        if (m.payPeriodEnd && leaveRegisterYearService.isPayrollPeriodEndedOnOrBeforeAsOf(m.payPeriodEnd, effectiveDate)) {
            m.clCredits = 0;
            clearedPast = true;
        }
        const afterZero = Math.round((Number(m.clCredits) || 0) * 2) / 2;
        policyRemainingGridOnly += afterZero;
        monthlyBreakdown.push({
            payrollMonthIndex: m.payrollMonthIndex,
            label: m.label || `Period ${m.payrollMonthIndex}`,
            payPeriodStart: m.payPeriodStart,
            payPeriodEnd: m.payPeriodEnd,
            policyCellOriginal: orig,
            clearedPast,
            carryAddedHere: 0,
            clCreditsApplied: afterZero,
        });
    }

    let firstOpenIndex = monthsPayload.findIndex((m) => {
        if (!m.payPeriodEnd) return true;
        return !leaveRegisterYearService.isPayrollPeriodEndedOnOrBeforeAsOf(m.payPeriodEnd, effectiveDate);
    });
    if (firstOpenIndex < 0) firstOpenIndex = 0;

    if (carryForwardAllowed > 0) {
        const base = Math.round((Number(monthsPayload[firstOpenIndex].clCredits) || 0) * 2) / 2;
        monthsPayload[firstOpenIndex].clCredits = Math.round((base + carryForwardAllowed) * 2) / 2;
        if (monthlyBreakdown[firstOpenIndex]) {
            monthlyBreakdown[firstOpenIndex].carryAddedHere = carryForwardAllowed;
            monthlyBreakdown[firstOpenIndex].clCreditsApplied = monthsPayload[firstOpenIndex].clCredits;
        }
    }

    const defaultPoolBalance = leaveRegisterYearService.sumScheduledCl(monthsPayload);
    const pastClearedCreditsTotal = Math.round((fullYearGridSum - policyRemainingGridOnly) * 2) / 2;

    return {
        monthsPayload,
        monthlyBreakdown,
        entitlement,
        proration,
        ledgerCLBalance,
        carryForwardAllowed,
        fullYearGridSum,
        policyRemainingGridOnly,
        pastClearedCreditsTotal,
        defaultPoolBalance,
        firstOpenIndex,
    };
}

function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

function round1(n) {
    return Math.round((Number(n) || 0) * 10) / 10;
}

function toDateOnlyKey(d) {
    const x = new Date(d);
    return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
}

function dayStartUTC(d) {
    const x = new Date(d);
    return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate(), 0, 0, 0, 0));
}

function overlapDaysInclusiveUTC(aStart, aEnd, bStart, bEnd) {
    const s = Math.max(dayStartUTC(aStart).getTime(), dayStartUTC(bStart).getTime());
    const e = Math.min(dayStartUTC(aEnd).getTime(), dayStartUTC(bEnd).getTime());
    if (e < s) return 0;
    return Math.floor((e - s) / 86400000) + 1;
}

function istDateKey(d) {
    return extractISTComponents(d).dateStr;
}

function overlapDaysInclusiveIST(aStart, aEnd, bStart, bEnd) {
    const aS = istDateKey(aStart);
    const aE = istDateKey(aEnd);
    const bS = istDateKey(bStart);
    const bE = istDateKey(bEnd);
    const s = aS > bS ? aS : bS;
    const e = aE < bE ? aE : bE;
    if (e < s) return 0;
    const sd = createISTDate(s);
    const ed = createISTDate(e);
    return Math.floor((ed.getTime() - sd.getTime()) / 86400000) + 1;
}

function normalizedDays(n, isHalfDay = false) {
    const v = Number(n);
    if (Number.isFinite(v) && v > 0) return v;
    return isHalfDay ? 0.5 : 1;
}

async function buildLeaveTypeDaysBySlot({ employeeId, monthsPayload, leaveType, statuses }) {
    const lt = String(leaveType || '').toUpperCase();
    if (!employeeId || !Array.isArray(monthsPayload) || monthsPayload.length === 0) return new Map();

    const out = new Map();
    for (let i = 0; i < monthsPayload.length; i++) {
        const slot = monthsPayload[i];
        const slotStart = slot?.payPeriodStart ? new Date(slot.payPeriodStart) : null;
        const slotEnd = slot?.payPeriodEnd ? new Date(slot.payPeriodEnd) : null;
        if (!slotStart || !slotEnd) continue;

        // Keep initial-sync fetch pattern aligned with attendance summary:
        // query leaves by resolved pay-period window for each slot.
        const leaves = await Leave.find({
            employeeId,
            isActive: { $ne: false },
            status: statuses,
            leaveType: new RegExp(`^${lt}$`, 'i'),
            fromDate: { $lte: slotEnd },
            toDate: { $gte: slotStart },
        })
            .select('_id fromDate toDate numberOfDays leaveType status splitStatus')
            .lean();

        const splitLeaveIds = leaves
            .filter((lv) => String(lv?.splitStatus || '').toLowerCase() === 'split_approved' && lv?._id)
            .map((lv) => lv._id);
        const splits = splitLeaveIds.length
            ? await LeaveSplit.find({
                  leaveId: { $in: splitLeaveIds },
                  status: 'approved',
                  leaveType: new RegExp(`^${lt}$`, 'i'),
                  date: { $gte: slotStart, $lte: slotEnd },
              })
                  .select('leaveId date numberOfDays isHalfDay')
                  .lean()
            : [];
        const splitsByLeave = new Map();
        for (const s of splits) {
            const key = String(s.leaveId);
            const arr = splitsByLeave.get(key) || [];
            arr.push(s);
            splitsByLeave.set(key, arr);
        }

        let days = 0;
        const perDayContrib = new Map();
        const slotStartKey = istDateKey(slotStart);
        const slotEndKey = istDateKey(slotEnd);
        for (const lv of leaves) {
            const splitRows = splitsByLeave.get(String(lv?._id)) || [];
            const isSplitApproved = String(lv?.splitStatus || '').toLowerCase() === 'split_approved';
            if (splitRows.length > 0) {
                for (const sp of splitRows) {
                    const dk = istDateKey(sp.date);
                    if (dk < slotStartKey || dk > slotEndKey) continue;
                    const prev = Number(perDayContrib.get(dk) || 0);
                    const next = Math.min(1, round2(prev + normalizedDays(sp.numberOfDays, !!sp.isHalfDay)));
                    perDayContrib.set(dk, next);
                }
                continue;
            }
            if (isSplitApproved) {
                // For split-approved leave, split rows are source of truth.
                // If no matching split rows for this leave-type in this slot, do not fallback to parent leave row.
                continue;
            }

            const from = new Date(lv.fromDate);
            const to = new Date(lv.toDate);
            const overlapDays = overlapDaysInclusiveIST(from, to, slotStart, slotEnd);
            if (overlapDays <= 0) continue;
            const leaveSpanDays = Math.max(1, overlapDaysInclusiveIST(from, to, from, to));
            const leaveDays = Number(lv.numberOfDays) || 0;
            if (leaveDays <= 0) continue;
            days += round2((leaveDays * overlapDays) / leaveSpanDays);
        }
        if (perDayContrib.size > 0) {
            for (const v of perDayContrib.values()) days += Number(v) || 0;
        }

        if (days > 0) {
            // Keep same unit feel as attendance summary aggregates (0.1 precision).
            out.set(i, round1(days));
        }
    }
    return out;
}

function sumClDebitsExcludingCarry(slot) {
    return round2(
        (slot?.transactions || [])
            .filter(
                (t) =>
                    String(t?.leaveType || '').toUpperCase() === 'CL' &&
                    String(t?.transactionType || '').toUpperCase() === 'DEBIT' &&
                    !String(t?.autoGeneratedType || '').startsWith('MONTHLY_POOL_TRANSFER_OUT_')
            )
            .reduce((s, t) => s + (Number(t?.days) || 0), 0)
    );
}

function sumDebitsExcludingCarry(slot, leaveType) {
    const lt = String(leaveType || '').toUpperCase();
    return round2(
        (slot?.transactions || [])
            .filter(
                (t) =>
                    String(t?.leaveType || '').toUpperCase() === lt &&
                    String(t?.transactionType || '').toUpperCase() === 'DEBIT' &&
                    !String(t?.autoGeneratedType || '').startsWith('MONTHLY_POOL_TRANSFER_OUT_')
            )
            .reduce((s, t) => s + (Number(t?.days) || 0), 0)
    );
}

async function appendApprovedClUsageDebits({ employeeId, monthsPayload }) {
    if (!employeeId || !Array.isArray(monthsPayload) || monthsPayload.length === 0) return 0;
    const fyStart = monthsPayload[0]?.payPeriodStart || monthsPayload[0]?.payPeriodEnd;
    const fyEnd = monthsPayload[monthsPayload.length - 1]?.payPeriodEnd || monthsPayload[monthsPayload.length - 1]?.payPeriodStart;
    if (!fyStart || !fyEnd) return 0;

    const approvedLeaves = await Leave.find({
        employeeId,
        isActive: { $ne: false },
        status: 'approved',
        leaveType: /^CL$/i,
        splitStatus: { $nin: ['pending_split'] },
        fromDate: { $lte: fyEnd },
        toDate: { $gte: fyStart },
    })
        .select('fromDate toDate numberOfDays leaveType status splitStatus')
        .lean();

    let inserted = 0;
    for (const slot of monthsPayload) {
        if (!Array.isArray(slot.transactions)) slot.transactions = [];
        const slotStart = slot.payPeriodStart ? new Date(slot.payPeriodStart) : null;
        const slotEnd = slot.payPeriodEnd ? new Date(slot.payPeriodEnd) : null;
        if (!slotStart || !slotEnd) continue;

        for (const lv of approvedLeaves) {
            const from = new Date(lv.fromDate);
            const to = new Date(lv.toDate);
            const overlapDays = overlapDaysInclusiveUTC(from, to, slotStart, slotEnd);
            if (overlapDays <= 0) continue;

            const leaveSpanDays = Math.max(1, overlapDaysInclusiveUTC(from, to, from, to));
            const leaveDays = Number(lv.numberOfDays) || 0;
            if (leaveDays <= 0) continue;
            const debitDays = round2((leaveDays * overlapDays) / leaveSpanDays);
            if (debitDays <= 0) continue;

            const debitStart = new Date(Math.max(dayStartUTC(from).getTime(), dayStartUTC(slotStart).getTime()));
            const debitEnd = new Date(Math.min(dayStartUTC(to).getTime(), dayStartUTC(slotEnd).getTime()));
            slot.transactions.push({
                at: new Date(),
                leaveType: 'CL',
                transactionType: 'DEBIT',
                days: debitDays,
                openingBalance: 0,
                closingBalance: 0,
                startDate: debitStart,
                endDate: debitEnd,
                reason: `Initial sync: approved CL leave used (${debitDays} day(s)) for ${toDateOnlyKey(debitStart)} to ${toDateOnlyKey(debitEnd)}`,
                status: 'APPROVED',
                autoGenerated: true,
                autoGeneratedType: 'INITIAL_SYNC_APPROVED_CL_USED',
            });
            inserted++;
        }
    }
    return inserted;
}

async function appendApprovedUsageDebitsForType({ employeeId, monthsPayload, leaveType }) {
    const lt = String(leaveType || '').toUpperCase();
    if (!employeeId || !Array.isArray(monthsPayload) || monthsPayload.length === 0) return 0;
    if (!['CL', 'CCL', 'EL'].includes(lt)) return 0;
    const daysBySlot = await buildLeaveTypeDaysBySlot({
        employeeId,
        monthsPayload,
        leaveType: lt,
        statuses: 'approved',
    });

    let inserted = 0;
    for (let i = 0; i < monthsPayload.length; i++) {
        const slot = monthsPayload[i];
        if (!Array.isArray(slot.transactions)) slot.transactions = [];
        const slotStart = slot.payPeriodStart ? new Date(slot.payPeriodStart) : null;
        const slotEnd = slot.payPeriodEnd ? new Date(slot.payPeriodEnd) : null;
        if (!slotStart || !slotEnd) continue;
        const debitDays = round1(Number(daysBySlot.get(i) || 0));
        if (debitDays <= 0) continue;

        const debitStart = createISTDate(istDateKey(slotStart), '00:00');
        const debitEnd = createISTDate(istDateKey(slotEnd), '00:00');
        slot.transactions.push({
            at: new Date(),
            leaveType: lt,
            transactionType: 'DEBIT',
            days: debitDays,
            openingBalance: 0,
            closingBalance: 0,
            startDate: debitStart,
            endDate: debitEnd,
            reason: `Initial sync: approved ${lt} leave used (${debitDays} day(s)) for ${toDateOnlyKey(debitStart)} to ${toDateOnlyKey(debitEnd)}`,
            status: 'APPROVED',
            autoGenerated: true,
            autoGeneratedType: `INITIAL_SYNC_APPROVED_${lt}_USED`,
        });
        inserted++;
    }
    return inserted;
}

async function applyLockedClCreditsFromInFlightLeaves({ employeeId, monthsPayload }) {
    if (!employeeId || !Array.isArray(monthsPayload) || monthsPayload.length === 0) return 0;
    const fyStart = monthsPayload[0]?.payPeriodStart || monthsPayload[0]?.payPeriodEnd;
    const fyEnd = monthsPayload[monthsPayload.length - 1]?.payPeriodEnd || monthsPayload[monthsPayload.length - 1]?.payPeriodStart;
    if (!fyStart || !fyEnd) return 0;

    const lockedBySlot = await buildLeaveTypeDaysBySlot({
        employeeId,
        monthsPayload,
        leaveType: 'CL',
        statuses: { $in: PENDING_PIPELINE_STATUSES || [] },
    });

    let updatedSlots = 0;
    for (let i = 0; i < monthsPayload.length; i++) {
        const slot = monthsPayload[i];
        const lockedRounded = round1(Number(lockedBySlot.get(i) || 0));
        if (lockedRounded > 0) updatedSlots++;
        slot.lockedCredits = lockedRounded;
    }
    return updatedSlots;
}

async function applyCclCreditsFromApprovedOd({ employeeId, monthsPayload }) {
    if (!employeeId || !Array.isArray(monthsPayload) || monthsPayload.length === 0) return 0;
    const fyStart = monthsPayload[0]?.payPeriodStart || monthsPayload[0]?.payPeriodEnd;
    const fyEnd = monthsPayload[monthsPayload.length - 1]?.payPeriodEnd || monthsPayload[monthsPayload.length - 1]?.payPeriodStart;
    if (!fyStart || !fyEnd) return 0;

    const approvedCO = await OD.find({
        employeeId,
        isActive: { $ne: false },
        status: 'approved',
        isCOEligible: true,
        fromDate: { $lte: fyEnd },
        toDate: { $gte: fyStart },
    })
        .select('fromDate toDate numberOfDays')
        .lean();

    let creditsPosted = 0;
    for (const slot of monthsPayload) {
        if (!Array.isArray(slot.transactions)) slot.transactions = [];
        const slotStart = slot.payPeriodStart ? new Date(slot.payPeriodStart) : null;
        const slotEnd = slot.payPeriodEnd ? new Date(slot.payPeriodEnd) : null;
        if (!slotStart || !slotEnd) continue;

        let slotCredit = 0;
        for (const od of approvedCO) {
            const from = new Date(od.fromDate);
            const to = new Date(od.toDate);
            const overlapDays = overlapDaysInclusiveUTC(from, to, slotStart, slotEnd);
            if (overlapDays <= 0) continue;
            const spanDays = Math.max(1, overlapDaysInclusiveUTC(from, to, from, to));
            const days = Number(od.numberOfDays) || 0;
            if (days <= 0) continue;
            slotCredit += round2((days * overlapDays) / spanDays);
        }
        slotCredit = round2(slotCredit);
        if (slotCredit <= 0) continue;

        slot.compensatoryOffs = round2((Number(slot.compensatoryOffs) || 0) + slotCredit);
        const creditAt = slot.payPeriodEnd ? new Date(slot.payPeriodEnd) : slot.payPeriodStart ? new Date(slot.payPeriodStart) : new Date();
        slot.transactions.push({
            at: new Date(),
            leaveType: 'CCL',
            transactionType: 'CREDIT',
            days: slotCredit,
            openingBalance: 0,
            closingBalance: 0,
            startDate: creditAt,
            endDate: creditAt,
            reason: `Initial sync: approved CO-eligible OD credited to CCL (${slotCredit} day(s))`,
            status: 'APPROVED',
            autoGenerated: true,
            autoGeneratedType: 'INITIAL_SYNC_OD_CCL_CREDIT',
        });
        creditsPosted++;
    }
    return creditsPosted;
}

/**
 * Move unused scheduled pool (CL/CCL/EL) from month i → i+1. Only for payroll months that have
 * **ended on or before asOf** (IST). Future months would otherwise show the whole cell as "unused"
 * and cascade carry + MONTHLY_POOL_TRANSFER_IN credits into every later month after policy apply.
 * @param {Date|string} effectiveDate — same as policy sync effective date (typically today IST).
 */
function applyCarryForwardAcrossMonths(monthsPayload, effectiveDate) {
    if (!Array.isArray(monthsPayload) || monthsPayload.length < 2) return 0;
    const asOf = effectiveDate != null ? new Date(effectiveDate) : new Date();
    let transferCount = 0;
    for (let i = 0; i < monthsPayload.length - 1; i++) {
        const cur = monthsPayload[i];
        const next = monthsPayload[i + 1];
        if (!cur.payPeriodEnd) continue;
        if (!leaveRegisterYearService.isPayrollPeriodEndedOnOrBeforeAsOf(cur.payPeriodEnd, asOf)) {
            continue;
        }
        if (!Array.isArray(cur.transactions)) cur.transactions = [];
        if (!Array.isArray(next.transactions)) next.transactions = [];
        const clUsed = sumDebitsExcludingCarry(cur, 'CL');
        const clLocked = round2(Number(cur.lockedCredits) || 0);
        const clCarry = Math.max(0, round2((Number(cur.clCredits) || 0) - clUsed - clLocked));
        const cclCarry = Math.max(0, round2((Number(cur.compensatoryOffs) || 0) - sumDebitsExcludingCarry(cur, 'CCL')));
        const elCarry = Math.max(0, round2((Number(cur.elCredits) || 0) - sumDebitsExcludingCarry(cur, 'EL')));
        if (clCarry <= 0 && cclCarry <= 0 && elCarry <= 0) continue;

        cur.poolCarryForwardOut = { ...(cur.poolCarryForwardOut || {}), cl: clCarry, ccl: cclCarry, el: elCarry };
        cur.poolCarryForwardOutAt = new Date();
        next.clCredits = round2((Number(next.clCredits) || 0) + clCarry);
        next.compensatoryOffs = round2((Number(next.compensatoryOffs) || 0) + cclCarry);
        next.elCredits = round2((Number(next.elCredits) || 0) + elCarry);
        next.poolCarryForwardIn = {
            ...(next.poolCarryForwardIn || {}),
            cl: round2((Number(next.poolCarryForwardIn?.cl) || 0) + clCarry),
            ccl: round2((Number(next.poolCarryForwardIn?.ccl) || 0) + cclCarry),
            el: round2((Number(next.poolCarryForwardIn?.el) || 0) + elCarry),
        };
        next.poolCarryForwardFromLabel = cur.label || `${cur.payrollCycleMonth}/${cur.payrollCycleYear || ''}`.trim();

        const debitAt = cur.payPeriodEnd ? new Date(cur.payPeriodEnd) : cur.payPeriodStart ? new Date(cur.payPeriodStart) : new Date();
        const creditAt = next.payPeriodEnd ? new Date(next.payPeriodEnd) : next.payPeriodStart ? new Date(next.payPeriodStart) : new Date();
        const pushCarry = (leaveType, days, outType, inType) => {
            if (days <= 0) return;
            cur.transactions.push({
                at: new Date(),
                leaveType,
                transactionType: 'DEBIT',
                days,
                openingBalance: 0,
                closingBalance: 0,
                startDate: debitAt,
                endDate: debitAt,
                reason: `Transfer unused ${leaveType} to next month (${cur.payrollCycleMonth}/${cur.payrollCycleYear} -> ${next.payrollCycleMonth}/${next.payrollCycleYear})`,
                status: 'APPROVED',
                autoGenerated: true,
                autoGeneratedType: outType,
            });
            next.transactions.push({
                at: new Date(),
                leaveType,
                transactionType: 'CREDIT',
                days,
                openingBalance: 0,
                closingBalance: 0,
                startDate: creditAt,
                endDate: creditAt,
                reason: `Transfer unused ${leaveType} from previous month (${cur.payrollCycleMonth}/${cur.payrollCycleYear} -> ${next.payrollCycleMonth}/${next.payrollCycleYear})`,
                status: 'APPROVED',
                autoGenerated: true,
                autoGeneratedType: inType,
            });
        };
        pushCarry('CL', clCarry, 'MONTHLY_POOL_TRANSFER_OUT_CL', 'MONTHLY_POOL_TRANSFER_IN_CL');
        pushCarry('CCL', cclCarry, 'MONTHLY_POOL_TRANSFER_OUT_CCL', 'MONTHLY_POOL_TRANSFER_IN_CCL');
        pushCarry('EL', elCarry, 'MONTHLY_POOL_TRANSFER_OUT_EL', 'MONTHLY_POOL_TRANSFER_IN_EL');
        transferCount++;
    }
    return transferCount;
}

/**
 * Set one employee's CL from policy: LeaveRegisterYear only (ledger CL for carry).
 * Past payroll periods (ended on/before effectiveDate, IST) get clCredits 0; remaining months
 * receive MONTHLY_CL_SCHEDULE credits in one go. Carry folds into first open period.
 * @param {object} [options]
 * @param {number|null|undefined} [options.targetCL] — if set (e.g. from preview review), applied CL balance; else default pool.
 */
async function syncEmployeeCLFromPolicy(employee, settings, effectiveDate, options = {}) {
    try {
        const targetCLOverride = options.targetCL;
        const creditAllPayrollMonths = options.creditAllPayrollMonths === true;
        const includeApprovedClUsageDebits = options.includeApprovedClUsageDebits === true;
        const carryUnusedClToNextMonth = options.carryUnusedClToNextMonth === true;
        const disableInitialLedgerCarryForward = options.disableInitialLedgerCarryForward === true;
        const empNo = employee?.emp_no || employee?._id || 'unknown';
        console.log(
            `[LeaveSync] Start syncEmployeeCLFromPolicy emp=${empNo} effectiveDate=${new Date(effectiveDate).toISOString()}`
        );

        const built = await buildInitialSyncMonthsPayload(employee, settings, effectiveDate);
        const {
            monthsPayload: builtMonthsPayload,
            entitlement,
            proration,
            ledgerCLBalance,
            carryForwardAllowed,
            fullYearGridSum,
            policyRemainingGridOnly,
            pastClearedCreditsTotal,
            defaultPoolBalance,
            firstOpenIndex,
            monthlyBreakdown,
        } = built;
        const effectiveCarryForwardAllowed = disableInitialLedgerCarryForward ? 0 : carryForwardAllowed;
        const monthsPayload = (builtMonthsPayload || []).map((m) => ({ ...m, transactions: [...(m.transactions || [])] }));

        // Settings apply mode: credit all payroll months, do not zero past periods.
        if (creditAllPayrollMonths && Array.isArray(monthlyBreakdown)) {
            for (let i = 0; i < monthsPayload.length; i++) {
                const orig = Number(monthlyBreakdown[i]?.policyCellOriginal || 0);
                if (Number.isFinite(orig)) monthsPayload[i].clCredits = round2(orig);
            }
            if (effectiveCarryForwardAllowed > 0 && monthsPayload.length > 0) {
                const base = round2(Number(monthsPayload[0].clCredits) || 0);
                monthsPayload[0].clCredits = round2(base + effectiveCarryForwardAllowed);
            }
        }

        const newBalance =
            targetCLOverride != null &&
            targetCLOverride !== '' &&
            Number.isFinite(Number(targetCLOverride))
                ? Math.max(0, Number(targetCLOverride))
                : defaultPoolBalance;

        const yearlyTransactions = [];
        if (effectiveCarryForwardAllowed > 0 && monthsPayload.length > 0) {
            const fold = monthsPayload[firstOpenIndex] || monthsPayload[0];
            yearlyTransactions.push({
                at: effectiveDate,
                transactionKind: 'CARRY_FORWARD',
                leaveType: 'CL',
                days: effectiveCarryForwardAllowed,
                reason: `Initial sync: carry folded into first open payroll month (${fold?.label || 'period'})`,
                payrollMonthIndex: fold?.payrollMonthIndex,
                payPeriodStart: fold?.payPeriodStart,
                payPeriodEnd: fold?.payPeriodEnd,
                meta: { foldedIntoPayrollMonthIndex: fold?.payrollMonthIndex, firstOpenIndex },
            });
        }
        yearlyTransactions.push({
            at: effectiveDate,
            transactionKind: 'ADJUSTMENT',
            leaveType: 'CL',
            days: newBalance,
            reason: `Initial policy sync: pool ${newBalance} (remaining FY grid ${policyRemainingGridOnly} + carry ${effectiveCarryForwardAllowed}; full grid before past-zero ${fullYearGridSum}; past slots cleared ${pastClearedCreditsTotal})${targetCLOverride != null ? '; review override' : ''}`,
            meta: {
                fullYearGridSum,
                policyRemainingGridOnly,
                pastClearedCreditsTotal,
                carryForwardAllowed: effectiveCarryForwardAllowed,
            },
        });

        leaveRegisterYearService.appendMonthlyClScheduledCreditTransactions(monthsPayload, {});
        let approvedUsageDebitCount = 0;
        if (includeApprovedClUsageDebits) {
            const clUsed = await appendApprovedUsageDebitsForType({ employeeId: employee._id, monthsPayload, leaveType: 'CL' });
            const cclUsed = await appendApprovedUsageDebitsForType({ employeeId: employee._id, monthsPayload, leaveType: 'CCL' });
            const elUsed = await appendApprovedUsageDebitsForType({ employeeId: employee._id, monthsPayload, leaveType: 'EL' });
            approvedUsageDebitCount = clUsed + cclUsed + elUsed;
        }
        const cclCreditsFromOD = await applyCclCreditsFromApprovedOd({ employeeId: employee._id, monthsPayload });
        const lockedSlotsUpdated = await applyLockedClCreditsFromInFlightLeaves({
            employeeId: employee._id,
            monthsPayload,
        });
        let carryTransfersCreated = 0;
        if (carryUnusedClToNextMonth) {
            carryTransfersCreated = applyCarryForwardAcrossMonths(monthsPayload, effectiveDate);
        }

        const syncSlot =
            monthsPayload.find(
                (m) =>
                    effectiveDate >= new Date(m.payPeriodStart) &&
                    effectiveDate <= new Date(m.payPeriodEnd)
            ) || monthsPayload[0];
        const zeroedPastPeriods = (monthsPayload || []).filter((m) => Number(m?.clCredits || 0) <= 0).length;

        const diff = Math.round((newBalance - defaultPoolBalance) * 100) / 100;
        if (syncSlot && Math.abs(diff) > 0.001) {
            if (!syncSlot.transactions) syncSlot.transactions = [];
            const at = new Date(effectiveDate);
            if (diff > 0) {
                syncSlot.transactions.push({
                    at,
                    leaveType: 'CL',
                    transactionType: 'CREDIT',
                    days: diff,
                    openingBalance: 0,
                    closingBalance: 0,
                    startDate: at,
                    endDate: at,
                    reason: `Initial sync: extra ${diff} day(s) vs policy schedule (reviewed target)`,
                    status: 'APPROVED',
                    autoGenerated: true,
                    autoGeneratedType: 'INITIAL_SYNC_DELTA',
                });
            } else {
                syncSlot.transactions.push({
                    at,
                    leaveType: 'CL',
                    transactionType: 'EXPIRY',
                    days: Math.abs(diff),
                    openingBalance: 0,
                    closingBalance: 0,
                    startDate: at,
                    endDate: at,
                    reason: `Initial sync: reduce ${Math.abs(diff)} day(s) vs policy schedule (reviewed target)`,
                    status: 'APPROVED',
                    autoGenerated: true,
                    autoGeneratedType: 'INITIAL_SYNC_DELTA',
                });
            }
        }

        const ccoBal = typeof employee.compensatoryOffs === 'number' ? employee.compensatoryOffs : 0;
        await leaveRegisterYearService.upsertLeaveRegisterYear({
            employeeId: employee._id,
            empNo: employee.emp_no,
            employeeName: employee.employee_name,
            resetDate: effectiveDate,
            casualBalance: newBalance,
            compensatoryOffBalance: ccoBal,
            months: monthsPayload,
            yearlyTransactions,
            yearlyPolicyClScheduledTotal: defaultPoolBalance,
            source: 'INITIAL_POLICY_SYNC',
        });

        await leaveRegisterYearLedgerService.recalculateRegisterBalances(employee._id, 'CL', null);
        console.log(
            `[LeaveSync] Completed emp=${empNo} pool=${newBalance} defaultPool=${defaultPoolBalance} pastCleared=${pastClearedCreditsTotal} zeroedPeriods=${zeroedPastPeriods} syncPeriod=${syncSlot?.label || 'n/a'} approvedUsageDebits=${approvedUsageDebitCount} cclCreditsFromOD=${cclCreditsFromOD} lockedSlots=${lockedSlotsUpdated} carryTransfers=${carryTransfersCreated}`
        );

        return {
            success: true,
            previousBalance: ledgerCLBalance,
            entitlement,
            proration,
            carryForwarded: effectiveCarryForwardAllowed,
            newBalance,
            fullYearGridSum,
            policyRemainingGridOnly,
            pastClearedCreditsTotal,
            zeroedPastPeriods,
            syncPeriodLabel: syncSlot?.label || null,
            approvedUsageDebitCount,
            cclCreditsFromOD,
            lockedSlotsUpdated,
            carryTransfersCreated,
            defaultPoolBalance,
            /** @deprecated use defaultPoolBalance */
            policyOpening: defaultPoolBalance,
        };
    } catch (error) {
        console.error('[LeaveSync] syncEmployeeCLFromPolicy failed:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Initial-sync CL entitlement from the same source as LeaveRegisterYear: 12 payroll slots × tier monthlyClCredits,
 * Join mid-cycle: default majority_full (full cell if more than half the pay period remains from DOJ). Missing DOJ → full grid sum for the FY.
 */
async function getInitialSyncEntitlement(settings, doj, effectiveDate) {
    const { tier, defaultCL } = getMatchingExperienceTier(settings, doj || effectiveDate, effectiveDate);
    const monthlyGrid = leaveRegisterYearService.normalizeTierMonthlyCredits(
        tier || { casualLeave: defaultCL },
        defaultCL
    );
    const fullEntitlement = monthlyGrid.reduce((a, b) => a + Number(b || 0), 0);

    if (!doj) {
        const { months, fy } = await leaveRegisterYearService.buildYearMonthSlots(
            effectiveDate,
            monthlyGrid,
            null,
            {}
        );
        const sum = leaveRegisterYearService.sumScheduledCl(months);
        const entitlement = Math.round(sum * 2) / 2;
        return {
            entitlement,
            months,
            financialYear: fy?.name,
            proration: {
                applied: false,
                reason: 'missing_doj',
                fullEntitlement,
                method: 'policy_monthly_grid_sum',
            },
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
            months: [],
            financialYear: fy.name,
            proration: {
                applied: true,
                reason: 'joined_after_fy_end',
                fullEntitlement,
                method: 'policy_monthly_grid_sum',
            },
        };
    }

    const { months, fy: fyResolved } = await leaveRegisterYearService.buildYearMonthSlots(
        effectiveDate,
        monthlyGrid,
        doj,
        {}
    );
    const sum = leaveRegisterYearService.sumScheduledCl(months);
    const entitlement = Math.round(sum * 2) / 2;

    const joinedBeforeOrOnFyStart = dojYmd <= fyStartYmd;
    const creditedSlots = months.filter((m) => (Number(m.clCredits) || 0) > 0).length;

    return {
        entitlement,
        months,
        financialYear: fyResolved?.name || fy.name,
        proration: {
            applied: !joinedBeforeOrOnFyStart,
            reason: joinedBeforeOrOnFyStart ? 'joined_before_fy_start' : 'joined_within_fy',
            fullEntitlement,
            method: 'policy_monthly_grid_per_payroll_cycle',
            joinCycleRuleDefault: 'majority_full',
            creditedPayrollSlots: creditedSlots,
            scheduledClSubtotal: sum,
        },
    };
}

module.exports = {
    performAnnualCLReset,
    performInitialCLSync,
    syncEmployeeCLFromPolicy,
    buildInitialSyncMonthsPayload,
    getInitialSyncEntitlement,
    getCLResetStatus,
    getNextResetDate,
    getResetDate,
    getMatchingExperienceTier,
    getCasualLeaveEntitlement,
    getMaxAnnualCarryForwardCl
};
