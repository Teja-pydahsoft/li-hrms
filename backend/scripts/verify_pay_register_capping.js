const mongoose = require('mongoose');
const summaryCalculationService = require('../attendance/services/summaryCalculationService');
const LeaveRegisterYear = require('../leaves/model/LeaveRegisterYear');
const Employee = require('../employees/model/Employee');
const Leave = require('../leaves/model/Leave');
const AttendanceDaily = require('../attendance/model/AttendanceDaily');
const dateCycleService = require('../leaves/services/dateCycleService');
const { extractISTComponents } = require('../shared/utils/dateUtils');

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function almostEq(a, b) {
  return Math.abs(round2(a) - round2(b)) < 0.001;
}

function buildDateList(startDateStr, count) {
  const out = [];
  const d = new Date(startDateStr);
  for (let i = 0; i < count; i++) {
    out.push(extractISTComponents(d).dateStr);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

async function createLeaveUnit(employee, empNo, dateStr, nature, unit) {
  const isHalfDay = Number(unit) === 0.5;
  await Leave.create({
    employeeId: employee._id,
    emp_no: empNo,
    leaveType: 'CL',
    leaveNature: nature,
    fromDate: new Date(dateStr),
    toDate: new Date(dateStr),
    numberOfDays: isHalfDay ? 0.5 : 1,
    isHalfDay,
    halfDayType: isHalfDay ? 'first_half' : null,
    purpose: 'Capping edge verification',
    contactNumber: '9999999999',
    appliedBy: employee._id,
    status: 'approved',
    isActive: true,
  });
}

async function seedLeavesForScenario(employee, empNo, periodStartStr, paidDays, lopDays) {
  const neededUnits = [];
  let p = round2(paidDays);
  let l = round2(lopDays);
  while (p >= 1) {
    neededUnits.push({ nature: 'paid', unit: 1 });
    p = round2(p - 1);
  }
  if (p === 0.5) neededUnits.push({ nature: 'paid', unit: 0.5 });
  while (l >= 1) {
    neededUnits.push({ nature: 'lop', unit: 1 });
    l = round2(l - 1);
  }
  if (l === 0.5) neededUnits.push({ nature: 'lop', unit: 0.5 });

  const dates = buildDateList(periodStartStr, neededUnits.length + 2);
  for (let i = 0; i < neededUnits.length; i++) {
    await createLeaveUnit(employee, empNo, dates[i], neededUnits[i].nature, neededUnits[i].unit);
  }
}

async function verifyCapping() {
  try {
    console.log('Connecting to DB at:', process.env.MONGODB_URI || 'mongodb://localhost:27017/hrms');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hrms', { serverSelectionTimeoutMS: 5000 });
    console.log('Connected to DB successfully!');

    const empNo = 'TEST001';
    let employee = await Employee.findOne({ emp_no: empNo });
    if (!employee) {
      employee = await Employee.create({
        emp_no: empNo,
        employee_name: 'Test Capping Employee',
        doj: new Date('2024-01-01'),
        is_active: true,
      });
    }

    const periodRefDate = new Date('2026-03-01');
    const periodInfo = await dateCycleService.getPeriodInfo(periodRefDate);
    const financialYear = periodInfo.financialYear.name;
    const cycleMonth = periodInfo.payrollCycle.month;
    const cycleYear = periodInfo.payrollCycle.year;
    const year = cycleYear;
    const month = cycleMonth;
    const periodStart = extractISTComponents(periodInfo.payrollCycle.startDate).dateStr;
    const periodEnd = extractISTComponents(periodInfo.payrollCycle.endDate).dateStr;

    let register = await LeaveRegisterYear.findOne({ employeeId: employee._id, financialYear });
    if (!register) {
      register = await LeaveRegisterYear.create({
        employeeId: employee._id,
        empNo: employee.emp_no,
        employeeName: employee.employee_name,
        financialYear,
        financialYearStart: periodInfo.financialYear.startDate,
        financialYearEnd: periodInfo.financialYear.endDate,
        months: [{
          payrollMonthIndex: 1,
          label: 'Test',
          payrollCycleMonth: cycleMonth,
          payrollCycleYear: cycleYear,
          payPeriodStart: periodInfo.payrollCycle.startDate,
          payPeriodEnd: periodInfo.payrollCycle.endDate,
          clCredits: 0,
          compensatoryOffs: 0,
          elCredits: 0,
          transactions: [],
        }],
      });
    }

    let slotIdx = register.months.findIndex(
      (m) => Number(m.payrollCycleMonth) === Number(cycleMonth) && Number(m.payrollCycleYear) === Number(cycleYear)
    );
    if (slotIdx < 0) {
      register.months.push({
        payrollMonthIndex: (register.months?.length || 0) + 1,
        label: 'Test',
        payrollCycleMonth: cycleMonth,
        payrollCycleYear: cycleYear,
        payPeriodStart: periodInfo.payrollCycle.startDate,
        payPeriodEnd: periodInfo.payrollCycle.endDate,
        clCredits: 0,
        compensatoryOffs: 0,
        elCredits: 0,
        transactions: [],
      });
      slotIdx = register.months.length - 1;
    }

    const scenarios = [
      { name: 'Over-cap paid to LOP', cl: 1, ccl: 1, paid: 3, lop: 0, expPaid: 2, expLop: 1 },
      { name: 'Transfer LOP to paid', cl: 2.5, ccl: 1, paid: 0, lop: 8, expPaid: 3.5, expLop: 4.5 },
      { name: 'Already balanced at cap', cl: 2.5, ccl: 1, paid: 3.5, lop: 4.5, expPaid: 3.5, expLop: 4.5 },
      { name: 'Zero credits all LOP', cl: 0, ccl: 0, paid: 2, lop: 1, expPaid: 0, expLop: 3 },
      { name: 'Cap above total leaves', cl: 4, ccl: 1, paid: 1, lop: 1, expPaid: 2, expLop: 0 },
      { name: 'Half-day precision', cl: 1, ccl: 0.5, paid: 0.5, lop: 2, expPaid: 1.5, expLop: 1 },
    ];

    let allPass = true;
    for (const s of scenarios) {
      register.months[slotIdx].clCredits = s.cl;
      register.months[slotIdx].compensatoryOffs = s.ccl;
      register.months[slotIdx].elCredits = 99;
      await register.save();

      await Leave.deleteMany({
        employeeId: employee._id,
        fromDate: { $gte: new Date(periodStart), $lte: new Date(periodEnd) },
      });
      await AttendanceDaily.deleteMany({ employeeNumber: empNo, date: { $gte: periodStart, $lte: periodEnd } });

      await seedLeavesForScenario(employee, empNo, periodStart, s.paid, s.lop);
      const summary = await summaryCalculationService.calculateMonthlySummary(employee._id, empNo, year, month);

      const gotPaid = round2(summary.totalPaidLeaves);
      const gotLop = round2(summary.totalLopLeaves);
      const pass = almostEq(gotPaid, s.expPaid) && almostEq(gotLop, s.expLop);
      if (!pass) allPass = false;

      console.log(
        `[${pass ? 'PASS' : 'FAIL'}] ${s.name} | cap=${round2(s.cl + s.ccl)} total=${round2(s.paid + s.lop)} | paid ${gotPaid} (exp ${s.expPaid}) | lop ${gotLop} (exp ${s.expLop})`
      );
    }

    if (!allPass) {
      console.log('FAILURE: One or more edge cases failed.');
      process.exit(1);
    }

    console.log('SUCCESS: All edge cases passed.');
    process.exit(0);
  } catch (error) {
    console.error('Verification failed:', error);
    process.exit(1);
  }
}

verifyCapping();
