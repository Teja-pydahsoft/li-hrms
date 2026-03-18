const ResignationRequest = require('../model/ResignationRequest');
const ResignationSettings = require('../model/ResignationSettings');
const Employee = require('../../employees/model/Employee');
const EmployeeHistory = require('../../employees/model/EmployeeHistory');
const {
  getEmployeeIdsInScope,
  buildWorkflowVisibilityFilter
} = require('../../shared/middleware/dataScopeMiddleware');

// @desc    Create resignation request (opens workflow)
// @route   POST /api/resignations
// @access  Private (HR, manager, super_admin, etc. - who can set left date)
exports.createResignationRequest = async (req, res) => {
  try {
    let { emp_no, leftDate, remarks, requestType } = req.body;
    requestType = requestType || 'resignation';
    const userRole = (req.user?.role || '').toLowerCase();
    const isEmployeeSelf = userRole === 'employee';
    if (isEmployeeSelf) {
      if (requestType === 'termination') {
        return res.status(403).json({ success: false, message: 'Employees cannot initiate their own termination.' });
      }
      emp_no = req.user?.employeeId || req.user?.emp_no;
      if (!emp_no) {
        return res.status(400).json({ success: false, message: 'Your employee record could not be identified. Please contact HR.' });
      }
    }
    if (!emp_no || !leftDate) {
      return res.status(400).json({ success: false, message: 'Employee number and left date are required' });
    }
    const leftDateObj = new Date(leftDate);
    if (isNaN(leftDateObj.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid left date' });
    }
    if (isEmployeeSelf && (req.body.emp_no && String(req.body.emp_no).toUpperCase() !== String(emp_no).toUpperCase())) {
      return res.status(403).json({ success: false, message: 'You can only submit a resignation for yourself.' });
    }

    const settings = await ResignationSettings.getActiveSettings();
    
    // Check termination permissions
    if (requestType === 'termination') {
      const allowedRoles = settings?.workflow?.terminationAllowedRoles || ['super_admin', 'hr'];
      const isSuperAdmin = userRole === 'super_admin';
      
      if (!isSuperAdmin && !allowedRoles.includes(userRole)) {
        return res.status(403).json({ 
          success: false, 
          message: `Your role (${userRole}) is not authorized to initiate terminations based on current policy.` 
        });
      }
    }

    const noticePeriodDays = Math.max(0, Number(settings?.noticePeriodDays) || 0);
    if (noticePeriodDays > 0 && requestType === 'resignation') {
      // Compare calendar days only (parse YYYY-MM-DD at noon UTC to avoid timezone shift)
      const leftDateStr = String(leftDate).slice(0, 10);
      const leftDay = new Date(leftDateStr + 'T12:00:00.000Z');
      const minDate = new Date();
      minDate.setUTCHours(12, 0, 0, 0);
      minDate.setUTCDate(minDate.getUTCDate() + noticePeriodDays);
      if (leftDay.getTime() < minDate.getTime()) {
        return res.status(400).json({
          success: false,
          message: `Notice period is ${noticePeriodDays} day(s). Last working date must be at least ${noticePeriodDays} days from today.`,
        });
      }
    }

    const employee = await Employee.findOne({ emp_no: String(emp_no).toUpperCase() })
      .populate('department_id', 'name')
      .populate('division_id', 'name');
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    if (employee.leftDate) {
      return res.status(400).json({ success: false, message: 'Employee already has a left date' });
    }

    const workflowEnabled = settings?.workflow?.isEnabled !== false;
    const reportingManagers = employee.dynamicFields?.reporting_to || employee.dynamicFields?.reporting_to_ || [];
    const hasReportingManager = Array.isArray(reportingManagers) && reportingManagers.length > 0;

    // Build approval chain same as Leave/OD: Reporting Manager or HOD first, then steps from settings (skip duplicate HOD)
    const approvalSteps = [];
    if (hasReportingManager) {
      approvalSteps.push({
        stepOrder: 1,
        role: 'reporting_manager',
        label: 'Reporting Manager Approval',
        status: 'pending',
        isCurrent: true,
        canEditLWD: false,
      });
    } else {
      approvalSteps.push({
        stepOrder: 1,
        role: 'hod',
        label: 'HOD Approval',
        status: 'pending',
        isCurrent: true,
        canEditLWD: false,
      });
    }
    if (workflowEnabled && settings?.workflow?.steps?.length) {
      settings.workflow.steps.forEach((step) => {
        const role = (step.approverRole || '').toLowerCase();
        if (role !== 'hod' && role !== 'reporting_manager') {
          approvalSteps.push({
            stepOrder: approvalSteps.length + 1,
            role: step.approverRole,
            label: step.stepName || `${(step.approverRole || '').toUpperCase()} Approval`,
            status: 'pending',
            isCurrent: false,
            canEditLWD: step.canEditLWD || false,
          });
        }
      });
    }
    if (approvalSteps.length === 0) {
      approvalSteps.push({
        stepOrder: 1,
        role: 'hr',
        label: 'HR Approval',
        status: 'pending',
        isCurrent: true,
      });
    }

    const firstRole = approvalSteps[0]?.role || 'hr';
    const finalAuthority = settings?.workflow?.finalAuthority?.role || 'hr';

    // Check if the submitted leftDate is the default one (today + notice period)
    // If it's different, we consider it "manually set"
    const defaultLeftDate = new Date();
    defaultLeftDate.setHours(12, 0, 0, 0);
    defaultLeftDate.setDate(defaultLeftDate.getDate() + noticePeriodDays);
    
    // Compare dates (YYYY-MM-DD only)
    const isManual = leftDateObj.toISOString().split('T')[0] !== defaultLeftDate.toISOString().split('T')[0];

    const resignation = new ResignationRequest({
      employeeId: employee._id,
      emp_no: employee.emp_no,
      leftDate: leftDateObj,
      remarks: remarks || '',
      status: 'pending',
      requestedBy: req.user._id,
      requestType,
      isLwdManual: requestType === 'termination' ? true : isManual,
      workflow: {
        currentStepRole: firstRole,
        nextApproverRole: firstRole,
        isCompleted: false,
        approvalChain: approvalSteps,
        finalAuthority,
        reportingManagerIds: hasReportingManager ? reportingManagers.map((m) => (m._id || m).toString()) : [],
        history: [
          {
            step: 'submitted',
            action: 'submitted',
            actionBy: req.user._id,
            actionByName: req.user.name,
            actionByRole: req.user.role,
            comments: 'Resignation request submitted',
            timestamp: new Date(),
          },
        ],
      },
    });
    await resignation.save();

    // Employee history: resignation submitted
    try {
      await EmployeeHistory.create({
        emp_no: employee.emp_no,
        event: 'resignation_submitted',
        performedBy: req.user._id,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        details: {
          resignationId: resignation._id,
          leftDate: resignation.leftDate,
          remarks: resignation.remarks,
        },
        comments: remarks || 'Resignation submitted',
      });
    } catch (err) {
      console.error('Failed to log resignation submission history:', err.message);
    }

    const populated = await ResignationRequest.findById(resignation._id)
      .populate('employeeId', 'employee_name emp_no department_id division_id')
      .populate('requestedBy', 'name email')
      .lean();

    res.status(201).json({
      success: true,
      message: 'Resignation request submitted. It will be processed through the approval flow.',
      data: populated,
    });
  } catch (error) {
    console.error('Error creating resignation request:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create resignation request',
    });
  }
};

// @desc    Get pending resignation approvals for current user
// @route   GET /api/resignations/pending-approvals
// @access  Private
exports.getPendingApprovals = async (req, res) => {
  try {
    const userRole = (req.user.role || '').toLowerCase();
    const filter = { status: 'pending' };

    if (['super_admin', 'sub_admin'].includes(userRole)) {
      // no employee scope
    } else {
      const roleVariants = [userRole];
      if (userRole === 'hr') roleVariants.push('final_authority');
      filter.$or = [
        { 'workflow.approvalChain': { $elemMatch: { role: { $in: roleVariants } } } },
        { 'workflow.reportingManagerIds': req.user._id.toString() },
      ];
      const employeeIds = await getEmployeeIdsInScope(req.user);
      filter.employeeId = employeeIds.length ? { $in: employeeIds } : { $in: [] };
    }

    const list = await ResignationRequest.find(filter)
      .populate('employeeId', 'employee_name emp_no department_id division_id')
      .populate('requestedBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();
    res.status(200).json({ success: true, data: list });
  } catch (error) {
    console.error('Error fetching pending resignation approvals:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch pending approvals',
    });
  }
};

// @desc    Approve or reject resignation request
// @route   PUT /api/resignations/:id/approve
// @access  Private
exports.approveResignationRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, comments, newLeftDate } = req.body; // action: 'approve' | 'reject'
    const resignation = await ResignationRequest.findById(id)
      .populate('employeeId')
      .populate('requestedBy', 'name email');
    if (!resignation) {
      return res.status(404).json({ success: false, message: 'Resignation request not found' });
    }
    if (resignation.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Request is no longer pending' });
    }

    // Fetch Resignation Settings to check for 'Allow Higher Authority'
    const ResignationSettings = require('../model/ResignationSettings');
    const settings = await ResignationSettings.getActiveSettings();
    const allowHigher = settings?.workflow?.allowHigherAuthorityToApproveLowerLevels === true;

    const chain = resignation.workflow?.approvalChain || [];
    const activeIndex = chain.findIndex((s) => s.status === 'pending');
    if (activeIndex === -1) {
      return res.status(400).json({ success: false, message: 'No pending approval step' });
    }
    const step = chain[activeIndex];
    const userRole = (req.user.role || '').toLowerCase();
    const isReportingManager = resignation.workflow?.reportingManagerIds?.includes(req.user._id.toString());
    const isSuperOrSubAdmin = ['super_admin', 'sub_admin'].includes(userRole);
    
    let canAct = false;
    let targetStep = step;

    if (isSuperOrSubAdmin) {
      canAct = true;
    } else {
      // Direct match with current step
      const isMatchCurrent = step.role === userRole ||
        (step.role === 'reporting_manager' && isReportingManager) ||
        (step.role === 'final_authority' && userRole === 'hr') ||
        (resignation.workflow.finalAuthority === userRole && ['hr'].includes(userRole));
      
      if (isMatchCurrent) {
        canAct = true;
      } else if (allowHigher) {
        // Check if user's role exists in any LATER pending/future steps
        // For Resignations, we look from the activeIndex onwards
        const laterSteps = chain.slice(activeIndex);
        const matchedLaterStep = laterSteps.find(s => 
          s.role === userRole || 
          (s.role === 'reporting_manager' && isReportingManager) ||
          (s.role === 'final_authority' && userRole === 'hr')
        );
        
        if (matchedLaterStep) {
          canAct = true;
          targetStep = matchedLaterStep;
        }
      }
    }

    if (!canAct) {
      return res.status(403).json({
        success: false,
        message: `Only ${step.role} can act on this step`,
      });
    }

    // Use targetStep for the action instead of just the first pending step
    const actingStep = targetStep; 

    const isApprove = action === 'approve';

    // Handle LWD Change
    if (isApprove && newLeftDate && (actingStep.canEditLWD || isSuperOrSubAdmin)) {
      const newDateObj = new Date(newLeftDate);
      if (!isNaN(newDateObj.getTime())) {
        const oldDate = resignation.leftDate;
        resignation.leftDate = newDateObj;
        resignation.isLwdManual = true; // Mark as manual override

        // Log LWD change to lwdHistory (newly added array)
        if (!resignation.lwdHistory) resignation.lwdHistory = [];
        resignation.lwdHistory.push({
          oldDate,
          newDate: newDateObj,
          updatedBy: req.user._id,
          updatedByName: req.user.name,
          updatedByRole: userRole,
          comments: comments || 'LWD updated during approval',
          timestamp: new Date(),
        });

        // Also log to workflow history for immediate visibility
        resignation.workflow.history.push({
          step: actingStep.role,
          action: 'lwd_changed',
          actionBy: req.user._id,
          actionByName: req.user.name,
          actionByRole: userRole,
          comments: `LWD changed from ${oldDate.toISOString().split('T')[0]} to ${newDateObj.toISOString().split('T')[0]}`,
          timestamp: new Date(),
        });
      }
    }

    actingStep.status = isApprove ? 'approved' : 'rejected';
    actingStep.actionBy = req.user._id;
    actingStep.actionByName = req.user.name;
    actingStep.actionByRole = userRole;
    actingStep.comments = comments || '';
    actingStep.updatedAt = new Date();

    // If a higher authority approved, we should mark all skipped earlier steps as 'approved' as well
    // or just leave them? Usually 'approved' is better so workflow proceed.
    if (isApprove && allowHigher && targetStep !== step) {
      for (let i = activeIndex; i < chain.indexOf(targetStep); i++) {
        const skippedStep = chain[i];
        if (skippedStep.status === 'pending') {
          skippedStep.status = 'approved';
          skippedStep.actionBy = req.user._id;
          skippedStep.actionByName = req.user.name;
          skippedStep.actionByRole = `${userRole} (Higher Auth)`;
          skippedStep.comments = 'Auto-approved by higher authority';
          skippedStep.updatedAt = new Date();
          
          resignation.workflow.history.push({
            step: skippedStep.role,
            action: 'approved',
            actionBy: req.user._id,
            actionByName: req.user.name,
            actionByRole: `${userRole} (Higher Auth)`,
            comments: 'Auto-approved by higher authority acting on later step',
            timestamp: new Date(),
          });
        }
      }
    }

    resignation.workflow.history.push({
      step: actingStep.role,
      action: isApprove ? 'approved' : 'rejected',
      actionBy: req.user._id,
      actionByName: req.user.name,
      actionByRole: userRole,
      comments: comments || '',
      timestamp: new Date(),
    });

    // Employee history: per-step approval / rejection
    try {
      await EmployeeHistory.create({
        emp_no: resignation.emp_no,
        event: isApprove ? 'resignation_step_approved' : 'resignation_step_rejected',
        performedBy: req.user._id,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        details: {
          resignationId: resignation._id,
          stepRole: step.role,
          stepOrder: step.stepOrder,
        },
        comments: comments || '',
      });
    } catch (err) {
      console.error('Failed to log resignation step history:', err.message);
    }

    const nextIndex = activeIndex + 1;
    const isLastStep = nextIndex >= chain.length;

    if (!isApprove) {
      resignation.status = 'rejected';
      resignation.workflow.isCompleted = true;
      resignation.workflow.currentStepRole = null;
      resignation.workflow.nextApproverRole = null;
      await resignation.save();

      // Employee history: overall resignation rejected
      try {
        await EmployeeHistory.create({
          emp_no: resignation.emp_no,
          event: 'resignation_rejected',
          performedBy: req.user._id,
          performedByName: req.user.name,
          performedByRole: req.user.role,
          details: {
            resignationId: resignation._id,
          },
          comments: comments || 'Resignation request rejected',
        });
      } catch (err) {
        console.error('Failed to log resignation rejection history:', err.message);
      }

      return res.status(200).json({
        success: true,
        message: 'Resignation request rejected',
        data: resignation,
      });
    }

    if (isLastStep) {
      resignation.status = 'approved';
      resignation.workflow.isCompleted = true;
      resignation.workflow.currentStepRole = null;
      resignation.workflow.nextApproverRole = null;

      // Calculate final LWD if not manual
      if (!resignation.isLwdManual) {
        const ResignationSettings = require('../model/ResignationSettings');
        const settings = await ResignationSettings.getActiveSettings();
        const noticePeriodDays = Math.max(0, Number(settings?.noticePeriodDays) || 0);
        
        const finalLwd = new Date();
        finalLwd.setHours(12, 0, 0, 0);
        finalLwd.setDate(finalLwd.getDate() + noticePeriodDays);
        resignation.leftDate = finalLwd;
        
        // Log this final calculation to history
        resignation.workflow.history.push({
          step: 'system',
          action: 'approved',
          actionBy: req.user._id,
          actionByName: 'System',
          actionByRole: 'system',
          comments: `Final LWD calculated as per ${noticePeriodDays} days notice period.`,
          timestamp: new Date(),
        });
      }

      await resignation.save();

      const emp = await Employee.findById(resignation.employeeId._id || resignation.employeeId);
      if (emp) {
        emp.leftDate = resignation.leftDate;
        emp.leftReason = resignation.remarks || (resignation.requestType === 'termination' ? 'Terminated' : null);
        
        // If termination, deactivate immediately
        if (resignation.requestType === 'termination') {
          emp.is_active = false;
        }

        await emp.save();

        // Employee history: final approval / left date set
        try {
          const isTermination = resignation.requestType === 'termination';
          await EmployeeHistory.create({
            emp_no: emp.emp_no,
            event: isTermination ? 'termination_final_approved' : 'resignation_final_approved',
            performedBy: req.user._id,
            performedByName: req.user.name,
            performedByRole: req.user.role,
            details: {
              resignationId: resignation._id,
              leftDate: emp.leftDate,
            },
            comments: comments || 'Resignation fully approved; left date set',
          });
        } catch (err) {
          console.error('Failed to log final resignation approval history:', err.message);
        }
      }

      return res.status(200).json({
        success: true,
        message: resignation.requestType === 'termination' 
          ? 'Termination approved. Employee has been deactivated.' 
          : 'Resignation approved. Employee left date has been set. Account remains active until last working date.',
        data: resignation,
      });
    }

    const nextStep = chain[nextIndex];
    nextStep.status = 'pending';
    nextStep.isCurrent = true;
    resignation.workflow.currentStepRole = nextStep.role;
    resignation.workflow.nextApproverRole = nextStep.role;
    await resignation.save();

    res.status(200).json({
      success: true,
      message: 'Resignation approved at this step. Forwarded to next approver.',
      data: resignation,
    });
  } catch (error) {
    console.error('Error approving resignation:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process approval',
    });
  }
};

// @desc    Get resignation requests (by employee or all for scope)
// @route   GET /api/resignations
// @access  Private
exports.getResignationRequests = async (req, res) => {
  try {
    const { emp_no } = req.query;

    // Visibility and Scope:
    // Applicants see their own. 
    // Super/Sub admins see everything. 
    // Functional roles (HOD/Manager/HR) see in-scope employees OR those in their workflow chain.
    const workflowFilter = buildWorkflowVisibilityFilter(req.user);
    const scopeEmployeeIds = await getEmployeeIdsInScope(req.user);
    
    // Final visibility: (part of workflow) OR (in administrative scope)
    const visibilityFilter = {
      $or: [
        workflowFilter,
        { employeeId: { $in: scopeEmployeeIds } }
      ]
    };

    const filter = {
      $and: [
        visibilityFilter,
        { isActive: { $ne: false } }
      ]
    };

    if (emp_no) filter.emp_no = String(emp_no).toUpperCase();
    const list = await ResignationRequest.find(filter)
      .populate('employeeId', 'employee_name emp_no department_id division_id')
      .populate('requestedBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();
    res.status(200).json({ success: true, data: list });
  } catch (error) {
    console.error('Error fetching resignation requests:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch resignation requests',
    });
  }
};

// @desc    Update Last Working Date (LWD) without immediate approval/rejection
// @route   PUT /api/resignations/:id/lwd
// @access  Private
exports.updateLWD = async (req, res) => {
  try {
    const { id } = req.params;
    const { newLeftDate, comments } = req.body;

    if (!newLeftDate) {
      return res.status(400).json({ success: false, message: 'New left date is required' });
    }

    const resignation = await ResignationRequest.findById(id);
    if (!resignation) {
      return res.status(404).json({ success: false, message: 'Resignation request not found' });
    }

    if (resignation.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Can only update LWD for pending requests' });
    }

    const userRole = (req.user.role || '').toLowerCase();
    const isSuperOrSubAdmin = ['super_admin', 'sub_admin'].includes(userRole);
    
    // Check if user is the current approver or super admin
    const chain = resignation.workflow?.approvalChain || [];
    const activeIndex = chain.findIndex(s => s.status === 'pending');
    const step = activeIndex !== -1 ? chain[activeIndex] : null;

    let canEdit = isSuperOrSubAdmin;
    if (step && !canEdit) {
      const isReportingManager = resignation.workflow?.reportingManagerIds?.includes(req.user._id.toString());
      const isCorrectRole = (step.role === userRole) || 
                          (step.role === 'reporting_manager' && isReportingManager) ||
                          (step.role === 'final_authority' && userRole === 'hr');
      
      if (isCorrectRole && step.canEditLWD) {
        canEdit = true;
      }
    }

    if (!canEdit) {
      return res.status(403).json({ success: false, message: 'You are not authorized to edit LWD at this stage' });
    }

    const newDateObj = new Date(newLeftDate);
    if (isNaN(newDateObj.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format' });
    }

    const oldDate = resignation.leftDate;
    const oldDateStr = oldDate ? oldDate.toISOString().split('T')[0] : 'None';
    const newDateStr = newDateObj.toISOString().split('T')[0];

    // Check if date actually changed
    if (oldDateStr === newDateStr) {
      return res.status(200).json({ success: true, message: 'No change in date', data: resignation });
    }

    resignation.leftDate = newDateObj;

    // Log LWD change to lwdHistory
    if (!resignation.lwdHistory) resignation.lwdHistory = [];
    resignation.lwdHistory.push({
      oldDate,
      newDate: newDateObj,
      updatedBy: req.user._id,
      updatedByName: req.user.name,
      updatedByRole: userRole,
      comments: comments || `LWD updated from ${oldDateStr} to ${newDateStr}`,
      timestamp: new Date(),
    });

    // Also log to workflow history
    resignation.workflow.history.push({
      step: step?.role || 'Admin',
      action: 'lwd_changed',
      actionBy: req.user._id,
      actionByName: req.user.name,
      actionByRole: userRole,
      comments: `LWD changed from ${oldDateStr} to ${newDateStr}. ${comments || ''}`,
      timestamp: new Date(),
    });

    await resignation.save();

    res.status(200).json({
      success: true,
      message: 'Last working date updated successfully',
      data: resignation,
    });
  } catch (error) {
    console.error('Error updating LWD:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update LWD',
    });
  }
};
