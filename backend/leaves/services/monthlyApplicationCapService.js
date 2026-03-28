/**
 * Leave policy: per–leave-type application caps per payroll period (maxDaysByType / legacy CL maxDays).
 * Scheduled pool (register) may include CL + CCL + optional EL for consumption reporting — no combined policy maxDays.
 * EL counts toward the scheduled pool only when policy.includeEL is true and earnedLeave.useAsPaidInPayroll is false.
 */

const Leave = require('../model/Leave');
const LeaveSplit = require('../model/LeaveSplit');
const LeavePolicySettings = require('../../settings/model/LeavePolicySettings');
const LeaveRegisterYear = require('../model/LeaveRegisterYear');
const dateCycleService = require('./dateCycleService');
const { extractISTComponents } = require('../../shared/utils/dateUtils');

/**
 * Statuses where the leave still consumes monthly apply quota (in-flight pipeline or fully approved).
 * Rejected (`rejected`, `*_rejected`), cancelled, draft, etc. are omitted — those days no longer
 * count as locked or approved, so the payroll-period credit is available for new applications.
 */
const CAP_COUNT_STATUSES = [
  'pending',
  'reporting_manager_approved',
  'hod_approved',
  'manager_approved',
  'hr_approved',
  'principal_approved',
  'approved',
];

/** Subset of {@link CAP_COUNT_STATUSES}: still in workflow — not final `approved` (days show as "locked" on the register). */
const PENDING_PIPELINE_STATUSES = CAP_COUNT_STATUSES.filter((s) => s !== 'approved');

function getConfiguredMonthlyTypeCap(policy, leaveType) {
  const lt = String(leaveType || '').toUpperCase();
  const capCfg = policy?.monthlyLeaveApplicationCap || {};
  const byType = capCfg?.maxDaysByType || {};
  const v = Number(byType?.[lt]);
  if (Number.isFinite(v) && v >= 0) return v;
  // Backward-compat: if old maxDays exists, treat it as CL cap only.
  if (lt === 'CL') {
    const old = Number(capCfg?.maxDays);
    if (Number.isFinite(old) && old >= 0) return old;
  }
  return 0;
}

/** True when this leave type has a positive per-period cap from maxDaysByType (or legacy CL maxDays). */
function isPerTypeMonthlyCapActive(policy, leaveType) {
  const c = getConfiguredMonthlyTypeCap(policy, leaveType);
  return Number.isFinite(c) && c > 0;
}

function parseFromDateForPeriod(fromDate) {
  const fromDateStr = String(fromDate || '').trim();
  let fromForPeriod = new Date(fromDate);
  const isoMatch = fromDateStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  const dmyMatch = fromDateStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (isoMatch) {
    fromForPeriod = new Date(
      Date.UTC(
        parseInt(isoMatch[1], 10),
        parseInt(isoMatch[2], 10) - 1,
        parseInt(isoMatch[3], 10),
        12,
        0,
        0
      )
    );
  } else if (dmyMatch) {
    const y = parseInt(dmyMatch[3], 10);
    const m = parseInt(dmyMatch[2], 10) - 1;
    const d = parseInt(dmyMatch[1], 10);
    if (m >= 0 && m <= 11 && d >= 1 && d <= 31) {
      fromForPeriod = new Date(Date.UTC(y, m, d, 12, 0, 0));
    }
  }
  return fromForPeriod;
}

/**
 * Days from one leave row that count toward the cap under current policy.
 */
function countedDaysForLeave(leave, policy) {
  const u = String(leave.leaveType || '').toUpperCase();
  const days = Number(leave.numberOfDays);
  const n = Number.isFinite(days) ? days : 0;
  if (u === 'CL' || u === 'CCL') return n;
  if (u === 'EL') {
    if (!policy?.earnedLeave?.enabled) return 0;
    const includeEL = !!policy?.monthlyLeaveApplicationCap?.includeEL;
    const elPaidInPayroll = policy?.earnedLeave?.useAsPaidInPayroll !== false;
    if (includeEL && !elPaidInPayroll) return n;
    return 0;
  }
  return 0;
}

/**
 * Whether scheduled EL credits count in the register’s CL+CCL+EL pool total (consumption reporting).
 * Per-type apply limits use maxDaysByType regardless.
 */
function elCountsTowardMonthlyPool(policy) {
  const capCfg = policy?.monthlyLeaveApplicationCap;
  const includeEL = !!capCfg?.includeEL;
  const elPaidInPayroll = policy?.earnedLeave?.useAsPaidInPayroll !== false;
  return !!policy?.earnedLeave?.enabled && includeEL && !elPaidInPayroll;
}

/** Allocate consumption U against scheduled pool: CL credits first, then CCL, then EL (same as payroll close). */
function allocateMonthlyPoolConsumptionClFirst(U, clS, cclS, elS) {
  const cl = Math.max(0, Number(clS) || 0);
  const ccl = Math.max(0, Number(cclS) || 0);
  const el = Math.max(0, Number(elS) || 0);
  const u = Math.max(0, Number(U) || 0);
  const clAlloc = Math.min(u, cl);
  let r = u - clAlloc;
  const cclAlloc = Math.min(r, ccl);
  r -= cclAlloc;
  const elAlloc = Math.min(r, el);
  return { clAlloc, cclAlloc, elAlloc };
}

/** CCL-typed applications: draw CCL pool first, then CL, then EL. */
function allocateMonthlyPoolConsumptionCclFirst(U, clS, cclS, elS) {
  const cl = Math.max(0, Number(clS) || 0);
  const ccl = Math.max(0, Number(cclS) || 0);
  const el = Math.max(0, Number(elS) || 0);
  const u = Math.max(0, Number(U) || 0);
  const cclAlloc = Math.min(u, ccl);
  let r = u - cclAlloc;
  const clAlloc = Math.min(r, cl);
  r -= clAlloc;
  const elAlloc = Math.min(r, el);
  return { clAlloc, cclAlloc, elAlloc };
}

/** EL-typed applications (when EL counts toward cap): EL pool first, then CL, then CCL. */
function allocateMonthlyPoolConsumptionElFirst(U, clS, cclS, elS) {
  const cl = Math.max(0, Number(clS) || 0);
  const ccl = Math.max(0, Number(cclS) || 0);
  const el = Math.max(0, Number(elS) || 0);
  const u = Math.max(0, Number(U) || 0);
  const elAlloc = Math.min(u, el);
  let r = u - elAlloc;
  const clAlloc = Math.min(r, cl);
  r -= clAlloc;
  const cclAlloc = Math.min(r, ccl);
  return { clAlloc, cclAlloc, elAlloc };
}

/**
 * Map in-flight leave days to register "Lk" columns using monthly pool hierarchy.
 * CL applications consume scheduled CL → CCL → EL; native CCL/EL apps prefer their tier first.
 * Approved consumption is applied first so remainder for locks matches substitution order.
 */
function finalizePendingLockedDisplayByPool(bucket, slot, policy) {
  if (!bucket || !slot || slot.payPeriodStart == null) return false;
  const clS = Math.max(0, Number(slot.clCredits) || 0);
  const cclS = Math.max(0, Number(slot.compensatoryOffs) || 0);
  const elS = elCountsTowardMonthlyPool(policy) ? Math.max(0, Number(slot.elCredits) || 0) : 0;

  const A = Math.max(0, Number(bucket.capApprovedDays) || 0);
  const allocA = allocateMonthlyPoolConsumptionClFirst(A, clS, cclS, elS);
  let remCl = clS - allocA.clAlloc;
  let remCcl = cclS - allocA.cclAlloc;
  let remEl = elS - allocA.elAlloc;

  let plc = 0;
  let plcc = 0;
  let ple = 0;

  const lockedCLapp = Math.max(0, Number(bucket.lockedClAppDays) || 0);
  const a1 = allocateMonthlyPoolConsumptionClFirst(lockedCLapp, remCl, remCcl, remEl);
  plc += a1.clAlloc;
  plcc += a1.cclAlloc;
  ple += a1.elAlloc;
  remCl -= a1.clAlloc;
  remCcl -= a1.cclAlloc;
  remEl -= a1.elAlloc;

  const lockedCCLapp = Math.max(0, Number(bucket.lockedCclAppDays) || 0);
  const a2 = allocateMonthlyPoolConsumptionCclFirst(lockedCCLapp, remCl, remCcl, remEl);
  plc += a2.clAlloc;
  plcc += a2.cclAlloc;
  ple += a2.elAlloc;
  remCl -= a2.clAlloc;
  remCcl -= a2.cclAlloc;
  remEl -= a2.elAlloc;

  const lockedELapp = Math.max(0, Number(bucket.lockedElAppDays) || 0);
  const a3 = allocateMonthlyPoolConsumptionElFirst(lockedELapp, remCl, remCcl, remEl);
  plc += a3.clAlloc;
  plcc += a3.cclAlloc;
  ple += a3.elAlloc;

  bucket.pendingLockedCL = plc;
  bucket.pendingLockedCCL = plcc;
  bucket.pendingLockedEL = ple;
  return true;
}

function computeScheduledPoolApplyCeiling(scheduled, policy) {
  if (!scheduled || typeof scheduled !== 'object') return null;
  const cl = Number(scheduled.clCredits) || 0;
  const cco = Number(scheduled.compensatoryOffs) || 0;
  const el = Number(scheduled.elCredits) || 0;
  const elInPool = elCountsTowardMonthlyPool(policy);
  const pool = cl + cco + (elInPool ? el : 0);
  return pool;
}

/**
 * Scheduled CL+CCL[+EL] pool for this payroll period (register slot), for reporting / UI only.
 * Per-type apply limits are enforced separately via maxDaysByType.
 */
async function resolvePooledMonthlyApplyCeiling(employeeId, fromDate, policy) {
  const fromForPeriod = parseFromDateForPeriod(fromDate);
  const periodInfo = await dateCycleService.getPeriodInfo(fromForPeriod);
  const pc = periodInfo.payrollCycle;
  const fy = await dateCycleService.getFinancialYearForDate(fromForPeriod);
  const doc = await LeaveRegisterYear.findOne({ employeeId, financialYear: fy.name }).lean();
  const slot = doc?.months?.find(
    (m) =>
      Number(m.payrollCycleMonth) === Number(pc.month) &&
      Number(m.payrollCycleYear) === Number(pc.year)
  );

  if (slot?.payPeriodStart) {
    const scheduled = {
      clCredits: slot.clCredits,
      compensatoryOffs: slot.compensatoryOffs,
      elCredits: slot.elCredits,
    };
    const c = computeScheduledPoolApplyCeiling(scheduled, policy);
    if (c != null && Number.isFinite(c)) return Math.max(0, c);
  }

  return null;
}

/**
 * Max CL days allowed from LeaveRegisterYear for this payroll period, or null if not applicable.
 * Applies only after the period has started (IST); future periods return null (no register-based CL cap yet).
 */
async function getRegisterClApplicationCap(employeeId, fromDate, policy) {
  if (policy?.monthlyLeaveApplicationCap?.clCapFromLeaveRegisterYear === false) return null;
  const fromForPeriod = parseFromDateForPeriod(fromDate);
  const periodInfo = await dateCycleService.getPeriodInfo(fromForPeriod);
  const pc = periodInfo.payrollCycle;
  const fy = await dateCycleService.getFinancialYearForDate(fromForPeriod);
  const doc = await LeaveRegisterYear.findOne({ employeeId, financialYear: fy.name }).lean();
  if (!doc?.months?.length) return null;
  const slot = doc.months.find(
    (m) =>
      Number(m.payrollCycleMonth) === Number(pc.month) && Number(m.payrollCycleYear) === Number(pc.year)
  );
  if (!slot?.payPeriodStart) return null;
  return Math.max(0, Number(slot.clCredits) || 0);
}

/**
 * @param {object} [options]
 * @param {import('mongoose').Types.ObjectId|string} [options.excludeLeaveId] — omit this leave when summing (e.g. edit in place).
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
async function assertWithinMonthlyApplicationCap(employeeId, fromDate, leaveType, numberOfDays, options = {}) {
  const excludeLeaveId = options.excludeLeaveId;
  const policy = await LeavePolicySettings.getSettings();
  const requestedType = String(leaveType || '').toUpperCase();
  const typeCap = getConfiguredMonthlyTypeCap(policy, requestedType);
  const perTypeCapActive = Number.isFinite(typeCap) && typeCap > 0;

  const fromForPeriod = parseFromDateForPeriod(fromDate);
  const periodInfo = await dateCycleService.getPeriodInfo(fromForPeriod);
  const start = periodInfo.payrollCycle.startDate;
  const end = periodInfo.payrollCycle.endDate;

  const overlapLeavesQuery = {
    employeeId,
    isActive: true,
    status: { $in: CAP_COUNT_STATUSES },
    fromDate: { $lte: end },
    toDate: { $gte: start },
  };

  const addForPerType = Math.max(0, Number(numberOfDays) || 0);

  if (perTypeCapActive && addForPerType > 0) {
    const existing = await Leave.find(overlapLeavesQuery)
      .select('leaveType numberOfDays splitStatus fromDate toDate')
      .lean();

    let usedTowardTypeCap = 0;
    for (const row of existing) {
      if (excludeLeaveId && String(row._id) === String(excludeLeaveId)) continue;
      usedTowardTypeCap += await sumLeaveTypeDaysForLeaveInPeriod(row, requestedType, start, end);
    }

    if (usedTowardTypeCap + addForPerType > typeCap) {
      return {
        ok: false,
        error: `${requestedType} payroll-period cap is ${typeCap} day(s). ${requestedType} days already counting (pending + approved): ${usedTowardTypeCap}; this request: ${addForPerType}.`,
      };
    }
  }

  return { ok: true };
}

/**
 * Days counting toward monthly apply cap for one leave row in a payroll window.
 * For split-approved leaves, only approved split segments whose date falls in [start,end]
 * and whose leave type counts (CL/CCL/EL rules) are included — LOP slices do not consume cap.
 */
async function sumCountedCapDaysForLeaveInPeriod(leave, policy, start, end) {
  if (String(leave.splitStatus || '') === 'split_approved' && leave._id) {
    const splits = await LeaveSplit.find({
      leaveId: leave._id,
      status: 'approved',
      date: { $gte: start, $lte: end },
    })
      .select('leaveType numberOfDays')
      .lean();
    let sum = 0;
    for (const s of splits) {
      sum += countedDaysForLeave({ leaveType: s.leaveType, numberOfDays: s.numberOfDays }, policy);
    }
    return sum;
  }
  return countedDaysForLeave(leave, policy);
}

/** CL-only days in period (register CL cap / messaging). Split-aware. */
async function sumClDaysForLeaveInPeriod(leave, policy, start, end) {
  if (String(leave.splitStatus || '') === 'split_approved' && leave._id) {
    const splits = await LeaveSplit.find({
      leaveId: leave._id,
      status: 'approved',
      date: { $gte: start, $lte: end },
    })
      .select('leaveType numberOfDays')
      .lean();
    let sum = 0;
    for (const s of splits) {
      if (String(s.leaveType || '').toUpperCase() !== 'CL') continue;
      sum += countedDaysForLeave({ leaveType: s.leaveType, numberOfDays: s.numberOfDays }, policy);
    }
    return sum;
  }
  if (String(leave.leaveType || '').toUpperCase() === 'CL') {
    return countedDaysForLeave(leave, policy);
  }
  return 0;
}

async function sumLeaveTypeDaysForLeaveInPeriod(leave, leaveType, start, end) {
  const lt = String(leaveType || '').toUpperCase();
  if (!['CL', 'CCL', 'EL'].includes(lt)) return 0;
  if (String(leave.splitStatus || '') === 'split_approved' && leave._id) {
    const splits = await LeaveSplit.find({
      leaveId: leave._id,
      status: 'approved',
      date: { $gte: start, $lte: end },
    })
      .select('leaveType numberOfDays')
      .lean();
    let sum = 0;
    for (const s of splits) {
      if (String(s.leaveType || '').toUpperCase() !== lt) continue;
      sum += Math.max(0, Number(s.numberOfDays) || 0);
    }
    return sum;
  }
  if (String(leave.leaveType || '').toUpperCase() !== lt) return 0;
  return Math.max(0, Number(leave.numberOfDays) || 0);
}

/**
 * Add one leave’s cap contributions into pendingByMonthKey buckets (register grid “locked/approved”).
 * Split rows are bucketed by each segment’s date; non-split by application fromDate.
 */
async function addLeaveCapToMonthlyBuckets(leave, policy, monthPayrollWindows, pendingByMonthKey) {
  const st = String(leave.status || '');
  const isApproved = st === 'approved';
  const contributions = [];

  if (String(leave.splitStatus || '') === 'split_approved' && leave._id) {
    const splits = await LeaveSplit.find({
      leaveId: leave._id,
      status: 'approved',
    })
      .select('date leaveType numberOfDays')
      .lean();
    for (const s of splits) {
      const capDays = countedDaysForLeave(
        { leaveType: s.leaveType, numberOfDays: s.numberOfDays },
        policy
      );
      const perTypeDays = Math.max(0, Number(s.numberOfDays) || 0);
      const lt = String(s.leaveType || '').toUpperCase();
      if (capDays <= 0 && !(lt === 'EL' && perTypeDays > 0)) continue;
      const splitMs = new Date(s.date).getTime();
      for (const w of monthPayrollWindows) {
        const startMs = w.start.getTime();
        const endMs = w.end.getTime();
        if (splitMs >= startMs && splitMs <= endMs) {
          contributions.push({ key: w.key, capDays, perTypeDays, leaveType: s.leaveType });
          break;
        }
      }
    }
  } else {
    const capDays = countedDaysForLeave(leave, policy);
    const perTypeDays = Math.max(0, Number(leave.numberOfDays) || 0);
    const lt = String(leave.leaveType || '').toUpperCase();
    if (capDays <= 0 && !(lt === 'EL' && perTypeDays > 0)) return;
    const leaveFromMs = new Date(leave.fromDate).getTime();
    for (const w of monthPayrollWindows) {
      const startMs = w.start.getTime();
      const endMs = w.end.getTime();
      if (leaveFromMs >= startMs && leaveFromMs <= endMs) {
        contributions.push({ key: w.key, capDays, perTypeDays, leaveType: leave.leaveType });
        break;
      }
    }
  }

  for (const c of contributions) {
    const b = pendingByMonthKey[c.key];
    if (!b) continue;
    b.capConsumedDays += c.capDays;
    const dType = Number.isFinite(Number(c.perTypeDays))
      ? Math.max(0, Number(c.perTypeDays))
      : Math.max(0, Number(c.capDays) || 0);
    if (isApproved) {
      b.capApprovedDays += c.capDays;
      const ua = String(c.leaveType || '').toUpperCase();
      if (ua === 'CL') b.approvedClCapDays = (Number(b.approvedClCapDays) || 0) + dType;
      else if (ua === 'CCL') b.approvedCclCapDays = (Number(b.approvedCclCapDays) || 0) + dType;
      else if (ua === 'EL') b.approvedElCapDays = (Number(b.approvedElCapDays) || 0) + dType;
    } else {
      b.capLockedDays += c.capDays;
      b.pendingCapDaysInFlight += c.capDays;
      const u = String(c.leaveType || '').toUpperCase();
      if (u === 'CL') b.lockedClAppDays = (Number(b.lockedClAppDays) || 0) + dType;
      else if (u === 'CCL') b.lockedCclAppDays = (Number(b.lockedCclAppDays) || 0) + dType;
      else if (u === 'EL') b.lockedElAppDays = (Number(b.lockedElAppDays) || 0) + dType;
    }
  }
}

module.exports = {
  assertWithinMonthlyApplicationCap,
  getRegisterClApplicationCap,
  countedDaysForLeave,
  computeScheduledPoolApplyCeiling,
  resolvePooledMonthlyApplyCeiling,
  sumCountedCapDaysForLeaveInPeriod,
  sumClDaysForLeaveInPeriod,
  addLeaveCapToMonthlyBuckets,
  finalizePendingLockedDisplayByPool,
  CAP_COUNT_STATUSES,
  PENDING_PIPELINE_STATUSES,
  getConfiguredMonthlyTypeCap,
  isPerTypeMonthlyCapActive,
  sumLeaveTypeDaysForLeaveInPeriod,
};
