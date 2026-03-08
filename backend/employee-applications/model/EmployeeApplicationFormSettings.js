/**
 * Employee Application Form Settings Model
 * Stores dynamic form configuration for employee applications
 */

const mongoose = require('mongoose');

/** Predefined qualification table columns – org can enable/disable or delete. S.No is UI-only (row index), not stored. */
function getDefaultQualificationFields() {
  return [];
}

const FieldSchema = new mongoose.Schema(
  {
    // Field identifier (unique within group)
    id: {
      type: String,
      required: true,
      trim: true,
    },

    // Display label (editable)
    label: {
      type: String,
      required: true,
      trim: true,
    },

    // Field type: text, textarea, number, date, select, multiselect, email, tel, file, array, object, userselect
    type: {
      type: String,
      enum: ['text', 'textarea', 'number', 'date', 'select', 'multiselect', 'email', 'tel', 'file', 'array', 'object', 'userselect'],
      required: true,
    },

    // Data storage type: string, number, date, array, object, mixed
    dataType: {
      type: String,
      enum: ['string', 'number', 'date', 'array', 'object', 'mixed'],
      required: true,
    },

    // Is this field required
    isRequired: {
      type: Boolean,
      default: false,
    },

    // Is this a system field (cannot be deleted/modified)
    isSystem: {
      type: Boolean,
      default: false,
    },

    // Placeholder text
    placeholder: {
      type: String,
      default: '',
    },

    // Default value
    defaultValue: mongoose.Schema.Types.Mixed,

    // Validation rules
    validation: {
      pattern: String, // Regex pattern
      minLength: Number,
      maxLength: Number,
      min: Number,
      max: Number,
      custom: String, // Custom validation message
    },

    // Options for select/multiselect fields
    options: [
      {
        label: String,
        value: String,
      },
    ],

    // For array fields: item type configuration
    itemType: {
      type: String,
      enum: ['string', 'number', 'object'],
      default: 'string',
    },

    // For array of objects: nested field schema
    itemSchema: {
      fields: [
        {
          id: String,
          label: String,
          type: String,
          dataType: String,
          isRequired: Boolean,
          validation: mongoose.Schema.Types.Mixed,
          options: [mongoose.Schema.Types.Mixed],
        },
      ],
    },

    // Array constraints
    minItems: {
      type: Number,
      default: 0,
    },
    maxItems: {
      type: Number,
      default: null,
    },

    // Date format (for date fields)
    dateFormat: {
      type: String,
      default: 'dd-mm-yyyy',
    },

    // Sort order within group
    order: {
      type: Number,
      default: 0,
    },

    // Is field enabled
    isEnabled: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

const GroupSchema = new mongoose.Schema(
  {
    // Group identifier
    id: {
      type: String,
      required: true,
      trim: true,
    },

    // Display label
    label: {
      type: String,
      required: true,
      trim: true,
    },

    // Description
    description: {
      type: String,
      default: '',
    },

    // Is this a system group (cannot be deleted)
    isSystem: {
      type: Boolean,
      default: false,
    },

    // Is this group an array (contains multiple entries)
    isArray: {
      type: Boolean,
      default: false,
    },

    // Fields in this group
    fields: [FieldSchema],

    // Sort order
    order: {
      type: Number,
      default: 0,
    },

    // Is group enabled
    isEnabled: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

const EmployeeApplicationFormSettingsSchema = new mongoose.Schema(
  {
    // Version for migration tracking
    version: {
      type: Number,
      default: 1,
    },

    // Field groups
    groups: [GroupSchema],

    // Is this configuration active
    isActive: {
      type: Boolean,
      default: true,
    },

    // Last updated by
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    // Qualifications Configuration (Special hardcoded field)
    qualifications: {
      // Enable/disable qualifications feature
      isEnabled: {
        type: Boolean,
        default: true,
      },
      // Enable certificate upload for qualifications
      enableCertificateUpload: {
        type: Boolean,
        default: false,
      },
      // Fields within each qualification object
      fields: [
        {
          id: { type: String, required: true, trim: true },
          label: { type: String, required: true, trim: true },
          type: { type: String, enum: ['text', 'textarea', 'number', 'date', 'select', 'boolean'], required: true },
          isRequired: { type: Boolean, default: false },
          isEnabled: { type: Boolean, default: true },
          placeholder: { type: String, default: '' },
          validation: { minLength: Number, maxLength: Number, min: Number, max: Number },
          options: [{ label: String, value: String }],
          order: { type: Number, default: 0 },
        },
      ],
      // Pre-filled rows set by super admin; shown read-only on application form (applicants cannot modify)
      defaultRows: {
        type: [mongoose.Schema.Types.Mixed],
        default: [],
      },
    },
  },
  {
    timestamps: true,
  }
);

// Index
EmployeeApplicationFormSettingsSchema.index({ isActive: 1 });

// Static method to get active settings
EmployeeApplicationFormSettingsSchema.statics.getActiveSettings = async function () {
  return this.findOne({ isActive: true }).sort({ createdAt: -1 });
};

// Predefined qualification table columns (for merge on getSettings)
EmployeeApplicationFormSettingsSchema.statics.getDefaultQualificationFields = getDefaultQualificationFields;

// Static method to initialize default settings
EmployeeApplicationFormSettingsSchema.statics.initializeDefault = async function (userId) {
  const defaultSettings = {
    version: 1,
    isActive: true,
    updatedBy: userId,
    groups: [
      // Basic Information (System Group)
      {
        id: 'basic_info',
        label: 'Basic Information',
        description: 'Core employee information',
        isSystem: true,
        isArray: false,
        order: 1,
        isEnabled: true,
        fields: [
          {
            id: 'emp_no',
            label: 'Employee No',
            type: 'text',
            dataType: 'string',
            isRequired: true,
            isSystem: true,
            placeholder: 'E.g., EMP001',
            validation: { minLength: 1, maxLength: 20 },
            order: 1,
            isEnabled: true,
          },
          {
            id: 'employee_name',
            label: 'Employee Name',
            type: 'text',
            dataType: 'string',
            isRequired: true,
            isSystem: true,
            placeholder: 'Full Name',
            validation: { minLength: 2, maxLength: 100 },
            order: 2,
            isEnabled: true,
          },
          {
            id: 'division_id',
            label: 'Division',
            type: 'select',
            dataType: 'string',
            isRequired: true,
            isSystem: true,
            placeholder: 'Select Division',
            order: 3,
            isEnabled: true,
          },
          {
            id: 'department_id',
            label: 'Department',
            type: 'select',
            dataType: 'string',
            isRequired: false,
            isSystem: true,
            placeholder: 'Select Department',
            order: 4,
            isEnabled: true,
          },
          {
            id: 'designation_id',
            label: 'Designation',
            type: 'select',
            dataType: 'string',
            isRequired: false,
            isSystem: true,
            placeholder: 'Select Designation',
            order: 5,
            isEnabled: true,
          },
          {
            id: 'doj',
            label: 'Date of Joining',
            type: 'date',
            dataType: 'date',
            isRequired: false,
            isSystem: true,
            dateFormat: 'dd-mm-yyyy',
            order: 6,
            isEnabled: true,
          },
          {
            id: 'proposedSalary',
            label: 'Proposed Salary',
            type: 'number',
            dataType: 'number',
            isRequired: true,
            isSystem: true,
            placeholder: '0.00',
            validation: { min: 0 },
            order: 7,
            isEnabled: true,
          },
          {
            id: 'second_salary',
            label: 'Second Salary',
            type: 'number',
            dataType: 'number',
            isRequired: false,
            isSystem: true,
            placeholder: '0.00',
            validation: { min: 0 },
            order: 8,
            isEnabled: true,
          },
        ],
      },
      // Personal Information (System Group)
      {
        id: 'personal_info',
        label: 'Personal Information',
        description: 'Personal details',
        isSystem: true,
        isArray: false,
        order: 2,
        isEnabled: true,
        fields: [
          {
            id: 'dob',
            label: 'Date of Birth',
            type: 'date',
            dataType: 'date',
            isRequired: false,
            isSystem: true,
            dateFormat: 'dd-mm-yyyy',
            order: 1,
            isEnabled: true,
          },
          {
            id: 'gender',
            label: 'Gender',
            type: 'select',
            dataType: 'string',
            isRequired: false,
            isSystem: true,
            options: [
              { label: 'Male', value: 'Male' },
              { label: 'Female', value: 'Female' },
              { label: 'Other', value: 'Other' },
            ],
            order: 2,
            isEnabled: true,
          },
          {
            id: 'marital_status',
            label: 'Marital Status',
            type: 'select',
            dataType: 'string',
            isRequired: false,
            isSystem: true,
            options: [
              { label: 'Single', value: 'Single' },
              { label: 'Married', value: 'Married' },
              { label: 'Divorced', value: 'Divorced' },
              { label: 'Widowed', value: 'Widowed' },
            ],
            order: 3,
            isEnabled: true,
          },
          {
            id: 'blood_group',
            label: 'Blood Group',
            type: 'select',
            dataType: 'string',
            isRequired: false,
            isSystem: true,
            options: [
              { label: 'A+', value: 'A+' },
              { label: 'A-', value: 'A-' },
              { label: 'B+', value: 'B+' },
              { label: 'B-', value: 'B-' },
              { label: 'AB+', value: 'AB+' },
              { label: 'AB-', value: 'AB-' },
              { label: 'O+', value: 'O+' },
              { label: 'O-', value: 'O-' },
            ],
            order: 4,
            isEnabled: true,
          },
        ],
      },
      // Contact Information (System Group)
      {
        id: 'contact_info',
        label: 'Contact Information',
        description: 'Contact details',
        isSystem: true,
        isArray: false,
        order: 3,
        isEnabled: true,
        fields: [
          {
            id: 'phone_number',
            label: 'Contact Number',
            type: 'tel',
            dataType: 'string',
            isRequired: true,
            isSystem: true,
            validation: { maxLength: 15 },
            order: 1,
            isEnabled: true,
          },
          {
            id: 'email',
            label: 'Email',
            type: 'email',
            dataType: 'string',
            isRequired: false,
            isSystem: true,
            placeholder: 'example@email.com',
            order: 2,
            isEnabled: true,
          },
        ],
      },
      // Bank Details (System Group)
      {
        id: 'bank_details',
        label: 'Bank Details',
        description: 'Banking information',
        isSystem: true,
        isArray: false,
        order: 4,
        isEnabled: true,
        fields: [
          {
            id: 'bank_account_no',
            label: 'Bank A/C No',
            type: 'text',
            dataType: 'string',
            isRequired: false,
            isSystem: true,
            order: 1,
            isEnabled: true,
          },
          {
            id: 'bank_name',
            label: 'Bank Name',
            type: 'text',
            dataType: 'string',
            isRequired: false,
            isSystem: true,
            order: 2,
            isEnabled: true,
          },
          {
            id: 'bank_place',
            label: 'Bank Place',
            type: 'text',
            dataType: 'string',
            isRequired: false,
            isSystem: true,
            order: 3,
            isEnabled: true,
          },
          {
            id: 'ifsc_code',
            label: 'IFSC Code',
            type: 'text',
            dataType: 'string',
            isRequired: false,
            isSystem: true,
            order: 4,
            isEnabled: true,
          },
          {
            id: 'salary_mode',
            label: 'Salary Mode',
            type: 'select',
            dataType: 'string',
            isRequired: true,
            isSystem: true,
            defaultValue: 'Bank',
            options: [
              { label: 'Bank', value: 'Bank' },
              { label: 'Cash', value: 'Cash' },
            ],
            order: 5,
            isEnabled: true,
          },
        ],
      },
      // Reporting Authority (System Group - Optional)
      {
        id: 'reporting_authority',
        label: 'Reporting Authority',
        description: 'Reporting manager information',
        isSystem: true,
        isArray: false,
        order: 5,
        isEnabled: true,
        fields: [
          {
            id: 'reporting_to',
            label: 'Reporting To',
            type: 'userselect',
            dataType: 'array',
            isRequired: false, // Changed from true - not required by default
            isSystem: true,
            placeholder: 'Select reporting manager(s)',
            validation: { minItems: 0, maxItems: 2 },
            order: 1,
            isEnabled: true,
          },
        ],
      },
    ],
    // Default Qualifications Configuration – table-like columns (predefined)
    qualifications: {
      isEnabled: true,
      enableCertificateUpload: false,
      fields: [],
      defaultRows: [],
    },
  };

  // Check if settings already exist
  const existing = await this.findOne({ isActive: true });
  if (existing) {
    return existing;
  }

  return this.create(defaultSettings);
};

module.exports = mongoose.models.EmployeeApplicationFormSettings || mongoose.model('EmployeeApplicationFormSettings', EmployeeApplicationFormSettingsSchema);

