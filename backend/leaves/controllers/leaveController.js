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
const OD = require('../model/OD');
const leaveRegisterService = require('../services/leaveRegisterService');
const dateCycleService = require('../services/dateCycleService');
const leaveRegisterYearMonthlyApplyService = require('../services/leaveRegisterYearMonthlyApplyService');
const leaveRegisterYearService = require('../services/leaveRegisterYearService');
const PDFDocument = require('pdfkit');
const XLSX = require('xlsx');
const dayjs = require('dayjs');

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
    const { status, employeeId, department, division, designation, fromDate, toDate, search, page = 1, limit = 20 } = req.query;

    // Multi-layered filter: Jurisdiction (Scope) AND Timing (Workflow)
    const scopeFilter = req.scopeFilter || { isActive: true };
    const workflowFilter = buildWorkflowVisibilityFilter(req.user);

    // Include leaves whose document has division/department in scope OR whose employeeId is in scope.
    // Also: for scoped roles (HOD/Manager/HR), show ALL requests from in-scope employees regardless of workflow stage,
    // so they can track and manage team requests even when pending at reporting_manager or other stages.
    let jurisdictionFilter = scopeFilter;
    let visibilityFilter = workflowFilter;
    const scopedEmployeeIds = await getEmployeeIdsInScope(req.user);
    if (Array.isArray(scopedEmployeeIds) && scopedEmployeeIds.length > 0) {
      jurisdictionFilter = {
        $or: [
          scopeFilter,
          { employeeId: { $in: scopedEmployeeIds } }
        ]
      };
      // Scoped roles see all requests from in-scope employees (bypass workflow stage restriction)
      visibilityFilter = {
        $or: [
          workflowFilter,
          { employeeId: { $in: scopedEmployeeIds } }
        ]
      };
    }

    const filter = {
      $and: [
        jurisdictionFilter,
        visibilityFilter,
        { isActive: true }
      ]
    };

    if (status) filter.status = status;
    if (employeeId && employeeId !== 'all') {
      const ids = String(employeeId).split(',').filter(id => id && id !== 'all');
      if (ids.length > 0) filter.employeeId = ids.length > 1 ? { $in: ids } : ids[0];
    }
    if (department && department !== 'all') {
      const ids = String(department).split(',').filter(id => id && id !== 'all');
      if (ids.length > 0) filter.department = ids.length > 1 ? { $in: ids } : ids[0];
    }
    if (division && division !== 'all') {
      const ids = String(division).split(',').filter(id => id && id !== 'all');
      if (ids.length > 0) filter.division_id = ids.length > 1 ? { $in: ids } : ids[0];
    }
    if (designation && designation !== 'all') {
      const ids = String(designation).split(',').filter(id => id && id !== 'all');
      if (ids.length > 0) filter.designation = ids.length > 1 ? { $in: ids } : ids[0];
    }
    if (fromDate || toDate) {
      if (toDate) filter.fromDate = { ...filter.fromDate, $lte: new Date(toDate) };
      if (fromDate) filter.toDate = { ...filter.toDate, $gte: new Date(fromDate) };
    }

    // Search: by emp_no or employee name (resolve employee ids)
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
        filter.employeeId = { $in: ids };
      } else {
        filter.employeeId = { $in: [] };
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [leaves, total] = await Promise.all([
      Leave.find(filter)
        .populate({
          path: 'employeeId',
          select: 'employee_name emp_no department_id division_id department',
          populate: [
            { path: 'department', select: 'name code' },
            { path: 'division', select: 'name code' }
          ]
        })
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
    if (fromDate || toDate) {
      if (toDate) filter.fromDate = { ...filter.fromDate, $lte: new Date(toDate) };
      if (fromDate) filter.toDate = { ...filter.toDate, $gte: new Date(fromDate) };
    }

    const leaves = await Leave.find(filter)
      .populate({
          path: 'employeeId',
          select: 'employee_name emp_no department_id division_id department',
          populate: [
            { path: 'department', select: 'name code' },
            { path: 'division', select: 'name code' }
          ]
        })
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
      .populate({
          path: 'employeeId',
          select: 'employee_name emp_no email phone_number department_id division_id department',
          populate: [
            { path: 'department', select: 'name code' },
            { path: 'division', select: 'name code' }
          ]
        })
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
        // Some deployments store employeeId as the Mongo _id, others as emp_no.
        const isSelf =
          (req.user.employeeRef && req.user.employeeRef.toString() === employee._id.toString()) ||
          (req.user.employeeId && req.user.employeeId.toString() === employee._id.toString()) ||
          (req.user.employeeId && employee.emp_no && String(req.user.employeeId).trim() === String(employee.emp_no).trim());

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

    }

    // Combined payroll-period application cap (CL + CCL + optional EL) from leave policy
    const monthlyApplicationCapService = require('../services/monthlyApplicationCapService');
    const capCheck = await monthlyApplicationCapService.assertWithinMonthlyApplicationCap(
      employee._id,
      fromDate,
      leaveType,
      numberOfDays
    );
    if (!capCheck.ok) {
      return res.status(400).json({
        success: false,
        error: capCheck.error,
      });
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

    leaveRegisterYearMonthlyApplyService.scheduleSyncMonthApply(employee._id, leave.fromDate);

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

    const originalFromDate = leave.fromDate ? new Date(leave.fromDate) : null;

    // Check if can edit - Allow editing for pending, hod_approved, hr_approved (not final approved)
    // Super Admin can edit any status except final approved
    const isSuperAdmin = req.user.role === 'super_admin';
    const isFinalApproved = leave.status === 'approved';

    if (isFinalApproved && !['super_admin', 'manager', 'hod'].includes(req.user.role)) {
      return res.status(400).json({
        success: false,
        error: 'Final approved leave cannot be edited',
      });
    }

    // Check ownership or admin permission
    const isOwner = leave.appliedBy.toString() === req.user._id.toString();
    const isAdmin = ['hr', 'sub_admin', 'super_admin', 'manager', 'hod'].includes(req.user.role);

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

    const capAffectingFields = new Set([
      'leaveType',
      'fromDate',
      'toDate',
      'isHalfDay',
      'halfDayType',
      'status',
    ]);
    const affectsMonthlyApply = changes.some((c) => capAffectingFields.has(c.field));

    if (affectsMonthlyApply) {
      try {
        await leaveRegisterYearMonthlyApplyService.syncStoredMonthApplyFieldsForEmployeeDate(
          leave.employeeId,
          leave.fromDate
        );
        if (
          originalFromDate &&
          new Date(leave.fromDate).getTime() !== originalFromDate.getTime()
        ) {
          await leaveRegisterYearMonthlyApplyService.syncStoredMonthApplyFieldsForEmployeeDate(
            leave.employeeId,
            originalFromDate
          );
        }
      } catch (e) {
        console.warn('[monthlyApply sync]', e?.message || e);
      }
    }

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
    const isAdmin = ['hr', 'sub_admin', 'super_admin', 'manager', 'hod'].includes(req.user.role);

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

    leaveRegisterYearMonthlyApplyService.scheduleSyncMonthApply(leave.employeeId, leave.fromDate);

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
    const limitNum = Math.min(1000, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    // Base filter: Active AND Not Applied by Me (Self-requests go to "My Leaves")
    let filter = {
      isActive: true,
      appliedBy: { $ne: req.user._id }
    };

    // 1. Super Admin: View all non-final leaves globally
    if (['super_admin'].includes(userRole)) {
      filter.status = { $nin: ['approved', 'rejected', 'cancelled'] };
    }
    // 2, 3, 4, 5: Scoped Roles (Sub Admin, HOD, HR, Manager)
    else if (['sub_admin', 'hod', 'hr', 'manager'].includes(userRole)) {
      filter.status = { $nin: ['approved', 'rejected', 'cancelled'] };
      
      const employeeIds = await getEmployeeIdsInScope(req.user);
      if (employeeIds.length > 0) {
        filter.employeeId = { $in: employeeIds };
      } else {
        filter.employeeId = { $in: [] };
      }
    }
    // Fallback for any other roles
    else {
      filter['$or'] = [
        { 'workflow.approvalChain': { $elemMatch: { role: userRole, status: 'pending' } } },
        { 'workflow.reportingManagerIds': req.user._id.toString() }
      ];
      filter.status = { $nin: ['approved', 'rejected', 'cancelled'] };
    }

    // Apply query filters
    if (leaveType) filter.leaveType = leaveType;
    if (fromDate || toDate) {
      if (toDate) {
        filter.fromDate = filter.fromDate || {};
        filter.fromDate.$lte = new Date(toDate);
      }
      if (fromDate) {
        filter.toDate = filter.toDate || {};
        filter.toDate.$gte = new Date(fromDate);
      }
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
        .populate({
          path: 'employeeId',
          select: 'employee_name emp_no first_name last_name department_id division_id department',
          populate: [
            { path: 'department', select: 'name code' },
            { path: 'division', select: 'name code' }
          ]
        })
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

    // --- Intermediate Rejection Override Check ---
    if (leave.status.endsWith('_rejected') && leave.status !== 'rejected') {
      const { getWorkflowSettings } = require('../../settings/services/workflowSettingsService');
      const workflowSettings = await getWorkflowSettings();
      const allowHigher = workflowSettings?.workflow?.allowHigherAuthorityToApproveLowerLevels === true;
      if (!allowHigher) {
        return res.status(403).json({
          success: false,
          error: `Leave application was rejected by ${leave.status.replace('_rejected', '').toUpperCase()}. Overrides are disabled in settings.`,
        });
      }
    }

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
            }
          } catch (err) { console.error("Limit check failed", err); }
        }

        // Conflict check for final step or HR
        const isFinishingChain = (activeStepIndex === leave.workflow.approvalChain.length - 1);
        const isFinalAuth = (userRole === leave.workflow.finalAuthority);

        if (isFinishingChain || isFinalAuth || userRole === 'hr') {
          const { validateLeaveRequest } = require('../../shared/services/conflictValidationService');
          const validation = await validateLeaveRequest(leave.employeeId, leave.emp_no, leave.fromDate, leave.toDate, leave.isHalfDay || false, leave.halfDayType || null, false, leave._id);
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

          leave.workflow.isCompleted = false;
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

    // Monthly slot: await only for final approval or canonical final rejection (`rejected`).
    // Intermediate pipeline outcomes (`hod_approved`, `hod_rejected`, etc.) use deferred sync.
    const finalApprove = action === 'approve' && leave.status === 'approved';
    const finalRejectCanonical = action === 'reject' && leave.status === 'rejected';
    if (finalApprove || finalRejectCanonical) {
      try {
        await leaveRegisterYearMonthlyApplyService.syncStoredMonthApplyFieldsForEmployeeDate(
          leave.employeeId,
          leave.fromDate
        );
      } catch (e) {
        console.warn('[monthlyApply sync]', e?.message || e);
      }
    } else {
      leaveRegisterYearMonthlyApplyService.scheduleSyncMonthApply(leave.employeeId, leave.fromDate);
    }

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

    const allowedStatuses = [
      'approved', 'rejected',
      'hod_approved', 'manager_approved', 'hr_approved',
      'hod_rejected', 'manager_rejected', 'hr_rejected'
    ];
    if (!allowedStatuses.includes(leave.status)) {
      return res.status(400).json({
        success: false,
        error: 'Only approved or rejected leaves can be revoked',
      });
    }

    const chain = leave.workflow?.approvalChain || [];
    if (chain.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No approval chain found',
      });
    }

    // Find the last action taken (either approval or rejection)
    const actionSteps = chain
      .map((s, i) => ({ step: s, index: i }))
      .filter(({ step }) => step.status === 'approved' || step.status === 'rejected');

    const lastAction = actionSteps[actionSteps.length - 1];
    if (!lastAction) {
      return res.status(400).json({
        success: false,
        error: 'No action found to revoke',
      });
    }

    const lastStep = lastAction.step;
    const stepIndex = lastAction.index;
    const updatedAt = lastStep.updatedAt || leave.approvals?.[lastStep.role]?.approvedAt || leave.approvals?.[lastStep.stepRole]?.approvedAt;

    if (!updatedAt) {
      return res.status(400).json({
        success: false,
        error: 'No timestamp found for the last action',
      });
    }

    const hoursSinceAction = (new Date() - new Date(updatedAt)) / (1000 * 60 * 60);
    const revocationWindow = 48; // Extended to 48 hours as per plan
    if (hoursSinceAction > revocationWindow) {
      return res.status(400).json({
        success: false,
        error: `Action can only be revoked within ${revocationWindow} hours. ${hoursSinceAction.toFixed(1)} hours have passed.`,
      });
    }

    const approverId = (lastStep.actionBy?._id || lastStep.actionBy)?.toString();
    const userId = (req.user._id || req.user.userId)?.toString();
    const userRole = req.user.role;

    // Authorization: Original actor OR Super Admin OR HR
    const isOriginalActor = approverId === userId;
    const isHigherAuthority = ['super_admin', 'hr'].includes(userRole);

    if (!isOriginalActor && !isHigherAuthority) {
      return res.status(403).json({
        success: false,
        error: 'Only the person who performed the action or a higher authority can revoke it',
      });
    }

    // If revoking a final approval, reverse the leave register debit
    if (lastStep.status === 'approved' && leave.status === 'approved') {
      try {
        const leaveRegisterService = require('../services/leaveRegisterService');
        await leaveRegisterService.reverseLeaveDebit(leave, req.user._id);
      } catch (err) {
        console.error('Failed to reverse leave register debit during revocation:', err);
        // We continue anyway, but log the error
      }
    }

    const stepRole = lastStep.role || lastStep.stepRole;
    const originalStatus = lastStep.status;

    // Reset the step to pending
    lastStep.status = 'pending';
    lastStep.actionBy = undefined;
    lastStep.actionByName = undefined;
    lastStep.actionByRole = undefined;
    lastStep.comments = undefined;
    lastStep.updatedAt = undefined;
    lastStep.isCurrent = true;

    // Also reset if there were any following steps marked as current or pending (safety)
    for (let i = stepIndex + 1; i < chain.length; i++) {
      chain[i].isCurrent = false;
      chain[i].status = 'pending';
    }

    if (leave.approvals && leave.approvals[stepRole]) {
      leave.approvals[stepRole] = { status: null, approvedBy: null, approvedAt: null, comments: null };
    }

    leave.workflow.currentStepRole = stepRole;
    leave.workflow.nextApprover = stepRole;
    leave.workflow.nextApproverRole = stepRole;
    leave.workflow.currentStep = stepRole;
    leave.workflow.isCompleted = false;

    // Recalculate overall status based on previous step
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
      actionByRole: userRole,
      comments: reason || `Action (${originalStatus}) revoked by ${req.user.name}`,
      timestamp: new Date(),
    });

    leave.markModified('workflow');
    leave.markModified('approvals');
    await leave.save();

    leaveRegisterYearMonthlyApplyService.scheduleSyncMonthApply(leave.employeeId, leave.fromDate);

    res.status(200).json({
      success: true,
      message: `Leave ${originalStatus} revoked successfully`,
      data: leave,
    });
  } catch (error) {
    console.error('Error revoking leave action:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to revoke leave action',
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

    // Authorization: Admin can delete any, employee can delete their own if pending
    const isAdmin = ['sub_admin', 'super_admin'].includes(req.user.role);
    const isOwner = leave.appliedBy?.toString() === req.user._id.toString() ||
      (req.user.employeeRef && leave.employeeId?.toString() === req.user.employeeRef.toString());

    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to delete this leave application',
      });
    }

    leave.isActive = false;
    await leave.save();

    leaveRegisterYearMonthlyApplyService.scheduleSyncMonthApply(leave.employeeId, leave.fromDate);

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

// @desc    Get dashboard counts for superadmin (all or filtered)
// @route   GET /api/leaves/dashboard-stats
// @access  Private (same as getLeaves - applyScopeFilter)
// Query: search, division, department, designation, fromDate, toDate. When absent = global counts; when present = filtered counts.
exports.getDashboardStats = async (req, res) => {
  try {
    const { search, division, department, designation, fromDate, toDate } = req.query;

    const scopeFilter = req.scopeFilter || { isActive: true };
    const workflowFilter = buildWorkflowVisibilityFilter(req.user);

    // Same jurisdiction and visibility as getLeaves/getODs
    let jurisdictionFilter = scopeFilter;
    let visibilityFilter = workflowFilter;
    const scopedEmployeeIds = await getEmployeeIdsInScope(req.user);
    if (Array.isArray(scopedEmployeeIds) && scopedEmployeeIds.length > 0) {
      jurisdictionFilter = {
        $or: [
          scopeFilter,
          { employeeId: { $in: scopedEmployeeIds } }
        ]
      };
      visibilityFilter = {
        $or: [
          workflowFilter,
          { employeeId: { $in: scopedEmployeeIds } }
        ]
      };
    }

    const baseFilter = {
      $and: [
        jurisdictionFilter,
        visibilityFilter,
        { isActive: true }
      ]
    };

    const leaveFilter = { ...baseFilter };
    const odFilter = { ...baseFilter };

    const convertToObjectId = (idArray) => {
      const validIds = idArray.filter(id => mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(id));
      return validIds.length > 0 ? (validIds.length > 1 ? { $in: validIds } : validIds[0]) : null;
    };

    if (department && department !== 'all') {
      const ids = String(department).split(',').filter(id => id && id !== 'all');
      const val = convertToObjectId(ids);
      if (val) {
        leaveFilter.department = val;
        odFilter.department = val;
      }
    }
    if (division && division !== 'all') {
      const ids = String(division).split(',').filter(id => id && id !== 'all');
      const val = convertToObjectId(ids);
      if (val) {
        leaveFilter.division_id = val;
        odFilter.division_id = val;
      }
    }
    if (designation && designation !== 'all') {
      const ids = String(designation).split(',').filter(id => id && id !== 'all');
      const val = convertToObjectId(ids);
      if (val) {
        leaveFilter.designation = val;
        odFilter.designation = val;
      }
    }

    if (fromDate || toDate) {
      if (toDate) {
        const end = new Date(toDate);
        leaveFilter.fromDate = { ...leaveFilter.fromDate, $lte: end };
        odFilter.fromDate = { ...odFilter.fromDate, $lte: end };
      }
      if (fromDate) {
        const start = new Date(fromDate);
        leaveFilter.toDate = { ...leaveFilter.toDate, $gte: start };
        odFilter.toDate = { ...odFilter.toDate, $gte: start };
      }
    }

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
      const idFilter = ids.length > 0 ? { $in: ids } : { $in: [] };
      leaveFilter.employeeId = idFilter;
      odFilter.employeeId = idFilter;
    }

    // Categories for granular breakdown
    const finalRejectedStatuses = ['rejected', 'cancelled'];
    const intermediateStatuses = [
      'pending', 'draft', 
      'hod_approved', 'hod_rejected', 
      'hr_approved', 'hr_rejected', 
      'manager_approved', 'manager_rejected',
      'reporting_manager_approved', 'reporting_manager_rejected',
      'principal_approved', 'principal_rejected'
    ];

    const [leaveStats, odStats] = await Promise.all([
      Leave.aggregate([
        { $match: leaveFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      OD.aggregate([
        { $match: odFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ])
    ]);

    const formatStats = (aggResults) => {
      const counts = {};
      aggResults.forEach(r => { counts[r._id] = r.count; });
      
      const total = aggResults.reduce((sum, r) => sum + r.count, 0);
      const approved = counts['approved'] || 0;
      const rejected = finalRejectedStatuses.reduce((sum, s) => sum + (counts[s] || 0), 0);
      const pending = total - approved - rejected;

      return {
        total,
        approved,
        rejected,
        pending,
        breakdown: {
          draft: counts['draft'] || 0,
          pending: counts['pending'] || 0,
          hod_approved: counts['hod_approved'] || 0,
          hod_rejected: counts['hod_rejected'] || 0,
          hr_approved: counts['hr_approved'] || 0,
          hr_rejected: counts['hr_rejected'] || 0,
          manager_approved: counts['manager_approved'] || 0,
          manager_rejected: counts['manager_rejected'] || 0,
          reporting_manager_approved: counts['reporting_manager_approved'] || 0,
          reporting_manager_rejected: counts['reporting_manager_rejected'] || 0,
          principal_approved: counts['principal_approved'] || 0,
          principal_rejected: counts['principal_rejected'] || 0,
        }
      };
    };

    const leaves = formatStats(leaveStats);
    const ods = formatStats(odStats);

    res.status(200).json({
      success: true,
      data: {
        totalLeaves: leaves.total,
        totalODs: ods.total,
        totalPendingLeaves: leaves.pending,
        totalPendingODs: ods.pending,
        totalApprovedLeaves: leaves.approved,
        totalApprovedODs: ods.approved,
        totalRejectedLeaves: leaves.rejected,
        totalRejectedODs: ods.rejected,
        totalPending: leaves.pending + ods.pending,
        totalApproved: leaves.approved + ods.approved,
        totalRejected: leaves.rejected + ods.rejected,
        leavesBreakdown: leaves.breakdown,
        odsBreakdown: ods.breakdown
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch dashboard stats'
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

/**
 * @desc    Stored monthly apply ceiling + consumption for the payroll period of fromDate (leave apply dialog)
 * @route   GET /api/leaves/apply-period-context
 * @query   fromDate (required), employeeId (optional — else current user’s employee), refresh=1 to force sync
 */
exports.getApplyPeriodContext = async (req, res) => {
  try {
    const { fromDate, employeeId: employeeIdQ, refresh } = req.query;
    if (!fromDate || !String(fromDate).trim()) {
      return res.status(400).json({ success: false, error: 'fromDate is required' });
    }

    let targetEmployeeId = employeeIdQ;
    if (!targetEmployeeId || !mongoose.Types.ObjectId.isValid(String(targetEmployeeId))) {
      targetEmployeeId = req.user?.employeeRef;
    }
    if (!targetEmployeeId || !mongoose.Types.ObjectId.isValid(String(targetEmployeeId))) {
      return res.status(400).json({
        success: false,
        error: 'employeeId is required (or link your user to an employee profile)',
      });
    }

    const empOid = new mongoose.Types.ObjectId(String(targetEmployeeId));
    if (
      employeeIdQ &&
      String(employeeIdQ) !== String(req.user?.employeeRef || '')
    ) {
      const allowedRoles = ['hod', 'hr', 'sub_admin', 'super_admin', 'manager'];
      const role = String(req.user?.role || '').toLowerCase();
      if (!allowedRoles.includes(role)) {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to view apply context for another employee',
        });
      }
      const emp = await Employee.findById(empOid).select('_id department_id division_id').lean();
      if (!emp) {
        return res.status(404).json({ success: false, error: 'Employee not found' });
      }
      const fullUser = req.scopedUser || req.user;
      if (!checkJurisdiction(fullUser, { employeeId: emp._id, department_id: emp.department_id, division_id: emp.division_id })) {
        return res.status(403).json({ success: false, error: 'Out of scope for this employee' });
      }
    }

    const doRefresh = String(refresh) === '1' || String(refresh).toLowerCase() === 'true';
    const ctx = await leaveRegisterYearMonthlyApplyService.getApplyPeriodContextForEmployee(
      empOid,
      fromDate,
      { refresh: doRefresh }
    );

    return res.status(200).json({ success: true, data: ctx });
  } catch (error) {
    console.error('getApplyPeriodContext:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to load apply period context',
    });
  }
};

/**
 * @desc    Paginated leave register list (per employee summaries for FY / payroll context)
 * @route   GET /api/leaves/register
 * @access  HOD, HR, Manager, Sub Admin, Super Admin (scoped)
 */
exports.listLeaveRegister = async (req, res) => {
  try {
    const user = req.scopedUser;
    if (!user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const {
      financialYear,
      month: monthQ,
      year: yearQ,
      departmentId,
      divisionId,
      designationId,
      employeeId,
      empNo,
      search,
      page = '1',
      limit = '25',
    } = req.query;

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 25));

    const monthNum =
      monthQ != null && String(monthQ).trim() !== ''
        ? parseInt(String(monthQ), 10)
        : null;
    const yearNum =
      yearQ != null && String(yearQ).trim() !== ''
        ? parseInt(String(yearQ), 10)
        : null;

    const filters = {
      financialYear: financialYear && String(financialYear).trim() ? String(financialYear).trim() : undefined,
      divisionId: divisionId && mongoose.Types.ObjectId.isValid(String(divisionId)) ? new mongoose.Types.ObjectId(String(divisionId)) : undefined,
      departmentId: departmentId && mongoose.Types.ObjectId.isValid(String(departmentId)) ? new mongoose.Types.ObjectId(String(departmentId)) : undefined,
      designationId: designationId && mongoose.Types.ObjectId.isValid(String(designationId)) ? new mongoose.Types.ObjectId(String(designationId)) : undefined,
      employeeId: employeeId && mongoose.Types.ObjectId.isValid(String(employeeId)) ? new mongoose.Types.ObjectId(String(employeeId)) : undefined,
      empNo: empNo && String(empNo).trim() ? String(empNo).trim() : undefined,
      searchTerm: search && String(search).trim() ? String(search).trim() : undefined,
    };

    const fullAccess =
      user.role === 'super_admin' ||
      user.role === 'sub_admin' ||
      user.dataScope === 'all';

    if (!fullAccess) {
      filters.employeeIds = await getEmployeeIdsInScope(user);
      if (user.employeeRef) {
        // Ensure the current user's employeeRef is always included if they are not fullAccess
        // and it's not already in the scoped list.
        const userEmployeeRef = user.employeeRef.toString();
        if (!filters.employeeIds.some(id => id.toString() === userEmployeeRef)) {
          filters.employeeIds.push(user.employeeRef);
        }
      }
    }

    let groupedData = await leaveRegisterService.getLeaveRegister(filters, monthNum, yearNum);

    // Legacy post-filtering was here; now handled by passing filters.employeeIds to the service.

    const total = groupedData.length;
    const start = (pageNum - 1) * limitNum;
    const pageRows = groupedData.slice(start, start + limitNum);

    const employees = pageRows.map((entry) => {
      const subs = entry.monthlySubLedgers || [];
      const last = subs.length > 0 ? subs[subs.length - 1] : null;
      const first = subs.length > 0 ? subs[0] : null;
      let transactionCount = 0;
      subs.forEach((s) => {
        transactionCount += (s.transactions && s.transactions.length) || 0;
      });
      return {
        employee: entry.employee,
        summary: {
          clBalance: last?.casualLeave?.balance ?? 0,
          elBalance: last?.earnedLeave?.balance ?? 0,
          cclBalance: last?.compensatoryOff?.balance ?? 0,
          totalPaidBalance: last?.totalPaidBalance ?? 0,
          monthlyAllowedLimit: last?.monthlyAllowedLimit,
        },
        yearSnapshot: entry.yearSnapshot || null,
        registerMonths: Array.isArray(entry.registerMonths) ? entry.registerMonths : [],
        payrollMonthsCovered: subs.length,
        transactionCount,
        firstPeriod: first ? { month: first.month, year: first.year } : null,
        lastPeriod: last ? { month: last.month, year: last.year } : null,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        employees,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.max(1, Math.ceil(total / limitNum)),
        },
        context: {
          financialYear: filters.financialYear || null,
          month: monthNum,
          year: yearNum,
        },
      },
    });
  } catch (error) {
    console.error('Error listing leave register:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to list leave register',
    });
  }
};

/**
 * @desc    Full leave register for one employee (ledger + optional LeaveRegisterYear)
 * @route   GET /api/leaves/register/employee/:employeeId
 * @access  HOD, HR, Manager, Sub Admin, Super Admin (scoped)
 */
exports.getEmployeeLeaveRegisterDetail = async (req, res) => {
  try {
    const user = req.scopedUser;
    if (!user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { employeeId } = req.params;
    const { financialYear, month: monthQ, year: yearQ } = req.query;

    if (!mongoose.Types.ObjectId.isValid(String(employeeId))) {
      return res.status(400).json({ success: false, message: 'Invalid employee id' });
    }

    const emp = await Employee.findById(employeeId)
      .select('_id emp_no employee_name department_id division_id')
      .lean();
    if (!emp) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const record = {
      employeeId: emp._id,
      department_id: emp.department_id,
      division_id: emp.division_id,
    };
    if (!checkJurisdiction(user, record)) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this employee' });
    }

    const monthNum =
      monthQ != null && String(monthQ).trim() !== ''
        ? parseInt(String(monthQ), 10)
        : null;
    const yearNum =
      yearQ != null && String(yearQ).trim() !== ''
        ? parseInt(String(yearQ), 10)
        : null;

    const filters = { employeeId: emp._id };
    if (financialYear && String(financialYear).trim()) {
      filters.financialYear = String(financialYear).trim();
    }

    const grouped = await leaveRegisterService.getLeaveRegister(filters, monthNum, yearNum);
    const ledger = Array.isArray(grouped) && grouped[0] ? grouped[0] : null;

    return res.status(200).json({
      success: true,
      data: {
        employee: {
          id: emp._id,
          empNo: emp.emp_no,
          name: emp.employee_name,
        },
        ledger,
        /** FY month grid: scheduled credits from LeaveRegisterYear + ledger balances + transactions per payroll month */
        months: ledger?.months || [],
        leaveRegisterYear: ledger?.leaveRegisterYear || null,
        context: {
          financialYear: filters.financialYear || null,
          month: monthNum,
          year: yearNum,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching employee leave register:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch leave register',
    });
  }
};

/**
 * @desc    Adjust scheduled pool on one FY payroll slot (CL/CCL/EL credits, optional policy lock)
 * @route   PATCH /api/leaves/leave-register-year/:employeeId/month-slot
 * @access  hr, sub_admin, super_admin (scoped)
 */
exports.patchLeaveRegisterYearMonthSlot = async (req, res) => {
  try {
    const user = req.scopedUser || req.user;
    if (!user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const { employeeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(employeeId))) {
      return res.status(400).json({ success: false, message: 'Invalid employee id' });
    }
    const emp = await Employee.findById(employeeId)
      .select('_id emp_no employee_name department_id division_id')
      .lean();
    if (!emp) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    if (!checkJurisdiction(user, { department_id: emp.department_id, division_id: emp.division_id })) {
      return res.status(403).json({ success: false, message: 'Not authorized for this employee' });
    }

    const {
      financialYear,
      payrollCycleMonth,
      payrollCycleYear,
      clCredits,
      compensatoryOffs,
      elCredits,
      lockedCredits,
      usedCl,
      usedCcl,
      usedEl,
      validateWithRecords,
      carryUnusedToNextMonth,
      reason,
    } = req.body || {};

    const result = await leaveRegisterYearService.patchMonthSlotScheduledCredits({
      employeeId: emp._id,
      financialYear,
      payrollCycleMonth,
      payrollCycleYear,
      patch: { clCredits, compensatoryOffs, elCredits, lockedCredits },
      usedCl,
      usedCcl,
      usedEl,
      validateWithRecords: !!validateWithRecords,
      carryUnusedToNextMonth: !!carryUnusedToNextMonth,
      reason,
      actorUserId: user._id,
    });

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('patchLeaveRegisterYearMonthSlot:', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Failed to update month slot',
    });
  }
};

/**
 * @desc    Refresh monthlyApply* denorm from Leave rows for one payroll slot (no schedule edits)
 * @route   POST /api/leaves/leave-register-year/:employeeId/sync-month-apply
 * @access  hr, sub_admin, super_admin (scoped)
 */
exports.syncLeaveRegisterYearMonthApply = async (req, res) => {
  try {
    const user = req.scopedUser || req.user;
    if (!user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const { employeeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(employeeId))) {
      return res.status(400).json({ success: false, message: 'Invalid employee id' });
    }
    const emp = await Employee.findById(employeeId)
      .select('_id department_id division_id')
      .lean();
    if (!emp) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    if (!checkJurisdiction(user, { department_id: emp.department_id, division_id: emp.division_id })) {
      return res.status(403).json({ success: false, message: 'Not authorized for this employee' });
    }

    const { financialYear, payrollCycleMonth, payrollCycleYear } = req.body || {};
    const result = await leaveRegisterYearService.syncMonthApplyOnly({
      employeeId: emp._id,
      financialYear,
      payrollCycleMonth,
      payrollCycleYear,
    });

    if (!result.ok) {
      return res.status(400).json({
        success: false,
        message: result.sync?.reason || 'Could not sync monthly apply fields for this slot',
        data: result,
      });
    }

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('syncLeaveRegisterYearMonthApply:', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Failed to sync month apply',
    });
  }
};

/**
 * Helper to draw a simple table in PDFKit
 */
const drawPDFTable = (doc, headers, data, startX, startY, colWidths, options = {}) => {
  const { headerFill = '#2980b9', rowFill = '#f8f9fa', fontSize = 7 } = options;
  let y = startY;
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);

  // Draw Header
  doc.fillColor(headerFill).rect(startX, y, tableWidth, 20).fill();
  doc.fillColor('#FFFFFF').fontSize(fontSize + 1).font('Helvetica-Bold');
  
  let x = startX;
  headers.forEach((h, i) => {
    doc.text(h, x + 4, y + 6, { width: colWidths[i] - 8, align: 'left' });
    x += colWidths[i];
  });
  
  y += 20;
  doc.font('Helvetica').fontSize(fontSize).fillColor('#333333');

  // Draw Rows
  data.forEach((row, rowIndex) => {
    // Check for page break - landscape height is ~595
    if (y > 480) {
      doc.addPage();
      y = 50;
      
      // Re-draw header
      doc.fillColor(headerFill).rect(startX, y, tableWidth, 20).fill();
      doc.fillColor('#FFFFFF').fontSize(fontSize + 1).font('Helvetica-Bold');
      let xH = startX;
      headers.forEach((h, i) => {
        doc.text(h, xH + 4, y + 6, { width: colWidths[i] - 8, align: 'left' });
        xH += colWidths[i];
      });
      y += 20;
      doc.font('Helvetica').fontSize(fontSize).fillColor('#333333');
    }

    if (rowIndex % 2 === 0) {
      doc.fillColor(rowFill).rect(startX, y, tableWidth, 18).fill();
    }

    doc.fillColor('#333333');
    let xRow = startX;
    row.forEach((cell, i) => {
      doc.text(String(cell || ''), xRow + 4, y + 5, { 
        width: colWidths[i] - 8, 
        align: 'left', 
        lineBreak: false,
        ellipsis: true
      });
      xRow += colWidths[i];
    });
    y += 18;
  });

  return y;
};

// @desc    Export Leaves and ODs as PDF
// @route   GET /api/leaves/export/pdf
// @access  Private
exports.exportReportPDF = async (req, res) => {
  try {
    const { 
      status, fromDate, toDate, leaveType, department, division, designation, search, employeeId,
      includeLeaves = 'true', includeODs = 'true', includeSummary = 'true' 
    } = req.query;

    // Multi-layered filter logic (same as getLeaves for consistency/security)
    const scopeFilter = req.scopeFilter || { isActive: true };
    const workflowFilter = buildWorkflowVisibilityFilter(req.user);
    const scopedEmployeeIds = await getEmployeeIdsInScope(req.user);
    
    let jurisdictionFilter = scopeFilter;
    let visibilityFilter = workflowFilter;
    
    if (Array.isArray(scopedEmployeeIds) && scopedEmployeeIds.length > 0) {
      jurisdictionFilter = {
        $or: [
          scopeFilter,
          { employeeId: { $in: scopedEmployeeIds } }
        ]
      };
      visibilityFilter = {
        $or: [
          workflowFilter,
          { employeeId: { $in: scopedEmployeeIds } }
        ]
      };
    }

    const baseFilter = {
      $and: [
        jurisdictionFilter,
        visibilityFilter,
        { isActive: true }
      ]
    };

    if (status && !['leaves', 'od', 'all'].includes(status)) baseFilter.status = status;
    if (employeeId && employeeId !== 'all') {
      const ids = String(employeeId).split(',').filter(id => id && id !== 'all');
      if (ids.length > 0) baseFilter.employeeId = ids.length > 1 ? { $in: ids } : ids[0];
    }
    if (department && department !== 'all') {
      const ids = String(department).split(',').filter(id => id && id !== 'all');
      if (ids.length > 0) baseFilter.department = ids.length > 1 ? { $in: ids } : ids[0];
    }
    if (division && division !== 'all') {
      const ids = String(division).split(',').filter(id => id && id !== 'all');
      if (ids.length > 0) baseFilter.division_id = ids.length > 1 ? { $in: ids } : ids[0];
    }
    if (designation && designation !== 'all') {
      const ids = String(designation).split(',').filter(id => id && id !== 'all');
      if (ids.length > 0) baseFilter.designation = ids.length > 1 ? { $in: ids } : ids[0];
    }
    if (fromDate) baseFilter.fromDate = { $gte: new Date(fromDate) };
    if (toDate) baseFilter.toDate = { ...baseFilter.toDate, $lte: new Date(toDate) };

    // Search logic (resolve employee IDs)
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
        baseFilter.employeeId = { $in: ids };
      } else {
        baseFilter.employeeId = { $in: [] };
      }
    }

    // Clone for Leave and OD
    const leaveFilter = { ...baseFilter };
    if (leaveType) leaveFilter.leaveType = leaveType;

    const odFilter = { ...baseFilter };
    // OD status mapping if needed (OD uses similar statuses)

    const [leaves, ods] = await Promise.all([
      includeLeaves === 'true' ? Leave.find(leaveFilter).populate({
          path: 'employeeId',
          select: 'employee_name emp_no first_name last_name department_id division_id department',
          populate: [
            { path: 'department', select: 'name code' },
            { path: 'division', select: 'name code' }
          ]
        }).lean() : [],
      includeODs === 'true' ? OD.find(odFilter).populate({
          path: 'employeeId',
          select: 'employee_name emp_no first_name last_name department_id division_id department',
          populate: [
            { path: 'department', select: 'name code' },
            { path: 'division', select: 'name code' }
          ]
        }).lean() : []
    ]);

    // Setup PDF - LANDSCAPE
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape', bufferPages: true });
    const filename = `Report_${new Date().toISOString().split('T')[0]}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    const pageWidth = doc.page.width;
    const margin = 30;

    // --- Header ---
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#00008B')
       .text("PYDAH COLLEGE OF ENGINEERING & TECHNOLOGY", { align: 'center' });
    doc.moveDown(0.2);
    doc.fontSize(14).fillColor('#000000')
       .text("Leave & OD Request Report", { align: 'center' });
    
    // Filter summary
    doc.fontSize(9).font('Helvetica').text(`Period: ${fromDate || 'Any'} to ${toDate || 'Any'} | Status: ${status || 'All'}`, { align: 'left' });
    doc.moveTo(margin, doc.y + 5).lineTo(pageWidth - margin, doc.y + 5).strokeColor('#CCCCCC').stroke();
    doc.moveDown(1.5);

    let currentY = doc.y;

    const formatDate = (date) => date ? new Date(date).toLocaleDateString('en-GB') : '-';
    // Helper to get name without ID part (since ID is now a separate column)
    const getCleanEmpName = (emp) => {
      if (!emp) return '-';
      return emp.employee_name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim();
    };

    const getEmpName = (emp) => {
      if (!emp) return '-';
      if (emp.employee_name) return emp.employee_name;
      return `${emp.first_name || ''} ${emp.last_name || ''} (${emp.emp_no || ''})`.trim();
    };

    // Columns: [S.No(30), Emp ID(60), Employee Name(150), Division(120), Department(120), Type(70), Dates(120), Days(40), Status(70)]
    const tableHeader = ['S.No', 'Emp ID', 'Employee Name', 'Division', 'Department', 'Type', 'Dates', 'Days', 'Status'];
    const tableColWidths = [30, 60, 150, 120, 120, 70, 120, 40, 70];
    if (includeLeaves === 'true' && leaves.length > 0) {
      doc.fontSize(11).font('Helvetica-Bold').text("LEAVE APPLICATIONS", margin, currentY);
      currentY = drawPDFTable(doc, 
        tableHeader,
        leaves.map((l, i) => [
          i + 1,
          l.employeeId?.emp_no || '-',
          getCleanEmpName(l.employeeId),
          l.employeeId?.division?.name || '-',
          l.employeeId?.department?.name || '-',
          l.leaveType,
          `${formatDate(l.fromDate)}${l.fromDate !== l.toDate ? ' - ' + formatDate(l.toDate) : ''}`,
          l.numberOfDays,
          (l.status || '').toUpperCase()
        ]),
        margin, currentY + 15, tableColWidths
      );
      currentY += 25;
    }

    // --- OD Table ---
    if (includeODs === 'true' && ods.length > 0) {
      if (currentY > 450) { doc.addPage(); currentY = 50; }
      doc.fontSize(11).font('Helvetica-Bold').text("ON DUTY (OD) APPLICATIONS", margin, currentY);
      currentY = drawPDFTable(doc, 
        tableHeader,
        ods.map((o, i) => [
          i + 1,
          o.employeeId?.emp_no || '-',
          getCleanEmpName(o.employeeId),
          o.employeeId?.division?.name || '-',
          o.employeeId?.department?.name || '-',
          (o.odType || '').replace('_', ' '),
          `${formatDate(o.fromDate)}${o.fromDate !== o.toDate ? ' - ' + formatDate(o.toDate) : ''}`,
          o.numberOfDays,
          (o.status || '').toUpperCase()
        ]),
        margin, currentY + 15, tableColWidths,
        { headerFill: '#8e44ad' }
      );
      currentY += 25;
    }

    // --- Summary Table ---
    if (includeSummary === 'true') {
      if (currentY > 400) { doc.addPage(); currentY = 50; }
      doc.fontSize(11).font('Helvetica-Bold').text("SUMMARY (APPROVED)", margin, currentY);
      
      const summaryMap = {};
      const process = (item, isOD) => {
        if (item.status !== 'approved' && item.status !== 'split_approved') return;
        const emp = item.employeeId;
        const empKey = emp?._id?.toString() || getEmpName(emp);
        if (!summaryMap[empKey]) {
          summaryMap[empKey] = { 
            empNo: emp?.emp_no || '-',
            name: getCleanEmpName(emp),
            division: emp?.division?.name || '-',
            department: emp?.department?.name || '-',
            CL: 0, 
            OTHER: 0, 
            OD: 0 
          };
        }
        const days = item.numberOfDays || 0;
        if (isOD) summaryMap[empKey].OD += days;
        else if (item.leaveType === 'CL') summaryMap[empKey].CL += days;
        else summaryMap[empKey].OTHER += days;
      };

      if (includeLeaves === 'true') leaves.forEach(l => process(l, false));
      if (includeODs === 'true') ods.forEach(o => process(o, true));

      const summaryHeaders = ['S.No', 'Emp ID', 'Employee Name', 'Division', 'Department'];
      const summaryColWidths = [30, 60, 150, 120, 120];
      
      if (includeLeaves === 'true') { 
        summaryHeaders.push('CL', 'Other'); 
        summaryColWidths.push(45, 45); 
      }
      if (includeODs === 'true') { 
        summaryHeaders.push('OD'); 
        summaryColWidths.push(45); 
      }
      summaryHeaders.push('Total'); 
      summaryColWidths.push(55);

      const summaryData = Object.values(summaryMap).map((emp, i) => {
        const row = [i + 1, emp.empNo, emp.name, emp.division, emp.department];
        let total = 0;
        if (includeLeaves === 'true') { 
          row.push(emp.CL, emp.OTHER); 
          total += emp.CL + emp.OTHER; 
        }
        if (includeODs === 'true') { 
          row.push(emp.OD); 
          total += emp.OD; 
        }
        row.push(total);
        return row;
      });

      if (summaryData.length > 0) {
        currentY = drawPDFTable(doc, summaryHeaders, summaryData, margin, currentY + 15, summaryColWidths, { headerFill: '#34495e' });
      } else {
        doc.fontSize(9).font('Helvetica-Oblique').text("No approved requests found for summary.", margin, currentY + 15);
      }
    }

    // Footer on each page
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(8).fillColor('#999999').text(
            `Generated on ${new Date().toLocaleString()} | Page ${i + 1} of ${pages.count}`,
            margin, doc.page.height - 35, { align: 'center', lineBreak: false }
        );
    }

    doc.end();

  } catch (error) {
    console.error('Backend PDF Export Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Failed to generate PDF' });
    }
  }
};



// @desc    Export Excel report
// @route   GET /api/leaves/export/xlsx
// @access  Private
exports.exportReportXLSX = async (req, res) => {
  try {
    const { 
      status, fromDate, toDate, leaveType, department, division, designation, search, employeeId,
      includeLeaves = 'true', includeODs = 'true'
    } = req.query;

    // Reuse filter logic from exportReportPDF
    const scopeFilter = req.scopeFilter || { isActive: true };
    const workflowFilter = buildWorkflowVisibilityFilter(req.user);
    const scopedEmployeeIds = await getEmployeeIdsInScope(req.user);
    
    let jurisdictionFilter = scopeFilter;
    let visibilityFilter = workflowFilter;
    
    if (Array.isArray(scopedEmployeeIds) && scopedEmployeeIds.length > 0) {
      jurisdictionFilter = {
        $or: [
          scopeFilter,
          { employeeId: { $in: scopedEmployeeIds } }
        ]
      };
      visibilityFilter = {
        $or: [
          workflowFilter,
          { employeeId: { $in: scopedEmployeeIds } }
        ]
      };
    }

    const baseFilter = {
      $and: [
        jurisdictionFilter,
        visibilityFilter,
        { isActive: true }
      ]
    };

    if (status && !['leaves', 'od', 'all'].includes(status)) baseFilter.status = status;
    if (employeeId && employeeId !== 'all') {
      const ids = String(employeeId).split(',').filter(id => id && id !== 'all');
      if (ids.length > 0) baseFilter.employeeId = ids.length > 1 ? { $in: ids } : ids[0];
    }
    if (department && department !== 'all') {
      const ids = String(department).split(',').filter(id => id && id !== 'all');
      if (ids.length > 0) baseFilter.department = ids.length > 1 ? { $in: ids } : ids[0];
    }
    if (division && division !== 'all') {
      const ids = String(division).split(',').filter(id => id && id !== 'all');
      if (ids.length > 0) baseFilter.division_id = ids.length > 1 ? { $in: ids } : ids[0];
    }
    if (designation && designation !== 'all') {
      const ids = String(designation).split(',').filter(id => id && id !== 'all');
      if (ids.length > 0) baseFilter.designation = ids.length > 1 ? { $in: ids } : ids[0];
    }
    if (fromDate) baseFilter.fromDate = { $gte: new Date(fromDate) };
    if (toDate) baseFilter.toDate = { ...baseFilter.toDate, $lte: new Date(toDate) };

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
        baseFilter.employeeId = { $in: ids };
      } else {
        baseFilter.employeeId = { $in: [] };
      }
    }

    const leaveFilter = { ...baseFilter };
    if (leaveType) leaveFilter.leaveType = leaveType;

    const [leaves, ods] = await Promise.all([
      includeLeaves === 'true' ? Leave.find(leaveFilter).populate({
          path: 'employeeId',
          select: 'employee_name emp_no department_id division_id',
          populate: [
            { path: 'department_id', select: 'name' },
            { path: 'division_id', select: 'name' }
          ]
        }).lean() : [],
      includeODs === 'true' ? OD.find(baseFilter).populate({
          path: 'employeeId',
          select: 'employee_name emp_no department_id division_id',
          populate: [
            { path: 'department_id', select: 'name' },
            { path: 'division_id', select: 'name' }
          ]
        }).lean() : []
    ]);

    const wb = XLSX.utils.book_new();

    if (includeLeaves === 'true' && leaves.length > 0) {
      const leaveData = leaves.map(l => ({
        'Emp No': l.employeeId?.emp_no || 'N/A',
        'Employee Name': l.employeeId?.employee_name || 'N/A',
        'Division': l.employeeId?.division_id?.name || 'N/A',
        'Department': l.employeeId?.department_id?.name || 'N/A',
        'Leave Type': l.leaveType || 'N/A',
        'From Date': dayjs(l.fromDate).format('DD-MM-YYYY'),
        'To Date': dayjs(l.toDate).format('DD-MM-YYYY'),
        'Days': l.numberOfDays || 0,
        'Status': l.status || 'N/A',
        'Applied At': dayjs(l.appliedAt).format('DD-MM-YYYY HH:mm')
      }));
      const wsLeaves = XLSX.utils.json_to_sheet(leaveData);
      XLSX.utils.book_append_sheet(wb, wsLeaves, 'Leaves');
    }

    if (includeODs === 'true' && ods.length > 0) {
      const odData = ods.map(o => ({
        'Emp No': o.employeeId?.emp_no || 'N/A',
        'Employee Name': o.employeeId?.employee_name || 'N/A',
        'Division': o.employeeId?.division_id?.name || 'N/A',
        'Department': o.employeeId?.department_id?.name || 'N/A',
        'OD Type': o.odType || 'N/A',
        'From Date': dayjs(o.fromDate).format('DD-MM-YYYY'),
        'To Date': dayjs(o.toDate).format('DD-MM-YYYY'),
        'Place': o.placeVisited || 'N/A',
        'Status': o.status || 'N/A',
        'Applied At': dayjs(o.createdAt).format('DD-MM-YYYY HH:mm')
      }));
      const wsODs = XLSX.utils.json_to_sheet(odData);
      XLSX.utils.book_append_sheet(wb, wsODs, 'On-Duty');
    }

    if (wb.SheetNames.length === 0) {
      // Create empty sheet if no data
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Message: 'No data found for selected filters' }]), 'No Data');
    }

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `Report_${dayjs().format('YYYY-MM-DD_HHmm')}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);

  } catch (error) {
    console.error('Error exporting XLSX:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to export XLSX',
    });
  }
};
