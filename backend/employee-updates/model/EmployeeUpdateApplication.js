const mongoose = require('mongoose');

const EmployeeUpdateApplicationSchema = new mongoose.Schema({
    employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: true
    },
    emp_no: {
        type: String,
        required: true
    },
    requestedChanges: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    comments: {
        type: String
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('EmployeeUpdateApplication', EmployeeUpdateApplicationSchema);
