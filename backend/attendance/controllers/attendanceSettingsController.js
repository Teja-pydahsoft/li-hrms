/**
 * Attendance Settings Controller
 * Handles attendance settings (MSSQL config, sync settings)
 */

const AttendanceSettings = require('../model/AttendanceSettings');
const { isSQLAvailable } = require('../config/attendanceSQLHelper');

/**
 * @desc    Get attendance settings
 * @route   GET /api/attendance/settings
 * @access  Private (Super Admin, Sub Admin)
 */
exports.getSettings = async (req, res) => {
  try {
    const settings = await AttendanceSettings.getSettings();

    // Check MSSQL availability if configured
    let mssqlAvailable = false;
    if (settings.mssqlConfig.databaseName && settings.mssqlConfig.tableName) {
      try {
        mssqlAvailable = await isSQLAvailable(settings);
      } catch (error) {
        // Ignore error
      }
    }

    res.status(200).json({
      success: true,
      data: {
        ...settings.toObject(),
        mssqlAvailable,
      },
    });

  } catch (error) {
    console.error('Error fetching attendance settings:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch attendance settings',
    });
  }
};

/**
 * @desc    Update attendance settings
 * @route   PUT /api/attendance/settings
 * @access  Private (Super Admin, Sub Admin)
 */
exports.updateSettings = async (req, res) => {
  try {
    // Only Super Admin and Sub Admin can update
    if (!['super_admin', 'sub_admin'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update attendance settings',
      });
    }

    const {
      dataSource,
      mssqlConfig,
      syncSettings,
      previousDayLinking,
      processingMode,
      featureFlags,
    } = req.body;

    const settings = await AttendanceSettings.getSettings();

    // Update fields
    if (dataSource !== undefined) {
      settings.dataSource = dataSource;
    }

    if (mssqlConfig) {
      if (mssqlConfig.databaseName !== undefined) {
        settings.mssqlConfig.databaseName = mssqlConfig.databaseName;
      }
      if (mssqlConfig.tableName !== undefined) {
        settings.mssqlConfig.tableName = mssqlConfig.tableName;
      }
      if (mssqlConfig.columnMapping) {
        if (mssqlConfig.columnMapping.employeeNumberColumn !== undefined) {
          settings.mssqlConfig.columnMapping.employeeNumberColumn = mssqlConfig.columnMapping.employeeNumberColumn;
        }
        if (mssqlConfig.columnMapping.timestampColumn !== undefined) {
          settings.mssqlConfig.columnMapping.timestampColumn = mssqlConfig.columnMapping.timestampColumn;
        }
        if (mssqlConfig.columnMapping.typeColumn !== undefined) {
          settings.mssqlConfig.columnMapping.typeColumn = mssqlConfig.columnMapping.typeColumn;
        }
        if (mssqlConfig.columnMapping.hasTypeColumn !== undefined) {
          settings.mssqlConfig.columnMapping.hasTypeColumn = mssqlConfig.columnMapping.hasTypeColumn;
        }
      }
    }

    if (syncSettings) {
      if (syncSettings.autoSyncEnabled !== undefined) {
        settings.syncSettings.autoSyncEnabled = syncSettings.autoSyncEnabled;
      }
      if (syncSettings.syncIntervalHours !== undefined) {
        settings.syncSettings.syncIntervalHours = syncSettings.syncIntervalHours;
      }
    }

    if (previousDayLinking) {
      if (previousDayLinking.enabled !== undefined) {
        settings.previousDayLinking.enabled = previousDayLinking.enabled;
      }
      if (previousDayLinking.requireConfirmation !== undefined) {
        settings.previousDayLinking.requireConfirmation = previousDayLinking.requireConfirmation;
      }
    }

    if (processingMode) {
      if (processingMode.mode !== undefined) {
        settings.processingMode.mode = processingMode.mode;
      }
      if (processingMode.strictCheckInOutOnly !== undefined) {
        settings.processingMode.strictCheckInOutOnly = processingMode.strictCheckInOutOnly;
      }
      if (settings.processingMode.mode === 'multi_shift') {
        settings.processingMode.strictCheckInOutOnly = true;
      }
      if (processingMode.continuousSplitThresholdHours !== undefined) {
        settings.processingMode.continuousSplitThresholdHours = processingMode.continuousSplitThresholdHours;
      }
      if (processingMode.splitMinGapHours !== undefined) {
        settings.processingMode.splitMinGapHours = processingMode.splitMinGapHours;
      }
      if (processingMode.maxShiftsPerDay !== undefined) {
        settings.processingMode.maxShiftsPerDay = processingMode.maxShiftsPerDay;
      }
      if (processingMode.rosterStrictWhenPresent !== undefined) {
        settings.processingMode.rosterStrictWhenPresent = processingMode.rosterStrictWhenPresent;
      }
      if (processingMode.postShiftOutMarginHours !== undefined) {
        settings.processingMode.postShiftOutMarginHours = processingMode.postShiftOutMarginHours;
      }
    }

    if (featureFlags) {
      if (featureFlags.allowInTimeEditing !== undefined) {
        if (!settings.featureFlags) settings.featureFlags = {};
        settings.featureFlags.allowInTimeEditing = featureFlags.allowInTimeEditing;
      }
      if (featureFlags.allowOutTimeEditing !== undefined) {
        if (!settings.featureFlags) settings.featureFlags = {};
        settings.featureFlags.allowOutTimeEditing = featureFlags.allowOutTimeEditing;
      }
      if (featureFlags.allowAttendanceUpload !== undefined) {
        if (!settings.featureFlags) settings.featureFlags = {};
        settings.featureFlags.allowAttendanceUpload = featureFlags.allowAttendanceUpload;
      }
      if (featureFlags.allowShiftChange !== undefined) {
        if (!settings.featureFlags) settings.featureFlags = {};
        settings.featureFlags.allowShiftChange = featureFlags.allowShiftChange;
      }
    }

    await settings.save();

    // Restart sync job if auto-sync settings changed
    if (syncSettings && (syncSettings.autoSyncEnabled !== undefined || syncSettings.syncIntervalHours !== undefined)) {
      const { restartSyncJob } = require('../services/attendanceSyncJob');
      await restartSyncJob();
    }

    res.status(200).json({
      success: true,
      message: 'Attendance settings updated successfully',
      data: settings,
    });

  } catch (error) {
    console.error('Error updating attendance settings:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update attendance settings',
    });
  }
};

