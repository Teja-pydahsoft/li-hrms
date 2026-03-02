# Paid Days from Output Column – Proration and Fallbacks

In **dynamic payroll** (output-column–driven calculation), **allowances**, **other deductions**, and **statutory deductions** that are prorated all use the **same** “paid days” (and optionally “total days in month”) when possible: the value from the **dynamic payroll config’s paid days column** (i.e. an output column whose value is used as paid days).

---

## 1. Where paid days come from (when column is found)

- **Config (optional):**  
  - `statutoryProratePaidDaysColumnHeader` – header of the output column whose value is used as **paid days**.  
  - `statutoryProrateTotalDaysColumnHeader` – header of the column for **total days in month** (optional).

- **Auto-detect by name:**  
  If no config header is set, the system looks in the **context** (already-filled output columns) for a column whose **name** matches known labels, e.g.:
  - Paid days: `Paid Days`, `Present Days`, `Working Days`, `Payable Shifts`, `Total Paid Days`, etc.
  - Total days: `Month days`, `Total Days`, `Total days in month`, `Days in month`, etc.

- **Who uses it:**  
  When resolving **allowances**, **other deductions**, or **statutory** in the column loop, the service builds `attendanceData` (or equivalent) with:
  - `totalPaidDays` = value from that column (config or auto-detect),
  - `totalDaysInMonth` = value from the total-days column if configured/detected.  
  **Allowance** and **deduction** services use `totalPaidDays` / `totalDaysInMonth` for proration when present; **statutory** uses the same paid/total days for its proration.

- **Column order:**  
  The paid days (and total days) column **must appear before** any allowance, other-deduction, or statutory column in the output column order, so their values are in **context** when those are computed.

---

## 2. When the system **can’t** find the paid days column

If no matching column is found (no config header and no auto-detect match in context), the following **fallbacks** and **precautions** apply.

### 2.1 Statutory deductions

- **Fallback:**  
  Paid days are taken from **record.attendance**:
  - Prefer `record.attendance.totalPaidDays` (set by basic pay service) if it is a number ≥ 0.
  - Else: `presentDays + paidLeaveDays + weeklyOffs + holidays` from `record.attendance`.
- **Total days:**  
  `record.attendance.totalDaysInMonth` (or default 30 if missing).
- **Precaution:**  
  Statutory is still calculated and prorated; it just uses attendance-based paid days instead of a column value. No throw; no blank statutory.

### 2.2 Allowances (prorated)

- **Fallback:**  
  When `attendanceData.totalPaidDays` (and optionally `totalDaysInMonth`) is **not** provided (e.g. no column in context), the allowance service uses:
  - **Paid days:** `presentDays + paidLeaveDays + odDays` from `attendanceData`.
  - **Total days:** `attendanceData.monthDays` or `totalDaysInMonth` or default 30.
- **Precaution:**  
  Proration still runs; it uses attendance-based days. No throw; no blank allowance.

### 2.3 Other deductions (prorated)

- **Fallback:**  
  Same as allowances:
  - **Paid days:** `presentDays + paidLeaveDays + odDays` when `totalPaidDays` is not provided.
  - **Total days:** `monthDays` or `totalDaysInMonth` or 30.
- **Precaution:**  
  Same as above; proration continues with attendance-based days.

---

## 3. Summary table

| Scenario | Statutory | Allowances | Other deductions |
|----------|-----------|------------|------------------|
| **Paid days column found** (config or auto-detect) | Use column value for proration | Use `totalPaidDays` / `totalDaysInMonth` from context | Same |
| **Paid days column not found** | Use `record.attendance` (totalPaidDays or present+paidLeave+weeklyOffs+holidays) | Use `presentDays + paidLeaveDays + odDays` and `monthDays` | Same as allowances |
| **Precaution** | Never skip statutory; always prorate with some paid days source | Never skip; fallback to attendance days | Same |

---

## 4. Tests

- **File:** `backend/payroll/services/__tests__/payrollCalculationFromOutputColumns.paidDays.test.js`
- **Covers:**
  - `getPaidDaysAndTotalDaysFromContext`: returns paid/total days from context (config header or auto-detect); returns nulls when context is empty or null.
  - **Allowance:** Proration using `totalPaidDays` / `totalDaysInMonth` from “column”; fallback to `presentDays + paidLeaveDays + odDays` when not provided; zero paid days → zero amount.
  - **Deduction:** Same for other-deduction proration.

Run:

```bash
npm test -- payroll/services/__tests__/payrollCalculationFromOutputColumns.paidDays.test.js
```

---

## 5. Necessary precautions (checklist)

1. **Column order:** Ensure the paid days (and if used, total days) column is **before** allowance, other-deduction, and statutory columns in the paysheet/output column order.
2. **Header name:** If using auto-detect, use one of the known names (e.g. `Paid Days`, `Present Days`, `Month days`) or set `statutoryProratePaidDaysColumnHeader` (and optionally `statutoryProrateTotalDaysColumnHeader`) in config.
3. **No column:** If you don’t add a paid days column, the system still runs; it uses **attendance-based** paid days (and total days) for all three (statutory, allowances, other deductions). No extra config required.
4. **Zero paid days:** If the column value (or fallback) is 0, prorated amounts become 0; the code does not throw.
