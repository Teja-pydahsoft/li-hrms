/**
 * Attendance Sync Service
 * Handles syncing attendance logs from MSSQL to MongoDB
 * Processes raw logs and aggregates into daily records
 */

const AttendanceRawLog = require('../model/AttendanceRawLog');
const AttendanceDaily = require('../model/AttendanceDaily');
const AttendanceSettings = require('../model/AttendanceSettings');
const PreScheduledShift = require('../../shifts/model/PreScheduledShift');
const { fetchAttendanceLogsSQL } = require('../config/attendanceSQLHelper');
const Employee = require('../../employees/model/Employee');
const OD = require('../../leaves/model/OD');
const { detectAndAssignShift } = require('../../shifts/services/shiftDetectionService');
const { detectExtraHours } = require('./extraHoursService');
const Settings = require('../../settings/model/Settings');
const { extractISTComponents, createISTDate } = require('../../shared/utils/dateUtils');

const MAX_PAIRING_WINDOW_HOURS = 25; // Maximum allowed duration for a shift (prevents multi-day jumps)

/**
 * Format date to YYYY-MM-DD
 */
const formatDate = (date) => {
  return extractISTComponents(date).dateStr;
};

/**
 * Process raw logs and aggregate into daily records
 * NEW APPROACH: Process logs chronologically to correctly pair IN/OUT across days
 * @param {Array} rawLogs - Array of raw log objects
 * @param {Boolean} previousDayLinking - Whether to enable previous day linking (deprecated, using chronological approach)
 * @returns {Object} Statistics of processed records
 */
const processAndAggregateLogs = async (rawLogs, previousDayLinking = false, skipInsertion = false) => {
  const stats = {
    rawLogsInserted: 0,
    rawLogsSkipped: 0,
    redundantLogsFiltered: 0,
    dailyRecordsCreated: 0,
    dailyRecordsUpdated: 0,
    errors: [],
  };

  try {
    // Fetch global general settings (for grace periods, etc.)
    const generalConfig = await Settings.getSettingsByCategory('general');

    // First, insert all raw logs (Duplicate prevention)
    // SKIP if explicitly requested (e.g. from RealTime Controller which already saves)
    if (!skipInsertion) {
      for (const log of rawLogs) {
        try {
          const timestampStr = typeof log.timestamp === 'string' && !log.timestamp.endsWith('Z')
            ? `${log.timestamp}Z`
            : log.timestamp;
          const timestamp = new Date(timestampStr);
          const date = formatDate(timestamp);
          const logData = {
            employeeNumber: log.employeeNumber,
            timestamp: timestamp,
            type: log.type,
            source: log.source || 'mssql',
            date: date,
            rawData: log.rawData,
          };

          // Try to insert (will fail if duplicate due to unique index)
          try {
            await AttendanceRawLog.create(logData);
            stats.rawLogsInserted++;
          } catch (error) {
            if (error.code === 11000) {
              // Duplicate - skip
              stats.rawLogsSkipped++;
            } else {
              throw error;
            }
          }
        } catch (error) {
          stats.errors.push(`Error processing log for ${log.employeeNumber}: ${error.message}`);
        }
      }
    }


    // NEW: Filter redundant logs within 30-minute window
    const REDUNDANCY_WINDOW_MINUTES = 30;
    const filteredLogs = filterRedundantLogs(rawLogs, REDUNDANCY_WINDOW_MINUTES);
    stats.redundantLogsFiltered = rawLogs.length - filteredLogs.length;
    
    console.log(`[SyncService] Redundancy Filter: ${rawLogs.length} -> ${filteredLogs.length} logs (${stats.redundantLogsFiltered} filtered)`);

    // NEW APPROACH: Group logs by employee, then process chronologically
    const logsByEmployee = {};

    // Fetch all logs for employees involved (to get complete picture across days)
    const employeeNumbers = [...new Set(filteredLogs.map(log => log.employeeNumber.toUpperCase()))];

    for (const empNo of employeeNumbers) {
      // Get all logs for this employee from database (chronologically sorted)
      // We need a date range - use dates from filtered logs
      const dates = [...new Set(filteredLogs.filter(l => l.employeeNumber.toUpperCase() === empNo).map(l => formatDate(l.timestamp)))];
      const minDate = dates.sort()[0];
      const maxDate = dates.sort()[dates.length - 1];

      // Extend range by 1 day on each side to catch overnight shifts
      const minDateObj = new Date(minDate);
      const maxDateObj = new Date(maxDate); // Ensure separate instance
      minDateObj.setDate(minDateObj.getDate() - 1);
      maxDateObj.setDate(maxDateObj.getDate() + 1);

      const allLogs = await AttendanceRawLog.find({
        employeeNumber: empNo,
        date: {
          $gte: formatDate(minDateObj),
          $lte: formatDate(maxDateObj),
        },
        timestamp: { $gte: new Date('2020-01-01') }, // Ignore ancient logs (1899/1900)
        type: { $in: ['IN', 'OUT', null] }, // CRITICAL: Include null-type (Thumb only) for Smart Pairing
      }).sort({ timestamp: 1 }); // Sort chronologically

      logsByEmployee[empNo] = allLogs.map(log => ({
        timestamp: new Date(log.timestamp),
        type: log.type,
        _id: log._id,
      }));
    }

    // NEW APPROACH: Process logs using Multi-Shift Engine
    const { processMultiShiftAttendance } = require('./multiShiftProcessingService');

    for (const [employeeNumber, logs] of Object.entries(logsByEmployee)) {
      try {
        // Group logs by date for this employee
        const logsByDate = {};
        for (const log of logs) {
          const date = formatDate(log.timestamp);
          if (!logsByDate[date]) logsByDate[date] = [];
          logsByDate[date].push(log);
        }

        // Process each date that has regular logs
        for (const date of Object.keys(logsByDate)) {
          console.log(`[SyncService] Processing Multi-Shift: Emp=${employeeNumber}, Date=${date}`);

          const result = await processMultiShiftAttendance(
            employeeNumber,
            date,
            logs, // Pass ALL logs for cross-day context
            generalConfig
          );

          if (result.success) {
            // Stats tracking
            if (result.isNew) stats.dailyRecordsCreated++;
            else stats.dailyRecordsUpdated++;
          } else {
            stats.errors.push(`${employeeNumber} on ${date}: ${result.reason || result.error || 'Failed'}`);
          }
        }
      } catch (error) {
        stats.errors.push(`Error processing employee ${employeeNumber}: ${error.message}`);
      }
    }

    return stats;
  } catch (error) {
    stats.errors.push(`Error in processAndAggregateLogs: ${error.message}`);
    return stats;
  }
};

/**
 * Apply previous day linking heuristic
 * If previous day has 1 log and current day has 1 log, link them
 */
const applyPreviousDayLinking = async (logsByEmployeeAndDate) => {
  // This is a simplified version - can be enhanced
  // For now, we'll mark these for admin review if needed
  // The actual linking logic can be more complex based on shift times
  // TODO: Implement full previous day linking logic
};

/**
 * Sync attendance from MSSQL to MongoDB
 * @param {Date} fromDate - Start date (optional, defaults to last 7 days)
 * @param {Date} toDate - End date (optional, defaults to today)
 * @returns {Object} Sync statistics
 */
const syncAttendanceFromMSSQL = async (fromDate = null, toDate = null) => {
  const stats = {
    success: false,
    rawLogsFetched: 0,
    rawLogsInserted: 0,
    rawLogsSkipped: 0,
    redundantLogsFiltered: 0,
    dailyRecordsCreated: 0,
    dailyRecordsUpdated: 0,
    errors: [],
    message: '',
  };

  try {
    // Get settings
    const settings = await AttendanceSettings.getSettings();

    if (settings.dataSource !== 'mssql') {
      throw new Error('Data source is not set to MSSQL');
    }

    if (!settings.mssqlConfig.databaseName || !settings.mssqlConfig.tableName) {
      throw new Error('MSSQL configuration is incomplete');
    }

    // Set default date range if not provided (IST aware)
    if (!fromDate) {
      const { year, month, day } = extractISTComponents(new Date());
      fromDate = createISTDate(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
      fromDate.setDate(fromDate.getDate() - 7); // Last 7 days
    }
    if (!toDate) {
      const { dateStr } = extractISTComponents(new Date());
      toDate = createISTDate(dateStr);
      // toDate should represent the end of the day or just the date boundary
    }

    // Fetch logs from MSSQL
    const rawLogs = await fetchAttendanceLogsSQL(settings, fromDate, toDate);
    stats.rawLogsFetched = rawLogs.length;

    if (rawLogs.length === 0) {
      stats.message = 'No logs found in MSSQL for the specified date range';
      stats.success = true;
      return stats;
    }

    // Process and aggregate
    const processStats = await processAndAggregateLogs(
      rawLogs,
      settings.previousDayLinking?.enabled || false
    );

    stats.rawLogsInserted = processStats.rawLogsInserted;
    stats.rawLogsSkipped = processStats.rawLogsSkipped;
    stats.redundantLogsFiltered = processStats.redundantLogsFiltered;
    stats.dailyRecordsCreated = processStats.dailyRecordsCreated;
    stats.dailyRecordsUpdated = processStats.dailyRecordsUpdated;
    stats.errors = processStats.errors;

    // Update sync status in settings
    await AttendanceSettings.findOneAndUpdate(
      {},
      {
        $set: {
          'syncSettings.lastSyncAt': new Date(),
          'syncSettings.lastSyncStatus': stats.errors.length > 0 ? 'failed' : 'success',
          'syncSettings.lastSyncMessage': stats.errors.length > 0
            ? `Sync completed with ${stats.errors.length} errors`
            : `Successfully synced ${stats.rawLogsInserted} logs`,
        },
      }
    );

    stats.success = true;
    stats.message = `Successfully synced ${stats.rawLogsInserted} logs, filtered ${stats.redundantLogsFiltered} redundant logs, created ${stats.dailyRecordsCreated} daily records, updated ${stats.dailyRecordsUpdated} records`;

    // NEW: Run Absenteeism Check (Auto-deactivation)
    try {
      const { ensureDailyRecordsExist, checkConsecutiveAbsences } = require('./absenteeismService');
      const checkDate = toDate instanceof Date ? toDate : new Date(toDate);
      const checkDateStr = formatDate(checkDate);

      console.log(`[AttendanceSync] Running absenteeism check for ${checkDateStr}...`);

      // 1. Ensure records exist for today (or sync end date)
      // We also check previous few days just in case, but primary focus is current sync window
      await ensureDailyRecordsExist(checkDateStr);

      // 2. Check for 3 consecutive absences
      await checkConsecutiveAbsences(checkDateStr);

      // 3. Removed: Auto-OD Creation for Holidays/Week-offs (Moved to calculation engine)

    } catch (absentError) {
      console.error('[AttendanceSync] Error in absenteeism check:', absentError);
      // We don't fail the sync stats if this auxiliary task fails, but we log it
    }

  } catch (error) {
    stats.success = false;
    stats.errors.push(error.message);
    stats.message = `Sync failed: ${error.message}`;

    // Update sync status
    try {
      await AttendanceSettings.findOneAndUpdate(
        {},
        {
          $set: {
            'syncSettings.lastSyncAt': new Date(),
            'syncSettings.lastSyncStatus': 'failed',
            'syncSettings.lastSyncMessage': error.message,
          },
        }
      );
    } catch (updateError) {
      // Ignore update error
    }
  }

  return stats;
};

/**
 * Filter redundant logs within specified time window
 * @param {Array} logs - Array of raw log objects
 * @param {number} windowMinutes - Time window in minutes (default: 30)
 * @returns {Array} - Filtered logs array
 */
const filterRedundantLogs = (logs, windowMinutes = 30) => {
  const filteredLogs = [];
  const windowMs = windowMinutes * 60 * 1000;

  // Sort logs chronologically for processing
  const sortedLogs = logs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  for (const log of sortedLogs) {
    const logTimestamp = new Date(log.timestamp);
    const logType = log.type || 'IN';
    
    // Check if this log is redundant with any previously accepted log
    const isRedundant = filteredLogs.some(existingLog => {
      const existingTimestamp = new Date(existingLog.timestamp);
      const existingType = existingLog.type || 'IN';
      
      // Same employee, same type, within time window
      return (
        existingLog.employeeNumber === log.employeeNumber &&
        existingType === logType &&
        Math.abs(existingTimestamp.getTime() - logTimestamp.getTime()) <= windowMs
      );
    });

    if (!isRedundant) {
      filteredLogs.push(log);
    } else {
      console.log(`🚫 Filtered redundant log: Employee ${log.employeeNumber}, Time ${logTimestamp.toISOString()}, Type ${logType} (within ${windowMinutes}min window)`);
    }
  }

  return filteredLogs;
};

module.exports = {
  syncAttendanceFromMSSQL,
  processAndAggregateLogs,
  formatDate,
  filterRedundantLogs
};

