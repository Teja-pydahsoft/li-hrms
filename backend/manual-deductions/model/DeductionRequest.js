const mongoose = require('mongoose');

const settlementHistorySchema = new mongoose.Schema({
  month: { type: String, required: true },
  amount: { type: Number, required: true },
  settledAt: { type: Date, default: Date.now },
  settledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  payrollId: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollRecord' }
}, { _id: false });

const editHistorySchema = new mongoose.Schema({
  editedAt: { type: Date, default: Date.now },
  editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  originalStartMonth: String,
  newStartMonth: String,
  originalEndMonth: String,
  newEndMonth: String,
  originalAmount: Number,
  newAmount: Number,
  originalMonthlyAmount: Number,
  newMonthlyAmount: Number,
  originalReason: String,
  newReason: String,
  reason: String,
  status: String
}, { _id: false });

const statusHistorySchema = new mongoose.Schema({
  changedAt: { type: Date, default: Date.now },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  previousStatus: String,
  newStatus: String,
  reason: String,
  comments: String
}, { _id: false });

const calculationBreakdownSchema = new mongoose.Schema({
  month: { type: String, required: true },
  monthlyAmount: { type: Number, required: true },
  totalDays: { type: Number, required: true },
  paidDays: { type: Number, required: true },
  proratedAmount: { type: Number, required: true }
}, { _id: false });

const deductionRequestSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['incremental', 'direct'],
      default: 'incremental',
      index: true
    },
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'Employee is required'],
      index: true
    },
    startMonth: { type: String, default: null },
    endMonth: { type: String, default: null },
    monthlyAmount: { type: Number, default: null, min: [0, 'Monthly amount must be positive'] },
    totalAmount: {
      type: Number,
      required: [true, 'Total amount is required'],
      min: [0, 'Total amount must be positive']
    },
    remainingAmount: {
      type: Number,
      required: [true, 'Remaining amount is required'],
      min: [0, 'Remaining amount must be positive']
    },
    reason: { type: String, required: [true, 'Reason/remarks is required'], trim: true },
    status: {
      type: String,
      enum: ['draft', 'pending_hod', 'pending_hr', 'pending_admin', 'approved', 'rejected', 'partially_settled', 'settled', 'cancelled'],
      default: 'draft',
      index: true
    },
    calculationBreakdown: [calculationBreakdownSchema],
    hodApproval: {
      approved: { type: Boolean, default: null },
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      approvedAt: Date,
      comments: String
    },
    hrApproval: {
      approved: { type: Boolean, default: null },
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      approvedAt: Date,
      comments: String
    },
    adminApproval: {
      approved: { type: Boolean, default: null },
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      approvedAt: Date,
      modifiedAmount: Number,
      comments: String
    },
    settlementHistory: [settlementHistorySchema],
    editHistory: [editHistorySchema],
    statusHistory: [statusHistorySchema],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

deductionRequestSchema.virtual('settledAmount').get(function () {
  return (this.settlementHistory || []).reduce((sum, s) => sum + s.amount, 0);
});

deductionRequestSchema.virtual('displayStatus').get(function () {
  if (this.status === 'approved' && this.remainingAmount > 0 && this.remainingAmount < this.totalAmount) {
    return 'partially_settled';
  }
  return this.status;
});

deductionRequestSchema.index({ employee: 1, status: 1 });
deductionRequestSchema.index({ status: 1 });
deductionRequestSchema.index({ 'settlementHistory.payrollId': 1 });
deductionRequestSchema.index({ createdAt: -1 });

deductionRequestSchema.pre('save', async function () {
  if (this.isNew) {
    this.remainingAmount = this.totalAmount;
  }
});

module.exports = mongoose.models.DeductionRequest || mongoose.model('DeductionRequest', deductionRequestSchema);
