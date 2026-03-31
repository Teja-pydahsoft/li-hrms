require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

// Path to models
const Leave = require('../leaves/model/Leave');
const MonthlyAttendanceSummary = require('../attendance/model/MonthlyAttendanceSummary');
const Employee = require('../employees/model/Employee');

async function auditLeaves() {
    const empNo = '931';
    const startDate = '2026-02-26';
    const endDate = '2026-03-25';
    const summaryMonth = '2026-03';

    // Toggle this to true to fix LOP natures in the database
    const UPDATE_MODE = false;

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
        
        let lopToFix = [];

        leaves.forEach(l => {
            const from = l.fromDate.toISOString().split('T')[0];
            const to = l.toDate.toISOString().split('T')[0];
            const status = (l.status || '').padEnd(15);
            const type = (l.leaveType || 'N/A').padEnd(4);
            const days = (l.numberOfDays || 0).toString().padEnd(4);
            
            // Critical check: if leaveType is LOP but nature is not 'lop', flag it
            let nature = (l.leaveNature || 'N/A').toLowerCase();
            let natureDisplay = nature.toUpperCase().padEnd(6);
            
            if (l.leaveType === 'LOP' && nature !== 'lop') {
                natureDisplay = `\x1b[31m${natureDisplay}\x1b[0m`; // Red if nature is wrong for LOP
                lopToFix.push(l._id);
            }

            const splitStatus = l.splitStatus === undefined ? 'UNDEFINED' : (l.splitStatus === null ? 'NULL' : `"${l.splitStatus}"`);
            
            console.log(`${from} | ${to} | ${status} | ${type} | ${days} | ${natureDisplay} | ${splitStatus}`);
        });

        // 1b. Perform Fix if requested
        if (UPDATE_MODE && lopToFix.length > 0) {
            console.log(`\n[Fixing ${lopToFix.length} LOP nature records...]`);
            const updateResult = await Leave.updateMany(
                { _id: { $in: lopToFix } },
                { $set: { leaveNature: 'lop' } }
            );
            console.log(`- Updated ${updateResult.modifiedCount} records to "lop" nature.`);
            
            // Re-fetch to have correct data for analysis
            const updatedLeaves = await Leave.find({ _id: { $in: leaves.map(l => l._id) } }).lean();
            leaves.length = 0;
            leaves.push(...updatedLeaves);
        } else if (lopToFix.length > 0) {
            console.log(`\n⚠️  Found ${lopToFix.length} records with mismatch: LeaveType=LOP but LeaveNature != "lop".`);
            console.log(`   (Run with UPDATE_MODE = true to fix them in the DB)`);
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
        
        // Granular counts by nature for approved leaves
        const approvedPaid = leaves.filter(l => l.status === 'approved' && l.leaveNature === 'paid').reduce((sum, l) => sum + (l.numberOfDays || 0), 0);
        const approvedLop = leaves.filter(l => l.status === 'approved' && l.leaveNature === 'lop').reduce((sum, l) => sum + (l.numberOfDays || 0), 0);
        const totalApproved = approvedPaid + approvedLop;
        const totalPending = leaves.filter(l => l.status !== 'approved').reduce((sum, l) => sum + (l.numberOfDays || 0), 0);
        
        console.log(`- DB Approved (PAID): ${approvedPaid}`);
        console.log(`- DB Approved (LOP) : ${approvedLop}`);
        console.log(`- DB Total Approved : ${totalApproved}`);
        console.log(`- DB Pending/Other  : ${totalPending}`);
        
        if (summary) {
            console.log('\nDiscrepancy Check:');
            const totalDiff = summary.totalLeaves - totalApproved;
            const paidDiff = summary.totalPaidLeaves - approvedPaid;
            const lopDiff = summary.totalLopLeaves - approvedLop;

            if (totalDiff === 0 && paidDiff === 0 && lopDiff === 0) {
                console.log('- ✅ PERFECT SYNC: Nature-level breakdown matches summary exactly.');
            } else {
                if (totalDiff !== 0) console.log(`- ❌ Total Leaves mismatch: Summary=${summary.totalLeaves} vs DB=${totalApproved}`);
                if (paidDiff !== 0) console.log(`- ❌ Paid Leaves mismatch: Summary=${summary.totalPaidLeaves} vs DB=${approvedPaid}`);
                if (lopDiff !== 0) console.log(`- ❌ LOP Leaves mismatch: Summary=${summary.totalLopLeaves} vs DB=${approvedLop}`);
                console.log('\nPossible causes:');
                if (lopToFix.length > 0) console.log('  -> Data nature mismatch (fix them and recalculate summary).');
                console.log('  -> Multiple summaries exist for same month/employee.');
                console.log('  -> Summary was not recalculated after leave approval/rejection.');
            }
        }

    } catch (error) {
        console.error('Audit failed:', error.message);
    } finally {
        await mongoose.disconnect();
    }
}

auditLeaves();
