const mongoose = require('mongoose');

/**
 * Payroll Payslip Snapshot
 * Frozen paysheet output (headers + values) for a specific employee and month,
 * generated using Payroll Configuration at calculation time.
 *
 * This prevents historical paysheets from changing when Payroll Configuration changes later.
 */
const payrollPayslipSnapshotSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      index: true,
    },
    emp_no: { type: String, default: '', index: true },
    month: { type: String, required: true, index: true }, // YYYY-MM
    kind: { type: String, enum: ['regular', 'second_salary'], required: true, index: true },

    payrollRecordId: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollRecord', default: null, index: true },
    secondSalaryRecordId: { type: mongoose.Schema.Types.ObjectId, ref: 'SecondSalaryRecord', default: null, index: true },

    // Config snapshot used to generate the output (store only what we need for audit)
    configSnapshot: {
      configId: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollConfiguration', default: null },
      configUpdatedAt: { type: Date, default: null },
      statutoryProratePaidDaysColumnHeader: { type: String, default: '' },
      statutoryProrateTotalDaysColumnHeader: { type: String, default: '' },
      professionTaxSlabEarningsColumnHeader: { type: String, default: '' },
      outputColumns: { type: [mongoose.Schema.Types.Mixed], default: [] }, // normalized output columns
      expandedColumns: { type: [mongoose.Schema.Types.Mixed], default: [] }, // with breakdown columns inserted
    },

    headers: { type: [String], default: [] }, // ordered header list
    row: { type: mongoose.Schema.Types.Mixed, default: {} }, // { [header]: value }

    generatedAt: { type: Date, default: Date.now, index: true },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    source: { type: String, default: 'dynamic_engine' },
  },
  { timestamps: true }
);

payrollPayslipSnapshotSchema.index({ employeeId: 1, month: 1, kind: 1 }, { unique: true });

payrollPayslipSnapshotSchema.statics.upsertSnapshot = async function upsertSnapshot(filter, payload) {
  const doc = await this.findOneAndUpdate(
    filter,
    { $set: payload },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return doc;
};

module.exports =
  mongoose.models.PayrollPayslipSnapshot || mongoose.model('PayrollPayslipSnapshot', payrollPayslipSnapshotSchema);

