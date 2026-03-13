const mongoose = require('mongoose');

/**
 * Loan/Salary Advance Model
 * Handles loan and salary advance applications with dynamic workflow
 */
const LoanSchema = new mongoose.Schema(
  {
    // Employee who applied for loan/advance
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

    // Type of request: 'loan' or 'salary_advance'
    requestType: {
      type: String,
      enum: ['loan', 'salary_advance'],
      required: [true, 'Request type is required'],
    },

    // Requested amount
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [1, 'Amount must be greater than 0'],
    },

    // Original amount requested (never changes after submission)
    originalAmount: {
      type: Number,
      required: [true, 'Original amount is required'],
    },

    // Optional amount requested if higher than eligibility
    needAmount: {
      type: Number,
    },

    // Reason/Purpose for loan/advance
    reason: {
      type: String,
      required: [true, 'Reason is required'],
      trim: true,
      maxlength: [500, 'Reason cannot exceed 500 characters'],
    },

    // Duration in months (for loans) or payroll cycles (for advances)
    duration: {
      type: Number,
      required: [true, 'Duration is required'],
      min: [1, 'Duration must be at least 1'],
    },

    // Interest amount (calculated based on principal, rate, and duration)
    interestAmount: {
      type: Number,
      default: 0,
    },

    // Remarks/Additional notes
    remarks: {
      type: String,
      trim: true,
      maxlength: [1000, 'Remarks cannot exceed 1000 characters'],
    },

    // Current status
    status: {
      type: String,
      enum: ['draft', 'pending', 'hod_approved', 'hod_rejected', 'manager_approved', 'manager_rejected', 'hr_approved', 'hr_rejected', 'approved', 'rejected', 'cancelled', 'disbursed', 'active', 'completed'],
      default: 'draft',
    },

    // Workflow tracking
    workflow: {
      // Current step in workflow
      currentStep: {
        type: String,
        enum: ['employee', 'hod', 'manager', 'hr', 'final', 'completed'],
        default: 'employee',
      },

      // Next approver role
      nextApprover: {
        type: String,
        enum: ['hod', 'manager', 'hr', 'final_authority', null],
        default: null,
      },

      // Workflow history
      history: [
        {
          step: String,
          action: {
            type: String,
            enum: ['submitted', 'approved', 'rejected', 'forwarded', 'returned', 'cancelled', 'disbursed', 'status_changed'],
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
          enum: ['pending', 'approved', 'rejected', 'forwarded', null],
          default: null,
        },
        approvedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        approvedAt: Date,
        comments: String,
      },
      manager: {
        status: {
          type: String,
          enum: ['pending', 'approved', 'rejected', 'forwarded', null],
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

    // Loan-specific configuration (only for loans, not salary advances)
    loanConfig: {
      // EMI amount (calculated)
      emiAmount: {
        type: Number,
        default: 0,
      },
      // Interest rate (if applicable)
      interestRate: {
        type: Number,
        default: 0,
      },
      // Total interest amount (calculated)
      totalInterest: {
        type: Number,
        default: 0,
      },
      // Start date for EMI deductions
      startDate: {
        type: Date,
      },
      // End date for EMI deductions
      endDate: {
        type: Date,
      },
      // Total amount with interest
      totalAmount: {
        type: Number,
        default: 0,
      },
    },

    // Salary Advance-specific configuration (only for salary advances)
    advanceConfig: {
      // Payroll cycle from which deduction starts
      deductionStartCycle: {
        type: String, // e.g., "2024-11" (YYYY-MM format)
      },
      // Number of cycles to deduct
      deductionCycles: {
        type: Number,
        default: 1,
      },
      // Amount per cycle
      deductionPerCycle: {
        type: Number,
        default: 0,
      },
    },

    // Repayment tracking
    repayment: {
      // Total amount paid so far
      totalPaid: {
        type: Number,
        default: 0,
      },
      // Remaining balance
      remainingBalance: {
        type: Number,
        default: 0,
      },
      // Number of EMIs/cycles paid
      installmentsPaid: {
        type: Number,
        default: 0,
      },
      // Total installments/cycles
      totalInstallments: {
        type: Number,
        default: 0,
      },
      // Last payment date
      lastPaymentDate: {
        type: Date,
      },
      // Next payment due date
      nextPaymentDate: {
        type: Date,
      },
    },

    // Transaction log for traceability
    transactions: [
      {
        transactionType: {
          type: String,
          enum: ['disbursement', 'emi_payment', 'advance_deduction', 'adjustment', 'refund', 'early_settlement'],
        },
        amount: Number,
        transactionDate: {
          type: Date,
          default: Date.now,
        },
        payrollCycle: String, // For tracking which payroll cycle this belongs to
        processedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        remarks: String,
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // Department at the time of application
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
    },

    // Designation at the time of application
    designation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Designation',
    },

    // Division at the time of application
    division_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Division',
    },

    // Disbursement details
    disbursement: {
      disbursedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      disbursedAt: Date,
      disbursementMethod: {
        type: String,
        enum: ['bank_transfer', 'cash', 'cheque', 'other'],
      },
      transactionReference: String,
      remarks: String,
    },

    // Guarantors for the loan (at least two required)
    guarantors: [
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
        name: String,
        status: {
          type: String,
          enum: ['pending', 'accepted', 'rejected'],
          default: 'pending',
        },
        actionAt: Date,
        remarks: String,
      },
    ],

    // applied by (the user who submitted)
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

    // Is this loan/advance active (not deleted)
    isActive: {
      type: Boolean,
      default: true,
    },

    // Financial year reference
    financialYear: {
      type: String, // e.g., "2024-2025"
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
  },
  {
    timestamps: true,
  }
);

// Indexes for faster queries
LoanSchema.index({ employeeId: 1, status: 1 });
LoanSchema.index({ emp_no: 1 });
LoanSchema.index({ department: 1, status: 1 });
LoanSchema.index({ requestType: 1, status: 1 });
LoanSchema.index({ status: 1, 'workflow.nextApprover': 1 });
LoanSchema.index({ appliedAt: -1 });
LoanSchema.index({ 'repayment.nextPaymentDate': 1 });

// Pre-save hook to calculate remaining balance and migrations
LoanSchema.pre('save', function () {
  // Migration: Fill originalAmount for older records
  if (this.amount && !this.originalAmount) {
    this.originalAmount = this.amount;
  }

  if (this.requestType === 'loan' && this.loanConfig.totalAmount) {
    this.repayment.remainingBalance = this.loanConfig.totalAmount - (this.repayment.totalPaid || 0);
  } else if (this.requestType === 'salary_advance') {
    this.repayment.remainingBalance = this.amount - (this.repayment.totalPaid || 0);
  }
});

// Virtual for display name
LoanSchema.virtual('statusDisplay').get(function () {
  const statusMap = {
    draft: 'Draft',
    pending: 'Pending',
    hod_approved: 'HOD Approved',
    hod_rejected: 'HOD Rejected',
    manager_approved: 'Manager Approved',
    manager_rejected: 'Manager Rejected',
    hr_approved: 'HR Approved',
    hr_rejected: 'HR Rejected',
    approved: 'Approved',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
    disbursed: 'Disbursed',
    active: 'Active',
    completed: 'Completed',
  };
  return statusMap[this.status] || this.status;
});

// Method to check if loan can be edited
LoanSchema.methods.canEdit = function () {
  return ['draft', 'pending'].includes(this.status);
};

// Method to check if loan can be cancelled
LoanSchema.methods.canCancel = function () {
  return ['draft', 'pending', 'hod_approved'].includes(this.status);
};

// Static method to get pending approvals for a role
LoanSchema.statics.getPendingForRole = async function (role, departmentIds = []) {
  const query = {
    isActive: true,
    'workflow.nextApprover': role,
  };

  if (departmentIds.length > 0) {
    query.department = { $in: departmentIds };
  }

  return this.find(query)
    .populate('employeeId', 'employee_name emp_no gross_salary')
    .populate('department', 'name')
    .populate('designation', 'name')
    .sort({ appliedAt: -1 });
};

module.exports = mongoose.models.Loan || mongoose.model('Loan', LoanSchema);

