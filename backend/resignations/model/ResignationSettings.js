const mongoose = require('mongoose');

/**
 * Resignation policy settings (workflow, notice period) - similar to LeaveSettings
 */
const ResignationSettingsSchema = new mongoose.Schema(
  {
    // Notice period in days (default 0 = no minimum)
    noticePeriodDays: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Whether approval workflow is enabled
    workflow: {
      isEnabled: {
        type: Boolean,
        default: true,
      },
      steps: [
        {
          stepOrder: Number,
          stepName: String,
          approverRole: {
            type: String,
            enum: ['hod', 'hr', 'manager', 'super_admin', 'reporting_manager'],
          },
          canEditLWD: {
            type: Boolean,
            default: false,
          },
        },
      ],
      finalAuthority: {
        role: {
          type: String,
          enum: ['hr', 'super_admin', 'manager', 'reporting_manager'],
          default: 'hr',
        },
        anyHRCanApprove: {
          type: Boolean,
          default: true,
        },
      },
      allowHigherAuthorityToApproveLowerLevels: {
        type: Boolean,
        default: false,
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

ResignationSettingsSchema.index({ isActive: 1 });

ResignationSettingsSchema.statics.getActiveSettings = async function () {
  return this.findOne({ isActive: true });
};

module.exports =
  mongoose.models.ResignationSettings ||
  mongoose.model('ResignationSettings', ResignationSettingsSchema);
