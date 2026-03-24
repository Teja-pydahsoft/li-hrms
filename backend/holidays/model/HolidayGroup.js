const mongoose = require('mongoose');

const holidayGroupSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'Holiday group name is required'],
            trim: true,
            unique: true,
        },
        description: {
            type: String,
            trim: true,
        },
        // Scoping to Division/Departments
        // If empty, it's not mapped (could be a template or draft)
        divisionMapping: [
            {
                division: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'Division',
                    required: true,
                },
                departments: [
                    {
                        type: mongoose.Schema.Types.ObjectId,
                        ref: 'Department',
                    },
                ],
                // If departments array is empty, it applies to ALL departments in this division
                employeeGroups: [
                    {
                        type: mongoose.Schema.Types.ObjectId,
                        ref: 'EmployeeGroup',
                    },
                ],
                // If employeeGroups array is empty, it applies to ALL employee groups in the selected scope
            },
        ],
        isActive: {
            type: Boolean,
            default: true,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
    },
    {
        timestamps: true,
    }
);

// Index for efficient querying
holidayGroupSchema.index({ 'divisionMapping.division': 1 });

module.exports = mongoose.model('HolidayGroup', holidayGroupSchema);
