/**
 * ============================================================
 * SET JAN 26 ATTENDANCE DAILY AS HOLIDAY (BY DEPARTMENT RULES)
 * ============================================================
 *
 * Target date: 2026-01-26 (Republic Day).
 *
 * RULES:
 *
 * 1) SPECIAL DEPARTMENTS (Hostel Dept, HOSTEL, MAINTENANCE, SECURITY):
 *    - If the day has punches (any shift with inTime) → do NOT touch the record.
 *    - If the day has no punches:
 *      - If status is HOLIDAY → set to ABSENT (remove holiday).
 *      - If the employee has approved leave on that day → we still set ABSENT
 *        so that the day is not marked holiday; leave is taken from Leave model
 *        and will show as leave in reports. So: remove holiday state only.
 *    Result: status = ABSENT, payableShifts = 0 (no punches case).
 *
 * 2) ALL OTHER DEPARTMENTS:
 *    - Everyone gets status = HOLIDAY on that day.
 *    - If they have punches (worked on holiday): keep punches as-is, only set
 *      status = HOLIDAY so the day is marked holiday; they get holiday pay and
 *      can apply for CCL for another day.
 *
 * Run from backend:
 *   node scripts/set_jan26_attendance_daily_holiday_by_dept.js
 * Dry run (no writes):
 *   DRY_RUN=1 node scripts/set_jan26_attendance_daily_holiday_by_dept.js
 * ============================================================
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const AttendanceDaily = require('../attendance/model/AttendanceDaily');
const Employee = require('../employees/model/Employee');
const Department = require('../departments/model/Department');

const TARGET_DATE = '2026-01-26';
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

// Special departments: by name (case-insensitive match on Department.name)
const SPECIAL_DEPT_NAMES = [
  'Hostel Dept',
  'HOSTEL',
  'MAINTENANCE',
  'SECURITY',
];

function hasPunches(daily) {
  const shifts = daily && daily.shifts;
  if (!Array.isArray(shifts) || shifts.length === 0) return false;
  return shifts.some((s) => s && s.inTime);
}

async function main() {
  console.log('\n--- Set Jan 26 Attendance Daily Holiday by Department ---\n');
  console.log('Target date:', TARGET_DATE);
  console.log('Special depts (no holiday; no-punch → ABSENT):', SPECIAL_DEPT_NAMES.join(', '));
  if (DRY_RUN) console.log('DRY RUN: no updates will be written.\n');

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.\n');

    // 1) Resolve special department IDs (match Department.name case-insensitive)
    const allDepts = await Department.find({}).select('_id name').lean();
    const specialDeptIds = new Set();
    for (const d of allDepts) {
      const name = (d.name || '').trim();
      if (SPECIAL_DEPT_NAMES.some((s) => s.toLowerCase() === name.toLowerCase())) {
        specialDeptIds.add(d._id.toString());
      }
    }
    console.log('Special department IDs:', [...specialDeptIds].join(', ') || '(none found)');

    // 2) Employee -> department_id (active only)
    const employees = await Employee.find({ is_active: true, leftDate: null })
      .select('emp_no department_id')
      .lean();
    const empToDept = new Map();
    for (const e of employees) {
      const empNo = (e.emp_no && String(e.emp_no).toUpperCase().trim()) || '';
      if (empNo) empToDept.set(empNo, e.department_id ? e.department_id.toString() : null);
    }
    const isSpecialDept = (empNo) => {
      const deptId = empToDept.get(empNo);
      return deptId ? specialDeptIds.has(deptId) : false;
    };
    console.log('Employees loaded:', empToDept.size, '\n');

    // 3) All attendance dailies for TARGET_DATE
    const dailies = await AttendanceDaily.find({ date: TARGET_DATE }).lean();
    console.log('Attendance dailies on', TARGET_DATE + ':', dailies.length);

    let specialSkippedPunches = 0;
    let specialSetAbsent = 0;
    let otherSetHoliday = 0;
    let otherAlreadyHoliday = 0;
    const updates = [];

    for (const daily of dailies) {
      const empNo = (daily.employeeNumber && String(daily.employeeNumber).toUpperCase().trim()) || daily.employeeNumber;
      const special = isSpecialDept(empNo);
      const punches = hasPunches(daily);

      if (special) {
        if (punches) {
          specialSkippedPunches++;
          continue;
        }
        // No punches: set ABSENT (remove holiday), payableShifts = 0
        updates.push({
          _id: daily._id,
          employeeNumber: empNo,
          type: 'special_absent',
          update: { $set: { status: 'ABSENT', payableShifts: 0 } },
        });
        specialSetAbsent++;
      } else {
        if (daily.status === 'HOLIDAY') {
          otherAlreadyHoliday++;
          continue;
        }
        // Other dept: set HOLIDAY (keep punches if any). If they have punches, add "Worked on Holiday" so they can apply for CCL.
        const setFields = { status: 'HOLIDAY' };
        if (punches) {
          const existingNotes = (daily.notes || '').trim();
          const workedNote = 'Worked on Holiday';
          if (!existingNotes) setFields.notes = workedNote;
          else if (!existingNotes.includes(workedNote)) setFields.notes = `${existingNotes} | ${workedNote}`;
        }
        updates.push({
          _id: daily._id,
          employeeNumber: empNo,
          type: 'other_holiday',
          update: { $set: setFields },
        });
        otherSetHoliday++;
      }
    }

    console.log('\nPlanned changes:');
    console.log('  Special dept – skipped (has punches):', specialSkippedPunches);
    console.log('  Special dept – set ABSENT (no punches):', specialSetAbsent);
    console.log('  Other dept – already HOLIDAY:', otherAlreadyHoliday);
    console.log('  Other dept – set HOLIDAY:', otherSetHoliday);

    if (!DRY_RUN && updates.length > 0) {
      for (const u of updates) {
        await AttendanceDaily.findByIdAndUpdate(u._id, u.update);
      }
      console.log('\nApplied', updates.length, 'updates.');
    } else if (DRY_RUN && updates.length > 0) {
      console.log('\n[DRY RUN] Would apply', updates.length, 'updates.');
    }

    console.log('\nDone.');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.\n');
    process.exit(0);
  }
}

main();
