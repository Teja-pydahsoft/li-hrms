# Suggestion: CCL (Compensatory Leave) for Holiday Work

## Current behaviour (after Jan 26 script)

- **Holiday worked (other departments):** Attendance daily is marked **HOLIDAY**, punches are kept for record.
- **Payroll:** `totalPayableShifts` in monthly summary **excludes** days with status HOLIDAY/WEEK_OFF. So the holiday worked day does **not** add to payable shifts.
- **Holiday pay:** The day still counts in `totalHolidays`, so the employee is paid for the holiday (not marked absent).
- **Result:** They get holiday pay once, and the worked day is not counted as an extra payable day — no double pay.

## What to add in the product

1. **CCL application flow**
   - When an employee has **punches on a holiday** (e.g. status = HOLIDAY and `shifts` have in/out), show an option like **“Apply for CCL”** (e.g. from attendance view or a dedicated CCL request screen).
   - CCL = compensatory casual leave: they choose **another date** to take off; that day is debited from a CCL balance (or similar) and they get that day as leave.

2. **Do not**
   - Make the holiday-worked day **PRESENT** or add it to payable shifts. That would double-count (holiday pay + working day pay).
   - Current design (day = HOLIDAY, punches kept, no payable for that day + option to apply CCL) is correct.

3. **Implementation options**
   - **Leave type:** Add a leave type (e.g. `CCL` / Compensatory) and a balance (e.g. `cclBalance` or use existing CL with a separate cap for CCL).
   - **Eligibility:** Only allow “Apply CCL” when there is an attendance daily for that employee on a holiday with punches (or a flag like “Worked on Holiday” in notes).
   - **Approval:** Reuse existing leave approval flow; on approval, deduct from CCL balance and create the leave for the chosen date.

4. **Reporting**
   - Optional: report or filter “Worked on Holiday” (e.g. from `AttendanceDaily` where status = HOLIDAY and `shifts` has inTime, or notes contain “Worked on Holiday”) so HR can see who is eligible for CCL.

## Summary

- **Keep:** Holiday worked = status HOLIDAY, punches retained, no payable for that day; employee gets holiday pay.
- **Add:** “Apply for CCL” for such employees so they can take another day off (CCL) without changing the holiday day to present or adding it to payable shifts.
