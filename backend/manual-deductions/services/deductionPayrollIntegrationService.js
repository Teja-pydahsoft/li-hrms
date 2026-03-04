const DeductionRequest = require('../model/DeductionRequest');

/**
 * Service to integrate manual deductions with payroll calculations.
 * Deductions reduce net pay (same flow as arrears but applied as deduction).
 */
class DeductionPayrollIntegrationService {
  static async getPendingDeductionsForPayroll(employeeId) {
    try {
      const deductions = await DeductionRequest.find({
        employee: employeeId,
        status: { $in: ['approved', 'partially_settled'] },
        remainingAmount: { $gt: 0 }
      })
        .sort({ createdAt: 1 })
        .lean();

      return deductions.map(dr => ({
        id: dr._id,
        type: dr.type || 'incremental',
        startMonth: dr.startMonth,
        endMonth: dr.endMonth,
        totalAmount: dr.totalAmount,
        remainingAmount: dr.remainingAmount,
        settledAmount: (dr.settlementHistory || []).reduce((sum, s) => sum + s.amount, 0),
        settlementHistory: dr.settlementHistory || [],
        reason: dr.reason
      }));
    } catch (error) {
      throw new Error(`Failed to fetch pending deductions: ${error.message}`);
    }
  }

  static async validateSettlements(employeeId, settlements) {
    const errors = [];
    if (!settlements || !Array.isArray(settlements) || settlements.length === 0) {
      return { valid: true, errors: [] };
    }
    try {
      for (const settlement of settlements) {
        if (!settlement.deductionId || settlement.amount === undefined) {
          errors.push('Invalid settlement format: missing deductionId or amount');
          continue;
        }
        const deduction = await DeductionRequest.findById(settlement.deductionId);
        if (!deduction) {
          errors.push(`Deduction ${settlement.deductionId} not found`);
          continue;
        }
        if (deduction.employee.toString() !== employeeId) {
          errors.push(`Deduction ${settlement.deductionId} does not belong to employee`);
          continue;
        }
        if (!['approved', 'partially_settled'].includes(deduction.status)) {
          errors.push(`Deduction ${settlement.deductionId} is not approved for settlement`);
          continue;
        }
        if (settlement.amount <= 0) {
          errors.push(`Settlement amount for deduction ${settlement.deductionId} must be positive`);
          continue;
        }
        if (settlement.amount > deduction.remainingAmount) {
          errors.push(
            `Settlement amount (${settlement.amount}) exceeds remaining amount (${deduction.remainingAmount}) for deduction ${settlement.deductionId}`
          );
        }
      }
      return { valid: errors.length === 0, errors };
    } catch (error) {
      return { valid: false, errors: [`Validation error: ${error.message}`] };
    }
  }

  static calculateTotalDeductionAmount(settlements) {
    if (!settlements || !Array.isArray(settlements)) return 0;
    return settlements.reduce((sum, s) => sum + (s.amount || 0), 0);
  }
}

module.exports = DeductionPayrollIntegrationService;
