const User = require('../../users/model/User');
const Employee = require('../../employees/model/Employee');
const RoleAssignment = require('../../workspaces/model/RoleAssignment');
const { generateToken } = require('../../users/controllers/userController');

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { identifier: bodyIdentifier, email, password } = req.body;
    const identifier = bodyIdentifier || email; // support both identifier and email keys

    console.log(`[AuthLogin] Attempting login for identifier: ${identifier}`);

    // Validate input
    if (!identifier || !password) {
      console.warn(`[AuthLogin] Missing identifier or password`);
      return res.status(400).json({
        success: false,
        message: 'Please provide email/username/emp_no and password',
      });
    }

    let user = null;
    let userType = null;

    // 1. CHECK USER COLLECTION FIRST (Requirement: Hierarchy check validation in users first)
    console.log(`[AuthLogin] Checking User collection for ${identifier}...`);
    // Search by email, name (username), or employeeId (emp_no)
    user = await User.findOne({
      $or: [
        { email: identifier.toLowerCase() },
        { name: identifier },
        { employeeId: identifier.toUpperCase() }
      ],
    }).select('+password');

    if (user) {
      userType = 'user';
      console.log(`[AuthLogin] Found matched record in User collection.`);
    }

    // 2. CHECK EMPLOYEE COLLECTION AS FALLBACK
    if (!user) {
      console.log(`[AuthLogin] Checking Employee collection for ${identifier}...`);
      // Search by emp_no or email
      user = await Employee.findOne({
        $or: [
          { emp_no: identifier.toUpperCase() },
          { email: identifier.toLowerCase() }
        ],
      }).select('+password');

      if (user) {
        userType = 'employee';
        console.log(`[AuthLogin] Found matched record in Employee collection.`);
      }
    }

    if (!user) {
      console.warn(`[AuthLogin] Identifier ${identifier} not found in any collection`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    console.log(`[AuthLogin] Found ${userType} for identifier ${identifier}: ID ${user._id}`);

    // Check if user/employee is active
    const isActive = userType === 'user' ? user.isActive : user.is_active;
    if (!isActive) {
      console.warn(`[AuthLogin] Found ${userType} is inactive: ${identifier}`);
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated. Please contact administrator',
      });
    }

    // Employee: treat as deactivated after last working date (resignation date)
    if (userType === 'employee' && user.leftDate) {
      const startOfToday = new Date();
      startOfToday.setUTCHours(0, 0, 0, 0);
      if (new Date(user.leftDate) < startOfToday) {
        return res.status(401).json({
          success: false,
          message: 'Your last working date has passed. Account is deactivated.',
        });
      }
    }

    // Check password
    console.log(`[AuthLogin] Verifying password for ${userType} ${identifier}...`);
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      console.warn(`[AuthLogin] Password mismatch for ${userType} ${identifier}. Provided length: ${password?.length}, Stored hash present: ${!!user.password}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    console.log(`[AuthLogin] Login successful for ${userType} ${identifier}`);

    // Update last login on the correct record: if user is upgraded from employee, update Employee only; else update the logged-in entity
    const now = new Date();
    if (userType === 'user') {
      if (user.employeeRef) {
        await Employee.findByIdAndUpdate(user.employeeRef, { lastLogin: now });
      } else {
        user.lastLogin = now;
        await user.save();
      }
    } else {
      user.lastLogin = now;
      await user.save();
    }

    // Generate token
    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user._id,
          email: user.email,
          name: userType === 'user' ? user.name : user.employee_name,
          role: userType === 'user' ? user.role : 'employee',
          roles: userType === 'user' ? user.roles : ['employee'],
          department: userType === 'employee' ? user.department_id : undefined,
          emp_no: userType === 'employee' ? user.emp_no : user.employeeId,
          type: userType,
          featureControl: userType === 'user' ? user.featureControl : undefined,
          dataScope: userType === 'user' ? user.dataScope : 'own',
          divisionMapping: userType === 'user' ? user.divisionMapping : undefined,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error during login',
      error: error.message,
    });
  }
};

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    let user = await User.findById(req.user.userId)
      .select('-password');

    let userType = 'user';

    if (!user) {
      user = await Employee.findById(req.user.userId)
        .populate('department_id', 'name code')
        .populate('designation_id', 'name code');
      userType = 'employee';
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Account not found',
      });
    }

    let profilePhoto = user.profilePhoto || null;
    let joined = user.createdAt || null;
    let lastLogin = user.lastLogin || null;

    if (userType === 'user' && user.employeeRef) {
      const emp = await Employee.findById(user.employeeRef).select('profilePhoto doj createdAt lastLogin').lean();
      if (emp) {
        if (emp.profilePhoto) profilePhoto = emp.profilePhoto;
        joined = emp.doj || emp.createdAt || null;
        lastLogin = emp.lastLogin || null;
      }
    } else if (userType === 'employee') {
      joined = user.doj || user.createdAt || null;
      lastLogin = user.lastLogin || null;
    }

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: userType === 'user' ? user.name : user.employee_name,
          role: userType === 'user' ? user.role : 'employee',
          roles: userType === 'user' ? user.roles : ['employee'],
          department: userType === 'employee' ? user.department_id : undefined,
          emp_no: userType === 'employee' ? user.emp_no : user.employeeId,
          type: userType,
          featureControl: userType === 'user' ? user.featureControl : undefined,
          isActive: user.isActive,
          dataScope: userType === 'user' ? user.dataScope : 'own',
          divisionMapping: userType === 'user' ? user.divisionMapping : undefined,
          profilePhoto,
          createdAt: joined,
          lastLogin,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching user data',
      error: error.message,
    });
  }
};

// @desc    SSO login: verify external token and create local session
// @route   POST /api/auth/sso-login
// @access  Public
exports.ssoLogin = async (req, res) => {
  try {
    const { encryptedToken } = req.body;

    if (!encryptedToken) {
      return res.status(400).json({
        success: false,
        message: 'SSO token is required',
      });
    }

    let verifyUrl = process.env.SSO_VERIFY_URL || process.env.CRM_SSO_VERIFY_URL;
    if (!verifyUrl) {
      console.warn('[SSOLogin] SSO_VERIFY_URL (or CRM_SSO_VERIFY_URL) is not configured');
      return res.status(503).json({
        success: false,
        message: 'SSO is not configured. Please set SSO_VERIFY_URL.',
      });
    }

    // Ensure path is correctly appended if missing
    if (!verifyUrl.endsWith('/auth/verify-token')) {
      verifyUrl = verifyUrl.replace(/\/$/, '') + '/auth/verify-token';
    }

    // Verify token with external CRM/auth gateway
    console.log(`[SSOLogin] Calling SSO verify URL: ${verifyUrl}`);
    let verifyResponse;
    try {
      verifyResponse = await fetch(verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encryptedToken }),
      });
    } catch (fetchError) {
      console.error('[SSOLogin] Failed to reach SSO verify endpoint:', fetchError.message);
      return res.status(502).json({
        success: false,
        message: 'Could not verify SSO token. Please try again.',
      });
    }

    if (!verifyResponse.ok) {
      console.error(`[SSOLogin] SSO verify endpoint returned status ${verifyResponse.status}`);
      const errorText = await verifyResponse.text();
      console.error(`[SSOLogin] Error response: ${errorText}`);
      return res.status(401).json({
        success: false,
        message: `SSO verification failed (Status: ${verifyResponse.status}). Please check your configuration.`,
      });
    }

    const verifyResult = await verifyResponse.json();

    if (!verifyResult.success || !verifyResult.valid) {
      console.warn(`[SSOLogin] SSO verification failed: ${verifyResult.message || 'Invalid or expired token'}`);
      return res.status(401).json({
        success: false,
        message: verifyResult.message || 'Invalid or expired SSO token',
      });
    }

    const { userId, role: externalRole, expiresAt, email: externalEmail } = verifyResult.data || {};

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid SSO token payload',
      });
    }

    // Optional: reject if token already expired
    if (expiresAt) {
      const expiryTime = new Date(expiresAt).getTime();
      if (Date.now() >= expiryTime) {
        return res.status(401).json({
          success: false,
          message: 'SSO token has expired',
        });
      }
    }

    const mongoose = require('mongoose');
    let user = null;
    let userType = null;

    // Resolve to our User or Employee: try by _id, then email, then employeeId/emp_no
    if (mongoose.Types.ObjectId.isValid(userId) && String(new mongoose.Types.ObjectId(userId)) === String(userId)) {
      user = await User.findById(userId).select('+password');
      if (user) userType = 'user';
      if (!user) {
        user = await Employee.findById(userId).select('+password');
        if (user) userType = 'employee';
      }
    }

    if (!user && (externalEmail || userId.includes('@'))) {
      const email = (externalEmail || userId).toLowerCase();
      user = await User.findOne({ email }).select('+password');
      if (user) userType = 'user';
      if (!user) {
        user = await Employee.findOne({ email }).select('+password');
        if (user) userType = 'employee';
      }
    }

    if (!user) {
      user = await User.findOne({
        $or: [
          { employeeId: userId.toUpperCase() },
          { name: userId },
        ],
      }).select('+password');
      if (user) userType = 'user';
    }

    if (!user) {
      user = await Employee.findOne({
        $or: [
          { emp_no: userId.toUpperCase() },
          { employee_name: userId },
        ],
      }).select('+password');
      if (user) userType = 'employee';
    }

    if (!user) {
      console.warn('[SSOLogin] No local user found for SSO userId:', userId);
      return res.status(401).json({
        success: false,
        message: 'User not found in HRMS. Please contact administrator.',
      });
    }

    const isActive = userType === 'user' ? user.isActive : user.is_active;
    if (!isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated. Please contact administrator',
      });
    }

    const now = new Date();
    if (userType === 'user' && user.employeeRef) {
      await Employee.findByIdAndUpdate(user.employeeRef, { lastLogin: now });
    } else {
      user.lastLogin = now;
      await user.save();
    }

    const token = generateToken(user._id);

    let workspaces = [];
    let activeWorkspace = null;

    if (userType === 'user') {
      try {
        const assignments = await RoleAssignment.getUserWorkspaces(user._id);
        workspaces = assignments.map((assignment) => ({
          _id: assignment.workspaceId._id,
          name: assignment.workspaceId.name,
          code: assignment.workspaceId.code,
          type: assignment.workspaceId.type,
          description: assignment.workspaceId.description,
          theme: assignment.workspaceId.theme,
          modules: assignment.workspaceId.modules?.filter((m) => m.isEnabled) || [],
          defaultModuleCode: assignment.workspaceId.defaultModuleCode,
          role: assignment.role,
          isPrimary: assignment.isPrimary,
        }));
        activeWorkspace = user.activeWorkspaceId
          ? workspaces.find((w) => w._id.toString() === user.activeWorkspaceId.toString())
          : workspaces.find((w) => w.isPrimary) || workspaces[0];
      } catch (wsError) {
        console.log('Workspaces not configured yet:', wsError.message);
      }
    } else {
      try {
        const Workspace = require('../../workspaces/model/Workspace');
        const empWorkspace = await Workspace.findOne({ code: 'EMP' });
        if (empWorkspace) {
          activeWorkspace = {
            _id: empWorkspace._id,
            name: empWorkspace.name,
            code: empWorkspace.code,
            type: empWorkspace.type,
            role: 'employee',
          };
          workspaces = [activeWorkspace];
        }
      } catch (wsError) {
        console.log('Error fetching employee workspace:', wsError.message);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user._id,
          email: user.email,
          name: userType === 'user' ? user.name : user.employee_name,
          role: userType === 'user' ? user.role : 'employee',
          roles: userType === 'user' ? user.roles : ['employee'],
          department: userType === 'employee' ? user.department_id : undefined,
          emp_no: userType === 'employee' ? user.emp_no : user.employeeId,
          type: userType,
          featureControl: userType === 'user' ? user.featureControl : undefined,
          dataScope: userType === 'user' ? user.dataScope : 'own',
          divisionMapping: userType === 'user' ? user.divisionMapping : undefined,
        },
        workspaces,
        activeWorkspace,
      },
    });
  } catch (error) {
    console.error('[SSOLogin] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during SSO login',
      error: error.message,
    });
  }
};

// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide current and new password',
      });
    }

    let user = await User.findById(req.user.userId).select('+password');
    let userType = 'user';

    if (!user) {
      user = await Employee.findById(req.user.userId).select('+password');
      userType = 'employee';
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Account not found',
      });
    }

    // Verify current password
    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error changing password',
      error: error.message,
    });
  }
};

