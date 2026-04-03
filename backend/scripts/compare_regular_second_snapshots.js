/**
 * Compare PayrollPayslipSnapshot regular vs second_salary for a month.
 * Usage: node scripts/compare_regular_second_snapshots.js [YYYY-MM]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const PayrollPayslipSnapshot = require('../payroll/model/PayrollPayslipSnapshot');

const MONTH = process.argv[2] || '2026-03';

const INTERESTING = /arrear|manual|deduct|deduction|settlement|other earning|net|gross/i;

function pickInteresting(row) {
  if (!row || typeof row !== 'object') return {};
  const out = {};
  for (const k of Object.keys(row)) {
    if (INTERESTING.test(k)) out[k] = row[k];
  }
  return out;
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI missing');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected. Month:', MONTH);

  const snaps = await PayrollPayslipSnapshot.find({ month: MONTH })
    .select('employeeId emp_no kind row headers generatedAt')
    .lean();

  console.log('Total snapshots for month:', snaps.length);

  const byEmp = new Map();
  for (const s of snaps) {
    const id = String(s.employeeId);
    if (!byEmp.has(id)) byEmp.set(id, {});
    byEmp.get(id)[s.kind] = s;
  }

  const pairs = [];
  for (const [empId, kinds] of byEmp) {
    if (kinds.regular && kinds.second_salary) {
      pairs.push({ empId, regular: kinds.regular, second: kinds.second_salary });
    }
  }

  console.log('Employees with BOTH regular and second_salary snapshot:', pairs.length);

  if (pairs.length === 0) {
    const regs = snaps.filter((s) => s.kind === 'regular').length;
    const secs = snaps.filter((s) => s.kind === 'second_salary').length;
    console.log('Regular only count:', regs, 'Second only count:', secs);
    await mongoose.disconnect();
    return;
  }

  const sample = pairs.slice(0, 5);
  for (const { empId, regular, second } of sample) {
    console.log('\n========', regular.emp_no || empId, '========');
    const rRow = regular.row || {};
    const sRow = second.row || {};

    const rPick = pickInteresting(rRow);
    const sPick = pickInteresting(sRow);

    console.log('--- Interesting columns (regular) ---');
    console.log(JSON.stringify(rPick, null, 2));
    console.log('--- Interesting columns (second salary) ---');
    console.log(JSON.stringify(sPick, null, 2));

    const allKeys = new Set([...Object.keys(rRow), ...Object.keys(sRow)]);
    const mismatches = [];
    for (const k of allKeys) {
      if (!INTERESTING.test(k)) continue;
      const a = rRow[k];
      const b = sRow[k];
      const na = Number(a);
      const nb = Number(b);
      const same =
        a === b ||
        (!Number.isNaN(na) && !Number.isNaN(nb) && Math.abs(na - nb) < 0.01);
      if (!same) mismatches.push({ header: k, regular: a, second_salary: b });
    }
    console.log('--- Same values for arrears/manual-deduction-like headers? ---');
    if (mismatches.length === 0) {
      console.log('All compared interesting headers match (or only one side has the key).');
    } else {
      console.log('DIFFERENCES:');
      console.log(JSON.stringify(mismatches, null, 2));
    }
  }

  if (pairs.length > 5) {
    console.log('\n(...', pairs.length - 5, 'more employees with both snapshots not printed)');

    let diffCount = 0;
    for (const { regular, second } of pairs) {
      const rRow = regular.row || {};
      const sRow = second.row || {};
      for (const k of Object.keys(rRow)) {
        if (!INTERESTING.test(k)) continue;
        const a = Number(rRow[k]);
        const b = Number(sRow[k]);
        if (Number.isNaN(a) && Number.isNaN(b) && rRow[k] === sRow[k]) continue;
        if (!Number.isNaN(a) && !Number.isNaN(b) && Math.abs(a - b) < 0.01) continue;
        if (rRow[k] === sRow[k]) continue;
        diffCount++;
        break;
      }
    }
    console.log('Employees in pair list with any interesting-header mismatch (quick scan):', diffCount, '/', pairs.length);
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
