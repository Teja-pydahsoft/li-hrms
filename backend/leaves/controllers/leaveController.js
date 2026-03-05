const mongoose = require('mongoose');
const Leave = require('../model/Leave');
const LeaveSettings = require('../model/LeaveSettings');
const Employee = require('../../employees/model/Employee');
const EmployeeHistory = require('../../employees/model/EmployeeHistory');
const User = require('../../users/model/User');
const Settings = require('../../settings/model/Settings');
const { isHRMSConnected, getEmployeeByIdMSSQL } = require('../../employees/config/sqlHelper');
const { getResolvedLeaveSettings } = require('../../departments/controllers/departmentSettingsController');
const {
  updateLeaveForAttendance,
  getLeaveConflicts
} = require('../services/leaveConflictService');
const {
  buildWorkflowVisibilityFilter,
  getEmployeeIdsInScope,
  checkJurisdiction
} = require('../../shared/middleware/dataScopeMiddleware');
const Department = require('../../departments/model/Department');
const leaveRegisterService = require('../services/leaveRegisterService');
const dateCycleService = require('../services/dateCycleService');

/**
 * Get employee settings from database
 */
const getEmployeeSettings = async () => {
  try {
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
 * Always tries MongoDB first (for leave records), then MSSQL if configured
 * If found only in MSSQL, syncs to MongoDB for leave record integrity
 */
const findEmployeeByEmpNo = async (empNo) => {
  if (!empNo) return null;

  // Always try MongoDB first (Leave model needs MongoDB employee references)
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
        // Sync employee from MSSQL to MongoDB for leave record integrity
        // This ensures we have a valid MongoDB _id for the leave record
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

// Helper to find employee by ID or emp_no (legacy support)
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
 * Leave Controller
 * Handles CRUD operations and approval workflow
 */

// Helper function to get workflow settings
const getWorkflowSettings = async () => {
  let settings = await LeaveSettings.getActiveSettings('leave');

  // Return default workflow if no settings found
  if (!settings) {
    return {
      workflow: {
        isEnabled: true,
        steps: [
          { stepOrder: 1, stepName: 'HOD Approval', approverRole: 'hod', availableActions: ['approve', 'reject'], approvedStatus: 'hod_approved', rejectedStatus: 'hod_rejected', nextStepOnApprove: 2, isActive: true },
          { stepOrder: 2, stepName: 'HR Approval', approverRole: 'hr', availableActions: ['approve', 'reject'], approvedStatus: 'approved', rejectedStatus: 'hr_rejected', nextStepOnApprove: null, isActive: true },
        ],
        finalAuthority: { role: 'hr', anyHRCanApprove: true },
      },
      settings: {
        allowBackdated: false,
        maxBackdatedDays: 7,
        allowFutureDated: true,
        maxAdvanceDays: 90,
      },
    };
  }

  return settings;
};

// @desc    Get all leaves (with filters)
// @route   GET /api/leaves
// @access  Private
exports.getLeaves = async (req, res) => {
  try {
    const { status, employeeId, department, fromDate, toDate, page = 1, limit = 20 } = req.query;

    // Multi-layered filter: Jurisdiction (Scope) AND Timing (Workflow)
    const scopeFilter = req.scopeFilter || { isActive: true };
    const workflowFilter = buildWorkflowVisibilityFilter(req.user);

    const filter = {
      $and: [
        scopeFilter,
        workflowFilter,
        { isActive: true }
      ]
    };

    if (status) filter.status = status;
    if (employeeId) filter.employeeId = employeeId;
    if (department) filter.department = department;
    if (fromDate) filter.fromDate = { $gte: new Date(fromDate) };
    if (toDate) filter.toDate = { ...filter.toDate, $lte: new Date(toDate) };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [leaves, total] = await Promise.all([
      Leave.find(filter)
        .populate('employeeId', 'employee_name emp_no')
        .populate('department', 'name')
        .populate('designation', 'name')
        .populate('appliedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Leave.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      count: leaves.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      data: leaves,
    });
  } catch (error) {
    console.error('Error fetching leaves:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch leaves',
    });
  }
};

// @desc    Get my leaves (for logged-in employee)
// @route   GET /api/leaves/my
// @access  Private
// Returns leaves applied BY me OR leaves applied FOR me (by HOD/Manager/HR on my behalf)
exports.getMyLeaves = async (req, res) => {
  try {
    const { status, fromDate, toDate } = req.query;
    const orConditions = [{ appliedBy: req.user._id }];

    // Leaves applied FOR me (by HOD/Manager/HR) - match by employeeId or emp_no
    if (req.user.employeeRef) {
      orConditions.push({ employeeId: req.user.employeeRef });
    }
    if (req.user.employeeId) {
      orConditions.push({ emp_no: String(req.user.employeeId).trim() });
    }
    // Fallback: User may have emp_no but no employeeRef - resolve Employee by emp_no
    if (!req.user.employeeRef && req.user.employeeId) {
      const emp = await Employee.findOne({
        $or: [
          { emp_no: String(req.user.employeeId).trim() },
          { emp_no: { $regex: new RegExp(`^${String(req.user.employeeId).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }
        ]
      }).select('_id');
      if (emp) orConditions.push({ employeeId: emp._id });
    }

    const filter = {
      isActive: true,
      $or: orConditions,
    };

    if (status) filter.status = status;
    if (fromDate) filter.fromDate = { $gte: new Date(fromDate) };
    if (toDate) filter.toDate = { ...filter.toDate, $lte: new Date(toDate) };

    const leaves = await Leave.find(filter)
      .populate('employeeId', 'employee_name emp_no')
      .populate('department', 'name')
      .populate('designation', 'name')
      .populate('appliedBy', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: leaves.length,
      data: leaves,
    });
  } catch (error) {
    console.error('Error fetching my leaves:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch leaves',
    });
  }
};

// @desc    Get single leave
// @route   GET /api/leaves/:id
// @access  Private
exports.getLeave = async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id)
      .populate('employeeId', 'employee_name emp_no email phone_number')
      .populate('department', 'name code')
      .populate('designation', 'name')
      .populate('appliedBy', 'name email')
      .populate('workflow.history.actionBy', 'name email')
      .populate('approvals.hod.approvedBy', 'name email')
      .populate('approvals.hr.approvedBy', 'name email')
      .populate('approvals.final.approvedBy', 'name email');

    if (!leave) {
      return res.status(404).json({
        success: false,
        error: 'Leave application not found',
      });
    }

    // Get splits if leave has been split
    let splits = null;
    let splitSummary = null;
    if (leave.splitStatus === 'split_approved') {
      const leaveSplitService = require('../services/leaveSplitService');
      splits = await leaveSplitService.getSplits(leave._id);
      splitSummary = await leaveSplitService.getSplitSummary(leave._id);
    }

    const leaveData = leave.toObject();
    if (splits) {
      leaveData.splits = splits;
    }
    if (splitSummary) {
      leaveData.splitSummary = splitSummary;
    }

    res.status(200).json({
      success: true,
      data: leaveData,
    });
  } catch (error) {
    console.error('Error fetching leave:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch leave',
    });
  }
};

// @desc    Apply for leave
// @route   POST /api/leaves
// @access  Private
exports.applyLeave = async (req, res) => {
  try {
    const {
      leaveType,
      fromDate,
      toDate,
      purpose,
      contactNumber,
      emergencyContact,
      addressDuringLeave,
      isHalfDay,
      halfDayType,
      remarks,
      empNo, // Primary - emp_no for applying on behalf
      employeeId, // Legacy - for backward compatibility
    } = req.body;

    // Validate dates against leave policy settings
    const leaveSettings = await LeaveSettings.getActiveSettings('leave');
    const leavePolicy = leaveSettings?.settings || {
      allowBackdated: false,
      maxBackdatedDays: 7,
      allowFutureDated: true,
      maxAdvanceDays: 90,
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkFromDate = new Date(fromDate);
    checkFromDate.setHours(0, 0, 0, 0);

    // Super admin bypasses date restrictions
    const isSuperAdmin = req.user?.role === 'super_admin';

    if (!isSuperAdmin) {
      if (checkFromDate < today) {
        // Past date – check if backdating is allowed
        if (!leavePolicy.allowBackdated) {
          return res.status(400).json({
            success: false,
            error: 'Backdated leave applications are not allowed.',
          });
        }
        const diffDays = Math.floor((today - checkFromDate) / (1000 * 60 * 60 * 24));
        if (diffDays > leavePolicy.maxBackdatedDays) {
          return res.status(400).json({
            success: false,
            error: `Leave can only be backdated up to ${leavePolicy.maxBackdatedDays} day(s). The selected date is ${diffDays} day(s) ago.`,
          });
        }
      } else if (checkFromDate > today) {
        // Future date – check if future-dated applications are allowed
        if (!leavePolicy.allowFutureDated) {
          return res.status(400).json({
            success: false,
            error: 'Future-dated leave applications are not allowed.',
          });
        }
        const diffDays = Math.floor((checkFromDate - today) / (1000 * 60 * 60 * 24));
        if (diffDays > leavePolicy.maxAdvanceDays) {
          return res.status(400).json({
            success: false,
            error: `Leave can only be applied up to ${leavePolicy.maxAdvanceDays} day(s) in advance. The selected date is ${diffDays} day(s) away.`,
          });
        }
      }
    }

    // Get employee - either from request body (HR applying for someone) or from user
    let employee;

    // Use empNo as primary identifier (from frontend)
    if (empNo) {
      // Check if this is actually a self-application (Manager applying for self via dropdown)
      const isSelf = req.user.emp_no && (req.user.emp_no === empNo || req.user.emp_no.toLowerCase() === empNo.toLowerCase());

      // Check if user has permission to apply for others
      // Allow hod, hr, sub_admin, super_admin, manager (backward compatibility)
      const allowedRoles = ['hod', 'hr', 'sub_admin', 'super_admin', 'manager'];
      const userRole = req.user.role ? req.user.role.toLowerCase() : '';
      const hasRolePermission = allowedRoles.includes(userRole) || isSelf;

      console.log(`[Apply Leave] User ${req.user._id} (${req.user.role}) applying for employee ${empNo}`);
      console.log(`[Apply Leave] Has role permission: ${hasRolePermission} `);

      // Check workspace permissions if user has active workspace
      let hasWorkspacePermission = false;
      if (req.user.activeWorkspaceId) {
        try {
          const leaveSettings = await LeaveSettings.findOne({ type: 'leave', isActive: true });
          if (leaveSettings?.settings?.workspacePermissions) {
            const workspaceIdStr = String(req.user.activeWorkspaceId);
            const permissions = leaveSettings.settings.workspacePermissions[workspaceIdStr];

            console.log(`[Apply Leave] Checking workspace ${workspaceIdStr} permissions: `, permissions);

            if (permissions) {
              // Handle both old format (boolean) and new format (object)
              if (typeof permissions === 'boolean') {
                hasWorkspacePermission = permissions; // Old format: boolean means canApplyForOthers
              } else {
                hasWorkspacePermission = permissions.canApplyForOthers || false; // New format
              }
            }
          } else {
            console.log(`[Apply Leave] No workspace permissions found in settings`);
          }
        } catch (error) {
          console.error('[Apply Leave] Error checking workspace permissions:', error);
        }
      } else {
        console.log(`[Apply Leave] User has no active workspace`);
      }

      console.log(`[Apply Leave] Has workspace permission: ${hasWorkspacePermission} `);

      // User must have either role permission OR workspace permission
      if (!hasRolePermission && !hasWorkspacePermission) {
        console.log(`[Apply Leave] ❌ Authorization denied - no role or workspace permission`);
        return res.status(403).json({
          success: false,
          error: 'Not authorized to apply leave for others',
        });
      }

      console.log(`[Apply Leave] ✅ Authorization granted`);

      // Find employee by emp_no (checks MongoDB first, then MSSQL based on settings)
      employee = await findEmployeeByEmpNo(empNo);

      if (employee) {
        // Populate division and department to get names for snapshotting
        await employee.populate([
          { path: 'division_id', select: 'name' },
          { path: 'department_id', select: 'name' }
        ]);
      }

      // Enforce HOD & Manager Scope (use User model for non-employee roles)
      if (['manager', 'hod'].includes(req.user.role) && employee) {
        // 1. Allow Self Application
        // Check if the target employee is the manager themselves
        const isSelf = (req.user.employeeId && req.user.employeeId.toString() === employee._id.toString()) ||
          (req.user.employeeRef && req.user.employeeRef.toString() === employee._id.toString());

        if (!isSelf) {
          // For non-employee roles, use User model (ensure full User with divisionMapping)
          const scopeUser = await User.findById(req.user._id).select('role divisionMapping').lean();
          const userForScope = scopeUser || req.user;
          let scopedEmployeeIds = await getEmployeeIdsInScope(userForScope);
          const employeeIdStr = employee._id.toString();
          let isInScope = scopedEmployeeIds.some(id => id.toString() === employeeIdStr);

          // Fallback for HOD: if divisionMapping empty, check Department.divisionHODs
          if (!isInScope && req.user.role === 'hod') {
            const empDeptId = (employee.department_id?._id || employee.department_id)?.toString();
            const empDivId = (employee.division_id?._id || employee.division_id)?.toString();
            if (empDeptId && empDivId) {
              const dept = await Department.findOne({
                _id: empDeptId,
                'divisionHODs.hod': req.user._id,
                'divisionHODs.division': empDivId
              }).select('_id');
              isInScope = !!dept;
            }
          }

          // Allow if current user is the reporting manager of this employee (apply on behalf of reportee)
          if (!isInScope && employee) {
            const reportingManagers = employee.dynamicFields?.reporting_to || employee.dynamicFields?.reporting_to_ || [];
            if (Array.isArray(reportingManagers) && reportingManagers.length > 0) {
              const reportingManagerIds = reportingManagers.map(m => (m._id || m).toString());
              const userStr = req.user._id?.toString();
              const userEmployeeIdStr = (req.user.employeeId || req.user.employeeRef)?.toString();
              if ((userStr && reportingManagerIds.includes(userStr)) ||
                  (userEmployeeIdStr && reportingManagerIds.includes(userEmployeeIdStr))) {
                isInScope = true;
                console.log(`[Apply Leave] ✅ User ${req.user._id} is reporting manager for employee ${empNo}`);
              }
            }
          }

          if (!isInScope) {
            console.log(`[Apply Leave] ❌ ${req.user.role} ${req.user._id} blocked - employee ${empNo} not in scope.`);
            return res.status(403).json({
              success: false,
              error: `You are not authorized to apply for employees outside your assigned data scope (Division/Department).`,
            });
          }
        }
      }
    } else if (employeeId) {
      // Legacy: Check if user has permission to apply for others
      // Allow hod, hr, sub_admin, super_admin, manager (backward compatibility)

      // Check if this is self-application
      const isSelf = req.user.employeeRef && req.user.employeeRef.toString() === employeeId.toString();

      const hasRolePermission = ['hod', 'hr', 'sub_admin', 'super_admin', 'manager'].includes(req.user.role) || isSelf;

      console.log(`[Apply Leave] User ${req.user._id} (${req.user.role}) applying for employee ${employeeId}(legacy)`);
      console.log(`[Apply Leave] Has role permission: ${hasRolePermission} `);

      // Check workspace permissions if user has active workspace
      let hasWorkspacePermission = false;
      if (req.user.activeWorkspaceId) {
        try {
          const leaveSettings = await LeaveSettings.findOne({ type: 'leave', isActive: true });
          if (leaveSettings?.settings?.workspacePermissions) {
            const workspaceIdStr = String(req.user.activeWorkspaceId);
            const permissions = leaveSettings.settings.workspacePermissions[workspaceIdStr];

            console.log(`[Apply Leave] Checking workspace ${workspaceIdStr} permissions: `, permissions);

            if (permissions) {
              // Handle both old format (boolean) and new format (object)
              if (typeof permissions === 'boolean') {
                hasWorkspacePermission = permissions; // Old format: boolean means canApplyForOthers
              } else {
                hasWorkspacePermission = permissions.canApplyForOthers || false; // New format
              }
            }
          }
        } catch (error) {
          console.error('[Apply Leave] Error checking workspace permissions:', error);
        }
      }

      console.log(`[Apply Leave] Has workspace permission: ${hasWorkspacePermission} `);

      // User must have either role permission OR workspace permission
      if (!hasRolePermission && !hasWorkspacePermission) {
        console.log(`[Apply Leave] ❌ Authorization denied - no role or workspace permission`);
        return res.status(403).json({
          success: false,
          error: 'Not authorized to apply leave for others',
        });
      }

      console.log(`[Apply Leave] ✅ Authorization granted`);

      // Find employee by ID or emp_no
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

    // Populate division, department, designation so we have names for snapshot (avoids saving 'N/A')
    await employee.populate([
      { path: 'division_id', select: 'name' },
      { path: 'department_id', select: 'name' },
      { path: 'designation_id', select: 'name' },
    ]);

    // Get workflow settings
    const workflowSettings = await getWorkflowSettings();

    // Get resolved leave settings (department + global fallback)
    let resolvedLeaveSettings = null;
    if (employee.department_id) {
      resolvedLeaveSettings = await getResolvedLeaveSettings(employee.department_id, employee.division_id);
    }

    // Calculate number of days
    const from = new Date(fromDate);
    const to = new Date(toDate);
    let numberOfDays;

    if (isHalfDay) {
      numberOfDays = 0.5;
    } else {
      const diffTime = Math.abs(to - from);
      numberOfDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    }

    // Check leave limits using resolved settings - WARN ONLY, don't block
    const limitWarnings = [];
    if (resolvedLeaveSettings) {
      // Check daily limit (if set, 0 = unlimited)
      if (resolvedLeaveSettings.dailyLimit !== null && resolvedLeaveSettings.dailyLimit > 0) {
        if (numberOfDays > resolvedLeaveSettings.dailyLimit) {
          limitWarnings.push(`Leave duration(${numberOfDays} days) exceeds the recommended daily limit of ${resolvedLeaveSettings.dailyLimit} day(s) per application`);
        }
      }

      // Check monthly limit (if set, 0 = unlimited)
      if (resolvedLeaveSettings.monthlyLimit !== null && resolvedLeaveSettings.monthlyLimit > 0) {
        // Get month and year from fromDate
        const month = from.getMonth() + 1;
        const year = from.getFullYear();

        // Count approved/pending leaves for this employee in this month
        const Leave = require('../model/Leave');
        const monthStart = new Date(year, month - 1, 1);
        const monthEnd = new Date(year, month, 0, 23, 59, 59);

        const existingLeaves = await Leave.find({
          employeeId: employee._id,
          fromDate: { $gte: monthStart, $lte: monthEnd },
          status: { $in: ['pending', 'hod_approved', 'hr_approved', 'approved'] },
          isActive: true,
        });

        const totalDaysThisMonth = existingLeaves.reduce((sum, l) => sum + (l.numberOfDays || 0), 0);
        const newTotal = totalDaysThisMonth + numberOfDays;

        if (newTotal > resolvedLeaveSettings.monthlyLimit) {
          limitWarnings.push(`Total leave days for this month(${newTotal} days) would exceed the recommended monthly limit of ${resolvedLeaveSettings.monthlyLimit} days.Current month total: ${totalDaysThisMonth} days`);
        }
      }

      // STRICT ENFORCEMENT for Casual Leave (CL) - max per month (when settings exist)
      if (leaveType === 'CL' && resolvedLeaveSettings) {
        if (resolvedLeaveSettings.maxCasualLeavesPerMonth !== null && resolvedLeaveSettings.maxCasualLeavesPerMonth > 0) {
          if (numberOfDays > resolvedLeaveSettings.maxCasualLeavesPerMonth) {
            return res.status(400).json({
              success: false,
              error: `Casual Leave usage is restricted to ${resolvedLeaveSettings.maxCasualLeavesPerMonth} day(s) per month for your department.`
            });
          }
        }
      }
    }

    // HARD ENFORCEMENT for Casual Leave (CL) against payroll-cycle monthly limit (including pending locks)
    if (leaveType === 'CL') {
      try {
        const periodInfo = await dateCycleService.getPeriodInfo(from);

        // Use payroll-cycle month/year derived from fromDate, not calendar month
        const registerResult = await leaveRegisterService.getLeaveRegister(
          {
            employeeId: employee._id,
            leaveType: 'CL',
            balanceAsOf: true,
          },
          periodInfo.payrollCycle.month,
          periodInfo.payrollCycle.year
        );

        const clEntry = Array.isArray(registerResult?.data) ? registerResult.data.find(e => e.casualLeave) : null;
        const allowedRemaining = clEntry?.casualLeave?.allowedRemaining ?? null;

        if (allowedRemaining !== null && allowedRemaining !== undefined) {
          if (numberOfDays > allowedRemaining) {
            return res.status(400).json({
              success: false,
              error: `Casual Leave monthly limit exceeded for this payroll cycle. Remaining allowed days: ${allowedRemaining}, requested: ${numberOfDays}.`,
            });
          }
        }
      } catch (err) {
        console.error('[Apply Leave] Error enforcing CL monthly payroll-cycle limit:', err);
      }
    }

    // CL balance is validated on the frontend only; backend does not enforce balance check here.

    // Enforce minGapBetweenLeaves from leave settings (gap between approved leaves and this request)
    const minGap = leavePolicy.minGapBetweenLeaves;
    if (minGap != null && minGap > 0) {
      const Leave = require('../model/Leave');
      const approvedLeaves = await Leave.find({
        employeeId: employee._id,
        status: 'approved',
        isActive: true,
      }).select('fromDate toDate').lean();

      const fromDay = new Date(from);
      fromDay.setHours(0, 0, 0, 0);
      const toDay = new Date(to);
      toDay.setHours(23, 59, 59, 999);

      for (const existing of approvedLeaves) {
        const exFrom = new Date(existing.fromDate);
        exFrom.setHours(0, 0, 0, 0);
        const exTo = new Date(existing.toDate);
        exTo.setHours(23, 59, 59, 999);

        if (exTo < fromDay) {
          const gapMs = fromDay - exTo;
          const gapDays = Math.floor(gapMs / (1000 * 60 * 60 * 24));
          if (gapDays < minGap) {
            return res.status(400).json({
              success: false,
              error: `There must be at least ${minGap} day(s) between leaves. Your last approved leave ends ${gapDays} day(s) before the selected start date.`,
            });
          }
        } else if (exFrom > toDay) {
          const gapMs = exFrom - toDay;
          const gapDays = Math.floor(gapMs / (1000 * 60 * 60 * 24));
          if (gapDays < minGap) {
            return res.status(400).json({
              success: false,
              error: `There must be at least ${minGap} day(s) between leaves. Your next approved leave starts ${gapDays} day(s) after the selected end date.`,
            });
          }
        }
      }
    }

    // Validate against OD conflicts (with half-day support) - Only check APPROVED records for creation
    const { validateLeaveRequest } = require('../../shared/services/conflictValidationService');
    const validation = await validateLeaveRequest(
      employee._id,
      employee.emp_no,
      from,
      to,
      isHalfDay || false,
      isHalfDay ? halfDayType : null,
      true // approvedOnly = true for creation
    );

    // Block if there are errors (approved conflicts), but allow if only warnings (non-approved conflicts)
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: validation.errors[0] || 'Validation failed',
        validationErrors: validation.errors,
        warnings: validation.warnings,
        conflictingODs: validation.conflictingODs,
      });
    }

    // Store warnings to include in success response
    const warnings = [...(validation.warnings || []), ...limitWarnings];

    // Create leave application

    // Initialize Workflow (Dynamic)
    const approvalSteps = [];
    const reportingManagers = employee.dynamicFields?.reporting_to || employee.dynamicFields?.reporting_to_ || [];
    const hasReportingManager = Array.isArray(reportingManagers) && reportingManagers.length > 0;

    // 1. Prioritize Reporting Manager if configured or available
    if (hasReportingManager) {
      approvalSteps.push({
        stepOrder: 1,
        role: 'reporting_manager',
        label: 'Reporting Manager Approval',
        status: 'pending',
        isCurrent: true
      });
    } else {
      // Fallback to HOD as per requirements
      approvalSteps.push({
        stepOrder: 1,
        role: 'hod',
        label: 'HOD Approval',
        status: 'pending',
        isCurrent: true
      });
    }

    // 2. Add other steps from settings, avoiding duplicate HOD if it's already first
    if (workflowSettings?.workflow?.steps && workflowSettings.workflow.steps.length > 0) {
      workflowSettings.workflow.steps.forEach(step => {
        // Skip if it's HOD (we already added it as first) or if it's disabled
        if (step.approverRole !== 'hod') {
          approvalSteps.push({
            stepOrder: approvalSteps.length + 1,
            role: step.approverRole,
            label: step.stepName || `${step.approverRole.toUpperCase()} Approval`,
            status: 'pending',
            isCurrent: false
          });
        }
      });
    }

    let workflowData = {
      currentStepRole: approvalSteps[0]?.role || 'hod',
      nextApproverRole: approvalSteps[0]?.role || 'hod',
      currentStep: approvalSteps[0]?.role || 'hod', // Legacy
      nextApprover: approvalSteps[0]?.role || 'hod', // Legacy
      approvalChain: approvalSteps,
      finalAuthority: workflowSettings?.workflow?.finalAuthority?.role || 'hr',
      reportingManagerIds: hasReportingManager ? reportingManagers.map(m => (m._id || m).toString()) : [],
      history: [
        {
          step: 'employee',
          action: 'submitted',
          actionBy: req.user._id,
          actionByName: req.user.name,
          actionByRole: req.user.role,
          comments: 'Leave application submitted',
          timestamp: new Date(),
        },
      ],
    };

    // Create leave application
    const leave = new Leave({
      employeeId: employee._id,
      emp_no: employee.emp_no,
      leaveType,
      fromDate: from,
      toDate: to,
      numberOfDays,
      isHalfDay: isHalfDay || false,
      halfDayType: isHalfDay ? halfDayType : null,
      purpose,
      contactNumber,
      emergencyContact,
      division_id: employee.division_id?._id || employee.division_id, // Save division at time of application
      division_name: employee.division_id?.name || '',
      department: employee.department_id?._id || employee.department_id || employee.department, // Support both field names
      department_id: employee.department_id?._id || employee.department_id,
      department_name: employee.department_id?.name || '',
      designation: employee.designation_id || employee.designation, // Support both field names
      appliedBy: req.user._id,
      appliedAt: new Date(),
      status: 'pending',
      remarks,
      workflow: workflowData
    });

    await leave.save();

    // Employee history: leave applied
    try {
      await EmployeeHistory.create({
        emp_no: employee.emp_no,
        event: 'leave_applied',
        performedBy: req.user._id,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        details: {
          leaveId: leave._id,
          fromDate: leave.fromDate,
          toDate: leave.toDate,
          numberOfDays: leave.numberOfDays,
          isHalfDay: leave.isHalfDay,
          halfDayType: leave.halfDayType,
        },
        comments: remarks || 'Leave applied',
      });
    } catch (err) {
      console.error('Failed to log leave applied history:', err.message);
    }

    // Populate for response
    await leave.populate([
      { path: 'employeeId', select: 'first_name last_name emp_no' },
      { path: 'department', select: 'name' },
      { path: 'designation', select: 'name' },
    ]);

    res.status(201).json({
      success: true,
      message: 'Leave application submitted successfully',
      data: leave,
      warnings: warnings.length > 0 ? warnings : undefined, // Include warnings if any
    });
  } catch (error) {
    console.error('Error applying leave:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to apply for leave',
    });
  }
};

// @desc    Update leave application
// @route   PUT /api/leaves/:id
// @access  Private
exports.updateLeave = async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id);

    if (!leave) {
      return res.status(404).json({
        success: false,
        error: 'Leave application not found',
      });
    }

    // Check if can edit - Allow editing for pending, hod_approved, hr_approved (not final approved)
    // Super Admin can edit any status except final approved
    const isSuperAdmin = req.user.role === 'super_admin';
    const isFinalApproved = leave.status === 'approved';

    if (isFinalApproved && !isSuperAdmin) {
      return res.status(400).json({
        success: false,
        error: 'Final approved leave cannot be edited',
      });
    }

    // Check ownership or admin permission
    const isOwner = leave.appliedBy.toString() === req.user._id.toString();
    const isAdmin = ['hr', 'sub_admin', 'super_admin'].includes(req.user.role);

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to update this leave',
      });
    }

    const allowedUpdates = [
      'leaveType', 'fromDate', 'toDate', 'purpose', 'contactNumber',
      'emergencyContact', 'addressDuringLeave', 'isHalfDay', 'halfDayType', 'remarks'
    ];

    // Super Admin can also change status
    if (isSuperAdmin && req.body.status !== undefined) {
      const oldStatus = leave.status;
      const newStatus = req.body.status;

      if (oldStatus !== newStatus) {
        allowedUpdates.push('status');

        // Add status change to timeline
        if (!leave.workflow.history) {
          leave.workflow.history = [];
        }
        leave.workflow.history.push({
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
          leave.workflow.currentStep = 'hod';
          leave.workflow.nextApprover = 'hod';
        } else if (newStatus === 'hod_approved') {
          leave.workflow.currentStep = 'hr';
          leave.workflow.nextApprover = 'hr';
        } else if (newStatus === 'hr_approved') {
          leave.workflow.currentStep = 'final';
          leave.workflow.nextApprover = 'final_authority';
        } else if (newStatus === 'approved') {
          leave.workflow.currentStep = 'completed';
          leave.workflow.nextApprover = null;
        }
      }
    }

    // Clean up enum fields - convert empty strings to null
    if (req.body.halfDayType !== undefined) {
      if (req.body.halfDayType === '' || req.body.halfDayType === null) {
        req.body.halfDayType = null;
      }
    }

    // Track changes (max 2-3 changes)
    const changes = [];
    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined && leave[field] !== req.body[field]) {
        const originalValue = leave[field];
        let newValue = req.body[field];

        // Convert empty strings to null for enum fields
        if (field === 'halfDayType' && (newValue === '' || newValue === null)) {
          newValue = null;
        }

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

        leave[field] = newValue;
      }
    });

    // Add changes to history (keep only last 2-3 changes)
    if (changes.length > 0) {
      if (!leave.changeHistory) {
        leave.changeHistory = [];
      }
      leave.changeHistory.push(...changes);
      // Keep only last 3 changes
      if (leave.changeHistory.length > 3) {
        leave.changeHistory = leave.changeHistory.slice(-3);
      }
    }

    // Recalculate days if dates changed
    if (req.body.fromDate || req.body.toDate || req.body.isHalfDay !== undefined) {
      if (leave.isHalfDay) {
        leave.numberOfDays = 0.5;
      } else {
        const diffTime = Math.abs(leave.toDate - leave.fromDate);
        leave.numberOfDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      }
    }

    await leave.save();

    // Populate for response
    await leave.populate([
      { path: 'employeeId', select: 'employee_name emp_no' },
      { path: 'department', select: 'name' },
      { path: 'designation', select: 'name' },
      { path: 'changeHistory.modifiedBy', select: 'name email role' },
    ]);

    res.status(200).json({
      success: true,
      message: 'Leave updated successfully',
      data: leave,
      changes: changes,
    });
  } catch (error) {
    console.error('Error updating leave:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update leave',
    });
  }
};

// @desc    Cancel leave application
// @route   PUT /api/leaves/:id/cancel
// @access  Private
exports.cancelLeave = async (req, res) => {
  try {
    const { reason } = req.body;
    const leave = await Leave.findById(req.params.id);

    if (!leave) {
      return res.status(404).json({
        success: false,
        error: 'Leave application not found',
      });
    }

    // Check if can cancel
    if (!leave.canCancel()) {
      return res.status(400).json({
        success: false,
        error: 'Leave cannot be cancelled in current status',
      });
    }

    // Check ownership or admin permission
    const isOwner = leave.appliedBy.toString() === req.user._id.toString();
    const isAdmin = ['hr', 'sub_admin', 'super_admin'].includes(req.user.role);

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to cancel this leave',
      });
    }

    leave.status = 'cancelled';
    leave.cancellation = {
      cancelledBy: req.user._id,
      cancelledAt: new Date(),
      reason: reason || 'Cancelled by user',
    };
    leave.workflow.currentStep = 'completed';
    leave.workflow.nextApprover = null;
    leave.workflow.history.push({
      step: 'cancellation',
      action: 'cancelled',
      actionBy: req.user._id,
      actionByName: req.user.name,
      actionByRole: req.user.role,
      comments: reason || 'Leave application cancelled',
      timestamp: new Date(),
    });

    await leave.save();

    res.status(200).json({
      success: true,
      message: 'Leave cancelled successfully',
      data: leave,
    });
  } catch (error) {
    console.error('Error cancelling leave:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to cancel leave',
    });
  }
};

// @desc    Get pending approvals for current user
// @route   GET /api/leaves/pending-approvals
// @access  Private
// Query: page, limit, search, leaveType, fromDate, toDate, department, division
// Data scope: Show leaves to ALL workflow participants (roles in approvalChain) with division/department scope.
exports.getPendingApprovals = async (req, res) => {
  try {
    const userRole = req.user.role;
    const { page = 1, limit = 20, search, leaveType, fromDate, toDate, department, division, designation } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    // Base filter: Active AND Not Applied by Me (Self-requests go to "My Leaves")
    let filter = {
      isActive: true,
      appliedBy: { $ne: req.user._id }
    };

    // 1. Super Admin / Sub Admin: View all non-final leaves
    if (['sub_admin', 'super_admin'].includes(userRole)) {
      filter.status = { $nin: ['approved', 'rejected', 'cancelled'] };
    }
    // 2, 3, 4: Scoped Roles (HOD, HR, Manager)
    else if (['hod', 'hr', 'manager'].includes(userRole)) {
      const roleVariants = [userRole];
      if (userRole === 'hr') roleVariants.push('final_authority');
      filter['$or'] = [
        { 'workflow.approvalChain': { $elemMatch: { role: { $in: roleVariants } } } },
        { 'workflow.reportingManagerIds': req.user._id.toString() }
      ];
      const employeeIds = await getEmployeeIdsInScope(req.user);
      if (employeeIds.length > 0) {
        filter.employeeId = { $in: employeeIds };
      } else {
        filter.employeeId = { $in: [] };
      }
      filter.status = { $nin: ['approved', 'rejected', 'cancelled'] };
    }
    else {
      filter['$or'] = [
        { 'workflow.approvalChain': { $elemMatch: { role: userRole } } },
        { 'workflow.reportingManagerIds': req.user._id.toString() }
      ];
      filter.status = { $nin: ['approved', 'rejected', 'cancelled'] };
    }

    // Apply query filters
    if (leaveType) filter.leaveType = leaveType;
    if (fromDate) {
      filter.fromDate = filter.fromDate || {};
      filter.fromDate.$gte = new Date(fromDate);
    }
    if (toDate) {
      filter.toDate = filter.toDate || {};
      filter.toDate.$lte = new Date(toDate);
    }
    if (department) filter.department = department;
    if (division) filter.division_id = division;
    if (designation) filter.designation = designation;

    // Search: by emp_no or employee name (resolve employee ids first)
    if (search && String(search).trim()) {
      const searchStr = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(searchStr, 'i');
      const matchedEmployees = await Employee.find({
        $or: [
          { emp_no: regex },
          { employee_name: regex },
          { first_name: regex },
          { last_name: regex }
        ]
      }).select('_id').lean();
      const ids = matchedEmployees.map(e => e._id);
      if (ids.length > 0) {
        const scopeIds = filter.employeeId && filter.employeeId.$in ? filter.employeeId.$in : null;
        filter.employeeId = scopeIds
          ? { $in: scopeIds.filter(id => ids.some(i => i.toString() === id.toString())) }
          : { $in: ids };
      } else {
        filter.employeeId = { $in: [] };
      }
    }

    const [leaves, total] = await Promise.all([
      Leave.find(filter)
        .populate('employeeId', 'employee_name emp_no first_name last_name')
        .populate('department', 'name')
        .populate('designation', 'name')
        .sort({ appliedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Leave.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      count: leaves.length,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      data: leaves,
    });
  } catch (error) {
    console.error('Error fetching pending approvals:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch pending approvals',
    });
  }
};

// @desc    Process leave action (approve/reject/forward)
// @route   PUT /api/leaves/:id/action
// @access  Private (HOD, HR, Admin)
exports.processLeaveAction = async (req, res) => {
  try {
    const { action, comments } = req.body;
    const leave = await Leave.findById(req.params.id);

    if (!leave) {
      return res.status(404).json({
        success: false,
        error: 'Leave application not found',
      });
    }

    const userRole = req.user.role;

    // Identify the current active step from the approval chain
    // We look for the first 'pending' step.
    let activeStepIndex = -1;
    let activeStep = null;

    if (leave.workflow && leave.workflow.approvalChain && leave.workflow.approvalChain.length > 0) {
      activeStepIndex = leave.workflow.approvalChain.findIndex(step => step.status === 'pending');
      if (activeStepIndex !== -1) {
        activeStep = leave.workflow.approvalChain[activeStepIndex];
      }
    }

    // If no approval chain or no pending step, fallback to legacy checks or return error
    if (!activeStep) {
      // Check if already approved/rejected
      if (['approved', 'rejected', 'cancelled'].includes(leave.status)) {
        return res.status(400).json({
          success: false,
          error: `Leave is already ${leave.status}`,
        });
      }

      // Try to construct a temporary active step based on nextApprover legacy field
      if (leave.workflow.nextApprover) {
        activeStep = { role: leave.workflow.nextApprover };
      } else {
        return res.status(400).json({
          success: false,
          error: 'No active approval step found for this leave.',
        });
      }
    }

    const requiredRole = activeStep.role;

    // --- Authorization Check ---
    let canProcess = false;

    // 1. Check exact role match
    if (userRole === requiredRole) {
      canProcess = true;
    }

    // 2. Specific Logic for Roles
    if (requiredRole === 'hod') {
      if (userRole === 'hod') {
        const leaveDeptId = (leave.department_id || leave.department)?.toString();
        const leaveDivId = (leave.division_id || leave.division)?.toString();
        const mapping = req.user.divisionMapping?.find(m =>
          (m.division?._id || m.division)?.toString() === leaveDivId
        );
        canProcess = mapping
          ? (!mapping.departments || mapping.departments.length === 0) || mapping.departments.some(d => (d?._id || d).toString() === leaveDeptId)
          : false;
      }
    } else if (requiredRole === 'reporting_manager') {
      // 1. Check if user is the assigned Reporting Manager
      const Employee = require('../../employees/model/Employee');
      const targetEmployee = await Employee.findById(leave.employeeId);
      const managers = targetEmployee?.dynamicFields?.reporting_to;

      if (managers && Array.isArray(managers) && managers.length > 0) {
        const userIdStr = (req.user._id || req.user.userId).toString();
        canProcess = managers.some(m => (m._id || m).toString() === userIdStr);
      }

      // 2. Fallback to HOD if no managers assigned OR if user is an HOD for the employee
      if (!canProcess) {
        const isActuallyHOD = userRole === 'hod';
        if (isActuallyHOD) {
          const leaveDeptId = (leave.department_id || leave.department)?.toString();
          const leaveDivId = (leave.division_id || leave.division)?.toString();
          const mapping = req.user.divisionMapping?.find(m =>
            (m.division?._id || m.division)?.toString() === leaveDivId
          );
          canProcess = mapping
            ? (!mapping.departments || mapping.departments.length === 0) || mapping.departments.some(d => (d?._id || d).toString() === leaveDeptId)
            : false;
        }
      }
    } else if (requiredRole === 'manager' || requiredRole === 'hr' || requiredRole === 'final_authority') {
      // Logic for Manager and HR (Scoped Roles)
      if (userRole === requiredRole || (requiredRole === 'final_authority' && (userRole === 'hr' || userRole === 'super_admin'))) {
        // Use req.scopedUser if available (from middleware), otherwise fetch
        const fullUser = req.scopedUser || await User.findById(req.user.userId || req.user._id);

        // Enforce Centralized Jurisdictional Check
        canProcess = checkJurisdiction(fullUser, leave);
      }
    }

    // 3. Admin Override (Super Admins and Sub Admins can generally approve any step)
    if (['sub_admin', 'super_admin'].includes(userRole)) {
      canProcess = true;
    }

    // 4. Setting: Allow higher authority to approve lower levels (e.g. HR can act when current step is HOD)
    if (!canProcess && leave.workflow && leave.workflow.approvalChain && leave.workflow.approvalChain.length > 0) {
      const workflowSettings = await getWorkflowSettings();
      const allowHigher = workflowSettings?.workflow?.allowHigherAuthorityToApproveLowerLevels === true;
      if (allowHigher) {
        // Build role order from approval chain (by stepOrder or array order)
        const chain = leave.workflow.approvalChain.slice().sort((a, b) => (a.stepOrder ?? 999) - (b.stepOrder ?? 999));
        const roleOrder = chain.map(s => (s.role || s.stepRole || '').toLowerCase()).filter(Boolean);
        const requiredIdx = roleOrder.indexOf(requiredRole.toLowerCase());
        let userIdx = roleOrder.indexOf(userRole.toLowerCase());
        if (userIdx === -1 && (userRole === 'hr' || userRole === 'super_admin')) {
          const finalRole = (leave.workflow.finalAuthority || 'hr').toLowerCase();
          userIdx = roleOrder.indexOf(finalRole) !== -1 ? roleOrder.length : roleOrder.indexOf('hr') !== -1 ? roleOrder.length : -1;
        }
        if (requiredIdx >= 0 && userIdx >= 0 && userIdx >= requiredIdx) {
          canProcess = true;
          // For scoped roles (manager, hr), still enforce jurisdiction
          if (['manager', 'hr'].includes(userRole)) {
            const fullUser = req.scopedUser || await User.findById(req.user.userId || req.user._id);
            canProcess = checkJurisdiction(fullUser, leave);
          } else if (requiredRole === 'hod' && userRole === 'hod') {
            // Already handled above with division mapping
          } else if (requiredRole === 'hod' && userRole !== 'hod') {
            // Higher role acting on HOD step: no extra scope check beyond jurisdiction for manager/hr
          }
        }
      }
    }

    if (!canProcess) {
      return res.status(403).json({
        success: false,
        error: `Not authorized. Waiting for ${requiredRole} approval. You are ${userRole}.`,
      });
    }

    // --- Action Processing ---

    // Prepare history entry
    const historyEntry = {
      step: requiredRole,
      actionBy: req.user._id,
      actionByName: req.user.name,
      actionByRole: userRole,
      comments: comments || '',
      timestamp: new Date(),
    };

    let approvalWarnings = [];

    switch (action) {
      case 'approve':
        // 1. Validation Logic (Limits & Conflicts)
        const Employee = require('../../employees/model/Employee');
        const employee = await Employee.findById(leave.employeeId);

        if (employee?.department_id) {
          try {
            const resolvedLeaveSettings = await getResolvedLeaveSettings(employee.department_id);
            if (resolvedLeaveSettings) {
              if (resolvedLeaveSettings.dailyLimit && leave.numberOfDays > resolvedLeaveSettings.dailyLimit) {
                approvalWarnings.push(`⚠️ Leave duration exceeds daily limit of ${resolvedLeaveSettings.dailyLimit}`);
              }
              if (resolvedLeaveSettings.monthlyLimit) {
                const from = new Date(leave.fromDate);
                const startOfMonth = new Date(from.getFullYear(), from.getMonth(), 1);
                const endOfMonth = new Date(from.getFullYear(), from.getMonth() + 1, 0, 23, 59, 59);
                const existingLeaves = await Leave.find({
                  employeeId: leave.employeeId,
                  fromDate: { $gte: startOfMonth, $lte: endOfMonth },
                  status: { $in: ['approved', 'hr_approved', 'hod_approved', 'manager_approved'] },
                  isActive: true,
                  _id: { $ne: leave._id }
                });
                const totalDays = existingLeaves.reduce((sum, l) => sum + (l.numberOfDays || 0), 0);
                if (totalDays + leave.numberOfDays > resolvedLeaveSettings.monthlyLimit) {
                  approvalWarnings.push(`⚠️ Monthly limit exceeded. New total: ${totalDays + leave.numberOfDays} (Limit: ${resolvedLeaveSettings.monthlyLimit})`);
                }
              }
            }
          } catch (err) { console.error("Limit check failed", err); }
        }

        // Conflict check for final step or HR
        const isFinishingChain = (activeStepIndex === leave.workflow.approvalChain.length - 1);
        const isFinalAuth = (userRole === leave.workflow.finalAuthority);

        if (isFinishingChain || isFinalAuth || userRole === 'hr') {
          const { validateLeaveRequest } = require('../../shared/services/conflictValidationService');
          const validation = await validateLeaveRequest(leave.employeeId, leave.emp_no, leave.fromDate, leave.toDate, leave.isHalfDay || false, leave.halfDayType || null, false);
          if (!validation.isValid) {
            return res.status(400).json({ success: false, error: validation.errors[0] || 'Conflict with approved records' });
          }
        }

        // 2. Process Approval in Chain
        const stepRole = requiredRole;
        const actualApproverRole = userRole;
        const commentText = comments && comments.trim() ? comments : `Approved by ${actualApproverRole}`;

        if (activeStepIndex !== -1) {
          const currentStep = leave.workflow.approvalChain[activeStepIndex];
          currentStep.status = 'approved';
          currentStep.actionBy = req.user._id;
          currentStep.actionByName = req.user.name;
          currentStep.actionByRole = actualApproverRole;
          currentStep.stepRole = stepRole;
          currentStep.comments = commentText;
          currentStep.updatedAt = new Date();
          currentStep.isCurrent = false;

          // Legacy approvals object update
          if (['hod', 'manager', 'hr'].includes(stepRole)) {
            leave.approvals[stepRole] = {
              status: 'approved',
              approvedBy: req.user._id,
              approvedAt: new Date(),
              comments: commentText
            };
          }
        }

        // 3. Sequential Travel Logic & Step-based status
        if (isFinishingChain) {
          leave.status = 'approved';
          leave.workflow.isCompleted = true;
          leave.workflow.currentStepRole = 'completed';
          leave.workflow.nextApprover = null;
          leave.workflow.nextApproverRole = null;
          leave.workflow.currentStep = 'completed';
          historyEntry.action = 'approved';
          historyEntry.stepRole = stepRole;
          historyEntry.actionByRole = actualApproverRole;
          historyEntry.comments = commentText;
        } else {
          const nextStep = leave.workflow.approvalChain[activeStepIndex + 1];
          nextStep.isCurrent = true;

          leave.workflow.currentStepRole = nextStep.role;
          leave.workflow.nextApprover = nextStep.role;
          leave.workflow.nextApproverRole = nextStep.role;
          leave.workflow.currentStep = nextStep.role;

          leave.status = `${stepRole}_approved`;
          historyEntry.stepRole = stepRole;
          historyEntry.actionByRole = actualApproverRole;
          historyEntry.comments = commentText;
        }

        if (approvalWarnings.length > 0) historyEntry.warnings = approvalWarnings;
        break;

      case 'reject':
        const rejectCommentText = comments && comments.trim() ? comments : `Rejected by ${userRole}`;
        const isRejectFinalStep = (activeStepIndex === leave.workflow.approvalChain.length - 1);

        if (activeStepIndex !== -1) {
          leave.workflow.approvalChain[activeStepIndex].status = 'rejected';
          leave.workflow.approvalChain[activeStepIndex].actionBy = req.user._id;
          leave.workflow.approvalChain[activeStepIndex].actionByName = req.user.name;
          leave.workflow.approvalChain[activeStepIndex].actionByRole = userRole;
          leave.workflow.approvalChain[activeStepIndex].stepRole = requiredRole;
          leave.workflow.approvalChain[activeStepIndex].updatedAt = new Date();
          leave.workflow.approvalChain[activeStepIndex].comments = rejectCommentText;
        }

        if (['hod', 'manager', 'hr'].includes(requiredRole)) {
          leave.approvals[requiredRole] = {
            status: 'rejected',
            approvedBy: req.user._id,
            approvedAt: new Date(),
            comments: rejectCommentText
          };
        }

        leave.status = isRejectFinalStep ? 'rejected' : `${requiredRole}_rejected`;
        leave.workflow.isCompleted = true;
        leave.workflow.currentStepRole = null;
        leave.workflow.nextApprover = null;
        leave.workflow.nextApproverRole = null;
        historyEntry.action = 'rejected';
        historyEntry.stepRole = requiredRole;
        historyEntry.actionByRole = userRole;
        historyEntry.comments = rejectCommentText;
        break;

      case 'forward':
        return res.status(400).json({
          success: false,
          error: 'Forward action is disabled. Use Approve or Reject only. Each step must be approved or rejected in sequence.',
        });

      default:
        return res.status(400).json({ success: false, error: 'Invalid action' });
    }

    leave.workflow.history.push(historyEntry);

    leave.markModified('workflow');
    leave.markModified('approvals');

    await leave.save();

    // When leave is finally approved, record a DEBIT in the leave register
    if (action === 'approve' && leave.status === 'approved') {
      try {
        await leaveRegisterService.addLeaveDebit(leave, req.user._id);
      } catch (err) {
        console.error('Leave register debit failed (leave already approved):', err);
      }
    }

    // Employee history: leave final decision
    try {
      if (action === 'approve' && leave.status === 'approved') {
        await EmployeeHistory.create({
          emp_no: leave.emp_no,
          event: 'leave_approved',
          performedBy: req.user._id,
          performedByName: req.user.name,
          performedByRole: userRole,
          details: {
            leaveId: leave._id,
            fromDate: leave.fromDate,
            toDate: leave.toDate,
            numberOfDays: leave.numberOfDays,
          },
          comments: comments && comments.trim()
            ? comments
            : 'Leave fully approved; employee will be marked on leave for these dates',
        });
      } else if (action === 'reject' && leave.status === 'rejected') {
        await EmployeeHistory.create({
          emp_no: leave.emp_no,
          event: 'leave_rejected',
          performedBy: req.user._id,
          performedByName: req.user.name,
          performedByRole: userRole,
          details: {
            leaveId: leave._id,
            fromDate: leave.fromDate,
            toDate: leave.toDate,
            numberOfDays: leave.numberOfDays,
          },
          comments: comments && comments.trim()
            ? comments
            : 'Leave rejected',
        });
      }
    } catch (err) {
      console.error('Failed to log leave approval/rejection history:', err.message);
    }

    await leave.populate([
      { path: 'employeeId', select: 'first_name last_name emp_no' },
      { path: 'department', select: 'name' },
    ]);

    const response = {
      success: true,
      message: `Leave ${action}ed successfully`,
      data: leave,
    };

    if (approvalWarnings && approvalWarnings.length > 0) {
      response.warnings = approvalWarnings;
    }

    res.status(200).json(response);

  } catch (error) {
    console.error('Error processing leave action:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process leave action',
    });
  }
};

// @desc    Revoke leave approval (within 2-3 hours)
// @route   PUT /api/leaves/:id/revoke
// @access  Private (HOD, HR, Super Admin)
exports.revokeLeaveApproval = async (req, res) => {
  try {
    const { reason } = req.body;
    const leave = await Leave.findById(req.params.id);

    if (!leave) {
      return res.status(404).json({
        success: false,
        error: 'Leave application not found',
      });
    }

    const allowedStatuses = ['approved', 'hod_approved', 'manager_approved', 'hr_approved'];
    if (!allowedStatuses.includes(leave.status)) {
      return res.status(400).json({
        success: false,
        error: 'Only approved or partially approved leaves can be revoked',
      });
    }

    const chain = leave.workflow?.approvalChain || [];
    if (chain.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No approval chain found',
      });
    }

    const approvedSteps = chain
      .map((s, i) => ({ step: s, index: i }))
      .filter(({ step }) => step.status === 'approved');
    const lastApproved = approvedSteps[approvedSteps.length - 1];
    if (!lastApproved) {
      return res.status(400).json({
        success: false,
        error: 'No approved step found to revoke',
      });
    }

    const lastStep = lastApproved.step;
    const stepIndex = lastApproved.index;
    const approvedAt = lastStep.updatedAt || leave.approvals?.[lastStep.role]?.approvedAt || leave.approvals?.[lastStep.stepRole]?.approvedAt;
    if (!approvedAt) {
      return res.status(400).json({
        success: false,
        error: 'No approval timestamp found for this step',
      });
    }

    const hoursSinceApproval = (new Date() - new Date(approvedAt)) / (1000 * 60 * 60);
    const revocationWindow = 3;
    if (hoursSinceApproval > revocationWindow) {
      return res.status(400).json({
        success: false,
        error: `Approval can only be revoked within ${revocationWindow} hours. ${hoursSinceApproval.toFixed(1)} hours have passed.`,
      });
    }

    const approverId = (lastStep.actionBy?._id || lastStep.actionBy)?.toString();
    const userId = (req.user._id || req.user.userId)?.toString();
    if (approverId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Only the person who approved this step can revoke it',
      });
    }

    const stepRole = lastStep.role || lastStep.stepRole;
    lastStep.status = 'pending';
    lastStep.actionBy = undefined;
    lastStep.actionByName = undefined;
    lastStep.actionByRole = undefined;
    lastStep.comments = undefined;
    lastStep.updatedAt = undefined;
    lastStep.isCurrent = true;

    if (leave.approvals && leave.approvals[stepRole]) {
      leave.approvals[stepRole] = { status: null, approvedBy: null, approvedAt: null, comments: null };
    }

    leave.workflow.currentStepRole = stepRole;
    leave.workflow.nextApprover = stepRole;
    leave.workflow.nextApproverRole = stepRole;
    leave.workflow.currentStep = stepRole;
    leave.workflow.isCompleted = false;

    if (stepIndex === 0) {
      leave.status = 'pending';
    } else {
      const prevRole = chain[stepIndex - 1]?.role || chain[stepIndex - 1]?.stepRole;
      leave.status = prevRole ? `${prevRole}_approved` : 'pending';
    }

    leave.workflow.history.push({
      step: stepRole,
      action: 'revoked',
      actionBy: req.user._id,
      actionByName: req.user.name,
      actionByRole: req.user.role,
      comments: reason || `Approval revoked by ${req.user.name}`,
      timestamp: new Date(),
    });

    leave.markModified('workflow');
    leave.markModified('approvals');
    await leave.save();

    res.status(200).json({
      success: true,
      message: 'Leave approval revoked successfully',
      data: leave,
    });
  } catch (error) {
    console.error('Error revoking leave approval:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to revoke leave approval',
    });
  }
};

// @desc    Delete leave (soft delete)
// @route   DELETE /api/leaves/:id
// @access  Private (Admin)
exports.deleteLeave = async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id);

    if (!leave) {
      return res.status(404).json({
        success: false,
        error: 'Leave application not found',
      });
    }

    // Only admin can delete
    if (!['sub_admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to delete leave applications',
      });
    }

    leave.isActive = false;
    await leave.save();

    res.status(200).json({
      success: true,
      message: 'Leave deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting leave:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete leave',
    });
  }
};

// @desc    Get leave statistics
// @route   GET /api/leaves/stats
// @access  Private
exports.getLeaveStats = async (req, res) => {
  try {
    const { employeeId, department, year } = req.query;
    const filter = { isActive: true };

    if (employeeId) {
      filter.employeeId = employeeId;
    } else if (req.user.employeeRef) {
      filter.employeeId = req.user.employeeRef;
    }

    if (department) {
      filter.department = department;
    }

    if (year) {
      const startOfYear = new Date(`${year}-01-01`);
      const endOfYear = new Date(`${year} -12 - 31`);
      filter.fromDate = { $gte: startOfYear, $lte: endOfYear };
    }

    const stats = await Leave.aggregate([
      { $match: filter },
      {
        $group: {
          _id: { leaveType: '$leaveType', status: '$status' },
          count: { $sum: 1 },
          totalDays: { $sum: '$numberOfDays' },
        },
      },
    ]);

    const summary = {
      byType: {},
      byStatus: {},
      totalApplied: 0,
      totalApproved: 0,
      totalPending: 0,
      totalRejected: 0,
      totalDays: 0,
    };

    stats.forEach((stat) => {
      const { leaveType, status } = stat._id;

      // By type
      if (!summary.byType[leaveType]) {
        summary.byType[leaveType] = { count: 0, days: 0 };
      }
      summary.byType[leaveType].count += stat.count;
      summary.byType[leaveType].days += stat.totalDays;

      // By status
      if (!summary.byStatus[status]) {
        summary.byStatus[status] = { count: 0, days: 0 };
      }
      summary.byStatus[status].count += stat.count;
      summary.byStatus[status].days += stat.totalDays;

      // Totals
      summary.totalApplied += stat.count;
      summary.totalDays += stat.totalDays;

      if (status === 'approved') {
        summary.totalApproved += stat.count;
      } else if (['pending', 'hod_approved'].includes(status)) {
        summary.totalPending += stat.count;
      } else if (['rejected', 'hod_rejected', 'hr_rejected'].includes(status)) {
        summary.totalRejected += stat.count;
      }
    });

    res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('Error fetching leave stats:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch leave statistics',
    });
  }
};

// @desc    Get approved records for a date (for conflict checking in frontend)
// @route   GET /api/leaves/approved-records
// @access  Private
exports.getApprovedRecordsForDate = async (req, res) => {
  try {
    const { employeeId, employeeNumber, date } = req.query;

    if (!employeeId && !employeeNumber) {
      return res.status(400).json({
        success: false,
        error: 'Employee ID or employee number is required',
      });
    }

    if (!date) {
      return res.status(400).json({
        success: false,
        error: 'Date is required',
      });
    }

    const { getApprovedRecordsForDate } = require('../../shared/services/conflictValidationService');
    const result = await getApprovedRecordsForDate(employeeId, employeeNumber, date);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error fetching approved records:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch approved records',
    });
  }
};

/**
 * @desc    Get leave conflicts for an attendance date
 * @route   GET /api/leaves/conflicts
 * @access  Private
 */
exports.getLeaveConflicts = async (req, res) => {
  try {
    const { employeeNumber, date } = req.query;

    if (!employeeNumber || !date) {
      return res.status(400).json({
        success: false,
        message: 'Employee number and date are required',
      });
    }

    const result = await getLeaveConflicts(employeeNumber, date);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      data: result.conflicts,
    });

  } catch (error) {
    console.error('Error getting leave conflicts:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get leave conflicts',
    });
  }
};

/**
 * @desc    Revoke full-day leave when attendance is logged
 * @route   POST /api/leaves/:id/revoke-for-attendance
 * @access  Private (Super Admin, Sub Admin, HR, HOD)
 */
exports.revokeLeaveForAttendance = async (req, res) => {
  try {
    const { id } = req.params;

    const userId = req.user?.userId || req.user?._id;
    const userName = req.user?.name || 'System';
    const userRole = req.user?.role || 'system';

    const result = await revokeFullDayLeave(id, userId, userName, userRole);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.leave,
    });

  } catch (error) {
    console.error('Error revoking leave for attendance:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to revoke leave',
    });
  }
};

/**
 * @desc    Update leave based on attendance (for multi-day leaves)
 * @route   POST /api/leaves/:id/update-for-attendance
 * @access  Private (Super Admin, Sub Admin, HR, HOD)
 */
exports.updateLeaveForAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const { employeeNumber, date } = req.body;

    if (!employeeNumber || !date) {
      return res.status(400).json({
        success: false,
        message: 'Employee number and date are required',
      });
    }

    // Get attendance record
    const AttendanceDaily = require('../../attendance/model/AttendanceDaily');
    const attendance = await AttendanceDaily.findOne({
      employeeNumber: employeeNumber.toUpperCase(),
      date: date,
    }).populate('shifts.shiftId');

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found',
      });
    }

    const userId = req.user?.userId || req.user?._id;
    const userName = req.user?.name || 'System';
    const userRole = req.user?.role || 'system';

    const result = await updateLeaveForAttendance(
      id,
      date,
      attendance,
      userId,
      userName,
      userRole
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: result.message,
      data: {
        updatedLeaves: result.updatedLeaves || [],
        createdLeaves: result.createdLeaves || [],
        deletedLeaveId: result.deletedLeaveId || null,
      },
    });

  } catch (error) {
    console.error('Error updating leave for attendance:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update leave',
    });
  }
};

// @desc    Create splits for a leave
// @route   POST /api/leaves/:id/split
// @access  Private (HOD, HR, Admin)
exports.createLeaveSplits = async (req, res) => {
  try {
    const { splits } = req.body;
    const leaveId = req.params.id;

    if (!splits || !Array.isArray(splits) || splits.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Splits array is required',
      });
    }

    const leaveSplitService = require('../services/leaveSplitService');
    const result = await leaveSplitService.createSplits(leaveId, splits, req.user);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.errors,
        warnings: result.warnings || [],
      });
    }

    res.status(200).json({
      success: true,
      message: 'Leave splits created successfully',
      data: result.data,
      warnings: result.warnings || [],
    });
  } catch (error) {
    console.error('Error creating leave splits:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create leave splits',
    });
  }
};

// @desc    Get splits for a leave
// @route   GET /api/leaves/:id/splits
// @access  Private
exports.getLeaveSplits = async (req, res) => {
  try {
    const leaveId = req.params.id;
    const leaveSplitService = require('../services/leaveSplitService');
    const splits = await leaveSplitService.getSplits(leaveId);

    res.status(200).json({
      success: true,
      data: splits,
    });
  } catch (error) {
    console.error('Error getting leave splits:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get leave splits',
    });
  }
};

// @desc    Get split summary for a leave
// @route   GET /api/leaves/:id/split-summary
// @access  Private
exports.getLeaveSplitSummary = async (req, res) => {
  try {
    const leaveId = req.params.id;
    const leaveSplitService = require('../services/leaveSplitService');
    const summary = await leaveSplitService.getSplitSummary(leaveId);

    if (!summary) {
      return res.status(404).json({
        success: false,
        error: 'Leave not found or has no splits',
      });
    }

    res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('Error getting leave split summary:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get leave split summary',
    });
  }
};

// @desc    Update a single split
// @route   PUT /api/leaves/:id/splits/:splitId
// @access  Private (HOD, HR, Admin)
exports.updateLeaveSplit = async (req, res) => {
  try {
    const { splitId } = req.params;
    const updateData = req.body;

    const leaveSplitService = require('../services/leaveSplitService');
    const result = await leaveSplitService.updateSplit(splitId, updateData, req.user);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.errors,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Split updated successfully',
      data: result.data,
    });
  } catch (error) {
    console.error('Error updating leave split:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update leave split',
    });
  }
};

// @desc    Delete a split
// @route   DELETE /api/leaves/:id/splits/:splitId
// @access  Private (HOD, HR, Admin)
exports.deleteLeaveSplit = async (req, res) => {
  try {
    const { splitId } = req.params;

    const leaveSplitService = require('../services/leaveSplitService');
    const result = await leaveSplitService.deleteSplit(splitId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.errors,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Split deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting leave split:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete leave split',
    });
  }
};

// @desc    Validate splits before creating
// @route   POST /api/leaves/:id/validate-splits
// @access  Private (HOD, HR, Admin)
exports.validateLeaveSplits = async (req, res) => {
  try {
    const { splits } = req.body;
    const leaveId = req.params.id;

    if (!splits || !Array.isArray(splits)) {
      return res.status(400).json({
        success: false,
        error: 'Splits array is required',
      });
    }

    const leaveSplitService = require('../services/leaveSplitService');
    const validation = await leaveSplitService.validateSplits(leaveId, splits);

    res.status(200).json({
      success: validation.isValid,
      isValid: validation.isValid,
      errors: validation.errors || [],
      warnings: validation.warnings || [],
      totalSplitDays: validation.totalSplitDays || 0,
      originalTotalDays: validation.originalTotalDays || 0,
    });
  } catch (error) {
    console.error('Error validating leave splits:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to validate leave splits',
    });
  }
};

