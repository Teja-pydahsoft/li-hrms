/**
 * Recalculate Attendance Script
 * 
 * Usage: node recalculate_attendance.js [employeeNumber] [date]
 * Example: node recalculate_attendance.js "EMP123" "2026-03-04"
 */

require('dotenv').config();
const mongoose = require('mongoose');
const AttendanceSettings = require('./attendance/model/AttendanceSettings');
const singleShiftService = require('./attendance/services/singleShiftProcessingService');
const multiShiftService = require('./attendance/services/multiShiftProcessingService');
const summaryCalculationService = require('./attendance/services/summaryCalculationService');

async function run() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const filteredArgs = args.filter(a => a !== '--dry-run');
  
  const empNo = filteredArgs[0];
  const dateStr = filteredArgs[1];

  if (!empNo || !dateStr) {
    console.log('Error: Missing arguments.');
    console.log('Usage: node recalculate_attendance.js [employeeNumber] [YYYY-MM or YYYY-MM-DD] [--dry-run]');
    process.exit(1);
  }

  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/li-hrms';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    const AttendanceDaily = require('./attendance/model/AttendanceDaily');
    const settings = await AttendanceSettings.getSettings();
    const mode = settings.processingMode?.mode || 'multi_shift';

    // Determine target dates
    let dates = [];
    if (dateStr.length === 7) { // YYYY-MM
      const [year, month] = dateStr.split('-').map(Number);
      const daysInMonth = new Date(year, month, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        dates.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }
      console.log(`Targeting entire month: ${dateStr} (${dates.length} days)`);
    } else {
      dates = [dateStr];
    }

    console.log(`\n--- ${dryRun ? 'DRY RUN' : 'EXECUTION'} ---`);
    console.log(`Target: ${empNo} | Mode: ${mode}`);

    for (const d of dates) {
      console.log(`\n>> Processing ${d}...`);
      if (dryRun) {
        const record = await AttendanceDaily.findOne({ employeeNumber: empNo.toUpperCase(), date: d }).populate('shifts.shiftId');
        if (!record) {
          console.log(`   No record found for ${d}. Skipping.`);
          continue;
        }

        const OD = mongoose.model('OD');
        const approvedOD = await OD.findOne({
          employeeId: record.employeeId,
          status: 'approved',
          fromDate: { $lte: new Date(d + 'T23:59:59.999Z') },
          toDate: { $gte: new Date(d + 'T00:00:00.000Z') },
          isActive: true
        }).lean();

        if (approvedOD) {
          record.odInfo = approvedOD;
          record.odDetails = approvedOD;
        }

        const punchOnlyWorked = record.shifts.reduce((acc, s) => acc + (Number(s.punchHours) || 0), 0);
        const totalExpected = record.shifts.reduce((acc, s) => acc + (Number(s.expectedHours) || (s.shiftId?.duration) || 8), 0);
        const punchRatio = totalExpected > 0 ? punchOnlyWorked / totalExpected : 0;
        
        // Simulation of new logic
        const hasOD = !!approvedOD;
        let simulatedPayable = record.payableShifts;
        let simulatedStatus = record.status;
        let odCreditAdded = false;

        // OD Credit simulation (Threshold 0.95)
        if (hasOD && punchRatio < 0.95) {
          odCreditAdded = true;
          // Simplified simulation: if work was 0.5, adding 0.5 makes 1.0
          if (simulatedPayable < 0.95) simulatedPayable += 0.5;
        }

        // Status simulation (Threshold 0.95)
        if (simulatedPayable >= 0.95 && punchRatio >= 0.95) {
          simulatedStatus = 'PRESENT';
        } else if (simulatedPayable >= 0.45) {
          simulatedStatus = 'HALF_DAY';
        } else {
          simulatedStatus = punchRatio > 0 ? 'PARTIAL' : 'ABSENT';
        }

        console.log(`   Backend: Status ${record.status} -> ${simulatedStatus} | Payable ${record.payableShifts} -> ${simulatedPayable}`);

        // Penalty Waiving Check (simulated)
        let li = record.totalLateInMinutes || 0;
        let eo = record.totalEarlyOutMinutes || 0;
        if (approvedOD) {
          if (approvedOD.halfDayType === 'first_half') li = 0;
          if (approvedOD.halfDayType === 'second_half') eo = 0;
        }

        // Frontend logic simulation
        let top = 'A', bottom = 'A';
        if (simulatedStatus === 'PRESENT') {
          top = 'P'; bottom = 'P';
        } else if (simulatedStatus === 'HALF_DAY') {
          let workedHalf = (eo > li) ? 'first' : (li > eo) ? 'second' : 'first';
          if (eo === li && record.shifts && record.shifts.length > 0) {
            const s = record.shifts[0];
            const timeToMins = (t) => {
              if (!t) return 0;
              if (t instanceof Date) return t.getHours() * 60 + t.getMinutes();
              const str = String(t);
              if (str.includes('AM') || str.includes('PM')) {
                const [time, modifier] = str.split(' ');
                let [hours, minutes] = time.split(':').map(Number);
                if (modifier === 'PM' && hours < 12) hours += 12;
                if (modifier === 'AM' && hours === 12) hours = 0;
                return hours * 60 + minutes;
              }
              const [h, m] = str.split(':').map(Number);
              return (h || 0) * 60 + (m || 0);
            };
            const sStart = s.shiftStartTime || s.shiftId?.startTime;
            const sEnd = s.shiftEndTime || s.shiftId?.endTime;
            if (s.inTime && sStart && s.outTime && sEnd) {
              const inDiff = Math.max(0, timeToMins(s.inTime) - timeToMins(sStart));
              const outDiff = Math.max(0, timeToMins(sEnd) - timeToMins(s.outTime));
              if (inDiff > outDiff) workedHalf = 'second';
              else if (outDiff > inDiff) workedHalf = 'first';
            }
          }
          if (eo === li && approvedOD?.halfDayType) {
            workedHalf = approvedOD.halfDayType === 'first_half' ? 'second' : 'first';
          }
          if (workedHalf === 'first') { top = 'HD'; bottom = 'A'; } else { top = 'A'; bottom = 'HD'; }
        }
        if (approvedOD) top = (top === 'A' || !top) ? 'OD' : `${top}/OD`;

        console.log(`   Visual: [${top}] / [${bottom}]`);

      } else {
        let result;
        if (mode === 'single_shift') {
          result = await singleShiftService.processSingleShiftAttendance(empNo, d);
        } else {
          result = await multiShiftService.processMultiShiftAttendance(empNo, d);
        }
        if (result && result.success) {
          const finalRecord = result.dailyRecord || result.attendanceRecord || {};
          console.log(`   Success: Status ${finalRecord.status} | Pay ${finalRecord.payableShifts}`);
        } else {
          console.log(`   Failed: ${result?.message || 'Unknown error'}`);
        }
      }
    }
    
    // Trigger Monthly Summary Recalculation after daily updates
    if (!dryRun) {
      const monthToTrigger = dateStr.substring(0, 7); // Extract YYYY-MM
      console.log(`\nTriggering Monthly Summary Refresh for ${empNo} in ${monthToTrigger}...`);
      await summaryCalculationService.calculateMonthlySummaryByEmpNo(empNo, monthToTrigger);
      console.log('Summary Refresh Complete.');
    }

  } catch (error) {
    console.error('Error during recalculation:', error);
  } finally {
    console.log('\nFinalizing and disconnecting...');
    // Only wait for background hooks in execution mode
    if (!dryRun) await new Promise(resolve => setTimeout(resolve, 3000));
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
    process.exit(0);
  }
}

run();
