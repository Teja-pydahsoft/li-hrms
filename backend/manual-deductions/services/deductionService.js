const mongoose = require('mongoose');
const DeductionRequest = require('../model/DeductionRequest');
const Employee = require('../../employees/model/Employee');

class DeductionService {
  static async createDeductionRequest(data, userId) {
    try {
      const type = (data.type || 'incremental').toLowerCase();
      if (!['incremental', 'direct'].includes(type)) {
        throw new Error('Invalid type. Use incremental or direct');
      }

      const employee = await Employee.findById(data.employee);
      if (!employee) {
        throw new Error('Employee not found');
      }

      if (type === 'direct') {
        const amount = Number(data.totalAmount ?? data.amount);
        const reason = (data.reason || '').trim();
        if (!reason) throw new Error('Remarks are required for direct deduction');
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Valid amount is required for direct deduction');

        const deduction = new DeductionRequest({
          type: 'direct',
          employee: data.employee,
          totalAmount: amount,
          remainingAmount: amount,
          reason,
          createdBy: userId,
          status: 'draft',
        });
        await deduction.save();
        return deduction.populate('employee createdBy');
      }

      if (!this.isValidMonthFormat(data.startMonth) || !this.isValidMonthFormat(data.endMonth)) {
        throw new Error('Invalid month format. Use YYYY-MM');
      }
      if (data.startMonth > data.endMonth) {
        throw new Error('Start month must be before or equal to end month');
      }

      let calculatedTotal = 0;
      if (data.calculationBreakdown && Array.isArray(data.calculationBreakdown) && data.calculationBreakdown.length > 0) {
        calculatedTotal = data.calculationBreakdown.reduce((sum, item) => sum + item.proratedAmount, 0);
      } else {
        const monthCount = this.getMonthDifference(data.startMonth, data.endMonth);
        calculatedTotal = data.monthlyAmount * monthCount;
      }
      if (Math.abs(data.totalAmount - calculatedTotal) > 0.05) {
        throw new Error(`Total amount mismatch. Calculated: ${calculatedTotal.toFixed(2)}, Provided: ${data.totalAmount}`);
      }

      const deduction = new DeductionRequest({
        ...data,
        type: 'incremental',
        createdBy: userId,
        remainingAmount: data.totalAmount,
        status: 'draft',
      });

      await deduction.save();
      return deduction.populate('employee createdBy');
    } catch (error) {
      throw new Error(`Failed to create deduction request: ${error.message}`);
    }
  }

  static async submitForHodApproval(deductionId, userId) {
    try {
      const deduction = await DeductionRequest.findById(deductionId);
      if (!deduction) throw new Error('Deduction request not found');
      if (deduction.status !== 'draft') throw new Error('Only draft deductions can be submitted for approval');
      deduction.status = 'pending_hod';
      deduction.updatedBy = userId;
      await deduction.save();
      return deduction.populate('employee createdBy updatedBy');
    } catch (error) {
      throw new Error(`Failed to submit for HOD approval: ${error.message}`);
    }
  }

  static async hodApprove(deductionId, approved, comments, userId) {
    try {
      const deduction = await DeductionRequest.findById(deductionId);
      if (!deduction) throw new Error('Deduction request not found');
      if (deduction.status !== 'pending_hod') throw new Error('Deduction is not pending HOD approval');
      deduction.hodApproval = { approved, approvedBy: userId, approvedAt: new Date(), comments };
      deduction.status = approved ? 'pending_hr' : 'rejected';
      deduction.updatedBy = userId;
      await deduction.save();
      return deduction.populate('employee createdBy updatedBy hodApproval.approvedBy');
    } catch (error) {
      throw new Error(`Failed to process HOD approval: ${error.message}`);
    }
  }

  static async hrApprove(deductionId, approved, comments, userId) {
    try {
      const deduction = await DeductionRequest.findById(deductionId);
      if (!deduction) throw new Error('Deduction request not found');
      if (deduction.status !== 'pending_hr') throw new Error('Deduction is not pending HR approval');
      deduction.hrApproval = { approved, approvedBy: userId, approvedAt: new Date(), comments };
      deduction.status = approved ? 'pending_admin' : 'rejected';
      deduction.updatedBy = userId;
      await deduction.save();
      return deduction.populate('employee createdBy updatedBy hrApproval.approvedBy');
    } catch (error) {
      throw new Error(`Failed to process HR approval: ${error.message}`);
    }
  }

  static async adminApprove(deductionId, approved, modifiedAmount, comments, userId) {
    try {
      const deduction = await DeductionRequest.findById(deductionId);
      if (!deduction) throw new Error('Deduction request not found');
      if (deduction.status !== 'pending_admin') throw new Error('Deduction is not pending admin approval');
      if (modifiedAmount !== undefined && modifiedAmount !== null) {
        if (modifiedAmount < 0) throw new Error('Modified amount cannot be negative');
        if (modifiedAmount > deduction.totalAmount) throw new Error('Modified amount cannot exceed total amount');
      }
      deduction.adminApproval = {
        approved,
        approvedBy: userId,
        approvedAt: new Date(),
        modifiedAmount: modifiedAmount || deduction.totalAmount,
        comments
      };
      if (approved) {
        deduction.status = 'approved';
        deduction.remainingAmount = modifiedAmount || deduction.totalAmount;
      } else {
        deduction.status = 'rejected';
      }
      deduction.updatedBy = userId;
      await deduction.save();
      return deduction.populate('employee createdBy updatedBy adminApproval.approvedBy');
    } catch (error) {
      throw new Error(`Failed to process admin approval: ${error.message}`);
    }
  }

  static async processSettlement(employeeId, month, deductionSettlements, userId, payrollId) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const settlementDate = new Date();
      const results = [];
      for (const settlement of deductionSettlements) {
        const dr = await DeductionRequest.findById(settlement.deductionId).session(session);
        if (!dr) continue;
        if (dr.employee.toString() !== employeeId) {
          throw new Error(`Deduction ${settlement.deductionId} does not belong to employee ${employeeId}`);
        }
        if (dr.status !== 'approved' && dr.status !== 'partially_settled') {
          throw new Error(`Deduction ${settlement.deductionId} is not approved for settlement`);
        }
        if (dr.remainingAmount <= 0) {
          throw new Error(`Deduction ${settlement.deductionId} has no remaining amount to settle`);
        }
        const settleAmount = Math.min(dr.remainingAmount, settlement.amount);
        if (settleAmount <= 0) throw new Error(`Invalid settlement amount for deduction ${settlement.deductionId}`);
        dr.remainingAmount -= settleAmount;
        dr.status = dr.remainingAmount > 0 ? 'partially_settled' : 'settled';
        dr.settlementHistory.push({
          month,
          amount: settleAmount,
          settledAt: settlementDate,
          settledBy: userId,
          payrollId
        });
        dr.updatedBy = userId;
        await dr.save({ session });
        results.push({ deductionId: dr._id, settledAmount: settleAmount, remainingAmount: dr.remainingAmount, status: dr.status });
      }
      await session.commitTransaction();
      return results;
    } catch (error) {
      await session.abortTransaction();
      throw new Error(`Failed to process settlement: ${error.message}`);
    } finally {
      session.endSession();
    }
  }

  static async getEmployeePendingDeductions(employeeId) {
    try {
      return await DeductionRequest.find({
        employee: employeeId,
        status: { $in: ['approved', 'partially_settled'] },
        remainingAmount: { $gt: 0 }
      })
        .sort({ createdAt: 1 })
        .populate('createdBy', 'name email');
    } catch (error) {
      throw new Error(`Failed to fetch pending deductions: ${error.message}`);
    }
  }

  static async getDeductionById(deductionId) {
    try {
      const deduction = await DeductionRequest.findById(deductionId)
        .populate('employee', 'emp_no name')
        .populate('createdBy updatedBy', 'name email')
        .populate('hodApproval.approvedBy hrApproval.approvedBy adminApproval.approvedBy', 'name email')
        .populate('settlementHistory.settledBy', 'name email')
        .populate('settlementHistory.payrollId', '_id month');
      if (!deduction) throw new Error('Deduction not found');
      return deduction;
    } catch (error) {
      throw new Error(`Failed to fetch deduction: ${error.message}`);
    }
  }

  static async getDeductions(filters = {}) {
    try {
      const query = {};
      if (filters.employee) query.employee = filters.employee;
      if (filters.status) {
        query.status = Array.isArray(filters.status) ? { $in: filters.status } : filters.status;
      }
      if (filters.department) {
        const employees = await Employee.find({ department_id: filters.department });
        query.employee = { $in: employees.map(e => e._id) };
      }
      return await DeductionRequest.find(query)
        .populate('employee', 'emp_no name')
        .populate('createdBy', 'name email')
        .sort({ createdAt: -1 });
    } catch (error) {
      throw new Error(`Failed to fetch deductions: ${error.message}`);
    }
  }

  static async cancelDeduction(deductionId, userId) {
    try {
      const deduction = await DeductionRequest.findById(deductionId);
      if (!deduction) throw new Error('Deduction request not found');
      if (!['draft', 'rejected'].includes(deduction.status)) {
        throw new Error('Only draft or rejected deductions can be cancelled');
      }
      deduction.status = 'cancelled';
      deduction.updatedBy = userId;
      await deduction.save();
      return deduction;
    } catch (error) {
      throw new Error(`Failed to cancel deduction: ${error.message}`);
    }
  }

  static isValidMonthFormat(month) {
    const regex = /^\d{4}-\d{2}$/;
    if (!regex.test(month)) return false;
    const [, monthNum] = month.split('-');
    const m = parseInt(monthNum, 10);
    return m >= 1 && m <= 12;
  }

  static getMonthDifference(startMonth, endMonth) {
    const [startYear, startM] = startMonth.split('-').map(Number);
    const [endYear, endM] = endMonth.split('-').map(Number);
    return Math.max(1, (endYear - startYear) * 12 + (endM - startM) + 1);
  }
}

module.exports = DeductionService;
