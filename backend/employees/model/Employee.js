/**
 * MongoDB Employee Model
 * Mirrors the MSSQL employees table for dual database storage
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const employeeSchema = new mongoose.Schema(
  {
    emp_no: {
      type: String,
      required: [true, 'Employee number is required'],
      unique: true,
      trim: true,
      uppercase: true,
    },
    employee_name: {
      type: String,
      required: [true, 'Employee name is required'],
      trim: true,
    },
    division_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Division',
      default: null, // Will be made required in the controller for new employees
    },
    department_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      default: null,
    },
    designation_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Designation',
      default: null,
    },
    employee_group_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EmployeeGroup',
      default: null,
    },
    doj: {
      type: Date,
      default: null,
    },
    dob: {
      type: Date,
      default: null,
    },
    gross_salary: {
      type: Number,
      default: null,
    },
    /** Salary components (form "Salaries" group): fieldId -> amount; canonical store — not dynamicFields.salaries */
    salaries: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    salary_mode: {
      type: String,
      enum: ['Bank', 'Cash'],
      default: 'Bank',
    },
    gender: {
      type: String,
      enum: ['Male', 'Female', 'Other', null],
      default: null,
    },
    marital_status: {
      type: String,
      enum: ['Single', 'Married', 'Divorced', 'Widowed', null],
      default: null,
    },
    blood_group: {
      type: String,
      enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', null],
      default: null,
    },
    qualifications: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      // Supports both old string format and new array of objects format
      // Old format: "B.Tech, MBA" (string)
      // New format: [{ degree: "B.Tech", qualified_year: 2020 }, { degree: "MBA", qualified_year: 2022 }] (array)
    },
    qualificationStatus: {
      type: String,
      default: 'Partial',
      trim: true,
    },
    experience: {
      type: Number,
      default: null,
    },
    address: {
      type: String,
      trim: true,
      default: null,
    },
    location: {
      type: String,
      trim: true,
      default: null,
    },
    aadhar_number: {
      type: String,
      trim: true,
      default: null,
    },
    phone_number: {
      type: String,
      trim: true,
      default: null,
    },
    alt_phone_number: {
      type: String,
      trim: true,
      default: null,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    pf_number: {
      type: String,
      trim: true,
      default: null,
    },
    esi_number: {
      type: String,
      trim: true,
      default: null,
    },
    bank_account_no: {
      type: String,
      trim: true,
      default: null,
    },
    bank_name: {
      type: String,
      trim: true,
      default: null,
    },
    bank_place: {
      type: String,
      trim: true,
      default: null,
    },
    ifsc_code: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },
    // Earned Leave (EL) balance – synced from leave register
    paidLeaves: {
      type: Number,
      default: 0,
      min: 0,
    },
    casualLeaves: {
      type: Number,
      default: 0,
      min: 0,
    },
    sickLeaves: {
      type: Number,
      default: 0,
      min: 0,
    },
    maternityLeaves: {
      type: Number,
      default: 0,
      min: 0,
    },
    onDutyLeaves: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Yearly allotted leaves (combined total for all leave types with nature "without_pay" or "lop")
    // Used for tracking and carry forward
    allottedLeaves: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Compensatory Off balance (credited when CCL requests are approved)
    compensatoryOffs: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Employee-level Allowance & Deduction Overrides (only store items the employee edited)
    employeeAllowances: {
      type: [
        {
          masterId: { type: mongoose.Schema.Types.ObjectId, ref: 'AllowanceDeductionMaster' },
          code: { type: String, trim: true },
          name: { type: String, trim: true },
          category: { type: String, enum: ['allowance', 'deduction'] },
          type: { type: String, enum: ['fixed', 'percentage'] },
          amount: { type: Number, default: null }, // override amount if fixed
          percentage: { type: Number, default: null },
          percentageBase: { type: String, enum: ['basic', 'gross', null], default: null },
          minAmount: { type: Number, default: null },
          maxAmount: { type: Number, default: null },
          basedOnPresentDays: { type: Boolean, default: false }, // prorate based on present days (only for fixed type)
          isOverride: { type: Boolean, default: true },
        },
      ],
      default: [],
    },
    employeeDeductions: {
      type: [
        {
          masterId: { type: mongoose.Schema.Types.ObjectId, ref: 'AllowanceDeductionMaster' },
          code: { type: String, trim: true },
          name: { type: String, trim: true },
          category: { type: String, enum: ['allowance', 'deduction'] },
          type: { type: String, enum: ['fixed', 'percentage'] },
          amount: { type: Number, default: null }, // override amount if fixed
          percentage: { type: Number, default: null },
          percentageBase: { type: String, enum: ['basic', 'gross', null], default: null },
          minAmount: { type: Number, default: null },
          maxAmount: { type: Number, default: null },
          basedOnPresentDays: { type: Boolean, default: false }, // prorate based on present days (only for fixed type)
          isOverride: { type: Boolean, default: true },
        },
      ],
      default: [],
    },
    // Calculated salary fields (from allowances/deductions)
    ctcSalary: {
      type: Number,
      default: null, // Gross Salary + Total Allowances
    },
    calculatedSalary: {
      type: Number,
      default: null, // Gross Salary + Allowances - Deductions (Net Salary)
    },
    // Dynamic fields for configurable form fields
    dynamicFields: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Profile photo URL (uploaded to S3 profiles folder)
    profilePhoto: {
      type: String,
      trim: true,
      default: null,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    // Employee left date - when employee left the company
    leftDate: {
      type: Date,
      default: null,
    },
    // Reason for leaving (optional)
    leftReason: {
      type: String,
      trim: true,
      default: null,
    },
    password: {
      type: String,
      default: null,
      select: false,
    },
    plain_password: {
      type: String,
      default: null,
      select: false, // Not returned by default for security
    },
    resetPasswordToken: String,
    resetPasswordExpire: Date,
    lastLogin: Date,
    // Second Salary fixed amount for calculation
    second_salary: {
      type: Number,
      default: 0,
      min: 0,
    },
    // 3-Step Approval Workflow Fields
    salaryStatus: {
      type: String,
      enum: ['pending_approval', 'approved'],
      default: 'pending_approval',
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    salaryApprovedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    salaryApprovedAt: {
      type: Date,
      default: null,
    },
    // Employee-level deduction flags (default true = apply deduction). Used by payroll for statutory & attendance.
    applyProfessionTax: { type: Boolean, default: true },
    applyESI: { type: Boolean, default: true },
    applyPF: { type: Boolean, default: true },
    applyAttendanceDeduction: { type: Boolean, default: true },
    deductLateIn: { type: Boolean, default: true },
    deductEarlyOut: { type: Boolean, default: true },
    deductPermission: { type: Boolean, default: true },
    deductAbsent: { type: Boolean, default: true },
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  }
);

// Indexes
// Note: emp_no already has unique:true which creates an index
employeeSchema.index({ employee_name: 1 });
employeeSchema.index({ department_id: 1 });
employeeSchema.index({ designation_id: 1 });
employeeSchema.index({ is_active: 1 });
employeeSchema.index({ leftDate: 1 });
employeeSchema.index({ phone_number: 1 });
employeeSchema.index({ email: 1 });
employeeSchema.index({ division_id: 1 });
employeeSchema.index({ employee_group_id: 1 });

// Virtual for department population
employeeSchema.virtual('department', {
  ref: 'Department',
  localField: 'department_id',
  foreignField: '_id',
  justOne: true,
});



// Virtual for division population
employeeSchema.virtual('division', {
  ref: 'Division',
  localField: 'division_id',
  foreignField: '_id',
  justOne: true,
});

// Virtual for designation population
employeeSchema.virtual('designation', {
  ref: 'Designation',
  localField: 'designation_id',
  foreignField: '_id',
  justOne: true,
});

employeeSchema.virtual('employee_group', {
  ref: 'EmployeeGroup',
  localField: 'employee_group_id',
  foreignField: '_id',
  justOne: true,
});
// Compound index for efficient scoped/filtered discovery at 1M scale
employeeSchema.index({ division_id: 1, department_id: 1, is_active: 1 }, { background: true });

// Virtual getter for unified qualifications (backward compatibility)
// Returns dynamicFields.qualifications if exists, otherwise falls back to old qualifications string
employeeSchema.virtual('getQualifications').get(function () {
  // Priority 1: Check dynamicFields.qualifications (new format - array of objects)
  if (this.dynamicFields?.qualifications && Array.isArray(this.dynamicFields.qualifications) && this.dynamicFields.qualifications.length > 0) {
    return this.dynamicFields.qualifications;
  }
  // Priority 2: Check root level qualifications (new format - array of objects)
  if (this.qualifications && Array.isArray(this.qualifications) && this.qualifications.length > 0) {
    return this.qualifications;
  }
  // Priority 3: Fallback to old string format at root level
  if (this.qualifications && typeof this.qualifications === 'string') {
    // Convert old string format to array format for backward compatibility
    return [{ degree: this.qualifications }];
  }
  // Return empty array if no qualifications found
  return [];
});

// Virtual getter for all data (permanent + dynamicFields merged)
// This provides a unified view of employee data
employeeSchema.virtual('allData').get(function () {
  const permanentFields = this.toObject({ virtuals: false });
  const { dynamicFields, _id, __v, ...permanentData } = permanentFields;

  // Merge dynamicFields into root level for easy access
  return {
    ...permanentData,
    ...(dynamicFields || {}),
    // Keep dynamicFields separate for reference
    dynamicFields: dynamicFields || {},
  };
});

// Method to get unified data (includes dynamicFields merged)
employeeSchema.methods.getUnifiedData = function () {
  const permanentFields = this.toObject({ virtuals: false });
  const { dynamicFields, _id, __v, ...permanentData } = permanentFields;

  return {
    ...permanentData,
    ...(dynamicFields || {}),
    dynamicFields: dynamicFields || {},
  };
};

// Method to get only permanent fields (for MSSQL sync)
employeeSchema.methods.getPermanentFields = function () {
  const allFields = this.toObject({ virtuals: false });
  const { dynamicFields, _id, __v, ...permanentFields } = allFields;
  return permanentFields;
};

/**
 * Returns MongoDB filter for "currently active" employees: is_active and either no leftDate or leftDate on/after today.
 * Use this so that resigned employees stay visible/active until their last working date.
 * @returns {Object} - Filter to use with find/countDocuments
 */
employeeSchema.statics.getCurrentlyActiveFilter = function () {
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  return {
    is_active: { $ne: false },
    $or: [
      { leftDate: null },
      { leftDate: { $gte: startOfToday } },
    ],
  };
};

/**
 * Static method to check if employee should be included for a given month
 * @param {Date|String} leftDate - Employee's left date
 * @param {String} month - Month in YYYY-MM format
 * @returns {Boolean} - True if employee should be included for this month
 *
 * Logic:
 * - If no leftDate: Always include (employee is still active)
 * - If leftDate is within the month: Include (they left during this month)
 * - If leftDate is after the month: Include (they were active during this month)
 * - If leftDate is before the month: Exclude (they left before this month started)
 */
employeeSchema.statics.shouldIncludeForMonth = function (leftDate, month) {
  if (!leftDate) return true; // No left date, always include

  // Parse month to get year and month number
  const [year, monthNum] = month.split('-').map(Number);
  const monthStart = new Date(year, monthNum - 1, 1);

  // Convert leftDate to Date if it's a string
  const leftDateObj = leftDate instanceof Date ? leftDate : new Date(leftDate);

  // Include if left date is on or after the start of this month
  // (meaning they were active during this month or left during this month)
  return leftDateObj >= monthStart;
};

/**
 * Instance method to check if employee should be included for a given month
 * @param {String} month - Month in YYYY-MM format
 * @returns {Boolean} - True if employee should be included for this month
 */
employeeSchema.methods.shouldIncludeForMonth = function (month) {
  return this.constructor.shouldIncludeForMonth(this.leftDate, month);
};

// Ensure virtuals are included in JSON output
employeeSchema.set('toJSON', { virtuals: true });
employeeSchema.set('toObject', { virtuals: true });

// Password hashing middleware
employeeSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) {
    console.log(`[EmployeeModel] Password not modified or missing for ${this.emp_no}, skipping hash.`);
    return;
  }
  console.log(`[EmployeeModel] Hashing password for employee ${this.emp_no}...`);
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  console.log(`[EmployeeModel] Password hashed successfully for ${this.emp_no}.`);
});

// Compare password method
employeeSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return await bcrypt.compare(candidatePassword, this.password);
};

// Generate password reset token
employeeSchema.methods.getResetPasswordToken = function () {
  const resetToken = crypto.randomBytes(20).toString('hex');
  this.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  this.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 minutes
  return resetToken;
};

module.exports = mongoose.models.Employee || mongoose.model('Employee', employeeSchema);

