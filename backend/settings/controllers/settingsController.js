const Settings = require('../model/Settings');

// @desc    Get all settings
// @route   GET /api/settings
// @access  Private
exports.getAllSettings = async (req, res) => {
  try {
    const { category } = req.query;
    const query = {};

    if (category) {
      query.category = category;
    }

    const settings = await Settings.find(query).sort({ category: 1, key: 1 });

    res.status(200).json({
      success: true,
      count: settings.length,
      data: settings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching settings',
      error: error.message,
    });
  }
};

// @desc    Get single setting
// @route   GET /api/settings/:key
// @access  Private
exports.getSetting = async (req, res) => {
  try {
    const setting = await Settings.findOne({ key: req.params.key });

    if (!setting) {
      // Return default values for known payroll settings to avoid 404 errors on first load
      const defaults = {
        'include_missing_employee_components': true,
        'enable_absent_deduction': false,
        'lop_days_per_absent': 1,
        'allow_employee_bulk_process': false,
        'payroll_cycle_start_day': '1',
        'payroll_cycle_end_day': '31'
        'qualification_statuses': ['Partial', 'Not Certified', 'Certified'],
        'default_apply_statutory_deductions': true,
        'default_apply_attendance_deductions': true,
      };

      if (defaults[req.params.key] !== undefined) {
        return res.status(200).json({
          success: true,
          data: {
            key: req.params.key,
            value: defaults[req.params.key],
            category: 'payroll',
            isDefault: true
          }
        });
      }

      return res.status(404).json({
        success: false,
        message: 'Setting not found',
      });
    }

    res.status(200).json({
      success: true,
      data: setting,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching setting',
      error: error.message,
    });
  }
};

// @desc    Create or update setting
// @route   POST /api/settings
// @route   PUT /api/settings/:key
// @access  Private (Super Admin, Sub Admin)
exports.upsertSetting = async (req, res) => {
  try {
    const { key, value, description, category } = req.body;

    if (!key) {
      return res.status(400).json({
        success: false,
        message: 'Setting key is required',
      });
    }

    // Validate shift_durations value
    if (key === 'shift_durations') {
      if (!Array.isArray(value)) {
        return res.status(400).json({
          success: false,
          message: 'shift_durations must be an array of numbers',
        });
      }

      // Validate all values are positive numbers
      const invalidValues = value.filter((v) => typeof v !== 'number' || v <= 0);
      if (invalidValues.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'All duration values must be positive numbers',
        });
      }
    }

    // Validate include_missing_employee_components: must be boolean
    if (key === 'include_missing_employee_components') {
      if (typeof value !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'include_missing_employee_components must be a boolean',
        });
      }
    }

    // Validate absent deduction settings
    if (key === 'enable_absent_deduction') {
      if (typeof value !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'enable_absent_deduction must be a boolean',
        });
      }
    }
    if (key === 'lop_days_per_absent') {
      if (typeof value !== 'number' || value < 0) {
        return res.status(400).json({
          success: false,
          message: 'lop_days_per_absent must be a non-negative number',
        });
      }
    }

    if (key === 'allow_employee_bulk_process') {
      if (typeof value !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'allow_employee_bulk_process must be a boolean',
        });
      }
    }

    const setting = await Settings.findOneAndUpdate(
      { key },
      {
        key,
        value,
        description: description || `Setting for ${key}`,
        category:
          category ||
          (['include_missing_employee_components', 'enable_absent_deduction', 'lop_days_per_absent'].includes(key)
            ? 'payroll'
            : ['allow_employee_bulk_process'].includes(key)
              ? 'employee'
              : 'general'),
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    );

    res.status(200).json({
      success: true,
      message: 'Setting saved successfully',
      data: setting,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error saving setting',
      error: error.message,
    });
  }
};

// @desc    Delete setting
// @route   DELETE /api/settings/:key
// @access  Private (Super Admin)
exports.deleteSetting = async (req, res) => {
  try {
    const setting = await Settings.findOne({ key: req.params.key });

    if (!setting) {
      return res.status(404).json({
        success: false,
        message: 'Setting not found',
      });
    }

    await setting.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Setting deleted successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting setting',
      error: error.message,
    });
  }
};

