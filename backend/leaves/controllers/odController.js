const mongoose = require('mongoose');
const OD = require('../model/OD');
const LeaveSettings = require('../model/LeaveSettings');
const Employee = require('../../employees/model/Employee');
const User = require('../../users/model/User');
const Settings = require('../../settings/model/Settings');
const { isHRMSConnected, getEmployeeByIdMSSQL } = require('../../employees/config/sqlHelper');
const {
  buildWorkflowVisibilityFilter,
  getEmployeeIdsInScope,
  checkJurisdiction
} = require('../../shared/middleware/dataScopeMiddleware');
const Department = require('../../departments/model/Department');
const EmployeeHistory = require('../../employees/model/EmployeeHistory');
const PreScheduledShift = require('../../shifts/model/PreScheduledShift');
const AttendanceDaily = require('../../attendance/model/AttendanceDaily');
const leaveRegisterService = require('../services/leaveRegisterService');

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
 * Always tries MongoDB first (for OD records), then MSSQL if configured
 * If found only in MSSQL, syncs to MongoDB for OD record integrity
 */
const findEmployeeByEmpNo = async (empNo) => {
  if (!empNo) return null;

  // Always try MongoDB first (OD model needs MongoDB employee references)
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
        // Sync employee from MSSQL to MongoDB for OD record integrity
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
 * Check if date is holiday or weekly off for employee (PreScheduledShift)
 */
const isHolidayOrWeekOff = async (employeeNumber, dateStr) => {
  const empNo = String(employeeNumber).trim().toUpperCase();
  const ps = await PreScheduledShift.findOne({
    employeeNumber: empNo,
    date: dateStr,
    status: { $in: ['WO', 'HOL'] },
  });
  return !!ps;
};

// @desc    Validate if date is holiday/week-off for an employee
// @route   GET /api/leaves/od/check-holiday
// @access  Private
exports.checkHoliday = async (req, res) => {
  try {
    const { date, employeeId, empNo } = req.query;

    if (!date) {
      return res.status(400).json({ success: false, error: 'Date is required' });
    }

    const dateStr = new Date(date).toISOString().split('T')[0];

    let employee = null;
    if (employeeId) {
      employee = await Employee.findById(employeeId);
    } else if (empNo) {
      employee = await findEmployeeByEmpNo(empNo);
    } else {
      // Fallback: self
      const identifier = req.user.employeeRef || req.user.employeeId;
      if (identifier) {
        employee = await findEmployeeByIdOrEmpNo(identifier);
      }
    }

    if (!employee) {
      return res.status(400).json({ success: false, error: 'Employee not found' });
    }

    const isHolWo = await isHolidayOrWeekOff(employee.emp_no, dateStr);

    res.status(200).json({
      success: true,
      isHolidayOrWeekOff: isHolWo,
      message: isHolWo 
        ? 'Selected day is holiday so this OD contributes to your compensatory off not on the working day.'
        : 'Regular working day',
      date: dateStr,
    });
  } catch (error) {
    console.error('Error in checkHoliday:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
};

/**
 * OD (On Duty) Controller
 * Handles CRUD operations and approval workflow
 */

// Helper function to get workflow settings
const getWorkflowSettings = async () => {
  let settings = await LeaveSettings.getActiveSettings('od');

  // Return default workflow if no settings found
  if (!settings) {
    return {
      settings: {
        allowBackdated: false,
        maxBackdatedDays: 0,
        allowFutureDated: true,
        maxAdvanceDays: 365,
      },
      workflow: {
        isEnabled: true,
        steps: [
          { stepOrder: 1, stepName: 'HOD Approval', approverRole: 'hod', availableActions: ['approve', 'reject'], approvedStatus: 'hod_approved', rejectedStatus: 'hod_rejected', nextStepOnApprove: 2, isActive: true },
          { stepOrder: 2, stepName: 'HR Approval', approverRole: 'hr', availableActions: ['approve', 'reject'], approvedStatus: 'approved', rejectedStatus: 'hr_rejected', nextStepOnApprove: null, isActive: true },
        ],
        finalAuthority: { role: 'hr', anyHRCanApprove: true },
      },
    };
  }

  return settings;
};

// @desc    Get all ODs (with filters)
// @route   GET /api/od
// @access  Private
exports.getODs = async (req, res) => {
  try {
    const { status, employeeId, department, division, designation, fromDate, toDate, search, page = 1, limit = 20 } = req.query;

    // Multi-layered filter: Jurisdiction (Scope) AND Timing (Workflow)
    const scopeFilter = req.scopeFilter || { isActive: true };
    const workflowFilter = buildWorkflowVisibilityFilter(req.user);

    // Include ODs whose document has division/department in scope OR whose employeeId is in scope.
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
    if (fromDate) filter.fromDate = { $gte: new Date(fromDate) };
    if (toDate) filter.toDate = { ...filter.toDate, $lte: new Date(toDate) };

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

    const [ods, total] = await Promise.all([
      OD.find(filter)
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
        .populate('assignedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      OD.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      count: ods.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      data: ods,
    });
  } catch (error) {
    console.error('Error fetching ODs:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch ODs',
    });
  }
};

// @desc    Get my ODs (for logged-in employee)
// @route   GET /api/od/my
// @access  Private
// Returns ODs applied BY me OR applied FOR me (by HOD/Manager/HR on my behalf)
exports.getMyODs = async (req, res) => {
  try {
    const { status, fromDate, toDate } = req.query;
    const orConditions = [{ appliedBy: req.user._id }];

    if (req.user.employeeRef) orConditions.push({ employeeId: req.user.employeeRef });
    if (req.user.employeeId) orConditions.push({ emp_no: String(req.user.employeeId).trim() });
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

    const ods = await OD.find(filter)
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
      .populate('assignedBy', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: ods.length,
      data: ods,
    });
  } catch (error) {
    console.error('Error fetching my ODs:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch ODs',
    });
  }
};

// @desc    Get single OD
// @route   GET /api/od/:id
// @access  Private
exports.getOD = async (req, res) => {
  try {
    const od = await OD.findById(req.params.id)
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
      .populate('assignedBy', 'name email')
      .populate('workflow.history.actionBy', 'name email')
      .populate('approvals.hod.approvedBy', 'name email')
      .populate('approvals.hr.approvedBy', 'name email');

    if (!od) {
      return res.status(404).json({
        success: false,
        error: 'OD application not found',
      });
    }

    res.status(200).json({
      success: true,
      data: od,
    });
  } catch (error) {
    console.error('Error fetching OD:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch OD',
    });
  }
};

// @desc    Apply for OD
// @route   POST /api/od
// @access  Private
exports.applyOD = async (req, res) => {
  try {
    const {
      odType,
      fromDate,
      toDate,
      purpose,
      placeVisited,
      placesVisited,
      contactNumber,
      isHalfDay,
      halfDayType,
      expectedOutcome,
      travelDetails,
      remarks,
      empNo, // Primary - emp_no for applying on behalf
      employeeId, // Legacy - for backward compatibility
      isAssigned, // If this is an assigned OD
      odType_extended, // NEW: Type of OD (full_day, half_day, hours)
      odStartTime, // NEW: OD start time (HH:MM format)
      odEndTime, // NEW: OD end time (HH:MM format)
      photoEvidence, // ADDED
      geoLocation, // ADDED
    } = req.body;

    // Photo evidence is mandatory for OD
    if (!photoEvidence || !photoEvidence.url) {
      return res.status(400).json({
        success: false,
        error: 'Photo evidence is required for OD applications.',
      });
    }

    // Get settings
    const workflowSettings = await getWorkflowSettings();
    const settings = workflowSettings.settings || {};

    // Validate Date
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkFromDate = new Date(fromDate);
    checkFromDate.setHours(0, 0, 0, 0);

    const diffTime = checkFromDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // 1. Backdate validation
    if (diffDays < 0) {
      if (!settings.allowBackdated) {
        return res.status(400).json({
          success: false,
          error: 'Backdated OD applications are not allowed.'
        });
      }

      const backdateDays = Math.abs(diffDays);
      if (settings.maxBackdatedDays !== null && settings.maxBackdatedDays !== undefined && backdateDays > settings.maxBackdatedDays) {
        return res.status(400).json({
          success: false,
          error: `OD application can only be backdated up to ${settings.maxBackdatedDays} days.`
        });
      }
    }
    // 2. Future date validation
    else if (diffDays > 0) {
      if (!settings.allowFutureDated) {
        return res.status(400).json({
          success: false,
          error: 'Future dated OD applications are not allowed.'
        });
      }

      const advanceDays = diffDays;
      if (settings.maxAdvanceDays !== null && settings.maxAdvanceDays !== undefined && advanceDays > settings.maxAdvanceDays) {
        return res.status(400).json({
          success: false,
          error: `OD application can only be applied up to ${settings.maxAdvanceDays} days in advance.`
        });
      }
    }

    // Get employee
    let employee;

    // Use empNo as primary identifier (from frontend)
    if (empNo) {
      // Check if this is self-application
      const isSelf = req.user.emp_no && (req.user.emp_no === empNo || req.user.emp_no.toLowerCase() === empNo.toLowerCase());

      // Check if user has permission to apply for others
      // Allow hod, hr, sub_admin, super_admin to apply for anyone (Global Logic)
      // Manager is handled separately with detailed scoping
      const isGlobalAdmin = ['hr', 'sub_admin', 'super_admin'].includes(req.user.role);
      const isScopedAdmin = ['hod', 'manager'].includes(req.user.role);

      console.log(`[Apply OD] User ${req.user._id} (${req.user.role}) applying for employee ${empNo}`);

      // 0. SELF APPLICATION CHECK
      if (isSelf) {
        console.log(`[Apply OD] ✅ Self Application Authorization granted`);
        employee = await findEmployeeByEmpNo(empNo);
      }
      // 1. GLOBAL ADMIN CHECK
      else if (isGlobalAdmin) {
        console.log(`[Apply OD] ✅ Global Admin Authorization granted`);
        // We still need the employee for data populating later
        employee = await findEmployeeByEmpNo(empNo);
        if (employee) {
          await employee.populate([
            { path: 'division_id', select: 'name' },
            { path: 'department_id', select: 'name' }
          ]);
        }
      }
      // 2. SCOPED ADMIN CHECK (HOD/Manager)
      else if (isScopedAdmin) {
        // Find employee to check their division/department
        // We need to fetch the employee *before* authorization in this specific case to check scope
        const targetEmployee = await findEmployeeByEmpNo(empNo);

        if (!targetEmployee) {
          return res.status(400).json({
            success: false,
            error: 'Employee record not found for scope check'
          });
        }

        // Populate division and department for scope check and snapshotting
        await targetEmployee.populate([
          { path: 'division_id', select: 'name' },
          { path: 'department_id', select: 'name' }
        ]);

        employee = targetEmployee;

        const scopeUser = await User.findById(req.user._id).select('role divisionMapping').lean();
        const userForScope = scopeUser || req.user;
        let scopedEmployeeIds = await getEmployeeIdsInScope(userForScope);

        // Self-application safety: some deployments store employeeId as emp_no instead of ObjectId
        const isSelfScoped =
          (req.user.employeeRef && req.user.employeeRef.toString() === targetEmployee._id.toString()) ||
          (req.user.employeeId && req.user.employeeId.toString() === targetEmployee._id.toString()) ||
          (req.user.employeeId && targetEmployee.emp_no && String(req.user.employeeId).trim() === String(targetEmployee.emp_no).trim());

        let isInScope = isSelfScoped || scopedEmployeeIds.some(id => id.toString() === targetEmployee._id.toString());

        if (!isInScope && req.user.role === 'hod') {
          const empDeptId = (targetEmployee.department_id?._id || targetEmployee.department_id)?.toString();
          const empDivId = (targetEmployee.division_id?._id || targetEmployee.division_id)?.toString();
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
        if (!isInScope && targetEmployee) {
          const reportingManagers = targetEmployee.dynamicFields?.reporting_to || targetEmployee.dynamicFields?.reporting_to_ || [];
          if (Array.isArray(reportingManagers) && reportingManagers.length > 0) {
            const reportingManagerIds = reportingManagers.map(m => (m._id || m).toString());
            const userStr = req.user._id?.toString();
            const userEmployeeIdStr = (req.user.employeeId || req.user.employeeRef)?.toString();
            if ((userStr && reportingManagerIds.includes(userStr)) ||
              (userEmployeeIdStr && reportingManagerIds.includes(userEmployeeIdStr))) {
              isInScope = true;
              console.log(`[Apply OD] ✅ User ${req.user._id} is reporting manager for employee ${empNo}`);
            }
          }
        }

        if (!isInScope) {
          console.log(`[Apply OD] ❌ ${req.user.role} blocked from applying for employee ${empNo} outside scope.`);
          return res.status(403).json({
            success: false,
            error: 'You are not authorized to apply for employees outside your assigned data scope (Division/Department).'
          });
        }

        console.log(`[Apply OD] ✅ ${req.user.role} Authorization granted (Scoped)`);
        // Store found employee to avoid re-fetching
        employee = targetEmployee;

      }
      // 3. WORKSPACE PERMISSION CHECK (Fallback)
      else {
        // Check workspace permissions if user has active workspace
        let hasWorkspacePermission = false;
        // ... (keep existing workspace permission logic if needed as strict fallback, 
        // or rely on the above checks. For safety, we keep the original block structure but wrapped)

        if (req.user.activeWorkspaceId) {
          try {
            const odSettings = await LeaveSettings.findOne({ type: 'od', isActive: true });
            if (odSettings?.settings?.workspacePermissions) {
              const workspaceIdStr = String(req.user.activeWorkspaceId);
              const permissions = odSettings.settings.workspacePermissions[workspaceIdStr];

              if (permissions) {
                if (typeof permissions === 'boolean') {
                  hasWorkspacePermission = permissions;
                } else {
                  hasWorkspacePermission = permissions.canApplyForOthers || false;
                }
              }
            }
          } catch (error) {
            console.error('[Apply OD] Error checking workspace permissions:', error);
          }
        }

        if (!hasWorkspacePermission) {
          console.log(`[Apply OD] ❌ Authorization denied - no role or workspace permission`);
          return res.status(403).json({
            success: false,
            error: 'Not authorized to apply OD for others',
          });
        }
        console.log(`[Apply OD] ✅ Workspace Authorization granted`);
        // Find employee by emp_no (checks MongoDB first, then MSSQL based on settings)
        employee = await findEmployeeByEmpNo(empNo);
      }


    } else if (employeeId) {
      // Legacy: Check if user has permission to apply for others
      // Allow hod, hr, sub_admin, super_admin (backward compatibility)

      // Check if this is self-application
      const isSelf = req.user.employeeRef && req.user.employeeRef.toString() === employeeId.toString();

      const hasRolePermission = ['hod', 'hr', 'sub_admin', 'super_admin'].includes(req.user.role) || isSelf;

      console.log(`[Apply OD] User ${req.user._id} (${req.user.role}) applying for employee ${employeeId}(legacy)`);
      console.log(`[Apply OD] Has role permission: ${hasRolePermission} `);

      // Check workspace permissions if user has active workspace
      let hasWorkspacePermission = false;
      if (req.user.activeWorkspaceId) {
        try {
          const odSettings = await LeaveSettings.findOne({ type: 'od', isActive: true });
          if (odSettings?.settings?.workspacePermissions) {
            const workspaceIdStr = String(req.user.activeWorkspaceId);
            const permissions = odSettings.settings.workspacePermissions[workspaceIdStr];

            console.log(`[Apply OD] Checking workspace ${workspaceIdStr} permissions: `, permissions);

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
          console.error('[Apply OD] Error checking workspace permissions:', error);
        }
      }

      console.log(`[Apply OD] Has workspace permission: ${hasWorkspacePermission} `);

      // User must have either role permission OR workspace permission
      if (!hasRolePermission && !hasWorkspacePermission) {
        console.log(`[Apply OD] ❌ Authorization denied - no role or workspace permission`);
        return res.status(403).json({
          success: false,
          error: 'Not authorized to apply OD for others',
        });
      }

      console.log(`[Apply OD] ✅ Authorization granted`);

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

    // Calculate number of days
    const from = new Date(fromDate);
    const to = new Date(toDate);
    let numberOfDays;
    let durationHours = null;

    // NEW: Handle hour-based OD
    if (odType_extended === 'hours' && odStartTime && odEndTime) {
      // Validate time format (HH:MM)
      const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRegex.test(odStartTime) || !timeRegex.test(odEndTime)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid time format. Use HH:MM format (e.g., 10:00, 14:30)',
        });
      }

      // Parse start and end times
      const [startHour, startMin] = odStartTime.split(':').map(Number);
      const [endHour, endMin] = odEndTime.split(':').map(Number);
      const startMinutes = startHour * 60 + startMin;
      const endMinutes = endHour * 60 + endMin;

      // Validate: end time must be after start time
      if (endMinutes <= startMinutes) {
        return res.status(400).json({
          success: false,
          error: 'OD end time must be after start time',
        });
      }

      // Calculate duration in hours
      durationHours = (endMinutes - startMinutes) / 60;
      // Validate: duration should be reasonable (max 8 hours)
      if (durationHours > 8) {
        return res.status(400).json({
          success: false,
          error: 'OD duration cannot exceed 8 hours. Use full day or half day for longer periods',
        });
      }

      numberOfDays = durationHours / 8; // Convert to fraction of day
    } else if (isHalfDay) {
      numberOfDays = 0.5;
    } else {
      const diffTime = Math.abs(to - from);
      numberOfDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    }

    // Validate against Leave conflicts (with half-day support) - Only check APPROVED records for creation
    const { validateODRequest } = require('../../shared/services/conflictValidationService');
    const validation = await validateODRequest(
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
        conflictingLeaves: validation.conflictingLeaves,
      });
    }

    // Store warnings to include in success response
    const warnings = validation.warnings || [];

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
          action: isAssigned ? 'assigned' : 'submitted',
          actionBy: req.user._id,
          actionByName: req.user.name,
          actionByRole: req.user.role,
          comments: isAssigned ? 'OD assigned by manager' : 'OD application submitted',
          timestamp: new Date(),
        },
      ],
    };

    // NEW: Check if this OD is on a holiday/week-off for CO eligibility
    const fromDateStr = from.toISOString().split('T')[0];
    const isHolWo = await isHolidayOrWeekOff(employee.emp_no, fromDateStr);

    // Create OD application
    const od = new OD({
      employeeId: employee._id,
      emp_no: employee.emp_no,
      odType,
      fromDate: from,
      toDate: to,
      numberOfDays,
      isHalfDay: isHalfDay || false,
      halfDayType: isHalfDay ? halfDayType : null,
      purpose,
      placeVisited,
      placesVisited,
      contactNumber,
      expectedOutcome,
      travelDetails,
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
      isAssigned: isAssigned || (employeeId && employeeId !== req.user.employeeRef?.toString()),
      assignedBy: isAssigned ? req.user._id : null,
      assignedByName: isAssigned ? req.user.name : null,
      // NEW: Hour-based OD fields
      odType_extended: odType_extended || (isHalfDay ? 'half_day' : 'full_day'),
      odStartTime: odStartTime || null,
      odEndTime: odEndTime || null,
      durationHours: durationHours,
      workflow: workflowData,
      photoEvidence: photoEvidence || null, // ADDED
      geoLocation: geoLocation || null, // ADDED
      isCOEligible: isHolWo, // NEW: Flag for frontend display
    });

    await od.save();

    // Employee history: OD applied/assigned
    try {
      await EmployeeHistory.create({
        emp_no: employee.emp_no,
        event: 'od_applied',
        performedBy: req.user._id,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        details: {
          odId: od._id,
          fromDate: od.fromDate,
          toDate: od.toDate,
          numberOfDays: od.numberOfDays,
          odType: od.odType,
          odType_extended: od.odType_extended,
        },
        comments: remarks || (isAssigned ? 'OD assigned by manager' : 'OD applied'),
      });
    } catch (err) {
      console.error('Failed to log OD applied history:', err.message);
    }

    // Populate for response
    await od.populate([
      { path: 'employeeId', select: 'first_name last_name emp_no' },
      { path: 'department', select: 'name' },
      { path: 'designation', select: 'name' },
    ]);

    res.status(201).json({
      success: true,
      message: 'OD application submitted successfully',
      data: od,
      warnings: warnings.length > 0 ? warnings : undefined, // Include warnings if any
    });
  } catch (error) {
    console.error('Error applying OD:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to apply for OD',
    });
  }
};

// @desc    Update OD application
// @route   PUT /api/od/:id
// @access  Private
exports.updateOD = async (req, res) => {
  try {
    const od = await OD.findById(req.params.id);

    if (!od) {
      return res.status(404).json({
        success: false,
        error: 'OD application not found',
      });
    }

    // Check if can edit - Allow editing for pending, hod_approved, hr_approved (not final approved)
    // Super Admin can edit any status except final approved
    const isSuperAdmin = req.user.role === 'super_admin';
    const isFinalApproved = od.status === 'approved';

    if (isFinalApproved && !['super_admin', 'manager', 'hod'].includes(req.user.role)) {
      return res.status(400).json({
        success: false,
        error: 'Final approved OD cannot be edited',
      });
    }

    // Check ownership or admin permission
    const isOwner = od.appliedBy.toString() === req.user._id.toString();
    const isAssigner = od.assignedBy?.toString() === req.user._id.toString();
    const isAdmin = ['hr', 'sub_admin', 'super_admin', 'manager', 'hod'].includes(req.user.role);

    if (!isOwner && !isAssigner && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to update this OD',
      });
    }

    const allowedUpdates = [
      'odType', 'fromDate', 'toDate', 'purpose', 'placeVisited', 'placesVisited',
      'contactNumber', 'isHalfDay', 'halfDayType', 'expectedOutcome', 'travelDetails', 'remarks',
      'odType_extended', 'odStartTime', 'odEndTime', 'durationHours', // NEW: Hour-based OD fields
      'photoEvidence', 'geoLocation' // ADDED
    ];

    // Super Admin can also change status
    if (isSuperAdmin && req.body.status !== undefined) {
      const oldStatus = od.status;
      const newStatus = req.body.status;

      if (oldStatus !== newStatus) {
        allowedUpdates.push('status');

        // Add status change to timeline
        if (!od.workflow.history) {
          od.workflow.history = [];
        }
        od.workflow.history.push({
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
          od.workflow.currentStep = 'hod';
          od.workflow.nextApprover = 'hod';
        } else if (newStatus === 'hod_approved') {
          od.workflow.currentStep = 'hr';
          od.workflow.nextApprover = 'hr';
        } else if (newStatus === 'hr_approved') {
          od.workflow.currentStep = 'final';
          od.workflow.nextApprover = 'final_authority';
        } else if (newStatus === 'approved') {
          od.workflow.currentStep = 'completed';
          od.workflow.nextApprover = null;
        }
      }
    }

    // Clean up enum fields - convert empty strings to null
    if (req.body.halfDayType !== undefined) {
      if (req.body.halfDayType === '' || req.body.halfDayType === null) {
        req.body.halfDayType = null;
      }
    }
    if (req.body.odStartTime !== undefined && req.body.odStartTime === '') {
      req.body.odStartTime = null;
    }
    if (req.body.odEndTime !== undefined && req.body.odEndTime === '') {
      req.body.odEndTime = null;
    }

    // Track changes (max 2-3 changes)
    const changes = [];
    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined && od[field] !== req.body[field]) {
        const originalValue = od[field];
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

        od[field] = newValue;
      }
    });

    // Add changes to history (keep only last 2-3 changes)
    if (changes.length > 0) {
      if (!od.changeHistory) {
        od.changeHistory = [];
      }
      od.changeHistory.push(...changes);
      // Keep only last 3 changes
      if (od.changeHistory.length > 3) {
        od.changeHistory = od.changeHistory.slice(-3);
      }
    }

    // Handle hour-based OD updates
    if (req.body.odType_extended === 'hours' || od.odType_extended === 'hours') {
      if (req.body.odStartTime && req.body.odEndTime) {
        // Validate time format (HH:MM)
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(req.body.odStartTime) || !timeRegex.test(req.body.odEndTime)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid time format. Use HH:MM format (e.g., 10:00, 14:30)',
          });
        }

        // Parse start and end times
        const [startHour, startMin] = req.body.odStartTime.split(':').map(Number);
        const [endHour, endMin] = req.body.odEndTime.split(':').map(Number);
        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;

        // Validate: end time must be after start time
        if (endMinutes <= startMinutes) {
          return res.status(400).json({
            success: false,
            error: 'OD end time must be after start time',
          });
        }

        // Calculate duration in hours
        const durationHours = (endMinutes - startMinutes) / 60;
        // Validate: duration should be reasonable (max 8 hours)
        if (durationHours > 8) {
          return res.status(400).json({
            success: false,
            error: 'OD duration cannot exceed 8 hours. Use full day or half day for longer periods',
          });
        }

        od.durationHours = durationHours;
        od.numberOfDays = durationHours / 8; // Convert to fraction of day for display
        od.odType_extended = 'hours';
        if (req.body.odStartTime) od.odStartTime = req.body.odStartTime;
        if (req.body.odEndTime) od.odEndTime = req.body.odEndTime;
      }
    } else if (req.body.fromDate || req.body.toDate || req.body.isHalfDay !== undefined) {
      // Recalculate days if dates changed (for non-hour-based OD)
      if (od.isHalfDay) {
        od.numberOfDays = 0.5;
      } else {
        const diffTime = Math.abs(od.toDate - od.fromDate);
        od.numberOfDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      }
    }

    await od.save();

    // When OD is approved (e.g. Super Admin set status via updateOD), update AttendanceDaily for each day in range and recalc monthly summary
    if (od.status === 'approved') {
      try {
        console.log('[OD-FLOW] updateOD: OD is approved', { odId: od._id?.toString(), emp_no: od.emp_no, odType_extended: od.odType_extended });
        const AttendanceDaily = require('../../attendance/model/AttendanceDaily');
        const formatDate = (date) => {
          const d = new Date(date);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };
        const dateFrom = formatDate(od.fromDate);
        const dateTo = formatDate(od.toDate);
        const empNoUpper = (od.emp_no != null ? String(od.emp_no).trim() : '').toUpperCase();
        if (empNoUpper) {
          const datesToUpdate = [];
          let d = new Date(dateFrom + 'T12:00:00');
          const end = new Date(dateTo + 'T12:00:00');
          while (d <= end) {
            datesToUpdate.push(formatDate(d));
            d.setDate(d.getDate() + 1);
          }
          const empNoVariants = [...new Set([empNoUpper, String(od.emp_no)].filter(Boolean))];
          // Only touch AttendanceDaily for hour-based OD. Half-day / full-day contribute only at monthly summary.
          for (const attendanceDate of datesToUpdate) {
            if (od.odType_extended === 'hours' && od.durationHours) {
              const attendance = await AttendanceDaily.findOne({
                date: attendanceDate,
                employeeNumber: empNoVariants.length ? { $in: empNoVariants } : empNoUpper,
              });
              if (attendance) {
                attendance.odHours = od.durationHours || 0;
                attendance.odDetails = {
                  odStartTime: od.odStartTime,
                  odEndTime: od.odEndTime,
                  durationHours: od.durationHours,
                  odType: od.odType_extended,
                  odId: od._id,
                  approvedAt: od.approvedAt || new Date(),
                  approvedBy: od.approvedBy || req.user._id,
                };
                await attendance.save();
                console.log(`✅ [updateOD] AttendanceDaily updated (hour-based OD) for ${od.emp_no} on ${attendanceDate}`);
              } else {
                const newDaily = new AttendanceDaily({
                  employeeNumber: empNoUpper,
                  date: attendanceDate,
                  shifts: [],
                  odHours: od.durationHours || 0,
                  odDetails: {
                    odStartTime: od.odStartTime,
                    odEndTime: od.odEndTime,
                    durationHours: od.durationHours,
                    odType: od.odType_extended,
                    odId: od._id,
                    approvedAt: od.approvedAt || new Date(),
                    approvedBy: od.approvedBy || req.user._id,
                  },
                });
                await newDaily.save();
                console.log(`✅ [updateOD] AttendanceDaily created (hour-based OD) for ${od.emp_no} on ${attendanceDate}`);
              }
            }
            // Half-day / full-day: no daily create/update; recalc below adds 0.5/1 to monthly summary for OD-only days
          }
          // Explicit recalc so monthly summary reflects OD immediately (same as processODAction)
          console.log('[OD-FLOW] updateOD: calling recalculateOnAttendanceUpdate for', datesToUpdate.length, 'dates', datesToUpdate);
          const { recalculateOnAttendanceUpdate } = require('../../attendance/services/summaryCalculationService');
          for (const attendanceDate of datesToUpdate) {
            await recalculateOnAttendanceUpdate(empNoUpper, attendanceDate);
          }
          console.log('[OD-FLOW] updateOD: recalc done');
        }
      } catch (error) {
        console.error('Error updating AttendanceDaily / recalc on OD approval (updateOD):', error);
      }
    }

    // Populate for response
    await od.populate([
      { path: 'employeeId', select: 'employee_name emp_no' },
      { path: 'department', select: 'name' },
      { path: 'designation', select: 'name' },
      { path: 'changeHistory.modifiedBy', select: 'name email role' },
    ]);

    res.status(200).json({
      success: true,
      message: 'OD updated successfully',
      data: od,
      changes: changes,
    });
  } catch (error) {
    console.error('Error updating OD:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update OD',
    });
  }
};

// @desc    Cancel OD application
// @route   PUT /api/od/:id/cancel
// @access  Private
exports.cancelOD = async (req, res) => {
  try {
    const { reason } = req.body;
    const od = await OD.findById(req.params.id);

    if (!od) {
      return res.status(404).json({
        success: false,
        error: 'OD application not found',
      });
    }

    if (!od.canCancel()) {
      return res.status(400).json({
        success: false,
        error: 'OD cannot be cancelled in current status',
      });
    }

    const isOwner = od.appliedBy.toString() === req.user._id.toString();
    const isAssigner = od.assignedBy?.toString() === req.user._id.toString();
    const isAdmin = ['hr', 'sub_admin', 'super_admin', 'manager', 'hod'].includes(req.user.role);

    if (!isOwner && !isAssigner && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to cancel this OD',
      });
    }

    od.status = 'cancelled';
    od.cancellation = {
      cancelledBy: req.user._id,
      cancelledAt: new Date(),
      reason: reason || 'Cancelled by user',
    };
    od.workflow.currentStep = 'completed';
    od.workflow.nextApprover = null;
    od.workflow.history.push({
      step: 'cancellation',
      action: 'cancelled',
      actionBy: req.user._id,
      actionByName: req.user.name,
      actionByRole: req.user.role,
      comments: reason || 'OD application cancelled',
      timestamp: new Date(),
    });

    await od.save();

    res.status(200).json({
      success: true,
      message: 'OD cancelled successfully',
      data: od,
    });
  } catch (error) {
    console.error('Error cancelling OD:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to cancel OD',
    });
  }
};

// @desc    Get pending approvals for current user
// @route   GET /api/od/pending-approvals
// @access  Private
// Query: page, limit, search, odType, fromDate, toDate, department, division
exports.getPendingApprovals = async (req, res) => {
  try {
    const userRole = req.user.role;
    const { page = 1, limit = 20, search, odType, fromDate, toDate, department, division, designation } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(1000, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    let filter = {
      isActive: true,
      appliedBy: { $ne: req.user._id }
    };

    if (['sub_admin', 'super_admin'].includes(userRole)) {
      filter.status = { $nin: ['approved', 'rejected', 'cancelled'] };
    }
    else if (['hod', 'hr', 'manager'].includes(userRole)) {
      const roleVariants = [userRole];
      if (userRole === 'hr') roleVariants.push('final_authority');
      filter['$or'] = [
        { 'workflow.approvalChain': { $elemMatch: { role: { $in: roleVariants }, status: 'pending' } } },
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
        { 'workflow.approvalChain': { $elemMatch: { role: userRole, status: 'pending' } } },
        { 'workflow.reportingManagerIds': req.user._id.toString() }
      ];
      filter.status = { $nin: ['approved', 'rejected', 'cancelled'] };
    }

    if (odType) filter.odType = odType;
    if (fromDate) {
      filter.fromDate = filter.fromDate || {};
      filter.fromDate.$gte = new Date(fromDate);
    }
    if (toDate) {
      filter.toDate = filter.toDate || {};
      filter.toDate.$lte = new Date(toDate);
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

    const [ods, total] = await Promise.all([
      OD.find(filter)
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
        .populate('assignedBy', 'name email')
        .sort({ appliedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      OD.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      count: ods.length,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      data: ods,
    });
  } catch (error) {
    console.error('Error fetching pending approvals:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch pending approvals',
    });
  }
};

// @desc    Process OD action (approve/reject/forward)
// @route   PUT /api/od/:id/action
// @access  Private (HOD, HR, Admin)
exports.processODAction = async (req, res) => {
  try {
    const { action, comments } = req.body;
    const od = await OD.findById(req.params.id);

    if (!od) {
      return res.status(404).json({
        success: false,
        error: 'OD application not found',
      });
    }

    const userRole = req.user.role;

    // Identify the current active step from the approval chain
    let activeStepIndex = -1;
    let activeStep = null;

    if (od.workflow && od.workflow.approvalChain && od.workflow.approvalChain.length > 0) {
      activeStepIndex = od.workflow.approvalChain.findIndex(step => step.status === 'pending');
      if (activeStepIndex !== -1) {
        activeStep = od.workflow.approvalChain[activeStepIndex];
      }
    }

    // Fallback or validation
    if (!activeStep) {
      if (['approved', 'rejected', 'cancelled'].includes(od.status)) {
        return res.status(400).json({ success: false, error: `OD is already ${od.status}` });
      }
      if (od.workflow.nextApprover) {
        activeStep = { role: od.workflow.nextApprover };
      } else {
        return res.status(400).json({ success: false, error: 'No active approval step found.' });
      }
    }

    const currentApprover = activeStep.role;
    const requiredRole = currentApprover;

    // --- Authorization Check (Scoped) ---
    // Use req.scopedUser if available (from middleware), otherwise fetch full User record
    const fullUser = req.scopedUser || await User.findById(req.user.userId || req.user._id);

    if (!fullUser) {
      return res.status(401).json({ success: false, message: 'User record not found' });
    }

    // Verify user can perform the action on the record's scope using centralized helper
    // 1. Check if the user's role matches the required role (or is a valid bypass)
    let canProcess = false;
    const isRoleMatch = userRole === requiredRole || (requiredRole === 'final_authority' && userRole === 'hr');
    const isGlobalAdmin = ['super_admin', 'sub_admin'].includes(userRole);

    if (isGlobalAdmin) {
      canProcess = true;
    } else if (requiredRole === 'reporting_manager') {
      // Logic for Reporting Manager (Virtual Role)
      const managers = od.workflow?.reportingManagerIds || [];
      if (managers.includes(fullUser._id.toString())) {
        canProcess = true;
      }
      // Fallback to HOD if user is an HOD for the employee
      if (!canProcess && userRole === 'hod') {
        canProcess = checkJurisdiction(fullUser, od);
      }
    } else if (isRoleMatch) {
      // 2. If roles match, enforce Jurisdictional Check
      canProcess = checkJurisdiction(fullUser, od);
    }

    // 3. Setting: Allow higher authority to approve lower levels
    if (!canProcess && od.workflow && od.workflow.approvalChain && od.workflow.approvalChain.length > 0) {
      const workflowSettings = await getWorkflowSettings();
      const allowHigher = workflowSettings?.workflow?.allowHigherAuthorityToApproveLowerLevels === true;
      if (allowHigher) {
        const chain = od.workflow.approvalChain.slice().sort((a, b) => (a.stepOrder ?? 999) - (b.stepOrder ?? 999));
        const roleOrder = chain.map(s => (s.role || s.stepRole || '').toLowerCase()).filter(Boolean);
        const requiredIdx = roleOrder.indexOf(requiredRole.toLowerCase());
        let userIdx = roleOrder.indexOf(userRole.toLowerCase());
        if (userIdx === -1 && (userRole === 'hr' || userRole === 'super_admin')) userIdx = roleOrder.length;
        if (requiredIdx >= 0 && userIdx >= 0 && userIdx >= requiredIdx) {
          canProcess = true;
          if (['manager', 'hr'].includes(userRole)) {
            canProcess = checkJurisdiction(fullUser, od);
          }
        }
      }
    }

    if (!canProcess) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to process this OD application',
      });
    }

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
        // Conflict check for final step or HR
        const isFinishingChain = (activeStepIndex === od.workflow.approvalChain.length - 1);
        const isFinalAuth = (userRole === od.workflow.finalAuthority);

        if (isFinishingChain || isFinalAuth || userRole === 'hr') {
          const { validateODRequest } = require('../../shared/services/conflictValidationService');
          const validation = await validateODRequest(od.employeeId, od.emp_no, od.fromDate, od.toDate, od.isHalfDay || false, od.halfDayType || null, false, od._id);
          if (!validation.isValid) {
            return res.status(400).json({ success: false, error: validation.errors[0] || 'Conflict with approved records' });
          }
        }

        // 2. Process Approval in Chain
        if (activeStepIndex !== -1) {
          const currentStep = od.workflow.approvalChain[activeStepIndex];
          currentStep.status = 'approved';
          currentStep.actionBy = req.user._id;
          currentStep.actionByName = req.user.name;
          currentStep.actionByRole = userRole;
          currentStep.comments = comments;
          currentStep.updatedAt = new Date();
          currentStep.isCurrent = false;

          // Legacy approvals object update
          if (['hod', 'manager', 'hr'].includes(currentStep.role)) {
            if (!od.approvals) od.approvals = {};
            od.approvals[currentStep.role] = { status: 'approved', approvedBy: req.user._id, approvedAt: new Date(), comments };
          }
        }

        // 3. Sequential Travel Logic
        if (isFinishingChain || isFinalAuth) {
          // WORKFLOW COMPLETE
          od.status = 'approved';
          od.workflow.isCompleted = true;
          od.workflow.currentStepRole = 'completed';
          od.workflow.nextApprover = null;
          od.workflow.nextApproverRole = null;
          od.workflow.currentStep = 'completed'; // Legacy
          historyEntry.action = 'approved';
        } else {
          // MOVE TO NEXT DESK
          const nextStep = od.workflow.approvalChain[activeStepIndex + 1];
          nextStep.isCurrent = true;

          od.workflow.currentStepRole = nextStep.role;
          od.workflow.nextApprover = nextStep.role;
          od.workflow.nextApproverRole = nextStep.role;
          od.workflow.currentStep = nextStep.role; // Legacy

          // Set intermediate status
          if (requiredRole === 'hod') od.status = 'hod_approved';
          else if (requiredRole === 'manager') od.status = 'manager_approved';
          else if (requiredRole === 'hr') od.status = 'hr_approved';
          else od.status = 'pending';

          historyEntry.action = 'approved';
        }
        break;

      case 'reject':
        if (activeStepIndex !== -1) {
          const currentStep = od.workflow.approvalChain[activeStepIndex];
          currentStep.status = 'rejected';
          currentStep.actionBy = req.user._id;
          currentStep.actionByName = req.user.name;
          currentStep.actionByRole = userRole;
          currentStep.comments = comments;
          currentStep.updatedAt = new Date();
          currentStep.isCurrent = false;
        }

        // Legacy Updates
        if (['hod', 'manager', 'hr'].includes(requiredRole)) {
          if (!od.approvals) od.approvals = {};
          od.approvals[requiredRole] = { status: 'rejected', approvedBy: req.user._id, approvedAt: new Date(), comments };
        }

        if (requiredRole === 'hod') od.status = 'hod_rejected';
        else if (requiredRole === 'manager') od.status = 'manager_rejected';
        else if (requiredRole === 'hr') od.status = 'hr_rejected';
        else od.status = 'rejected';

        od.workflow.isCompleted = true;
        od.workflow.currentStepRole = 'completed';
        od.workflow.nextApprover = null;
        historyEntry.action = 'rejected';
        break;

      case 'forward':
        return res.status(400).json({
          success: false,
          error: 'Forward action is disabled. Use Approve or Reject only. Each step must be approved or rejected in sequence.',
        });

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid action',
        });
    }

    od.workflow.history.push(historyEntry);
    await od.save();

    // Employee history: OD final decision
    try {
      if (action === 'approve' && od.status === 'approved') {
        await EmployeeHistory.create({
          emp_no: od.emp_no,
          event: 'od_approved',
          performedBy: req.user._id,
          performedByName: req.user.name,
          performedByRole: userRole,
          details: {
            odId: od._id,
            fromDate: od.fromDate,
            toDate: od.toDate,
            numberOfDays: od.numberOfDays,
            odType: od.odType,
            odType_extended: od.odType_extended,
          },
          comments: comments && comments.trim()
            ? comments
            : 'OD fully approved; employee will be on official duty for these dates',
        });
      } else if (action === 'reject' && od.status === 'rejected') {
        await EmployeeHistory.create({
          emp_no: od.emp_no,
          event: 'od_rejected',
          performedBy: req.user._id,
          performedByName: req.user.name,
          performedByRole: userRole,
          details: {
            odId: od._id,
            fromDate: od.fromDate,
            toDate: od.toDate,
            numberOfDays: od.numberOfDays,
          },
          comments: comments && comments.trim()
            ? comments
            : 'OD rejected',
        });
      }
    } catch (err) {
      console.error('Failed to log OD approval/rejection history:', err.message);
    }

    // When OD is fully approved, update or create AttendanceDaily for each day in OD range so totalWorkingHours/status/payableShifts reflect OD
    if (action === 'approve' && od.status === 'approved') {
      try {
        console.log('[OD-FLOW] processODAction: OD fully approved', { odId: od._id?.toString(), emp_no: od.emp_no, odType_extended: od.odType_extended, fromDate: od.fromDate, toDate: od.toDate });
        const AttendanceDaily = require('../../attendance/model/AttendanceDaily');
        const formatDate = (date) => {
          const d = new Date(date);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };
        const dateFrom = formatDate(od.fromDate);
        const dateTo = formatDate(od.toDate);
        const empNoRaw = od.emp_no != null ? String(od.emp_no).trim() : '';
        const empNoUpper = empNoRaw.toUpperCase();
        if (!empNoUpper) {
          console.log('[OD-FLOW] processODAction: skip (no emp_no)');
          return;
        }

        const datesToUpdate = [];
        let d = new Date(dateFrom + 'T12:00:00');
        const end = new Date(dateTo + 'T12:00:00');
        while (d <= end) {
          datesToUpdate.push(formatDate(d));
          d.setDate(d.getDate() + 1);
        }
        console.log('[OD-FLOW] processODAction: datesToUpdate', datesToUpdate, 'hourBased=', od.odType_extended === 'hours');

        // Only touch AttendanceDaily for hour-based OD. Half-day and full-day OD contribute only at monthly summary (no daily create/update).
        for (const attendanceDate of datesToUpdate) {
          const empNoVariants = [...new Set([empNoUpper, empNoRaw, String(od.emp_no)].filter(Boolean))];
          const attendance = await AttendanceDaily.findOne({
            date: attendanceDate,
            employeeNumber: empNoVariants.length ? { $in: empNoVariants } : empNoUpper,
          });

          if (od.odType_extended === 'hours') {
            if (attendance) {
              attendance.odHours = od.durationHours || 0;
              attendance.odDetails = {
                odStartTime: od.odStartTime,
                odEndTime: od.odEndTime,
                durationHours: od.durationHours,
                odType: od.odType_extended,
                odId: od._id,
                approvedAt: new Date(),
                approvedBy: req.user._id,
              };
              await attendance.save();
              console.log(`✅ AttendanceDaily updated (hour-based OD) for ${od.emp_no} on ${attendanceDate}`);
            } else {
              const newDaily = new AttendanceDaily({
                employeeNumber: empNoUpper,
                date: attendanceDate,
                shifts: [],
                odHours: od.durationHours || 0,
                odDetails: {
                  odStartTime: od.odStartTime,
                  odEndTime: od.odEndTime,
                  durationHours: od.durationHours,
                  odType: od.odType_extended,
                  odId: od._id,
                  approvedAt: new Date(),
                  approvedBy: req.user._id,
                },
              });
              await newDaily.save();
              console.log(`✅ AttendanceDaily created (hour-based OD) for ${od.emp_no} on ${attendanceDate}`);
            }
          }
          // Half-day / full-day: do not create or update daily; recalc below will add 0.5/1 to monthly summary for OD-only days
        }

        // NEW: Compensatory Off Credit for Holidays/Week-offs
        try {
          console.log('[OD-FLOW] processODAction: checking for holiday/week-off CO credit');
          const emp = await Employee.findById(od.employeeId)
            .populate('department_id', 'name')
            .populate('designation_id', 'name');
            
          for (const attendanceDate of datesToUpdate) {
            const isHolWo = await isHolidayOrWeekOff(od.emp_no, attendanceDate);
            if (isHolWo) {
              const increment = od.isHalfDay ? 0.5 : 1;
              console.log(`[OD-FLOW] processODAction: crediting ${increment} CO for ${od.emp_no} on holiday/week-off ${attendanceDate}`);
              
              if (emp) {
                await leaveRegisterService.addTransaction({
                  employeeId: od.employeeId,
                  empNo: od.emp_no,
                  employeeName: emp.employee_name || 'N/A',
                  designation: (emp.designation_id && emp.designation_id.name) || 'N/A',
                  department: (emp.department_id && emp.department_id.name) || 'N/A',
                  divisionId: emp.division_id,
                  departmentId: emp.department_id,
                  dateOfJoining: emp.doj || new Date(),
                  employmentStatus: emp.is_active ? 'active' : 'inactive',
                  leaveType: 'CCL',
                  transactionType: 'CREDIT',
                  startDate: new Date(attendanceDate + 'T00:00:00Z'),
                  endDate: new Date(attendanceDate + 'T00:00:00Z'),
                  days: increment,
                  reason: `Compensatory Off credited for OD on holiday/week-off (${attendanceDate})`,
                  status: 'APPROVED',
                  autoGenerated: true,
                });
              }
            }
          }
        } catch (coErr) {
          console.error('[OD-FLOW] processODAction: CO credit failed:', coErr);
        }

        // Explicitly recalc monthly summary so it reflects hour-based OD (shift/day -> PRESENT)
        // Post-save on each daily runs async (setImmediate); this ensures summary is updated in this request
        try {
          console.log('[OD-FLOW] processODAction: calling recalculateOnAttendanceUpdate for', datesToUpdate.length, 'dates');
          const { recalculateOnAttendanceUpdate } = require('../../attendance/services/summaryCalculationService');
          for (const attendanceDate of datesToUpdate) {
            await recalculateOnAttendanceUpdate(empNoUpper, attendanceDate);
          }
          console.log('[OD-FLOW] processODAction: recalc done for all dates');
        } catch (recalcErr) {
          console.error('Error recalculating monthly summary after OD approval:', recalcErr);
        }
      } catch (error) {
        console.error('Error updating AttendanceDaily on OD approval:', error);
      }
    }

    await od.populate([
      { path: 'employeeId', select: 'first_name last_name emp_no' },
      { path: 'department', select: 'name' },
    ]);

    res.status(200).json({
      success: true,
      message: `OD ${action}ed successfully`,
      data: od,
    });
  } catch (error) {
    console.error('Error processing OD action:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process OD action',
    });
  }
};

// @desc    Revoke OD approval (within 2-3 hours)
// @route   PUT /api/od/:id/revoke
// @access  Private (HOD, HR, Super Admin)
exports.revokeODApproval = async (req, res) => {
  try {
    const { reason } = req.body;
    const od = await OD.findById(req.params.id);

    if (!od) {
      return res.status(404).json({
        success: false,
        error: 'OD application not found',
      });
    }

    const allowedStatuses = [
      'approved', 'rejected',
      'hod_approved', 'manager_approved', 'hr_approved',
      'hod_rejected', 'manager_rejected', 'hr_rejected'
    ];
    if (!allowedStatuses.includes(od.status)) {
      return res.status(400).json({
        success: false,
        error: 'Only approved or rejected ODs can be revoked',
      });
    }

    const chain = od.workflow?.approvalChain || [];
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
    const updatedAt = lastStep.updatedAt || od.approvals?.[lastStep.role]?.approvedAt || od.approvals?.[lastStep.stepRole]?.approvedAt;

    if (!updatedAt) {
      return res.status(400).json({
        success: false,
        error: 'No timestamp found for the last action',
      });
    }

    const hoursSinceAction = (new Date() - new Date(updatedAt)) / (1000 * 60 * 60);
    const revocationWindow = 48; // Extended to 48 hours
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

    // Also reset any subsequent steps (safety)
    for (let i = stepIndex + 1; i < chain.length; i++) {
      chain[i].isCurrent = false;
      chain[i].status = 'pending';
    }

    if (od.approvals && od.approvals[stepRole]) {
      od.approvals[stepRole] = { status: null, approvedBy: null, approvedAt: null, comments: null };
    }

    od.workflow.currentStepRole = stepRole;
    od.workflow.nextApprover = stepRole;
    od.workflow.nextApproverRole = stepRole;
    od.workflow.currentStep = stepRole;
    od.workflow.isCompleted = false;

    // Recalculate status
    if (stepIndex === 0) {
      od.status = 'pending';
    } else {
      const prevRole = chain[stepIndex - 1]?.role || chain[stepIndex - 1]?.stepRole;
      od.status = prevRole ? `${prevRole}_approved` : 'pending';
    }

    od.workflow.history.push({
      step: stepRole,
      action: 'revoked',
      actionBy: req.user._id,
      actionByName: req.user.name,
      actionByRole: userRole,
      comments: reason || `Action (${originalStatus}) revoked by ${req.user.name}`,
      timestamp: new Date(),
    });

    od.markModified('workflow');
    od.markModified('approvals');
    await od.save();

    res.status(200).json({
      success: true,
      message: `OD ${originalStatus} revoked successfully`,
      data: od,
    });
  } catch (error) {
    console.error('Error revoking OD action:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to revoke OD action',
    });
  }
};

// @desc    Delete OD (soft delete)
// @route   DELETE /api/od/:id
// @access  Private (Admin)
exports.deleteOD = async (req, res) => {
  try {
    const od = await OD.findById(req.params.id);

    if (!od) {
      return res.status(404).json({
        success: false,
        error: 'OD application not found',
      });
    }

    // Authorization: Admin can delete any, employee can delete their own if pending
    const isAdmin = ['sub_admin', 'super_admin'].includes(req.user.role);
    const isOwner = od.appliedBy?.toString() === req.user._id.toString() ||
      (req.user.employeeRef && od.employeeId?.toString() === req.user.employeeRef.toString());

    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to delete this OD application',
      });
    }

    od.isActive = false;
    await od.save();

    res.status(200).json({
      success: true,
      message: 'OD deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting OD:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete OD',
    });
  }
};

// @desc    Update OD outcome (after completion)
// @route   PUT /api/od/:id/outcome
// @access  Private
exports.updateODOutcome = async (req, res) => {
  try {
    const { actualOutcome, travelDetails } = req.body;
    const od = await OD.findById(req.params.id);

    if (!od) {
      return res.status(404).json({
        success: false,
        error: 'OD application not found',
      });
    }

    // Only approved ODs can have outcome updated
    if (od.status !== 'approved') {
      return res.status(400).json({
        success: false,
        error: 'Can only update outcome for approved ODs',
      });
    }

    // Check ownership or admin permission
    const isOwner = od.appliedBy.toString() === req.user._id.toString();
    const isAdmin = ['hr', 'sub_admin', 'super_admin'].includes(req.user.role);

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to update this OD outcome',
      });
    }

    if (actualOutcome) od.actualOutcome = actualOutcome;
    if (travelDetails?.actualExpense !== undefined) {
      od.travelDetails = { ...od.travelDetails, actualExpense: travelDetails.actualExpense };
    }

    await od.save();

    res.status(200).json({
      success: true,
      message: 'OD outcome updated successfully',
      data: od,
    });
  } catch (error) {
    console.error('Error updating OD outcome:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update OD outcome',
    });
  }
};

