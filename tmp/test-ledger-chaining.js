const mongoose = require('mongoose');
const path = require('path');

mongoose.set('debug', true);

const root = 'd:\\li-hrms';
const LeaveRegister = require(path.join(root, 'backend/leaves/model/LeaveRegister'));
const leaveRegisterService = require(path.join(root, 'backend/leaves/services/leaveRegisterService'));
const dateCycleService = require(path.join(root, 'backend/leaves/services/dateCycleService'));
const LeavePolicySettings = require(path.join(root, 'backend/settings/model/LeavePolicySettings'));
const Settings = require(path.join(root, 'backend/settings/model/Settings'));
const Employee = require(path.join(root, 'backend/employees/model/Employee'));

// Mock everything that hits other collections
dateCycleService.getLeavePolicySettings = async () => ({
    financialYear: { startMonth: 4, startDay: 1, useCalendarYear: false }
});
dateCycleService.getPayrollCycleSettings = async () => ({
    startDay: 1, endDay: 31
});
LeavePolicySettings.getSettings = async () => ({
    financialYear: { startMonth: 4, startDay: 1, useCalendarYear: false }
});
Settings.getSettingsByCategory = async () => ({
    payroll_cycle_start_day: 1,
    payroll_cycle_end_day: 31
});

// Mock Employee update to avoid hitting that collection
leaveRegisterService.updateEmployeeBalance = async () => {
    console.log('MOCK: updateEmployeeBalance called');
    return true;
};

async function testLedgerRechaining() {
    try {
        console.log('Connecting to DB...');
        await mongoose.connect('mongodb://localhost:27017/li-hrms', {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
        console.log('Connected to DB');

        const mockEmployeeId = new mongoose.Types.ObjectId();
        const leaveType = 'CL';

        console.log('--- Step 1: Add a Future Transaction (Feb 2024) ---');
        const febDate = new Date('2024-02-15');
        await leaveRegisterService.addTransaction({
            employeeId: mockEmployeeId,
            leaveType,
            transactionType: 'DEBIT',
            startDate: febDate,
            endDate: febDate,
            days: 2,
            reason: 'Future Leave',
            status: 'APPROVED'
        });

        let febTx = await LeaveRegister.findOne({ employeeId: mockEmployeeId, startDate: febDate });
        console.log(`Feb Initial: Opening=${febTx.openingBalance}, Used=2, Closing=${febTx.closingBalance}`);

        console.log('--- Step 2: Add a Backdated Transaction (Jan 2024) ---');
        const janDate = new Date('2024-01-15');
        await leaveRegisterService.addTransaction({
            employeeId: mockEmployeeId,
            leaveType,
            transactionType: 'CREDIT',
            startDate: janDate,
            endDate: janDate,
            days: 10,
            reason: 'Opening Balance',
            status: 'APPROVED'
        });

        let janTx = await LeaveRegister.findOne({ employeeId: mockEmployeeId, startDate: janDate });
        console.log(`Jan: Opening=0, Credit=10, Closing=${janTx.closingBalance}`);

        console.log('--- Step 3: Verify Feb Transaction was Re-chained ---');
        febTx = await LeaveRegister.findOne({ employeeId: mockEmployeeId, startDate: febDate });
        console.log(`Feb Updated: Opening=${febTx.openingBalance}, Used=2, Closing=${febTx.closingBalance}`);

        if (febTx.openingBalance === 10 && febTx.closingBalance === 8) {
            console.log('✅ RE-CHAINING SUCCESSFUL!');
        } else {
            console.error('❌ RE-CHAINING FAILED!');
        }

        // Cleanup
        await LeaveRegister.deleteMany({ employeeId: mockEmployeeId });
        await mongoose.disconnect();
    } catch (error) {
        console.error('STRICT ERROR:', error);
        process.exit(1);
    }
}

testLedgerRechaining();
