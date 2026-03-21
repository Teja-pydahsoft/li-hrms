require('dotenv').config({ path: 'backend/.env' });
const mongoose = require('mongoose');
const { performInitialCLSync } = require('../backend/leaves/services/annualCLResetService');

async function test() {
    try {
        const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/hrms';
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
        console.log('Connected to DB. Running Initial CL Sync...');
        const result = await performInitialCLSync();
        console.log('Initial CL Sync Results:');
        console.log(JSON.stringify(result, null, 2));

        // Let's also check if the ledger queries work
        const leaveRegisterService = require('../backend/leaves/services/leaveRegisterService');
        const now = new Date();
        const registerData = await leaveRegisterService.getLeaveRegister({}, now.getMonth() + 1, now.getFullYear());
        console.log('\nRetrieved Register Data length:', registerData.length);
        if (registerData.length > 0) {
            console.log('Sample data:', JSON.stringify(registerData[0].casualLeave, null, 2));
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
test();
