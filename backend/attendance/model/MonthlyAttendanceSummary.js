const mongoose = require('mongoose');
const { createISTDate, extractISTComponents } = require('../../shared/utils/dateUtils');

/**
 * Monthly Attendance Summary Model
 * Stores aggregated monthly attendance data for each employee
 * Used for analytics and payroll calculations
 */
const monthlyAttendanceSummarySchema = new mongoose.Schema(
  {
    // Employee reference
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'Employee is required'],
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

    // Total number of leaves (approved) in this month
    totalLeaves: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Total number of ODs (approved) in this month
    totalODs: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Total week-off days in the period (from roster / AttendanceDaily status WEEK_OFF)
    totalWeeklyOffs: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Total holiday days in the period (from roster / AttendanceDaily status HOLIDAY)
    totalHolidays: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Total present days in this month
    totalPresentDays: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Total days in the pay period (respects pay cycle: e.g. 28–31 for calendar month, or 33 for 25 Jan–26 Feb)
    totalDaysInMonth: {
      type: Number,
      required: [true, 'Total days in month is required'],
      min: 28,
      max: 35,
    },

    // Total payable shifts in this month
    // Calculated as: sum of shift.payableShifts for present days + ODs (each OD = 1)
    totalPayableShifts: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Overtime hours (from approved OT requests)
    totalOTHours: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Extra hours worked without OT request (auto-detected)
    totalExtraHours: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Permission hours (total hours of permissions taken)
    totalPermissionHours: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Permission count (number of permissions taken)
    totalPermissionCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // NEW: Early-Out / Late-In Fields
    // Total early-out minutes in this month
    totalEarlyOutMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Total early-out deduction days (quarter/half/full days)
    totalEarlyOutDeductionDays: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Total early-out deduction amount (for custom_amount deductions)
    totalEarlyOutDeductionAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Breakdown of deduction types
    earlyOutDeductionBreakdown: {
      quarter_day: {
        type: Number,
        default: 0,
        min: 0,
      },
      half_day: {
        type: Number,
        default: 0,
        min: 0,
      },
      full_day: {
        type: Number,
        default: 0,
        min: 0,
      },
      custom_amount: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
    // Count of early-out instances
    earlyOutCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Total late-in minutes in this month (first shift only)
    totalLateInMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Count of late-in instances (days with late-in on first shift)
    lateInCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Combined late-in + early-out minutes (first shift only)
    totalLateOrEarlyMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Count of days with either late-in or early-out (first shift only)
    lateOrEarlyCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Last calculated/updated timestamp
    lastCalculatedAt: {
      type: Date,
      default: Date.now,
    },

    /**
     * Store lists of date strings (YYYY-MM-DD) that contributed to each summary metric.
     * This is used by the frontend to highlight relevant cells when a summary value is clicked.
     */
    contributingDates: {
      present: [String],
      leaves: [String],
      ods: [String],
      weeklyOffs: [String],
      holidays: [String],
      payableShifts: [String],
      otHours: [String],
      extraHours: [String],
      lateIn: [String],
      earlyOut: [String],
      permissions: [String],
    },

    // Additional metadata
    notes: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Unique index: one summary per employee per month
monthlyAttendanceSummarySchema.index({ employeeId: 1, month: 1 }, { unique: true });
monthlyAttendanceSummarySchema.index({ emp_no: 1, month: 1 }, { unique: true });

// Index for queries
monthlyAttendanceSummarySchema.index({ year: 1, monthNumber: 1 });
monthlyAttendanceSummarySchema.index({ employeeId: 1, year: 1 });

// Static method to get or create summary for an employee and month
monthlyAttendanceSummarySchema.statics.getOrCreate = async function (employeeId, emp_no, year, monthNumber) {
  const monthStr = `${year}-${String(monthNumber).padStart(2, '0')}`;
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = `${monthNames[monthNumber - 1]} ${year}`;

  // Get total days in month via IST
  const nextMonthFirst = monthNumber === 12
    ? createISTDate(`${year + 1}-01-01`)
    : createISTDate(`${year}-${String(monthNumber + 1).padStart(2, '0')}-01`);
  const lastDayOfMonth = new Date(nextMonthFirst.getTime() - 1000);
  const totalDaysInMonth = extractISTComponents(lastDayOfMonth).day;

  let summary = await this.findOne({ employeeId, month: monthStr });

  if (!summary) {
    // New summary: use calendar month days as initial value; calculateMonthlySummary overwrites with pay-period length
    summary = await this.create({
      employeeId,
      emp_no,
      month: monthStr,
      monthName,
      year,
      monthNumber,
      totalDaysInMonth,
    });
  } else {
    // Update month name only; totalDaysInMonth is set from pay period in calculateMonthlySummary (respects pay cycle)
    summary.monthName = monthName;
    await summary.save();
  }

  return summary;
};

module.exports = mongoose.models.MonthlyAttendanceSummary || mongoose.model('MonthlyAttendanceSummary', monthlyAttendanceSummarySchema);

