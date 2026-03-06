require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const OD = require('../leaves/model/OD');
const Employee = require('../employees/model/Employee');

async function run() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const employee = await Employee.findOne({ emp_no: '272' }).lean();
        if (!employee) return console.log('Emp not found');

        const ods = await OD.find({
            employeeId: employee._id
        }).lean();

        console.log('--- ALL ODs for Emp 272 ---');
        console.log('Count:', ods.length);
        ods.forEach(o => {
            console.log({
                date: o.date,
                toDate: o.toDate,
                numberOfDays: o.numberOfDays,
                status: o.status,
                isActive: o.isActive
            });
        });
    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
}
run();
