const mongoose = require('mongoose');

/**
 * Payroll Record Model
 * Stores monthly payroll calculation for each employee
 */
const payrollRecordSchema = new mongoose.Schema(
  {
    // Employee reference
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'Employee is required'],
      index: true,
    },
    // Division reference (for scoped reporting)
    division_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Division',
      index: true,
    },

    // Employee number for quick reference
    emp_no: {
      type: String,
      required: [true, 'Employee number is required'],
      index: true,
    },

    // Month in format "YYYY-MM" (e.g., "2024-01")
    month: {
      type: String,
      required: [true, 'Month is required'],
      match: [/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format'],
      index: true,
    },

    // Month name for display (e.g., "January 2024")
    monthName: {
      type: String,
      required: [true, 'Month name is required'],
    },

    // Year for filtering
    year: {
      type: Number,
      required: [true, 'Year is required'],
      index: true,
    },

    // Month number (1-12)
    monthNumber: {
      type: Number,
      required: [true, 'Month number is required'],
      min: 1,
      max: 12,
    },

    // Total days in the month
    totalDaysInMonth: {
      type: Number,
      required: [true, 'Total days in month is required'],
      min: 1,
      max: 40,
    },

    // Payroll Cycle Start Date (YYYY-MM-DD)
    startDate: {
      type: String,
      index: true,
    },

    // Payroll Cycle End Date (YYYY-MM-DD)
    endDate: {
      type: String,
      index: true,
    },

    // Total payable shifts
    totalPayableShifts: {
      type: Number,
      default: 0,
      min: 0,
    },
    // EL days added as paid in this payroll (when useAsPaidInPayroll ON); debited from balance on batch complete
    elUsedInPayroll: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Combined arrears from Arrears Settlement
    arrearsAmount: {
      type: Number,
      default: 0,
    },
    // Manual deductions (approved deduction requests settled in this payroll)
    manualDeductionsAmount: {
      type: Number,
      default: 0,
    },
    // Pay for extra days specifically
    extraDaysPay: {
      type: Number,
      default: 0,
    },

    // ATTENDANCE BREAKDOWN (NEW - Enhanced tracking)
    attendance: {
      // Total days in the month
      totalDaysInMonth: {
        type: Number,
        default: 0,
        min: 1,
        max: 40,
      },
      // Present days (actual working days)
      presentDays: {
        type: Number,
        default: 0,
        min: 0,
      },
      // Paid leave days
      paidLeaveDays: {
        type: Number,
        default: 0,
        min: 0,
      },
      // On Duty days
      odDays: {
        type: Number,
        default: 0,
        min: 0,
      },
      // Weekly offs in the month
      weeklyOffs: {
        type: Number,
        default: 0,
        min: 0,
      },
      // Holidays in the month
      holidays: {
        type: Number,
        default: 0,
        min: 0,
      },
      // Absent days (calculated)
      absentDays: {
        type: Number,
        default: 0,
        min: 0,
      },
      // Payable shifts
      payableShifts: {
        type: Number,
        default: 0,
        min: 0,
      },
      // Extra days = Payable Shifts - (Present + OD)
      extraDays: {
        type: Number,
        default: 0,
        min: 0,
      },
      // Total paid days = Present + WeekOffs + PaidLeave + Extra + OD
      totalPaidDays: {
        type: Number,
        default: 0,
        min: 0,
      },
      // Paid days for display (Present + WeekOffs + PaidLeave + OD + Holidays)
      paidDays: {
        type: Number,
        default: 0,
      },
      // OT hours
      otHours: {
        type: Number,
        default: 0,
        min: 0,
      },
      // OT days
      otDays: {
        type: Number,
        default: 0,
        min: 0,
      },
      // Earned salary (Total Paid Days × Per Day Salary)
      earnedSalary: {
        type: Number,
        default: 0,
        min: 0,
      },
    },

    // EARNINGS BREAKDOWN
    earnings: {
      // Fixed basic pay from employee profile
      basicPay: {
        type: Number,
        default: 0,
        min: 0,
      },
      // Per day basic pay
      perDayBasicPay: {
        type: Number,
        default: 0,
        min: 0,
      },
      // Payable amount based on shifts
      payableAmount: {
        type: Number,
        default: 0,
        min: 0,
      },
      // Incentive = Payable Amount - Basic Pay
      incentive: {
        type: Number,
        default: 0,
      },
      // Overtime pay
      otPay: {
        type: Number,
        default: 0,
        min: 0,
      },
      // OT hours used for calculation
      otHours: {
        type: Number,
        default: 0,
        min: 0,
      },
      // OT rate per hour used
      otRatePerHour: {
        type: Number,
        default: 0,
        min: 0,
      },
      // Total allowances
      totalAllowances: {
        type: Number,
        default: 0,
        min: 0,
      },
      // Cumulative of all allowances (for use in later steps / formulas)
      allowancesCumulative: {
        type: Number,
        default: 0,
        min: 0,
      },
      // Allowances breakdown (array of {name, amount, type})
      allowances: [
        {
          name: String,
          amount: Number,
          type: {
            type: String,
            enum: ['fixed', 'percentage'],
          },
          base: {
            type: String,
            enum: ['basic', 'gross'],
          },
        },
      ],
      // Gross salary
      grossSalary: {
        type: Number,
        default: 0,
        min: 0,
      },
    },

    // DEDUCTIONS BREAKDOWN
    deductions: {
      // Attendance deduction (late-ins + early-outs)
      attendanceDeduction: {
        type: Number,
        default: 0,
        min: 0,
      },
      // Attendance deduction breakdown
      attendanceDeductionBreakdown: {
        lateInsCount: {
          type: Number,
          default: 0,
        },
        earlyOutsCount: {
          type: Number,
        },
        combinedCount: {
          type: Number,
          default: 0,
        },
        daysDeducted: {
          type: Number,
          default: 0,
        },
        deductionType: String,
        calculationMode: String,
      },
      // Permission deduction
      permissionDeduction: {
        type: Number,
        default: 0,
        min: 0,
      },
      // Permission deduction breakdown
      permissionDeductionBreakdown: {
        permissionCount: {
          type: Number,
          default: 0,
        },
        eligiblePermissionCount: {
          type: Number,
          default: 0,
        },
        daysDeducted: {
          type: Number,
          default: 0,
        },
        deductionType: String,
        calculationMode: String,
      },
      // Leave deduction
      leaveDeduction: {
        type: Number,
        default: 0,
        min: 0,
      },
      // Leave deduction breakdown
      leaveDeductionBreakdown: {
        totalLeaves: {
          type: Number,
          default: 0,
        },
        paidLeaves: {
          type: Number,
          default: 0,
        },
        unpaidLeaves: {
          type: Number,
          default: 0,
        },
        daysDeducted: {
          type: Number,
          default: 0,
        },
      },
      // Other deductions (from AllowanceDeductionMaster)
      totalOtherDeductions: {
        type: Number,
        default: 0,
        min: 0,
      },
      // Other deductions breakdown
      otherDeductions: [
        {
          name: String,
          amount: Number,
          type: {
            type: String,
            enum: ['fixed', 'percentage'],
          },
          base: {
            type: String,
            enum: ['basic', 'gross', 'fixed'],
          },
        },
      ],
      // Statutory deductions (ESI, PF, Profession Tax) - employee share only in payroll
      statutoryDeductions: [
        {
          name: String,
          code: String,
          employeeAmount: Number,
          employerAmount: Number,
        },
      ],
      totalStatutoryEmployee: { type: Number, default: 0, min: 0 },
      totalStatutoryEmployer: { type: Number, default: 0, min: 0 },
      // Cumulative statutory (employee share) for this month; YTD can be derived from sum of past months
      statutoryCumulative: { type: Number, default: 0, min: 0 },
      // Cumulative of all deductions (for use in later steps / formulas)
      deductionsCumulative: { type: Number, default: 0, min: 0 },
      // Total deductions (excluding EMI and advance)
      totalDeductions: {
        type: Number,
        default: 0,
        min: 0,
      },
    },

    // LOAN & ADVANCE ADJUSTMENTS
    loanAdvance: {
      // Total EMI deductions
      totalEMI: {
        type: Number,
        default: 0,
        min: 0,
      },
      // EMI breakdown
      emiBreakdown: [
        {
          loanId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Loan',
          },
          emiAmount: Number,
        },
      ],
      // Salary advance deduction
      advanceDeduction: {
        type: Number,
        default: 0,
        min: 0,
      },
      // Advance breakdown
      advanceBreakdown: [
        {
          advanceId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Loan',
          },
          advanceAmount: Number,
          carriedForward: Number,
        },
      ],
    },

    // NET SALARY
    netSalary: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Round off adjustment (difference between exact and rounded net salary)
    roundOff: {
      type: Number,
      default: 0,
    },

    // Payable amount before advance
    payableAmountBeforeAdvance: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Status
    status: {
      type: String,
      enum: ['draft', 'calculated', 'approved', 'processed', 'cancelled'],
      default: 'calculated',
    },

    // Visibility / Release status
    isReleased: {
      type: Boolean,
      default: false,
    },

    // Download tracking
    downloadCount: {
      type: Number,
      default: 0,
    },

    // Approval details
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    approvedAt: Date,
    approvedComments: String,

    // Processed details
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    processedAt: Date,

    // Reference to attendance summary
    attendanceSummaryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MonthlyAttendanceSummary',
    },

    // Reference to payroll batch
    payrollBatchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PayrollBatch',
    },

    // Additional metadata
    notes: {
      type: String,
      trim: true,
      default: null,
    },

    // Calculation metadata
    calculationMetadata: {
      calculatedAt: {
        type: Date,
        default: Date.now,
      },
      calculatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      calculationVersion: {
        type: String,
        default: '1.0',
      },
      // Store settings used for calculation (for audit)
      settingsSnapshot: {
        otSettings: {
          otPayPerHour: Number,
          minOTHours: Number,
        },
        permissionDeductionRules: {
          countThreshold: Number,
          deductionType: String,
          minimumDuration: Number,
          calculationMode: String,
        },
        attendanceDeductionRules: {
          combinedCountThreshold: Number,
          deductionType: String,
          minimumDuration: Number,
          calculationMode: String,
        },
      },
    },
  },
  {
    timestamps: true,
  }
);

// Unique index: one payroll record per employee per month
payrollRecordSchema.index({ employeeId: 1, month: 1 }, { unique: true });
payrollRecordSchema.index({ emp_no: 1, month: 1 }, { unique: true });

// Indexes for queries
payrollRecordSchema.index({ year: 1, monthNumber: 1 });
payrollRecordSchema.index({ employeeId: 1, year: 1 });
payrollRecordSchema.index({ status: 1 });
payrollRecordSchema.index({ month: 1, status: 1 });

// Static method to get or create payroll record
payrollRecordSchema.statics.getOrCreate = async function (employeeId, emp_no, year, monthNumber) {
  const { getPayrollDateRange } = require('../../shared/utils/dateUtils');
  const { startDate, endDate, totalDays } = await getPayrollDateRange(year, monthNumber);

  const monthStr = `${year}-${String(monthNumber).padStart(2, '0')}`;
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = `${monthNames[monthNumber - 1]} ${year}`;

  let record = await this.findOne({ employeeId, month: monthStr });

  if (!record) {
    record = await this.create({
      employeeId,
      emp_no,
      month: monthStr,
      monthName,
      year,
      monthNumber,
      totalDaysInMonth: totalDays,
      startDate,
      endDate,
      attendance: { totalDaysInMonth: totalDays },
      status: 'draft',
    });
  } else {
    // Update month name and range
    record.monthName = monthName;
    record.totalDaysInMonth = totalDays;
    record.startDate = startDate;
    record.endDate = endDate;
    if (record.attendance) {
      record.attendance.totalDaysInMonth = totalDays;
    }
    await record.save();
  }

  return record;
};

module.exports = mongoose.models.PayrollRecord || mongoose.model('PayrollRecord', payrollRecordSchema);

