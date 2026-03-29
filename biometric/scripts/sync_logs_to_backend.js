require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const axios = require('axios');

/**
 * ============================================================
 * BIOMETRIC LOG RESYNC SCRIPT
 * ============================================================
 * This script sends ALL attendance logs from the local 
 * biometric_logs database to the main backend HRMS application.
 * 
 * Usage (PowerShell - Windows):
 *   Specific Employee: $env:SYNC_EMP="1832"; $env:SYNC_MONTH="2026-03"; node sync_logs_to_backend.js
 *   All Employees:     $env:SYNC_MONTH="2026-03"; node scripts/sync_logs_to_backend.js
 *   Date Range:        $env:SYNC_START="2026-03-01"; $env:SYNC_END="2026-03-31"; node sync_logs_to_backend.js
 * 
 * Usage (Bash - Linux/macOS):
 *   Specific Employee: SYNC_EMP="1832" SYNC_MONTH="2026-03" node scripts/sync_logs_to_backend.js
 * ============================================================
 */

// ─── Config ───────────────────────────────────────────────────────────────────
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const SYNC_ENDPOINT = `${BACKEND_URL}/api/internal/attendance/sync`;
const SYSTEM_KEY = process.env.HRMS_MICROSERVICE_SECRET_KEY || 'hrms-secret-key-2026-abc123xyz789';
if (!BACKEND_URL) {
    console.error('ERROR: BACKEND_URL not configured in biometric service .env');
    process.exit(1);
}
if (!SYSTEM_KEY) {
    console.error('ERROR: HRMS_MICROSERVICE_SECRET_KEY not configured in biometric service .env');
    process.exit(1);
}
const BATCH_SIZE = 200; // Optimal batch size with delays
const RETRY_ATTEMPTS = 3;
const DELAY_BETWEEN_BATCHES = 1000; // 1s delay to prevent backend overload

function parseMonth(monthStr) {
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(monthStr || '').trim());
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]); // 1-12
    return { year, month };
}

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
    const mongoURI = process.env.BIOMETRIC_MONGODB_URI || process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoURI) {
        throw new Error('Missing BIOMETRIC_MONGODB_URI/MONGODB_URI/MONGO_URI in biometric .env');
    }

    console.log('\n🚀 Starting Biometric Log Resync...\n');
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(mongoURI);
    console.log(`✅ Connected to: ${mongoURI}\n`);

    // ── STEP 2: Resend logs to backend (Filtered by month) ───────────────────
    // ── STEP 2: Configure Filter ───────────────────
    const SYNC_EMP = process.env.SYNC_EMP;
    const SYNC_START = process.env.SYNC_START; // Format: YYYY-MM-DD
    const SYNC_END = process.env.SYNC_END;     // Format: YYYY-MM-DD
    const SYNC_MONTH = process.env.SYNC_MONTH || '2026-03';

    let START_DATE, END_DATE;

    if (SYNC_START && SYNC_END) {
        START_DATE = new Date(`${SYNC_START}T00:00:00.000Z`);
        END_DATE = new Date(`${SYNC_END}T23:59:59.999Z`);
    } else {
        // Fallback to month-based logic
        const monthCfg = parseMonth(SYNC_MONTH);
        if (!monthCfg) {
            throw new Error('Invalid SYNC_MONTH. Use YYYY-MM (example: 2026-03)');
        }
        const { year, month } = monthCfg;
        const startDateStr = `${year}-${String(month).padStart(2, '0')}-01T00:00:00.000Z`;
        const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const endDateStr = `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}T23:59:59.999Z`;
        START_DATE = new Date(startDateStr);
        END_DATE = new Date(endDateStr);
    }

    const query = {
        timestamp: { $gte: START_DATE, $lte: END_DATE },
    };

    if (SYNC_EMP) {
        query.employeeId = SYNC_EMP;
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP: Resend AttendanceLog records to backend');
    console.log(`   Filter   : ${START_DATE.toISOString().slice(0, 10)} — ${END_DATE.toISOString().slice(0, 10)}`);
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
                // Ensure it ends with Z
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
                        timeout: 180000, // 3 minutes timeout
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
                        // console.log(`\n   ⚠️  Batch ${batchNum} retry ${attempt}/${RETRY_ATTEMPTS} after error: ${status}`);
                        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s before retry
                    } else {
                        failedBatches++;
                        console.error(`\n   ❌ Batch ${batchNum} failed after ${RETRY_ATTEMPTS} attempts: ${status}`);
                    }
                }
            }

            // Wait between batches to prevent backend exhaustion
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
