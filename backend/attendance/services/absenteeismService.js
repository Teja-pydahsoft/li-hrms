/**
 * Absenteeism Service
 * Handles logic for tracking absenteeism and auto-deactivating employees
 */

const Employee = require('../../employees/model/Employee');
const AttendanceDaily = require('../model/AttendanceDaily');
const PreScheduledShift = require('../../shifts/model/PreScheduledShift');
const { extractISTComponents, createISTDate } = require('../../shared/utils/dateUtils');

/**
 * Format date to YYYY-MM-DD
 */
const formatDate = (date) => {
    return extractISTComponents(date).dateStr;
};

/**
 * Ensure daily attendance records exist for all active employees for a given date.
 * If no record exists, create one with status 'ABSENT'.
 * @param {String} dateStr - Date string in YYYY-MM-DD format
 */
const ensureDailyRecordsExist = async (dateStr) => {
    try {
        console.log(`[AbsenteeismService] Ensuring daily records exist for ${dateStr}...`);

        // Fetch all active employees (using IST date comparison)
        const dateBoundary = createISTDate(dateStr);
        const activeEmployees = await Employee.find({
            is_active: { $ne: false },
            $or: [
                { leftDate: null },
                { leftDate: { $gte: dateBoundary } }
            ],
            $or: [
                { doj: null },
                { doj: { $lte: dateBoundary } }
            ]
        }).select('emp_no _id');

        console.log(`[AbsenteeismService] Found ${activeEmployees.length} active employees.`);

        let createdCount = 0;

        for (const emp of activeEmployees) {
            // Check if record exists
            const existingRecord = await AttendanceDaily.findOne({
                employeeNumber: emp.emp_no,
                date: dateStr
            });

            if (!existingRecord) {
                // Check roster status to determine if it should be ABSENT, HOLIDAY, or WEEK_OFF
                let status = 'ABSENT';
                let notes = null;

                try {
                    const rosterEntry = await PreScheduledShift.findOne({
                        employeeNumber: emp.emp_no,
                        date: dateStr,
                    });

                    if (rosterEntry) {
                        if (rosterEntry.status === 'HOL') status = 'HOLIDAY';
                        else if (rosterEntry.status === 'WO') status = 'WEEK_OFF';
                    }
                } catch (rosterErr) {
                    console.error(`[AbsenteeismService] Error checking roster for ${emp.emp_no}:`, rosterErr);
                }

                // Create missing record
                await AttendanceDaily.create({
                    employeeNumber: emp.emp_no,
                    date: dateStr,
                    status: status,
                    source: ['auto-generated'],
                    notes: notes
                });
                createdCount++;
            }
        }

        console.log(`[AbsenteeismService] Created ${createdCount} missing daily records for ${dateStr}.`);

    } catch (error) {
        console.error('[AbsenteeismService] Error in ensureDailyRecordsExist:', error);
    }
};

/**
 * Check for consecutive absences and deactivate employees if limit reached.
 * Limit: 3 consecutive days of ABSENT status.
 * @param {String} requestDateStr - The reference date to check backwards from (usually today)
 */
const checkConsecutiveAbsences = async (requestDateStr) => {
    try {
        // Determine the 3 dates to check (requestDate, requestDate-1, requestDate-2) - IST Aware
        const { year, month, day } = extractISTComponents(requestDateStr);
        const dateObj = createISTDate(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);

        const datesToCheck = [];
        for (let i = 0; i < 3; i++) {
            const d = createISTDate(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
            d.setDate(d.getDate() - i);
            datesToCheck.push(formatDate(d));
        }

        console.log(`[AbsenteeismService] Checking dates: ${datesToCheck.join(', ')}`);

        // Fetch all active employees
        const activeEmployees = await Employee.find({ is_active: true });

        let deactivatedCount = 0;

        for (const emp of activeEmployees) {
            // Fetch attendance records for these 3 dates
            const records = await AttendanceDaily.find({
                employeeNumber: emp.emp_no,
                date: { $in: datesToCheck }
            });

            // Map date to status
            const statusMap = {};
            records.forEach(r => statusMap[r.date] = r.status);

            // Check if all 3 statuses are 'ABSENT'
            let consecutiveAbsents = 0;
            let missingData = false;

            for (const date of datesToCheck) {
                const status = statusMap[date];
                if (!status) {
                    // If data is missing even after ensureDailyRecordsExist, we skip to be safe
                    // or we could assume absent? Safer to skip and wait for next sync.
                    missingData = true;
                    break;
                }
                if (status === 'ABSENT') {
                    consecutiveAbsents++;
                } else {
                    // Reset count if any day is not absent (Present, Leave, Holiday, Weekoff, etc.)
                    // Logic: consecutive days must include weekends/holidays if marked as ABSENT?
                    // Usually WeekOff/Holiday are not counted as Absent.
                    // So if status is 'WEEK_OFF' or 'HOLIDAY', it breaks the "Absent" chain?
                    // User requirement: "3 continuous absents".
                    // Typically this means 3 working days missed, or just 3 calendar days marked as Absent.
                    // If checking strict 'ABSENT' status, then WO/HOL breaks the chain, which is correct for "Absent".
                    break;
                }
            }

            if (!missingData && consecutiveAbsents === 3) {
                console.log(`[AbsenteeismService] Employee ${emp.emp_no} has 3 consecutive absences. Deactivating...`);

                // Deactivate employee
                emp.is_active = false;
                emp.leftDate = new Date(requestDateStr); // Set left date to the 3rd absent day
                emp.leftReason = 'Auto-deactivated due to 3 consecutive absences';

                await emp.save();
                deactivatedCount++;
            }
        }

        console.log(`[AbsenteeismService] Auto-deactivated ${deactivatedCount} employees.`);

    } catch (error) {
        console.error('[AbsenteeismService] Error in checkConsecutiveAbsences:', error);
    }
};

module.exports = {
    ensureDailyRecordsExist,
    checkConsecutiveAbsences
};
