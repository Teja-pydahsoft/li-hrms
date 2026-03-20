const mongoose = require('mongoose');

/**
 * OD (On Duty) Model
 * Handles On Duty applications with dynamic workflow
 * Similar structure to Leave but with OD-specific fields
 */
const ODSchema = new mongoose.Schema(
  {
    // Employee who is on duty
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'Employee is required'],
    },

    // Employee number for quick reference
    emp_no: {
      type: String,
      required: true,
    },

    // OD type (dynamic - values come from LeaveSettings)
    odType: {
      type: String,
      required: [true, 'OD type is required'],
      trim: true,
    },

    // Start date
    fromDate: {
      type: Date,
      required: [true, 'Start date is required'],
    },

    // End date
    toDate: {
      type: Date,
      required: [true, 'End date is required'],
    },

    // Number of days
    numberOfDays: {
      type: Number,
      required: true,
      validate: {
        validator: function (v) {
          // Allow smaller fractions for hour-based OD; for full/half day enforce minimum 0.5
          if (this.odType_extended === 'hours') {
            return v >= 0; // allow 0 and above for hour-based OD
          }
          return v >= 0.5;
        },
        message: 'Minimum OD is half day',
      },
    },

    // Half day options
    isHalfDay: {
      type: Boolean,
      default: false,
    },

    halfDayType: {
      type: String,
      enum: ['first_half', 'second_half', null],
      default: null,
    },

    // NEW: Compensatory Off (CO) Eligibility Flag
    // True if this OD was applied on a holiday/week-off
    isCOEligible: {
      type: Boolean,
      default: false,
    },

    // NEW: Hour-based OD fields
    odType_extended: {
      type: String,
      enum: ['full_day', 'half_day', 'hours', null],
      default: null,
      description: 'Type of OD: full_day, half_day, or specific hours'
    },

    // Start time for hour-based OD (HH:MM format, e.g., "10:00")
    odStartTime: {
      type: String,
      default: null,
      trim: true,
    },

    // End time for hour-based OD (HH:MM format, e.g., "14:30")
    odEndTime: {
      type: String,
      default: null,
      trim: true,
    },

    // Duration in hours (calculated from start and end time)
    durationHours: {
      type: Number,
      default: null,
      min: 0,
    },

    // Purpose of OD
    purpose: {
      type: String,
      required: [true, 'Purpose is required'],
      trim: true,
      maxlength: [500, 'Purpose cannot exceed 500 characters'],
    },

    // Place(s) visited
    placeVisited: {
      type: String,
      required: [true, 'Place visited is required'],
      trim: true,
    },

    // Multiple places (optional - for detailed tracking)
    placesVisited: [
      {
        name: String,
        address: String,
        visitDate: Date,
        purpose: String,
      },
    ],

    // Contact number during OD
    contactNumber: {
      type: String,
      required: [true, 'Contact number is required'],
      trim: true,
    },

    // Who assigned the OD (if assigned by someone else)
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    assignedByName: {
      type: String,
      trim: true,
    },

    // Is this self-applied or assigned by manager
    isAssigned: {
      type: Boolean,
      default: false,
    },

    // Current status
    status: {
      type: String,
      enum: ['draft', 'pending', 'reporting_manager_approved', 'reporting_manager_rejected', 'hod_approved', 'hod_rejected', 'manager_approved', 'manager_rejected', 'hr_approved', 'hr_rejected', 'approved', 'rejected', 'cancelled'],
      default: 'draft',
    },

    // Workflow tracking
    workflow: {
      // Current step role in workflow
      currentStepRole: {
        type: String,
        default: null,
      },

      // Next approver role
      nextApproverRole: {
        type: String,
        default: null,
      },

      // LEGACY FIELDS (Kept for backward compatibility)
      currentStep: {
        type: String,
        default: 'employee'
      },
      nextApprover: {
        type: String,
        default: null
      },

      // IDs of assigned reporting managers for visibility bridging
      reportingManagerIds: [String],

      // Is the entire workflow completed?
      isCompleted: {
        type: Boolean,
        default: false,
      },

      // Dynamic Approval Chain
      approvalChain: [
        {
          stepOrder: Number,
          role: String,
          label: String,
          status: {
            type: String,
            enum: ['pending', 'approved', 'rejected', 'skipped'],
            default: 'pending'
          },
          isCurrent: {
            type: Boolean,
            default: false
          },
          actionBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
          },
          actionByName: String,
          actionByRole: String,
          comments: String,
          updatedAt: Date
        }
      ],

      // Workflow history
      history: [
        {
          step: String,
          action: {
            type: String,
            enum: ['submitted', 'approved', 'rejected', 'returned', 'cancelled', 'assigned', 'revoked', 'status_changed'],
          },
          actionBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
          },
          actionByName: String,
          actionByRole: String,
          comments: String,
          timestamp: {
            type: Date,
            default: Date.now,
          },
        },
      ],
    },

    // Approvals record
    approvals: {
      hod: {
        status: {
          type: String,
          enum: ['pending', 'approved', 'rejected', null],
          default: null,
        },
        approvedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        approvedAt: Date,
        comments: String,
      },
      hr: {
        status: {
          type: String,
          enum: ['pending', 'approved', 'rejected', null],
          default: null,
        },
        approvedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        approvedAt: Date,
        comments: String,
      },
      final: {
        status: {
          type: String,
          enum: ['pending', 'approved', 'rejected', null],
          default: null,
        },
        approvedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        approvedAt: Date,
        comments: String,
      },
    },

    // Division at the time of application
    division_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Division',
    },
    division_name: {
      type: String,
      trim: true,
    },

    // Department at the time of application
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
    },
    department_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
    },
    department_name: {
      type: String,
      trim: true,
    },

    // Designation at the time of application
    designation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Designation',
    },

    // Expected deliverables/outcomes (optional)
    expectedOutcome: {
      type: String,
      trim: true,
    },

    // Actual outcome (filled after OD completion)
    actualOutcome: {
      type: String,
      trim: true,
    },

    // Travel details (optional)
    travelDetails: {
      modeOfTravel: {
        type: String,
        enum: ['own_vehicle', 'company_vehicle', 'public_transport', 'flight', 'train', 'other', null],
      },
      vehicleNumber: String,
      estimatedExpense: Number,
      actualExpense: Number,
    },

    // Attachments (supporting documents)
    attachments: [
      {
        name: String,
        url: String,
        type: String,
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // Applied by (the user who submitted)
    appliedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Applied at timestamp
    appliedAt: {
      type: Date,
    },

    // Cancellation details
    cancellation: {
      cancelledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      cancelledAt: Date,
      reason: String,
    },

    // Is this OD active (not deleted)
    isActive: {
      type: Boolean,
      default: true,
    },

    // Notes/remarks
    remarks: {
      type: String,
      trim: true,
    },

    // Change tracking history (max 2-3 changes)
    changeHistory: [
      {
        field: {
          type: String,
          required: true,
        },
        originalValue: {
          type: mongoose.Schema.Types.Mixed,
        },
        newValue: {
          type: mongoose.Schema.Types.Mixed,
        },
        modifiedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        modifiedByName: String,
        modifiedByRole: String,
        modifiedAt: {
          type: Date,
          default: Date.now,
        },
        reason: String, // Optional reason for change
      },
    ],

    // Geo Location Data
    geoLocation: {
      latitude: { type: Number },
      longitude: { type: Number },
      address: { type: String },
      capturedAt: { type: Date }
    },

    // Photo Evidence
    photoEvidence: {
      url: { type: String },
      key: { type: String },
      exifLocation: {
        latitude: { type: Number },
        longitude: { type: Number }
      }
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for faster queries
ODSchema.index({ employeeId: 1, status: 1 });
ODSchema.index({ emp_no: 1 });
ODSchema.index({ department: 1, status: 1 });
ODSchema.index({ fromDate: 1, toDate: 1 });
ODSchema.index({ status: 1, 'workflow.nextApprover': 1 });
ODSchema.index({ appliedAt: -1 });
ODSchema.index({ assignedBy: 1 });

// Calculate number of days before save
ODSchema.pre('save', function () {
  if (this.isModified('fromDate') || this.isModified('toDate')) {
    if (this.fromDate && this.toDate) {
      const diffTime = Math.abs(this.toDate - this.fromDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

      if (this.isHalfDay) {
        this.numberOfDays = 0.5;
      } else {
        this.numberOfDays = diffDays;
      }
    }
  }
  // No need to call next() - Mongoose handles this automatically for synchronous middleware
});

// Virtual for display name
ODSchema.virtual('statusDisplay').get(function () {
  const statusMap = {
    draft: 'Draft',
    pending: 'Pending',
    hod_approved: 'HOD Approved',
    hod_rejected: 'HOD Rejected',
    hr_approved: 'HR Approved',
    hr_rejected: 'HR Rejected',
    approved: 'Approved',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
  };
  return statusMap[this.status] || this.status;
});

// Method to check if OD can be edited
ODSchema.methods.canEdit = function () {
  return ['draft', 'pending'].includes(this.status);
};

// Method to check if OD can be cancelled
ODSchema.methods.canCancel = function () {
  return ['draft', 'pending', 'hod_approved'].includes(this.status);
};

// Static method to get pending approvals for a role
ODSchema.statics.getPendingForRole = async function (role, departmentIds = []) {
  const query = {
    isActive: true,
    'workflow.nextApprover': role,
  };

  if (departmentIds.length > 0) {
    query.department = { $in: departmentIds };
  }

  return this.find(query)
    .populate('employeeId', 'employee_name emp_no')
    .populate('department', 'name')
    .populate('designation', 'name')
    .populate('assignedBy', 'name email')
    .sort({ appliedAt: -1 });
};

// Post-save hook to update monthly attendance summary when OD is approved
ODSchema.post('save', async function () {
  try {
    // Only update if status is 'approved' and this is a new approval
    if (this.status === 'approved' && this.isModified('status')) {
      console.log('[OD-FLOW] OD post-save: status=approved and modified, calling recalculateOnODApproval', { odId: this._id?.toString() });
      const { recalculateOnODApproval } = require('../../attendance/services/summaryCalculationService');
      await recalculateOnODApproval(this);
    }

    // Auto-sync pay register when OD is approved/rejected/cancelled
    if (this.isModified('status') && (this.status === 'approved' || this.status === 'hr_approved' || this.status === 'hod_approved' || this.status === 'rejected' || this.status === 'cancelled')) {
      const { syncPayRegisterFromOD } = require('../../pay-register/services/autoSyncService');
      await syncPayRegisterFromOD(this);
    }
  } catch (error) {
    // Don't throw - this is a background operation
    console.error('Error updating monthly summary on OD approval:', error);
  }
});

module.exports = mongoose.models.OD || mongoose.model('OD', ODSchema);

