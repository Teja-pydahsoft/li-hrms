/**
 * Leave Policy Settings Model
 * Configures earned leave rules, carry forward policies, and financial year settings
 */

const mongoose = require('mongoose');

const leavePolicySettingsSchema = new mongoose.Schema({
    // Financial Year Configuration
    financialYear: {
        startMonth: {
            type: Number,
            default: 4, // April (1-12)
            min: 1,
            max: 12,
            description: 'Financial year start month (1=Jan, 4=Apr, etc.)'
        },
        startDay: {
            type: Number,
            default: 1,
            min: 1,
            max: 31,
            description: 'Financial year start day'
        },
        useCalendarYear: {
            type: Boolean,
            default: false,
            description: 'Use calendar year (Jan-Dec) instead of custom financial year'
        }
    },

    /**
     * Per–leave-type monthly (payroll-period) apply limits: maxDaysByType. Legacy enabled/maxDays are ignored.
     * includeEL: include EL in scheduled pool totals on the register when EL is not paid in payroll.
     */
    monthlyLeaveApplicationCap: {
        enabled: {
            type: Boolean,
            default: false,
            description: '[Legacy] Combined cap — ignored; use maxDaysByType only'
        },
        maxDays: {
            type: Number,
            default: 0,
            min: 0,
            max: 62,
            description: '[Legacy] Combined max — ignored'
        },
        maxDaysByType: {
            CL: { type: Number, default: 0, min: 0, max: 62 },
            CCL: { type: Number, default: 0, min: 0, max: 62 },
            EL: { type: Number, default: 0, min: 0, max: 62 },
        },
        includeEL: {
            type: Boolean,
            default: false,
            description: 'Include EL in register scheduled-pool total when useAsPaidInPayroll is false'
        },
        /**
         * When not false: CL applications in a payroll period are capped by that period’s scheduled
         * clCredits on LeaveRegisterYear, but only after the period has started (IST). No future-period
         * credits are implied.
         */
        clCapFromLeaveRegisterYear: {
            type: Boolean,
            default: true,
            description: 'Cap CL per payroll period by register slot clCredits after period start (IST)'
        }
    },
    /**
     * Granular controls for manual Leave Register month-slot edits.
     * If a flag is false, the corresponding field cannot be patched via month-slot edit API.
     */
    leaveRegisterMonthSlotEdit: {
        /**
         * Default edit controls applied to all payroll month slots unless overridden below.
         */
        defaults: {
            /** Master switch: when false, no month-slot edits (including sync-apply) for that payroll month index. */
            allowEditMonth: { type: Boolean, default: true },
            allowEditClCredits: { type: Boolean, default: true },
            allowEditCclCredits: { type: Boolean, default: true },
            allowEditElCredits: { type: Boolean, default: true },
            allowEditPolicyLock: { type: Boolean, default: true },
            allowEditUsedCl: { type: Boolean, default: true },
            allowEditUsedCcl: { type: Boolean, default: true },
            allowEditUsedEl: { type: Boolean, default: true },
            allowCarryUnusedToNextMonth: { type: Boolean, default: true }
        },
        /**
         * Optional per-payroll-month override map (keys "1".."12").
         * Each value can contain a partial subset of defaults.
         */
        byPayrollMonthIndex: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },

    // Earned Leave (EL) Configuration
    earnedLeave: {
        enabled: {
            type: Boolean,
            default: true,
            description: 'Enable earned leave (EL) earning; when false, no EL is accrued'
        },
        // Earning Rules
        earningType: {
            type: String,
            enum: ['attendance_based', 'fixed'],
            default: 'attendance_based',
            description: 'How EL is earned - based on attendance, fixed amount'
        },
        // Whether EL days availed count as paid days in payroll (salary for EL days)
        useAsPaidInPayroll: {
            type: Boolean,
            default: true,
            description: 'When true, EL days availed count as paid days in payroll; when false, EL is leave-only (no salary for those days)'
        },

        // Attendance-Based Earning
        attendanceRules: {
            minDaysForFirstEL: {
                type: Number,
                default: 20,
                min: 1,
                max: 31,
                description: 'Minimum days attendance required to earn first EL'
            },
            daysPerEL: {
                type: Number,
                default: 20,
                min: 1,
                max: 31,
                description: 'Number of attendance days required for 1 EL'
            },
            maxELPerMonth: {
                type: Number,
                default: 2,
                min: 0,
                max: 10,
                description: 'Maximum EL that can be earned in a month'
            },
            maxELPerYear: {
                type: Number,
                default: 12,
                min: 0,
                max: 365,
                description: 'Maximum EL that can be earned in a financial year'
            },
            considerPresentDays: {
                type: Boolean,
                default: true,
                description: 'Count present days in attendance calculation'
            },
            considerHolidays: {
                type: Boolean,
                default: true,
                description: 'Count holidays/weekly offs as present for EL calculation'
            },
            // Attendance Ranges (Cumulative Logic) – same path the frontend uses
            attendanceRanges: [{
                minDays: { type: Number, required: true },
                maxDays: { type: Number, required: true },
                elEarned: { type: Number, required: true },
                description: { type: String, default: '' }
            }]
        },

        // Fixed Earning
        fixedRules: {
            elPerMonth: {
                type: Number,
                default: 1,
                min: 0,
                max: 10,
                description: 'Fixed EL earned per month'
            },
            maxELPerYear: {
                type: Number,
                default: 12,
                min: 0,
                max: 365,
                description: 'Maximum EL per year (for fixed earning)'
            }
        }
    },

    // Carry Forward Policies
    carryForward: {
        casualLeave: {
            enabled: {
                type: Boolean,
                default: true,
                description: 'Enable carry forward for Casual Leave'
            },
            maxMonths: {
                type: Number,
                default: 12,
                min: 0,
                max: 24,
                description: 'Maximum months CL can be carried forward (0=no limit)'
            },
            expiryMonths: {
                type: Number,
                default: 12,
                min: 0,
                max: 60,
                description: 'CL expires after these many months (0=no expiry)'
            },
            carryForwardToNextYear: {
                type: Boolean,
                default: true,
                description: 'Carry forward unused CL to next financial year'
            },
            /**
             * When true (default), unused CL shown as this payroll month’s scheduled credit (clCredits) stays in the balance (rolls with the pool).
             * When false, at each payroll cycle end we forfeit max(0, scheduled − CL used in that month) via an EXPIRY ledger row.
             */
            carryMonthlyClCreditToNextPayrollMonth: {
                type: Boolean,
                default: true,
                description: 'Roll unused monthly scheduled CL into next periods vs forfeit at cycle end'
            }
        },
        earnedLeave: {
            enabled: {
                type: Boolean,
                default: true,
                description: 'Enable carry forward for Earned Leave'
            },
            maxMonths: {
                type: Number,
                default: 24,
                min: 0,
                max: 60,
                description: 'Maximum months EL can be carried forward'
            },
            expiryMonths: {
                type: Number,
                default: 60,
                min: 0,
                max: 120,
                description: 'EL expires after these many months (0=no expiry)'
            },
            carryForwardToNextYear: {
                type: Boolean,
                default: true,
                description: 'Carry forward unused EL to next financial year'
            },
            /**
             * When monthly cap includes EL (leave-only EL), unused scheduled EL in the apply pool for the month
             * rolls into next month’s elCredits slot; when false, EXPIRY at cycle end. Ignored when EL is not in pool.
             */
            carryMonthlyPoolToNextPayrollMonth: {
                type: Boolean,
                default: true,
                description: 'Roll unused monthly apply-pool EL to next payroll month vs expire at cycle end'
            }
        },
        compensatoryOff: {
            enabled: {
                type: Boolean,
                default: true,
                description: 'Enable carry forward for Compensatory Off'
            },
            maxMonths: {
                type: Number,
                default: 6,
                min: 0,
                max: 24,
                description: 'Maximum months CO can be carried forward'
            },
            expiryMonths: {
                type: Number,
                default: 6,
                min: 0,
                max: 24,
                description: 'CO expires after these many months (0=no expiry)'
            },
            carryForwardToNextYear: {
                type: Boolean,
                default: false,
                description: 'Carry forward unused CO to next financial year'
            },
            /**
             * When true, unused scheduled CCL in a payroll month’s apply pool (after CL→CCL→EL consumption)
             * rolls into the next month’s compensatoryOffs slot; when false, forfeit (EXPIRY) on cycle end.
             */
            carryMonthlyPoolToNextPayrollMonth: {
                type: Boolean,
                default: true,
                description: 'Roll unused monthly pool CCL to next payroll month vs expire at cycle end'
            }
        }
    },

    // Leave Encashment Rules
    encashment: {
        casualLeave: {
            enabled: {
                type: Boolean,
                default: false,
                description: 'Allow CL encashment'
            },
            minDaysForEncashment: {
                type: Number,
                default: 5,
                min: 1,
                description: 'Minimum CL days required for encashment'
            },
            maxEncashmentPerYear: {
                type: Number,
                default: 0,
                min: 0,
                description: 'Maximum CL days that can be encashed per year (0=no limit)'
            }
        },
        earnedLeave: {
            enabled: {
                type: Boolean,
                default: true,
                description: 'Allow EL encashment'
            },
            minDaysForEncashment: {
                type: Number,
                default: 10,
                min: 1,
                description: 'Minimum EL days required for encashment'
            },
            maxEncashmentPerYear: {
                type: Number,
                default: 15,
                min: 0,
                description: 'Maximum EL days that can be encashed per year (0=no limit)'
            }
        }
    },

    // Compliance Settings (Indian Labor Laws)
    compliance: {
        applicableAct: {
            type: String,
            enum: ['shops_act', 'factories_act', 'it_act', 'custom'],
            default: 'shops_act',
            description: 'Applicable labor law for EL calculations'
        },
        considerWeeklyOffs: {
            type: Boolean,
            default: true,
            description: 'Count weekly offs as working days for EL calculation'
        },
        considerPaidHolidays: {
            type: Boolean,
            default: true,
            description: 'Count paid holidays as working days for EL calculation'
        },
        probationPeriod: {
            months: {
                type: Number,
                default: 6,
                min: 0,
                max: 24,
                description: 'Probation period in months'
            },
            elApplicableAfter: {
                type: Boolean,
                default: true,
                description: 'EL applicable only after probation completion'
            }
        }
    },

    // Auto-Update Settings
    autoUpdate: {
        enabled: {
            type: Boolean,
            default: true,
            description: 'Enable automatic EL updates based on attendance'
        },
        updateFrequency: {
            type: String,
            enum: ['daily', 'weekly', 'monthly'],
            default: 'monthly',
            description: 'When to update EL balances'
        },
        updateDay: {
            type: Number,
            default: 1,
            min: 1,
            max: 31,
            description: 'Day of month to run updates (for monthly frequency)'
        }
    },

    // Annual CL Reset Settings
    annualCLReset: {
        enabled: {
            type: Boolean,
            default: true,
            description: 'Enable annual CL balance reset at financial year start'
        },
        // Default CL entitlement for all (used when experience-based tiers are not used or no tier matches)
        resetToBalance: {
            type: Number,
            default: 12,
            min: 0,
            max: 365,
            description: 'Default CL entitlement at reset (used for all if experience tiers empty or no match)'
        },
        // Experience-based CL: optional tiers by years of service (from DOJ to reset date). First matching tier wins.
        casualLeaveByExperience: [{
            minYears: { type: Number, required: true, min: 0 },
            maxYears: { type: Number, required: true, min: 0 },
            /** Annual display / fallback when monthlyClCredits not set; should match sum of 12 cells when grid is used. */
            casualLeave: { type: Number, required: true, min: 0 },
            /** Twelve payroll months (leave year order): CL credited for each period at annual reset. */
            monthlyClCredits: {
                type: [Number],
                default: undefined,
                validate: {
                    validator(v) {
                        if (v == null || v === undefined) return true;
                        return Array.isArray(v) && v.length === 12 && v.every((n) => typeof n === 'number' && n >= 0 && !Number.isNaN(n));
                    },
                    message: 'monthlyClCredits must be an array of 12 non-negative numbers'
                }
            },
            description: { type: String, default: '' }
        }],
        addCarryForward: {
            type: Boolean,
            default: true,
            description: 'Add unused CL carry forward to reset balance'
        },
        /** Max CL days that can be carried into the new leave year (capped by unused balance). Applied to first payroll month in LeaveRegisterYear. If unset, defaults to 12 in code. */
        maxCarryForwardCl: {
            type: Number,
            default: 12,
            min: 0,
            max: 365,
            description: 'Maximum CL days carried at annual reset; unused balance above this expires'
        },
        // When true: reset date = start of first payroll period of the year (e.g. 26 Dec when payroll is 26th–25th). Uses payroll cycle start day.
        usePayrollCycleForReset: {
            type: Boolean,
            default: false,
            description: 'Use payroll cycle start day for reset; reset = Dec (prev year) + payroll start day (e.g. 26 Dec for 26–25 cycle)'
        },
        resetMonth: {
            type: Number,
            default: 4, // April
            min: 1,
            max: 12,
            description: 'Month when CL reset occurs (1=Jan, 4=Apr); ignored if usePayrollCycleForReset is true'
        },
        resetDay: {
            type: Number,
            default: 1,
            min: 1,
            max: 31,
            description: 'Day when CL reset occurs; ignored if usePayrollCycleForReset is true'
        }
    }
}, {
    timestamps: true,
    collection: 'leave_policy_settings'
});

// Static methods
leavePolicySettingsSchema.statics.getSettings = async function() {
    let settings = await this.findOne({});
    if (!settings) {
        // Create default settings if none exist
        settings = await this.create({});
    }
    return settings;
};

leavePolicySettingsSchema.statics.updateSettings = async function(updateData) {
    return this.findOneAndUpdate(
        {},
        {
            $set: updateData,
            $unset: {
                monthlyLimitSettings: '',
                'earnedLeave.includeInMonthlyLimit': '',
            },
        },
        { new: true, upsert: true }
    );
};

module.exports = mongoose.model('LeavePolicySettings', leavePolicySettingsSchema);
