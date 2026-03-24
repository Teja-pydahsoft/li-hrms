const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [5, 'Password must be at least 5 characters'],
      select: false, // Don't return password by default
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    role: {
      type: String,
      enum: ['super_admin', 'sub_admin', 'hr', 'manager', 'hod', 'employee'],
      required: [true, 'Role is required'],
      default: 'employee',
    },
    // Scope of access for HR/Sub-admin
    scope: {
      type: String,
      enum: ['global', 'restricted'],
      default: 'global', // Defaults to global for backward compatibility, but UI should enforce selection
    },
    roles: [
      {
        type: String,
        enum: ['super_admin', 'sub_admin', 'hr', 'manager', 'hod', 'employee'],
      },
    ], // Multi-role support
    employeeId: {
      type: String,
      unique: true,
      sparse: true, // Allow null values but enforce uniqueness when present
    }, // Link to MSSQL employee data
    employeeRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      default: null,
    }, // Link to MongoDB employee
    dataScope: {
      type: String,
      enum: ['own', 'department', 'departments', 'division', 'divisions', 'group', 'groups', 'all'],
      default: function () {
        switch (this.role) {
          case 'employee': return 'own';
          case 'hod': return 'department';
          case 'manager': return 'division';
          case 'hr': return 'divisions';
          case 'sub_admin': return 'all';
          case 'super_admin': return 'all';
          default: return 'own';
        }
      }
    }, // Data access scope
    divisionMapping: [
      {
        division: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Division',
        },
        departments: [
          {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Department',
          }
        ] // If empty, means 'All Departments' in this division
      }
    ],
    groupMapping: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmployeeGroup',
      }
    ],
    preferences: {
      language: {
        type: String,
        default: 'en',
      },
      timezone: String,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Profile photo URL (S3). Used when user has no linked employee (employeeRef).
    profilePhoto: {
      type: String,
      trim: true,
      default: null,
    },
    lastLogin: {
      type: Date,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    featureControl: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
userSchema.pre('save', async function () {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) {
    return;
  }

  // Check if password is already a bcrypt hash (starts with $2a$ or $2b$)
  // This is important when inheriting hashed passwords from Employee
  if (this.password && /^\$2[aby]\$\d+\$.{53}$/.test(this.password)) {
    console.log(`[UserModel] Password for ${this.email} already hashed, skipping.`);
    return;
  }

  // Hash password with cost of 12
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Remove password from JSON output
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.models.User || mongoose.model('User', userSchema);

