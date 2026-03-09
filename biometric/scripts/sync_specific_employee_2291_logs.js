require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const axios = require('axios');

/**
 * ============================================================
 * SPECIFIC EMPLOYEE BIOMETRIC LOG RESYNC SCRIPT
 * ============================================================
 * This script sends attendance logs for employee 2291 from 
 * Jan 10, 2026 to March 8, 2026 from the local biometric_logs 
 * database to the main backend HRMS application.
 * ============================================================
 */

// ─── Config ───────────────────────────────────────────────────────────────────
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const SYNC_ENDPOINT = `${BACKEND_URL}/api/internal/attendance/sync`;
const SYSTEM_KEY = process.env.HRMS_MICROSERVICE_SECRET_KEY || "hrms-secret-key-2026-abc123xyz789";
if (!SYSTEM_KEY) {
    console.error('ERROR: HRMS_MICROSERVICE_SECRET_KEY not configured in biometric service');
    process.exit(1);
}
const BATCH_SIZE = 200;
const RETRY_ATTEMPTS = 3;
const DELAY_BETWEEN_BATCHES = 1000;

// ─── Biometric AttendanceLog model ───────────────────────────────────────────
const attendanceLogSchema = new mongoose.Schema({
    employeeId: String,
    timestamp: Date,
    logType: String,
    rawType: Number,
    rawData: Object,
    deviceId: String,
    deviceName: String,
    syncedAt: Date,
}, { timestamps: true });

const AttendanceLog =
    mongoose.models.AttendanceLog ||
    mongoose.model('AttendanceLog', attendanceLogSchema);

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    const mongoURI = 'mongodb+srv://teampydah:TeamPydah@teampydah.y4zj6wh.mongodb.net/biometric_logs';

    console.log('\n🚀 Starting Biometric Log Resync for Employee 2291...\n');
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(mongoURI);
    console.log(`✅ Connected to: ${mongoURI}\n`);

    // ── STEP: Filter by employee and date range ──────────────────────────────
    const START_DATE = new Date('2026-01-10T00:00:00.000Z');
    const END_DATE = new Date('2026-03-09T23:59:59.999Z');
    const TARGET_EMP_ID = "2291";

    const query = {
        employeeId: TARGET_EMP_ID,
        timestamp: { $gte: START_DATE, $lte: END_DATE },
    };

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP: Resend AttendanceLog records to backend');
    console.log(`   Employee : ${TARGET_EMP_ID}`);
    console.log(`   Range    : Jan 10, 2026 — March 08, 2026`);
    console.log(`   Endpoint : ${SYNC_ENDPOINT}`);
    console.log(`   Batch    : ${BATCH_SIZE} logs per request`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const totalLogs = await AttendanceLog.countDocuments(query);
    console.log(`   Total logs matching filter: ${totalLogs}\n`);

    if (totalLogs === 0) {
        console.log('   ℹ️  No logs to send.');
    } else {
        let processed = 0;
        let batchNum = 0;
        let successBatches = 0;
        let failedBatches = 0;
        const totalBatches = Math.ceil(totalLogs / BATCH_SIZE);

        for (let skip = 0; skip < totalLogs; skip += BATCH_SIZE) {
            batchNum++;
            const logs = await AttendanceLog.find(query)
                .sort({ timestamp: 1 })
                .skip(skip)
                .limit(BATCH_SIZE)
                .lean();

            // Build payload matching the format the backend expects
            const payload = logs.map(log => {
                const ts = log.timestamp instanceof Date ? log.timestamp.toISOString() : log.timestamp;
                const timestamp = typeof ts === 'string' && !ts.endsWith('Z') ? `${ts}Z` : ts;

                return {
                    employeeId: log.employeeId,
                    timestamp: timestamp,
                    logType: log.logType,
                    deviceId: log.deviceId || 'UNKNOWN',
                    deviceName: log.deviceName || 'UNKNOWN',
                    rawStatus: log.rawType ?? null,
                };
            });

            let attempt = 0;
            let success = false;

            while (attempt < RETRY_ATTEMPTS && !success) {
                try {
                    const response = await axios.post(SYNC_ENDPOINT, payload, {
                        headers: { 'x-system-key': SYSTEM_KEY },
                        timeout: 180000,
                    });
                    processed += logs.length;
                    successBatches++;
                    success = true;
                    process.stdout.write(
                        `\r   📤 Batch ${batchNum}/${totalBatches} — Sent: ${processed}/${totalLogs} | Backend accepted: ${response.data.processedCount ?? response.data.processed ?? '?'}`
                    );
                } catch (err) {
                    attempt++;
                    const status = err.response ? `HTTP ${err.response.status} - ${JSON.stringify(err.response.data)}` : err.message;
                    if (attempt < RETRY_ATTEMPTS) {
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    } else {
                        failedBatches++;
                        console.error(`\n   ❌ Batch ${batchNum} failed after ${RETRY_ATTEMPTS} attempts: ${status}`);
                    }
                }
            }

            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
        }

        console.log(`\n\n   ✅ Done — ${successBatches} batch(es) succeeded, ${failedBatches} failed.`);
    }

    console.log('\n🏁 Closing connection...');
    await mongoose.disconnect();
    console.log('✅ Disconnected.');
}

main().catch(err => {
    console.error('❌ Script failed:', err.message);
    process.exit(1);
});
