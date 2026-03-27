#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const Employee = require('../employees/model/Employee');
const EmployeeGroup = require('../employees/model/EmployeeGroup');
const Settings = require('../settings/model/Settings');

function parseArgs(argv) {
  const out = {
    file: '',
    apply: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--file' && argv[i + 1]) out.file = argv[i + 1];
    if (a === '--apply') out.apply = true;
  }
  return out;
}

function parseCsvLine(line) {
  const cols = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cols.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur.trim());
  return cols;
}

function readCsvRows(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error('CSV must contain header + at least 1 row');
  }

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
  const idxEmpNo = header.findIndex((h) => ['emp_no', 'employee no', 'employee_no', 'emp no'].includes(h));
  const idxGroupName = header.findIndex((h) => ['group_name', 'group', 'employee_group', 'employee group'].includes(h));
  const idxGroupCode = header.findIndex((h) => ['group_code', 'group code', 'employee_group_code'].includes(h));

  if (idxEmpNo < 0) {
    throw new Error('CSV header must include emp_no');
  }
  if (idxGroupName < 0 && idxGroupCode < 0) {
    throw new Error('CSV header must include group_name or group_code');
  }

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const empNo = String(cols[idxEmpNo] || '').trim().toUpperCase();
    const groupName = idxGroupName >= 0 ? String(cols[idxGroupName] || '').trim() : '';
    const groupCode = idxGroupCode >= 0 ? String(cols[idxGroupCode] || '').trim().toUpperCase() : '';

    if (!empNo) continue;
    if (!groupName && !groupCode) continue;

    rows.push({ empNo, groupName, groupCode, lineNo: i + 1 });
  }
  return rows;
}

async function isGroupingEnabled() {
  const doc = await Settings.findOne({ key: 'custom_employee_grouping_enabled' }).lean();
  return doc?.value === true || doc?.value === 'true';
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error('Usage: node backend/scripts/update_employee_groups_from_csv.js --file <path-to-csv> [--apply]');
    process.exit(1);
  }

  const absFile = path.isAbsolute(args.file) ? args.file : path.resolve(process.cwd(), args.file);
  if (!fs.existsSync(absFile)) {
    console.error(`CSV not found: ${absFile}`);
    process.exit(1);
  }

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('Missing MONGODB_URI/MONGO_URI in environment');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');

  try {
    const groupingEnabled = await isGroupingEnabled();
    if (!groupingEnabled) {
      throw new Error('custom_employee_grouping_enabled is OFF. Enable it before running this update.');
    }

    const groups = await EmployeeGroup.find({ isActive: true }).select('_id name code').lean();
    const byName = new Map();
    const byCode = new Map();
    groups.forEach((g) => {
      byName.set(String(g.name || '').trim().toLowerCase(), g);
      byCode.set(String(g.code || '').trim().toUpperCase(), g);
    });

    const rows = readCsvRows(absFile);
    console.log(`Rows parsed: ${rows.length}`);

    let updated = 0;
    let unchanged = 0;
    let missingEmployee = 0;
    let missingGroup = 0;
    const errors = [];

    for (const r of rows) {
      const emp = await Employee.findOne({ emp_no: r.empNo }).select('_id emp_no employee_name employee_group_id').lean();
      if (!emp) {
        missingEmployee += 1;
        errors.push(`L${r.lineNo}: employee not found for emp_no=${r.empNo}`);
        continue;
      }

      const resolvedGroup = r.groupCode
        ? byCode.get(r.groupCode)
        : byName.get(String(r.groupName || '').toLowerCase());

      if (!resolvedGroup) {
        missingGroup += 1;
        errors.push(
          `L${r.lineNo}: group not found for emp_no=${r.empNo} (${r.groupCode ? `code=${r.groupCode}` : `name=${r.groupName}`})`
        );
        continue;
      }

      const current = String(emp.employee_group_id || '');
      const next = String(resolvedGroup._id);
      if (current === next) {
        unchanged += 1;
        continue;
      }

      if (args.apply) {
        await Employee.updateOne(
          { _id: emp._id },
          { $set: { employee_group_id: resolvedGroup._id } }
        );
      }

      updated += 1;
      console.log(
        `${args.apply ? 'UPDATED' : 'DRY-RUN'} | ${emp.emp_no} | ${emp.employee_name || '-'} -> ${resolvedGroup.name} (${resolvedGroup.code || '-'})`
      );
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY-RUN'}`);
    console.log(`Updated (or would update): ${updated}`);
    console.log(`Unchanged: ${unchanged}`);
    console.log(`Missing employee: ${missingEmployee}`);
    console.log(`Missing group: ${missingGroup}`);

    if (errors.length) {
      console.log('\n=== ISSUES ===');
      errors.slice(0, 200).forEach((e) => console.log(e));
      if (errors.length > 200) console.log(`...and ${errors.length - 200} more`);
    }
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected');
  }
}

run().catch((err) => {
  console.error('Failed:', err.message || err);
  process.exit(1);
});

