const ArrearsRequest = require('../model/ArrearsRequest');
const ArrearsService = require('../services/arrearsService');

// @desc    Create new arrears request (incremental: period + monthly amount; direct: amount + remarks only)
// @route   POST /api/arrears
// @access  Private
exports.createArrears = async (req, res) => {
  try {
    const { type, employee, startMonth, endMonth, monthlyAmount, totalAmount, amount, reason, calculationBreakdown } = req.body;

    if (!employee || !reason) {
      return res.status(400).json({
        success: false,
        message: 'Employee and reason/remarks are required'
      });
    }

    const isDirect = (type || 'incremental').toLowerCase() === 'direct';
    if (isDirect) {
      const amt = totalAmount ?? amount;
      if (amt == null || amt === '' || isNaN(Number(amt)) || Number(amt) <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Valid amount is required for direct arrears'
        });
      }
    } else {
      if (!startMonth || !endMonth || monthlyAmount == null || monthlyAmount === '' || totalAmount == null || totalAmount === '') {
        return res.status(400).json({
          success: false,
          message: 'For incremental arrears provide startMonth, endMonth, monthlyAmount, and totalAmount'
        });
      }
    }

    const payload = isDirect
      ? { type: 'direct', employee, totalAmount: Number(totalAmount ?? amount), reason }
      : { type: 'incremental', employee, startMonth, endMonth, monthlyAmount: Number(monthlyAmount), totalAmount: Number(totalAmount), reason, calculationBreakdown };

    const arrears = await ArrearsService.createArrearsRequest(
      payload,
      req.user._id || req.user.userId || req.user.id
    );

    res.status(201).json({
      success: true,
      data: arrears
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get all arrears with filters
// @route   GET /api/arrears
// @access  Private
exports.getArrears = async (req, res) => {
  try {
    const { employee, status, department } = req.query;

    const filters = {};
    if (employee) filters.employee = employee;
    if (status) filters.status = status.split(',');
    if (department) filters.department = department;

    const arrears = await ArrearsService.getArrears(filters);

    res.status(200).json({
      success: true,
      count: arrears.length,
      data: arrears
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get arrears by ID
// @route   GET /api/arrears/:id
// @access  Private
exports.getArrearsById = async (req, res) => {
  try {
    const arrears = await ArrearsService.getArrearsById(req.params.id);

    res.status(200).json({
      success: true,
      data: arrears
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get employee's pending arrears
// @route   GET /api/arrears/employee/:employeeId/pending
// @access  Private
exports.getEmployeePendingArrears = async (req, res) => {
  try {
    const arrears = await ArrearsService.getEmployeePendingArrears(req.params.employeeId);

    res.status(200).json({
      success: true,
      count: arrears.length,
      data: arrears
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Submit arrears for HOD approval
// @route   PUT /api/arrears/:id/submit-hod
// @access  Private
exports.submitForHodApproval = async (req, res) => {
  try {
    const arrears = await ArrearsService.submitForHodApproval(req.params.id, req.user._id || req.user.userId || req.user.id);

    res.status(200).json({
      success: true,
      message: 'Arrears submitted for HOD approval',
      data: arrears
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    HOD approve arrears
// @route   PUT /api/arrears/:id/hod-approve
// @access  Private (HOD)
exports.hodApprove = async (req, res) => {
  try {
    const { approved, comments } = req.body;

    if (approved === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Please provide approval status'
      });
    }

    const arrears = await ArrearsService.hodApprove(
      req.params.id,
      approved,
      comments || '',
      req.user._id || req.user.userId || req.user.id
    );

    res.status(200).json({
      success: true,
      message: `Arrears ${approved ? 'approved' : 'rejected'} by HOD`,
      data: arrears
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    HR approve arrears
// @route   PUT /api/arrears/:id/hr-approve
// @access  Private (HR)
exports.hrApprove = async (req, res) => {
  try {
    const { approved, comments } = req.body;

    if (approved === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Please provide approval status'
      });
    }

    const arrears = await ArrearsService.hrApprove(
      req.params.id,
      approved,
      comments || '',
      req.user._id || req.user.userId || req.user.id
    );

    res.status(200).json({
      success: true,
      message: `Arrears ${approved ? 'approved' : 'rejected'} by HR`,
      data: arrears
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Admin approve arrears (final approval with optional modification)
// @route   PUT /api/arrears/:id/admin-approve
// @access  Private (Admin)
exports.adminApprove = async (req, res) => {
  try {
    const { approved, modifiedAmount, comments } = req.body;

    if (approved === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Please provide approval status'
      });
    }

    const arrears = await ArrearsService.adminApprove(
      req.params.id,
      approved,
      modifiedAmount,
      comments || '',
      req.user._id || req.user.userId || req.user.id
    );

    res.status(200).json({
      success: true,
      message: `Arrears ${approved ? 'approved' : 'rejected'} by Admin`,
      data: arrears
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Process arrears settlement
// @route   POST /api/arrears/settle
// @access  Private
exports.processSettlement = async (req, res) => {
  try {
    const { employeeId, month, settlements, payrollId } = req.body;

    if (!employeeId || !month || !settlements || !Array.isArray(settlements)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide employeeId, month, and settlements array'
      });
    }

    const results = await ArrearsService.processSettlement(
      employeeId,
      month,
      settlements,
      req.user._id || req.user.userId || req.user.id,
      payrollId
    );

    res.status(200).json({
      success: true,
      message: 'Arrears settled successfully',
      data: results
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Cancel arrears request
// @route   PUT /api/arrears/:id/cancel
// @access  Private
exports.cancelArrears = async (req, res) => {
  try {
    const arrears = await ArrearsService.cancelArrears(req.params.id, req.user._id || req.user.userId || req.user.id);

    res.status(200).json({
      success: true,
      message: 'Arrears cancelled successfully',
      data: arrears
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get my arrears
// @route   GET /api/arrears/my
// @access  Private
exports.getMyArrears = async (req, res) => {
  try {
    const employeeId = req.user.employeeId;

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: 'Employee record not found for user'
      });
    }

    const arrears = await ArrearsRequest.find({ employee: employeeId })
      .sort({ createdAt: -1 })
      .populate('employee', 'emp_no name');

    res.status(200).json({
      success: true,
      count: arrears.length,
      data: arrears
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get pending approvals for current user
// @route   GET /api/arrears/pending-approvals
// @access  Private (HOD, HR, Admin)
exports.getPendingApprovals = async (req, res) => {
  try {
    const User = require('../../users/model/User');
    const user = await User.findById(req.user._id || req.user.userId || req.user.id);

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'User not found'
      });
    }

    let query = {};

    // HOD: pending HOD approval
    if (user.role === 'hod' || user.roles?.includes('hod')) {
      query.status = 'pending_hod';
    }
    // HR: pending HR approval
    else if (user.role === 'hr' || user.roles?.includes('hr')) {
      query.status = 'pending_hr';
    }
    // Admin: pending admin approval
    else if (['super_admin', 'sub_admin'].includes(user.role) || user.roles?.some(r => ['super_admin', 'sub_admin'].includes(r))) {
      query.status = 'pending_admin';
    }

    const arrears = await ArrearsRequest.find(query)
      .sort({ createdAt: -1 })
      .populate('employee', 'emp_no name')
      .populate('createdBy', 'name email');

    res.status(200).json({
      success: true,
      count: arrears.length,
      data: arrears
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Edit arrears details (at any approval level)
// @route   PUT /api/arrears/:id/edit
// @access  Private (SuperAdmin)
exports.editArrears = async (req, res) => {
  try {
    const { startMonth, endMonth, monthlyAmount, totalAmount, reason } = req.body;
    const user = req.user;

    // Only SuperAdmin can edit
    if (!['super_admin', 'sub_admin'].includes(user.role) && !user.roles?.some(r => ['super_admin', 'sub_admin'].includes(r))) {
      return res.status(403).json({
        success: false,
        message: 'Only SuperAdmin can edit arrears'
      });
    }

    const arrears = await ArrearsRequest.findById(req.params.id);

    if (!arrears) {
      return res.status(404).json({
        success: false,
        message: 'Arrears not found'
      });
    }

    // Can edit at any status except settled/partially_settled/cancelled
    if (['settled', 'partially_settled', 'cancelled'].includes(arrears.status)) {
      return res.status(403).json({
        success: false,
        message: 'Cannot edit settled or cancelled arrears'
      });
    }

    // Track original amount for audit trail
    const originalAmount = arrears.totalAmount;
    const originalMonthlyAmount = arrears.monthlyAmount;

    // Update fields if provided
    if (startMonth) arrears.startMonth = startMonth;
    if (endMonth) arrears.endMonth = endMonth;
    if (monthlyAmount) arrears.monthlyAmount = monthlyAmount;
    if (totalAmount) arrears.totalAmount = totalAmount;
    if (reason) arrears.reason = reason;

    // When total amount changes, update remaining amount accordingly
    // Remaining amount should be the new total amount (since no settlement has happened yet)
    if (totalAmount && totalAmount !== originalAmount) {
      // Calculate the difference
      const amountDifference = totalAmount - originalAmount;
      // Update remaining amount with the new total
      arrears.remainingAmount = totalAmount;

      // Add to edit history if not exists
      if (!arrears.editHistory) {
        arrears.editHistory = [];
      }
      arrears.editHistory.push({
        editedAt: new Date(),
        editedBy: user._id,
        originalAmount: originalAmount,
        newAmount: totalAmount,
        originalMonthlyAmount: originalMonthlyAmount,
        newMonthlyAmount: monthlyAmount || originalMonthlyAmount,
        reason: `Amount changed from ₹${originalAmount} to ₹${totalAmount}`,
        status: arrears.status
      });
    }

    arrears.updatedBy = req.user._id || req.user.userId || req.user.id;
    await arrears.save();

    // Populate user details for response
    await arrears.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'updatedBy', select: 'name email' },
      { path: 'editHistory.editedBy', select: 'name email' },
      { path: 'statusHistory.changedBy', select: 'name email' },
      { path: 'employee', select: 'first_name last_name emp_no' }
    ]);

    res.status(200).json({
      success: true,
      message: 'Arrears updated successfully',
      data: arrears
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update arrears (only draft - legacy endpoint)
// @route   PUT /api/arrears/:id
// @access  Private
exports.updateArrears = async (req, res) => {
  try {
    const { startMonth, endMonth, monthlyAmount, totalAmount, reason } = req.body;
    const arrears = await ArrearsRequest.findById(req.params.id);

    if (!arrears) {
      return res.status(404).json({
        success: false,
        message: 'Arrears not found'
      });
    }

    if (arrears.status !== 'draft') {
      return res.status(403).json({
        success: false,
        message: 'Only draft arrears can be updated'
      });
    }

    if (startMonth) arrears.startMonth = startMonth;
    if (endMonth) arrears.endMonth = endMonth;
    if (monthlyAmount) arrears.monthlyAmount = monthlyAmount;
    if (totalAmount) arrears.totalAmount = totalAmount;
    if (reason) arrears.reason = reason;

    arrears.updatedBy = req.user._id || req.user.userId || req.user.id;
    await arrears.save();

    res.status(200).json({
      success: true,
      message: 'Arrears updated successfully',
      data: arrears
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Transition arrears to next approval level (SuperAdmin only)
// @route   PUT /api/arrears/:id/transition
// @access  Private (SuperAdmin)
exports.transitionArrears = async (req, res) => {
  try {
    const { nextStatus, startMonth, endMonth, monthlyAmount, totalAmount, reason, comments } = req.body;
    const user = req.user;

    // Only SuperAdmin can transition
    if (!['super_admin', 'sub_admin'].includes(user.role) && !user.roles?.some(r => ['super_admin', 'sub_admin'].includes(r))) {
      return res.status(403).json({
        success: false,
        message: 'Only SuperAdmin can transition arrears'
      });
    }

    const arrears = await ArrearsRequest.findById(req.params.id);

    if (!arrears) {
      return res.status(404).json({
        success: false,
        message: 'Arrears not found'
      });
    }

    // Update fields if provided
    if (startMonth) arrears.startMonth = startMonth;
    if (endMonth) arrears.endMonth = endMonth;
    if (monthlyAmount) arrears.monthlyAmount = monthlyAmount;
    if (totalAmount) arrears.totalAmount = totalAmount;
    if (reason) arrears.reason = reason;

    // Validate status transition
    const validTransitions = {
      'draft': ['pending_hod'],
      'pending_hod': ['pending_hr', 'draft'],
      'pending_hr': ['pending_admin', 'draft'],
      'pending_admin': ['approved', 'draft'],
      'approved': ['draft'],
      'rejected': ['draft']
    };

    if (!validTransitions[arrears.status] || !validTransitions[arrears.status].includes(nextStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot transition from ${arrears.status} to ${nextStatus}`
      });
    }

    // Track status change and update approval fields
    const previousStatus = arrears.status;
    const now = new Date();
    arrears.status = nextStatus;
    arrears.updatedBy = req.user._id || req.user.userId || req.user.id;

    // Update approval fields based on status transition
    if (nextStatus === 'pending_hr') {
      // When moving to pending_hr, set HOD approval
      arrears.hodApproval = {
        approved: true,
        approvedBy: user._id,
        approvedAt: now,
        comments: comments || 'Approved by HOD'
      };
    } else if (nextStatus === 'pending_admin') {
      // When moving to pending_admin, set HR approval
      arrears.hrApproval = {
        approved: true,
        approvedBy: user._id,
        approvedAt: now,
        comments: comments || 'Approved by HR'
      };
    } else if (nextStatus === 'approved') {
      // When approving, set Admin approval
      arrears.adminApproval = {
        approved: true,
        approvedBy: user._id,
        approvedAt: now,
        comments: comments || 'Approved by Admin',
        modifiedAmount: req.body.modifiedAmount || arrears.totalAmount
      };
    }

    // Add to status history
    if (!arrears.statusHistory) {
      arrears.statusHistory = [];
    }
    arrears.statusHistory.push({
      changedAt: now,
      changedBy: user._id,
      previousStatus: previousStatus,
      newStatus: nextStatus,
      reason: `Status changed from ${previousStatus} to ${nextStatus}`,
      comments: comments
    });

    await arrears.save();

    // Populate user details for response
    await arrears.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'updatedBy', select: 'name email' },
      { path: 'editHistory.editedBy', select: 'name email' },
      { path: 'statusHistory.changedBy', select: 'name email' },
      { path: 'employee', select: 'first_name last_name emp_no' }
    ]);

    res.status(200).json({
      success: true,
      message: `Arrears transitioned to ${nextStatus}`,
      data: arrears
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Process arrears action (approve/reject/forward at different levels)
// @route   PUT /api/arrears/:id/action
// @access  Private (HOD, HR, Admin)
exports.processArrearsAction = async (req, res) => {
  try {
    const { action, approved, modifiedAmount, comments } = req.body;
    const User = require('../../users/model/User');
    const user = await User.findById(req.user._id || req.user.userId || req.user.id);

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'User not found'
      });
    }

    const arrears = await ArrearsRequest.findById(req.params.id);

    if (!arrears) {
      return res.status(404).json({
        success: false,
        message: 'Arrears not found'
      });
    }

    // Determine which level the user is approving at
    let approvalLevel = null;
    if (arrears.status === 'pending_hod' && (user.role === 'hod' || user.roles?.includes('hod'))) {
      approvalLevel = 'hod';
    } else if (arrears.status === 'pending_hr' && (user.role === 'hr' || user.roles?.includes('hr'))) {
      approvalLevel = 'hr';
    } else if (arrears.status === 'pending_admin' && ['super_admin', 'sub_admin'].includes(user.role)) {
      approvalLevel = 'admin';
    } else {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to approve this arrears at current status'
      });
    }

    // Process based on approval level
    if (approvalLevel === 'hod') {
      const result = await ArrearsService.hodApprove(req.params.id, approved, comments || '', req.user.id);
      return res.status(200).json({
        success: true,
        message: `Arrears ${approved ? 'approved' : 'rejected'} by HOD`,
        data: result
      });
    } else if (approvalLevel === 'hr') {
      const result = await ArrearsService.hrApprove(req.params.id, approved, comments || '', req.user.id);
      return res.status(200).json({
        success: true,
        message: `Arrears ${approved ? 'approved' : 'rejected'} by HR`,
        data: result
      });
    } else if (approvalLevel === 'admin') {
      const result = await ArrearsService.adminApprove(req.params.id, approved, modifiedAmount, comments || '', req.user.id);
      return res.status(200).json({
        success: true,
        message: `Arrears ${approved ? 'approved' : 'rejected'} by Admin`,
        data: result
      });
    }
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Revoke arrears approval
// @route   PUT /api/arrears/:id/revoke
// @access  Private (HOD, HR, Admin)
exports.revokeArrearsApproval = async (req, res) => {
  try {
    const { reason } = req.body;
    const arrears = await ArrearsRequest.findById(req.params.id);

    if (!arrears) {
      return res.status(404).json({
        success: false,
        message: 'Arrears not found'
      });
    }

    // Can only revoke if approved or partially settled
    if (!['approved', 'partially_settled'].includes(arrears.status)) {
      return res.status(403).json({
        success: false,
        message: 'Can only revoke approved or partially settled arrears'
      });
    }

    // Check if within revocation time limit (e.g., 2-3 hours)
    const approvalTime = arrears.adminApproval?.approvedAt || arrears.hrApproval?.approvedAt || arrears.hodApproval?.approvedAt;
    if (approvalTime) {
      const hoursDiff = (new Date() - new Date(approvalTime)) / (1000 * 60 * 60);
      if (hoursDiff > 3) {
        return res.status(403).json({
          success: false,
          message: 'Revocation window has expired (3 hours limit)'
        });
      }
    }

    // Reset to draft status
    arrears.status = 'draft';
    arrears.hodApproval = { approved: null };
    arrears.hrApproval = { approved: null };
    arrears.adminApproval = { approved: null };
    arrears.updatedBy = req.user.id;
    await arrears.save();

    res.status(200).json({
      success: true,
      message: 'Arrears approval revoked successfully',
      data: arrears
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update arrears settlement status
// @route   PUT /api/arrears/:id/settlement
// @access  Private
exports.updateArrearsSettlement = async (req, res) => {
  try {
    const { amount, payrollId, month, year } = req.body;

    const arrears = await ArrearsRequest.findById(req.params.id);

    if (!arrears) {
      return res.status(404).json({
        success: false,
        message: 'Arrears not found'
      });
    }

    // Check if amount is valid
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required'
      });
    }

    // Check if there's enough remaining amount
    const remainingAmount = arrears.totalAmount - (arrears.settledAmount || 0);
    if (amount > remainingAmount) {
      return res.status(400).json({
        success: false,
        message: `Amount exceeds remaining amount of ${remainingAmount}`
      });
    }

    // Update settled amount
    arrears.settledAmount = (arrears.settledAmount || 0) + amount;

    // Check if fully settled
    if (arrears.settledAmount >= arrears.totalAmount) {
      arrears.isFullySettled = true;
      arrears.status = 'settled';
    } else {
      arrears.status = 'partially_settled';
    }

    // Add to settlement history
    if (!arrears.settlementHistory) {
      arrears.settlementHistory = [];
    }

    arrears.settlementHistory.push({
      settledAt: new Date(),
      settledBy: req.user._id || req.user.userId || req.user.id,
      amount: amount,
      payrollId: payrollId,
      month: month,
      year: year
    });

    await arrears.save();

    // Populate for response
    await arrears.populate([
      { path: 'employee', select: 'emp_no first_name last_name' },
      { path: 'createdBy', select: 'name email' },
      { path: 'settlementHistory.settledBy', select: 'name email' }
    ]);

    res.status(200).json({
      success: true,
      message: 'Arrears settlement updated successfully',
      data: arrears
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get approved but not fully settled arrears for payroll
// @route   GET /api/arrears/for-payroll
// @access  Private
exports.getArrearsForPayroll = async (req, res) => {
  try {
    const { employeeId, month, year } = req.query;

    console.log('\n=== GET ARREARS FOR PAYROLL ===');
    console.log('Query params:', { employeeId, month, year });

    // Build query for approved/partially_settled arrears that have remaining amount
    const query = {
      status: { $in: ['approved', 'partially_settled'] },
      remainingAmount: { $gt: 0 }
    };

    // Add employee filter if provided
    if (employeeId) {
      query.employee = employeeId;
    }

    console.log('MongoDB query:', JSON.stringify(query, null, 2));

    // Note: We don't filter by month/year for arrears
    // Arrears should be available for payroll regardless of when they were created
    // The arrears period (startMonth/endMonth) is informational only
    // All approved/partially_settled arrears with remaining amount should be shown

    const arrears = await ArrearsRequest.find(query)
      .populate('employee', 'emp_no employee_name first_name last_name department_id division_id')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    console.log(`Found ${arrears.length} arrears`);
    if (arrears.length > 0) {
      console.log('First arrear:', {
        id: arrears[0]._id,
        employee: arrears[0].employee,
        status: arrears[0].status,
        remainingAmount: arrears[0].remainingAmount,
        totalAmount: arrears[0].totalAmount
      });
    }

    res.status(200).json({
      success: true,
      count: arrears.length,
      data: arrears
    });
  } catch (error) {
    console.error('Error in getArrearsForPayroll:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get arrears statistics
// @route   GET /api/arrears/stats/summary
// @access  Private
exports.getArrearsStats = async (req, res) => {
  try {
    const { department, month } = req.query;

    const matchStage = {};
    if (department) {
      // This would require a lookup with Employee collection
      matchStage.department = department;
    }

    const stats = await ArrearsRequest.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
          remainingAmount: { $sum: '$remainingAmount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
