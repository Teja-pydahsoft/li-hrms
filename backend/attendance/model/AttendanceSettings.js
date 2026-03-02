/**
 * Attendance Settings Model
 * Stores MSSQL configuration and sync settings
 */

const mongoose = require('mongoose');

const attendanceSettingsSchema = new mongoose.Schema(
  {
    // Data Source Selection
    dataSource: {
      type: String,
      enum: ['mssql', 'mongodb'],
      default: 'mongodb',
    },
    
    // MSSQL Configuration
    mssqlConfig: {
      databaseName: {
        type: String,
        trim: true,
        default: null,
      },
      tableName: {
        type: String,
        trim: true,
        default: null,
      },
      columnMapping: {
        employeeNumberColumn: {
          type: String,
          trim: true,
          default: null,
        },
        timestampColumn: {
          type: String,
          trim: true,
          default: null,
        },
        typeColumn: {
          type: String,
          trim: true,
          default: null, // Optional: column that indicates IN/OUT
        },
        hasTypeColumn: {
          type: Boolean,
          default: false, // Does table have separate IN/OUT type column?
        },
      },
    },
    
    // Sync Settings
    syncSettings: {
      autoSyncEnabled: {
        type: Boolean,
        default: false,
      },
      syncIntervalHours: {
        type: Number,
        default: 1, // Default: sync every 1 hour
        min: 0.5, // Minimum: 30 minutes
        max: 24, // Maximum: 24 hours
      },
      lastSyncAt: {
        type: Date,
        default: null,
      },
      lastSyncStatus: {
        type: String,
        enum: ['success', 'failed', 'pending'],
        default: null,
      },
      lastSyncMessage: {
        type: String,
        default: null,
      },
    },
    
    // Previous Day Linking (Settings enabled)
    previousDayLinking: {
      enabled: {
        type: Boolean,
        default: false,
      },
      requireConfirmation: {
        type: Boolean,
        default: true, // Require admin confirmation for linked records
      },
    },

    // Processing Mode (Dual-Mode: multi_shift vs single_shift)
    processingMode: {
      mode: {
        type: String,
        enum: ['multi_shift', 'single_shift'],
        default: 'multi_shift',
      },
      strictCheckInOutOnly: {
        type: Boolean,
        default: true, // Only CHECK-IN/CHECK-OUT used for pairing; others stored but ignored
      },
      continuousSplitThresholdHours: {
        type: Number,
        default: 14,
        min: 10,
        max: 24,
      },
      splitMinGapHours: {
        type: Number,
        default: 3,
        min: 0,
        max: 12,
      },
      maxShiftsPerDay: {
        type: Number,
        default: 3,
        min: 1,
        max: 3,
      },
      rosterStrictWhenPresent: {
        type: Boolean,
        default: true, // When roster exists, use ONLY roster; else hierarchy
      },
      // When strict is OFF: OUT window extends post shift end by this many hours (for OT)
      postShiftOutMarginHours: {
        type: Number,
        default: 4,
        min: 0,
        max: 8,
      },
    },

    // Feature flags: control visibility/enabling of editing and upload on attendance pages
    featureFlags: {
      allowInTimeEditing: { type: Boolean, default: true },
      allowOutTimeEditing: { type: Boolean, default: true },
      allowAttendanceUpload: { type: Boolean, default: true },
      allowShiftChange: { type: Boolean, default: true },
    },
  },
  {
    timestamps: true,
  }
);

// Only one settings document should exist
attendanceSettingsSchema.statics.getSettings = async function() {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

// Returns processingMode with defaults applied (handles existing docs without processingMode)
attendanceSettingsSchema.statics.getProcessingMode = function(doc) {
  const pm = doc?.processingMode || {};
  return {
    mode: pm.mode || 'multi_shift',
    // Multi-shift always uses strict (CHECK-IN/OUT only); strict toggle only applies when single_shift
    strictCheckInOutOnly: pm.mode === 'multi_shift' ? true : (pm.strictCheckInOutOnly !== false),
    continuousSplitThresholdHours: pm.continuousSplitThresholdHours ?? 14,
    splitMinGapHours: pm.splitMinGapHours ?? 3,
    maxShiftsPerDay: pm.maxShiftsPerDay ?? 3,
    rosterStrictWhenPresent: pm.rosterStrictWhenPresent !== false,
    postShiftOutMarginHours: pm.postShiftOutMarginHours ?? 4,
  };
};

module.exports = mongoose.models.AttendanceSettings || mongoose.model('AttendanceSettings', attendanceSettingsSchema);

