require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const PayrollRecord = require('../payroll/model/PayrollRecord');
const SecondSalaryRecord = require('../payroll/model/SecondSalaryRecord');

const MONTH = process.argv[2] || '2026-03';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const pr = await PayrollRecord.find({ month: MONTH })
    .select('employeeId emp_no arrearsAmount manualDeductionsAmount')
    .lean();
  const byEmp = new Map(pr.map((r) => [String(r.employeeId), r]));

  const ss = await SecondSalaryRecord.find({ month: MONTH })
    .select('employeeId emp_no arrearsAmount')
    .lean();

  let pairs = 0;
  let mismatch = 0;
  const examples = [];

  for (const s of ss) {
    const pid = String(s.employeeId);
    const p = byEmp.get(pid);
    if (!p) continue;
    pairs++;
    const a = Number(p.arrearsAmount) || 0;
    const b = Number(s.arrearsAmount) || 0;
    if (Math.abs(a - b) > 0.01) {
      mismatch++;
      if (examples.length < 15) {
        examples.push({
          emp_no: p.emp_no || s.emp_no,
          payrollRecordArrears: a,
          secondSalaryRecordArrears: b,
          payrollManualDeductionsAmount: p.manualDeductionsAmount,
        });
      }
    }
  }

  console.log('Month', MONTH);
  console.log('PayrollRecord count:', pr.length);
  console.log('SecondSalaryRecord count:', ss.length);
  console.log('Pairs (same employeeId in both):', pairs);
  console.log('Pairs where arrearsAmount differs:', mismatch);
  console.log('Examples:', JSON.stringify(examples, null, 2));

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
