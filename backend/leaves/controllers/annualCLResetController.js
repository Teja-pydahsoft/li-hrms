/**
 * Annual CL Reset Controller
 * Manages annual casual leave balance reset operations
 */

const { performAnnualCLReset, performInitialCLSync, getInitialSyncEntitlement, getCLResetStatus, getNextResetDate } = require('../services/annualCLResetService');
const LeavePolicySettings = require('../../settings/model/LeavePolicySettings');
const Employee = require('../../employees/model/Employee');
const leaveRegisterService = require('../services/leaveRegisterService');

function yearsOfExperience(doj, asOfDate) {
    if (!doj) return 0;
    const start = new Date(doj);
    const end = new Date(asOfDate);
    if (end < start) return 0;
    const years = (end.getFullYear() - start.getFullYear()) +
        ((end.getMonth() - start.getMonth()) * 12 + (end.getDate() - start.getDate())) / 365.25;
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

        const maxCF = settings?.carryForward?.casualLeave?.enabled
            ? (settings?.carryForward?.casualLeave?.maxMonths || 12)
            : 0;
        const addCarryForward = settings?.annualCLReset?.addCarryForward !== false;

        const previewRows = [];
        for (const emp of pageRows) {
            const currentCL = await leaveRegisterService.getCurrentBalance(emp._id, 'CL');
            const currentEL = await leaveRegisterService.getCurrentBalance(emp._id, 'EL');
            const currentCCL = await leaveRegisterService.getCurrentBalance(emp._id, 'CCL');

            const { entitlement, proration } = await getInitialSyncEntitlement(settings, emp.doj, new Date());
            const carryForward = addCarryForward ? Math.min(currentCL, maxCF) : 0;
            const targetCL = Math.max(0, entitlement + carryForward);

            previewRows.push({
                employeeId: emp._id,
                empNo: emp.emp_no,
                employeeName: emp.employee_name,
                designation: emp.designation || 'N/A',
                department: emp.department_id?.name || 'N/A',
                division: emp.division_id?.name || 'N/A',
                doj: emp.doj,
                currentBalances: {
                    CL: Number(currentCL || 0),
                    EL: Number(currentEL || 0),
                    CCL: Number(currentCCL || 0)
                },
                proposedBalances: {
                    CL: Number(targetCL || 0),
                    // Keep existing EL/CCL by default; user may edit before apply.
                    EL: Number(currentEL || 0),
                    CCL: Number(currentCCL || 0)
                },
                clCalculation: {
                    entitlement,
                    proration,
                    carryForward,
                    maxCarryForward: maxCF,
                    addCarryForward
                },
                needsUpdate:
                    Number(targetCL || 0) !== Number(currentCL || 0) ||
                    Number(currentEL || 0) !== Number(currentEL || 0) ||
                    Number(currentCCL || 0) !== Number(currentCCL || 0)
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
                    monthlyLimitSettings: settings.monthlyLimitSettings
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
 * @desc    Apply initial CL/EL/CCL balances from reviewed preview rows
 * @route   POST /api/leaves/initial-cl-sync/apply
 * @access  Private (HR, Admin only)
 */
exports.applyInitialCLSync = async (req, res) => {
    try {
        const { confirm, employees = [], reason } = req.body || {};
        if (!confirm) {
            return res.status(400).json({
                success: false,
                message: 'Please confirm apply operation by setting confirm=true'
            });
        }

        if (!Array.isArray(employees) || employees.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No employees payload provided for apply.'
            });
        }

        const results = {
            processed: 0,
            successCount: 0,
            errors: [],
            details: []
        };

        for (const row of employees) {
            const { employeeId, targetCL, targetEL, targetCCL } = row || {};
            if (!employeeId) continue;

            try {
                const targetMap = [
                    { type: 'CL', value: targetCL },
                    { type: 'EL', value: targetEL },
                    { type: 'CCL', value: targetCCL }
                ];

                for (const t of targetMap) {
                    if (t.value == null || t.value === '') continue;
                    const num = Number(t.value);
                    if (!Number.isFinite(num) || num < 0) {
                        throw new Error(`Invalid ${t.type} target value for employee ${employeeId}`);
                    }
                    await leaveRegisterService.addAdjustment(
                        employeeId,
                        t.type,
                        num,
                        `Initial policy sync${reason ? `: ${String(reason).trim()}` : ''}`
                    );
                }

                results.successCount++;
                results.details.push({ employeeId, success: true });
            } catch (e) {
                results.errors.push({ employeeId, error: e.message });
                results.details.push({ employeeId, success: false, error: e.message });
            } finally {
                results.processed++;
            }
        }

        res.status(200).json({
            success: true,
            message: `Initial sync apply completed: ${results.successCount}/${results.processed} employees processed`,
            data: results
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
            
            if (settings.annualCLReset.addCarryForward && settings.carryForward.casualLeave.enabled) {
                const unusedCL = Math.max(0, currentCL - 5); // Simplified calculation
                carryForwardAmount = Math.min(unusedCL, settings.carryForward.casualLeave.maxMonths || 12);
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
