# Initial Apply Leave Register: Locked + Split-Aware Plan

## Objective

Refine **initial leave register apply** behavior so that period-wise CL usage is computed correctly from leave records (including split leaves), with strict IST boundaries, and carry-forward handled using locked + used counts.

This change is **only for initial apply flow** (not global monthly recalculation/list rendering).

---

## Confirmed Business Rules

1. **Scope**
   - Apply only in initial apply flow (`initial-cl-sync/apply` path).
   - Do not change normal ongoing monthly rendering/recompute behavior.

2. **Status mapping**
   - `approved` => contributes to **used**
   - `rejected` => ignored (neither used nor locked)
   - all other statuses => contributes to **locked** (intermediate)

3. **Carry-forward formula (per period)**
   - `carry = max(0, opening + scheduled - used - locked)`

4. **Split leave handling**
   - If a leave is split, use split-day data (`LeaveSplit`) to compute period CL used/locked.
   - Count only split rows that are CL for that period/day.

5. **Date handling**
   - Period checks must be strict **IST pay-cycle windows**.
   - Half-day/full-day/multi-day and split-day allocations must follow IST date boundaries.

---

## Current Problem Summary

During initial apply, carry and period totals can drift because:
- carry-forward is applied too early/too broadly,
- locked usage may be mixed with carry incorrectly,
- split leave days are not always the source-of-truth for period CL allocation.

---

## Implementation Strategy

### 1) Initial apply should be period-first

For each employee in initial apply:
- Resolve FY/pay-period slots in chronological order (month 1 -> month 12).
- For each slot, compute:
  - `opening` (previous slot carry),
  - `scheduled` (policy slot credit),
  - `used` (approved CL in this slot),
  - `locked` (intermediate CL in this slot),
  - `carry` using confirmed formula.

No pre-application of carry-forward across future periods.

### 2) Add split-aware CL period consumption resolver

Create/extend service helper to return per-slot CL consumption buckets:
- **approved CL days** (used)
- **intermediate CL days** (locked)

Priority for day allocation:
1. `LeaveSplit` rows in period (if leave has splits / splitStatus relevant)
2. fallback to Leave record day computation for non-split leaves

### 3) IST-safe period filtering

Use existing pay-cycle/date helpers (IST normalized) and ensure all leave day checks are by IST day string.

### 4) Restrict this logic to initial apply path

Wire only from initial apply service/controller flow:
- `annualCLResetController.applyInitialCLSync`
- `annualCLResetService.syncEmployeeCLFromPolicy` and related initial-sync helpers

Do not modify global list/get leave register recomputation path except where unavoidable shared helper behavior is guarded by explicit flag.

---

## Proposed Touchpoints

- `backend/leaves/controllers/annualCLResetController.js`
  - keep endpoint contract unchanged
  - pass explicit option for split+locked aware initial apply calculation

- `backend/leaves/services/annualCLResetService.js`
  - main orchestration for initial apply
  - replace early carry pass with slot-by-slot opening/scheduled/used/locked/carry sequence
  - include debug/trace info in returned details for verification

- `backend/leaves/services/leaveRegisterYearMonthlyApplyService.js`
  - add/adjust helper for period-wise CL used+locked computation
  - split-aware day extraction from `LeaveSplit`

- `backend/leaves/services/leaveSplitService.js` (if needed)
  - reuse helpers for split normalization/day calculations

- `backend/leaves/model/Leave.js`, `backend/leaves/model/LeaveSplit.js`
  - no schema change expected; consume existing fields

---

## Status Classification (Implementation Mapping)

- **Used bucket**
  - `status === 'approved'`

- **Ignored**
  - `status === 'rejected'`

- **Locked bucket**
  - every other non-final/intermediate status
  - (implementation: `status !== 'approved' && status !== 'rejected'`)

---

## Split Leave Counting Rules

For each period slot:
- include split rows where:
  - split date lies within slot IST start/end,
  - split leave type is CL,
  - split status follows used/locked mapping above.
- day contribution:
  - half day -> `0.5`
  - full day -> `1`
  - explicit `numberOfDays` honored if present and valid

Fallback for non-split leave:
- compute overlap by IST day range + half-day metadata.

---

## Data Returned for Preview/Diagnostics (optional but recommended)

Per employee per slot, return:
- `opening`
- `scheduled`
- `usedApprovedCL`
- `lockedIntermediateCL`
- `closingBeforeCarry`
- `carryToNext`

This improves auditability when users compare preview vs apply.

---

## Non-Goals

- No changes to attendance/payroll formulas.
- No change to regular monthly leave register rendering logic (outside initial apply).
- No change to status names/workflow config itself.

---

## Validation Checklist

1. Employee with no leaves:
   - used=0, locked=0, carry from opening+scheduled

2. Approved CL only:
   - used increases, locked stays 0

3. Intermediate CL only:
   - locked increases, used stays 0

4. Mix approved + intermediate:
   - both buckets correctly reflected; carry reduces by both

5. Split leave across pay-cycle boundary:
   - only IST days in slot counted

6. Half-day split:
   - contributes 0.5 only

7. Rejected leave:
   - no used/locked contribution

---

## Rollout

1. Implement helper changes in service layer.
2. Wire into initial apply flow with feature-scoped option.
3. Verify with dry-run/preview first on sample employees.
4. Apply to filtered list and validate slot-level results.

