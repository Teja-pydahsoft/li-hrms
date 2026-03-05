/**
 * CCL (Compensatory Casual Leave) Controller
 * Handles CCL requests for employees who worked on holiday/week-off
 * Same workflow as Leave/OD
 */

const mongoose = require('mongoose');
const CCLRequest = require('../model/CCLRequest');
const OD = require('../model/OD');

const LeaveSettings = require('../model/LeaveSettings');
const Employee = require('../../employees/model/Employee');
const leaveRegisterService = require('../services/leaveRegisterService');
const User = require('../../users/model/User');
const PreScheduledShift = require('../../shifts/model/PreScheduledShift');
const AttendanceDaily = require('../../attendance/model/AttendanceDaily');
const Department = require('../../departments/model/Department');
const Settings = require('../../settings/model/Settings');
const { isHRMSConnected, getEmployeeByIdMSSQL } = require('../../employees/config/sqlHelper');
const {
  buildWorkflowVisibilityFilter,
  getEmployeeIdsInScope,
  checkJurisdiction
} = require('../../shared/middleware/dataScopeMiddleware');

const getEmployeeSettings = async () => {
  try {
    const dataSourceSetting = await Settings.findOne({ key: 'employee_data_source' });
    return { dataSource: dataSourceSetting?.value || 'mongodb' };
  } catch (error) {
    return { dataSource: 'mongodb' };
  }
};

const findEmployeeByEmpNo = async (empNo) => {
  if (!empNo) return null;
  let employee = await Employee.findOne({ emp_no: String(empNo).trim().toUpperCase() });
  if (employee) return employee;
  const settings = await getEmployeeSettings();
  if ((settings.dataSource === 'mssql' || settings.dataSource === 'both') && isHRMSConnected()) {
    try {
      const mssqlEmployee = await getEmployeeByIdMSSQL(empNo);
      if (mssqlEmployee) {
        employee = new Employee({
          emp_no: mssqlEmployee.emp_no,
          employee_name: mssqlEmployee.employee_name,
          department_id: mssqlEmployee.department_id || null,
          designation_id: mssqlEmployee.designation_id || null,
          division_id: mssqlEmployee.division_id || null,
          doj: mssqlEmployee.doj || null,
          dob: mssqlEmployee.dob || null,
          is_active: mssqlEmployee.is_active !== false,
        });
        await employee.save();
        return employee;
      }
    } catch (err) {
      console.error('[CCL] Error syncing from MSSQL:', err);
    }
  }
  return null;
};

const findEmployeeByIdOrEmpNo = async (identifier) => {
  if (!identifier) return null;
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    const emp = await Employee.findById(identifier);
    if (emp) return emp;
  }
  return await findEmployeeByEmpNo(identifier);
};

const getWorkflowSettings = async () => {
  let settings = await LeaveSettings.getActiveSettings('ccl');
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
    };
  }
  return settings;
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

/**
 * Get attendance punch data for employee on date (AttendanceDaily)
 * Returns { inTime, outTime, totalHours } or null + attendanceNote
 */
const getAttendanceForDate = async (employeeNumber, dateStr) => {
  const empNo = String(employeeNumber).trim().toUpperCase();
  const att = await AttendanceDaily.findOne({
    employeeNumber: empNo,
    date: dateStr,
  }).lean();

  if (!att) {
    return {
      inTime: null,
      outTime: null,
      totalHours: null,
      attendanceNote: `No thumb or punch records have been detected for this employee on ${dateStr}.`,
    };
  }

  // Multi-shift: use first shift in/out or aggregate
  let inTime = att.inTime;
  let outTime = att.outTime;
  let totalHours = att.totalHours;

  if (att.shifts && att.shifts.length > 0) {
    const first = att.shifts[0];
    const last = att.shifts[att.shifts.length - 1];
    inTime = first.inTime;
    outTime = last.outTime || first.outTime;
    if (att.totalWorkingHours != null) {
      totalHours = att.totalWorkingHours;
    } else if (inTime && outTime) {
      totalHours = (new Date(outTime) - new Date(inTime)) / (1000 * 60 * 60);
    }
  }

  return {
    inTime,
    outTime,
    totalHours: totalHours != null ? Math.round(totalHours * 100) / 100 : null,
    attendanceNote: null,
  };
};

/**
 * Get users for Assigned By dropdown: in scope (division/department) + sub_admin, super_admin
 * Exclude user with name exactly "superadmin"
 */
const getUsersForAssignedBy = async (employeeId) => {
  const employee = await Employee.findById(employeeId)
    .populate('division_id', '_id name')
    .populate('department_id', '_id name')
    .lean();

  if (!employee) return [];

  const empDivId = (employee.division_id?._id || employee.division_id)?.toString();
  const empDeptId = (employee.department_id?._id || employee.department_id)?.toString();

  const orConditions = [];

  // 1. Sub_admin and Super_admin (exclude name "superadmin")
  orConditions.push({
    role: { $in: ['sub_admin', 'super_admin'] },
    name: { $ne: 'superadmin' },
    isActive: true,
  });

  // 2. Users with divisionMapping that includes employee's division/department
  if (empDivId) {
    const elemConditions = [
      { $or: [{ division: empDivId }, { 'division._id': empDivId }] },
    ];
    if (empDeptId) {
      elemConditions.push({
        $or: [
          { departments: { $size: 0 } },
          { departments: empDeptId },
        ],
      });
    }
    orConditions.push({
      divisionMapping: { $elemMatch: { $and: elemConditions } },
      role: { $in: ['hod', 'hr', 'manager'] },
      isActive: true,
    });
  }

  const users = await User.find({ $or: orConditions })
    .select('_id name email role')
    .sort({ name: 1 })
    .lean();

  return users;
};

// @desc    Get users for Assigned By dropdown
// @route   GET /api/leaves/ccl/assigned-by-users
// @access  Private
exports.getAssignedByUsers = async (req, res) => {
  try {
    const { employeeId, empNo } = req.query;

    let employee = null;
    if (employeeId) {
      employee = await Employee.findById(employeeId);
    } else if (empNo) {
      employee = await findEmployeeByEmpNo(empNo);
    } else {
      // Fallback to current user if no params provided
      if (req.user.employeeRef) {
        employee = await Employee.findById(req.user.employeeRef);
      } else if (req.user.employeeId) {
        employee = await findEmployeeByEmpNo(req.user.employeeId);
      }
    }

    if (!employee) {
      return res.status(400).json({
        success: false,
        error: 'Employee not found. Provide employeeId or empNo.',
      });
    }

    const users = await getUsersForAssignedBy(employee._id);
    res.status(200).json({
      success: true,
      data: users,
    });
  } catch (error) {
    console.error('Error fetching assigned-by users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users',
    });
  }
};

// @desc    Get all CCL requests (with filters)
// @route   GET /api/leaves/ccl
// @access  Private
exports.getCCLs = async (req, res) => {
  try {
    const { status, employeeId, department, fromDate, toDate, page = 1, limit = 20 } = req.query;

    const scopeFilter = req.scopeFilter || { isActive: true };
    const workflowFilter = buildWorkflowVisibilityFilter(req.user);

    const filter = { $and: [scopeFilter, workflowFilter, { isActive: true }] };

    if (status) filter.status = status;
    if (employeeId) filter.employeeId = employeeId;
    if (department) filter.department_id = department;
    if (fromDate || toDate) {
      filter.date = {};
      if (fromDate) filter.date.$gte = fromDate;
      if (toDate) filter.date.$lte = toDate;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [ccls, total] = await Promise.all([
      CCLRequest.find(filter)
        .populate('employeeId', 'employee_name emp_no')
        .populate('department_id', 'name')
        .populate('assignedBy', 'name email')
        .populate('appliedBy', 'name email')
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      CCLRequest.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      count: ccls.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      data: ccls,
    });
  } catch (error) {
    console.error('Error fetching CCL requests:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch CCL requests',
    });
  }
};

// @desc    Get my CCL requests
// @route   GET /api/leaves/ccl/my
// @access  Private
exports.getMyCCLs = async (req, res) => {
  try {
    const orConditions = [{ appliedBy: req.user._id }];
    if (req.user.employeeRef) orConditions.push({ employeeId: req.user.employeeRef });
    if (req.user.employeeId) orConditions.push({ emp_no: String(req.user.employeeId).trim().toUpperCase() });
    if (!req.user.employeeRef && req.user.employeeId) {
      const emp = await Employee.findOne({ emp_no: String(req.user.employeeId).trim().toUpperCase() }).select('_id');
      if (emp) orConditions.push({ employeeId: emp._id });
    }

    const filter = { isActive: true, $or: orConditions };

    const ccls = await CCLRequest.find(filter)
      .populate('employeeId', 'employee_name emp_no')
      .populate('department_id', 'name')
      .populate('assignedBy', 'name email')
      .populate('appliedBy', 'name email')
      .sort({ date: -1, createdAt: -1 });

    res.status(200).json({
      success: true,
      count: ccls.length,
      data: ccls,
    });
  } catch (error) {
    console.error('Error fetching my CCL requests:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch my CCL requests',
    });
  }
};

// @desc    Get single CCL request
// @route   GET /api/leaves/ccl/:id
// @access  Private
exports.getCCL = async (req, res) => {
  try {
    const ccl = await CCLRequest.findById(req.params.id)
      .populate('employeeId', 'employee_name emp_no email phone_number')
      .populate('department_id', 'name code')
      .populate('assignedBy', 'name email')
      .populate('appliedBy', 'name email')
      .populate('workflow.history.actionBy', 'name email');

    if (!ccl) {
      return res.status(404).json({
        success: false,
        error: 'CCL request not found',
      });
    }

    res.status(200).json({
      success: true,
      data: ccl,
    });
  } catch (error) {
    console.error('Error fetching CCL request:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch CCL request',
    });
  }
};

// @desc    Apply for CCL
// @route   POST /api/leaves/ccl
// @access  Private
exports.applyCCL = async (req, res) => {
  try {
    const { date, isHalfDay, halfDayType, assignedBy, purpose, empNo, employeeId } = req.body;

    if (!date || typeof isHalfDay !== 'boolean' || !assignedBy || !purpose || !purpose.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Date, isHalfDay (true/false), assignedBy, and purpose are required',
      });
    }

    // Normalize date to YYYY-MM-DD
    const dateStr = new Date(date).toISOString().split('T')[0];

    // Resolve employee (self or on-behalf)
    let employee = null;
    const isGlobalAdmin = ['hr', 'sub_admin', 'super_admin'].includes(req.user.role);
    const isScopedAdmin = ['hod', 'manager'].includes(req.user.role);

    if (empNo || employeeId) {
      if (!isGlobalAdmin && !isScopedAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to apply CCL for others',
        });
      }
      employee = empNo
        ? await findEmployeeByEmpNo(empNo)
        : await findEmployeeByIdOrEmpNo(employeeId);
      if (isScopedAdmin && employee) {
        const scopedIds = await getEmployeeIdsInScope(req.user);
        const inScope = scopedIds.some(id => id.toString() === employee._id.toString());
        if (!inScope) {
          const empDeptId = (employee.department_id?._id || employee.department_id)?.toString();
          const empDivId = (employee.division_id?._id || employee.division_id)?.toString();
          let hodScope = false;
          if (req.user.role === 'hod' && empDeptId && empDivId) {
            const dept = await Department.findOne({
              _id: empDeptId,
              'divisionHODs.hod': req.user._id,
              'divisionHODs.division': empDivId,
            }).select('_id');
            hodScope = !!dept;
          }
          // Allow if current user is the reporting manager of this employee (apply on behalf of reportee)
          let isReportingManager = false;
          const reportingManagers = employee.dynamicFields?.reporting_to || employee.dynamicFields?.reporting_to_ || [];
          if (Array.isArray(reportingManagers) && reportingManagers.length > 0) {
            const reportingManagerIds = reportingManagers.map(m => (m._id || m).toString());
            const userStr = req.user._id?.toString();
            const userEmployeeIdStr = (req.user.employeeId || req.user.employeeRef)?.toString();
            isReportingManager = (userStr && reportingManagerIds.includes(userStr)) ||
              (userEmployeeIdStr && reportingManagerIds.includes(userEmployeeIdStr));
          }
          if (!hodScope && !isReportingManager) {
            return res.status(403).json({
              success: false,
              error: 'Not authorized to apply CCL for this employee',
            });
          }
        }
      }
    } else {
      if (req.user.employeeRef) employee = await findEmployeeByIdOrEmpNo(req.user.employeeRef);
      else if (req.user.employeeId) employee = await findEmployeeByEmpNo(req.user.employeeId);
    }

    if (!employee) {
      return res.status(400).json({
        success: false,
        error: 'Employee record not found',
      });
    }

    await employee.populate([{ path: 'division_id', select: 'name' }, { path: 'department_id', select: 'name' }]);

    // Validate: date must be holiday or weekly off
    const isHolWo = await isHolidayOrWeekOff(employee.emp_no, dateStr);
    if (!isHolWo) {
      return res.status(400).json({
        success: false,
        error: `Date ${dateStr} is not a holiday or weekly off for this employee. CCL can only be requested for days marked as holiday or week-off.`,
      });
    }

    // Validate assignedBy is in allowed list
    const allowedUsers = await getUsersForAssignedBy(employee._id);
    const assignedByObjId = mongoose.Types.ObjectId.isValid(assignedBy) ? new mongoose.Types.ObjectId(assignedBy) : null;
    const isAllowed = assignedByObjId && allowedUsers.some(u => u._id.toString() === assignedByObjId.toString());
    if (!isAllowed) {
      return res.status(400).json({
        success: false,
        error: 'Invalid assigned by user. Select a user from the list.',
      });
    }

    // Validate: no conflicting CCL for same employee on same date
    // Allow: first_half + second_half on same day (complementary halves)
    // Reject: full day + any; same half + same half; half + full
    const existingCCLs = await CCLRequest.find({
      employeeId: employee._id,
      date: dateStr,
      isActive: true,
      status: { $nin: ['cancelled'] },
    });

    const newHalf = isHalfDay ? (halfDayType || null) : null;

    for (const existing of existingCCLs) {
      const exHalf = existing.isHalfDay ? (existing.halfDayType || null) : null;

      if (!existing.isHalfDay) {
        return res.status(400).json({
          success: false,
          error: `A full-day CCL already exists for this employee on ${dateStr}. Duplicate CCL for the same day is not allowed.`,
        });
      }
      if (!isHalfDay) {
        return res.status(400).json({
          success: false,
          error: `A CCL already exists for this employee on ${dateStr} (${exHalf || 'half'}). You cannot add a full-day CCL.`,
        });
      }
      if (!newHalf || !exHalf) {
        return res.status(400).json({
          success: false,
          error: `A half-day CCL exists for this employee on ${dateStr}. Specify first_half or second_half for the new request, or a duplicate is not allowed.`,
        });
      }
      if (exHalf === newHalf) {
        return res.status(400).json({
          success: false,
          error: `A ${exHalf.replace('_', ' ')} CCL already exists for this employee on ${dateStr}. You can only add a CCL for the other half.`,
        });
      }
    }

    // Get attendance data
    const attData = await getAttendanceForDate(employee.emp_no, dateStr);

    // Build workflow
    const workflowSettings = await getWorkflowSettings();
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
    } else if (workflowSettings?.workflow?.steps?.length) {
      workflowSettings.workflow.steps.forEach((s, i) => {
        approvalSteps.push({
          stepOrder: i + 1,
          role: s.approverRole,
          label: s.stepName || `${s.approverRole?.toUpperCase()} Approval`,
          status: 'pending',
          isCurrent: i === 0,
        });
      });
    } else {
      approvalSteps.push(
        { stepOrder: 1, role: 'hod', label: 'HOD Approval', status: 'pending', isCurrent: true },
        { stepOrder: 2, role: 'hr', label: 'HR Approval', status: 'pending', isCurrent: false }
      );
    }

    const workflowData = {
      currentStepRole: approvalSteps[0]?.role || 'hod',
      nextApproverRole: approvalSteps[0]?.role || 'hod',
      currentStep: approvalSteps[0]?.role || 'hod',
      nextApprover: approvalSteps[0]?.role || 'hod',
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
          comments: 'CCL application submitted',
          timestamp: new Date(),
        },
      ],
    };

    const ccl = new CCLRequest({
      employeeId: employee._id,
      emp_no: employee.emp_no,
      date: dateStr,
      isHalfDay,
      halfDayType: isHalfDay ? (halfDayType || null) : null,
      inTime: attData.inTime,
      outTime: attData.outTime,
      totalHours: attData.totalHours,
      attendanceNote: attData.attendanceNote,
      assignedBy: assignedByObjId,
      purpose: purpose.trim(),
      status: 'pending',
      division_id: employee.division_id?._id || employee.division_id,
      division_name: employee.division_id?.name || 'N/A',
      department_id: employee.department_id?._id || employee.department_id,
      department_name: employee.department_id?.name || 'N/A',
      appliedBy: req.user._id,
      appliedAt: new Date(),
      workflow: workflowData,
    });

    await ccl.save();

    await ccl.populate([
      { path: 'employeeId', select: 'employee_name emp_no' },
      { path: 'department_id', select: 'name' },
      { path: 'assignedBy', select: 'name email' },
      { path: 'appliedBy', select: 'name email' },
    ]);

    res.status(201).json({
      success: true,
      message: 'CCL application submitted successfully',
      data: ccl,
    });
  } catch (error) {
    console.error('Error applying CCL:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to apply for CCL',
    });
  }
};

// @desc    Get pending CCL approvals
// @route   GET /api/leaves/ccl/pending-approvals
// @access  Private
exports.getPendingApprovals = async (req, res) => {
  try {
    const userRole = req.user.role;
    const filter = {
      isActive: true,
      appliedBy: { $ne: req.user._id },
      status: { $nin: ['approved', 'rejected', 'cancelled'] },
    };

    if (['sub_admin', 'super_admin'].includes(userRole)) {
      // no extra filter
    } else if (['hod', 'hr', 'manager'].includes(userRole)) {
      const roleVariants = [userRole];
      if (userRole === 'hr') roleVariants.push('final_authority');

      filter['$or'] = [
        { 'workflow.approvalChain': { $elemMatch: { role: { $in: roleVariants }, status: 'pending' } } },
        { 'workflow.reportingManagerIds': req.user._id.toString() }
      ];

      const employeeIds = await getEmployeeIdsInScope(req.user);
      filter.employeeId = employeeIds.length > 0 ? { $in: employeeIds } : { $in: [] };
    } else {
      // Check if user is a reporting manager even if they don't have an admin role
      filter['$or'] = [
        { 'workflow.approvalChain': { $elemMatch: { role: userRole, status: 'pending' } } },
        { 'workflow.reportingManagerIds': req.user._id.toString() }
      ];
    }

    const ccls = await CCLRequest.find(filter)
      .populate('employeeId', 'employee_name emp_no')
      .populate('department_id', 'name')
      .populate('assignedBy', 'name email')
      .populate('appliedBy', 'name email')
      .sort({ appliedAt: -1 });

    res.status(200).json({
      success: true,
      count: ccls.length,
      data: ccls,
    });
  } catch (error) {
    console.error('Error fetching pending CCL approvals:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch pending approvals',
    });
  }
};

// @desc    Process CCL action (approve/reject)
// @route   PUT /api/leaves/ccl/:id/action
// @access  Private
exports.processCCLAction = async (req, res) => {
  try {
    const { action, comments } = req.body;
    const ccl = await CCLRequest.findById(req.params.id);

    if (!ccl) {
      return res.status(404).json({ success: false, error: 'CCL request not found' });
    }

    const userRole = req.user.role;
    let activeStepIndex = -1;
    let activeStep = null;

    if (ccl.workflow?.approvalChain?.length) {
      activeStepIndex = ccl.workflow.approvalChain.findIndex(s => s.status === 'pending');
      if (activeStepIndex !== -1) activeStep = ccl.workflow.approvalChain[activeStepIndex];
    }

    if (!activeStep) {
      if (['approved', 'rejected', 'cancelled'].includes(ccl.status)) {
        return res.status(400).json({ success: false, error: `CCL is already ${ccl.status}` });
      }
      if (ccl.workflow?.nextApprover) activeStep = { role: ccl.workflow.nextApprover };
      else return res.status(400).json({ success: false, error: 'No active approval step' });
    }

    const requiredRole = activeStep.role;
    const fullUser = req.scopedUser || await User.findById(req.user.userId || req.user._id);
    if (!fullUser) return res.status(401).json({ success: false, message: 'User not found' });

    const isRoleMatch = userRole === requiredRole || (requiredRole === 'final_authority' && userRole === 'hr');
    const isGlobalAdmin = ['super_admin', 'sub_admin'].includes(userRole);

    let canProcess = false;
    if (isGlobalAdmin) {
      canProcess = true;
    } else if (requiredRole === 'reporting_manager') {
      // Logic for Reporting Manager (Virtual Role)
      const managers = ccl.workflow?.reportingManagerIds || [];
      if (managers.includes(fullUser._id.toString())) {
        canProcess = true;
      }
      // Fallback to HOD if user is an HOD for the employee
      if (!canProcess && userRole === 'hod') {
        canProcess = checkJurisdiction(fullUser, ccl);
      }
    } else if (isRoleMatch) {
      canProcess = checkJurisdiction(fullUser, ccl);
    }

    // 4. Setting: Allow higher authority to approve lower levels (same as Leave/OD)
    if (!canProcess && ccl.workflow?.approvalChain?.length > 0) {
      const workflowSettings = await getWorkflowSettings();
      const allowHigher = workflowSettings?.workflow?.allowHigherAuthorityToApproveLowerLevels === true;
      if (allowHigher) {
        const chain = ccl.workflow.approvalChain.slice().sort((a, b) => (a.stepOrder ?? 999) - (b.stepOrder ?? 999));
        const roleOrder = chain.map(s => (s.role || s.stepRole || '').toLowerCase()).filter(Boolean);
        const requiredIdx = roleOrder.indexOf(requiredRole.toLowerCase());
        let userIdx = roleOrder.indexOf(userRole.toLowerCase());
        if (userIdx === -1 && (userRole === 'hr' || userRole === 'super_admin')) userIdx = roleOrder.length;
        if (requiredIdx >= 0 && userIdx >= 0 && userIdx >= requiredIdx) {
          canProcess = true;
          if (['manager', 'hr'].includes(userRole)) {
            canProcess = checkJurisdiction(fullUser, ccl);
          }
        }
      }
    }

    if (!canProcess) {
      return res.status(403).json({ success: false, error: 'Not authorized to process this CCL' });
    }

    // On approve: validate no conflict with existing CCLs for same employee+date
    if (action === 'approve') {
      const otherCCLs = await CCLRequest.find({
        employeeId: ccl.employeeId,
        date: ccl.date,
        isActive: true,
        status: { $nin: ['cancelled'] },
        _id: { $ne: ccl._id },
      });

      const thisHalf = ccl.isHalfDay ? (ccl.halfDayType || null) : null;

      for (const other of otherCCLs) {
        const otherHalf = other.isHalfDay ? (other.halfDayType || null) : null;

        if (!other.isHalfDay) {
          return res.status(400).json({
            success: false,
            error: `Cannot approve: A full-day CCL already exists for this employee on ${ccl.date}. Duplicate CCL for the same day is not allowed.`,
          });
        }
        if (!ccl.isHalfDay) {
          return res.status(400).json({
            success: false,
            error: `Cannot approve: A half-day CCL already exists for this employee on ${ccl.date}. You cannot have a full-day CCL.`,
          });
        }
        if (!thisHalf || !otherHalf) {
          return res.status(400).json({
            success: false,
            error: `Cannot approve: A half-day CCL exists for this employee on ${ccl.date}. Specify first_half or second_half.`,
          });
        }
        if (thisHalf === otherHalf) {
          return res.status(400).json({
            success: false,
            error: `Cannot approve: A ${otherHalf.replace('_', ' ')} CCL already exists for this employee on ${ccl.date}.`,
          });
        }
      }
    }

    const historyEntry = {
      step: requiredRole,
      actionBy: req.user._id,
      actionByName: req.user.name,
      actionByRole: userRole,
      comments: comments || '',
      timestamp: new Date(),
    };

    if (action === 'approve') {
      if (activeStepIndex !== -1) {
        const step = ccl.workflow.approvalChain[activeStepIndex];
        step.status = 'approved';
        step.actionBy = req.user._id;
        step.actionByName = req.user.name;
        step.actionByRole = userRole;
        step.comments = comments;
        step.updatedAt = new Date();
        step.isCurrent = false;

        const stepStatus = `${step.role}_approved`;
        ccl.status = stepStatus;

        const nextStep = ccl.workflow.approvalChain[activeStepIndex + 1];
        if (nextStep) {
          ccl.workflow.currentStepRole = nextStep.role;
          ccl.workflow.nextApproverRole = nextStep.role;
          ccl.workflow.currentStep = nextStep.role;
          ccl.workflow.nextApprover = nextStep.role;
          nextStep.isCurrent = true;
        } else {
          ccl.workflow.isCompleted = true;
          ccl.workflow.currentStepRole = 'completed';
          ccl.workflow.nextApprover = null;
          ccl.workflow.nextApproverRole = null;
          ccl.status = 'approved';

          // Post CCL CREDIT to leave register (updateEmployeeBalance will sync Employee.compensatoryOffs)
          const increment = ccl.isHalfDay ? 0.5 : 1;
          const cclDate = new Date(ccl.date);
          try {
            const emp = await Employee.findById(ccl.employeeId)
              .populate('department_id', 'name')
              .populate('designation_id', 'name');
            if (emp) {
              await leaveRegisterService.addTransaction({
                employeeId: ccl.employeeId,
                empNo: emp.emp_no,
                employeeName: emp.employee_name || 'N/A',
                designation: (emp.designation_id && emp.designation_id.name) || 'N/A',
                department: (emp.department_id && emp.department_id.name) || 'N/A',
                divisionId: emp.division_id,
                departmentId: emp.department_id,
                dateOfJoining: emp.doj || new Date(),
                employmentStatus: emp.is_active ? 'active' : 'inactive',
                leaveType: 'CCL',
                transactionType: 'CREDIT',
                startDate: cclDate,
                endDate: cclDate,
                days: increment,
                reason: `CCL approved - worked on holiday/week-off (${cclDate.toISOString().slice(0, 10)})`,
                status: 'APPROVED',
                autoGenerated: false,
              });
            }
          } catch (err) {
            console.error('Leave register CCL credit failed (CCL already approved):', err);
          }
        }
      }

      historyEntry.action = 'approved';
      historyEntry.stepRole = requiredRole;
    } else if (action === 'reject') {
      ccl.status = 'rejected';
      ccl.workflow.isCompleted = true;
      ccl.workflow.currentStepRole = 'completed';
      ccl.workflow.nextApprover = null;
      if (activeStepIndex !== -1) {
        const step = ccl.workflow.approvalChain[activeStepIndex];
        step.status = 'rejected';
        step.actionBy = req.user._id;
        step.actionByName = req.user.name;
        step.actionByRole = userRole;
        step.comments = comments;
        step.updatedAt = new Date();
        step.isCurrent = false;
      }
      historyEntry.action = 'rejected';
      historyEntry.stepRole = requiredRole;
    } else if (action === 'forward') {
      return res.status(400).json({
        success: false,
        error: 'Forward action is disabled. Use Approve or Reject only.',
      });
    } else {
      return res.status(400).json({ success: false, error: 'Invalid action' });
    }

    ccl.workflow.history.push(historyEntry);
    ccl.markModified('workflow');
    await ccl.save();

    await ccl.populate([
      { path: 'employeeId', select: 'employee_name emp_no' },
      { path: 'department_id', select: 'name' },
      { path: 'assignedBy', select: 'name email' },
      { path: 'appliedBy', select: 'name email' },
    ]);

    res.status(200).json({
      success: true,
      message: `CCL ${action}ed successfully`,
      data: ccl,
    });
  } catch (error) {
    console.error('Error processing CCL action:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process CCL',
    });
  }
};

// @desc    Cancel CCL request
// @route   PUT /api/leaves/ccl/:id/cancel
// @access  Private
exports.cancelCCL = async (req, res) => {
  try {
    const { reason } = req.body;
    const ccl = await CCLRequest.findById(req.params.id);

    if (!ccl) {
      return res.status(404).json({ success: false, error: 'CCL request not found' });
    }

    if (['approved', 'rejected', 'cancelled'].includes(ccl.status)) {
      return res.status(400).json({
        success: false,
        error: `Cannot cancel CCL that is already ${ccl.status}`,
      });
    }

    ccl.status = 'cancelled';
    ccl.workflow.isCompleted = true;
    ccl.workflow.currentStepRole = 'completed';
    ccl.workflow.nextApprover = null;
    ccl.workflow.history.push({
      step: 'cancellation',
      action: 'cancelled',
      actionBy: req.user._id,
      actionByName: req.user.name,
      actionByRole: req.user.role,
      comments: reason || 'CCL cancelled',
      timestamp: new Date(),
    });
    ccl.markModified('workflow');
    await ccl.save();

    res.status(200).json({
      success: true,
      message: 'CCL cancelled successfully',
      data: ccl,
    });
  } catch (error) {
    console.error('Error cancelling CCL:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel CCL',
    });
  }
};

// @desc    Validate date for CCL (holiday/week-off check)
// @route   GET /api/leaves/ccl/validate-date
// @access  Private
exports.validateCCLDate = async (req, res) => {
  try {
    const { date, employeeId, empNo, isHalfDay, halfDayType } = req.query;

    if (!date) {
      return res.status(400).json({ success: false, error: 'Date is required' });
    }

    const dateStr = new Date(date).toISOString().split('T')[0];

    let employee = null;
    if (employeeId) employee = await Employee.findById(employeeId);
    else if (empNo) employee = await findEmployeeByEmpNo(empNo);
    else if (req.user.employeeRef) employee = await findEmployeeByIdOrEmpNo(req.user.employeeRef);
    else if (req.user.employeeId) employee = await findEmployeeByEmpNo(req.user.employeeId);

    if (!employee) {
      return res.status(400).json({ success: false, error: 'Employee not found' });
    }

    const isHolWo = await isHolidayOrWeekOff(employee.emp_no, dateStr);

    const existingCCLs = await CCLRequest.find({
      employeeId: employee._id,
      date: dateStr,
      isActive: true,
      status: { $nin: ['cancelled'] },
    });

    let hasConflict = false;
    let conflictMessage = null;

    const proposedHalf = isHalfDay === 'true' ? (halfDayType || null) : null;

    for (const existing of existingCCLs) {
      const exHalf = existing.isHalfDay ? (existing.halfDayType || null) : null;

      if (!existing.isHalfDay) {
        hasConflict = true;
        conflictMessage = `A full-day CCL already exists for this employee on ${dateStr}.`;
        break;
      }
      if (isHalfDay !== 'true') {
        hasConflict = true;
        conflictMessage = `A CCL already exists for this employee on ${dateStr}.`;
        break;
      }
      if (!proposedHalf || !exHalf) {
        hasConflict = true;
        conflictMessage = `A half-day CCL exists for this employee on ${dateStr}. Specify first_half or second_half.`;
        break;
      }
      if (exHalf === proposedHalf) {
        hasConflict = true;
        conflictMessage = `A ${exHalf.replace('_', ' ')} CCL already exists for this employee on ${dateStr}. You can only add a CCL for the other half.`;
        break;
      }
    }

    const valid = isHolWo && !hasConflict;
    let message = hasConflict
      ? conflictMessage
      : isHolWo
        ? 'Date is a holiday or weekly off'
        : 'Date is not a holiday or weekly off for this employee';

    // NEW: Check for actual attendance punches
    if (valid) {
      const attData = await getAttendanceForDate(employee.emp_no, dateStr);
      // Logic: Must have InTime OR TotalHours > 0
      const hasPunches = attData && (attData.inTime || (attData.totalHours && attData.totalHours > 0));

      if (!hasPunches) {
        // Fallback: Check for APPROVED OD
        const od = await OD.findOne({
          employeeId: employee._id,
          fromDate: { $lte: new Date(dateStr) },
          toDate: { $gte: new Date(dateStr) },
          status: 'approved',
          isActive: true
        });

        if (od) {
          // OD Found - Check duration
          if (od.isHalfDay) {
            // Half Day OD
            if (isHalfDay === 'true') {
              // Allowed: Half Day OD -> Half Day CCL
            } else {
              // Blocked: Half Day OD -> Full Day CCL
              return res.status(200).json({
                success: true,
                valid: false,
                hasExistingCCL: false,
                message: 'You only had a Half Day OD for this date. You can only apply for Half Day CCL.',
                date: dateStr,
              });
            }
          } else {
            // Full Day OD - Allows both Full and Half Day CCL
            // valid = true (implicitly)
          }
        } else {
          // No OD and No Punches
          return res.status(200).json({
            success: true,
            valid: false,
            hasExistingCCL: false,
            message: 'No attendance punches or approved OD found. You can only apply for CCL if you worked (punches) or had an approved OD on this Holiday/Week Off.',
            date: dateStr,
          });
        }
      }
    }

    res.status(200).json({
      success: true,
      valid,
      hasExistingCCL: hasConflict,
      message,
      date: dateStr,
    });
  } catch (error) {
    console.error('Error validating CCL date:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate date',
    });
  }
};
