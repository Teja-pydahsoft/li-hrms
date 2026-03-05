/**
 * Debug: list approved leaves and which days are counted in the payroll period for an employee.
 * Usage: node scripts/debug_leaves_in_period.js
 *   EMP_NO=2146 MONTH=2026-02 node scripts/debug_leaves_in_period.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Leave = require('../leaves/model/Leave');
const Employee = require('../employees/model/Employee');
const dateCycleService = require('../leaves/services/dateCycleService');
const { createISTDate, extractISTComponents } = require('../shared/utils/dateUtils');

function toNormalizedDateStr(val) {
  if (!val) return '';
  if (val instanceof Date) return extractISTComponents(val).dateStr;
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return extractISTComponents(new Date(val)).dateStr;
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const empNo = (process.env.EMP_NO || '2146').trim().toUpperCase();
  const month = process.env.MONTH || '2026-02';
  const [year, monthNum] = month.split('-').map(Number);

  const emp = await Employee.findOne({ emp_no: empNo }).select('_id emp_no employee_name').lean();
  if (!emp) {
    console.log('Employee not found:', empNo);
    await mongoose.disconnect();
    return;
  }

  const anchor = createISTDate(`${year}-${String(monthNum).padStart(2, '0')}-15`);
  const periodInfo = await dateCycleService.getPeriodInfo(anchor);
  const startDateStr = extractISTComponents(periodInfo.payrollCycle.startDate).dateStr;
  const endDateStr = extractISTComponents(periodInfo.payrollCycle.endDate).dateStr;
  const startDate = createISTDate(startDateStr);
  const endDate = createISTDate(endDateStr);

  console.log('Employee:', emp.emp_no, emp.employee_name);
  console.log('Period:', startDateStr, '..', endDateStr, '\n');

  const leaves = await Leave.find({
    employeeId: emp._id,
    status: 'approved',
    isActive: true,
    $or: [{ fromDate: { $lte: endDate }, toDate: { $gte: startDate } }],
  })
    .select('fromDate toDate isHalfDay leaveType')
    .sort({ fromDate: 1 })
    .lean();

  console.log('Approved leaves overlapping period:', leaves.length);
  let totalCounted = 0;
  for (let i = 0; i < leaves.length; i++) {
    const leave = leaves[i];
    const fromStr = toNormalizedDateStr(leave.fromDate);
    const toStr = toNormalizedDateStr(leave.toDate);
    const contrib = leave.isHalfDay ? 0.5 : 1;
    const leaveStart = createISTDate(fromStr, '00:00');
    const leaveEnd = createISTDate(toStr, '23:59');

    const daysInPeriod = [];
    let currentDate = new Date(leaveStart);
    while (currentDate <= leaveEnd) {
      const dayStr = toNormalizedDateStr(currentDate);
      if (dayStr >= startDateStr && dayStr <= endDateStr) {
        daysInPeriod.push({ date: dayStr, contrib });
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }
    const leaveTotal = daysInPeriod.length * contrib;
    totalCounted += leaveTotal;
    console.log(`Leave ${i + 1}: ${fromStr} to ${toStr} | isHalfDay: ${leave.isHalfDay} | contrib per day: ${contrib}`);
    console.log('  Days in period:', daysInPeriod.map((d) => d.date).join(', ') || '(none)');
    console.log('  Counted for this leave:', leaveTotal, '\n');
  }
  console.log('Total leave days in period (summary.totalLeaves):', totalCounted);
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
