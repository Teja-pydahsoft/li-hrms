const mongoose = require('mongoose');

/**
 * Resignation request - workflow like Leave; on full approval sets employee.leftDate
 */
const ResignationRequestSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
    },
    emp_no: {
      type: String,
      required: true,
    },
    // Requested last working / left date
    leftDate: {
      type: Date,
      required: true,
    },
    // Resignation remarks (reason)
    remarks: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
    },
    // Who submitted (user _id)
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    workflow: {
      currentStepRole: String,
      nextApproverRole: String,
      isCompleted: { type: Boolean, default: false },
      approvalChain: [
        {
          stepOrder: Number,
          role: String,
          label: String,
          status: { type: String, enum: ['pending', 'approved', 'rejected', 'skipped'], default: 'pending' },
          actionBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          actionByName: String,
          actionByRole: String,
          comments: String,
          canEditLWD: { type: Boolean, default: false },
        },
      ],
      finalAuthority: String,
      reportingManagerIds: [String],
      history: [
        {
          step: String,
          action: { type: String, enum: ['submitted', 'approved', 'rejected', 'cancelled', 'lwd_changed'] },
          actionBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          actionByName: String,
          actionByRole: String,
          comments: String,
          timestamp: { type: Date, default: Date.now },
        },
      ],
    },
    // History of LWD changes
    lwdHistory: [
      {
        oldDate: Date,
        newDate: Date,
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        updatedByName: String,
        updatedByRole: String,
        comments: String,
        timestamp: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

ResignationRequestSchema.index({ employeeId: 1 });
ResignationRequestSchema.index({ status: 1 });
ResignationRequestSchema.index({ 'workflow.approvalChain': 1 });

module.exports =
  mongoose.models.ResignationRequest ||
  mongoose.model('ResignationRequest', ResignationRequestSchema);
