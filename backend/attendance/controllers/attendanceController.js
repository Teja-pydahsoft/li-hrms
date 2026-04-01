/**
 * Attendance Controller
 * Handles attendance data retrieval and display
 */

const AttendanceRawLog = require('../model/AttendanceRawLog');
const AttendanceDaily = require('../model/AttendanceDaily');
const Employee = require('../../employees/model/Employee');
const Shift = require('../../shifts/model/Shift');
const Leave = require('../../leaves/model/Leave');
const OD = require('../../leaves/model/OD');
const MonthlyAttendanceSummary = require('../model/MonthlyAttendanceSummary');
const { calculateMonthlySummary } = require('../services/summaryCalculationService');
const Settings = require('../../settings/model/Settings');
const { extractISTComponents } = require('../../shared/utils/dateUtils');

/**
 * Format date to YYYY-MM-DD
 */
const formatDate = (date) => {
  return extractISTComponents(date).dateStr;
};

/**
 * @desc    Get attendance records for calendar view
 * @route   GET /api/attendance/calendar
 * @access  Private
 */
exports.getAttendanceCalendar = async (req, res) => {
  try {
    const { employeeNumber, year, month } = req.query;

    if (!employeeNumber) {
      return res.status(400).json({
        success: false,
        message: 'Employee number is required',
      });
    }

    // Default to current month if not provided (IST Aware)
    const { year: curYear, month: curMonth } = extractISTComponents(new Date());
    const targetYear = parseInt(year) || curYear;
    const targetMonth = parseInt(month) || curMonth;

    // Get employee with scope validation
    const employee = await Employee.findOne({
      ...req.scopeFilter,
      emp_no: employeeNumber.toUpperCase(),
      is_active: { $ne: false }
    });

    if (!employee) {
      return res.status(403).json({
        success: false,
        message: 'Access denied or employee not found',
      });
    }

    const { getCalendarViewData } = require('../services/attendanceViewService');
    const attendanceMap = await getCalendarViewData(employee, targetYear, targetMonth);

    res.status(200).json({
      success: true,
      data: attendanceMap,
      year: targetYear,
      month: targetMonth,
    });

  } catch (error) {
    console.error('Error fetching attendance calendar:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch attendance calendar',
    });
  }
};

/**
 * @desc    Get attendance records for list view
 * @route   GET /api/attendance/list
 * @access  Private
 */
exports.getAttendanceList = async (req, res) => {
  try {
    const { employeeNumber, startDate, endDate, page = 1, limit = 30 } = req.query;

    if (!employeeNumber) {
      return res.status(400).json({
        success: false,
        message: 'Employee number is required',
      });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required',
      });
    }

    // Scope validation
    const allowedEmployee = await Employee.findOne({
      ...req.scopeFilter,
      emp_no: employeeNumber.toUpperCase()
    });

    if (!allowedEmployee) {
      return res.status(403).json({
        success: false,
        message: 'Access denied or employee not found',
      });
    }

    const query = {
      employeeNumber: employeeNumber.toUpperCase(),
      date: { $gte: startDate, $lte: endDate },
    };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const records = await AttendanceDaily.find(query)
      .populate('shifts.shiftId', 'name startTime endTime duration')
      .sort({ date: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await AttendanceDaily.countDocuments(query);

    res.status(200).json({
      success: true,
      data: records,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });

  } catch (error) {
    console.error('Error fetching attendance list:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch attendance list',
    });
  }
};

/**
 * @desc    Get available shifts for an employee for a specific date
 * @route   GET /api/attendance/:employeeNumber/:date/available-shifts
 * @access  Private
 */
exports.getAvailableShifts = async (req, res) => {
  try {
    const { employeeNumber, date } = req.params;

    const { getShiftsForEmployee } = require('../../shifts/services/shiftDetectionService');
    const { shifts, source } = await getShiftsForEmployee(employeeNumber, date);

    res.status(200).json({
      success: true,
      data: shifts,
      source: source,
    });

  } catch (error) {
    console.error('Error fetching available shifts:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching available shifts',
      error: error.message,
    });
  }
};

/**
 * @desc    Get attendance detail for a specific date
 * @route   GET /api/attendance/detail
 * @access  Private
 */
exports.getAttendanceDetail = async (req, res) => {
  try {
    const { employeeNumber, date } = req.query;

    if (!employeeNumber || !date) {
      return res.status(400).json({
        success: false,
        message: 'Employee number and date are required',
      });
    }

    // Scope validation
    const allowedEmployee = await Employee.findOne({
      ...req.scopeFilter,
      emp_no: employeeNumber.toUpperCase()
    });

    if (!allowedEmployee) {
      return res.status(403).json({
        success: false,
        message: 'Access denied or employee not found',
      });
    }

    const record = await AttendanceDaily.findOne({
      employeeNumber: employeeNumber.toUpperCase(),
      date: date,
    })
      .populate('shifts.shiftId', 'name startTime endTime duration gracePeriod');

    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found',
      });
    }

    // Also fetch raw logs for that day
    const rawLogs = await AttendanceRawLog.find({
      employeeNumber: employeeNumber.toUpperCase(),
      date: date,
    }).sort({ timestamp: 1 });

    // Check for OT request (pending or approved) for Convert button logic
    const OT = require('../../overtime/model/OT');
    const otRequest = await OT.findOne({
      employeeId: allowedEmployee._id,
      date: date,
      status: { $in: ['pending', 'approved', 'manager_approved', 'hod_approved'] },
      isActive: true,
    }).select('status otHours').lean();

    res.status(200).json({
      success: true,
      data: {
        ...record.toObject(),
        rawLogs,
        otRequest: otRequest ? { status: otRequest.status, otHours: otRequest.otHours } : null,
        leftDate: allowedEmployee.leftDate || null,
      },
    });

  } catch (error) {
    console.error('Error fetching attendance detail:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch attendance detail',
    });
  }
};

/**
 * @desc    Get all employees with their attendance summary
 * @route   GET /api/attendance/employees
 * @access  Private
 */
exports.getEmployeesWithAttendance = async (req, res) => {
  try {
    const { date, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get paginated employees within scope
    const employees = await Employee.find({
      ...req.scopeFilter,
      is_active: { $ne: false }
    })
      .select('emp_no employee_name department_id designation_id')
      .populate('department_id', 'name')
      .populate('designation_id', 'name')
      .sort({ emp_no: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Employee.countDocuments({
      ...req.scopeFilter,
      is_active: { $ne: false }
    });

    // If date provided, get attendance for that date for these SPECIFIC employees
    let attendanceMap = {};
    if (date) {
      const empNos = employees.map(e => e.emp_no);
      const records = await AttendanceDaily.find({
        date,
        employeeNumber: { $in: empNos }
      });
      records.forEach(record => {
        attendanceMap[record.employeeNumber] = record;
      });
    }

    const employeesWithAttendance = employees.map(emp => ({
      ...emp.toObject(),
      attendance: attendanceMap[emp.emp_no] || null,
    }));

    res.status(200).json({
      success: true,
      data: employeesWithAttendance,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Error fetching employees with attendance:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch employees with attendance',
    });
  }
};

/**
 * @desc    Get all employees attendance for a month (for table view)
 * @route   GET /api/attendance/monthly
 * @access  Private
 */
exports.getMonthlyAttendance = async (req, res) => {
  try {
    const { year, month, page = 1, limit = 20, search, divisionId, departmentId, designationId, startDate, endDate } = req.query;

    if (!year || !month) {
      return res.status(400).json({
        success: false,
        message: 'Year and month are required',
      });
    }

    // Build filter based on scope and provided filters
    const filter = { ...req.scopeFilter, is_active: { $ne: false } };

    if (search) {
      filter.$or = [
        { employee_name: { $regex: search, $options: 'i' } },
        { emp_no: { $regex: search, $options: 'i' } }
      ];
    }

    if (divisionId) filter.division_id = divisionId;
    if (departmentId) filter.department_id = departmentId;
    if (designationId) filter.designation_id = designationId;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get paginated active employees
    const employees = await Employee.find(filter)
      .populate('division_id', 'name')
      .populate('department_id', 'name')
      .populate('designation_id', 'name')
      .sort({ employee_name: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalEmployees = await Employee.countDocuments(filter);

    const { getMonthlyTableViewData } = require('../services/attendanceViewService');
    const employeesWithAttendance = await getMonthlyTableViewData(employees, year, month, startDate, endDate);

    res.status(200).json({
      success: true,
      data: employeesWithAttendance,
      pagination: {
        total: totalEmployees,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(totalEmployees / parseInt(limit))
      },
      month: parseInt(month),
      year: parseInt(year),
      daysInMonth: new Date(parseInt(year), parseInt(month), 0).getDate(),
      startDate,
      endDate
    });

  } catch (error) {
    console.error('Error fetching monthly attendance:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch monthly attendance',
    });
  }
};

/**
 * @desc    Update outTime for attendance record (for PARTIAL attendance)
 * @route   PUT /api/attendance/:employeeNumber/:date/outtime
 * @access  Private (Super Admin, Sub Admin, HR, HOD)
 */
exports.updateOutTime = async (req, res) => {
  try {
    const { employeeNumber, date } = req.params;
    const { outTime, shiftRecordId } = req.body;

    const AttendanceSettings = require('../model/AttendanceSettings');
    const attSettings = await AttendanceSettings.getSettings();
    if (attSettings?.featureFlags?.allowOutTimeEditing === false) {
      return res.status(403).json({
        success: false,
        message: 'Out-time editing is disabled by settings.',
      });
    }

    // Restrict to HR/Superadmin/Subadmin
    if (!req.user || (req.user.role !== 'hr' && req.user.role !== 'sub_admin' && req.user.role !== 'super_admin' && req.user.role !== 'superadmin' && req.user.role !== 'admin')) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied. Only HR and Admins can edit attendance details.'
      });
    }

    if (!outTime) {
      return res.status(400).json({
        success: false,
        message: 'Out time is required',
      });
    }

    // Get attendance record
    const AttendanceDaily = require('../model/AttendanceDaily');
    const Shift = require('../../shifts/model/Shift');
    const Settings = require('../../settings/model/Settings');

    // Fetch global general settings
    const generalConfig = await Settings.getSettingsByCategory('general');

    const attendanceRecord = await AttendanceDaily.findOne({
      employeeNumber: employeeNumber.toUpperCase(),
      date: date,
    }).populate('shifts.shiftId');

    if (!attendanceRecord) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found',
      });
    }

    // Ensure we have shifts
    if (!attendanceRecord.shifts || attendanceRecord.shifts.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No shifts found for this attendance record',
      });
    }

    // Determine which shift to update
    let shiftSegment;

    if (shiftRecordId) {
      shiftSegment = attendanceRecord.shifts.id(shiftRecordId);
      if (!shiftSegment) {
        return res.status(404).json({
          success: false,
          message: 'Shift segment not found',
        });
      }
    } else {
      // Default to the last shift if not specified
      shiftSegment = attendanceRecord.shifts.find(s => !s.outTime) || attendanceRecord.shifts[attendanceRecord.shifts.length - 1];
    }

    // Check if shift has inTime
    if (!shiftSegment.inTime) {
      return res.status(400).json({
        success: false,
        message: 'Shift segment has no in-time',
      });
    }

    // Ensure outTime is a Date object
    let outTimeDate = outTime instanceof Date ? outTime : new Date(outTime);

    if (isNaN(outTimeDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid out time format',
      });
    }

    // Get shift details
    let shiftDetails = shiftSegment.shiftId;
    // If shiftId is just an ID (not populated), fetch it
    if (shiftDetails && !shiftDetails.startTime) {
      shiftDetails = await Shift.findById(shiftSegment.shiftId);
    }

    // Handle overnight logic
    let isOvernightShift = false;
    if (shiftDetails && shiftDetails.startTime && shiftDetails.endTime) {
      const [startH, startM] = shiftDetails.startTime.split(':').map(Number);
      const [endH, endM] = shiftDetails.endTime.split(':').map(Number);
      isOvernightShift = startH > 20 || (endH * 60 + endM) < (startH * 60 + startM);
    }

    // Auto-adjust date if needed (e.g. if outTime is earlier than inTime on same date)
    if (outTimeDate < shiftSegment.inTime && outTimeDate.toDateString() === shiftSegment.inTime.toDateString()) {
      outTimeDate.setDate(outTimeDate.getDate() + 1);
    }

    // Update outTime
    shiftSegment.outTime = outTimeDate;

    // Mark as manually edited
    if (!attendanceRecord.source) attendanceRecord.source = [];
    if (!attendanceRecord.source.includes('manual')) {
      attendanceRecord.source.push('manual');
    }

    attendanceRecord.isEdited = true;
    attendanceRecord.editHistory.push({
      action: 'OUT_TIME_UPDATE',
      modifiedBy: req.user._id,
      modifiedByName: req.user.name,
      modifiedAt: new Date(),
      details: `Out time updated manually to ${outTimeDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}`
    });

    // Recalculate metrics for this segment
    if (shiftDetails) {
      const { calculateLateIn, calculateEarlyOut } = require('../../shifts/services/shiftDetectionService');
      const globalLateInGrace = generalConfig.late_in_grace_time ?? null;
      const globalEarlyOutGrace = generalConfig.early_out_grace_time ?? null;

      // 1. Recalculate Late In
      if (shiftSegment.inTime) {
        const lateIn = calculateLateIn(
          shiftSegment.inTime,
          shiftDetails.startTime,
          shiftDetails.gracePeriod,
          date,
          globalLateInGrace
        );
        shiftSegment.lateInMinutes = lateIn > 0 ? lateIn : 0;
        shiftSegment.isLateIn = lateIn > 0;
      }

      // 2. Recalculate Early Out
      const earlyOutMinutes = calculateEarlyOut(
        shiftSegment.outTime,
        shiftDetails.endTime,
        shiftDetails.startTime,
        date,
        globalEarlyOutGrace
      );

      shiftSegment.earlyOutMinutes = earlyOutMinutes > 0 ? earlyOutMinutes : 0;
      shiftSegment.isEarlyOut = earlyOutMinutes > 0;

      // 3. Recalculate Extra Hours
      shiftSegment.extraHours = 0;
      if (shiftSegment.outTime) {
        const { createDateWithOffset } = require('../../shifts/services/shiftDetectionService');
        const [endH, endM] = shiftDetails.endTime.split(':').map(Number);

        // Calculate shift end date robustly
        let shiftEndDate = createDateWithOffset(date, shiftDetails.endTime);

        // Handle overnight shift end date
        if (isOvernightShift) {
          shiftEndDate.setDate(shiftEndDate.getDate() + 1);
        }

        const grace = shiftDetails.gracePeriod || 15;
        shiftEndDate.setMinutes(shiftEndDate.getMinutes() + grace);

        if (shiftSegment.outTime > shiftEndDate) {
          const diffMs = shiftSegment.outTime - shiftEndDate;
          shiftSegment.extraHours = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
        }
      }

      // 4. Recalculate Working Hours
      if (shiftSegment.inTime && shiftSegment.outTime) {
        const diffMs = shiftSegment.outTime - shiftSegment.inTime;
        const hours = diffMs / (1000 * 60 * 60);
        shiftSegment.punchHours = Math.round(hours * 100) / 100;
        shiftSegment.workingHours = Math.round(((shiftSegment.punchHours || 0) + (shiftSegment.odHours || 0)) * 100) / 100;
      }

      // 5. Recalculate Status and Payable
      const durationHours = shiftDetails.duration > 20 ? (shiftDetails.duration / 60) : (shiftDetails.duration || 8);
      let basePayable = shiftDetails.payableShifts ?? 1;
      shiftSegment.expectedHours = Math.round(durationHours * 100) / 100;

      if (shiftSegment.workingHours >= (durationHours * 0.9)) {
        shiftSegment.status = 'PRESENT';
        shiftSegment.payableShift = basePayable;
      } else if (shiftSegment.workingHours >= (durationHours * 0.45)) {
        shiftSegment.status = 'HALF_DAY';
        shiftSegment.payableShift = basePayable * 0.5;
      } else {
        shiftSegment.status = 'ABSENT';
        shiftSegment.payableShift = 0;
      }
    }

    // Save the record to trigger pre-save hooks (which calculate global aggregates)
    await attendanceRecord.save();

    res.status(200).json({
      success: true,
      message: 'Out time updated successfully',
      data: attendanceRecord,
    });

  } catch (error) {
    console.error('Error updating out time:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};

/**
 * @desc    Manually assign shift to attendance record
 * @route   PUT /api/attendance/:employeeNumber/:date/shift
 * @access  Private (Super Admin, Sub Admin, HR, HOD)
 */
exports.assignShift = async (req, res) => {
  try {
    const { employeeNumber, date } = req.params;
    const { shiftId, shiftRecordId } = req.body;

    // Restrict to HR/Superadmin/Subadmin
    if (!req.user || (req.user.role !== 'hr' && req.user.role !== 'sub_admin' && req.user.role !== 'super_admin' && req.user.role !== 'superadmin' && req.user.role !== 'admin')) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied. Only HR and Admins can assign shifts.'
      });
    }

    if (!shiftId) {
      return res.status(400).json({
        success: false,
        message: 'Shift ID is required',
      });
    }

    // Get attendance record
    const AttendanceDaily = require('../model/AttendanceDaily');
    const Shift = require('../../shifts/model/Shift');
    const Settings = require('../../settings/model/Settings');

    const attendanceRecord = await AttendanceDaily.findOne({
      employeeNumber: employeeNumber.toUpperCase(),
      date: date,
    }).populate('shifts.shiftId');

    if (!attendanceRecord) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found',
      });
    }

    // Verify shift exists
    const shift = await Shift.findById(shiftId);
    if (!shift) {
      return res.status(404).json({
        success: false,
        message: 'Shift not found',
      });
    }

    // Delete ConfusedShift if it exists for this date
    const ConfusedShift = require('../../shifts/model/ConfusedShift');
    const confusedShift = await ConfusedShift.findOne({
      employeeNumber: employeeNumber.toUpperCase(),
      date: date,
      status: 'pending',
    });

    if (confusedShift) {
      confusedShift.status = 'resolved';
      confusedShift.assignedShiftId = shiftId;
      confusedShift.reviewedBy = req.user?.userId || req.user?._id;
      confusedShift.reviewedAt = new Date();
      await confusedShift.save();
    }

    // Ensure we have shifts
    if (!attendanceRecord.shifts || attendanceRecord.shifts.length === 0) {
      // If legacy data with no shifts array, we might need to migrate on the fly or fail?
      // Ideally migration script handled this.
      // Let's check if we can create one from root if needed? 
      // No, assuming migration is done.
      return res.status(400).json({
        success: false,
        message: 'No shifts found for this attendance record',
      });
    }

    let shiftSegment;
    if (shiftRecordId) {
      shiftSegment = attendanceRecord.shifts.id(shiftRecordId);
      if (!shiftSegment) {
        return res.status(404).json({
          success: false,
          message: 'Shift segment not found',
        });
      }
    } else {
      // Default to finding a segment that matches or just the first one?
      // If assigning a shift, we usually want to assign it to the 'current' or 'main' shift.
      // Taking the first one or the one without a valid shiftId?
      shiftSegment = attendanceRecord.shifts[0];
    }

    // Update shift details
    shiftSegment.shiftId = shiftId;
    shiftSegment.shiftName = shift.name;
    shiftSegment.shiftStartTime = shift.startTime;
    shiftSegment.shiftEndTime = shift.endTime;
    shiftSegment.duration = shift.duration; // Assuming duration is in minutes

    // Recalculate metrics
    const { calculateLateIn, calculateEarlyOut } = require('../../shifts/services/shiftDetectionService');
    const generalConfig = await Settings.getSettingsByCategory('general');
    const globalLateInGrace = generalConfig.late_in_grace_time ?? null;
    const globalEarlyOutGrace = generalConfig.early_out_grace_time ?? null;

    // Recalculate Late In
    if (shiftSegment.inTime) {
      const lateIn = calculateLateIn(shiftSegment.inTime, shift.startTime, shift.gracePeriod || 15, date, globalLateInGrace);
      shiftSegment.lateInMinutes = lateIn > 0 ? lateIn : 0;
      shiftSegment.isLateIn = lateIn > 0;
    }

    // Recalculate Early Out
    if (shiftSegment.outTime) {
      const earlyOut = calculateEarlyOut(shiftSegment.outTime, shift.endTime, shift.startTime, date, globalEarlyOutGrace);
      shiftSegment.earlyOutMinutes = earlyOut > 0 ? earlyOut : 0;
      shiftSegment.isEarlyOut = earlyOut > 0;

      // Recalculate Extra Hours
      // Reset extra hours
      shiftSegment.extraHours = 0;

      const { createDateWithOffset } = require('../../shifts/services/shiftDetectionService');
      const [endH, endM] = shift.endTime.split(':').map(Number);
      const [startH, startM] = shift.startTime.split(':').map(Number);

      // Handle overnight
      let isOvernight = startH > 20 || (endH * 60 + endM) < (startH * 60 + startM);

      let shiftEndDate = createDateWithOffset(date, shift.endTime);
      if (isOvernight) {
        shiftEndDate.setDate(shiftEndDate.getDate() + 1);
      }

      const grace = shift.gracePeriod || 15;
      shiftEndDate.setMinutes(shiftEndDate.getMinutes() + grace);

      if (shiftSegment.outTime > shiftEndDate) {
        const diffMs = shiftSegment.outTime - shiftEndDate;
        shiftSegment.extraHours = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
      }
    }

    // Recalculate Working Hours (logic check)
    if (shiftSegment.inTime && shiftSegment.outTime) {
      // ... Working hours are difference of punches, not dependent on shift definition (usually).
      // But status might change.
    }

    // Update Status based on rules
    if (shiftSegment.workingHours !== undefined) {
      const durationHours = shift.duration > 20 ? (shift.duration / 60) : (shift.duration || 8);
      let basePayable = shift.payableShifts ?? 1;
      shiftSegment.expectedHours = Math.round(durationHours * 100) / 100;

      if (shiftSegment.workingHours >= (durationHours * 0.9)) {
        shiftSegment.status = 'PRESENT';
        shiftSegment.payableShift = basePayable;
      } else if (shiftSegment.workingHours >= (durationHours * 0.45)) {
        shiftSegment.status = 'HALF_DAY';
        shiftSegment.payableShift = basePayable * 0.5;
      } else {
        shiftSegment.status = 'ABSENT';
        shiftSegment.payableShift = 0;
      }
    }

    // Mark as manually edited
    if (!attendanceRecord.source) attendanceRecord.source = [];
    if (!attendanceRecord.source.includes('manual')) {
      attendanceRecord.source.push('manual');
    }

    attendanceRecord.isEdited = true;
    attendanceRecord.editHistory.push({
      action: 'SHIFT_CHANGE',
      modifiedBy: req.user?._id || req.user?.userId,
      modifiedByName: req.user.name,
      modifiedAt: new Date(),
      details: `Changed shift to ${shift.name}`
    });

    await attendanceRecord.save();

    // Update roster tracking for manual assignment
    const PreScheduledShift = require('../../shifts/model/PreScheduledShift');
    const rosterRecord = await PreScheduledShift.findOne({
      employeeNumber: employeeNumber.toUpperCase(),
      date: date
    });

    if (rosterRecord) {
      const isDeviation = rosterRecord.shiftId && rosterRecord.shiftId.toString() !== shiftId.toString();
      rosterRecord.actualShiftId = shiftId;
      rosterRecord.isDeviation = !!isDeviation;
      rosterRecord.attendanceDailyId = attendanceRecord._id;
      await rosterRecord.save();
    }

    // Detect extra hours (Global)
    if (attendanceRecord.outTime) {
      const { detectExtraHours } = require('../services/extraHoursService');
      await detectExtraHours(employeeNumber.toUpperCase(), date);
    }

    // Recalculate monthly summary
    const { recalculateOnAttendanceUpdate } = require('../services/summaryCalculationService');
    await recalculateOnAttendanceUpdate(employeeNumber.toUpperCase(), date);

    const updatedRecord = await AttendanceDaily.findOne({
      employeeNumber: employeeNumber.toUpperCase(),
      date: date,
    })
      .populate('shifts.shiftId', 'name startTime endTime duration payableShifts');

    res.status(200).json({
      success: true,
      message: 'Shift assigned successfully',
      data: updatedRecord,
    });

  } catch (error) {
    console.error('Error assigning shift:', error);
    res.status(500).json({
      success: false,
      message: 'Error assigning shift',
      error: error.message,
    });
  }
};

/**
 * @desc    Get recent live activity feed for dashboard
 * @route   GET /api/attendance/activity/recent
 * @access  Private
 */
exports.getRecentActivity = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // 1. Determine Scope & Filter
    let logQuery = {};

    // If we have a specific scope filter (Division/HR/HOD/Emp)
    if (req.scopeFilter && Object.keys(req.scopeFilter).length > 0) {
      // Find allowed Employee Numbers
      const allowedEmployees = await Employee.find(req.scopeFilter).select('emp_no').lean();
      const allowedEmpNos = allowedEmployees.map(e => e.emp_no);

      if (allowedEmpNos.length === 0) {
        return res.status(200).json({
          success: true,
          data: [],
          pagination: { page: parseInt(page), limit: parseInt(limit), total: 0, totalPages: 0 }
        });
      }
      logQuery.employeeNumber = { $in: allowedEmpNos };
    }

    // 2. Fetch Recent Logs (Paginated)
    const rawLogs = await AttendanceRawLog.find(logQuery)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await AttendanceRawLog.countDocuments(logQuery);

    if (rawLogs.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit))
        }
      });
    }

    // 3. Hydrate Data
    const uniqueEmpNos = [...new Set(rawLogs.map(l => l.employeeNumber))];

    const employeesInfo = await Employee.find({ emp_no: { $in: uniqueEmpNos } })
      .select('emp_no employee_name department_id designation_id')
      .populate('department_id', 'name')
      .populate('designation_id', 'name')
      .lean();

    const empMap = {};
    employeesInfo.forEach(e => { empMap[e.emp_no] = e; });

    const dailyMap = {};
    const relevantDates = [...new Set(rawLogs.map(l => ({ emp: l.employeeNumber, date: l.date })))];

    const dailyQuery = {
      $or: relevantDates.map(i => ({ employeeNumber: i.emp, date: i.date }))
    };

    if (relevantDates.length > 0) {
      const dailyRecords = await AttendanceDaily.find(dailyQuery)
        .select('employeeNumber date shiftId status')
        .populate('shiftId', 'name startTime endTime')
        .lean();

      dailyRecords.forEach(d => {
        dailyMap[`${d.employeeNumber}_${d.date}`] = d;
      });
    }

    // 4. Assemble Response
    const activityFeed = rawLogs.map(log => {
      const emp = empMap[log.employeeNumber] || {};
      const daily = dailyMap[`${log.employeeNumber}_${log.date}`] || {};
      const shift = daily.shiftId || {};

      return {
        _id: log._id,
        timestamp: log.timestamp,
        employee: {
          name: emp.employee_name || 'Unknown',
          number: log.employeeNumber,
          department: emp.department_id?.name || '-',
          designation: emp.designation_id?.name || '-'
        },
        punch: {
          type: log.type,
          subType: log.subType,
          device: log.deviceName || log.deviceId
        },
        shift: {
          name: shift.name || 'Detecting...',
          startTime: shift.startTime,
          endTime: shift.endTime
        },
        status: daily.status || 'PROCESSING'
      };
    });

    res.status(200).json({
      success: true,
      data: activityFeed,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Error fetching recent activity:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch activity feed'
    });
  }
};

/**
 * @desc    Update inTime for attendance record (manual correction)
 * @route   PUT /api/attendance/:employeeNumber/:date/intime
 * @access  Private (Super Admin, HR)
 */
exports.updateInTime = async (req, res) => {
  try {
    const { employeeNumber, date } = req.params;
    const { inTime, shiftRecordId } = req.body;

    const AttendanceSettings = require('../model/AttendanceSettings');
    const attSettings = await AttendanceSettings.getSettings();
    if (attSettings?.featureFlags?.allowInTimeEditing === false) {
      return res.status(403).json({
        success: false,
        message: 'In-time editing is disabled by settings.',
      });
    }

    // Validate inTime format (YYYY-MM-DDTHH:mm:ss.sssZ or similar ISO string)
    if (!inTime) {
      return res.status(400).json({
        success: false,
        message: 'In Time is required',
      });
    }

    // Get attendance record
    const AttendanceDaily = require('../model/AttendanceDaily');
    const attendanceRecord = await AttendanceDaily.findOne({
      employeeNumber: employeeNumber.toUpperCase(),
      date: date,
    }).populate('shifts.shiftId');

    if (!attendanceRecord) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found',
      });
    }

    // Ensure we have shifts - if not, we must create a default one or fail?
    if (!attendanceRecord.shifts || attendanceRecord.shifts.length === 0) {
      attendanceRecord.shifts = [{
        shiftNumber: 1,
        status: 'incomplete',
        payableShift: 0
      }];
    }

    let shiftSegment;
    if (shiftRecordId) {
      shiftSegment = attendanceRecord.shifts.id(shiftRecordId);
      if (!shiftSegment) {
        return res.status(404).json({
          success: false,
          message: 'Shift segment not found',
        });
      }
    } else {
      shiftSegment = attendanceRecord.shifts[0];
    }

    // Parse new In Time
    const newInTime = new Date(inTime);

    // Update inTime on the shift segment
    shiftSegment.inTime = newInTime;

    // Status update logic
    if (attendanceRecord.status === 'ABSENT' || !attendanceRecord.status) {
      // If we set inTime, it's at least Partial
      attendanceRecord.status = 'PARTIAL';
    }

    // Mark as manual
    if (!attendanceRecord.source) attendanceRecord.source = [];
    if (!attendanceRecord.source.includes('manual')) {
      attendanceRecord.source.push('manual');
    }

    attendanceRecord.isEdited = true;
    attendanceRecord.editHistory.push({
      action: 'IN_TIME_UPDATE',
      modifiedBy: req.user?._id || req.user?.userId,
      modifiedByName: req.user.name,
      modifiedAt: new Date(),
      details: `In time updated manually to ${newInTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}`
    });

    // Recalculate Metrics for this shift
    const SettingsModel = require('../../settings/model/Settings');
    const generalConfig = await SettingsModel.getSettingsByCategory('general');
    const globalLateInGrace = generalConfig.late_in_grace_time ?? null;
    const globalEarlyOutGrace = generalConfig.early_out_grace_time ?? null;

    // We need shift details (expecting them populated)
    let shiftDetails = shiftSegment.shiftId;
    if (shiftSegment.shiftId && !shiftSegment.shiftId.startTime) {
      // Not populated
      const Shift = require('../../shifts/model/Shift');
      shiftDetails = await Shift.findById(shiftSegment.shiftId);
    }

    if (shiftDetails && shiftDetails.startTime) {
      const { calculateLateIn, calculateEarlyOut } = require('../../shifts/services/shiftDetectionService');
      const lateInMinutes = calculateLateIn(newInTime, shiftDetails.startTime, shiftDetails.gracePeriod || 15, date, globalLateInGrace);
      shiftSegment.lateInMinutes = lateInMinutes > 0 ? lateInMinutes : 0;
      shiftSegment.isLateIn = lateInMinutes > 0;

      // Also recalculate Early Out and Duration if OutTime exists
      // (Changing InTime affects duration)
      if (shiftSegment.outTime) {
        const earlyOut = calculateEarlyOut(shiftSegment.outTime, shiftDetails.endTime, shiftDetails.startTime, date, globalEarlyOutGrace);
        shiftSegment.earlyOutMinutes = earlyOut > 0 ? earlyOut : 0;
        shiftSegment.isEarlyOut = earlyOut > 0;

        // Calculate Working Hours
        const diffMs = shiftSegment.outTime - newInTime;
        const hours = diffMs / (1000 * 60 * 60);
        shiftSegment.punchHours = Math.round(hours * 100) / 100;
        shiftSegment.workingHours = Math.round(((shiftSegment.punchHours || 0) + (shiftSegment.odHours || 0)) * 100) / 100;

        // Recalculate Status and Payable
        const durationHours = shiftDetails.duration > 20 ? (shiftDetails.duration / 60) : (shiftDetails.duration || 8);
        let basePayable = shiftDetails.payableShifts ?? 1;
        shiftSegment.expectedHours = Math.round(durationHours * 100) / 100;

        if (shiftSegment.workingHours >= (durationHours * 0.9)) {
          shiftSegment.status = 'PRESENT';
          shiftSegment.payableShift = basePayable;
        } else if (shiftSegment.workingHours >= (durationHours * 0.45)) {
          shiftSegment.status = 'HALF_DAY';
          shiftSegment.payableShift = basePayable * 0.5;
        } else {
          shiftSegment.status = 'ABSENT';
          shiftSegment.payableShift = 0;
        }
      }
    }

    await attendanceRecord.save();

    // Recalculate monthly summary
    const { recalculateOnAttendanceUpdate } = require('../services/summaryCalculationService');
    await recalculateOnAttendanceUpdate(employeeNumber.toUpperCase(), date);

    const updatedRecord = await AttendanceDaily.findOne({
      employeeNumber: employeeNumber.toUpperCase(),
      date: date,
    }).populate('shifts.shiftId');

    res.status(200).json({
      success: true,
      message: 'In Time updated successfully',
      data: updatedRecord,
    });

  } catch (error) {
    console.error('Error updating in-time:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating in-time',
      error: error.message,
    });
  }
};
