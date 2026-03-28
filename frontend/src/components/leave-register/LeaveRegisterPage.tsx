'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { auth } from '@/lib/auth';
import { toast } from 'react-toastify';
import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  X,
  BookOpen,
  Loader2,
  User,
  Building2,
  Layers,
  CalendarRange,
  Shield,
  Info,
} from 'lucide-react';

type MonthLeaveBucket = {
  credited?: number;
  used?: number;
  locked?: number | null;
  transfer?: number | null;
  /** Per-type monthly apply cap (days) when policy sets maxDaysByType > 0 for this leave type. */
  typeApplyCap?: number | null;
  /** Days toward that cap (locked + approved native applications) in the payroll period. */
  typeApplyConsumed?: number | null;
  typeApplyRemaining?: number | null;
  usedAudit?: MonthContributionAudit[];
  lockedAudit?: MonthContributionAudit[];
};

type MonthContributionAudit = {
  leaveId?: string;
  leaveType?: string;
  status?: string;
  appliedFrom?: string | Date | null;
  appliedTo?: string | Date | null;
  requestDays?: number;
  contributedDays?: number;
  source?: string;
};

type RegisterMonthLite = {
  payrollMonthIndex?: number;
  label?: string;
  month: number;
  year: number;
  payPeriodStart?: string | null;
  payPeriodEnd?: string | null;
  scheduledCl?: number | null;
  /** Cumulative scheduled CL from policy period 1 through this period (FY order). */
  scheduledClYtd?: number | null;
  scheduledEl?: number | null;
  scheduledCco?: number | null;
  lockedCredits?: number | null;
  clBalance?: number | null;
  elBalance?: number | null;
  cclBalance?: number | null;
  transactionCount?: number;
  /** Scheduled pool size (CL+CCL[+EL when in register pool]) for consumption tracking. */
  monthlyApplyLimit?: number | null;
  /** max(0, pool − days counting toward pooled consumption: in-flight + approved per policy). */
  monthlyApplyRemaining?: number | null;
  /** Days counting toward pooled consumption (approved + in-flight), per policy rules. */
  capConsumedDays?: number | null;
  /** Subtotal: in-flight (locked) days toward the period cap. */
  capLockedDays?: number | null;
  /** Subtotal: final-approved days toward the period cap. */
  capApprovedDays?: number | null;
  monthEditPolicy?: MonthSlotEditPolicy | null;
  cl?: MonthLeaveBucket;
  ccl?: MonthLeaveBucket;
  el?: MonthLeaveBucket;
};

type MonthSlotEditPolicy = {
  allowEditMonth: boolean;
  allowEditClCredits: boolean;
  allowEditCclCredits: boolean;
  allowEditElCredits: boolean;
  allowEditPolicyLock: boolean;
  allowEditUsedCl: boolean;
  allowEditUsedCcl: boolean;
  allowEditUsedEl: boolean;
  allowCarryUnusedToNextMonth: boolean;
};

type MonthSlotEditPolicyConfig = {
  defaults?: Partial<MonthSlotEditPolicy>;
  byPayrollMonthIndex?: Record<string, Partial<MonthSlotEditPolicy>>;
} | null;

function gateMonthSlotEditPolicy(flags: MonthSlotEditPolicy): MonthSlotEditPolicy {
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
  return { ...flags, allowEditMonth: true };
}

function resolveMonthSlotEditPolicy(
  cfg: MonthSlotEditPolicyConfig,
  payrollMonthIndex?: number | null
): MonthSlotEditPolicy {
  const allow = (v: unknown) => v !== false;
  const flat = (cfg || {}) as Partial<MonthSlotEditPolicy>;
  const d = cfg?.defaults || {};
  const merged: MonthSlotEditPolicy = {
    // Backward-compatible: read new `defaults` shape first, then legacy flat flags.
    allowEditMonth: allow(d.allowEditMonth ?? flat.allowEditMonth),
    allowEditClCredits: allow(d.allowEditClCredits ?? flat.allowEditClCredits),
    allowEditCclCredits: allow(d.allowEditCclCredits ?? flat.allowEditCclCredits),
    allowEditElCredits: allow(d.allowEditElCredits ?? flat.allowEditElCredits),
    allowEditPolicyLock: allow(d.allowEditPolicyLock ?? flat.allowEditPolicyLock),
    allowEditUsedCl: allow(d.allowEditUsedCl ?? flat.allowEditUsedCl),
    allowEditUsedCcl: allow(d.allowEditUsedCcl ?? flat.allowEditUsedCcl),
    allowEditUsedEl: allow(d.allowEditUsedEl ?? flat.allowEditUsedEl),
    allowCarryUnusedToNextMonth: allow(
      d.allowCarryUnusedToNextMonth ?? flat.allowCarryUnusedToNextMonth
    ),
  };
  if (!Number.isFinite(Number(payrollMonthIndex))) return gateMonthSlotEditPolicy(merged);
  const k = String(Number(payrollMonthIndex));
  const ov = cfg?.byPayrollMonthIndex?.[k];
  if (!ov || typeof ov !== 'object') return gateMonthSlotEditPolicy(merged);
  const withOv: MonthSlotEditPolicy = {
    ...merged,
    allowEditMonth:
      ov.allowEditMonth == null ? merged.allowEditMonth : allow(ov.allowEditMonth),
    allowEditClCredits:
      ov.allowEditClCredits == null ? merged.allowEditClCredits : allow(ov.allowEditClCredits),
    allowEditCclCredits:
      ov.allowEditCclCredits == null ? merged.allowEditCclCredits : allow(ov.allowEditCclCredits),
    allowEditElCredits:
      ov.allowEditElCredits == null ? merged.allowEditElCredits : allow(ov.allowEditElCredits),
    allowEditPolicyLock:
      ov.allowEditPolicyLock == null ? merged.allowEditPolicyLock : allow(ov.allowEditPolicyLock),
    allowEditUsedCl:
      ov.allowEditUsedCl == null ? merged.allowEditUsedCl : allow(ov.allowEditUsedCl),
    allowEditUsedCcl:
      ov.allowEditUsedCcl == null ? merged.allowEditUsedCcl : allow(ov.allowEditUsedCcl),
    allowEditUsedEl:
      ov.allowEditUsedEl == null ? merged.allowEditUsedEl : allow(ov.allowEditUsedEl),
    allowCarryUnusedToNextMonth:
      ov.allowCarryUnusedToNextMonth == null
        ? merged.allowCarryUnusedToNextMonth
        : allow(ov.allowCarryUnusedToNextMonth),
  };
  return gateMonthSlotEditPolicy(withOv);
}

type ListRow = {
  employee: {
    id?: string;
    _id?: string;
    empNo?: string;
    name?: string;
    designation?: string;
    department?: string;
    division?: string;
    status?: string;
  };
  summary: {
    clBalance: number;
    elBalance: number;
    cclBalance: number;
    totalPaidBalance: number;
    monthlyAllowedLimit?: number;
  };
  yearSnapshot?: {
    financialYear?: string;
    casualBalance?: number;
    compensatoryOffBalance?: number;
    earnedLeaveBalance?: number;
    resetAt?: string;
  } | null;
  registerMonths?: RegisterMonthLite[];
  payrollMonthsCovered: number;
  transactionCount: number;
  firstPeriod: { month: number; year: number } | null;
  lastPeriod: { month: number; year: number } | null;
};

function formatNum(n: unknown): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return Number.isInteger(x) ? String(x) : x.toFixed(2);
}

function formatNullableNum(n: unknown): string {
  if (n == null) return '—';
  return formatNum(n);
}

/** Net for this payroll month only: bucket credits minus used (approved debits). */
function formatMonthNetBalance(credited: unknown, used: unknown): string {
  if (credited == null && used == null) return '—';
  const c = credited != null && Number.isFinite(Number(credited)) ? Number(credited) : 0;
  const u = used != null && Number.isFinite(Number(used)) ? Number(used) : 0;
  return formatNum(c - u);
}

function TypeApplyCapHint({ bucket }: { bucket?: MonthLeaveBucket | null }) {
  if (bucket?.typeApplyCap == null || bucket.typeApplyRemaining == null) return null;
  const consumed = bucket.typeApplyConsumed ?? 0;
  return (
    <div
      className="text-[9px] text-slate-400 dark:text-slate-500 font-normal mt-0.5 leading-tight"
      title="Policy apply limit for this leave type in this payroll period (pending + approved days for that type only)."
    >
      Limit {formatNum(consumed)}/{formatNum(bucket.typeApplyCap)} · left {formatNum(bucket.typeApplyRemaining)}
    </div>
  );
}

function formatDateShort(v: unknown): string {
  if (!v) return '—';
  const d = new Date(v as any);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN');
}

function computeFinancialYearNameFromPolicy(settings: any, date: Date): string {
  const fy = settings?.financialYear || {};
  const useCalendarYear = !!fy?.useCalendarYear;

  if (useCalendarYear) {
    return `${date.getFullYear()}`;
  }

  const startMonth = Number.isFinite(Number(fy?.startMonth)) ? Number(fy.startMonth) : 4; // April
  const startDay = Number.isFinite(Number(fy?.startDay)) ? Number(fy.startDay) : 1;
  const month1Based = date.getMonth() + 1;
  const day = date.getDate();

  // Matches backend DateCycleService.getFinancialYearForDate.
  const fyStartYear =
    month1Based > startMonth || (month1Based === startMonth && day >= startDay)
      ? date.getFullYear()
      : date.getFullYear() - 1;

  return `${fyStartYear}-${fyStartYear + 1}`;
}

function buildFinancialYearOptions(settings: any, date: Date): string[] {
  const fy = settings?.financialYear || {};
  const useCalendarYear = !!fy?.useCalendarYear;
  const current = computeFinancialYearNameFromPolicy(settings, date);

  if (useCalendarYear) {
    const currentYear = Number(current) || date.getFullYear();
    return [
      currentYear - 5,
      currentYear - 4,
      currentYear - 3,
      currentYear - 2,
      currentYear - 1,
      currentYear,
      currentYear + 1,
    ]
      .map((y) => String(y))
      .filter((v, i, arr) => arr.indexOf(v) === i);
  }

  const currentStartYear = Number(String(current).split('-')[0]) || date.getFullYear();
  return [
    currentStartYear - 5,
    currentStartYear - 4,
    currentStartYear - 3,
    currentStartYear - 2,
    currentStartYear - 1,
    currentStartYear,
    currentStartYear + 1,
  ]
    .map((y) => `${y}-${y + 1}`)
    .filter((v, i, arr) => arr.indexOf(v) === i);
}

export type LeaveRegisterPageVariant = 'default' | 'superadmin';

export type LeaveRegisterPageProps = {
  /** Superadmin gets grouped filters, results toolbar, and stronger visual hierarchy. */
  variant?: LeaveRegisterPageVariant;
  /** HR / sub-admin / super-admin: edit FY month scheduled pool (requires financial year filter). Default: superadmin variant only. */
  allowAdminMonthEdits?: boolean;
};

export default function LeaveRegisterPage({
  variant = 'default',
  allowAdminMonthEdits,
}: LeaveRegisterPageProps) {
  const isSuperadmin = variant === 'superadmin';
  const currentUser = useMemo(() => auth.getUser(), []);
  const hasMonthEditPrivilege = useMemo(() => {
    if (!currentUser) return false;
    if (currentUser.role === 'super_admin') return true;
    const fc = Array.isArray(currentUser.featureControl) ? currentUser.featureControl : [];
    return fc.includes('LEAVE_REGISTER_MONTH_EDIT:write') || fc.includes('LEAVE_REGISTER_MONTH_EDIT');
  }, [currentUser]);
  const canEditMonths = (allowAdminMonthEdits ?? isSuperadmin) && hasMonthEditPrivilege;
  const now = useMemo(() => new Date(), []);
  const fallbackFinancialYear = useMemo(
    () =>
      computeFinancialYearNameFromPolicy(
        { financialYear: { useCalendarYear: false, startMonth: 4, startDay: 1 } },
        now
      ),
    [now]
  );
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [financialYear, setFinancialYear] = useState(fallbackFinancialYear);
  const [financialYearOptions, setFinancialYearOptions] = useState<string[]>([fallbackFinancialYear]);
  const [divisionId, setDivisionId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [divisions, setDivisions] = useState<{ _id: string; name: string }[]>([]);
  const [departments, setDepartments] = useState<{ _id: string; name: string }[]>([]);
  const PAGE_SIZE = 25;
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ListRow[]>([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, pages: 1 });
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [rowDetailLoading, setRowDetailLoading] = useState<Record<string, boolean>>({});
  const detailCacheRef = useRef<Map<string, unknown>>(new Map());
  const detailInflightRef = useRef<Map<string, Promise<void>>>(new Map());
  const [monthModal, setMonthModal] = useState<{
    open: boolean;
    employeeId: string;
    employeeName: string;
    month: number;
    year: number;
    label: string;
    transactions: any[];
    clUsedAudit: MonthContributionAudit[];
    clLockedAudit: MonthContributionAudit[];
    auditView: 'none' | 'used' | 'locked';
    loading: boolean;
  } | null>(null);

  const [registerListRefresh, setRegisterListRefresh] = useState(0);
  const [monthSlotEditPolicyConfig, setMonthSlotEditPolicyConfig] = useState<MonthSlotEditPolicyConfig>(null);
  const [slotEditModal, setSlotEditModal] = useState<{
    open: boolean;
    employeeId: string;
    employeeName: string;
    /** FY string sent to API (from filter and/or row year snapshot). */
    financialYearForApi: string;
    payrollCycleMonth: number;
    payrollCycleYear: number;
    label: string;
    payrollMonthIndex: number;
    monthEditPolicy?: MonthSlotEditPolicy | null;
    clCredits: string;
    compensatoryOffs: string;
    elCredits: string;
    lockedCredits: string;
    validateWithRecords: boolean;
    carryUnusedToNextMonth: boolean;
    clUsed: string;
    compensatoryOffsUsed: string;
    elUsed: string;
    reason: string;
    saving: boolean;
  } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    (async () => {
      try {
        const [divRes, deptRes] = await Promise.all([
          api.getDivisions(true),
          api.getDepartments(true, divisionId || undefined),
        ]);
        if (divRes.success && Array.isArray(divRes.data)) {
          setDivisions(divRes.data.map((d: any) => ({ _id: d._id, name: d.name })));
        }
        if (deptRes.success && Array.isArray(deptRes.data)) {
          setDepartments(deptRes.data.map((d: any) => ({ _id: d._id, name: d.name })));
        }
      } catch {
        /* ignore */
      }
    })();
  }, [divisionId]);

  useEffect(() => {
    // Auto-select current financial year from backend policy settings.
    // If the user already changed FY away from the fallback, we won't overwrite.
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getLeavePolicySettings();
        if (cancelled || !res?.success) return;
        const computed = computeFinancialYearNameFromPolicy(res.data, now);
        const options = buildFinancialYearOptions(res.data, now);
        const editCfg = (res.data?.leaveRegisterMonthSlotEdit || null) as MonthSlotEditPolicyConfig;
        setMonthSlotEditPolicyConfig(editCfg);
        setFinancialYearOptions(options.length > 0 ? options : [computed]);
        setFinancialYear((prev) => {
          const t = prev.trim();
          if (options.includes(t)) return t;
          return computed;
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fallbackFinancialYear, now]);

  const effectiveMonthSlotEditPolicy = useMemo(
    () =>
      (slotEditModal?.monthEditPolicy || null) ??
      resolveMonthSlotEditPolicy(
        monthSlotEditPolicyConfig,
        slotEditModal?.payrollMonthIndex ?? null
      ),
    [monthSlotEditPolicyConfig, slotEditModal?.payrollMonthIndex, slotEditModal?.monthEditPolicy]
  );

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, financialYear, departmentId, divisionId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await api.listLeaveRegister({
          financialYear: financialYear.trim() || undefined,
          departmentId: departmentId || undefined,
          divisionId: divisionId || undefined,
          search: debouncedSearch || undefined,
          page,
          limit: PAGE_SIZE,
        });
        if (cancelled) return;
        if (!res.success) {
          toast.error(res.message || 'Failed to load leave register');
          setRows([]);
          return;
        }
        const data = res.data;
        setRows(data?.employees || []);
        if (data?.pagination) {
          setPagination({
            page: data.pagination.page,
            limit: data.pagination.limit,
            total: data.pagination.total,
            pages: data.pagination.pages,
          });
        }
      } catch (e: any) {
        if (!cancelled) {
          toast.error(e?.message || 'Failed to load leave register');
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, financialYear, departmentId, divisionId, page]);

  useEffect(() => {
    detailCacheRef.current = new Map();
    detailInflightRef.current = new Map();
    setExpandedIds([]);
  }, [debouncedSearch, financialYear, departmentId, divisionId]);

  const prefetchRowDetail = async (employeeId: string) => {
    if (detailCacheRef.current.has(employeeId)) return;
    const existing = detailInflightRef.current.get(employeeId);
    if (existing) return existing;
    const p = (async () => {
      setRowDetailLoading((r) => ({ ...r, [employeeId]: true }));
      try {
        const res = await api.getEmployeeLeaveRegisterDetail(employeeId, {
          financialYear: financialYear.trim() || undefined,
        });
        if (res.success && res.data) {
          detailCacheRef.current.set(employeeId, res.data);
        } else {
          toast.error(res.message || 'Failed to load register detail');
        }
      } catch (e: any) {
        toast.error(e?.message || 'Failed to load register detail');
      } finally {
        setRowDetailLoading((r) => ({ ...r, [employeeId]: false }));
        detailInflightRef.current.delete(employeeId);
      }
    })();
    detailInflightRef.current.set(employeeId, p);
    return p;
  };

  const toggleRowExpand = (employeeId: string) => {
    setExpandedIds((prev) => {
      const on = prev.includes(employeeId);
      const next = on ? prev.filter((id) => id !== employeeId) : [...prev, employeeId];
      if (!on) {
        void prefetchRowDetail(employeeId);
      }
      return next;
    });
  };

  const openMonthTransactions = async (
    employeeId: string,
    employeeName: string,
    m: RegisterMonthLite
  ) => {
    const label = m.label || `${m.month}/${m.year}`;
    setMonthModal({
      open: true,
      employeeId,
      employeeName,
      month: m.month,
      year: m.year,
      label,
      transactions: [],
      clUsedAudit: [],
      clLockedAudit: [],
      auditView: 'none',
      loading: true,
    });
    await prefetchRowDetail(employeeId);
    const data = detailCacheRef.current.get(employeeId) as any;
    const canonical = Array.isArray(data?.months)
      ? data.months.find(
          (row: any) =>
            Number(row.payrollCycleMonth) === Number(m.month) &&
            Number(row.payrollCycleYear) === Number(m.year)
        )
      : null;
    const ledger = data?.ledger;
    const sub = ledger?.monthlySubLedgers?.find(
      (s: any) => Number(s.month) === Number(m.month) && Number(s.year) === Number(m.year)
    );
    const txs =
      canonical && Array.isArray(canonical.transactions) && canonical.transactions.length > 0
        ? canonical.transactions
        : Array.isArray(sub?.transactions)
          ? sub.transactions
          : [];
    const usedAudit = Array.isArray(canonical?.audit?.clUsed)
      ? canonical.audit.clUsed
      : Array.isArray(m?.cl?.usedAudit)
        ? m.cl.usedAudit
        : [];
    const lockedAudit = Array.isArray(canonical?.audit?.clLocked)
      ? canonical.audit.clLocked
      : Array.isArray(m?.cl?.lockedAudit)
        ? m.cl.lockedAudit
        : [];
    setMonthModal((prev) =>
      prev
        ? {
            ...prev,
            transactions: txs,
            clUsedAudit: usedAudit,
            clLockedAudit: lockedAudit,
            auditView: 'none',
            loading: false,
          }
        : null
    );
  };

  const saveSlotEdit = async () => {
    if (!slotEditModal) return;
    if (!effectiveMonthSlotEditPolicy.allowEditMonth) {
      toast.error('Month slot editing is disabled for this payroll period (leave policy).');
      return;
    }
    const fy = slotEditModal.financialYearForApi.trim();
    if (!fy) {
      toast.error('Could not resolve financial year. Enter it in filters (e.g. 2025-2026).');
      return;
    }
    const reason = slotEditModal.reason.trim();
    if (!reason) {
      toast.error('Reason is required for audit.');
      return;
    }
    const body: {
      financialYear: string;
      payrollCycleMonth: number;
      payrollCycleYear: number;
      reason: string;
      clCredits?: number;
      compensatoryOffs?: number;
      elCredits?: number;
      lockedCredits?: number;
      validateWithRecords?: boolean;
      carryUnusedToNextMonth?: boolean;
      usedCl?: number;
      usedCcl?: number;
      usedEl?: number;
    } = {
      financialYear: fy,
      payrollCycleMonth: slotEditModal.payrollCycleMonth,
      payrollCycleYear: slotEditModal.payrollCycleYear,
      reason,
      validateWithRecords: !!slotEditModal.validateWithRecords,
    };
    if (effectiveMonthSlotEditPolicy.allowCarryUnusedToNextMonth) {
      body.carryUnusedToNextMonth = !!slotEditModal.carryUnusedToNextMonth;
    }
    const push = (key: 'clCredits' | 'compensatoryOffs' | 'elCredits' | 'lockedCredits', raw: string) => {
      const t = raw.trim();
      if (t === '') return;
      const n = Number(t);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`Invalid number for ${key}`);
      }
      body[key] = n;
    };

    const pushUsed = (key: 'usedCl' | 'usedCcl' | 'usedEl', raw: string) => {
      const t = raw.trim();
      if (t === '') return;
      const n = Number(t);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`Invalid number for ${key}`);
      }
      body[key] = n;
    };
    try {
      if (effectiveMonthSlotEditPolicy.allowEditClCredits) push('clCredits', slotEditModal.clCredits);
      if (effectiveMonthSlotEditPolicy.allowEditCclCredits) push('compensatoryOffs', slotEditModal.compensatoryOffs);
      if (effectiveMonthSlotEditPolicy.allowEditElCredits) push('elCredits', slotEditModal.elCredits);
      if (effectiveMonthSlotEditPolicy.allowEditPolicyLock) push('lockedCredits', slotEditModal.lockedCredits);
      if (effectiveMonthSlotEditPolicy.allowEditUsedCl) pushUsed('usedCl', slotEditModal.clUsed);
      if (effectiveMonthSlotEditPolicy.allowEditUsedCcl) pushUsed('usedCcl', slotEditModal.compensatoryOffsUsed);
      if (effectiveMonthSlotEditPolicy.allowEditUsedEl) pushUsed('usedEl', slotEditModal.elUsed);
    } catch (e: any) {
      toast.error(e?.message || 'Invalid input');
      return;
    }
    if (
      body.clCredits === undefined &&
      body.compensatoryOffs === undefined &&
      body.elCredits === undefined &&
      body.lockedCredits === undefined &&
      body.usedCl === undefined &&
      body.usedCcl === undefined &&
      body.usedEl === undefined &&
      body.carryUnusedToNextMonth !== true
    ) {
      toast.error('Enter at least one value to update in allowed fields.');
      return;
    }
    setSlotEditModal((m) => (m ? { ...m, saving: true } : null));
    const empId = slotEditModal.employeeId;
    try {
      const res = await api.patchLeaveRegisterYearMonthSlot(empId, body);
      if (!res.success) throw new Error(res.message || 'Update failed');
      toast.success('Month slot saved; apply ceiling refreshed from leaves.');
      setSlotEditModal(null);
      setRegisterListRefresh((x) => x + 1);
      detailCacheRef.current.delete(empId);
    } catch (e: any) {
      toast.error(e?.message || 'Update failed');
      setSlotEditModal((m) => (m ? { ...m, saving: false } : null));
    }
  };

  const syncSlotApplyOnly = async () => {
    if (!slotEditModal) return;
    const fy = slotEditModal.financialYearForApi.trim();
    if (!fy) {
      toast.error('Could not resolve financial year. Enter it in filters (e.g. 2025-2026).');
      return;
    }
    setSlotEditModal((m) => (m ? { ...m, saving: true } : null));
    const empId = slotEditModal.employeeId;
    try {
      const res = await api.syncLeaveRegisterYearMonthApply(empId, {
        financialYear: fy,
        payrollCycleMonth: slotEditModal.payrollCycleMonth,
        payrollCycleYear: slotEditModal.payrollCycleYear,
      });
      if (!res.success) throw new Error(res.message || 'Sync failed');
      toast.success('Monthly apply fields synced from leave applications.');
      setSlotEditModal(null);
      setRegisterListRefresh((x) => x + 1);
      detailCacheRef.current.delete(empId);
    } catch (e: any) {
      toast.error(e?.message || 'Sync failed');
      setSlotEditModal((m) => (m ? { ...m, saving: false } : null));
    }
  };

  function rowDisplayBalances(row: ListRow) {
    const ys = row.yearSnapshot;
    const cl =
      ys != null && ys.casualBalance != null && Number.isFinite(Number(ys.casualBalance))
        ? Number(ys.casualBalance)
        : row.summary?.clBalance;
    const ccl =
      ys != null &&
      ys.compensatoryOffBalance != null &&
      Number.isFinite(Number(ys.compensatoryOffBalance))
        ? Number(ys.compensatoryOffBalance)
        : row.summary?.cclBalance;
    const el =
      ys != null &&
      ys.earnedLeaveBalance != null &&
      Number.isFinite(Number(ys.earnedLeaveBalance))
        ? Number(ys.earnedLeaveBalance)
        : row.summary?.elBalance;
    return {
      cl,
      el,
      ccl,
      total: row.summary?.totalPaidBalance,
    };
  }

  const inputClass =
    'w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 dark:focus:border-blue-400';

  return (
    <div
      className={
        isSuperadmin
          ? 'min-h-screen bg-gradient-to-b from-slate-100 via-slate-50 to-white dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 pb-12'
          : 'min-h-screen bg-slate-50 dark:bg-slate-950 pb-10'
      }
    >
      <div
        className={
          isSuperadmin
            ? 'border-b border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm'
            : 'border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
        }
      >
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-5">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="flex items-start gap-3">
              <div
                className={
                  isSuperadmin
                    ? 'h-11 w-11 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center shadow-md shadow-blue-600/20 shrink-0'
                    : 'h-10 w-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-500/20 shrink-0'
                }
              >
                <BookOpen className="h-5 w-5" />
              </div>
              <div className="space-y-1 min-w-0">
                {isSuperadmin && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-blue-200/80 dark:border-blue-800/60 bg-blue-50/90 dark:bg-blue-950/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-800 dark:text-blue-200">
                    <Shield className="h-3 w-3 shrink-0" />
                    Super admin
                  </span>
                )}
                <h1 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white tracking-tight">
                  Leave register
                </h1>
                <p className="text-xs text-slate-600 dark:text-slate-400 max-w-2xl leading-normal">
                  {isSuperadmin ? (
                    <>
                      FY balances, payroll-month credits (CL / CCL / EL), and per–leave-type apply limits when set in
                      policy. Expand a row for month detail; click a month for transactions.
                    </>
                  ) : (
                    <>Per-employee ledger (CL, EL, CCL) for the selected financial year and payroll context.</>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4">
        <div
          className={
            isSuperadmin
              ? 'rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-sm dark:shadow-none'
              : 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm'
          }
        >
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
            <Filter className="h-3.5 w-3.5" />
            Filters
            {isSuperadmin && (
              <span className="ml-auto font-normal normal-case text-[11px] text-slate-400 dark:text-slate-500 max-w-md text-right leading-snug">
                Payroll month + FY first, then org or search.
              </span>
            )}
          </div>
          {isSuperadmin ? (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Find people</label>
                <div className="relative mt-1.5">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Name or employee number…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-9 pr-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/25 p-3 space-y-2.5">
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <CalendarRange className="h-3.5 w-3.5 shrink-0" />
                    Payroll context
                  </p>
                  <div className="grid grid-cols-1 gap-2.5">
                    <div>
                      <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Financial year</label>
                      <select
                        value={financialYear}
                        onChange={(e) => setFinancialYear(e.target.value)}
                        className={`mt-1 ${inputClass}`}
                      >
                        {financialYearOptions.map((fy) => (
                          <option key={fy} value={fy}>
                            {fy}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-4 space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5" />
                    Organization
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                        <Layers className="h-3.5 w-3.5" />
                        Division
                      </label>
                      <select
                        value={divisionId}
                        onChange={(e) => {
                          setDivisionId(e.target.value);
                          setDepartmentId('');
                        }}
                        className={`mt-1 ${inputClass}`}
                      >
                        <option value="">All divisions</option>
                        {divisions.map((d) => (
                          <option key={d._id} value={d._id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-500 flex items-center gap-1">
                        <Building2 className="h-3.5 w-3.5" />
                        Department
                      </label>
                      <select
                        value={departmentId}
                        onChange={(e) => setDepartmentId(e.target.value)}
                        className={`mt-1 ${inputClass}`}
                      >
                        <option value="">All departments</option>
                        {departments.map((d) => (
                          <option key={d._id} value={d._id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="lg:col-span-2">
                <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Search</label>
                <div className="relative mt-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Name or employee number…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <CalendarRange className="h-3.5 w-3.5" />
                  Financial year
                </label>
                <select
                  value={financialYear}
                  onChange={(e) => setFinancialYear(e.target.value)}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-sm"
                >
                  {financialYearOptions.map((fy) => (
                    <option key={fy} value={fy}>
                      {fy}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                  <Layers className="h-3.5 w-3.5" />
                  Division
                </label>
                <select
                  value={divisionId}
                  onChange={(e) => {
                    setDivisionId(e.target.value);
                    setDepartmentId('');
                  }}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-sm"
                >
                  <option value="">All divisions</option>
                  {divisions.map((d) => (
                    <option key={d._id} value={d._id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" />
                  Department
                </label>
                <select
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-sm"
                >
                  <option value="">All departments</option>
                  {departments.map((d) => (
                    <option key={d._id} value={d._id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <div
          className={
            isSuperadmin
              ? 'rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm dark:shadow-none overflow-hidden'
              : 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden'
          }
        >
          {isSuperadmin && (
            <div className="flex flex-wrap items-start sm:items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">Employee register</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 max-w-xl leading-snug">
                  Balances use the year snapshot when FY is set. Expand a row for monthly Cr / Used / Bal (credits minus
                  used for that payroll month only) and per-type apply
                  limits (under each type).
                </p>
              </div>
              {!loading && (
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <span className="inline-flex items-center rounded-md bg-blue-100 dark:bg-blue-950/60 px-2 py-0.5 text-[11px] font-medium tabular-nums text-blue-900 dark:text-blue-100">
                    {pagination.total} employee{pagination.total === 1 ? '' : 's'}
                  </span>
                  {pagination.pages > 1 && (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      {page}/{pagination.pages}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className={`w-full ${isSuperadmin ? 'text-xs' : 'text-sm'}`}>
              <thead>
                <tr
                  className={
                    isSuperadmin
                      ? 'bg-slate-100/95 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700'
                      : 'bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700'
                  }
                >
                  <th className={`w-9 ${isSuperadmin ? 'py-2 px-1.5' : 'py-3 px-2'}`} aria-label="Expand" />
                  <th
                    className={`text-left font-medium text-slate-600 dark:text-slate-300 ${isSuperadmin ? 'py-2 px-3' : 'py-3 px-4'}`}
                  >
                    Employee
                  </th>
                  <th
                    className={`text-left font-medium text-slate-600 dark:text-slate-300 hidden md:table-cell ${isSuperadmin ? 'py-2 px-3' : 'py-3 px-4'}`}
                  >
                    Org
                  </th>
                  <th
                    className={`text-right font-medium text-slate-600 dark:text-slate-300 ${isSuperadmin ? 'py-2 px-2' : 'py-3 px-3'}`}
                    title="Casual leave balance (FY snapshot when set)"
                  >
                    CL
                  </th>
                  <th
                    className={`text-right font-medium text-slate-600 dark:text-slate-300 ${isSuperadmin ? 'py-2 px-2' : 'py-3 px-3'}`}
                    title="Earned leave balance"
                  >
                    EL
                  </th>
                  <th
                    className={`text-right font-medium text-slate-600 dark:text-slate-300 ${isSuperadmin ? 'py-2 px-2' : 'py-3 px-3'}`}
                    title="Compensatory / CCL balance"
                  >
                    CCL
                  </th>
                  <th
                    className={`text-right font-medium text-slate-600 dark:text-slate-300 hidden sm:table-cell ${isSuperadmin ? 'py-2 px-2' : 'py-3 px-3'}`}
                  >
                    Total
                  </th>
                  <th
                    className={`text-right font-medium text-slate-600 dark:text-slate-300 hidden lg:table-cell ${isSuperadmin ? 'py-2 px-2' : 'py-3 px-3'}`}
                  >
                    Txns
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-500">
                      <Loader2 className="h-7 w-7 animate-spin mx-auto text-indigo-500" />
                      <p className="mt-2 text-xs">Loading register…</p>
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-500 dark:text-slate-400 text-xs">
                      No employees match your filters.
                    </td>
                  </tr>
                ) : (
                  rows.flatMap((row) => {
                    const id = row.employee?.id || row.employee?._id;
                    const idStr = id ? String(id) : '';
                    const expanded = idStr ? expandedIds.includes(idStr) : false;
                    const bal = rowDisplayBalances(row);
                    const months = row.registerMonths?.length
                      ? row.registerMonths
                      : [];
                    const mainRow = (
                      <tr
                        key={idStr || row.employee?.empNo}
                        role="button"
                        tabIndex={0}
                        onClick={() => idStr && toggleRowExpand(idStr)}
                        onKeyDown={(e) => {
                          if ((e.key === 'Enter' || e.key === ' ') && idStr) {
                            e.preventDefault();
                            toggleRowExpand(idStr);
                          }
                        }}
                        className={
                          isSuperadmin
                            ? 'border-b border-slate-100 dark:border-slate-800/90 hover:bg-blue-50/40 dark:hover:bg-slate-800/50 cursor-pointer transition-colors'
                            : 'border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer'
                        }
                      >
                        <td
                          className={`text-slate-400 align-middle ${isSuperadmin ? 'py-2 px-1.5' : 'py-3 px-2'}`}
                        >
                          {idStr ? (
                            <ChevronRight
                              className={`${isSuperadmin ? 'h-3.5 w-3.5' : 'h-4 w-4'} transition-transform ${expanded ? 'rotate-90' : ''}`}
                            />
                          ) : null}
                        </td>
                        <td className={isSuperadmin ? 'py-2 px-3' : 'py-3 px-4'}>
                          <div className="flex items-center gap-2">
                            <div
                              className={
                                isSuperadmin
                                  ? 'h-8 w-8 rounded-lg bg-blue-100 dark:bg-blue-950/50 flex items-center justify-center text-blue-700 dark:text-blue-300'
                                  : 'h-9 w-9 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-indigo-700 dark:text-indigo-300'
                              }
                            >
                              <User className={isSuperadmin ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-slate-900 dark:text-white text-sm leading-tight">
                                {row.employee?.name || '—'}
                              </p>
                              <p className="text-[11px] text-slate-500 leading-snug">
                                {row.employee?.empNo || '—'}
                                {row.employee?.designation ? ` · ${row.employee.designation}` : ''}
                              </p>
                              {row.yearSnapshot?.financialYear ? (
                                <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                                  FY {row.yearSnapshot.financialYear} · year register
                                </p>
                              ) : !financialYear.trim() ? (
                                <p className="text-[10px] text-amber-600/90 dark:text-amber-400/90 mt-0.5 leading-snug">
                                  Set FY for year snapshot
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td
                          className={`hidden md:table-cell text-slate-600 dark:text-slate-400 ${isSuperadmin ? 'py-2 px-3 text-[11px]' : 'py-3 px-4 text-xs'}`}
                        >
                          <div>{row.employee?.department || '—'}</div>
                          <div className="text-slate-400">{row.employee?.division || ''}</div>
                        </td>
                        <td
                          className={`text-right font-mono tabular-nums ${isSuperadmin ? 'py-2 px-2' : 'py-3 px-3'}`}
                        >
                          {formatNum(bal.cl)}
                        </td>
                        <td
                          className={`text-right font-mono tabular-nums ${isSuperadmin ? 'py-2 px-2' : 'py-3 px-3'}`}
                        >
                          {formatNum(bal.el)}
                        </td>
                        <td
                          className={`text-right font-mono tabular-nums ${isSuperadmin ? 'py-2 px-2' : 'py-3 px-3'}`}
                        >
                          {formatNum(bal.ccl)}
                        </td>
                        <td
                          className={`text-right font-mono tabular-nums hidden sm:table-cell font-medium text-slate-800 dark:text-slate-200 ${isSuperadmin ? 'py-2 px-2' : 'py-3 px-3'}`}
                        >
                          {formatNum(bal.total)}
                        </td>
                        <td
                          className={`text-right text-slate-500 hidden lg:table-cell ${isSuperadmin ? 'py-2 px-2' : 'py-3 px-3'}`}
                        >
                          {row.transactionCount ?? 0}
                        </td>
                      </tr>
                    );
                    const expandRow =
                      expanded && idStr ? (
                        <tr
                          key={`${idStr}-expand`}
                          className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/50"
                        >
                          <td colSpan={8} className={isSuperadmin ? 'px-3 py-3' : 'px-4 py-4'}>
                            {rowDetailLoading[idStr] && !detailCacheRef.current.has(idStr) ? (
                              <div className="flex items-center gap-2 text-xs text-slate-500">
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />
                                Loading months…
                              </div>
                            ) : months.length === 0 ? (
                              <p className="text-xs text-slate-500">
                                No payroll months in this view. Adjust filters or financial year.
                              </p>
                            ) : (
                              <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
                                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                  Payroll months · click a month for transactions
                                </p>
                                {isSuperadmin ? (
                                  <div className="flex gap-2 rounded-lg border border-blue-200/70 dark:border-blue-900/50 bg-blue-50/90 dark:bg-blue-950/25 px-2.5 py-2 text-[10px] leading-snug text-blue-950 dark:text-blue-100">
                                    <Info className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
                                    <p>
                                      <span className="font-medium">Per-type apply limits</span> (under CL / CCL / EL → Lk)
                                      come from leave policy maxDaysByType for that type.
                                      Pending and approved days for <em>that type only</em> count toward each limit.
                                    </p>
                                  </div>
                                ) : (
                                  <p className="text-[10px] text-slate-400">
                                    When the policy sets a per-type cap, <strong>Limit used/total · left</strong> appears under
                                    each type’s Lk column. Pending and approved days count only toward that leave type’s cap.
                                  </p>
                                )}
                                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/60">
                                  <table
                                    className={`w-full min-w-[760px] border-collapse ${isSuperadmin ? 'text-[10px]' : 'text-[11px]'}`}
                                  >
                                    <thead>
                                      <tr className="bg-slate-100/90 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300">
                                        <th
                                          rowSpan={2}
                                          className="text-left font-semibold px-2 py-2 align-bottom whitespace-nowrap"
                                        >
                                          Month
                                        </th>
                                        <th colSpan={5} className="text-center font-semibold px-1 py-1 border-l border-slate-200 dark:border-slate-600">
                                          CL
                                        </th>
                                        <th colSpan={4} className="text-center font-semibold px-1 py-1 border-l border-slate-200 dark:border-slate-600">
                                          CCL
                                        </th>
                                        <th colSpan={4} className="text-center font-semibold px-1 py-1 border-l border-slate-200 dark:border-slate-600">
                                          EL
                                        </th>
                                      </tr>
                                      <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-600">
                                        <th className="text-right font-medium px-1 py-1 border-l border-slate-200 dark:border-slate-600">
                                          Cr
                                        </th>
                                        <th className="text-right font-medium px-1 py-1">Used</th>
                                        <th
                                          className="text-right font-medium px-1 py-1"
                                          title="This month: credits minus used (approved debits) for CL in this payroll period."
                                        >
                                          Bal
                                        </th>
                                        <th
                                          className="text-right font-medium px-1 py-1"
                                          title="Locked (pending). Subtext: per-type apply limit when configured in policy."
                                        >
                                          Lk
                                        </th>
                                        <th
                                          className="text-right font-medium px-1 py-1 border-l border-slate-200 dark:border-slate-600"
                                          title="Transferred unused pool to next month"
                                        >
                                          Transfer
                                        </th>
                                        <th className="text-right font-medium px-1 py-1 border-l border-slate-200 dark:border-slate-600">
                                          Cr
                                        </th>
                                        <th className="text-right font-medium px-1 py-1">Used</th>
                                        <th
                                          className="text-right font-medium px-1 py-1"
                                          title="This month: credits minus used (approved debits) for CCL in this payroll period."
                                        >
                                          Bal
                                        </th>
                                        <th
                                          className="text-right font-medium px-1 py-1"
                                          title="Locked (pending). Subtext: per-type apply limit when configured."
                                        >
                                          Lk
                                        </th>
                                        <th className="text-right font-medium px-1 py-1 border-l border-slate-200 dark:border-slate-600">
                                          Cr
                                        </th>
                                        <th className="text-right font-medium px-1 py-1">Used</th>
                                        <th
                                          className="text-right font-medium px-1 py-1"
                                          title="This month: credits minus used (approved debits) for EL in this payroll period."
                                        >
                                          Bal
                                        </th>
                                        <th
                                          className="text-right font-medium px-1 py-1"
                                          title="Locked (pending). Subtext: per-type apply limit when configured."
                                        >
                                          Lk
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {months.map((m, idx) => (
                                        <tr
                                          key={`${m.year}-${m.month}-${idx}`}
                                          role="button"
                                          tabIndex={0}
                                          onClick={() =>
                                            void openMonthTransactions(
                                              idStr,
                                              row.employee?.name || row.employee?.empNo || 'Employee',
                                              m
                                            )
                                          }
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                              e.preventDefault();
                                              void openMonthTransactions(
                                                idStr,
                                                row.employee?.name || row.employee?.empNo || 'Employee',
                                                m
                                              );
                                            }
                                          }}
                                          className="border-b border-slate-100 dark:border-slate-700/80 hover:bg-indigo-50/60 dark:hover:bg-slate-700/40 cursor-pointer font-mono tabular-nums"
                                        >
                                          <td className="text-left px-2 py-1.5 align-top">
                                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                                              {m.label || `${m.month}/${m.year}`}
                                            </div>
                                            <div className="text-[10px] text-slate-500 font-normal mt-0.5 space-y-0.5">
                                              <div>
                                                Bal CL {formatNum(m.clBalance)} · CCL {formatNum(m.cclBalance)} · EL{' '}
                                                {formatNum(m.elBalance)}
                                              </div>
                                              <div>
                                                sch CL {formatNullableNum(m.scheduledCl)}
                                                {m.scheduledClYtd != null && (
                                                  <span className="text-slate-400">
                                                    {' '}
                                                    · YTD sch {formatNum(m.scheduledClYtd)}
                                                  </span>
                                                )}{' '}
                                                · Txns {m.transactionCount ?? 0}
                                              </div>
                                            </div>
                                            {canEditMonths && m.monthEditPolicy?.allowEditMonth ? (
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  const fyResolved =
                                                    financialYear.trim() ||
                                                    String(row.yearSnapshot?.financialYear || '').trim();
                                                  if (!fyResolved) {
                                                    toast.info(
                                                      'Enter Financial year in filters (e.g. 2025-2026), or open row when FY snapshot loads.'
                                                    );
                                                    return;
                                                  }
                                                  setSlotEditModal({
                                                    open: true,
                                                    employeeId: idStr,
                                                    employeeName:
                                                      row.employee?.name || row.employee?.empNo || 'Employee',
                                                    financialYearForApi: fyResolved,
                                                    payrollCycleMonth: m.month,
                                                    payrollCycleYear: m.year,
                                                    label: m.label || `${m.month}/${m.year}`,
                                                    payrollMonthIndex:
                                                      Number(m.payrollMonthIndex) || (idx + 1),
                                                    monthEditPolicy: m.monthEditPolicy || null,
                                                    clCredits:
                                                      m.scheduledCl != null ? String(m.scheduledCl) : '',
                                                    compensatoryOffs:
                                                      m.scheduledCco != null ? String(m.scheduledCco) : '',
                                                    elCredits:
                                                      m.scheduledEl != null ? String(m.scheduledEl) : '',
                                                    lockedCredits:
                                                      m.lockedCredits != null ? String(m.lockedCredits) : '',
                                                    validateWithRecords: true,
                                                    carryUnusedToNextMonth: false,
                                                    clUsed: '',
                                                    compensatoryOffsUsed: '',
                                                    elUsed: '',
                                                    reason: '',
                                                    saving: false,
                                                  });
                                                }}
                                                className="mt-1 text-left text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                                              >
                                                Edit scheduled pool (admin)…
                                              </button>
                                            ) : canEditMonths ? (
                                              <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                                                Slot edit off for this period (policy).
                                              </p>
                                            ) : null}
                                          </td>
                                          <td className="text-right px-1 py-1.5 border-l border-slate-200 dark:border-slate-600">
                                            {formatNullableNum(m.cl?.credited)}
                                          </td>
                                          <td className="text-right px-1 py-1.5">{formatNullableNum(m.cl?.used)}</td>
                                          <td className="text-right px-1 py-1.5 text-slate-800 dark:text-slate-100 font-semibold">
                                            {formatMonthNetBalance(m.cl?.credited, m.cl?.used)}
                                          </td>
                                          <td className="text-right px-1 py-1.5 align-top">
                                            <div>{formatNullableNum(m.cl?.locked)}</div>
                                            <TypeApplyCapHint bucket={m.cl} />
                                          </td>
                                          <td className="text-right px-1 py-1.5 border-l border-slate-200 dark:border-slate-600">
                                            {formatNullableNum(m.cl?.transfer)}
                                          </td>
                                          <td className="text-right px-1 py-1.5 border-l border-slate-200 dark:border-slate-600">
                                            {formatNullableNum(m.ccl?.credited)}
                                          </td>
                                          <td className="text-right px-1 py-1.5">{formatNullableNum(m.ccl?.used)}</td>
                                          <td className="text-right px-1 py-1.5 text-slate-800 dark:text-slate-100 font-semibold">
                                            {formatMonthNetBalance(m.ccl?.credited, m.ccl?.used)}
                                          </td>
                                          <td className="text-right px-1 py-1.5 align-top">
                                            <div>{formatNullableNum(m.ccl?.locked)}</div>
                                            <TypeApplyCapHint bucket={m.ccl} />
                                          </td>
                                          <td className="text-right px-1 py-1.5 border-l border-slate-200 dark:border-slate-600">
                                            {formatNullableNum(m.el?.credited)}
                                          </td>
                                          <td className="text-right px-1 py-1.5">{formatNullableNum(m.el?.used)}</td>
                                          <td className="text-right px-1 py-1.5 text-slate-800 dark:text-slate-100 font-semibold">
                                            {formatMonthNetBalance(m.el?.credited, m.el?.used)}
                                          </td>
                                          <td className="text-right px-1 py-1.5 align-top">
                                            <div>{formatNullableNum(m.el?.locked)}</div>
                                            <TypeApplyCapHint bucket={m.el} />
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      ) : null;
                    return expandRow ? [mainRow, expandRow] : [mainRow];
                  })
                )}
              </tbody>
            </table>
          </div>

          {!loading && pagination.pages > 1 && (
            <div
              className={
                isSuperadmin
                  ? 'flex items-center justify-between px-3 sm:px-4 py-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40'
                  : 'flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30'
              }
            >
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Page {page} of {pagination.pages} · {pagination.total} employees
              </p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className={
                    isSuperadmin
                      ? 'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-[11px] font-medium text-slate-700 dark:text-slate-200 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800'
                      : 'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-xs font-medium disabled:opacity-40'
                  }
                >
                  <ChevronLeft className={isSuperadmin ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
                  Prev
                </button>
                <button
                  type="button"
                  disabled={page >= pagination.pages}
                  onClick={() => setPage((p) => p + 1)}
                  className={
                    isSuperadmin
                      ? 'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-blue-600 dark:border-blue-500 bg-blue-600 text-white text-[11px] font-medium disabled:opacity-40 hover:bg-blue-700 dark:hover:bg-blue-600'
                      : 'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-xs font-medium disabled:opacity-40'
                  }
                >
                  Next
                  <ChevronRight className={isSuperadmin ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {monthModal?.open && (
        <div
          className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="month-modal-title"
          onClick={() => setMonthModal(null)}
        >
          <div
            className={`bg-white dark:bg-slate-900 w-full sm:max-w-2xl sm:rounded-xl shadow-2xl max-h-[88vh] overflow-hidden flex flex-col border ${
              isSuperadmin
                ? 'border-slate-200/80 dark:border-slate-600'
                : 'border-slate-200 dark:border-slate-700'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={
                isSuperadmin
                  ? 'flex items-center justify-between px-3 sm:px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/50'
                  : 'flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800'
              }
            >
              <div className="min-w-0 pr-2">
                {isSuperadmin && (
                  <p className="text-[10px] font-medium uppercase tracking-wide text-blue-600 dark:text-blue-400 mb-0.5">
                    Month transactions
                  </p>
                )}
                <h2
                  id="month-modal-title"
                  className={`font-semibold text-slate-900 dark:text-white ${isSuperadmin ? 'text-base' : 'text-lg font-bold'}`}
                >
                  {monthModal.label}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                  {monthModal.employeeName} · {monthModal.month}/{monthModal.year}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMonthModal(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className={`overflow-y-auto flex-1 ${isSuperadmin ? 'p-3 sm:p-4' : 'p-4 sm:p-5'}`}>
              {monthModal.loading ? (
                <div className="py-10 flex justify-center">
                  <Loader2 className={`animate-spin ${isSuperadmin ? 'h-8 w-8 text-blue-600' : 'h-10 w-10 text-indigo-500'}`} />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setMonthModal((prev) =>
                          prev ? { ...prev, auditView: prev.auditView === 'used' ? 'none' : 'used' } : null
                        )
                      }
                      className={`text-left rounded-lg border px-3 py-2 ${
                        monthModal.auditView === 'used'
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                          : 'border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <p className="text-[11px] text-slate-500">Used (approved) audit</p>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {formatNum(monthModal.clUsedAudit.reduce((s, a) => s + (Number(a?.contributedDays) || 0), 0))}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setMonthModal((prev) =>
                          prev ? { ...prev, auditView: prev.auditView === 'locked' ? 'none' : 'locked' } : null
                        )
                      }
                      className={`text-left rounded-lg border px-3 py-2 ${
                        monthModal.auditView === 'locked'
                          ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                          : 'border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <p className="text-[11px] text-slate-500">Locked (in-flight) audit</p>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {formatNum(monthModal.clLockedAudit.reduce((s, a) => s + (Number(a?.contributedDays) || 0), 0))}
                      </p>
                    </button>
                  </div>

                  {monthModal.auditView !== 'none' && (
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                      <table className={`w-full ${isSuperadmin ? 'text-xs' : 'text-sm'}`}>
                        <thead>
                          <tr className="text-left bg-slate-50 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                            <th className={`font-medium ${isSuperadmin ? 'py-1.5 px-2' : 'py-2.5 px-3 font-semibold'}`}>Leave</th>
                            <th className={`font-medium ${isSuperadmin ? 'py-1.5 px-2' : 'py-2.5 px-3 font-semibold'}`}>Applied</th>
                            <th className={`font-medium text-right ${isSuperadmin ? 'py-1.5 px-2' : 'py-2.5 px-3 font-semibold'}`}>Req</th>
                            <th className={`font-medium text-right ${isSuperadmin ? 'py-1.5 px-2' : 'py-2.5 px-3 font-semibold'}`}>Contrib</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(monthModal.auditView === 'used' ? monthModal.clUsedAudit : monthModal.clLockedAudit).map((a, idx) => (
                            <tr key={`${a.leaveId || 'leave'}-${idx}`} className="border-b border-slate-100 dark:border-slate-800/80">
                              <td className={isSuperadmin ? 'py-1.5 px-2' : 'py-2.5 px-3'}>
                                <div className="font-medium">{a.leaveType || 'CL'}</div>
                                <div className="text-[10px] text-slate-500">{a.leaveId || '—'}</div>
                              </td>
                              <td className={isSuperadmin ? 'py-1.5 px-2' : 'py-2.5 px-3'}>
                                {formatDateShort(a.appliedFrom)} - {formatDateShort(a.appliedTo)}
                              </td>
                              <td className={`text-right font-mono tabular-nums ${isSuperadmin ? 'py-1.5 px-2' : 'py-2.5 px-3'}`}>{formatNum(a.requestDays)}</td>
                              <td className={`text-right font-mono tabular-nums font-semibold ${isSuperadmin ? 'py-1.5 px-2' : 'py-2.5 px-3'}`}>{formatNum(a.contributedDays)}</td>
                            </tr>
                          ))}
                          {(monthModal.auditView === 'used' ? monthModal.clUsedAudit.length === 0 : monthModal.clLockedAudit.length === 0) && (
                            <tr>
                              <td colSpan={4} className="py-4 text-center text-xs text-slate-500">
                                No leave requests contributed in this bucket.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {monthModal.transactions.length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-3">No transactions for this month.</p>
                  ) : (
                    <div
                      className={
                        isSuperadmin ? 'rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden' : ''
                      }
                    >
                      <table className={`w-full ${isSuperadmin ? 'text-xs' : 'text-sm'}`}>
                    <thead>
                      <tr
                        className={
                          isSuperadmin
                            ? 'text-left bg-slate-50 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700'
                            : 'text-slate-500 text-left border-b border-slate-200 dark:border-slate-700'
                        }
                      >
                        <th className={`font-medium ${isSuperadmin ? 'py-1.5 px-2' : 'py-2.5 px-3 font-semibold'}`}>
                          Type
                        </th>
                        <th className={`font-medium ${isSuperadmin ? 'py-1.5 px-2' : 'py-2.5 px-3 font-semibold'}`}>
                          Leave
                        </th>
                        <th
                          className={`font-medium text-right ${isSuperadmin ? 'py-1.5 px-2' : 'py-2.5 px-3 font-semibold'}`}
                        >
                          Days
                        </th>
                        <th
                          className={`hidden sm:table-cell font-medium ${isSuperadmin ? 'py-1.5 px-2' : 'py-2.5 px-3 font-semibold'}`}
                        >
                          Reason
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthModal.transactions.map((tx: any, idx: number) => (
                        <tr
                          key={tx._id || `${tx.createdAt}-${tx.days}-${tx.transactionType}`}
                          className={
                            isSuperadmin
                              ? idx % 2 === 0
                                ? 'border-b border-slate-100 dark:border-slate-800/80 bg-white dark:bg-slate-900'
                                : 'border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/20'
                              : 'border-b border-slate-100 dark:border-slate-800/80'
                          }
                        >
                          <td className={isSuperadmin ? 'py-1.5 px-2' : 'py-2.5 px-3'}>{tx.transactionType}</td>
                          <td className={isSuperadmin ? 'py-1.5 px-2' : 'py-2.5 px-3'}>{tx.leaveType}</td>
                          <td
                            className={`text-right font-mono tabular-nums ${isSuperadmin ? 'py-1.5 px-2 font-medium' : 'py-2.5 px-3 font-medium'}`}
                          >
                            {formatNum(tx.days)}
                          </td>
                          <td
                            className={`text-slate-500 dark:text-slate-400 hidden sm:table-cell max-w-[220px] truncate ${isSuperadmin ? 'py-1.5 px-2' : 'py-2.5 px-3'}`}
                          >
                            {tx.reason || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {slotEditModal?.open && (
        <div
          className="fixed inset-0 z-[201] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="slot-edit-title"
          onClick={() => !slotEditModal.saving && setSlotEditModal(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 w-full sm:max-w-md sm:rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 id="slot-edit-title" className="text-sm font-semibold text-slate-900 dark:text-white">
                  Edit scheduled pool
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {slotEditModal.employeeName} · {slotEditModal.label} · FY{' '}
                  {slotEditModal.financialYearForApi.trim() || '—'}
                </p>
              </div>
              <button
                type="button"
                disabled={slotEditModal.saving}
                onClick={() => setSlotEditModal(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              {!effectiveMonthSlotEditPolicy.allowEditMonth ? (
                <div className="rounded-lg border border-amber-200/80 bg-amber-50/90 dark:border-amber-900/40 dark:bg-amber-950/30 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-100">
                  Editing is turned off for this payroll period in leave policy (master “Edit month”).
                </div>
              ) : null}
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                Updates <strong>scheduled</strong> credits on the FY month slot (initial sync / corrections).
                Apply-cap consumption (locked/approved) is refreshed from leave rows after save; use{' '}
                <strong>Sync apply only</strong> if you only fixed applications.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <label className="col-span-2 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  Scheduled CL
                  <input
                    type="text"
                    inputMode="decimal"
                    value={slotEditModal.clCredits}
                    disabled={!effectiveMonthSlotEditPolicy.allowEditClCredits}
                    onChange={(e) =>
                      setSlotEditModal((m) => (m ? { ...m, clCredits: e.target.value } : null))
                    }
                    className="mt-0.5 w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </label>
                <label className="col-span-2 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  Scheduled CCL (pool)
                  <input
                    type="text"
                    inputMode="decimal"
                    value={slotEditModal.compensatoryOffs}
                    disabled={!effectiveMonthSlotEditPolicy.allowEditCclCredits}
                    onChange={(e) =>
                      setSlotEditModal((m) => (m ? { ...m, compensatoryOffs: e.target.value } : null))
                    }
                    className="mt-0.5 w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </label>
                <label className="col-span-2 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  Scheduled EL
                  <input
                    type="text"
                    inputMode="decimal"
                    value={slotEditModal.elCredits}
                    disabled={!effectiveMonthSlotEditPolicy.allowEditElCredits}
                    onChange={(e) =>
                      setSlotEditModal((m) => (m ? { ...m, elCredits: e.target.value } : null))
                    }
                    className="mt-0.5 w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </label>
                <label className="col-span-2 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  Policy lock (optional)
                  <input
                    type="text"
                    inputMode="decimal"
                    value={slotEditModal.lockedCredits}
                    disabled={!effectiveMonthSlotEditPolicy.allowEditPolicyLock}
                    onChange={(e) =>
                      setSlotEditModal((m) => (m ? { ...m, lockedCredits: e.target.value } : null))
                    }
                    className="mt-0.5 w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </label>
                <label className="col-span-2 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  Used CL (override)
                  <input
                    type="text"
                    inputMode="decimal"
                    value={slotEditModal.clUsed}
                    disabled={!effectiveMonthSlotEditPolicy.allowEditUsedCl}
                    onChange={(e) =>
                      setSlotEditModal((m) => (m ? { ...m, clUsed: e.target.value } : null))
                    }
                    className="mt-0.5 w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </label>
                <label className="col-span-2 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  Used CCL (override)
                  <input
                    type="text"
                    inputMode="decimal"
                    value={slotEditModal.compensatoryOffsUsed}
                    disabled={!effectiveMonthSlotEditPolicy.allowEditUsedCcl}
                    onChange={(e) =>
                      setSlotEditModal((m) => (m ? { ...m, compensatoryOffsUsed: e.target.value } : null))
                    }
                    className="mt-0.5 w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </label>
                <label className="col-span-2 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  Used EL (override)
                  <input
                    type="text"
                    inputMode="decimal"
                    value={slotEditModal.elUsed}
                    disabled={!effectiveMonthSlotEditPolicy.allowEditUsedEl}
                    onChange={(e) =>
                      setSlotEditModal((m) => (m ? { ...m, elUsed: e.target.value } : null))
                    }
                    className="mt-0.5 w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </label>
              </div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                Reason (audit) *
                <textarea
                  value={slotEditModal.reason}
                  disabled={!effectiveMonthSlotEditPolicy.allowEditMonth}
                  onChange={(e) =>
                    setSlotEditModal((m) => (m ? { ...m, reason: e.target.value } : null))
                  }
                  rows={2}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="Why are you changing this month?"
                />
              </label>
              <div className="space-y-1">
                <label className="flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300"
                    checked={slotEditModal.validateWithRecords}
                    disabled={!effectiveMonthSlotEditPolicy.allowEditMonth}
                    onChange={(e) =>
                      setSlotEditModal((m) =>
                        m ? { ...m, validateWithRecords: e.target.checked } : null
                      )
                    }
                  />
                  <span>
                    Validate with records
                    <span className="block text-[10px] text-slate-500">
                      Prevent save if scheduled values are less than already used days.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300"
                    checked={slotEditModal.carryUnusedToNextMonth}
                    disabled={!effectiveMonthSlotEditPolicy.allowCarryUnusedToNextMonth}
                    onChange={(e) =>
                      setSlotEditModal((m) =>
                        m ? { ...m, carryUnusedToNextMonth: e.target.checked } : null
                      )
                    }
                  />
                  <span>
                    Carry unused to next month
                    <span className="block text-[10px] text-slate-500">
                      Moves this month&apos;s unused edited pool to the immediate next slot.
                    </span>
                  </span>
                </label>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  disabled={
                    slotEditModal.saving || !effectiveMonthSlotEditPolicy.allowEditMonth
                  }
                  onClick={() => void saveSlotEdit()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 text-white px-3 py-2 text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
                >
                  {slotEditModal.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Save slot
                </button>
                <button
                  type="button"
                  disabled={
                    slotEditModal.saving || !effectiveMonthSlotEditPolicy.allowEditMonth
                  }
                  onClick={() => void syncSlotApplyOnly()}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Sync apply only
                </button>
                <button
                  type="button"
                  disabled={slotEditModal.saving}
                  onClick={() => setSlotEditModal(null)}
                  className="inline-flex items-center justify-center rounded-lg px-3 py-2 text-xs text-slate-500"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
