# Pay Register: Summary Calculation & Grids

## 1. Where the Pay Register Page Lives

- **Superadmin:** `/superadmin/pay-register` — full management (create/sync/edit, bulk actions, day grid).
- **Workspace (employee view):** `/(workspace)/pay-register` — view and limited actions for the logged-in context.

The **Upload Summary** button and its modal are **hidden** on both pages (button removed; modal not shown).

---

## 2. How the Pay Register Summary Is Calculated

### 2.1 Data model

Each employee has one **PayRegisterSummary** document per month (`backend/pay-register/model/PayRegisterSummary.js`):

- **`dailyRecords`** — one entry per date in the payroll period. Each day can be:
  - **Full-day:** single `status` (e.g. `present`, `absent`, `leave`, `od`, `holiday`, `week_off`).
  - **Half-day (split):** `firstHalf` and `secondHalf` with their own `status`, `leaveType`, `leaveNature`, `otHours`, etc.
- **`totals`** — monthly aggregates **derived from `dailyRecords`** (see below).
- **`startDate` / `endDate`** — payroll cycle (can differ from calendar month).
- **`totalDaysInMonth`** — number of days in the period.

### 2.2 Where totals come from

**Totals are not stored independently;** they are **recomputed from `dailyRecords`** whenever:

1. **Sync** — Backend builds/updates `dailyRecords` from:
   - **Attendance** (AttendanceDaily)
   - **Leaves** (Leave, LeaveSplit)
   - **OD** (On Duty)
   - **OT** (Overtime)
   - **Shifts** (PreScheduledShift, Shift)
   - **Holidays / week-offs** (from calendar or config)

   Then it runs **totals calculation** and saves.

2. **Create pay register** — Same: `populatePayRegisterFromSources` builds `dailyRecords`, then `calculateTotals(dailyRecords)` fills `totals`.

3. **Update daily record** — When a single day is updated (e.g. from the grid), backend replaces that day in `dailyRecords` and calls **totals calculation** again.

4. **Recalculate (model method)** — `payRegister.recalculateTotals()` on the Mongoose model also recomputes `totals` from `dailyRecords` (used after bulk or manual changes).

So: **summary = sum over `dailyRecords`**. No separate “summary upload” is used for the main flow; the (now hidden) “Upload Summary” feature was an alternate way to push totals and distribute them back onto days.

### 2.3 Totals calculation logic (high level)

Implemented in:

- `backend/pay-register/services/totalsCalculationService.js` — `calculateTotals(dailyRecords)`
- `PayRegisterSummary` model — `recalculateTotals()` (same logic, on the document)

For each day in `dailyRecords`:

- **Holiday / week_off** — Count 1 (or 0.5 per half) for `totalHolidays` / `totalWeeklyOffs`; do **not** count that day under present/absent/leave/OD.
- **Split days** — For each half, by `status`:
  - `present` / `od` → present (and OD) counters
  - `absent` → absent
  - `leave` → paid leave or LOP from `leaveNature`
- **Full days** — Same buckets, full-day counts.
- **OT** — Sum `otHours` (and half-day OT) into `totalOTHours`.
- **Late / early** — `isLate` / `isEarlyOut` (and optional minutes) into `lateCount` / `earlyOutCount`.

Then:

- **totalPresentDays** = full present days + 0.5 × present half-days (OD counted in present).
- **totalAbsentDays**, **totalPaidLeaveDays**, **totalLopDays**, **totalODDays** — same idea (full + half × 0.5).
- **totalLeaveDays** = totalPaidLeaveDays + totalLopDays.
- **totalPayableShifts** = totalPresentDays + totalPaidLeaveDays + extraDays (manual extra units).

So the **pay register summary** you see (Present, Absent, Leaves, LOP, OD, OT, Paid days, etc.) is exactly this **totals** object, always derived from **dailyRecords**.

---

## 3. How the Below Grids Are Placed (Frontend)

### 3.1 What the page loads

- **Month** is chosen in the UI (e.g. `YYYY-MM`).
- Frontend calls **`getEmployeesWithPayRegister(monthStr, departmentId?, divisionId?, ..., page, limit)`**.
- Backend:
  - Resolves **payroll cycle** for that month (`getPayrollDateRange` → `startDate`, `endDate`, `totalDays`).
  - Finds **employees** (active or left-in-period) for the filters.
  - Loads **PayRegisterSummary** for those employees and that month (with `dailyRecords` and `totals`).
  - For employees without a summary yet, returns a **stub** (empty `dailyRecords`, zeros in `totals`).

So the **list of rows** in the grid = one row per employee (for the selected month/filters), each row backed by one PayRegisterSummary (or stub).

### 3.2 Day columns (the “grid” of days)

- **Range of dates** shown as columns:
  - If the API returned **`startDate` / `endDate`** for the payroll cycle, the frontend builds **`displayDays`** as all dates from `startDate` to `endDate`.
  - Otherwise it falls back to **calendar month** (1 to last day of the selected month).
- **`daysArray`** = `displayDays` (used everywhere for column headers and cell keys).
- So the **grid** is: one **row per employee**, one **column per date** in `daysArray`, plus fixed columns (e.g. employee name, actions).

### 3.3 What each cell shows

- For employee row **pr** and date **day**:
  - **pr.dailyRecords** is an array of `{ date, firstHalf, secondHalf, status, leaveType, ... }`.
  - The frontend builds a **map** `date → record` from `pr.dailyRecords`.
  - For column **day**, it looks up **record = dailyRecordsMap.get(day)**.
- **Display:**
  - If **no record** for that day → cell can be empty or “-”, and may be clickable to add a record.
  - If **record exists** → cell shows status (e.g. P, A, L, OD, H, WO) and optional half-day (e.g. P/A). Color comes from **getCellBackgroundColor(record, activeTable)**.
- **Table type** (Present / Absent / Leaves / OD / OT or Extra / Shifts) filters which cells are **highlighted** (e.g. only “present” cells in the Present tab); **all days are still there**, only the highlighting and which rows “count” for that view change.

So the **placement** of the grids is:

1. **Rows** = employees (from `getEmployeesWithPayRegister`).
2. **Columns** = dates in `daysArray` (from payroll `startDate`–`endDate` or calendar month).
3. **Cell (employee, date)** = the element of that employee’s `dailyRecords` whose `date` equals the column date.

### 3.4 Summary row / block above or below the grid

- The **summary numbers** (Total Present, Total Absent, Paid Leaves, LOP, OD, OT, Paid days, Month days, Counted days, etc.) are **not** computed again on the frontend from the grid.
- They come from **pr.totals** (and related fields like `totalDaysInMonth`) returned by the same API.
- The frontend may derive a few **display-only** values (e.g. “Paid days = present + paid leave + holidays + week-offs”, “Counted days = …”) for the summary block from `pr.totals` and `pr.totalDaysInMonth`.

So the **below grids** are the **dailyRecords** laid out by (employee × date); the **summary** is the **totals** object from the backend, which is always calculated from those same **dailyRecords** on the server.

---

## 4. Short Summary

| What you see            | Source |
|-------------------------|--------|
| List of employees       | `getEmployeesWithPayRegister` (PayRegisterSummary or stub per employee). |
| Day columns             | `daysArray` = dates from payroll `startDate`–`endDate` or calendar month. |
| Cell (employee, date)   | `pr.dailyRecords` entry for that date (status, half-day, OT, etc.). |
| Summary numbers         | `pr.totals` (and `totalDaysInMonth`), computed on the backend from `dailyRecords`. |
| How summary is computed | Sum over `dailyRecords`: present/absent/leave/OD/OT/holiday/week-off, full and half days; then totalPresentDays, totalPayableShifts, etc. |

The **Upload Summary** button and modal are hidden; the main flow is **sync/create/update daily records → backend recalculates totals from dailyRecords**.
