const mongoose = require('mongoose');
const PayRegisterSummary = require('../pay-register/model/PayRegisterSummary');
const MonthlyAttendanceSummary = require('../attendance/model/MonthlyAttendanceSummary');
require('dotenv').config();

async function verify() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const testEmpNo = 'EMP123'; // Replace with an actual test emp_no
  const month = '2024-03';

  const summary = await MonthlyAttendanceSummary.findOne({ emp_no: testEmpNo, month });
  if (!summary) {
    console.log(`No MonthlyAttendanceSummary found for ${testEmpNo} ${month}. Please ensure it exists first.`);
    return mongoose.disconnect();
  }

  console.log('Monthly Summary data:', {
    totalPresentDays: summary.totalPresentDays,
    totalLeaves: summary.totalLeaves,
    totalPaidLeaves: summary.totalPaidLeaves,
    totalLopLeaves: summary.totalLopLeaves,
    totalPayableShifts: summary.totalPayableShifts,
  });

  const payRegister = await PayRegisterSummary.findOne({ emp_no: testEmpNo, month });
  if (!payRegister) {
    console.log(`No PayRegisterSummary found for ${testEmpNo} ${month}.`);
  } else {
    console.log('Pay Register totals:', {
      totalPresentDays: payRegister.totals.totalPresentDays,
      totalLeaveDays: payRegister.totals.totalLeaveDays,
      totalPaidLeaveDays: payRegister.totals.totalPaidLeaveDays,
      totalLopDays: payRegister.totals.totalLopDays,
      totalPayableShifts: payRegister.totals.totalPayableShifts,
    });

    const match = (val1, val2) => Math.abs(val1 - val2) < 0.01;
    const ok = match(summary.totalPresentDays, payRegister.totals.totalPresentDays) &&
               match(summary.totalLeaves, payRegister.totals.totalLeaveDays) &&
               match(summary.totalPaidLeaves, payRegister.totals.totalPaidLeaveDays) &&
               match(summary.totalLopLeaves, payRegister.totals.totalLopDays);

    if (ok) {
        console.log('Verification SUCCESS: Pay Register matches Monthly Summary!');
    } else {
        console.log('Verification FAILURE: Mismatch found!');
    }
  }

  await mongoose.disconnect();
}

verify().catch(console.error);
