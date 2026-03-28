/**
 * Annual CL Reset Controller
 * Manages annual casual leave balance reset operations
 */

const {
    performAnnualCLReset,
    performInitialCLSync,
    syncEmployeeCLFromPolicy,
    buildInitialSyncMonthsPayload,
    getCLResetStatus,
    getNextResetDate,
    getMaxAnnualCarryForwardCl,
} = require('../services/annualCLResetService');
const { createISTDate, getTodayISTDateString, extractISTComponents } = require('../../shared/utils/dateUtils');
const LeavePolicySettings = require('../../settings/model/LeavePolicySettings');
const Employee = require('../../employees/model/Employee');
const leaveRegisterService = require('../services/leaveRegisterService');
const leaveRegisterYearService = require('../services/leaveRegisterYearService');

function yearsOfExperience(doj, asOfDate) {
    if (!doj) return 0;
    const s = extractISTComponents(doj);
    const e = extractISTComponents(asOfDate);
    if (e.dateStr < s.dateStr) return 0;
    const years = (e.year - s.year) + ((e.month - s.month) * 12 + (e.day - s.day)) / 365.25;
    return Math.floor(years);
}

function getEntitlementByPolicy(settings, doj, asOfDate = new Date()) {
    const defaultCL = settings?.annualCLReset?.resetToBalance ?? 12;
    const tiers = settings?.annualCLReset?.casualLeaveByExperience;
    if (!doj || !Array.isArray(tiers) || tiers.length === 0) return defaultCL;
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
 * @desc    Perform annual CL reset for all employees
 * @route   POST /api/leaves/annual-reset
 * @access  Private (HR, Admin only)
 */
exports.performAnnualReset = async (req, res) => {
    try {
        const { targetYear, confirmReset } = req.body;
        
        // Get current settings to show what will be reset
        const settings = await LeavePolicySettings.getSettings();
        
        if (!settings.annualCLReset.enabled) {
            return res.status(400).json({
                success: false,
                message: 'Annual CL reset is disabled in settings'
            });
        }

        // Require confirmation for production safety
        if (!confirmReset) {
            const resetDate = await getNextResetDate(settings);
            return res.status(400).json({
                success: false,
                message: 'Please confirm the reset operation by setting confirmReset=true',
                preview: {
                    resetToBalance: settings.annualCLReset.resetToBalance,
                    addCarryForward: settings.annualCLReset.addCarryForward,
                    resetDate,
                    affectedEmployees: 'All active employees'
                }
            });
        }

        const result = await performAnnualCLReset(targetYear);
        
        res.status(200).json({
            success: result.success,
            message: result.message,
            data: result
        });

    } catch (error) {
        console.error('Error performing annual CL reset:', error);
        res.status(500).json({
            success: false,
            message: 'Error performing annual CL reset',
            error: error.message
        });
    }
};

/**
 * @desc    Preview initial CL sync for all employees (shows what would happen without making changes)
 * @route   GET /api/leaves/initial-cl-sync/preview
 * @access  Private (HR, Admin only)
 */
exports.previewInitialCLSync = async (req, res) => {
    try {
        const { search = '', departmentId, divisionId, page = 1, limit = 200 } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(1000, Math.max(1, parseInt(limit, 10) || 200));
        const settings = await LeavePolicySettings.getSettings();

        const query = { is_active: true };
        if (departmentId) query.department_id = departmentId;
        if (divisionId) query.division_id = divisionId;

        const employees = await Employee.find(query)
            .select('_id emp_no employee_name designation department_id division_id doj is_active')
            .populate('department_id', 'name')
            .populate('division_id', 'name')
            .sort({ employee_name: 1 })
            .lean();

        const term = String(search || '').trim().toLowerCase();
        const filtered = term
            ? employees.filter((emp) =>
                (emp.employee_name || '').toLowerCase().includes(term) ||
                (emp.emp_no || '').toLowerCase().includes(term) ||
                (emp.designation || '').toLowerCase().includes(term)
            )
            : employees;

        const start = (pageNum - 1) * limitNum;
        const pageRows = filtered.slice(start, start + limitNum);

        const maxCarryCap = getMaxAnnualCarryForwardCl(settings);
        const addCarryForward = settings?.annualCLReset?.addCarryForward !== false;
        const effectiveDate = createISTDate(getTodayISTDateString());

        const previewRows = [];
        for (const emp of pageRows) {
            const built = await buildInitialSyncMonthsPayload(emp, settings, effectiveDate);
            const currentCL = Number(built.ledgerCLBalance || 0);
            const currentEL = await leaveRegisterService.getCurrentBalance(emp._id, 'EL');
            const currentCCL = await leaveRegisterService.getCurrentBalance(emp._id, 'CCL');

            const targetCL = Math.max(0, Number(built.defaultPoolBalance) || 0);

            previewRows.push({
                employeeId: emp._id,
                empNo: emp.emp_no,
                employeeName: emp.employee_name,
                designation: emp.designation || 'N/A',
                department: emp.department_id?.name || 'N/A',
                division: emp.division_id?.name || 'N/A',
                doj: emp.doj,
                effectiveDate,
                currentBalances: {
                    CL: currentCL,
                    EL: Number(currentEL || 0),
                    CCL: Number(currentCCL || 0),
                },
                proposedBalances: {
                    CL: targetCL,
                    EL: Number(currentEL || 0),
                    CCL: Number(currentCCL || 0),
                },
                /** Remaining FY grid after past payroll slots zeroed (before carry); carry is folded into first open month. */
                policyClScheduled: Number(built.policyRemainingGridOnly || 0),
                carryForwardInTarget: built.carryForwardAllowed,
                monthlyClBreakdown: built.monthlyBreakdown,
                clCalculation: {
                    entitlement: built.entitlement,
                    entitlementFullYear: built.fullYearGridSum,
                    policyRemainingGridOnly: built.policyRemainingGridOnly,
                    pastClearedCreditsTotal: built.pastClearedCreditsTotal,
                    defaultPoolBalance: built.defaultPoolBalance,
                    ledgerClForCarry: Number(built.ledgerCLBalance || 0),
                    proration: built.proration,
                    carryForward: built.carryForwardAllowed,
                    maxCarryForward: maxCarryCap,
                    addCarryForward,
                },
                needsUpdate: Number(targetCL) !== currentCL,
            });
        }

        res.status(200).json({
            success: true,
            data: {
                employees: previewRows,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: filtered.length,
                    pages: Math.ceil(filtered.length / limitNum)
                },
                summary: {
                    totalEmployees: filtered.length,
                    needsUpdate: previewRows.filter(r => r.needsUpdate).length
                },
                settings: {
                    annualCLReset: settings.annualCLReset,
                }
            }
        });
    } catch (error) {
        console.error('Error in initial CL sync preview:', error);
        res.status(500).json({
            success: false,
            message: 'Error generating preview',
            error: error.message
        });
    }
};

/**
 * @desc    Apply initial CL/EL/CCL balances from reviewed preview rows, or all active employees (CL from policy only).
 * @route   POST /api/leaves/initial-cl-sync/apply
 * @body    { confirm, scope?: 'listed' | 'all', employees?: [...], reason? }
 * @access  Private (HR, Admin only)
 */
exports.applyInitialCLSync = async (req, res) => {
    try {
        const { confirm } = req.body || {};
        if (!confirm) {
            return res.status(400).json({
                success: false,
                message: 'Please confirm apply operation by setting confirm=true'
            });
        }

        const clSyncOptions = {
            creditAllPayrollMonths: true,
            includeApprovedClUsageDebits: true,
            carryUnusedClToNextMonth: false,
            disableInitialLedgerCarryForward: true,
        };

        const settings = await LeavePolicySettings.getSettings();
        const effectiveDate = createISTDate(getTodayISTDateString());
        const employeesAll = await Employee.find({ is_active: true })
            .select('_id emp_no employee_name department_id division_id doj is_active compensatoryOffs')
            .populate('department_id', 'name')
            .populate('division_id', 'name');

        const results = {
            processed: 0,
            successCount: 0,
            errors: [],
            details: [],
            scope: 'all',
        };

        for (const emp of employeesAll) {
            try {
                const syncResult = await syncEmployeeCLFromPolicy(emp, settings, effectiveDate, clSyncOptions);
                if (!syncResult.success) {
                    throw new Error(syncResult.error || 'CL sync failed');
                }
                results.successCount++;
                results.details.push({
                    employeeId: emp._id,
                    success: true,
                    newBalance: syncResult.newBalance,
                    policyOpening: syncResult.policyOpening,
                });
            } catch (e) {
                results.errors.push({ employeeId: emp._id, error: e.message });
                results.details.push({ employeeId: emp._id, success: false, error: e.message });
            } finally {
                results.processed++;
            }
        }

        return res.status(200).json({
            success: true,
            message: `Initial sync (all active): ${results.successCount}/${results.processed} employees processed`,
            data: results,
        });
    } catch (error) {
        console.error('Error applying initial CL sync:', error);
        res.status(500).json({
            success: false,
            message: 'Error applying initial sync',
            error: error.message
        });
    }
};

/**
 * @desc    Legacy apply initial CL sync for all employees from policy
 * @route   POST /api/leaves/initial-cl-sync
 * @access  Private (HR, Admin only)
 */
exports.performInitialCLSync = async (req, res) => {
    try {
        const { confirm = true } = req.body || {};
        if (!confirm) {
            return res.status(400).json({
                success: false,
                message: 'Please confirm operation by setting confirm=true'
            });
        }

        const result = await performInitialCLSync();
        res.status(200).json({
            success: !!result.success,
            message: result.message || 'Initial CL sync finished',
            data: result
        });
    } catch (error) {
        console.error('Error performing initial CL sync:', error);
        res.status(500).json({
            success: false,
            message: 'Error performing initial CL sync',
            error: error.message
        });
    }
};

/**
 * @desc    Get CL reset status for employees
 * @route   GET /api/leaves/annual-reset/status
 * @access  Private (HR, Admin)
 */
exports.getResetStatus = async (req, res) => {
    try {
        const { employeeIds, departmentId, divisionId } = req.query;
        
        let filters = {};
        if (employeeIds) {
            filters.employeeIds = employeeIds.split(',').map(id => id.trim());
        }
        if (departmentId) {
            filters.departmentId = departmentId;
        }
        if (divisionId) {
            filters.divisionId = divisionId;
        }

        const result = await getCLResetStatus(filters.employeeIds);
        
        // Apply department/division filters if specified
        let filteredData = result.data;
        if (filters.departmentId) {
            filteredData = filteredData.filter(emp => emp.department === filters.departmentId);
        }
        if (filters.divisionId) {
            filteredData = filteredData.filter(emp => emp.division === filters.divisionId);
        }

        res.status(200).json({
            success: true,
            data: filteredData,
            settings: result.settings,
            total: filteredData.length,
            message: `Found reset status for ${filteredData.length} employees`
        });

    } catch (error) {
        console.error('Error getting CL reset status:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting CL reset status',
            error: error.message
        });
    }
};

/**
 * @desc    Get next CL reset date
 * @route   GET /api/leaves/annual-reset/next-date
 * @access  Private (All authenticated users)
 */
exports.getNextResetDate = async (req, res) => {
    try {
        const settings = await LeavePolicySettings.getSettings();
        
        if (!settings.annualCLReset.enabled) {
            return res.status(200).json({
                success: true,
                enabled: false,
                message: 'Annual CL reset is disabled'
            });
        }

        const nextResetDate = await getNextResetDate(settings);
        
        res.status(200).json({
            success: true,
            enabled: true,
            data: {
                nextResetDate,
                usePayrollCycleForReset: settings.annualCLReset.usePayrollCycleForReset,
                resetToBalance: settings.annualCLReset.resetToBalance,
                addCarryForward: settings.annualCLReset.addCarryForward,
                resetMonth: settings.annualCLReset.resetMonth,
                resetDay: settings.annualCLReset.resetDay,
                daysUntilReset: Math.ceil((nextResetDate - new Date()) / (1000 * 60 * 60 * 24))
            }
        });

    } catch (error) {
        console.error('Error getting next reset date:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting next reset date',
            error: error.message
        });
    }
};

/**
 * @desc    Preview annual CL reset
 * @route   POST /api/leaves/annual-reset/preview
 * @access  Private (HR, Admin)
 */
/**
 * @desc    Per-employee leave register for one financial year (after annual reset)
 * @route   GET /api/leaves/leave-register-year/:employeeId?financialYear=2025-2026
 * @access  Private (HR, Admin)
 */
exports.getLeaveRegisterYear = async (req, res) => {
    try {
        const { employeeId } = req.params;
        const financialYear = req.query.financialYear;
        if (!financialYear || String(financialYear).trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Query parameter financialYear is required (must match policy FY label, e.g. 2025-2026)'
            });
        }
        const doc = await leaveRegisterYearService.findByEmployeeAndFY(employeeId, String(financialYear).trim());
        return res.status(200).json({
            success: true,
            data: doc
        });
    } catch (error) {
        console.error('Error fetching leave register year:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching leave register year',
            error: error.message
        });
    }
};

exports.previewReset = async (req, res) => {
    try {
        const { sampleSize = 10 } = req.body; // Preview for sample employees
        
        const settings = await LeavePolicySettings.getSettings();
        
        if (!settings.annualCLReset.enabled) {
            return res.status(400).json({
                success: false,
                message: 'Annual CL reset is disabled in settings'
            });
        }

        // Get sample employees for preview
        const Employee = require('../../employees/model/Employee');
        const sampleEmployees = await Employee.find({ is_active: true })
            .limit(sampleSize)
            .select('_id emp_no employee_name paidLeaves department_id division_id')
            .populate('department_id', 'name')
            .populate('division_id', 'name')
            .lean();

        const previewResults = [];
        const resetDate = await getNextResetDate(settings);

        for (const employee of sampleEmployees) {
            const currentCL = employee.paidLeaves || 0;
            let carryForwardAmount = 0;
            
            if (settings.annualCLReset.addCarryForward) {
                const maxCarry = getMaxAnnualCarryForwardCl(settings);
                const unusedCL = Math.max(0, currentCL - 5); // Simplified sample preview
                carryForwardAmount = Math.min(unusedCL, maxCarry);
            }

            const newBalance = settings.annualCLReset.resetToBalance + carryForwardAmount;

            previewResults.push({
                employeeId: employee._id,
                empNo: employee.emp_no,
                employeeName: employee.employee_name,
                department: employee.department_id?.name,
                division: employee.division_id?.name,
                currentBalance: currentCL,
                estimatedCarryForward: carryForwardAmount,
                newBalance: newBalance
            });
        }

        res.status(200).json({
            success: true,
            message: `Annual CL reset preview for ${previewResults.length} employees`,
            data: {
                resetDate,
                resetToBalance: settings.annualCLReset.resetToBalance,
                addCarryForward: settings.annualCLReset.addCarryForward,
                sampleResults: previewResults,
                totalEmployees: sampleSize
            }
        });

    } catch (error) {
        console.error('Error previewing annual CL reset:', error);
        res.status(500).json({
            success: false,
            message: 'Error previewing annual CL reset',
            error: error.message
        });
    }
};
