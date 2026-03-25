/**
 * Leave policy: combined application cap per payroll period (CL + CCL + optional EL).
 * EL counts toward the cap only when policy.includeEL is true and earnedLeave.useAsPaidInPayroll is false.
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
 * Scheduled credits pool for the payroll period: CL + CCL + EL (EL only when it counts toward monthly cap).
 * If policy monthly cap is enabled → min(pool, maxDays); otherwise → pool (register-only ceiling).
 */
function computeScheduledPoolApplyCeiling(scheduled, policy) {
  if (!scheduled || typeof scheduled !== 'object') return null;
  const cl = Number(scheduled.clCredits) || 0;
  const cco = Number(scheduled.compensatoryOffs) || 0;
  const el = Number(scheduled.elCredits) || 0;
  const capCfg = policy?.monthlyLeaveApplicationCap;
  const includeEL = !!capCfg?.includeEL;
  const elPaidInPayroll = policy?.earnedLeave?.useAsPaidInPayroll !== false;
  const elInPool = policy?.earnedLeave?.enabled && includeEL && !elPaidInPayroll;
  const pool = cl + cco + (elInPool ? el : 0);
  const policyCapEnabled = !!capCfg?.enabled;
  const maxDays = Number(capCfg?.maxDays);
  const policyCapActive = policyCapEnabled && Number.isFinite(maxDays) && maxDays > 0;
  if (policyCapActive) return Math.min(pool, maxDays);
  return pool;
}

/**
 * Effective days employee may apply in this payroll period (same rules as register UI):
 * min(scheduled pool, policy cap) when year slot applies; else policy maxDays if cap on; else null (no pooled ceiling).
 */
async function resolvePooledMonthlyApplyCeiling(employeeId, fromDate, policy) {
  const capCfg = policy?.monthlyLeaveApplicationCap;
  const policyCapEnabled = !!capCfg?.enabled;
  const maxDays = Number(capCfg?.maxDays);
  const policyCapActive = policyCapEnabled && Number.isFinite(maxDays) && maxDays > 0;

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

  // Enforce scheduled pooled ceiling even for future payroll periods.
  // Otherwise, UI can show "0 left" (stored ceiling/consumption) while backend allows apply
  // just because the period hasn't started yet.
  if (slot?.payPeriodStart) {
    const scheduled = {
      clCredits: slot.clCredits,
      compensatoryOffs: slot.compensatoryOffs,
      elCredits: slot.elCredits,
    };
    const c = computeScheduledPoolApplyCeiling(scheduled, policy);
    if (c != null && Number.isFinite(c)) return Math.max(0, c);
  }

  if (policyCapActive) return maxDays;
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
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
async function assertWithinMonthlyApplicationCap(employeeId, fromDate, leaveType, numberOfDays) {
  const policy = await LeavePolicySettings.getSettings();
  const capCfg = policy?.monthlyLeaveApplicationCap;

  const fromForPeriod = parseFromDateForPeriod(fromDate);
  const periodInfo = await dateCycleService.getPeriodInfo(fromForPeriod);
  const start = periodInfo.payrollCycle.startDate;
  const end = periodInfo.payrollCycle.endDate;

  const existing = await Leave.find({
    employeeId,
    isActive: true,
    status: { $in: CAP_COUNT_STATUSES },
    fromDate: { $gte: start, $lte: end },
  })
    .select('leaveType numberOfDays splitStatus')
    .lean();

  const add = countedDaysForLeave({ leaveType, numberOfDays }, policy);
  if (add <= 0) return { ok: true };

  const lt = String(leaveType || '').toUpperCase();
  const registerClCap = await getRegisterClApplicationCap(employeeId, fromDate, policy);
  if (lt === 'CL' && registerClCap != null) {
    let usedCL = 0;
    for (const row of existing) {
      usedCL += await sumClDaysForLeaveInPeriod(row, policy, start, end);
    }
    if (usedCL + add > registerClCap) {
      return {
        ok: false,
        error: `This payroll period’s CL application limit from the leave register is ${registerClCap} day(s) (scheduled for the period). Already applied (CL) in this period: ${usedCL} day(s); this request: ${add} day(s).`,
      };
    }
  }

  /** In-flight (“locked”) + approved both deduct from the same period ceiling (min(pool, cap) or policy-only cap). */
  const pooledCeiling = await resolvePooledMonthlyApplyCeiling(employeeId, fromDate, policy);
  if (pooledCeiling == null) return { ok: true };

  let usedTowardCeiling = 0;
  for (const row of existing) {
    usedTowardCeiling += await sumCountedCapDaysForLeaveInPeriod(row, policy, start, end);
  }

  if (usedTowardCeiling + add > pooledCeiling) {
    const elPart =
      capCfg?.includeEL && policy?.earnedLeave?.useAsPaidInPayroll === false ? ', EL' : '';
    return {
      ok: false,
      error: `Payroll-period apply ceiling is ${pooledCeiling} day(s) (scheduled pool and policy cap when set; CL + CCL${elPart}). Days already counting (pending + approved): ${usedTowardCeiling}; this request: ${add}.`,
    };
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
      if (capDays <= 0) continue;
      const splitMs = new Date(s.date).getTime();
      for (const w of monthPayrollWindows) {
        const startMs = w.start.getTime();
        const endMs = w.end.getTime();
        if (splitMs >= startMs && splitMs <= endMs) {
          contributions.push({ key: w.key, capDays, leaveType: s.leaveType });
          break;
        }
      }
    }
  } else {
    const capDays = countedDaysForLeave(leave, policy);
    if (capDays <= 0) return;
    const leaveFromMs = new Date(leave.fromDate).getTime();
    for (const w of monthPayrollWindows) {
      const startMs = w.start.getTime();
      const endMs = w.end.getTime();
      if (leaveFromMs >= startMs && leaveFromMs <= endMs) {
        contributions.push({ key: w.key, capDays, leaveType: leave.leaveType });
        break;
      }
    }
  }

  for (const c of contributions) {
    const b = pendingByMonthKey[c.key];
    if (!b) continue;
    b.capConsumedDays += c.capDays;
    if (isApproved) b.capApprovedDays += c.capDays;
    else {
      b.capLockedDays += c.capDays;
      b.pendingCapDaysInFlight += c.capDays;
      const u = String(c.leaveType || '').toUpperCase();
      if (u === 'CL') b.pendingCLDays += c.capDays;
      else if (u === 'CCL') b.pendingCclDays += c.capDays;
      else if (u === 'EL') b.pendingElDays += c.capDays;
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
  CAP_COUNT_STATUSES,
  PENDING_PIPELINE_STATUSES,
};
