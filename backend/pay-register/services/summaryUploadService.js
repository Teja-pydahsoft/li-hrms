const PayRegisterSummary = require('../model/PayRegisterSummary');
const Employee = require('../../employees/model/Employee');
const { populatePayRegisterFromSources, getAllDatesInMonth } = require('./autoPopulationService');
const { calculateTotals, ensureTotalsRespectRoster } = require('./totalsCalculationService');
const { getPayrollDateRange } = require('../../shared/utils/dateUtils');
const mongoose = require('mongoose');

/**
 * Summary Upload Service
 * Handles bulk uploading of monthly summaries and distributing them across daily records
 */

/**
 * Process bulk upload of monthly summaries
 * @param {String} month - Month in YYYY-MM format
 * @param {Array} rows - Array of objects from Excel
 * @param {String} userId - ID of user performing upload
 * @returns {Object} Result summary
 */
async function processSummaryBulkUpload(month, rows, userId) {
    const [year, monthNum] = month.split('-').map(Number);
    const range = await getPayrollDateRange(year, monthNum);

    const results = {
        total: rows.length,
        success: 0,
        failed: 0,
        errors: [],
    };

    // Helper to find value in row by various possible key names (case-insensitive, trimmed)
    const getValue = (row, variants) => {
        const keys = Object.keys(row);
        for (const variant of variants) {
            const match = keys.find(k => k.trim().toLowerCase() === variant.toLowerCase());
            if (match !== undefined) return row[match];
        }
        return undefined;
    };

    for (const row of rows) {
        try {
            const empNo = getValue(row, ['Employee Code', 'Emp Code', 'Emp No', 'EmployeeNo'])?.toString()?.trim();
            if (!empNo) {
                results.failed++;
                results.errors.push(`Row ${rows.indexOf(row) + 1}: Missing Employee Code`);
                continue;
            }

            const employee = await Employee.findOne({ emp_no: empNo });
            if (!employee) {
                results.failed++;
                results.errors.push(`Employee not found: ${empNo}`);
                continue;
            }

            const employeeId = employee._id;

            // 1. DATA EXTRACTION
            const totalPresentInput = Number(getValue(row, ['Total Present', 'Present Days'])) || 0;
            const paidLeaves = Number(getValue(row, ['Paid Leaves', 'PaidLeaveCount', 'Leaves'])) || 0;
            const lopCount = Number(getValue(row, ['LOP Count', 'LOP'])) || 0;
            const holidayCount = Number(getValue(row, ['Holiday Count', 'Holidays', 'Weekoff Count'])) || 0;
            const totalODCount = Number(getValue(row, ['Total OD', 'OD Days', 'OD'])) || 0;
            const otHoursTotal = Number(getValue(row, ['OT Hours', 'Total OT'])) || 0;
            const extraDaysValue = Number(getValue(row, ['Extra Days', 'Total Extra Days'])) || 0;
            const lateCountRaw = Number(getValue(row, ['Late Count', 'Lates'])) || 0;

            // 2. DYNAMIC MONTH DAYS CALCULATION
            let totalDaysInMonth = range.totalDays || 30;
            const excelMonthDays = Number(getValue(row, ['Month Days', 'Total Days']));
            if (excelMonthDays > 0) totalDaysInMonth = excelMonthDays;

            // 3. DYNAMIC ABSENT CALCULATION
            const totalAbsentInputFromExcel = Number(getValue(row, ['Total Absent', 'Absent Days']));
            let totalAbsent = totalAbsentInputFromExcel;
            if (!totalAbsent || totalAbsent === 0) {
                totalAbsent = Math.max(0, totalDaysInMonth - (totalPresentInput + paidLeaves + lopCount + holidayCount));
            }

            let payRegister = await PayRegisterSummary.findOne({ employeeId, month });
            if (!payRegister) {
                payRegister = await PayRegisterSummary.create({
                    employeeId,
                    emp_no: employee.emp_no,
                    month,
                    monthName: new Date(year, monthNum - 1).toLocaleString('default', { month: 'long', year: 'numeric' }),
                    year,
                    monthNumber: monthNum,
                    startDate: range.startDate,
                    endDate: range.endDate,
                    status: 'draft',
                    totalDaysInMonth,
                    dailyRecords: await populatePayRegisterFromSources(employeeId, employee.emp_no, year, monthNum),
                    totals: {
                        totalDays: totalDaysInMonth,
                        totalPresentDays: 0,
                        totalAbsentDays: 0,
                        totalLeaveDays: 0,
                        totalODDays: 0,
                        totalPayableShifts: 0,
                    }
                });
            } else {
                payRegister.totalDaysInMonth = totalDaysInMonth;
                payRegister.startDate = range.startDate;
                payRegister.endDate = range.endDate;
                if (!payRegister.dailyRecords || payRegister.dailyRecords.length === 0) {
                    payRegister.dailyRecords = await populatePayRegisterFromSources(employeeId, employee.emp_no, year, monthNum);
                }
            }

            // 4. RESET ALL DAILY RECORDS (Clean Slate - No Shift Roster Respect)
            payRegister.dailyRecords.forEach(dr => {
                dr.status = 'absent';
                dr.isOD = false;
                dr.isSplit = false;
                dr.leaveType = null;
                dr.leaveNature = null;
                dr.isLate = false;
                dr.otHours = 0;
                dr.remarks = null;
                dr.isManuallyEdited = false;
                if (dr.firstHalf) {
                    dr.firstHalf.status = 'absent';
                    dr.firstHalf.leaveType = null;
                    dr.firstHalf.leaveNature = null;
                    dr.firstHalf.isOD = false;
                }
                if (dr.secondHalf) {
                    dr.secondHalf.status = 'absent';
                    dr.secondHalf.leaveType = null;
                    dr.secondHalf.leaveNature = null;
                    dr.secondHalf.isOD = false;
                }
            });
            payRegister.markModified('dailyRecords');

            // 5. EXHAUSTIVE DISTRIBUTION (Sequential, ignoring roster positions)
            const allDates = payRegister.dailyRecords.map(dr => dr.date);

            const exhaustiveDistribute = (count, status, leaveNature = null) => {
                let remaining = Number(count) || 0;
                if (remaining <= 0) return;

                // Simple sequential fill from the first available 'absent' day
                for (const date of allDates) {
                    if (remaining <= 0) break;

                    const dr = payRegister.dailyRecords.find(d => d.date === date);
                    if (!dr || (dr.status !== 'absent' && dr.status !== null) || dr.isSplit) continue;

                    if (remaining >= 1) {
                        dr.status = status;
                        dr.isOD = (status === 'od');
                        if (status === 'leave') {
                            dr.leaveNature = leaveNature;
                            dr.leaveType = leaveNature === 'paid' ? 'cl' : 'lop';
                        }
                        // Sync halves
                        if (dr.firstHalf) dr.firstHalf.status = status;
                        if (dr.secondHalf) dr.secondHalf.status = status;

                        remaining -= 1;
                    } else if (remaining > 0) {
                        dr.isSplit = true;
                        dr.firstHalf = { status, isOD: status === 'od', leaveNature };
                        dr.secondHalf = { status: 'absent' };
                        remaining = 0;
                    }
                }
            };

            const remainingPresent = Math.max(0, totalPresentInput - totalODCount);

            // Sequential order: Holidays first, then Leaves, then OD, then Present
            exhaustiveDistribute(holidayCount, 'holiday');
            exhaustiveDistribute(paidLeaves, 'leave', 'paid');
            exhaustiveDistribute(lopCount, 'leave', 'lop');
            exhaustiveDistribute(totalODCount, 'od');
            exhaustiveDistribute(remainingPresent, 'present');

            // 6. HANDLE LATES AND OT
            if (lateCountRaw > 0) {
                let latesToApply = lateCountRaw;
                for (const dr of payRegister.dailyRecords) {
                    if (latesToApply <= 0) break;
                    const isFullPresent = dr.status === 'present' || dr.status === 'od';
                    const isHalfPresent = dr.isSplit && (dr.firstHalf.status === 'present' || dr.secondHalf.status === 'present');
                    if (isFullPresent || isHalfPresent) {
                        dr.isLate = true;
                        latesToApply -= 1;
                    }
                }
            }
            if (otHoursTotal > 0) {
                const target = payRegister.dailyRecords.find(dr => dr.status === 'present' || dr.status === 'od' || (dr.isSplit && dr.firstHalf.status === 'present'));
                if (target) target.otHours = otHoursTotal;
            }

            // 7. FINAL TOTALS OVERRIDE (Blindly follow Excel)
            payRegister.set('totals.totalPresentDays', totalPresentInput);
            payRegister.set('totals.totalPaidLeaveDays', paidLeaves);
            payRegister.set('totals.totalLopDays', lopCount);
            payRegister.set('totals.totalLeaveDays', paidLeaves + lopCount);
            payRegister.set('totals.totalODDays', totalODCount);
            payRegister.set('totals.totalAbsentDays', totalAbsent);
            payRegister.set('totals.totalHolidays', holidayCount);
            payRegister.set('totals.totalWeeklyOffs', 0);
            payRegister.set('totals.lateCount', lateCountRaw);
            payRegister.set('totals.totalOTHours', otHoursTotal);
            payRegister.set('totals.extraDays', extraDaysValue);
            payRegister.set('totals.totalPayableShifts', totalPresentInput + extraDaysValue);

            payRegister.lastEditedBy = userId;
            payRegister.lastEditedAt = new Date();
            payRegister.markModified('totals');
            payRegister.markModified('dailyRecords');

            await payRegister.save();
            results.success++;
        } catch (err) {
            results.failed++;
            results.errors.push(`Row ${rows.indexOf(row) + 1}: ${err.message}`);
        }
    }

    return results;
}

module.exports = {
    processSummaryBulkUpload,
};
