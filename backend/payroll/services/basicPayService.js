/**
 * Basic Pay Calculation Service
 * Handles basic pay, per day calculation, payable amount, and incentive
 */

/**
 * Calculate basic pay components
 * @param {Object} employee - Employee object with gross_salary
 * @param {Object} attendanceSummary - MonthlyAttendanceSummary object
 * @returns {Object} Basic pay calculation result
 */
function calculateBasicPay(employee, attendanceSummary) {
  // Validate inputs
  if (!employee || !employee.gross_salary) {
    throw new Error('Employee or gross_salary is missing');
  }

  if (!attendanceSummary || !attendanceSummary.totalDaysInMonth) {
    throw new Error('Attendance summary or totalDaysInMonth is missing');
  }

  const basicPay = employee.gross_salary || 0;
  const totalDaysInMonth = attendanceSummary.totalDaysInMonth;
  const totalPresentDays = attendanceSummary.totalPresentDays || 0;
  const totalODDays = attendanceSummary.totalODDays || 0;
  const totalPaidLeaveDays = attendanceSummary.totalPaidLeaveDays || 0;
  const totalWeeklyOffs = attendanceSummary.totalWeeklyOffs || 0;
  const totalHolidays = attendanceSummary.totalHolidays || 0;
  const manualExtraDays = attendanceSummary.extraDays || 0;

  // Calculate per day basic pay
  const perDayBasicPay = totalDaysInMonth > 0 ? basicPay / totalDaysInMonth : 0;

  // 1. Calculate Total Paid Days (User Formula)
  // Formula: Calculated Paid Days = Payable Shifts + Paid Leaves + Holidays + Weekly Offs
  // Note: totalPayableShifts already includes Present Days + OD Days from attendance processing
  // We add Paid Leaves, Holidays, and Weekly Offs to get the complete calculation
  const physicalUnits = (attendanceSummary.totalPayableShifts || 0) +
    (attendanceSummary.totalPaidLeaveDays || 0) +
    (attendanceSummary.totalWeeklyOffs || 0) +
    (attendanceSummary.totalHolidays || 0);

  const rawTotalDays = physicalUnits;

  let totalPaidDays = rawTotalDays;
  let extraDays = 0;

  // 2. Capping Logic (User Request)
  // If Calculated Paid Days <= Total Days in Month: Total Paid Days = Calculated Paid Days, Extra Days = 0
  // If Calculated Paid Days > Total Days in Month: Extra Days = Calculated Paid Days - Total Days, Total Paid Days = Total Days (Capped)
  if (rawTotalDays > totalDaysInMonth) {
    extraDays = rawTotalDays - totalDaysInMonth;
    totalPaidDays = totalDaysInMonth;
  } else {
    extraDays = 0;
    totalPaidDays = rawTotalDays;
  }

  // 3. Base Pay Calculation (User Formula)
  // Base Pay = Total Paid Days * Daily Rate (Always capped at month's max days)
  const basePayForWork = totalPaidDays * perDayBasicPay;

  // 4. Extra Days Pay (Incentive)
  const incentive = extraDays * perDayBasicPay;

  // Final payable amount (Sum of both)
  const payableAmount = basePayForWork + incentive;

  return {
    basicPay,
    perDayBasicPay: Math.round(perDayBasicPay * 100) / 100,
    payableAmount: Math.round(payableAmount * 100) / 100,
    incentive: Math.round(incentive * 100) / 100,
    basePayForWork: Math.round(basePayForWork * 100) / 100,
    totalDaysInMonth,
    totalPaidDays,
    extraDays: Math.round(extraDays * 100) / 100,
    calculatedPaidDays: rawTotalDays,
    physicalUnits
  };
}

module.exports = {
  calculateBasicPay,
};

