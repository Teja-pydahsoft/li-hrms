/**
 * ============================================================
 * DELETE ATTENDANCE DAILY FROM JAN 20 TO TILL DATE
 * ============================================================
 * Removes AttendanceDaily records from 2026-01-20 up to today
 * (inclusive). Run this BEFORE re-syncing biometric logs for
 * that range so dailies are recreated from the sync.
 *
 * Usage (from backend folder):
 *   node scripts/delete_attendance_daily_from_jan20.js
 * ============================================================
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const AttendanceDaily = require('../attendance/model/AttendanceDaily');

// Date range: Jan 20, 2026 — today (YYYY-MM-DD)
const START_DATE = '2026-01-10';
function getTodayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function main() {
    const endDate = getTodayStr();
    console.log('\n🗑️ Delete AttendanceDaily from Jan 20 to till date\n');
    console.log(`   Range: ${START_DATE} to ${endDate} (inclusive)\n`);

    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        const filter = { date: { $gte: START_DATE, $lte: endDate } };
        const count = await AttendanceDaily.countDocuments(filter);
        console.log(`   Found ${count} AttendanceDaily record(s) in range.\n`);

        if (count === 0) {
            console.log('   Nothing to delete.');
            return;
        }

        const result = await AttendanceDaily.deleteMany(filter);
        console.log(`✅ Deleted ${result.deletedCount} AttendanceDaily record(s).\n`);
        console.log('   You can now run the biometric sync script (Jan 20 — till date) to recreate them.');
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected.\n');
    }
}

main();
