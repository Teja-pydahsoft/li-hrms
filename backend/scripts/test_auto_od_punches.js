/**
 * test_auto_od_punches.js
 * --------------------------------------------------------
 * Sends simulated biometric CHECK-IN / CHECK-OUT logs to the
 * HRMS internal sync endpoint to verify Auto-OD creation.
 *
 * Test Scenarios for emp_no: 2146 (March 2026, current month)
 *   - March 15: IN at ~9:05 AM (IST), OUT at ~6:00 PM (IST) — should create Auto-OD  
 *   - March 22: IN at ~9:05 AM (IST), OUT at ~10:05 AM (IST)  — 1hr only, may NOT create if < threshold
 *
 * NOTE: Timestamps sent to the server must be in UTC.
 *       IST = UTC+5:30, so:
 *           09:05 IST = 03:35 UTC
 *           18:00 IST = 12:30 UTC
 *           10:05 IST = 04:35 UTC
 */

const http = require('http');

// ─── CONFIG ────────────────────────────────────────────────────────────────
const HOST = 'localhost';
const PORT = 5000; // Your backend port
const SYSTEM_KEY = 'hrms-secret-key-2024-abc123xyz789'; // From .env
const EMPLOYEE_ID = '2146'; // Emp_no
const ENDPOINT = '/api/internal/attendance/sync';
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build a UTC ISO string for a given local IST date-time
 * e.g. toUTC(2026, 3, 15, 9, 5) → 2026-03-15T03:35:00.000Z
 */
function toUTC(year, month, day, hourIST, minIST) {
  // IST = UTC+5:30, so subtract 5h 30m to get UTC
  const totalMinIST = hourIST * 60 + minIST;
  const totalMinUTC = totalMinIST - 5 * 60 - 30;
  const utcDay = day + (totalMinUTC < 0 ? -1 : 0);
  const adjustedMin = ((totalMinUTC % 1440) + 1440) % 1440;
  const utcHour = Math.floor(adjustedMin / 60);
  const utcMin = adjustedMin % 60;

  const d = new Date(Date.UTC(year, month - 1, utcDay, utcHour, utcMin, 0));
  return d.toISOString();
}

const SCENARIOS = [
  {
    label: '🗓️  Scenario 1 — March 15 (Long Shift, should create Auto-OD)',
    logs: [
      {
        employeeId: EMPLOYEE_ID,
        timestamp: toUTC(2026, 3, 15, 9, 5), // 9:05 AM IST → CHECK-IN
        logType: 'CHECK-IN',
        deviceId: 'DEVICE-A',
        deviceName: 'Gate A Reader',
      },
      {
        employeeId: EMPLOYEE_ID,
        timestamp: toUTC(2026, 3, 15, 18, 0), // 6:00 PM IST → CHECK-OUT
        logType: 'CHECK-OUT',
        deviceId: 'DEVICE-A',
        deviceName: 'Gate A Reader',
      },
    ],
  },
  {
    label: '🗓️  Scenario 2 — March 22 (Short Shift ~1hr, limited OD)',
    logs: [
      {
        employeeId: EMPLOYEE_ID,
        timestamp: toUTC(2026, 3, 22, 9, 5), // 9:05 AM IST → CHECK-IN
        logType: 'CHECK-IN',
        deviceId: 'DEVICE-B',
        deviceName: 'Back Door Reader',
      },
      {
        employeeId: EMPLOYEE_ID,
        timestamp: toUTC(2026, 3, 22, 10, 5), // 10:05 AM IST → CHECK-OUT
        logType: 'CHECK-OUT',
        deviceId: 'DEVICE-B',
        deviceName: 'Back Door Reader',
      },
    ],
  },
];

function sendLogs(scenario) {
  return new Promise((resolve) => {
    const body = JSON.stringify(scenario.logs);
    const options = {
      hostname: HOST,
      port: PORT,
      path: ENDPOINT,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-system-key': SYSTEM_KEY,
      },
    };

    console.log(`\n${'─'.repeat(70)}`);
    console.log(`  ${scenario.label}`);
    console.log(`${'─'.repeat(70)}`);
    scenario.logs.forEach(l => {
      const istTime = new Date(l.timestamp);
      istTime.setMinutes(istTime.getMinutes() + 330); // +5:30 to display IST
      console.log(`  → [${l.logType.padEnd(10)}] Emp: ${l.employeeId} | IST: ${istTime.toUTCString().replace('GMT', 'IST')} | UTC: ${l.timestamp}`);
    });
    console.log();

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        if (res.statusCode === 200 || res.statusCode === 201) {
          console.log('  ✅ Response Status: SUCCESS', res.statusCode);
        } else {
          console.log(`  ❌ Response Status: FAILED (HTTP ${res.statusCode})`);
        }
        console.log('  Response Body:', JSON.stringify(parsed, null, 2).split('\n').join('\n  '));
        resolve();
      });
    });

    req.on('error', (e) => {
      console.error(`  ❌ Request failed: ${e.message}`);
      resolve();
    });

    req.write(body);
    req.end();
  });
}

async function runTests() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║     AUTO-OD BIOMETRIC PUNCH SIMULATION — Employee 2146         ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`  Endpoint : POST http://${HOST}:${PORT}${ENDPOINT}`);
  console.log(`  Auth Key : ${SYSTEM_KEY}`);
  console.log(`  Employee : ${EMPLOYEE_ID}`);
  console.log();
  console.log('  After running this script:');
  console.log('  1. Check backend console for AttendanceDaily records created/updated');
  console.log('  2. Check backend console for Auto-OD creation logs ([AutoOD] ...)');
  console.log('  3. Verify in the UI → Leaves → OD Tab for employee 2146');
  console.log();

  for (const scenario of SCENARIOS) {
    await sendLogs(scenario);
    // Wait 2s between scenarios to let processing complete
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log('  All scenarios sent. Now check:');
  console.log('  • Backend terminal for [AutoOD] logs and AttendanceDaily updates');
  console.log('  • The OD list in the web UI for pending auto-ODs for emp 2146');
  console.log(`${'═'.repeat(70)}\n`);
}

runTests();
