const EarlyOutSettings = require('../model/EarlyOutSettings');
const cacheService = require('../../shared/services/cacheService');

/**
 * Early-Out Deduction Service
 * Calculates deductions based on early-out minutes and configured ranges
 */

/**
 * Calculate deduction for a single early-out instance
 * @param {Number} earlyOutMinutes - Minutes of early-out
 * @param {Object} [providedSettings] - Optional settings to avoid DB hit (for batching)
 * @returns {Object} Deduction details
 */
async function calculateEarlyOutDeduction(earlyOutMinutes, providedSettings = null) {
  try {
    // Get active early-out settings (with caching)
    let settings = providedSettings;
    if (!settings) {
      const cacheKey = 'settings:early_out:active';
      settings = await cacheService.get(cacheKey);

      if (!settings) {
        settings = await EarlyOutSettings.getActiveSettings();
        if (settings) {
          // Cache for 10 minutes
          await cacheService.set(cacheKey, settings, 600);
        }
      }
    }

    // If early-out settings are disabled, return no deduction
    if (!settings || !settings.isEnabled) {
      return {
        deductionApplied: false,
        reason: 'Early-out settings disabled',
        deductionType: null,
        deductionAmount: null,
        deductionDays: null,
      };
    }

    // If early-out is within allowed duration, no deduction
    if (earlyOutMinutes <= settings.allowedDurationMinutes) {
      return {
        deductionApplied: false,
        reason: `Within allowed duration (${settings.allowedDurationMinutes} minutes)`,
        deductionType: null,
        deductionAmount: null,
        deductionDays: null,
      };
    }

    // If early-out is less than minimum duration, no deduction
    if (earlyOutMinutes < settings.minimumDuration) {
      return {
        deductionApplied: false,
        reason: `Below minimum duration (${settings.minimumDuration} minutes)`,
        deductionType: null,
        deductionAmount: null,
        deductionDays: null,
      };
    }

    // Find matching deduction range
    if (!settings.deductionRanges || settings.deductionRanges.length === 0) {
      return {
        deductionApplied: false,
        reason: 'No deduction ranges configured',
        deductionType: null,
        deductionAmount: null,
        deductionDays: null,
      };
    }

    // Sort ranges by minMinutes (ascending)
    const sortedRanges = [...settings.deductionRanges].sort((a, b) => a.minMinutes - b.minMinutes);

    // Find the range that matches the early-out minutes
    let matchingRange = null;
    for (const range of sortedRanges) {
      if (earlyOutMinutes >= range.minMinutes && earlyOutMinutes <= range.maxMinutes) {
        matchingRange = range;
        break;
      }
    }

    // If no matching range found, check if it exceeds the highest range
    if (!matchingRange && sortedRanges.length > 0) {
      const highestRange = sortedRanges[sortedRanges.length - 1];
      if (earlyOutMinutes > highestRange.maxMinutes) {
        matchingRange = highestRange; // Apply the highest range's deduction
      }
    }

    if (!matchingRange) {
      return {
        deductionApplied: false,
        reason: 'No matching deduction range found',
        deductionType: null,
        deductionAmount: null,
        deductionDays: null,
      };
    }

    // Calculate deduction based on type
    let deductionDays = null;
    let deductionAmount = null;

    switch (matchingRange.deductionType) {
      case 'quarter_day':
        deductionDays = 0.25;
        break;
      case 'half_day':
        deductionDays = 0.5;
        break;
      case 'full_day':
        deductionDays = 1.0;
        break;
      case 'custom_amount':
        deductionAmount = matchingRange.deductionAmount;
        break;
    }

    return {
      deductionApplied: true,
      reason: `Matched range: ${matchingRange.minMinutes}-${matchingRange.maxMinutes} minutes`,
      deductionType: matchingRange.deductionType,
      deductionAmount,
      deductionDays,
      rangeDescription: matchingRange.description || '',
    };
  } catch (error) {
    console.error('Error calculating early-out deduction:', error);
    return {
      deductionApplied: false,
      reason: 'Error calculating deduction',
      error: error.message,
      deductionType: null,
      deductionAmount: null,
      deductionDays: null,
    };
  }
}

/**
 * Calculate total early-out deductions for a month
 * @param {String} employeeNumber - Employee number
 * @param {Number} year - Year
 * @param {Number} monthNumber - Month number (1-12)
 * @returns {Object} Summary of early-out deductions
 */
async function calculateMonthlyEarlyOutDeductions(employeeNumber, year, monthNumber) {
  try {
    const AttendanceDaily = require('../model/AttendanceDaily');
    const startDate = `${year}-${String(monthNumber).padStart(2, '0')}-01`;
    const endDate = new Date(year, monthNumber, 0);
    const endDateStr = `${year}-${String(monthNumber).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

    // Get all attendance records for the month that have any recorded early-out minutes
    // (we'll later constrain to first shift only when calculating)
    const attendanceRecords = await AttendanceDaily.find({
      employeeNumber: employeeNumber.toUpperCase(),
      date: { $gte: startDate, $lte: endDateStr },
      totalEarlyOutMinutes: { $exists: true, $ne: null, $gt: 0 },
    });

    let totalEarlyOutMinutes = 0;
    let totalDeductionDays = 0;
    let totalDeductionAmount = 0;
    const deductionBreakdown = {
      quarter_day: 0,
      half_day: 0,
      full_day: 0,
      custom_amount: 0,
    };

    // Get settings once for the month (batching optimization)
    const settingsCacheKey = 'settings:early_out:active';
    let settings = await cacheService.get(settingsCacheKey);
    if (!settings) {
      settings = await EarlyOutSettings.getActiveSettings();
      if (settings) await cacheService.set(settingsCacheKey, settings, 600);
    }

    // Only count early-out and apply deduction on PRESENT (full) days. Half-days are already deducted (0.5 pay); do not double-count.
    const isPresentDay = (record) => record.status === 'PRESENT';

    // Calculate deductions for each day using all shifts (sum early-out minutes per day) — only for PRESENT days
    for (const record of attendanceRecords) {
      if (!isPresentDay(record)) continue;

      const shifts = Array.isArray(record.shifts) ? record.shifts : [];
      let dayEarlyOut = 0;
      if (shifts.length > 0) {
        for (const s of shifts) {
          if (s.earlyOutMinutes != null && s.earlyOutMinutes > 0) {
            dayEarlyOut += Number(s.earlyOutMinutes);
          }
        }
      } else {
        dayEarlyOut = Number(record.totalEarlyOutMinutes) || 0;
      }

      if (dayEarlyOut > 0) {
        totalEarlyOutMinutes += dayEarlyOut;

        // Calculate deduction for this day - PASS SETTINGS to avoid redundant DB hits
        const deduction = await calculateEarlyOutDeduction(dayEarlyOut, settings);

        if (deduction.deductionApplied) {
          if (deduction.deductionDays) {
            totalDeductionDays += deduction.deductionDays;
            deductionBreakdown[deduction.deductionType] += deduction.deductionDays;
          }
          if (deduction.deductionAmount) {
            totalDeductionAmount += deduction.deductionAmount;
            deductionBreakdown.custom_amount += deduction.deductionAmount;
          }
        }
      }
    }

    // earlyOutCount = number of PRESENT days with at least one early-out (half-days excluded — already deducted as half-day)
    const earlyOutCount = totalEarlyOutMinutes > 0
      ? attendanceRecords.reduce((count, record) => {
          if (!isPresentDay(record)) return count;
          const shifts = Array.isArray(record.shifts) ? record.shifts : [];
          let dayEarlyOut = 0;
          if (shifts.length > 0) {
            for (const s of shifts) {
              if (s.earlyOutMinutes != null && s.earlyOutMinutes > 0) {
                dayEarlyOut += Number(s.earlyOutMinutes);
              }
            }
          } else {
            dayEarlyOut = Number(record.totalEarlyOutMinutes) || 0;
          }
          return dayEarlyOut > 0 ? count + 1 : count;
        }, 0)
      : 0;

    return {
      totalEarlyOutMinutes: Math.round(totalEarlyOutMinutes * 100) / 100,
      totalDeductionDays: Math.round(totalDeductionDays * 100) / 100,
      totalDeductionAmount: Math.round(totalDeductionAmount * 100) / 100,
      deductionBreakdown,
      earlyOutCount,
    };
  } catch (error) {
    console.error('Error calculating monthly early-out deductions:', error);
    return {
      totalEarlyOutMinutes: 0,
      totalDeductionDays: 0,
      totalDeductionAmount: 0,
      deductionBreakdown: {
        quarter_day: 0,
        half_day: 0,
        full_day: 0,
        custom_amount: 0,
      },
      earlyOutCount: 0,
      error: error.message,
    };
  }
}

module.exports = {
  calculateEarlyOutDeduction,
  calculateMonthlyEarlyOutDeductions,
};

