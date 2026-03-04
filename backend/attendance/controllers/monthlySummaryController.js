const MonthlyAttendanceSummary = require('../model/MonthlyAttendanceSummary');
const { calculateMonthlySummary, calculateAllEmployeesSummary, deleteAllMonthlySummaries } = require('../services/summaryCalculationService');
const Employee = require('../../employees/model/Employee');

/**
 * @desc    Get monthly summary for an employee
 * @route   GET /api/attendance/monthly-summary/:employeeId
 * @access  Private
 */
exports.getEmployeeMonthlySummary = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { month, year } = req.query; // month in YYYY-MM format or year and monthNumber

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: 'Employee ID is required',
      });
    }

    let query = { employeeId };

    if (month) {
      // month in YYYY-MM format
      query.month = month;
    } else if (year) {
      query.year = parseInt(year);
      if (req.query.monthNumber) {
        query.monthNumber = parseInt(req.query.monthNumber);
      }
    } else {
      // Default to current month
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      query.month = currentMonth;
    }

    const summary = await MonthlyAttendanceSummary.findOne(query)
      .populate('employeeId', 'employee_name emp_no department_id designation_id');

    if (!summary) {
      return res.status(404).json({
        success: false,
        message: 'Monthly summary not found',
      });
    }

    res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('Error getting monthly summary:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting monthly summary',
      error: error.message,
    });
  }
};

/**
 * @desc    Get all monthly summaries for a month
 * @route   GET /api/attendance/monthly-summary
 * @access  Private
 */
exports.getAllMonthlySummaries = async (req, res) => {
  try {
    const { month, year, monthNumber } = req.query;

    let query = {};

    if (month) {
      query.month = month;
    } else if (year) {
      query.year = parseInt(year);
      if (monthNumber) {
        query.monthNumber = parseInt(monthNumber);
      }
    } else {
      // Default to current month
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      query.month = currentMonth;
    }

    // Apply data scope filtering
    if (req.scopeFilter && Object.keys(req.scopeFilter).length > 0) {
      // Find employees within scope
      const allowedEmployees = await Employee.find(req.scopeFilter).select('_id').lean();
      const allowedIds = allowedEmployees.map(e => e._id);

      if (allowedIds.length === 0) {
        return res.status(200).json({ success: true, data: [] });
      }
      query.employeeId = { $in: allowedIds };
    }

    const summaries = await MonthlyAttendanceSummary.find(query)
      .populate('employeeId', 'employee_name emp_no department_id designation_id')
      .sort({ emp_no: 1 });

    res.status(200).json({
      success: true,
      data: summaries,
    });
  } catch (error) {
    console.error('Error getting all monthly summaries:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting monthly summaries',
      error: error.message,
    });
  }
};

/**
 * @desc    Calculate/Recalculate monthly summary for an employee
 * @route   POST /api/attendance/monthly-summary/calculate/:employeeId
 * @access  Private (Super Admin, Sub Admin, HR)
 */
exports.calculateEmployeeSummary = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { year, monthNumber } = req.body;

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: 'Employee ID is required',
      });
    }

    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    const now = new Date();
    const calcYear = year || now.getFullYear();
    const calcMonth = monthNumber || now.getMonth() + 1;

    const summary = await calculateMonthlySummary(
      employee._id,
      employee.emp_no,
      calcYear,
      calcMonth
    );

    res.status(200).json({
      success: true,
      message: 'Monthly summary calculated successfully',
      data: summary,
    });
  } catch (error) {
    console.error('Error calculating monthly summary:', error);
    res.status(500).json({
      success: false,
      message: 'Error calculating monthly summary',
      error: error.message,
    });
  }
};

/**
 * @desc    Delete all monthly summaries (optionally for a month), then recalculate for given month
 * @route   POST /api/attendance/monthly-summary/clear-and-recalculate
 * @body    { year?, monthNumber?, clearAll?: boolean } - clearAll: if true, delete all summaries; else delete only for year+monthNumber. Then recalc for year+monthNumber (default current month).
 * @access  Private (Super Admin, Sub Admin, HR)
 */
exports.clearAndRecalculateSummaries = async (req, res) => {
  try {
    const { year, monthNumber, clearAll } = req.body || {};
    const now = new Date();
    const calcYear = year != null ? Number(year) : now.getFullYear();
    const calcMonth = monthNumber != null ? Number(monthNumber) : now.getMonth() + 1;

    const deleteOptions = clearAll ? {} : { year: calcYear, monthNumber: calcMonth };
    const { deletedCount } = await deleteAllMonthlySummaries(deleteOptions);

    const results = await calculateAllEmployeesSummary(calcYear, calcMonth);
    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    res.status(200).json({
      success: true,
      message: `Deleted ${deletedCount} summary/summaries; recalculated for ${calcYear}-${String(calcMonth).padStart(2, '0')}: ${successCount} succeeded, ${failureCount} failed.`,
      data: {
        deletedCount,
        period: { year: calcYear, monthNumber: calcMonth },
        recalc: { total: results.length, successCount, failureCount },
        results,
      },
    });
  } catch (error) {
    console.error('Error in clear-and-recalculate:', error);
    res.status(500).json({
      success: false,
      message: 'Error clearing and recalculating monthly summaries',
      error: error.message,
    });
  }
};

/**
 * @desc    Calculate/Recalculate monthly summary for all employees
 * @route   POST /api/attendance/monthly-summary/calculate-all
 * @access  Private (Super Admin, Sub Admin, HR)
 */
exports.calculateAllSummaries = async (req, res) => {
  try {
    const { year, monthNumber } = req.body;

    const now = new Date();
    const calcYear = year || now.getFullYear();
    const calcMonth = monthNumber || now.getMonth() + 1;

    const results = await calculateAllEmployeesSummary(calcYear, calcMonth);

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    res.status(200).json({
      success: true,
      message: `Calculated summaries for ${successCount} employees. ${failureCount} failed.`,
      data: {
        total: results.length,
        success: successCount,
        failed: failureCount,
        results,
      },
    });
  } catch (error) {
    console.error('Error calculating all monthly summaries:', error);
    res.status(500).json({
      success: false,
      message: 'Error calculating monthly summaries',
      error: error.message,
    });
  }
};

