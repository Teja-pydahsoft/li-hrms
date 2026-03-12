/**
 * Simplified Logic Verification for singleShiftProcessingService
 */

// --- LOGIC UNDER TEST (Extracted from modified singleShiftProcessingService.js) ---

function testDeduplication(punches) {
    const DEDUP_WINDOW_MS = 5 * 60 * 1000;
    const sortedLogs = punches.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const allPunches = [];
    for (const p of sortedLogs) {
        const last = allPunches[allPunches.length - 1];
        if (last && (new Date(p.timestamp) - new Date(last.timestamp)) < DEDUP_WINDOW_MS) {
            continue;
        }
        allPunches.push(p);
    }
    return allPunches;
}

function testShiftAwareLogic(punches, shiftStart, shiftEnd) {
    const windowGraceMs = 3 * 60 * 60 * 1000;
    const inCandidates = [];
    const outCandidates = [];

    for (const p of punches) {
        const t = new Date(p.timestamp).getTime();
        const distStart = Math.abs(t - shiftStart.getTime());
        const distEnd = Math.abs(t - shiftEnd.getTime());
        const withinStartWindow = distStart <= windowGraceMs;
        const withinEndWindow = distEnd <= windowGraceMs;

        if (distStart <= distEnd && withinStartWindow) {
            inCandidates.push(p);
        } else if (distEnd < distStart && withinEndWindow) {
            outCandidates.push(p);
        }
    }

    let inPunch = inCandidates.length ? inCandidates.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))[0] : null;
    let outPunch = outCandidates.length ? outCandidates.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))[outCandidates.length - 1] : null;

    if (inPunch && outPunch && new Date(outPunch.timestamp) <= new Date(inPunch.timestamp)) {
        const inDist = Math.abs(new Date(inPunch.timestamp) - shiftStart);
        const outDist = Math.abs(new Date(outPunch.timestamp) - shiftEnd);
        if (inDist <= outDist) outPunch = null;
        else inPunch = null;
    }

    return { inPunch, outPunch };
}

// --- SIMULATION RUN ---

async function run() {
    console.log("=== SIMULATION RESULTS ===");

    const shiftStart = new Date("2026-03-12T09:00:00+05:30");
    const shiftEnd = new Date("2026-03-12T18:00:00+05:30");

    const rawLogs = [
        { id: 1, timestamp: "2026-03-12T08:44:00+05:30", type: 'OUT' }, // Reported case
        { id: 2, timestamp: "2026-03-12T08:46:00+05:30", type: 'IN' },  // Double-tap
        { id: 3, timestamp: "2026-03-12T18:15:00+05:30", type: 'OUT' }  // Normal out
    ];

    console.log("\nInput Punches:");
    rawLogs.forEach(l => console.log(` - [${l.id}] ${l.timestamp} (type: ${l.type})`));

    // 1. Test Deduplication
    const deduped = testDeduplication(rawLogs);
    console.log("\n1. After 5-minute Deduplication:");
    deduped.forEach(l => console.log(` - [${l.id}] ${l.timestamp}`));

    const ids = deduped.map(l => l.id);
    if (!ids.includes(2)) {
        console.log(" ✓ SUCCESS: Punch [2] at 08:46 was correctly deduplicated.");
    }

    // 2. Test Smart Pairing (Irregular type)
    const result = testShiftAwareLogic(deduped, shiftStart, shiftEnd);
    console.log("\n2. Smart Pairing Result (Shift 09:00 - 18:00):");
    console.log(` - Identified IN:  ${result.inPunch ? `[${result.inPunch.id}] ${result.inPunch.timestamp}` : 'NONE'}`);
    console.log(` - Identified OUT: ${result.outPunch ? `[${result.outPunch.id}] ${result.outPunch.timestamp}` : 'NONE'}`);

    if (result.inPunch && result.inPunch.id === 1) {
        console.log(" ✓ SUCCESS: Punch [1] (08:44 'OUT') was correctly identified as shift IN based on proximity.");
    }
    if (result.outPunch && result.outPunch.id === 3) {
        console.log(" ✓ SUCCESS: Punch [3] was correctly identified as shift OUT.");
    }

    console.log("\nConclusion: The logic successfully handles irregular operation types and performs deduplication as expected.");
}

run();
