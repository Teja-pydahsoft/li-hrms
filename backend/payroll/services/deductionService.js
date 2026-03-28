const AttendanceDaily = require('../../attendance/model/AttendanceDaily');
const Permission = require('../../permissions/model/Permission');
const DepartmentSettings = require('../../departments/model/DepartmentSettings');
const PermissionDeductionSettings = require('../../permissions/model/PermissionDeductionSettings');
const AttendanceDeductionSettings = require('../../attendance/model/AttendanceDeductionSettings');
const AllowanceDeductionMaster = require('../../allowances-deductions/model/AllowanceDeductionMaster');
const cacheService = require('../../shared/services/cacheService');

/**
 * Deduction Calculation Service
 * Handles all types of deductions: attendance, permission, leave, and other deductions
 */

/**
 * Get resolved permission deduction rules
 * @param {String} departmentId - Department ID
 * @returns {Object} Resolved rules
 */
async function getResolvedPermissionDeductionRules(departmentId, divisionId = null) {
  try {
    const cacheKey = `settings:deduction:permission:dept:${departmentId}:div:${divisionId || 'none'}`;
    let resolved = await cacheService.get(cacheKey);
    console.log('resolved', resolved);
    if (resolved) return resolved;

    const deptSettings = await DepartmentSettings.getByDeptAndDiv(departmentId, divisionId);
    const globalSettings = await PermissionDeductionSettings.getActiveSettings();

    resolved = {
      freeAllowedPerMonth: deptSettings?.permissions?.deductionRules?.freeAllowedPerMonth ?? globalSettings?.deductionRules?.freeAllowedPerMonth ?? null,
      countThreshold: deptSettings?.permissions?.deductionRules?.countThreshold ?? globalSettings?.deductionRules?.countThreshold ?? null,
      deductionType: deptSettings?.permissions?.deductionRules?.deductionType ?? globalSettings?.deductionRules?.deductionType ?? null,
      deductionDays: deptSettings?.permissions?.deductionRules?.deductionDays ?? globalSettings?.deductionRules?.deductionDays ?? null,
      deductionAmount: deptSettings?.permissions?.deductionRules?.deductionAmount ?? globalSettings?.deductionRules?.deductionAmount ?? null,
      minimumDuration: deptSettings?.permissions?.deductionRules?.minimumDuration ?? globalSettings?.deductionRules?.minimumDuration ?? null,
      calculationMode: deptSettings?.permissions?.deductionRules?.calculationMode ?? globalSettings?.deductionRules?.calculationMode ?? null,
    };

    await cacheService.set(cacheKey, resolved, 300);
    console.log(' after cache resolved', resolved);
    return resolved;
  } catch (error) {
    console.error('Error getting resolved permission deduction rules:', error);
    return {
      freeAllowedPerMonth: null,
      countThreshold: null,
      deductionType: null,
      deductionDays: null,
      deductionAmount: null,
      minimumDuration: null,
      calculationMode: null,
    };
  }
}

/**
 * Get resolved attendance deduction rules
 * @param {String} departmentId - Department ID
 * @returns {Object} Resolved rules
 */
async function getResolvedAttendanceDeductionRules(departmentId, divisionId = null) {
  try {
    const cacheKey = `settings:deduction:attendance:dept:${departmentId}:div:${divisionId || 'none'}`;
    let resolved = await cacheService.get(cacheKey);
    console.log('resolved', resolved);
    if (resolved) return resolved;

    const deptSettings = await DepartmentSettings.getByDeptAndDiv(departmentId, divisionId);
    const globalSettings = await AttendanceDeductionSettings.getActiveSettings();

    resolved = {
      freeAllowedPerMonth: deptSettings?.attendance?.deductionRules?.freeAllowedPerMonth ?? globalSettings?.deductionRules?.freeAllowedPerMonth ?? null,
      combinedCountThreshold: deptSettings?.attendance?.deductionRules?.combinedCountThreshold ?? globalSettings?.deductionRules?.combinedCountThreshold ?? null,
      deductionType: deptSettings?.attendance?.deductionRules?.deductionType ?? globalSettings?.deductionRules?.deductionType ?? null,
      deductionDays: deptSettings?.attendance?.deductionRules?.deductionDays ?? globalSettings?.deductionRules?.deductionDays ?? null,
      deductionAmount: deptSettings?.attendance?.deductionRules?.deductionAmount ?? globalSettings?.deductionRules?.deductionAmount ?? null,
      minimumDuration: deptSettings?.attendance?.deductionRules?.minimumDuration ?? globalSettings?.deductionRules?.minimumDuration ?? null,
      calculationMode: deptSettings?.attendance?.deductionRules?.calculationMode ?? globalSettings?.deductionRules?.calculationMode ?? null,
    };

    await cacheService.set(cacheKey, resolved, 300);
    console.log(' after cache resolved', resolved);
    return resolved;
  } catch (error) {
    console.error('Error getting resolved attendance deduction rules:', error);
    return {
      freeAllowedPerMonth: null,
      combinedCountThreshold: null,
      deductionType: null,
      deductionDays: null,
      deductionAmount: null,
      minimumDuration: null,
      calculationMode: null,
    };
  }
}

/**
 * Calculate days to deduct based on deduction type
 * @param {Number} multiplier - Multiplier from calculation
 * @param {Number} remainder - Remainder from calculation
 * @param {Number} threshold - Count threshold
 * @param {String} deductionType - 'half_day', 'full_day', 'custom_days', or 'custom_amount'
 * @param {Number} deductionDays - Custom days per unit if type is 'custom_days'
 * @param {Number} customAmount - Custom amount if type is 'custom_amount'
 * @param {Number} perDayBasicPay - Per day basic pay for custom amount conversion
 * @param {String} calculationMode - 'proportional' or 'floor'
 * @returns {Number} Days to deduct
 */
function calculateDaysToDeduct(multiplier, remainder, threshold, deductionType, deductionDays, customAmount, perDayBasicPay, calculationMode) {
  let days = 0;

  if (deductionType === 'half_day') {
    days = multiplier * 0.5;
    if (calculationMode === 'proportional' && remainder > 0 && threshold > 0) {
      days += (remainder / threshold) * 0.5;
    }
  } else if (deductionType === 'full_day') {
    days = multiplier * 1;
    if (calculationMode === 'proportional' && remainder > 0 && threshold > 0) {
      days += (remainder / threshold) * 1;
    }
  } else if (deductionType === 'custom_days' && deductionDays != null && deductionDays > 0) {
    days = multiplier * deductionDays;
    if (calculationMode === 'proportional' && remainder > 0 && threshold > 0) {
      days += (remainder / threshold) * deductionDays;
    }
  } else if (deductionType === 'custom_amount' && customAmount && perDayBasicPay > 0) {
    const amountPerThreshold = customAmount;
    days = (multiplier * amountPerThreshold) / perDayBasicPay;
    if (calculationMode === 'proportional' && remainder > 0 && threshold > 0) {
      days += ((remainder / threshold) * amountPerThreshold) / perDayBasicPay;
    }
  }

  return Math.round(days * 100) / 100; // Round to 2 decimals
}

/**
 * Calculate attendance deduction (late-ins + early-outs + absent extra).
 * Respects employee flags: applyAttendanceDeduction (master), deductLateIn, deductEarlyOut, deductAbsent (default true = apply).
 * @param {String} employeeId - Employee ID
 * @param {String} month - Month in YYYY-MM format
 * @param {String} departmentId - Department ID
 * @param {Number} perDayBasicPay - Per day basic pay
 * @param {String|null} divisionId - Division ID for rules
 * @param {Object} [options] - Optional: { absentDays, enableAbsentDeduction, lopDaysPerAbsent, employee }. employee: { applyAttendanceDeduction, deductLateIn, deductEarlyOut, deductAbsent }.
 * @returns {Object} Attendance deduction result
 */
async function calculateAttendanceDeduction(employeeId, month, departmentId, perDayBasicPay, divisionId = null, options = {}) {
  try {
    const employee = options && options.employee != null ? options.employee : null;
    const applyAttendanceDeduction = employee == null || (employee && employee.applyAttendanceDeduction !== false);
    if (!applyAttendanceDeduction) {
      return {
        attendanceDeduction: 0,
        breakdown: {
          lateInsCount: 0,
          earlyOutsCount: 0,
          combinedCount: 0,
          freeAllowedPerMonth: 0,
          effectiveCount: 0,
          daysDeducted: 0,
          lateEarlyDaysDeducted: 0,
          absentExtraDays: 0,
          absentDays: 0,
          lopDaysPerAbsent: null,
          deductionType: null,
          calculationMode: null,
        },
      };
    }

    // 1. Fetch counts FIRST (so we can return them even if no deduction rules apply)
    const PayRegisterSummary = require('../../pay-register/model/PayRegisterSummary');
    // Using lean() to bypass strict mode filtering if fields are missing from schema but present in DB
    let payRegister = await PayRegisterSummary.findOne({ employeeId, month }).lean();
    let lateInsCount = 0;
    let earlyOutsCount = 0;
    let source = 'attendance_logs';

    // Priority 1: Always try to calculate from AttendanceDaily logs first (Real-time truth)
    const [y, mNum] = month.split('-').map(Number);
    const startStr = `${y}-${String(mNum).padStart(2, '0')}-01`;
    const lastD = new Date(y, mNum, 0).getDate();
    const endStr = `${y}-${String(mNum).padStart(2, '0')}-${String(lastD).padStart(2, '0')}`;

    const Employee = require('../../employees/model/Employee');
    const empDoc = await Employee.findById(employeeId).select('emp_no').lean();
    let logsFound = false;

    if (empDoc?.emp_no) {
      const empNo = String(empDoc.emp_no).toUpperCase();
      const attendanceRecords = await AttendanceDaily.find({
        employeeNumber: empNo,
        date: { $gte: startStr, $lte: endStr },
      })
        .select('status shifts totalLateInMinutes totalEarlyOutMinutes lateInWaved earlyOutWaved')
        .lean();

      if (attendanceRecords.length > 0) {
        logsFound = true;
        const rulesTemp = await getResolvedAttendanceDeductionRules(departmentId, divisionId);
        const minimumDuration = rulesTemp.minimumDuration || 0;

        for (const record of attendanceRecords) {
          if (record.status !== 'PRESENT') continue;

          const shifts = Array.isArray(record.shifts) ? record.shifts : [];
          let dayLate = 0;
          let dayEarly = 0;
          if (shifts.length > 0) {
            for (const s of shifts) {
              dayLate += Number(s.lateInMinutes) || 0;
              dayEarly += Number(s.earlyOutMinutes) || 0;
            }
          } else {
            dayLate = Number(record.totalLateInMinutes) || 0;
            dayEarly = Number(record.totalEarlyOutMinutes) || 0;
          }
          if (dayLate > 0 && dayLate >= minimumDuration && !record.lateInWaved) lateInsCount++;
          if (dayEarly > 0 && dayEarly >= minimumDuration && !record.earlyOutWaved) earlyOutsCount++;
        }
      }
    }

    // Priority 2: Fallback to Pay Register Summary only if no logs available OR if summary specifically exists and we aren't forcing logs
    if (!logsFound && payRegister && payRegister.totals && !options.forceRecalculate) {
      lateInsCount = payRegister.totals.lateCount || 0;
      earlyOutsCount = payRegister.totals.earlyOutCount || 0;
      source = 'pay_register_summary';
    }

    const deductLateIn = employee == null || employee.deductLateIn !== false;
    const deductEarlyOut = employee == null || employee.deductEarlyOut !== false;
    const deductAbsent = employee == null || employee.deductAbsent !== false;
    if (!deductLateIn) lateInsCount = 0;
    if (!deductEarlyOut) earlyOutsCount = 0;

    console.log(`[Deduction] Employee ${employeeId} - Lates: ${lateInsCount}, Early: ${earlyOutsCount} (Source: ${source})`);

    // 2. Fetch Rules and Calculate Deduction
    const rules = await getResolvedAttendanceDeductionRules(departmentId, divisionId);

    // If no rules configured, still apply absent extra if enabled (and employee.deductAbsent)
    if (!rules.combinedCountThreshold || !rules.deductionType || !rules.calculationMode) {
      const absentDaysNoRules = Number(options.absentDays) || 0;
      const enableAbsentNoRules = deductAbsent && options.enableAbsentDeduction === true;
      const lopPerAbsentNoRules = Math.max(0, Number(options.lopDaysPerAbsent) || 1);
      let absentExtraNoRules = 0;
      if (enableAbsentNoRules && absentDaysNoRules > 0 && lopPerAbsentNoRules > 1) {
        absentExtraNoRules = absentDaysNoRules * (lopPerAbsentNoRules - 1);
      }
      const totalDeductedNoRules = absentExtraNoRules;
      const amountNoRules = totalDeductedNoRules * perDayBasicPay;
      console.log('[Deduction] No valid late/early rules. Absent extra days:', absentExtraNoRules);
      const combined = lateInsCount + earlyOutsCount;
      const freeAllowed = rules.freeAllowedPerMonth != null ? Number(rules.freeAllowedPerMonth) : 0;
      return {
        attendanceDeduction: Math.round(amountNoRules * 100) / 100,
        breakdown: {
          lateInsCount,
          earlyOutsCount,
          combinedCount: combined,
          freeAllowedPerMonth: freeAllowed,
          effectiveCount: Math.max(0, combined - freeAllowed),
          daysDeducted: totalDeductedNoRules,
          lateEarlyDaysDeducted: 0,
          absentExtraDays: absentExtraNoRules,
          absentDays: absentDaysNoRules,
          lopDaysPerAbsent: enableAbsentNoRules ? lopPerAbsentNoRules : null,
          deductionType: null,
          calculationMode: null,
        },
      };
    }

    const combinedCount = lateInsCount + earlyOutsCount;
    const freeAllowed = rules.freeAllowedPerMonth != null ? Number(rules.freeAllowedPerMonth) : 0;
    const effectiveCount = Math.max(0, combinedCount - freeAllowed);
    let daysDeducted = 0;

    if (effectiveCount >= rules.combinedCountThreshold) {
      const multiplier = Math.floor(effectiveCount / rules.combinedCountThreshold);
      const remainder = effectiveCount % rules.combinedCountThreshold;

      daysDeducted = calculateDaysToDeduct(
        multiplier,
        remainder,
        rules.combinedCountThreshold,
        rules.deductionType,
        rules.deductionDays,
        rules.deductionAmount,
        perDayBasicPay,
        rules.calculationMode
      );
      console.log(`[Deduction] Calculated deduction: ${daysDeducted} days (combined: ${combinedCount}, free: ${freeAllowed}, effective: ${effectiveCount}).`);
    } else {
      console.log(`[Deduction] Effective count ${effectiveCount} is below threshold ${rules.combinedCountThreshold}`);
    }

    // Absent extra: when enable_absent_deduction && employee.deductAbsent, deduct (absentDays * (lopDaysPerAbsent - 1)) days.
    let absentExtraDays = 0;
    const absentDays = Number(options.absentDays) || 0;
    const enableAbsentDeduction = deductAbsent && options.enableAbsentDeduction === true;
    const lopDaysPerAbsent = Math.max(0, Number(options.lopDaysPerAbsent) || 1);
    if (enableAbsentDeduction && absentDays > 0 && lopDaysPerAbsent > 1) {
      absentExtraDays = absentDays * (lopDaysPerAbsent - 1);
      console.log(`[Deduction] Absent extra: ${absentDays} absent × (${lopDaysPerAbsent} - 1) = ${absentExtraDays} days`);
    }

    const totalDaysDeducted = daysDeducted + absentExtraDays;
    const attendanceDeduction = totalDaysDeducted * perDayBasicPay;

    return {
      attendanceDeduction: Math.round(attendanceDeduction * 100) / 100,
      breakdown: {
        lateInsCount,
        earlyOutsCount,
        combinedCount,
        freeAllowedPerMonth: freeAllowed,
        effectiveCount,
        daysDeducted: totalDaysDeducted,
        lateEarlyDaysDeducted: daysDeducted,
        absentExtraDays,
        absentDays,
        lopDaysPerAbsent: enableAbsentDeduction ? lopDaysPerAbsent : null,
        deductionType: rules.deductionType,
        calculationMode: rules.calculationMode,
      },
    };
  } catch (error) {
    console.error('Error calculating attendance deduction:', error);
    return {
      attendanceDeduction: 0,
      breakdown: {
        lateInsCount: 0,
        earlyOutsCount: 0,
        combinedCount: 0,
        freeAllowedPerMonth: 0,
        effectiveCount: 0,
        daysDeducted: 0,
        lateEarlyDaysDeducted: 0,
        absentExtraDays: 0,
        absentDays: 0,
        lopDaysPerAbsent: null,
        deductionType: null,
        calculationMode: null,
      },
    };
  }
}

/**
 * Calculate permission deduction.
 * Respects employee.deductPermission (default true = apply). When false, returns 0.
 * @param {String} employeeId - Employee ID
 * @param {String} month - Month in YYYY-MM format
 * @param {String} departmentId - Department ID
 * @param {Number} perDayBasicPay - Per day basic pay
 * @param {String|null} divisionId - Division ID
 * @param {Object} [options] - Optional: { employee }. If employee.deductPermission === false, return 0.
 * @returns {Object} Permission deduction result
 */
async function calculatePermissionDeduction(employeeId, month, departmentId, perDayBasicPay, divisionId = null, options = {}) {
  try {
    const employee = options && options.employee != null ? options.employee : null;
    const deductPermission = employee == null || (employee && employee.deductPermission !== false);
    if (!deductPermission) {
      return {
        permissionDeduction: 0,
        breakdown: {
          permissionCount: 0,
          eligiblePermissionCount: 0,
          daysDeducted: 0,
          deductionType: null,
          calculationMode: null,
        },
      };
    }

    const rules = await getResolvedPermissionDeductionRules(departmentId, divisionId);

    // If no rules configured, return zero
    if (!rules.countThreshold || !rules.deductionType || !rules.calculationMode) {
      return {
        permissionDeduction: 0,
        breakdown: {
          permissionCount: 0,
          eligiblePermissionCount: 0,
          daysDeducted: 0,
          deductionType: null,
          calculationMode: null,
        },
      };
    }

    // Fetch permissions for the month
    // Parse month string (YYYY-MM) to get start and end dates
    const [year, monthNum] = month.split('-').map(Number);
    const startDate = new Date(year, monthNum - 1, 1);
    const endDate = new Date(year, monthNum, 0, 23, 59, 59, 999);

    const permissions = await Permission.find({
      employeeId,
      date: {
        $gte: startDate,
        $lte: endDate,
      },
      status: 'approved',
    }).select('duration');

    const minimumDuration = rules.minimumDuration || 0;

    // Filter permissions by minimum duration
    const eligiblePermissions = permissions.filter(
      (perm) => perm.duration !== null && perm.duration !== undefined && perm.duration >= minimumDuration
    );

    const eligiblePermissionCount = eligiblePermissions.length;
    const totalPermissionCount = permissions.length;
    const freeAllowed = rules.freeAllowedPerMonth != null ? Number(rules.freeAllowedPerMonth) : 0;
    const effectiveCount = Math.max(0, eligiblePermissionCount - freeAllowed);

    let daysDeducted = 0;

    if (effectiveCount >= rules.countThreshold) {
      const multiplier = Math.floor(effectiveCount / rules.countThreshold);
      const remainder = effectiveCount % rules.countThreshold;

      daysDeducted = calculateDaysToDeduct(
        multiplier,
        remainder,
        rules.countThreshold,
        rules.deductionType,
        rules.deductionDays,
        rules.deductionAmount,
        perDayBasicPay,
        rules.calculationMode
      );
    }

    const permissionDeduction = daysDeducted * perDayBasicPay;

    return {
      permissionDeduction: Math.round(permissionDeduction * 100) / 100,
      breakdown: {
        permissionCount: totalPermissionCount,
        eligiblePermissionCount,
        freeAllowedPerMonth: freeAllowed,
        effectiveCount,
        daysDeducted,
        deductionType: rules.deductionType,
        calculationMode: rules.calculationMode,
      },
    };
  } catch (error) {
    console.error('Error calculating permission deduction:', error);
    return {
      permissionDeduction: 0,
      breakdown: {
        permissionCount: 0,
        eligiblePermissionCount: 0,
        freeAllowedPerMonth: 0,
        effectiveCount: 0,
        daysDeducted: 0,
        deductionType: null,
        calculationMode: null,
      },
    };
  }
}

/**
 * Calculate leave deduction (legacy: quota-based unpaid = totalLeaves - paidLeaves quota)
 * @deprecated Prefer calculateLeaveDeductionFromUnpaidDays when pay register marks paid vs LOP by nature.
 */
function calculateLeaveDeduction(totalLeaves, paidLeaves, totalDaysInMonth, basicPay) {
  const unpaidLeaves = Math.max(0, totalLeaves - (paidLeaves || 0));
  const daysDeducted = unpaidLeaves;
  const leaveDeduction = totalDaysInMonth > 0 ? (daysDeducted / totalDaysInMonth) * basicPay : 0;

  return {
    leaveDeduction: Math.round(leaveDeduction * 100) / 100,
    breakdown: {
      totalLeaves: totalLeaves || 0,
      paidLeaves: paidLeaves || 0,
      unpaidLeaves,
      daysDeducted,
    },
  };
}

/**
 * Calculate leave deduction from unpaid days only (LOP + absent).
 * Paid leave days (CL, EL, CCL by nature) are already counted as paid in totalPayableShifts;
 * only LOP and absent days are deducted from salary.
 * @param {Number} lopDays - LOP (loss of pay) leave days from attendance summary
 * @param {Number} absentDays - Absent days from attendance summary
 * @param {Number} totalDaysInMonth - Total days in month
 * @param {Number} basicPay - Basic pay
 * @returns {Object} Leave deduction result
 */
function calculateLeaveDeductionFromUnpaidDays(lopDays, absentDays, totalDaysInMonth, basicPay) {
  const daysDeducted = (Number(lopDays) || 0) + (Number(absentDays) || 0);
  const leaveDeduction = totalDaysInMonth > 0 ? (daysDeducted / totalDaysInMonth) * basicPay : 0;

  return {
    leaveDeduction: Math.round(leaveDeduction * 100) / 100,
    breakdown: {
      lopDays: Number(lopDays) || 0,
      absentDays: Number(absentDays) || 0,
      daysDeducted,
      totalLeaves: daysDeducted,
      paidLeaves: 0,
      unpaidLeaves: daysDeducted,
    },
  };
}

/**
 * Get all active deductions for a department
 * @param {String} departmentId - Department ID
 * @returns {Array} Array of deduction master objects with resolved rules
 */
async function getAllActiveDeductions(departmentId, divisionId = null) {
  try {
    const cacheKey = `settings:deduction:masters:all`;
    let deductionMasters = await cacheService.get(cacheKey);

    if (!deductionMasters) {
      deductionMasters = await AllowanceDeductionMaster.find({
        category: 'deduction',
        isActive: true,
      }).lean();
      await cacheService.set(cacheKey, deductionMasters, 600); // Master data can be cached longer
    }

    const deductions = [];

    for (const master of deductionMasters) {
      const rule = getResolvedDeductionRule(master, departmentId, divisionId);

      if (!rule) {
        continue;
      }

      deductions.push({
        masterId: master._id,
        name: master.name,
        rule: {
          type: rule.type,
          amount: rule.amount,
          percentage: rule.percentage,
          percentageBase: rule.percentageBase,
          minAmount: rule.minAmount,
          maxAmount: rule.maxAmount,
        },
      });
    }

    return deductions;
  } catch (error) {
    console.error('Error getting all active deductions:', error);
    return [];
  }
}

/**
 * Calculate other deductions (from AllowanceDeductionMaster)
 * NEW APPROACH: Get all deductions, separate by type, apply fixed first, then percentage
 * @param {String} departmentId - Department ID
 * @param {Number} basicPay - Basic pay
 * @param {Number} grossSalary - Gross salary (for percentage base = 'gross')
 * @returns {Array} Array of deduction objects
 */
async function calculateOtherDeductions(departmentId, basicPay, grossSalary = null, attendanceData = null, divisionId = null) {
  try {
    // Get all active deductions
    const allDeductions = await getAllActiveDeductions(departmentId, divisionId);

    if (allDeductions.length === 0) {
      return [];
    }

    // Separate deductions by type
    const fixedDeductions = [];
    const percentageBasicDeductions = [];
    const percentageGrossDeductions = [];

    for (const deduction of allDeductions) {
      const { rule } = deduction;

      if (rule.type === 'fixed') {
        // Fixed deductions don't need a base - apply them directly
        const amount = calculateDeductionAmount(rule, basicPay, grossSalary, attendanceData);
        if (amount >= 0) {
          fixedDeductions.push({
            masterId: deduction.masterId,
            name: deduction.name,
            amount,
            type: 'fixed',
            base: null,
            percentage: rule.percentage,
            percentageBase: rule.percentageBase,
            minAmount: rule.minAmount,
            maxAmount: rule.maxAmount,
            basedOnPresentDays: rule.basedOnPresentDays || false,
          });
        }
      } else if (rule.type === 'percentage') {
        // Percentage deductions need to be separated by base
        if (rule.percentageBase === 'basic') {
          percentageBasicDeductions.push(deduction);
        } else if (rule.percentageBase === 'gross') {
          percentageGrossDeductions.push(deduction);
        }
      }
    }

    // Calculate fixed deductions (no base needed)
    const fixedResults = fixedDeductions;

    // Calculate percentage deductions based on 'basic'
    const percentageBasicResults = [];
    for (const deduction of percentageBasicDeductions) {
      const amount = calculateDeductionAmount(deduction.rule, basicPay, null, attendanceData);
      if (amount >= 0) {
        percentageBasicResults.push({
          masterId: deduction.masterId,
          name: deduction.name,
          amount,
          type: 'percentage',
          base: 'basic',
          percentage: deduction.rule.percentage,
          percentageBase: deduction.rule.percentageBase,
          minAmount: deduction.rule.minAmount,
          maxAmount: deduction.rule.maxAmount,
          basedOnPresentDays: deduction.rule.basedOnPresentDays || false,
        });
      }
    }

    // Calculate percentage deductions based on 'gross' (only if grossSalary is provided)
    const percentageGrossResults = [];
    if (grossSalary !== null && grossSalary !== undefined) {
      for (const deduction of percentageGrossDeductions) {
        const amount = calculateDeductionAmount(deduction.rule, basicPay, grossSalary, attendanceData);
        if (amount >= 0) {
          percentageGrossResults.push({
            masterId: deduction.masterId,
            name: deduction.name,
            amount,
            type: 'percentage',
            base: 'gross',
            percentage: deduction.rule.percentage,
            percentageBase: deduction.rule.percentageBase,
            minAmount: deduction.rule.minAmount,
            maxAmount: deduction.rule.maxAmount,
            basedOnPresentDays: deduction.rule.basedOnPresentDays || false,
          });
        }
      }
    }

    // Combine all deductions: fixed first, then percentage basic, then percentage gross
    const allResults = [...fixedResults, ...percentageBasicResults, ...percentageGrossResults];

    return allResults;
  } catch (error) {
    console.error('Error calculating other deductions:', error);
    return [];
  }
}

/**
 * Get resolved deduction rule for a department (with optional division support)
 * @param {Object} deductionMaster - AllowanceDeductionMaster document
 * @param {String} departmentId - Department ID
 * @param {String} divisionId - Optional Division ID
 * @returns {Object} Resolved rule
 */
function getResolvedDeductionRule(deductionMaster, departmentId, divisionId = null) {
  if (!deductionMaster || !deductionMaster.isActive) {
    return null;
  }

  // Priority 1: Check for division-department specific rule
  if (divisionId && departmentId && deductionMaster.departmentRules && deductionMaster.departmentRules.length > 0) {
    const divDeptRule = deductionMaster.departmentRules.find(
      (rule) =>
        rule.divisionId &&
        rule.divisionId.toString() === divisionId.toString() &&
        rule.departmentId.toString() === departmentId.toString()
    );

    if (divDeptRule) {
      return {
        type: divDeptRule.type,
        amount: divDeptRule.amount,
        percentage: divDeptRule.percentage,
        percentageBase: divDeptRule.percentageBase,
        minAmount: divDeptRule.minAmount,
        maxAmount: divDeptRule.maxAmount,
        basedOnPresentDays: divDeptRule.basedOnPresentDays || false,
      };
    }
  }

  // Priority 2: Check for department-only rule (backward compatible)
  if (departmentId && deductionMaster.departmentRules && deductionMaster.departmentRules.length > 0) {
    const deptOnlyRule = deductionMaster.departmentRules.find(
      (rule) =>
        !rule.divisionId && // No division specified
        rule.departmentId.toString() === departmentId.toString()
    );

    if (deptOnlyRule) {
      return {
        type: deptOnlyRule.type,
        amount: deptOnlyRule.amount,
        percentage: deptOnlyRule.percentage,
        percentageBase: deptOnlyRule.percentageBase,
        minAmount: deptOnlyRule.minAmount,
        maxAmount: deptOnlyRule.maxAmount,
        basedOnPresentDays: deptOnlyRule.basedOnPresentDays || false,
      };
    }
  }

  // Priority 3: Return global rule
  if (deductionMaster.globalRule) {
    return {
      type: deductionMaster.globalRule.type,
      amount: deductionMaster.globalRule.amount,
      percentage: deductionMaster.globalRule.percentage,
      percentageBase: deductionMaster.globalRule.percentageBase,
      minAmount: deductionMaster.globalRule.minAmount,
      maxAmount: deductionMaster.globalRule.maxAmount,
      basedOnPresentDays: deductionMaster.globalRule.basedOnPresentDays || false,
    };
  }

  return null;
}

/**
 * Calculate deduction amount from rule
 * @param {Object} rule - Resolved rule
 * @param {Number} basicPay - Basic pay
 * @param {Number} grossSalary - Gross salary (for percentage base = 'gross')
 * @param {Object} attendanceData - Attendance data for proration { presentDays, paidLeaveDays, odDays, monthDays } or from dynamic payroll { totalPaidDays, totalDaysInMonth } (from output column)
 * @returns {Number} Deduction amount
 */
function calculateDeductionAmount(rule, basicPay, grossSalary = null, attendanceData = null) {
  if (!rule) {
    return 0;
  }

  let amount = 0;

  if (rule.type === 'fixed') {
    amount = rule.amount || 0;

    // Prorate: use totalPaidDays/totalDaysInMonth from dynamic payroll output column when provided; else present + paid leave + OD.
    if (rule.basedOnPresentDays && attendanceData) {
      const { presentDays = 0, paidLeaveDays = 0, odDays = 0, monthDays = 30, totalPaidDays: fromColumn, totalDaysInMonth: totalDaysFromColumn } = attendanceData;
      const totalPaidDays = typeof fromColumn === 'number' && fromColumn >= 0 ? fromColumn : (presentDays + paidLeaveDays + odDays);
      const totalDays = (typeof totalDaysFromColumn === 'number' && totalDaysFromColumn > 0) ? totalDaysFromColumn : monthDays;

      if (totalDays > 0) {
        const perDayAmount = amount / totalDays;
        amount = perDayAmount * totalPaidDays;
        console.log(`[Deduction] Prorated ${rule.name || 'deduction'}: ${rule.amount} / ${totalDays} * ${totalPaidDays} = ${amount}`);
      }
    }
  } else if (rule.type === 'percentage') {
    const base = rule.percentageBase === 'gross' && grossSalary ? grossSalary : basicPay;
    amount = (base * (rule.percentage || 0)) / 100;
  }

  // Apply min/max constraints
  if (rule.minAmount !== null && rule.minAmount !== undefined && amount < rule.minAmount) {
    amount = rule.minAmount;
  }
  if (rule.maxAmount !== null && rule.maxAmount !== undefined && amount > rule.maxAmount) {
    amount = rule.maxAmount;
  }

  return Math.round(amount * 100) / 100; // Round to 2 decimals
}

/**
 * Calculate total other deductions
 * @param {Array} deductions - Array of deduction objects
 * @returns {Number} Total deductions
 */
function calculateTotalOtherDeductions(deductions) {
  return deductions.reduce((sum, deduction) => sum + (deduction.amount || 0), 0);
}

module.exports = {
  getResolvedPermissionDeductionRules,
  getResolvedAttendanceDeductionRules,
  calculateDaysToDeduct,
  calculateAttendanceDeduction,
  calculatePermissionDeduction,
  calculateLeaveDeduction,
  calculateLeaveDeductionFromUnpaidDays,
  calculateOtherDeductions,
  getResolvedDeductionRule,
  calculateDeductionAmount,
  calculateTotalOtherDeductions,
};

