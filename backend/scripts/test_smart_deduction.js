const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const Employee = require('../employees/model/Employee');
const Leave = require('../leaves/model/Leave');
const LeaveSettings = require('../leaves/model/LeaveSettings');
const LeavePolicySettings = require('../settings/model/LeavePolicySettings');
const LeaveRegister = require('../leaves/model/LeaveRegister');
const Division = require('../departments/model/Division');
const Department = require('../departments/model/Department');
const Designation = require('../departments/model/Designation');
const User = require('../users/model/User');
const leaveRegisterService = require('../leaves/services/leaveRegisterService');
const leaveController = require('../leaves/controllers/leaveController');

async function runTest() {
    try {
        console.log('Connecting to MongoDB...');
        const mongoUri = process.env.MONGODB_URI.replace('localhost', '127.0.0.1');
        await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
        console.log('Connected.\n');

        // 1. Setup Test Employee
        console.log('1. Setting up Test Employee...');
        let division = await Division.findOne({ name: 'Test Division' });
        if (!division) {
            division = await Division.create({ name: 'Test Division', code: 'TDIV' });
        }

        let department = await Department.findOne({ name: 'Test Dept' });
        if (!department) {
            department = await Department.create({ name: 'Test Dept', code: 'TDEPT', division_id: division._id });
        }

        let employee = await Employee.findOne({ emp_no: 'TEST_SMART_01' });
        if (!employee) {
            employee = await Employee.create({
                emp_no: 'TEST_SMART_01',
                employee_name: 'Test Smart User',
                email: 'testsmart@example.com',
                is_active: true,
                doj: new Date('2023-01-01'),
                division_id: division._id,
                department_id: department._id,
                casualLeaves: 12,
                compensatoryOffs: 2,
                paidLeaves: 10
            });
        } else {
            employee.division_id = division._id;
            employee.department_id = department._id;
            employee.casualLeaves = 12;
            employee.compensatoryOffs = 2;
            employee.paidLeaves = 10;
            await employee.save();
        }
        console.log(`   ✓ Employee: ${employee.emp_no}, Balances: CL:12, CCL:2, EL:10\n`);

        // 2. Setup Leave Settings (Hide CCL and EL)
        console.log('2. Configuring Leave Settings (Hiding CCL/EL)...');
        let settings = await LeaveSettings.findOne({ type: 'leave', isActive: true });
        if (!settings) {
            settings = await LeaveSettings.create({ type: 'leave', isActive: true, types: [] });
        }
        
        // Ensure CL is active, CCL/EL are inactive or missing
        const types = settings.types.filter(t => t.code !== 'CCL' && t.code !== 'EL');
        if (!types.find(t => t.code === 'CL')) {
            types.push({ code: 'CL', name: 'Casual Leave', isActive: true, totalDays: 12 });
        }
        settings.types = types;
        await settings.save();
        console.log('   ✓ CCL and EL are now hidden from selectable types.\n');

        // 3. Setup Leave Policy (Enable Substitution and 1-day CL cap)
        console.log('3. Configuring Leave Policy (1-day CL cap, Substitution ON)...');
        let policy = await LeavePolicySettings.findOne({});
        if (!policy) policy = new LeavePolicySettings({});
        
        policy.monthlyLimitSettings = {
            mode: 'strict',
            defaultMonthlyCap: 1, // 1 day CL cap
            maxUsableLimit: 4,
            includeCCL: true,
            includeEL: true,
            logicType: 'ADDITIVE'
        };
        await policy.save();
        console.log('   ✓ Policy: 1-day CL cap, CCL/EL included in total limit.\n');

        // 4. Clean up previous test register entries
        await LeaveRegister.deleteMany({ empNo: 'TEST_SMART_01' });

        // 4a. Seed starting balance entries (ledger-based balance)
        await leaveRegisterService.addTransaction({
            employeeId: employee._id, empNo: employee.emp_no,
            employeeName: employee.employee_name, designation: 'N/A', department: 'N/A',
            divisionId: division._id, departmentId: department._id,
            dateOfJoining: employee.doj, employmentStatus: 'active',
            leaveType: 'CL', transactionType: 'CREDIT',
            startDate: new Date('2026-03-01'), endDate: new Date('2026-03-01'),
            days: 12, reason: 'Yearly allotment'
        });
        await leaveRegisterService.addTransaction({
            employeeId: employee._id, empNo: employee.emp_no,
            employeeName: employee.employee_name, designation: 'N/A', department: 'N/A',
            divisionId: division._id, departmentId: department._id,
            dateOfJoining: employee.doj, employmentStatus: 'active',
            leaveType: 'CCL', transactionType: 'CREDIT',
            startDate: new Date('2026-03-01'), endDate: new Date('2026-03-01'),
            days: 2, reason: 'Comp-off earned'
        });
        console.log('   ✓ Seeded CL:12 and CCL:2 ledger entries.\n');

        // 5. Test Application (3 days of CL)
        console.log('4. Testing 3-day CL Application...');
        // Mocking request/response for controller
        const req = {
            user: { _id: new mongoose.Types.ObjectId(), role: 'super_admin' },
            body: {
                empNo: 'TEST_SMART_01',
                leaveType: 'CL',
                fromDate: '2026-03-24',
                toDate: '2026-03-26',
                purpose: 'Smart deduction test',
                contactNumber: '1234567890'
            }
        };
        let result = { code: 200 };
        const res = {
            status: (code) => {
                result.code = code;
                return {
                    json: (data) => {
                        result.data = data;
                        return result;
                    }
                };
            },
            json: (data) => {
                result.data = data;
                return result;
            }
        };

        await leaveController.applyLeave(req, res);
        if (result.code !== 201 && result.code !== 200 && !result.data?.success) {
            console.error('   ✗ Application failed:', result.data.error || result.data);
            return;
        }
        
        const leave = result.data.data;
        console.log(`   ✓ Leave created: ${leave._id}, Status: ${leave.status}\n`);

        // 6. Approve Leave to trigger addLeaveDebit
        console.log('5. Approving Leave and Verifying Deductions...');
        // We bypass the full workflow for speed and call addLeaveDebit directly as it would happen on final approval
        await leaveRegisterService.addLeaveDebit(leave, req.user._id);
        
        // 7. Verification
        const registerEntries = await LeaveRegister.find({ applicationId: leave._id }).sort({ leaveType: 1 });
        console.log('   ✓ Register Entries found:', registerEntries.length);
        
        registerEntries.forEach(entry => {
            console.log(`     - Type: ${entry.leaveType}, Days: ${entry.days}, Reason: ${entry.reason}`);
        });

        const updatedEmp = await Employee.findById(employee._id);
        console.log(`\n   ✓ Final Employee Balances (Calculated from Register):`);
        
        async function getRegBalance(employeeId, leaveType) {
            return await leaveRegisterService.getCurrentBalance(employeeId, leaveType, new Date('2026-04-30')); // End of month
        }

        const clRegBal = await getRegBalance(employee._id, 'CL');
        const cclRegBal = await getRegBalance(employee._id, 'CCL');
        const elRegBal = await getRegBalance(employee._id, 'EL');

        console.log(`     - Casual Leaves: ${clRegBal} (Expected: 11)`);
        console.log(`     - Comp Offs:     ${cclRegBal} (Expected: 0)`);
        console.log(`     - Paid Leaves:   ${elRegBal} (Expected: 10)`);
        
        console.log(`\n   ✓ Final Employee Stats (Model Fields Sync):`);
        console.log(`     - casualLeaves:     ${updatedEmp.casualLeaves}`);
        console.log(`     - compensatoryOffs: ${updatedEmp.compensatoryOffs}`);

        if (registerEntries.length === 2 && clRegBal === 11 && cclRegBal === 0) {
            console.log('\n   [SUCCESS] Smart Deduction verified: 1 day CL + 2 days CCL used for 3-day request.');
        } else {
            console.log('\n   [FAILURE] Deduction logic did not match expectations.');
        }

    } catch (err) {
        console.error('Test Error:', err.message);
        if (err.errors) {
            console.log('Detailed Validation Errors:');
            Object.keys(err.errors).forEach(key => {
                console.log(`- ${key}: ${err.errors[key].message}`);
            });
        }
    } finally {
        await mongoose.disconnect();
    }
}

runTest();
