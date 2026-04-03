const mongoose = require('mongoose');

/**
 * Second Salary Record Model
 * Stores monthly 2nd salary calculation for each employee
 */
const secondSalaryRecordSchema = new mongoose.Schema(
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
        // Combined arrears from Arrears Settlement
        arrearsAmount: {
            type: Number,
            default: 0,
        },
        manualDeductionsAmount: {
            type: Number,
            default: 0,
        },
        arrearsSettlements: [
            {
                arrearId: { type: mongoose.Schema.Types.ObjectId, ref: 'ArrearsRequest' },
                amount: { type: Number, required: true },
            },
        ],
        deductionSettlements: [
            {
                deductionId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeductionRequest' },
                amount: { type: Number, required: true },
            },
        ],
        // Pay for extra days specifically
        extraDaysPay: {
            type: Number,
            default: 0,
        },

        // ATTENDANCE BREAKDOWN
        attendance: {
            totalDaysInMonth: {
                type: Number,
                default: 0,
                min: 1,
                max: 40,
            },
            presentDays: {
                type: Number,
                default: 0,
                min: 0,
            },
            paidLeaveDays: {
                type: Number,
                default: 0,
                min: 0,
            },
            odDays: {
                type: Number,
                default: 0,
                min: 0,
            },
            weeklyOffs: {
                type: Number,
                default: 0,
                min: 0,
            },
            holidays: {
                type: Number,
                default: 0,
                min: 0,
            },
            absentDays: {
                type: Number,
                default: 0,
                min: 0,
            },
            payableShifts: {
                type: Number,
                default: 0,
                min: 0,
            },
            extraDays: {
                type: Number,
                default: 0,
                min: 0,
            },
            totalPaidDays: {
                type: Number,
                default: 0,
                min: 0,
            },
            paidDays: {
                type: Number,
                default: 0,
            },
            otHours: {
                type: Number,
                default: 0,
                min: 0,
            },
            otDays: {
                type: Number,
                default: 0,
                min: 0,
            },
            earnedSalary: {
                type: Number,
                default: 0,
                min: 0,
            },
            attendanceDeductionDays: {
                type: Number,
                default: 0,
                min: 0,
            },
        },

        // EARNINGS BREAKDOWN
        earnings: {
            // Fixed 2nd salary amount from employee profile
            secondSalaryAmount: {
                type: Number,
                default: 0,
                min: 0,
            },
            // Basic pay (for 2nd salary, this is the secondSalaryAmount)
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
            grossSalary: {
                type: Number,
                default: 0,
                min: 0,
            },
        },

        // DEDUCTIONS BREAKDOWN
        deductions: {
            attendanceDeduction: {
                type: Number,
                default: 0,
                min: 0,
            },
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
            permissionDeduction: {
                type: Number,
                default: 0,
                min: 0,
            },
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
            leaveDeduction: {
                type: Number,
                default: 0,
                min: 0,
            },
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
            totalOtherDeductions: {
                type: Number,
                default: 0,
                min: 0,
            },
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
            // Statutory (PF, ESI, PT) — same shape as PayrollRecord so dynamic 2nd-salary engine persists breakdown
            statutoryDeductions: [
                {
                    name: String,
                    code: String,
                    employeeAmount: Number,
                    employerAmount: Number,
                },
            ],
            totalStatutoryEmployee: { type: Number, default: 0, min: 0 },
            statutoryCumulative: { type: Number, default: 0, min: 0 },
            deductionsCumulative: { type: Number, default: 0, min: 0 },
            totalDeductions: {
                type: Number,
                default: 0,
                min: 0,
            },
        },

        // LOAN & ADVANCE ADJUSTMENTS
        loanAdvance: {
            totalEMI: {
                type: Number,
                default: 0,
                min: 0,
            },
            emiBreakdown: [
                {
                    loanId: {
                        type: mongoose.Schema.Types.ObjectId,
                        ref: 'Loan',
                    },
                    emiAmount: Number,
                },
            ],
            advanceDeduction: {
                type: Number,
                default: 0,
                min: 0,
            },
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

        roundOff: {
            type: Number,
            default: 0,
        },

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

        // Reference to attendance summary
        attendanceSummaryId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'MonthlyAttendanceSummary',
        },

        // Reference to 2nd salary payroll batch
        secondSalaryBatchId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'SecondSalaryBatch',
        },

        // Audit Trail
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
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

// Unique index: one 2nd salary record per employee per month
secondSalaryRecordSchema.index({ employeeId: 1, month: 1 }, { unique: true });
secondSalaryRecordSchema.index({ emp_no: 1, month: 1 }, { unique: true });

// Static method to get or create record
secondSalaryRecordSchema.statics.getOrCreate = async function (employeeId, emp_no, year, monthNumber) {
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

module.exports = mongoose.models.SecondSalaryRecord || mongoose.model('SecondSalaryRecord', secondSalaryRecordSchema);
