const mongoose = require('mongoose');

/**
 * Persisted monthly projection for leave register limits/locks.
 * This is a denormalized, query-friendly snapshot for one employee in one payroll month.
 */
const leaveRegisterMonthlySnapshotSchema = new mongoose.Schema({
    employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: true,
        index: true
    },
    empNo: {
        type: String,
        required: true,
        index: true
    },
    financialYear: {
        type: String,
        required: true,
        index: true
    },
    month: {
        type: Number,
        required: true,
        min: 1,
        max: 12,
        index: true
    },
    year: {
        type: Number,
        required: true,
        index: true
    },

    // CL-focused policy projection for this payroll month
    monthlyCLLimit: { type: Number, default: 0 },
    clUsedThisMonth: { type: Number, default: 0 },
    clPendingThisMonth: { type: Number, default: 0 },
    clLockedThisMonth: { type: Number, default: 0 }, // used + pending
    clAllowedRemaining: { type: Number, default: 0 },

    // Pooled values for CL + optional CCL/EL
    monthlyLimitPooled: { type: Number, default: 0 },
    monthlyAllowedLimit: { type: Number, default: 0 },
    pendingAllDays: { type: Number, default: 0 },

    // Balance context for audit/debugging
    clBalance: { type: Number, default: 0 },
    cclBalance: { type: Number, default: 0 },
    elBalance: { type: Number, default: 0 },

    policySnapshot: {
        mode: { type: String, default: 'accumulative' },
        defaultMonthlyCap: { type: Number, default: 1 },
        maxUsableLimit: { type: Number, default: 4 },
        protectFutureMonths: { type: Boolean, default: true },
        includeCCL: { type: Boolean, default: true },
        includeEL: { type: Boolean, default: true },
        logicType: { type: String, default: 'ADDITIVE' }
    }
}, {
    timestamps: true,
    collection: 'leave_register_monthly_snapshots'
});

leaveRegisterMonthlySnapshotSchema.index(
    { employeeId: 1, financialYear: 1, month: 1, year: 1 },
    { unique: true }
);
leaveRegisterMonthlySnapshotSchema.index({ empNo: 1, financialYear: 1, month: 1, year: 1 });

module.exports = mongoose.models.LeaveRegisterMonthlySnapshot || mongoose.model('LeaveRegisterMonthlySnapshot', leaveRegisterMonthlySnapshotSchema);
