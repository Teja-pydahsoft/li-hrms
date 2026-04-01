const mongoose = require('mongoose');
const Loan = require('../model/Loan');
const LoanSettings = require('../model/LoanSettings');
const Employee = require('../../employees/model/Employee');
const User = require('../../users/model/User');
const { isHRMSConnected, getEmployeeByIdMSSQL } = require('../../employees/config/sqlHelper');
const { getResolvedLoanSettings } = require('../../departments/controllers/departmentSettingsController');
const { getEmployeeIdsInScope } = require('../../shared/middleware/dataScopeMiddleware');

// ============================================
// TESTING FLAG - Set to false to disable Super Admin bypass
// ============================================
const ENABLE_SUPERADMIN_BYPASS = false; // Set to true for production, false for testing workflow
// ============================================

/**
 * Get employee settings from database
 */
const getEmployeeSettings = async () => {
  try {
    const Settings = require('../../settings/model/Settings');
    const dataSourceSetting = await Settings.findOne({ key: 'employee_data_source' });
    return {
      dataSource: dataSourceSetting?.value || 'mongodb', // 'mongodb' | 'mssql' | 'both'
    };
  } catch (error) {
    console.error('Error getting employee settings:', error);
    return { dataSource: 'mongodb' };
  }
};

/**
 * Find employee by emp_no - respects employee settings
 */
const findEmployeeByEmpNo = async (empNo) => {
  if (!empNo) return null;

  // Always try MongoDB first
  let employee = await Employee.findOne({ emp_no: empNo });

  if (employee) {
    return employee;
  }

  // If not in MongoDB, check if MSSQL is available and try there
  const settings = await getEmployeeSettings();

  if ((settings.dataSource === 'mssql' || settings.dataSource === 'both') && isHRMSConnected()) {
    try {
      const mssqlEmployee = await getEmployeeByIdMSSQL(empNo);
      if (mssqlEmployee) {
        console.log(`Syncing employee ${empNo} from MSSQL to MongoDB...`);

        const newEmployee = new Employee({
          emp_no: mssqlEmployee.emp_no,
          employee_name: mssqlEmployee.employee_name,
          department_id: mssqlEmployee.department_id || null,
          designation_id: mssqlEmployee.designation_id || null,
          doj: mssqlEmployee.doj || null,
          dob: mssqlEmployee.dob || null,
          gross_salary: mssqlEmployee.gross_salary || null,
          gender: mssqlEmployee.gender || null,
          marital_status: mssqlEmployee.marital_status || null,
          blood_group: mssqlEmployee.blood_group || null,
          qualifications: mssqlEmployee.qualifications || null,
          experience: mssqlEmployee.experience || null,
          address: mssqlEmployee.address || null,
          location: mssqlEmployee.location || null,
          aadhar_number: mssqlEmployee.aadhar_number || null,
          phone_number: mssqlEmployee.phone_number || null,
          alt_phone_number: mssqlEmployee.alt_phone_number || null,
          email: mssqlEmployee.email || null,
          pf_number: mssqlEmployee.pf_number || null,
          esi_number: mssqlEmployee.esi_number || null,
          bank_account_no: mssqlEmployee.bank_account_no || null,
          bank_name: mssqlEmployee.bank_name || null,
          bank_place: mssqlEmployee.bank_place || null,
          ifsc_code: mssqlEmployee.ifsc_code || null,
          is_active: mssqlEmployee.is_active !== false,
        });

        await newEmployee.save();
        console.log(`✅ Employee ${empNo} synced to MongoDB`);
        return newEmployee;
      }
    } catch (error) {
      console.error('Error fetching/syncing from MSSQL:', error);
    }
  }

  return null;
};

// Helper to find employee by ID or emp_no
const findEmployeeByIdOrEmpNo = async (identifier) => {
  if (!identifier) return null;

  // Check if it's a valid MongoDB ObjectId
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    const employee = await Employee.findById(identifier);
    if (employee) return employee;
  }

  // Try to find by emp_no as fallback
  return await findEmployeeByEmpNo(identifier);
};

/**
 * Loan Controller
 * Handles CRUD operations and approval workflow
 */

// Helper function to get workflow settings
const getWorkflowSettings = async (type) => {
  let settings = await LoanSettings.getActiveSettings(type);

  // Return default workflow if no settings found
  if (!settings) {
    return {
      workflow: {
        isEnabled: true,
        steps: [
          { stepOrder: 1, stepName: 'HOD Approval', approverRole: 'hod', availableActions: ['approve', 'reject', 'forward'], approvedStatus: 'hod_approved', rejectedStatus: 'hod_rejected', nextStepOnApprove: 2, isActive: true },
          { stepOrder: 2, stepName: 'HR Approval', approverRole: 'hr', availableActions: ['approve', 'reject'], approvedStatus: 'approved', rejectedStatus: 'hr_rejected', nextStepOnApprove: null, isActive: true },
        ],
        finalAuthority: { role: 'hr', anyHRCanApprove: true },
      },
      settings: {
        maxAmount: null,
        minAmount: 1000,
        maxDuration: 60,
        minDuration: 1,
      },
    };
  }

  return settings;
};

// Helper to calculate EMI for loans with simple interest
const calculateEMI = (principal, interestRate, duration) => {
  if (interestRate === 0 || !interestRate) {
    // No interest - simple division
    const emi = principal / duration;
    return {
      emiAmount: Math.round(emi),
      totalInterest: 0,
      totalAmount: principal,
    };
  }

  // Simple Interest Method: SI = (P × R × T) / 100
  // T is in months, so convert to years: T/12
  const totalInterest = (principal * interestRate * (duration / 12)) / 100;
  const totalAmount = principal + totalInterest;
  const emi = totalAmount / duration;

  return {
    emiAmount: Math.round(emi),
    totalInterest: Math.round(totalInterest),
    totalAmount: Math.round(totalAmount),
  };
};

// Helper to calculate early settlement amount
const calculateEarlySettlement = (loan, settlementDate = new Date()) => {
  if (loan.requestType !== 'loan' || !loan.loanConfig) {
    return null; // Only loans have interest calculation
  }

  const principal = loan.amount;
  const interestRate = loan.loanConfig.interestRate || 0;
  const originalDuration = loan.duration; // months
  const originalTotalAmount = loan.loanConfig.totalAmount || principal;
  const originalInterest = originalTotalAmount - principal;

  // Calculate months used (from disbursement or applied date)
  const startDate = loan.disbursement?.disbursedAt || loan.appliedAt || loan.createdAt;
  const monthsUsed = Math.ceil((settlementDate - new Date(startDate)) / (1000 * 60 * 60 * 24 * 30));
  const actualMonthsUsed = Math.max(1, Math.min(monthsUsed, originalDuration));

  // Recalculate interest only for months used
  let recalculatedInterest = 0;
  if (interestRate > 0) {
    // Simple interest calculation: Principal × Rate × (Months/12)
    recalculatedInterest = principal * (interestRate / 100) * (actualMonthsUsed / 12);
  }

  // Calculate what has been paid so far
  const totalPaid = loan.repayment?.totalPaid || 0;
  const installmentsPaid = loan.repayment?.installmentsPaid || 0;

  // Calculate remaining principal (original principal - principal portion of payments)
  // For simplicity, we'll calculate based on EMI payments made
  let principalPaid = 0;
  if (installmentsPaid > 0 && loan.loanConfig.emiAmount) {
    // Calculate principal portion from EMIs paid
    const emiAmount = loan.loanConfig.emiAmount;
    const monthlyInterest = principal * (interestRate / 100) / 12;
    const monthlyPrincipal = emiAmount - monthlyInterest;
    principalPaid = monthlyPrincipal * installmentsPaid;
  }

  const remainingPrincipal = Math.max(0, principal - principalPaid);

  // Settlement amount = Remaining Principal + Interest for used period - Interest already paid
  const interestAlreadyPaid = totalPaid - principalPaid;
  const settlementInterest = Math.max(0, recalculatedInterest - interestAlreadyPaid);
  const settlementAmount = remainingPrincipal + settlementInterest;

  // Calculate savings
  const remainingMonths = originalDuration - actualMonthsUsed;
  const interestForRemainingMonths = principal * (interestRate / 100) * (remainingMonths / 12);
  const interestSavings = Math.max(0, interestForRemainingMonths);

  return {
    principal,
    originalDuration,
    originalTotalAmount,
    originalInterest,
    actualMonthsUsed,
    remainingMonths,
    recalculatedInterest,
    totalPaid,
    principalPaid,
    remainingPrincipal,
    interestAlreadyPaid,
    settlementInterest,
    settlementAmount: Math.round(settlementAmount),
    interestSavings: Math.round(interestSavings),
    totalSavings: Math.round(interestSavings + (originalTotalAmount - (remainingPrincipal + recalculatedInterest))),
  };
};

// @desc    Get all loans (with filters)
// @route   GET /api/loans
// @access  Private
exports.getLoans = async (req, res) => {
  try {
    const { status, employeeId, department, requestType, page = 1, limit = 20 } = req.query;
    const filter = { isActive: true, ...(req.scopeFilter || {}) };

    if (status) filter.status = status;
    if (employeeId) filter.employeeId = employeeId;
    if (department) filter.department = department;
    if (requestType) filter.requestType = requestType;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [loans, total] = await Promise.all([
      Loan.find(filter)
        .populate('employeeId', 'employee_name emp_no gross_salary')
        .populate('department', 'name')
        .populate('designation', 'name')
        .populate('appliedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Loan.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      count: loans.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      data: loans,
    });
  } catch (error) {
    console.error('Error fetching loans:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch loans',
    });
  }
};

// @desc    Get my loans (for logged-in employee)
// @route   GET /api/loans/my
// @access  Private
exports.getMyLoans = async (req, res) => {
  try {
    const { status, requestType } = req.query;
    const filter = {
      isActive: true,
      appliedBy: req.user._id,
    };

    if (status) filter.status = status;
    if (requestType) filter.requestType = requestType;

    const loans = await Loan.find(filter)
      .populate('employeeId', 'employee_name emp_no gross_salary')
      .populate('department', 'name')
      .populate('designation', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: loans.length,
      data: loans,
    });
  } catch (error) {
    console.error('Error fetching my loans:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch loans',
    });
  }
};

// @desc    Get guarantor candidates for current user
// @route   GET /api/loans/guarantor-candidates
// @access  Private
exports.getGuarantorCandidates = async (req, res) => {
  try {
    const { search = '', limit = 60 } = req.query;

    // Resolve current employee first (supports both employeeRef and emp_no based login)
    let selfEmployee = null;
    if (req.user.employeeRef) {
      selfEmployee = await findEmployeeByIdOrEmpNo(req.user.employeeRef);
    } else if (req.user.employeeId) {
      selfEmployee = await findEmployeeByEmpNo(req.user.employeeId);
    }

    if (!selfEmployee) {
      return res.status(400).json({
        success: false,
        message: 'Current user is not linked to an employee record',
      });
    }

    // Keep candidate scope safe: same division and optionally same department.
    const baseFilter = {
      is_active: true,
      _id: { $ne: selfEmployee._id },
    };
    if (selfEmployee.division_id) {
      baseFilter.division_id = selfEmployee.division_id;
    }
    if (selfEmployee.department_id) {
      baseFilter.department_id = selfEmployee.department_id;
    }

    if (search && String(search).trim()) {
      const rx = new RegExp(String(search).trim(), 'i');
      baseFilter.$or = [
        { emp_no: rx },
        { employee_name: rx },
      ];
    }

    const max = Math.min(Math.max(parseInt(limit, 10) || 60, 1), 200);
    const employees = await Employee.find(baseFilter)
      .select('emp_no employee_name department_id designation_id division_id')
      .populate('department_id', 'name')
      .populate('designation_id', 'name')
      .sort({ employee_name: 1 })
      .limit(max);

    res.status(200).json({
      success: true,
      count: employees.length,
      data: employees.map((e) => ({
        _id: e._id,
        emp_no: e.emp_no,
        employee_name: e.employee_name,
        department: e.department_id ? { _id: e.department_id._id, name: e.department_id.name } : null,
        designation: e.designation_id ? { _id: e.designation_id._id, name: e.designation_id.name } : null,
        division_id: e.division_id || null,
      })),
    });
  } catch (error) {
    console.error('Error fetching guarantor candidates:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch guarantor candidates',
    });
  }
};

// @desc    Calculate salary advance eligibility
// @route   GET /api/loans/calculate-eligibility
// @access  Private
exports.calculateEligibility = async (req, res) => {
  try {
    const { empNo } = req.query;

    // Get employee - either from query or from logged-in user
    let employee;
    if (empNo) {
      // Check if user has permission to check for others
      const hasPermission = ['hr', 'hod', 'manager', 'sub_admin', 'super_admin'].includes(req.user.role);
      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to check eligibility for others'
        });
      }
      employee = await findEmployeeByEmpNo(empNo);
    } else {
      // Get for self
      if (req.user.employeeRef) {
        employee = await findEmployeeByIdOrEmpNo(req.user.employeeRef);
      } else if (req.user.employeeId) {
        employee = await findEmployeeByEmpNo(req.user.employeeId);
      }
    }

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    // Get salary advance settings
    const settings = await LoanSettings.findOne({
      type: 'salary_advance',
      isActive: true
    });

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Salary advance settings not configured'
      });
    }

    // Get current month attendance (AttendanceDaily uses uppercase status: PRESENT, PARTIAL, HALF_DAY)
    const AttendanceDaily = require('../../attendance/model/AttendanceDaily');
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const firstDayOfMonth = `${currentMonth}-01`;
    const today = now.toISOString().split('T')[0];
    const empNoForQuery = (employee.emp_no && String(employee.emp_no).toUpperCase()) || employee.emp_no;

    const attendance = await AttendanceDaily.find({
      employeeNumber: empNoForQuery,
      date: {
        $gte: firstDayOfMonth,
        $lte: today
      }
    }).select('status').lean();

    // Calculate days
    const applicationDate = now.getDate();
    const totalDaysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysElapsed = applicationDate;

    // Calculate days worked: PRESENT/PARTIAL = 1 day, HALF_DAY = 0.5 (match AttendanceDaily enum)
    const presentOrPartial = attendance.filter(a =>
      a.status === 'PRESENT' || a.status === 'PARTIAL'
    ).length;
    const halfDays = attendance.filter(a => a.status === 'HALF_DAY').length;
    const effectiveDaysWorked = presentOrPartial + (halfDays * 0.5);

    // Attendance percentage
    const attendancePercentage = daysElapsed > 0
      ? (effectiveDaysWorked / daysElapsed) * 100
      : 0;

    // Get salary (use gross_salary as basic pay as per user's instruction)
    const basicSalary = employee.gross_salary || 0;

    if (!basicSalary || basicSalary === 0) {
      return res.status(400).json({
        success: false,
        message: 'Salary information not available. Please contact HR.'
      });
    }

    // Calculate eligible amount (prorated for days elapsed)
    const eligibleAmount = (daysElapsed / totalDaysInMonth) * basicSalary;

    // Calculate prorated amount (based on attendance)
    const considerAttendance = settings.settings?.salaryBasedLimits?.considerAttendance !== false;
    const proratedAmount = considerAttendance
      ? eligibleAmount * (attendancePercentage / 100)
      : eligibleAmount;

    // Calculate max limit (% of basic salary from settings)
    const maxPercentage = settings.settings?.salaryBasedLimits?.advancePercentage || 50;
    const maxLimitAmount = (maxPercentage / 100) * basicSalary;

    // Final max allowed: when considerAttendance is true, cap by attendance-prorated amount; else by time-eligible amount
    const finalMaxAllowed = considerAttendance
      ? Math.min(proratedAmount, maxLimitAmount)
      : Math.min(eligibleAmount, maxLimitAmount);

    res.json({
      success: true,
      data: {
        // Date info
        applicationDate,
        daysElapsedInMonth: daysElapsed,
        totalDaysInMonth,

        // Attendance info
        daysWorked: effectiveDaysWorked,
        attendancePercentage: Math.round(attendancePercentage * 100) / 100,
        attendanceRecords: attendance.length,

        // Salary info
        basicSalary,

        // Calculated amounts
        eligibleAmount: Math.round(eligibleAmount),
        proratedAmount: Math.round(proratedAmount),
        maxLimitAmount: Math.round(maxLimitAmount),
        finalMaxAllowed: Math.round(finalMaxAllowed),

        // Settings
        maxPercentage,
        considerAttendance,

        // Employee info
        employeeName: employee.employee_name,
        empNo: employee.emp_no
      }
    });
  } catch (error) {
    console.error('Error calculating eligibility:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to calculate eligibility'
    });
  }
};

// @desc    Get single loan
// @route   GET /api/loans/:id
// @access  Private
exports.getLoan = async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id)
      .populate('employeeId', 'employee_name emp_no gross_salary email phone_number')
      .populate('department', 'name code')
      .populate('designation', 'name')
      .populate('appliedBy', 'name email')
      .populate('workflow.history.actionBy', 'name email')
      .populate('approvals.hod.approvedBy', 'name email')
      .populate('approvals.hr.approvedBy', 'name email')
      .populate('approvals.final.approvedBy', 'name email')
      .populate('disbursement.disbursedBy', 'name email');

    if (!loan) {
      return res.status(404).json({
        success: false,
        error: 'Loan application not found',
      });
    }

    res.status(200).json({
      success: true,
      data: loan,
    });
  } catch (error) {
    console.error('Error fetching loan:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch loan',
    });
  }
};

// @desc    Apply for loan/advance
// @route   POST /api/loans
// @access  Private
exports.applyLoan = async (req, res) => {
  try {
    const {
      requestType,
      amount,
      reason,
      duration,
      remarks,
      empNo, // Primary - emp_no for applying on behalf
      employeeId, // Legacy - for backward compatibility
      guarantorIds, // Array of employee IDs or emp_nos
    } = req.body;

    // Validate request type
    if (!['loan', 'salary_advance'].includes(requestType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request type. Must be "loan" or "salary_advance"',
      });
    }

    // Validate guarantors (at least two required for loans)
    if (requestType === 'loan' && (!guarantorIds || !Array.isArray(guarantorIds) || guarantorIds.length < 2)) {
      return res.status(400).json({
        success: false,
        error: 'At least two guarantors are required for a loan application',
      });
    }

    // Get employee - either from request body (HR applying for someone) or from user
    let employee;

    // Use empNo as primary identifier (from frontend)
    if (empNo) {
      // Check if user has permission to apply for others
      const hasRolePermission = ['hr', 'sub_admin', 'super_admin'].includes(req.user.role);

      console.log(`[Apply Loan] User ${req.user._id} (${req.user.role}) applying for employee ${empNo}`);
      console.log(`[Apply Loan] Has role permission: ${hasRolePermission} `);

      // Check workspace permissions if user has active workspace
      let hasWorkspacePermission = false;
      if (req.user.activeWorkspaceId) {
        try {
          const loanSettings = await LoanSettings.findOne({ type: requestType, isActive: true });
          if (loanSettings?.settings?.workspacePermissions) {
            const workspaceIdStr = String(req.user.activeWorkspaceId);
            const permissions = loanSettings.settings.workspacePermissions[workspaceIdStr];

            console.log(`[Apply Loan] Checking workspace ${workspaceIdStr} permissions: `, permissions);

            if (permissions) {
              // Handle both old format (boolean) and new format (object)
              if (typeof permissions === 'boolean') {
                hasWorkspacePermission = permissions;
              } else {
                hasWorkspacePermission = permissions.canApplyForOthers || false;
              }
            }
          }
        } catch (error) {
          console.error('[Apply Loan] Error checking workspace permissions:', error);
        }
      }

      console.log(`[Apply Loan] Has workspace permission: ${hasWorkspacePermission} `);

      // User must have either role permission OR workspace permission
      if (!hasRolePermission && !hasWorkspacePermission) {
        console.log(`[Apply Loan] ❌ Authorization denied - no role or workspace permission`);
        return res.status(403).json({
          success: false,
          error: 'Not authorized to apply loan/advance for others',
        });
      }

      console.log(`[Apply Loan] ✅ Authorization granted`);

      // Find employee by emp_no
      employee = await findEmployeeByEmpNo(empNo);
    } else if (employeeId) {
      // Legacy: Check if user has permission to apply for others
      const hasRolePermission = ['hr', 'sub_admin', 'super_admin'].includes(req.user.role);

      // Check workspace permissions
      let hasWorkspacePermission = false;
      if (req.user.activeWorkspaceId) {
        try {
          const loanSettings = await LoanSettings.findOne({ type: requestType, isActive: true });
          if (loanSettings?.settings?.workspacePermissions) {
            const workspaceIdStr = String(req.user.activeWorkspaceId);
            const permissions = loanSettings.settings.workspacePermissions[workspaceIdStr];
            if (permissions) {
              if (typeof permissions === 'boolean') {
                hasWorkspacePermission = permissions;
              } else {
                hasWorkspacePermission = permissions.canApplyForOthers || false;
              }
            }
          }
        } catch (error) {
          console.error('[Apply Loan] Error checking workspace permissions:', error);
        }
      }

      if (!hasRolePermission && !hasWorkspacePermission) {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to apply loan/advance for others',
        });
      }

      employee = await findEmployeeByIdOrEmpNo(employeeId);
    } else {
      // Apply for self
      if (req.user.employeeRef) {
        employee = await findEmployeeByIdOrEmpNo(req.user.employeeRef);
      } else if (req.user.employeeId) {
        employee = await findEmployeeByEmpNo(req.user.employeeId);
      }
    }

    if (!employee) {
      return res.status(400).json({
        success: false,
        error: 'Employee record not found',
      });
    }

    // Process Guarantors (only for loans)
    const processedGuarantors = [];
    if (requestType === 'loan' && guarantorIds && Array.isArray(guarantorIds)) {
      const uniqueGuarantorIds = new Set();

      for (const gId of guarantorIds) {
        const guarantor = await findEmployeeByIdOrEmpNo(gId);
        if (!guarantor) {
          return res.status(400).json({
            success: false,
            error: `Guarantor with ID ${gId} not found`,
          });
        }

        if (guarantor._id.toString() === employee._id.toString()) {
          return res.status(400).json({
            success: false,
            error: 'Applicant cannot be their own guarantor',
          });
        }

        if (uniqueGuarantorIds.has(guarantor._id.toString())) {
          continue; // Skip duplicate guarantors
        }

        uniqueGuarantorIds.add(guarantor._id.toString());
        processedGuarantors.push({
          employeeId: guarantor._id,
          emp_no: guarantor.emp_no,
          name: guarantor.employee_name,
          status: 'pending',
        });
      }

      if (processedGuarantors.length < 2) {
        return res.status(400).json({
          success: false,
          error: 'At least two unique guarantors are required',
        });
      }
    }

    // Get workflow settings
    const workflowSettings = await getWorkflowSettings(requestType);

    // Get resolved settings (department + global fallback)
    let settings = workflowSettings.settings || {};
    if (employee.department_id) {
      const resolvedSettings = await getResolvedLoanSettings(employee.department_id, requestType, employee.division_id);
      if (resolvedSettings) {
        // Merge resolved settings with workflow settings
        // Map resolved settings (minTenure/maxTenure) to settings format (minDuration/maxDuration)
        settings = {
          ...settings,
          interestRate: resolvedSettings.interestRate ?? settings.interestRate,
          isInterestApplicable: resolvedSettings.isInterestApplicable ?? settings.isInterestApplicable,
          minDuration: resolvedSettings.minTenure ?? settings.minDuration,
          maxDuration: resolvedSettings.maxTenure ?? settings.maxDuration,
          minAmount: resolvedSettings.minAmount ?? settings.minAmount,
          maxAmount: resolvedSettings.maxAmount ?? settings.maxAmount,
          maxPerEmployee: resolvedSettings.maxPerEmployee ?? settings.maxPerEmployee,
          maxActivePerEmployee: resolvedSettings.maxActivePerEmployee ?? settings.maxActivePerEmployee,
          minServicePeriod: resolvedSettings.minServicePeriod ?? settings.minServicePeriod,
          // Keep workflow-specific settings from global
          eligibleDepartments: settings.eligibleDepartments,
          eligibleDesignations: settings.eligibleDesignations,
        };
      }
    }

    // Validate amount
    if (amount < (settings.minAmount || 1000)) {
      return res.status(400).json({
        success: false,
        error: `Amount must be at least ${settings.minAmount || 1000} `,
      });
    }

    if (settings.maxAmount && amount > settings.maxAmount) {
      return res.status(400).json({
        success: false,
        error: `Amount cannot exceed ${settings.maxAmount} `,
      });
    }

    // Validate duration
    if (duration < (settings.minDuration || 1)) {
      return res.status(400).json({
        success: false,
        error: `Duration must be at least ${settings.minDuration || 1} month(s)`,
      });
    }

    if (duration > (settings.maxDuration || 60)) {
      return res.status(400).json({
        success: false,
        error: `Duration cannot exceed ${settings.maxDuration || 60} months`,
      });
    }

    // Calculate loan-specific values
    let loanConfig = {};
    let advanceConfig = {};
    let totalAmount = amount;
    let totalInterest = 0; // Declare in outer scope

    if (requestType === 'loan') {
      const interestRate = settings.interestRate || 0;
      const { emiAmount, totalInterest: calculatedInterest, totalAmount: calculatedTotal } = calculateEMI(amount, interestRate, duration);

      totalAmount = calculatedTotal;
      totalInterest = calculatedInterest; // Assign to outer scope variable

      // Calculate start and end dates (start from next month)
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() + 1);
      startDate.setDate(1); // First day of next month

      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + duration);

      loanConfig = {
        emiAmount,
        interestRate,
        totalInterest,
        startDate,
        endDate,
        totalAmount,
      };
    } else {
      // Salary advance - calculate per cycle deduction
      const deductionPerCycle = amount / duration;
      advanceConfig = {
        deductionCycles: duration,
        deductionPerCycle: Math.round(deductionPerCycle),
      };
    }

    // Create loan application
    const loan = new Loan({
      employeeId: employee._id,
      emp_no: employee.emp_no,
      requestType,
      amount,
      originalAmount: amount,
      reason,
      duration,
      interestAmount: requestType === 'loan' ? (totalInterest || 0) : 0,
      remarks,
      department: employee.department_id || employee.department,
      designation: employee.designation_id || employee.designation,
      division_id: employee.division_id || employee.division,
      appliedBy: req.user._id,
      appliedAt: new Date(),
      status: 'pending',
      advanceConfig,
      guarantors: processedGuarantors,
      repayment: {
        totalPaid: 0,
        remainingBalance: requestType === 'loan' ? totalAmount : amount,
        installmentsPaid: 0,
        totalInstallments: duration,
        nextPaymentDate: requestType === 'loan' ? loanConfig.startDate : null,
      },
      workflow: {
        currentStep: 'hod',
        nextApprover: 'hod',
        history: [
          {
            step: 'employee',
            action: 'submitted',
            actionBy: req.user._id,
            actionByName: req.user.name,
            actionByRole: req.user.role,
            comments: `${requestType === 'loan' ? 'Loan' : 'Salary advance'} application submitted`,
            timestamp: new Date(),
          },
        ],
      },
    });

    await loan.save();

    // Populate for response
    await loan.populate([
      { path: 'employeeId', select: 'employee_name emp_no gross_salary' },
      { path: 'department', select: 'name' },
      { path: 'designation', select: 'name' },
    ]);

    res.status(201).json({
      success: true,
      message: `${requestType === 'loan' ? 'Loan' : 'Salary advance'} application submitted successfully`,
      data: loan,
    });
  } catch (error) {
    console.error('Error applying loan:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to apply for loan/advance',
    });
  }
};

// @desc    Get guarantor requests for the current user
// @route   GET /api/loans/guarantor-requests
// @access  Private
exports.getGuarantorRequests = async (req, res) => {
  try {
    const employeeId = req.user.employeeRef || req.user.employeeId;
    if (!employeeId) {
      return res.status(400).json({
        success: false,
        error: 'Current user is not linked to an employee record',
      });
    }

    // Find employee to get their MongoDB ID if they only have emp_no
    let mongoEmployeeId = req.user.employeeRef;
    if (!mongoEmployeeId) {
      const employee = await findEmployeeByEmpNo(req.user.employeeId);
      if (employee) mongoEmployeeId = employee._id;
    }

    if (!mongoEmployeeId) {
       return res.status(404).json({
        success: false,
        error: 'Associated employee record not found',
      });
    }

    const loans = await Loan.find({
      'guarantors.employeeId': mongoEmployeeId,
      isActive: true,
    })
      .populate('employeeId', 'employee_name emp_no')
      .populate('department', 'name')
      .populate('designation', 'name')
      .sort({ appliedAt: -1 });

    res.status(200).json({
      success: true,
      count: loans.length,
      data: loans,
    });
  } catch (error) {
    console.error('Error fetching guarantor requests:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch guarantor requests',
    });
  }
};

// @desc    Process guarantor action (accept/reject)
// @route   PUT /api/loans/:id/guarantor-action
// @access  Private
exports.processGuarantorAction = async (req, res) => {
  try {
    const { action, remarks } = req.body;
    const { id } = req.params;

    if (!['accepted', 'rejected'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid action. Must be "accepted" or "rejected"',
      });
    }

    const loan = await Loan.findById(id);
    if (!loan) {
      return res.status(404).json({
        success: false,
        error: 'Loan application not found',
      });
    }

    // Identify current user's employee record
    let mongoEmployeeId = req.user.employeeRef;
    if (!mongoEmployeeId) {
      const employee = await findEmployeeByEmpNo(req.user.employeeId);
      if (employee) mongoEmployeeId = employee._id;
    }

    if (!mongoEmployeeId) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to perform guarantor actions',
      });
    }

    // Find the guarantor entry for this user
    const guarantorEntry = loan.guarantors.find(
      (g) => g.employeeId.toString() === mongoEmployeeId.toString()
    );

    if (!guarantorEntry) {
      return res.status(403).json({
        success: false,
        error: 'You are not listed as a guarantor for this loan',
      });
    }

    if (guarantorEntry.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: `You have already ${guarantorEntry.status} this request`,
      });
    }

    // Update guarantor status
    guarantorEntry.status = action;
    guarantorEntry.actionAt = new Date();
    guarantorEntry.remarks = remarks;

    // Add to history
    loan.workflow.history.push({
      step: 'guarantor',
      action: action === 'accepted' ? 'approved' : 'rejected',
      actionBy: req.user._id,
      actionByName: req.user.name,
      actionByRole: 'guarantor',
      comments: remarks || `Guarantor ${action} the request`,
      timestamp: new Date(),
    });

    await loan.save();

    res.status(200).json({
      success: true,
      message: `Request successfully ${action}`,
      data: loan,
    });
  } catch (error) {
    console.error('Error processing guarantor action:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process guarantor action',
    });
  }
};

// @desc    Update loan/advance application
// @route   PUT /api/loans/:id
// @access  Private
exports.updateLoan = async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id);

    if (!loan) {
      return res.status(404).json({
        success: false,
        error: 'Loan/Advance application not found',
      });
    }

    // Check if can edit - Allow editing for pending, hod_approved, hr_approved (not final approved)
    // Super Admin can edit any status except disbursed/active/completed
    const isSuperAdmin = req.user.role === 'super_admin';
    const isFinalApproved = ['approved', 'disbursed', 'active', 'completed'].includes(loan.status);

    if (isFinalApproved && !isSuperAdmin) {
      return res.status(400).json({
        success: false,
        error: 'Final approved/disbursed loan cannot be edited',
      });
    }

    // Check ownership or admin permission
    const isOwner = loan.appliedBy.toString() === req.user._id.toString();
    const isAdmin = ['hr', 'sub_admin', 'super_admin'].includes(req.user.role);

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to update this loan/advance',
      });
    }

    const allowedUpdates = ['amount', 'reason', 'duration', 'remarks'];

    // Super Admin can also change status
    if (isSuperAdmin && req.body.status !== undefined) {
      const oldStatus = loan.status;
      const newStatus = req.body.status;

      if (oldStatus !== newStatus) {
        allowedUpdates.push('status');

        // Add status change to timeline
        if (!loan.workflow.history) {
          loan.workflow.history = [];
        }
        loan.workflow.history.push({
          step: 'admin',
          action: 'status_changed',
          actionBy: req.user._id,
          actionByName: req.user.name,
          actionByRole: req.user.role,
          comments: `Status changed from ${oldStatus} to ${newStatus}${req.body.statusChangeReason ? ': ' + req.body.statusChangeReason : ''} `,
          timestamp: new Date(),
        });

        // If changing status, also update workflow accordingly
        if (newStatus === 'pending') {
          loan.workflow.currentStep = 'hod';
          loan.workflow.nextApprover = 'hod';
        } else if (newStatus === 'hod_approved') {
          loan.workflow.currentStep = 'hr';
          loan.workflow.nextApprover = 'hr';
        } else if (newStatus === 'hr_approved') {
          loan.workflow.currentStep = 'final';
          loan.workflow.nextApprover = 'final_authority';
        } else if (newStatus === 'approved') {
          loan.workflow.currentStep = 'final';
          loan.workflow.nextApprover = null;
        }
      }
    }

    // Track changes (max 2-3 changes)
    const changes = [];
    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined && loan[field] !== req.body[field]) {
        const originalValue = loan[field];
        const newValue = req.body[field];

        // Store change
        changes.push({
          field: field,
          originalValue: originalValue,
          newValue: newValue,
          modifiedBy: req.user._id,
          modifiedByName: req.user.name,
          modifiedByRole: req.user.role,
          modifiedAt: new Date(),
          reason: req.body.changeReason || null,
        });

        loan[field] = newValue;
      }
    });

    // Add changes to history (keep only last 2-3 changes)
    if (changes.length > 0) {
      if (!loan.changeHistory) {
        loan.changeHistory = [];
      }
      loan.changeHistory.push(...changes);
      // Keep only last 3 changes
      if (loan.changeHistory.length > 3) {
        loan.changeHistory = loan.changeHistory.slice(-3);
      }
    }

    // Recalculate loan/advance config if amount or duration changed
    if (req.body.amount !== undefined || req.body.duration !== undefined) {
      const amount = req.body.amount !== undefined ? req.body.amount : loan.amount;
      const duration = req.body.duration !== undefined ? req.body.duration : loan.duration;

      // Get settings for recalculation
      const settings = await LoanSettings.findOne({
        type: loan.requestType,
        isActive: true
      });

      if (settings) {
        if (loan.requestType === 'loan') {
          // Use interestRate from request body if provided, otherwise use settings
          const interestRate = req.body.interestRate !== undefined ? parseFloat(req.body.interestRate) : (settings.interestRate || 0);
          const { emiAmount, totalInterest, totalAmount } = calculateEMI(amount, interestRate, duration);

          const startDate = new Date();
          startDate.setMonth(startDate.getMonth() + 1);
          startDate.setDate(1);

          const endDate = new Date(startDate);
          endDate.setMonth(endDate.getMonth() + duration);

          loan.loanConfig = {
            emiAmount,
            interestRate,
            totalInterest,
            startDate,
            endDate,
            totalAmount,
          };

          // Update interest amount
          loan.interestAmount = totalInterest;

          // Update repayment remaining balance
          loan.repayment.remainingBalance = totalAmount - (loan.repayment.totalPaid || 0);
          loan.repayment.totalInstallments = duration;
        } else {
          // Salary advance
          const deductionPerCycle = amount / duration;
          loan.advanceConfig = {
            deductionCycles: duration,
            deductionPerCycle: Math.round(deductionPerCycle),
          };

          // Update repayment remaining balance
          loan.repayment.remainingBalance = amount - (loan.repayment.totalPaid || 0);
          loan.repayment.totalInstallments = duration;
        }
      }
    }

    await loan.save();

    // Populate for response
    await loan.populate([
      { path: 'employeeId', select: 'employee_name emp_no gross_salary' },
      { path: 'department', select: 'name' },
      { path: 'designation', select: 'name' },
      { path: 'changeHistory.modifiedBy', select: 'name email role' },
    ]);

    res.status(200).json({
      success: true,
      message: `${loan.requestType === 'loan' ? 'Loan' : 'Salary advance'} updated successfully`,
      data: loan,
      changes: changes,
    });
  } catch (error) {
    console.error('Error updating loan:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update loan/advance',
    });
  }
};

// @desc    Get pending approvals for current user
// @route   GET /api/loans/pending-approvals
// @access  Private
exports.getPendingApprovals = async (req, res) => {
  try {
    const userRole = req.user.role;
    let filter = { isActive: true };

    // Determine what the user can approve based on their role (use divisionMapping for scope)
    if (userRole === 'hod') {
      filter['workflow.nextApprover'] = 'hod';
      const scopedEmployeeIds = await getEmployeeIdsInScope(req.user);
      if (scopedEmployeeIds.length > 0) {
        filter.employeeId = { $in: scopedEmployeeIds };
      } else {
        return res.status(200).json({ success: true, count: 0, data: [] });
      }
    } else if (userRole === 'manager') {
      filter['workflow.nextApprover'] = 'manager';
      const scopedEmployeeIds = await getEmployeeIdsInScope(req.user);
      if (scopedEmployeeIds.length > 0) {
        filter.employeeId = { $in: scopedEmployeeIds };
      } else {
        return res.status(200).json({ success: true, count: 0, data: [] });
      }
    } else if (userRole === 'hr') {
      filter['workflow.nextApprover'] = { $in: ['hr', 'final_authority'] };
    } else if (['sub_admin', 'super_admin'].includes(userRole)) {
      filter.status = { $nin: ['approved', 'rejected', 'cancelled', 'completed'] };
    } else {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to view pending approvals',
      });
    }

    const loans = await Loan.find(filter)
      .populate('employeeId', 'employee_name emp_no gross_salary')
      .populate('department', 'name')
      .populate('designation', 'name')
      .sort({ appliedAt: -1 });

    res.status(200).json({
      success: true,
      count: loans.length,
      data: loans,
    });
  } catch (error) {
    console.error('Error fetching pending approvals:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch pending approvals',
    });
  }
};

// @desc    Process loan action (approve/reject/forward)
// @route   PUT /api/loans/:id/action
// @access  Private (HOD, Manager, HR, Admin)
exports.processLoanAction = async (req, res) => {
  try {
    const { action, comments, approvalAmount, approvalInterestRate } = req.body;
    const loan = await Loan.findById(req.params.id)
      .populate('division_id')
      .populate('employeeId', 'employee_name emp_no gross_salary');

    if (!loan) {
      return res.status(404).json({
        success: false,
        error: 'Loan application not found',
      });
    }

    const userRole = req.user.role;
    const currentApprover = loan.workflow.nextApprover || 'hod'; // Default to hod if not set
    const isSuperAdmin = userRole === 'super_admin';

    // Validate user can perform this action
    let canProcess = false;
    if (isSuperAdmin) {
      canProcess = true;
    } else if (currentApprover === 'reporting_manager') {
      // 1. Check if user is the assigned Reporting Manager
      const targetEmployee = await Employee.findById(loan.employeeId);
      const managers = targetEmployee?.dynamicFields?.reporting_to;

      if (managers && Array.isArray(managers) && managers.length > 0) {
        const userIdStr = req.user._id.toString();
        canProcess = managers.some(m => (m._id || m).toString() === userIdStr);
      }

      // 2. Fallback to HOD if no managers assigned OR if user is an HOD for the employee
      if (!canProcess && userRole === 'hod') {
        const loanDeptId = (loan.department_id || loan.department)?.toString();
        const loanDivId = (loan.division_id || loan.division)?.toString();
        const mapping = req.user.divisionMapping?.find(m =>
          (m.division?._id || m.division)?.toString() === loanDivId
        );
        canProcess = mapping
          ? (!mapping.departments || mapping.departments.length === 0) || mapping.departments.some(d => (d?._id || d).toString() === loanDeptId)
          : false;
      }
    } else if (['hr', 'final_authority'].includes(currentApprover) && userRole === 'hr') {
      canProcess = true;
    }

    if (!canProcess) {
      return res.status(403).json({
        success: false,
        error: `Not authorized to process this application (Current Approver: ${currentApprover})`,
      });
    }

    // Handle Updates if provided during approval (Amount or Interest Rate)
    const isAuthorizedForEdits = ['super_admin', 'hr', 'sub_admin'].includes(userRole);
    let configChanged = false;

    if (action === 'approve' && isAuthorizedForEdits) {
      // 1. Handle Interest Rate Update (only for loans)
      if (loan.requestType === 'loan' && approvalInterestRate !== undefined && !isNaN(parseFloat(approvalInterestRate))) {
        const newRate = parseFloat(approvalInterestRate);
        if (newRate !== loan.loanConfig.interestRate) {
          const oldRate = loan.loanConfig.interestRate || 0;
          loan.loanConfig.interestRate = newRate;
          configChanged = true;

          loan.changeHistory.push({
            field: 'interestRate',
            originalValue: oldRate,
            newValue: newRate,
            modifiedBy: req.user._id,
            modifiedByName: req.user.name,
            modifiedByRole: userRole,
            modifiedAt: new Date(),
            reason: comments || `Interest rate adjusted to ${newRate}% during ${currentApprover} approval`,
          });
        }
      }

      // 2. Handle Amount Update
      if (approvalAmount !== undefined && !isNaN(parseFloat(approvalAmount)) && parseFloat(approvalAmount) !== loan.amount) {
        const oldAmount = loan.amount;
        const newAmount = parseFloat(approvalAmount);
        loan.amount = newAmount;
        configChanged = true;

        loan.changeHistory.push({
          field: 'amount',
          originalValue: oldAmount,
          newValue: newAmount,
          modifiedBy: req.user._id,
          modifiedByName: req.user.name,
          modifiedByRole: userRole,
          modifiedAt: new Date(),
          reason: comments || `Amount adjusted to ₹${newAmount.toLocaleString()} during ${currentApprover} approval`,
        });
      }

      // 3. Recalculate configurations if anything changed
      if (configChanged) {
        if (loan.requestType === 'loan') {
          const currentAmount = loan.amount;
          const currentRate = loan.loanConfig.interestRate || 0;
          const duration = loan.duration;
          const { emiAmount, totalInterest, totalAmount } = calculateEMI(currentAmount, currentRate, duration);

          loan.loanConfig.emiAmount = emiAmount;
          loan.loanConfig.totalInterest = totalInterest;
          loan.loanConfig.totalAmount = totalAmount;
          loan.interestAmount = totalInterest;
          loan.repayment.totalInstallments = duration;
        } else {
          // Salary advance - recalculate per cycle deduction
          loan.advanceConfig.deductionPerCycle = Math.round(loan.amount / loan.duration);
          loan.repayment.totalInstallments = loan.duration;
        }
      }
    }

    // Process based on action
    const historyEntry = {
      step: currentApprover,
      actionBy: req.user._id,
      actionByName: req.user.name,
      actionByRole: userRole,
      comments: comments || '',
      timestamp: new Date(),
    };

    switch (action) {
      case 'approve':
        historyEntry.action = 'approved';

        // Super Admin Bypass Feature: Can approve at any stage (if enabled)
        if (isSuperAdmin && ENABLE_SUPERADMIN_BYPASS) {
          loan.status = 'approved';
          loan.workflow.currentStep = 'completed';
          loan.workflow.nextApprover = null;

          // Legacy status support
          loan.approvals.final = {
            status: 'approved',
            approvedBy: req.user._id,
            approvedAt: new Date(),
            comments: comments || 'Final approval by Super Admin',
          };

          historyEntry.comments = `${comments || ''} (Ultimate Approval by Super Admin)`;
          break;
        }

        console.log('[Loan Approval] Processing approval for:', {
          currentApprover,
          loanId: loan._id,
          currentStatus: loan.status,
          userRole,
          action
        });

        if (currentApprover === 'hod') {
          console.log('[HOD Approval] Setting status to hod_approved');
          loan.status = 'hod_approved';
          loan.approvals.hod = {
            status: 'approved',
            approvedBy: req.user._id,
            approvedAt: new Date(),
            comments,
          };

          // Check if division has manager
          const Division = require('../../departments/model/Division');
          const division = await Division.findById(loan.division_id).populate('manager');

          if (division && division.manager) {
            console.log('[HOD Approval] Division has manager, routing to manager');
            loan.workflow.currentStep = 'manager';
            loan.workflow.nextApprover = 'manager';
          } else {
            console.log('[HOD Approval] No manager, routing to HR');
            loan.workflow.currentStep = 'hr';
            loan.workflow.nextApprover = 'hr';
          }

          console.log('[HOD Approval] Final state:', {
            status: loan.status,
            currentStep: loan.workflow.currentStep,
            nextApprover: loan.workflow.nextApprover
          });
        } else if (currentApprover === 'manager') {
          loan.status = 'manager_approved';
          loan.approvals.manager = {
            status: 'approved',
            approvedBy: req.user._id,
            approvedAt: new Date(),
            comments,
          };
          loan.workflow.currentStep = 'hr';
          loan.workflow.nextApprover = 'hr';
        } else if (currentApprover === 'hr') {
          // HR Approval - Check if HR is the final authority
          const settings = await LoanSettings.findOne({ type: loan.requestType, isActive: true });
          const finalAuth = settings?.workflow?.finalAuthority;

          let isFinalStep = false;

          if (finalAuth && finalAuth.role === 'hr') {
            // HR is configured as final authority
            if (finalAuth.anyHRCanApprove) {
              isFinalStep = true;
            } else if (finalAuth.authorizedHRUsers && finalAuth.authorizedHRUsers.length > 0) {
              isFinalStep = finalAuth.authorizedHRUsers.some(userId =>
                userId.toString() === req.user._id.toString()
              );
            }
          }
          // If HR is NOT final authority, isFinalStep stays false → routes to final_authority

          console.log('[Loan Approval] HR Approval Check:', {
            currentApprover,
            userRole,
            finalAuthRole: finalAuth?.role,
            isFinalStep,
            userId: req.user._id.toString()
          });

          if (isFinalStep) {
            // HR is the final authority - fully approve
            loan.status = 'approved';
            loan.workflow.currentStep = 'completed';
            loan.workflow.nextApprover = null;

            loan.approvals.final = {
              status: 'approved',
              approvedBy: req.user._id,
              approvedAt: new Date(),
              comments,
            };
          } else {
            // HR is NOT final authority - route to final authority (admin)
            loan.status = 'hr_approved';
            loan.workflow.currentStep = 'final';
            loan.workflow.nextApprover = 'final_authority';
          }

          loan.approvals.hr = {
            status: 'approved',
            approvedBy: req.user._id,
            approvedAt: new Date(),
            comments,
          };

        } else if (currentApprover === 'final_authority') {
          // Final Authority Approval - Check if current user is authorized
          const settings = await LoanSettings.findOne({ type: loan.requestType, isActive: true });
          const finalAuth = settings?.workflow?.finalAuthority;

          let isFinalStep = false;

          if (finalAuth) {
            if (finalAuth.role === 'admin' && (userRole === 'super_admin' || userRole === 'sub_admin')) {
              // Admin is final authority and current user is admin
              isFinalStep = true;
            } else if (finalAuth.role === 'hr' && userRole === 'hr') {
              // HR can also be final authority
              if (finalAuth.anyHRCanApprove) {
                isFinalStep = true;
              } else if (finalAuth.authorizedHRUsers && finalAuth.authorizedHRUsers.length > 0) {
                isFinalStep = finalAuth.authorizedHRUsers.some(userId =>
                  userId.toString() === req.user._id.toString()
                );
              }
            } else if (finalAuth.role === 'specific_user') {
              // Check if current user is in the authorized list
              if (finalAuth.authorizedHRUsers && finalAuth.authorizedHRUsers.length > 0) {
                isFinalStep = finalAuth.authorizedHRUsers.some(userId =>
                  userId.toString() === req.user._id.toString()
                );
              }
            }
          } else {
            // No final authority configured - default to admin as final authority
            if (userRole === 'super_admin' || userRole === 'sub_admin') {
              isFinalStep = true;
            }
          }

          console.log('[Loan Approval] Final Authority Check:', {
            currentApprover,
            userRole,
            finalAuthRole: finalAuth?.role,
            isFinalStep,
            userId: req.user._id.toString()
          });

          if (isFinalStep) {
            // This is the final approval
            loan.status = 'approved';
            loan.workflow.currentStep = 'completed';
            loan.workflow.nextApprover = null;

            loan.approvals.final = {
              status: 'approved',
              approvedBy: req.user._id,
              approvedAt: new Date(),
              comments,
            };
          } else {
            // User is not authorized as final authority
            return res.status(403).json({
              success: false,
              error: 'You are not authorized to give final approval for this loan',
            });
          }
        }
        break;

      case 'reject':
        loan.workflow.currentStep = 'completed';
        loan.workflow.nextApprover = null;
        historyEntry.action = 'rejected';

        if (currentApprover === 'hod') {
          loan.status = 'hod_rejected';
          loan.approvals.hod = {
            status: 'rejected',
            approvedBy: req.user._id,
            approvedAt: new Date(),
            comments,
          };
        } else if (currentApprover === 'manager') {
          loan.status = 'manager_rejected';
          loan.approvals.manager = {
            status: 'rejected',
            approvedBy: req.user._id,
            approvedAt: new Date(),
            comments,
          };
        } else {
          loan.status = 'hr_rejected';
          loan.approvals.hr = {
            status: 'rejected',
            approvedBy: req.user._id,
            approvedAt: new Date(),
            comments,
          };
        }
        break;

      case 'forward':
        historyEntry.action = 'forwarded';
        if (currentApprover === 'hod') {
          loan.status = 'hod_approved';
          loan.approvals.hod = {
            status: 'forwarded',
            approvedBy: req.user._id,
            approvedAt: new Date(),
            comments,
          };

          // Logic for manual forward would go here
          loan.workflow.currentStep = 'hr';
          loan.workflow.nextApprover = 'hr';
        }
        break;

      default:
        return res.status(400).json({ success: false, error: 'Invalid action' });
    }

    loan.workflow.history.push(historyEntry);
    await loan.save();

    res.status(200).json({
      success: true,
      message: `Loan application ${action}d successfully`,
      data: loan,
    });
  } catch (error) {
    console.error('Error processing loan action:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process loan action',
    });
  }
};

// @desc    Cancel loan application
// @route   PUT /api/loans/:id/cancel
// @access  Private
exports.cancelLoan = async (req, res) => {
  try {
    const { reason } = req.body;
    const loan = await Loan.findById(req.params.id);

    if (!loan) {
      return res.status(404).json({
        success: false,
        error: 'Loan application not found',
      });
    }

    if (!loan.canCancel()) {
      return res.status(400).json({
        success: false,
        error: 'Loan cannot be cancelled in current status',
      });
    }

    const isOwner = loan.appliedBy.toString() === req.user._id.toString();
    const isAdmin = ['hr', 'sub_admin', 'super_admin'].includes(req.user.role);

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to cancel this loan',
      });
    }

    loan.status = 'cancelled';
    loan.cancellation = {
      cancelledBy: req.user._id,
      cancelledAt: new Date(),
      reason: reason || 'Cancelled by user',
    };
    loan.workflow.currentStep = 'completed';
    loan.workflow.nextApprover = null;
    loan.workflow.history.push({
      step: 'cancellation',
      action: 'cancelled',
      actionBy: req.user._id,
      actionByName: req.user.name,
      actionByRole: req.user.role,
      comments: reason || 'Loan application cancelled',
      timestamp: new Date(),
    });

    await loan.save();

    res.status(200).json({
      success: true,
      message: 'Loan cancelled successfully',
      data: loan,
    });
  } catch (error) {
    console.error('Error cancelling loan:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to cancel loan',
    });
  }
};

// @desc    Disburse loan (mark as disbursed)
// @route   PUT /api/loans/:id/disburse
// @access  Private (HR, Admin)
exports.disburseLoan = async (req, res) => {
  try {
    const { disbursementMethod, transactionReference, remarks } = req.body;
    const loan = await Loan.findById(req.params.id);

    if (!loan) {
      return res.status(404).json({
        success: false,
        error: 'Loan application not found',
      });
    }

    if (loan.status !== 'approved') {
      return res.status(400).json({
        success: false,
        error: 'Only approved loans can be disbursed',
      });
    }

    // Check if all guarantors have accepted
    const pendingGuarantors = loan.guarantors.filter((g) => g.status !== 'accepted');
    if (pendingGuarantors.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot disburse: ${pendingGuarantors.length} guarantor(s) have not yet accepted the request`,
        pendingGuarantors: pendingGuarantors.map((g) => g.name),
      });
    }

    // Only HR and Admin can disburse
    if (!['hr', 'sub_admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to disburse loans',
      });
    }

    loan.status = 'disbursed';
    loan.disbursement = {
      disbursedBy: req.user._id,
      disbursedAt: new Date(),
      disbursementMethod: disbursementMethod || 'bank_transfer',
      transactionReference,
      remarks,
    };

    // Initialize repayment tracking if not exists
    if (!loan.repayment) {
      loan.repayment = {
        totalPaid: 0,
        remainingBalance: loan.requestType === 'loan' ? (loan.loanConfig?.totalAmount || loan.amount) : loan.amount,
        installmentsPaid: 0,
        totalInstallments: loan.duration,
      };
    }

    // Add transaction log for disbursement
    loan.transactions.push({
      transactionType: 'disbursement',
      amount: loan.amount,
      transactionDate: new Date(),
      processedBy: req.user._id,
      remarks: remarks || `${loan.requestType === 'loan' ? 'Loan' : 'Salary advance'} disbursed`,
    });

    loan.workflow.history.push({
      step: 'disbursement',
      action: 'disbursed',
      actionBy: req.user._id,
      actionByName: req.user.name,
      actionByRole: req.user.role,
      comments: remarks || 'Loan disbursed',
      timestamp: new Date(),
    });

    await loan.save();

    await loan.populate([
      { path: 'employeeId', select: 'employee_name emp_no gross_salary' },
      { path: 'disbursement.disbursedBy', select: 'name email' },
    ]);

    res.status(200).json({
      success: true,
      message: 'Loan disbursed successfully',
      data: loan,
    });
  } catch (error) {
    console.error('Error disbursing loan:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to disburse loan',
    });
  }
};

// @desc    Record EMI payment for a loan
// @route   POST /api/loans/:id/pay-emi
// @access  Private (HR, Sub Admin, Super Admin)
exports.payEMI = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, paymentDate, remarks, payrollCycle, isEarlySettlement } = req.body;

    const loan = await Loan.findById(id).populate('employeeId', 'employee_name emp_no gross_salary');

    if (!loan) {
      return res.status(404).json({
        success: false,
        error: 'Loan not found',
      });
    }

    if (loan.requestType !== 'loan') {
      return res.status(400).json({
        success: false,
        error: 'This endpoint is only for loan EMI payments',
      });
    }

    if (!['disbursed', 'active'].includes(loan.status)) {
      return res.status(400).json({
        success: false,
        error: 'Loan must be disbursed or active to record payments',
      });
    }

    let paymentAmount = amount;
    let settlementDetails = null;

    // Handle early settlement
    if (isEarlySettlement) {
      const settlementDate = paymentDate ? new Date(paymentDate) : new Date();
      settlementDetails = calculateEarlySettlement(loan, settlementDate);

      if (!settlementDetails) {
        return res.status(400).json({
          success: false,
          error: 'Unable to calculate early settlement amount',
        });
      }

      paymentAmount = settlementDetails.settlementAmount;
    } else {
      // Regular EMI payment validation
      if (!amount || amount <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Payment amount is required and must be greater than 0',
        });
      }

      // Check if payment exceeds remaining balance
      const remainingBalance = loan.repayment.remainingBalance || loan.loanConfig.totalAmount || loan.amount;
      if (amount > remainingBalance) {
        return res.status(400).json({
          success: false,
          error: `Payment amount(₹${amount}) exceeds remaining balance(₹${remainingBalance})`,
        });
      }
    }

    // Record transaction
    const transaction = {
      transactionType: isEarlySettlement ? 'early_settlement' : 'emi_payment',
      amount: paymentAmount,
      transactionDate: paymentDate ? new Date(paymentDate) : new Date(),
      payrollCycle: payrollCycle || null,
      processedBy: req.user._id,
      remarks: remarks || (isEarlySettlement ? 'Early settlement payment' : 'EMI payment recorded'),
    };

    loan.transactions.push(transaction);

    // Update repayment totals
    loan.repayment.totalPaid = (loan.repayment.totalPaid || 0) + paymentAmount;

    if (isEarlySettlement) {
      // For early settlement, set remaining balance to 0
      loan.repayment.remainingBalance = 0;
      loan.repayment.installmentsPaid = loan.duration; // Mark all installments as paid
    } else {
      loan.repayment.remainingBalance = (loan.loanConfig.totalAmount || loan.amount) - loan.repayment.totalPaid;
      loan.repayment.installmentsPaid = (loan.repayment.installmentsPaid || 0) + 1;
    }

    loan.repayment.lastPaymentDate = transaction.transactionDate;

    // Calculate next payment date (if not fully paid)
    if (loan.repayment.remainingBalance > 0 && loan.loanConfig.startDate && !isEarlySettlement) {
      const monthsPaid = loan.repayment.installmentsPaid;
      const nextDate = new Date(loan.loanConfig.startDate);
      nextDate.setMonth(nextDate.getMonth() + monthsPaid);
      loan.repayment.nextPaymentDate = nextDate;
    } else {
      loan.repayment.nextPaymentDate = null;
    }

    // Update status if fully paid
    if (loan.repayment.remainingBalance <= 0) {
      loan.status = 'completed';
      loan.repayment.remainingBalance = 0;
    } else if (loan.status === 'disbursed') {
      loan.status = 'active';
    }

    await loan.save();

    await loan.populate([
      { path: 'employeeId', select: 'employee_name emp_no gross_salary' },
      { path: 'transactions.processedBy', select: 'name email' },
    ]);

    res.status(200).json({
      success: true,
      message: isEarlySettlement ? 'Early settlement payment recorded successfully' : 'EMI payment recorded successfully',
      data: loan,
      settlementDetails: isEarlySettlement ? settlementDetails : null,
    });
  } catch (error) {
    console.error('Error recording EMI payment:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to record EMI payment',
    });
  }
};

// @desc    Record advance deduction payment
// @route   POST /api/loans/:id/pay-advance
// @access  Private (HR, Sub Admin, Super Admin)
exports.payAdvance = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, paymentDate, remarks, payrollCycle } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Payment amount is required and must be greater than 0',
      });
    }

    const loan = await Loan.findById(id).populate('employeeId', 'employee_name emp_no gross_salary');

    if (!loan) {
      return res.status(404).json({
        success: false,
        error: 'Salary advance not found',
      });
    }

    if (loan.requestType !== 'salary_advance') {
      return res.status(400).json({
        success: false,
        error: 'This endpoint is only for salary advance deductions',
      });
    }

    if (!['disbursed', 'active'].includes(loan.status)) {
      return res.status(400).json({
        success: false,
        error: 'Salary advance must be disbursed or active to record payments',
      });
    }

    // Check if payment exceeds remaining balance
    const remainingBalance = loan.repayment.remainingBalance || loan.amount;
    if (amount > remainingBalance) {
      return res.status(400).json({
        success: false,
        error: `Payment amount(₹${amount}) exceeds remaining balance(₹${remainingBalance})`,
      });
    }

    // Record transaction
    const transaction = {
      transactionType: 'advance_deduction',
      amount: amount,
      transactionDate: paymentDate ? new Date(paymentDate) : new Date(),
      payrollCycle: payrollCycle || null,
      processedBy: req.user._id,
      remarks: remarks || 'Advance deduction recorded',
    };

    loan.transactions.push(transaction);

    // Update repayment totals
    loan.repayment.totalPaid = (loan.repayment.totalPaid || 0) + amount;
    loan.repayment.remainingBalance = loan.amount - loan.repayment.totalPaid;
    loan.repayment.installmentsPaid = (loan.repayment.installmentsPaid || 0) + 1;
    loan.repayment.lastPaymentDate = transaction.transactionDate;

    // Update status if fully paid
    if (loan.repayment.remainingBalance <= 0) {
      loan.status = 'completed';
      loan.repayment.remainingBalance = 0;
    } else if (loan.status === 'disbursed') {
      loan.status = 'active';
    }

    await loan.save();

    await loan.populate([
      { path: 'employeeId', select: 'employee_name emp_no gross_salary' },
      { path: 'transactions.processedBy', select: 'name email' },
    ]);

    res.status(200).json({
      success: true,
      message: 'Advance deduction recorded successfully',
      data: loan,
    });
  } catch (error) {
    console.error('Error recording advance deduction:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to record advance deduction',
    });
  }
};

// @desc    Get early settlement preview for a loan
// @route   GET /api/loans/:id/settlement-preview
// @access  Private
exports.getSettlementPreview = async (req, res) => {
  try {
    const { id } = req.params;
    const { settlementDate } = req.query; // Optional: settlement date (default: now)

    const loan = await Loan.findById(id)
      .populate('employeeId', 'employee_name emp_no gross_salary')
      .select('requestType amount duration loanConfig repayment disbursement appliedAt createdAt status');

    if (!loan) {
      return res.status(404).json({
        success: false,
        error: 'Loan/Advance not found',
      });
    }

    // Only loans have interest calculation
    if (loan.requestType !== 'loan') {
      return res.status(400).json({
        success: false,
        error: 'Early settlement calculation is only available for loans',
      });
    }

    // Check if loan is disbursed/active
    if (!['disbursed', 'active'].includes(loan.status)) {
      return res.status(400).json({
        success: false,
        error: 'Loan must be disbursed or active for settlement calculation',
      });
    }

    const settlementDateObj = settlementDate ? new Date(settlementDate) : new Date();
    const currentSettlement = calculateEarlySettlement(loan, settlementDateObj);

    // Calculate next month settlement
    const nextMonthDate = new Date(settlementDateObj);
    nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
    const nextMonthSettlement = calculateEarlySettlement(loan, nextMonthDate);

    if (!currentSettlement) {
      return res.status(400).json({
        success: false,
        error: 'Unable to calculate settlement amount',
      });
    }

    res.status(200).json({
      success: true,
      data: {
        current: currentSettlement,
        nextMonth: nextMonthSettlement,
        loanDetails: {
          principal: loan.amount,
          originalDuration: loan.duration,
          interestRate: loan.loanConfig?.interestRate || 0,
          originalTotalAmount: loan.loanConfig?.totalAmount || loan.amount,
        },
      },
    });
  } catch (error) {
    console.error('Error calculating settlement preview:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to calculate settlement preview',
    });
  }
};

// @desc    Get transaction history for a loan/advance
// @route   GET /api/loans/:id/transactions
// @access  Private
exports.getTransactions = async (req, res) => {
  try {
    const { id } = req.params;

    const loan = await Loan.findById(id)
      .populate('employeeId', 'employee_name emp_no gross_salary')
      .populate('transactions.processedBy', 'name email')
      .select('transactions requestType amount loanConfig advanceConfig repayment');

    if (!loan) {
      return res.status(404).json({
        success: false,
        error: 'Loan/Advance not found',
      });
    }

    // Sort transactions by date (newest first)
    const transactions = loan.transactions.sort((a, b) => {
      return new Date(b.transactionDate || b.createdAt) - new Date(a.transactionDate || a.createdAt);
    });

    res.status(200).json({
      success: true,
      data: {
        transactions,
        summary: {
          totalAmount: loan.requestType === 'loan' ? (loan.loanConfig.totalAmount || loan.amount) : loan.amount,
          totalPaid: loan.repayment.totalPaid || 0,
          remainingBalance: loan.repayment.remainingBalance || 0,
          installmentsPaid: loan.repayment.installmentsPaid || 0,
          totalInstallments: loan.repayment.totalInstallments || loan.duration,
          requestType: loan.requestType,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch transactions',
    });
  }
};

