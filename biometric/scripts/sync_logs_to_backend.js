require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const axios = require('axios');

/**
 * ============================================================
 * BIOMETRIC LOG RESYNC SCRIPT
 * ============================================================
 * This script sends attendance logs from the local biometric_logs database to
 * the main backend HRMS application, limited to one division (default: PYDAHSOFT PVT LTD).
 * 
 * Scope: Only attendance for employees in division "Pydahsoft Pvt Ltd" (override with SYNC_DIVISION_NAME).
 * Requires HRMS_MONGODB_URI in .env to resolve division → departments → employee numbers.
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

function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Minimal HRMS models (read-only) — same collections as backend. */
const hrmsDivisionSchema = new mongoose.Schema({
    name: String,
    code: String,
    departments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
}, { collection: 'divisions', strict: false });

const hrmsDepartmentSchema = new mongoose.Schema({
    name: String,
    code: String,
    divisions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Division' }],
}, { collection: 'departments', strict: false });

/** Uses division-specific departments on Division + Department.divisions for this division. */
async function loadDivisionScope(hrmsConn, divisionName) {
    const Division = hrmsConn.models.HrmsDivision || hrmsConn.model('HrmsDivision', hrmsDivisionSchema);
    const Department = hrmsConn.models.HrmsDepartment || hrmsConn.model('HrmsDepartment', hrmsDepartmentSchema);
    const Employee = hrmsConn.models.HrmsEmployee || hrmsConn.model(
        'HrmsEmployee',
        new mongoose.Schema({
            emp_no: String,
            division_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Division' },
            department_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
            is_active: { type: Boolean, default: true },
        }, { collection: 'employees', strict: false }),
    );

    const trimmed = String(divisionName || '').trim();
    const division = await Division.findOne({
        name: { $regex: new RegExp(`^${escapeRegex(trimmed)}$`, 'i') },
    }).lean();

    if (!division) {
        throw new Error(
            `Division not found in HRMS: "${trimmed}". Check name or HRMS_MONGODB_URI.`,
        );
    }

    const divId = division._id;
    const deptIdsFromDivision = Array.isArray(division.departments) ? division.departments : [];
    const deptDocsLinked = await Department.find({ divisions: divId }).select('_id name').lean();

    const deptIdSet = new Set(deptIdsFromDivision.map((id) => id.toString()));
    for (const d of deptDocsLinked) {
        deptIdSet.add(d._id.toString());
    }

    const departmentDetails = deptIdSet.size === 0
        ? []
        : await Department.find({ _id: { $in: [...deptIdSet].map((id) => new mongoose.Types.ObjectId(id)) } })
            .select('name code')
            .sort({ name: 1 })
            .lean();

    const employees = await Employee.find({
        division_id: divId,
        is_active: { $ne: false },
    })
        .select('emp_no')
        .lean();

    const employeeIds = [...new Set(employees.map((e) => String(e.emp_no || '').trim()).filter(Boolean))];

    return {
        division: { _id: divId, name: division.name || trimmed, code: division.code || '' },
        departments: departmentDetails.map((d) => ({ _id: d._id, name: d.name || '', code: d.code || '' })),
        employeeIds,
    };
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

    let hrmsConn = null;

    try {
        console.log('\n🚀 Starting Biometric Log Resync...\n');
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(mongoURI);
        console.log(`✅ Connected to: ${mongoURI}\n`);

        const hrmsMongoUri = process.env.HRMS_MONGODB_URI;
        if (!hrmsMongoUri) {
            throw new Error('Missing HRMS_MONGODB_URI in biometric .env (needed to scope sync by division).');
        }

        hrmsConn = mongoose.createConnection(hrmsMongoUri, { maxPoolSize: 5 });
        await hrmsConn.asPromise();
        console.log(`✅ HRMS DB connected: ${hrmsMongoUri}\n`);

        const SYNC_DIVISION_NAME = process.env.SYNC_DIVISION_NAME || 'PYDAHSOFT PVT LTD';
        const scope = await loadDivisionScope(hrmsConn, SYNC_DIVISION_NAME);

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`Division (sync scope): ${scope.division.name} [${scope.division.code || 'no code'}]`);
        console.log(`Departments in this division (${scope.departments.length}):`);
        for (const d of scope.departments) {
            console.log(`   • ${d.name}${d.code ? ` (${d.code})` : ''}`);
        }
        console.log(`Active employees in division: ${scope.employeeIds.length}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        if (scope.employeeIds.length === 0) {
            console.warn('⚠️  No active employees found for this division — no logs will match.');
        }

        // ── STEP 2: Resend logs to backend (Filtered by month) ───────────────────
        // ── Configure Filter ───────────────────
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
            const want = String(SYNC_EMP).trim();
            const match = scope.employeeIds.find((id) => id.toUpperCase() === want.toUpperCase());
            if (!match) {
                throw new Error(
                    `SYNC_EMP "${SYNC_EMP}" is not an active employee in division "${scope.division.name}".`,
                );
            }
            query.employeeId = match;
        } else {
            query.employeeId = { $in: scope.employeeIds };
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
    } finally {
        console.log('\n🏁 Closing connection...');
        if (hrmsConn && hrmsConn.readyState !== 0) {
            await hrmsConn.close().catch(() => {});
        }
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect().catch(() => {});
        }
        console.log('✅ Disconnected.');
    }
}

main().catch(err => {
    console.error('❌ Script failed:', err.message);
    process.exit(1);
});
