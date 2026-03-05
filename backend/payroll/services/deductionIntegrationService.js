const DeductionPayrollIntegrationService = require('../../manual-deductions/services/deductionPayrollIntegrationService');

/**
 * Service to handle manual deductions integration with payroll.
 * Deductions reduce net pay (applied after other earnings/deductions).
 */
class DeductionIntegrationService {
  /**
   * Add manual deductions to payroll (as deduction from net).
   * @param {Object} payrollRecord - Payroll record
   * @param {Array} deductionSettlements - Array of { deductionId, amount }
   * @param {String} employeeId - Employee ID
   * @returns {Object} Updated payroll record
   */
  static async addDeductionsToPayroll(payrollRecord, deductionSettlements, employeeId) {
    try {
      if (!deductionSettlements || deductionSettlements.length === 0) {
        return payrollRecord;
      }

      const normalized = deductionSettlements.map(s => ({
        deductionId: s.deductionId || s.id,
        amount: s.amount
      }));

      const validation = await DeductionPayrollIntegrationService.validateSettlements(
        employeeId,
        normalized
      );

      if (!validation.valid) {
        throw new Error(`Invalid deduction settlements: ${validation.errors.join(', ')}`);
      }

      const totalDeductionAmount = DeductionPayrollIntegrationService.calculateTotalDeductionAmount(normalized);
      if (totalDeductionAmount <= 0) return payrollRecord;

      payrollRecord.manualDeductionsAmount = totalDeductionAmount;
      payrollRecord.deductionSettlements = normalized;

      if (!payrollRecord.deductions) payrollRecord.deductions = {};
      if (!payrollRecord.deductions.otherDeductions) payrollRecord.deductions.otherDeductions = [];
      payrollRecord.deductions.otherDeductions.push({
        name: 'Manual Deduction',
        amount: totalDeductionAmount,
        type: 'fixed',
        base: 'fixed'
      });
      payrollRecord.deductions.totalOtherDeductions = (payrollRecord.deductions.totalOtherDeductions || 0) + totalDeductionAmount;
      payrollRecord.deductions.totalDeductions = (payrollRecord.deductions.totalDeductions || 0) + totalDeductionAmount;

      const currentNet = Number(payrollRecord.netSalary) || 0;
      const newNet = Math.max(0, currentNet - totalDeductionAmount);
      if (typeof payrollRecord.set === 'function') {
        payrollRecord.set('netSalary', newNet);
      } else {
        payrollRecord.netSalary = newNet;
      }

      return payrollRecord;
    } catch (error) {
      console.error('Error adding manual deductions to payroll:', error);
      throw error;
    }
  }

  /**
   * Process deduction settlements after payroll is saved.
   * @param {String} employeeId - Employee ID
   * @param {String} month - YYYY-MM
   * @param {Array} deductionSettlements - Array of { deductionId, amount }
   * @param {String} userId - User ID
   * @param {String} payrollId - Payroll record ID
   * @returns {Array} Settlement results
   */
  static async processDeductionSettlements(employeeId, month, deductionSettlements, userId, payrollId) {
    try {
      if (!deductionSettlements || deductionSettlements.length === 0) {
        return [];
      }
      const normalized = deductionSettlements.map(s => ({
        deductionId: s.deductionId || s.id,
        amount: s.amount
      }));
      const DeductionService = require('../../manual-deductions/services/deductionService');
      return await DeductionService.processSettlement(employeeId, month, normalized, userId, payrollId);
    } catch (error) {
      console.error('Error processing deduction settlements:', error);
      throw error;
    }
  }
}

module.exports = DeductionIntegrationService;
