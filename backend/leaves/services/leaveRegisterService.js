const mongoose = require('mongoose');
const leaveRegisterYearLedgerService = require('./leaveRegisterYearLedgerService');
const Employee = require('../../employees/model/Employee');
const Leave = require('../model/Leave');
const LeaveSplit = require('../model/LeaveSplit');
const LeaveSettings = require('../model/LeaveSettings');
const LeavePolicySettings = require('../../settings/model/LeavePolicySettings');
const { extractISTComponents, createISTDate } = require('../../shared/utils/dateUtils');
const LeaveRegisterYear = require('../model/LeaveRegisterYear');
const {
    CAP_COUNT_STATUSES,
    computeScheduledPoolApplyCeiling,
    addLeaveCapToMonthlyBuckets,
    finalizePendingLockedDisplayByPool,
    getConfiguredMonthlyTypeCap,
} = require('./monthlyApplicationCapService');

/**
 * Mongo / legacy rows sometimes omit nested leave buckets; avoid "cannot read casualLeave of undefined".
 */
function ensureMonthlySubLedgerShape(sub) {
    if (!sub || typeof sub !== 'object') {
        return sub;
    }
    if (!sub.casualLeave || typeof sub.casualLeave !== 'object') {
        sub.casualLeave = {
            openingBalance: 0,
            accruedThisMonth: 0,
            earnedCCL: 0,
            usedThisMonth: 0,
            expired: 0,
            balance: 0,
            carryForward: 0,
            adjustments: 0,
        };
    }
    if (!sub.earnedLeave || typeof sub.earnedLeave !== 'object') {
        sub.earnedLeave = {
            openingBalance: 0,
            accruedThisMonth: 0,
            usedThisMonth: 0,
            balance: 0,
            adjustments: 0,
        };
    }
    if (!sub.compensatoryOff || typeof sub.compensatoryOff !== 'object') {
        sub.compensatoryOff = {
            openingBalance: 0,
            earned: 0,
            used: 0,
            expired: 0,
            balance: 0,
            adjustments: 0,
        };
    }
    return sub;
}

/** Payroll cycle end is labeled by (year, month). Positive if (yA,mA) is strictly after (yB,mB). */
function comparePayrollCyclePeriod(yearA, monthA, yearB, monthB) {
    if (yearA !== yearB) return yearA - yearB;
    return monthA - monthB;
}

/** True when this slot is a payroll period after `cap` (typically today's cycle) — no running balance carry into these rows for UI. */
function isPayrollPeriodStrictlyAfter(month, year, cap) {
    if (!cap || cap.month == null || cap.year == null) return false;
    return comparePayrollCyclePeriod(year, month, cap.year, cap.month) > 0;
}

function gateMonthSlotEditFlags(flags) {
    if (flags.allowEditMonth === false) {
        return {
            allowEditMonth: false,
            allowEditClCredits: false,
            allowEditCclCredits: false,
            allowEditElCredits: false,
            allowEditPolicyLock: false,
            allowEditUsedCl: false,
            allowEditUsedCcl: false,
            allowEditUsedEl: false,
            allowCarryUnusedToNextMonth: false,
        };
    }
    return { ...flags, allowEditMonth: flags.allowEditMonth !== false };
}

function resolveMonthSlotEditFlags(policyDoc, payrollMonthIndex) {
    const allow = (v) => v !== false;
    const cfg = policyDoc?.leaveRegisterMonthSlotEdit || {};
    const flat = cfg || {};
    const defaults = cfg?.defaults || {};
    const base = {
        allowEditMonth: allow(defaults.allowEditMonth ?? flat.allowEditMonth),
        allowEditClCredits: allow(defaults.allowEditClCredits ?? flat.allowEditClCredits),
        allowEditCclCredits: allow(defaults.allowEditCclCredits ?? flat.allowEditCclCredits),
        allowEditElCredits: allow(defaults.allowEditElCredits ?? flat.allowEditElCredits),
        allowEditPolicyLock: allow(defaults.allowEditPolicyLock ?? flat.allowEditPolicyLock),
        allowEditUsedCl: allow(defaults.allowEditUsedCl ?? flat.allowEditUsedCl),
        allowEditUsedCcl: allow(defaults.allowEditUsedCcl ?? flat.allowEditUsedCcl),
        allowEditUsedEl: allow(defaults.allowEditUsedEl ?? flat.allowEditUsedEl),
        allowCarryUnusedToNextMonth: allow(
            defaults.allowCarryUnusedToNextMonth ?? flat.allowCarryUnusedToNextMonth
        ),
    };
    const key = String(Number(payrollMonthIndex) || '');
    const override =
        key &&
        cfg?.byPayrollMonthIndex &&
        typeof cfg.byPayrollMonthIndex === 'object'
            ? cfg.byPayrollMonthIndex[key]
            : null;
    if (!override || typeof override !== 'object') return gateMonthSlotEditFlags(base);
    const merged = {
        ...base,
        allowEditMonth: allow(
            override.allowEditMonth != null ? override.allowEditMonth : base.allowEditMonth
        ),
        allowEditClCredits: allow(
            override.allowEditClCredits != null ? override.allowEditClCredits : base.allowEditClCredits
        ),
        allowEditCclCredits: allow(
            override.allowEditCclCredits != null ? override.allowEditCclCredits : base.allowEditCclCredits
        ),
        allowEditElCredits: allow(
            override.allowEditElCredits != null ? override.allowEditElCredits : base.allowEditElCredits
        ),
        allowEditPolicyLock: allow(
            override.allowEditPolicyLock != null ? override.allowEditPolicyLock : base.allowEditPolicyLock
        ),
        allowEditUsedCl: allow(
            override.allowEditUsedCl != null ? override.allowEditUsedCl : base.allowEditUsedCl
        ),
        allowEditUsedCcl: allow(
            override.allowEditUsedCcl != null ? override.allowEditUsedCcl : base.allowEditUsedCcl
        ),
        allowEditUsedEl: allow(
            override.allowEditUsedEl != null ? override.allowEditUsedEl : base.allowEditUsedEl
        ),
        allowCarryUnusedToNextMonth: allow(
            override.allowCarryUnusedToNextMonth != null
                ? override.allowCarryUnusedToNextMonth
                : base.allowCarryUnusedToNextMonth
        ),
    };
    return gateMonthSlotEditFlags(merged);
}

/** First calendar month (1–12) of FY period 1 — must match DateCycleService FY + settings grid order. */
function effectiveFyStartMonthForPayrollIndex(policyDoc) {
    const fy = policyDoc?.financialYear;
    if (fy && fy.useCalendarYear === true) return 1;
    const m = Number(fy?.startMonth);
    if (Number.isFinite(m) && m >= 1 && m <= 12) return m;
    return 4;
}

function derivePolicyMonthIndexFromCycleMonth(slot, policyDoc) {
    const startMonth = effectiveFyStartMonthForPayrollIndex(policyDoc);
    const pcm = Number(slot?.payrollCycleMonth);
    if (!Number.isFinite(pcm) || pcm < 1 || pcm > 12) {
        return Number(slot?.payrollMonthIndex) || 1;
    }
    return ((pcm - startMonth + 12) % 12) + 1;
}

function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

function istDateKey(d) {
    return extractISTComponents(d).dateStr;
}

function overlapDaysInclusiveIST(aStart, aEnd, bStart, bEnd) {
    const aS = istDateKey(aStart);
    const aE = istDateKey(aEnd);
    const bS = istDateKey(bStart);
    const bE = istDateKey(bEnd);
    const s = aS > bS ? aS : bS;
    const e = aE < bE ? aE : bE;
    if (e < s) return 0;
    const sd = createISTDate(s);
    const ed = createISTDate(e);
    return Math.floor((ed.getTime() - sd.getTime()) / 86400000) + 1;
}

function normalizedDays(n, isHalfDay = false) {
    const v = Number(n);
    if (Number.isFinite(v) && v > 0) return v;
    return isHalfDay ? 0.5 : 1;
}

async function buildClUsedLockedAuditForSlot(employeeId, slotStart, slotEnd) {
    if (!employeeId || !slotStart || !slotEnd) {
        return { used: [], locked: [] };
    }
    const intermediateStatuses = (CAP_COUNT_STATUSES || []).filter((s) => s !== 'approved');
    const leaves = await Leave.find({
        employeeId,
        isActive: { $ne: false },
        leaveType: /^CL$/i,
        status: { $in: CAP_COUNT_STATUSES || [] },
        fromDate: { $lte: slotEnd },
        toDate: { $gte: slotStart },
    })
        .select('_id leaveType status splitStatus fromDate toDate numberOfDays')
        .lean();
    if (!leaves.length) return { used: [], locked: [] };

    const splitLeaveIds = leaves
        .filter((lv) => String(lv?.splitStatus || '').toLowerCase() === 'split_approved' && lv?._id)
        .map((lv) => lv._id);
    const splits = splitLeaveIds.length
        ? await LeaveSplit.find({
              leaveId: { $in: splitLeaveIds },
              status: 'approved',
              leaveType: /^CL$/i,
              date: { $gte: slotStart, $lte: slotEnd },
          })
              .select('leaveId date numberOfDays isHalfDay')
              .lean()
        : [];
    const splitsByLeave = new Map();
    for (const s of splits) {
        const k = String(s.leaveId);
        const arr = splitsByLeave.get(k) || [];
        arr.push(s);
        splitsByLeave.set(k, arr);
    }

    const used = [];
    const locked = [];
    for (const lv of leaves) {
        const st = String(lv?.status || '').toLowerCase();
        const isUsed = st === 'approved';
        const isLocked = intermediateStatuses.includes(st);
        if (!isUsed && !isLocked) continue;

        let contributed = 0;
        let source = 'leave';
        const splitRows = splitsByLeave.get(String(lv?._id)) || [];
        const isSplitApproved = String(lv?.splitStatus || '').toLowerCase() === 'split_approved';
        if (splitRows.length > 0) {
            source = 'split';
            for (const sp of splitRows) {
                contributed += normalizedDays(sp.numberOfDays, !!sp.isHalfDay);
            }
        } else if (!isSplitApproved) {
            const from = new Date(lv.fromDate);
            const to = new Date(lv.toDate);
            const overlapDays = overlapDaysInclusiveIST(from, to, slotStart, slotEnd);
            if (overlapDays > 0) {
                const leaveSpanDays = Math.max(1, overlapDaysInclusiveIST(from, to, from, to));
                const leaveDays = Number(lv.numberOfDays) || 0;
                if (leaveDays > 0) contributed += round2((leaveDays * overlapDays) / leaveSpanDays);
            }
        }
        contributed = round2(contributed);
        if (contributed <= 0) continue;

        const item = {
            leaveId: String(lv._id),
            leaveType: String(lv.leaveType || 'CL').toUpperCase(),
            status: st,
            appliedFrom: lv.fromDate,
            appliedTo: lv.toDate,
            requestDays: Number(lv.numberOfDays) || 0,
            contributedDays: contributed,
            source,
        };
        if (isUsed) used.push(item);
        else locked.push(item);
    }

    const sortByFrom = (a, b) =>
        new Date(a?.appliedFrom || 0).getTime() - new Date(b?.appliedFrom || 0).getTime();
    used.sort(sortByFrom);
    locked.sort(sortByFrom);
    return { used, locked };
}

/**
 * Leave Register Service
 * Manages complete ledger of all leave transactions with audit transparency
 */

class LeaveRegisterService {
    /**
     * Add leave transaction to register
     */
    async addTransaction(transactionData) {
        try {
            return await leaveRegisterYearLedgerService.addTransaction(transactionData);
        } catch (error) {
            if (error.name === 'ValidationError') {
                console.error('[LeaveRegisterYear] ValidationError fields:', Object.keys(error.errors || {}).join(', '));
            }
            console.error('Error adding leave transaction:', error.message);
            throw error;
        }
    }

    /**
     * Add earned leave credit (auto-generated)
     */
    async addEarnedLeaveCredit(employeeId, elEarned, month, year, calculationBreakdown = null, cycleEnd = null) {
        try {
            const employee = await Employee.findById(employeeId);
            if (!employee) throw new Error('Employee not found');

            // Use provided cycleEnd date, else fallback to 15th of month to locate the correct payroll cycle.
            const cycleDate = cycleEnd || new Date(year, month - 1, 15);

            const transactionData = {
                employeeId,
                empNo: employee.emp_no,
                employeeName: employee.employee_name || 'N/A',
                designation: employee.designation || 'N/A',
                department: employee.department || 'N/A',
                divisionId: employee.division_id,
                departmentId: employee.department_id,
                dateOfJoining: employee.doj,
                employmentStatus: employee.is_active ? 'active' : 'inactive',

                leaveType: 'EL',
                transactionType: 'CREDIT',
                startDate: cycleDate, // addTransaction handles cycle categorization based on this
                endDate: cycleDate,
                days: elEarned,
                reason: 'Earned Leave - Auto Credit',
                status: 'APPROVED',

                autoGenerated: true,
                autoGeneratedType: 'EARNED_LEAVE',
                calculationBreakdown
            };

            return await this.addTransaction(transactionData);
        } catch (error) {
            console.error('Error adding earned leave credit:', error);
            throw error;
        }
    }

    /**
     * Add leave debit (when leave is availed)
     * Supports smart priority-based substitution (CL > CCL > EL) for CL applications.
     * @param {Object} leaveRecord - The approved leave document
     * @param {mongoose.Types.ObjectId} [approvedByUserId] - User ID of the approver
     */
    async addLeaveDebit(leaveRecord, approvedByUserId = null) {
        try {
            const employee = await Employee.findById(leaveRecord.employeeId)
                .populate('department_id', 'name')
                .populate('designation_id', 'name');
            if (!employee) throw new Error('Employee not found');

            const employeeName = employee.employee_name || 'N/A';
            const designation = (employee.designation_id && employee.designation_id.name) || employee.designation?.name || 'N/A';
            const department = (employee.department_id && employee.department_id.name) || employee.department?.name || 'N/A';

            const originalLeaveType = leaveRecord.leaveType === 'LOP' ? 'LOP' : (leaveRecord.leaveType || 'CL');
            const statusUpper = String(leaveRecord.status || 'approved').toUpperCase();
            const status = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(statusUpper) ? statusUpper : 'APPROVED';
            const approvedBy = approvedByUserId && mongoose.Types.ObjectId.isValid(approvedByUserId) ? approvedByUserId : undefined;

            // --- SMART DEDUCTION LOGIC FOR CL ---
            let clEntry = undefined;
            let useCCL = false;
            let useEL = false;

            if (originalLeaveType === 'CL') {
                const settings = await LeaveSettings.getActiveSettings('leave');
                const isCCLHidden = !settings?.types?.some(t => t.code === 'CCL' && t.isActive);
                const isELHidden = !settings?.types?.some(t => t.code === 'EL' && t.isActive);
                useCCL = isCCLHidden;
                useEL = isELHidden;

                const dateCycleService = require('./dateCycleService');
                const periodInfo = await dateCycleService.getPeriodInfo(leaveRecord.fromDate);
                
                // Fetch current limits/balances snapshot for ALL relevant types (no leaveType filter)
                const registerResult = await this.getLeaveRegister(
                    { employeeId: leaveRecord.employeeId, balanceAsOf: true },
                    periodInfo.payrollCycle.month,
                    periodInfo.payrollCycle.year
                );
                const registerList = (Array.isArray(registerResult) ? registerResult : (registerResult?.data || []));
                const empEntry = registerList[0]; // We filtered by employeeId
                clEntry = empEntry?.monthlySubLedgers?.find(s => s.month === periodInfo.payrollCycle.month && s.year === periodInfo.payrollCycle.year);

                if (useCCL || useEL) {
                    const clBalFromRegister = Number(clEntry?.casualLeave?.balance);
                    const clCap = Number.isFinite(clBalFromRegister)
                        ? Math.max(0, clBalFromRegister)
                        : await this.getCurrentBalance(leaveRecord.employeeId, 'CL', leaveRecord.fromDate);
                    const totalDaysRequested = leaveRecord.numberOfDays;
                    
                    let remainingToDeduct = totalDaysRequested;
                    const deductions = [];

                    // 1. CL (Priority 1)
                    if (remainingToDeduct > 0) {
                        const clSpend = Math.min(remainingToDeduct, clCap);
                        if (clSpend > 0) {
                            deductions.push({ type: 'CL', days: clSpend, reason: leaveRecord.purpose });
                            remainingToDeduct -= clSpend;
                        }
                    }

                    // 2. CCL (Priority 2)
                    if (remainingToDeduct > 0 && useCCL) {
                        const cclBalance = await this.getCurrentBalance(leaveRecord.employeeId, 'CCL', leaveRecord.fromDate);
                        const cclSpend = Math.min(remainingToDeduct, cclBalance);
                        if (cclSpend > 0) {
                            deductions.push({ type: 'CCL', days: cclSpend, reason: `Substituted for CL Application: ${leaveRecord.purpose}` });
                            remainingToDeduct -= cclSpend;
                        }
                    }

                    // 3. EL (Priority 3)
                    if (remainingToDeduct > 0 && useEL) {
                        const elBalance = await this.getCurrentBalance(leaveRecord.employeeId, 'EL', leaveRecord.fromDate);
                        const elSpend = Math.min(remainingToDeduct, elBalance);
                        if (elSpend > 0) {
                            deductions.push({ type: 'EL', days: elSpend, reason: `Substituted for CL Application: ${leaveRecord.purpose}` });
                            remainingToDeduct -= elSpend;
                        }
                    }

                    // 4. Any leftover (Force back to CL if total limit allowed but specific hidden credits exhausted)
                    if (remainingToDeduct > 0) {
                        // Find if we already have a CL entry to merge, or add new
                        const clIdx = deductions.findIndex(d => d.type === 'CL');
                        if (clIdx > -1) deductions[clIdx].days += remainingToDeduct;
                        else deductions.push({ type: 'CL', days: remainingToDeduct, reason: leaveRecord.purpose });
                    }

                    // Execute Transactions
                    let lastResult = null;
                    for (const d of deductions) {
                        lastResult = await this.addTransaction({
                            employeeId: leaveRecord.employeeId,
                            empNo: employee.emp_no,
                            employeeName, designation, department,
                            divisionId: employee.division_id,
                            departmentId: employee.department_id,
                            dateOfJoining: employee.doj,
                            employmentStatus: employee.is_active ? 'active' : 'inactive',
                            leaveType: d.type,
                            transactionType: 'DEBIT',
                            startDate: leaveRecord.fromDate,
                            endDate: leaveRecord.toDate,
                            days: d.days,
                            applicationId: leaveRecord._id,
                            applicationDate: leaveRecord.createdAt,
                            approvalDate: leaveRecord.updatedAt,
                            approvedBy, status,
                            reason: d.reason,
                            pendingLeavesBeforeAction: clEntry?.pendingAllDays ?? 0
                        });
                    }
                    return lastResult;
                }
            }

            // Fallback: Standard single-type debit
            const transactionData = {
                employeeId: leaveRecord.employeeId,
                empNo: employee.emp_no,
                employeeName, designation, department,
                divisionId: employee.division_id,
                departmentId: employee.department_id,
                dateOfJoining: employee.doj,
                employmentStatus: employee.is_active ? 'active' : 'inactive',
                leaveType: originalLeaveType,
                transactionType: 'DEBIT',
                startDate: leaveRecord.fromDate,
                endDate: leaveRecord.toDate,
                days: leaveRecord.numberOfDays,
                applicationId: leaveRecord._id,
                applicationDate: leaveRecord.createdAt,
                approvalDate: leaveRecord.updatedAt,
                approvedBy, status,
                reason: leaveRecord.purpose,
                pendingLeavesBeforeAction: typeof clEntry !== 'undefined' ? (clEntry?.pendingAllDays ?? 0) : 0
            };

            return await this.addTransaction(transactionData);
        } catch (error) {
            console.error('Error adding leave debit:', error);
            throw error;
        }
    }

    /**
     * Reverse leave debit (when leave is cancelled/rejected)
     */
    async reverseLeaveDebit(leaveRecord, cancelledByUserId = null) {
        try {
            const employee = await Employee.findById(leaveRecord.employeeId)
                .populate('department_id', 'name')
                .populate('designation_id', 'name');
            if (!employee) throw new Error('Employee not found');

            const employeeName = employee.employee_name || 'N/A';
            const designation = (employee.designation_id && employee.designation_id.name) || employee.designation?.name || 'N/A';
            const department = (employee.department_id && employee.department_id.name) || employee.department?.name || 'N/A';

            const statusUpper = String(leaveRecord.status || 'cancelled').toUpperCase();
            const dateCycleService = require('./dateCycleService');
            const fy = await dateCycleService.getFinancialYearForDate(leaveRecord.fromDate);
            const yearDoc = await LeaveRegisterYear.findOne({
                employeeId: leaveRecord.employeeId,
                financialYear: fy.name,
            }).lean();

            /** One approved CL app can post multiple DEBIT rows (CL+CCL+EL substitution); reverse every matching row. */
            const matchingDebits = [];
            if (leaveRecord._id && yearDoc?.months?.length) {
                const appId = String(leaveRecord._id);
                for (const slot of yearDoc.months) {
                    for (const tx of slot.transactions || []) {
                        if (!tx?.applicationId || String(tx.applicationId) !== appId) continue;
                        if (String(tx.transactionType || '').toUpperCase() !== 'DEBIT') continue;
                        matchingDebits.push(tx);
                    }
                }
            }

            const base = {
                employeeId: leaveRecord.employeeId,
                empNo: employee.emp_no,
                employeeName,
                designation,
                department,
                divisionId: employee.division_id,
                departmentId: employee.department_id,
                dateOfJoining: employee.doj,
                employmentStatus: employee.is_active ? 'active' : 'inactive',
                applicationId: leaveRecord._id,
                applicationDate: leaveRecord.createdAt,
                approvalDate: new Date(),
                approvedBy: cancelledByUserId,
                status: statusUpper,
                reason: 'Leave Application Cancelled/Reversed',
            };

            if (matchingDebits.length > 0) {
                let lastResult = null;
                const ordered = [...matchingDebits].reverse();
                for (const tx of ordered) {
                    const lt = String(tx.leaveType || '').toUpperCase() === 'LOP' ? 'LOP' : String(tx.leaveType || 'CL');
                    lastResult = await this.addTransaction({
                        ...base,
                        leaveType: lt,
                        transactionType: 'CREDIT',
                        startDate: tx.startDate || leaveRecord.fromDate,
                        endDate: tx.endDate || leaveRecord.toDate,
                        days: Number(tx.days) || 0,
                    });
                }
                return lastResult;
            }

            const leaveType = leaveRecord.leaveType === 'LOP' ? 'LOP' : (leaveRecord.leaveType || 'CL');
            return await this.addTransaction({
                ...base,
                leaveType,
                transactionType: 'CREDIT',
                startDate: leaveRecord.fromDate,
                endDate: leaveRecord.toDate,
                days: leaveRecord.numberOfDays,
            });
        } catch (error) {
            console.error('Error reversing leave debit:', error);
            throw error;
        }
    }

    /**
     * Recalculate all balances for an employee's leave type from a specific start date.
     */
    async recalculateRegisterBalances(employeeId, leaveType, fromDate) {
        try {
            return await leaveRegisterYearLedgerService.recalculateRegisterBalances(employeeId, leaveType, fromDate);
        } catch (error) {
            console.error('Error recalculating register balances:', error);
            throw error;
        }
    }

    /**
     * Add an ADJUSTMENT transaction for an employee's leave balance.
     * Used by admin/HR to correct CL/other leave balances via the register adjust API.
     */
    async addAdjustment(employeeId, leaveType, days, reason) {
        try {
            const employee = await Employee.findById(employeeId)
                .select('_id emp_no employee_name designation_id department_id division_id doj is_active')
                .populate('designation_id', 'name')
                .populate('department_id', 'name')
                .populate('division_id', 'name');
            if (!employee) {
                throw new Error('Employee not found');
            }

            const employeeName = employee.employee_name || 'N/A';
            const designation = (employee.designation_id && employee.designation_id.name) || employee.designation?.name || 'N/A';
            const department = (employee.department_id && employee.department_id.name) || employee.department?.name || 'N/A';

            const now = new Date();
            const transactionData = {
                employeeId: employee._id,
                empNo: employee.emp_no,
                employeeName,
                designation,
                department,
                divisionId: employee.division_id,
                departmentId: employee.department_id,
                dateOfJoining: employee.doj,
                employmentStatus: employee.is_active ? 'active' : 'inactive',

                leaveType,
                transactionType: 'ADJUSTMENT',
                startDate: now,
                endDate: now,
                days,
                reason,
                status: 'APPROVED',
                autoGenerated: false
            };

            return await this.addTransaction(transactionData);
        } catch (error) {
            console.error('Error adding adjustment transaction:', error);
            throw error;
        }
    }

    /**
     * Record EL used in payroll (when batch is completed).
     * Debits employee's EL balance and marks transaction as included in payroll.
     * @param {string} employeeId - Employee ID
     * @param {number} days - EL days used in payroll
     * @param {string} month - Payroll month YYYY-MM
     * @param {ObjectId} [payrollBatchId] - Optional batch reference
     */
    async addELUsedInPayroll(employeeId, days, month, payrollBatchId = null) {
        if (!employeeId || days == null || days <= 0) return null;
        const employee = await Employee.findById(employeeId)
            .select('_id emp_no employee_name designation_id department_id division_id doj is_active')
            .populate('designation_id', 'name')
            .populate('department_id', 'name')
            .populate('division_id', 'name')
            .lean();
        if (!employee) {
            throw new Error('Employee not found');
        }
        const [y, m] = month.split('-').map(Number);
        const cycleDate = new Date(y, m - 1, 15);
        const periodInfo = await dateCycleService.getPeriodInfo(cycleDate);
        const designation = (employee.designation_id && employee.designation_id.name) || 'N/A';
        const department = (employee.department_id && employee.department_id.name) || 'N/A';
        const transactionData = {
            employeeId: employee._id,
            empNo: employee.emp_no,
            employeeName: employee.employee_name || 'N/A',
            designation,
            department,
            divisionId: employee.division_id,
            departmentId: employee.department_id,
            dateOfJoining: employee.doj,
            employmentStatus: employee.is_active ? 'active' : 'inactive',
            leaveType: 'EL',
            transactionType: 'DEBIT',
            startDate: periodInfo.payrollCycle.startDate,
            endDate: periodInfo.payrollCycle.endDate,
            days: Number(days),
            reason: 'Included in payroll',
            status: 'APPROVED',
            autoGenerated: true,
            autoGeneratedType: 'PAYROLL_USE',
            includedInPayroll: true,
            payrollBatchId: payrollBatchId || undefined
        };
        return await this.addTransaction(transactionData);
    }

    /**
     * Get leave register with filters
     */
    async getLeaveRegister(filters = {}, month = null, year = null) {
        try {
            const dateCycleService = require('./dateCycleService');
            const today = new Date();
            const baseYearNum = (year != null && year !== '') ? Number(year) : today.getFullYear();
            const baseMonthNum = (month != null && month !== '') ? Number(month) : (today.getMonth() + 1);
            const midOfMonth = new Date(baseYearNum, baseMonthNum - 1, 15);
            const periodInfo = await dateCycleService.getPeriodInfo(midOfMonth);

            /** List / multi-employee: omit transaction arrays to keep payloads small; single-employee detail keeps full txs. */
            const registerLite =
                !filters.employeeId &&
                !filters.empNo &&
                !filters.balanceAsOf;

            // Determine the financial year
            let fyName = filters.financialYear || periodInfo.financialYear.name;
            filters.financialYear = fyName;

            const yearDocs = await leaveRegisterYearLedgerService.findYearDocsForRegisterFilters(filters, fyName);

            // IMPORTANT: month ordering for register view must follow the selected FY, not current payroll context.
            let fyStart = null;
            if (Array.isArray(yearDocs) && yearDocs.length > 0 && yearDocs[0]?.financialYearStart) {
                fyStart = new Date(yearDocs[0].financialYearStart);
            } else {
                try {
                    const policy = await LeavePolicySettings.getSettings();
                    const useCalendarYear = !!policy?.financialYear?.useCalendarYear;
                    const startMonth = Number(policy?.financialYear?.startMonth) || 4;
                    const startDay = Number(policy?.financialYear?.startDay) || 1;
                    const fyText = String(fyName || '').trim();
                    if (fyText) {
                        if (useCalendarYear) {
                            const y = parseInt(fyText, 10);
                            if (Number.isFinite(y)) fyStart = new Date(y, 0, 1);
                        } else {
                            const startYear = parseInt(fyText.split('-')[0], 10);
                            if (Number.isFinite(startYear)) {
                                fyStart = new Date(startYear, Math.max(0, startMonth - 1), Math.max(1, startDay));
                            }
                        }
                    }
                } catch {
                    fyStart = null;
                }
            }
            if (!fyStart) {
                fyStart = periodInfo.financialYear.startDate;
            }

            const idSet = new Set(yearDocs.map((d) => d.employeeId.toString()));
            if (filters.employeeId) idSet.add(filters.employeeId.toString());
            const employeeIds = [...idSet];
            const employeesList =
                employeeIds.length > 0
                ? await Employee.find({ _id: { $in: employeeIds } })
                    .select('_id emp_no employee_name designation_id department_id division_id doj is_active')
                    .populate('designation_id', 'name')
                    .populate('department_id', 'name')
                    .populate('division_id', 'name')
                    .lean()
                : [];
            const empMap = new Map(employeesList.map((e) => [e._id.toString(), e]));

            let rawData = leaveRegisterYearLedgerService.flattenYearDocsToLegacyTransactions(yearDocs, empMap);

            const numMonth = month != null ? Number(month) : null;
            const numYear = year != null ? Number(year) : null;
            const balanceAsOf =
                filters.balanceAsOf &&
                (filters.employeeId || filters.empNo) &&
                numMonth != null &&
                numYear != null &&
                !Number.isNaN(numMonth) &&
                !Number.isNaN(numYear);
            if (balanceAsOf) {
                rawData = rawData.filter(
                    (t) => t.year < numYear || (t.year === numYear && t.month <= numMonth)
                );
            }

            if (filters.searchTerm && String(filters.searchTerm).trim()) {
                const term = String(filters.searchTerm).trim().toLowerCase();
                rawData = rawData.filter(
                    (t) =>
                        (t.employeeName || '').toLowerCase().includes(term) ||
                        (t.empNo || '').toLowerCase().includes(term) ||
                        (t.designation || '').toLowerCase().includes(term) ||
                        (t.department || '').toLowerCase().includes(term)
                );
            }

            const populatedData = rawData;

            // Group by employee and provide yearly ledger with monthly sub-ledgers
            // For UI month labels we must follow payroll-cycle month/year, not just calendar month.
            let monthsInOrderOverride = null;
            try {
                const dateCycleService = require('./dateCycleService');
                if (fyStart) {
                    const base = new Date(fyStart);
                    base.setDate(15);
                    monthsInOrderOverride = [];
                    for (let i = 0; i < 12; i++) {
                        const repDate = new Date(base);
                        repDate.setMonth(base.getMonth() + i);
                        repDate.setDate(15);
                        const periodInfo = await dateCycleService.getPeriodInfo(repDate);
                        const m = periodInfo.payrollCycle.month;
                        const y = periodInfo.payrollCycle.year;
                        monthsInOrderOverride.push({ month: m, year: y, key: `${y}-${m}` });
                    }
                }
            } catch (e) {
                // Fallback to old behavior if period resolution fails.
                monthsInOrderOverride = null;
            }

            const todayPeriodInfoForCarry = await dateCycleService.getPeriodInfo(today);
            let groupedData = this.groupByEmployeeYearly(
                populatedData,
                fyStart,
                monthsInOrderOverride,
                todayPeriodInfoForCarry.payrollCycle
            );



            // When viewing register for a month (not a single employee), ensure ALL active employees in scope are listed.
            if (!filters.employeeId && !filters.empNo && month && year) {
                const existingIds = new Set(groupedData.map((entry) => entry.employee?.id?.toString() || entry.employee?._id?.toString()).filter(Boolean));
                const empQuery = { is_active: true };
                
                // --- Apply data scope to extra employees ---
                if (filters.employeeIds && Array.isArray(filters.employeeIds)) {
                    empQuery._id = { $in: filters.employeeIds };
                }
                
                if (filters.divisionId) empQuery.division_id = filters.divisionId;
                if (filters.departmentId) empQuery.department_id = filters.departmentId;
                
                const extraEmployees = await Employee.find(empQuery)
                    .select('_id emp_no employee_name designation_id department_id division_id doj is_active casualLeaves paidLeaves compensatoryOffs')
                    .populate('designation_id', 'name')
                    .populate('department_id', 'name')
                    .populate('division_id', 'name')
                    .lean();

                for (const emp of extraEmployees) {
                    const idStr = emp._id.toString();
                    if (existingIds.has(idStr)) continue;
                    
                    const clBalance = typeof emp.casualLeaves === 'number' ? emp.casualLeaves : 0;
                    const elBalance = typeof emp.paidLeaves === 'number' ? emp.paidLeaves : 0;
                    const cclBalance = typeof emp.compensatoryOffs === 'number' ? emp.compensatoryOffs : 0;
                    
                    groupedData.push({
                        employee: {
                            id: emp._id,
                            empNo: emp.emp_no,
                            name: emp.employee_name,
                            designation: emp.designation_id?.name || 'N/A',
                            department: emp.department_id?.name || 'N/A',
                            division: emp.division_id?.name || 'N/A',
                            doj: emp.doj,
                            status: emp.is_active ? 'active' : 'inactive'
                        },
                        monthlySubLedgers: [{
                            month: Number(month),
                            year: Number(year),
                            casualLeave: { openingBalance: 0, accruedThisMonth: 0, earnedCCL: 0, usedThisMonth: 0, expired: 0, balance: clBalance, carryForward: 0 },
                            earnedLeave: { openingBalance: 0, accruedThisMonth: 0, usedThisMonth: 0, balance: elBalance },
                            compensatoryOff: { openingBalance: 0, earned: 0, used: 0, expired: 0, balance: cclBalance },
                            totalPaidBalance: clBalance + elBalance + cclBalance,
                            transactions: []
                        }]
                    });
                }
            }

            // When balance-as-of was requested for one employee and register has no transactions, fallback to Employee.casualLeaves
            if (filters.balanceAsOf && (filters.employeeId || filters.empNo) && groupedData.length === 0) {
                const emp = filters.employeeId
                    ? await Employee.findById(filters.employeeId)
                        .select('_id emp_no employee_name designation_id department_id division_id doj is_active casualLeaves paidLeaves compensatoryOffs')
                        .populate('designation_id', 'name')
                        .populate('department_id', 'name')
                        .populate('division_id', 'name')
                        .lean()
                    : await Employee.findOne({ emp_no: filters.empNo })
                        .select('_id emp_no employee_name designation_id department_id division_id doj is_active casualLeaves paidLeaves compensatoryOffs')
                        .populate('designation_id', 'name')
                        .populate('department_id', 'name')
                        .populate('division_id', 'name')
                        .lean();
                if (emp) {
                    const clBalance = typeof emp.casualLeaves === 'number' ? emp.casualLeaves : 0;
                    const elBalance = typeof emp.paidLeaves === 'number' ? emp.paidLeaves : 0;
                    const cclBalance = typeof emp.compensatoryOffs === 'number' ? emp.compensatoryOffs : 0;
                    groupedData = [{
                        employee: {
                            id: emp._id,
                            empNo: emp.emp_no,
                            name: emp.employee_name,
                            designation: emp.designation_id?.name || 'N/A',
                            department: emp.department_id?.name || 'N/A',
                            division: emp.division_id?.name || 'N/A',
                            doj: emp.doj,
                            status: emp.is_active ? 'active' : 'inactive'
                        },
                        monthlySubLedgers: [{
                            month: Number(month),
                            year: Number(year),
                            casualLeave: { openingBalance: 0, accruedThisMonth: 0, earnedCCL: 0, usedThisMonth: 0, expired: 0, balance: clBalance, carryForward: 0 },
                            earnedLeave: { openingBalance: 0, accruedThisMonth: 0, usedThisMonth: 0, balance: elBalance },
                            compensatoryOff: { openingBalance: 0, earned: 0, used: 0, expired: 0, balance: cclBalance },
                            totalPaidBalance: clBalance + elBalance + cclBalance,
                            transactions: []
                        }]
                    }];
                }
            }

            // Pending / in-flight leaves by payroll month (FY start → selected month).
            // "Locked" = not final `approved`, still counts toward monthly apply cap (same rules as monthlyApplicationCapService).
            const emptyCapBucket = () => ({
                pendingCapDaysInFlight: 0,
                capConsumedDays: 0,
                capApprovedDays: 0,
                capLockedDays: 0,
                /** Approved days toward per-type monthly caps (native application type). */
                approvedClCapDays: 0,
                approvedCclCapDays: 0,
                approvedElCapDays: 0,
                /** In-flight days by application leave type (before pool hierarchy → Lk columns). */
                lockedClAppDays: 0,
                lockedCclAppDays: 0,
                lockedElAppDays: 0,
                pendingLockedCL: 0,
                pendingLockedCCL: 0,
                pendingLockedEL: 0,
            });
            let capPolicy = {};
            try {
                capPolicy = await LeavePolicySettings.getSettings();
            } catch {
                capPolicy = {};
            }

            // Build payroll windows keyed exactly like the register grid month keys:
            // `${sub.year}-${sub.month}` (so per-type locked columns cannot drift).
            const uniqueSubMonths = new Map();
            for (const entry of groupedData) {
                for (const sub of entry.monthlySubLedgers || []) {
                    if (sub?.year == null || sub?.month == null) continue;
                    const key = `${sub.year}-${sub.month}`;
                    if (!uniqueSubMonths.has(key)) {
                        uniqueSubMonths.set(key, { year: Number(sub.year), month: Number(sub.month) });
                    }
                }
            }

            const monthPayrollWindows = [];
            for (const { year: smYear, month: smMonth } of uniqueSubMonths.values()) {
                const mid = new Date(smYear, smMonth - 1, 15);
                const pInfo = await dateCycleService.getPeriodInfo(mid);
                const pc = pInfo?.payrollCycle || {};
                monthPayrollWindows.push({
                    month: smMonth,
                    year: smYear,
                    key: `${smYear}-${smMonth}`,
                    start: pc.startDate,
                    end: pc.endDate,
                });
            }

            // Ensure deterministic ordering for window min/max computation.
            monthPayrollWindows.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

            const windowStartMs =
                monthPayrollWindows.length > 0 ? new Date(monthPayrollWindows[0].start).getTime() : null;
            const windowEndMs =
                monthPayrollWindows.length > 0
                    ? new Date(monthPayrollWindows[monthPayrollWindows.length - 1].end).getTime()
                    : null;

            const fyForSlots = filters.financialYear && String(filters.financialYear).trim();

            for (const entry of groupedData) {
                const empId = entry.employee?.id || entry.employee?._id;
                if (!empId) continue;

                const pendingByMonthKey = {};
                for (const w of monthPayrollWindows) {
                    pendingByMonthKey[w.key] = emptyCapBucket();
                }

                if (windowStartMs != null && windowEndMs != null) {
                    const capLeaves = await Leave.find({
                        employeeId: empId,
                        fromDate: { $gte: new Date(windowStartMs), $lte: new Date(windowEndMs) },
                        status: { $in: CAP_COUNT_STATUSES },
                        isActive: true,
                    })
                        .select('leaveType numberOfDays fromDate status splitStatus')
                        .lean();

                    for (const l of capLeaves) {
                        await addLeaveCapToMonthlyBuckets(l, capPolicy, monthPayrollWindows, pendingByMonthKey);
                    }
                }

                let yearDocLean = null;
                if (fyForSlots) {
                    yearDocLean = await LeaveRegisterYear.findOne({
                        employeeId: empId,
                        financialYear: fyForSlots,
                    })
                        .select('months')
                        .lean();
                }

                for (const sub of entry.monthlySubLedgers || []) {
                    ensureMonthlySubLedgerShape(sub);
                    const key = `${sub.year}-${sub.month}`;
                    const bucket = pendingByMonthKey[key] || emptyCapBucket();
                    const pendingCapDaysInFlight = bucket.pendingCapDaysInFlight;
                    const lockedClApp = Number(bucket.lockedClAppDays) || 0;
                    const slot =
                        yearDocLean?.months?.find(
                            (m) =>
                                Number(m.payrollCycleMonth) === Number(sub.month) &&
                                Number(m.payrollCycleYear) === Number(sub.year)
                        ) || null;
                    if (slot && finalizePendingLockedDisplayByPool(bucket, slot, capPolicy)) {
                        /* pendingLocked* set on bucket */
                    } else {
                        bucket.pendingLockedCL = lockedClApp;
                        bucket.pendingLockedCCL = Number(bucket.lockedCclAppDays) || 0;
                        bucket.pendingLockedEL = Number(bucket.lockedElAppDays) || 0;
                    }
                    sub.casualLeave.pendingThisMonth = lockedClApp;
                    sub.pendingAllDays = pendingCapDaysInFlight;
                    sub.pendingLockedCL = bucket.pendingLockedCL;
                    sub.pendingLockedCCL = bucket.pendingLockedCCL;
                    sub.pendingLockedEL = bucket.pendingLockedEL;
                    sub.capConsumedDays = bucket.capConsumedDays;
                    sub.capApprovedDays = bucket.capApprovedDays;
                    sub.capLockedDays = bucket.capLockedDays;
                    sub.approvedClCapDays = Number(bucket.approvedClCapDays) || 0;
                    sub.approvedCclCapDays = Number(bucket.approvedCclCapDays) || 0;
                    sub.approvedElCapDays = Number(bucket.approvedElCapDays) || 0;
                    const clBal = Number(sub.casualLeave?.balance) || 0;
                    const cclBal = Number(sub.compensatoryOff?.balance) || 0;
                    const elBal = Number(sub.earnedLeave?.balance) || 0;
                    sub.casualLeave.allowedRemaining = Math.max(0, clBal - lockedClApp);
                    sub.monthlyAllowedLimit = null;
                    sub.monthlyLimitPooled = null;
                    sub.casualLeave.monthlyCLLimit = null;
                    sub.casualLeave.clBalance = Math.max(0, clBal);
                    sub.compensatoryOff.cclBalance = Math.max(0, cclBal);
                    sub.compensatoryOff.isIncluded = true;
                    sub.earnedLeave.elBalance = Math.max(0, elBal);
                    sub.earnedLeave.isIncluded = true;
                }
            }

            await this.hydrateRegisterYearView(groupedData, filters.financialYear, {
                lite: registerLite,
            });

            return groupedData;
        } catch (error) {
            console.error('Error getting leave register:', error);
            throw error;
        }
    }

    /**
     * Canonical leave register view: LeaveRegisterYear.months[] drives the FY grid; each row merges
     * scheduled credits from the year doc with ledger aggregates + LeaveRegister transactions for that payroll month.
     * @param {object} options
     * @param {boolean} options.lite - Omit transaction arrays (list / multi-employee); keep transactionCount.
     */
    async hydrateRegisterYearView(groupedData, financialYear, options = {}) {
        const { lite = false } = options;
        if (!groupedData || groupedData.length === 0) {
            return groupedData;
        }
        let policy = {};
        try {
            policy = await LeavePolicySettings.getSettings();
        } catch {
            policy = {};
        }
        const fy = financialYear && String(financialYear).trim();
        const LeaveRegisterYear = require('../model/LeaveRegisterYear');
        let byEmp = new Map();
        if (fy) {
            const ids = groupedData.map((e) => e.employee?.id || e.employee?._id).filter(Boolean);
            if (ids.length > 0) {
                const docs = await LeaveRegisterYear.find({
                    financialYear: fy,
                    employeeId: { $in: ids },
                }).lean();
                byEmp = new Map(docs.map((d) => [d.employeeId.toString(), d]));
            }
        }

        const matchSub = (subs, pcm, pcy) =>
            subs.find(
                (s) =>
                    s &&
                    Number(s.month) === Number(pcm) &&
                    Number(s.year) === Number(pcy)
            );

        const ledgerSlice = (sub) => ({
            casualLeave: sub?.casualLeave ? { ...sub.casualLeave } : {},
            earnedLeave: sub?.earnedLeave ? { ...sub.earnedLeave } : {},
            compensatoryOff: sub?.compensatoryOff ? { ...sub.compensatoryOff } : {},
            totalPaidBalance: sub?.totalPaidBalance ?? 0,
            monthlyAllowedLimit: sub?.monthlyAllowedLimit,
            monthlyLimitPooled: sub?.monthlyLimitPooled,
            pendingAllDays: sub?.pendingAllDays,
            pendingLockedCL: sub?.pendingLockedCL,
            pendingLockedCCL: sub?.pendingLockedCCL,
            pendingLockedEL: sub?.pendingLockedEL,
            capConsumedDays: sub?.capConsumedDays,
            capApprovedDays: sub?.capApprovedDays,
            capLockedDays: sub?.capLockedDays,
            approvedClCapDays: sub?.approvedClCapDays,
            approvedCclCapDays: sub?.approvedCclCapDays,
            approvedElCapDays: sub?.approvedElCapDays,
        });

        for (const entry of groupedData) {
            const eid = (entry.employee?.id || entry.employee?._id)?.toString();
            const yd = fy && eid ? byEmp.get(eid) : null;

            const subsRaw = entry.monthlySubLedgers || [];
            const subs = subsRaw.filter(Boolean);
            for (const sub of subs) {
                ensureMonthlySubLedgerShape(sub);
            }

            entry.yearSnapshot = yd
                ? {
                      financialYear: yd.financialYear,
                      casualBalance: yd.casualBalance,
                      compensatoryOffBalance: yd.compensatoryOffBalance,
                      earnedLeaveBalance: yd.earnedLeaveBalance,
                      resetAt: yd.resetAt,
                  }
                : null;

            const yt = yd && Array.isArray(yd.yearlyTransactions) ? yd.yearlyTransactions : [];
            entry.leaveRegisterYear = yd
                ? {
                      _id: yd._id,
                      financialYear: yd.financialYear,
                      financialYearStart: yd.financialYearStart,
                      financialYearEnd: yd.financialYearEnd,
                      casualBalance: yd.casualBalance,
                      compensatoryOffBalance: yd.compensatoryOffBalance,
                      earnedLeaveBalance: yd.earnedLeaveBalance,
                      resetAt: yd.resetAt,
                      source: yd.source,
                      yearlyTransactions: lite ? [] : yt,
                      yearlyTransactionCount: yt.length,
                  }
                : null;

            let monthsOut = [];

            if (yd && Array.isArray(yd.months) && yd.months.length > 0) {
                const matchedKeys = new Set();
                const slotsOrdered = [...yd.months].sort((a, b) => {
                    const sa = new Date(a?.payPeriodStart || a?.payPeriodEnd || 0).getTime();
                    const sb = new Date(b?.payPeriodStart || b?.payPeriodEnd || 0).getTime();
                    if (sa !== sb) return sa - sb;
                    const ea = new Date(a?.payPeriodEnd || a?.payPeriodStart || 0).getTime();
                    const eb = new Date(b?.payPeriodEnd || b?.payPeriodStart || 0).getTime();
                    return ea - eb;
                });

                for (let orderedIdx = 0; orderedIdx < slotsOrdered.length; orderedIdx++) {
                    const slot = slotsOrdered[orderedIdx];
                    const policyMonthIndex = derivePolicyMonthIndexFromCycleMonth(slot, policy);
                    const pcm = slot.payrollCycleMonth;
                    const pcy = slot.payrollCycleYear;
                    const sub = matchSub(subs, pcm, pcy);
                    const key = `${pcy}-${pcm}`;
                    if (sub) {
                        matchedKeys.add(key);
                        sub.registerPlannedCl = slot.clCredits;
                        sub.registerPlannedEl = slot.elCredits;
                        sub.registerPlannedCco = slot.compensatoryOffs;
                        sub.registerLockedCredits = slot.lockedCredits;
                    }

                    const txs = !lite && sub?.transactions?.length ? [...sub.transactions] : [];
                    const txCount = sub?.transactions?.length ?? 0;

                    const slotStart = slot.payPeriodStart ? new Date(slot.payPeriodStart) : null;
                    const slotEnd = slot.payPeriodEnd ? new Date(slot.payPeriodEnd) : null;
                    const clAudit =
                        !lite && eid && slotStart && slotEnd
                            ? await buildClUsedLockedAuditForSlot(eid, slotStart, slotEnd)
                            : { used: [], locked: [] };
                    monthsOut.push({
                        payrollMonthIndex: policyMonthIndex,
                        label: slot.label || `Period ${policyMonthIndex}`,
                        payPeriodStart: slot.payPeriodStart,
                        payPeriodEnd: slot.payPeriodEnd,
                        payrollCycleMonth: pcm,
                        payrollCycleYear: pcy,
                        storedMonthlyApply: {
                            ceiling: slot.monthlyApplyCeiling,
                            consumed: slot.monthlyApplyConsumed,
                            locked: slot.monthlyApplyLocked,
                            approved: slot.monthlyApplyApproved,
                            syncedAt: slot.monthlyApplySyncedAt,
                        },
                        scheduled: {
                            clCredits: slot.clCredits,
                            elCredits: slot.elCredits,
                            compensatoryOffs: slot.compensatoryOffs,
                            lockedCredits: slot.lockedCredits,
                            poolCarryForwardOut: slot.poolCarryForwardOut,
                        },
                        ledger: sub
                            ? ledgerSlice(sub)
                            : {
                                  casualLeave: { balance: 0, usedThisMonth: 0 },
                                  earnedLeave: { balance: 0 },
                                  compensatoryOff: { balance: 0 },
                                  totalPaidBalance: 0,
                              },
                        transactions: txs,
                        transactionCount: txCount,
                        hasLedgerSlot: !!sub,
                        audit: {
                            clUsed: clAudit.used,
                            clLocked: clAudit.locked,
                        },
                    });
                }

                const orphans = subs.filter((sub) => {
                    const k = `${sub.year}-${sub.month}`;
                    return !matchedKeys.has(k);
                });
                orphans.sort((a, b) => (a.year - b.year) || (a.month - b.month));

                for (const sub of orphans) {
                    const txs = !lite && sub.transactions?.length ? [...sub.transactions] : [];
                    const txCount = sub.transactions?.length ?? 0;
                    monthsOut.push({
                        payrollMonthIndex: monthsOut.length + 1,
                        label: `${sub.month}/${sub.year}`,
                        payPeriodStart: null,
                        payPeriodEnd: null,
                        payrollCycleMonth: sub.month,
                        payrollCycleYear: sub.year,
                        scheduled: null,
                        ledger: ledgerSlice(sub),
                        transactions: txs,
                        transactionCount: txCount,
                        hasLedgerSlot: true,
                        ledgerOnly: true,
                    });
                }
            } else if (subs.length > 0) {
                monthsOut = subs.map((sub, idx) => {
                    const txs = !lite && sub.transactions?.length ? [...sub.transactions] : [];
                    const txCount = sub.transactions?.length ?? 0;
                    return {
                        payrollMonthIndex: idx + 1,
                        label: `${sub.month}/${sub.year}`,
                        payPeriodStart: null,
                        payPeriodEnd: null,
                        payrollCycleMonth: sub.month,
                        payrollCycleYear: sub.year,
                        scheduled: null,
                        ledger: ledgerSlice(sub),
                        transactions: txs,
                        transactionCount: txCount,
                        hasLedgerSlot: true,
                        audit: {
                            clUsed: [],
                            clLocked: [],
                        },
                    };
                });
            }

            entry.months = monthsOut;

            let scheduledClYtd = 0;
            entry.registerMonths = monthsOut.map((m) => {
                scheduledClYtd += Number(m.scheduled?.clCredits) || 0;
                const sub = matchSub(subs, m.payrollCycleMonth, m.payrollCycleYear);
                const clL = m.ledger?.casualLeave || {};
                const elL = m.ledger?.earnedLeave || {};
                const cclL = m.ledger?.compensatoryOff || {};
                const clCredited =
                    (Number(clL.accruedThisMonth) || 0) + (Number(clL.earnedCCL) || 0);
                const clReversal = Number(clL.reversalCreditThisMonth) || 0;
                const clCreditedNet = Math.max(0, clCredited - clReversal);
                const policyLock = Math.max(0, Number(m.scheduled?.lockedCredits) || 0);
                const st = m.storedMonthlyApply;
                const hasStored =
                    st &&
                    (st.ceiling != null ||
                        st.consumed != null ||
                        st.locked != null ||
                        st.approved != null);
                const applyLimit = hasStored && st.ceiling != null && Number.isFinite(Number(st.ceiling))
                    ? Math.max(0, Number(st.ceiling))
                    : computeScheduledPoolApplyCeiling(m.scheduled, policy);
                // Register view should reflect latest Leave statuses (locked/approved/rejected) immediately.
                // Prefer live recomputation from monthly buckets; use stored slot values only as fallback.
                const consumed =
                    sub != null && Number.isFinite(Number(sub?.capConsumedDays))
                        ? Number(sub.capConsumedDays)
                        : hasStored && st.consumed != null && Number.isFinite(Number(st.consumed))
                          ? Number(st.consumed)
                          : 0;
                const effectiveConsumed = Math.max(0, consumed);
                const capLockedDays =
                    sub != null && Number.isFinite(Number(sub?.capLockedDays))
                        ? Number(sub.capLockedDays)
                        : hasStored && st.locked != null && Number.isFinite(Number(st.locked))
                          ? Number(st.locked)
                          : null;
                const capLockedWithPolicy =
                    capLockedDays == null ? null : Math.max(0, Number(capLockedDays));
                const capApprovedDays =
                    sub != null && Number.isFinite(Number(sub?.capApprovedDays))
                        ? Number(sub.capApprovedDays)
                        : hasStored && st.approved != null && Number.isFinite(Number(st.approved))
                          ? Number(st.approved)
                          : null;
                const monthlyApplyRemaining =
                    applyLimit != null ? Math.max(0, applyLimit - effectiveConsumed) : null;
                const clLockedDisplay = sub != null ? Number(sub.pendingLockedCL) || 0 : 0;

                const clTypeCap = getConfiguredMonthlyTypeCap(policy, 'CL');
                const cclTypeCap = getConfiguredMonthlyTypeCap(policy, 'CCL');
                const elTypeCap = getConfiguredMonthlyTypeCap(policy, 'EL');
                const clTypeOn = Number.isFinite(clTypeCap) && clTypeCap > 0;
                const cclTypeOn = Number.isFinite(cclTypeCap) && cclTypeCap > 0;
                const elTypeOn = Number.isFinite(elTypeCap) && elTypeCap > 0;
                const clNativeApp =
                    sub != null
                        ? (Number(sub.approvedClCapDays) || 0) + (Number(sub.lockedClAppDays) || 0)
                        : 0;
                const cclNativeApp =
                    sub != null
                        ? (Number(sub.approvedCclCapDays) || 0) + (Number(sub.lockedCclAppDays) || 0)
                        : 0;
                const elNativeApp =
                    sub != null
                        ? (Number(sub.approvedElCapDays) || 0) + (Number(sub.lockedElAppDays) || 0)
                        : 0;

                return {
                    payrollMonthIndex: m.payrollMonthIndex,
                    label: m.label,
                    month: m.payrollCycleMonth,
                    year: m.payrollCycleYear,
                    payPeriodStart: m.payPeriodStart,
                    payPeriodEnd: m.payPeriodEnd,
                    scheduledCl: m.scheduled?.clCredits ?? null,
                    scheduledClYtd,
                    scheduledEl: m.scheduled?.elCredits ?? null,
                    scheduledCco: m.scheduled?.compensatoryOffs ?? null,
                    /** Policy slot field (reserved / admin); UI "Lk" uses pending application locks per leave type below. */
                    lockedCredits: m.scheduled?.lockedCredits ?? null,
                    clBalance: m.ledger?.casualLeave?.balance ?? null,
                    elBalance: m.ledger?.earnedLeave?.balance ?? null,
                    cclBalance: m.ledger?.compensatoryOff?.balance ?? null,
                    transactionCount: m.transactionCount,
                    monthlyApplyLimit: applyLimit,
                    monthlyApplyRemaining,
                    capConsumedDays: effectiveConsumed,
                    capLockedDays: capLockedWithPolicy,
                    capApprovedDays,
                    monthlyApplySource: hasStored ? 'stored' : 'live',
                    monthEditPolicy: resolveMonthSlotEditFlags(policy, m.payrollMonthIndex),
                    cl: {
                        credited: clCreditedNet,
                        used: Number(clL.usedThisMonth) || 0,
                        locked: sub != null ? clLockedDisplay : policyLock,
                        transfer: Number(m.scheduled?.poolCarryForwardOut?.cl) || 0,
                        typeApplyCap: clTypeOn ? clTypeCap : null,
                        typeApplyConsumed: clTypeOn ? clNativeApp : null,
                        typeApplyRemaining: clTypeOn ? Math.max(0, clTypeCap - clNativeApp) : null,
                        usedAudit: Array.isArray(m.audit?.clUsed) ? m.audit.clUsed : [],
                        lockedAudit: Array.isArray(m.audit?.clLocked) ? m.audit.clLocked : [],
                    },
                    ccl: {
                        credited: Math.max(0, (Number(cclL.earned) || 0) - (Number(cclL.reversalCreditThisMonth) || 0)),
                        used: Number(cclL.used) || 0,
                        locked: sub != null ? Number(sub.pendingLockedCCL) || 0 : null,
                        typeApplyCap: cclTypeOn ? cclTypeCap : null,
                        typeApplyConsumed: cclTypeOn ? cclNativeApp : null,
                        typeApplyRemaining: cclTypeOn ? Math.max(0, cclTypeCap - cclNativeApp) : null,
                    },
                    el: {
                        credited: Math.max(0, (Number(elL.accruedThisMonth) || 0) - (Number(elL.reversalCreditThisMonth) || 0)),
                        used: Number(elL.usedThisMonth) || 0,
                        locked: sub != null ? Number(sub.pendingLockedEL) || 0 : null,
                        typeApplyCap: elTypeOn ? elTypeCap : null,
                        typeApplyConsumed: elTypeOn ? elNativeApp : null,
                        typeApplyRemaining: elTypeOn ? Math.max(0, elTypeCap - elNativeApp) : null,
                    },
                };
            });

            if (lite) {
                for (const sub of subs) {
                    const n = sub.transactions?.length || 0;
                    sub.transactionCount = n;
                    sub.transactions = [];
                }
            }
        }

            return groupedData;
    }

    /**
     * Get employee leave ledger
     */
    async getEmployeeLedger(employeeId, leaveType, startDate, endDate) {
        try {
            const LeaveRegisterYear = require('../model/LeaveRegisterYear');
            const years = await LeaveRegisterYear.find({ employeeId }).sort({ financialYearStart: 1 }).lean();
            const startMs = new Date(startDate).getTime();
            const endMs = new Date(endDate).getTime();
            const ledger = [];
            for (const y of years) {
                for (const slot of y.months || []) {
                    for (const tx of slot.transactions || []) {
                        if (tx.leaveType !== leaveType) continue;
                        const s = new Date(tx.startDate).getTime();
                        if (s >= startMs && s <= endMs) {
                            ledger.push({ ...tx, month: slot.payrollCycleMonth, year: slot.payrollCycleYear });
                        }
                    }
                }
            }
            ledger.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

            return {
                employeeId,
                leaveType,
                startDate,
                endDate,
                transactions: ledger,
                openingBalance: ledger.length > 0 ? ledger[0].openingBalance : 0,
                closingBalance: ledger.length > 0 ? ledger[ledger.length - 1].closingBalance : 0,
                totalCredits: ledger.filter((t) => t.transactionType === 'CREDIT').reduce((sum, t) => sum + t.days, 0),
                totalDebits: ledger.filter((t) => t.transactionType === 'DEBIT').reduce((sum, t) => sum + t.days, 0),
            };
        } catch (error) {
            console.error('Error getting employee ledger:', error);
            throw error;
        }
    }

    /**
     * Get employee's complete leave register
     */
    async getEmployeeRegister(employeeId, options = {}) {
        try {
            const { financialYear = null, fyStart = null } = options;
            const LeaveRegisterYear = require('../model/LeaveRegisterYear');
            const yQuery = { employeeId };
            if (financialYear) yQuery.financialYear = financialYear;
            const yearDocs = await LeaveRegisterYear.find(yQuery).sort({ financialYearStart: 1 }).lean();
            const empForFlat = await Employee.findById(employeeId)
                .select('_id emp_no employee_name designation_id department_id division_id doj is_active')
                .lean();
            const empMap = new Map();
            if (empForFlat) empMap.set(empForFlat._id.toString(), empForFlat);
            const allTransactions = leaveRegisterYearLedgerService.flattenYearDocsToLegacyTransactions(yearDocs, empMap);
            allTransactions.sort(
                (a, b) =>
                    (a.year - b.year) ||
                    (a.month - b.month) ||
                    new Date(a.createdAt || a.at || 0) - new Date(b.createdAt || b.at || 0)
            );

            // For UI year drill-down we must build the 12-month sequence using payroll-cycle
            // month/year (because ledger month label is based on payroll cycle end month).
            let monthsInOrderOverride = null;
            if (fyStart) {
                const dateCycleService = require('./dateCycleService');
                monthsInOrderOverride = [];
                const base = new Date(fyStart);
                base.setDate(15);
                for (let i = 0; i < 12; i++) {
                    const repDate = new Date(base);
                    repDate.setMonth(base.getMonth() + i);
                    repDate.setDate(15);
                    const periodInfo = await dateCycleService.getPeriodInfo(repDate);
                    const m = periodInfo.payrollCycle.month;
                    const y = periodInfo.payrollCycle.year;
                    monthsInOrderOverride.push({ month: m, year: y, key: `${y}-${m}` });
                }
            }

            // Use the yearly grouping logic
            const dateCycleServiceForCarry = require('./dateCycleService');
            const carryCapPayrollCycle = (await dateCycleServiceForCarry.getPeriodInfo(new Date())).payrollCycle;
            const grouped = this.groupByEmployeeYearly(
                allTransactions,
                fyStart,
                monthsInOrderOverride,
                carryCapPayrollCycle
            );

            let employeeLedger = grouped[0] || {
                employeeId,
                monthlySubLedgers: [],
                yearlySummary: {}
            };

            // If there are no transactions, still return a full 12-month sequence for UI stability.
            if ((!employeeLedger.monthlySubLedgers || employeeLedger.monthlySubLedgers.length === 0) && monthsInOrderOverride) {
                employeeLedger.monthlySubLedgers = monthsInOrderOverride.map(mi => ({
                    month: mi.month,
                    year: mi.year,
                    casualLeave: { openingBalance: 0, accruedThisMonth: 0, earnedCCL: 0, usedThisMonth: 0, expired: 0, balance: 0, carryForward: 0, adjustments: 0 },
                    earnedLeave: { openingBalance: 0, accruedThisMonth: 0, usedThisMonth: 0, balance: 0, adjustments: 0 },
                    compensatoryOff: { openingBalance: 0, earned: 0, used: 0, expired: 0, balance: 0, adjustments: 0 },
                    totalPaidBalance: 0,
                    transactions: []
                }));
            }

            // Enhance with yearly summary
            const yearlySummary = {
                CL: { totalCredits: 0, totalDebits: 0, adjustments: 0 },
                EL: { totalCredits: 0, totalDebits: 0, adjustments: 0 },
                CCL: { totalCredits: 0, totalDebits: 0, adjustments: 0 }
            };

            allTransactions.forEach(tx => {
                const type = tx.leaveType;
                if (yearlySummary[type]) {
                    if (tx.transactionType === 'CREDIT') yearlySummary[type].totalCredits += tx.days;
                    else if (tx.transactionType === 'DEBIT') yearlySummary[type].totalDebits += tx.days;
                    else if (tx.transactionType === 'ADJUSTMENT') yearlySummary[type].adjustments += tx.days;
                }
            });
            employeeLedger.yearlySummary = yearlySummary;

            // Fetch basic employee info to ensure all fields are present for the modal
            const employee = await Employee.findById(employeeId)
                .select('_id emp_no employee_name designation_id department_id division_id doj is_active')
                .populate('designation_id', 'name')
                .populate('department_id', 'name')
                .populate('division_id', 'name')
                .lean();

            if (employee) {
                employeeLedger.employeeName = employee.employee_name;
                employeeLedger.empNo = employee.emp_no;
                employeeLedger.designation = (employee.designation_id && employee.designation_id.name) || 'N/A';
                employeeLedger.department = (employee.department_id && employee.department_id.name) || 'N/A';
                employeeLedger.divisionName = (employee.division_id && employee.division_id.name) || 'N/A';
                employeeLedger.dateOfJoining = employee.doj;
                employeeLedger.employmentStatus = employee.is_active ? 'active' : 'inactive';
            }

            return employeeLedger;
        } catch (error) {
            console.error('Error getting employee register:', error);
            throw error;
        }
    }

    /**
     * Get current balance for employee
     */
    async getCurrentBalance(employeeId, leaveType, asOfDate = new Date()) {
        try {
            return await leaveRegisterYearLedgerService.getCurrentBalance(employeeId, leaveType, asOfDate);
        } catch (error) {
            console.error('Error getting current balance:', error);
            throw error;
        }
    }

    /**
     * Helper methods
     */
    calculateClosingBalance(openingBalance, transactionData) {
        const { transactionType, days } = transactionData;

        if (transactionType === 'CREDIT') {
            return openingBalance + days;
        } else if (transactionType === 'DEBIT' || transactionType === 'EXPIRY') {
            return Math.max(0, openingBalance - days);
        } else if (transactionType === 'ADJUSTMENT') {
            return days; // For adjustments, set directly
        }
        return openingBalance;
    }

    /**
     * Group transactions by employee with monthly summary breakdown
     */
    /**
     * Group transactions by employee with monthly sub-ledgers and individual transactions.
     * @param {{ month: number, year: number }|null} balanceCarryCapPayrollCycle - Do not chain closing→opening balances
     *        into months strictly after this payroll cycle (usually today's cycle). Omit/null = chain entire FY (legacy).
     */
    groupByEmployeeYearly(transactions, fyStart = null, monthsInOrderOverride = null, balanceCarryCapPayrollCycle = null) {
        const grouped = {};

        // 1. Group transactions by employee
        transactions.forEach(transaction => {
            const employeeId = transaction.employeeId._id || transaction.employeeId.id || transaction.employeeId;
            const empKey = employeeId.toString();
            const monthNum = transaction.month;
            const yearNum = transaction.year;
            const monthKey = `${yearNum}-${monthNum}`;

            if (!grouped[empKey]) {
                grouped[empKey] = {
                    employee: {
                        id: employeeId,
                        empNo: transaction.empNo,
                        name: transaction.employeeName,
                        designation: transaction.designation,
                        department: transaction.department,
                        division: transaction.divisionName,
                        doj: transaction.dateOfJoining,
                        status: transaction.employmentStatus
                    },
                    months: {}
                };
            }

            if (!grouped[empKey].months[monthKey]) {
                grouped[empKey].months[monthKey] = {
                    month: monthNum,
                    year: yearNum,
                    // usedThisMonth is what UI shows as "Used".
                    // We keep usedThisMonthRaw so balance math stays correct when we compute net-used.
                    casualLeave: {
                      openingBalance: 0,
                      accruedThisMonth: 0,
                      earnedCCL: 0,
                      usedThisMonth: 0,
                      usedThisMonthRaw: 0,
                      reversalCreditThisMonth: 0,
                      expired: 0,
                      balance: 0,
                      carryForward: 0,
                      adjustments: 0,
                    },
                    earnedLeave: {
                      openingBalance: 0,
                      accruedThisMonth: 0,
                      usedThisMonth: 0,
                      usedThisMonthRaw: 0,
                      reversalCreditThisMonth: 0,
                      balance: 0,
                      adjustments: 0,
                    },
                    compensatoryOff: {
                      openingBalance: 0,
                      earned: 0,
                      used: 0,
                      usedRaw: 0,
                      reversalCreditThisMonth: 0,
                      expired: 0,
                      balance: 0,
                      adjustments: 0,
                    },
                    totalPaidBalance: 0,
                    transactions: []
                };
            }

            const monthData = grouped[empKey].months[monthKey];
            monthData.transactions.push(transaction);

            const leaveType = transaction.leaveType;
            const type = transaction.transactionType;
            const days = transaction.days;

            const isReversalCredit = type === 'CREDIT' && String(transaction.reason || '').includes('Leave Application Cancelled/Reversed');
            const isMonthlyPoolTransferOut =
                type === 'DEBIT' &&
                String(transaction.autoGeneratedType || '').startsWith('MONTHLY_POOL_TRANSFER_OUT_');

            if (leaveType === 'CL') {
                const cl = monthData.casualLeave;
                cl.balance = transaction.closingBalance;
                if (type === 'CREDIT') {
                    if (transaction.autoGeneratedType === 'INITIAL_BALANCE') cl.accruedThisMonth += days;
                    else if (transaction.reason?.includes('CCL')) cl.earnedCCL += days;
                    else cl.accruedThisMonth += days;
                    if (isReversalCredit) cl.reversalCreditThisMonth += days;
                }
                else if (type === 'DEBIT' && !isMonthlyPoolTransferOut) cl.usedThisMonthRaw += days;
                else if (type === 'EXPIRY') cl.expired += days;
                else if (type === 'ADJUSTMENT') cl.adjustments += days;
            } else if (leaveType === 'EL') {
                const el = monthData.earnedLeave;
                el.balance = transaction.closingBalance;
                if (type === 'CREDIT') el.accruedThisMonth += days;
                if (type === 'CREDIT' && isReversalCredit) el.reversalCreditThisMonth += days;
                else if (type === 'DEBIT' && !isMonthlyPoolTransferOut) el.usedThisMonthRaw += days;
                else if (type === 'ADJUSTMENT') el.adjustments += days;
            } else if (leaveType === 'CCL') {
                const ccl = monthData.compensatoryOff;
                ccl.balance = transaction.closingBalance;
                if (type === 'CREDIT') ccl.earned += days;
                if (type === 'CREDIT' && isReversalCredit) ccl.reversalCreditThisMonth += days;
                else if (type === 'DEBIT' && !isMonthlyPoolTransferOut) ccl.usedRaw += days;
                else if (type === 'EXPIRY') ccl.expired += days;
                else if (type === 'ADJUSTMENT') ccl.adjustments += days;
            }
        });

        // 2. Resolve full 12-month sequence for the financial year (or at least all months up to latest activity)
        return Object.values(grouped).map(empEntry => {
            // Determine full sequence of months to show if fyStart was provided
            let monthsInOrder = [];
            if (fyStart) {
                const monthsInOrderSource = Array.isArray(monthsInOrderOverride) && monthsInOrderOverride.length > 0
                    ? monthsInOrderOverride
                    : (() => {
                        const fyIst = extractISTComponents(fyStart);
                        const seq = [];
                        let m = fyIst.month;
                        let y = fyIst.year;
                        for (let i = 0; i < 12; i++) {
                            seq.push({ month: m, year: y, key: `${y}-${m}` });
                            if (m === 12) {
                                m = 1;
                                y += 1;
                            } else {
                                m += 1;
                            }
                        }
                        return seq;
                    })();

                for (const mi of monthsInOrderSource) {
                    const { month: m, year: y, key } = mi;
                    
                    if (empEntry.months[key]) {
                        monthsInOrder.push(empEntry.months[key]);
                    } else {
                        // Create placeholder month
                        monthsInOrder.push({
                            month: m,
                            year: y,
                            casualLeave: { openingBalance: 0, accruedThisMonth: 0, earnedCCL: 0, usedThisMonth: 0, expired: 0, balance: 0, carryForward: 0 },
                            earnedLeave: { openingBalance: 0, accruedThisMonth: 0, usedThisMonth: 0, balance: 0 },
                            compensatoryOff: { openingBalance: 0, earned: 0, used: 0, expired: 0, balance: 0 },
                            totalPaidBalance: 0,
                            transactions: []
                        });
                    }
                }
            } else {
                monthsInOrder = Object.values(empEntry.months).sort((a, b) => (a.year - b.year) || (a.month - b.month));
            }
            
            // 3. Chain balances across the sequence
            if (monthsInOrder.length > 0) {
                for (let i = 0; i < monthsInOrder.length; i++) {
                    const m = monthsInOrder[i];
                    ensureMonthlySubLedgerShape(m);
                    
                    if (i > 0) {
                        const prevM = monthsInOrder[i - 1];
                        ensureMonthlySubLedgerShape(prevM);
                        m.casualLeave.openingBalance = prevM.casualLeave.closingBalance ?? prevM.casualLeave.balance;
                        m.earnedLeave.openingBalance = prevM.earnedLeave.closingBalance ?? prevM.earnedLeave.balance;
                        m.compensatoryOff.openingBalance = prevM.compensatoryOff.closingBalance ?? prevM.compensatoryOff.balance;
                    } else {
                        if (m.transactions.length > 0) {
                            m.casualLeave.openingBalance = m.transactions.find(tx => tx.leaveType === 'CL')?.openingBalance || 0;
                            m.earnedLeave.openingBalance = m.transactions.find(tx => tx.leaveType === 'EL')?.openingBalance || 0;
                            m.compensatoryOff.openingBalance = m.transactions.find(tx => tx.leaveType === 'CCL')?.openingBalance || 0;
                        }
                    }

                    if (m.transactions.length === 0) {
                        m.casualLeave.balance = m.casualLeave.openingBalance;
                        m.earnedLeave.balance = m.earnedLeave.openingBalance;
                        m.compensatoryOff.balance = m.compensatoryOff.openingBalance;
                    } else {
                        // UI should show USED as net (DEBIT - reversal CREDIT).
                        // Balance math must still use raw debits, because reversal credits are counted as credits.
                        const clUsedRaw = Number(m.casualLeave.usedThisMonthRaw) || 0;
                        const clReversal = Number(m.casualLeave.reversalCreditThisMonth) || 0;
                        m.casualLeave.usedThisMonth = Math.max(0, clUsedRaw - clReversal);

                        const elUsedRaw = Number(m.earnedLeave.usedThisMonthRaw) || 0;
                        const elReversal = Number(m.earnedLeave.reversalCreditThisMonth) || 0;
                        m.earnedLeave.usedThisMonth = Math.max(0, elUsedRaw - elReversal);

                        const cclUsedRaw = Number(m.compensatoryOff.usedRaw) || 0;
                        const cclReversal = Number(m.compensatoryOff.reversalCreditThisMonth) || 0;
                        m.compensatoryOff.used = Math.max(0, cclUsedRaw - cclReversal);

                        const deltaCL =
                          m.casualLeave.accruedThisMonth + m.casualLeave.earnedCCL - clUsedRaw - m.casualLeave.expired + m.casualLeave.adjustments;
                        const deltaEL = m.earnedLeave.accruedThisMonth - elUsedRaw + m.earnedLeave.adjustments;
                        const deltaCCL =
                          m.compensatoryOff.earned - cclUsedRaw - m.compensatoryOff.expired + m.compensatoryOff.adjustments;
                        
                        m.casualLeave.balance = m.casualLeave.openingBalance + deltaCL;
                        m.earnedLeave.balance = m.earnedLeave.openingBalance + deltaEL;
                        m.compensatoryOff.balance = m.compensatoryOff.openingBalance + deltaCCL;
                    }

                    m.casualLeave.closingBalance = m.casualLeave.balance;
                    m.earnedLeave.closingBalance = m.earnedLeave.balance;
                    m.compensatoryOff.closingBalance = m.compensatoryOff.balance;
                    m.totalPaidBalance = m.casualLeave.balance + m.earnedLeave.balance + m.compensatoryOff.balance;
                }
            }


            // 4. Calculate Yearly Summary from the sub-ledgers

            const yearlySummary = {
                CL: { openingBalance: 0, totalCredits: 0, totalDebits: 0, adjustments: 0, closingBalance: 0 },
                EL: { openingBalance: 0, totalCredits: 0, totalDebits: 0, adjustments: 0, closingBalance: 0 },
                CCL: { openingBalance: 0, totalCredits: 0, totalDebits: 0, adjustments: 0, closingBalance: 0 }
            };

            if (monthsInOrder.length > 0) {
                // Initial opening balances from the first month in the financial year
                yearlySummary.CL.openingBalance = monthsInOrder[0].casualLeave.openingBalance;
                yearlySummary.EL.openingBalance = monthsInOrder[0].earnedLeave.openingBalance;
                yearlySummary.CCL.openingBalance = monthsInOrder[0].compensatoryOff.openingBalance;

                // Final closing balances from the last month in the financial year
                yearlySummary.CL.closingBalance = monthsInOrder[monthsInOrder.length - 1].casualLeave.closingBalance;
                yearlySummary.EL.closingBalance = monthsInOrder[monthsInOrder.length - 1].earnedLeave.closingBalance;
                yearlySummary.CCL.closingBalance = monthsInOrder[monthsInOrder.length - 1].compensatoryOff.closingBalance;

                // Aggregate credits/debits across all 12 months
                monthsInOrder.forEach(m => {
                    yearlySummary.CL.totalCredits += m.casualLeave.accruedThisMonth + m.casualLeave.earnedCCL;
                    yearlySummary.CL.totalDebits += m.casualLeave.usedThisMonth;
                    
                    yearlySummary.EL.totalCredits += m.earnedLeave.accruedThisMonth;
                    yearlySummary.EL.totalDebits += m.earnedLeave.usedThisMonth;
                    
                    yearlySummary.CCL.totalCredits += m.compensatoryOff.earned;
                    yearlySummary.CCL.totalDebits += m.compensatoryOff.used;

                    // Sum adjustments from transactions
                    m.transactions.forEach(tx => {
                        if (tx.transactionType === 'ADJUSTMENT') {
                            if (tx.leaveType === 'CL') yearlySummary.CL.adjustments += tx.days;
                            else if (tx.leaveType === 'EL') yearlySummary.EL.adjustments += tx.days;
                            else if (tx.leaveType === 'CCL') yearlySummary.CCL.adjustments += tx.days;
                        }
                    });
                });
            }

            empEntry.yearlySummary = yearlySummary;
            empEntry.monthlySubLedgers = monthsInOrder;
            delete empEntry.months;
            return empEntry;
        });


    }

    async updateEmployeeBalance(employeeId, leaveType) {
        try {
            // Get the absolute latest balance regardless of date for the employee model sync
            const currentBalance = await this.getCurrentBalance(employeeId, leaveType, new Date('9999-12-31'));

            const updateField = this.getEmployeeBalanceField(leaveType);
            console.log(`[LeaveRegister] Syncing ${leaveType} balance (${currentBalance}) to Employee field ${updateField}`);
            await Employee.findByIdAndUpdate(employeeId, {
                [updateField]: currentBalance
            });
        } catch (error) {
            console.error('Error updating employee balance:', error);
            // Don't throw error here as it's not critical
        }
    }

    getEmployeeBalanceField(leaveType) {
        // EL (Earned Leave) is stored in Employee.paidLeaves for legacy naming
        const fieldMap = {
            'EL': 'paidLeaves',
            'CL': 'casualLeaves',
            'SL': 'sickLeaves',
            'ML': 'maternityLeaves',
            'OD': 'onDutyLeaves',
            'CCL': 'compensatoryOffs'
        };
        return fieldMap[leaveType] || 'paidLeaves';
    }
}

module.exports = new LeaveRegisterService();
