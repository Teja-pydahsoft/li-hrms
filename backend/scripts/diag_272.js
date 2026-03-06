require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const AttendanceDaily = require('../attendance/model/AttendanceDaily');
const OD = require('../leaves/model/OD');
const Leave = require('../leaves/model/Leave');
const MonthlyAttendanceSummary = require('../attendance/model/MonthlyAttendanceSummary');
const Employee = require('../employees/model/Employee');
const { createISTDate, extractISTComponents, getAllDatesInRange } = require('../shared/utils/dateUtils');

async function run() {
    await mongoose.connect(process.env.MONGODB_URI);
    const emp = await Employee.findOne({ emp_no: '272' }).lean();

    const start = '2026-01-26';
    const end = '2026-02-25';
    const dates = getAllDatesInRange(start, end);

    const dailies = await AttendanceDaily.find({ employeeNumber: '272', date: { $gte: start, $lte: end } }).lean();
    const ods = await OD.find({ employeeId: emp._id, status: 'approved', isActive: true }).lean();
    const summary = await MonthlyAttendanceSummary.findOne({ employeeId: emp._id, month: '2026-02' }).lean();

    const dailyMap = new Map();
    dailies.forEach(d => dailyMap.set(d.date, d));

    console.log('Date | Status | PaySh | OD? | Type | Present? | Payable?');
    console.log('-----------------------------------------------------------');

    let calcP = 0;
    let calcPay = 0;

    for (const date of dates) {
        const d = dailyMap.get(date);
        const dayOds = ods.filter(o => {
            const os = extractISTComponents(o.fromDate).dateStr;
            const oe = extractISTComponents(o.toDate).dateStr;
            return date >= os && date <= oe;
        });

        let p = 0;
        let pay = 0;

        if (d) {
            if (d.status === 'PRESENT' || d.status === 'PARTIAL') p = 1.0;
            else if (d.status === 'HALF_DAY') p = 0.5;
            pay = d.payableShifts || 0;
        }

        if (dayOds.length > 0) {
            const odC = dayOds.some(o => !o.isHalfDay) ? 1.0 : 0.5;
            p = Math.max(p, odC);
            pay = Math.max(pay, odC);
        }

        console.log(`${date} | ${d?.status || 'MIS'} | ${d?.payableShifts || 0} | ${dayOds.length > 0 ? 'YES' : 'NO '} | ${dayOds[0]?.halfDayType || 'N/A'} | ${p} | ${pay}`);
        calcP += p;
        calcPay += pay;
    }

    console.log('-----------------------------------------------------------');
    console.log(`Calculated Present: ${calcP}`);
    console.log(`Calculated Payable: ${calcPay}`);
    console.log(`Summary Present: ${summary?.totalPresentDays}`);
    console.log(`Summary Payable: ${summary?.totalPayableShifts}`);

    await mongoose.disconnect();
}
run();
