const Shift = require('../model/Shift');
const ShiftDuration = require('../model/ShiftDuration');
const Division = require('../../departments/model/Division');
const Department = require('../../departments/model/Department');
const Designation = require('../../departments/model/Designation');
const User = require('../../users/model/User');
const mongoose = require('mongoose');

// @desc    Get all shifts
// @route   GET /api/shifts
// @access  Private
exports.getAllShifts = async (req, res) => {
  try {
    const { isActive } = req.query;
    const cacheService = require('../../shared/services/cacheService');
    const cacheKey = `shifts:all:${isActive || 'any'}`;

    // Try to get from cache
    const cachedShifts = await cacheService.get(cacheKey);
    if (cachedShifts) {
      console.log(`[Cache] Serving shifts from cache: ${cacheKey}`);
      return res.status(200).json({
        success: true,
        count: cachedShifts.length,
        data: cachedShifts,
        _cached: true
      });
    }

    const query = {};
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    const shifts = await Shift.find(query)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    // Store in cache for 10 minutes
    await cacheService.set(cacheKey, shifts, 600);

    res.status(200).json({
      success: true,
      count: shifts.length,
      data: shifts,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching shifts',
      error: error.message,
    });
  }
};

// @desc    Get scoped structured shift data (Divisions -> Departments -> Designations)
// @route   GET /api/shifts/scoped
// @access  Private
exports.getScopedShiftData = async (req, res) => {
  try {
    const userId = req.user.userId;
    // We assume req.user has role, but we need full data scope details
    const user = await User.findById(userId)
      .select('role dataScope divisionMapping')
      .populate('divisionMapping.division')
      .populate('divisionMapping.departments');

    if (!user) {
      // Fallback for Employee login if needed, though they usually use simple views
      return res.status(200).json({
        success: true,
        data: { divisions: [], departments: [], designations: [] }
      });
    }

    const { role, dataScope } = user;
    const isGlobal = ['super_admin', 'sub_admin'].includes(role);

    let divisions = [];
    let departments = [];
    let designations = [];

    let divQuery = { isActive: true };
    // If NOT global AND has divisionMapping, then restrict. 
    // If divisionMapping is empty/null, show all (per user request).
    if (!isGlobal && user.divisionMapping && user.divisionMapping.length > 0) {
      const allowedDivIds = new Set(
        user.divisionMapping.map(dm => (dm.division?._id || dm.division)?.toString()).filter(Boolean)
      );
      if (allowedDivIds.size > 0) divQuery._id = { $in: Array.from(allowedDivIds) };
      else divQuery._id = { $in: [] };
    }

    // Fetch divisions with correctly populated shifts
    divisions = await Division.find(divQuery)
      .populate('shifts.shiftId')
      .lean();

    let deptQuery = { isActive: true };
    if (!isGlobal && user.divisionMapping && user.divisionMapping.length > 0) {
      const allowedDeptIds = user.divisionMapping.flatMap(dm =>
        (dm.departments || []).map(d => d?._id || d)
      ).filter(Boolean);

      if (allowedDeptIds.length > 0) {
        deptQuery._id = { $in: allowedDeptIds };
      } else if (divisions.length > 0) {
        // If divMapping has divisions but no specific departments, allowed all depts in those divisions
        deptQuery.divisions = { $in: divisions.map(d => d._id) };
      } else {
        deptQuery._id = { $in: [] };
      }
    }

    // Fetch departments with correctly populated shifts
    departments = await Department.find(deptQuery)
      .populate('shifts.shiftId')
      .populate('divisionDefaults.shifts.shiftId')
      .populate('designations')
      .lean();

    // 3. DESIGNATIONS
    const deptIds = departments.map(d => d._id);
    let desQuery = { isActive: true };

    if (!isGlobal && user.divisionMapping && user.divisionMapping.length > 0) {
      if (deptIds.length > 0) {
        desQuery.department = { $in: deptIds };
      } else {
        desQuery._id = { $in: [] };
      }
    }

    designations = await Designation.find(desQuery)
      .populate('shifts.shiftId')
      .populate('departmentShifts.shifts.shiftId')
      .populate('divisionDefaults.shifts.shiftId')
      .lean();

    res.status(200).json({
      success: true,
      data: {
        divisions,
        departments,
        designations
      }
    });

  } catch (error) {
    console.error('Error fetching scoped shift data:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching scoped shift data',
      error: error.message
    });
  }
};

// @desc    Get single shift
// @route   GET /api/shifts/:id
// @access  Private
exports.getShift = async (req, res) => {
  try {
    const shift = await Shift.findById(req.params.id).populate('createdBy', 'name email');

    if (!shift) {
      return res.status(404).json({
        success: false,
        message: 'Shift not found',
      });
    }

    res.status(200).json({
      success: true,
      data: shift,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching shift',
      error: error.message,
    });
  }
};

// @desc    Create new shift
// @route   POST /api/shifts
// @access  Private (Super Admin, Sub Admin, HR)
exports.createShift = async (req, res) => {
  try {
    const { name, startTime, endTime, duration, payableShifts, color } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Shift name is required',
      });
    }

    // Get allowed durations from ShiftDuration model
    let allowedDurations = [];
    try {
      const durationDocs = await ShiftDuration.find({ isActive: true }).select('duration');
      allowedDurations = durationDocs.map((d) => d.duration);
    } catch (err) {
      console.warn('ShiftDuration model not available, skipping validation:', err.message);
      // If ShiftDuration doesn't exist yet, allow all durations
    }

    let finalDuration = duration;
    let finalStartTime = startTime;
    let finalEndTime = endTime;

    // If duration is provided, calculate end time from start time
    if (duration && startTime && !endTime) {
      const [startHour, startMin] = startTime.split(':').map(Number);
      const startMinutes = startHour * 60 + startMin;
      const endMinutes = startMinutes + duration * 60;
      const endHours = Math.floor(endMinutes / 60) % 24;
      const endMins = endMinutes % 60;
      finalEndTime = `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`;
    }
    // If start and end are provided, calculate duration
    else if (startTime && endTime && !duration) {
      const [startHour, startMin] = startTime.split(':').map(Number);
      const [endHour, endMin] = endTime.split(':').map(Number);

      let startMinutes = startHour * 60 + startMin;
      let endMinutes = endHour * 60 + endMin;

      // Handle overnight shifts
      if (endMinutes <= startMinutes) {
        endMinutes += 24 * 60;
      }

      const durationMinutes = endMinutes - startMinutes;
      finalDuration = Math.round((durationMinutes / 60) * 100) / 100;
    }

    // Validate duration against allowed durations (Warning only in logs)
    if (allowedDurations.length > 0) {
      const isAllowed = allowedDurations.some(
        (allowed) => Math.abs(allowed - finalDuration) < 0.01
      );

      if (!isAllowed) {
        console.warn(`Creating shift with non-standard duration: ${finalDuration} hours`);
      }
    }

    // Validate that we have all required fields
    if (!finalStartTime || !finalEndTime || !finalDuration) {
      return res.status(400).json({
        success: false,
        message: 'Either provide (name, startTime, endTime) or (name, startTime, duration)',
      });
    }

    // Create shift
    const shift = await Shift.create({
      name,
      startTime: finalStartTime,
      endTime: finalEndTime,
      duration: finalDuration,
      payableShifts: payableShifts !== undefined ? Number(payableShifts) : 1,
      color: color || '#3b82f6',
      createdBy: req.user?.userId,
    });

    // Clear cache
    const cacheService = require('../../shared/services/cacheService');
    await cacheService.delByPattern('shifts:*');

    // LINK TO DIVISION IF NOT GLOBAL
    // If the user has a specific division mapping and is not a super_admin/sub_admin,
    // automatically link this new shift to their assigned divisions.
    const isGlobal = ['super_admin', 'sub_admin'].includes(req.user.role || '');
    if (!isGlobal && req.user.divisionMapping && req.user.divisionMapping.length > 0) {
      try {
        const Division = require('../../departments/model/Division');
        const divisionIds = req.user.divisionMapping.map(m => m.division);
        
        await Division.updateMany(
          { _id: { $in: divisionIds } },
          { 
            $addToSet: { 
              shifts: { 
                shiftId: shift._id, 
                gender: 'All' 
              } 
            } 
          }
        );
      } catch (linkErr) {
        console.error('Error linking new shift to divisions:', linkErr);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Shift created successfully',
      data: shift,
    });
  } catch (error) {
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Shift with this name already exists',
      });
    }

    console.error('Error creating shift:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating shift',
      error: error.message,
    });
  }
};

// @desc    Update shift
// @route   PUT /api/shifts/:id
// @access  Private (Super Admin, Sub Admin, HR)
exports.updateShift = async (req, res) => {
  try {
    const { name, startTime, endTime, duration, payableShifts, isActive, color } = req.body;

    const shift = await Shift.findById(req.params.id);
    if (!shift) {
      return res.status(404).json({
        success: false,
        message: 'Shift not found',
      });
    }

    // Get allowed durations from ShiftDuration model
    let allowedDurations = [];
    try {
      const durationDocs = await ShiftDuration.find({ isActive: true }).select('duration');
      allowedDurations = durationDocs.map((d) => d.duration);
    } catch (err) {
      console.warn('ShiftDuration model not available, skipping validation:', err.message);
    }

    // Update fields
    if (name) shift.name = name;
    if (startTime) shift.startTime = startTime;
    if (endTime) shift.endTime = endTime;
    if (payableShifts !== undefined) shift.payableShifts = Number(payableShifts);
    if (isActive !== undefined) shift.isActive = isActive;
    if (color) shift.color = color;

    // Recalculate duration if times changed
    if (startTime || endTime) {
      const finalStartTime = startTime || shift.startTime;
      const finalEndTime = endTime || shift.endTime;

      const [startHour, startMin] = finalStartTime.split(':').map(Number);
      const [endHour, endMin] = finalEndTime.split(':').map(Number);

      let startMinutes = startHour * 60 + startMin;
      let endMinutes = endHour * 60 + endMin;

      if (endMinutes <= startMinutes) {
        endMinutes += 24 * 60;
      }

      const durationMinutes = endMinutes - startMinutes;
      shift.duration = Math.round((durationMinutes / 60) * 100) / 100;
    } else if (duration) {
      shift.duration = duration;
    }

    // Validate duration (Warning only)
    if (allowedDurations.length > 0) {
      const isAllowed = allowedDurations.some(
        (allowed) => Math.abs(allowed - shift.duration) < 0.01
      );

      if (!isAllowed) {
        console.warn(`Updating shift with non-standard duration: ${shift.duration} hours`);
      }
    }

    await shift.save();

    // Clear cache
    const cacheService = require('../../shared/services/cacheService');
    await cacheService.delByPattern('shifts:*');

    res.status(200).json({
      success: true,
      message: 'Shift updated successfully',
      data: shift,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Shift with this name already exists',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error updating shift',
      error: error.message,
    });
  }
};

// @desc    Delete shift
// @route   DELETE /api/shifts/:id
// @access  Private (Super Admin, Sub Admin)
exports.deleteShift = async (req, res) => {
  try {
    const shift = await Shift.findById(req.params.id);
    if (!shift) {
      return res.status(404).json({
        success: false,
        message: 'Shift not found',
      });
    }

    await shift.deleteOne();

    // Clear cache
    const cacheService = require('../../shared/services/cacheService');
    await cacheService.delByPattern('shifts:*');

    res.status(200).json({
      success: true,
      message: 'Shift deleted successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting shift',
      error: error.message,
    });
  }
};

// @desc    Get allowed shift durations
// @route   GET /api/shifts/durations
// @access  Private
exports.getAllowedDurations = async (req, res) => {
  try {
    const durationDocs = await ShiftDuration.find({ isActive: true }).sort({ duration: 1 });
    const allowedDurations = durationDocs.map((d) => d.duration);

    res.status(200).json({
      success: true,
      data: allowedDurations,
      durations: durationDocs, // Full objects with labels
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching allowed durations',
      error: error.message,
    });
  }
};

