const mongoose = require('mongoose');

const employeeGroupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Group name is required'],
      trim: true,
      unique: true,
    },
    code: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  }
);

employeeGroupSchema.index({ isActive: 1 });

module.exports =
  mongoose.models.EmployeeGroup || mongoose.model('EmployeeGroup', employeeGroupSchema);
