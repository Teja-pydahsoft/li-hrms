/**
 * Reproduction Script for singleShiftProcessingService issue
 */
const { processSingleShiftAttendance } = require('./backend/attendance/services/singleShiftProcessingService');
const mongoose = require('mongoose');

// Mock Models
const AttendanceDaily = {
    findOne: async () => null,
    findOneAndUpdate: async () => ({}),
    save: async function () { return this; }
};

// Mock dependencies
// We'll need to override the requires inside the service or use a different approach.
// Since I can't easily mock 'require' in this environment without a library, 
// I'll look at the service and see if I can satisfy its requirements by mocking global or passing objects.

// Actually, it's better to just run a script that connects to the local DB if available, 
// OR I can use a more surgical approach by unit testing the specific functions if they were exported.
// But only `processSingleShiftAttendance` is exported.

// Let's try to mock the DB connection and use actual models if possible, 
// but that might be heavy.

// Let's look at getShiftAwareInOutPair and processSingleShiftAttendance again.
// They are in the same file.

async function testScenario() {
    console.log("--- Testing Single Punch with 'OUT' type at shift start ---");

    // Employee: 101
    // Shift: 09:00 - 18:00
    // Punch: 08:44, type: 'OUT'

    // We need to mock getShiftsForEmployee and other deps.
    // This is getting complex for a simple script.

    // Instead, I will manually inspect the code logic which is clearly flawed for this case.

    /*
    165:     if (distStart <= distEnd && withinStartWindow) {
    166:       inCandidates.push(p);
    167:     } else if (distEnd < distStart && withinEndWindow) {
    168:       outCandidates.push(p);
    169:     }
    ...
    172:   if (inCandidates.length === 0 || outCandidates.length === 0) return null;
    */

    // If there is only one punch at 8:44, inCandidates will have 1, outCandidates will have 0.
    // Line 172 returns null.

    /*
    234:     if (!strict) {
    235:       const pair = await getShiftAwareInOutPair(employeeNumber, date, allPunches, processingMode);
    236:       if (pair) {
    237:         firstInTime = pair.firstInTime;
    ...
    242:       }
    243:     }
    244: 
    245:     // Fallback (strict ON or no shift-aware pair): typed IN/OUT only — first IN, last OUT; overnight next-day OUT.
    246:     if (!firstInTime || !lastOutTime) {
    247:       const ins = targetDatePunches.filter(isIN);
    248:       const outs = targetDatePunches.filter(isOUT);
    249:       firstInTime = ins.length ? new Date(ins[0].timestamp) : null;
    ...
    251:       outPunchRecord = outs.length ? outs[outs.length - 1] : null;
    */

    // fallback assumes if firstInTime OR lastOutTime is missing, it should recalculate both based on strict types.
    // This is the BUG. If firstInTime was found but lastOutTime wasn't, firstInTime is wiped by line 249 if no typed IN exists.
}

// I'll proceed with the fix directly since the logic issue is very obvious from the code review.
// But first I'll add the 5-minute dedup which is also missing.
