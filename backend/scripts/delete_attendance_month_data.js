#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const AttendanceRawLog = require('../attendance/model/AttendanceRawLog');
const AttendanceDaily = require('../attendance/model/AttendanceDaily');
const MonthlyAttendanceSummary = require('../attendance/model/MonthlyAttendanceSummary');

function parseArgs(argv) {
  const out = {
    month: '',
    apply: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--month' && argv[i + 1]) out.month = argv[i + 1];
    if (a === '--apply') out.apply = true;
  }
  return out;
}

function assertMonth(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('Invalid --month format. Use YYYY-MM (example: 2026-03)');
  }
}

function getMonthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const startStr = `${y}-${String(m).padStart(2, '0')}-01`;
  const endDay = new Date(y, m, 0).getDate();
  const endStr = `${y}-${String(m).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
  const startDate = new Date(`${startStr}T00:00:00.000Z`);
  const endDate = new Date(`${endStr}T23:59:59.999Z`);
  return { startStr, endStr, startDate, endDate };
}

async function run() {
  const { month, apply } = parseArgs(process.argv.slice(2));
  if (!month) {
    console.error('Usage: node scripts/delete_attendance_month_data.js --month YYYY-MM [--apply]');
    process.exit(1);
  }
  assertMonth(month);

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('Missing MONGODB_URI/MONGO_URI in environment');
    process.exit(1);
  }

  const { startStr, endStr, startDate, endDate } = getMonthBounds(month);

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');
  console.log(`Target month: ${month} (${startStr} to ${endStr})`);
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);

  try {
    const rawFilter = {
      $or: [
        { date: { $gte: startStr, $lte: endStr } },
        { timestamp: { $gte: startDate, $lte: endDate } },
      ],
    };
    const dailyFilter = { date: { $gte: startStr, $lte: endStr } };
    const summaryFilter = { month };

    const [rawCount, dailyCount, summaryCount] = await Promise.all([
      AttendanceRawLog.countDocuments(rawFilter),
      AttendanceDaily.countDocuments(dailyFilter),
      MonthlyAttendanceSummary.countDocuments(summaryFilter),
    ]);

    console.log('\nRecords matched:');
    console.log(`- AttendanceRawLog: ${rawCount}`);
    console.log(`- AttendanceDaily: ${dailyCount}`);
    console.log(`- MonthlyAttendanceSummary: ${summaryCount}`);

    if (!apply) {
      console.log('\nDry run only. Re-run with --apply to delete.');
      return;
    }

    const [rawRes, dailyRes, summaryRes] = await Promise.all([
      AttendanceRawLog.deleteMany(rawFilter),
      AttendanceDaily.deleteMany(dailyFilter),
      MonthlyAttendanceSummary.deleteMany(summaryFilter),
    ]);

    console.log('\nDeleted:');
    console.log(`- AttendanceRawLog: ${rawRes.deletedCount || 0}`);
    console.log(`- AttendanceDaily: ${dailyRes.deletedCount || 0}`);
    console.log(`- MonthlyAttendanceSummary: ${summaryRes.deletedCount || 0}`);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected');
  }
}

run().catch((err) => {
  console.error('Failed:', err.message || err);
  process.exit(1);
});

