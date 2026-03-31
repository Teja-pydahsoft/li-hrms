require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { calculateMonthlySummary } = require('../attendance/services/summaryCalculationService');
const Employee = require('../employees/model/Employee');

async function triggerFix() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to Database');

        const employee = await Employee.findOne({ emp_no: '2144' });
        if (!employee) return;

        console.log('Triggering Recalculation for March 2026...');
        await calculateMonthlySummary(employee._id, '2144', 2026, 3);
        console.log('Done.');

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
    }
}

triggerFix();
