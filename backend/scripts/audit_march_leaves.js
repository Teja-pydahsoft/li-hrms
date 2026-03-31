require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

// Path to models
const Leave = require('../leaves/model/Leave');
const MonthlyAttendanceSummary = require('../attendance/model/MonthlyAttendanceSummary');
const Employee = require('../employees/model/Employee');

async function auditLeaves() {
    const empNo = '2144';
    const startDate = '2026-02-26';
    const endDate = '2026-03-25';
    const summaryMonth = '2026-03';

    try {
        const mongoURI = process.env.MONGODB_URI;
        await mongoose.connect(mongoURI);
        console.log('Connected to Database');

        const employee = await Employee.findOne({ emp_no: empNo });
        if (!employee) {
            console.error(`Error: Employee ${empNo} not found.`);
            process.exit(1);
        }

        console.log(`\n=== Audit Report for ${employee.employee_name} (${empNo}) ===`);
        console.log(`Target Period: ${startDate} to ${endDate}`);

        // 1. Fetch all leaves in range
        const leaves = await Leave.find({
            employeeId: employee._id,
            $or: [
                { fromDate: { $lte: new Date(endDate) }, toDate: { $gte: new Date(startDate) } }
            ],
            isActive: true
        }).select('fromDate toDate status leaveType numberOfDays leaveNature splitStatus').sort({ fromDate: 1 }).lean();

        console.log(`\n[Leave Records Found: ${leaves.length}]`);
        console.log('----------------------------------------------------------------------------------------------------');
        console.log('From Date  | To Date    | Status          | Type | Days | Nature | Split Status');
        console.log('----------------------------------------------------------------------------------------------------');
        
        leaves.forEach(l => {
            const from = l.fromDate.toISOString().split('T')[0];
            const to = l.toDate.toISOString().split('T')[0];
            const status = (l.status || '').padEnd(15);
            const type = (l.leaveType || 'N/A').padEnd(4);
            const days = (l.numberOfDays || 0).toString().padEnd(4);
            const nature = (l.leaveNature || 'N/A').toUpperCase().padEnd(6);
            const splitStatus = l.splitStatus === undefined ? 'UNDEFINED' : (l.splitStatus === null ? 'NULL' : `"${l.splitStatus}"`);
            
            console.log(`${from} | ${to} | ${status} | ${type} | ${days} | ${nature} | ${splitStatus}`);
        });

        // 1b. Check for LeaveSplits
        const LeaveSplit = require('../leaves/model/LeaveSplit');
        const splits = await LeaveSplit.find({
            employeeId: employee._id,
            date: { $gte: new Date(startDate), $lte: new Date(endDate) },
            isActive: { $ne: false }
        }).lean();

        if (splits.length > 0) {
            console.log(`\n[Leave Split Records Found: ${splits.length}]`);
            splits.forEach(s => {
                console.log(`- Date: ${s.date.toISOString().split('T')[0]} | Type: ${s.leaveType} | Status: ${s.status}`);
            });
        }

        // 2. Fetch Monthly Attendance Summary
        const summary = await MonthlyAttendanceSummary.findOne({
            employeeId: employee._id,
            month: summaryMonth
        });

        console.log('\n[Monthly Attendance Summary (March 2026)]');
        if (summary) {
            console.log(`Status:            Calculated at ${summary.updatedAt.toLocaleString()}`);
            console.log(`Period Bounds:     ${summary.startDate || 'N/A'} to ${summary.endDate || 'N/A'}`);
            console.log(`Total Leaves:      ${summary.totalLeaves}`);
            console.log(`Paid Leaves:       ${summary.totalPaidLeaves}`);
            console.log(`LOP Leaves :       ${summary.totalLopLeaves}`);
            console.log(`Payable Shifts:    ${summary.totalPayableShifts}`);
            console.log(`Total Days:        ${summary.totalDaysInMonth}`);
        } else {
            console.log('Status:            ⚠️ NOT GENERATED YET');
        }

        console.log('\n--------------------------------------------------------------------------------');
        console.log('Analysis:');
        const approvedCount = leaves.filter(l => l.status === 'approved').reduce((sum, l) => sum + l.numberOfDays, 0);
        const totalPending = leaves.filter(l => l.status !== 'approved').reduce((sum, l) => sum + l.numberOfDays, 0);
        
        console.log(`- Approved Leave Days: ${approvedCount}`);
        console.log(`- Pending/Other Days:  ${totalPending}`);
        
        if (summary && summary.totalLeaves !== approvedCount) {
          console.log(`- ❌ DISCREPANCY: Summary shows ${summary.totalLeaves} leaves, but DB has ${approvedCount} approved leave days.`);
        } else if (summary) {
          console.log('- ✅ SYNCED: Summary matches approved leave count.');
        }

    } catch (error) {
        console.error('Audit failed:', error.message);
    } finally {
        await mongoose.disconnect();
    }
}

auditLeaves();
