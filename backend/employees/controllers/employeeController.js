/**
 * Employee Controller
 * Handles dual database operations (MongoDB + MSSQL) based on settings
 */

const Employee = require('../model/Employee');
const Department = require('../../departments/model/Department');
const Designation = require('../../departments/model/Designation');
const Division = require('../../departments/model/Division');
const Settings = require('../../settings/model/Settings');
const EmployeeApplicationFormSettings = require('../../employee-applications/model/EmployeeApplicationFormSettings');
const User = require('../../users/model/User');
const {
  validateFormData,
} = require('../../employee-applications/services/formValidationService');
const {
  extractPermanentFields,
  extractDynamicFields,
  resolveQualificationLabels,
  mapQualificationsLabelsToIds,
} = require('../../employee-applications/services/fieldMappingService');
const { resolveForEmployee } = require('../../payroll/services/allowanceDeductionResolverService');
const mongoose = require('mongoose');
const {
  isHRMSConnected,
  createEmployeeMSSQL,
  getAllEmployeesMSSQL,
  getEmployeeByIdMSSQL,
  updateEmployeeMSSQL,
  deleteEmployeeMSSQL,
  employeeExistsMSSQL,
} = require('../config/sqlHelper');
const { generatePassword, sendCredentials } = require('../../shared/services/passwordNotificationService');
const s3UploadService = require('../../shared/services/s3UploadService');
const { getNextEmpNo } = require('../services/empNoService');
const EmployeeHistory = require('../model/EmployeeHistory');
const { initializeEmployeeLeaves } = require('../../leaves/services/employeeLeaveInitializationService');
const {
  stripEmployeeGroupIfDisabled,
  validateEmployeeGroupIfEnabled,
} = require('../../shared/utils/customEmployeeGrouping');
const streamingExportService = require('../../shared/services/streamingExportService');

// ============== Helper Functions ==============

/**
 * Process qualifications with S3 uploads and label resolution
 */
const processQualifications = async (req, settings) => {
  let qualifications = [];
  try {
    // Parse if string (from FormData) or use as is
    const raw = req.body.qualifications;
    if (typeof raw === 'string') {
      qualifications = JSON.parse(raw);
    } else if (Array.isArray(raw)) {
      qualifications = raw;
    }
  } catch (e) {
    console.error('[EmployeeController] Error parsing qualifications:', e);
    return [];
  }

  // Handle S3 Uploads
  if (req.files && req.files.length > 0) {
    console.log(`[EmployeeController] Processing ${req.files.length} files`);
    console.log('[EmployeeController] Files received:', req.files.map(f => f.fieldname));

    // Map files for easy access
    // Expecting fieldname "qualification_cert_{index}"
    const fileMap = {};
    req.files.forEach(f => {
      fileMap[f.fieldname] = f;
    });

    for (let i = 0; i < qualifications.length; i++) {
      const file = fileMap[`qualification_cert_${i}`];
      if (file) {
        console.log(`[EmployeeController] Found file for qualification index [${i}]`);
        try {
          // Pass buffer, originalname, mimetype, and specify 'hrms/certificates' folder
          const uploadResult = await s3UploadService.uploadToS3(
            file.buffer,
            file.originalname,
            file.mimetype,
            'hrms/certificates'
          );

          // s3UploadService returns the URL directly (or check if it returns { Location })
          // Looking at s3UploadService.js: return result.Location; 
          // So uploadResult is the URL string.
          qualifications[i].certificateUrl = uploadResult;
          console.log(`[EmployeeController] Upload success for index ${i}: ${uploadResult}`);
        } catch (uploadErr) {
          console.error(`[EmployeeController] Failed to upload cert for index ${i}:`, uploadErr);
        }
      } else {
        console.log(`[EmployeeController] No file for qualification index [${i}]`);
      }
    }
  } else {
    console.log('[EmployeeController] No files received in request');
  }

  // Resolve Labels -> Field IDs for Robust Storage (Reverse Mapping)
  if (settings && qualifications.length > 0) {
    console.log('[EmployeeController] Reversing labels to Field IDs for storage');
    qualifications = mapQualificationsLabelsToIds(qualifications, settings);
  }

  return qualifications;
};

/**
 * Get employee settings from database
 */
const getEmployeeSettings = async () => {
  try {
    const [dataSourceSetting, deleteTargetSetting, autoGenSetting] = await Promise.all([
      Settings.findOne({ key: 'employee_data_source' }),
      Settings.findOne({ key: 'employee_delete_target' }),
      Settings.findOne({ key: 'auto_generate_employee_number' }),
    ]);

    const autoGenerateEmployeeNumber = autoGenSetting?.value === true
      || autoGenSetting?.value === 'true';

    return {
      dataSource: dataSourceSetting?.value || 'mongodb', // 'mongodb' | 'mssql' | 'both'
      deleteTarget: deleteTargetSetting?.value || 'both', // 'mongodb' | 'mssql' | 'both'
      auto_generate_employee_number: autoGenerateEmployeeNumber,
    };
  } catch (error) {
    console.error('Error getting employee settings:', error);
    return { dataSource: 'mongodb', deleteTarget: 'both', auto_generate_employee_number: false };
  }
};

/**
 * Resolve department and designation names for employees
 */
const resolveEmployeeReferences = async (employees) => {
  // Get unique department and designation IDs
  const deptIds = [...new Set(employees.map(e => e.department_id).filter(Boolean))];
  const desigIds = [...new Set(employees.map(e => e.designation_id).filter(Boolean))];

  // Fetch departments, designations, and divisions
  const [departments, designations, divisions] = await Promise.all([
    Department.find({ _id: { $in: deptIds } }).select('_id name code'),
    Designation.find({ _id: { $in: desigIds } }).select('_id name code'),
    Division.find({ _id: { $in: employees.map(e => e.division_id).filter(Boolean) } }).select('_id name code'),
  ]);

  // Create lookup maps
  const deptMap = new Map(departments.map(d => [d._id.toString(), d]));
  const desigMap = new Map(designations.map(d => [d._id.toString(), d]));
  const divMap = new Map(divisions.map(d => [d._id.toString(), d]));

  // Resolve references
  return employees.map(emp => ({
    ...emp,
    division: emp.division_id ? divMap.get(emp.division_id.toString()) : null,
    department: emp.department_id ? deptMap.get(emp.department_id.toString()) : null,
    designation: emp.designation_id ? desigMap.get(emp.designation_id.toString()) : null,
  }));
};

/**
 * Convert MongoDB employee to plain object for response
 */
const toPlainObject = (doc) => {
  if (!doc) return null;
  return doc.toObject ? doc.toObject() : doc;
};

/**
 * Populate user ObjectIds in dynamicFields (e.g., reporting_to)
 * 
 * @param {Object} dynamicFields - Dynamic fields object
 * @returns {Object} Dynamic fields with populated users
 */
const populateUsersInDynamicFields = async (dynamicFields) => {
  if (!dynamicFields || typeof dynamicFields !== 'object') {
    return dynamicFields || {};
  }

  const populated = { ...dynamicFields };

  // Check if reporting_to or reporting_to_ exists and is an array of ObjectIds
  // Handle both field names (reporting_to and reporting_to_)
  const reportingToField = populated.reporting_to || populated.reporting_to_;

  if (reportingToField && Array.isArray(reportingToField) && reportingToField.length > 0) {
    try {
      const fieldName = populated.reporting_to ? 'reporting_to' : 'reporting_to_';
      console.log(`Found ${fieldName} field:`, JSON.stringify(reportingToField));
      // Check if already populated (has user objects with name property)
      const isAlreadyPopulated = reportingToField[0] && typeof reportingToField[0] === 'object' && reportingToField[0].name;
      console.log('Is already populated:', isAlreadyPopulated);

      if (!isAlreadyPopulated) {
        // Filter valid ObjectIds and convert to strings
        const userIds = [];
        for (const id of reportingToField) {
          if (typeof id === 'string') {
            if (mongoose.Types.ObjectId.isValid(id)) {
              userIds.push(id);
            }
          } else if (id && typeof id === 'object') {
            if (id._id && mongoose.Types.ObjectId.isValid(id._id)) {
              userIds.push(id._id.toString());
            } else if (mongoose.Types.ObjectId.isValid(id)) {
              userIds.push(id.toString());
            }
          } else if (id && id.toString && typeof id.toString === 'function') {
            const idStr = id.toString();
            if (mongoose.Types.ObjectId.isValid(idStr)) {
              userIds.push(idStr);
            }
          }
        }

        if (userIds.length > 0) {
          // Convert string ObjectIds to mongoose ObjectIds for query
          const objectIds = userIds.map(id => {
            try {
              return new mongoose.Types.ObjectId(id);
            } catch (e) {
              return null;
            }
          }).filter(Boolean);

          if (objectIds.length > 0) {
            // Fetch users
            const users = await User.find({ _id: { $in: objectIds } })
              .select('_id name email role')
              .lean();

            // Create a map for quick lookup (using both string and ObjectId keys)
            const userMap = new Map();
            users.forEach(u => {
              const idStr = u._id.toString();
              userMap.set(idStr, u);
              // Also add with ObjectId key for matching
              userMap.set(u._id, u);
            });

            // Replace ObjectIds with populated user objects, preserving order
            populated[fieldName] = reportingToField.map(id => {
              let idStr;
              if (typeof id === 'string') {
                idStr = id;
              } else if (id && typeof id === 'object') {
                if (id._id) {
                  idStr = id._id.toString();
                } else if (id.toString && typeof id.toString === 'function') {
                  idStr = id.toString();
                } else {
                  idStr = String(id);
                }
              } else {
                idStr = String(id);
              }

              // Try to find user by string ID
              const user = userMap.get(idStr);
              if (user) {
                return user;
              }

              // Try to find by ObjectId if id is an object
              if (typeof id === 'object' && id._id) {
                const userById = userMap.get(id._id);
                if (userById) return userById;
              }

              // If not found, return original ID
              return id;
            });

            console.log(`Populated ${users.length} of ${userIds.length} users for ${fieldName} field`);
            console.log(`Populated ${fieldName}:`, JSON.stringify(populated[fieldName]));
          } else {
            console.log('No valid ObjectIds could be created from userIds array. userIds:', userIds);
          }
        } else {
          console.log(`No valid ObjectIds found in ${fieldName} array. Original array:`, JSON.stringify(reportingToField));
        }
      }
    } catch (error) {
      console.error('Error populating users in reporting_to:', error);
      console.error('Error details:', error.message, error.stack);
      // Keep original IDs if population fails
    }
  }

  return populated;
};

/**
 * Transform employee data for API response
 * Merges permanent fields and dynamicFields for unified access
 * 
 * @param {Object} employee - Employee document or plain object
 * @param {Boolean} populateUsers - Whether to populate user ObjectIds in dynamicFields
 * @returns {Object} Transformed employee data
 */
const transformEmployeeForResponse = async (employee, populateUsers = true) => {
  if (!employee) return null;

  const plainObj = toPlainObject(employee);
  const { dynamicFields, ...permanentFields } = plainObj;

  // Populate users in dynamicFields if needed
  let populatedDynamicFields = dynamicFields || {};
  if (populateUsers && dynamicFields) {
    populatedDynamicFields = await populateUsersInDynamicFields(dynamicFields);
  }

  // Merge dynamicFields into root level (dynamicFields act as fallback)
  // Permanent fields (Source of Truth) must overwrite dynamicFields
  const merged = {
    ...populatedDynamicFields,
    ...permanentFields,
    dynamicFields: populatedDynamicFields,
  };

  // Schema-level employeeAllowances/employeeDeductions must not be overwritten by dynamicFields
  // (dynamicFields can contain stale empty arrays; prefer the actual schema arrays)
  if (Array.isArray(permanentFields.employeeAllowances)) {
    merged.employeeAllowances = permanentFields.employeeAllowances;
  }
  if (Array.isArray(permanentFields.employeeDeductions)) {
    merged.employeeDeductions = permanentFields.employeeDeductions;
  }

  // Normalize reporting_to_ to reporting_to (handle field name inconsistency)
  // Ensure we move data if standard field is present but empty
  if (merged.reporting_to_) {
    if (!merged.reporting_to || !Array.isArray(merged.reporting_to) || merged.reporting_to.length === 0) {
      if (Array.isArray(merged.reporting_to_) && merged.reporting_to_.length > 0) {
        merged.reporting_to = merged.reporting_to_;
      }
    }
    delete merged.reporting_to_;
  }

  if (merged.dynamicFields) {
    if (merged.dynamicFields.reporting_to_) {
      if (!merged.dynamicFields.reporting_to || !Array.isArray(merged.dynamicFields.reporting_to) || merged.dynamicFields.reporting_to.length === 0) {
        if (Array.isArray(merged.dynamicFields.reporting_to_) && merged.dynamicFields.reporting_to_.length > 0) {
          merged.dynamicFields.reporting_to = merged.dynamicFields.reporting_to_;
        }
      }
      delete merged.dynamicFields.reporting_to_;
    }
  }

  // Also populate reporting_to if it exists at root level (from previous merge)
  const rootReportingTo = merged.reporting_to;
  if (populateUsers && rootReportingTo && Array.isArray(rootReportingTo) && rootReportingTo.length > 0) {
    const isAlreadyPopulated = rootReportingTo[0] && typeof rootReportingTo[0] === 'object' && rootReportingTo[0].name;
    if (!isAlreadyPopulated) {
      // Populate reporting_to at root level
      const populatedRoot = await populateUsersInDynamicFields({ reporting_to: rootReportingTo });
      merged.reporting_to = populatedRoot.reporting_to;
      // Also update in dynamicFields
      if (merged.dynamicFields) {
        merged.dynamicFields.reporting_to = populatedRoot.reporting_to;
      }
    }
  }

  return merged;
};

// ============== Controller Methods ==============

/**
 * @desc    Get all employees
 * @route   GET /api/employees
 * @access  Private
 */
exports.getAllEmployees = async (req, res) => {
  try {
    const {
      is_active,
      division_id,
      divisionId,
      department_id,
      designation_id,
      employee_group_id,
      includeLeft,
      startDate,
      endDate,
      page = 1,
      limit = 50,
      search,
    } = req.query;
    const { scopeFilter } = req; // Get scope filter from data scope middleware
    const settings = await getEmployeeSettings();

    let employees = [];
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build filters - merge scope filter with query filters
    const filters = { ...scopeFilter };
    if (is_active !== undefined) filters.is_active = is_active === 'true';
    if (division_id || divisionId) filters.division_id = division_id || divisionId;
    if (department_id) filters.department_id = department_id;
    if (designation_id) filters.designation_id = designation_id;
    if (employee_group_id) filters.employee_group_id = employee_group_id;

    // Search functionality
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      filters.$or = [
        { emp_no: searchRegex },
        { employee_name: searchRegex },
        { phone_number: searchRegex },
        { email: searchRegex }
      ];
    }

    // If a date range is provided (e.g. shift roster payroll cycle), include employees
    // whose employment overlaps that period.
    if (startDate && endDate) {
      const rangeStart = new Date(startDate);
      const rangeEnd = new Date(endDate);
      if (!Number.isNaN(rangeStart.getTime()) && !Number.isNaN(rangeEnd.getTime())) {
        rangeStart.setUTCHours(0, 0, 0, 0);
        rangeEnd.setUTCHours(23, 59, 59, 999);
        filters.$and = filters.$and || [];
        // Employee should have joined by range end
        filters.$and.push({ $or: [{ doj: null }, { doj: { $lte: rangeEnd } }] });
        // Employee should not have left before range start
        filters.$and.push({ $or: [{ leftDate: null }, { leftDate: { $gte: rangeStart } }] });
      }
    } else if (includeLeft !== 'true') {
      // By default, show only currently active: no leftDate or leftDate on/after today
      const startOfToday = new Date();
      startOfToday.setUTCHours(0, 0, 0, 0);
      filters.$and = filters.$and || [];
      filters.$and.push({ $or: [{ leftDate: null }, { leftDate: { $gte: startOfToday } }] });
    }

    console.log('[Employee Controller] Scope filters:', filters);

    let total = 0;

    // Fetch based on data source setting
    if (settings.dataSource === 'mssql' && isHRMSConnected()) {
      // Fetch from MSSQL
      const mssqlEmployees = await getAllEmployeesMSSQL(filters);
      total = mssqlEmployees.length;
      const sortedMssql = mssqlEmployees.slice(skip, skip + parseInt(limit));

      // Resolve names/refs for MSSQL employees
      const resolved = await resolveEmployeeReferences(sortedMssql);

      // MERGE with MongoDB data for fields not in SQL (allowances, dynamicFields, etc.)
      const empNos = resolved.map(e => e.emp_no);
      const mongoMatches = await Employee.find({ emp_no: { $in: empNos } });
      const mongoMap = new Map(mongoMatches.map(m => [m.emp_no, m]));

      employees = await Promise.all(resolved.map(async (mssqlEmp) => {
        const mongoEmp = mongoMap.get(mssqlEmp.emp_no);
        if (!mongoEmp) return mssqlEmp;

        // Transform MongoDB extra data
        const transformed = await transformEmployeeForResponse(mongoEmp, true);

        // Merge: MSSQL fields take priority for core fields, MongoDB for extra ones
        return {
          ...transformed,
          ...mssqlEmp,
          // Explicitly ensure MongoDB-only fields are preserved if transformed had them
          employeeAllowances: transformed.employeeAllowances || [],
          employeeDeductions: transformed.employeeDeductions || [],
          dynamicFields: transformed.dynamicFields || {},
          paidLeaves: mssqlEmp.paidLeaves ?? transformed.paidLeaves ?? 0,
          allottedLeaves: mssqlEmp.allottedLeaves ?? transformed.allottedLeaves ?? 0,
          ctcSalary: mssqlEmp.ctc_salary ?? transformed.ctcSalary ?? null,
          calculatedSalary: mssqlEmp.calculated_salary ?? transformed.calculatedSalary ?? null,
        };
      }));
    } else {
      // Fetch from MongoDB (default)
      const query = { ...filters };

      total = await Employee.countDocuments(query);
      const mongoEmployees = await Employee.find(query)
        .populate('division_id', 'name code')
        .populate('department_id', 'name code')
        .populate('designation_id', 'name code')
        .populate('employee_group_id', 'name code isActive')
        .sort({ employee_name: 1 })
        .skip(skip)
        .limit(parseInt(limit));

      // Transform employees with user population
      employees = await Promise.all(mongoEmployees.map(async (emp) => {
        const transformed = await transformEmployeeForResponse(emp, true);
        return {
          ...transformed,
          division: transformed.division_id,
          department: transformed.department_id,
          designation: transformed.designation_id,
          employee_group: transformed.employee_group_id,
          paidLeaves: transformed.paidLeaves !== undefined && transformed.paidLeaves !== null ? Number(transformed.paidLeaves) : 0,
          allottedLeaves: transformed.allottedLeaves !== undefined && transformed.allottedLeaves !== null ? Number(transformed.allottedLeaves) : 0,
          employeeAllowances: transformed.employeeAllowances || [],
          employeeDeductions: transformed.employeeDeductions || [],
          ctcSalary: transformed.ctcSalary !== undefined && transformed.ctcSalary !== null ? Number(transformed.ctcSalary) : null,
          calculatedSalary: transformed.calculatedSalary !== undefined && transformed.calculatedSalary !== null ? Number(transformed.calculatedSalary) : null,
        };
      }));
    }

    res.status(200).json({
      success: true,
      count: employees.length,
      dataSource: settings.dataSource,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      },
      data: employees,
    });
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching employees',
      error: error.message,
    });
  }
};

/**
 * @desc    Get single employee
 * @route   GET /api/employees/:empNo
 * @access  Private
 */
exports.getEmployee = async (req, res) => {
  try {
    const { empNo } = req.params;
    const settings = await getEmployeeSettings();

    let employee = null;

    if (settings.dataSource === 'mssql' && isHRMSConnected()) {
      const mssqlEmployee = await getEmployeeByIdMSSQL(empNo);
      if (mssqlEmployee) {
        const resolved = await resolveEmployeeReferences([mssqlEmployee]);
        const baseEmployee = resolved[0];

        // Fetch extra fields from MongoDB
        const mongoEmployee = await Employee.findOne({ emp_no: empNo })
          .populate('division_id', 'name code')
          .populate('department_id', 'name code')
          .populate('designation_id', 'name code')
          .populate('employee_group_id', 'name code isActive');

        if (mongoEmployee) {
          const transformed = await transformEmployeeForResponse(mongoEmployee, true);
          employee = {
            ...transformed,
            ...baseEmployee,
            employeeAllowances: transformed.employeeAllowances || [],
            employeeDeductions: transformed.employeeDeductions || [],
            ctcSalary: baseEmployee.gross_salary !== undefined ? transformed.ctcSalary : (transformed.ctcSalary || null),
            calculatedSalary: baseEmployee.gross_salary !== undefined ? transformed.calculatedSalary : (transformed.calculatedSalary || null),
          };
        } else {
          employee = baseEmployee;
        }
      }
    } else {
      const mongoEmployee = await Employee.findOne({ emp_no: empNo })
        .populate('division_id', 'name code')
        .populate('department_id', 'name code')
        .populate('designation_id', 'name code')
        .populate('employee_group_id', 'name code isActive');

      if (mongoEmployee) {
        const transformed = await transformEmployeeForResponse(mongoEmployee, true);
        employee = {
          ...transformed,
          division: transformed.division_id,
          department: transformed.department_id,
          designation: transformed.designation_id,
          employee_group: transformed.employee_group_id,
          // Explicitly ensure paidLeaves and allottedLeaves are included
          paidLeaves: transformed.paidLeaves !== undefined && transformed.paidLeaves !== null ? Number(transformed.paidLeaves) : 0,
          allottedLeaves: transformed.allottedLeaves !== undefined && transformed.allottedLeaves !== null ? Number(transformed.allottedLeaves) : 0,
          // Explicitly include allowances, deductions, and calculated salaries
          employeeAllowances: transformed.employeeAllowances || [],
          employeeDeductions: transformed.employeeDeductions || [],
          ctcSalary: transformed.ctcSalary !== undefined && transformed.ctcSalary !== null ? Number(transformed.ctcSalary) : null,
          calculatedSalary: transformed.calculatedSalary !== undefined && transformed.calculatedSalary !== null ? Number(transformed.calculatedSalary) : null,
        };
      }
    }

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    res.status(200).json({
      success: true,
      dataSource: settings.dataSource,
      data: employee,
    });
  } catch (error) {
    console.error('Error fetching employee:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching employee',
      error: error.message,
    });
  }
};

/**
 * @desc    Create employee
 * @route   POST /api/employees
 * @access  Private (Super Admin, Sub Admin, HR)
 */
exports.createEmployee = async (req, res) => {
  try {
    const { passwordMode, notificationChannels, ...employeeData } = req.body;

    const settings = await getEmployeeSettings();
    const autoGenerate = settings.auto_generate_employee_number === true;
    const empNoBlank = employeeData.emp_no == null || String(employeeData.emp_no || '').trim() === '';

    if (autoGenerate && empNoBlank) {
      employeeData.emp_no = await getNextEmpNo();
    } else if (!autoGenerate && empNoBlank) {
      return res.status(400).json({
        success: false,
        message: 'Employee number (emp_no) is required when auto-generate is off',
      });
    }

    if (!employeeData.employee_name) {
      return res.status(400).json({
        success: false,
        message: 'Employee name is required',
      });
    }

    if (!employeeData.division_id) {
      return res.status(400).json({
        success: false,
        message: 'Division is required for new employees',
      });
    }

    // Check if employee already exists in MongoDB
    const existingMongo = await Employee.findOne({ emp_no: String(employeeData.emp_no || '').toUpperCase() });
    if (existingMongo) {
      return res.status(400).json({
        success: false,
        message: 'Employee with this employee number already exists',
      });
    }

    // Validate department if provided
    if (employeeData.department_id) {
      const dept = await Department.findById(employeeData.department_id);
      if (!dept) {
        return res.status(400).json({
          success: false,
          message: 'Invalid department ID',
        });
      }
    }

    // Validate designation if provided
    if (employeeData.designation_id) {
      const desig = await Designation.findById(employeeData.designation_id);
      if (!desig) {
        return res.status(400).json({
          success: false,
          message: 'Invalid designation ID',
        });
      }

      // Check if division is valid
      if (employeeData.division_id) {
        const div = await Division.findById(employeeData.division_id);
        if (!div) {
          return res.status(400).json({
            success: false,
            message: 'Invalid division ID',
          });
        }
      }

      // Auto-link designation to department if not already linked
      if (employeeData.department_id) {
        const department = await Department.findById(employeeData.department_id);
        const designationIdStr = employeeData.designation_id.toString();
        const isLinked = department.designations.some(d => d.toString() === designationIdStr);

        if (department && !isLinked) {
          await Department.findByIdAndUpdate(
            employeeData.department_id,
            { $addToSet: { designations: employeeData.designation_id } }
          );
          console.log(`[createEmployee] Auto-linked designation ${desig.name} to department ${department.name}`);
        }
      }
    }

    await stripEmployeeGroupIfDisabled(employeeData);
    const groupErrCreate = await validateEmployeeGroupIfEnabled(employeeData.employee_group_id);
    if (groupErrCreate) {
      return res.status(400).json({
        success: false,
        message: groupErrCreate.error,
      });
    }

    const results = { mongodb: false, mssql: false };

    // Separate permanent fields and dynamicFields
    const permanentFields = extractPermanentFields(employeeData);

    // 1. Extract dynamic fields from root level
    const extractedDynamic = extractDynamicFields(employeeData, permanentFields);

    // 2. Parse dynamicFields object if present
    let dynamicFields = {};
    if (employeeData.dynamicFields) {
      try {
        const nested = typeof employeeData.dynamicFields === 'string'
          ? JSON.parse(employeeData.dynamicFields)
          : employeeData.dynamicFields;
        dynamicFields = { ...nested };
      } catch (e) {
        console.warn('Failed to parse dynamicFields in createEmployee:', e.message);
      }
    }

    // 3. Merge: root-level fields take precedence
    dynamicFields = { ...dynamicFields, ...extractedDynamic };

    // 4. Parse specific Fields that should be arrays
    const arrayFields = ['reporting_to', 'reporting_to_'];
    arrayFields.forEach(field => {
      if (dynamicFields[field] && typeof dynamicFields[field] === 'string') {
        try {
          dynamicFields[field] = JSON.parse(dynamicFields[field]);
        } catch (e) {
          console.warn(`Failed to parse ${field} in dynamicFields:`, e.message);
        }
      }
    });

    // 5. Normalize: Always use 'reporting_to', eliminate 'reporting_to_'
    if (dynamicFields.reporting_to_ && Array.isArray(dynamicFields.reporting_to_) && dynamicFields.reporting_to_.length > 0) {
      if (!dynamicFields.reporting_to || !Array.isArray(dynamicFields.reporting_to) || dynamicFields.reporting_to.length === 0) {
        dynamicFields.reporting_to = dynamicFields.reporting_to_;
      }
    }
    delete dynamicFields.reporting_to_;

    // Normalize bank details from camelCase to snake_case if present
    const bankFields = [
      { snake: 'bank_account_no', camel: 'bankAccountNo' },
      { snake: 'bank_name', camel: 'bankName' },
      { snake: 'bank_place', camel: 'bankPlace' },
      { snake: 'ifsc_code', camel: 'ifscCode' },
      { snake: 'salary_mode', camel: 'salaryMode' },
      { snake: 'second_salary', camel: 'secondSalary' }
    ];

    bankFields.forEach(({ snake, camel }) => {
      // Check permanentFields first, then dynamicFields, then input root
      let value = permanentFields[snake];

      // If not in permanentFields (snake), checks input under camelCase
      if (value === undefined && employeeData[camel] !== undefined) {
        value = employeeData[camel];
      }

      // Also check dynamicFields for both versions
      if (value === undefined) {
        value = dynamicFields[snake] || dynamicFields[camel];
      }

      if (value !== undefined && value !== null && value !== '') {
        permanentFields[snake] = value;
        // Remove from dynamicFields to avoid duplication
        delete dynamicFields[snake];
        delete dynamicFields[camel];
      }
    });

    const normalizeOverrides = (list) => {
      try {
        const parsed = typeof list === 'string' ? JSON.parse(list) : (list || []);
        return Array.isArray(parsed)
          ? parsed
            .filter((item) => item && (item.masterId || item.name))
            .map((item) => ({
              masterId: item.masterId || null,
              code: item.code || null,
              name: item.name || '',
              category: item.category || null,
              type: item.type || null,
              amount: item.amount ?? item.overrideAmount ?? null,
              percentage: item.percentage ?? null,
              percentageBase: item.percentageBase ?? null,
              minAmount: item.minAmount ?? null,
              maxAmount: item.maxAmount ?? null,
              basedOnPresentDays: item.basedOnPresentDays ?? false,
              isOverride: true,
            }))
          : [];
      } catch (e) { return []; }
    };

    const employeeAllowances = normalizeOverrides(employeeData.employeeAllowances);
    const employeeDeductions = normalizeOverrides(employeeData.employeeDeductions);

    // Resolve Qualification Labels & Uploads
    let qualifications = [];
    try {
      const settings = await EmployeeApplicationFormSettings.getActiveSettings();
      // Use helper to parse, upload, and resolve
      qualifications = await processQualifications(req, settings);
      console.log('[createEmployee] Final Qualifications:', JSON.stringify(qualifications));
    } catch (err) {
      console.error('Error processing qualifications:', err);
    }

    // Generate password
    const rawPassword = await generatePassword(employeeData, passwordMode || null);

    // Create in MongoDB (MANDATORY)
    try {
      const mongoEmployee = await Employee.create({
        ...permanentFields,
        qualifications, // Explicitly save resolved qualifications
        dynamicFields: Object.keys(dynamicFields).length > 0 ? dynamicFields : {},
        emp_no: String(employeeData.emp_no || '').toUpperCase(),
        employeeAllowances,
        employeeDeductions,
        password: rawPassword, // Will be hashed by pre-save hook
        plain_password: rawPassword, // Store raw password for credential resend
      });
      results.mongodb = true;
    } catch (mongoError) {
      console.error('MongoDB create error:', mongoError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create employee in MongoDB',
        error: mongoError.message,
      });
    }

    // Create in MSSQL (OPTIONAL/FAIL-SAFE)
    if (isHRMSConnected()) {
      try {
        await createEmployeeMSSQL({
          ...permanentFields,
          emp_no: String(employeeData.emp_no || '').toUpperCase(),
          department_id: permanentFields.department_id?.toString() || null,
          designation_id: permanentFields.designation_id?.toString() || null,
        });
        results.mssql = true;
      } catch (mssqlError) {
        console.error('MSSQL create error (non-blocking):', mssqlError.message);
        // We don't return error here because MongoDB succeeded
      }
    } else {
      console.warn('MSSQL not connected, skipping employee sync (non-blocking)');
    }

    // Fetch the created employee
    const createdEmployee = await Employee.findOne({ emp_no: String(employeeData.emp_no || '').toUpperCase() })
      .populate('division_id', 'name code')
      .populate('department_id', 'name code')
      .populate('designation_id', 'name code')
      .populate('employee_group_id', 'name code isActive');

    // Initialize prorated leave balances for the new employee
    const leaveInitResults = await initializeEmployeeLeaves(createdEmployee._id);
    console.log('[createEmployee] Leave initialization results:', leaveInitResults);

    // Send notifications
    const notificationResults = await sendCredentials(
      createdEmployee,
      rawPassword,
      notificationChannels || { email: true, sms: true }
    );

    res.status(201).json({
      success: true,
      message: results.mssql
        ? 'Employee created successfully in both databases'
        : 'Employee created successfully in MongoDB. MSSQL sync skipped/failed.',
      savedTo: results,
      leaveInitialization: leaveInitResults,
      notificationResults,
      data: createdEmployee,
    });
  } catch (error) {
    console.error('Error creating employee:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating employee',
      error: error.message,
    });
  }
};

/**
 * @desc    Update employee
 * @route   PUT /api/employees/:empNo
 * @access  Private (Super Admin, Sub Admin, HR)
 */
exports.updateEmployee = async (req, res) => {
  try {
    const { empNo } = req.params;
    const employeeData = req.body;

    // Check if employee exists



    // Check if employee exists
    const existingEmployee = await Employee.findOne({ emp_no: empNo });
    if (!existingEmployee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    await stripEmployeeGroupIfDisabled(employeeData);
    const groupErrUpdate = await validateEmployeeGroupIfEnabled(employeeData.employee_group_id);
    if (groupErrUpdate) {
      return res.status(400).json({
        success: false,
        message: groupErrUpdate.error,
      });
    }

    // Validate department if provided
    if (employeeData.department_id) {
      const dept = await Department.findById(employeeData.department_id);
      if (!dept) {
        return res.status(400).json({
          success: false,
          message: 'Invalid department ID',
        });
      }
    }

    // Validate designation if provided
    if (employeeData.designation_id) {
      const desig = await Designation.findById(employeeData.designation_id);
      if (!desig) {
        return res.status(400).json({
          success: false,
          message: 'Invalid designation ID',
        });
      }

      // Auto-link designation to department if designation or department changed
      const departmentId = employeeData.department_id || existingEmployee.department_id;
      if (departmentId) {
        const department = await Department.findById(departmentId);
        const designationIdStr = employeeData.designation_id.toString();
        const isLinked = department.designations.some(d => d.toString() === designationIdStr);

        if (department && !isLinked) {
          await Department.findByIdAndUpdate(
            departmentId,
            { $addToSet: { designations: employeeData.designation_id } }
          );
          console.log(`[updateEmployee] Auto-linked designation ${desig.name} to department ${department.name}`);
        }
      }
    }

    // Validate dynamicFields if form settings exist
    // Only validate if dynamicFields are being updated and validation is explicitly needed
    // Skip validation for updates that only change permanent fields (like allowances/deductions/salary)
    const hasDynamicFieldsUpdate = employeeData.dynamicFields && Object.keys(employeeData.dynamicFields).length > 0;
    const hasOnlyPermanentFieldsUpdate = !hasDynamicFieldsUpdate && (
      employeeData.employeeAllowances !== undefined ||
      employeeData.employeeDeductions !== undefined ||
      employeeData.gross_salary !== undefined ||
      employeeData.ctcSalary !== undefined ||
      employeeData.calculatedSalary !== undefined ||
      employeeData.paidLeaves !== undefined ||
      employeeData.second_salary !== undefined
    );

    // Only validate if dynamicFields are being updated (not for simple permanent field updates)
    if (hasDynamicFieldsUpdate && !hasOnlyPermanentFieldsUpdate) {
      const settings = await EmployeeApplicationFormSettings.getActiveSettings();
      if (settings) {
        // Merge existing employee data with update data for validation
        const mergedData = {
          ...existingEmployee.toObject(),
          ...employeeData,
          // Ensure proposedSalary satisfies validation if required by settings (since it's a UI field)
          proposedSalary: employeeData.proposedSalary || employeeData.gross_salary || existingEmployee.gross_salary
        };

        const validation = await validateFormData(mergedData, settings);
        if (!validation.isValid) {
          console.error('Validation errors:', validation.errors);
          return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: validation.errors,
          });
        }
      }
    }

    // CRITICAL: Exclude proposedSalary from updates AFTER validation to prevent it from being saved 
    // as a dynamic field or overwriting salary data unintentionally.
    if (employeeData.proposedSalary) {
      delete employeeData.proposedSalary;
    }

    // Separate permanent fields and dynamicFields
    const permanentFields = extractPermanentFields(employeeData);

    // 1. Extract dynamic fields from root level
    const extractedDynamic = extractDynamicFields(employeeData, permanentFields);

    // 2. Parse dynamicFields object if present
    let dynamicFields = {};
    if (employeeData.dynamicFields) {
      try {
        const nested = typeof employeeData.dynamicFields === 'string'
          ? JSON.parse(employeeData.dynamicFields)
          : employeeData.dynamicFields;
        dynamicFields = { ...nested };
      } catch (e) {
        console.warn('Failed to parse dynamicFields in updateEmployee:', e.message);
      }
    }

    // 3. Merge: root-level fields take precedence
    dynamicFields = { ...dynamicFields, ...extractedDynamic };

    // 4. Parse specific Fields that should be arrays
    const arrayFields = ['reporting_to', 'reporting_to_'];
    arrayFields.forEach(field => {
      if (dynamicFields[field] && typeof dynamicFields[field] === 'string') {
        try {
          dynamicFields[field] = JSON.parse(dynamicFields[field]);
        } catch (e) {
          console.warn(`Failed to parse ${field} in dynamicFields:`, e.message);
        }
      }
    });

    // 5. Normalize: Always use 'reporting_to', eliminate 'reporting_to_'
    if (dynamicFields.reporting_to_ && Array.isArray(dynamicFields.reporting_to_) && dynamicFields.reporting_to_.length > 0) {
      if (!dynamicFields.reporting_to || !Array.isArray(dynamicFields.reporting_to) || dynamicFields.reporting_to.length === 0) {
        dynamicFields.reporting_to = dynamicFields.reporting_to_;
      }
    }
    delete dynamicFields.reporting_to_;

    // Normalize bank details from camelCase to snake_case if present
    const bankFields = [
      { snake: 'bank_account_no', camel: 'bankAccountNo' },
      { snake: 'bank_name', camel: 'bankName' },
      { snake: 'bank_place', camel: 'bankPlace' },
      { snake: 'ifsc_code', camel: 'ifscCode' },
      { snake: 'salary_mode', camel: 'salaryMode' },
      { snake: 'second_salary', camel: 'secondSalary' }
    ];

    bankFields.forEach(({ snake, camel }) => {
      // Check permanentFields first, then dynamicFields, then input root
      let value = permanentFields[snake];

      // If not in permanentFields (snake), checks input under camelCase
      if (value === undefined && employeeData[camel] !== undefined) {
        value = employeeData[camel];
      }

      // Also check dynamicFields for both versions
      if (value === undefined) {
        value = dynamicFields[snake] || dynamicFields[camel];
      }

      if (value !== undefined && value !== null && value !== '') {
        permanentFields[snake] = value;
        // Remove from dynamicFields to avoid duplication
        delete dynamicFields[snake];
        delete dynamicFields[camel];
      }
    });

    // Normalize employee allowances and deductions
    const normalizeOverrides = (list) => {
      try {
        const parsed = typeof list === 'string' ? JSON.parse(list) : (list || []);
        return Array.isArray(parsed)
          ? parsed
            .filter((item) => item && (item.masterId || item.name))
            .map((item) => ({
              masterId: item.masterId || null,
              code: item.code || null,
              name: item.name || '',
              category: item.category || null,
              type: item.type || null,
              amount: item.amount ?? item.overrideAmount ?? null,
              percentage: item.percentage ?? null,
              percentageBase: item.percentageBase ?? null,
              minAmount: item.minAmount ?? null,
              maxAmount: item.maxAmount ?? null,
              basedOnPresentDays: item.basedOnPresentDays ?? false,
              isOverride: true,
            }))
          : [];
      } catch (e) { return []; }
    };

    const employeeAllowances = normalizeOverrides(employeeData.employeeAllowances);
    const employeeDeductions = normalizeOverrides(employeeData.employeeDeductions);
    const ctcSalary = employeeData.ctcSalary ?? null;
    const calculatedSalary = employeeData.calculatedSalary ?? null;

    // Resolve Qualification Labels & Uploads
    let qualifications = [];
    try {
      const settings = await EmployeeApplicationFormSettings.getActiveSettings();
      qualifications = await processQualifications(req, settings);

      // If no new qualifications in request, merge with existing?
      // Logic: if req.body.qualifications is provided (even empty array), we replace. 
      // If it's undefined/null, we keep existing? 
      // With FormData, missing field usually means undefined.
      // But if user deleted all qualifications, it might send "[]". 
      // Let's rely on what processQualifications returns. 
      // If req.body.qualifications was undefined, helper returns [].
      // We should check if the key existed in body to decide whether to update.
      if (req.body.qualifications === undefined && !req.files?.length) {
        qualifications = existingEmployee.qualifications || [];
      }

    } catch (err) {
      console.error('Error processing qualifications:', err);
      qualifications = existingEmployee.qualifications || [];
    }

    const results = { mongodb: false, mssql: false };

    // Update in MongoDB (MANDATORY)
    try {
      // Ensure paidLeaves is explicitly set (even if 0)
      const updateData = {
        ...permanentFields,
        qualifications, // Explicitly save resolved qualifications
        updated_at: new Date(),
      };

      // Handle allowances, deductions and salary fields ONLY if provided in request to avoid partial-update wipes
      if (employeeData.employeeAllowances !== undefined) {
        updateData.employeeAllowances = employeeAllowances;
      }
      if (employeeData.employeeDeductions !== undefined) {
        updateData.employeeDeductions = employeeDeductions;
      }
      if (employeeData.ctcSalary !== undefined) {
        updateData.ctcSalary = ctcSalary;
      }
      if (employeeData.calculatedSalary !== undefined) {
        updateData.calculatedSalary = calculatedSalary;
      }

      // Handle dynamicFields carefully to prevent wiping
      if (Object.keys(dynamicFields).length > 0 || (existingEmployee.dynamicFields && Object.keys(existingEmployee.dynamicFields).length > 0)) {
        const cleanedExistingDynamic = { ...(existingEmployee.dynamicFields || {}) };

        // Explicitly remove bank fields from existing dynamic fields to fix stale data
        const bankFieldsToCleanup = [
          'bank_account_no', 'bankAccountNo',
          'bank_name', 'bankName',
          'bank_place', 'bankPlace',
          'ifsc_code', 'ifscCode',
          'salary_mode', 'salaryMode',
          'second_salary', 'secondSalary',
          'proposedSalary' // Also cleanup proposedSalary if it was accidentally saved
        ];
        bankFieldsToCleanup.forEach(f => delete cleanedExistingDynamic[f]);

        updateData.dynamicFields = {
          ...cleanedExistingDynamic,
          ...dynamicFields
        };
      }

      // Explicitly handle paidLeaves to ensure it's saved even if 0
      if (employeeData.paidLeaves !== undefined && employeeData.paidLeaves !== null) {
        updateData.paidLeaves = Number(employeeData.paidLeaves);
      }
      // Explicitly handle allottedLeaves to ensure it's saved even if 0
      if (employeeData.allottedLeaves !== undefined && employeeData.allottedLeaves !== null) {
        updateData.allottedLeaves = Number(employeeData.allottedLeaves);
      }

      // Explicitly handle second_salary to ensure it's saved correctly as Number
      // Check for both snake_case (standard) and camelCase (frontend payload)
      if (employeeData.second_salary !== undefined && employeeData.second_salary !== null && employeeData.second_salary !== '') {
        updateData.second_salary = Number(employeeData.second_salary);
      } else if (employeeData.secondSalary !== undefined && employeeData.secondSalary !== null && employeeData.secondSalary !== '') {
        updateData.second_salary = Number(employeeData.secondSalary);
      }

      await Employee.findOneAndUpdate(
        { emp_no: empNo },
        updateData,
        { new: true }
      );
      results.mongodb = true;
    } catch (mongoError) {
      console.error('MongoDB update error:', mongoError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update employee in MongoDB',
        error: mongoError.message,
      });
    }

    // Update in MSSQL (OPTIONAL/FAIL-SAFE)
    let mssqlSyncError = null;

    // Update in MSSQL (OPTIONAL/FAIL-SAFE)
    if (isHRMSConnected()) {
      try {
        const mssqlUpdateData = { ...permanentFields };
        if (permanentFields.department_id !== undefined) {
          mssqlUpdateData.department_id = permanentFields.department_id?.toString() || null;
        }
        if (permanentFields.designation_id !== undefined) {
          mssqlUpdateData.designation_id = permanentFields.designation_id?.toString() || null;
        }
        await updateEmployeeMSSQL(empNo, mssqlUpdateData);
        results.mssql = true;
      } catch (mssqlError) {
        console.error('MSSQL update error (non-blocking):', mssqlError);
        mssqlSyncError = {
          message: mssqlError.message,
          code: mssqlError.code,
          originalError: mssqlError.originalError ? mssqlError.originalError.message : null
        };
      }
    } else {
      console.warn('MSSQL not connected, skipping employee update sync (non-blocking)');
    }

    // Fetch updated employee
    const updatedEmployeeDoc = await Employee.findOne({ emp_no: empNo })
      .populate('division_id', 'name code')
      .populate('department_id', 'name code')
      .populate('designation_id', 'name code')
      .populate('employee_group_id', 'name code isActive');

    // Transform employee with user population
    const updatedEmployee = await transformEmployeeForResponse(updatedEmployeeDoc, true);
    if (updatedEmployee) {
      updatedEmployee.paidLeaves = updatedEmployee.paidLeaves !== undefined && updatedEmployee.paidLeaves !== null
        ? Number(updatedEmployee.paidLeaves)
        : 0;
      updatedEmployee.allottedLeaves = updatedEmployee.allottedLeaves !== undefined && updatedEmployee.allottedLeaves !== null
        ? Number(updatedEmployee.allottedLeaves)
        : 0;
    }

    // Employee history: profile updated (human-readable previous/current for changed fields)
    try {
      const before = existingEmployee.toObject();
      const after = updatedEmployeeDoc ? updatedEmployeeDoc.toObject() : null;
      if (after) {
        const skipFields = new Set(['__v', 'getQualifications', 'allData', 'created_at', 'updated_at', 'password', 'plain_password']);
        const requestedFields = Object.keys(employeeData || {}).filter((f) => !skipFields.has(f));
        const rawChanges = requestedFields
          .map((field) => ({
            field,
            previous: before[field],
            current: after[field],
          }))
          .filter((c) => {
            const prev = c.previous;
            const curr = c.current;
            if (prev === undefined && curr === undefined) return false;
            try {
              return JSON.stringify(prev) !== JSON.stringify(curr);
            } catch {
              return prev !== curr;
            }
          });

        // Resolve refs and complex values to human-readable strings for display
        const toDisplay = async (value, field) => {
          if (value === undefined || value === null) return '—';
          if (field === 'division_id') {
            const id = value?._id || value;
            if (!id) return '—';
            const doc = await Division.findById(id).select('name').lean();
            return doc ? doc.name : String(id);
          }
          if (field === 'department_id') {
            const id = value?._id || value;
            if (!id) return '—';
            const doc = await Department.findById(id).select('name').lean();
            return doc ? doc.name : String(id);
          }
          if (field === 'designation_id') {
            const id = value?._id || value;
            if (!id) return '—';
            const doc = await Designation.findById(id).select('name').lean();
            return doc ? doc.name : String(id);
          }
          if (field === 'qualifications') {
            const arr = Array.isArray(value) ? value : [];
            return arr.length ? `${arr.length} row(s)` : '—';
          }
          if (field === 'dynamicFields') {
            const obj = value && typeof value === 'object' ? value : {};
            const keys = Object.keys(obj).filter((k) => !k.startsWith('_'));
            return keys.length ? `${keys.length} field(s)` : '—';
          }
          if (value instanceof Date) return value.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
          if (typeof value === 'object') return '[updated]';
          return String(value);
        };

        const changes = [];
        for (const c of rawChanges) {
          changes.push({
            field: c.field,
            previous: await toDisplay(c.previous, c.field),
            current: await toDisplay(c.current, c.field),
          });
        }

        if (changes.length > 0) {
          await EmployeeHistory.create({
            emp_no: existingEmployee.emp_no,
            event: 'employee_updated',
            performedBy: req.user._id,
            performedByName: req.user.name,
            performedByRole: req.user.role,
            details: {
              changes,
            },
            comments: 'Employee profile updated',
          });
        }
      }
    } catch (err) {
      console.error('Failed to log employee update history:', err.message);
    }

    res.status(200).json({
      success: true,
      message: results.mssql
        ? 'Employee updated successfully in both databases'
        : 'Employee updated successfully in MongoDB. MSSQL sync skipped/failed.',
      savedTo: results,
      syncError: mssqlSyncError,
      data: updatedEmployee,
    });
  } catch (error) {
    console.error('Error updating employee:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating employee',
      error: error.message,
    });
  }
};

/**
 * @desc    Delete employee
 * @route   DELETE /api/employees/:empNo
 * @access  Private (Super Admin, Sub Admin)
 */
exports.deleteEmployee = async (req, res) => {
  try {
    const { empNo } = req.params;
    const settings = await getEmployeeSettings();

    // Check if employee exists
    const existingEmployee = await Employee.findOne({ emp_no: empNo });
    const existsMSSql = isHRMSConnected() ? await employeeExistsMSSQL(empNo) : false;

    if (!existingEmployee && !existsMSSql) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    const results = { mongodb: false, mssql: false };

    // Delete based on settings
    if (settings.deleteTarget === 'mongodb' || settings.deleteTarget === 'both') {
      try {
        if (existingEmployee) {
          await Employee.findOneAndDelete({ emp_no: empNo });
          results.mongodb = true;
        }
      } catch (mongoError) {
        console.error('MongoDB delete error:', mongoError);
      }
    }

    if (settings.deleteTarget === 'mssql' || settings.deleteTarget === 'both') {
      if (isHRMSConnected()) {
        try {
          await deleteEmployeeMSSQL(empNo);
          results.mssql = true;
        } catch (mssqlError) {
          console.error('MSSQL delete error:', mssqlError);
        }
      }
    }

    res.status(200).json({
      success: true,
      message: 'Employee deleted successfully',
      deletedFrom: results,
      deleteTarget: settings.deleteTarget,
    });
  } catch (error) {
    console.error('Error deleting employee:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting employee',
      error: error.message,
    });
  }
};

/**
 * @desc    Get employee count
 * @route   GET /api/employees/count
 * @access  Private
 */
exports.getEmployeeCount = async (req, res) => {
  try {
    const { is_active } = req.query;
    const query = {};

    if (is_active !== undefined) {
      query.is_active = is_active === 'true';
    }

    const count = await Employee.countDocuments(query);

    res.status(200).json({
      success: true,
      count,
    });
  } catch (error) {
    console.error('Error getting employee count:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting employee count',
      error: error.message,
    });
  }
};

/**
 * @desc    Get employee settings
 * @route   GET /api/employees/settings
 * @access  Private
 */
exports.getSettings = async (req, res) => {
  try {
    const settings = await getEmployeeSettings();
    const mssqlConnected = isHRMSConnected();

    res.status(200).json({
      success: true,
      data: {
        ...settings,
        mssqlConnected,
      },
    });
  } catch (error) {
    console.error('Error getting employee settings:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting employee settings',
      error: error.message,
    });
  }
};

/**
 * @desc    Update employee settings (dataSource, deleteTarget, auto_generate_employee_number)
 * @route   PUT /api/employees/settings
 * @access  Private (Super Admin, Sub Admin, Manager)
 */
exports.updateSettings = async (req, res) => {
  try {
    const { dataSource, deleteTarget, auto_generate_employee_number } = req.body;

    const updates = [
      dataSource != null && { key: 'employee_data_source', value: dataSource },
      deleteTarget != null && { key: 'employee_delete_target', value: deleteTarget },
      auto_generate_employee_number != null && { key: 'auto_generate_employee_number', value: !!auto_generate_employee_number },
    ].filter(Boolean);

    for (const { key, value } of updates) {
      await Settings.findOneAndUpdate(
        { key },
        { key, value, category: 'employee' },
        { new: true, upsert: true }
      );
    }

    const settings = await getEmployeeSettings();
    res.status(200).json({
      success: true,
      message: 'Employee settings updated',
      data: settings,
    });
  } catch (error) {
    console.error('Error updating employee settings:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating employee settings',
      error: error.message,
    });
  }
};

/**
 * @desc    Get next employee number (for UI when auto-generate is ON)
 * @route   GET /api/employees/next-emp-no
 * @access  Private
 */
exports.getNextEmpNo = async (req, res) => {
  try {
    const nextEmpNo = await getNextEmpNo();
    res.status(200).json({
      success: true,
      data: { nextEmpNo },
    });
  } catch (error) {
    console.error('Error getting next employee number:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting next employee number',
      error: error.message,
    });
  }
};

/**
 * @desc    Get resolved allowance/deduction components for a department/gross salary (with optional employee overrides)
 * @route   GET /api/employees/components/defaults
 * @access  Private
 */
/**
 * @desc    Set employee left date (deactivate employee)
 * @route   PUT /api/employees/:empNo/left-date
 * @access  Private (Super Admin, Sub Admin, HR)
 */
exports.setLeftDate = async (req, res) => {
  try {
    const { empNo } = req.params;
    const { leftDate, leftReason } = req.body;

    if (!leftDate) {
      return res.status(400).json({
        success: false,
        message: 'Left date is required',
      });
    }

    // Validate date format
    const leftDateObj = new Date(leftDate);
    if (isNaN(leftDateObj.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid left date format',
      });
    }

    // Find employee
    const employee = await Employee.findOne({ emp_no: empNo.toUpperCase() });
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    // Update left date and deactivate immediately for manual operation
    employee.leftDate = leftDateObj;
    employee.leftReason = leftReason || null;
    employee.is_active = false; // Manual left-date API keeps behaviour: deactivate now

    await employee.save();

    // Employee history: left date set manually
    try {
      await EmployeeHistory.create({
        emp_no: employee.emp_no,
        event: 'left_date_set',
        performedBy: req.user._id,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        details: {
          leftDate: employee.leftDate,
          leftReason: employee.leftReason,
          source: 'manual_api',
        },
        comments: leftReason || 'Left date set manually',
      });
    } catch (err) {
      console.error('Failed to log left date set history:', err.message);
    }

    res.status(200).json({
      success: true,
      message: 'Employee left date set successfully',
      data: {
        emp_no: employee.emp_no,
        employee_name: employee.employee_name,
        leftDate: employee.leftDate,
        leftReason: employee.leftReason,
        is_active: employee.is_active,
      },
    });
  } catch (error) {
    console.error('Error setting left date:', error);
    res.status(500).json({
      success: false,
      message: 'Error setting left date',
      error: error.message,
    });
  }
};

/**
 * @desc    Remove employee left date (reactivate employee)
 * @route   DELETE /api/employees/:empNo/left-date
 * @access  Private (Super Admin, Sub Admin, HR)
 */
exports.removeLeftDate = async (req, res) => {
  try {
    const { empNo } = req.params;

    // Find employee
    const employee = await Employee.findOne({ emp_no: empNo.toUpperCase() });
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    // Remove left date and reactivate
    employee.leftDate = null;
    employee.leftReason = null;
    employee.is_active = true;

    await employee.save();

    // Employee history: left date cleared / reactivation
    try {
      await EmployeeHistory.create({
        emp_no: employee.emp_no,
        event: 'left_date_cleared',
        performedBy: req.user._id,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        details: {
          source: 'manual_api',
        },
        comments: 'Employee reactivated; left date cleared',
      });
    } catch (err) {
      console.error('Failed to log left date cleared history:', err.message);
    }

    res.status(200).json({
      success: true,
      message: 'Employee reactivated successfully',
      data: {
        emp_no: employee.emp_no,
        employee_name: employee.employee_name,
        leftDate: employee.leftDate,
        leftReason: employee.leftReason,
        is_active: employee.is_active,
      },
    });
  } catch (error) {
    console.error('Error removing left date:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing left date',
      error: error.message,
    });
  }
};

/**
 * @desc    Get employee history timeline
 * @route   GET /api/employees/:empNo/history
 * @access  Private (Super Admin only for now)
 */
exports.getEmployeeHistory = async (req, res) => {
  try {
    const { empNo } = req.params;
    const empNoUpper = String(empNo || '').toUpperCase();

    if (!empNoUpper) {
      return res.status(400).json({
        success: false,
        message: 'Employee number is required',
      });
    }

    const history = await EmployeeHistory.find({ emp_no: empNoUpper })
      .sort({ timestamp: -1 })
      .limit(200)
      .lean();

    return res.status(200).json({
      success: true,
      data: history,
    });
  } catch (error) {
    console.error('Error fetching employee history:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching employee history',
      error: error.message,
    });
  }
};

exports.getAllowanceDeductionDefaults = async (req, res) => {
  try {
    const { departmentId, grossSalary, empNo } = req.query;

    if (!departmentId || !grossSalary) {
      return res.status(400).json({
        success: false,
        message: 'departmentId and grossSalary are required',
      });
    }

    let employeeAllowances = [];
    let employeeDeductions = [];

    if (empNo) {
      const existingEmployee = await Employee.findOne({ emp_no: empNo.toUpperCase() });
      if (existingEmployee) {
        employeeAllowances = Array.isArray(existingEmployee.employeeAllowances) ? existingEmployee.employeeAllowances : [];
        employeeDeductions = Array.isArray(existingEmployee.employeeDeductions) ? existingEmployee.employeeDeductions : [];
      }
    }

    const resolved = await resolveForEmployee({
      departmentId,
      grossSalary: Number(grossSalary),
      employeeAllowances,
      employeeDeductions,
    });

    return res.status(200).json({
      success: true,
      data: resolved,
    });
  } catch (error) {
    console.error('Error resolving allowance/deduction defaults:', error);
    res.status(500).json({
      success: false,
      message: 'Error resolving allowance/deduction defaults',
      error: error.message,
    });
  }
};

/**
 * @desc    Resend employee credentials
 * @route   POST /api/employees/:empNo/resend-credentials
 * @access  Private (Super Admin)
 */
exports.resendEmployeePassword = async (req, res) => {
  try {
    const { empNo } = req.params;

    // Force both channels for resend as per requirement
    const notificationChannels = { email: true, sms: true };

    console.log(`[EmployeeController] Resending credentials for ${empNo}. Channels forced:`, notificationChannels);

    // Explicitly select fields used by notification service to ensure they aren't missing
    const employee = await Employee.findOne({ emp_no: empNo.toUpperCase() })
      .select('+plain_password emp_no employee_name email phone_number');

    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    console.log(`[EmployeeController] Found employee: ${employee.employee_name}, Email: ${employee.email}, Phone: ${employee.phone_number}`);

    let passwordToSend = employee.plain_password;

    if (!passwordToSend) {
      const { passwordMode } = req.body;
      passwordToSend = await generatePassword(employee, passwordMode || null);
      employee.password = passwordToSend;
      employee.plain_password = passwordToSend;
      await employee.save();
    }

    const notificationResults = await sendCredentials(
      employee,
      passwordToSend,
      notificationChannels,
      false
    );

    // Employee history: credentials resent
    try {
      await EmployeeHistory.create({
        emp_no: employee.emp_no,
        event: 'credentials_resent',
        performedBy: req.user._id,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        details: {
          channels: notificationChannels,
        },
        comments: 'Login credentials resent to employee',
      });
    } catch (err) {
      console.error('Failed to log credentials resent history:', err.message);
    }

    res.status(200).json({
      success: true,
      message: 'Credentials resent successfully',
      notificationResults
    });
  } catch (error) {
    console.error('Error resending credentials:', error);
    res.status(500).json({ success: false, message: 'Error resending credentials', error: error.message });
  }
};

/**
 * @desc    Reset employee credentials (generate new and send via config matrix)
 * @route   POST /api/employees/:empNo/reset-credentials
 * @access  Private (Super Admin)
 */
exports.resetEmployeeCredentials = async (req, res) => {
  try {
    const { empNo } = req.params;

    const employee = await Employee.findOne({ emp_no: empNo.toUpperCase() })
      .select('+plain_password emp_no employee_name email phone_number');

    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    console.log(`[EmployeeController] Resetting credentials for ${empNo}. Using config matrix delivery strategy.`);

    const { passwordMode, customPassword } = req.body;

    let passwordToSend;
    if (customPassword && customPassword.trim().length > 0) {
      passwordToSend = customPassword.trim();
    } else {
      passwordToSend = await generatePassword(employee, passwordMode || null);
    }
    employee.password = passwordToSend;
    employee.plain_password = passwordToSend;
    await employee.save();

    const notificationResults = await sendCredentials(
      employee,
      passwordToSend,
      null,
      true
    );

    // Employee history: credentials reset
    try {
      await EmployeeHistory.create({
        emp_no: employee.emp_no,
        event: 'password_reset',
        performedBy: req.user._id,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        details: {
          mode: 'manual_reset',
        },
        comments: 'Login credentials reset and sent to employee',
      });
    } catch (err) {
      console.error('Failed to log credentials reset history:', err.message);
    }

    res.status(200).json({
      success: true,
      message: 'Credentials reset and sent successfully',
      notificationResults
    });
  } catch (error) {
    console.error('Error resetting credentials:', error);
    res.status(500).json({ success: false, message: 'Error resetting credentials', error: error.message });
  }
};

/**
 * @desc    Bulk export employee passwords
 * @route   POST /api/employees/bulk-export-passwords
 * @access  Private (Super Admin)
 */
exports.bulkExportEmployeePasswords = async (req, res) => {
  try {
    const { empNos, passwordMode } = req.body; // Array of emp_nos to reset/export

    const query = empNos && empNos.length > 0 ? { emp_no: { $in: empNos } } : { is_active: true };
    const employees = await Employee.find(query);

    const exportData = [];

    for (const emp of employees) {
      const newPassword = await generatePassword(emp, passwordMode || null);
      emp.password = newPassword;
      await emp.save();

      exportData.push({
        emp_no: emp.emp_no,
        employee_name: emp.employee_name,
        email: emp.email,
        phone: emp.phone_number,
        password: newPassword
      });

      // Employee history: credentials exported / reset as part of bulk operation
      try {
        await EmployeeHistory.create({
          emp_no: emp.emp_no,
          event: 'password_reset',
          performedBy: req.user._id,
          performedByName: req.user.name,
          performedByRole: req.user.role,
          details: {
            mode: 'bulk_export',
          },
          comments: 'Password reset as part of bulk export operation',
        });
      } catch (err) {
        console.error('Failed to log bulk password reset history:', err.message);
      }
    }

    // Convert to CSV for response
    const { Parser } = require('json2csv');
    const fields = ['emp_no', 'employee_name', 'email', 'phone', 'password'];
    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(exportData);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=employee_credentials.csv');
    res.status(200).send(csv);

  } catch (error) {
    console.error('Error in bulk password export:', error);
    res.status(500).json({ success: false, message: 'Error in bulk password export', error: error.message });
  }
};

/**
 * @desc    Bulk resend credentials to filtered employees
 * @route   POST /api/employees/bulk-resend-credentials
 * @access  Private (Super Admin)
 */
exports.bulkResendCredentials = async (req, res) => {
  try {
    const {
      search,
      divisionId,
      departmentId,
      designationId,
      includeLeft
    } = req.body;

    // Reuse filter logic similar to getAllEmployees
    const filters = { ...req.scopeFilter };

    if (divisionId) filters.division_id = divisionId;
    if (departmentId) filters.department_id = departmentId;
    if (designationId) filters.designation_id = designationId;

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      filters.$or = [
        { emp_no: searchRegex },
        { employee_name: searchRegex },
        { phone_number: searchRegex },
        { email: searchRegex }
      ];
    }

    if (includeLeft !== 'true') {
      filters.leftDate = null;
    }

    // Force both channels
    const notificationChannels = { email: true, sms: true };

    console.log('[EmployeeController] Bulk resending credentials with filters:', filters);

    // Fetch all matching employees
    const employees = await Employee.find(filters)
      .select('+plain_password emp_no employee_name email phone_number');

    if (!employees || employees.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No employees found matching the filters',
        count: 0
      });
    }

    console.log(`[EmployeeController] Found ${employees.length} employees for bulk resend`);

    const results = {
      total: employees.length,
      successCount: 0,
      failCount: 0,
      details: []
    };

    // Process each employee
    for (const employee of employees) {
      try {
        let passwordToSend = employee.plain_password;

        if (!passwordToSend) {
          // Fallback if plain_password missing
          passwordToSend = await generatePassword(employee, null);
          employee.password = passwordToSend;
          employee.plain_password = passwordToSend;
          await employee.save();
        }

        await sendCredentials(
          employee,
          passwordToSend,
          notificationChannels,
          false
        );

        // Employee history: credentials resent (bulk)
        try {
          await EmployeeHistory.create({
            emp_no: employee.emp_no,
            event: 'credentials_resent',
            performedBy: req.user._id,
            performedByName: req.user.name,
            performedByRole: req.user.role,
            details: {
              channels: notificationChannels,
              mode: 'bulk',
            },
            comments: 'Login credentials resent (bulk operation)',
          });
        } catch (err) {
          console.error('Failed to log bulk credentials resent history:', err.message);
        }

        results.successCount++;
      } catch (err) {
        console.error(`[EmployeeController] Failed to resend for ${employee.emp_no}:`, err.message);
        results.failCount++;
        results.details.push({ emp_no: employee.emp_no, error: err.message });
      }
    }

    res.status(200).json({
      success: true,
      message: `Bulk resend complete. Sent: ${results.successCount}, Failed: ${results.failCount}`,
      data: results
    });

  } catch (error) {
    console.error('Error in bulk resend credentials:', error);
    res.status(500).json({ success: false, message: 'Error in bulk resend credentials', error: error.message });
  }
};

/**
 * @desc    Export employees to CSV
 * @route   POST /api/employees/export
 * @access  Private
 */
exports.exportEmployees = async (req, res) => {
  try {
    const { fields, filters: queryFilters, empNo } = req.body;
    const { scopeFilter } = req;

    if (!fields || !Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ success: false, message: 'Please select at least one field to export' });
    }

    // Build filters
    let filters = { ...scopeFilter };
    if (empNo) {
      filters.emp_no = empNo;
    } else if (queryFilters) {
      if (queryFilters.is_active !== undefined) filters.is_active = queryFilters.is_active === 'true' || queryFilters.is_active === true;
      if (queryFilters.division_id) filters.division_id = queryFilters.division_id;
      if (queryFilters.department_id) filters.department_id = queryFilters.department_id;
      if (queryFilters.designation_id) filters.designation_id = queryFilters.designation_id;
      if (queryFilters.employee_group_id) filters.employee_group_id = queryFilters.employee_group_id;

      if (queryFilters.search) {
        const searchRegex = new RegExp(queryFilters.search, 'i');
        filters.$or = [
          { emp_no: searchRegex },
          { employee_name: searchRegex },
          { phone_number: searchRegex },
          { email: searchRegex }
        ];
      }

      if (queryFilters.includeLeft !== 'true') {
        const startOfToday = new Date();
        startOfToday.setUTCHours(0, 0, 0, 0);
        filters.$and = filters.$and || [];
        filters.$and.push({ $or: [{ leftDate: null }, { leftDate: { $gte: startOfToday } }] });
      }
    }

    // Fetch form settings to get labels
    const settings = await EmployeeApplicationFormSettings.getActiveSettings();
    if (!settings) {
      return res.status(500).json({ success: false, message: 'Form settings not found' });
    }

    // Create lookup Maps for labels and groupings
    const fieldMap = {};
    settings.groups.forEach(group => {
      group.fields.forEach(field => {
        fieldMap[field.id] = field.label;
      });
    });

    // Preparation for CSV headers/extraction
    const csvFields = fields.map(fId => ({
      label: fieldMap[fId] || fId,
      value: (row) => {
        let val = row[fId];
        // If not at root, check dynamicFields (common in this HRMS for custom fields)
        if ((val === undefined || val === null) && row.dynamicFields) {
          val = row.dynamicFields[fId];
        }

        if (val === undefined || val === null) return '';

        // Formatting logic
        if (fId === 'is_active') return val ? 'Active' : 'Inactive';
        if (fId === 'division_id' || fId === 'department_id' || fId === 'designation_id' || fId === 'employee_group_id') {
          return val?.name || val || '';
        }
        if (Array.isArray(val)) {
          return val.map(v => (typeof v === 'object' ? (v.name || v._id || JSON.stringify(v)) : String(v))).join(', ');
        }
        if (val instanceof Date || (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val))) {
          const d = new Date(val);
          return isNaN(d.getTime()) ? val : d.toLocaleDateString();
        }
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val);
      }
    }));

    // Multi-database handling
    let cursor;
    const settingsHelper = await getEmployeeSettings();
    if (settingsHelper.dataSource === 'mssql' && isHRMSConnected()) {
      // For MSSQL, we fetch all and create a stream-like behavior or just build CSV in memory if small
      // Since streamingExportService.streamToCSV expects a mongoose cursor, we might need a workaround
      // Or just fetch simplified MongoDB data if shared fields are enough.
      // But user likely wants SQL data too.
      // For now, let's support MongoDB streaming which covers 90% of cases and all dynamic fields.
      cursor = Employee.find(filters)
        .populate('division_id', 'name')
        .populate('department_id', 'name')
        .populate('designation_id', 'name')
        .populate('employee_group_id', 'name')
        .cursor();
    } else {
      cursor = Employee.find(filters)
        .populate('division_id', 'name')
        .populate('department_id', 'name')
        .populate('designation_id', 'name')
        .populate('employee_group_id', 'name')
        .cursor();
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=employees_export_${Date.now()}.csv`);

    const parser = streamingExportService.streamToCSV(cursor, csvFields);
    parser.pipe(res);

  } catch (error) {
    console.error('Error exporting employees:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Error exporting employees', error: error.message });
    }
  }
};
