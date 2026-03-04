# Senior Tester Verification Report: Manual Deductions & Dynamic Payroll Changes

**Scope:** All changes made for manual deductions module, payroll integration, dynamic payroll outcome variables, and deductions cumulative semantics.

---

## 1. BUG FIXED DURING REVIEW

- **deductionIntegrationService.js:** `addDeductionsToPayroll` used `payrollRecord.set('netSalary', ...)`, which only exists on Mongoose documents. The **dynamic payroll** flow passes a **plain object** `record`, so `.set` would throw. **Fixed:** Use `payrollRecord.netSalary = newNet` when `payrollRecord.set` is not a function, so both mongoose docs and plain objects work.

---

## 2. CHANGES SUMMARY

| Area | What changed |
|------|----------------|
| **Manual deductions module** | New backend (model, service, controller, routes), payroll integration (DeductionIntegrationService), frontend (form, list, pay-register section, superadmin page, API, permissions). |
| **Dynamic payroll – manual deduction** | Apply `options.deductionSettlements` before column loop; expose `manualDeductionsAmount` / `manualDeductions.manualDeductionsAmount`; persist and run `processDeductionSettlements` after save. |
| **Outcome variables** | `manualDeductionsAmount`, `manual_deductions_amount` in ALLOWED_FORMULA_VARS and getContextFromPayslip; payroll config field option "Manual deductions". |
| **Deductions cumulative (dynamic only)** | `deductions.deductionsCumulative` = **only** “other deductions” (allowances-deductions config, excluding "Manual Deduction"). `deductions.totalDeductions` = full total (att + otherOnly + statutory + loanEMI + advance + manualDed) for net salary. |

---

## 3. LOGIC VERIFICATION

### 3.1 Manual deduction flow (strategy = new or dynamic)

- **Create** → POST `/api/manual-deductions` (direct/incremental).
- **Approve** → transition or action (HOD → HR → Admin) → status `approved`.
- **Payroll** → POST `/api/payroll/calculate?strategy=new` (or `dynamic`) with `body.deductions: [{ deductionId, amount }]`.
- **Backend:** `options.deductionSettlements` passed to calculation; `DeductionIntegrationService.addDeductionsToPayroll` adds to record (manualDeductionsAmount, otherDeductions, totalDeductions, reduces netSalary). After save, `processDeductionSettlements` updates DeductionRequest remainingAmount/status.
- **Result:** Payslip/response includes `manualDeductionsAmount`; net is reduced; deduction requests are settled.

**Consistency:** Same flow for both `calculatePayrollNew` (strategy=new) and `calculatePayrollFromOutputColumns` (strategy=dynamic). Deduction integration supports both mongoose PayrollRecord and plain object (dynamic `record`).

### 3.2 Dynamic payroll – deductions cumulative vs total deductions

- **deductionsCumulative:** Sum of `record.deductions.otherDeductions` where `name !== 'Manual Deduction'` (i.e. only allowances-deductions config items). Used for the “Deductions cumulative” column so attendance, statutory, loan EMI, advance, and manual stay separate.
- **totalDeductions:** `att + otherDeductionsOnly + statutory + loanEMI + advance + manualDed`. Used for net salary. No double-count: manual is added once; “Manual Deduction” is excluded from `otherDeductionsOnly`.
- **runRequiredServices:** Sets `deductionsCumulative = other`, `totalDeductions = att + other + statutory + loanEMI + advance` (before manual is applied). After `addDeductionsToPayroll`, “Recompute” and resolveFieldValue overwrite both using the same formula above.

**Consistency:** All three places (resolveFieldValue for deductionsCumulative/totalDeductions, netSalary fallback, final “Recompute” block) use the same definitions. No double-count of manual deduction.

### 3.3 Outcome variables (dynamic)

- **manualDeductionsAmount** / **manual_deductions_amount:** In ALLOWED_FORMULA_VARS and getContextFromPayslip; available in formulas and as field `manualDeductions.manualDeductionsAmount`.
- **deductionsCumulative:** In context from `ded.deductionsCumulative ?? ded.totalDeductions`. In dynamic flow, `deductionsCumulative` is set to other-only, so formulas/columns using it get the allowances-deductions total only.

---

## 4. WHAT TO TEST (CHECKLIST)

### 4.1 Manual deductions module (any strategy)

- [ ] Login as super admin (or HR/sub_admin). Create direct deduction (employee, amount, reason). Status = draft.
- [ ] Transition to approved (or use action flow: HOD → HR → Admin). Status = approved.
- [ ] GET `/api/manual-deductions`, GET `/api/manual-deductions/:id`, GET `/api/manual-deductions/employee/:id/pending`, GET `/api/manual-deductions/for-payroll` return expected data.
- [ ] Pay register: select employee, month; in “Manual deductions” section select the approved deduction and amount; run Calculate. Response includes `manualDeductionsAmount`; net salary is reduced by that amount.
- [ ] Run test script: `node scripts/test_manual_deductions_and_payroll.js` (ensure SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD in `.env` match seeded admin).

### 4.2 Dynamic payroll (strategy=dynamic)

- [ ] Payroll config: add column with field `manualDeductions.manualDeductionsAmount` (or “Manual deductions”). Run payroll with deductions in body; that column shows the manual deduction amount.
- [ ] Add column “Deductions cumulative”. Run payroll with at least one allowance-deduction config item and optionally manual deduction. **Expected:** “Deductions cumulative” = sum of allowances-deductions only (no attendance, statutory, loan, advance, manual). “Total deductions” or net-based check = full total including attendance, statutory, loan, advance, manual.
- [ ] Formula using `manualDeductionsAmount` or `deductionsCumulative` evaluates correctly (e.g. a column with formula that references them).
- [ ] After calculate with deductions, corresponding DeductionRequest documents have updated remainingAmount and settlement history.

### 4.3 Regression

- [ ] Strategy = new (non-dynamic): payroll with manual deductions still applies amount and reduces net; payslip shows manualDeductionsAmount.
- [ ] Legacy / non-dynamic: “total deductions” and net salary unchanged; no reliance on deductionsCumulative = other-only (that semantics is dynamic-only).

---

## 5. FILES TOUCHED (REFERENCE)

- **Backend:**  
  `manual-deductions/*`, `payroll/services/deductionIntegrationService.js`, `payroll/services/payrollCalculationService.js`, `payroll/services/payrollCalculationFromOutputColumnsService.js`, `payroll/services/outputColumnService.js`, `payroll/controllers/payrollController.js`, `payroll/model/PayrollRecord.js`, `server.js`
- **Frontend:**  
  `lib/api.ts`, `lib/permissions.ts`, `components/ManualDeductions/*`, `components/Sidebar.tsx`, `app/superadmin/manual-deductions/page.tsx`, `app/superadmin/pay-register/page.tsx`, `app/superadmin/payroll-config/page.tsx`
- **Tests / docs:**  
  `scripts/test_manual_deductions_and_payroll.js`, `scripts/postman_manual_deductions_and_payroll.json`, `scripts/README_MANUAL_DEDUCTIONS_TEST.md`

---

## 6. CONCLUSION

- **Code logic:** Manual deduction flow, dynamic vs new strategy, and deductions cumulative (other-only) vs total deductions are consistent and do not double-count. The only bug found (plain object vs mongoose in `addDeductionsToPayroll`) is fixed.
- **Runtime:** Automated script failed on **login (401)** due to env credentials; no code defect there. Recommend running the checklist above with valid admin credentials and a real pay register + payroll config to confirm end-to-end behaviour.
