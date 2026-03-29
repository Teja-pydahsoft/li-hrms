const Department = require('../model/Department');
const User = require('../../users/model/User');
const Employee = require('../../employees/model/Employee');
const Shift = require('../../shifts/model/Shift');
const Designation = require('../model/Designation');

/**
 * Map Employee-style scope filter to Department schema.
 * Department uses: _id, divisions[] (not division_id, department_id).
 */
function mapScopeFilterForDepartment(scopeFilter) {
  if (!scopeFilter || Object.keys(scopeFilter).length === 0) return {};

  function mapCondition(cond) {
    if (!cond || typeof cond !== 'object') return cond;
    const mapped = {};

    for (const [key, value] of Object.entries(cond)) {
      if (key === '$or') {
        const mappedBranches = value
          .map(mapCondition)
          .filter((b) => b && Object.keys(b).length > 0 && (b.divisions !== undefined || b._id !== undefined || (b.$or && b.$or.length > 0) || (b.$and && b.$and.length > 0)));
        if (mappedBranches.length > 0) mapped.$or = mappedBranches;
      } else if (key === '$and') {
        mapped.$and = value.map(mapCondition).filter((b) => b && Object.keys(b).length > 0);
        if (mapped.$and.length === 0) delete mapped.$and;
      } else if (key === 'division_id' || key === 'division') {
        if (value && value.$in && value.$in.length > 0) {
          mapped.divisions = mapped.divisions || { $in: [] };
          mapped.divisions.$in = [...new Set([...(mapped.divisions.$in || []), ...value.$in])];
        }
      } else if (key === 'department_id' || key === 'department') {
        if (value && value.$in && value.$in.length > 0) {
          mapped._id = mapped._id || { $in: [] };
          mapped._id.$in = [...new Set([...(mapped._id.$in || []), ...value.$in])];
        }
      }
    }

    return Object.keys(mapped).length > 0 ? mapped : null;
  }

  if (scopeFilter.$or) {
    const mappedBranches = scopeFilter.$or.map(mapCondition).filter((b) => b && Object.keys(b).length > 0);
    if (mappedBranches.length === 0) return { _id: null };
    return mappedBranches.length === 1 ? mappedBranches[0] : { $or: mappedBranches };
  }

  const mapped = mapCondition(scopeFilter);
  return mapped || {};
}

// @desc    Get all departments
// @route   GET /api/departments
// @access  Private
// Cache key MUST include userId: result set is scope-filtered per user (divisionMapping).
// Without user in key, User B can get User A's limited list from cache (permission leak).
exports.getAllDepartments = async (req, res) => {
  try {
    const { isActive, division } = req.query;
    const cacheService = require('../../shared/services/cacheService');
    const userId = (req.user && (req.user._id || req.user.userId)) ? String(req.user._id || req.user.userId) : 'anon';
    const cacheKey = `departments:user_${userId}:${isActive || 'any'}:${division || 'all'}`;

    const cachedDepts = await cacheService.get(cacheKey);
    if (cachedDepts && Array.isArray(cachedDepts)) {
      console.log(`[Cache] Serving departments from cache: ${cacheKey}`);
      return res.status(200).json({
        success: true,
        count: cachedDepts.length,
        data: cachedDepts,
        _cached: true
      });
    }

    let query = {};
    if (req.metadataScopeFilter) {
      query = { ...req.metadataScopeFilter };
    } else if (req.scopeFilter) {
      query = mapScopeFilterForDepartment(req.scopeFilter);
    }


    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    if (division) {
      query.divisions = division;
    }

    console.log('Executing Department Query:', JSON.stringify(query));

    const departments = await Department.find(query)
      .populate('hod', 'name email role') // Legacy
      .populate('divisionHODs.hod', 'name email role')
      .populate('divisionHODs.division', 'name code')
      .populate('hr', 'name email role')
      .populate('shifts.shiftId', 'name startTime endTime duration isActive')
      .populate({
        path: 'divisionDefaults.division',
        select: 'name code',
      })
      .populate({
        path: 'divisionDefaults.shifts.shiftId',
        select: 'name startTime endTime duration isActive',
      })
      .populate('designations', 'name code isActive')
      .populate('createdBy', 'name email')
      .sort({ name: 1 })
      .lean();

    const data = Array.isArray(departments) ? departments : [];
    await cacheService.set(cacheKey, data, 600);

    res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error('Error fetching departments:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching departments',
      error: error.message,
    });
  }
};

// @desc    Get single department
// @route   GET /api/departments/:id
// @access  Private
exports.getDepartment = async (req, res) => {
  try {
    const department = await Department.findById(req.params.id)
      .populate('hod', 'name email role')
      .populate('hr', 'name email role')
      .populate('divisionHODs.hod', 'name email role')
      .populate('divisionHODs.division', 'name code')
      .populate('shifts.shiftId', 'name startTime endTime duration isActive')
      .populate({
        path: 'divisionDefaults.division',
        select: 'name code',
      })
      .populate({
        path: 'divisionDefaults.shifts.shiftId',
        select: 'name startTime endTime duration isActive',
      })
      .populate('createdBy', 'name email');

    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    res.status(200).json({
      success: true,
      data: department,
    });
  } catch (error) {
    console.error('Error fetching department:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching department',
      error: error.message,
    });
  }
};

// @desc    Get department employees
// @route   GET /api/departments/:id/employees
// @access  Private
exports.getDepartmentEmployees = async (req, res) => {
  try {
    const department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    const employees = await Employee.find({ department_id: req.params.id })
      .select('-password')
      .populate('department_id', 'name')
      .sort({ employee_name: 1 });

    res.status(200).json({
      success: true,
      count: employees.length,
      data: employees,
    });
  } catch (error) {
    console.error('Error fetching department employees:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching department employees',
      error: error.message,
    });
  }
};

// @desc    Create department
// @route   POST /api/departments
// @access  Private (Super Admin, Sub Admin, HR)
exports.createDepartment = async (req, res) => {
  try {
    const { name, code, description, divisionHODs, hod, divisions } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Department name is required',
      });
    }

    // Validate divisionHODs if provided
    let validDivisionHODs = [];
    if (divisionHODs && Array.isArray(divisionHODs)) {
      for (const dh of divisionHODs) {
        if (dh.division && dh.hod) {
          const userExists = await User.findById(dh.hod);
          if (!userExists) {
            return res.status(400).json({
              success: false,
              message: `HOD User not found for division assignment`,
            });
          }
          validDivisionHODs.push({
            division: dh.division,
            hod: dh.hod
          });
        }
      }
    }
    // Fallback: frontend sends hod + divisions (single or array)
    if (validDivisionHODs.length === 0 && hod) {
      const divIds = Array.isArray(divisions) ? divisions : (divisions ? [divisions] : []);
      if (divIds.length > 0) {
        const hodUser = await User.findById(hod);
        if (!hodUser) {
          return res.status(400).json({
            success: false,
            message: 'HOD User not found for division assignment',
          });
        }
        validDivisionHODs = divIds.map(divId => ({ division: divId, hod }));
      }
    }

    const department = await Department.create({
      name,
      code: code || undefined,
      description: description || undefined,
      hod: null, // Global HOD is deprecated
      divisionHODs: validDivisionHODs,
      divisions: divisions && (Array.isArray(divisions) ? divisions : [divisions]).filter(Boolean),
      createdBy: req.user?.userId,
    });

    if (validDivisionHODs.length > 0) {
      for (const dh of validDivisionHODs) {
        const r = await User.updateOne(
          { _id: dh.hod, 'divisionMapping.division': dh.division },
          { $addToSet: { 'divisionMapping.$.departments': department._id } }
        );
        if (r.matchedCount === 0) {
          await User.updateOne(
            { _id: dh.hod },
            { $push: { divisionMapping: { division: dh.division, departments: [department._id] } } }
          );
        }
      }
    }

    // Clear cache
    const cacheService = require('../../shared/services/cacheService');
    await cacheService.delByPattern('departments:*');

    res.status(201).json({
      success: true,
      message: 'Department created successfully',
      data: department,
    });
  } catch (error) {
    console.error('Error creating department:', error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Department with this name or code already exists',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error creating department',
      error: error.message,
    });
  }
};

// @desc    Update department
// @route   PUT /api/departments/:id
// @access  Private (Super Admin, Sub Admin, HR)
exports.updateDepartment = async (req, res) => {
  try {
    const {
      name,
      code,
      description,
      hod,
      hr,
      attendanceConfig,
      permissionPolicy,
      autoDeductionRules,
      shifts,
      paidLeaves,
      leaveLimits,
      isActive,
      divisions,
    } = req.body;

    const department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    // Validate HOD if provided
    if (hod) {
      const hodUser = await User.findById(hod);
      if (!hodUser) {
        return res.status(400).json({
          success: false,
          message: 'HOD user not found',
        });
      }
    }

    // Validate HR if provided
    if (hr) {
      const hrUser = await User.findById(hr);
      if (!hrUser) {
        return res.status(400).json({
          success: false,
          message: 'HR user not found',
        });
      }
    }

    // Update fields & Sync Users
    if (name) department.name = name;
    if (code !== undefined) department.code = code;
    if (description !== undefined) department.description = description;
    
    if (divisions !== undefined) {
      department.divisions = Array.isArray(divisions) ? divisions : (divisions ? [divisions] : []);
    }

    // Handle Division HODs Sync
    if (req.body.divisionHODs !== undefined) {
      const newDivisionHODs = req.body.divisionHODs;

      // Validate structure (minimal validation, trust valid IDs or frontend checks primarily, but safeguard)
      let validDivisionHODs = [];
      if (Array.isArray(newDivisionHODs)) {
        for (const dh of newDivisionHODs) {
          if (dh.division && dh.hod) {
            // Check if user exists 
            const userExists = await User.findById(dh.hod);
            if (!userExists) {
              return res.status(400).json({ success: false, message: 'Invalid HOD User ID' });
            }

            // Allow same HOD for multiple divisions (in this department or across departments)
            validDivisionHODs.push({ division: dh.division, hod: dh.hod });
          }
        }
      }

      for (const dh of validDivisionHODs) {
        const r = await User.updateOne(
          { _id: dh.hod, 'divisionMapping.division': dh.division },
          { $addToSet: { 'divisionMapping.$.departments': department._id } }
        );
        if (r.matchedCount === 0) {
          await User.updateOne(
            { _id: dh.hod },
            { $push: { divisionMapping: { division: dh.division, departments: [department._id] } } }
          );
        }
      }

      for (const oldDh of department.divisionHODs || []) {
        const stillInNew = validDivisionHODs.some(dh =>
          dh.hod.toString() === oldDh.hod.toString() && dh.division.toString() === oldDh.division.toString()
        );
        if (!stillInNew) {
          await User.updateOne(
            { _id: oldDh.hod, 'divisionMapping.division': oldDh.division },
            { $pull: { 'divisionMapping.$.departments': department._id } }
          );
        }
      }

      department.divisionHODs = validDivisionHODs;
    }

    if (hr !== undefined) {
      if (department.hr && department.hr.toString() !== (hr || '')) {
        const divs = department.divisions || [];
        for (const divId of divs) {
          await User.updateOne(
            { _id: department.hr, 'divisionMapping.division': divId },
            { $pull: { 'divisionMapping.$.departments': department._id } }
          );
        }
      }
      if (hr) {
        const divs = department.divisions || [];
        for (const divId of divs) {
          const r = await User.updateOne(
            { _id: hr, 'divisionMapping.division': divId },
            { $addToSet: { 'divisionMapping.$.departments': department._id } }
          );
          if (r.matchedCount === 0) {
            await User.updateOne(
              { _id: hr },
              { $push: { divisionMapping: { division: divId, departments: [department._id] } } }
            );
          }
        }
      }
      department.hr = hr || null;
    }

    if (attendanceConfig) department.attendanceConfig = { ...department.attendanceConfig, ...attendanceConfig };
    if (permissionPolicy) department.permissionPolicy = { ...department.permissionPolicy, ...permissionPolicy };
    if (autoDeductionRules) department.autoDeductionRules = autoDeductionRules;
    if (shifts !== undefined) {
      // Validate shifts if provided
      if (Array.isArray(shifts) && shifts.length > 0) {
        const shiftDocs = await Shift.find({ _id: { $in: shifts } });
        if (shiftDocs.length !== shifts.length) {
          return res.status(400).json({
            success: false,
            message: 'One or more shifts not found',
          });
        }
      }
      department.shifts = shifts;
    }
    if (paidLeaves !== undefined) department.paidLeaves = Number(paidLeaves);
    if (leaveLimits) department.leaveLimits = { ...department.leaveLimits, ...leaveLimits };
    if (isActive !== undefined) department.isActive = isActive;

    await department.save();

    // Clear cache
    const cacheService = require('../../shared/services/cacheService');
    await cacheService.delByPattern('departments:*');

    res.status(200).json({
      success: true,
      message: 'Department updated successfully',
      data: department,
    });
  } catch (error) {
    console.error('Error updating department:', error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Department with this name or code already exists',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error updating department',
      error: error.message,
    });
  }
};

// @desc    Delete department
// @route   DELETE /api/departments/:id
// @access  Private (Super Admin, Sub Admin)
exports.deleteDepartment = async (req, res) => {
  try {
    const department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    // Check if department has employees
    const employeeCount = await Employee.countDocuments({ department_id: req.params.id });
    if (employeeCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete department. It has ${employeeCount} employee(s) assigned. Please reassign employees first.`,
      });
    }

    const divs = department.divisions || [];
    for (const divId of divs) {
      if (department.hr) {
        await User.updateOne(
          { _id: department.hr, 'divisionMapping.division': divId },
          { $pull: { 'divisionMapping.$.departments': department._id } }
        );
      }
    }
    for (const dh of department.divisionHODs || []) {
      await User.updateOne(
        { _id: dh.hod, 'divisionMapping.division': dh.division },
        { $pull: { 'divisionMapping.$.departments': department._id } }
      );
    }

    await department.deleteOne();

    // Clear cache
    const cacheService = require('../../shared/services/cacheService');
    await cacheService.delByPattern('departments:*');

    res.status(200).json({
      success: true,
      message: 'Department deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting department:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting department',
      error: error.message,
    });
  }
};

// @desc    Assign HOD to department (Division Specific)
// @route   PUT /api/departments/:id/assign-hod
// @access  Private (Super Admin, Sub Admin, HR)
exports.assignHOD = async (req, res) => {
  try {
    const { hodId, divisionId } = req.body;

    if (!hodId) {
      return res.status(400).json({
        success: false,
        message: 'HOD ID is required',
      });
    }

    if (!divisionId) {
      return res.status(400).json({
        success: false,
        message: 'Division ID is required for HOD assignment',
      });
    }

    const department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    const hodUser = await User.findById(hodId);
    if (!hodUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Find existing HOD for this division in this department
    const existingEntryIndex = department.divisionHODs.findIndex(
      dh => dh.division.toString() === divisionId
    );
    const oldHodId = existingEntryIndex > -1 ? department.divisionHODs[existingEntryIndex].hod : null;

    // Sync: Remove this department from old HOD's list (if it was their only link to this department)
    // Actually, simply pulling the department from the old HOD is safer, assuming they don't lead *another* division in this same dept.
    // However, to be precise: "User.departments" is a list of departments they are associated with.
    // If they are removed as HOD for this division, do we remove the department from them?
    // Yes, generally. But we should check if they are HOD for *other* divisions in this same dept?
    // For simplicity, we pull the department. If they are HOD for another division, re-adding it is idempotent.
    // A better approach: distinct lists. But User.departments is simple.
    // Let's stick to the existing pattern: Pull department from old HOD.
    if (oldHodId) {
      await User.updateOne(
        { _id: oldHodId, 'divisionMapping.division': divisionId },
        { $pull: { 'divisionMapping.$.departments': department._id } }
      );
    }

    const r = await User.updateOne(
      { _id: hodId, 'divisionMapping.division': divisionId },
      { $addToSet: { 'divisionMapping.$.departments': department._id } }
    );
    if (r.matchedCount === 0) {
      await User.updateOne(
        { _id: hodId },
        { $push: { divisionMapping: { division: divisionId, departments: [department._id] } } }
      );
    }

    // Update Department Model
    if (existingEntryIndex > -1) {
      department.divisionHODs[existingEntryIndex].hod = hodId;
    } else {
      department.divisionHODs.push({
        division: divisionId,
        hod: hodId
      });
    }

    // Also update legacy field if this is the first HOD or just as a fallback
    // department.hod = hodId; // Optional: Keep strictly division-based now.

    await department.save();

    // Clear cache
    const cacheService = require('../../shared/services/cacheService');
    await cacheService.delByPattern('departments:*');

    res.status(200).json({
      success: true,
      message: 'HOD assigned successfully to division',
      data: department,
    });
  } catch (error) {
    console.error('Error assigning HOD:', error);
    res.status(500).json({
      success: false,
      message: 'Error assigning HOD',
      error: error.message,
    });
  }
};

// @desc    Assign HR to department
// @route   PUT /api/departments/:id/assign-hr
// @access  Private (Super Admin, Sub Admin)
exports.assignHR = async (req, res) => {
  try {
    const { hrId } = req.body;

    if (!hrId) {
      return res.status(400).json({
        success: false,
        message: 'HR ID is required',
      });
    }

    const department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    const hrUser = await User.findById(hrId);
    if (!hrUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (department.hr) {
      const divs = department.divisions || [];
      for (const divId of divs) {
        await User.updateOne(
          { _id: department.hr, 'divisionMapping.division': divId },
          { $pull: { 'divisionMapping.$.departments': department._id } }
        );
      }
    }

    const divs = department.divisions || [];
    for (const divId of divs) {
      const r = await User.updateOne(
        { _id: hrId, 'divisionMapping.division': divId },
        { $addToSet: { 'divisionMapping.$.departments': department._id } }
      );
      if (r.matchedCount === 0) {
        await User.updateOne(
          { _id: hrId },
          { $push: { divisionMapping: { division: divId, departments: [department._id] } } }
        );
      }
    }

    department.hr = hrId;
    await department.save();

    // Clear cache
    const cacheService = require('../../shared/services/cacheService');
    await cacheService.delByPattern('departments:*');

    res.status(200).json({
      success: true,
      message: 'HR assigned successfully',
      data: department,
    });
  } catch (error) {
    console.error('Error assigning HR:', error);
    res.status(500).json({
      success: false,
      message: 'Error assigning HR',
      error: error.message,
    });
  }
};

// @desc    Assign shifts to department
// @route   PUT /api/departments/:id/shifts
// @access  Private (Super Admin, Sub Admin, HR)
exports.assignShifts = async (req, res) => {
  try {
    const { shifts } = req.body;

    if (!Array.isArray(shifts)) {
      return res.status(400).json({
        success: false,
        message: 'shifts must be an array',
      });
    }

    const department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    // Validate all shifts exist
    if (shifts.length > 0) {
      // Extract IDs depending on whether input is object or string (backward compatibility)
      const shiftIds = shifts.map(s => (typeof s === 'string' ? s : s.shiftId));
      const foundShifts = await Shift.find({ _id: { $in: shiftIds } });
      if (foundShifts.length !== shiftIds.length) {
        return res.status(400).json({
          success: false,
          message: 'One or more shifts not found',
        });
      }
    }

    // Ensure we store in the correct format [{ shiftId, gender }]
    const formattedShifts = shifts.map(s => {
      if (typeof s === 'string') return { shiftId: s, gender: 'All' };
      return { shiftId: s.shiftId, gender: s.gender || 'All' };
    });

    department.shifts = formattedShifts;
    await department.save();

    const populatedDepartment = await Department.findById(req.params.id).populate('shifts.shiftId', 'name startTime endTime duration');

    // Clear cache
    const cacheService = require('../../shared/services/cacheService');
    await cacheService.delByPattern('departments:*');

    res.status(200).json({
      success: true,
      message: 'Shifts assigned successfully',
      data: populatedDepartment,
    });
  } catch (error) {
    console.error('Error assigning shifts:', error);
    res.status(500).json({
      success: false,
      message: 'Error assigning shifts',
      error: error.message,
    });
  }
};

// @desc    Get department configuration
// @route   GET /api/departments/:id/configuration
// @access  Private
exports.getDepartmentConfiguration = async (req, res) => {
  try {
    const department = await Department.findById(req.params.id)
      .populate('shifts.shiftId', 'name startTime endTime duration isActive')
      .populate('hod', 'name email role')
      .populate('hr', 'name email role');

    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    // Get designations linked to this department
    const designations = await Designation.find({
      _id: { $in: department.designations || [] },
      isActive: true
    }).select('name code deductionRules paidLeaves');

    res.status(200).json({
      success: true,
      data: {
        department,
        designations,
        configuration: {
          attendanceConfig: department.attendanceConfig,
          permissionPolicy: department.permissionPolicy,
          autoDeductionRules: department.autoDeductionRules,
          leaveLimits: department.leaveLimits,
          paidLeaves: department.paidLeaves,
          shifts: department.shifts,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching department configuration:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching department configuration',
      error: error.message,
    });
  }
};

// @desc    Update department paid leaves
// @route   PUT /api/departments/:id/paid-leaves
// @access  Private (Super Admin, Sub Admin, HR)
exports.updatePaidLeaves = async (req, res) => {
  try {
    const { paidLeaves } = req.body;

    if (paidLeaves === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Paid leaves count is required',
      });
    }

    const department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    department.paidLeaves = Number(paidLeaves);

    await department.save();

    res.status(200).json({
      success: true,
      message: 'Paid leaves updated successfully',
      data: { paidLeaves: department.paidLeaves },
    });
  } catch (error) {
    console.error('Error updating paid leaves:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating paid leaves',
      error: error.message,
    });
  }
};

// @desc    Update department leave limits
// @route   PUT /api/departments/:id/leave-limits
// @access  Private (Super Admin, Sub Admin, HR)
exports.updateLeaveLimits = async (req, res) => {
  try {
    const { dailyLimit, monthlyLimit } = req.body;

    const department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    if (dailyLimit !== undefined) department.leaveLimits.dailyLimit = dailyLimit;
    if (monthlyLimit !== undefined) department.leaveLimits.monthlyLimit = monthlyLimit;

    await department.save();

    res.status(200).json({
      success: true,
      message: 'Leave limits updated successfully',
      data: department.leaveLimits,
    });
  } catch (error) {
    console.error('Error updating leave limits:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating leave limits',
      error: error.message,
    });
  }
};

// @desc    Update department configuration
// @route   PUT /api/departments/:id/configuration
// @access  Private (Super Admin, Sub Admin, HR)
exports.updateDepartmentConfiguration = async (req, res) => {
  try {
    const {
      attendanceConfig,
      permissionPolicy,
      autoDeductionRules,
      leaveLimits,
      paidLeaves,
    } = req.body;

    const department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    if (attendanceConfig) {
      department.attendanceConfig = { ...department.attendanceConfig, ...attendanceConfig };
    }

    if (permissionPolicy) {
      department.permissionPolicy = { ...department.permissionPolicy, ...permissionPolicy };
    }

    if (autoDeductionRules) {
      department.autoDeductionRules = autoDeductionRules;
    }

    if (leaveLimits) {
      department.leaveLimits = { ...department.leaveLimits, ...leaveLimits };
    }

    if (paidLeaves !== undefined) {
      department.paidLeaves = Number(paidLeaves);
    }

    await department.save();

    const populatedDepartment = await Department.findById(req.params.id)
      .populate('shifts', 'name startTime endTime duration')
      .populate('hod', 'name email role')
      .populate('hr', 'name email role');

    res.status(200).json({
      success: true,
      message: 'Department configuration updated successfully',
      data: populatedDepartment,
    });
  } catch (error) {
    console.error('Error updating department configuration:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating department configuration',
      error: error.message,
    });
  }
};


