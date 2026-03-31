/**
 * Leave movements live only on LeaveRegisterYear.months[].transactions (legacy LeaveRegister collection is unused).
 */

const mongoose = require('mongoose');
const LeaveRegisterYear = require('../model/LeaveRegisterYear');
const Employee = require('../../employees/model/Employee');
const LeavePolicySettings = require('../../settings/model/LeavePolicySettings');
const dateCycleService = require('./dateCycleService');
const leaveRegisterYearService = require('./leaveRegisterYearService');
const leaveRegisterYearMonthlyApplyService = require('./leaveRegisterYearMonthlyApplyService');

function roundHalf(x) {
  const n = Number(x) || 0;
  if (n <= 0) return 0;
  return Math.round(n * 2) / 2;
}

function calculateClosingBalance(openingBalance, transactionData) {
  const { transactionType, days } = transactionData;
  const d = Number(days) || 0;
  if (transactionType === 'CREDIT') return openingBalance + d;
  if (transactionType === 'DEBIT' || transactionType === 'EXPIRY') return Math.max(0, openingBalance - d);
  if (transactionType === 'ADJUSTMENT') return d;
  if (transactionType === 'CARRY_FORWARD') return openingBalance + d;
  return openingBalance;
}

async function loadAllYearDocs(employeeId) {
  return LeaveRegisterYear.find({ employeeId }).sort({ financialYearStart: 1 }).exec();
}

function collectTxnRefsForLeaveType(docs, leaveType) {
  const refs = [];
  for (const doc of docs) {
    const months = doc.months || [];
    for (let mi = 0; mi < months.length; mi++) {
      const txs = months[mi].transactions || [];
      for (let ti = 0; ti < txs.length; ti++) {
        const tx = txs[ti];
        if (tx.leaveType === leaveType) {
          refs.push({ doc, mi, ti, tx });
        }
      }
    }
  }
  refs.sort((a, b) => {
    const da = new Date(a.tx.startDate).getTime();
    const db = new Date(b.tx.startDate).getTime();
    if (da !== db) return da - db;
    const aa = a.tx.at ? new Date(a.tx.at).getTime() : 0;
    const ab = b.tx.at ? new Date(b.tx.at).getTime() : 0;
    return aa - ab;
  });
  return refs;
}

async function syncEmployeeModelBalance(employeeId, leaveType, closingBalance) {
  const fieldMap = {
    EL: 'paidLeaves',
    CL: 'casualLeaves',
    SL: 'sickLeaves',
    ML: 'maternityLeaves',
    OD: 'onDutyLeaves',
    CCL: 'compensatoryOffs',
  };
  const field = fieldMap[leaveType] || 'paidLeaves';
  try {
    await Employee.findByIdAndUpdate(employeeId, { [field]: closingBalance });
  } catch (e) {
    console.error('[LeaveRegisterYearLedger] Employee balance sync failed:', e.message);
  }
}

async function recalculateRegisterBalances(employeeId, leaveType, fromDate) {
  const years = await loadAllYearDocs(employeeId);
  const refs = collectTxnRefsForLeaveType(years, leaveType);
  const fromMs = fromDate ? new Date(fromDate).getTime() : null;

  let startIdx = 0;
  let currentBalance = 0;
  if (fromMs != null) {
    for (; startIdx < refs.length; startIdx++) {
      const t = new Date(refs[startIdx].tx.startDate).getTime();
      if (t >= fromMs) break;
      currentBalance = Number(refs[startIdx].tx.closingBalance) || 0;
    }
  }

  const dirty = new Set();
  for (let i = startIdx; i < refs.length; i++) {
    const { doc, mi, tx } = refs[i];
    tx.openingBalance = currentBalance;
    tx.closingBalance = calculateClosingBalance(currentBalance, tx);
    currentBalance = tx.closingBalance;
    dirty.add(doc);
    doc.markModified(`months.${mi}.transactions`);
  }

  for (const doc of dirty) {
    await doc.save();
  }

  const finalBalance = refs.length === 0 ? 0 : currentBalance;
  if (leaveType === 'CL' || leaveType === 'CCL' || leaveType === 'EL') {
    const latest = await LeaveRegisterYear.findOne({ employeeId }).sort({ financialYearStart: -1 });
    if (latest) {
      if (leaveType === 'CL') latest.casualBalance = finalBalance;
      if (leaveType === 'CCL') latest.compensatoryOffBalance = finalBalance;
      if (leaveType === 'EL') latest.earnedLeaveBalance = finalBalance;
      await latest.save();
    }
  }
  await syncEmployeeModelBalance(employeeId, leaveType, finalBalance);

  // Trigger monthly summary recalculation to apply potential capping changes
  try {
    const summaryCalculationService = require('../../attendance/services/summaryCalculationService');
    summaryCalculationService.recalculateOnLeaveRegisterUpdate(employeeId, fromDate);
  } catch (err) {
    console.error('[LeaveRegisterYearLedger] Failed to trigger summary recalculation:', err.message);
  }

  return true;
}

async function ensureYearDocument(transactionData, periodInfo) {
  const fyName = periodInfo.financialYear.name;
  let doc = await LeaveRegisterYear.findOne({
    employeeId: transactionData.employeeId,
    financialYear: fyName,
  });
  if (doc) return doc;

  const employee = await Employee.findById(transactionData.employeeId)
    .select('_id emp_no employee_name doj compensatoryOffs')
    .lean();
  if (!employee) throw new Error('Employee not found');

  const { getMatchingExperienceTier } = require('./annualCLResetService');
  const settings = await LeavePolicySettings.getSettings();
  const defaultCL = settings.annualCLReset?.resetToBalance ?? 12;
  const { tier, defaultCL: dc } = getMatchingExperienceTier(settings, employee.doj, transactionData.startDate);
  const monthlyGrid = leaveRegisterYearService.normalizeTierMonthlyCredits(
    tier || { casualLeave: dc ?? defaultCL },
    dc ?? defaultCL
  );
  const { fy, months } = await leaveRegisterYearService.buildYearMonthSlots(
    transactionData.startDate,
    monthlyGrid,
    employee.doj,
    {}
  );

  const monthsWithTx = months.map((m) => ({
    ...m,
    transactions: [],
  }));

  try {
    doc = await LeaveRegisterYear.create({
      employeeId: employee._id,
      empNo: transactionData.empNo || employee.emp_no,
      employeeName: transactionData.employeeName || employee.employee_name || '',
      financialYear: fy.name,
      financialYearStart: fy.startDate,
      financialYearEnd: fy.endDate,
      casualBalance: 0,
      compensatoryOffBalance: Number(employee.compensatoryOffs) || 0,
      earnedLeaveBalance: Number(employee.paidLeaves) || 0,
      months: monthsWithTx,
      yearlyTransactions: [],
      resetAt: transactionData.startDate,
      source: 'MANUAL',
    });
  } catch (e) {
    if (e && e.code === 11000) {
      doc = await LeaveRegisterYear.findOne({
        employeeId: transactionData.employeeId,
        financialYear: fyName,
      });
    } else {
      throw e;
    }
  }
  return doc;
}

function findMonthIndex(doc, payrollMonth, payrollYear) {
  const months = doc.months || [];
  const pm = Number(payrollMonth);
  const py = Number(payrollYear);
  const idx = months.findIndex(
    (m) => Number(m.payrollCycleMonth) === pm && Number(m.payrollCycleYear) === py
  );
  if (idx >= 0) return idx;
  return months.length > 0 ? 0 : -1;
}

async function addTransaction(transactionData) {
  const periodInfo = await dateCycleService.getPeriodInfo(transactionData.startDate);
  const doc = await ensureYearDocument(transactionData, periodInfo);
  const mi = findMonthIndex(doc, periodInfo.payrollCycle.month, periodInfo.payrollCycle.year);
  if (mi < 0) {
    throw new Error('LeaveRegisterYear has no month slots for this financial year.');
  }

  if (!doc.months[mi].transactions) doc.months[mi].transactions = [];

  // Keep the "monthly apply pool" (slot.clCredits/compensatoryOffs/elCredits) in sync
  // with ledger CREDIT postings. This is required so monthlyLeaveApplicationCap
  // recomputations reflect CCL credits (e.g. holiday/week-off OD CO credit).
  const leaveTypeUpper = String(transactionData.leaveType || '').toUpperCase();
  const txTypeUpper = String(transactionData.transactionType || '').toUpperCase();
  const creditDays = roundHalf(Number(transactionData.days) || 0);

  if (txTypeUpper === 'CREDIT' && creditDays > 0) {
    if (leaveTypeUpper === 'CL') {
      doc.yearlyClCreditDaysPosted = roundHalf((Number(doc.yearlyClCreditDaysPosted) || 0) + creditDays);
    }
    if (leaveTypeUpper === 'CCL') {
      doc.yearlyCclCreditDaysPosted = roundHalf((Number(doc.yearlyCclCreditDaysPosted) || 0) + creditDays);
      const curPool = roundHalf(Number(doc.months[mi].compensatoryOffs) || 0);
      doc.months[mi].compensatoryOffs = roundHalf(curPool + creditDays);
    }
  }

  doc.months[mi].transactions.push({
    at: new Date(),
    leaveType: transactionData.leaveType,
    transactionType: transactionData.transactionType,
    days: Number(transactionData.days) || 0,
    openingBalance: 0,
    closingBalance: 0,
    startDate: transactionData.startDate,
    endDate: transactionData.endDate,
    reason: transactionData.reason || '',
    applicationId: transactionData.applicationId,
    applicationDate: transactionData.applicationDate,
    approvalDate: transactionData.approvalDate,
    approvedBy: transactionData.approvedBy,
    status: transactionData.status || 'APPROVED',
    autoGenerated: !!transactionData.autoGenerated,
    autoGeneratedType: transactionData.autoGeneratedType || null,
    includedInPayroll: !!transactionData.includedInPayroll,
    payrollBatchId: transactionData.payrollBatchId,
    calculationBreakdown: transactionData.calculationBreakdown,
    pendingLeavesBeforeAction: transactionData.pendingLeavesBeforeAction,
    divisionId: transactionData.divisionId,
    departmentId: transactionData.departmentId,
  });

  doc.markModified(`months.${mi}.transactions`);
  doc.markModified(`months.${mi}`);
  await doc.save();

  await recalculateRegisterBalances(
    transactionData.employeeId,
    transactionData.leaveType,
    transactionData.startDate
  );

  // Any ledger CREDIT can change the effective monthly apply pool (or at minimum
  // the UI cached ceiling/consumption). Force an immediate sync so the UI updates
  // right after credit posting.
  if (txTypeUpper === 'CREDIT') {
    await leaveRegisterYearMonthlyApplyService.syncStoredMonthApplyFieldsForEmployeeDate(
      transactionData.employeeId,
      transactionData.startDate
    );
  } else {
    leaveRegisterYearMonthlyApplyService.scheduleSyncMonthApply(
      transactionData.employeeId,
      transactionData.startDate
    );
  }

  // Trigger monthly summary recalculation to apply potential capping changes
  try {
    const summaryCalculationService = require('../../attendance/services/summaryCalculationService');
    summaryCalculationService.recalculateOnLeaveRegisterUpdate(transactionData.employeeId, transactionData.startDate);
  } catch (err) {
    console.error('[LeaveRegisterYearLedger] Failed to trigger summary recalculation:', err.message);
  }

  const reloaded = await LeaveRegisterYear.findById(doc._id);
  const slot = reloaded.months[mi];
  const saved = slot.transactions[slot.transactions.length - 1];
  const plain = saved.toObject ? saved.toObject() : { ...saved };

  return {
    ...plain,
    month: periodInfo.payrollCycle.month,
    year: periodInfo.payrollCycle.year,
    financialYear: periodInfo.financialYear.name,
    payrollCycleStart: periodInfo.payrollCycle.startDate,
    payrollCycleEnd: periodInfo.payrollCycle.endDate,
    financialYearStart: periodInfo.financialYear.startDate,
    financialYearEnd: periodInfo.financialYear.endDate,
    employeeId: transactionData.employeeId,
    empNo: transactionData.empNo,
    employeeName: transactionData.employeeName,
    designation: transactionData.designation,
    department: transactionData.department,
    divisionName: transactionData.divisionName,
    dateOfJoining: transactionData.dateOfJoining,
    employmentStatus: transactionData.employmentStatus,
  };
}

function flattenYearDocsToLegacyTransactions(yearDocs, employeeById) {
  const out = [];
  for (const yd of yearDocs) {
    const emp = employeeById.get(yd.employeeId.toString()) || {};
    const designation = emp.designation_id?.name || emp.designation || 'N/A';
    const department = emp.department_id?.name || emp.department || 'N/A';
    const divisionName = emp.division_id?.name || 'N/A';

    for (const slot of yd.months || []) {
      const pm = slot.payrollCycleMonth;
      const py = slot.payrollCycleYear;
      for (const tx of slot.transactions || []) {
        const o = tx.toObject ? tx.toObject() : { ...tx };
        out.push({
          ...o,
          employeeId: {
            _id: yd.employeeId,
            id: yd.employeeId,
            empNo: yd.empNo,
            name: yd.employeeName || emp.employee_name,
            designation,
            department,
            division: divisionName,
            doj: emp.doj,
            status: emp.is_active ? 'active' : 'inactive',
          },
          empNo: yd.empNo,
          employeeName: yd.employeeName || emp.employee_name,
          designation,
          department,
          divisionName,
          dateOfJoining: emp.doj,
          employmentStatus: emp.is_active ? 'active' : 'inactive',
          month: pm,
          year: py,
          financialYear: yd.financialYear,
          payrollCycleStart: slot.payPeriodStart,
          payrollCycleEnd: slot.payPeriodEnd,
          financialYearStart: yd.financialYearStart,
          financialYearEnd: yd.financialYearEnd,
          divisionId: o.divisionId || emp.division_id?._id || emp.division_id,
          departmentId: o.departmentId || emp.department_id?._id || emp.department_id,
        });
      }
    }
  }
  return out;
}

async function findYearDocsForRegisterFilters(filters, fyName) {
  const q = { financialYear: fyName };
  
  if (filters.employeeIds && Array.isArray(filters.employeeIds)) {
    q.employeeId = { $in: filters.employeeIds };
  } else if (filters.employeeId) {
    q.employeeId = filters.employeeId;
  }

  if (filters.empNo) {
    const e = await Employee.findOne({ emp_no: filters.empNo }).select('_id').lean();
    if (e) q.employeeId = e._id;
    else return [];
  }

  let docs = await LeaveRegisterYear.find(q).lean();
  if (filters.divisionId || filters.departmentId) {
    const empQ = { is_active: true };
    if (filters.divisionId) empQ.division_id = filters.divisionId;
    if (filters.departmentId) empQ.department_id = filters.departmentId;
    const allowed = await Employee.find(empQ).select('_id').lean();
    const set = new Set(allowed.map((x) => x._id.toString()));
    docs = docs.filter((d) => set.has(d.employeeId.toString()));
  }
  return docs;
}

async function getCurrentBalance(employeeId, leaveType, asOfDate = new Date()) {
  const years = await LeaveRegisterYear.find({ employeeId }).sort({ financialYearStart: 1 }).lean();
  const list = [];
  for (const y of years) {
    for (const slot of y.months || []) {
      for (const tx of slot.transactions || []) {
        if (tx.leaveType === leaveType) list.push(tx);
      }
    }
  }
  list.sort((a, b) => {
    const da = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
    if (da !== 0) return da;
    const aa = a.at ? new Date(a.at).getTime() : 0;
    const ab = b.at ? new Date(b.at).getTime() : 0;
    return aa - ab;
  });
  const target = new Date(asOfDate).getTime();
  let bestClosing = 0;
  let bestEnd = -Infinity;
  for (const tx of list) {
    const end = new Date(tx.endDate).getTime();
    if (end <= target && end >= bestEnd) {
      bestEnd = end;
      bestClosing = Number(tx.closingBalance) || 0;
    }
  }
  // No ledger rows for this type (e.g. leave_register_years wiped) — use Employee snapshot so preview / carry still make sense
  if (list.length === 0 && ['CL', 'EL', 'CCL'].includes(leaveType)) {
    const emp = await Employee.findById(employeeId).select('casualLeaves paidLeaves compensatoryOffs').lean();
    if (!emp) return 0;
    if (leaveType === 'CL') return Math.max(0, Number(emp.casualLeaves) || 0);
    if (leaveType === 'EL') return Math.max(0, Number(emp.paidLeaves) || 0);
    if (leaveType === 'CCL') return Math.max(0, Number(emp.compensatoryOffs) || 0);
  }
  return bestClosing;
}

/**
 * CL/EL/CCL balance from LeaveRegisterYear transactions only (no Employee fallback).
 * Use for initial-sync carry so stale employee.casualLeaves does not invent carry after register wipe.
 */
async function getCurrentBalanceLedgerOnly(employeeId, leaveType, asOfDate = new Date()) {
  const years = await LeaveRegisterYear.find({ employeeId }).sort({ financialYearStart: 1 }).lean();
  const list = [];
  for (const y of years) {
    for (const slot of y.months || []) {
      for (const tx of slot.transactions || []) {
        if (tx.leaveType === leaveType) list.push(tx);
      }
    }
  }
  list.sort((a, b) => {
    const da = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
    if (da !== 0) return da;
    const aa = a.at ? new Date(a.at).getTime() : 0;
    const ab = b.at ? new Date(b.at).getTime() : 0;
    return aa - ab;
  });
  const target = new Date(asOfDate).getTime();
  let bestClosing = 0;
  let bestEnd = -Infinity;
  for (const tx of list) {
    const end = new Date(tx.endDate).getTime();
    if (end <= target && end >= bestEnd) {
      bestEnd = end;
      bestClosing = Number(tx.closingBalance) || 0;
    }
  }
  return bestClosing;
}

async function hasEarnedLeaveCreditInMonth(employeeId, financialYear, payrollMonth, payrollYear) {
  const doc = await LeaveRegisterYear.findOne({ employeeId, financialYear }).lean();
  if (!doc) return false;
  const slot = (doc.months || []).find(
    (m) =>
      Number(m.payrollCycleMonth) === Number(payrollMonth) &&
      Number(m.payrollCycleYear) === Number(payrollYear)
  );
  if (!slot?.transactions?.length) return false;
  return slot.transactions.some(
    (t) =>
      t.leaveType === 'EL' &&
      t.transactionType === 'CREDIT' &&
      t.autoGeneratedType === 'EARNED_LEAVE'
  );
}

module.exports = {
  addTransaction,
  recalculateRegisterBalances,
  getCurrentBalance,
  getCurrentBalanceLedgerOnly,
  flattenYearDocsToLegacyTransactions,
  findYearDocsForRegisterFilters,
  hasEarnedLeaveCreditInMonth,
  calculateClosingBalance,
};
