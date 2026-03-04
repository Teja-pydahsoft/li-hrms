/**
 * Attendance Daily Model
 * Aggregated daily view - one document per employee per date
 */

const mongoose = require('mongoose');
const { extractISTComponents } = require('../../shared/utils/dateUtils');

const attendanceDailySchema = new mongoose.Schema(
  {
    employeeNumber: {
      type: String,
      required: [true, 'Employee number is required'],
      trim: true,
      uppercase: true,
      index: true,
    },
    date: {
      type: String, // YYYY-MM-DD format
      required: [true, 'Date is required'],
      index: true,
    },
    // ========== MULTI-SHIFT SUPPORT ==========
    // Array to store multiple shifts per day (up to 3)
    shifts: [{
      shiftNumber: {
        type: Number,
        required: true,
        min: 1,
        max: 3,
      },
      inTime: {
        type: Date,
        required: true,
      },
      outTime: {
        type: Date,
        default: null,
      },
      duration: {
        type: Number, // in minutes
        default: null,
      },
      workingHours: {
        type: Number, // actual working hours for this shift (punch + od)
        default: null,
      },
      punchHours: {
        type: Number, // working hours from actual punches
        default: 0,
      },
      odHours: {
        type: Number, // working hours added from OD gap filling
        default: 0,
      },
      otHours: {
        type: Number, // OT hours for this shift
        default: 0,
      },
      shiftId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Shift',
        default: null,
      },
      shiftName: {
        type: String,
        default: null,
      },
      shiftStartTime: {
        type: String, // HH:MM
        default: null,
      },
      shiftEndTime: {
        type: String, // HH:MM
        default: null,
      },
      lateInMinutes: {
        type: Number,
        default: null,
      },
      earlyOutMinutes: {
        type: Number,
        default: null,
      },
      isLateIn: {
        type: Boolean,
        default: false,
      },
      isEarlyOut: {
        type: Boolean,
        default: false,
      },
      status: {
        type: String,
        enum: ['complete', 'incomplete', 'PRESENT', 'ABSENT', 'PARTIAL', 'HALF_DAY'],
        default: 'incomplete',
      },
      payableShift: {
        type: Number,
        default: 0, // 0, 0.5, 1
      },
      expectedHours: {
        type: Number,
        default: null, // From shift.duration for OT/extra calculation
      },
      extraHours: {
        type: Number,
        default: 0, // workingHours - expectedHours when > 0
      },
    }],
    // Aggregate fields for multi-shift
    totalShifts: {
      type: Number,
      default: 0,
      min: 0,
      max: 3,
    },
    totalWorkingHours: {
      type: Number, // Sum of all shift working hours
      default: 0,
    },
    totalOTHours: {
      type: Number, // Sum of all shift OT hours
      default: 0,
    },
    payableShifts: {
      type: Number, // Sum of payable shifts (e.g. 1.5)
      default: 0,
    },
    // ========== NEW AGGREGATE FIELDS ==========
    totalLateInMinutes: {
      type: Number,
      default: 0
    },
    totalEarlyOutMinutes: {
      type: Number,
      default: 0
    },
    totalExpectedHours: {
      type: Number,
      default: 0
    },

    status: {
      type: String,
      enum: ['PRESENT', 'ABSENT', 'PARTIAL', 'HALF_DAY', 'HOLIDAY', 'WEEK_OFF'],
      default: 'ABSENT',
    },
    isEdited: {
      type: Boolean,
      default: false,
    },
    editHistory: [{
      action: {
        type: String,
        enum: ['OUT_TIME_UPDATE', 'SHIFT_CHANGE', 'OT_CONVERSION', 'IN_TIME_UPDATE'],
        required: true,
      },
      modifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      modifiedByName: String,
      modifiedAt: {
        type: Date,
        default: Date.now,
      },
      details: String,
    }],
    source: {
      type: [String],
      enum: ['mssql', 'excel', 'manual', 'biometric-realtime', 'roster-sync'],
      default: [],
    },
    lastSyncedAt: {
      type: Date,
      default: null,
    },
    locked: {
      type: Boolean,
      default: false, // For manual overrides
    },
    notes: {
      type: String,
      trim: true,
      default: null,
    },
    // Overtime and extra hours
    otHours: {
      type: Number,
      default: 0, // Overtime hours (from approved OT request) - Keeping for backward compat / manual OT
    },
    extraHours: {
      type: Number,
      default: 0, // Sum of extra hours from all shifts
    },
    // Permission fields
    permissionHours: {
      type: Number,
      default: 0, // Total permission hours for the day
    },
    permissionCount: {
      type: Number,
      default: 0, // Number of permissions taken on this day
    },
    permissionDeduction: {
      type: Number,
      default: 0, // Total deduction amount for permissions (if deduction is enabled)
    },
    // NEW: OD (On-Duty) hours field
    odHours: {
      type: Number,
      default: 0, // Hours spent on OD (from approved hour-based OD)
    },
    // Store full OD details for display
    odDetails: {
      odStartTime: String, // HH:MM format (e.g., "10:00")
      odEndTime: String,   // HH:MM format (e.g., "14:30")
      durationHours: Number, // Duration in hours
      odType: {
        type: String,
        enum: ['full_day', 'half_day', 'hours', null],
        default: null,
      },
      odId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'OD',
        default: null,
      },
      approvedAt: Date,
      approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
    },
    // NEW: Early-Out Deduction Fields
    earlyOutDeduction: {
      deductionApplied: {
        type: Boolean,
        default: false,
      },
      deductionType: {
        type: String,
        enum: ['quarter_day', 'half_day', 'full_day', 'custom_amount', null],
        default: null,
      },
      deductionDays: {
        type: Number,
        default: null,
      },
      deductionAmount: {
        type: Number,
        default: null,
      },
      reason: {
        type: String,
        default: null,
      },
      rangeDescription: {
        type: String,
        default: null,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Unique index: one record per employee per date
attendanceDailySchema.index({ employeeNumber: 1, date: 1 }, { unique: true, background: true });

// Index for calendar and reporting queries
attendanceDailySchema.index({ date: 1, status: 1 }, { background: true });

// Index for employee history/list queries (Compound for performance)
attendanceDailySchema.index({ employeeNumber: 1, date: -1 }, { background: true });

// Index for shift-based analytics
attendanceDailySchema.index({ shiftId: 1, date: 1 }, { background: true });

// Method to calculate total hours
// Handles overnight shifts where out-time is before in-time (next day scenario)
// Method to calculate total hours - REMOVED (Legacy)

// Pre-save hook to calculate aggregates from shifts array + OD enrichment
attendanceDailySchema.pre('save', async function () {
  // Fetch roster status once for both shifts-based and legacy logic (HOL/WO, remarks)
  let rosterStatus = null;
  try {
    const PreScheduledShift = require('../../shifts/model/PreScheduledShift');
    const rosterEntry = await PreScheduledShift.findOne({
      employeeNumber: this.employeeNumber,
      date: this.date,
    });
    rosterStatus = rosterEntry?.status; // 'WO' or 'HOL'
  } catch (err) {
    console.error('[AttendanceDaily Model] Error fetching roster status:', err);
  }

  // OD enrichment: add approved OD contribution to totalWorkingHours, payableShifts, status
  let odPayableContribution = 0;
  let odPayableContributionHourBased = 0; // when we apply at shift level, don't add this again to daily payable
  let odHoursContribution = 0;
  let odDetailsFromOD = null;
  let approvedODs = [];
  try {
    const OD = require('../../leaves/model/OD');
    const dayStart = new Date(`${this.date}T00:00:00+05:30`);
    const dayEnd = new Date(`${this.date}T23:59:59.999+05:30`);
    approvedODs = await OD.find({
      emp_no: this.employeeNumber,
      status: 'approved',
      isActive: true,
      fromDate: { $lte: dayEnd },
      toDate: { $gte: dayStart },
    }).select('odType_extended isHalfDay durationHours odStartTime odEndTime').lean();

    for (const od of approvedODs || []) {
      if (!odDetailsFromOD) {
        odDetailsFromOD = {
          odStartTime: od.odStartTime,
          odEndTime: od.odEndTime,
          durationHours: od.durationHours,
          odType: od.odType_extended || (od.isHalfDay ? 'half_day' : 'full_day'),
        };
      }
      if (od.odType_extended === 'hours') {
        odHoursContribution += Number(od.durationHours) || 0;
        const hourPay = Math.min(1, ((Number(od.durationHours) || 0) / 8));
        odPayableContribution += hourPay;
        odPayableContributionHourBased += hourPay;
      } else if (od.odType_extended === 'half_day' || od.isHalfDay) {
        odPayableContribution += 0.5;
      } else {
        odPayableContribution += 1;
      }
    }
    odPayableContribution = Math.round(odPayableContribution * 100) / 100;
    odPayableContributionHourBased = Math.round(odPayableContributionHourBased * 100) / 100;
    odHoursContribution = Math.round(odHoursContribution * 100) / 100;
  } catch (err) {
    console.error('[AttendanceDaily Model] Error fetching OD for enrichment:', err);
  }

  // Update each shift in shifts array with OD gap-fill (hour-based OD with start/end times) so segment view is correct
  let appliedShiftLevelOD = false;
  const timeStrToMins = (t) => {
    if (!t || typeof t !== 'string') return 0;
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const timeStrToDate = (timeStr, dateStr, nextDay) => {
    if (!timeStr || !dateStr) return null;
    let d = dateStr;
    if (nextDay) {
      const x = new Date(dateStr + 'T12:00:00+05:30');
      x.setDate(x.getDate() + 1);
      d = extractISTComponents(x).dateStr;
    }
    const [h, m] = timeStr.split(':').map(Number);
    const hs = String(h ?? 0).padStart(2, '0');
    const ms = String(m ?? 0).padStart(2, '0');
    return new Date(`${d}T${hs}:${ms}:00+05:30`);
  };
  const getOverlapMinutes = (startA, endA, startB, endB) => {
    if (!startA || !endA || !startB || !endB) return 0;
    const start = Math.max(startA.getTime(), startB.getTime());
    const end = Math.min(endA.getTime(), endB.getTime());
    return Math.max(0, (end - start) / (1000 * 60));
  };

  if (this.shifts && this.shifts.length > 0 && approvedODs && approvedODs.length > 0) {
    const hourBasedODs = approvedODs.filter((od) => od.odType_extended === 'hours' && od.odStartTime && od.odEndTime);
    if (hourBasedODs.length > 0) {
      appliedShiftLevelOD = true;
      for (const shift of this.shifts) {
        if (!shift.shiftStartTime || !shift.shiftEndTime) continue;
        const punchIn = shift.inTime ? new Date(shift.inTime) : null;
        const punchOut = shift.outTime ? new Date(shift.outTime) : null;
        const isOvernight = timeStrToMins(shift.shiftEndTime) <= timeStrToMins(shift.shiftStartTime);
        const shiftStartDate = timeStrToDate(shift.shiftStartTime, this.date, false);
        const shiftEndDate = timeStrToDate(shift.shiftEndTime, this.date, isOvernight);
        let addedOdMinutes = 0;
        for (const od of hourBasedODs) {
          const odEndNextDay = timeStrToMins(od.odEndTime) <= timeStrToMins(od.odStartTime);
          const odStart = timeStrToDate(od.odStartTime, this.date, false);
          const odEnd = timeStrToDate(od.odEndTime, this.date, odEndNextDay);
          const odInShiftOverlap = getOverlapMinutes(shiftStartDate, shiftEndDate, odStart, odEnd);
          let odInPunchOverlap = 0;
          if (punchIn && punchOut) {
            odInPunchOverlap = getOverlapMinutes(punchIn, punchOut, odStart, odEnd);
          }
          addedOdMinutes += Math.max(0, odInShiftOverlap - odInPunchOverlap);
          // Waive early-out when approved OD end covers shift end (OD covers time after punch-out)
          if (shift.isEarlyOut && punchOut && odStart <= punchOut && odEnd >= shiftEndDate) {
            shift.isEarlyOut = false;
            shift.earlyOutMinutes = 0;
          }
          // Waive late-in when approved OD start is at or before shift start (OD covers time before punch-in)
          if (shift.isLateIn && punchIn && odStart <= shiftStartDate && odEnd >= punchIn) {
            shift.isLateIn = false;
            shift.lateInMinutes = 0;
          }
        }
        const addedOdHours = Math.round((addedOdMinutes / 60) * 100) / 100;
        shift.odHours = addedOdHours;
        shift.workingHours = Math.round(((Number(shift.punchHours) || 0) + addedOdHours) * 100) / 100;
        const expectedHours = Number(shift.expectedHours) || 8;
        const statusDuration = (Number(shift.punchHours) || 0) + addedOdHours;
        const basePayable = 1;
        // When hour-based OD contributes hours and total (punch + OD) satisfies shift duration: mark PRESENT, full payable, early-out already waived above
        if (statusDuration >= expectedHours * 0.75) {
          shift.status = 'PRESENT';
          shift.payableShift = basePayable;
        } else if (statusDuration >= expectedHours * 0.4) {
          shift.status = 'HALF_DAY';
          shift.payableShift = basePayable * 0.5;
        } else {
          shift.status = shift.inTime && (shift.outTime || addedOdHours > 0) ? 'HALF_DAY' : 'ABSENT';
          shift.payableShift = statusDuration >= expectedHours * 0.4 ? basePayable * 0.5 : 0;
        }
      }
    }
  }

  if (this.shifts && this.shifts.length > 0) {
    // 1. Calculate Aggregate Totals (shift.workingHours already includes OD when appliedShiftLevelOD)
    let totalWorking = 0;
    let totalOT = 0;
    let totalExtra = 0;
    let totalLateIn = 0;
    let totalEarlyOut = 0;
    let totalExpected = 0;

    // Calculate totals from shifts
    this.shifts.forEach((shift) => {
      totalWorking += shift.workingHours || 0;
      totalOT += shift.otHours || 0;
      totalExtra += shift.extraHours || 0;

      // Accumulate minutes
      if (shift.lateInMinutes > 0) totalLateIn += shift.lateInMinutes;
      if (shift.earlyOutMinutes > 0) totalEarlyOut += shift.earlyOutMinutes;

      // Expected hours (from shift definition if available)
      totalExpected += shift.expectedHours || 8;
    });

    this.totalWorkingHours = appliedShiftLevelOD
      ? Math.round(totalWorking * 100) / 100
      : Math.round((totalWorking + odHoursContribution) * 100) / 100;
    this.totalOTHours = Math.round(totalOT * 100) / 100;
    this.extraHours = Math.round(totalExtra * 100) / 100;
    this.totalLateInMinutes = totalLateIn;
    this.totalEarlyOutMinutes = totalEarlyOut;
    this.totalExpectedHours = totalExpected;
    if (appliedShiftLevelOD) {
      this.odHours = Math.round(this.shifts.reduce((s, sh) => s + (Number(sh.odHours) || 0), 0) * 100) / 100;
      if (odDetailsFromOD) this.odDetails = { ...(this.odDetails || {}), ...odDetailsFromOD };
    } else if (odHoursContribution > 0) {
      this.odHours = (Number(this.odHours) || 0) + odHoursContribution;
      if (odDetailsFromOD) this.odDetails = { ...(this.odDetails || {}), ...odDetailsFromOD };
    }

    // 2. Status Determination (includes OD contribution: cumulative punch + OD)
    // Half-day OD: if day already had HALF_DAY from punches (0.5), adding half-day OD (0.5) -> total 1.0 -> PRESENT.
    // If day had no half-day from punches, half-day OD alone -> 0.5 payable -> HALF_DAY. Monthly summary is updated in post-save.
    const hasPresentShift = this.shifts.some(s => s.status === 'complete' || s.status === 'PRESENT');
    const hasHalfDayShift = this.shifts.some(s => s.status === 'HALF_DAY');
    const totalPayableFromShifts = this.shifts.reduce((acc, s) => acc + (s.payableShift || 0), 0);
    // When OD was applied at shift level, hour-based payable is already in shift.payableShift; add only half/full-day OD
    const payableToAdd = appliedShiftLevelOD
      ? odPayableContribution - (odPayableContributionHourBased || 0)
      : odPayableContribution;
    const totalPayableWithOD = totalPayableFromShifts + Math.max(0, payableToAdd);
    this.payableShifts = Math.round(totalPayableWithOD * 100) / 100;

    if (hasPresentShift || totalPayableWithOD >= 0.95) {
      this.status = 'PRESENT'; // e.g. half-day punch + half-day OD = 1.0 -> PRESENT
    } else if (hasHalfDayShift || totalPayableWithOD >= 0.45) {
      this.status = 'HALF_DAY'; // e.g. half-day OD only -> 0.5 -> HALF_DAY
    } else {
      const hasPunches = this.shifts.some(s => s.inTime || (s.outTime && s.outTime !== s.inTime));
      this.status = hasPunches ? 'PARTIAL' : 'ABSENT';
    }
  } else {
    // No shifts (OD-only or no punches): use OD contribution; half-day OD -> HALF_DAY, full-day OD -> PRESENT
    if (odPayableContribution > 0 || odHoursContribution > 0) {
      this.payableShifts = Math.round(odPayableContribution * 100) / 100;
      this.totalWorkingHours = Math.round(((Number(this.totalWorkingHours) || 0) + odHoursContribution) * 100) / 100;
      if (odHoursContribution > 0) {
        this.odHours = odHoursContribution;
        if (odDetailsFromOD) this.odDetails = odDetailsFromOD;
      }
      if (this.payableShifts >= 0.95) this.status = 'PRESENT';   // full-day OD or multiple OD
      else if (this.payableShifts >= 0.45) this.status = 'HALF_DAY'; // half-day OD
      else this.status = 'PARTIAL';
    } else if (this.totalWorkingHours > 0) {
      this.status = 'PRESENT'; // Simplified fallback
    } else {
      this.payableShifts = 0;
      if (rosterStatus === 'HOL') this.status = 'HOLIDAY';
      else if (rosterStatus === 'WO') this.status = 'WEEK_OFF';
      else this.status = 'ABSENT';
    }
    // Special Requirement: If worked on Holiday/Week-Off (have punches on HOL/WO day), add remark
    // Checked via totalWorkingHours now
    if ((rosterStatus === 'HOL' || rosterStatus === 'WO') && (this.totalWorkingHours > 0)) {
      const dayLabel = rosterStatus === 'HOL' ? 'Holiday' : 'Week Off';
      const remark = `Worked on ${dayLabel}`;
      if (!this.notes) {
        this.notes = remark;
      } else if (!this.notes.includes(remark)) {
        this.notes = `${this.notes} | ${remark}`;
      }
    }
  }

  // Calculate early-out deduction if totalEarlyOutMinutes exists
  if (this.totalEarlyOutMinutes && this.totalEarlyOutMinutes > 0) {
    try {
      const { calculateEarlyOutDeduction } = require('../services/earlyOutDeductionService');
      const deduction = await calculateEarlyOutDeduction(this.totalEarlyOutMinutes);

      // Update early-out deduction fields
      this.earlyOutDeduction = {
        deductionApplied: deduction.deductionApplied,
        deductionType: deduction.deductionType,
        deductionDays: deduction.deductionDays,
        deductionAmount: deduction.deductionAmount,
        reason: deduction.reason,
        rangeDescription: deduction.rangeDescription || null,
      };
    } catch (error) {
      console.error('Error calculating early-out deduction:', error);
      // Don't throw - set default values
      this.earlyOutDeduction = {
        deductionApplied: false,
        deductionType: null,
        deductionDays: null,
        deductionAmount: null,
        reason: 'Error calculating deduction',
        rangeDescription: null,
      };
    }
  } else {
    // Reset deduction if no early-out
    this.earlyOutDeduction = {
      deductionApplied: false,
      deductionType: null,
      deductionDays: null,
      deductionAmount: null,
      reason: null,
      rangeDescription: null,
    };
  }
});

// Post-save hook: always run monthly summary recalculation when daily is saved (including when OD approval updates status/payable).
// Ensures half-day OD + half-day punch -> PRESENT and half-day OD only -> HALF_DAY are reflected in monthly summary.
attendanceDailySchema.post('save', function () {
  const employeeNumber = (this.employeeNumber && String(this.employeeNumber).trim()) ? String(this.employeeNumber).toUpperCase() : this.employeeNumber;
  const date = this.date;
  const shifts = this.shifts;

  setImmediate(async () => {
    try {
      console.log('[OD-FLOW] AttendanceDaily post-save: triggering recalculateOnAttendanceUpdate', { employeeNumber, date });
      const { recalculateOnAttendanceUpdate } = require('../services/summaryCalculationService');
      const { detectExtraHours } = require('../services/extraHoursService');

      // Always update monthly summary so present days and payable shifts reflect latest daily (e.g. after OD approval)
      await recalculateOnAttendanceUpdate(employeeNumber, date);

      if (shifts && shifts.length > 0) {
        await detectExtraHours(employeeNumber, date);
      }
    } catch (error) {
      console.error('[AttendanceDaily] Background summary recalc failed:', error);
    }
  });
});

/**
 * Handle findOneAndUpdate to trigger summary recalculation (runs in background).
 * findOneAndUpdate bypasses 'save' hooks, so we need this hook when updates go through updateOne/findOneAndUpdate.
 */
attendanceDailySchema.post('findOneAndUpdate', async function (result) {
  try {
    const query = this.getQuery ? this.getQuery() : {};
    const update = this.getUpdate ? this.getUpdate() : {};
    const isShiftsUpdate = update.$set?.shifts || update.shifts;
    const isStatusUpdate = update.$set?.status || update.status;
    const isManualOverride = update.$set?.isEdited || update.isEdited;
    if (!isShiftsUpdate && !isStatusUpdate && !isManualOverride) return;

    const employeeNumber = (result && result.employeeNumber) || query.employeeNumber;
    const date = (result && result.date) || query.date;
    if (!employeeNumber || !date) return;

    setImmediate(async () => {
      try {
        const { recalculateOnAttendanceUpdate } = require('../services/summaryCalculationService');
        const { detectExtraHours } = require('../services/extraHoursService');
        await recalculateOnAttendanceUpdate(employeeNumber, date);
        if (isShiftsUpdate) {
          await detectExtraHours(employeeNumber, date);
        }
      } catch (err) {
        console.error('[AttendanceDaily findOneAndUpdate hook] Background summary recalc failed:', err);
      }
    });
  } catch (error) {
    console.error('Error in post-findOneAndUpdate hook:', error);
  }
});

module.exports = mongoose.models.AttendanceDaily || mongoose.model('AttendanceDaily', attendanceDailySchema);

