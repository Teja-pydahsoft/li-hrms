const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Configuration
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/li-hrms';
const empNo = process.argv[2] || '2067';
const monthStr = process.argv[3] || '2026-03';

async function run() {
    try {
        console.log(`\n=============================================================`);
        console.log(`   ATTENDANCE DEDUCTION DEBUGGER - ${monthStr}`);
        console.log(`=============================================================\n`);

        // Connect to DB
        await mongoose.connect(MONGO_URI);

        // Models
        const Employee = require('../employees/model/Employee');
        const MonthlyAttendanceSummary = require('../attendance/model/MonthlyAttendanceSummary');
        const deductionService = require('../payroll/services/deductionService');

        // 1. Fetch Employee
        const employee = await Employee.findOne({ emp_no: empNo }).lean();
        if (!employee) {
            console.error(`ERROR: Employee ${empNo} not found.`);
            process.exit(1);
        }

        console.log(`[1] EMPLOYEE PROFILE`);
        console.table({
            'Name': employee.employee_name,
            'EMP No': employee.emp_no,
            'Dept ID': employee.department_id?.toString(),
            'Apply Deduc.': employee.applyAttendanceDeduction !== false ? 'YES' : 'NO',
            'Deduct Late': employee.deductLateIn !== false ? 'YES' : 'NO',
            'Deduct Early': employee.deductEarlyOut !== false ? 'YES' : 'NO'
        });

        // 2. Fetch Summary & Calculate Live Breakdown
        const summary = await MonthlyAttendanceSummary.findOne({ 
            employeeId: employee._id, 
            month: monthStr 
        }).lean();

        let storedBreakdown = summary?.attendanceDeductionBreakdown || {};
        let liveBreakdown = {};

        // Recalculate Live Breakdown for comparison
        try {
            const gross = Number(employee.gross_salary) || 0;
            const totalDays = summary?.totalDaysInMonth || 30;
            const perDayBasicPay = Math.round((gross / totalDays) * 100) / 100;
            
            // We need to fetch absent settings for the live call
            const DepartmentSettings = require('../departments/model/DepartmentSettings');
            const AttendanceDeductionSettings = require('../attendance/model/AttendanceDeductionSettings');
            
            const deptSettings = await DepartmentSettings.getByDeptAndDiv(employee.department_id, employee.division_id);
            const globalSettings = await AttendanceDeductionSettings.getActiveSettings();
            
            const lopDaysPerAbsent = deptSettings?.attendance?.absentDeductionRules?.lopDaysPerAbsent ?? 1;
            const enableAbsentDeduction = deptSettings?.attendance?.absentDeductionRules?.enableAbsentDeduction ?? false;

            const attDed = await deductionService.calculateAttendanceDeduction(
                employee._id,
                monthStr,
                employee.department_id,
                perDayBasicPay,
                employee.division_id,
                {
                    absentDays: summary?.totalAbsentDays || 0,
                    enableAbsentDeduction: enableAbsentDeduction,
                    lopDaysPerAbsent: lopDaysPerAbsent,
                    employee: employee
                }
            );
            liveBreakdown = attDed.breakdown || {};
        } catch (e) {
            console.warn(`[!] Live deduction calculation failed: ${e.message}`);
        }

        if (!summary) {
            console.warn(`\n[!] Monthly summary not found for ${monthStr}. Please run recalculation first.\n`);
        } else {
            console.log(`\n[2] MONTHLY ATTENDANCE SUMMARY (STORED)`);
            console.table({
                'Present Days': summary.totalPresentDays,
                'OD Days': summary.totalODs,
                'LOP Days (Absents)': summary.totalAbsentDays,
                'Extra Penalty (Absents)': summary.absentExtraDays || 0,
                'Lates Count': summary.lateInCount,
                'Combined Count': summary.lateOrEarlyCount
            });

            console.log(`\n[3] DEDUCTION CALCULATION BREAKDOWN (STORED)`);
            console.table({
                'Threshold (N)': storedBreakdown.combinedCountThreshold || 'N/A',
                'Free Allowed': storedBreakdown.freeAllowedPerMonth || 0,
                'Effective Count': storedBreakdown.effectiveCount || 0,
                'Deduction Type': storedBreakdown.deductionType || 'None',
                'Days Deducted': storedBreakdown.daysDeducted || 0
            });

            if (summary.contributingDates && summary.contributingDates.absent?.length > 0) {
                console.log(`\n[4] CONTRIBUTING DATES (ABSENCES)`);
                const absentTable = summary.contributingDates.absent.map(d => ({
                    'Date': d.date,
                    'Value': d.value,
                    'Label': d.label
                }));
                console.table(absentTable);
            }

            if (summary.contributingDates && summary.contributingDates.lateIn?.length > 0) {
                console.log(`\n[5] CONTRIBUTING DATES (LATE-INS REPORTED)`);
                const latesTable = summary.contributingDates.lateIn.map(d => ({
                    'Date': d.date,
                    'Late (Mins)': d.value,
                    'Label': d.label
                }));
                console.table(latesTable);
            }
        }

        // 3. Fetch Resolved Rules (Live)
        console.log(`\n[6] ACTIVE DEDUCTION SETTINGS (LIVE SYSTEM)`);
        const rules = await deductionService.getResolvedAttendanceDeductionRules(
            employee.department_id, 
            employee.division_id
        );

        // Fetch Department Settings (for Absents)
        const DepartmentSettings = require('../departments/model/DepartmentSettings');
        const deptSettings = await DepartmentSettings.getByDeptAndDiv(employee.department_id, employee.division_id);
        const lopDaysPerAbsent = deptSettings?.attendance?.absentDeductionRules?.lopDaysPerAbsent ?? 1;
        const enableAbsentDeduction = deptSettings?.attendance?.absentDeductionRules?.enableAbsentDeduction ?? false;
        
        console.table({
            'Threshold': rules.combinedCountThreshold || 'Not Configured',
            'Deduc. Type': rules.deductionType || 'No Deduction',
            'Absent Extra Penalty': enableAbsentDeduction ? `EXTRA ${(lopDaysPerAbsent - 1)} per absent` : 'None',
            'Total LOP per Absent': enableAbsentDeduction ? lopDaysPerAbsent : '1 (Standard)'
        });

        // 4. Unified Analysis Table
        console.log(`\n[7] UNIFIED DEDUCTION AUDIT`);
        const unifiedData = [
            { 'Feature': 'Lates Count', 'Summary (Stored)': summary?.lateInCount || 0, 'Live Logic (Recalculated)': liveBreakdown.lateInsCount || 0, 'Status': summary?.lateInCount === liveBreakdown.lateInsCount ? 'OK' : 'MISMATCH' },
            { 'Feature': 'Early Count', 'Summary (Stored)': summary?.earlyOutCount || 0, 'Live Logic (Recalculated)': liveBreakdown.earlyOutsCount || 0, 'Status': summary?.earlyOutCount === liveBreakdown.earlyOutsCount ? 'OK' : 'MISMATCH' },
            { 'Feature': 'Combined Count', 'Summary (Stored)': summary?.lateOrEarlyCount || 0, 'Live Logic (Recalculated)': liveBreakdown.combinedCount || 0, 'Status': summary?.lateOrEarlyCount === liveBreakdown.combinedCount ? 'OK' : 'MISMATCH' },
            { 'Feature': 'Effective Count', 'Stored': storedBreakdown.effectiveCount || 0, 'Live Logic (Recalculated)': liveBreakdown.effectiveCount || 0, 'Status': storedBreakdown.effectiveCount === liveBreakdown.effectiveCount ? 'OK' : 'MISMATCH' },
            { 'Feature': 'Threshold (N)', 'Stored': storedBreakdown.combinedCountThreshold || 'N/A', 'Live Logic (Recalculated)': liveBreakdown.combinedCountThreshold || 'N/A', 'Status': '-' },
            { 'Feature': 'Late/Early Ded (Days)', 'Stored': storedBreakdown.lateEarlyDaysDeducted || 0, 'Live Logic (Recalculated)': liveBreakdown.lateEarlyDaysDeducted || 0, 'Status': '-' },
            { 'Feature': 'Absent Days', 'Summary (Stored)': summary?.totalAbsentDays || 0, 'Live Logic (Recalculated)': liveBreakdown.absentDays || 0, 'Status': summary?.totalAbsentDays === liveBreakdown.absentDays ? 'OK' : 'MISMATCH' },
            { 'Feature': 'Absent Extra (Days)', 'Stored': storedBreakdown.absentExtraDays || 0, 'Live Logic (Recalculated)': liveBreakdown.absentExtraDays || 0, 'Status': '-' },
            { 'Feature': 'TOTAL DEDUCTION (DAYS)', 'Summary (Stored)': summary?.totalAttendanceDeductionDays || 0, 'Live Logic (Recalculated)': liveBreakdown.daysDeducted || 0, 'Status': summary?.totalAttendanceDeductionDays === liveBreakdown.daysDeducted ? 'OK' : 'MISMATCH' }
        ];
        console.table(unifiedData);

        if (summary?.lateInCount !== liveBreakdown.lateInsCount || summary?.earlyOutCount !== liveBreakdown.earlyOutsCount) {
             console.log(`\n[!] WARNING: Mismatch detected between stored counts and live logic.`);
             console.log(`    This can happen if lates are on HALF_DAY records (currently skipped in summary).`);
             console.log(`    Please run recalculation: node recalculate_attendance.js ${empNo} ${monthStr}`);
        }

        // 5. Projection Table (Simulated Lates)
        console.log(`\n[8] DEDUCTION SIMULATION (LATES 1-5)`);
        if (rules.combinedCountThreshold && rules.deductionType) {
            const simulation = [];
            const threshold = Number(rules.combinedCountThreshold);
            const deductionPerThreshold = rules.deductionType === 'half_day' ? 0.5 : (rules.deductionType === 'full_day' ? 1.0 : (rules.deductionDays || 0));
            const free = Number(rules.freeAllowedPerMonth) || 0;
            const mode = rules.calculationMode || 'floor';

            for (let i = 1; i <= 5; i++) {
                const effective = Math.max(0, i - free);
                let multiplier = 0;
                if (mode === 'floor') {
                    multiplier = Math.floor(effective / threshold);
                } else {
                    multiplier = effective / threshold;
                }
                const daysDeducted = Math.round((multiplier * deductionPerThreshold) * 100) / 100;
                
                simulation.push({
                    'Lates Count': i,
                    'Free Allowed': free,
                    'Effective': effective,
                    'Threshold': threshold,
                    'Deducted Days': daysDeducted,
                    'Formula': `${mode}(${effective}/${threshold}) * ${deductionPerThreshold}`
                });
            }
            console.table(simulation);
        } else {
            console.log('Skipping simulation: Threshold or Deduction Type not configured.');
        }

        console.log(`\n=============================================================`);
        console.log(`>>> FINAL AUDIT RESULT FOR EMP ${empNo} (${monthStr}) <<<`);
        
        // Fetch specific dates for lates/early-outs (to show all 3 lates)
        const AttendanceDaily = require('../attendance/model/AttendanceDaily');
        const startStr = `${monthStr}-01`;
        const endStr = `${monthStr}-31`;
        const dailyRecords = await AttendanceDaily.find({
            employeeNumber: empNo,
            date: { $gte: startStr, $lte: endStr }
        }).select('date status totalLateInMinutes totalEarlyOutMinutes lateInWaved earlyOutWaved').lean();

        const lateDates = dailyRecords.filter(r => r.status === 'PRESENT' && (Number(r.totalLateInMinutes) || 0) > 0 && !r.lateInWaved).map(r => `${r.date}`);
        const earlyDates = dailyRecords.filter(r => r.status === 'PRESENT' && (Number(r.totalEarlyOutMinutes) || 0) > 0 && !r.earlyOutWaved).map(r => `${r.date}`);
        const skippedLates = dailyRecords.filter(r => r.status !== 'PRESENT' && (Number(r.totalLateInMinutes) || 0) > 0 && !r.lateInWaved).map(r => `${r.date} (${r.status})`);

        console.log(`Lates Detected (PRESENT only): ${liveBreakdown.lateInsCount || 0}`);
        if (lateDates.length > 0) console.log(`   Dates: ${lateDates.join(', ')}`);
        
        if (skippedLates.length > 0) {
            console.log(`Lates Ignored (Non-PRESENT): ${skippedLates.length}`);
            console.log(`   Dates: ${skippedLates.join(', ')}`);
        }
        
        console.log(`Early-Outs Detected (PRESENT only): ${liveBreakdown.earlyOutsCount || 0}`);
        if (earlyDates.length > 0) console.log(`   Dates: ${earlyDates.join(', ')}`);

        console.log(`Projected Total Deduction: ${(liveBreakdown.daysDeducted || 0)} Days`);
        console.log(`=============================================================\n`);

    } catch (error) {
        console.error('Execution failed:', error);
    } finally {
        await mongoose.disconnect();
    }
}

run();
