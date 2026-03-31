const mongoose = require('mongoose');

/**
 * Leave Settings Model
 * Configures leave types, workflow, and approval chain
 */
const LeaveSettingsSchema = new mongoose.Schema(
  {
    // Settings type - leave, od, or ccl
    type: {
      type: String,
      enum: ['leave', 'od', 'ccl'],
      required: true,
    },

    // Leave/OD Types configuration
    types: [
      {
        code: {
          type: String,
          required: true,
          uppercase: true,
        },
        name: {
          type: String,
          required: true,
        },
        description: String,
        // Maximum days per year (null = unlimited)
        maxDaysPerYear: {
          type: Number,
          default: null,
        },
        // Can be carried forward
        carryForward: {
          type: Boolean,
          default: false,
        },
        // Maximum carry forward days
        maxCarryForward: {
          type: Number,
          default: 0,
        },
        // Requires attachment (e.g., medical certificate for sick leave)
        requiresAttachment: {
          type: Boolean,
          default: false,
        },
        // Minimum notice days before leave
        minNoticeDays: {
          type: Number,
          default: 0,
        },
        // Is paid leave
        isPaid: {
          type: Boolean,
          default: true,
        },
        // Leave nature: 'paid' = paid leave, 'lop' = loss of pay, 'without_pay' = without pay
        leaveNature: {
          type: String,
          enum: ['paid', 'lop', 'without_pay'],
          default: 'paid',
        },
        // Is active
        isActive: {
          type: Boolean,
          default: true,
        },
        // Color for UI
        color: {
          type: String,
          default: '#3b82f6',
        },
        // Sort order
        sortOrder: {
          type: Number,
          default: 0,
        },
      },
    ],

    // Status configuration
    statuses: [
      {
        code: {
          type: String,
          required: true,
          lowercase: true,
        },
        name: {
          type: String,
          required: true,
        },
        description: String,
        // Color for UI
        color: {
          type: String,
          default: '#6b7280',
        },
        // Is this a final status (approved/rejected/cancelled)
        isFinal: {
          type: Boolean,
          default: false,
        },
        // Is this a positive final status
        isApproved: {
          type: Boolean,
          default: false,
        },
        // Can employee edit when in this status
        canEmployeeEdit: {
          type: Boolean,
          default: false,
        },
        // Can employee cancel when in this status
        canEmployeeCancel: {
          type: Boolean,
          default: false,
        },
        // Sort order
        sortOrder: {
          type: Number,
          default: 0,
        },
      },
    ],

    // General settings
    settings: {
      // Allow backdated leave applications
      allowBackdated: {
        type: Boolean,
        default: false,
      },
      // Maximum days for backdated
      maxBackdatedDays: {
        type: Number,
        default: 7,
      },
      // Allow future dated leave
      allowFutureDated: {
        type: Boolean,
        default: true,
      },
      // Maximum days in advance
      maxAdvanceDays: {
        type: Number,
        default: 90,
      },
      // Minimum gap between consecutive leaves
      minGapBetweenLeaves: {
        type: Number,
        default: 0,
      },
      // Weekend counted as leave days
      countWeekends: {
        type: Boolean,
        default: false,
      },
      // Holidays counted as leave days
      countHolidays: {
        type: Boolean,
        default: false,
      },
      // Auto cancel if not approved within days
      autoCancelDays: {
        type: Number,
        default: null,
      },
      // Send email notifications
      sendEmailNotifications: {
        type: Boolean,
        default: true,
      },
      // Notify employee on status change
      notifyOnStatusChange: {
        type: Boolean,
        default: true,
      },
      // Notify approver when new application comes
      notifyApproverOnNew: {
        type: Boolean,
        default: true,
      },
      // Workspace-level permissions for leave/OD applications
      // Format: { workspaceId: { canApplyForSelf: boolean, canApplyForOthers: boolean } }
      workspacePermissions: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
    },

    // Workflow configuration
    workflow: {
      isEnabled: {
        type: Boolean,
        default: true
      },
      steps: [
        {
          stepOrder: Number,
          stepName: String,
          approverRole: {
            type: String,
            enum: ['hod', 'hr', 'manager', 'super_admin', 'reporting_manager']
          }
        }
      ],
      finalAuthority: {
        role: {
          type: String,
          enum: ['hr', 'super_admin', 'manager', 'reporting_manager'],
          default: 'hr'
        },
        anyHRCanApprove: {
          type: Boolean,
          default: true
        }
      },
      // When true, approvers with a role later in the chain can act on requests still at an earlier step
      allowHigherAuthorityToApproveLowerLevels: {
        type: Boolean,
        default: false
      }
    },

    // Is this settings configuration active
    isActive: {
      type: Boolean,
      default: true,
    },

    // Created by
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    // Last updated by
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// Pre-save hook to ensure leaveNature is synced with isPaid for leave types
LeaveSettingsSchema.pre('save', async function () {
  if (this.type === 'leave' && this.types && Array.isArray(this.types)) {
    this.types.forEach(type => {
      // Sync leaveNature based on isPaid status
      // If isPaid is true (default), nature is 'paid'
      // If isPaid is false, nature is 'lop'
      type.leaveNature = type.isPaid === false ? 'lop' : 'paid';
    });
  }
});

// Ensure only one active settings per type
LeaveSettingsSchema.index({ type: 1, isActive: 1 });

// Static method to get active settings for a type
LeaveSettingsSchema.statics.getActiveSettings = async function (type) {
  return this.findOne({ type, isActive: true });
};

module.exports = mongoose.models.LeaveSettings || mongoose.model('LeaveSettings', LeaveSettingsSchema);

