'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { api, Department, Division, Designation } from '@/lib/api';
import { auth } from '@/lib/auth';
import { toast, ToastContainer } from 'react-toastify';
import Swal from 'sweetalert2';
import 'react-toastify/dist/ReactToastify.css';
import Spinner from '@/components/Spinner';
import LocationPhotoCapture from '@/components/LocationPhotoCapture';
import EmployeeSelect from '@/components/EmployeeSelect';
import { Loader2, Calendar, Briefcase, X, Clock as Clock3 } from 'lucide-react';

const LocationMap = dynamic(() => import('@/components/LocationMap'), { ssr: false });


// Icons
const PlusIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
  </svg>
);

const CalendarIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const BriefcaseIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

const XIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const ClockIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const SearchIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

const UserIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);

const SettingsIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
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

  let current = new Date(start);
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

const getRequestedDays = (fromDate: string, toDate: string, isHalfDay: boolean): number => {
  if (!fromDate || !toDate) return 0;
  if (isHalfDay) return 0.5;
  const from = parseDateOnly(fromDate);
  const to = parseDateOnly(toDate);
  const diffTime = Math.abs(to.getTime() - from.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
};

export default function LeavesPage() {
  const [activeTab, setActiveTab] = useState<'leaves' | 'od' | 'pending'>('leaves');
  const [leaves, setLeaves] = useState<LeaveApplication[]>([]);
  const [ods, setODs] = useState<ODApplication[]>([]);
  const [pendingLeaves, setPendingLeaves] = useState<LeaveApplication[]>([]);
  const [pendingODs, setPendingODs] = useState<ODApplication[]>([]);
  const [pendingLeavesTotal, setPendingLeavesTotal] = useState(0);
  const [pendingODsTotal, setPendingODsTotal] = useState(0);
  const [pendingLeavesPage, setPendingLeavesPage] = useState(1);
  const [pendingODsPage, setPendingODsPage] = useState(1);
  const pendingLimit = 20;
  const [loadingPending, setLoadingPending] = useState(false);
  const [loading, setLoading] = useState(true);

  // Dialog states
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [applyType, setApplyType] = useState<'leave' | 'od'>('leave');
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [isChangeHistoryExpanded, setIsChangeHistoryExpanded] = useState(false);
  const [selectedItem, setSelectedItem] = useState<LeaveApplication | ODApplication | null>(null);
  const [detailType, setDetailType] = useState<'leave' | 'od'>('leave');
  const [actionComment, setActionComment] = useState('');
  const [splitMode, setSplitMode] = useState(false);
  const [splitDrafts, setSplitDrafts] = useState<LeaveSplit[]>([]);
  const [splitWarnings, setSplitWarnings] = useState<string[]>([]);
  const [splitErrors, setSplitErrors] = useState<string[]>([]);
  const [splitSaving, setSplitSaving] = useState(false);

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
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [showEmployeeDropdown, setShowEmployeeDropdown] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  // CL balance for selected month (when leave type is CL)
  const [clBalanceForMonth, setClBalanceForMonth] = useState<number | null>(null);
  const [clBalanceLoading, setClBalanceLoading] = useState(false);

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

  // Approved records info for conflict checking
  const [approvedRecordsInfo, setApprovedRecordsInfo] = useState<{
    hasLeave: boolean;
    hasOD: boolean;
    leaveInfo: any;
    odInfo: any;
  } | null>(null);
  const [checkingApprovedRecords, setCheckingApprovedRecords] = useState(false);

  // Photo Evidence & Location State
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [locationData, setLocationData] = useState<{
    latitude: number;
    longitude: number;
    address?: string;
    capturedAt: Date;
  } | null>(null);

  // Filter Dropdown States
  const [searchTerm, setSearchTerm] = useState('');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);

  const [selectedDivisionFilter, setSelectedDivisionFilter] = useState('');
  const [selectedDepartmentFilter, setSelectedDepartmentFilter] = useState('');
  const [selectedDesignationFilter, setSelectedDesignationFilter] = useState('');

  const loadFilterData = async () => {
    try {
      const [divRes, deptRes, desigRes] = await Promise.all([
        api.getDivisions(),
        api.getDepartments(),
        api.getAllDesignations()
      ]);

      if (divRes.success && divRes.data) setDivisions(divRes.data);
      if (deptRes.success && deptRes.data) setDepartments(deptRes.data as any[]);
      if (desigRes.success && desigRes.data) setDesignations(desigRes.data);
    } catch (err) {
      console.error('Failed to load filter options:', err);
    }
  };

  // Filtered departments based on selected division
  const filteredDepartments = useMemo(() => {
    if (!selectedDivisionFilter) return departments;
    const div = divisions.find(d => String(d._id) === selectedDivisionFilter);
    if (!div || !div.departments) return departments;
    return departments.filter(dept =>
      (div.departments || []).some(d =>
        (typeof d === 'string' ? d : String((d as any)._id)) === String(dept._id)
      )
    );
  }, [selectedDivisionFilter, divisions, departments]);

  useEffect(() => {
    loadData();
    loadTypes();
    loadEmployees();
    loadFilterData();
  }, []);

  useEffect(() => {
    if (activeTab !== 'pending') return;
    setPendingLeavesPage(1);
    setPendingODsPage(1);
    loadPendingData(1, 1);
  }, [activeTab, selectedDivisionFilter, selectedDepartmentFilter, selectedDesignationFilter, searchTerm]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [leavesRes, odsRes] = await Promise.all([
        api.getLeaves({ limit: 50 }),
        api.getODs({ limit: 50 }),
      ]);
      if (leavesRes.success) setLeaves(leavesRes.data || []);
      if (odsRes.success) setODs(odsRes.data || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const getPendingFilters = () => ({
    search: searchTerm?.trim() || undefined,
    department: selectedDepartmentFilter || undefined,
    division: selectedDivisionFilter || undefined,
    designation: selectedDesignationFilter || undefined,
  });

  const loadPendingData = async (leavePage = pendingLeavesPage, odPage = pendingODsPage) => {
    if (activeTab !== 'pending') return;
    setLoadingPending(true);
    const filters = getPendingFilters();
    try {
      const [leavesRes, odsRes] = await Promise.all([
        api.getPendingLeaveApprovals({ ...filters, page: leavePage, limit: pendingLimit }),
        api.getPendingODApprovals({ ...filters, page: odPage, limit: pendingLimit }),
      ]);
      if (leavesRes.success) {
        setPendingLeaves(leavesRes.data || []);
        setPendingLeavesTotal((leavesRes as any).total ?? (leavesRes.data?.length ?? 0));
      }
      if (odsRes.success) {
        setPendingODs(odsRes.data || []);
        setPendingODsTotal((odsRes as any).total ?? (odsRes.data?.length ?? 0));
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to load pending approvals');
    } finally {
      setLoadingPending(false);
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

  const loadEmployees = async () => {
    try {
      const response = await api.getEmployees({ is_active: true });
      if (response.success) {
        setEmployees(response.data || []);
      }
    } catch (err) {
      console.error('Failed to load employees:', err);
    }
  };

  // Filter employees based on search
  const filteredEmployees = employees.filter((emp) => {
    const searchLower = employeeSearch.toLowerCase();
    const fullName = getEmployeeName(emp).toLowerCase();
    return (
      fullName.includes(searchLower) ||
      emp.emp_no?.toLowerCase().includes(searchLower) ||
      emp.department?.name?.toLowerCase().includes(searchLower)
    );
  });

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate employee selection
    if (!selectedEmployee) {
      toast.error('Please select an employee');
      return;
    }

    // Check if there's a full-day approved record that conflicts
    if (approvedRecordsInfo) {
      const hasFullDayLeave = approvedRecordsInfo.hasLeave && !approvedRecordsInfo.leaveInfo?.isHalfDay;
      const hasFullDayOD = approvedRecordsInfo.hasOD && !approvedRecordsInfo.odInfo?.isHalfDay;

      if (hasFullDayLeave || hasFullDayOD) {
        toast.error('Cannot create request - Employee has an approved full-day record on this date');
        return;
      }

      // Check if trying to select the same half that's already approved
      if (formData.isHalfDay) {
        const approvedHalf = approvedRecordsInfo.hasLeave
          ? approvedRecordsInfo.leaveInfo?.halfDayType
          : approvedRecordsInfo.odInfo?.halfDayType;

        if (approvedHalf === formData.halfDayType) {
          toast.error(`Cannot create request - Employee already has ${approvedHalf === 'first_half' ? 'First Half' : 'Second Half'} approved on this date`);
          return;
        }
      }
    }

    try {

      // Validate hour-based OD
      if (applyType === 'od' && formData.odType_extended === 'hours') {
        if (!formData.odStartTime || !formData.odEndTime) {
          toast.error('Please provide start and end times for hour-based OD');
          return;
        }
      }

      // Check Photo Evidence for OD
      let uploadedEvidence = undefined;
      let geoData = undefined;

      if (applyType === 'od') {
        if (!evidenceFile) {
          toast.error('Photo evidence is required for OD applications');
          return;
        }

        // Lazy Upload
        try {
          const uploadRes = await api.uploadEvidence(evidenceFile) as any;
          if (!uploadRes.success) throw new Error('Upload failed');

          uploadedEvidence = {
            url: uploadRes.url,
            key: uploadRes.key,
            filename: uploadRes.filename
          };

          if (locationData) {
            geoData = {
              latitude: locationData.latitude,
              longitude: locationData.longitude,
              capturedAt: locationData.capturedAt,
              address: locationData.address || ''
            };
          }
        } catch (uploadError) {
          console.error("Evidence upload failed:", uploadError);
          toast.error("Failed to upload photo evidence");
          return;
        }
      }

      if (applyType === 'leave') {
        const isCL = formData.leaveType === 'CL' || formData.leaveType?.toUpperCase() === 'CL';
        if (isCL) {
          if (clBalanceForMonth === null && !clBalanceLoading) {
            toast.error('CL balance could not be loaded. Please select employee and from date again, or try again.');
            return;
          }
          if (clBalanceForMonth === null) {
            toast.error('Please wait for CL balance to load.');
            return;
          }
          const requestedDays = getRequestedDays(formData.fromDate, formData.toDate, formData.isHalfDay);
          if (requestedDays > clBalanceForMonth) {
            toast.error(`Casual Leave balance for this month is ${clBalanceForMonth} day(s). You selected ${requestedDays} day(s). Please reduce the date range.`);
            return;
          }
        }
      }

      let response;
      const contactNum = formData.contactNumber || selectedEmployee.phone_number || '';

      if (applyType === 'leave') {
        response = await api.applyLeave({
          empNo: selectedEmployee.emp_no, // Use emp_no as primary identifier
          leaveType: formData.leaveType,
          fromDate: formData.fromDate,
          toDate: formData.toDate,
          purpose: formData.purpose,
          contactNumber: contactNum,
          isHalfDay: formData.isHalfDay,
          halfDayType: formData.isHalfDay ? formData.halfDayType : null,
          remarks: formData.remarks,
        });
      } else {
        response = await api.applyOD({
          empNo: selectedEmployee.emp_no, // Use emp_no as primary identifier
          odType: formData.odType,
          odType_extended: formData.odType_extended,
          odStartTime: formData.odType_extended === 'hours' ? formData.odStartTime : null,
          odEndTime: formData.odType_extended === 'hours' ? formData.odEndTime : null,
          fromDate: formData.fromDate,
          toDate: formData.toDate,
          purpose: formData.purpose,
          placeVisited: formData.placeVisited,
          contactNumber: contactNum,
          isHalfDay: formData.isHalfDay,
          halfDayType: formData.isHalfDay ? formData.halfDayType : null,
          remarks: formData.remarks,
          isAssigned: true, // Mark as assigned by admin
          photoEvidence: uploadedEvidence,
          geoLocation: geoData,
        });
      }

      if (response.success) {
        const empName = getEmployeeName(selectedEmployee);
        // Show warnings if any (non-approved conflicts)
        if (response.warnings && response.warnings.length > 0) {
          response.warnings.forEach((warning: string) => {
            toast.warning(warning);
          });
        }
        Swal.fire({
          icon: 'success',
          title: 'Success!',
          text: `${applyType === 'leave' ? 'Leave' : 'OD'} applied successfully for ${empName}`,
          timer: 2000,
          showConfirmButton: false,
        });
        setShowApplyDialog(false);
        resetForm();
        loadData();
      } else {
        toast.error(response.error || 'Failed to apply');
        // Show warnings even on error (for non-approved conflicts)
        if (response.warnings && response.warnings.length > 0) {
          response.warnings.forEach((warning: string) => {
            toast.warning(warning);
          });
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to apply');
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
        if (activeTab === 'pending') loadPendingData(pendingLeavesPage, pendingODsPage);
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
    setLocationData(null);
  };

  const handleSelectEmployee = (employee: Employee) => {
    setSelectedEmployee(employee);
    setEmployeeSearch('');
    setShowEmployeeDropdown(false);
    // Pre-fill contact number if available
    const phone = employee.phone_number || employee.phone_number;
    if (phone) {
      setFormData(prev => ({ ...prev, contactNumber: phone }));
    }
    // Reset approved records info when employee changes
    setApprovedRecordsInfo(null);
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

  const isCLSelected = applyType === 'leave' && (formData.leaveType === 'CL' || formData.leaveType?.toUpperCase() === 'CL');
  const targetEmployeeId = selectedEmployee?._id;
  const hasValidEmployeeId = targetEmployeeId && String(targetEmployeeId).length === 24 && !String(targetEmployeeId).startsWith('current');

  useEffect(() => {
    if (!isCLSelected || !formData.fromDate || !hasValidEmployeeId || !targetEmployeeId) {
      setClBalanceForMonth(null);
      return;
    }
    const from = parseDateOnly(formData.fromDate);
    const month = from.getMonth() + 1;
    const year = from.getFullYear();
    let cancelled = false;
    setClBalanceLoading(true);
    setClBalanceForMonth(null);
    api.getLeaveRegister({ employeeId: String(targetEmployeeId), month, year })
      .then((res: any) => {
        if (cancelled) return;
        const data = res?.data;
        if (Array.isArray(data) && data.length > 0 && data[0].casualLeave) {
          const balance = Number(data[0].casualLeave.balance);
          setClBalanceForMonth(Number.isFinite(balance) ? balance : 0);
        } else {
          setClBalanceForMonth(0);
        }
      })
      .catch(() => { if (!cancelled) setClBalanceForMonth(null); })
      .finally(() => { if (!cancelled) setClBalanceLoading(false); });
    return () => { cancelled = true; };
  }, [isCLSelected, formData.fromDate, hasValidEmployeeId, targetEmployeeId]);

  useEffect(() => {
    if (!isCLSelected || formData.isHalfDay || clBalanceForMonth == null || !formData.fromDate || !formData.toDate) return;
    const requested = getRequestedDays(formData.fromDate, formData.toDate, false);
    if (requested <= clBalanceForMonth) return;
    const d = new Date(formData.fromDate);
    d.setDate(d.getDate() + Math.max(0, Math.floor(clBalanceForMonth) - 1));
    const maxTo = d.toISOString().split('T')[0];
    setFormData(prev => (prev.toDate <= maxTo ? prev : { ...prev, toDate: maxTo }));
  }, [isCLSelected, formData.isHalfDay, formData.fromDate, formData.toDate, clBalanceForMonth]);

  const openApplyDialog = (type: 'leave' | 'od') => {
    setApplyType(type);

    // Reset form first
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

    // Auto-select if only one type available
    if (type === 'leave' && leaveTypes.length === 1) {
      setFormData(prev => ({ ...prev, leaveType: leaveTypes[0].code }));
    } else if (type === 'od' && odTypes.length === 1) {
      setFormData(prev => ({ ...prev, odType: odTypes[0].code }));
    }

    setShowApplyDialog(true);
  };

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editFormData, setEditFormData] = useState<any>({});
  const [canRevoke, setCanRevoke] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    const user = auth.getUser();
    setIsSuperAdmin(user?.role === 'super_admin');
  }, []);

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

      let enrichedItem: LeaveApplication | ODApplication = item;
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

      // Check if revocation is possible: only by the approver of the last step, within 3 hours
      const wf = (enrichedItem as any).workflow;
      const chain = wf?.approvalChain || [];
      const approvedSteps = chain.filter((s: any) => s.status === 'approved');
      const lastApproved = approvedSteps[approvedSteps.length - 1];
      const userId = (auth.getUser() as any)?._id;
      if (lastApproved && userId) {
        const approverId = (lastApproved.actionBy?._id || lastApproved.actionBy)?.toString?.() || String(lastApproved.actionBy);
        const approvedAt = lastApproved.updatedAt || (enrichedItem as any).approvals?.[lastApproved.role || lastApproved.stepRole]?.approvedAt;
        const hoursSince = approvedAt ? (Date.now() - new Date(approvedAt).getTime()) / (1000 * 60 * 60) : 999;
        setCanRevoke(approverId === userId && hoursSince <= 3);
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

  const totalPending = pendingLeavesTotal + pendingODsTotal;

  const applyFilters = (item: LeaveApplication | ODApplication) => {
    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      const empName = item.employeeId?.employee_name || item.employeeId?.first_name || '';
      const empNo = item.emp_no || item.employeeId?.emp_no || '';
      if (!empName.toLowerCase().includes(lowerSearch) && !empNo.toLowerCase().includes(lowerSearch)) {
        return false;
      }
    }

    const emp = item.employeeId as any;
    if (selectedDivisionFilter) {
      const divId = typeof emp?.division === 'object' ? emp?.division?._id : (emp?.division_id || emp?.division);
      if (String(divId) !== String(selectedDivisionFilter)) return false;
    }
    if (selectedDepartmentFilter) {
      const deptId = typeof emp?.department === 'object' ? emp?.department?._id : (emp?.department_id || emp?.department);
      if (String(deptId) !== String(selectedDepartmentFilter)) return false;
    }
    if (selectedDesignationFilter) {
      const desigId = typeof emp?.designation === 'object' ? emp?.designation?._id : (emp?.designation_id || emp?.designation);
      if (String(desigId) !== String(selectedDesignationFilter)) return false;
    }

    return true;
  };

  const getRoleOrderFromItem = (item: LeaveApplication | ODApplication): string[] => {
    const chain = (item as any).workflow?.approvalChain;
    if (!chain || !Array.isArray(chain) || chain.length === 0) return [];
    const sorted = chain.slice().sort((a: any, b: any) => (a.stepOrder ?? 999) - (b.stepOrder ?? 999));
    return sorted.map((s: any) => String(s.role || s.stepRole || '').toLowerCase()).filter(Boolean);
  };

  const canPerformAction = (item: LeaveApplication | ODApplication, source?: 'leave' | 'od') => {
    const user = auth.getUser() as any;
    if (!user || user.role === 'employee') return false;
    if (['super_admin', 'sub_admin'].includes(user.role)) return !['approved', 'rejected', 'cancelled'].includes(item.status);
    const isOD = source === 'od' || ((item as any).odType !== undefined);
    const allowHigher = isOD ? odWorkflowAllowHigherAuthority : leaveWorkflowAllowHigherAuthority;
    const itemRoleOrder = getRoleOrderFromItem(item);
    const globalRoleOrder = isOD ? odWorkflowRoleOrder : leaveWorkflowRoleOrder;
    const roleOrder = itemRoleOrder.length > 0 ? itemRoleOrder : globalRoleOrder;
    const next = String((item as any).workflow?.nextApproverRole || (item as any).workflow?.nextApprover || '').toLowerCase();
    const role = String(user.role || '').toLowerCase();
    if (!next) return false;
    if (role === next || (next === 'final_authority' && role === 'hr') || (next === 'reporting_manager' && ['manager', 'hod'].includes(role))) return true;
    if (allowHigher && roleOrder.length > 0) {
      const nextIdx = roleOrder.indexOf(next);
      let userIdx = roleOrder.indexOf(role);
      if (userIdx === -1 && (role === 'hr' || role === 'super_admin')) userIdx = roleOrder.length;
      if (userIdx === -1 && role === 'manager') {
        const reportingIdx = roleOrder.indexOf('reporting_manager');
        const hrIdx = roleOrder.indexOf('hr');
        userIdx = reportingIdx >= 0 ? reportingIdx : (hrIdx >= 0 ? hrIdx : roleOrder.length);
      }
      if (nextIdx >= 0 && userIdx >= 0 && userIdx >= nextIdx) return true;
    }
    return false;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="max-w-[1920px] mx-auto">
      {/* Header */}
      <div className="mb-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Leave & OD Management</h1>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Manage leave applications and on-duty requests
            </p>
          </div>
          <button
            onClick={() => openApplyDialog('leave')}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-green-500 to-green-600 text-white text-xs font-semibold shadow-sm hover:shadow-md transition-all"
          >
            <PlusIcon />
            Apply Leave / OD
          </button>
        </div>
      </div>

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

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
              <CalendarIcon />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">{leaves.length}</div>
              <div className="text-sm text-slate-500">Total Leaves</div>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center">
              <BriefcaseIcon />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">{ods.length}</div>
              <div className="text-sm text-slate-500">Total ODs</div>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-yellow-100 flex items-center justify-center">
              <ClockIcon />
            </div>
            <div>
              <div className="text-2xl font-bold text-yellow-600">{totalPending}</div>
              <div className="text-sm text-slate-500">Pending Approvals</div>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center">
              <CheckIcon />
            </div>
            <div>
              <div className="text-2xl font-bold text-green-600">
                {leaves.filter(l => l.status === 'approved').length + ods.filter(o => o.status === 'approved').length}
              </div>
              <div className="text-sm text-slate-500">Approved</div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6">
        <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700">
          <button
            onClick={() => setActiveTab('leaves')}
            className={`px-4 py-2.5 font-medium text-sm transition-all border-b-2 -mb-px ${activeTab === 'leaves'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
          >
            <span className="flex items-center gap-2">
              <CalendarIcon />
              Leaves ({leaves.length})
            </span>
          </button>
          <button
            onClick={() => setActiveTab('od')}
            className={`px-4 py-2.5 font-medium text-sm transition-all border-b-2 -mb-px ${activeTab === 'od'
              ? 'border-purple-500 text-purple-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
          >
            <span className="flex items-center gap-2">
              <BriefcaseIcon />
              On Duty ({ods.length})
            </span>
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-4 py-2.5 font-medium text-sm transition-all border-b-2 -mb-px ${activeTab === 'pending'
              ? 'border-yellow-500 text-yellow-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
          >
            <span className="flex items-center gap-2">
              <ClockIcon />
              Pending Approvals ({totalPending})
            </span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-4 items-center">
        <select
          value={selectedDivisionFilter}
          onChange={(e) => {
            setSelectedDivisionFilter(e.target.value);
            setSelectedDepartmentFilter('');
          }}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        >
          <option value="">All Divisions</option>
          {divisions.map((div) => (
            <option key={div._id} value={div._id}>{div.name}</option>
          ))}
        </select>

        <select
          value={selectedDepartmentFilter}
          onChange={(e) => setSelectedDepartmentFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        >
          <option value="">All Departments</option>
          {filteredDepartments.map((dept) => (
            <option key={dept._id} value={dept._id}>{dept.name}</option>
          ))}
        </select>

        <select
          value={selectedDesignationFilter}
          onChange={(e) => setSelectedDesignationFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        >
          <option value="">All Designations</option>
          {designations.map((desig) => (
            <option key={desig._id} value={desig._id}>{desig.name}</option>
          ))}
        </select>

        <div className="relative flex-grow max-w-sm">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <SearchIcon />
          </div>
          <input
            type="text"
            placeholder="Search employees..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="block w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
        </div>
      </div>

      {/* Content */}
      <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 overflow-hidden">
        {activeTab === 'leaves' && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-900">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Employee</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Duration</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Days</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Applied By</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {leaves.filter(applyFilters).map((leave) => (
                  <tr
                    key={leave._id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors"
                    onClick={() => openDetailDialog(leave, 'leave')}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-white">
                        {leave.employeeId?.employee_name || `${leave.employeeId?.first_name || ''} ${leave.employeeId?.last_name || ''}`.trim() || leave.emp_no}
                      </div>
                      <div className="text-xs text-slate-500">{leave.employeeId?.emp_no || leave.emp_no}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300 capitalize">
                      {leave.leaveType?.replace('_', ' ') || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {formatDate(leave.fromDate)} - {formatDate(leave.toDate)}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900 dark:text-white">
                      {leave.numberOfDays}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-1 text-xs font-medium rounded-lg capitalize ${getStatusColor(leave.status)}`}>
                        {leave.status?.replace('_', ' ') || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {leave.appliedBy?.name || 'Self'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      {formatDate(leave.appliedAt)}
                    </td>
                  </tr>
                ))}
                {leaves.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      No leave applications found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'od' && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-900">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Employee</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Place</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Duration</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Applied By</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {ods.filter(applyFilters).map((od) => (
                  <tr
                    key={od._id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors"
                    onClick={() => openDetailDialog(od, 'od')}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-white">
                        {od.employeeId?.employee_name || `${od.employeeId?.first_name || ''} ${od.employeeId?.last_name || ''}`.trim() || od.emp_no}
                      </div>
                      <div className="text-xs text-slate-500">{od.employeeId?.emp_no || od.emp_no}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300 capitalize">
                      {od.odType?.replace('_', ' ') || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300 max-w-[200px] truncate">
                      {od.placeVisited || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {formatDate(od.fromDate)} - {formatDate(od.toDate)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-1 text-xs font-medium rounded-lg capitalize ${getStatusColor(od.status)}`}>
                        {od.status?.replace('_', ' ') || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {od.assignedBy?.name || od.appliedBy?.name || 'Self'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      {formatDate(od.appliedAt)}
                    </td>
                  </tr>
                ))}
                {ods.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      No OD applications found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'pending' && (
          <div className="p-4 space-y-6">
            {loadingPending && (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            )}

            {/* Pending Leaves */}
            <div>
              <h3 className="inline-flex items-center gap-2 rounded-xl bg-blue-500/15 px-4 py-2.5 text-sm font-black uppercase tracking-wider text-blue-700 dark:bg-blue-400/20 dark:text-blue-300 mb-3 border border-blue-200/60 dark:border-blue-500/30">
                <CalendarIcon />
                Pending Leaves ({pendingLeavesTotal})
              </h3>

              {/* Desktop: Table */}
              <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Employee</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Type</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Dates</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Days</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Status</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {!loadingPending && pendingLeaves.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No pending leaves</td></tr>
                    )}
                    {pendingLeaves.map((leave) => (
                      <tr key={leave._id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900 dark:text-white">{getEmployeeName({ employee_name: leave.employeeId?.employee_name ?? '', first_name: leave.employeeId?.first_name, last_name: leave.employeeId?.last_name, emp_no: leave.employeeId?.emp_no ?? leave.emp_no ?? '' } as Employee)}</div>
                          <div className="text-xs text-slate-500">{leave.employeeId?.emp_no ?? leave.emp_no}</div>
                        </td>
                        <td className="px-4 py-3">{leave.leaveType}</td>
                        <td className="px-4 py-3">{formatDate(leave.fromDate)} – {formatDate(leave.toDate)}</td>
                        <td className="px-4 py-3">{leave.numberOfDays}</td>
                        <td className="px-4 py-3"><span className={`px-2 py-0.5 text-xs font-medium rounded ${getStatusColor(leave.status)}`}>{leave.status.replace('_', ' ')}</span></td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => handleAction(leave._id, 'leave', 'approve')} className="px-2 py-1 text-xs font-medium text-green-700 bg-green-100 rounded hover:bg-green-200 mr-1">Approve</button>
                          <button onClick={() => handleAction(leave._id, 'leave', 'reject')} className="px-2 py-1 text-xs font-medium text-red-700 bg-red-100 rounded hover:bg-red-200">Reject</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pendingLeavesTotal > pendingLimit && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50">
                    <span className="text-xs text-slate-600 dark:text-slate-400">Page {pendingLeavesPage} of {Math.ceil(pendingLeavesTotal / pendingLimit) || 1}</span>
                    <div className="flex gap-2">
                      <button disabled={pendingLeavesPage <= 1} onClick={() => { const prev = pendingLeavesPage - 1; setPendingLeavesPage(prev); loadPendingData(prev, pendingODsPage); }} className="px-3 py-1 text-xs font-medium rounded border border-slate-300 dark:border-slate-600 disabled:opacity-50">Prev</button>
                      <button disabled={pendingLeavesPage >= Math.ceil(pendingLeavesTotal / pendingLimit)} onClick={() => { const next = pendingLeavesPage + 1; setPendingLeavesPage(next); loadPendingData(next, pendingODsPage); }} className="px-3 py-1 text-xs font-medium rounded border border-slate-300 dark:border-slate-600 disabled:opacity-50">Next</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Mobile: Cards */}
              <div className="md:hidden space-y-3">
                {!loadingPending && pendingLeaves.length === 0 && <div className="text-center py-6 text-slate-500 text-sm">No pending leaves</div>}
                {pendingLeaves.map((leave) => (
                  <div key={leave._id} className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-900/50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-900 dark:text-white">{getEmployeeName({ employee_name: leave.employeeId?.employee_name ?? '', first_name: leave.employeeId?.first_name, last_name: leave.employeeId?.last_name, emp_no: leave.employeeId?.emp_no ?? leave.emp_no ?? '' } as Employee)}</div>
                        <div className="text-xs text-slate-500">({leave.employeeId?.emp_no ?? leave.emp_no}) · {leave.leaveType} · {leave.numberOfDays}d</div>
                        <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">{formatDate(leave.fromDate)} – {formatDate(leave.toDate)}</div>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <button onClick={() => handleAction(leave._id, 'leave', 'approve')} className="px-2 py-1 text-xs font-medium text-green-700 bg-green-100 rounded">Approve</button>
                        <button onClick={() => handleAction(leave._id, 'leave', 'reject')} className="px-2 py-1 text-xs font-medium text-red-700 bg-red-100 rounded">Reject</button>
                      </div>
                    </div>
                  </div>
                ))}
                {pendingLeavesTotal > pendingLimit && (
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-slate-500">Page {pendingLeavesPage} of {Math.ceil(pendingLeavesTotal / pendingLimit) || 1}</span>
                    <div className="flex gap-2">
                      <button disabled={pendingLeavesPage <= 1} onClick={() => { const prev = pendingLeavesPage - 1; setPendingLeavesPage(prev); loadPendingData(prev, pendingODsPage); }} className="px-2 py-1 text-xs rounded border border-slate-300 disabled:opacity-50">Prev</button>
                      <button disabled={pendingLeavesPage >= Math.ceil(pendingLeavesTotal / pendingLimit)} onClick={() => { const next = pendingLeavesPage + 1; setPendingLeavesPage(next); loadPendingData(next, pendingODsPage); }} className="px-2 py-1 text-xs rounded border border-slate-300 disabled:opacity-50">Next</button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Pending ODs */}
            <div>
              <h3 className="inline-flex items-center gap-2 rounded-xl bg-purple-500/15 px-4 py-2.5 text-sm font-black uppercase tracking-wider text-purple-700 dark:bg-purple-400/20 dark:text-purple-300 mb-3 border border-purple-200/60 dark:border-purple-500/30">
                <BriefcaseIcon />
                Pending ODs ({pendingODsTotal})
              </h3>

              {/* Desktop: Table */}
              <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Employee</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Type</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Place</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Dates</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Days</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {!loadingPending && pendingODs.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No pending ODs</td></tr>
                    )}
                    {pendingODs.map((od) => (
                      <tr key={od._id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900 dark:text-white">{getEmployeeName({ employee_name: od.employeeId?.employee_name ?? '', first_name: od.employeeId?.first_name, last_name: od.employeeId?.last_name, emp_no: od.employeeId?.emp_no ?? od.emp_no ?? '' } as Employee)}</div>
                          <div className="text-xs text-slate-500">{od.employeeId?.emp_no ?? od.emp_no}</div>
                        </td>
                        <td className="px-4 py-3">{od.odType}</td>
                        <td className="px-4 py-3 max-w-[120px] truncate" title={od.placeVisited}>{od.placeVisited || '–'}</td>
                        <td className="px-4 py-3">{formatDate(od.fromDate)} – {formatDate(od.toDate)}</td>
                        <td className="px-4 py-3">{od.numberOfDays}</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => handleAction(od._id, 'od', 'approve')} className="px-2 py-1 text-xs font-medium text-green-700 bg-green-100 rounded hover:bg-green-200 mr-1">Approve</button>
                          <button onClick={() => handleAction(od._id, 'od', 'reject')} className="px-2 py-1 text-xs font-medium text-red-700 bg-red-100 rounded hover:bg-red-200">Reject</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pendingODsTotal > pendingLimit && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50">
                    <span className="text-xs text-slate-600 dark:text-slate-400">Page {pendingODsPage} of {Math.ceil(pendingODsTotal / pendingLimit) || 1}</span>
                    <div className="flex gap-2">
                      <button disabled={pendingODsPage <= 1} onClick={() => { const prev = pendingODsPage - 1; setPendingODsPage(prev); loadPendingData(pendingLeavesPage, prev); }} className="px-3 py-1 text-xs font-medium rounded border border-slate-300 dark:border-slate-600 disabled:opacity-50">Prev</button>
                      <button disabled={pendingODsPage >= Math.ceil(pendingODsTotal / pendingLimit)} onClick={() => { const next = pendingODsPage + 1; setPendingODsPage(next); loadPendingData(pendingLeavesPage, next); }} className="px-3 py-1 text-xs font-medium rounded border border-slate-300 dark:border-slate-600 disabled:opacity-50">Next</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Mobile: Cards */}
              <div className="md:hidden space-y-3">
                {!loadingPending && pendingODs.length === 0 && <div className="text-center py-6 text-slate-500 text-sm">No pending ODs</div>}
                {pendingODs.map((od) => (
                  <div key={od._id} className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-900/50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-900 dark:text-white">{getEmployeeName({ employee_name: od.employeeId?.employee_name ?? '', first_name: od.employeeId?.first_name, last_name: od.employeeId?.last_name, emp_no: od.employeeId?.emp_no ?? od.emp_no ?? '' } as Employee)}</div>
                        <div className="text-xs text-slate-500">({od.employeeId?.emp_no ?? od.emp_no}) · {od.odType} · {od.numberOfDays}d</div>
                        <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">{formatDate(od.fromDate)} – {formatDate(od.toDate)}</div>
                        {od.placeVisited && <div className="text-xs text-slate-500 mt-0.5 truncate">{od.placeVisited}</div>}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <button onClick={() => handleAction(od._id, 'od', 'approve')} className="px-2 py-1 text-xs font-medium text-green-700 bg-green-100 rounded">Approve</button>
                        <button onClick={() => handleAction(od._id, 'od', 'reject')} className="px-2 py-1 text-xs font-medium text-red-700 bg-red-100 rounded">Reject</button>
                      </div>
                    </div>
                  </div>
                ))}
                {pendingODsTotal > pendingLimit && (
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-slate-500">Page {pendingODsPage} of {Math.ceil(pendingODsTotal / pendingLimit) || 1}</span>
                    <div className="flex gap-2">
                      <button disabled={pendingODsPage <= 1} onClick={() => { const prev = pendingODsPage - 1; setPendingODsPage(prev); loadPendingData(pendingLeavesPage, prev); }} className="px-2 py-1 text-xs rounded border border-slate-300 disabled:opacity-50">Prev</button>
                      <button disabled={pendingODsPage >= Math.ceil(pendingODsTotal / pendingLimit)} onClick={() => { const next = pendingODsPage + 1; setPendingODsPage(next); loadPendingData(pendingLeavesPage, next); }} className="px-2 py-1 text-xs rounded border border-slate-300 disabled:opacity-50">Next</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}


      </div>

      {/* Apply Leave/OD Dialog */}
      {showApplyDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowApplyDialog(false)} />
          <div className="relative z-50 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            {/* Type Toggle */}
            <div className="flex gap-2 mb-6">
              <button
                onClick={() => setApplyType('leave')}
                className={`flex-1 py-3 rounded-xl font-medium text-sm transition-all ${applyType === 'leave'
                  ? 'bg-blue-500 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                  }`}
              >
                <span className="flex items-center justify-center gap-2">
                  <CalendarIcon />
                  Leave
                </span>
              </button>
              <button
                onClick={() => setApplyType('od')}
                className={`flex-1 py-3 rounded-xl font-medium text-sm transition-all ${applyType === 'od'
                  ? 'bg-purple-500 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                  }`}
              >
                <span className="flex items-center justify-center gap-2">
                  <BriefcaseIcon />
                  On Duty
                </span>
              </button>
            </div>

            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-6">
              Apply for {applyType === 'leave' ? 'Leave' : 'On Duty'}
            </h2>

            <form onSubmit={handleApply} className="space-y-4">
              {/* Apply For - Employee Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
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

              {/* Type Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  {applyType === 'leave' ? 'Leave Type' : 'OD Type'} *
                </label>
                {/* Show as non-editable text if only one type exists */}
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
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">Select {applyType === 'leave' ? 'leave' : 'OD'} type</option>
                    {(applyType === 'leave' ? leaveTypes : odTypes).map((type) => (
                      <option key={type.code} value={type.code}>{type.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* CL balance for month – show when Casual Leave selected */}
              {isCLSelected && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
                  {!formData.fromDate || !selectedEmployee ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">Select employee and from date to see CL balance for that month.</p>
                  ) : clBalanceLoading ? (
                    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading CL balance...
                    </div>
                  ) : clBalanceForMonth !== null ? (
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      <span className="text-green-600 dark:text-green-400">CL balance for this month: {clBalanceForMonth} day{clBalanceForMonth !== 1 ? 's' : ''}.</span>
                      {' '}You can apply for up to <strong>{clBalanceForMonth}</strong> day{clBalanceForMonth !== 1 ? 's' : ''} only.
                    </p>
                  ) : (
                    <p className="text-sm text-amber-600 dark:text-amber-400">Could not load CL balance. You must have a valid balance to apply for CL; try again or select employee/from date again.</p>
                  )}
                </div>
              )}

              {/* OD Type Extended - Full Day / Half Day / Hours Selector */}
              {applyType === 'od' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Duration Type</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, odType_extended: 'full_day', isHalfDay: false })}
                      className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-medium transition-all ${formData.odType_extended === 'full_day'
                        ? 'bg-purple-500 text-white shadow-md'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'
                        }`}
                    >
                      Full Day
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, odType_extended: 'half_day', isHalfDay: true, halfDayType: formData.halfDayType || 'first_half', odStartTime: null, odEndTime: null, toDate: formData.fromDate })}
                      className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-medium transition-all ${formData.odType_extended === 'half_day'
                        ? 'bg-purple-500 text-white shadow-md'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'
                        }`}
                    >
                      Half Day
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, odType_extended: 'hours', isHalfDay: false, halfDayType: null, toDate: formData.fromDate })}
                      className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-medium transition-all ${formData.odType_extended === 'hours'
                        ? 'bg-fuchsia-500 text-white shadow-md'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'
                        }`}
                    >
                      Specific Hours
                    </button>
                  </div>
                </div>
              )}

              {/* Hour-Based OD - Time Pickers */}
              {applyType === 'od' && formData.odType_extended === 'hours' && (
                <div className="space-y-4 p-4 rounded-lg bg-fuchsia-50 dark:bg-fuchsia-900/20 border border-fuchsia-200 dark:border-fuchsia-800">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Start Time (HH:MM) *</label>
                      <input
                        type="time"
                        value={formData.odStartTime || ''}
                        onChange={(e) => setFormData({ ...formData, odStartTime: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        placeholder="HH:MM"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">End Time (HH:MM) *</label>
                      <input
                        type="time"
                        value={formData.odEndTime || ''}
                        onChange={(e) => setFormData({ ...formData, odEndTime: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        placeholder="HH:MM"
                      />
                    </div>
                  </div>
                  {formData.odStartTime && formData.odEndTime && (
                    <div className="p-3 rounded-lg bg-white dark:bg-slate-800 border border-fuchsia-200 dark:border-fuchsia-700">
                      {(() => {
                        const [startH, startM] = formData.odStartTime.split(':').map(Number);
                        const [endH, endM] = formData.odEndTime.split(':').map(Number);
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

              {/* Half Day Selector - Show when half day is selected */}
              {applyType === 'od' && formData.odType_extended === 'half_day' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Half Day Type *</label>
                  <select
                    value={formData.halfDayType || ''}
                    onChange={(e) => setFormData({ ...formData, halfDayType: e.target.value as 'first_half' | 'second_half' | null || null })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="first_half">First Half (Morning)</option>
                    <option value="second_half">Second Half (Afternoon)</option>
                  </select>
                </div>
              )}
              {/* Date Selection Logic */}
              {(() => {
                const policy = applyType === 'od' ? odPolicy : leavePolicy;
                const todayStr = new Date().toISOString().split('T')[0];
                const minDate = policy.allowBackdated && policy.maxBackdatedDays > 0
                  ? new Date(Date.now() - policy.maxBackdatedDays * 86400000).toISOString().split('T')[0]
                  : todayStr;
                const maxDate = policy.allowFutureDated && policy.maxAdvanceDays > 0
                  ? new Date(Date.now() + policy.maxAdvanceDays * 86400000).toISOString().split('T')[0]
                  : undefined;
                const hint = policy.allowBackdated && policy.maxBackdatedDays > 0
                  ? `Backdating allowed up to ${policy.maxBackdatedDays} day(s)`
                  : policy.allowFutureDated && policy.maxAdvanceDays > 0
                    ? `Up to ${policy.maxAdvanceDays} day(s) in advance`
                    : null;
                return (
                  <>
                    {((applyType === 'leave' && formData.isHalfDay) || applyType === 'od') ? (
                      /* Single Date Input for Half Day / Specific Hours / Any OD */
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Date *</label>
                        <input
                          type="date"
                          min={minDate}
                          max={maxDate}
                          value={formData.fromDate}
                          onChange={(e) => setFormData({ ...formData, fromDate: e.target.value, toDate: e.target.value })}
                          required
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                        {hint && <p className="mt-1 text-xs text-indigo-500 dark:text-indigo-400">{hint}</p>}
                      </div>
                    ) : (
                      /* Two Date Inputs for Full Day */
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">From Date *</label>
                          <input
                            type="date"
                            min={minDate}
                            max={maxDate}
                            value={formData.fromDate}
                            onChange={(e) => setFormData({ ...formData, fromDate: e.target.value })}
                            required
                            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">To Date *</label>
                          <input
                            type="date"
                            min={formData.fromDate || minDate}
                            max={maxDate}
                            value={formData.toDate}
                            onChange={(e) => setFormData({ ...formData, toDate: e.target.value })}
                            required
                            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                          />
                        </div>
                        {hint && <p className="col-span-2 text-xs text-indigo-500 dark:text-indigo-400">{hint}</p>}
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Approved Records Info */}
              {approvedRecordsInfo && (approvedRecordsInfo.hasLeave || approvedRecordsInfo.hasOD) && (
                <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-2">
                    ⚠️ Approved Record Found on This Date:
                  </p>
                  {approvedRecordsInfo.hasLeave && approvedRecordsInfo.leaveInfo && (
                    <div className="text-xs text-amber-700 dark:text-amber-400 mb-1">
                      <strong>Leave:</strong> {approvedRecordsInfo.leaveInfo.isHalfDay
                        ? `${approvedRecordsInfo.leaveInfo.halfDayType === 'first_half' ? 'First Half' : 'Second Half'} Leave`
                        : 'Full Day Leave'}
                    </div>
                  )}
                  {approvedRecordsInfo.hasOD && approvedRecordsInfo.odInfo && (
                    <div className="text-xs text-amber-700 dark:text-amber-400">
                      <strong>OD:</strong> {approvedRecordsInfo.odInfo.isHalfDay
                        ? `${approvedRecordsInfo.odInfo.halfDayType === 'first_half' ? 'First Half' : 'Second Half'} OD`
                        : 'Full Day OD'}
                    </div>
                  )}
                  {(approvedRecordsInfo.hasLeave && approvedRecordsInfo.leaveInfo?.isHalfDay) ||
                    (approvedRecordsInfo.hasOD && approvedRecordsInfo.odInfo?.isHalfDay) ? (
                    <p className="text-xs text-amber-600 dark:text-amber-500 mt-2">
                      ✓ Opposite half has been auto-selected for you
                    </p>
                  ) : (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                      ✗ Cannot create {applyType === 'leave' ? 'Leave' : 'OD'} - Full day already approved
                    </p>
                  )}
                </div>
              )}

              {/* Half Day */}
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isHalfDay}
                    onChange={(e) => {
                      if (!e.target.checked) {
                        setFormData({ ...formData, isHalfDay: false, halfDayType: null });
                      } else {
                        setFormData({ ...formData, isHalfDay: true, halfDayType: formData.halfDayType || 'first_half', toDate: formData.fromDate });
                      }
                    }}
                    disabled={
                      approvedRecordsInfo
                        ? ((approvedRecordsInfo.hasLeave && !approvedRecordsInfo.leaveInfo?.isHalfDay) ||
                          (approvedRecordsInfo.hasOD && !approvedRecordsInfo.odInfo?.isHalfDay))
                        : undefined
                    }
                    className="w-4 h-4 rounded border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300">Half Day</span>
                </label>
                {formData.isHalfDay && (
                  <select
                    value={formData.halfDayType || ''}
                    onChange={(e) => setFormData({ ...formData, halfDayType: e.target.value as 'first_half' | 'second_half' | null || null })}
                    disabled={
                      approvedRecordsInfo
                        ? ((approvedRecordsInfo.hasLeave && approvedRecordsInfo.leaveInfo?.isHalfDay &&
                          approvedRecordsInfo.leaveInfo.halfDayType === formData.halfDayType) ||
                          (approvedRecordsInfo.hasOD && approvedRecordsInfo.odInfo?.isHalfDay &&
                            approvedRecordsInfo.odInfo.halfDayType === formData.halfDayType))
                        : undefined
                    }
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="first_half">First Half</option>
                    <option value="second_half">Second Half</option>
                  </select>
                )}
              </div>

              {/* Purpose */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Purpose *</label>
                <textarea
                  value={formData.purpose}
                  onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
                  required
                  rows={3}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  placeholder={`Reason for ${applyType === 'leave' ? 'leave' : 'OD'}...`}
                />
              </div>

              {/* Place Visited (OD only) */}
              {applyType === 'od' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Place to Visit *</label>
                  <input
                    type="text"
                    value={formData.placeVisited}
                    onChange={(e) => setFormData({ ...formData, placeVisited: e.target.value })}
                    required
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    placeholder="Location/Place name"
                  />
                </div>
              )}

              {/* Contact Number */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Contact Number *</label>
                <input
                  type="tel"
                  value={formData.contactNumber}
                  onChange={(e) => setFormData({ ...formData, contactNumber: e.target.value })}
                  required
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  placeholder="Contact number during leave/OD"
                />
              </div>

              {/* Remarks */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Remarks (Optional)</label>
                <input
                  type="text"
                  value={formData.remarks}
                  onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  placeholder="Any additional remarks"
                />
              </div>

              {/* Photo Evidence (OD Only - mandatory) */}
              {applyType === 'od' && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-700/50">
                  <LocationPhotoCapture
                    required
                    label="Live Photo Evidence"
                    onCapture={(loc, photo) => {
                      setEvidenceFile(photo.file);
                      setLocationData(loc);
                      (photo.file as any).exifLocation = photo.exifLocation;
                    }}
                    onClear={() => {
                      setEvidenceFile(null);
                      setLocationData(null);
                    }}
                  />
                </div>
              )}

              {/* Buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowApplyDialog(false)}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`flex-1 px-4 py-2.5 text-sm font-semibold text-white rounded-xl ${applyType === 'leave'
                    ? 'bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600'
                    : 'bg-gradient-to-r from-purple-500 to-red-500 hover:from-purple-600 hover:to-red-600'
                    }`}
                >
                  Apply {applyType === 'leave' ? 'Leave' : 'OD'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Dialog - styled like workspace */}
      {showDetailDialog && selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => {
            setShowDetailDialog(false);
            setSelectedItem(null);
            setIsChangeHistoryExpanded(false);
          }} />
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
                    <p className="text-white/70 text-[10px] font-bold uppercase tracking-widest">Superadmin</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowDetailDialog(false);
                    setSelectedItem(null);
                    setIsChangeHistoryExpanded(false);
                  }}
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
                    {(selectedItem.employeeId?.employee_name?.[0] || selectedItem.emp_no?.[0] || 'E').toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-black text-slate-900 dark:text-white text-xl">
                      {selectedItem.employeeId?.employee_name || `${(selectedItem.employeeId as any)?.first_name || ''} ${(selectedItem.employeeId as any)?.last_name || ''}`.trim() || selectedItem.emp_no}
                    </h3>
                    <p className="text-sm text-slate-500 font-bold uppercase tracking-tight">
                      {selectedItem.employeeId?.emp_no || selectedItem.emp_no}
                    </p>
                    <div className="flex gap-2 mt-2">
                      {selectedItem.department?.name && (
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700">
                          {selectedItem.department.name}
                        </span>
                      )}
                      {selectedItem.designation?.name && (
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700">
                          {selectedItem.designation.name}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-row sm:flex-col items-center sm:items-end gap-2 w-full sm:w-auto justify-between sm:justify-start">
                  <span className={`px-4 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest border ${getStatusColor(selectedItem.status)}`}>
                    {selectedItem.status?.replace('_', ' ') || 'Unknown'}
                  </span>
                  <div className="flex items-center gap-1.5 text-slate-400 font-bold text-[10px] uppercase tracking-wider">
                    <Clock3 className="w-3.5 h-3.5" />
                    Applied {formatDate((selectedItem as any).createdAt || selectedItem.appliedAt)}
                  </div>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-50 dark:bg-slate-700/30 p-4 sm:p-6 rounded-xl">
                <div className="space-y-1">
                  <p className="text-xs uppercase font-bold text-slate-400 tracking-wider">Type</p>
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate" title={detailType === 'leave' ? (selectedItem as LeaveApplication).leaveType : (selectedItem as ODApplication).odType}>
                    {((detailType === 'leave' ? (selectedItem as LeaveApplication).leaveType : (selectedItem as ODApplication).odType) || '-').replace('_', ' ')}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs uppercase font-bold text-slate-400 tracking-wider">Duration</p>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                    {detailType === 'od' && (selectedItem as any).odType_extended === 'hours'
                      ? (() => {
                          const odItem = selectedItem as any;
                          const start = odItem.odStartTime || odItem.od_start_time || '';
                          const end = odItem.odEndTime || odItem.od_end_time || '';
                          if (start && end && typeof start === 'string' && typeof end === 'string') {
                            try {
                              const [sh, sm] = start.split(':').map(Number);
                              const [eh, em] = end.split(':').map(Number);
                              const sMin = sh * 60 + sm;
                              const eMin = eh * 60 + em;
                              if (!isNaN(sMin) && !isNaN(eMin) && eMin > sMin) {
                                const durationMin = eMin - sMin;
                                const hours = Math.floor(durationMin / 60);
                                const mins = durationMin % 60;
                                return `${hours}h ${mins}m`;
                              }
                            } catch (_) {}
                          }
                          return `${selectedItem.numberOfDays}d`;
                        })()
                      : `${selectedItem.numberOfDays}d${selectedItem.isHalfDay ? ` (${(selectedItem.halfDayType || 'first half').replace('_', ' ')})` : ''}`}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs uppercase font-bold text-slate-400 tracking-wider">From</p>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{formatDate(selectedItem.fromDate)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs uppercase font-bold text-slate-400 tracking-wider">To</p>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{formatDate(selectedItem.toDate)}</p>
                </div>
              </div>

              {/* Details Content */}
              <div className="space-y-6">
                <div className="bg-slate-50 dark:bg-slate-900/50 p-4 sm:p-6 rounded-xl">
                  <p className="text-xs uppercase font-bold text-slate-400 mb-2 tracking-wider">Purpose / Reason</p>
                  <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                    {selectedItem.purpose || 'No purpose specified'}
                  </p>
                </div>
                {detailType === 'od' && (selectedItem as ODApplication).placeVisited && (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-sm text-slate-700 dark:text-slate-300 px-2 mt-2">
                    <span className="font-bold text-xs uppercase text-slate-400 tracking-wider sm:min-w-20">Location:</span>
                    <span className="font-medium break-words">{(selectedItem as ODApplication).placeVisited}</span>
                  </div>
                )}
                {selectedItem.contactNumber && (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-sm text-slate-700 dark:text-slate-300 px-2 mt-2">
                    <span className="font-bold text-xs uppercase text-slate-400 tracking-wider sm:min-w-20">Contact:</span>
                    <span className="font-medium text-slate-900 dark:text-white break-all">{selectedItem.contactNumber}</span>
                  </div>
                )}
              </div>

              {/* Photo Evidence & Location */}
              {detailType === 'od' && ((selectedItem as any).photoEvidence || (selectedItem as any).geoLocation) && (
                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-4 sm:p-5 border border-slate-200 dark:border-slate-700">
                  <p className="text-xs uppercase font-bold text-slate-400 mb-3 tracking-wider">Evidence & Location</p>
                  <div className="space-y-4">
                    {/* Photo */}
                    {(selectedItem as any).photoEvidence && (
                      <div className="flex items-start gap-4">
                        <a
                          href={(selectedItem as any).photoEvidence.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="relative group block shrink-0"
                        >
                          <img
                            src={(selectedItem as any).photoEvidence.url}
                            alt="Evidence"
                            className="w-24 h-24 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shadow-sm transition-transform group-hover:scale-105"
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors rounded-lg">
                            <svg className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                          </div>
                        </a>
                        <div>
                          <p className="text-sm font-medium text-slate-900 dark:text-white">Photo Evidence</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Uploaded at application time</p>
                        </div>
                      </div>
                    )}

                    {(selectedItem as any).geoLocation && (
                      <div className="p-3 rounded-lg bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
                        <div className="flex items-center gap-2 mb-2">
                          <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Location</span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                          <div>
                            <span className="text-slate-500">Lat:</span>
                            <span className="ml-1 font-mono text-slate-700 dark:text-slate-300">{(selectedItem as any).geoLocation.latitude?.toFixed(6)}</span>
                          </div>
                          <div>
                            <span className="text-slate-500">Lon:</span>
                            <span className="ml-1 font-mono text-slate-700 dark:text-slate-300">{(selectedItem as any).geoLocation.longitude?.toFixed(6)}</span>
                          </div>
                          {(selectedItem as any).geoLocation.address && (
                            <div className="col-span-2 pt-2 border-t border-slate-100 dark:border-slate-700 mt-1">
                              <span className="block text-slate-500 mb-0.5">Address</span>
                              <p className="text-slate-700 dark:text-slate-300 leading-tight text-xs">{(selectedItem as any).geoLocation.address}</p>
                            </div>
                          )}
                          <div className="col-span-2 mt-1">
                            <a
                              href={`https://www.google.com/maps?q=${(selectedItem as any).geoLocation.latitude},${(selectedItem as any).geoLocation.longitude}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 font-medium text-xs"
                            >
                              View on Google Maps
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                            </a>
                          </div>
                        </div>
                      </div>
                    )}
                    {(() => {
                      const geo = (selectedItem as any).geoLocation;
                      const exif = (selectedItem as any).photoEvidence?.exifLocation;
                      const lat = geo?.latitude ?? exif?.latitude;
                      const lng = geo?.longitude ?? exif?.longitude;
                      const address = geo?.address ?? null;
                      if (lat == null || lng == null) return null;
                      return (
                        <div className="mt-2">
                          <span className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Map</span>
                          <LocationMap latitude={lat} longitude={lng} address={address} height="180px" />
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Split Breakdown (read-only) */}
              {detailType === 'leave' && (selectedItem as LeaveApplication)?.splits && (selectedItem as LeaveApplication).splits!.length > 0 && (
                <div className="bg-slate-50 dark:bg-slate-900/50 p-4 sm:p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                  <p className="text-xs uppercase font-bold text-slate-400 mb-4 tracking-wider">Approved Breakdown</p>
                  {(selectedItem as LeaveApplication).splitSummary && (
                    <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">
                      Approved {((selectedItem as LeaveApplication).splitSummary as LeaveSplitSummary)?.approvedDays ?? 0} / {(selectedItem as LeaveApplication).numberOfDays}
                    </p>
                  )}
                  <div className="space-y-2">
                    {(selectedItem as LeaveApplication).splits!.map((split, idx) => (
                      <div key={split._id || `${split.date}-${idx}`} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900/40">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 dark:text-white">{formatDate(split.date)}</span>
                          {split.isHalfDay && (
                            <span className="text-xs px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300">
                              {split.halfDayType === 'first_half' ? 'First Half' : 'Second Half'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                            {split.leaveType}
                          </span>
                          <span className={`text-xs px-2 py-1 rounded-full ${split.status === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'}`}>
                            {split.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Split Editor for approvers */}
              {detailType === 'leave' && !['approved', 'rejected', 'cancelled'].includes(selectedItem.status) && (
                <div className="rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-md border border-slate-200 dark:border-slate-700 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Split & Approve</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Split days/half-days and assign leave types before approving.</p>
                    </div>
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
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
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      Enable split
                    </label>
                  </div>

                  {splitMode && (
                    <>
                      <div className="flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span>Applied: {(selectedItem as LeaveApplication).numberOfDays} day(s)</span>
                        <span>|</span>
                        <span>
                          Approved in splits: {splitDrafts.filter(s => s.status === 'approved').reduce((sum, s) => sum + (s.isHalfDay ? 0.5 : 1), 0)}
                        </span>
                        <span>|</span>
                        <span>
                          Rejected in splits: {splitDrafts.filter(s => s.status === 'rejected').reduce((sum, s) => sum + (s.isHalfDay ? 0.5 : 1), 0)}
                        </span>
                      </div>

                      {splitErrors.length > 0 && (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/40 dark:text-red-200">
                          {splitErrors.map((msg, idx) => (
                            <div key={idx}>• {msg}</div>
                          ))}
                        </div>
                      )}
                      {splitWarnings.length > 0 && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                          {splitWarnings.map((msg, idx) => (
                            <div key={idx}>• {msg}</div>
                          ))}
                        </div>
                      )}

                      <div className="space-y-3">
                        {splitDrafts.map((split, idx) => (
                          <div key={`${split.date}-${idx}`} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50/70 dark:bg-slate-900/40">
                            <div className="flex flex-wrap items-center gap-3">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-slate-900 dark:text-white">{formatDate(split.date)}</span>
                                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                                  <input
                                    type="checkbox"
                                    checked={split.isHalfDay || false}
                                    onChange={(e) => updateSplitDraft(idx, { isHalfDay: e.target.checked })}
                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                  />
                                  Half-day
                                </label>
                                {split.isHalfDay && (
                                  <select
                                    value={split.halfDayType || 'first_half'}
                                    onChange={(e) => updateSplitDraft(idx, { halfDayType: e.target.value as any })}
                                    className="text-xs rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                                  >
                                    <option value="first_half">First Half</option>
                                    <option value="second_half">Second Half</option>
                                  </select>
                                )}
                              </div>

                              <div className="flex items-center gap-2">
                                <select
                                  value={split.leaveType}
                                  onChange={(e) => updateSplitDraft(idx, { leaveType: e.target.value })}
                                  className="text-sm rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                                >
                                  <option value="">Select Leave Type</option>
                                  {leaveTypes.map((lt) => (
                                    <option key={lt.code} value={lt.code}>
                                      {lt.name || lt.code}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  value={split.status}
                                  onChange={(e) => updateSplitDraft(idx, { status: e.target.value as 'approved' | 'rejected' })}
                                  className="text-sm rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                                >
                                  <option value="approved">Approve</option>
                                  <option value="rejected">Reject</option>
                                </select>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            setSplitSaving(true);
                            await validateSplitsForLeave();
                            setSplitSaving(false);
                          }}
                          className="px-3 py-2 text-sm font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        >
                          {splitSaving ? 'Validating...' : 'Validate splits'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSplitDrafts(buildInitialSplits(selectedItem as LeaveApplication))}
                          className="px-3 py-2 text-sm font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        >
                          Reset to original
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            setSplitSaving(true);
                            const saved = await saveSplits();
                            if (saved) {
                              toast.success('Splits saved');
                              const refreshed = await api.getLeave((selectedItem as LeaveApplication)._id);
                              if (refreshed?.success && refreshed.data) {
                                setSelectedItem(refreshed.data);
                                setSplitDrafts(buildInitialSplits(refreshed.data));
                              }
                            }
                            setSplitSaving(false);
                          }}
                          className="px-3 py-2 text-sm font-semibold text-white rounded-lg bg-indigo-600 hover:bg-indigo-700"
                        >
                          {splitSaving ? 'Saving...' : 'Save splits'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Change History */}
              {selectedItem.changeHistory && selectedItem.changeHistory.length > 0 && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <button
                    onClick={() => setIsChangeHistoryExpanded(!isChangeHistoryExpanded)}
                    className="w-full px-4 py-3 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors"
                  >
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      Change History ({selectedItem.changeHistory.length})
                    </span>
                    <svg
                      className={`w-5 h-5 text-slate-500 transition-transform ${isChangeHistoryExpanded ? 'rotate-180' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {isChangeHistoryExpanded && (
                    <div className="p-4 space-y-3">
                      {selectedItem.changeHistory.map((change: any, idx: number) => {
                        // Format date values
                        const formatValue = (value: any) => {
                          if (value === null || value === undefined) return 'N/A';
                          const str = String(value);
                          // Check if it's a date string
                          if (str.includes('T') || str.includes('-') && str.length > 10) {
                            try {
                              const date = new Date(str);
                              if (!isNaN(date.getTime())) {
                                return date.toLocaleDateString('en-IN', {
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                });
                              }
                            } catch (e) {
                              // Not a valid date
                            }
                          }
                          return str;
                        };

                        const fieldName = change.field.replace(/([A-Z])/g, ' $1').trim().toUpperCase();
                        const oldValue = formatValue(change.originalValue);
                        const newValue = formatValue(change.newValue);

                        return (
                          <div key={idx} className="p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                            <div className="flex items-start justify-between mb-2">
                              <span className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
                                {fieldName}
                              </span>
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                {new Date(change.modifiedAt).toLocaleString('en-IN', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                })}
                              </span>
                            </div>
                            <div className="space-y-2">
                              {/* Old and New Value in same line */}
                              <div className="text-sm text-slate-700 dark:text-slate-300">
                                <span className="text-slate-400 dark:text-slate-500 line-through mr-2">
                                  {oldValue}
                                </span>
                                <span className="text-green-600 dark:text-green-400 font-semibold">
                                  → {newValue}
                                </span>
                              </div>
                              {/* Modified By */}
                              {change.modifiedByName && (
                                <div className="text-xs text-slate-600 dark:text-slate-400">
                                  Modified by <span className="font-medium">{change.modifiedByName}</span>
                                  {change.modifiedByRole && (
                                    <span className="text-slate-500"> ({change.modifiedByRole})</span>
                                  )}
                                </div>
                              )}
                              {/* Reason */}
                              {change.reason && (
                                <div className="text-xs text-slate-600 dark:text-slate-400 italic pt-1 border-t border-slate-200 dark:border-slate-700">
                                  Reason: {change.reason}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Approval Steps - Timeline / Progress */}
              {(() => {
                const wf = (selectedItem as any).workflow;
                const chain = wf?.approvalChain;
                if (!chain || !Array.isArray(chain) || chain.length === 0) return null;
                const approvedCount = chain.filter((s: any) => s.status === 'approved').length;
                return (
                  <div className="bg-slate-50 dark:bg-slate-900/50 p-4 sm:p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                    <p className="text-xs uppercase font-bold text-slate-400 mb-4 tracking-wider">Approval Timeline</p>
                    {/* Progress bar */}
                    <div className="mb-6">
                      <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase mb-1">
                        <span>{approvedCount} of {chain.length} approved</span>
                      </div>
                      <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-green-500 to-green-600 transition-all duration-300"
                          style={{ width: `${(approvedCount / chain.length) * 100}%` }}
                        />
                      </div>
                    </div>
                    {/* Vertical timeline */}
                    <div className="relative pl-6 border-l-2 border-slate-200 dark:border-slate-700 ml-1">
                      {chain.map((step: any, idx: number) => {
                        const stepRole = step.role || step.stepRole || 'step';
                        const label = step.label || `${stepRole.replace('_', ' ')}`;
                        const isApproved = step.status === 'approved';
                        const isRejected = step.status === 'rejected';
                        const isPending = step.status === 'pending';
                        const nextRole = wf?.nextApproverRole || wf?.nextApprover;
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
                              {isApproved && (
                                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                                  {step.actionByName || 'Unknown'} ({step.actionByRole || stepRole})
                                  {step.updatedAt && <span className="ml-1">· {new Date(step.updatedAt).toLocaleString()}</span>}
                                </p>
                              )}
                              {isApproved && step.comments && (
                                <p className="text-xs text-slate-500 italic mt-0.5">"{step.comments}"</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Action Section */}
              <div className="space-y-4">
                {/* Revoke Button - only for approver of last step, within 3 hours */}
                {canRevoke && (selectedItem.status === 'approved' || selectedItem.status === 'hod_approved' || selectedItem.status === 'manager_approved' || selectedItem.status === 'hr_approved') && (
                  <div className="p-3 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
                    <p className="text-xs font-semibold text-orange-800 dark:text-orange-300 mb-2">
                      ⏰ Revoke Approval (Within 3 hours)
                    </p>
                    <textarea
                      value={revokeReason}
                      onChange={(e) => setRevokeReason(e.target.value)}
                      placeholder="Reason for revocation (optional)..."
                      rows={2}
                      className="w-full rounded-lg border border-orange-200 bg-white px-3 py-2 text-xs dark:border-orange-700 dark:bg-slate-800 dark:text-white mb-2"
                    />
                    <button
                      onClick={async () => {
                        try {
                          const response = detailType === 'leave'
                            ? await api.revokeLeaveApproval(selectedItem._id, revokeReason)
                            : await api.revokeODApproval(selectedItem._id, revokeReason);

                          if (response.success) {
                            Swal.fire({
                              icon: 'success',
                              title: 'Success!',
                              text: `${detailType === 'leave' ? 'Leave' : 'OD'} approval revoked successfully`,
                              timer: 2000,
                              showConfirmButton: false,
                            });
                            setShowDetailDialog(false);
                            setSelectedItem(null);
                            setIsChangeHistoryExpanded(false);
                            loadData();
                          } else {
                            Swal.fire({
                              icon: 'error',
                              title: 'Failed',
                              text: response.error || 'Failed to revoke approval',
                            });
                          }
                        } catch (err: any) {
                          Swal.fire({
                            icon: 'error',
                            title: 'Error',
                            text: err.message || 'Failed to revoke approval',
                          });
                        }
                      }}
                      className="px-4 py-2.5 text-xs font-semibold text-white bg-orange-500 rounded-xl hover:bg-orange-600 transition-colors"
                    >
                      Revoke Approval
                    </button>
                  </div>
                )}

                {/* Edit Button (for Super Admin/HR - not final approved) */}
                {(selectedItem.status !== 'approved' || isSuperAdmin) && (
                  <button
                    onClick={() => {
                      const odItem = selectedItem as any;
                      setEditFormData({
                        leaveType: (selectedItem as LeaveApplication).leaveType || '',
                        odType: (selectedItem as ODApplication).odType || '',
                        fromDate: formatDateForInput(selectedItem.fromDate),
                        toDate: formatDateForInput(selectedItem.toDate),
                        purpose: selectedItem.purpose,
                        contactNumber: selectedItem.contactNumber || '',
                        placeVisited: (selectedItem as ODApplication).placeVisited || '',
                        isHalfDay: selectedItem.isHalfDay || false,
                        halfDayType: selectedItem.halfDayType || null,
                        remarks: (selectedItem as any).remarks || '',
                        status: selectedItem.status, // Include status for Super Admin
                        // Hour-based OD fields
                        odType_extended: odItem.odType_extended || 'full_day',
                        odStartTime: odItem.odStartTime || odItem.od_start_time || '',
                        odEndTime: odItem.odEndTime || odItem.od_end_time || '',
                      });
                      setShowEditDialog(true);
                    }}
                    className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-blue-500 rounded-xl hover:bg-blue-600 transition-colors"
                  >
                    Edit {detailType === 'leave' ? 'Leave' : 'OD'}
                  </button>
                )}

                {/* Approval Actions - only show to current approver */}
                {!['approved', 'rejected', 'cancelled'].includes(selectedItem.status) && canPerformAction(selectedItem, detailType) && (
                  <>
                    <p className="text-xs text-slate-500 uppercase font-semibold">Take Action</p>

                    {/* Comment */}
                    <textarea
                      value={actionComment}
                      onChange={(e) => setActionComment(e.target.value)}
                      placeholder="Add a comment (optional)..."
                      rows={2}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />

                    {/* Action Buttons */}
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handleDetailAction('approve')}
                        className="px-4 py-2.5 text-sm font-semibold text-white bg-green-500 rounded-xl hover:bg-green-600 transition-colors flex items-center gap-2"
                      >
                        <CheckIcon /> Approve
                      </button>
                      <button
                        onClick={() => handleDetailAction('reject')}
                        className="px-4 py-2.5 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors flex items-center gap-2"
                      >
                        <XIcon /> Reject
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="p-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row gap-3 justify-end items-stretch sm:items-center">
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
        </div>
      )
      }

      {/* Edit Dialog */}
      {
        showEditDialog && selectedItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowEditDialog(false)} />
            <div className="relative z-50 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-6">
                Edit {detailType === 'leave' ? 'Leave' : 'OD'}
              </h2>

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
                  <input
                    type="text"
                    value={detailType === 'leave' ? editFormData.leaveType : editFormData.odType}
                    onChange={(e) => setEditFormData({
                      ...editFormData,
                      [detailType === 'leave' ? 'leaveType' : 'odType']: e.target.value,
                    })}
                    required
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                {/* Dates */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Date *</label>
                    <input
                      type="date"
                      value={editFormData.fromDate}
                      onChange={(e) => {
                        const newFromDate = e.target.value;
                        // For OD, always set end date = start date
                        const newToDate = (detailType === 'od')
                          ? newFromDate
                          : editFormData.toDate;
                        setEditFormData({ ...editFormData, fromDate: newFromDate, toDate: newToDate });
                      }}
                      required
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {detailType === 'od' ? 'To Date' : 'To Date *'}
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
                        // For OD, prevent changing end date separately
                        if (detailType === 'od') {
                          // Auto-set to start date
                          setEditFormData({ ...editFormData, toDate: editFormData.fromDate });
                        } else {
                          setEditFormData({ ...editFormData, toDate: e.target.value });
                        }
                      }}
                      required={detailType === 'leave'}
                      disabled={detailType === 'od'}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white disabled:bg-slate-100 dark:disabled:bg-slate-700 disabled:cursor-not-allowed"
                    />
                    {detailType === 'od' && (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        End date is automatically set to start date for OD applications
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
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">End Time *</label>
                        <input
                          type="time"
                          value={editFormData.odEndTime || ''}
                          onChange={(e) => setEditFormData({ ...editFormData, odEndTime: e.target.value })}
                          required={editFormData.odType_extended === 'hours'}
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
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
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Purpose *</label>
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
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                )}

                {/* Contact Number */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Contact Number *</label>
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
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Remarks</label>
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
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
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

