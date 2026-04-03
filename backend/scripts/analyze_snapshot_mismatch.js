require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const PayrollPayslipSnapshot = require('../payroll/model/PayrollPayslipSnapshot');

const MONTH = process.argv[2] || '2026-03';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const snaps = await PayrollPayslipSnapshot.find({ month: MONTH }).select('employeeId emp_no kind row').lean();
  const byEmp = new Map();
  for (const s of snaps) {
    const id = String(s.employeeId);
    if (!byEmp.has(id)) byEmp.set(id, {});
    byEmp.get(id)[s.kind] = s;
  }

  let arDiff = 0;
  const arDiffExamples = [];
  const mdMismatches = [];

  for (const [, k] of byEmp) {
    if (!k.regular || !k.second_salary) continue;
    const ra = k.regular.row || {};
    const sa = k.second_salary.row || {};
    const a1 = ra.Arrears;
    const a2 = sa.Arrears;
    if (a1 != null && a2 != null && Number(a1) !== Number(a2)) {
      arDiff++;
      if (arDiffExamples.length < 8) {
        arDiffExamples.push({ emp_no: k.regular.emp_no, regularArrears: a1, secondArrears: a2 });
      }
    }

    const keys = new Set([...Object.keys(ra), ...Object.keys(sa)]);
    for (const key of keys) {
      if (!/manual|Manual|arrear|Arrear|deduct/i.test(key)) continue;
      const v1 = ra[key];
      const v2 = sa[key];
      const n1 = Number(v1);
      const n2 = Number(v2);
      const same =
        v1 === v2 ||
        (!Number.isNaN(n1) && !Number.isNaN(n2) && Math.abs(n1 - n2) < 0.005);
      if (!same) {
        mdMismatches.push({
          emp_no: k.regular.emp_no,
          header: key,
          regular: v1,
          second_salary: v2,
        });
      }
    }
  }

  console.log('Month:', MONTH);
  console.log('Pairs with different numeric Arrears (both sides present):', arDiff);
  console.log('Examples:', JSON.stringify(arDiffExamples, null, 2));

  const byHeader = {};
  for (const m of mdMismatches) {
    byHeader[m.header] = (byHeader[m.header] || 0) + 1;
  }
  console.log('Mismatch counts by header (arrear/manual/deduct*):', byHeader);
  console.log('First 12 detailed mismatches:', JSON.stringify(mdMismatches.slice(0, 12), null, 2));

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
