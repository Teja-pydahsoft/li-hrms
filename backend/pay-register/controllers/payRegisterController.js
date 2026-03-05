const PayRegisterSummary = require('../model/PayRegisterSummary');
const Employee = require('../../employees/model/Employee');
const PayrollBatch = require('../../payroll/model/PayrollBatch');
const { populatePayRegisterFromSources } = require('../services/autoPopulationService');
const { calculateTotals, ensureTotalsRespectRoster } = require('../services/totalsCalculationService');
const { updateDailyRecord } = require('../services/dailyRecordUpdateService');
const { getPayrollDateRange } = require('../../shared/utils/dateUtils');
const { manualSyncPayRegister } = require('../services/autoSyncService');
const { processSummaryBulkUpload } = require('../services/summaryUploadService');

/**
 * Pay Register Controller
 * Handles pay register CRUD operations
 */

// @desc    Get pay register for employee and month
// @route   GET /api/pay-register/:employeeId/:month
// @access  Private (exclude employee)
exports.getPayRegister = async (req, res) => {
  try {
    const { employeeId, month } = req.params;

    // Validate month format
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        error: 'Month must be in YYYY-MM format',
      });
    }

    // Find or create pay register
    let payRegister = await PayRegisterSummary.findOne({
      employeeId,
      month,
    })
      .populate('employeeId', 'employee_name emp_no department_id designation_id')
      .populate('dailyRecords.shiftId', 'name payableShifts')
      .populate('lastEditedBy', 'name email role')
      .populate('editedBy', 'name email role');

    // Recalculate totals to ensure accuracy; week-offs and holidays from shift roster
    if (payRegister) {
      payRegister.totals = calculateTotals(payRegister.dailyRecords);
      payRegister.recalculateTotals(); // Also use model method for consistency
      let startDate = payRegister.startDate;
      let endDate = payRegister.endDate;
      if (!startDate || !endDate) {
        const [y, m] = payRegister.month.split('-').map(Number);
        const range = await getPayrollDateRange(y, m);
        startDate = range.startDate;
        endDate = range.endDate;
        payRegister.startDate = startDate;
        payRegister.endDate = endDate;
      }
      await ensureTotalsRespectRoster(payRegister.totals, payRegister.emp_no, startDate, endDate);
      await payRegister.save();
    }

    if (!payRegister) {
      // Auto-create by populating from sources
      const employee = await Employee.findById(employeeId);
      if (!employee) {
        return res.status(404).json({
          success: false,
          error: 'Employee not found',
        });
      }

      const [year, monthNum] = month.split('-').map(Number);
      const { getPayrollDateRange } = require('../../shared/utils/dateUtils');
      const { startDate, endDate, totalDays } = await getPayrollDateRange(year, monthNum);

      const dailyRecords = await populatePayRegisterFromSources(
        employeeId,
        employee.emp_no,
        year,
        monthNum
      );

      let totals = calculateTotals(dailyRecords);
      await ensureTotalsRespectRoster(totals, employee.emp_no, startDate, endDate);
      payRegister = await PayRegisterSummary.create({
        employeeId,
        emp_no: employee.emp_no,
        month,
        monthName: new Date(year, monthNum - 1).toLocaleString('default', { month: 'long', year: 'numeric' }),
        year,
        monthNumber: monthNum,
        totalDaysInMonth: totalDays,
        startDate,
        endDate,
        dailyRecords,
        totals,
        status: 'draft',
        lastAutoSyncedAt: new Date(),
      });

      await payRegister.populate([
        { path: 'employeeId', select: 'employee_name emp_no department_id designation_id' },
        { path: 'dailyRecords.shiftId', select: 'name payableShifts' },
      ]);
    }

    res.status(200).json({
      success: true,
      data: payRegister,
    });
  } catch (error) {
    console.error('Error getting pay register:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get pay register',
    });
  }
};

// @desc    Create pay register
// @route   POST /api/pay-register/:employeeId/:month
// @access  Private (exclude employee)
exports.createPayRegister = async (req, res) => {
  try {
    const { employeeId, month } = req.params;

    // Validate month format
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        error: 'Month must be in YYYY-MM format',
      });
    }

    // Check if already exists
    const existing = await PayRegisterSummary.findOne({ employeeId, month });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Pay register already exists for this employee and month',
      });
    }

    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({
        success: false,
        error: 'Employee not found',
      });
    }

    const [year, monthNum] = month.split('-').map(Number);
    const { getPayrollDateRange } = require('../../shared/utils/dateUtils');
    const { startDate, endDate, totalDays } = await getPayrollDateRange(year, monthNum);

    const dailyRecords = await populatePayRegisterFromSources(
      employeeId,
      employee.emp_no,
      year,
      monthNum
    );

    let totals = calculateTotals(dailyRecords);
    await ensureTotalsRespectRoster(totals, employee.emp_no, startDate, endDate);

    const payRegister = await PayRegisterSummary.create({
      employeeId,
      emp_no: employee.emp_no,
      month,
      monthName: new Date(year, monthNum - 1).toLocaleString('default', { month: 'long', year: 'numeric' }),
      year,
      monthNumber: monthNum,
      totalDaysInMonth: totalDays,
      startDate,
      endDate,
      dailyRecords,
      totals,
      status: 'draft',
      lastAutoSyncedAt: new Date(),
    });

    await payRegister.populate([
      { path: 'employeeId', select: 'employee_name emp_no department_id designation_id' },
      { path: 'dailyRecords.shiftId', select: 'name payableShifts' },
    ]);

    res.status(201).json({
      success: true,
      data: payRegister,
    });
  } catch (error) {
    console.error('Error creating pay register:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create pay register',
    });
  }
};

// @desc    Update pay register
// @route   PUT /api/pay-register/:employeeId/:month
// @access  Private (exclude employee)
exports.updatePayRegister = async (req, res) => {
  try {
    const { employeeId, month } = req.params;
    const { dailyRecords, status, notes } = req.body;

    const payRegister = await PayRegisterSummary.findOne({ employeeId, month });
    if (!payRegister) {
      return res.status(404).json({
        success: false,
        error: 'Pay register not found',
      });
    }

    // Update dailyRecords if provided; recalc totals so any day/half marked OD (e.g. edited from absent) is included in present days; WO/HOL from roster
    if (dailyRecords && Array.isArray(dailyRecords)) {
      payRegister.dailyRecords = dailyRecords;
      payRegister.totals = calculateTotals(dailyRecords);
      payRegister.recalculateTotals();
      let startDate = payRegister.startDate;
      let endDate = payRegister.endDate;
      if (!startDate || !endDate) {
        const [y, m] = month.split('-').map(Number);
        const range = await getPayrollDateRange(y, m);
        startDate = range.startDate;
        endDate = range.endDate;
        payRegister.startDate = startDate;
        payRegister.endDate = endDate;
      }
      await ensureTotalsRespectRoster(payRegister.totals, payRegister.emp_no, startDate, endDate);
    }

    // Update status if provided
    if (status) {
      payRegister.status = status;
    }

    // Update notes if provided
    if (notes !== undefined) {
      payRegister.notes = notes;
    }

    // Update edit tracking
    payRegister.lastEditedBy = req.user._id;
    payRegister.lastEditedAt = new Date();
    payRegister.editedBy = req.user._id;
    payRegister.editedAt = new Date();

    await payRegister.save();

    await payRegister.populate([
      { path: 'employeeId', select: 'employee_name emp_no department_id designation_id' },
      { path: 'dailyRecords.shiftId', select: 'name payableShifts' },
      { path: 'lastEditedBy', select: 'name email role' },
      { path: 'editedBy', select: 'name email role' },
    ]);

    res.status(200).json({
      success: true,
      data: payRegister,
    });
  } catch (error) {
    console.error('Error updating pay register:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update pay register',
    });
  }
};

// @desc    Update single daily record
// @route   PUT /api/pay-register/:employeeId/:month/daily/:date
// @access  Private (exclude employee)
exports.updateDailyRecord = async (req, res) => {
  try {
    const { employeeId, month, date } = req.params;
    const updateData = req.body;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        error: 'Date must be in YYYY-MM-DD format',
      });
    }

    const [year, monthNum] = month.split('-').map(Number);
    const { startDate, endDate } = await getPayrollDateRange(year, monthNum);

    // Validate date is within the payroll cycle
    if (date < startDate || date > endDate) {
      return res.status(400).json({
        success: false,
        error: `Date must be within the payroll cycle range (${startDate} to ${endDate})`,
      });
    }

    const payRegister = await PayRegisterSummary.findOne({ employeeId, month });
    if (!payRegister) {
      return res.status(404).json({
        success: false,
        error: 'Pay register not found',
      });
    }

    // Update daily record
    await updateDailyRecord(payRegister, date, updateData, req.user);

    // Recalculate totals so any day/half edited from absent to OD is included in totalPresentDays; WO/HOL from roster
    payRegister.totals = calculateTotals(payRegister.dailyRecords);
    payRegister.recalculateTotals();
    await ensureTotalsRespectRoster(payRegister.totals, payRegister.emp_no, startDate, endDate);
    if (!payRegister.startDate || !payRegister.endDate) {
      payRegister.startDate = startDate;
      payRegister.endDate = endDate;
    }

    await payRegister.save();

    await payRegister.populate([
      { path: 'employeeId', select: 'employee_name emp_no department_id designation_id' },
      { path: 'dailyRecords.shiftId', select: 'name payableShifts' },
      { path: 'lastEditedBy', select: 'name email role' },
    ]);

    res.status(200).json({
      success: true,
      data: payRegister,
    });
  } catch (error) {
    console.error('Error updating daily record:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update daily record',
    });
  }
};

// @desc    Sync pay register from sources
// @route   POST /api/pay-register/:employeeId/:month/sync
// @access  Private (exclude employee)
exports.syncPayRegister = async (req, res) => {
  try {
    const { employeeId, month } = req.params;

    const payRegister = await manualSyncPayRegister(employeeId, month);

    await payRegister.populate([
      { path: 'employeeId', select: 'employee_name emp_no department_id designation_id' },
      { path: 'dailyRecords.shiftId', select: 'name payableShifts' },
    ]);

    res.status(200).json({
      success: true,
      data: payRegister,
      message: 'Pay register synced successfully',
    });
  } catch (error) {
    console.error('Error syncing pay register:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to sync pay register',
    });
  }
};

// @desc    Get edit history
// @route   GET /api/pay-register/:employeeId/:month/history
// @access  Private (exclude employee)
exports.getEditHistory = async (req, res) => {
  try {
    const { employeeId, month } = req.params;

    const payRegister = await PayRegisterSummary.findOne({ employeeId, month })
      .select('editHistory')
      .populate('editHistory.editedBy', 'name email role');

    if (!payRegister) {
      return res.status(404).json({
        success: false,
        error: 'Pay register not found',
      });
    }

    res.status(200).json({
      success: true,
      data: payRegister.editHistory || [],
    });
  } catch (error) {
    console.error('Error getting edit history:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get edit history',
    });
  }
};

// @desc    Get all employees with pay registers for a month
// @route   GET /api/pay-register/employees/:month
// @access  Private (exclude employee)
exports.getEmployeesWithPayRegister = async (req, res) => {
  try {
    const { month } = req.params;
    const { departmentId, divisionId, status, page, limit } = req.query;

    console.log('[Pay Register Controller] getEmployeesWithPayRegister called:', {
      month,
      departmentId,
      divisionId,
      status
    });

    // Validate month format
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        error: 'Month must be in YYYY-MM format',
      });
    }

    const Employee = require('../../employees/model/Employee');
    const PayrollRecord = require('../../payroll/model/PayrollRecord');
    const mongoose = require('mongoose');

    // Parse month
    const [year, monthNum] = month.split('-').map(Number);
    const { getPayrollDateRange } = require('../../shared/utils/dateUtils');
    const { startDate, endDate, totalDays } = await getPayrollDateRange(year, monthNum);

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 50; // Default limit 50
    const skip = (pageNum - 1) * limitNum;

    // Use UTC boundaries so "left in period" matches payroll calculation (excludes e.g. 25 Dec when period is 26 Dec–25 Jan).
    const rangeStart = new Date(startDate + 'T00:00:00.000Z');
    const rangeEnd = new Date(endDate + 'T23:59:59.999Z');

    // Build Employee Query - include active employees OR those who left within this specific payroll cycle
    let employeeQuery = {
      $or: [
        { is_active: true, leftDate: null },
        { leftDate: { $gte: rangeStart, $lte: rangeEnd } }
      ]
    };

    if (departmentId) {
      let deptObjectId = departmentId;
      try {
        if (mongoose.Types.ObjectId.isValid(departmentId)) {
          deptObjectId = new mongoose.Types.ObjectId(departmentId);
        }
      } catch (err) { }
      employeeQuery.department_id = deptObjectId;
    }

    if (divisionId) {
      let divObjectId = divisionId;
      try {
        if (mongoose.Types.ObjectId.isValid(divisionId)) {
          divObjectId = new mongoose.Types.ObjectId(divisionId);
        }
      } catch (err) { }
      employeeQuery.division_id = divObjectId;
    }

    // 1. Bulk Fetch Employees
    const totalEmployees = await Employee.countDocuments(employeeQuery);

    let employeeFetch = Employee.find(employeeQuery)
      .select('_id employee_name emp_no department_id designation_id leftDate leftReason')
      .populate('department_id', 'name')
      .populate('designation_id', 'name')
      .sort({ employee_name: 1 });

    // Bypass pagination if limit is -1
    if (limitNum !== -1) {
      employeeFetch = employeeFetch.skip(skip).limit(limitNum);
    }

    const employees = await employeeFetch;

    if (employees.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalEmployees,
          totalPages: Math.ceil(totalEmployees / limitNum)
        }
      });
    }

    const employeeIds = employees.map(e => e._id);

    // 2. Bulk Fetch Existing Pay Registers (Include dailyRecords); include leftDate/leftReason so frontend can show "Left" employees
    const payRegisters = await PayRegisterSummary.find({
      employeeId: { $in: employeeIds },
      month
    })
      .populate('employeeId', 'employee_name emp_no department_id designation_id leftDate leftReason')
      .select('employeeId emp_no month status totals lastEditedAt dailyRecords startDate endDate totalDaysInMonth');

    // Map for O(1) Access
    const prMap = new Map();
    payRegisters.forEach(pr => {
      const eId = pr.employeeId._id ? pr.employeeId._id.toString() : pr.employeeId.toString();
      prMap.set(eId, pr);
    });

    // 3. Bulk Fetch Payroll Records (Context)
    const payrollRecords = await PayrollRecord.find({
      employeeId: { $in: employeeIds },
      month
    }).select('employeeId _id');

    const payrollMap = new Map();
    payrollRecords.forEach(pr => payrollMap.set(pr.employeeId.toString(), pr._id));

    // 4. Construct Response (Merge & Stub)
    const results = employees.map(employee => {
      const eId = employee._id.toString();
      const existingPR = prMap.get(eId);
      const payrollId = payrollMap.get(eId);

      if (existingPR) {
        return {
          _id: existingPR._id,
          employeeId: existingPR.employeeId,
          emp_no: existingPR.emp_no,
          month: existingPR.month,
          status: existingPR.status,
          totals: existingPR.totals,
          dailyRecords: existingPR.dailyRecords || [],
          lastEditedAt: existingPR.lastEditedAt,
          payrollId: payrollId || null,
          startDate: existingPR.startDate || startDate,
          endDate: existingPR.endDate || endDate,
          totalDaysInMonth: existingPR.totalDaysInMonth || totalDays
        };
      } else {
        // Return In-Memory Stub (Fast!)
        return {
          _id: `stub_${eId}`,
          employeeId: employee, // Full populated employee doc
          emp_no: employee.emp_no,
          month,
          status: 'draft',
          totals: {
            presentDays: 0,
            presentHalfDays: 0,
            totalPresentDays: 0,
            absentDays: 0,
            absentHalfDays: 0,
            totalAbsentDays: 0,
            paidLeaveDays: 0,
            paidLeaveHalfDays: 0,
            totalPaidLeaveDays: 0,
            unpaidLeaveDays: 0,
            unpaidLeaveHalfDays: 0,
            totalUnpaidLeaveDays: 0,
            lopDays: 0,
            lopHalfDays: 0,
            totalLopDays: 0,
            totalLeaveDays: 0,
            odDays: 0,
            odHalfDays: 0,
            totalODDays: 0,
            totalOTHours: 0,
            totalPayableShifts: 0
          },
          dailyRecords: [], // Empty for stubs
          lastEditedAt: null,
          payrollId: payrollId || null,
          isStub: true,
          startDate,
          endDate,
          totalDaysInMonth: totalDays
        };
      }
    });

    // Filter by status if requested (Note: Status filtering across pages is tricky without aggregation, doing post-filter for now but pagination applies to employees mainly)
    const finalResults = status ? results.filter(r => r.status === status) : results;

    res.status(200).json({
      success: true,
      count: finalResults.length,
      data: finalResults,
      startDate,
      endDate,
      pagination: {
        page: pageNum,
        limit: limitNum === -1 ? totalEmployees : limitNum,
        total: totalEmployees,
        totalPages: limitNum === -1 ? 1 : Math.ceil(totalEmployees / limitNum)
      }
    });

  } catch (error) {
    console.error('[Pay Register Controller] Error getting employees with pay register:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get employees with pay register',
    });
  }
};

// @desc    Bulk upload monthly summary
// @route   POST /api/pay-register/upload-summary/:month
// @access  Private (exclude employee)
exports.uploadSummaryBulk = async (req, res) => {
  try {
    const { month } = req.params;
    const { data } = req.body;

    if (!month || !data || !Array.isArray(data)) {
      return res.status(400).json({
        success: false,
        error: 'Month and data array are required',
      });
    }

    const result = await processSummaryBulkUpload(month, data, req.user._id);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error bulk uploading summary:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to bulk upload summary',
    });
  }
};

