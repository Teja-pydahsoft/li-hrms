const User = require('../model/User');
const Employee = require('../../employees/model/Employee');
const EmployeeHistory = require('../../employees/model/EmployeeHistory');
const Department = require('../../departments/model/Department');
const Division = require('../../departments/model/Division');
const jwt = require('jsonwebtoken');
const Setting = require('../../settings/model/Settings');
const { generatePassword, sendCredentials } = require('../../shared/services/passwordNotificationService');
const EmployeeApplication = require('../../employee-applications/model/EmployeeApplication');


// Generate JWT Token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d',
  });
};



// @desc    Register a new user
// @route   POST /api/users/register
// @access  Private (Super Admin, Sub Admin, HR)
exports.registerUser = async (req, res) => {
  try {
    const {
      email,
      password,
      name,
      role,
      roles,
      employeeId,
      employeeRef,
      autoGeneratePassword,
      assignWorkspace,
      scope,
      featureControl,
      dataScope,
      divisionMapping,
    } = req.body;
    const { department, division } = req.body;

    // Only super_admin can create another super_admin
    if (role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only a super admin can create another super admin',
      });
    }

    // Validate required fields
    if (!email || !name || !role) {
      return res.status(400).json({
        success: false,
        message: 'Email, name, and role are required',
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists',
      });
    }

    // Generate or use provided password
    const userPassword = autoGeneratePassword ? await generatePassword() : password;
    if (!userPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password is required',
      });
    }
    if (!autoGeneratePassword && String(userPassword).length < 4) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 4 characters',
      });
    }

    // Validate role-specific requirements: HOD must have at least one division and one department (via divisionMapping or division+department)
    if (role === 'hod') {
      const hasMapping = divisionMapping && Array.isArray(divisionMapping) && divisionMapping.length > 0;
      const hasDeptsInMapping = hasMapping && divisionMapping.some(m => (m.departments || []).length > 0);
      if (!hasDeptsInMapping && !(division && department)) {
        return res.status(400).json({
          success: false,
          message: 'HOD must be assigned to at least one division and one department (via divisionMapping or division+department)',
        });
      }
    }

    const userRoles = roles && roles.length > 0 ? roles : [role];

    let finalDivisionMapping = Array.isArray(divisionMapping) ? divisionMapping : [];

    // Fallback logic if divisionMapping is missing but division/department are provided
    if (finalDivisionMapping.length === 0 && division && department) {
      finalDivisionMapping = [{ division, departments: [department] }];
    }

    const userData = {
      email: email.toLowerCase(),
      password: userPassword,
      name,
      role,
      roles: userRoles,
      scope: scope || 'global',
      featureControl: featureControl ? featureControl.flatMap(fc =>
        fc.includes(':') ? [fc] : [`${fc}:read`, `${fc}:write`]
      ) : [],
      createdBy: req.user?._id,
      dataScope: dataScope || undefined,
      divisionMapping: finalDivisionMapping,
    };

    // Only add employeeId and employeeRef if they have values (sparse index)
    if (employeeId) userData.employeeId = employeeId;
    if (employeeRef) userData.employeeRef = employeeRef;

    // Create user
    const user = await User.create(userData);

    // HOD Sync: Update every department in divisionMapping with this user as HOD for the respective division
    if (role === 'hod' && finalDivisionMapping.length > 0) {
      for (const mapping of finalDivisionMapping) {
        const divId = mapping.division?._id || mapping.division;
        const deptIds = mapping.departments || [];
        if (!divId) continue;
        const divStr = divId.toString();
        for (const deptId of deptIds) {
          const id = deptId?._id || deptId;
          const dept = await Department.findById(id);
          if (dept) {
            const idx = dept.divisionHODs.findIndex(dh => (dh.division?.toString() || dh.division) === divStr);
            if (idx > -1) dept.divisionHODs[idx].hod = user._id;
            else dept.divisionHODs.push({ division: divId, hod: user._id });
            await dept.save();
          }
        }
      }
    }

    // Manager Sync: Update Division manager reference
    const managerDivisionId = finalDivisionMapping.length === 1 ? (finalDivisionMapping[0].division?._id || finalDivisionMapping[0].division) : null;
    if (role === 'manager' && managerDivisionId) {
      const divisionId = managerDivisionId;
      // 1. Unset this user from being manager of any OTHER divisions (safety cleanup)
      await Division.updateMany(
        { manager: user._id },
        { $unset: { manager: "" } }
      );

      // 2. Set user as manager for the SPECIFIC division
      await Division.findByIdAndUpdate(divisionId, { manager: user._id });
    }

    // Return user without password, but include generated password if auto-generated
    const responseData = {
      user: {
        _id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        roles: user.roles,
        employeeId: user.employeeId,
        employeeRef: user.employeeRef,
        scope: user.scope,
        dataScope: user.dataScope,
        divisionMapping: user.divisionMapping,
        isActive: user.isActive,
        createdAt: user.createdAt,
      },
    };

    // Include generated password in response (only shown once)
    if (autoGeneratePassword) {
      responseData.generatedPassword = userPassword;
    }

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: responseData,
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating user',
      error: error.message,
    });
  }
};

// @desc    Create user from employee
// @route   POST /api/users/from-employee
// @access  Private (Super Admin, Sub Admin, HR)
exports.createUserFromEmployee = async (req, res) => {
  try {
    const {
      employeeId: empNo,
      email,
      password,
      role,
      roles,
      autoGeneratePassword,
      scope,
      featureControl,
      dataScope,
      divisionMapping,
    } = req.body;
    const { departments, department, division } = req.body;

    // Only super_admin can create another super_admin from employee
    if (role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only a super admin can create a super admin account from an employee',
      });
    }

    // Find employee (including password for inheritance)
    const employee = await Employee.findOne({ emp_no: empNo })
      .select('+password')
      .populate('department_id', 'name')
      .populate('designation_id', 'name');

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    // Check if user already exists for this employee
    const existingUser = await User.findOne({
      $or: [{ employeeId: employee.emp_no }, { employeeRef: employee._id }],
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists for this employee',
        existingUser: {
          _id: existingUser._id,
          email: existingUser.email,
          role: existingUser.role,
        },
      });
    }

    // Use employee email or provided email
    const userEmail = email || employee.email;
    if (!userEmail) {
      return res.status(400).json({
        success: false,
        message: 'Email is required. Employee has no email, please provide one.',
      });
    }

    // Check if email already in use
    const emailExists = await User.findOne({ email: userEmail.toLowerCase() });
    if (emailExists) {
      return res.status(400).json({
        success: false,
        message: 'This email is already registered to another user',
      });
    }

    // Generate, inherit, or use provided password
    let userPassword = password;
    if (autoGeneratePassword) {
      userPassword = await generatePassword(employee);
    } else if (!userPassword && employee.password) {
      // INHERIT PASSWORD FROM EMPLOYEE If none provided
      console.log(`[UserController] Inheriting password from employee ${employeeId} `);
      userPassword = employee.password;
    }

    if (!userPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password is required. No password provided and employee has no password.',
      });
    }
    if (!autoGeneratePassword && password && String(password).length < 4) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 4 characters',
      });
    }

    const empDeptId = employee.department_id?._id || employee.department_id;
    let finalDivisionMapping = Array.isArray(divisionMapping) ? divisionMapping : [];

    // Priority 1: Use divisionMapping if provided from frontend
    // Priority 2: Use division + department if provided from frontend
    // Priority 3: Auto-generate from employee's department (fallback for simple registration)
    if (finalDivisionMapping.length === 0) {
      if (division && department) {
        finalDivisionMapping = [{ division, departments: [department] }];
      } else if (departments?.length > 0 || empDeptId) {
        // Fallback: Auto-generate from departments (only if nothing specific was sent)
        const deptIds = (role === 'hr' && departments?.length > 0) ? departments : (empDeptId ? [empDeptId] : []);
        if (deptIds.length > 0) {
          const depts = await Department.find({ _id: { $in: deptIds } }).select('divisions').lean();
          const mapByDiv = new Map();
          for (const d of depts) {
            const divs = d.divisions || [];
            for (const div of divs) {
              const divId = (div?._id || div).toString();
              if (!mapByDiv.has(divId)) mapByDiv.set(divId, new Set());
              mapByDiv.get(divId).add(d._id.toString());
            }
          }
          finalDivisionMapping = Array.from(mapByDiv.entries()).map(([divId, deptSet]) => ({
            division: divId,
            departments: Array.from(deptSet),
          }));
        }
      }
    }

    const userRoles = roles && roles.length > 0 ? roles : [role];

    const user = await User.create({
      email: userEmail.toLowerCase(),
      password: userPassword,
      name: employee.employee_name,
      role: role || 'employee',
      roles: userRoles,
      employeeId: employee.emp_no,
      employeeRef: employee._id,
      scope: scope || 'global',
      featureControl: featureControl ? featureControl.flatMap(fc =>
        fc.includes(':') ? [fc] : [`${fc}:read`, `${fc}:write`]
      ) : [],
      dataScope: dataScope || undefined,
      divisionMapping: finalDivisionMapping,
      createdBy: req.user?._id,
    });

    // Employee history: user created / promoted (from employee to role)
    try {
      await EmployeeHistory.create({
        emp_no: employee.emp_no,
        event: 'user_promoted',
        performedBy: req.user._id,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        details: {
          userId: user._id,
          newRole: user.role,
          newRoles: user.roles,
        },
        comments: `User account created from employee and promoted to role: ${user.role}`,
      });
    } catch (err) {
      console.error('Failed to log user promotion history:', err.message);
    }

    const deptIdsFromMapping = finalDivisionMapping.flatMap(m => m.departments || []);
    if (role === 'hod' && finalDivisionMapping.length > 0) {
      for (const mapping of finalDivisionMapping) {
        const divId = mapping.division?._id || mapping.division;
        const deptIds = mapping.departments || [];
        if (!divId) continue;
        const divStr = divId.toString();
        for (const deptId of deptIds) {
          const id = deptId?._id || deptId;
          const dept = await Department.findById(id);
          if (dept) {
            const idx = dept.divisionHODs.findIndex(dh => (dh.division?.toString() || dh.division) === divStr);
            if (idx > -1) dept.divisionHODs[idx].hod = user._id;
            else dept.divisionHODs.push({ division: divId, hod: user._id });
            await dept.save();
          }
        }
      }
    }
    if (role === 'hr' && deptIdsFromMapping.length > 0) {
      await Department.updateMany(
        { _id: { $in: deptIdsFromMapping } },
        { hr: user._id }
      );
    }

    // Response
    const responseData = {
      user: {
        _id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        roles: user.roles,
        employeeId: user.employeeId,
        employeeRef: user.employeeRef,
        scope: user.scope,
        dataScope: user.dataScope,
        divisionMapping: user.divisionMapping,
        isActive: user.isActive,
      },
      employee: {
        _id: employee._id,
        emp_no: employee.emp_no,
        employee_name: employee.employee_name,
        department: employee.department_id,
        designation: employee.designation_id,
      },
    };

    if (autoGeneratePassword) {
      responseData.generatedPassword = userPassword;
    }

    res.status(201).json({
      success: true,
      message: 'User created from employee successfully',
      data: responseData,
    });
  } catch (error) {
    console.error('Error creating user from employee:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating user from employee',
      error: error.message,
    });
  }
};

// @desc    Get all users
// @route   GET /api/users
// @access  Private (Super Admin, Sub Admin, HR)
exports.getAllUsers = async (req, res) => {
  try {
    const { role, department, division, isActive, search, page = 1, limit = 50 } = req.query;
    const query = req.metadataScopeFilter ? { ...req.metadataScopeFilter } : {};

    if (role) query.role = role;

    if (department) {
      if (division) {
        // Strict intersection for specific department search within a division
        query.divisionMapping = {
          $elemMatch: {
            division: division,
            departments: department
          }
        };
      } else {
        query['divisionMapping.departments'] = department;
      }
    }


    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [users, total] = await Promise.all([
      User.find(query)
        .populate('divisionMapping.division', 'name code')
        .populate('divisionMapping.departments', 'name code')
        .populate('employeeRef', 'emp_no employee_name')
        .select('-password')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      User.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      count: users.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: users,
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching users',
      error: error.message,
    });
  }
};

// @desc    Get single user with workspaces
// @route   GET /api/users/:id
// @access  Private
exports.getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('divisionMapping.division', 'name code')
      .populate('divisionMapping.departments', 'name code')
      .populate('employeeRef')
      .select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user',
      error: error.message,
    });
  }
};

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Private (Super Admin, Sub Admin, HR)
exports.updateUser = async (req, res) => {
  try {
    const {
      name,
      role,
      roles,
      isActive,
      employeeId,
      employeeRef,
      scope,
      featureControl,
      dataScope,
      divisionMapping,
    } = req.body;
    const { department, division } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Prevent modifying super_admin if not super_admin
    if (user.role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Cannot modify super admin user',
      });
    }

    // Only super_admin can promote someone else to super_admin
    if (role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only a super admin can promote a user to super admin role',
      });
    }

    // Track original values for history
    const originalRole = user.role;
    const originalRoles = Array.isArray(user.roles) ? [...user.roles] : [];
    const originalIsActive = user.isActive;

    // Track if role changed for workspace update
    const roleChanged = role && role !== user.role;

    const oldMapping = user.divisionMapping || [];
    const oldDeptIds = new Set();
    oldMapping.forEach(m => {
      (m.departments || []).forEach(d => oldDeptIds.add((d?._id || d).toString()));
    });

    if (name !== undefined) user.name = name;
    if (role !== undefined) {
      user.role = role;
      user.roles = roles || [role];
    }
    if (isActive !== undefined) user.isActive = isActive;
    if (employeeId !== undefined) user.employeeId = employeeId;
    if (employeeRef !== undefined) user.employeeRef = employeeRef;
    if (scope !== undefined) user.scope = scope;
    if (featureControl !== undefined) {
      user.featureControl = Array.isArray(featureControl) ? featureControl.flatMap(fc =>
        fc.includes(':') ? [fc] : [`${fc}:read`, `${fc}:write`]
      ) : [];
    }
    if (dataScope !== undefined) user.dataScope = dataScope;
    if (divisionMapping !== undefined) {
      user.divisionMapping = divisionMapping;
    } else if (division && department) {
      user.divisionMapping = [{ division, departments: [department] }];
    }

    await user.save();

    const newDeptIds = new Set();
    (user.divisionMapping || []).forEach(m => {
      (m.departments || []).forEach(d => newDeptIds.add((d?._id || d).toString()));
    });
    const removedDeptIds = [...oldDeptIds].filter(d => !newDeptIds.has(d));

    if (removedDeptIds.length > 0) {
      await Department.updateMany(
        { _id: { $in: removedDeptIds }, hod: user._id },
        { $unset: { hod: "" } }
      );
      await Department.updateMany(
        { _id: { $in: removedDeptIds }, hr: user._id },
        { $unset: { hr: "" } }
      );
      // Remove this user from divisionHODs in departments no longer in mapping
      await Department.updateMany(
        { _id: { $in: removedDeptIds } },
        { $pull: { divisionHODs: { hod: user._id } } }
      );
    }

    const managerDivId = user.divisionMapping?.[0]?.division?._id || user.divisionMapping?.[0]?.division;
    if (role === 'manager' && managerDivId) {
      await Division.updateMany({ manager: user._id }, { $unset: { manager: "" } });
      await Division.findByIdAndUpdate(managerDivId, { manager: user._id });
    } else if (role === 'manager' || roleChanged) {
      await Division.updateMany({ manager: user._id }, { $unset: { manager: "" } });
    }

    // HOD: sync all (division, department) in divisionMapping to each department's divisionHODs
    if (user.role === 'hod' && user.divisionMapping?.length > 0) {
      for (const mapping of user.divisionMapping) {
        const divId = mapping.division?._id || mapping.division;
        const deptIds = mapping.departments || [];
        if (!divId) continue;
        const divStr = divId.toString();
        for (const deptId of deptIds) {
          const id = deptId?._id || deptId;
          const dept = await Department.findById(id);
          if (dept) {
            const idx = dept.divisionHODs.findIndex(dh => (dh.division?.toString() || dh.division) === divStr);
            if (idx > -1) dept.divisionHODs[idx].hod = user._id;
            else dept.divisionHODs.push({ division: divId, hod: user._id });
            await dept.save();
          }
        }
      }
    }

    if (user.role === 'hr' && newDeptIds.size > 0) {
      await Department.updateMany(
        { _id: { $in: Array.from(newDeptIds) } },
        { hr: user._id }
      );
    }

    // Fetch updated user with populated fields
    const updatedUser = await User.findById(user._id)
      .populate('divisionMapping.division', 'name code')
      .populate('divisionMapping.departments', 'name code')
      .select('-password');

    // Employee history: role / status changes
    try {
      // Resolve employee number if linked
      let empNoForHistory = user.employeeId;
      if (!empNoForHistory && user.employeeRef) {
        const empDoc = await Employee.findById(user.employeeRef).select('emp_no');
        empNoForHistory = empDoc?.emp_no;
      }

      if (empNoForHistory) {
        // Role change (promotion/demotion)
        if (role !== undefined && originalRole !== role) {
          const isPromotion = originalRole === 'employee' && role !== 'employee';
          const event = isPromotion ? 'user_promoted' : 'user_demoted';
          const comments = isPromotion
            ? `Promoted from ${originalRole || 'employee'} to ${role}`
            : `Role changed from ${originalRole || 'employee'} to ${role}`;

          await EmployeeHistory.create({
            emp_no: empNoForHistory,
            event,
            performedBy: req.user._id,
            performedByName: req.user.name,
            performedByRole: req.user.role,
            details: {
              userId: user._id,
              previousRole: originalRole,
              previousRoles: originalRoles,
              newRole: user.role,
              newRoles: user.roles,
            },
            comments,
          });
        }

        // Activation / deactivation via updateUser
        if (isActive !== undefined && originalIsActive !== isActive) {
          await EmployeeHistory.create({
            emp_no: empNoForHistory,
            event: isActive ? 'user_activated' : 'user_deactivated',
            performedBy: req.user._id,
            performedByName: req.user.name,
            performedByRole: req.user.role,
            details: {
              userId: user._id,
            },
            comments: isActive
              ? 'User account activated (access restored)'
              : 'User account temporarily deactivated',
          });
        }
      }
    } catch (err) {
      console.error('Failed to log user update history:', err.message);
    }

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: updatedUser,
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating user',
      error: error.message,
    });
  }
};

// @desc    Reset user password
// @route   PUT /api/users/:id/reset-password
// @access  Private (Super Admin, Sub Admin)
exports.resetPassword = async (req, res) => {
  try {
    const { newPassword, autoGenerate } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const password = autoGenerate ? await generatePassword() : newPassword;
    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Password is required',
      });
    }
    if (!autoGenerate && String(password).length < 4) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 4 characters',
      });
    }

    user.password = password;
    await user.save();

    // Send notification
    let notificationSent = false;
    try {
      // Find employee to get contact info if not in user
      const employee = await Employee.findById(user.employeeRef);
      const deliveryInfo = {
        employee_name: user.name,
        emp_no: user.employeeId || (employee ? employee.emp_no : 'User'),
        email: user.email,
        phone_number: employee ? employee.phone_number : null
      };

      const notificationResult = await sendCredentials(deliveryInfo, password, null, true);
      notificationSent = notificationResult.email || notificationResult.sms;
    } catch (notificationError) {
      console.error('[UserController] Failed to send reset notification:', notificationError.message);
    }

    const response = {
      success: true,
      message: notificationSent
        ? 'Password reset successfully and notification sent.'
        : 'Password reset successfully, but failed to send notification.',
    };

    if (autoGenerate) {
      response.newPassword = password;
    }

    // Employee history: user password reset
    try {
      // Resolve employee number if linked
      let empNoForHistory = user.employeeId;
      if (!empNoForHistory && user.employeeRef) {
        const empDoc = await Employee.findById(user.employeeRef).select('emp_no');
        empNoForHistory = empDoc?.emp_no;
      }

      if (empNoForHistory) {
        await EmployeeHistory.create({
          emp_no: empNoForHistory,
          event: 'password_reset',
          performedBy: req.user._id,
          performedByName: req.user.name,
          performedByRole: req.user.role,
          details: {
            userId: user._id,
            autoGenerate: !!autoGenerate,
          },
          comments: 'User password reset by administrator',
        });
      }
    } catch (err) {
      console.error('Failed to log user password reset history:', err.message);
    }

    res.status(200).json(response);
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({
      success: false,
      message: 'Error resetting password',
      error: error.message,
    });
  }
};

// @desc    Toggle user active status
// @route   PUT /api/users/:id/toggle-status
// @access  Private (Super Admin, Sub Admin)
exports.toggleUserStatus = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Prevent deactivating super_admin
    if (user.role === 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Cannot deactivate super admin user',
      });
    }

    const originalIsActive = user.isActive;

    user.isActive = !user.isActive;
    await user.save();

    // Employee history: toggle active status (temporary deactivation / activation)
    try {
      let empNoForHistory = user.employeeId;
      if (!empNoForHistory && user.employeeRef) {
        const empDoc = await Employee.findById(user.employeeRef).select('emp_no');
        empNoForHistory = empDoc?.emp_no;
      }

      if (empNoForHistory && originalIsActive !== user.isActive) {
        await EmployeeHistory.create({
          emp_no: empNoForHistory,
          event: user.isActive ? 'user_activated' : 'user_deactivated',
          performedBy: req.user._id,
          performedByName: req.user.name,
          performedByRole: req.user.role,
          details: {
            userId: user._id,
          },
          comments: user.isActive
            ? 'User account activated (access restored)'
            : 'User account temporarily deactivated',
        });
      }
    } catch (err) {
      console.error('Failed to log user toggle-status history:', err.message);
    }

    res.status(200).json({
      success: true,
      message: `User ${user.isActive ? 'activated' : 'deactivated'} successfully`,
      data: { isActive: user.isActive },
    });
  } catch (error) {
    console.error('Error toggling user status:', error);
    res.status(500).json({
      success: false,
      message: 'Error toggling user status',
      error: error.message,
    });
  }
};

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private (Super Admin, Sub Admin)
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Prevent deleting super_admin
    if (user.role === 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Cannot delete super admin user',
      });
    }

    // If this user is linked to an employee, reject any active application for that employee
    const empNo = user.employeeId;
    if (empNo) {
      const application = await EmployeeApplication.findOne({
        emp_no: empNo,
        status: { $in: ['pending', 'verified', 'approved'] },
      });
      if (application) {
        application.status = 'rejected';
        application.rejectedBy = req.user?._id || null;
        application.rejectedAt = new Date();
        application.rejectionComments = 'User account deleted by administrator.';
        await application.save();
        console.log(`[deleteUser] Rejected application ${application._id} for employee ${empNo} (user deleted)`);
      }
    }

    await user.deleteOne();

    // Employee history: user deleted (treated as demoted / access removed)
    try {
      if (empNo) {
        await EmployeeHistory.create({
          emp_no: empNo,
          event: 'user_deleted',
          performedBy: req.user._id,
          performedByName: req.user.name,
          performedByRole: req.user.role,
          details: {
            userId: user._id,
            previousRole: user.role,
            previousRoles: user.roles,
          },
          comments: 'User account deleted; access removed (demoted back to employee record only)',
        });
      }
    } catch (err) {
      console.error('Failed to log user deletion history:', err.message);
    }

    res.status(200).json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting user',
      error: error.message,
    });
  }
};

// @desc    Get employees without user accounts
// @route   GET /api/users/employees-without-account
// @access  Private (Super Admin, Sub Admin, HR)
exports.getEmployeesWithoutAccount = async (req, res) => {
  try {
    // Get all employee IDs that have user accounts
    const usersWithEmployees = await User.find({
      $or: [{ employeeId: { $ne: null } }, { employeeRef: { $ne: null } }],
    }).select('employeeId employeeRef');

    const linkedEmpNos = usersWithEmployees.map((u) => u.employeeId).filter(Boolean);
    const linkedEmpRefs = usersWithEmployees.map((u) => u.employeeRef).filter(Boolean);

    // Find employees without accounts
    const employees = await Employee.find({
      emp_no: { $nin: linkedEmpNos },
      _id: { $nin: linkedEmpRefs },
      is_active: true,
    })
      .populate('department_id', 'name code')
      .populate('designation_id', 'name')
      .select('emp_no employee_name email phone_number department_id designation_id')
      .sort({ employee_name: 1 });

    res.status(200).json({
      success: true,
      count: employees.length,
      data: employees,
    });
  } catch (error) {
    console.error('Error fetching employees without accounts:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching employees',
      error: error.message,
    });
  }
};

// @desc    Get user statistics
// @route   GET /api/users/stats
// @access  Private (Super Admin, Sub Admin)
exports.getUserStats = async (req, res) => {
  try {
    const [totalUsers, activeUsers, roleStats] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isActive: true }),
      User.aggregate([
        { $group: { _id: '$role', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const roleStatsMap = {};
    roleStats.forEach((r) => {
      roleStatsMap[r._id] = r.count;
    });

    res.status(200).json({
      success: true,
      data: {
        totalUsers,
        activeUsers,
        inactiveUsers: totalUsers - activeUsers,
        byRole: roleStatsMap,
      },
    });
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user statistics',
      error: error.message,
    });
  }
};

// @desc    Update user's own profile
// @route   PUT /api/users/profile
// @access  Private
// When profilePhoto is provided: if user has employeeRef, store on Employee; else store on User.
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, phone, profilePhoto } = req.body;

    const updateData = {};
    if (name) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;

    const userDoc = await User.findById(userId).select('-password');
    if (userDoc) {
      if (profilePhoto !== undefined) {
        const photoUrl = profilePhoto && String(profilePhoto).trim() ? String(profilePhoto).trim() : null;
        if (userDoc.employeeRef) {
          await Employee.findByIdAndUpdate(userDoc.employeeRef, { profilePhoto: photoUrl });
        } else {
          updateData.profilePhoto = photoUrl;
        }
      }
      const user = await User.findByIdAndUpdate(
        userId,
        updateData,
        { new: true, runValidators: true }
      ).select('-password');
      return res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        data: user,
      });
    }

    const employeeDoc = await Employee.findById(userId).select('-password');
    if (employeeDoc) {
      if (name) await Employee.findByIdAndUpdate(userId, { employee_name: name });
      if (profilePhoto !== undefined) {
        const photoUrl = profilePhoto && String(profilePhoto).trim() ? String(profilePhoto).trim() : null;
        await Employee.findByIdAndUpdate(userId, { profilePhoto: photoUrl });
      }
      const employee = await Employee.findById(userId).select('-password');
      return res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        data: { ...employee.toObject(), name: employee.employee_name },
      });
    }

    return res.status(404).json({
      success: false,
      message: 'User not found',
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating profile',
      error: error.message,
    });
  }
};

// Export generateToken for use in authController
exports.generateToken = generateToken;
