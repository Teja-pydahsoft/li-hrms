'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { auth } from '@/lib/auth';
import {
  canViewLeaves,
  canApproveLeaves  // Used as canManageLeaves
} from '@/lib/permissions';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { toast, ToastContainer } from 'react-toastify';
import Swal from 'sweetalert2';
import 'react-toastify/dist/ReactToastify.css';

import LocationPhotoCapture from '@/components/LocationPhotoCapture';
import EmployeeSelect from '@/components/EmployeeSelect';

const LocationMap = dynamic(() => import('@/components/LocationMap'), { ssr: false });
import {
  Calendar,
  Briefcase,
  Clock3,
  CheckCircle2,
  XCircle,
  Plus,
  Search,
  Filter,
  ChevronRight,
  Eye,
  X,
  MapPin,
  ShieldCheck,
  RotateCw,
  AlertCircle,
  Clock,
  Check,
  Circle,
  Loader2,
  Trash2,
  Star
} from 'lucide-react';

// Custom Stat Card
// Custom Stat Card
// Custom Stat Card
const StatCard = ({ title, value, icon: Icon, bgClass, iconClass, dekorClass, trend, loading }: { title: string, value: number | string, icon: any, bgClass: string, iconClass: string, dekorClass?: string, trend?: { value: string, positive: boolean }, loading?: boolean }) => (
  <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 transition-all hover:shadow-xl dark:border-slate-800 dark:bg-slate-900 group">
    <div className="flex items-center justify-between gap-3 sm:gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 truncate group-hover:text-blue-500 transition-colors">{title}</p>
        <div className="mt-1 sm:mt-2 flex items-baseline gap-2">
          {loading ? (
            <div className="h-8 w-16 bg-slate-200 dark:bg-slate-700 rounded animate-pulse"></div>
          ) : (
            <h3 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">{value}</h3>
          )}
          {!loading && trend && (
            <span className={`text-[9px] sm:text-[10px] font-black px-1.5 py-0.5 rounded-md ${trend.positive ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'}`}>
              {trend.value}
            </span>
          )}
        </div>
      </div>
      <div className={`flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-2xl shadow-lg shrink-0 transition-transform group-hover:scale-110 ${bgClass} ${iconClass}`}>
        <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
      </div>
    </div>
    {dekorClass && <div className={`absolute -right-4 -bottom-4 h-20 w-20 sm:h-24 sm:w-24 rounded-full opacity-10 group-hover:opacity-20 transition-all ${dekorClass}`} />}
  </div>
);




interface LeaveSplit {
  _id?: string;
  date: string;
  leaveType: string;
  leaveNature?: 'paid' | 'lop' | 'without_pay';
  isHalfDay?: boolean;
  halfDayType?: 'first_half' | 'second_half' | null;
  status: 'approved' | 'rejected';
  numberOfDays?: number;
  notes?: string | null;
}

interface LeaveSplitSummary {
  originalDays: number;
  originalLeaveType: string;
  totalSplits: number;
  approvedDays: number;
  rejectedDays: number;
  breakdown: Record<
    string,
    {
      leaveType: string;
      status: string;
      days: number;
    }
  >;
}

interface Employee {
  _id: string;
  employee_name: string;
  emp_no: string;
  department?: { _id: string; name: string };
  designation?: { _id: string; name: string };
  phone_number?: string;
  // Some systems may use first_name/last_name
  first_name?: string;
  last_name?: string;
}

// Helper to get display name
const getEmployeeName = (emp: Employee) => {
  if (emp.employee_name) return emp.employee_name;
  if (emp.first_name && emp.last_name) return `${emp.first_name} ${emp.last_name}`;
  if (emp.first_name) return emp.first_name;
  return emp.emp_no;
};

// Helper to get initials
const getEmployeeInitials = (emp: Employee) => {
  const name = getEmployeeName(emp);
  const parts = name.trim().split(' ');
  if (parts.length >= 2) {
    return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
  }
  return (name[0] || 'E').toUpperCase();
};

interface LeaveApplication {
  _id: string;
  employeeId?: {
    _id: string;
    employee_name?: string;
    first_name?: string;
    last_name?: string;
    emp_no: string;
  };
  emp_no?: string;
  leaveType: string;
  fromDate: string;
  toDate: string;
  numberOfDays: number;
  isHalfDay?: boolean;
  halfDayType?: string;
  purpose: string;
  contactNumber?: string;
  status: string;
  originalLeaveType?: string;
  splitStatus?: 'pending_split' | 'split_approved' | 'split_rejected' | null;
  splits?: LeaveSplit[];
  splitSummary?: LeaveSplitSummary | null;
  department?: { name: string };
  designation?: { name: string };
  appliedAt: string;
  appliedBy?: { _id: string; name: string; email: string };
  workflow?: {
    nextApprover?: string;
    nextApproverRole?: string;
    approvalChain?: Array<{
      stepOrder?: number;
      role?: string;
      stepRole?: string;
      label?: string;
      status?: string;
      actionBy?: string | { _id: string };
      actionByName?: string;
      actionByRole?: string;
      comments?: string;
      updatedAt?: string;
    }>;
    history?: any[];
  };
  changeHistory?: Array<{
    field: string;
    originalValue: any;
    newValue: any;
    modifiedBy?: { _id: string; name: string; email: string; role: string };
    modifiedByName?: string;
    modifiedByRole?: string;
    modifiedAt: string;
    reason?: string;
  }>;
  approvals?: {
    hod?: {
      approvedAt?: string;
    };
    hr?: {
      approvedAt?: string;
    };
  };
}

interface ODApplication {
  _id: string;
  employeeId?: {
    _id?: string;
    employee_name?: string;
    first_name?: string;
    last_name?: string;
    emp_no: string;
  };
  emp_no?: string;
  odType: string;
  odType_extended?: 'full_day' | 'half_day' | 'hours' | null;
  odStartTime?: string;
  odEndTime?: string;
  durationHours?: number;
  fromDate: string;
  toDate: string;
  numberOfDays: number;
  isHalfDay?: boolean;
  halfDayType?: string;
  purpose: string;
  placeVisited?: string;
  contactNumber?: string;
  status: string;
  department?: { name: string };
  designation?: { name: string };
  appliedAt: string;
  appliedBy?: { _id: string; name: string; email: string };
  assignedBy?: { name: string };
  workflow?: {
    nextApprover?: string;
    nextApproverRole?: string;
    approvalChain?: Array<{
      stepOrder?: number;
      role?: string;
      stepRole?: string;
      label?: string;
      status?: string;
      actionBy?: string | { _id: string };
      actionByName?: string;
      actionByRole?: string;
      comments?: string;
      updatedAt?: string;
    }>;
    history?: any[];
  };
  changeHistory?: Array<{
    field: string;
    originalValue: any;
    newValue: any;
    modifiedBy?: { _id: string; name: string; email: string; role: string };
    modifiedByName?: string;
    modifiedByRole?: string;
    modifiedAt: string;
    reason?: string;
  }>;
  approvals?: {
    hod?: {
      approvedAt?: string;
    };
    hr?: {
      approvedAt?: string;
    };
  };
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'approved':
      return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    case 'pending':
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
    case 'hod_approved':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    case 'rejected':
    case 'hod_rejected':
    case 'hr_rejected':
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    case 'cancelled':
      return 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400';
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400';
  }
};

// Helper to format date for HTML date input (YYYY-MM-DD)
const formatDateForInput = (dateStr: string) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const parseDateOnly = (value: Date | string) => {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const str = String(value);
  const datePart = str.includes('T') ? str.split('T')[0] : str;
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return new Date(`${datePart}T00:00:00`);
  }
  const d = new Date(str);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

const toISODate = (date: Date | string) => {
  const d = parseDateOnly(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const clampSplitsToRange = (leave: LeaveApplication, splits: LeaveSplit[]) => {
  const start = parseDateOnly(leave.fromDate).getTime();
  const end = parseDateOnly(leave.toDate).getTime();
  const byKey = new Map<string, LeaveSplit>();

  splits.forEach((s) => {
    const d = parseDateOnly(s.date);
    const t = d.getTime();
    if (Number.isNaN(t) || t < start || t > end) return;
    const iso = toISODate(d);
    const key = `${iso}_${s.isHalfDay ? s.halfDayType || 'half' : 'full'}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        ...s,
        date: iso,
        numberOfDays: s.numberOfDays ?? (s.isHalfDay ? 0.5 : 1),
        halfDayType: s.isHalfDay ? (s.halfDayType as any) || 'first_half' : null,
      });
    }
  });

  return Array.from(byKey.values()).sort(
    (a, b) => parseDateOnly(a.date).getTime() - parseDateOnly(b.date).getTime()
  );
};

const buildDateRange = (fromDate: string, toDate: string, isHalfDay?: boolean, halfDayType?: string | null) => {
  const dates: LeaveSplit[] = [];
  const start = parseDateOnly(fromDate);
  const end = parseDateOnly(toDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  const current = new Date(start);
  while (current <= end) {
    const isSingleHalf = isHalfDay && start.getTime() === end.getTime();
    dates.push({
      date: toISODate(current),
      leaveType: '',
      status: 'approved',
      isHalfDay: Boolean(isSingleHalf),
      halfDayType: isSingleHalf ? (halfDayType as any) || 'first_half' : null,
      numberOfDays: isSingleHalf ? 0.5 : 1,
    });
    current.setDate(current.getDate() + 1);
  }
  return dates;
};

// Compute requested leave days from fromDate, toDate, isHalfDay (same logic as backend)
const getRequestedDays = (fromDate: string, toDate: string, isHalfDay: boolean): number => {
  if (!fromDate || !toDate) return 0;
  if (isHalfDay) return 0.5;
  const from = parseDateOnly(fromDate);
  const to = parseDateOnly(toDate);
  const diffTime = Math.abs(to.getTime() - from.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
};

// Min/max date strings from leave or OD policy (allowBackdated, maxBackdatedDays, allowFutureDated, maxAdvanceDays)
const getPolicyDateBounds = (policy: { allowBackdated?: boolean; maxBackdatedDays?: number; allowFutureDated?: boolean; maxAdvanceDays?: number }) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let minDate = new Date(today);
  let maxDate = new Date(today);
  if (policy.allowBackdated && (policy.maxBackdatedDays ?? 0) > 0) {
    minDate.setDate(minDate.getDate() - (policy.maxBackdatedDays ?? 0));
  }
  if (policy.allowFutureDated && (policy.maxAdvanceDays ?? 0) > 0) {
    maxDate.setDate(maxDate.getDate() + (policy.maxAdvanceDays ?? 0));
  }
  return {
    minDate: minDate.toISOString().split('T')[0],
    maxDate: maxDate.toISOString().split('T')[0],
  };
};

export default function LeavesPage() {
  const { getModuleConfig, hasPermission, activeWorkspace } = useWorkspace();
  const [activeTab, setActiveTab] = useState<'leaves' | 'od' | 'pending' | 'in_progress'>('leaves');
  const [leaves, setLeaves] = useState<LeaveApplication[]>([]);
  const [ods, setODs] = useState<ODApplication[]>([]);
  const [pendingLeaves, setPendingLeaves] = useState<LeaveApplication[]>([]);
  const [pendingODs, setPendingODs] = useState<ODApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  // Pay cycle start day from settings (default 1)
  const [payCycleStartDay, setPayCycleStartDay] = useState(1);

  // Date range filter — defaults to current pay-cycle (startDay of month/prev month → today)
  const getDefaultDateRange = (startDay: number = 1) => {
    const now = new Date();
    const today = now.getDate();
    let startDate = new Date(now);

    // If startDay > 1 and today < startDay, cycle started in previous month
    if (startDay > 1 && today < startDay) {
      startDate.setMonth(startDate.getMonth() - 1);
    }

    startDate.setDate(startDay);
    const format = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { from: format(startDate), to: format(now) };
  };

  const getPreviousPayCycle = (startDay: number = 1) => {
    const { from } = getDefaultDateRange(startDay);
    const startDate = new Date(from);

    const prevEnd = new Date(startDate);
    prevEnd.setDate(prevEnd.getDate() - 1);

    const prevStart = new Date(startDate);
    prevStart.setMonth(prevStart.getMonth() - 1);

    const format = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { from: format(prevStart), to: format(prevEnd) };
  };

  const getLast3MonthsPayCycle = (startDay: number = 1) => {
    const { to } = getDefaultDateRange(startDay);
    const { from } = getDefaultDateRange(startDay);
    const startDate = new Date(from);
    startDate.setMonth(startDate.getMonth() - 2); // 3 cycles total including current

    const format = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { from: format(startDate), to };
  };

  const [dateRange, setDateRange] = useState(() => getDefaultDateRange(1));
  const [error, setError] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Permission checks using read/write pattern
  // Write permission enables ALL actions (apply, approve, reject, cancel)
  // Read permission blocks all actions (view only)
  // Future: When implementing granular permissions, only permissions.ts needs updating
  const user = auth.getUser();
  const hasViewPermission = user ? canViewLeaves(user as any) : false;
  const hasManagePermission = user ? canApproveLeaves(user as any) : false; // Write permission for ALL actions

  // Permission states (Workspace based)
  const [canApplyLeaveForSelf, setCanApplyLeaveForSelf] = useState(false);
  const [canApplyLeaveForOthers, setCanApplyLeaveForOthers] = useState(false);
  const [canApplyODForSelf, setCanApplyODForSelf] = useState(false);
  const [canApplyODForOthers, setCanApplyODForOthers] = useState(false);
  const [canApplyForSelf, setCanApplyForSelf] = useState(false);
  const [canApplyForOthers, setCanApplyForOthers] = useState(false);
  const [canRevoke, setCanRevoke] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');

  // Dialog states
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [applyType, setApplyType] = useState<'leave' | 'od'>('leave');
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [isChangeHistoryExpanded, setIsChangeHistoryExpanded] = useState(false);
  const [isBreakdownExpanded, setIsBreakdownExpanded] = useState(false);
  const [selectedItem, setSelectedItem] = useState<LeaveApplication | ODApplication | null>(null);
  const [detailType, setDetailType] = useState<'leave' | 'od'>('leave');
  const [actionComment, setActionComment] = useState('');
  const [splitMode, setSplitMode] = useState(false);
  const [splitDrafts, setSplitDrafts] = useState<LeaveSplit[]>([]);
  const [splitWarnings, setSplitWarnings] = useState<string[]>([]);
  const [splitErrors, setSplitErrors] = useState<string[]>([]);
  const [splitSaving, setSplitSaving] = useState(false);

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editFormData, setEditFormData] = useState<any>({});

  // Leave types and OD types
  const [leaveTypes, setLeaveTypes] = useState<any[]>([]);
  const [odTypes, setODTypes] = useState<any[]>([]);

  // Leave / OD policy (backdated & future-date bounds)
  const defaultPolicy = { allowBackdated: false, maxBackdatedDays: 0, allowFutureDated: true, maxAdvanceDays: 90 };
  const [leavePolicy, setLeavePolicy] = useState<typeof defaultPolicy>(defaultPolicy);
  const [odPolicy, setODPolicy] = useState<typeof defaultPolicy>({ ...defaultPolicy, allowBackdated: true, maxBackdatedDays: 30 });
  const [leaveWorkflowAllowHigherAuthority, setLeaveWorkflowAllowHigherAuthority] = useState(false);
  const [leaveWorkflowRoleOrder, setLeaveWorkflowRoleOrder] = useState<string[]>([]);
  const [odWorkflowAllowHigherAuthority, setODWorkflowAllowHigherAuthority] = useState(false);
  const [odWorkflowRoleOrder, setODWorkflowRoleOrder] = useState<string[]>([]);

  // Employees for "Apply For" selection
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [defaultEmployees, setDefaultEmployees] = useState<Employee[]>([]); // Store initial loaded employees
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchTerm, setSearchTerm] = useState(''); // Global search for lists
  const [showEmployeeDropdown, setShowEmployeeDropdown] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  // CL balances for selected month/year (when leave type is CL)
  const [clBalanceForMonth, setClBalanceForMonth] = useState<number | null>(null);
  const [clAnnualBalance, setClAnnualBalance] = useState<number | null>(null);
  const [cclBalance, setCclBalance] = useState<number | null>(null);
  const [clBalanceLoading, setClBalanceLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');

  // Form state
  const [formData, setFormData] = useState<{
    leaveType: string;
    odType: string;
    odType_extended: string;
    odStartTime: string | null;
    odEndTime: string | null;
    fromDate: string;
    toDate: string;
    purpose: string;
    contactNumber: string;
    placeVisited: string;
    isHalfDay: boolean;
    halfDayType: 'first_half' | 'second_half' | null;
    remarks: string;
  }>({
    leaveType: '',
    odType: '',
    odType_extended: 'full_day',
    odStartTime: '',
    odEndTime: '',
    fromDate: '',
    toDate: '',
    purpose: '',
    contactNumber: '',
    placeVisited: '',
    isHalfDay: false,
    halfDayType: null,
    remarks: '',
  });

  const [leaveFilters, setLeaveFilters] = useState({
    employeeNumber: '',
    status: '',
    leaveType: '',
    startDate: '',
    endDate: '',
    division: '',
    department: ''
  });

  // Evidence State
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [locationData, setLocationData] = useState<any | null>(null);
  const [evidencePreview, setEvidencePreview] = useState<string | null>(null);

  // Approved records info for conflict checking
  const [approvedRecordsInfo, setApprovedRecordsInfo] = useState<{
    hasLeave: boolean;
    hasOD: boolean;
    leaveInfo: any;
    odInfo: any;
  } | null>(null);
  const [checkingApprovedRecords, setCheckingApprovedRecords] = useState(false);

  // Holiday info for OD
  const [holidayInfo, setHolidayInfo] = useState<{ isHolidayOrWeekOff: boolean, message: string } | null>(null);
  const [checkingHoliday, setCheckingHoliday] = useState(false);

  // Form validation for Apply button
  const isFormValid = () => {
    // 1. Common required fields
    if (!formData.fromDate || !formData.toDate || !formData.purpose || !formData.contactNumber) {
      return false;
    }

    // 2. Employee selection (required for non-employee roles)
    if (currentUser?.role !== 'employee' && !selectedEmployee) {
      return false;
    }

    // 3. Type-specific validation
    if (applyType === 'leave') {
      if (!formData.leaveType) return false;
    } else {
      // OD Validation
      if (!formData.odType || !formData.placeVisited) return false;

      // Hours-specific OD
      if (formData.odType_extended === 'hours') {
        if (!formData.odStartTime || !formData.odEndTime) return false;
      }

      // Photo Evidence & Location required for OD (typically mandatory in this system)
      if (!evidenceFile || !locationData) return false;
    }

    return true;
  };

  useEffect(() => {
    const user = auth.getUser();
    if (user) {
      setCurrentUser(user);
      if (user.role === 'super_admin') {
        setIsSuperAdmin(true);
      }
    }
    loadData(user, dateRange);
    loadTypes();
  }, []);

  // Fetch pay cycle start day setting on mount
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await api.getSetting('payroll_cycle_start_day');
        if (res?.data?.value) {
          const startDay = parseInt(res.data.value, 10);
          if (!isNaN(startDay) && startDay >= 1 && startDay <= 31) {
            setPayCycleStartDay(startDay);
            // Update the default date range now that we have the actual start day
            setDateRange(getDefaultDateRange(startDay));
          }
        }
      } catch (err) {
        console.error('Failed to fetch payroll_cycle_start_day:', err);
      }
    };
    fetchSettings();
  }, []);

  // Re-fetch when date range changes
  useEffect(() => {
    if (currentUser) {
      loadData(currentUser, dateRange);
    }
  }, [dateRange.from, dateRange.to]);

  // Load employees and permissions when user or workspace changes
  useEffect(() => {
    if (currentUser) {
      // For Admins/HR/HODs, we can load employees even if activeWorkspace is not yet ready
      // as they have a broader scope. For employees, we load self.
      const isAdmin = ['hr', 'super_admin', 'sub_admin', 'manager', 'hod'].includes(currentUser.role);
      if (isAdmin || activeWorkspace) {
        loadEmployees();
        checkWorkspacePermission();
      }
    }
  }, [currentUser, activeWorkspace?._id]);

  const loadData = async (user?: any, range?: { from: string; to: string }) => {
    setLoading(true);
    const activeRange = range || dateRange;
    try {
      const role = user?.role || currentUser?.role;
      const isEmployee = role === 'employee';

      if (isEmployee) {
        // Employee Plan: Fetch MY leaves/ODs scoped by date range
        const [leavesRes, odsRes] = await Promise.all([
          api.getMyLeaves({ fromDate: activeRange.from, toDate: activeRange.to }),
          api.getMyODs({ fromDate: activeRange.from, toDate: activeRange.to }),
        ]);

        const myLeaves = leavesRes.success ? (leavesRes.data as LeaveApplication[]) : [];
        const myODs = odsRes.success ? (odsRes.data as ODApplication[]) : [];

        setLeaves(myLeaves);
        setODs(myODs);

        // For employees, "Pending" means "My Pending Requests"
        setPendingLeaves(myLeaves.filter(l => l.status === 'pending'));
        setPendingODs(myODs.filter(o => o.status === 'pending'));

        // Reset check (management feature)
        setCheckingApprovedRecords(false);

      } else {
        // Manager/HOD/Admin Plan:
        const [leavesRes, odsRes, pendingLeavesRes, pendingODsRes] = await Promise.all([
          api.getLeaves({ limit: 500, fromDate: activeRange.from, toDate: activeRange.to }),
          api.getODs({ limit: 500, fromDate: activeRange.from, toDate: activeRange.to }),
          api.getPendingLeaveApprovals({ fromDate: activeRange.from, toDate: activeRange.to }),
          api.getPendingODApprovals({ fromDate: activeRange.from, toDate: activeRange.to }),
        ]);

        if (leavesRes.success) setLeaves(leavesRes.data || []);
        if (odsRes.success) setODs(odsRes.data || []);
        if (pendingLeavesRes.success) setPendingLeaves(pendingLeavesRes.data || []);
        if (pendingODsRes.success) setPendingODs(pendingODsRes.data || []);
      }

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load data';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const loadCurrentUser = async () => {
    try {
      const response = await api.getCurrentUser();
      if (response.success) {
        // getCurrentUser returns { user, workspaces, activeWorkspace }
        const userData = (response as any).user || (response as any).data?.user;
        if (userData) {
          setCurrentUser(userData);
        }
      }
    } catch (err) {
      console.error('Failed to load current user:', err);
    }
  };

  const checkWorkspacePermission = async () => {
    try {
      const workspaceId = activeWorkspace?._id;
      const isAdmin = currentUser && ['manager', 'hod', 'hr', 'super_admin', 'sub_admin'].includes(currentUser.role);

      console.log('[Workspace Leaves] Checking permissions for workspace:', workspaceId, activeWorkspace?.name);

      if (!workspaceId && !isAdmin) {
        console.log('[Workspace Leaves] No workspace ID found and not an admin. Resetting permissions.');
        setCanApplyLeaveForSelf(false);
        setCanApplyLeaveForOthers(false);
        setCanApplyODForSelf(false);
        setCanApplyODForOthers(false);
        setCanApplyForSelf(false);
        setCanApplyForOthers(false);
        return;
      }

      // Employee workspace: can only apply for self (if enabled)
      if (activeWorkspace?.type === 'employee') {
        console.log('[Workspace Leaves] Employee workspace - allowing self-application only');
        setCanApplyLeaveForSelf(true);
        setCanApplyLeaveForOthers(false);
        setCanApplyODForSelf(true);
        setCanApplyODForOthers(false);
        setCanApplyForSelf(true);
        setCanApplyForOthers(false);
        return;
      }

      // Check both leave and od settings for workspace permissions (and workflow options for approve/reject visibility)
      const [leaveSettingsRes, odSettingsRes] = await Promise.all([
        api.getLeaveSettings('leave'),
        api.getLeaveSettings('od'),
      ]);

      console.log('[Workspace Leaves] Leave settings response:', leaveSettingsRes);
      console.log('[Workspace Leaves] OD settings response:', odSettingsRes);

      // Apply workflow "allow higher authority" and role order so Pending tab shows Approve/Reject when setting is on
      if (leaveSettingsRes.success && leaveSettingsRes.data?.workflow) {
        const wf = leaveSettingsRes.data.workflow as { allowHigherAuthorityToApproveLowerLevels?: boolean; steps?: { stepOrder: number; approverRole: string }[] };
        setLeaveWorkflowAllowHigherAuthority(Boolean(wf.allowHigherAuthorityToApproveLowerLevels));
        const steps = (wf.steps || []).slice().sort((a: any, b: any) => (a.stepOrder ?? 999) - (b.stepOrder ?? 999));
        setLeaveWorkflowRoleOrder(steps.map((st: any) => String(st.approverRole || '').toLowerCase()).filter(Boolean));
      }
      if (odSettingsRes.success && odSettingsRes.data?.workflow) {
        const wf = odSettingsRes.data.workflow as { allowHigherAuthorityToApproveLowerLevels?: boolean; steps?: { stepOrder: number; approverRole: string }[] };
        setODWorkflowAllowHigherAuthority(Boolean(wf.allowHigherAuthorityToApproveLowerLevels));
        const steps = (wf.steps || []).slice().sort((a: any, b: any) => (a.stepOrder ?? 999) - (b.stepOrder ?? 999));
        setODWorkflowRoleOrder(steps.map((st: any) => String(st.approverRole || '').toLowerCase()).filter(Boolean));
      }

      // Do not use workspace permissions from settings; role-based only
      let leaveSelf = false;
      let leaveOthers = false;
      let odSelf = false;
      let odOthers = false;
      if (currentUser) {
        if (currentUser.role === 'employee') {
          leaveSelf = true;
          leaveOthers = false;
          odSelf = true;
          odOthers = false;
        } else if (['manager', 'hod', 'hr', 'super_admin', 'sub_admin'].includes(currentUser.role)) {
          leaveSelf = true;
          leaveOthers = true;
          odSelf = true;
          odOthers = true;
        }
      }
      setCanApplyLeaveForSelf(leaveSelf);
      setCanApplyLeaveForOthers(leaveOthers);
      setCanApplyODForSelf(odSelf);
      setCanApplyODForOthers(odOthers);
      setCanApplyForSelf(leaveSelf || odSelf);
      setCanApplyForOthers(leaveOthers || odOthers);
    } catch (err) {
      console.error('[Workspace Leaves] Failed to check workspace permission:', err);
      setCanApplyLeaveForSelf(false);
      setCanApplyLeaveForOthers(false);
      setCanApplyODForSelf(false);
      setCanApplyODForOthers(false);
      setCanApplyForSelf(false);
      setCanApplyForOthers(false);
    }
  };

  const loadEmployees = async () => {
    try {
      if (!currentUser) return;

      // Load employees logic (based on Role)
      if (currentUser) {
        // 1. Employee: Load self profile only
        if (currentUser.role === 'employee') {
          // console.log('[Workspace Leaves] Loading data for employee:', currentUser);
          // Try to get employee details using linked employeeId or emp_no
          const identifier = (currentUser as any).emp_no || currentUser.employeeId;

          let employeeLoaded = false;

          if (identifier) {
            try {
              const response = await api.getEmployee(identifier);
              if (response.success && response.data) {
                setEmployees([response.data]);
                employeeLoaded = true;
              }
            } catch (fetchErr: any) {
              // Only log if it's not a known "deactivated" error which we handle by fallback
              if (!fetchErr?.message?.includes('deactivated')) {
                console.error('Error fetching employee details:', fetchErr);
              }
            }
          }

          // Fallback: If API failed or no identifier, but we are logged in as employee,
          // create a synthetic employee object from currentUser to allow application
          if (!employeeLoaded) {
            // console.warn('Using synthetic employee data from currentUser');
            const syntheticEmployee: any = {
              _id: currentUser!.id || 'current-user',
              emp_no: identifier || 'UNKNOWN',
              employee_name: currentUser!.name,
              email: currentUser!.email,
              role: 'employee',
              phone_number: (currentUser as any).phone || '',
              department: currentUser!.department,
            };
            setEmployees([syntheticEmployee]);
          }

        }
        // 2. HOD: Access to own department employees
        else {
          // console.log(`[Workspace Leaves] Loading employees for ${currentUser.role}.`);

          const query: any = { is_active: true };
          if (currentUser.role === 'hod') {
            const deptId = typeof currentUser.department === 'object' && currentUser.department ? currentUser.department._id : currentUser.department;
            if (deptId) {
              query.department_id = deptId;
            }
          }

          const response = await api.getEmployees(query);
          if (response.success) {
            if (!Array.isArray(response.data)) {
              console.error('[Workspace Leaves] Expected array for employees but got:', typeof response.data);
              setEmployees([]);
              return;
            }

            let employeesList = response.data;

            // Ensure current user is included in the list (if they have an emp_no)
            const identifier = (currentUser as any).emp_no || currentUser.employeeId;
            const selfExists = employeesList.some((emp: any) => emp && (emp.emp_no === identifier || emp._id === currentUser.id));

            if (!selfExists && identifier) {
              try {
                const selfRes = await api.getEmployee(identifier);
                if (selfRes.success && selfRes.data) {
                  employeesList = [selfRes.data, ...employeesList];
                }
              } catch (err) {
                console.error('Error fetching self for list:', err);
              }
            }

            setEmployees(employeesList);
            setDefaultEmployees(employeesList); // Set defaults
          } else {
            // Suppress error for deactivated accounts as this is expected state for some contexts
            if (response.message !== 'Employee account is deactivated') {
              console.error('[Workspace Leaves] Failed to fetch employees:', response.message);
            }
          }
        }
      } else {
        // Fallback if currentUser not loaded yet
        setEmployees([]);
      }
    } catch (err: any) {
      console.error('Failed to load employees [Critical]:', err?.message || err);
      // Attempt to print full error object if possible
      try {
        console.error(JSON.stringify(err, null, 2));
      } catch (e) { /* ignore */ }
      setEmployees([]);
    }
  };

  const loadTypes = async () => {
    try {
      // Load from settings API
      const [leaveSettingsRes, odSettingsRes] = await Promise.all([
        api.getLeaveSettings('leave'),
        api.getLeaveSettings('od'),
      ]);

      // Extract leave types from settings (field is 'types' not 'leaveTypes')
      let fetchedLeaveTypes: any[] = [];
      if (leaveSettingsRes.success && leaveSettingsRes.data?.types) {
        fetchedLeaveTypes = leaveSettingsRes.data.types.filter((t: any) => t.isActive !== false);
      }

      // Store leave policy settings
      if (leaveSettingsRes.success && leaveSettingsRes.data?.settings) {
        const s = leaveSettingsRes.data.settings;
        setLeavePolicy({
          allowBackdated: s.allowBackdated ?? false,
          maxBackdatedDays: s.maxBackdatedDays ?? 0,
          allowFutureDated: s.allowFutureDated ?? true,
          maxAdvanceDays: s.maxAdvanceDays ?? 90,
        });
      }
      // Leave workflow: allow higher authority to approve lower levels
      if (leaveSettingsRes.success && leaveSettingsRes.data?.workflow) {
        const wf = leaveSettingsRes.data.workflow as { allowHigherAuthorityToApproveLowerLevels?: boolean; steps?: { stepOrder: number; approverRole: string }[] };
        setLeaveWorkflowAllowHigherAuthority(Boolean(wf.allowHigherAuthorityToApproveLowerLevels));
        const steps = (wf.steps || []).slice().sort((a: any, b: any) => (a.stepOrder ?? 999) - (b.stepOrder ?? 999));
        setLeaveWorkflowRoleOrder(steps.map((st: any) => String(st.approverRole || '').toLowerCase()).filter(Boolean));
      }

      // Extract OD types from settings (field is 'types' not 'odTypes')
      let fetchedODTypes: any[] = [];
      if (odSettingsRes.success && odSettingsRes.data?.types) {
        fetchedODTypes = odSettingsRes.data.types.filter((t: any) => t.isActive !== false);
      }

      // Store OD policy settings
      if (odSettingsRes.success && odSettingsRes.data?.settings) {
        const s = odSettingsRes.data.settings;
        setODPolicy({
          allowBackdated: s.allowBackdated ?? true,
          maxBackdatedDays: s.maxBackdatedDays ?? 30,
          allowFutureDated: s.allowFutureDated ?? true,
          maxAdvanceDays: s.maxAdvanceDays ?? 90,
        });
      }
      // OD workflow: allow higher authority to approve lower levels
      if (odSettingsRes.success && odSettingsRes.data?.workflow) {
        const wf = odSettingsRes.data.workflow as { allowHigherAuthorityToApproveLowerLevels?: boolean; steps?: { stepOrder: number; approverRole: string }[] };
        setODWorkflowAllowHigherAuthority(Boolean(wf.allowHigherAuthorityToApproveLowerLevels));
        const steps = (wf.steps || []).slice().sort((a: any, b: any) => (a.stepOrder ?? 999) - (b.stepOrder ?? 999));
        setODWorkflowRoleOrder(steps.map((st: any) => String(st.approverRole || '').toLowerCase()).filter(Boolean));
      }

      // Use fetched types or defaults
      if (fetchedLeaveTypes.length > 0) {
        setLeaveTypes(fetchedLeaveTypes);
      } else {
        // Fallback defaults
        setLeaveTypes([
          { code: 'CL', name: 'Casual Leave' },
          { code: 'SL', name: 'Sick Leave' },
          { code: 'EL', name: 'Earned Leave' },
          { code: 'LWP', name: 'Leave Without Pay' },
        ]);
      }

      if (fetchedODTypes.length > 0) {
        setODTypes(fetchedODTypes);
      } else {
        // Fallback defaults
        setODTypes([
          { code: 'OFFICIAL', name: 'Official Work' },
          { code: 'TRAINING', name: 'Training' },
          { code: 'MEETING', name: 'Meeting' },
          { code: 'CLIENT', name: 'Client Visit' },
        ]);
      }
    } catch (err) {
      console.error('Failed to load types:', err);
      // Set defaults if API fails
      setLeaveTypes([
        { code: 'CL', name: 'Casual Leave' },
        { code: 'SL', name: 'Sick Leave' },
        { code: 'EL', name: 'Earned Leave' },
        { code: 'LWP', name: 'Leave Without Pay' },
      ]);
      setODTypes([
        { code: 'OFFICIAL', name: 'Official Work' },
        { code: 'TRAINING', name: 'Training' },
        { code: 'MEETING', name: 'Meeting' },
        { code: 'CLIENT', name: 'Client Visit' },
      ]);
    }
  };



  // Filter employees based on search
  // Filter employees based on search
  // Debounced Search Effect
  useEffect(() => {
    const timer = setTimeout(async () => {
      // If search is empty, revert to default
      if (!employeeSearch.trim()) {
        if (employees.length !== defaultEmployees.length) {
          setEmployees(defaultEmployees);
        }
        return;
      }

      // If search matches one of the local employees, we can show that (client-side filter)
      // BUT for better coverage, we'll fetch from server if it's not a generic query
      setIsSearching(true);

      try {
        const query: any = { is_active: true, search: employeeSearch };

        // Apply same restrictions as loadEmployees
        if (currentUser.role === 'hod') {
          const deptId = typeof currentUser.department === 'object' && currentUser.department ? currentUser.department._id : currentUser.department;
          if (deptId) {
            query.department_id = deptId;
          }
        }

        // Keep current user in list if they match (handled by backend or we append)
        const response = await api.getEmployees(query);

        if (response.success && Array.isArray(response.data)) {
          // Ensure the currently selected employee is preserved if they wouldn't be in the new list?
          // For now just show results.
          setEmployees(response.data);
        }
      } catch (err) {
        console.error('Error searching employees:', err);
      } finally {
        setIsSearching(false);
      }

    }, 500); // 500ms debounce

    return () => clearTimeout(timer);
  }, [employeeSearch, currentUser, defaultEmployees]); // Depend on defaultEmployees for revert

  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      const searchLower = employeeSearch.toLowerCase();
      const fullName = getEmployeeName(emp).toLowerCase();
      return (
        fullName.includes(searchLower) ||
        emp.emp_no?.toLowerCase().includes(searchLower) ||
        emp.department?.name?.toLowerCase().includes(searchLower)
      );
    });
  }, [employees, employeeSearch]);
  const openApplyDialog = (type: 'leave' | 'od') => {
    setApplyType(type);
    resetForm();
    setShowApplyDialog(true);
  };

  const handleSelectEmployee = (employee: Employee) => {
    setSelectedEmployee(employee);
    setEmployeeSearch('');
    setShowEmployeeDropdown(false);
    if (employee.phone_number) {
      setFormData(prev => ({ ...prev, contactNumber: employee.phone_number || '' }));
    }
  };

  // Auto-select employee for employee role when dialog opens
  useEffect(() => {
    console.log('[Workspace Leaves] Auto-select effect. Show:', showApplyDialog, 'Role:', currentUser?.role, 'Employees:', employees.length);
    if (showApplyDialog && currentUser?.role === 'employee' && employees.length > 0) {
      if (!selectedEmployee || selectedEmployee._id !== employees[0]._id) {
        console.log('[Workspace Leaves] Auto-selecting employee:', employees[0]);
        handleSelectEmployee(employees[0]);
      }
    }
  }, [showApplyDialog, currentUser, employees]);



  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setLoadingMessage('Initializing...');

    try {
      let employeeToApplyFor = selectedEmployee;

      console.log('[Workspace Leaves] Apply. Selected:', selectedEmployee, 'Role:', currentUser?.role, 'Employees count:', employees.length);

      // Fallback: If no employee selected but current user is employee
      if (!employeeToApplyFor && currentUser?.role === 'employee') {
        if (employees.length > 0) {
          employeeToApplyFor = employees[0];
        } else {
          console.warn('[Workspace Leaves] Constructing synthetic employee in handleApply fallback');
          employeeToApplyFor = {
            _id: currentUser.id || 'current-user',
            emp_no: (currentUser as any).emp_no || currentUser.employeeId || 'UNKNOWN',
            employee_name: currentUser.name || 'Current User',
            email: currentUser.email || '',
            role: 'employee',
            phone_number: (currentUser as any).phone || '',
            department: currentUser.department,
          } as Employee;
        }
      }

      if (!employeeToApplyFor) {
        toast.error('Please select an employee');
        setLoading(false);
        return;
      }

      // 1. Validation
      const policy = applyType === 'leave' ? leavePolicy : odPolicy;
      const { minDate: policyMin, maxDate: policyMax } = getPolicyDateBounds(policy);
      if (formData.fromDate && (formData.fromDate < policyMin || formData.fromDate > policyMax)) {
        toast.error(
          applyType === 'leave'
            ? `From date must be within the allowed range (${policyMin} to ${policyMax}) as per leave settings.`
            : `Date must be within the allowed range (${policyMin} to ${policyMax}) as per OD settings.`
        );
        setLoading(false);
        return;
      }
      if (formData.toDate && (formData.toDate < policyMin || formData.toDate > policyMax)) {
        toast.error(`To date must be within the allowed range (${policyMin} to ${policyMax}) as per ${applyType === 'leave' ? 'leave' : 'OD'} settings.`);
        setLoading(false);
        return;
      }

      if (applyType === 'leave') {
        if (!formData.leaveType || !formData.fromDate || !formData.toDate || !formData.purpose) {
          toast.error('Please fill all required fields');
          setLoading(false);
          return;
        }
        // CL: validate only on frontend — require balance to be loaded, then cap by balance
        const isCL = formData.leaveType === 'CL' || formData.leaveType?.toUpperCase() === 'CL';
        if (isCL) {
          if (clBalanceForMonth === null && !clBalanceLoading) {
            toast.error('CL balance could not be loaded. Please select employee and from date again, or try again.');
            setLoading(false);
            return;
          }
          if (clBalanceForMonth === null) {
            toast.error('Please wait for CL balance to load.');
            setLoading(false);
            return;
          }
          const requestedDays = getRequestedDays(formData.fromDate, formData.toDate, formData.isHalfDay);
          if (requestedDays > clBalanceForMonth) {
            toast.error(`CL allowed for this pay period is ${clBalanceForMonth} day(s). You selected ${requestedDays} day(s). Please reduce the date range.`);
            setLoading(false);
            return;
          }
        }
      } else {
        if (!formData.odType || !formData.fromDate || !formData.toDate || !formData.purpose || !formData.placeVisited) {
          toast.error('Please fill all required fields');
          setLoading(false);
          return;
        }
        if (formData.odType_extended === 'hours' && (!formData.odStartTime || !formData.odEndTime)) {
          toast.error('Please provide start and end times for hour-based OD');
          setLoading(false);
          return;
        }
      }

      // Check for conflicts
      if (approvedRecordsInfo) {
        const hasFullDayApproved = (approvedRecordsInfo.hasLeave && !approvedRecordsInfo.leaveInfo?.isHalfDay) ||
          (approvedRecordsInfo.hasOD && !approvedRecordsInfo.odInfo?.isHalfDay);

        if (hasFullDayApproved) {
          toast.error('Employee already has an approved full-day record on this date');
          setLoading(false);
          return;
        }

        if (formData.isHalfDay) {
          const approvedHalfDayType = approvedRecordsInfo.hasLeave ? approvedRecordsInfo.leaveInfo?.halfDayType : approvedRecordsInfo.odInfo?.halfDayType;
          if (approvedHalfDayType === formData.halfDayType) {
            toast.error(`Employee already has ${formData.halfDayType?.replace('_', ' ')} approved on this date`);
            setLoading(false);
            return;
          }
        }
      }

      // 2. Prepare Payload
      setLoadingMessage('Preparing application...');
      const contactNum = formData.contactNumber || employeeToApplyFor.phone_number || '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let payload: any = {
        // Only send empNo if NOT employee role (admin applying for others)
        // Employees applying for self should omit empNo to trigger backend "self" logic
        ...(currentUser?.role !== 'employee' ? { empNo: employeeToApplyFor.emp_no } : {}),
        fromDate: formData.fromDate,
        toDate: formData.toDate,
        purpose: formData.purpose,
        contactNumber: contactNum,
        remarks: formData.remarks,
        isHalfDay: formData.isHalfDay,
        halfDayType: formData.isHalfDay ? formData.halfDayType : null,
      };

      if (applyType === 'leave') {
        payload.leaveType = formData.leaveType;
      } else {
        payload.odType = formData.odType;
        payload.placeVisited = formData.placeVisited;
        payload.odType_extended = formData.odType_extended;
        if (formData.odType_extended === 'hours') {
          payload.odStartTime = formData.odStartTime;
          payload.odEndTime = formData.odEndTime;
        }
      }

      // 3. Evidence Upload (mandatory for OD)
      if (applyType === 'od') {
        if (!evidenceFile) {
          toast.error('Photo evidence is required for OD applications');
          setLoading(false);
          return;
        }

        if (evidenceFile) {
          // Check file size (20MB limit)
          const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
          if (evidenceFile.size > MAX_FILE_SIZE) {
            toast.error('The selected photo is too large. please upload a photo smaller than 20MB.');
            setLoading(false);
            return;
          }

          setLoadingMessage('Uploading photo');
          const uploadRes = await api.uploadEvidence(evidenceFile);
          // API returns { success, url, key, filename } at top level (no .data wrapper)
          if (uploadRes.success && uploadRes.url) {
            payload.photoEvidence = {
              url: uploadRes.url,
              key: uploadRes.key,
              exifLocation: (evidenceFile as any).exifLocation
            };
          } else {
            toast.error('Failed to upload photo evidence');
            setLoading(false);
            return;
          }
        }

        if (locationData) {
          payload.geoLocation = locationData;
        }
      }

      // 4. Submit
      setLoadingMessage('Submitting Request');
      const response = applyType === 'leave'
        ? await api.applyLeave(payload)
        : await api.applyOD(payload);

      if (response.success) {
        Swal.fire({
          icon: 'success',
          title: 'Success!',
          text: `${applyType === 'leave' ? 'Leave' : 'OD'} applied successfully`,
          timer: 2000,
          showConfirmButton: false,
        });
        setShowApplyDialog(false);
        resetForm();
        loadData();
      } else {
        toast.error(response.error || 'Failed to apply');
      }
    } catch (err: any) {
      toast.error(err.message || 'An error occurred');
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };

  const handleAction = async (id: string, type: 'leave' | 'od', action: 'approve' | 'reject', comments: string = '') => {
    try {
      let response;
      if (type === 'leave') {
        response = await api.processLeaveAction(id, action, comments);
      } else {
        response = await api.processODAction(id, action, comments);
      }

      if (response.success) {
        Swal.fire({
          icon: 'success',
          title: 'Success!',
          text: `${type === 'leave' ? 'Leave' : 'OD'} ${action}ed successfully`,
          timer: 2000,
          showConfirmButton: false,
        });
        loadData();
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Failed',
          text: response.error || 'Action failed',
        });
      }
    } catch (err: any) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: err.message || 'Action failed',
      });
    }
  };

  const resetForm = () => {
    setFormData({
      leaveType: '',
      odType: '',
      odType_extended: 'full_day',
      odStartTime: '',
      odEndTime: '',
      fromDate: '',
      toDate: '',
      purpose: '',
      contactNumber: '',
      placeVisited: '',
      isHalfDay: false,
      halfDayType: null,
      remarks: '',
    });
    setSelectedEmployee(null);
    setEmployeeSearch('');
    setShowEmployeeDropdown(false);
    setEvidenceFile(null);
    setEvidencePreview(null);
    setLocationData(null);
    setLoadingMessage('');
    setError(null);
  };

  // Check approved records when employee and date are selected
  useEffect(() => {
    const checkApprovedRecords = async () => {
      if (!selectedEmployee || !formData.fromDate) {
        setApprovedRecordsInfo(null);
        return;
      }

      // Only check if it's a single day (same fromDate and toDate)
      if (formData.fromDate === formData.toDate || !formData.toDate) {
        setCheckingApprovedRecords(true);
        try {
          const response = await api.getApprovedRecordsForDate(
            selectedEmployee._id,
            selectedEmployee.emp_no,
            formData.fromDate
          );

          if (response.success && response.data) {
            setApprovedRecordsInfo(response.data);

            // Auto-select opposite half if approved half-day exists
            if (response.data.hasLeave && response.data.leaveInfo?.isHalfDay) {
              const approvedHalf = response.data.leaveInfo.halfDayType;
              if (approvedHalf === 'first_half') {
                setFormData(prev => ({
                  ...prev,
                  isHalfDay: true,
                  halfDayType: 'second_half'
                }));
              } else if (approvedHalf === 'second_half') {
                setFormData(prev => ({
                  ...prev,
                  isHalfDay: true,
                  halfDayType: 'first_half'
                }));
              }
            } else if (response.data.hasOD && response.data.odInfo?.isHalfDay) {
              const approvedHalf = response.data.odInfo.halfDayType;
              if (approvedHalf === 'first_half') {
                setFormData(prev => ({
                  ...prev,
                  isHalfDay: true,
                  halfDayType: 'second_half'
                }));
              } else if (approvedHalf === 'second_half') {
                setFormData(prev => ({
                  ...prev,
                  isHalfDay: true,
                  halfDayType: 'first_half'
                }));
              }
            }
          } else {
            setApprovedRecordsInfo(null);
          }
        } catch (err) {
          console.error('Error checking approved records:', err);
          setApprovedRecordsInfo(null);
        } finally {
          setCheckingApprovedRecords(false);
        }
      } else {
        setApprovedRecordsInfo(null);
      }
    };

    checkApprovedRecords();
  }, [selectedEmployee, formData.fromDate, formData.toDate]);

  // Check holiday status for OD
  useEffect(() => {
    const checkHolidayStatus = async () => {
      const targetEmp = selectedEmployee || (currentUser?.role === 'employee' ? { _id: (currentUser as any).id, emp_no: (currentUser as any).emp_no || (currentUser as any).employeeId } : null);

      if (applyType !== 'od' || !formData.fromDate || !targetEmp) {
        setHolidayInfo(null);
        return;
      }

      setCheckingHoliday(true);
      try {
        const response = await api.checkODHoliday(
          targetEmp._id,
          targetEmp.emp_no,
          formData.fromDate
        );
        if (response.success) {
          setHolidayInfo({
            isHolidayOrWeekOff: response.isHolidayOrWeekOff,
            message: response.message || 'Holiday/Week-off detected'
          });
        } else {
          setHolidayInfo(null);
        }
      } catch (err) {
        console.error('Error checking holiday status:', err);
        setHolidayInfo(null);
      } finally {
        setCheckingHoliday(false);
      }
    };

    checkHolidayStatus();
  }, [applyType, formData.fromDate, selectedEmployee, currentUser]);

  // Fetch CL balance for the pay-cycle period that contains the selected from date (not calendar month).
  const isCLSelected = applyType === 'leave' && (formData.leaveType === 'CL' || formData.leaveType?.toUpperCase() === 'CL');
  const targetEmployeeForBalance = selectedEmployee || (employees.length > 0 ? employees[0] : null) ||
    (currentUser?.role === 'employee' ? { _id: (currentUser as any).id, emp_no: (currentUser as any).emp_no || (currentUser as any).employeeId } : null);
  const targetEmployeeId = targetEmployeeForBalance?._id;
  const targetEmpNo = targetEmployeeForBalance?.emp_no;
  const hasValidEmployeeId = targetEmployeeId && String(targetEmployeeId).length === 24 && !String(targetEmployeeId).startsWith('current');
  const hasValidEmpNo = targetEmpNo && String(targetEmpNo).trim() !== '' && String(targetEmpNo) !== 'UNKNOWN';
  const canFetchCLBalance = hasValidEmployeeId || hasValidEmpNo;

  useEffect(() => {
    if (!isCLSelected || !formData.fromDate || !canFetchCLBalance) {
      setClBalanceForMonth(null);
      return;
    }

    let cancelled = false;
    setClBalanceLoading(true);
    setClBalanceForMonth(null);

    // Determine pay-cycle period from the selected date: send baseDate (not calendar month/year)
    // so the backend resolves the correct period (e.g. 26 Jan–25 Feb for 31 Jan when cycle is 26–25).
    const raw = formData.fromDate?.includes('T') ? formData.fromDate.split('T')[0] : (formData.fromDate || '');
    const baseDateForApi = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : toISODate(formData.fromDate) || raw;
    const registerParams = hasValidEmployeeId
      ? { employeeId: String(targetEmployeeId), baseDate: baseDateForApi, balanceAsOf: true }
      : { empNo: String(targetEmpNo), baseDate: baseDateForApi, balanceAsOf: true };
    api.getLeaveRegister(registerParams)
      .then((res: any) => {
        if (cancelled) return;
        const data = res?.data;
        if (Array.isArray(data) && data.length > 0 && data[0].casualLeave) {
          const cl = data[0].casualLeave;
          const balance = Number(cl.balance);
          const allowedRaw = cl.allowedRemaining != null ? Number(cl.allowedRemaining) : balance;
          const clCap = Number.isFinite(allowedRaw) ? Math.max(0, allowedRaw) : (Number.isFinite(balance) ? balance : 0);
          setClBalanceForMonth(clCap);
          setClAnnualBalance(Number.isFinite(balance) ? Math.max(0, balance) : null);
          const cclRaw = data[0].compensatoryOff?.balance;
          const cclVal = Number(cclRaw);
          setCclBalance(Number.isFinite(cclVal) ? Math.max(0, cclVal) : 0);
        } else {
          setClBalanceForMonth(0);
          setClAnnualBalance(null);
          setCclBalance(null);
        }
      })
      .catch(() => {
        if (!cancelled) setClBalanceForMonth(null);
      })
      .finally(() => {
        if (!cancelled) setClBalanceLoading(false);
      });

    return () => { cancelled = true; };
  }, [isCLSelected, formData.fromDate, canFetchCLBalance, targetEmployeeId, targetEmpNo, hasValidEmployeeId]);

  // When CL balance is known, clamp toDate so requested days do not exceed balance
  useEffect(() => {
    if (!isCLSelected || formData.isHalfDay || clBalanceForMonth == null || !formData.fromDate || !formData.toDate) return;
    const requested = getRequestedDays(formData.fromDate, formData.toDate, false);
    if (requested <= clBalanceForMonth) return;
    const d = new Date(formData.fromDate);
    d.setDate(d.getDate() + Math.max(0, Math.floor(clBalanceForMonth) - 1));
    const maxTo = d.toISOString().split('T')[0];
    setFormData(prev => (prev.toDate <= maxTo ? prev : { ...prev, toDate: maxTo }));
  }, [isCLSelected, formData.isHalfDay, formData.fromDate, formData.toDate, clBalanceForMonth]);

  const buildInitialSplits = (leave: LeaveApplication) => {
    if (!leave) return [];
    if (leave.splits && leave.splits.length > 0) {
      return clampSplitsToRange(
        leave,
        leave.splits.map((s) => ({
          _id: s._id,
          date: toISODate(s.date),
          leaveType: s.leaveType,
          leaveNature: s.leaveNature,
          isHalfDay: s.isHalfDay,
          halfDayType: (s.halfDayType as any) || null,
          status: s.status,
          numberOfDays: s.numberOfDays ?? (s.isHalfDay ? 0.5 : 1),
          notes: s.notes || null,
        }))
      );
    }
    const defaults = buildDateRange(leave.fromDate, leave.toDate, leave.isHalfDay, leave.halfDayType);
    return defaults.map((d) => ({
      ...d,
      leaveType: leave.leaveType,
      status: 'approved' as const,
      numberOfDays: d.numberOfDays ?? (d.isHalfDay ? 0.5 : 1),
    }));
  };

  const openDetailDialog = async (item: LeaveApplication | ODApplication, type: 'leave' | 'od') => {
    try {
      setSplitMode(false);
      setSplitDrafts([]);
      setSplitWarnings([]);
      setSplitErrors([]);
      setSplitSaving(false);
      setActionComment('');

      let enrichedItem = item;
      if (type === 'leave') {
        const response = await api.getLeave(item._id);
        if (response?.success && response.data) {
          enrichedItem = response.data;
        }
        const initialSplits = buildInitialSplits(enrichedItem as LeaveApplication);
        setSplitDrafts(initialSplits);
        const leaveItem = enrichedItem as LeaveApplication;
        setSplitMode((leaveItem.splits && leaveItem.splits.length > 0) || false);
      } else {
        const response = await api.getOD(item._id);
        if (response?.success && response.data) {
          enrichedItem = response.data;
        }
      }

      setSelectedItem(enrichedItem);
      setDetailType(type);
      setShowDetailDialog(true);
      setIsChangeHistoryExpanded(false);
      setIsBreakdownExpanded(false);

      // Check if revocation is possible: 
      // 1. By the original actor who performed the last step
      // 2. By Super Admin or HR
      // 3. Within 48 hours window
      const authUser = auth.getUser() as any;
      const wf = (enrichedItem as any).workflow;
      const chain = wf?.approvalChain || [];
      const actionSteps = chain.filter((s: any) => s.status === 'approved' || s.status === 'rejected');
      const lastAction = actionSteps[actionSteps.length - 1];
      const userId = authUser?._id || authUser?.id;
      const userRole = authUser?.role;

      if (lastAction && userId) {
        const actorId = (lastAction.actionBy?._id || lastAction.actionBy)?.toString?.() || String(lastAction.actionBy);
        const performedAt = lastAction.updatedAt || (enrichedItem as any).approvals?.[lastAction.role || lastAction.stepRole]?.approvedAt;
        const hoursSince = performedAt ? (Date.now() - new Date(performedAt).getTime()) / (1000 * 60 * 60) : 999;

        const isOriginalActor = actorId === userId;
        const isHigherAuthority = ['super_admin', 'hr'].includes(userRole || '');
        const isWithinWindow = hoursSince <= 48; // Extended window

        setCanRevoke((isOriginalActor || isHigherAuthority) && isWithinWindow);
      } else {
        setCanRevoke(false);
      }
    } catch (err: any) {
      console.error('Failed to load leave details', err);
      toast.error(err.message || 'Failed to load leave details');
    }
  };

  const updateSplitDraft = (index: number, updates: Partial<LeaveSplit>) => {
    setSplitDrafts((prev) =>
      prev.map((row, idx) => {
        if (idx !== index) return row;
        const next = { ...row, ...updates };
        next.numberOfDays = next.isHalfDay ? 0.5 : 1;
        if (!next.isHalfDay) {
          next.halfDayType = null;
        }
        return next;
      })
    );
  };

  const validateSplitsForLeave = async () => {
    if (detailType !== 'leave' || !selectedItem) return null;
    setSplitErrors([]);
    setSplitWarnings([]);

    try {
      const payload = splitDrafts.map((s) => ({
        date: s.date,
        leaveType: s.leaveType,
        isHalfDay: s.isHalfDay || false,
        halfDayType: s.isHalfDay ? s.halfDayType : null,
        status: s.status,
        notes: s.notes,
      }));

      const resp = await api.validateLeaveSplits(selectedItem._id, payload);
      if (!resp.success && (resp as any).isValid === false) {
        setSplitErrors((resp as any).errors || ['Validation failed']);
      } else {
        setSplitErrors((resp as any).errors || []);
      }
      setSplitWarnings((resp as any).warnings || []);
      return resp;
    } catch (err: any) {
      setSplitErrors([err.message || 'Failed to validate splits']);
      return null;
    }
  };

  const saveSplits = async () => {
    if (detailType !== 'leave' || !selectedItem) return false;
    const validation = await validateSplitsForLeave();
    if (!validation || (validation as any).isValid === false) {
      return false;
    }

    try {
      const payload = splitDrafts.map((s) => ({
        date: s.date,
        leaveType: s.leaveType,
        isHalfDay: s.isHalfDay || false,
        halfDayType: s.isHalfDay ? s.halfDayType : null,
        status: s.status,
        notes: s.notes,
      }));

      const resp = await api.createLeaveSplits(selectedItem._id, payload);
      if (!resp.success) {
        setSplitErrors((resp as any).errors || ['Failed to save splits']);
        setSplitWarnings((resp as any).warnings || []);
        return false;
      }

      setSplitWarnings((resp as any).warnings || []);
      return true;
    } catch (err: any) {
      setSplitErrors([err.message || 'Failed to save splits']);
      return false;
    }
  };

  const handleDetailAction = async (action: 'approve' | 'reject' | 'cancel') => {
    if (!selectedItem) return;

    try {
      if (detailType === 'leave' && action === 'approve' && splitMode) {
        setSplitSaving(true);
        const saved = await saveSplits();
        if (!saved) {
          setSplitSaving(false);
          return;
        }
      }

      let response;

      if (action === 'cancel') {
        if (detailType === 'leave') {
          response = await api.cancelLeave(selectedItem._id);
        } else {
          // OD cancel if available
          response = { success: true };
        }
      } else {
        if (detailType === 'leave') {
          response = await api.processLeaveAction(selectedItem._id, action, actionComment);
        } else {
          response = await api.processODAction(selectedItem._id, action, actionComment);
        }
      }

      if (response.success) {
        Swal.fire({
          icon: 'success',
          title: 'Success!',
          text: `${detailType === 'leave' ? 'Leave' : 'OD'} ${action}${action === 'cancel' ? 'led' : 'ed'} successfully`,
          timer: 2000,
          showConfirmButton: false,
        });
        setShowDetailDialog(false);
        setSelectedItem(null);
        setIsChangeHistoryExpanded(false);
        loadData();
        if (detailType === 'leave') {
          // refresh splits after action
          const refreshed = await api.getLeave(selectedItem._id);
          if (refreshed?.success && refreshed.data) {
            setSelectedItem(refreshed.data);
            setSplitDrafts(buildInitialSplits(refreshed.data));
          }
        }
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Failed',
          text: response.error || `Failed to ${action}`,
        });
      }
    } catch (err: any) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: err.message || `Failed to ${action}`,
      });
    } finally {
      setSplitSaving(false);
    }
  };

  const handleDeleteRequest = async (id: string, type: 'leave' | 'od') => {
    try {
      const result = await Swal.fire({
        title: `Delete ${type.toUpperCase()} Request?`,
        text: `This will permanently delete this ${type} application. This action cannot be undone.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Yes, Delete',
        cancelButtonText: 'Cancel',
        reverseButtons: true
      });

      if (result.isConfirmed) {
        setLoading(true);
        const response = type === 'leave' ? await api.deleteLeave(id) : await api.deleteOD(id);
        if (response.success) {
          toast.success(`${type === 'leave' ? 'Leave' : 'OD'} application deleted`);
          setShowDetailDialog(false);
          setSelectedItem(null);
          loadData();
        } else {
          toast.error(response.error || 'Failed to delete');
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete');
    } finally {
      setLoading(false);
    }
  };


  // Helper: get department name from item (top-level or nested on employeeId)
  const getItemDepartmentName = (item: any) =>
    item?.department?.name || (item?.employeeId as any)?.department?.name || (item?.department_name) || '';

  // Helper: get division name from item (top-level or nested)
  const getItemDivisionName = (item: any) =>
    item?.division_name || (item?.employeeId as any)?.department?.division?.name || (item?.division_id as any)?.name || '';

  // Helper: get designation name from item (top-level or nested on employeeId)
  const getItemDesignationName = (item: any) =>
    item?.designation?.name || (item?.employeeId as any)?.designation?.name || item?.designation_name || '';

  // Filter logic
  const filterData = (data: any[]) => {
    return data.filter(item => {
      // 1. Search: name (all variants), emp_no, department, division
      const searchContent = (leaveFilters.employeeNumber || '').trim().toLowerCase();
      const itemDept = getItemDepartmentName(item);
      const itemDiv = getItemDivisionName(item);
      const fullName = [
        item.employeeId?.employee_name,
        item.employee_name,
        [item.employeeId?.first_name, item.employeeId?.last_name].filter(Boolean).join(' ')
      ].filter(Boolean).join(' ');
      const matchesSearch = !searchContent ||
        (item.employeeId?.employee_name?.toLowerCase().includes(searchContent)) ||
        (item.employee_name?.toLowerCase().includes(searchContent)) ||
        (item.employeeId?.first_name?.toLowerCase().includes(searchContent)) ||
        (item.employeeId?.last_name?.toLowerCase().includes(searchContent)) ||
        (fullName.toLowerCase().includes(searchContent)) ||
        (item.emp_no?.toLowerCase().includes(searchContent)) ||
        (item.employeeId?.emp_no?.toLowerCase().includes(searchContent)) ||
        (itemDept?.toLowerCase().includes(searchContent)) ||
        (itemDiv?.toLowerCase().includes(searchContent));

      // 2. Status Filter
      const matchesStatus = !leaveFilters.status || item.status === leaveFilters.status;

      // 3. Leave Type Filter (Works for both Leave.leaveType and OD.odType)
      const type = item.leaveType || item.odType;
      const matchesType = !leaveFilters.leaveType || (type && type === leaveFilters.leaveType);

      // 4. Division Filter
      const matchesDivision = !leaveFilters.division || (getItemDivisionName(item) === leaveFilters.division);

      // 5. Department Filter
      const matchesDepartment = !leaveFilters.department || (getItemDepartmentName(item) === leaveFilters.department);

      // 6. Date Range Filter
      let matchesDate = true;
      if (leaveFilters.startDate || leaveFilters.endDate) {
        const itemDate = new Date(item.fromDate).getTime(); // Using fromDate as reference
        const start = leaveFilters.startDate ? new Date(leaveFilters.startDate).getTime() : 0;
        const end = leaveFilters.endDate ? new Date(leaveFilters.endDate).getTime() : Infinity;
        matchesDate = itemDate >= start && itemDate <= end;
      }

      return matchesSearch && matchesStatus && matchesType && matchesDivision && matchesDepartment && matchesDate;
    });
  };

  const filteredLeaves = useMemo(() => filterData(leaves), [leaves, leaveFilters]);
  const filteredODs = useMemo(() => filterData(ods), [ods, leaveFilters]);
  const filteredPendingLeaves = useMemo(() => filterData(pendingLeaves), [pendingLeaves, leaveFilters]);
  const filteredPendingODs = useMemo(() => filterData(pendingODs), [pendingODs, leaveFilters]);

  const inProgressLeaves = useMemo(() => {
    const pendingIds = new Set(pendingLeaves.map(p => p._id));
    const userId = currentUser?.id || currentUser?._id;
    return leaves.filter(i => {
      if (['approved', 'rejected', 'cancelled'].includes(i.status) || pendingIds.has(i._id)) return false;
      // Only show if user has already acted on it (approved or rejected step in chain)
      const chain = (i as any).workflow?.approvalChain || [];
      return chain.some((s: any) =>
        (s.status === 'approved' || s.status === 'rejected') &&
        ((s.actionBy?._id || s.actionBy)?.toString() === String(userId))
      );
    });
  }, [leaves, pendingLeaves, currentUser]);

  const inProgressODs = useMemo(() => {
    const pendingIds = new Set(pendingODs.map(p => p._id));
    const userId = currentUser?.id || currentUser?._id;
    return ods.filter(i => {
      if (['approved', 'rejected', 'cancelled'].includes(i.status) || pendingIds.has(i._id)) return false;
      // Only show if user has already acted on it
      const chain = (i as any).workflow?.approvalChain || [];
      return chain.some((s: any) =>
        (s.status === 'approved' || s.status === 'rejected') &&
        ((s.actionBy?._id || s.actionBy)?.toString() === String(userId))
      );
    });
  }, [ods, pendingODs, currentUser]);

  const filteredInProgressLeaves = useMemo(() => filterData(inProgressLeaves), [inProgressLeaves, leaveFilters]);
  const filteredInProgressODs = useMemo(() => filterData(inProgressODs), [inProgressODs, leaveFilters]);

  const stats = useMemo(() => {
    const calc = (items: any[], pendingList: any[]) => {
      const pendingIds = new Set(pendingList.map(p => p._id));
      const userId = currentUser?.id || currentUser?._id;

      const inProgress = items.filter(i => {
        if (['approved', 'rejected', 'cancelled'].includes(i.status) || pendingIds.has(i._id)) return false;
        const chain = (i as any).workflow?.approvalChain || [];
        return chain.some((s: any) =>
          (s.status === 'approved' || s.status === 'rejected') &&
          ((s.actionBy?._id || s.actionBy)?.toString() === String(userId))
        );
      });

      return {
        total: items.length,
        approved: items.filter(i => i.status === 'approved').length,
        myActions: pendingList.length,
        inProgress: inProgress.length,
        totalPending: pendingList.length + inProgress.length,
        rejected: items.filter(i => ['rejected', 'hod_rejected', 'hr_rejected', 'cancelled'].includes(i.status)).length,
      };
    };

    const leavesStats = calc(leaves, pendingLeaves);
    const odsStats = calc(ods, pendingODs);

    return {
      leaves: leavesStats,
      ods: odsStats,
      totalMyActions: pendingLeaves.length + pendingODs.length,
      totalInProgress: leavesStats.inProgress + odsStats.inProgress
    };
  }, [leaves, ods, pendingLeaves, pendingODs]);

  const totalMyActions = stats.totalMyActions;
  const totalInProgress = stats.totalInProgress;

  // Build role order from the leave/OD's stored workflow (dynamic per record)
  const getRoleOrderFromItem = (item: LeaveApplication | ODApplication): string[] => {
    const chain = (item as any).workflow?.approvalChain;
    if (!chain || !Array.isArray(chain) || chain.length === 0) return [];
    const sorted = chain.slice().sort((a: any, b: any) => (a.stepOrder ?? 999) - (b.stepOrder ?? 999));
    return sorted.map((s: any) => String(s.role || s.stepRole || '').toLowerCase()).filter(Boolean);
  };

  const canPerformAction = (item: LeaveApplication | ODApplication, source?: 'leave' | 'od') => {
    if (!currentUser) return false;
    if (currentUser.role === 'employee') return false;

    // Super Admin & Sub Admin: Always allow intervention unless record is already in a final state
    if (['super_admin', 'sub_admin'].includes(currentUser.role)) {
      return !['approved', 'rejected', 'cancelled'].includes(item.status);
    }

    const isOD = source === 'od' || ((item as any).odType !== undefined);
    const allowHigher = isOD ? odWorkflowAllowHigherAuthority : leaveWorkflowAllowHigherAuthority;
    // Use workflow order stored on the leave/OD (dynamic); fallback to global settings order if missing
    const itemRoleOrder = getRoleOrderFromItem(item);
    const globalRoleOrder = isOD ? odWorkflowRoleOrder : leaveWorkflowRoleOrder;
    const roleOrder = itemRoleOrder.length > 0 ? itemRoleOrder : globalRoleOrder;

    // Strict check: nextApproverRole must match user.role (current step = user's turn)
    const nextRole = String((item as any).workflow?.nextApproverRole || (item as any).workflow?.nextApprover || '').toLowerCase().trim();
    const userRole = String(currentUser.role || '').toLowerCase().trim();
    if (nextRole) {
      if (userRole === nextRole) return true;
      if (nextRole === 'final_authority' && userRole === 'hr') return true;
      // Reporting manager step: allow if user is in workflow.reportingManagerIds (e.g. HR who is RM for this employee)
      if (nextRole === 'reporting_manager') {
        if (['manager', 'hod'].includes(userRole)) return true;
        const reportingManagerIds = (item as any).workflow?.reportingManagerIds as string[] | undefined;
        const userId = String((currentUser as any).id ?? (currentUser as any)._id ?? '').trim();
        if (reportingManagerIds?.length && userId && reportingManagerIds.some((id: string) => String(id).trim() === userId)) return true;
      }
      // Setting: allow higher authority to approve lower levels (using this leave's workflow order)
      if (allowHigher && roleOrder.length > 0) {
        const nextIdx = roleOrder.indexOf(nextRole);
        let userIdx = roleOrder.indexOf(userRole);
        if (userIdx === -1 && (userRole === 'hr' || userRole === 'super_admin')) userIdx = roleOrder.length;
        if (userIdx === -1 && userRole === 'manager') {
          const reportingIdx = roleOrder.indexOf('reporting_manager');
          const hrIdx = roleOrder.indexOf('hr');
          userIdx = reportingIdx >= 0 ? reportingIdx : (hrIdx >= 0 ? hrIdx : roleOrder.length);
        }
        if (nextIdx >= 0 && userIdx >= 0 && userIdx >= nextIdx) return true;
      }
      return false;
    }

    // 2. Fallback for legacy records (where workflow object might be missing)
    const status = item.status;
    const role = currentUser.role;

    if (status === 'pending') {
      return role === 'hod' || role === 'manager';
    }

    if (status === 'hod_approved' || status === 'manager_approved') {
      return role === 'hr';
    }

    return false;
  };

  // Dynamic Column Logic
  const { showDivision, showDepartment } = useMemo(() => {
    const isHOD = currentUser?.role === 'hod';
    if (isHOD) return { showDivision: false, showDepartment: false };

    let dataToCheck: any[] = [];
    if (activeTab === 'leaves') dataToCheck = leaves;
    else if (activeTab === 'od') dataToCheck = ods;

    const uniqueDivisions = new Set(dataToCheck.map(item => item.employeeId?.department?.division?.name).filter(Boolean));

    return {
      showDivision: uniqueDivisions.size > 1,
      showDepartment: true // Always show department for non-HODs as per requirement
    };
  }, [leaves, ods, activeTab, currentUser]);

  // Unique division and department names for filter dropdowns (from all lists)
  const filterDivisionOptions = useMemo(() => {
    const collected = new Set<string>();
    const addFrom = (list: any[]) => list.forEach(item => {
      const n = item?.division_name || (item?.employeeId as any)?.department?.division?.name || (item?.division_id as any)?.name;
      if (n) collected.add(n);
    });
    addFrom(leaves);
    addFrom(ods);
    addFrom(pendingLeaves);
    addFrom(pendingODs);
    return Array.from(collected).sort();
  }, [leaves, ods, pendingLeaves, pendingODs]);

  const filterDepartmentOptions = useMemo(() => {
    const collected = new Set<string>();
    const addFrom = (list: any[]) => list.forEach(item => {
      const n = item?.department?.name || (item?.employeeId as any)?.department?.name || item?.department_name;
      if (n) collected.add(n);
    });
    addFrom(leaves);
    addFrom(ods);
    addFrom(pendingLeaves);
    addFrom(pendingODs);
    return Array.from(collected).sort();
  }, [leaves, ods, pendingLeaves, pendingODs]);



  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 pb-10 pt-1">
      {/* Sticky Header */}
      <div className="sticky px-2 top-4 z-40 md:px-4 mb-2 md:mb-8">
        <div className="max-w-[1920px] mx-auto md:bg-white/70 md:dark:bg-slate-900/70 md:backdrop-blur-2xl md:rounded-[2.5rem] md:border md:border-white/20 md:dark:border-slate-800 md:shadow-2xl md:shadow-slate-200/50 md:dark:shadow-none min-h-[4.5rem] flex flex-row items-center 
         justify-between gap-4 px-0 sm:px-8 py-2 md:py-0">
          <div className="flex items-center gap-4">
            <div className="hidden md:flex h-10 w-10 rounded-xl bg-gradient-to-br from-green-500 to-green-600 items-center justify-center text-white shadow-lg shadow-green-500/20">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base md:text-xl font-black bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 uppercase tracking-tight whitespace-nowrap">
                Leave & OD
              </h1>
              <p className="hidden md:flex text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] items-center gap-2">
                Workspace <span className="h-1 w-1 rounded-full bg-slate-300"></span> Management
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 w-auto overflow-x-auto hide-scrollbar">


            {hasManagePermission && (canApplyForSelf || canApplyForOthers || currentUser?.role === 'employee' || ['manager', 'hod', 'hr', 'super_admin', 'sub_admin'].includes(currentUser?.role)) && (
              <button
                onClick={() => openApplyDialog('leave')}
                className="group h-7 sm:h-11 p-1 sm:px-6 rounded-full sm:rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[9px] sm:text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-slate-900/10 dark:shadow-white/10 shrink-0"
              >
                <Plus className="w-5 h-5 sm:w-3.5 sm:h-3.5" />
                <span className="hidden sm:inline">Apply Request</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-[1920px] mx-auto px-2 sm:px-6">

        {/* Toast Container */}
        <ToastContainer
          position="top-right"
          autoClose={3000}
          hideProgressBar={false}
          newestOnTop={false}
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
          theme="light"
        />

        {/* Stats Grid */}
        {/* Stats Grid - Desktop */}
        <div className="hidden md:grid mb-8 grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard
            title="Approved Leaves"
            value={stats.leaves.approved}
            icon={CheckCircle2}
            bgClass="bg-emerald-500/10"
            iconClass="text-emerald-600 dark:text-emerald-400"
            dekorClass="bg-emerald-500/5"
            loading={loading}
          />
          <StatCard
            title="Pending Leaves"
            value={stats.leaves.totalPending}
            icon={Clock3}
            bgClass="bg-amber-500/10"
            iconClass="text-amber-600 dark:text-amber-400"
            dekorClass="bg-amber-500/5"
            loading={loading}
          />
          <StatCard
            title="Rejected Leaves"
            value={stats.leaves.rejected}
            icon={XCircle}
            bgClass="bg-rose-500/10"
            iconClass="text-rose-600 dark:text-rose-400"
            dekorClass="bg-rose-500/5"
            loading={loading}
          />
          <StatCard
            title="Approved ODs"
            value={stats.ods.approved}
            icon={ShieldCheck}
            bgClass="bg-blue-500/10"
            iconClass="text-blue-600 dark:text-blue-400"
            dekorClass="bg-blue-500/5"
            loading={loading}
          />
          <StatCard
            title="Pending ODs"
            value={stats.ods.totalPending}
            icon={Clock}
            bgClass="bg-violet-500/10"
            iconClass="text-violet-600 dark:text-violet-400"
            dekorClass="bg-violet-500/5"
            loading={loading}
          />
          <StatCard
            title="Rejected ODs"
            value={stats.ods.rejected}
            icon={X}
            bgClass="bg-slate-500/10"
            iconClass="text-slate-600 dark:text-slate-400"
            dekorClass="bg-slate-500/5"
            loading={loading}
          />
        </div>

        {/* Mobile Stats (Grouped) */}
        <div className="md:hidden grid grid-cols-2 gap-3 mb-6">
          {/* Leave Stats Card */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-10">
              <Calendar className="w-12 h-12 text-blue-500" />
            </div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Leave Stats</h3>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                  <span className="text-xs text-slate-600 dark:text-slate-400">Approved</span>
                </div>
                <span className="text-sm font-bold text-slate-900 dark:text-white">{stats.leaves.approved}</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                  <span className="text-xs text-slate-600 dark:text-slate-400">Pending</span>
                </div>
                <span className="text-sm font-bold text-slate-900 dark:text-white">{stats.leaves.totalPending}</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-rose-500"></div>
                  <span className="text-xs text-slate-600 dark:text-slate-400">Rejected</span>
                </div>
                <span className="text-sm font-bold text-slate-900 dark:text-white">{stats.leaves.rejected}</span>
              </div>
            </div>
          </div>

          {/* OD Stats Card */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-10">
              <Briefcase className="w-12 h-12 text-purple-500" />
            </div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">OD Stats</h3>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                  <span className="text-xs text-slate-600 dark:text-slate-400">Approved</span>
                </div>
                <span className="text-sm font-bold text-slate-900 dark:text-white">{stats.ods.approved}</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-violet-500"></div>
                  <span className="text-xs text-slate-600 dark:text-slate-400">Pending</span>
                </div>
                <span className="text-sm font-bold text-slate-900 dark:text-white">{stats.ods.totalPending}</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-slate-500"></div>
                  <span className="text-xs text-slate-600 dark:text-slate-400">Rejected</span>
                </div>
                <span className="text-sm font-bold text-slate-900 dark:text-white">{stats.ods.rejected}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Controls Section (Filters) */}
        <div className="mb-6 animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="md:p-5 md:rounded-[2.5rem] md:border md:border-white/20 md:dark:border-slate-800 md:bg-white/60 md:dark:bg-slate-900/60 md:backdrop-blur-xl md:shadow-xl md:shadow-slate-200/50 md:dark:shadow-none transition-all">
            <div className="flex flex-wrap items-center gap-2 md:gap-6">
              {/* Search & Toggle */}
              <div className="flex items-center gap-2 w-full md:w-auto md:flex-1">
                <div className="flex-1 min-w-[200px] relative group">
                  <div className="absolute inset-0 bg-blue-500/5 rounded-2xl blur-xl transition-opacity opacity-0 group-focus-within:opacity-100" />
                  <input
                    type="text"
                    placeholder="Search Employee..."
                    value={leaveFilters.employeeNumber}
                    onChange={(e) => setLeaveFilters(prev => ({ ...prev, employeeNumber: e.target.value }))}
                    className="relative w-full h-10 md:h-11 pl-4 pr-12 rounded-xl md:rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs md:text-sm font-semibold focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all dark:text-white shadow-sm"
                  />
                  {/* Embedded Search Button */}
                  <button
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-blue-500 text-white shadow-lg shadow-blue-500/20 active:scale-95 transition-all"
                  >
                    <Search className="w-4 h-4" />
                  </button>
                </div>
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`md:hidden h-10 w-10 flex items-center justify-center rounded-xl border transition-all ${showFilters
                    ? 'bg-blue-500 border-blue-500 text-white'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                    }`}
                >
                  <Filter className="w-5 h-5" />
                </button>
              </div>

              <div className={`grid grid-cols-2 gap-2 w-full md:flex md:w-auto md:items-center md:gap-4 ${showFilters ? 'grid' : 'hidden md:flex'}`}>
                {/* Status Filter */}
                <div className="relative">
                  <Filter className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <select
                    value={leaveFilters.status}
                    onChange={(e) => setLeaveFilters(prev => ({ ...prev, status: e.target.value }))}
                    className="h-10 pl-9 pr-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all appearance-none cursor-pointer w-full"
                  >
                    <option value="">All Status</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>

                {/* Type Filter */}
                <div className="relative">
                  <Filter className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <select
                    value={leaveFilters.leaveType}
                    onChange={(e) => setLeaveFilters(prev => ({ ...prev, leaveType: e.target.value }))}
                    className="h-10 pl-9 pr-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all appearance-none cursor-pointer w-full"
                  >
                    <option value="">All Types</option>
                    {activeTab === 'od' ? (
                      odTypes.map(t => <option key={t.code} value={t.code}>{t.name}</option>)
                    ) : (
                      leaveTypes.map(t => <option key={t.code} value={t.code}>{t.name}</option>)
                    )}
                  </select>
                </div>

                {/* Division Filter - when we have divisions and user is not HOD */}
                {currentUser?.role !== 'hod' && filterDivisionOptions.length > 0 && (
                  <div className="relative">
                    <Filter className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <select
                      value={leaveFilters.division}
                      onChange={(e) => setLeaveFilters(prev => ({ ...prev, division: e.target.value }))}
                      className="h-10 pl-9 pr-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all appearance-none cursor-pointer w-full"
                    >
                      <option value="">All Divisions</option>
                      {filterDivisionOptions.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Department Filter */}
                {currentUser?.role !== 'hod' && filterDepartmentOptions.length > 0 && (
                  <div className="relative">
                    <Filter className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <select
                      value={leaveFilters.department}
                      onChange={(e) => setLeaveFilters(prev => ({ ...prev, department: e.target.value }))}
                      className="h-10 pl-9 pr-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all appearance-none cursor-pointer w-full"
                    >
                      <option value="">All Departments</option>
                      {filterDepartmentOptions.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Pay Period / Date Range — drives backend fetch */}
                <div className="col-span-2 flex flex-col sm:flex-row items-start sm:items-center gap-2">
                  {/* Quick Presets */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {[
                      {
                        label: 'This Month',
                        get: () => getDefaultDateRange(payCycleStartDay)
                      },
                      {
                        label: 'Last Month',
                        get: () => getPreviousPayCycle(payCycleStartDay)
                      },
                      {
                        label: 'Last 3M',
                        get: () => getLast3MonthsPayCycle(payCycleStartDay)
                      }
                    ].map(preset => {
                      const r = preset.get();
                      const isActive = dateRange.from === r.from && dateRange.to === r.to;
                      return (
                        <button
                          key={preset.label}
                          onClick={() => setDateRange(r)}
                          className={`h-7 px-2.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all border ${isActive
                            ? 'bg-blue-500 text-white border-blue-500 shadow-md shadow-blue-500/20'
                            : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-blue-300 hover:text-blue-600'}`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                  {/* Custom range inputs */}
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                    <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <input
                      type="date"
                      value={dateRange.from}
                      onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                      className="bg-transparent text-xs font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer w-[110px]"
                    />
                    <span className="text-slate-300 dark:text-slate-600 font-bold shrink-0">→</span>
                    <input
                      type="date"
                      value={dateRange.to}
                      onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                      className="bg-transparent text-xs font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer w-[110px]"
                    />
                    {loading && (
                      <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="grid grid-cols-3 sm:inline-flex items-center p-1 rounded-xl bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 backdrop-blur-sm shadow-inner w-full sm:w-auto gap-1 sm:gap-0">
            {[
              { id: 'leaves', label: 'Leaves', icon: Calendar, count: leaves.length, activeColor: 'blue' },
              { id: 'od', label: 'On Duty', icon: Briefcase, count: ods.length, activeColor: 'purple' },
              { id: 'pending', label: 'Actions Required', icon: Clock3, count: totalMyActions, activeColor: 'orange' },
              { id: 'in_progress', label: 'In Progress', icon: Clock, count: totalInProgress, activeColor: 'blue' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`group relative flex items-center justify-center gap-2 px-2 sm:px-6 py-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all duration-300 whitespace-nowrap ${activeTab === tab.id
                  ? `bg-white dark:bg-slate-700 text-${tab.activeColor}-600 dark:text-${tab.activeColor}-400 shadow-sm ring-1 ring-slate-200/50 dark:ring-0`
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
              >
                <tab.icon className={`w-3.5 h-3.5 ${activeTab === tab.id ? `text-${tab.activeColor}-600 dark:text-${tab.activeColor}-400` : 'text-slate-400 group-hover:text-slate-600'}`} />
                <span>{tab.label}</span>
                {tab.count > 0 && (
                  <span className={`flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-md text-[10px] font-black ${activeTab === tab.id
                    ? `bg-${tab.activeColor}-50 text-${tab.activeColor}-600 dark:bg-${tab.activeColor}-900/30 dark:text-${tab.activeColor}-300`
                    : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                    }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          {activeTab === 'leaves' && (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto scrollbar-hide bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-500">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200/60 dark:border-slate-800">
                      {currentUser?.role !== 'employee' && (
                        <th className="px-6 py-4 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Employee</th>
                      )}
                      <th className="px-6 py-4 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Leave Type</th>
                      <th className="px-6 py-4 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Dates</th>
                      <th className="px-6 py-4 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 text-center">Duration</th>
                      <th className="px-6 py-4 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 text-center">Status</th>
                      <th className="px-6 py-4 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {loading ? (
                      [...Array(5)].map((_, i) => (
                        <tr key={i} className="animate-pulse">
                          {currentUser?.role !== 'employee' && (
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-full bg-slate-200 dark:bg-slate-700" />
                                <div className="space-y-1.5">
                                  <div className="h-3 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
                                  <div className="h-2 w-16 bg-slate-200 dark:bg-slate-700 rounded" />
                                </div>
                              </div>
                            </td>
                          )}
                          <td className="px-6 py-4"><div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded" /></td>
                          <td className="px-6 py-4"><div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded" /></td>
                          <td className="px-6 py-4"><div className="h-6 w-16 bg-slate-200 dark:bg-slate-700 rounded" /></td>
                          <td className="px-6 py-4"><div className="h-6 w-20 bg-slate-200 dark:bg-slate-700 rounded-full" /></td>
                          <td className="px-6 py-4"><div className="h-4 w-12 bg-slate-200 dark:bg-slate-700 rounded ml-auto" /></td>
                        </tr>
                      ))
                    ) : filteredLeaves.length === 0 ? (
                      <tr>
                        <td colSpan={currentUser?.role !== 'employee' ? 6 : 5} className="px-6 py-10 text-center text-slate-500 text-sm">
                          No leave applications found
                        </td>
                      </tr>
                    ) : (
                      filteredLeaves.map((leave) => (
                        <tr
                          key={leave._id}
                          onClick={() => openDetailDialog(leave, 'leave')}
                          className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors cursor-pointer"
                        >
                          {currentUser?.role !== 'employee' && (
                            <td className="px-6 py-3.5">
                              <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-700 dark:text-blue-400 font-bold text-xs shrink-0">
                                  {getEmployeeInitials({ employee_name: leave.employeeId?.employee_name || '', first_name: leave.employeeId?.first_name, last_name: leave.employeeId?.last_name, emp_no: '' } as any)}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-medium text-slate-900 dark:text-white text-sm truncate max-w-[150px]">
                                    {leave.employeeId?.employee_name || `${leave.employeeId?.first_name || ''} ${leave.employeeId?.last_name || ''}`.trim() || leave.emp_no}
                                  </div>
                                  <div className="text-xs text-slate-500">
                                    {leave.employeeId?.emp_no}
                                  </div>
                                </div>
                              </div>
                            </td>
                          )}
                          <td className="px-6 py-3.5">
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 capitalize">
                              {leave.leaveType?.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-6 py-3.5 whitespace-nowrap">
                            <div className="text-sm text-slate-700 dark:text-slate-300">
                              <span className="font-medium">{formatDate(leave.fromDate)}</span>
                              {leave.fromDate !== leave.toDate && (
                                <span className="text-slate-400 mx-1.5">-</span>
                              )}
                              {leave.fromDate !== leave.toDate && (
                                <span>{formatDate(leave.toDate)}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-3.5 text-center">
                            <div className="inline-flex items-center gap-1.5 bg-slate-100 rounded-md px-2 py-1 dark:bg-slate-800">
                              <span className="font-semibold text-slate-700 dark:text-slate-300 text-sm">
                                {leave.numberOfDays}d
                              </span>
                              {leave.isHalfDay && (
                                <span className="text-[10px] font-bold text-orange-600 uppercase">
                                  {leave.halfDayType === 'first_half' ? '(1st)' : '(2nd)'}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-3.5 text-center">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize border ${getStatusColor(leave.status) === 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' ? 'border-green-200' : 'border-transparent' // subtle border for approved
                              } ${getStatusColor(leave.status)}`}>
                              {leave.status?.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-6 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDetailDialog(leave, 'leave');
                                }}
                                className="px-2 py-1 text-xs font-bold uppercase tracking-wider text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30 rounded-lg transition-all"
                              >
                                View
                              </button>
                              {(isSuperAdmin || currentUser?.role === 'sub_admin' || currentUser?.role === 'employee') && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteRequest(leave._id, 'leave');
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-all group"
                                  title="Delete Request"
                                >
                                  <Trash2 className="w-3.5 h-3.5 transition-transform group-hover:scale-110" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden space-y-4">
                {loading ? (
                  [...Array(3)].map((_, i) => (
                    <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm animate-pulse">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-700"></div>
                          <div className="space-y-2">
                            <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded"></div>
                            <div className="h-3 w-20 bg-slate-200 dark:bg-slate-700 rounded"></div>
                          </div>
                        </div>
                        <div className="h-6 w-20 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
                      </div>
                      <div className="h-16 bg-slate-50 dark:bg-slate-800 rounded-xl"></div>
                    </div>
                  ))
                ) : filteredLeaves.length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-sm bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
                    No leave applications found
                  </div>
                ) : (
                  filteredLeaves.map((leave) => (
                    <div
                      key={leave._id}
                      onClick={() => openDetailDialog(leave, 'leave')}
                      className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm active:scale-[0.98] transition-all"
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-3">
                          {currentUser?.role !== 'employee' && (
                            <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-700 dark:text-blue-400 font-bold text-xs shrink-0">
                              {getEmployeeInitials({ employee_name: leave.employeeId?.employee_name || '', first_name: leave.employeeId?.first_name, last_name: leave.employeeId?.last_name, emp_no: '' } as any)}
                            </div>
                          )}
                          <div className="min-w-0">
                            {currentUser?.role !== 'employee' && (
                              <>
                                <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                                  {getEmployeeName({ employee_name: leave.employeeId?.employee_name || '', first_name: leave.employeeId?.first_name, last_name: leave.employeeId?.last_name, emp_no: leave.employeeId?.emp_no || leave.emp_no || '' } as Employee)}
                                </h4>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                  {leave.employeeId?.emp_no || leave.emp_no}
                                  {(leave.employeeId as any)?.department?.name && ` • ${(leave.employeeId as any).department.name}`}
                                </p>
                              </>
                            )}
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                              {leave.leaveType?.replace('_', ' ')}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border ${getStatusColor(leave.status)} border-transparent`}>
                            {leave.status?.replace('_', ' ')}
                          </span>
                          {(isSuperAdmin || currentUser?.role === 'sub_admin' || currentUser?.role === 'employee') && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteRequest(leave._id, 'leave');
                              }}
                              className="p-1.5 text-slate-400 hover:text-red-500 bg-slate-50 dark:bg-slate-800 rounded-lg"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl">
                        <div className="flex flex-col">
                          <span className="text-[10px] uppercase font-bold text-slate-400">Duration</span>
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {leave.numberOfDays} Day{leave.numberOfDays !== 1 ? 's' : ''} {leave.isHalfDay && `(${leave.halfDayType === 'first_half' ? '1st' : '2nd'} Half)`}
                          </span>
                        </div>
                        <div className="h-8 w-px bg-slate-200 dark:bg-slate-700"></div>
                        <div className="flex flex-col items-end">
                          <span className="text-[10px] uppercase font-bold text-slate-400">Dates</span>
                          <span className="font-semibold text-slate-900 dark:text-white text-right">
                            {formatDate(leave.fromDate)}
                            {leave.fromDate !== leave.toDate && ` - ${formatDate(leave.toDate)}`}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}


          {activeTab === 'od' && (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto scrollbar-hide bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-500">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200/60 dark:border-slate-800">
                      {currentUser?.role !== 'employee' && (
                        <th className="px-6 py-4 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Employee</th>
                      )}
                      <th className="px-6 py-4 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">OD Type</th>
                      <th className="px-6 py-4 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Place Visited</th>
                      <th className="px-6 py-4 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Dates</th>
                      <th className="px-6 py-4 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 text-center">Duration</th>
                      <th className="px-6 py-4 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 text-center">Status</th>
                      <th className="px-6 py-4 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {loading ? (
                      [...Array(5)].map((_, i) => (
                        <tr key={i} className="animate-pulse">
                          {currentUser?.role !== 'employee' && (
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-full bg-slate-200 dark:bg-slate-700" />
                                <div className="space-y-1.5">
                                  <div className="h-3 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
                                  <div className="h-2 w-16 bg-slate-200 dark:bg-slate-700 rounded" />
                                </div>
                              </div>
                            </td>
                          )}
                          <td className="px-6 py-4"><div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded" /></td>
                          <td className="px-6 py-4"><div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded" /></td>
                          <td className="px-6 py-4"><div className="h-6 w-16 bg-slate-200 dark:bg-slate-700 rounded" /></td>
                          <td className="px-6 py-4"><div className="h-6 w-20 bg-slate-200 dark:bg-slate-700 rounded-full" /></td>
                          <td className="px-6 py-4"><div className="h-4 w-12 bg-slate-200 dark:bg-slate-700 rounded ml-auto" /></td>
                        </tr>
                      ))
                    ) : filteredODs.length === 0 ? (
                      <tr>
                        <td colSpan={currentUser?.role !== 'employee' ? 7 : 6} className="px-6 py-10 text-center text-slate-500 text-sm italic">
                          No OD applications found
                        </td>
                      </tr>
                    ) : (
                      filteredODs.map((od) => (
                        <tr
                          key={od._id}
                          onClick={() => openDetailDialog(od, 'od')}
                          className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors cursor-pointer"
                        >
                          {currentUser?.role !== 'employee' && (
                            <td className="px-6 py-3.5">
                              <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-700 dark:text-purple-400 font-bold text-xs shrink-0">
                                  {getEmployeeInitials({ employee_name: od.employeeId?.employee_name || '', first_name: od.employeeId?.first_name, last_name: od.employeeId?.last_name, emp_no: '' } as any)}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-medium text-slate-900 dark:text-white text-sm truncate max-w-[150px]">
                                    {od.employeeId?.employee_name || `${od.employeeId?.first_name || ''} ${od.employeeId?.last_name || ''}`.trim() || od.emp_no}
                                  </div>
                                  <div className="text-xs text-slate-500">
                                    {od.employeeId?.emp_no}
                                  </div>
                                </div>
                              </div>
                            </td>
                          )}
                          <td className="px-6 py-3.5">
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 capitalize">
                              {od.odType?.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-6 py-3.5 max-w-[180px] truncate text-sm text-slate-700 dark:text-slate-300" title={od.placeVisited}>
                            {od.placeVisited || '-'}
                          </td>
                          <td className="px-6 py-3.5 whitespace-nowrap">
                            <div className="text-sm text-slate-700 dark:text-slate-300">
                              <span className="font-medium">{formatDate(od.fromDate)}</span>
                              {od.fromDate !== od.toDate && (
                                <span className="text-slate-400 mx-1.5">-</span>
                              )}
                              {od.fromDate !== od.toDate && (
                                <span>{formatDate(od.toDate)}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-3.5 text-center">
                            <div className="inline-flex items-center gap-1.5 bg-slate-100 rounded-md px-2 py-1 dark:bg-slate-800">
                              <span className="font-semibold text-slate-700 dark:text-slate-300 text-sm">
                                {od.numberOfDays}d
                              </span>
                              {od.isHalfDay && (
                                <span className="text-[10px] font-bold text-orange-600 uppercase">
                                  {od.halfDayType === 'first_half' ? '(1st)' : '(2nd)'}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-3.5 text-center">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize border ${getStatusColor(od.status) === 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' ? 'border-green-200' : 'border-transparent'
                              } ${getStatusColor(od.status)}`}>
                              {od.status?.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-6 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDetailDialog(od, 'od');
                                }}
                                className="px-2 py-1 text-xs font-bold uppercase tracking-wider text-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-900/30 rounded-lg transition-all"
                              >
                                View
                              </button>
                              {(isSuperAdmin || currentUser?.role === 'sub_admin' || currentUser?.role === 'employee') && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteRequest(od._id, 'od');
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-all group"
                                  title="Delete OD"
                                >
                                  <Trash2 className="w-3.5 h-3.5 transition-transform group-hover:scale-110" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden space-y-4">
                {loading ? (
                  [...Array(3)].map((_, i) => (
                    <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm animate-pulse">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-700"></div>
                          <div className="space-y-2">
                            <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded"></div>
                            <div className="h-3 w-20 bg-slate-200 dark:bg-slate-700 rounded"></div>
                          </div>
                        </div>
                        <div className="h-6 w-20 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
                      </div>
                      <div className="h-16 bg-slate-50 dark:bg-slate-800 rounded-xl"></div>
                    </div>
                  ))
                ) : filteredODs.length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-sm bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
                    No OD applications found
                  </div>
                ) : (
                  filteredODs.map((od) => (
                    <div
                      key={od._id}
                      onClick={() => openDetailDialog(od, 'od')}
                      className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm active:scale-[0.98] transition-all"
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-3">
                          {currentUser?.role !== 'employee' && (
                            <div className="h-10 w-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-700 dark:text-purple-400 font-bold text-xs shrink-0">
                              {getEmployeeInitials({ employee_name: od.employeeId?.employee_name || '', first_name: od.employeeId?.first_name, last_name: od.employeeId?.last_name, emp_no: '' } as any)}
                            </div>
                          )}
                          <div className="min-w-0">
                            {currentUser?.role !== 'employee' && (
                              <>
                                <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                                  {getEmployeeName({ employee_name: od.employeeId?.employee_name || '', first_name: od.employeeId?.first_name, last_name: od.employeeId?.last_name, emp_no: od.employeeId?.emp_no || od.emp_no || '' } as Employee)}
                                </h4>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                  {od.employeeId?.emp_no || od.emp_no}
                                  {(od.employeeId as any)?.department?.name && ` • ${(od.employeeId as any).department.name}`}
                                </p>
                              </>
                            )}
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                              {od.odType?.replace('_', ' ')}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border ${getStatusColor(od.status)} border-transparent`}>
                            {od.status?.replace('_', ' ')}
                          </span>
                          {(isSuperAdmin || currentUser?.role === 'sub_admin' || currentUser?.role === 'employee') && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteRequest(od._id, 'od');
                              }}
                              className="p-1.5 text-slate-400 hover:text-red-500 bg-slate-50 dark:bg-slate-800 rounded-lg"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {od.placeVisited && (
                        <div className="mb-3 flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <Briefcase className="w-3.5 h-3.5 mt-0.5" />
                          <span>{od.placeVisited}</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl">
                        <div className="flex flex-col">
                          <span className="text-[10px] uppercase font-bold text-slate-400">Duration</span>
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {od.numberOfDays} Day{od.numberOfDays !== 1 ? 's' : ''} {od.isHalfDay && `(${od.halfDayType === 'first_half' ? '1st' : '2nd'} Half)`}
                          </span>
                        </div>
                        <div className="h-8 w-px bg-slate-200 dark:bg-slate-700"></div>
                        <div className="flex flex-col items-end">
                          <span className="text-[10px] uppercase font-bold text-slate-400">Dates</span>
                          <span className="font-semibold text-slate-900 dark:text-white text-right">
                            {formatDate(od.fromDate)}
                            {od.fromDate !== od.toDate && ` - ${formatDate(od.toDate)}`}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}


          {activeTab === 'pending' && (
            <div className="p-4 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
              {loading ? (
                <div className="space-y-4">
                  <div className="h-5 w-40 bg-slate-200 dark:bg-slate-700 rounded animate-pulse mb-4"></div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-56 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 animate-pulse">
                        <div className="flex justify-between mb-4">
                          <div className="flex gap-3">
                            <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-700"></div>
                            <div className="space-y-2">
                              <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded"></div>
                              <div className="h-3 w-20 bg-slate-200 dark:bg-slate-700 rounded"></div>
                            </div>
                          </div>
                          <div className="h-6 w-20 bg-slate-200 dark:bg-slate-700 rounded-full"></div>
                        </div>
                        <div className="space-y-3">
                          <div className="h-4 w-full bg-slate-200 dark:bg-slate-700 rounded"></div>
                          <div className="h-4 w-3/4 bg-slate-200 dark:bg-slate-700 rounded"></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (<>
                {/* Pending Leaves */}
                {filteredPendingLeaves.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between px-2">
                      <h3 className="inline-flex items-center gap-2 rounded-xl bg-blue-500/15 px-4 py-2.5 text-sm font-black uppercase tracking-wider text-blue-700 dark:bg-blue-400/20 dark:text-blue-300 border border-blue-200/60 dark:border-blue-500/30">
                        <Calendar className="w-4 h-4" />
                        Pending Leaves ({filteredPendingLeaves.length})
                      </h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {filteredPendingLeaves.map((leave) => (
                        <div key={leave._id} className="group relative flex flex-col justify-between rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-blue-200/60 dark:border-slate-800 dark:bg-slate-900">
                          {/* Status Strip */}
                          <div className="absolute top-0 left-0 w-1 h-full bg-blue-500/80 rounded-l-2xl group-hover:w-1.5 transition-all" />

                          {/* Header: name, division & department beside name (no labels), emp no, designation under name */}
                          <div className="flex items-start justify-between gap-3 mb-4">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 font-bold dark:bg-blue-900/30 dark:text-blue-400">
                                {getEmployeeInitials({ employee_name: leave.employeeId?.employee_name || '', first_name: leave.employeeId?.first_name, last_name: leave.employeeId?.last_name, emp_no: '' } as any)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                  <h4 className="font-semibold text-slate-900 dark:text-white line-clamp-1" title={getEmployeeName({ employee_name: leave.employeeId?.employee_name || '', first_name: leave.employeeId?.first_name, last_name: leave.employeeId?.last_name, emp_no: leave.employeeId?.emp_no || leave.emp_no || '' } as Employee)}>
                                    {getEmployeeName({ employee_name: leave.employeeId?.employee_name || '', first_name: leave.employeeId?.first_name, last_name: leave.employeeId?.last_name, emp_no: leave.employeeId?.emp_no || leave.emp_no || '' } as Employee)}
                                  </h4>
                                  {([getItemDivisionName(leave), getItemDepartmentName(leave)].filter(v => v && v !== 'N/A').length > 0) && (
                                    <span className="text-xs text-slate-500 dark:text-slate-400">
                                      {[getItemDivisionName(leave), getItemDepartmentName(leave)].filter(v => v && v !== 'N/A').join(' · ')}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                  {leave.employeeId?.emp_no || leave.emp_no}
                                </p>
                                {(getItemDesignationName(leave) && getItemDesignationName(leave) !== 'N/A') && (
                                  <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mt-0.5">
                                    {getItemDesignationName(leave)}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-col gap-1 items-end">
                              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${getStatusColor(leave.status)}`}>
                                {leave.status.replace('_', ' ')}
                              </span>
                              {(isSuperAdmin || currentUser?.role === 'sub_admin' || (leave.employeeId?._id === currentUser?.employeeRef || leave.appliedBy?._id === currentUser?._id || leave.appliedBy === currentUser?._id)) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteRequest(leave._id, 'leave');
                                  }}
                                  className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                                  title="Delete Request"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Content */}
                          <div className="mb-4 space-y-2.5">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-500 dark:text-slate-400">Type</span>
                              <span className="font-medium text-slate-700 dark:text-slate-300">{leave.leaveType}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-500 dark:text-slate-400">Duration</span>
                              <span className="font-medium text-slate-700 dark:text-slate-300">{leave.numberOfDays} Day{leave.numberOfDays !== 1 ? 's' : ''}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-500 dark:text-slate-400">Dates</span>
                              <span className="font-medium text-slate-700 dark:text-slate-300 text-right">
                                {formatDate(leave.fromDate)}
                                {leave.fromDate !== leave.toDate && ` - ${formatDate(leave.toDate)}`}
                              </span>
                            </div>
                            {leave.purpose && (
                              <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-700">
                                <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 italic">
                                  "{leave.purpose}"
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Actions */}

                          {canPerformAction(leave, 'leave') && (hasManagePermission || hasManagePermission) && (
                            <div className="flex items-center gap-2 mt-auto">
                              {hasManagePermission && (
                                <button
                                  onClick={() => handleAction(leave._id, 'leave', 'approve')}
                                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-500/10 py-2 text-sm font-semibold text-green-600 transition-colors hover:bg-green-500 hover:text-white dark:bg-green-500/20 dark:text-green-400 dark:hover:bg-green-500 dark:hover:text-white"
                                  title="Approve Leave"
                                >
                                  <Check /> Approve
                                </button>
                              )}
                              {hasManagePermission && (
                                <button
                                  onClick={() => handleAction(leave._id, 'leave', 'reject')}
                                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-500/10 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-500 hover:text-white dark:bg-red-500/20 dark:text-red-400 dark:hover:bg-red-500 dark:hover:text-white"
                                  title="Reject Leave"
                                >
                                  <X /> Reject
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Pending ODs */}
                {filteredPendingODs.length > 0 && (
                  <div>
                    <h3 className="inline-flex items-center gap-2 rounded-xl bg-purple-500/15 px-4 py-2.5 text-sm font-black uppercase tracking-wider text-purple-700 dark:bg-purple-400/20 dark:text-purple-300 mb-3 border border-purple-200/60 dark:border-purple-500/30">
                      <Briefcase className="w-4 h-4" />
                      Pending ODs ({filteredPendingODs.length})
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {filteredPendingODs.map((od) => (
                        <div key={od._id} className="group relative flex flex-col justify-between rounded-xl border border-slate-200 border-l-4 border-l-purple-500 bg-white p-5 shadow-sm transition-all hover:shadow-md dark:border-slate-700 dark:bg-slate-800">

                          {/* Header: name, division & department beside name (no labels), emp no, designation under name */}
                          <div className="flex items-start justify-between gap-3 mb-4">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-600 font-bold dark:bg-purple-900/30 dark:text-purple-400">
                                {getEmployeeInitials({ employee_name: od.employeeId?.employee_name || '', first_name: od.employeeId?.first_name, last_name: od.employeeId?.last_name, emp_no: '' } as any)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                  <h4 className="font-semibold text-slate-900 dark:text-white line-clamp-1" title={getEmployeeName({ employee_name: od.employeeId?.employee_name || '', first_name: od.employeeId?.first_name, last_name: od.employeeId?.last_name, emp_no: od.employeeId?.emp_no || od.emp_no || '' } as Employee)}>
                                    {getEmployeeName({ employee_name: od.employeeId?.employee_name || '', first_name: od.employeeId?.first_name, last_name: od.employeeId?.last_name, emp_no: od.employeeId?.emp_no || od.emp_no || '' } as Employee)}
                                  </h4>
                                  {([getItemDivisionName(od), getItemDepartmentName(od)].filter(v => v && v !== 'N/A').length > 0) && (
                                    <span className="text-xs text-slate-500 dark:text-slate-400">
                                      {[getItemDivisionName(od), getItemDepartmentName(od)].filter(v => v && v !== 'N/A').join(' · ')}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                  {od.employeeId?.emp_no || od.emp_no}
                                </p>
                                {(getItemDesignationName(od) && getItemDesignationName(od) !== 'N/A') && (
                                  <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mt-0.5">
                                    {getItemDesignationName(od)}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-col gap-1 items-end">
                              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${getStatusColor(od.status)}`}>
                                {od.status.replace('_', ' ')}
                              </span>
                              {(isSuperAdmin || currentUser?.role === 'sub_admin' || (od.employeeId?._id === currentUser?.employeeRef || od.appliedBy?._id === currentUser?._id || od.appliedBy === currentUser?._id)) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteRequest(od._id, 'od');
                                  }}
                                  className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                                  title="Delete Request"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Content */}
                          <div className="mb-4 space-y-2.5">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-500 dark:text-slate-400">Type</span>
                              <span className="font-medium text-slate-700 dark:text-slate-300">{od.odType}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-500 dark:text-slate-400">Duration</span>
                              <span className="font-medium text-slate-700 dark:text-slate-300">{od.numberOfDays} Day{od.numberOfDays !== 1 ? 's' : ''}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-500 dark:text-slate-400">Dates</span>
                              <span className="font-medium text-slate-700 dark:text-slate-300 text-right">
                                {formatDate(od.fromDate)}
                                {od.fromDate !== od.toDate && ` - ${formatDate(od.toDate)}`}
                              </span>
                            </div>
                            {od.purpose && (
                              <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-700">
                                <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 italic">
                                  "{od.purpose}"
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Actions */}
                          {canPerformAction(od, 'od') && (hasManagePermission || hasManagePermission) && (
                            <div className="flex items-center gap-2 mt-auto">
                              {hasManagePermission && (
                                <button
                                  onClick={() => handleAction(od._id, 'od', 'approve')}
                                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-500/10 py-2 text-sm font-semibold text-green-600 transition-colors hover:bg-green-500 hover:text-white dark:bg-green-500/20 dark:text-green-400 dark:hover:bg-green-500 dark:hover:text-white"
                                  title="Approve OD"
                                >
                                  <Check /> Approve
                                </button>
                              )}
                              {hasManagePermission && (
                                <button
                                  onClick={() => handleAction(od._id, 'od', 'reject')}
                                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-500/10 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-500 hover:text-white dark:bg-red-500/20 dark:text-red-400 dark:hover:bg-red-500 dark:hover:text-white"
                                  title="Reject OD"
                                >
                                  <X /> Reject
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {totalMyActions === 0 && (
                  <div className="text-center py-12 text-slate-500">
                    No pending approvals
                  </div>
                )}
              </>)}
            </div>
          )}


          {activeTab === 'in_progress' && (
            <div className="p-4 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
              {loading ? (
                <div className="space-y-4">
                  <div className="h-5 w-40 bg-slate-200 dark:bg-slate-700 rounded animate-pulse mb-4"></div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-56 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 animate-pulse">
                        <div className="flex justify-between mb-4">
                          <div className="flex gap-3">
                            <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-700"></div>
                            <div className="space-y-2">
                              <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded"></div>
                              <div className="h-3 w-20 bg-slate-200 dark:bg-slate-700 rounded"></div>
                            </div>
                          </div>
                          <div className="h-6 w-20 bg-slate-200 dark:bg-slate-700 rounded-full"></div>
                        </div>
                        <div className="space-y-3">
                          <div className="h-4 w-full bg-slate-200 dark:bg-slate-700 rounded"></div>
                          <div className="h-4 w-3/4 bg-slate-200 dark:bg-slate-700 rounded"></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (<>
                {/* In Progress Leaves */}
                {filteredInProgressLeaves.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between px-2">
                      <h3 className="inline-flex items-center gap-2 rounded-xl bg-blue-500/15 px-4 py-2.5 text-sm font-black uppercase tracking-wider text-blue-700 dark:bg-blue-400/20 dark:text-blue-300 border border-blue-200/60 dark:border-blue-500/30">
                        <Calendar className="w-4 h-4" />
                        In Progress Leaves ({filteredInProgressLeaves.length})
                      </h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {filteredInProgressLeaves.map((leave) => (
                        <div key={leave._id} onClick={() => openDetailDialog(leave, 'leave')} className="cursor-pointer group relative flex flex-col justify-between rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-blue-200/60 dark:border-slate-800 dark:bg-slate-900">
                          {/* Status Strip */}
                          <div className="absolute top-0 left-0 w-1 h-full bg-blue-500/80 rounded-l-2xl group-hover:w-1.5 transition-all" />

                          {/* Header */}
                          <div className="flex items-start justify-between gap-3 mb-4">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 font-bold dark:bg-blue-900/30 dark:text-blue-400">
                                {getEmployeeInitials({ employee_name: leave.employeeId?.employee_name || '', first_name: leave.employeeId?.first_name, last_name: leave.employeeId?.last_name, emp_no: '' } as any)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                  <h4 className="font-semibold text-slate-900 dark:text-white line-clamp-1">
                                    {getEmployeeName({ employee_name: leave.employeeId?.employee_name || '', first_name: leave.employeeId?.first_name, last_name: leave.employeeId?.last_name, emp_no: leave.employeeId?.emp_no || leave.emp_no || '' } as Employee)}
                                  </h4>
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                  {leave.employeeId?.emp_no || leave.emp_no}
                                </p>
                              </div>
                            </div>
                            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${getStatusColor(leave.status)}`}>
                              {leave.status.replace('_', ' ')}
                            </span>
                          </div>

                          {/* Content */}
                          <div className="mb-0 space-y-2.5">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-500 dark:text-slate-400">Type</span>
                              <span className="font-medium text-slate-700 dark:text-slate-300">{leave.leaveType}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-500 dark:text-slate-400">Duration</span>
                              <span className="font-medium text-slate-700 dark:text-slate-300">{leave.numberOfDays} Day{leave.numberOfDays !== 1 ? 's' : ''}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-500 dark:text-slate-400">Dates</span>
                              <span className="font-medium text-slate-700 dark:text-slate-300 text-right">
                                {formatDate(leave.fromDate)}
                                {leave.fromDate !== leave.toDate && ` - ${formatDate(leave.toDate)}`}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* In Progress ODs */}
                {filteredInProgressODs.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="inline-flex items-center gap-2 rounded-xl bg-purple-500/15 px-4 py-2.5 text-sm font-black uppercase tracking-wider text-purple-700 dark:bg-purple-400/20 dark:text-purple-300 mb-0 border border-purple-200/60 dark:border-purple-500/30">
                      <Briefcase className="w-4 h-4" />
                      In Progress ODs ({filteredInProgressODs.length})
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {filteredInProgressODs.map((od) => (
                        <div key={od._id} onClick={() => openDetailDialog(od, 'od')} className="cursor-pointer group relative flex flex-col justify-between rounded-xl border border-slate-200 border-l-4 border-l-purple-500 bg-white p-5 shadow-sm transition-all hover:shadow-md dark:border-slate-700 dark:bg-slate-800">
                          {/* Header */}
                          <div className="flex items-start justify-between gap-3 mb-4">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-600 font-bold dark:bg-purple-900/30 dark:text-purple-400">
                                {getEmployeeInitials({ employee_name: od.employeeId?.employee_name || '', first_name: od.employeeId?.first_name, last_name: od.employeeId?.last_name, emp_no: '' } as any)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <h4 className="font-semibold text-slate-900 dark:text-white line-clamp-1">
                                  {getEmployeeName({ employee_name: od.employeeId?.employee_name || '', first_name: od.employeeId?.first_name, last_name: od.employeeId?.last_name, emp_no: od.employeeId?.emp_no || od.emp_no || '' } as Employee)}
                                </h4>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                  {od.employeeId?.emp_no || od.emp_no}
                                </p>
                              </div>
                            </div>
                            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${getStatusColor(od.status)}`}>
                              {od.status.replace('_', ' ')}
                            </span>
                          </div>

                          {/* Content */}
                          <div className="mb-0 space-y-2.5">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-500 dark:text-slate-400">Type</span>
                              <span className="font-medium text-slate-700 dark:text-slate-300">{od.odType}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-500 dark:text-slate-400">Duration</span>
                              <span className="font-medium text-slate-700 dark:text-slate-300">{od.numberOfDays} Day{od.numberOfDays !== 1 ? 's' : ''}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-500 dark:text-slate-400">Dates</span>
                              <span className="font-medium text-slate-700 dark:text-slate-300 text-right">
                                {formatDate(od.fromDate)}
                                {od.fromDate !== od.toDate && ` - ${formatDate(od.toDate)}`}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {totalInProgress === 0 && (
                  <div className="text-center py-12 text-slate-500">
                    No in-progress requests
                  </div>
                )}
              </>)}
            </div>
          )}


        </div >

        {showApplyDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setShowApplyDialog(false)} />
            <div className="relative z-50 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-white/20 dark:border-slate-800 shadow-2xl p-5 sm:p-8 animate-in zoom-in-95 duration-300">
              {/* Type Toggle */}
              <div className="inline-flex w-full p-1 rounded-2xl bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-700/50 mb-6 sm:mb-8">
                <button
                  type="button"
                  onClick={() => setApplyType('leave')}
                  className={`flex-1 py-2 sm:py-3.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${applyType === 'leave'
                    ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm shadow-blue-500/10'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                >
                  <div className="flex items-center justify-center px-2 gap-1">
                    <Calendar className="w-4 h-4" />
                    Leave
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setApplyType('od')}
                  className={`flex-1 py-2 sm:py-3.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${applyType === 'od'
                    ? 'bg-white dark:bg-slate-700 text-purple-600 dark:text-purple-400 shadow-sm shadow-purple-500/10'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                >
                  <div className="flex items-center justify-center gap-2">
                    <Briefcase className="w-4 h-4" />
                    On Duty
                  </div>
                </button>
              </div>

              <div className="mb-6 sm:mb-8 hidden sm:block">
                <h2 className="text-lg sm:text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300">
                  New {applyType === 'leave' ? 'Leave' : 'OD'} Application
                </h2>
                <p className="text-slate-500 dark:text-slate-400 text-xs sm:sm mt-1">Please fill in the details of your request.</p>
              </div>

              <form onSubmit={handleApply} className="space-y-4">
                {/* Apply For - Employee Selection (Hidden for Employees) */}
                {currentUser?.role !== 'employee' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 sm:mb-2">
                      Apply For Employee *
                    </label>
                    <div className="relative">
                      <EmployeeSelect
                        value={selectedEmployee?._id || selectedEmployee?.emp_no || ''}
                        onChange={(emp) => {
                          if (!emp) {
                            setSelectedEmployee(null);
                            setFormData(prev => ({ ...prev, contactNumber: '' }));
                          } else {
                            handleSelectEmployee(emp);
                          }
                        }}
                        placeholder="Search by name, emp no, or department..."
                      />
                    </div>
                  </div>
                )}

                {/* Type Selection */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 sm:mb-2">
                    {applyType === 'leave' ? 'Leave Type' : 'OD Type'} *
                  </label>
                  {((applyType === 'leave' && leaveTypes.length === 1) || (applyType === 'od' && odTypes.length === 1)) ? (
                    <div className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-700 dark:text-white">
                      <span className="font-medium">
                        {applyType === 'leave'
                          ? leaveTypes[0]?.name || leaveTypes[0]?.code
                          : odTypes[0]?.name || odTypes[0]?.code}
                      </span>
                      <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">(Only type available)</span>
                    </div>
                  ) : (
                    <select
                      value={applyType === 'leave' ? formData.leaveType : formData.odType}
                      onChange={(e) => {
                        if (applyType === 'leave') {
                          setFormData({ ...formData, leaveType: e.target.value });
                        } else {
                          setFormData({ ...formData, odType: e.target.value });
                        }
                      }}
                      required
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 sm:py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="">Select {applyType === 'leave' ? 'leave' : 'OD'} type</option>
                      {(applyType === 'leave' ? leaveTypes : odTypes).map((type) => (
                        <option key={type.code} value={type.code}>{type.name}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* CL summary for month/year – show when Casual Leave selected */}
                {isCLSelected && (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3 space-y-1.5">
                    {!formData.fromDate || !canFetchCLBalance ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        {currentUser?.role === 'employee'
                          ? 'Select from date to see your CL balance and monthly limit for that month.'
                          : 'Select employee and from date to see CL balance and monthly limit for that month.'}
                      </p>
                    ) : clBalanceLoading ? (
                      <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading CL balance and monthly limit...
                      </div>
                    ) : clBalanceForMonth !== null ? (
                      <>
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                          {clAnnualBalance !== null && (
                            <>
                              <span className="text-slate-600 dark:text-slate-300">
                                Yearly CL balance (remaining):{' '}
                              </span>
                              <span className="font-semibold">
                                {clAnnualBalance} day{clAnnualBalance !== 1 ? 's' : ''}.
                              </span>
                            </>
                          )}
                        </p>
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                          <span className="text-green-600 dark:text-green-400">
                            CL allowed this pay period: <strong>{clBalanceForMonth}</strong> day{clBalanceForMonth !== 1 ? 's' : ''} (2 per period, pending CL locks).
                          </span>
                        </p>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                          You can apply for up to <strong>{clBalanceForMonth}</strong> CL day{clBalanceForMonth !== 1 ? 's' : ''} in this pay cycle. Compensatory (CCL) is in addition.
                        </p>
                        <p className="text-sm text-slate-700 dark:text-slate-300">
                          Compensatory off (CCL):{' '}
                          <span className="font-semibold">
                            {cclBalance ?? 0} day{(cclBalance ?? 0) !== 1 ? 's' : ''}.
                          </span>{' '}
                          CCL is added on top of the 2 CL per period when you use it.
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-amber-600 dark:text-amber-400">
                        Could not load CL balance. You must have a valid balance to apply for CL; try again or select employee/from date again.
                      </p>
                    )}
                  </div>
                )}

                {/* OD Type Extended Selector */}
                {applyType === 'od' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 sm:mb-3">Duration Type</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, odType_extended: 'full_day', isHalfDay: false })}
                        className={`py-2 px-2 sm:py-2.5 sm:px-3 rounded-lg text-xs sm:text-sm font-medium transition-all ${formData.odType_extended === 'full_day'
                          ? 'bg-purple-500 text-white shadow-md'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'
                          }`}
                      >
                        Full Day
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, odType_extended: 'half_day', isHalfDay: true, halfDayType: formData.halfDayType || 'first_half' })}
                        className={`py-2 px-2 sm:py-2.5 sm:px-3 rounded-lg text-xs sm:text-sm font-medium transition-all ${formData.odType_extended === 'half_day'
                          ? 'bg-purple-500 text-white shadow-md'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'
                          }`}
                      >
                        Half Day
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, odType_extended: 'hours', isHalfDay: false })}
                        className={`py-2 px-2 sm:py-2.5 sm:px-3 rounded-lg text-xs sm:text-sm font-medium transition-all ${formData.odType_extended === 'hours'
                          ? 'bg-purple-500 text-white shadow-md'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'
                          }`}
                      >
                        Hours
                      </button>
                    </div>
                  </div>
                )}

                {/* Date Selection Logic - min/max from workspace leave/OD settings */}
                {((applyType === 'leave' && formData.isHalfDay) || applyType === 'od') ? (
                  /* Single Date Input for Half Day / Specific Hours / Any OD */
                  (() => {
                    const policy = applyType === 'leave' ? leavePolicy : odPolicy;
                    const { minDate: singleMin, maxDate: singleMax } = getPolicyDateBounds(policy);
                    return (
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 sm:mb-2">{applyType === 'od' ? 'Date *' : 'Date *'}</label>
                        <input
                          type="date"
                          min={singleMin}
                          max={singleMax}
                          value={formData.fromDate}
                          onChange={(e) => setFormData({ ...formData, fromDate: e.target.value, toDate: e.target.value })}
                          required
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 sm:py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                    );
                  })()
                ) : (
                  /* Two Date Inputs for Full Day */
                  (() => {
                    const policy = applyType === 'leave' ? leavePolicy : odPolicy;
                    const { minDate: fromMin, maxDate: policyMax } = getPolicyDateBounds(policy);
                    const isCLFullDay = isCLSelected && !formData.isHalfDay && formData.fromDate && clBalanceForMonth !== null && clBalanceForMonth >= 0;
                    const maxToDateISO = isCLFullDay && formData.fromDate
                      ? (() => {
                        const d = new Date(formData.fromDate);
                        d.setDate(d.getDate() + Math.max(0, Math.floor(clBalanceForMonth!) - 1));
                        return d.toISOString().split('T')[0];
                      })()
                      : undefined;
                    const toMax = maxToDateISO
                      ? (policyMax && maxToDateISO > policyMax ? policyMax : maxToDateISO)
                      : policyMax;
                    return (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 sm:mb-2">From Date *</label>
                          <input
                            type="date"
                            min={fromMin}
                            max={policyMax}
                            value={formData.fromDate}
                            onChange={(e) => setFormData({ ...formData, fromDate: e.target.value })}
                            required
                            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 sm:py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 sm:mb-2">To Date *</label>
                          <input
                            type="date"
                            min={formData.fromDate || fromMin}
                            max={toMax}
                            value={formData.toDate}
                            onChange={(e) => {
                              let toDate = e.target.value;
                              if (maxToDateISO && toDate > maxToDateISO) {
                                toDate = maxToDateISO;
                                toast.info(`CL allowed for this period: up to ${clBalanceForMonth} days; To date capped.`);
                              }
                              if (policyMax && toDate > policyMax) toDate = policyMax;
                              setFormData({ ...formData, toDate });
                            }}
                            required
                            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 sm:py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                          />
                          {isCLFullDay && maxToDateISO && formData.toDate > maxToDateISO && (
                            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Max {clBalanceForMonth} days for CL in this pay period.</p>
                          )}
                        </div>
                      </div>
                    );
                  })()
                )}

                {/* Holiday Indicator for OD */}
                {applyType === 'od' && holidayInfo && holidayInfo.isHolidayOrWeekOff && (
                  <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-200 dark:border-indigo-800/50 animate-in fade-in zoom-in duration-500">
                    <div className="flex items-start gap-4">
                      <div className="p-2.5 rounded-xl bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 shrink-0">
                        <Star className="w-5 h-5 fill-current" />
                      </div>
                      <div>
                        <p className="text-sm font-black text-indigo-900 dark:text-indigo-100 uppercase tracking-tight">Premium Reward</p>
                        <p className="text-xs text-indigo-700/80 dark:text-indigo-300/80 leading-relaxed font-medium mt-1">
                          {holidayInfo.message}. Selected day is holiday so this OD contributes to your compensatory off not on the working day.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Hour-Based OD - Time Pickers */}
                {applyType === 'od' && formData.odType_extended === 'hours' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 sm:mb-2">Start Time *</label>
                      <input
                        type="time"
                        value={formData.odStartTime || ''}
                        onChange={(e) => setFormData({ ...formData, odStartTime: e.target.value })}
                        required
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 sm:py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 sm:mb-2">End Time *</label>
                      <input
                        type="time"
                        value={formData.odEndTime || ''}
                        onChange={(e) => setFormData({ ...formData, odEndTime: e.target.value })}
                        required
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 sm:py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                    {formData.odStartTime && formData.odEndTime && (
                      <div className="col-span-2 p-3 rounded-lg bg-white dark:bg-slate-800 border border-fuchsia-200 dark:border-fuchsia-700">
                        {(() => {
                          const [startH, startM] = formData.odStartTime!.split(':').map(Number);
                          const [endH, endM] = formData.odEndTime!.split(':').map(Number);
                          const startMin = startH * 60 + startM;
                          const endMin = endH * 60 + endM;

                          if (startMin >= endMin) {
                            return <p className="text-sm text-red-600 dark:text-red-400">⚠️ End time must be after start time</p>;
                          }

                          const durationMin = endMin - startMin;
                          const hours = Math.floor(durationMin / 60);
                          const mins = durationMin % 60;

                          if (durationMin > 480) {
                            return <p className="text-sm text-red-600 dark:text-red-400">⚠️ Maximum duration is 8 hours</p>;
                          }

                          return (
                            <p className="text-sm font-medium text-fuchsia-700 dark:text-fuchsia-300">
                              ✓ Duration: {hours}h {mins}m
                            </p>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}

                {/* Half Day Selection */}
                {(applyType === 'leave' || (applyType === 'od' && formData.odType_extended === 'half_day')) && (
                  <div className="flex items-center gap-4">
                    {applyType === 'leave' && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.isHalfDay}
                          onChange={(e) => {
                            if (!e.target.checked) {
                              setFormData({ ...formData, isHalfDay: false, halfDayType: null });
                            } else {
                              // When toggling half-day on, sync toDate to fromDate and default to first_half
                              setFormData({ ...formData, isHalfDay: true, halfDayType: formData.halfDayType || 'first_half', toDate: formData.fromDate });
                            }
                          }}
                          className="w-4 h-4 rounded border-slate-300"
                        />
                        <span className="text-sm text-slate-700 dark:text-slate-300">Half Day</span>
                      </label>
                    )}

                    {(formData.isHalfDay || (applyType === 'od' && formData.odType_extended === 'half_day')) && (
                      <div className="flex items-center gap-2">
                        {applyType === 'od' && <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Select Half:</span>}
                        <select
                          value={formData.halfDayType || 'first_half'}
                          onChange={(e) => setFormData({ ...formData, halfDayType: e.target.value as any })}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-purple-500 outline-none"
                        >
                          <option value="first_half">First Half</option>
                          <option value="second_half">Second Half</option>
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {/* Purpose */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 sm:mb-2">Purpose *</label>
                  <textarea
                    value={formData.purpose}
                    onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
                    required
                    rows={2}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 sm:py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    placeholder="Reason..."
                  />
                </div>

                {/* OD Specific - Place & Evidence */}
                {applyType === 'od' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 sm:mb-2">Place to Visit *</label>
                      <input
                        type="text"
                        value={formData.placeVisited}
                        onChange={(e) => setFormData({ ...formData, placeVisited: e.target.value })}
                        required
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 sm:py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        placeholder="Location"
                      />
                    </div>
                    <LocationPhotoCapture
                      required
                      label="Photo Evidence"
                      onCapture={(loc, photo) => {
                        setEvidenceFile(photo.file);
                        setLocationData(loc);
                      }}
                      onClear={() => {
                        setEvidenceFile(null);
                        setLocationData(null);
                      }}
                    />
                  </div>
                )}

                {/* Contact Number */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 sm:mb-2">Contact Number *</label>
                  <input
                    type="tel"
                    value={formData.contactNumber}
                    onChange={(e) => setFormData({ ...formData, contactNumber: e.target.value })}
                    required
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 sm:py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                {/* Remarks */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 sm:mb-2">Remarks</label>
                  <input
                    type="text"
                    value={formData.remarks}
                    onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 sm:py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                {/* Actions - Sticky Bottom */}
                <div className="sticky bottom-0 z-10 -mx-5 -mb-5 p-5 sm:-mx-8 sm:-mb-8 sm:p-8 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-t border-slate-100 dark:border-slate-800 flex gap-3 mt-6">
                  <button
                    type="button"
                    onClick={() => setShowApplyDialog(false)}
                    className="flex-1 py-2.5 sm:py-3 text-sm font-bold text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 active:scale-95 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading || !isFormValid()}
                    className={`flex-1 py-2.5 sm:py-3 text-sm font-bold text-white rounded-xl transition-all ${(loading || !isFormValid())
                      ? 'opacity-40 cursor-not-allowed grayscale'
                      : 'opacity-100 hover:scale-[1.02] active:scale-95 shadow-lg shadow-blue-500/20'
                      } ${applyType === 'leave' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-purple-600 hover:bg-purple-700 shadow-purple-500/20'}`}
                  >
                    {loading ? (
                      <div className="flex items-center justify-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        <span>{loadingMessage || 'Submitting...'}</span>
                      </div>
                    ) : `Apply ${applyType === 'leave' ? 'Leave' : 'OD'}`}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )
        }

        {/* Detail Dialog */}
        {
          showDetailDialog && selectedItem && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setShowDetailDialog(false)} />
              <div className="relative z-50 w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-white/20 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
                {/* Header */}
                <div className={`shrink-0 px-6 py-4 sm:px-8 sm:py-6 border-b border-white/10 ${detailType === 'leave'
                  ? 'bg-gradient-to-r from-blue-600 to-blue-500'
                  : 'bg-gradient-to-r from-purple-600 to-purple-500'
                  }`}>
                  <div className="flex items-center justify-between text-white">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-md">
                        {detailType === 'leave' ? <Calendar className="w-5 h-5" /> : <Briefcase className="w-5 h-5" />}
                      </div>
                      <div>
                        <h2 className="text-base sm:text-lg font-black uppercase tracking-wider">
                          {detailType === 'leave' ? 'Leave Details' : 'OD Details'}
                        </h2>
                        <p className="text-white/70 text-[10px] font-bold uppercase tracking-widest">Workspace Management</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setShowDetailDialog(false)}
                      className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 space-y-6 sm:space-y-8">
                  {/* Top Section: Employee & Status */}
                  <div className="flex flex-col sm:flex-row sm:justify-between items-start gap-6">
                    <div className="flex items-center gap-4">
                      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-white font-black text-2xl shadow-xl ${detailType === 'leave'
                        ? 'bg-blue-600 shadow-blue-500/20'
                        : 'bg-purple-600 shadow-purple-500/20'
                        }`}>
                        {(selectedItem!.employeeId?.employee_name?.[0] || selectedItem!.emp_no?.[0] || 'E').toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-black text-slate-900 dark:text-white text-xl">
                          {selectedItem!.employeeId?.employee_name || selectedItem!.emp_no}
                        </h3>
                        <p className="text-sm text-slate-500 font-bold uppercase tracking-tight">
                          {selectedItem!.employeeId?.emp_no}
                        </p>
                        <div className="flex gap-2 mt-2">
                          {selectedItem!.department?.name && (
                            <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700">
                              {selectedItem!.department.name}
                            </span>
                          )}
                          {selectedItem!.designation?.name && (
                            <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700">
                              {selectedItem!.designation.name}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-row sm:flex-col items-center sm:items-end gap-2 w-full sm:w-auto justify-between sm:justify-start">
                      <span className={`px-4 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest border ${getStatusColor(selectedItem!.status)}`}>
                        {selectedItem!.status?.replace('_', ' ')}
                      </span>
                      <div className="flex items-center gap-1.5 text-slate-400 font-bold text-[10px] uppercase tracking-wider">
                        <Clock3 className="w-3.5 h-3.5" />
                        Applied {formatDate((selectedItem! as any).createdAt || selectedItem!.appliedAt)}
                      </div>
                    </div>
                  </div>

                  {/* CO Eligibility Indicator */}
                  {detailType === 'od' && (selectedItem as any).isCOEligible && (
                    <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-200 dark:border-indigo-800/50 animate-in fade-in zoom-in duration-500">
                      <div className="flex items-start gap-4">
                        <div className="p-2.5 rounded-xl bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 shrink-0">
                          <Star className="w-5 h-5 fill-current" />
                        </div>
                        <div>
                          <p className="text-sm font-black text-indigo-900 dark:text-indigo-100 uppercase tracking-tight">Premium Reward</p>
                          <p className="text-xs text-indigo-700/80 dark:text-indigo-300/80 leading-relaxed font-medium mt-1">
                            This OD contributes to your compensatory off as it was applied on a holiday or week-off.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Stats Grid - Cleaner Look */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-50 dark:bg-slate-700/30 p-4 sm:p-6 rounded-xl">
                    <div className="space-y-1">
                      <p className="text-[10px] sm:text-xs uppercase font-bold text-slate-400 tracking-wider">Type</p>
                      <p className="text-[13px] sm:text-sm font-bold text-slate-900 dark:text-white truncate" title={detailType === 'leave' ? (selectedItem! as LeaveApplication).leaveType : (selectedItem! as ODApplication).odType}>
                        {((detailType === 'leave' ? (selectedItem! as LeaveApplication).leaveType : (selectedItem! as ODApplication).odType) || '').replace('_', ' ')}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] sm:text-xs uppercase font-bold text-slate-400 tracking-wider">Duration</p>
                      <p className="text-[13px] sm:text-sm font-bold text-slate-900 dark:text-white">
                        {selectedItem!.numberOfDays}d {selectedItem!.isHalfDay ? `(${(selectedItem!.halfDayType?.replace('_', ' ') || 'first half')})` : ''}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] sm:text-xs uppercase font-bold text-slate-400 tracking-wider">From</p>
                      <p className="text-[13px] sm:text-sm font-bold text-slate-900 dark:text-white">{formatDate(selectedItem!.fromDate)}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] sm:text-xs uppercase font-bold text-slate-400 tracking-wider">To</p>
                      <p className="text-[13px] sm:text-sm font-bold text-slate-900 dark:text-white">{formatDate(selectedItem!.toDate)}</p>
                    </div>
                  </div>

                  {/* Punch Transparency / Time Details (Visible if populated) */}
                  {detailType === 'od' && (selectedItem as ODApplication).odStartTime && (
                    <div className="grid grid-cols-3 gap-4 bg-purple-50 dark:bg-purple-900/20 p-4 rounded-xl border border-purple-100 dark:border-purple-800/50">
                      <div className="space-y-1">
                        <p className="text-[10px] uppercase font-bold text-purple-400 tracking-wider">Work In</p>
                        <p className="text-sm font-black text-purple-700 dark:text-purple-300">
                          {(() => {
                            const [h, m] = ((selectedItem as ODApplication).odStartTime || '').split(':');
                            if (!h) return 'N/A';
                            const date = new Date();
                            date.setHours(parseInt(h), parseInt(m));
                            return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
                          })()}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] uppercase font-bold text-purple-400 tracking-wider">Work Out</p>
                        <p className="text-sm font-black text-purple-700 dark:text-purple-300">
                          {(() => {
                            const [h, m] = ((selectedItem as ODApplication).odEndTime || '').split(':');
                            if (!h) return 'N/A';
                            const date = new Date();
                            date.setHours(parseInt(h), parseInt(m));
                            return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
                          })()}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] uppercase font-bold text-purple-400 tracking-wider">Total Duration</p>
                        <p className="text-sm font-black text-purple-700 dark:text-purple-300">
                          {(selectedItem as ODApplication).durationHours || 0} hrs
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="space-y-6">
                    <div className="bg-slate-50 dark:bg-slate-900/50 p-4 sm:p-6 rounded-xl">
                      <p className="text-[10px] sm:text-xs uppercase font-bold text-slate-400 mb-2 tracking-wider">Purpose / Reason</p>
                      <p className="text-[13px] sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                        {selectedItem!.purpose || 'No purpose specified'}
                      </p>
                    </div>

                    {detailType === 'od' && (selectedItem! as ODApplication).placeVisited && (
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-[13px] sm:text-sm text-slate-700 dark:text-slate-300 px-2 mt-2">
                        <span className="font-bold text-[10px] sm:text-xs uppercase text-slate-400 tracking-wider sm:min-w-20">Location:</span>
                        <span className="font-medium break-words">{(selectedItem! as ODApplication).placeVisited}</span>
                      </div>
                    )}
                    {selectedItem!.contactNumber && (
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-[13px] sm:text-sm text-slate-700 dark:text-slate-300 px-2 mt-2">
                        <span className="font-bold text-[10px] sm:text-xs uppercase text-slate-400 tracking-wider sm:min-w-20">Contact:</span>
                        <span className="font-medium text-slate-900 dark:text-white break-all">{selectedItem!.contactNumber}</span>
                      </div>
                    )}
                  </div>

                  {detailType === 'od' && ((selectedItem as any).photoEvidence || (selectedItem as any).geoLocation) && (
                    <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-4 sm:p-5 border border-slate-200 dark:border-slate-700">
                      <p className="text-xs uppercase font-bold text-slate-400 mb-3 tracking-wider">Evidence & Location</p>
                      <div className="flex flex-col sm:grid sm:grid-cols-2 gap-6">
                        {(selectedItem as any).photoEvidence && (
                          <div className="flex items-start gap-4 p-4 rounded-xl bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 shadow-sm">
                            <a
                              href={(selectedItem as any).photoEvidence.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="relative group block shrink-0"
                            >
                              <img
                                src={(selectedItem as any).photoEvidence.url}
                                alt="Evidence"
                                className="w-24 h-24 rounded-lg object-cover border border-slate-200 dark:border-slate-600 shadow-sm transition-transform group-hover:scale-105"
                              />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors rounded-lg">
                                <svg className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                              </div>
                            </a>
                            <div className="pt-1">
                              <p className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-tight">Photo Evidence</p>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 uppercase font-black">Captured via App</p>
                            </div>
                          </div>
                        )}
                        <div className="space-y-4">
                          {(selectedItem as any).geoLocation && (
                            <div className="p-4 rounded-xl bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 shadow-sm">
                              <div className="flex items-center gap-2 mb-3">
                                <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                <span className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-widest">Live Location</span>
                              </div>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-slate-400">Lat:</span>
                                  <span className="ml-1 font-mono text-slate-700 dark:text-slate-300">{(selectedItem as any).geoLocation.latitude?.toFixed(6)}</span>
                                </div>
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-slate-400">Lon:</span>
                                  <span className="ml-1 font-mono text-slate-700 dark:text-slate-300">{(selectedItem as any).geoLocation.longitude?.toFixed(6)}</span>
                                </div>
                                {(selectedItem as any).geoLocation.address && (
                                  <div className="col-span-2 pt-3 border-t border-slate-100 dark:border-slate-700 mt-2">
                                    <span className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Full Address</span>
                                    <p className="text-slate-700 dark:text-slate-300 leading-tight text-[11px] font-medium">{(selectedItem as any).geoLocation.address}</p>
                                  </div>
                                )}
                                <div className="col-span-2 mt-2 pt-2">
                                  <a
                                    href={`https://www.google.com/maps?q=${(selectedItem as any).geoLocation.latitude},${(selectedItem as any).geoLocation.longitude}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-2 font-black text-[10px] uppercase tracking-wider"
                                  >
                                    <div className="p-1 rounded bg-blue-50 dark:bg-blue-900/30">
                                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                    </div>
                                    View on Maps
                                  </a>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Leaflet map view */}
                          {(() => {
                            const geo = (selectedItem as any).geoLocation;
                            const exif = (selectedItem as any).photoEvidence?.exifLocation;
                            const lat = geo?.latitude ?? exif?.latitude;
                            const lng = geo?.longitude ?? exif?.longitude;
                            const address = geo?.address ?? null;
                            if (lat == null || lng == null) return null;
                            return (
                              <div className="p-1 pb-0 rounded-xl bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
                                <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest p-3 pb-2">Map Preview</span>
                                <LocationMap latitude={lat} longitude={lng} address={address} height="150px" className="rounded-b-lg" />
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Approval Steps - Timeline / Progress */}
                  {((selectedItem as any).workflow?.approvalChain?.length > 0) && (
                    <div className="bg-slate-50 dark:bg-slate-900/50 p-4 sm:p-6 rounded-xl overflow-hidden scrollbar-hide">
                      <p className="text-xs uppercase font-bold text-slate-400 mb-4 tracking-wider">Approval Timeline</p>
                      {/* Progress bar */}
                      <div className="mb-6">
                        <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase mb-1">
                          <span>{((selectedItem as any).workflow.approvalChain as any[]).filter((s: any) => s.status === 'approved').length} of {((selectedItem as any).workflow.approvalChain as any[]).length} approved</span>
                        </div>
                        <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-green-500 to-green-600 transition-all duration-300"
                            style={{ width: `${(((selectedItem as any).workflow.approvalChain as any[]).filter((s: any) => s.status === 'approved').length / ((selectedItem as any).workflow.approvalChain as any[]).length) * 100}%` }}
                          />
                        </div>
                      </div>
                      {/* Vertical timeline */}
                      <div className="relative pl-6 border-l-2 border-slate-200 dark:border-slate-700 ml-1">
                        {((selectedItem as any).workflow.approvalChain as any[]).map((step: any, idx: number) => {
                          const stepRole = step.role || step.stepRole || 'step';
                          const label = step.label || `${stepRole.replace('_', ' ')}`;
                          const isApproved = step.status === 'approved';
                          const isRejected = step.status === 'rejected';
                          const isPending = step.status === 'pending';
                          const nextRole = (selectedItem as any).workflow?.nextApproverRole || (selectedItem as any).workflow?.nextApprover;
                          const isCurrent = isPending && (String(nextRole || '').toLowerCase() === String(stepRole).toLowerCase());
                          const nodeColor = isApproved ? 'bg-green-500 ring-4 ring-green-200 dark:ring-green-900/50' : isRejected ? 'bg-red-500 ring-4 ring-red-200 dark:ring-red-900/50' : isCurrent ? 'bg-blue-500 ring-4 ring-blue-200 dark:ring-blue-900/50' : 'bg-slate-300 dark:bg-slate-600';
                          return (
                            <div key={idx} className="relative pb-6 last:pb-0">
                              <div className={`absolute -left-[29px] top-0.5 w-4 h-4 rounded-full ${nodeColor} border-2 border-white dark:border-slate-900 shadow-sm`} />
                              <div className="ml-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-bold text-slate-900 dark:text-white capitalize">{label}</span>
                                  {isApproved && <span className="text-[10px] font-bold text-green-600 dark:text-green-400 uppercase">✓ Approved</span>}
                                  {isRejected && <span className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase">✗ Rejected</span>}
                                  {isCurrent && <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase">⏳ Your turn</span>}
                                  {isPending && !isCurrent && <span className="text-[10px] font-bold text-slate-400 uppercase">○ Pending</span>}
                                </div>
                                {(isApproved || isRejected) && (
                                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                                    {step.actionByName || 'Unknown'} ({step.actionByRole || stepRole})
                                    {step.updatedAt && <span className="ml-1 inline-block">· {new Date(step.updatedAt).toLocaleString()}</span>}
                                  </p>
                                )}
                                {(isApproved || isRejected) && step.comments && (
                                  <p className="text-xs text-slate-500 italic mt-0.5">"{step.comments}"</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Change History Section */}
                  {selectedItem.changeHistory && selectedItem.changeHistory.length > 0 && (
                    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
                      <button
                        onClick={() => setIsChangeHistoryExpanded(!isChangeHistoryExpanded)}
                        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors"
                      >
                        <span className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">
                          Edit History ({selectedItem.changeHistory.length})
                        </span>
                        <svg
                          className={`w-4 h-4 text-slate-500 transition-transform duration-300 ${isChangeHistoryExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {isChangeHistoryExpanded && (
                        <div className="p-4 space-y-4 bg-white dark:bg-slate-900 max-h-[300px] overflow-y-auto">
                          {selectedItem.changeHistory.map((change: any, idx: number) => {
                            const formatValue = (value: any) => {
                              if (value === null || value === undefined) return 'N/A';
                              const str = String(value);
                              if (str.includes('T') || (str.includes('-') && str.length > 10)) {
                                try {
                                  const date = new Date(str);
                                  if (!isNaN(date.getTime())) {
                                    return date.toLocaleDateString('en-IN', {
                                      day: '2-digit',
                                      month: 'short',
                                      year: 'numeric',
                                    });
                                  }
                                } catch (e) { }
                              }
                              return str;
                            };

                            const fieldName = change.field.replace(/([A-Z])/g, ' $1').trim().toUpperCase();
                            const oldValue = formatValue(change.originalValue);
                            const newValue = formatValue(change.newValue);

                            return (
                              <div key={idx} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 hover:shadow-sm transition-shadow">
                                <div className="flex items-start justify-between mb-2">
                                  <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                                    {fieldName}
                                  </span>
                                  <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                                    {new Date(change.modifiedAt).toLocaleString('en-IN', {
                                      day: '2-digit',
                                      month: '2-digit',
                                      year: '2-digit',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-xs mb-2">
                                  <span className="text-slate-400 line-through truncate max-w-[120px]">{oldValue}</span>
                                  <svg className="w-3 h-3 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                                  <span className="text-green-600 dark:text-green-400 font-bold truncate max-w-[120px]">{newValue}</span>
                                </div>
                                {change.modifiedByName && (
                                  <div className="text-[10px] text-slate-500 flex items-center gap-1.5">
                                    <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                                    <span>By {change.modifiedByName}</span>
                                    {change.modifiedByRole && <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-[9px] uppercase font-bold">{change.modifiedByRole}</span>}
                                  </div>
                                )}
                                {change.reason && (
                                  <p className="mt-2 text-[10px] text-slate-500 italic leading-relaxed border-t border-slate-100 dark:border-slate-700 pt-2">
                                    Reason: {change.reason}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Split Breakdown (Spacious) */}
                  {detailType === 'leave' && (selectedItem as LeaveApplication)?.splits && (selectedItem as LeaveApplication).splits!.length > 0 && (
                    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
                      <button
                        onClick={() => setIsBreakdownExpanded(!isBreakdownExpanded)}
                        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-700/30 text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest"
                      >
                        <span>Breakdown ({((selectedItem as LeaveApplication).splitSummary as LeaveSplitSummary)?.approvedDays ?? 0}/{(selectedItem as LeaveApplication).numberOfDays} Approved)</span>
                        <svg
                          className={`w-4 h-4 text-slate-500 transition-transform duration-300 ${isBreakdownExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {isBreakdownExpanded && (
                        <div className="divide-y divide-slate-100 dark:divide-slate-700 max-h-40 overflow-y-auto">
                          {(selectedItem as LeaveApplication).splits!.map((split, idx) => (
                            <div key={idx} className="flex justify-between px-4 py-2.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                              <div className="flex items-center gap-2">
                                <span className="text-slate-700 dark:text-slate-300">{formatDate(split.date)}</span>
                                {split.isHalfDay && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 uppercase font-black">
                                    {split.halfDayType === 'first_half' ? '1st' : '2nd'}
                                  </span>
                                )}
                              </div>
                              <span className={`capitalize font-bold ${split.status === 'approved' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{split.status}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Interactive Split Editor (For Approvers/Admins) */}
                  {detailType === 'leave' && currentUser?.role !== 'employee' && !['rejected', 'cancelled'].includes(selectedItem.status) && (
                    <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/50 p-6 border border-slate-200 dark:border-slate-700 space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Split & Decision</p>
                          <p className="text-[10px] text-slate-500 font-medium uppercase tracking-tight mt-1">Manage individual day approvals</p>
                        </div>
                        <label className="flex items-center gap-3 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={splitMode}
                            onChange={(e) => {
                              const enable = e.target.checked;
                              setSplitMode(enable);
                              if (enable && splitDrafts.length === 0 && detailType === 'leave' && selectedItem) {
                                setSplitDrafts(buildInitialSplits(selectedItem as LeaveApplication));
                              }
                              if (!enable) {
                                setSplitWarnings([]);
                                setSplitErrors([]);
                              }
                            }}
                            className="w-5 h-5 rounded-lg border-2 border-slate-300 text-blue-600 focus:ring-blue-500 transition-all group-hover:border-blue-400"
                          />
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">Enable Split</span>
                        </label>
                      </div>

                      {splitMode && (
                        <div className="animate-in fade-in slide-in-from-top-2 duration-300 space-y-4">
                          <div className="flex flex-wrap gap-3 p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-sm">
                            <div className="flex flex-col">
                              <span className="text-[9px] uppercase font-black text-slate-400">Total</span>
                              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{(selectedItem as LeaveApplication).numberOfDays}d</span>
                            </div>
                            <div className="w-px h-6 bg-slate-100 dark:bg-slate-700" />
                            <div className="flex flex-col">
                              <span className="text-[9px] uppercase font-black text-green-500">Approved</span>
                              <span className="text-xs font-bold text-green-600 dark:text-green-400">{splitDrafts.filter(s => s.status === 'approved').reduce((sum, s) => sum + (s.isHalfDay ? 0.5 : 1), 0)}d</span>
                            </div>
                            <div className="w-px h-6 bg-slate-100 dark:bg-slate-700" />
                            <div className="flex flex-col">
                              <span className="text-[9px] uppercase font-black text-red-500">Rejected</span>
                              <span className="text-xs font-bold text-red-600 dark:text-red-400">{splitDrafts.filter(s => s.status === 'rejected').reduce((sum, s) => sum + (s.isHalfDay ? 0.5 : 1), 0)}d</span>
                            </div>
                          </div>

                          {splitErrors.length > 0 && (
                            <div className="rounded-xl border border-red-200 bg-red-50/50 px-4 py-3 text-[11px] font-bold text-red-600 animate-pulse">
                              {splitErrors.map((msg, idx) => (
                                <div key={idx} className="flex items-center gap-2">
                                  <div className="w-1 h-1 rounded-full bg-red-500" />
                                  {msg}
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="space-y-2 max-h-[280px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-700">
                            {splitDrafts.map((split, idx) => (
                              <div key={`${split.date}-${idx}`} className="group flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-800 hover:border-blue-400/50 transition-all">
                                <div className="flex items-center gap-3">
                                  <div className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">{formatDate(split.date)}</div>
                                  <label className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-500 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={split.isHalfDay || false}
                                      onChange={(e) => updateSplitDraft(idx, { isHalfDay: e.target.checked })}
                                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    Half
                                  </label>
                                  {split.isHalfDay && (
                                    <select
                                      value={split.halfDayType || 'first_half'}
                                      onChange={(e) => updateSplitDraft(idx, { halfDayType: e.target.value as any })}
                                      className="text-[10px] font-bold h-7 rounded-lg border border-slate-200 bg-slate-50 px-2 dark:border-slate-700 dark:bg-slate-900 dark:text-white outline-none focus:border-blue-400"
                                    >
                                      <option value="first_half">1st Half</option>
                                      <option value="second_half">2nd Half</option>
                                    </select>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 ml-auto">
                                  <select
                                    value={split.leaveType}
                                    onChange={(e) => updateSplitDraft(idx, { leaveType: e.target.value })}
                                    className="text-[10px] font-bold h-8 rounded-lg border border-slate-200 bg-white px-2 dark:border-slate-700 dark:bg-slate-900 dark:text-white outline-none focus:border-blue-400"
                                  >
                                    <option value="">Select Type</option>
                                    {leaveTypes.map((lt) => (
                                      <option key={lt.code} value={lt.code}>
                                        {lt.name || lt.code}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    value={split.status}
                                    onChange={(e) => updateSplitDraft(idx, { status: e.target.value as 'approved' | 'rejected' })}
                                    className={`text-[10px] font-black h-8 rounded-lg border px-2 outline-none uppercase tracking-wider ${split.status === 'approved'
                                      ? 'border-green-200 bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800'
                                      : 'border-red-200 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800'
                                      }`}
                                  >
                                    <option value="approved">Approve</option>
                                    <option value="rejected">Reject</option>
                                  </select>
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="flex gap-2 pt-2">
                            <button
                              type="button"
                              onClick={async () => {
                                setSplitSaving(true);
                                await validateSplitsForLeave();
                                setSplitSaving(false);
                              }}
                              className="flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 transition-colors"
                            >
                              {splitSaving ? 'Validating...' : 'Validate'}
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                setSplitSaving(true);
                                const saved = await saveSplits();
                                if (saved) {
                                  toast.success('Splits updated');
                                  const res = await api.getLeave((selectedItem as LeaveApplication)._id);
                                  if (res?.success) {
                                    setSelectedItem(res.data);
                                    setSplitDrafts(buildInitialSplits(res.data));
                                  }
                                }
                                setSplitSaving(false);
                              }}
                              className="flex-[2] py-2 text-[10px] font-black uppercase tracking-widest rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-500/20 hover:bg-blue-700 transition-all active:scale-[0.98]"
                            >
                              {splitSaving ? 'Saving...' : 'Apply Splits'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Revoke / Edit Actions */}
                  <div className="flex flex-col gap-3">
                    {/* Revoke - visible if canRevoke is true (actor or admin, within 48hr) */}
                    {canRevoke && currentUser?.role !== 'employee' && (
                      <div className="flex flex-col gap-3 p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-800/50 rounded-xl">
                        <div className="flex items-center gap-2 mb-1">
                          <RotateCw className="w-4 h-4 text-orange-500" />
                          <span className="text-xs font-bold text-orange-700 dark:text-orange-400 uppercase tracking-wider">Revoke Action</span>
                        </div>
                        <p className="text-[10px] text-orange-600 dark:text-orange-500 leading-relaxed mb-1">
                          You can revert the last approval or rejection. This will return the request to its previous state.
                        </p>
                        <div className="flex gap-2">
                          <input
                            value={revokeReason}
                            onChange={(e) => setRevokeReason(e.target.value)}
                            className="flex-1 text-xs border border-orange-200 dark:border-orange-800 rounded-lg px-3 py-2 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 dark:bg-slate-900 dark:text-white"
                            placeholder="Reason for revoking..."
                          />
                          <button
                            onClick={async () => {
                              if (!revokeReason) return toast.error('Reason required');
                              try {
                                const res = detailType === 'leave' ? await api.revokeLeaveApproval(selectedItem._id, revokeReason) : await api.revokeODApproval(selectedItem._id, revokeReason);
                                if (res.success) {
                                  setShowDetailDialog(false);
                                  loadData();
                                  toast.success('Action revoked and status reverted');
                                } else {
                                  toast.error(res.error || 'Failed to revoke');
                                }
                              } catch (e) { toast.error('An error occurred during revocation'); }
                            }}
                            className="px-4 py-2 bg-orange-500 text-white text-xs font-bold rounded-lg hover:bg-orange-600 transition-colors shadow-sm"
                          >
                            Revoke
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer Actions - Sticky Bottom */}
                {/* Footer Actions - Sticky Bottom */}
                <div className="p-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row gap-3 justify-end items-stretch sm:items-center">
                  {!['approved', 'rejected', 'cancelled'].includes(selectedItem.status) && canPerformAction(selectedItem, detailType) && (
                    <>
                      <textarea
                        value={actionComment}
                        onChange={(e) => setActionComment(e.target.value)}
                        placeholder="Add a comment..."
                        rows={1}
                        className="w-full sm:min-w-[200px] rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-white resize-none"
                      />
                      {['manager', 'hod', 'hr', 'super_admin', 'sub_admin'].includes(currentUser?.role || '') && (
                        <div className="flex gap-2">
                          <button onClick={() => handleDetailAction('approve')} className="flex-1 sm:flex-none px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors">Approve</button>
                          <button onClick={() => handleDetailAction('reject')} className="flex-1 sm:flex-none px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors">Reject</button>
                        </div>
                      )}
                    </>
                  )}

                  {['manager', 'hod', 'hr', 'super_admin', 'sub_admin'].includes(currentUser?.role || '') && !['rejected', 'cancelled'].includes(selectedItem.status) && (
                    <button
                      onClick={() => {
                        setEditFormData({
                          ...selectedItem,
                          fromDate: formatDateForInput(selectedItem.fromDate),
                          toDate: formatDateForInput(selectedItem.toDate),
                        });
                        setShowEditDialog(true);
                      }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
                    >
                      Edit
                    </button>
                  )}

                  {(isSuperAdmin || currentUser?.role === 'sub_admin' ||
                    ((selectedItem.employeeId?._id === currentUser?.employeeRef || selectedItem.appliedBy?._id === currentUser?._id || selectedItem.appliedBy === currentUser?._id) &&
                      selectedItem.status === 'pending')) && (
                      <button
                        onClick={() => {
                          handleDeleteRequest(selectedItem._id, detailType);
                        }}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
                      >
                        Delete
                      </button>
                    )}

                  <button
                    onClick={() => {
                      setShowDetailDialog(false);
                      setSelectedItem(null);
                      setIsChangeHistoryExpanded(false);
                    }}
                    className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-lg transition-colors shadow-sm dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )
        }
      </div >


      {
        showEditDialog && selectedItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setShowEditDialog(false)} />
            <div className="relative z-50 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-white/20 dark:border-slate-800 shadow-2xl p-6 sm:p-8 animate-in zoom-in-95 duration-300">
              <div className="mb-8">
                <h2 className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300">
                  Edit {detailType === 'leave' ? 'Leave' : 'OD'} Application
                </h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Modify the existing request details.</p>
              </div>

              <form onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const user = auth.getUser();

                  // Clean up data before sending - convert empty strings to null for enum fields
                  const cleanedData: any = {
                    ...editFormData,
                    // Fix halfDayType - must be null if not half day, or valid enum value
                    halfDayType: editFormData.isHalfDay
                      ? (editFormData.halfDayType || 'first_half')
                      : (editFormData.halfDayType === '' || editFormData.halfDayType === null ? null : editFormData.halfDayType),
                    // For hour-based OD, ensure times are properly set
                    odStartTime: (detailType === 'od' && editFormData.odType_extended === 'hours')
                      ? (editFormData.odStartTime || null)
                      : (editFormData.odStartTime === '' ? null : editFormData.odStartTime),
                    odEndTime: (detailType === 'od' && editFormData.odType_extended === 'hours')
                      ? (editFormData.odEndTime || null)
                      : (editFormData.odEndTime === '' ? null : editFormData.odEndTime),
                    changeReason: `Edited by ${user?.name || 'Admin'}`,
                  };

                  // If Super Admin is changing status, include statusChangeReason
                  if (isSuperAdmin && editFormData.status && editFormData.status !== selectedItem.status) {
                    cleanedData.statusChangeReason = `Status changed from ${selectedItem.status} to ${editFormData.status}`;
                  }

                  const response = detailType === 'leave'
                    ? await api.updateLeave(selectedItem._id, cleanedData)
                    : await api.updateOD(selectedItem._id, cleanedData);

                  if (response.success) {
                    Swal.fire({
                      icon: 'success',
                      title: 'Success!',
                      text: `${detailType === 'leave' ? 'Leave' : 'OD'} updated successfully`,
                      timer: 2000,
                      showConfirmButton: false,
                    });
                    setShowEditDialog(false);
                    setShowDetailDialog(false);
                    setSelectedItem(null);
                    setIsChangeHistoryExpanded(false);
                    loadData();
                  } else {
                    Swal.fire({
                      icon: 'error',
                      title: 'Failed',
                      text: response.error || 'Failed to update',
                    });
                  }
                } catch (err: any) {
                  Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: err.message || 'Failed to update',
                  });
                }
              }} className="space-y-4">
                {/* Type */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    {detailType === 'leave' ? 'Leave Type' : 'OD Type'} *
                  </label>
                  <select
                    value={detailType === 'leave' ? editFormData.leaveType : editFormData.odType}
                    onChange={(e) => setEditFormData({
                      ...editFormData,
                      [detailType === 'leave' ? 'leaveType' : 'odType']: e.target.value,
                    })}
                    required
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">Select {detailType === 'leave' ? 'Leave' : 'OD'} Type</option>
                    {(detailType === 'leave' ? leaveTypes : odTypes).map((t: any) => (
                      <option key={t.code} value={t.code}>{t.name}</option>
                    ))}
                  </select>
                </div>

                {/* Dates */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">From Date *</label>
                    <input
                      type="date"
                      value={editFormData.fromDate}
                      onChange={(e) => {
                        const newFromDate = e.target.value;
                        // Auto-set end date = start date for half-day and hour-based OD
                        const newToDate = (detailType === 'od' && (editFormData.odType_extended === 'half_day' || editFormData.odType_extended === 'hours'))
                          ? newFromDate
                          : editFormData.toDate;
                        setEditFormData({ ...editFormData, fromDate: newFromDate, toDate: newToDate });
                      }}
                      required
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 sm:py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      To Date *
                      {/* Today button for hour-based OD */}
                      {detailType === 'od' && editFormData.odType_extended === 'hours' && (
                        <button
                          type="button"
                          onClick={() => {
                            const today = new Date().toISOString().split('T')[0];
                            setEditFormData({ ...editFormData, fromDate: today, toDate: today });
                          }}
                          className="ml-2 text-xs px-2 py-1 rounded-lg bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50 transition-colors"
                        >
                          Today
                        </button>
                      )}
                    </label>
                    <input
                      type="date"
                      value={editFormData.toDate}
                      onChange={(e) => {
                        // For half-day and hour-based OD, prevent changing end date separately
                        if (detailType === 'od' && (editFormData.odType_extended === 'half_day' || editFormData.odType_extended === 'hours')) {
                          // Auto-set to start date
                          setEditFormData({ ...editFormData, toDate: editFormData.fromDate });
                        } else {
                          setEditFormData({ ...editFormData, toDate: e.target.value });
                        }
                      }}
                      required
                      disabled={detailType === 'od' && (editFormData.odType_extended === 'half_day' || editFormData.odType_extended === 'hours')}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white disabled:bg-slate-100 dark:disabled:bg-slate-700 disabled:cursor-not-allowed"
                    />
                    {detailType === 'od' && (editFormData.odType_extended === 'half_day' || editFormData.odType_extended === 'hours') && (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        End date is automatically set to start date for {editFormData.odType_extended === 'half_day' ? 'half-day' : 'hour-based'} OD
                      </p>
                    )}
                  </div>
                </div>

                {/* OD Duration Type (OD only) */}
                {detailType === 'od' && (
                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">OD Duration Type *</label>
                    <div className="grid grid-cols-3 gap-3">
                      <button
                        type="button"
                        onClick={() => setEditFormData({ ...editFormData, odType_extended: 'full_day', isHalfDay: false, halfDayType: null, odStartTime: null, odEndTime: null })}
                        className={`p-3 rounded-lg border-2 transition-all ${editFormData.odType_extended === 'full_day'
                          ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/30'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                          }`}
                      >
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">Full Day</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const endDate = editFormData.fromDate || editFormData.toDate;
                          setEditFormData({
                            ...editFormData,
                            odType_extended: 'half_day',
                            isHalfDay: true,
                            halfDayType: editFormData.halfDayType || 'first_half',
                            odStartTime: null,
                            odEndTime: null,
                            toDate: endDate || editFormData.fromDate
                          });
                        }}
                        className={`p-3 rounded-lg border-2 transition-all ${editFormData.odType_extended === 'half_day'
                          ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/30'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                          }`}
                      >
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">Half Day</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const endDate = editFormData.fromDate || editFormData.toDate;
                          setEditFormData({
                            ...editFormData,
                            odType_extended: 'hours',
                            isHalfDay: false,
                            halfDayType: null,
                            toDate: endDate || editFormData.fromDate
                          });
                        }}
                        className={`p-3 rounded-lg border-2 transition-all ${editFormData.odType_extended === 'hours'
                          ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/30'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                          }`}
                      >
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">Specific Hours</div>
                      </button>
                    </div>
                  </div>
                )}

                {/* Hour Input (for hour-based OD) */}
                {detailType === 'od' && editFormData.odType_extended === 'hours' && (
                  <div className="space-y-4 p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-700">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Start Time *</label>
                        <input
                          type="time"
                          value={editFormData.odStartTime || ''}
                          onChange={(e) => setEditFormData({ ...editFormData, odStartTime: e.target.value })}
                          required={editFormData.odType_extended === 'hours'}
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 sm:py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">End Time *</label>
                        <input
                          type="time"
                          value={editFormData.odEndTime || ''}
                          onChange={(e) => setEditFormData({ ...editFormData, odEndTime: e.target.value })}
                          required={editFormData.odType_extended === 'hours'}
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 sm:py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                    </div>
                    {editFormData.odStartTime && editFormData.odEndTime && (
                      <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-purple-300 dark:border-purple-600">
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          {(() => {
                            const [startHour, startMin] = editFormData.odStartTime.split(':').map(Number);
                            const [endHour, endMin] = editFormData.odEndTime.split(':').map(Number);
                            const startMinutes = startHour * 60 + startMin;
                            const endMinutes = endHour * 60 + endMin;
                            const durationMinutes = endMinutes - startMinutes;

                            if (durationMinutes <= 0) {
                              return <span className="text-red-600 dark:text-red-400">❌ End time must be after start time</span>;
                            }

                            const hours = Math.floor(durationMinutes / 60);
                            const mins = durationMinutes % 60;

                            if (durationMinutes > 480) {
                              return <span className="text-red-600 dark:text-red-400">❌ Maximum duration is 8 hours</span>;
                            }

                            return (
                              <span className="text-green-600 dark:text-green-400">
                                ✓ Duration: {hours}h {mins}m
                              </span>
                            );
                          })()}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Half Day (for non-hour-based OD) */}
                {!(detailType === 'od' && editFormData.odType_extended === 'hours') && (
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editFormData.isHalfDay}
                        onChange={(e) => setEditFormData({ ...editFormData, isHalfDay: e.target.checked, halfDayType: e.target.checked ? (editFormData.halfDayType || 'first_half') : null })}
                        className="w-4 h-4 rounded border-slate-300"
                      />
                      <span className="text-sm text-slate-700 dark:text-slate-300">Half Day</span>
                    </label>
                    {editFormData.isHalfDay && (
                      <select
                        value={editFormData.halfDayType || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, halfDayType: e.target.value as 'first_half' | 'second_half' | null || null })}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        <option value="first_half">First Half</option>
                        <option value="second_half">Second Half</option>
                      </select>
                    )}
                  </div>
                )}

                {/* Purpose */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 sm:mb-2">Purpose *</label>
                  <textarea
                    value={editFormData.purpose}
                    onChange={(e) => setEditFormData({ ...editFormData, purpose: e.target.value })}
                    required
                    rows={3}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                {/* Place Visited (OD only) */}
                {detailType === 'od' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Place Visited *</label>
                    <input
                      type="text"
                      value={editFormData.placeVisited}
                      onChange={(e) => setEditFormData({ ...editFormData, placeVisited: e.target.value })}
                      required
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 sm:py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                )}

                {/* Contact Number */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 sm:mb-2">Contact Number *</label>
                  <input
                    type="tel"
                    value={editFormData.contactNumber}
                    onChange={(e) => setEditFormData({ ...editFormData, contactNumber: e.target.value })}
                    required
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                {/* Remarks */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 sm:mb-2">Remarks</label>
                  <input
                    type="text"
                    value={editFormData.remarks}
                    onChange={(e) => setEditFormData({ ...editFormData, remarks: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                {/* Status (Super Admin only) */}
                {isSuperAdmin && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Status (Super Admin)
                    </label>
                    <select
                      value={editFormData.status || selectedItem.status}
                      onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 sm:py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="pending">Pending</option>
                      <option value="hod_approved">HOD Approved</option>
                      <option value="hr_approved">HR Approved</option>
                      <option value="approved">Approved</option>
                      <option value="hod_rejected">HOD Rejected</option>
                      <option value="hr_rejected">HR Rejected</option>
                      <option value="rejected">Rejected</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                )}

                {/* Buttons */}
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowEditDialog(false)}
                    className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2.5 text-sm font-semibold text-white rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </div>
          </div>
        )
      }
    </div >
  );
}


