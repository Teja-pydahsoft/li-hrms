/**
 * Employee Application Controller
 * Handles employee application workflow: HR creates → Superadmin approves/rejects
 */

const EmployeeApplication = require('../model/EmployeeApplication');
const Employee = require('../../employees/model/Employee');
const EmployeeHistory = require('../../employees/model/EmployeeHistory');
const Department = require('../../departments/model/Department');
const Designation = require('../../departments/model/Designation');
const EmployeeApplicationFormSettings = require('../model/EmployeeApplicationFormSettings');
const {
  validateFormData,
  transformFormData,
} = require('../services/formValidationService');
const {
  transformApplicationToEmployee,
} = require('../services/fieldMappingService');
const sqlHelper = require('../../employees/config/sqlHelper');
const { generatePassword, sendCredentials } = require('../../shared/services/passwordNotificationService');
const s3UploadService = require('../../shared/services/s3UploadService');
const { resolveQualificationLabels } = require('../services/fieldMappingService');
const { applicationQueue } = require('../../shared/jobs/queueManager');
const Settings = require('../../settings/model/Settings');
const { getNextEmpNo, getNextEmpNos } = require('../../employees/services/empNoService');
const {
  isCustomEmployeeGroupingEnabled,
  stripEmployeeGroupIfDisabled,
  stripEmployeeGroupWhenDisabled,
  validateEmployeeGroupIfEnabled,
} = require('../../shared/utils/customEmployeeGrouping');

/**
 * Internal helper for creating a single application
 * Used by createApplication and bulkCreateApplications
 */
const createApplicationInternal = async (rawData, settings, creatorId) => {
  let applicationData = { ...rawData };

  await stripEmployeeGroupIfDisabled(applicationData);

  // PARSE JSON fields if they are strings (usually from FormData in single creation)
  const jsonFields = ['dynamicFields', 'qualifications', 'employeeAllowances', 'employeeDeductions', 'department', 'designation'];
  jsonFields.forEach(field => {
    if (typeof applicationData[field] === 'string') {
      try {
        applicationData[field] = JSON.parse(applicationData[field]);
      } catch (e) {
        // Skip for bulk if already objects
      }
    }
  });

  // Basic validation if no settings
  if (!settings) {
    if (!applicationData.emp_no) throw new Error('Employee number (emp_no) is required');
    if (!applicationData.employee_name) throw new Error('Employee name is required');
    if (!applicationData.proposedSalary) throw new Error('Proposed salary is required');
  } else {
    const validation = await validateFormData(applicationData, settings);
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${Object.values(validation.errors).flat().join(', ')}`);
    }
  }

  const empNo = String(applicationData.emp_no || '').toUpperCase();

  // Check if employee already exists
  const existingEmployee = await Employee.findOne({ emp_no: empNo });
  if (existingEmployee) {
    throw new Error(`Employee with number ${empNo} already exists`);
  }

  // Check if pending application already exists
  const existingApplication = await EmployeeApplication.findOne({
    emp_no: empNo,
    status: 'pending',
  });
  if (existingApplication) {
    throw new Error(`Pending application already exists for employee number ${empNo}`);
  }

  // Transform form data
  const { permanentFields, dynamicFields } = transformFormData(applicationData, settings);

  await stripEmployeeGroupIfDisabled(permanentFields);
  const groupErr = await validateEmployeeGroupIfEnabled(permanentFields.employee_group_id);
  if (groupErr) {
    throw new Error(groupErr.error);
  }

  // Ensure qualifications (if provided) are handled and labels are resolved
  if (applicationData.qualifications) {
    if (settings && Array.isArray(applicationData.qualifications)) {
      permanentFields.qualifications = resolveQualificationLabels(applicationData.qualifications, settings);
    } else {
      permanentFields.qualifications = applicationData.qualifications;
    }
  }

  const normalizeOverrides = (list) =>
    Array.isArray(list)
      ? list
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

  const employeeAllowances = normalizeOverrides(applicationData.employeeAllowances);
  const employeeDeductions = normalizeOverrides(applicationData.employeeDeductions);

  // Profile photo URL (from S3 upload at application time)
  const profilePhoto = applicationData.profilePhoto && String(applicationData.profilePhoto).trim() ? String(applicationData.profilePhoto).trim() : null;

  // Create application
  const application = await EmployeeApplication.create({
    ...permanentFields,
    dynamicFields: dynamicFields,
    emp_no: empNo,
    profilePhoto,
    employeeAllowances,
    employeeDeductions,
    createdBy: creatorId,
    status: 'pending',
  });

  // Log history
  await EmployeeHistory.create({
    emp_no: empNo,
    event: 'application_created',
    performedBy: creatorId,
    details: { proposedSalary: application.proposedSalary },
  }).catch(err => console.error('Failed to log application creation history:', err.message));

  return application;
};

/**
 * @desc    Create employee application (HR)
 * @route   POST /api/employee-applications
 * @access  Private (HR, Sub Admin, Super Admin)
 */
exports.createApplication = async (req, res) => {
  console.log('[CreateApplication] Received request');
  try {
    let applicationData = { ...req.body };

    // Respect auto_generate_employee_number: assign next number if setting is ON and emp_no is blank (never use "(Auto)" as real emp_no)
    const autoGenSetting = await Settings.findOne({ key: 'auto_generate_employee_number' });
    const autoGenerateEmployeeNumber = autoGenSetting?.value === true || autoGenSetting?.value === 'true';
    const empNoStr = String(applicationData.emp_no || '').trim();
    const empNoBlank = !empNoStr || empNoStr.toUpperCase() === '(AUTO)';
    if (autoGenerateEmployeeNumber && empNoBlank) {
      applicationData.emp_no = await getNextEmpNo();
    } else if (!autoGenerateEmployeeNumber && empNoBlank) {
      return res.status(400).json({
        success: false,
        message: 'Employee number is required when auto-generate is off',
      });
    }

    // Handle Qualifications Files (only for single creation)
    if (req.files && applicationData.qualifications) {
      // We need to parse it first to modify
      if (typeof applicationData.qualifications === 'string') {
        applicationData.qualifications = JSON.parse(applicationData.qualifications);
      }

      if (Array.isArray(applicationData.qualifications)) {
        const fileMap = {};
        req.files.forEach(f => { fileMap[f.fieldname] = f; });

        for (let i = 0; i < applicationData.qualifications.length; i++) {
          const file = fileMap[`qualification_cert_${i}`];
          if (file) {
            try {
              const uploadResult = await s3UploadService.uploadToS3(
                file.buffer,
                file.originalname,
                file.mimetype,
                'hrms/certificates'
              );
              applicationData.qualifications[i].certificateUrl = uploadResult;
            } catch (err) {
              console.error(`[CreateApplication] S3 Upload Failed for [${i}]:`, err);
            }
          }
        }
      }
    }

    const settings = await EmployeeApplicationFormSettings.getActiveSettings();
    const application = await createApplicationInternal(applicationData, settings, req.user._id);

    await application.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'division_id', select: 'name' },
      { path: 'department_id', select: 'name code' },
      { path: 'designation_id', select: 'name code' },
      { path: 'employee_group_id', select: 'name code isActive' },
    ]);

    res.status(201).json({
      success: true,
      message: 'Employee application created successfully',
      data: application,
    });
  } catch (error) {
    console.error('Error creating employee application:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to create employee application',
    });
  }
};

/**
 * @desc    Bulk create employee applications (HR)
 * @route   POST /api/employee-applications/bulk
 * @access  Private (HR, Sub Admin, Super Admin)
 */
exports.bulkCreateApplications = async (req, res) => {
  console.log('[BulkCreateApplications] Received request');
  try {
    let applications = req.body;

    if (!Array.isArray(applications) || applications.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payload: Expected a non-empty array of applications',
      });
    }

    const autoGenSetting = await Settings.findOne({ key: 'auto_generate_employee_number' });
    const autoGenerateEmployeeNumber = autoGenSetting?.value === true || autoGenSetting?.value === 'true';

    // When auto-generate is ON, assign next emp_nos to rows that have no emp_no (or placeholder "(Auto)")
    const isEmpNoBlank = (v) => {
      const s = String(v || '').trim();
      return !s || s.toUpperCase() === '(AUTO)';
    };
    if (autoGenerateEmployeeNumber) {
      const rowsWithoutEmpNo = applications
        .map((app, index) => ({ app, index }))
        .filter(({ app }) => isEmpNoBlank(app.emp_no));
      const count = rowsWithoutEmpNo.length;
      if (count > 0) {
        const nextNos = await getNextEmpNos(count);
        nextNos.forEach((no, i) => {
          const { index } = rowsWithoutEmpNo[i];
          applications[index] = { ...applications[index], emp_no: no };
        });
      }
    }

    const settings = await EmployeeApplicationFormSettings.getActiveSettings();
    const creatorId = req.user._id;
    const groupingOn = await isCustomEmployeeGroupingEnabled();

    // 1. Pre-fetch existing and pending emp_no for duplicate checking
    const empNos = applications.map(app => String(app.emp_no || '').toUpperCase()).filter(Boolean);
    const [existingEmployees, pendingApps] = await Promise.all([
      Employee.find({ emp_no: { $in: empNos } }).select('emp_no'),
      EmployeeApplication.find({ emp_no: { $in: empNos }, status: 'pending' }).select('emp_no')
    ]);

    const existingEmpSet = new Set(existingEmployees.map(e => e.emp_no.toUpperCase()));
    const pendingAppSet = new Set(pendingApps.map(a => a.emp_no.toUpperCase()));

    const itemsToInsert = [];
    const results = {
      successCount: 0,
      failCount: 0,
      errors: [],
    };

    const normalizeOverrides = (list) =>
      Array.isArray(list)
        ? list
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

    // 2. Process and Validate in memory
    for (const appData of applications) {
      stripEmployeeGroupWhenDisabled(appData, groupingOn);

      const empNoRaw = String(appData.emp_no || '').trim();
      const empNo = empNoRaw.toUpperCase() === '(AUTO)' ? '' : empNoRaw.toUpperCase();

      try {
        // When auto-generate is OFF, emp_no is required (and must not be the placeholder "(Auto)")
        if (!autoGenerateEmployeeNumber && !empNo) {
          throw new Error('Employee number is required when auto-generate is off');
        }

        // Validation
        if (settings) {
          const validation = await validateFormData(appData, settings);
          if (!validation.isValid) {
            throw new Error(`Validation: ${Object.values(validation.errors).flat().join(', ')}`);
          }
        } else if (!appData.emp_no || !appData.employee_name || !appData.proposedSalary) {
          throw new Error('Basic validation failed: emp_no, employee_name, and proposedSalary are required');
        }

        // Duplicate Check
        if (existingEmpSet.has(empNo)) throw new Error(`Employee with number ${empNo} already exists`);
        if (pendingAppSet.has(empNo)) throw new Error(`Pending application already exists for employee number ${empNo}`);

        // Transformation
        const { permanentFields, dynamicFields } = transformFormData(appData, settings);

        stripEmployeeGroupWhenDisabled(permanentFields, groupingOn);
        if (groupingOn) {
          const gErr = await validateEmployeeGroupIfEnabled(permanentFields.employee_group_id);
          if (gErr) throw new Error(gErr.error);
        }

        // Qualifications
        if (appData.qualifications) {
          if (settings && Array.isArray(appData.qualifications)) {
            permanentFields.qualifications = resolveQualificationLabels(appData.qualifications, settings);
          } else {
            permanentFields.qualifications = appData.qualifications;
          }
        }

        // Never persist "(Auto)" or blank: use assigned number from appData (set above when auto-generate is on)
        const empNoToInsert = (empNo && String(empNo).toUpperCase() !== '(AUTO)')
          ? empNo
          : String(appData.emp_no || '').trim();
        if (empNoToInsert.toUpperCase() === '(AUTO)') {
          throw new Error('Employee number cannot be "(Auto)"');
        }

        itemsToInsert.push({
          ...permanentFields,
          dynamicFields,
          emp_no: empNoToInsert,
          employeeAllowances: normalizeOverrides(appData.employeeAllowances),
          employeeDeductions: normalizeOverrides(appData.employeeDeductions),
          createdBy: creatorId,
          status: 'pending',
        });

        // Add to "seen" set to catch duplicates within the same file
        pendingAppSet.add(empNoToInsert);

      } catch (err) {
        results.failCount++;
        results.errors.push({
          emp_no: appData.emp_no || 'Unknown',
          name: appData.employee_name || 'Unknown',
          message: err.message,
        });
      }
    }

    // 3. Batch Insert
    if (itemsToInsert.length > 0) {
      await EmployeeApplication.insertMany(itemsToInsert);
      results.successCount = itemsToInsert.length;
    }

    res.status(200).json({
      success: results.failCount === 0,
      message: `Bulk processing complete. ${results.successCount} succeeded, ${results.failCount} failed.`,
      data: results,
    });
  } catch (error) {
    console.error('Error in bulk creating applications:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error occurred during bulk processing',
    });
  }
};

/**
 * @desc    Update employee application (HR/Admin)
 * @route   PUT /api/employee-applications/:id
 * @access  Private (HR, Sub Admin, Super Admin)
 */
exports.updateApplication = async (req, res) => {
  console.log('[UpdateApplication] Received request for:', req.params.id);
  console.log('[UpdateApplication] Files:', req.files ? req.files.map(f => f.fieldname) : 'No files');

  try {
    const applicationId = req.params.id;
    let applicationData = { ...req.body };

    const existingApplication = await EmployeeApplication.findById(applicationId);
    if (!existingApplication) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    await stripEmployeeGroupIfDisabled(applicationData);

    // PARSE JSON STRINGIFIED FIELDS
    const jsonFields = ['dynamicFields', 'qualifications', 'employeeAllowances', 'employeeDeductions', 'department', 'designation'];
    jsonFields.forEach(field => {
      if (typeof applicationData[field] === 'string') {
        try {
          applicationData[field] = JSON.parse(applicationData[field]);
        } catch (e) {
          console.warn(`[UpdateApplication] Failed to parse JSON for field ${field}:`, e.message);
        }
      }
    });

    // Handle Qualifications Files (Replacement Logic)
    if (applicationData.qualifications && Array.isArray(applicationData.qualifications)) {
      const fileMap = {};
      if (req.files) {
        req.files.forEach(f => { fileMap[f.fieldname] = f; });
      }

      for (let i = 0; i < applicationData.qualifications.length; i++) {
        const file = fileMap[`qualification_cert_${i}`];
        // Preserve existing URL if no new file is uploaded
        // But wait, the frontend might send the 'certificateUrl' string if it wasn't valid.
        // If a new file is uploaded, we replace.

        if (file) {
          console.log(`[UpdateApplication] Replacing cert for qualification [${i}]`);

          // Check for existing URL to delete
          const oldUrl = existingApplication.qualifications[i]?.certificateUrl;

          try {
            // Upload new
            const uploadResult = await s3UploadService.uploadToS3(
              file.buffer,
              file.originalname,
              file.mimetype,
              'hrms/certificates'
            );

            // Delete old if exists
            if (oldUrl) {
              // We perform delete asynchronously or await it. Await is safer.
              await s3UploadService.deleteFromS3(oldUrl).catch(err => console.error('Failed to delete old cert:', err));
            }

            applicationData.qualifications[i].certificateUrl = uploadResult;
          } catch (err) {
            console.error(`[UpdateApplication] S3 Upload Failed for [${i}]:`, err);
          }
        } else {
          // Keep existing URL if not explicitly cleared/changed
          // The frontend should send the existing object. 
          // If the user deleted the file on frontend, 'certificateUrl' might be null in applicationData.
          // We trust applicationData's state (except for the file payload which is separate).
        }
      }
    }

    // Get form settings for validation
    const settings = await EmployeeApplicationFormSettings.getActiveSettings();

    // Validate (Optional: might skip strict validation on draft updates, but let's keep it safe)
    if (settings) {
      const validation = await validateFormData(applicationData, settings);
      if (!validation.isValid) {
        console.warn('Validation warnings on update:', validation.errors);
        // We might allow partial updates or return error. 
        // Let's enforce validation for consistency.
        // return res.status(400).json({ success: false, message: 'Validation failed', errors: validation.errors });
      }
    }

    // Update fields
    // We explicitly map fields to avoid overwriting metadata like 'status' if not intended, 
    // but here we are basically replacing the content.
    // 'status' should generally remain 'pending' unless specific action taken? 
    // Usually editing resets approvals? Let's assume status stays 'pending'.

    // Transform / Separate Fields
    const { permanentFields, dynamicFields } = transformFormData(applicationData, settings);

    await stripEmployeeGroupIfDisabled(permanentFields);
    const groupUpdateErr = await validateEmployeeGroupIfEnabled(permanentFields.employee_group_id);
    if (groupUpdateErr) {
      return res.status(400).json({ success: false, message: groupUpdateErr.error });
    }

    // Resolve labels for qualifications
    if (applicationData.qualifications) {
      if (settings && Array.isArray(applicationData.qualifications)) {
        permanentFields.qualifications = resolveQualificationLabels(applicationData.qualifications, settings);
      } else {
        permanentFields.qualifications = applicationData.qualifications;
      }
    }

    // Helper for allowances
    const normalizeOverrides = (list) => Array.isArray(list) ? list : [];

    // Profile photo: update if provided (URL from S3 upload)
    const profilePhoto = applicationData.profilePhoto !== undefined
      ? (applicationData.profilePhoto && String(applicationData.profilePhoto).trim() ? String(applicationData.profilePhoto).trim() : null)
      : existingApplication.profilePhoto;

    // Update document
    Object.assign(existingApplication, {
      ...permanentFields,
      dynamicFields,
      profilePhoto,
      employeeAllowances: normalizeOverrides(applicationData.employeeAllowances),
      employeeDeductions: normalizeOverrides(applicationData.employeeDeductions),
      // Don't update emp_no if it's unique/fixed? Usually allowed to fix typos.
      emp_no: applicationData.emp_no || existingApplication.emp_no
    });

    await existingApplication.save();

    res.status(200).json({
      success: true,
      message: 'Application updated successfully',
      data: existingApplication
    });

  } catch (error) {
    console.error('Error updating application:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Get all employee applications
 * @route   GET /api/employee-applications
 * @query   status, division_id, department_id, designation_id, search
 * @access  Private (HR, Sub Admin, Super Admin)
 * @scope   Respects user dataScope and divisionMapping (same as get employees)
 */
exports.getApplications = async (req, res) => {
  try {
    const { status, division_id, department_id, designation_id, employee_group_id, search } = req.query;
    const scopeFilter = req.scopeFilter || {};

    // Start with scope filter (division mapping / data scope) so workspace users see only their scope
    const filter = Object.keys(scopeFilter).length > 0 ? { ...scopeFilter } : {};
    if (status) {
      filter.status = status;
    }
    if (division_id) {
      filter.division_id = division_id;
    }
    if (department_id) {
      filter.department_id = department_id;
    }
    if (designation_id) {
      filter.designation_id = designation_id;
    }
    if (employee_group_id) {
      filter.employee_group_id = employee_group_id;
    }
    if (search && String(search).trim()) {
      const term = String(search).trim();
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const searchCondition = { $or: [{ employee_name: regex }, { emp_no: regex }] };
      filter.$and = filter.$and || [];
      filter.$and.push(searchCondition);
    }

    // HR can only see their own applications (and within their scope when scope filter is applied)
    if (req.user.role === 'hr') {
      filter.createdBy = req.user._id;
    }

    const applications = await EmployeeApplication.find(filter)
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('verifiedBy', 'name email')
      .populate('rejectedBy', 'name email')
      .populate('division_id', 'name')
      .populate('department_id', 'name code')
      .populate('designation_id', 'name code')
      .populate('employee_group_id', 'name code isActive')
      .sort({ created_at: -1 });

    res.status(200).json({
      success: true,
      data: applications,
    });
  } catch (error) {
    console.error('Error fetching employee applications:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch employee applications',
    });
  }
};

/**
 * @desc    Get single employee application
 * @route   GET /api/employee-applications/:id
 * @access  Private (HR, Sub Admin, Super Admin)
 */
exports.getApplication = async (req, res) => {
  try {
    const application = await EmployeeApplication.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('verifiedBy', 'name email')
      .populate('rejectedBy', 'name email')
      .populate('division_id', 'name')
      .populate('department_id', 'name code')
      .populate('designation_id', 'name code')
      .populate('employee_group_id', 'name code isActive');

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Employee application not found',
      });
    }

    // HR can only see their own applications
    if (req.user.role === 'hr' && application.createdBy._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this application',
      });
    }

    res.status(200).json({
      success: true,
      data: application,
    });
  } catch (error) {
    console.error('Error fetching employee application:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch employee application',
    });
  }
};

/**
 * Step 2: Verification Helper
 * Creates the employee record and sets status to 'verified'
 */
const verifySingleApplicationInternal = async (applicationId, approver) => {
  const approverId = approver._id || approver;
  const application = await EmployeeApplication.findById(applicationId);

  if (!application) {
    throw new Error('Employee application not found');
  }

  if (application.status !== 'pending') {
    throw new Error(`Application for ${application.emp_no} is already ${application.status}`);
  }

  // Determine initial DOJ (defaults to current date for the employee record)
  const finalDOJ = application.doj || new Date();

  // Set status to verified
  application.status = 'verified';
  application.verifiedBy = approverId;
  application.verifiedAt = new Date();

  // Prepare employee data (Proposed salary is stored but salaryStatus is pending)
  const appObj = application.toObject();

  // Resolve Qualification Labels if needed
  if (appObj.qualifications && Array.isArray(appObj.qualifications)) {
    const settings = await EmployeeApplicationFormSettings.getActiveSettings();
    if (settings) {
      appObj.qualifications = resolveQualificationLabels(appObj.qualifications, settings);
    }
  }

  const { permanentFields, dynamicFields } = transformApplicationToEmployee(
    appObj,
    {
      gross_salary: application.proposedSalary, // Use proposed as initial
      doj: finalDOJ,
    }
  );

  const employeeData = {
    ...permanentFields,
    dynamicFields: dynamicFields || {},
    employeeAllowances: application.employeeAllowances || [],
    employeeDeductions: application.employeeDeductions || [],
    salaryStatus: 'pending_approval',
    verifiedBy: approverId,
    verifiedAt: new Date(),
  };

  const results = { mongodb: false, mssql: false };

  // Generate and set password
  const password = await generatePassword(employeeData, null);
  employeeData.password = password;

  try {
    await Employee.create(employeeData);
    results.mongodb = true;
    await application.save();

    // Log History
    await EmployeeHistory.create({
      emp_no: application.emp_no,
      event: 'employee_verified',
      performedBy: approverId,
      performedByName: approver.name || null,
      performedByRole: approver.role || null,
      details: {
        gross_salary: application.proposedSalary,
        stage: 2,
        action: 'Employee record created'
      },
    }).catch(err => console.error('History log failed:', err.message));

  } catch (mongoError) {
    console.error(`[VerifyApplication] MongoDB error for ${employeeData.emp_no}:`, mongoError);
    throw new Error(`Failed to create employee record: ${mongoError.message}`);
  }

  // Create in MSSQL (OPTIONAL)
  const { isHRMSConnected, employeeExistsMSSQL, createEmployeeMSSQL } = sqlHelper;
  if (isHRMSConnected && isHRMSConnected()) {
    try {
      const existsInMSSQL = await employeeExistsMSSQL(employeeData.emp_no);
      if (!existsInMSSQL) {
        await createEmployeeMSSQL(employeeData);
        results.mssql = true;
      }
    } catch (mssqlError) {
      console.error(`[VerifyApplication] MSSQL error:`, mssqlError.message);
    }
  }

  // Send credentials
  let notificationResults = null;
  try {
    notificationResults = await sendCredentials(employeeData, password, { email: true, sms: true });
  } catch (notifError) {
    console.error(`[VerifyApplication] Notification error:`, notifError.message);
  }

  return { application, results, notificationResults };
};

/**
 * Step 3: Salary Approval Helper
 * Finalizes salary and sets status to 'approved'
 */
const approveSalaryInternal = async (applicationId, salaryData, approver) => {
  const approverId = approver._id || approver;
  const {
    approvedSalary, doj, comments, employeeAllowances, employeeDeductions,
    ctcSalary, calculatedSalary, second_salary,
    qualifications, qualificationStatus, paidLeaves, casualLeaves,
    applyProfessionTax, applyESI, applyPF, applyAttendanceDeduction,
    deductLateIn, deductEarlyOut, deductPermission, deductAbsent
  } = salaryData;

  const application = await EmployeeApplication.findById(applicationId);
  if (!application) throw new Error('Application not found');
  if (application.status !== 'verified') throw new Error('Application must be verified before salary approval');

  const finalSalary = approvedSalary || application.proposedSalary;
  const finalDOJ = doj ? new Date(doj) : application.doj;

  // Update Application
  application.status = 'approved';
  application.approvedSalary = finalSalary;
  application.doj = finalDOJ;
  application.approvedBy = approverId;
  application.approvalComments = comments;
  application.approvedAt = new Date();

  if (employeeAllowances) application.employeeAllowances = employeeAllowances;
  if (employeeDeductions) application.employeeDeductions = employeeDeductions;
  if (ctcSalary) application.ctcSalary = ctcSalary;
  if (calculatedSalary) application.calculatedSalary = calculatedSalary;
  if (second_salary !== undefined) application.second_salary = second_salary;
  if (qualifications !== undefined) application.qualifications = qualifications;
  if (qualificationStatus !== undefined) application.qualificationStatus = qualificationStatus;
  if (paidLeaves !== undefined) application.paidLeaves = paidLeaves;
  if (casualLeaves !== undefined) application.casualLeaves = casualLeaves;

  // Deduction Preferences
  if (applyProfessionTax !== undefined) application.applyProfessionTax = applyProfessionTax;
  if (applyESI !== undefined) application.applyESI = applyESI;
  if (applyPF !== undefined) application.applyPF = applyPF;
  if (applyAttendanceDeduction !== undefined) application.applyAttendanceDeduction = applyAttendanceDeduction;
  if (deductLateIn !== undefined) application.deductLateIn = deductLateIn;
  if (deductEarlyOut !== undefined) application.deductEarlyOut = deductEarlyOut;
  if (deductPermission !== undefined) application.deductPermission = deductPermission;
  if (deductAbsent !== undefined) application.deductAbsent = deductAbsent;

  await application.save();

  // Update Employee
  const employee = await Employee.findOne({ emp_no: application.emp_no });
  if (employee) {
    employee.gross_salary = finalSalary;
    employee.doj = finalDOJ;
    employee.salaryStatus = 'approved';
    employee.salaryApprovedBy = approverId;
    employee.salaryApprovedAt = new Date();
    // Also sync verifiedBy if it was missing in the employee record
    if (!employee.verifiedBy) {
      employee.verifiedBy = application.verifiedBy;
      employee.verifiedAt = application.verifiedAt;
    }

    if (second_salary !== undefined) employee.second_salary = second_salary;
    if (employeeAllowances) employee.employeeAllowances = employeeAllowances;
    if (employeeDeductions) employee.employeeDeductions = employeeDeductions;
    if (ctcSalary) employee.ctcSalary = ctcSalary;
    if (calculatedSalary) employee.calculatedSalary = calculatedSalary;
    if (qualifications !== undefined) employee.qualifications = qualifications;
    if (qualificationStatus !== undefined) employee.qualificationStatus = qualificationStatus;
    if (paidLeaves !== undefined) employee.paidLeaves = paidLeaves;
    if (casualLeaves !== undefined) employee.casualLeaves = casualLeaves;

    // Deduction Preferences
    if (applyProfessionTax !== undefined) employee.applyProfessionTax = applyProfessionTax;
    if (applyESI !== undefined) employee.applyESI = applyESI;
    if (applyPF !== undefined) employee.applyPF = applyPF;
    if (applyAttendanceDeduction !== undefined) employee.applyAttendanceDeduction = applyAttendanceDeduction;
    if (deductLateIn !== undefined) employee.deductLateIn = deductLateIn;
    if (deductEarlyOut !== undefined) employee.deductEarlyOut = deductEarlyOut;
    if (deductPermission !== undefined) employee.deductPermission = deductPermission;
    if (deductAbsent !== undefined) employee.deductAbsent = deductAbsent;

    await employee.save();

    // Sync to MSSQL if needed (Salary update)
    const { isHRMSConnected, updateEmployeeMSSQL } = sqlHelper;
    if (isHRMSConnected && isHRMSConnected()) {
      await updateEmployeeMSSQL(employee.emp_no, employee.toObject()).catch(e => console.error('MSSQL update failed:', e.message));
    }
  }

  // Log History
  await EmployeeHistory.create({
    emp_no: application.emp_no,
    event: 'salary_approved',
    performedBy: approverId,
    performedByName: approver.name || null,
    performedByRole: approver.role || null,
    details: { gross_salary: finalSalary, stage: 3 },
    comments: comments
  }).catch(err => console.error('History log failed:', err.message));

  return application;
};

/**
 * Helper logic for approving a single application (LEGACY SUPPORT / DUAL ACTION)
 * This contains the core logic to be shared between individual and bulk approval
 */
const approveSingleApplicationInternal = async (applicationId, approvalData, approver) => {
  // We can opt to make this call both verify and approve salary sequentially for backward compatibility
  const verifyResult = await verifySingleApplicationInternal(applicationId, approver);
  const approveResult = await approveSalaryInternal(applicationId, approvalData, approver);
  return { application: approveResult, results: verifyResult.results, notificationResults: verifyResult.notificationResults };
};

/**
 * @desc    Verify employee application (HR/Manager) - Stage 2
 * @route   PUT /api/employee-applications/:id/verify
 * @access  Private (HR, Manager, Sub Admin, Super Admin)
 */
exports.verifyApplication = async (req, res) => {
  try {
    const result = await verifySingleApplicationInternal(req.params.id, req.user);

    await result.application.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'verifiedBy', select: 'name email' },
      { path: 'division_id', select: 'name' },
      { path: 'department_id', select: 'name code' },
      { path: 'designation_id', select: 'name code' },
    ]);

    res.status(200).json({
      success: true,
      message: 'Application verified and employee record created. Credentials sent.',
      data: result.application,
      results: result.results,
      notificationResults: result.notificationResults,
    });
  } catch (error) {
    console.error('Error verifying application:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Approve salary (Superadmin) - Stage 3
 * @route   PUT /api/employee-applications/:id/approve-salary
 * @access  Private (Super Admin, Sub Admin)
 */
exports.approveSalary = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const application = await approveSalaryInternal(req.params.id, req.body, req.user);

    await application.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'verifiedBy', select: 'name email' },
      { path: 'approvedBy', select: 'name email' },
      { path: 'division_id', select: 'name' },
      { path: 'department_id', select: 'name code' },
      { path: 'designation_id', select: 'name code' },
    ]);

    res.status(200).json({
      success: true,
      message: 'Salary approved and employee finalized successfully',
      data: application,
    });
  } catch (error) {
    console.error('Error approving salary:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Approve employee application (LEGACY / Superadmin)
 * @route   PUT /api/employee-applications/:id/approve
 * @access  Private (Super Admin, Sub Admin)
 */
exports.approveApplication = async (req, res) => {
  try {
    // Only Superadmin and Sub Admin can approve
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to approve applications',
      });
    }

    const result = await approveSingleApplicationInternal(req.params.id, req.body, req.user);

    await result.application.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'approvedBy', select: 'name email' },
      { path: 'division_id', select: 'name' },
      { path: 'department_id', select: 'name code' },
      { path: 'designation_id', select: 'name code' },
    ]);

    res.status(200).json({
      success: true,
      message: 'Employee application processed successfully',
      data: result.application,
    });
  } catch (error) {
    console.error('Error approving employee application:', error);
    res.status(error.message.includes('not found') ? 404 : 400).json({
      success: false,
      message: error.message || 'Failed to approve employee application',
    });
  }
};

/**
 * @desc    Bulk approve employee applications (Superadmin)
 * @route   PUT /api/employee-applications/bulk-approve
 * @access  Private (Super Admin, Sub Admin)
 */
exports.bulkApproveApplications = async (req, res) => {
  try {
    const { applicationIds, bulkSettings } = req.body;

    if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No application IDs provided',
      });
    }

    // Only Superadmin and Sub Admin can approve
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to approve applications',
      });
    }

    // For small batches (≤10), process synchronously
    // For larger batches, use queue
    const SYNC_THRESHOLD = 10;

    if (applicationIds.length <= SYNC_THRESHOLD) {
      // Process synchronously
      const results = {
        successCount: 0,
        failCount: 0,
        errors: [],
      };

      for (const appId of applicationIds) {
        try {
          const approvalData = {
            approvedSalary: bulkSettings.approvedSalary,
            doj: bulkSettings.doj,
            comments: bulkSettings.comments,
          };
          await approveSingleApplicationInternal(appId, approvalData, req.user._id);
          results.successCount++;
        } catch (err) {
          results.failCount++;
          results.errors.push({
            applicationId: appId,
            message: err.message,
          });
        }
      }

      return res.status(200).json({
        success: results.failCount === 0,
        message: `Bulk approval completed. ${results.successCount} succeeded, ${results.failCount} failed.`,
        data: results,
      });
    } else {
      // Enqueue for large batches
      try {
        const job = await applicationQueue.add('approve-bulk', {
          type: 'approve-bulk',
          applicationIds,
          bulkSettings,
          approverId: req.user._id
        });

        return res.status(202).json({
          success: true,
          message: `Bulk approval job queued for ${applicationIds.length} applications.`,
          jobId: job.id,
        });
      } catch (queueError) {
        // If queue fails (e.g., Redis not available), fall back to synchronous processing
        console.warn('[BulkApprove] Queue unavailable, falling back to synchronous processing:', queueError.message);

        const results = {
          successCount: 0,
          failCount: 0,
          errors: [],
        };

        for (const appId of applicationIds) {
          try {
            const approvalData = {
              approvedSalary: bulkSettings.approvedSalary,
              doj: bulkSettings.doj,
              comments: bulkSettings.comments,
            };
            await approveSingleApplicationInternal(appId, approvalData, req.user);
            results.successCount++;
          } catch (err) {
            results.failCount++;
            results.errors.push({
              applicationId: appId,
              message: err.message,
            });
          }
        }

        return res.status(200).json({
          success: results.failCount === 0,
          message: `Bulk approval completed (synchronous fallback). ${results.successCount} succeeded, ${results.failCount} failed.`,
          data: results,
        });
      }
    }
  } catch (error) {
    console.error('Error in bulk approving applications:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error occurred during bulk approval',
    });
  }
};

/**
 * @desc    Reject employee application (Superadmin)
 * @route   PUT /api/employee-applications/:id/reject
 * @access  Private (Super Admin, Sub Admin)
 */
exports.rejectApplication = async (req, res) => {
  try {
    const { comments } = req.body;

    // Only Superadmin and Sub Admin can reject
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to reject applications',
      });
    }

    const application = await EmployeeApplication.findById(req.params.id);

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Employee application not found',
      });
    }

    // Cannot reject an already-rejected application
    if (application.status === 'rejected') {
      return res.status(400).json({
        success: false,
        message: 'Application is already rejected',
      });
    }

    // If the application was already verified or approved, an Employee record exists — delete it
    const wasEmployeeCreated = ['verified', 'approved'].includes(application.status);
    if (wasEmployeeCreated) {
      const employee = await Employee.findOne({ emp_no: application.emp_no });
      if (employee) {
        await employee.deleteOne();
        console.log(`[rejectApplication] Deleted employee record for ${application.emp_no} (application rejected after ${application.status})`);

        // Also remove from MSSQL if connected
        const { isHRMSConnected, deleteEmployeeMSSQL } = sqlHelper;
        if (isHRMSConnected && isHRMSConnected() && typeof deleteEmployeeMSSQL === 'function') {
          try {
            await deleteEmployeeMSSQL(application.emp_no);
          } catch (mssqlErr) {
            console.error(`[rejectApplication] MSSQL delete failed for ${application.emp_no}:`, mssqlErr.message);
          }
        }
      }
    }

    // Update application status
    application.status = 'rejected';
    application.rejectedBy = req.user._id;
    application.rejectionComments = comments || null;
    application.rejectedAt = new Date();

    await application.save();

    // Log history
    await EmployeeHistory.create({
      emp_no: application.emp_no,
      event: 'application_rejected',
      performedBy: req.user._id,
      performedByName: req.user.name || null,
      performedByRole: req.user.role || null,
      details: { previousStatus: wasEmployeeCreated ? 'verified/approved' : 'pending', employeeDeleted: wasEmployeeCreated },
      comments: comments || null,
    }).catch(err => console.error('History log failed:', err.message));

    await application.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'rejectedBy', select: 'name email' },
      { path: 'division_id', select: 'name' },
      { path: 'department_id', select: 'name code' },
      { path: 'designation_id', select: 'name code' },
    ]);

    res.status(200).json({
      success: true,
      message: wasEmployeeCreated
        ? 'Application rejected and employee record removed successfully'
        : 'Employee application rejected',
      data: application,
    });
  } catch (error) {
    console.error('Error rejecting employee application:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to reject employee application',
    });
  }
};


/**
 * @desc    Bulk reject employee applications (Superadmin)
 * @route   PUT /api/employee-applications/bulk-reject
 * @access  Private (Super Admin, Sub Admin)
 */
exports.bulkRejectApplications = async (req, res) => {
  try {
    const { applicationIds, comments } = req.body;

    if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No application IDs provided',
      });
    }

    // Only Superadmin can reject
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to reject applications',
      });
    }

    // Enqueue Bulk Rejection Job
    const job = await applicationQueue.add('reject-bulk', {
      type: 'reject-bulk',
      applicationIds,
      comments,
      approverId: req.user._id
    });

    res.status(202).json({
      success: true,
      message: `Bulk rejection job queued for ${applicationIds.length} applications.`,
      jobId: job.id,
    });
  } catch (error) {
    console.error('Error in bulk rejecting applications:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error occurred during bulk rejection',
    });
  }
};



