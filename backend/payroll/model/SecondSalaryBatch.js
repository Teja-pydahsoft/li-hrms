const mongoose = require('mongoose');

// Status History Schema
const statusHistorySchema = new mongoose.Schema({
    status: {
        type: String,
        enum: ['pending', 'approved', 'freeze', 'complete'],
        required: true
    },
    changedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    changedAt: {
        type: Date,
        default: Date.now
    },
    reason: String
}, { _id: false });

// Recalculation Permission Schema
const recalculationPermissionSchema = new mongoose.Schema({
    granted: {
        type: Boolean,
        default: false
    },
    grantedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    grantedAt: Date,
    expiresAt: Date,
    reason: String,
    requestedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    requestedAt: Date
}, { _id: false });

// Main SecondSalaryBatch Schema
const secondSalaryBatchSchema = new mongoose.Schema({
    batchNumber: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    division: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Division',
        index: true
    },
    department: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Department',
        required: [true, 'Department context is required'],
        index: true
    },
    month: {
        type: String, // YYYY-MM
        required: true,
        index: true
    },
    year: {
        type: Number,
        required: true
    },
    monthNumber: {
        type: Number,
        required: true,
        min: 1,
        max: 12
    },

    // Employee Payrolls
    employeePayrolls: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SecondSalaryRecord'
    }],
    totalEmployees: {
        type: Number,
        default: 0
    },

    // Financial Summary
    totalGrossSalary: {
        type: Number,
        default: 0
    },
    totalDeductions: {
        type: Number,
        default: 0
    },
    totalNetSalary: {
        type: Number,
        default: 0
    },
    totalArrears: {
        type: Number,
        default: 0
    },

    // Status Management
    status: {
        type: String,
        enum: ['pending', 'approved', 'freeze', 'complete'],
        default: 'pending',
        index: true
    },
    statusHistory: [statusHistorySchema],

    // Recalculation Permission
    recalculationPermission: recalculationPermissionSchema,

    // Audit Trail
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedAt: Date,
    freezedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    freezedAt: Date,
    completedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    completedAt: Date
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Compound index to ensure one batch per department per division per month
secondSalaryBatchSchema.index({ division: 1, department: 1, month: 1, year: 1 }, { unique: true });
secondSalaryBatchSchema.index({ status: 1, month: 1 });
secondSalaryBatchSchema.index({ createdAt: -1 });

// Virtual for month name
secondSalaryBatchSchema.virtual('monthName').get(function () {
    const date = new Date(this.year, this.monthNumber - 1);
    return date.toLocaleString('default', { month: 'long', year: 'numeric' });
});

// Static method to generate batch number
secondSalaryBatchSchema.statics.generateBatchNumber = async function (departmentId, divisionId, month) {
    const Department = mongoose.model('Department');
    const Division = mongoose.model('Division');

    const [dept, div] = await Promise.all([
        Department.findById(departmentId),
        Division.findById(divisionId)
    ]);

    const deptCode = dept?.code || 'DEPT';
    const divCode = div?.code || 'DIV';

    const [year, monthNum] = month.split('-');
    // Batch Number Format: PSB-DIV-DEPT-YYYY-MM-SEQ (PSB = Payroll Second Batch)
    const prefix = `PSB-${divCode}-${deptCode}-${year}-${monthNum}`;

    const lastBatch = await this.findOne({
        batchNumber: new RegExp(`^${prefix}`)
    }).sort({ batchNumber: -1 });

    let sequence = 1;
    if (lastBatch) {
        const parts = lastBatch.batchNumber.split('-');
        const lastSequence = parseInt(parts[parts.length - 1]);
        if (!isNaN(lastSequence)) {
            sequence = lastSequence + 1;
        }
    }

    return `${prefix}-${String(sequence).padStart(3, '0')}`;
};

// Instance method to check if recalculation permission is valid
secondSalaryBatchSchema.methods.hasValidRecalculationPermission = function () {
    if (!this.recalculationPermission || !this.recalculationPermission.granted) {
        return false;
    }
    if (this.recalculationPermission.expiresAt && new Date() > this.recalculationPermission.expiresAt) {
        return false;
    }
    return true;
};

// Instance method to consume recalculation permission (single-use)
secondSalaryBatchSchema.methods.consumeRecalculationPermission = function () {
    if (!this.recalculationPermission) return;
    this.recalculationPermission.granted = false;
    this.recalculationPermission.grantedBy = null;
    this.recalculationPermission.grantedAt = null;
    this.recalculationPermission.expiresAt = null;
    this.recalculationPermission.reason = null;
};

// Pre-save hook to update history
secondSalaryBatchSchema.pre('save', async function () {
    if (this.isNew && this.statusHistory.length === 0) {
        this.statusHistory.push({
            status: this.status,
            changedBy: this.createdBy,
            changedAt: new Date(),
            reason: 'Batch created'
        });
    }
});

module.exports = mongoose.models.SecondSalaryBatch || mongoose.model('SecondSalaryBatch', secondSalaryBatchSchema);
