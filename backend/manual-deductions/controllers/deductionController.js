const DeductionRequest = require('../model/DeductionRequest');
const DeductionService = require('../services/deductionService');

const uid = (req) => req.user._id || req.user.userId || req.user.id;

/**
 * Bulk create direct deduction requests.
 * Body: { items: [{ employee: employeeId, amount: number, reason: string }, ...] }
 * Only items with amount > 0 are created. Returns created count and created records.
 */
exports.createDeductionsBulk = async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'items array is required and must not be empty' });
    }
    const userId = uid(req);
    const toCreate = items
      .map((item) => ({
        employee: item.employee,
        amount: Number(item.amount ?? item.totalAmount ?? 0),
        reason: (item.reason || item.remarks || 'Bulk deduction').trim(),
      }))
      .filter((item) => item.employee && item.amount > 0 && item.reason);
    if (toCreate.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid items (employee, amount > 0, and reason required)' });
    }
    const created = [];
    const errors = [];
    for (let i = 0; i < toCreate.length; i++) {
      try {
        const deduction = await DeductionService.createDeductionRequest(
          { type: 'direct', employee: toCreate[i].employee, totalAmount: toCreate[i].amount, reason: toCreate[i].reason },
          userId
        );
        created.push(deduction);
      } catch (err) {
        errors.push({ index: i, employee: toCreate[i].employee, message: err.message });
      }
    }
    return res.status(201).json({
      success: true,
      created: created.length,
      failed: errors.length,
      data: created,
      errors: errors.length ? errors : undefined,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Bulk approve: transition selected deduction IDs to fully approved (only pending_* statuses).
 * Body: { ids: string[] }
 */
exports.bulkApproveDeductions = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'ids array is required and must not be empty' });
    }
    const userId = uid(req);
    const approved = [];
    const errors = [];
    for (let i = 0; i < ids.length; i++) {
      try {
        const deduction = await DeductionService.transitionToApproved(ids[i], userId);
        approved.push(deduction);
      } catch (err) {
        errors.push({ id: ids[i], message: err.message });
      }
    }
    return res.status(200).json({
      success: true,
      approved: approved.length,
      failed: errors.length,
      data: approved,
      errors: errors.length ? errors : undefined,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.createDeduction = async (req, res) => {
  try {
    const { type, employee, startMonth, endMonth, monthlyAmount, totalAmount, amount, reason, calculationBreakdown } = req.body;
    if (!employee || !reason) {
      return res.status(400).json({ success: false, message: 'Employee and reason/remarks are required' });
    }
    const isDirect = (type || 'incremental').toLowerCase() === 'direct';
    if (isDirect) {
      const amt = totalAmount ?? amount;
      if (amt == null || amt === '' || isNaN(Number(amt)) || Number(amt) <= 0) {
        return res.status(400).json({ success: false, message: 'Valid amount is required for direct deduction' });
      }
    } else {
      if (!startMonth || !endMonth || monthlyAmount == null || monthlyAmount === '' || totalAmount == null || totalAmount === '') {
        return res.status(400).json({ success: false, message: 'For incremental deduction provide startMonth, endMonth, monthlyAmount, and totalAmount' });
      }
    }
    const payload = isDirect
      ? { type: 'direct', employee, totalAmount: Number(totalAmount ?? amount), reason }
      : { type: 'incremental', employee, startMonth, endMonth, monthlyAmount: Number(monthlyAmount), totalAmount: Number(totalAmount), reason, calculationBreakdown };
    const deduction = await DeductionService.createDeductionRequest(payload, uid(req));
    res.status(201).json({ success: true, data: deduction });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.getDeductions = async (req, res) => {
  try {
    const { employee, status, department } = req.query;
    const filters = {};
    if (employee) filters.employee = employee;
    if (status) filters.status = status.split(',');
    if (department) filters.department = department;
    const deductions = await DeductionService.getDeductions(filters);
    res.status(200).json({ success: true, count: deductions.length, data: deductions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getDeductionById = async (req, res) => {
  try {
    const deduction = await DeductionService.getDeductionById(req.params.id);
    res.status(200).json({ success: true, data: deduction });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

exports.getEmployeePendingDeductions = async (req, res) => {
  try {
    const deductions = await DeductionService.getEmployeePendingDeductions(req.params.employeeId);
    res.status(200).json({ success: true, count: deductions.length, data: deductions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.submitForHodApproval = async (req, res) => {
  try {
    const deduction = await DeductionService.submitForHodApproval(req.params.id, uid(req));
    res.status(200).json({ success: true, message: 'Deduction submitted for HOD approval', data: deduction });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.hodApprove = async (req, res) => {
  try {
    const { approved, comments } = req.body;
    if (approved === undefined) return res.status(400).json({ success: false, message: 'Please provide approval status' });
    const deduction = await DeductionService.hodApprove(req.params.id, approved, comments || '', uid(req));
    res.status(200).json({ success: true, message: `Deduction ${approved ? 'approved' : 'rejected'} by HOD`, data: deduction });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.hrApprove = async (req, res) => {
  try {
    const { approved, comments } = req.body;
    if (approved === undefined) return res.status(400).json({ success: false, message: 'Please provide approval status' });
    const deduction = await DeductionService.hrApprove(req.params.id, approved, comments || '', uid(req));
    res.status(200).json({ success: true, message: `Deduction ${approved ? 'approved' : 'rejected'} by HR`, data: deduction });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.adminApprove = async (req, res) => {
  try {
    const { approved, modifiedAmount, comments } = req.body;
    if (approved === undefined) return res.status(400).json({ success: false, message: 'Please provide approval status' });
    const deduction = await DeductionService.adminApprove(req.params.id, approved, modifiedAmount, comments || '', uid(req));
    res.status(200).json({ success: true, message: `Deduction ${approved ? 'approved' : 'rejected'} by Admin`, data: deduction });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.processSettlement = async (req, res) => {
  try {
    const { employeeId, month, settlements, payrollId } = req.body;
    if (!employeeId || !month || !settlements || !Array.isArray(settlements)) {
      return res.status(400).json({ success: false, message: 'Please provide employeeId, month, and settlements array' });
    }
    const deductionSettlements = settlements.map(s => ({ deductionId: s.deductionId || s.id, amount: s.amount }));
    const results = await DeductionService.processSettlement(employeeId, month, deductionSettlements, uid(req), payrollId);
    res.status(200).json({ success: true, message: 'Deductions settled successfully', data: results });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.cancelDeduction = async (req, res) => {
  try {
    const deduction = await DeductionService.cancelDeduction(req.params.id, uid(req));
    res.status(200).json({ success: true, message: 'Deduction cancelled successfully', data: deduction });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.getMyDeductions = async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    if (!employeeId) return res.status(400).json({ success: false, message: 'Employee record not found for user' });
    const deductions = await DeductionRequest.find({ employee: employeeId }).sort({ createdAt: -1 }).populate('employee', 'emp_no name');
    res.status(200).json({ success: true, count: deductions.length, data: deductions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPendingApprovals = async (req, res) => {
  try {
    const User = require('../../users/model/User');
    const user = await User.findById(uid(req));
    if (!user) return res.status(400).json({ success: false, message: 'User not found' });
    let query = {};
    if (user.role === 'hod' || user.roles?.includes('hod')) query.status = 'pending_hod';
    else if (user.role === 'hr' || user.roles?.includes('hr')) query.status = 'pending_hr';
    else if (['super_admin', 'sub_admin'].includes(user.role) || user.roles?.some(r => ['super_admin', 'sub_admin'].includes(r))) query.status = 'pending_admin';
    const deductions = await DeductionRequest.find(query).sort({ createdAt: -1 }).populate('employee', 'emp_no name').populate('createdBy', 'name email');
    res.status(200).json({ success: true, count: deductions.length, data: deductions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.editDeduction = async (req, res) => {
  try {
    const { startMonth, endMonth, monthlyAmount, totalAmount, reason } = req.body;
    const user = req.user;
    if (!['super_admin', 'sub_admin'].includes(user.role) && !user.roles?.some(r => ['super_admin', 'sub_admin'].includes(r))) {
      return res.status(403).json({ success: false, message: 'Only SuperAdmin can edit deductions' });
    }
    const deduction = await DeductionRequest.findById(req.params.id);
    if (!deduction) return res.status(404).json({ success: false, message: 'Deduction not found' });
    if (['settled', 'partially_settled', 'cancelled'].includes(deduction.status)) {
      return res.status(403).json({ success: false, message: 'Cannot edit settled or cancelled deductions' });
    }
    const originalAmount = deduction.totalAmount;
    const originalMonthlyAmount = deduction.monthlyAmount;
    if (startMonth) deduction.startMonth = startMonth;
    if (endMonth) deduction.endMonth = endMonth;
    if (monthlyAmount) deduction.monthlyAmount = monthlyAmount;
    if (totalAmount) deduction.totalAmount = totalAmount;
    if (reason) deduction.reason = reason;
    if (totalAmount && totalAmount !== originalAmount) {
      deduction.remainingAmount = totalAmount;
      if (!deduction.editHistory) deduction.editHistory = [];
      deduction.editHistory.push({
        editedAt: new Date(),
        editedBy: user._id,
        originalAmount,
        newAmount: totalAmount,
        originalMonthlyAmount,
        newMonthlyAmount: monthlyAmount || originalMonthlyAmount,
        reason: `Amount changed from ₹${originalAmount} to ₹${totalAmount}`,
        status: deduction.status
      });
    }
    deduction.updatedBy = uid(req);
    await deduction.save();
    await deduction.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'updatedBy', select: 'name email' },
      { path: 'editHistory.editedBy', select: 'name email' },
      { path: 'statusHistory.changedBy', select: 'name email' },
      { path: 'employee', select: 'first_name last_name emp_no' }
    ]);
    res.status(200).json({ success: true, message: 'Deduction updated successfully', data: deduction });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateDeduction = async (req, res) => {
  try {
    const { startMonth, endMonth, monthlyAmount, totalAmount, reason } = req.body;
    const deduction = await DeductionRequest.findById(req.params.id);
    if (!deduction) return res.status(404).json({ success: false, message: 'Deduction not found' });
    if (deduction.status !== 'draft') return res.status(403).json({ success: false, message: 'Only draft deductions can be updated' });
    if (startMonth) deduction.startMonth = startMonth;
    if (endMonth) deduction.endMonth = endMonth;
    if (monthlyAmount) deduction.monthlyAmount = monthlyAmount;
    if (totalAmount) deduction.totalAmount = totalAmount;
    if (reason) deduction.reason = reason;
    deduction.updatedBy = uid(req);
    await deduction.save();
    res.status(200).json({ success: true, message: 'Deduction updated successfully', data: deduction });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.transitionDeduction = async (req, res) => {
  try {
    const { nextStatus, startMonth, endMonth, monthlyAmount, totalAmount, reason, comments } = req.body;
    const user = req.user;
    if (!['super_admin', 'sub_admin'].includes(user.role) && !user.roles?.some(r => ['super_admin', 'sub_admin'].includes(r))) {
      return res.status(403).json({ success: false, message: 'Only SuperAdmin can transition deductions' });
    }
    const deduction = await DeductionRequest.findById(req.params.id);
    if (!deduction) return res.status(404).json({ success: false, message: 'Deduction not found' });
    if (startMonth) deduction.startMonth = startMonth;
    if (endMonth) deduction.endMonth = endMonth;
    if (monthlyAmount) deduction.monthlyAmount = monthlyAmount;
    if (totalAmount) deduction.totalAmount = totalAmount;
    if (reason) deduction.reason = reason;
    const validTransitions = {
      draft: ['pending_hod'],
      pending_hod: ['pending_hr', 'draft'],
      pending_hr: ['pending_admin', 'draft'],
      pending_admin: ['approved', 'draft'],
      approved: ['draft'],
      rejected: ['draft']
    };
    if (!validTransitions[deduction.status] || !validTransitions[deduction.status].includes(nextStatus)) {
      return res.status(400).json({ success: false, message: `Cannot transition from ${deduction.status} to ${nextStatus}` });
    }
    const previousStatus = deduction.status;
    const now = new Date();
    deduction.status = nextStatus;
    deduction.updatedBy = uid(req);
    if (nextStatus === 'pending_hr') {
      deduction.hodApproval = { approved: true, approvedBy: user._id, approvedAt: now, comments: comments || 'Approved by HOD' };
    } else if (nextStatus === 'pending_admin') {
      deduction.hrApproval = { approved: true, approvedBy: user._id, approvedAt: now, comments: comments || 'Approved by HR' };
    } else if (nextStatus === 'approved') {
      deduction.adminApproval = { approved: true, approvedBy: user._id, approvedAt: now, comments: comments || 'Approved by Admin', modifiedAmount: req.body.modifiedAmount || deduction.totalAmount };
    }
    if (!deduction.statusHistory) deduction.statusHistory = [];
    deduction.statusHistory.push({ changedAt: now, changedBy: user._id, previousStatus, newStatus: nextStatus, reason: `Status changed from ${previousStatus} to ${nextStatus}`, comments });
    await deduction.save();
    await deduction.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'updatedBy', select: 'name email' },
      { path: 'editHistory.editedBy', select: 'name email' },
      { path: 'statusHistory.changedBy', select: 'name email' },
      { path: 'employee', select: 'first_name last_name emp_no' }
    ]);
    res.status(200).json({ success: true, message: `Deduction transitioned to ${nextStatus}`, data: deduction });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.processDeductionAction = async (req, res) => {
  try {
    const { action, approved, modifiedAmount, comments } = req.body;
    const User = require('../../users/model/User');
    const user = await User.findById(uid(req));
    if (!user) return res.status(400).json({ success: false, message: 'User not found' });
    const deduction = await DeductionRequest.findById(req.params.id);
    if (!deduction) return res.status(404).json({ success: false, message: 'Deduction not found' });
    let approvalLevel = null;
    if (deduction.status === 'pending_hod' && (user.role === 'hod' || user.roles?.includes('hod'))) approvalLevel = 'hod';
    else if (deduction.status === 'pending_hr' && (user.role === 'hr' || user.roles?.includes('hr'))) approvalLevel = 'hr';
    else if (deduction.status === 'pending_admin' && ['super_admin', 'sub_admin'].includes(user.role)) approvalLevel = 'admin';
    else return res.status(403).json({ success: false, message: 'You do not have permission to approve this deduction at current status' });
    if (approvalLevel === 'hod') {
      const result = await DeductionService.hodApprove(req.params.id, approved, comments || '', req.user.id);
      return res.status(200).json({ success: true, message: `Deduction ${approved ? 'approved' : 'rejected'} by HOD`, data: result });
    }
    if (approvalLevel === 'hr') {
      const result = await DeductionService.hrApprove(req.params.id, approved, comments || '', req.user.id);
      return res.status(200).json({ success: true, message: `Deduction ${approved ? 'approved' : 'rejected'} by HR`, data: result });
    }
    if (approvalLevel === 'admin') {
      const result = await DeductionService.adminApprove(req.params.id, approved, modifiedAmount, comments || '', req.user.id);
      return res.status(200).json({ success: true, message: `Deduction ${approved ? 'approved' : 'rejected'} by Admin`, data: result });
    }
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.revokeDeductionApproval = async (req, res) => {
  try {
    const deduction = await DeductionRequest.findById(req.params.id);
    if (!deduction) return res.status(404).json({ success: false, message: 'Deduction not found' });
    if (!['approved', 'partially_settled'].includes(deduction.status)) {
      return res.status(403).json({ success: false, message: 'Can only revoke approved or partially settled deductions' });
    }
    const approvalTime = deduction.adminApproval?.approvedAt || deduction.hrApproval?.approvedAt || deduction.hodApproval?.approvedAt;
    if (approvalTime && (new Date() - new Date(approvalTime)) / (1000 * 60 * 60) > 3) {
      return res.status(403).json({ success: false, message: 'Revocation window has expired (3 hours limit)' });
    }
    deduction.status = 'draft';
    deduction.hodApproval = { approved: null };
    deduction.hrApproval = { approved: null };
    deduction.adminApproval = { approved: null };
    deduction.updatedBy = req.user.id;
    await deduction.save();
    res.status(200).json({ success: true, message: 'Deduction approval revoked successfully', data: deduction });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateDeductionSettlement = async (req, res) => {
  try {
    const { amount, payrollId, month, year } = req.body;
    const deduction = await DeductionRequest.findById(req.params.id);
    if (!deduction) return res.status(404).json({ success: false, message: 'Deduction not found' });
    if (!amount || isNaN(amount) || amount <= 0) return res.status(400).json({ success: false, message: 'Valid amount is required' });
    const remainingAmount = deduction.totalAmount - (deduction.settlementHistory || []).reduce((s, x) => s + x.amount, 0);
    if (amount > remainingAmount) return res.status(400).json({ success: false, message: `Amount exceeds remaining amount of ${remainingAmount}` });
    if (!deduction.settlementHistory) deduction.settlementHistory = [];
    deduction.settlementHistory.push({ settledAt: new Date(), settledBy: uid(req), amount, payrollId, month, year });
    const settledTotal = deduction.settlementHistory.reduce((s, x) => s + x.amount, 0);
    deduction.remainingAmount = Math.max(0, deduction.totalAmount - settledTotal);
    deduction.status = deduction.remainingAmount <= 0 ? 'settled' : 'partially_settled';
    await deduction.save();
    await deduction.populate([{ path: 'employee', select: 'emp_no first_name last_name' }, { path: 'createdBy', select: 'name email' }, { path: 'settlementHistory.settledBy', select: 'name email' }]);
    res.status(200).json({ success: true, message: 'Deduction settlement updated successfully', data: deduction });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.getDeductionsForPayroll = async (req, res) => {
  try {
    const { employeeId } = req.query;
    const query = { status: { $in: ['approved', 'partially_settled'] }, remainingAmount: { $gt: 0 } };
    if (employeeId) query.employee = employeeId;
    const deductions = await DeductionRequest.find(query)
      .populate('employee', 'emp_no employee_name first_name last_name department_id')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: deductions.length, data: deductions });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.getDeductionStats = async (req, res) => {
  try {
    const { department } = req.query;
    const matchStage = {};
    if (department) matchStage.department = department;
    const stats = await DeductionRequest.aggregate([
      { $match: matchStage },
      { $group: { _id: '$status', count: { $sum: 1 }, totalAmount: { $sum: '$totalAmount' }, remainingAmount: { $sum: '$remainingAmount' } } },
      { $sort: { _id: 1 } }
    ]);
    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
