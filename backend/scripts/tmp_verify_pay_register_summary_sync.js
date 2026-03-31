require('dotenv').config();
const mongoose = require('mongoose');
const Employee = require('../employees/model/Employee');
const PayRegisterSummary = require('../pay-register/model/PayRegisterSummary');
const MonthlyAttendanceSummary = require('../attendance/model/MonthlyAttendanceSummary');
const { manualSyncPayRegister } = require('../pay-register/services/autoSyncService');

async function run() {
  const empNoArg = process.argv[2] || '5005';
  const month = process.argv[3] || '2026-02';
  await mongoose.connect(process.env.MONGODB_URI);

  const employee = await Employee.findOne({ emp_no: String(empNoArg).toUpperCase() }).select('_id emp_no').lean();
  if (!employee) throw new Error(`Employee not found: ${empNoArg}`);

  const beforePR = await PayRegisterSummary.findOne({ employeeId: employee._id, month })
    .select('totals.totalWeeklyOffs totals.totalHolidays totals.totalAbsentDays totals.totalLeaveDays')
    .lean();
  const beforeSummary = await MonthlyAttendanceSummary.findOne({ employeeId: employee._id, month })
    .select('totalWeeklyOffs totalHolidays totalAbsentDays totalLeaves')
    .lean();

  await manualSyncPayRegister(String(employee._id), month);

  const afterPR = await PayRegisterSummary.findOne({ employeeId: employee._id, month })
    .select('totals.totalWeeklyOffs totals.totalHolidays totals.totalAbsentDays totals.totalLeaveDays')
    .lean();
  const afterSummary = await MonthlyAttendanceSummary.findOne({ employeeId: employee._id, month })
    .select('totalWeeklyOffs totalHolidays totalAbsentDays totalLeaves')
    .lean();

  console.log(
    JSON.stringify(
      {
        emp_no: employee.emp_no,
        month,
        before: {
          payRegister: beforePR?.totals || null,
          summary: beforeSummary || null,
        },
        after: {
          payRegister: afterPR?.totals || null,
          summary: afterSummary || null,
          matches: {
            weeklyOffs: (afterPR?.totals?.totalWeeklyOffs || 0) === (afterSummary?.totalWeeklyOffs || 0),
            holidays: (afterPR?.totals?.totalHolidays || 0) === (afterSummary?.totalHolidays || 0),
            absent: (afterPR?.totals?.totalAbsentDays || 0) === (afterSummary?.totalAbsentDays || 0),
            leaves: (afterPR?.totals?.totalLeaveDays || 0) === (afterSummary?.totalLeaves || 0),
          },
        },
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
