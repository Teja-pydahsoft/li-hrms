const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

// Path to models
const PayRegisterSummary = require('../pay-register/model/PayRegisterSummary');
const Employee = require('../employees/model/Employee');
const PayrollBatch = require('../payroll/model/PayrollBatch');

async function checkStatus() {
    const empNo = process.argv[2];
    const month = process.argv[3];

    if (!empNo || !month) {
        console.log('Usage: node scripts/check_pay_register_status.js <emp_no> <month>');
        console.log('Example: node scripts/check_pay_register_status.js 272 2026-03');
        process.exit(1);
    }

    try {
        const mongoURI = process.env.MONGODB_URI;
        if (!mongoURI) {
            throw new Error('MONGODB_URI not found in environment variables');
        }

        await mongoose.connect(mongoURI);
        console.log('Connected to Database');

        // 1. Find Employee
        const employee = await Employee.findOne({ emp_no: empNo }).select('employee_name emp_no department_id division_id');
        if (!employee) {
            console.error(`Error: Employee with code ${empNo} not found.`);
            process.exit(1);
        }

        console.log(`\n--- Report for ${employee.employee_name} (${employee.emp_no}) | Month: ${month} ---`);

        // 2. Check Pay Register Summary
        const pr = await PayRegisterSummary.findOne({ employeeId: employee._id, month })
            .populate('lastEditedBy', 'name role')
            .lean();

        if (pr) {
            console.log('\n[Pay Register Summary]');
            console.log(`Status:        ${pr.status === 'finalized' ? '🔴 LOCKED (FINALIZED)' : '🟢 OPEN (' + pr.status.toUpperCase() + ')'}`);
            console.log(`Period:        ${pr.startDate} to ${pr.endDate}`);
            console.log(`Total Days:    ${pr.totalDaysInMonth}`);
            console.log(`Last Edited:   ${pr.lastEditedAt ? pr.lastEditedAt.toLocaleString() : 'N/A'}`);
            if (pr.lastEditedBy) {
                console.log(`Edited By:     ${pr.lastEditedBy.name} (${pr.lastEditedBy.role})`);
            }
            
            console.log('\n[Totals Sync Check]');
            console.log(`Present Days:  ${pr.totals.totalPresentDays}`);
            console.log(`Paid Leaves:   ${pr.totals.totalPaidLeaveDays}`);
            console.log(`LOP Days:      ${pr.totals.totalLopDays}`);
            console.log(`Late Count:    ${pr.totals.lateCount}`);
            console.log(`Payable:       ${pr.totals.totalPayableShifts}`);
        } else {
            console.log('\n[Pay Register Summary]');
            console.log('Status:        ⚠️ NOT CREATED YET (Will be created on first access)');
        }

        // 3. Check Payroll Batch (Departmental Lock)
        const batch = await PayrollBatch.findOne({
            department: employee.department_id,
            month: month
        }).populate('approvedBy', 'name').lean();

        if (batch) {
            console.log('\n[Payroll Batch Status]');
            console.log(`Batch Number:  ${batch.batchNumber}`);
            console.log(`Batch Status:  ${['freeze', 'complete'].includes(batch.status) ? '🔴 LOCKED (' + batch.status.toUpperCase() + ')' : '🟡 ' + batch.status.toUpperCase()}`);
            if (batch.approvedBy) {
                console.log(`Approved By:   ${batch.approvedBy.name}`);
            }
        } else {
            console.log('\n[Payroll Batch Status]');
            console.log('Status:        No active payroll batch found for this department/month.');
        }

        console.log('\n-----------------------------------------------------------\n');

    } catch (error) {
        console.error('An error occurred:', error.message);
    } finally {
        await mongoose.disconnect();
    }
}

checkStatus();
