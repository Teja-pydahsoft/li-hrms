/**
 * Form Validation Service
 * Validates employee application form data based on form settings
 */

const EmployeeApplicationFormSettings = require('../model/EmployeeApplicationFormSettings');

/**
 * Validate form data against form settings
 * @param {Object} formData - Form data to validate
 * @param {Object} settings - Form settings (optional, will fetch if not provided)
 * @returns {Object} { isValid: boolean, errors: Object }
 */
exports.validateFormData = async (formData, settings = null) => {
  try {
    // Get settings if not provided
    if (!settings) {
      settings = await EmployeeApplicationFormSettings.getActiveSettings();
      if (!settings) {
        return {
          isValid: false,
          errors: { _general: 'Form settings not found. Please initialize settings first.' },
        };
      }
    }

    const errors = {};
    const permanentFieldIds = [
      'emp_no',
      'employee_name',
      'division_id',
      'department_id',
      'designation_id',
      'doj',
      'dob',
      'gender',
      'marital_status',
      'blood_group',
      'phone_number',
      'bank_account_no',
      'bank_name',
      'bank_place',
      'ifsc_code',
    ];

    // Validate all groups
    for (const group of settings.groups) {
      if (!group.isEnabled) continue;

      for (const field of group.fields) {
        if (!field.isEnabled) continue;

        const fieldId = field.id;
        const value = formData[fieldId];

        // Check required fields
        if (field.isRequired) {
          if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
            errors[fieldId] = `${field.label} is required`;
            continue;
          }
        }

        // Skip validation if field is empty and not required
        if (value === undefined || value === null || value === '') {
          continue;
        }

        // Validate based on field type
        const fieldError = validateField(field, value, formData);
        if (fieldError) {
          errors[fieldId] = fieldError;
        }
      }
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors,
    };
  } catch (error) {
    console.error('Error validating form data:', error);
    return {
      isValid: false,
      errors: { _general: 'Validation error: ' + error.message },
    };
  }
};

/**
 * Validate a single field
 * @param {Object} field - Field configuration
 * @param {*} value - Field value
 * @param {Object} formData - Complete form data (for context)
 * @returns {string|null} Error message or null if valid
 */
function validateField(field, value, formData) {
  const { type, dataType, validation, options, itemType, itemSchema, minItems, maxItems } = field;

  // Type-specific validation
  switch (type) {
    case 'text':
    case 'textarea':
      if (dataType === 'string') {
        const valStr = String(value);
        if (validation) {
          if (validation.minLength && valStr.length < validation.minLength) {
            return `${field.label} must be at least ${validation.minLength} characters`;
          }
          if (validation.maxLength && valStr.length > validation.maxLength) {
            return `${field.label} must be at most ${validation.maxLength} characters`;
          }
          if (validation.pattern) {
            const regex = new RegExp(validation.pattern);
            if (!regex.test(valStr)) {
              return validation.custom || `${field.label} format is invalid`;
            }
          }
        }
      }
      break;

    case 'number':
      if (dataType === 'number') {
        const numValue = typeof value === 'string' ? parseFloat(value) : value;
        if (isNaN(numValue)) {
          return `${field.label} must be a number`;
        }
        if (validation) {
          if (validation.min !== undefined && numValue < validation.min) {
            return `${field.label} must be at least ${validation.min}`;
          }
          if (validation.max !== undefined && numValue > validation.max) {
            return `${field.label} must be at most ${validation.max}`;
          }
        }
      }
      break;

    case 'date':
      if (dataType === 'date') {
        const dateValue = value instanceof Date ? value : new Date(value);
        if (isNaN(dateValue.getTime())) {
          return `${field.label} must be a valid date`;
        }
      }
      break;

    case 'email':
      if (dataType === 'string') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
          return `${field.label} must be a valid email address`;
        }
      }
      break;

    case 'tel':
      if (dataType === 'string') {
        const phoneRegex = /^[0-9+\-\s()]+$/;
        const valStr = String(value);
        if (!phoneRegex.test(valStr)) {
          return `${field.label} must be a valid phone number`;
        }
        if (validation) {
          const digitsOnly = valStr.replace(/[^0-9]/g, '');
          if (validation.minLength && digitsOnly.length < validation.minLength) {
            return `${field.label} must be at least ${validation.minLength} digits`;
          }
          if (validation.maxLength && digitsOnly.length > validation.maxLength) {
            return `${field.label} must be at most ${validation.maxLength} digits`;
          }
        }
      }
      break;

    case 'select':
      if (dataType === 'string' && options && options.length > 0) {
        const validValues = options.map((opt) => opt.value);
        if (!validValues.includes(value)) {
          return `${field.label} must be one of the allowed values`;
        }
      }
      break;

    case 'multiselect':
      if (dataType === 'array' && Array.isArray(value)) {
        if (options && options.length > 0) {
          const validValues = options.map((opt) => opt.value);
          const invalidValues = value.filter((v) => !validValues.includes(v));
          if (invalidValues.length > 0) {
            return `${field.label} contains invalid values`;
          }
        }
      } else {
        return `${field.label} must be an array`;
      }
      break;

    case 'array':
      if (!Array.isArray(value)) {
        return `${field.label} must be an array`;
      }

      // Check array constraints
      if (minItems !== undefined && value.length < minItems) {
        return `${field.label} must have at least ${minItems} items`;
      }
      if (maxItems !== undefined && value.length > maxItems) {
        return `${field.label} must have at most ${maxItems} items`;
      }

      // Validate array items
      if (itemType === 'object' && itemSchema && itemSchema.fields) {
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          if (typeof item !== 'object' || Array.isArray(item)) {
            return `${field.label}[${i}] must be an object`;
          }

          // Validate nested fields
          for (const nestedField of itemSchema.fields) {
            const nestedValue = item[nestedField.id];
            if (nestedField.isRequired && (nestedValue === undefined || nestedValue === null || nestedValue === '')) {
              return `${field.label}[${i}].${nestedField.label} is required`;
            }
            if (nestedValue !== undefined && nestedValue !== null && nestedValue !== '') {
              const nestedError = validateField(nestedField, nestedValue, item);
              if (nestedError) {
                return `${field.label}[${i}].${nestedError}`;
              }
            }
          }
        }
      } else if (itemType === 'string') {
        for (let i = 0; i < value.length; i++) {
          if (typeof value[i] !== 'string') {
            return `${field.label}[${i}] must be a string`;
          }
        }
      } else if (itemType === 'number') {
        for (let i = 0; i < value.length; i++) {
          const numValue = typeof value[i] === 'string' ? parseFloat(value[i]) : value[i];
          if (isNaN(numValue)) {
            return `${field.label}[${i}] must be a number`;
          }
        }
      }
      break;

    case 'object':
      if (dataType === 'object' && itemSchema && itemSchema.fields) {
        if (typeof value !== 'object' || Array.isArray(value)) {
          return `${field.label} must be an object`;
        }

        // Validate nested fields
        for (const nestedField of itemSchema.fields) {
          const nestedValue = value[nestedField.id];
          if (nestedField.isRequired && (nestedValue === undefined || nestedValue === null || nestedValue === '')) {
            return `${field.label}.${nestedField.label} is required`;
          }
          if (nestedValue !== undefined && nestedValue !== null && nestedValue !== '') {
            const nestedError = validateField(nestedField, nestedValue, value);
            if (nestedError) {
              return `${field.label}.${nestedError}`;
            }
          }
        }
      }
      break;
  }

  return null;
}

/**
 * Transform form data: separate permanent fields from dynamic fields
 * @param {Object} formData - Complete form data
 * @param {Object} settings - Form settings
 * @returns {Object} { permanentFields: Object, dynamicFields: Object }
 */
exports.transformFormData = (formData, settings) => {
  const permanentFieldIds = [
    'emp_no',
    'employee_name',
    'division_id',
    'department_id',
    'designation_id',
    'proposedSalary',
    'doj',
    'dob',
    'gender',
    'marital_status',
    'blood_group',
    'phone_number',
    'alt_phone_number',
    'email',
    'address',
    'location',
    'aadhar_number',
    'qualifications',
    'experience',
    'pf_number',
    'esi_number',
    'bank_account_no',
    'bank_name',
    'bank_place',
    'ifsc_code',
    'applyProfessionTax',
    'applyESI',
    'applyPF',
    'applyAttendanceDeduction',
    'deductLateIn',
    'deductEarlyOut',
    'deductPermission',
    'deductAbsent',
  ];

  const permanentFields = {};
  const dynamicFields = {};

  // Get all field IDs from settings
  const allFieldIds = new Set(permanentFieldIds);
  if (settings && settings.groups) {
    for (const group of settings.groups) {
      for (const field of group.fields) {
        allFieldIds.add(field.id);
      }
    }
  }

  // Separate permanent and dynamic fields
  for (const key in formData) {
    if (permanentFieldIds.includes(key)) {
      permanentFields[key] = formData[key];
    } else if (allFieldIds.has(key)) {
      // This is a configured field but not permanent
      dynamicFields[key] = formData[key];
    } else {
      // Unknown field - add to dynamicFields
      dynamicFields[key] = formData[key];
    }
  }

  return { permanentFields, dynamicFields };
};

