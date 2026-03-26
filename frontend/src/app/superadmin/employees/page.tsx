'use client'; // Cache bust: Force recompile 1

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { api, Employee, Department, Division, Designation, EmployeeApplication, Allowance, Deduction } from '@/lib/api';
import { canFinalizeSalary } from '@/lib/permissions';
import { alertSuccess, alertError, alertConfirm, alertLoading } from '@/lib/customSwal';
import { auth } from '@/lib/auth';
import Swal from 'sweetalert2';
import BulkUpload from '@/components/BulkUpload';
import DynamicEmployeeForm from '@/components/DynamicEmployeeForm';
import EmployeeUpdateModal from '@/components/EmployeeUpdateModal';
import CertificatePreviewModal from '@/components/employee/CertificatePreviewModal';
import HistoryViewCompleteModal from '@/components/employee/HistoryViewCompleteModal';
import ResignationModal from '@/components/employee/ResignationModal';
import BulkAllowancesDeductionsModal from '@/components/employee/BulkAllowancesDeductionsModal';
import UpdateRequestReviewModal from '@/components/employee/UpdateRequestReviewModal';
import BankUpdateDialog from '@/components/employee/BankUpdateDialog';
import Spinner from '@/components/Spinner';
import EmployeeExportDialog from '@/components/employee/EmployeeExportDialog';

import {
  EMPLOYEE_TEMPLATE_HEADERS,
  EMPLOYEE_TEMPLATE_SAMPLE,
  validateEmployeeRow,
  ParsedRow,
} from '@/lib/bulkUpload';
import {
  UserCheck,
  UserX,
  Clock as LucideClock,
  ShieldCheck,
  CheckCircle,
  MoreVertical,
  ChevronRight,
  ChevronLeft,
  Plus,
  Search,
  Filter,
  Eye,
  Edit2,
  Trash2,
  Mail,
  KeyRound,
  Upload,
  Settings,
  Users,
  List,
  LayoutGrid,
  ArrowRight,
  XCircle,
  AlertTriangle,
  Download
} from 'lucide-react';




interface UpdateRequest {
  _id: string;
  employeeId: {
    _id: string;
    employee_name: string;
    profilePhoto?: string;
    emp_no: string;
    department?: { name: string };
    designation?: { name: string };
    dynamicFields?: Record<string, any>;
    email?: string;
    phone_number?: string;
    address?: string;
    blood_group?: string;
    dob?: string;
    doj?: string;
    gender?: string;
    marital_status?: string;
  };
  emp_no: string;
  requestedChanges: Record<string, any>;
  previousValues?: Record<string, any>;
  status: 'pending' | 'approved' | 'rejected';
  createdBy?: { name: string };
  comments?: string;
  createdAt: string;
}

interface FormSettings {
  groups: Array<{
    id: string;
    label: string;
    isEnabled: boolean;
    isSystem?: boolean;
    order?: number;
    fields: Array<{
      id: string;
      label: string;
      type: string;
      isEnabled: boolean;
      options?: Array<{ label: string; value: string }>;
      isRequired?: boolean;
      order?: number;
      description?: string;
    }>;
  }>;
  qualifications?: {
    isEnabled: boolean;
    enableCertificateUpload?: boolean;
    fields: Array<{ id: string; label: string }>;
    defaultRows?: Record<string, unknown>[];
  };
  qualification_statuses?: Array<{ label: string; value: string }>;
}

const initialFormState: Partial<Employee> = {
  emp_no: '',
  employee_name: '',
  division_id: '',
  department_id: '',
  designation_id: '',
  employee_group_id: '',
  doj: '',
  dob: '',
  gross_salary: undefined,
  second_salary: undefined,
  paidLeaves: 0,
  allottedLeaves: 0,
  gender: '',
  marital_status: '',
  blood_group: '',
  qualifications: [],
  experience: undefined,
  address: '',
  location: '',
  aadhar_number: '',
  phone_number: '',
  alt_phone_number: '',
  email: '',
  pf_number: '',
  esi_number: '',
  bank_account_no: '',
  bank_name: '',
  bank_place: '',
  ifsc_code: '',
  salary_mode: 'Cash',
  is_active: true,
  employeeAllowances: [],
  employeeDeductions: [],
  profilePhoto: '',
};

interface TemplateColumn {
  key: string;
  label: string;
  width?: string;
  type?: 'text' | 'number' | 'date' | 'select';
  options?: Array<{ label: string; value: string }>;
  tooltip?: string;
  editable?: boolean;
}

// Helper to render sortable/filterable header
const RenderFilterHeader = ({
  label,
  filterKey,
  nestedKey,
  options,
  currentFilters,
  setFilters,
  isActive,
  onToggle,
}: {
  label: string;
  filterKey: string;
  nestedKey?: string;
  options: string[];
  currentFilters: Record<string, string>;
  setFilters: (filters: Record<string, string>) => void;
  isActive: boolean;
  onToggle: (e: React.MouseEvent) => void;
}) => {
  const currentFilterValue = currentFilters[filterKey] || '';
  const btnEl = useRef<HTMLButtonElement>(null);
  const [fixedPos, setFixedPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    // Recalculate position on scroll or resize to keep it attached
    const updatePosition = () => {
      if (isActive && btnEl.current) {
        const rect = btnEl.current.getBoundingClientRect();
        // Adjust for right edge overflow
        const left = rect.left + 200 > window.innerWidth ? rect.right - 200 : rect.left;
        setFixedPos({
          top: rect.bottom + 4,
          left: left,
        });
      }
    };

    if (isActive) {
      updatePosition();
      window.addEventListener('scroll', updatePosition, true); // true for capturing scroll in parents
      window.addEventListener('resize', updatePosition);
    }

    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isActive]);

  return (
    <th className={`relative px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 ${isActive ? 'z-50' : ''}`}>
      <div className="flex items-center gap-2">
        <span>{label}</span>
        <button
          ref={btnEl}
          onClick={onToggle}
          className={`rounded p-1 hover:bg-slate-200 dark:hover:bg-slate-700 ${currentFilterValue ? 'text-green-600 bg-green-50 dark:bg-green-900/30' : 'text-slate-400'}`}
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 6.707A1 1 0 013 6.586V4z" />
          </svg>
        </button>
      </div>

      {isActive && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={onToggle}
          />
          <div
            className="fixed z-50 mt-1 min-w-[200px] rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-800"
            style={{ top: fixedPos.top, left: fixedPos.left }}
          >
            <div className="mb-2 px-2 py-1">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Filter by {label}</span>
            </div>
            <div className="max-h-48 overflow-y-auto">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const newFilters = { ...currentFilters };
                  delete newFilters[filterKey];
                  setFilters(newFilters);
                  onToggle({ stopPropagation: () => { } } as any);
                }}
                className={`flex w-full items-center rounded-lg px-2 py-1.5 text-sm ${!currentFilterValue ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}
              >
                All
              </button>
              {options.map((option) => (
                <button
                  key={option}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFilters({ ...currentFilters, [filterKey]: option });
                    onToggle({ stopPropagation: () => { } } as any);
                  }}
                  className={`flex w-full items-center rounded-lg px-2 py-1.5 text-sm ${currentFilters[filterKey] === option ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </th>
  );
};

/** Format date as YYYY-MM-DD in local time (avoids UTC shift for resignation last working date) */
const toLocalDateString = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const isEmployeeActive = (employee: any) => {
  const status = employee.is_active;
  return status === true || status === 1 || (status !== false && status !== 0 && status !== '0');
};

const getFieldLabel = (fieldId: string, formSettings: any) => {
  if (!formSettings) return fieldId.replace(/_/g, ' ');
  for (const group of formSettings.groups) {
    const field = group.fields.find((f: any) => f.id === fieldId);
    if (field) return field.label;
  }
  if (formSettings.qualifications?.fields?.some((f: any) => f.id === fieldId)) {
    return formSettings.qualifications?.fields.find((f: any) => f.id === fieldId)?.label || fieldId;
  }
  return fieldId.replace(/_/g, ' ');
};

export default function EmployeesPage() {
  const [activeTab, setActiveTab] = useState<'employees' | 'applications' | 'requests'>('employees');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [applications, setApplications] = useState<EmployeeApplication[]>([]);
  const [updateRequests, setUpdateRequests] = useState<UpdateRequest[]>([]);
  const [loadingUpdateRequests, setLoadingUpdateRequests] = useState(false);
  const [selectedUpdateRequest, setSelectedUpdateRequest] = useState<UpdateRequest | null>(null);
  const [updateRequestStatusFilter, setUpdateRequestStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [updateRequestViewMode, setUpdateRequestViewMode] = useState<'list' | 'card'>('list');
  const [processingUpdateRequest, setProcessingUpdateRequest] = useState(false);
  const [updateRequestRejectComments, setUpdateRequestRejectComments] = useState('');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [selectedDivisionFilter, setSelectedDivisionFilter] = useState('');
  const [filteredDesignations, setFilteredDesignations] = useState<Designation[]>([]);
  const [filteredApplicationDesignations, setFilteredApplicationDesignations] = useState<Designation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingApplications, setLoadingApplications] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [showApplicationDialog, setShowApplicationDialog] = useState(false);
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const [selectedApplication, setSelectedApplication] = useState<EmployeeApplication | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editingApplicationID, setEditingApplicationID] = useState<string | null>(null);
  const [viewingEmployee, setViewingEmployee] = useState<Employee | null>(null);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [showApprovalOverrides, setShowApprovalOverrides] = useState(false);

  const [employeeHistory, setEmployeeHistory] = useState<any[]>([]);
  const [employeeHistoryLoading, setEmployeeHistoryLoading] = useState(false);
  const [employeeViewTab, setEmployeeViewTab] = useState<'profile' | 'history'>('profile');
  const [historyViewComplete, setHistoryViewComplete] = useState<{
    eventLabel: string;
    changes: { field: string; fieldLabel: string; previous: unknown; current: unknown }[];
  } | null>(null);
  const [certificatePreviewUrl, setCertificatePreviewUrl] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Employee>>(initialFormState);
  const [formSettings, setFormSettings] = useState<FormSettings | null>(null);
  const [applicationFormData, setApplicationFormData] = useState<Partial<EmployeeApplication & { proposedSalary: number }>>({ ...initialFormState, proposedSalary: 0 });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [approvalData, setApprovalData] = useState<{
    approvedSalary: number;
    second_salary?: number;
    doj: string;
    comments: string;
    qualifications?: any[];
    qualificationStatus?: string;
    paidLeaves?: number;
    casualLeaves?: number;
  }>({ approvedSalary: 0, doj: '', comments: '', qualifications: [], qualificationStatus: 'Partial', paidLeaves: 0, casualLeaves: 0 });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [notificationChannels, setNotificationChannels] = useState<{ sms: boolean; whatsapp: boolean; email: boolean }>({
    sms: false,
    whatsapp: false,
    email: true
  });
  const [dataSource, setDataSource] = useState<string>('mongodb');


  const [applicationSearchTerm, setApplicationSearchTerm] = useState('');
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [allowEmployeeBulkProcess, setAllowEmployeeBulkProcess] = useState(false);
  const [customEmployeeGroupingEnabled, setCustomEmployeeGroupingEnabled] = useState(false);
  const [employeeGroups, setEmployeeGroups] = useState<{ _id: string; name: string; isActive?: boolean }[]>([]);
  const [autoGenerateEmployeeNumber, setAutoGenerateEmployeeNumber] = useState(false);
  /** Toggle in bulk preview: when true, ignore emp numbers from file (auto-generate). Defaults from settings when dialog opens. */
  const [bulkPreviewAutoGenerateEmpNo, setBulkPreviewAutoGenerateEmpNo] = useState(false);
  const [addFormAutoGenerateEmpNo, setAddFormAutoGenerateEmpNo] = useState(false);
  const [applicationFormAutoGenerateEmpNo, setApplicationFormAutoGenerateEmpNo] = useState(false);
  const [userRole, setUserRole] = useState<string>('');
  const [showLeftDateModal, setShowLeftDateModal] = useState(false);
  const [selectedEmployeeForLeftDate, setSelectedEmployeeForLeftDate] = useState<Employee | null>(null);
  const [leftDateForm, setLeftDateForm] = useState<{ leftDate: string; leftReason: string; requestType?: 'resignation' | 'termination' }>({ leftDate: '', leftReason: '', requestType: 'resignation' });
  const [resignationNoticePeriodDays, setResignationNoticePeriodDays] = useState(0);
  const [includeLeftEmployees, setIncludeLeftEmployees] = useState(false);
  const [passwordMode, setPasswordMode] = useState<'random' | 'phone_empno'>('random');
  const [isResending, setIsResending] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState<string | null>(null);
  const [selectedApplicationIds, setSelectedApplicationIds] = useState<string[]>([]);
  const [updatingStatusIds, setUpdatingStatusIds] = useState<Set<string>>(new Set());
  const [showEmployeeUpdateModal, setShowEmployeeUpdateModal] = useState(false);
  const [showBulkAllowancesDeductions, setShowBulkAllowancesDeductions] = useState(false);
  const [showBankUpdateDialog, setShowBankUpdateDialog] = useState(false);
  const [submittingBankUpdate, setSubmittingBankUpdate] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [selectedEmployeeForExport, setSelectedEmployeeForExport] = useState<{ empNo?: string; name?: string } | null>(null);

  const [dynamicTemplate, setDynamicTemplate] = useState<{ headers: string[]; sample: any[]; columns: TemplateColumn[] }>({
    headers: EMPLOYEE_TEMPLATE_HEADERS,
    sample: EMPLOYEE_TEMPLATE_SAMPLE,
    columns: [],
  });

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDepartmentFilter, setSelectedDepartmentFilter] = useState('');
  const [selectedDesignationFilter, setSelectedDesignationFilter] = useState('');
  const [selectedEmployeeGroupFilter, setSelectedEmployeeGroupFilter] = useState('');
  const [employeeFilters, setEmployeeFilters] = useState<Record<string, string>>({});

  const [applicationPage, setApplicationPage] = useState(1);
  const [applicationRowsPerPage, setApplicationRowsPerPage] = useState(10);
  const [applicationFilters, setApplicationFilters] = useState<Record<string, string>>({});

  // Deduction Defaults
  const [defaultStatutory, setDefaultStatutory] = useState(true);
  const [defaultAttendance, setDefaultAttendance] = useState(true);

  const fetchDeductionDefaults = useCallback(async () => {
    try {
      const [statRes, attRes] = await Promise.all([
        api.getSetting('default_apply_statutory_deductions'),
        api.getSetting('default_apply_attendance_deductions')
      ]);
      if (statRes.success && statRes.data) setDefaultStatutory(!!statRes.data.value);
      if (attRes.success && attRes.data) setDefaultAttendance(!!attRes.data.value);
    } catch (err) {
      console.error('Error fetching deduction defaults:', err);
    }
  }, []);

  useEffect(() => {
    fetchDeductionDefaults();
  }, [fetchDeductionDefaults]);

  const initialFormStateWithDefaults = useMemo(() => ({
    ...initialFormState,
    applyPF: defaultStatutory,
    applyESI: defaultStatutory,
    applyProfessionTax: defaultStatutory,
    applyAttendanceDeduction: defaultAttendance,
    deductLateIn: defaultAttendance,
    deductEarlyOut: defaultAttendance,
    deductPermission: defaultAttendance,
    deductAbsent: defaultAttendance,
  }), [defaultStatutory, defaultAttendance]);



  // Sorting State
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  // Helper to filter data based on column filters
  // Helper to filter data based on column filters
  const filterData = (data: any[], filters: Record<string, string>) => {
    return data.filter(item => {
      return Object.entries(filters).every(([key, value]) => {
        if (!value) return true;

        // Special handling for Employee Status
        if (key === 'status') {
          if (value === 'Left') return !!item.leftDate;
          if (value === 'Active') return !item.leftDate && item.is_active !== false;
          if (value === 'Inactive') return !item.leftDate && item.is_active === false;
          // Fallback for simple status matching (like in applications tab where it's a string)
          return String(item.status) === value;
        }

        // Special handling for Processed By (Applications)
        if (key === 'processedBy') {
          const processorName = item.approvedBy?.name || item.rejectedBy?.name;
          return processorName === value;
        }

        // Handle nested keys (e.g., department.name)
        const keys = key.split('.');
        let itemValue = item;
        for (const k of keys) {
          itemValue = itemValue?.[k];
        }
        return String(itemValue || '') === value;
      });
    });
  };

  // Sorting Logic
  const sortData = (data: any[]) => {
    if (!sortConfig) return data;

    return [...data].sort((a, b) => {
      let aValue = (a as any)[sortConfig.key];
      let bValue = (b as any)[sortConfig.key];

      // Handle numbers if strings look like numbers
      if (!isNaN(Number(aValue)) && !isNaN(Number(bValue))) {
        aValue = Number(aValue);
        bValue = Number(bValue);
      } else {
        aValue = String(aValue || '').toLowerCase();
        bValue = String(bValue || '').toLowerCase();
      }

      if (aValue < bValue) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
  };

  // Allowance/Deduction defaults & overrides
  const [componentDefaults, setComponentDefaults] = useState<{ allowances: any[]; deductions: any[] }>({

    allowances: [],
    deductions: [],
  });
  const [overrideAllowances, setOverrideAllowances] = useState<Record<string, number | null>>({});
  const [overrideDeductions, setOverrideDeductions] = useState<Record<string, number | null>>({});
  const [overrideAllowancesBasedOnPresentDays, setOverrideAllowancesBasedOnPresentDays] = useState<Record<string, boolean>>({});
  const [overrideDeductionsBasedOnPresentDays, setOverrideDeductionsBasedOnPresentDays] = useState<Record<string, boolean>>({});
  const [loadingComponents, setLoadingComponents] = useState(false);
  const [salarySummary, setSalarySummary] = useState({
    totalAllowances: 0,
    totalDeductions: 0,
    netSalary: 0,
    ctcSalary: 0,
  });
  const [applicationSalarySummary, setApplicationSalarySummary] = useState({
    totalAllowances: 0,
    totalDeductions: 0,
    netSalary: 0,
    ctcSalary: 0,
  });
  const [approvalSalarySummary, setApprovalSalarySummary] = useState({
    totalAllowances: 0,
    totalDeductions: 0,
    netSalary: 0,
    ctcSalary: 0,
  });

  // Filter Header State
  const [activeFilterColumn, setActiveFilterColumn] = useState<string | null>(null);

  const [approvalComponentDefaults, setApprovalComponentDefaults] = useState<{ allowances: any[]; deductions: any[] }>({
    allowances: [],
    deductions: [],
  });
  const [approvalOverrideAllowances, setApprovalOverrideAllowances] = useState<Record<string, number | null>>({});
  const [approvalOverrideDeductions, setApprovalOverrideDeductions] = useState<Record<string, number | null>>({});
  const [approvalOverrideAllowancesBasedOnPresentDays, setApprovalOverrideAllowancesBasedOnPresentDays] = useState<Record<string, boolean>>({});
  const [approvalOverrideDeductionsBasedOnPresentDays, setApprovalOverrideDeductionsBasedOnPresentDays] = useState<Record<string, boolean>>({});
  const [approvalLoadingComponents, setApprovalLoadingComponents] = useState(false);


  // Build override payload: only actual overrides (pre-existing employee overrides + newly edited/added).
  // When editing employee: include ALL allowances/deductions the employee has, with form values applied; plus any new overrides from global/dept.
  const buildOverridePayload = (
    defaults: any[],
    overrides: Record<string, number | null>,
    basedOnPresentDaysMap: Record<string, boolean>,
    categoryFallback: 'allowance' | 'deduction',
    existingEmployeeItems?: any[]
  ) => {
    const existingList = Array.isArray(existingEmployeeItems) ? existingEmployeeItems : [];
    const existingKeys = new Set(
      existingList.map((ov: any) => ov.masterId?.toString() || (ov.name || '').toLowerCase()).filter(Boolean)
    );

    const buildEntry = (item: any, amt: number | null, key: string) => {
      if (amt === null || amt === undefined) return null;
      const itemType = item.type || (item.base ? 'percentage' : 'fixed');
      const basedOnPresentDays = itemType === 'fixed' ? (basedOnPresentDaysMap[key] ?? item.basedOnPresentDays ?? false) : false;
      return {
        masterId: item.masterId || null,
        code: item.code || null,
        name: item.name || '',
        category: item.category || categoryFallback,
        type: itemType,
        amount: Number(amt),
        overrideAmount: Number(amt),
        percentage: item.type === 'percentage' ? (item.percentage ?? null) : null,
        percentageBase: item.base || item.percentageBase || null,
        minAmount: item.minAmount ?? null,
        maxAmount: item.maxAmount ?? null,
        basedOnPresentDays,
        isOverride: true,
      };
    };

    const result: any[] = [];

    // Part A: every existing employee override — include all, use form value if user edited
    for (const ov of existingList) {
      const key = ov.masterId?.toString() || (ov.name || '').toLowerCase();
      if (!key) continue;
      const amt = Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : (ov.amount ?? ov.overrideAmount ?? null);
      const entry = buildEntry(ov, amt, key);
      if (entry) result.push(entry);
    }

    // Part B: new overrides (in form overrides but not in employee's list — user added from global/dept)
    for (const key of Object.keys(overrides)) {
      if (existingKeys.has(key)) continue;
      const amt = overrides[key];
      if (amt === null || amt === undefined) continue;

      let item = defaults.find((d: any) => (d.masterId?.toString() === key) || ((d.name || '').toLowerCase() === key));
      if (!item && editingEmployee) {
        const list = categoryFallback === 'allowance' ? editingEmployee.employeeAllowances : editingEmployee.employeeDeductions;
        item = (list || []).find((ov: any) => (ov.masterId?.toString() === key) || ((ov.name || '').toLowerCase() === key));
      }
      if (!item && selectedApplication) {
        const appList = categoryFallback === 'allowance' ? selectedApplication.employeeAllowances : selectedApplication.employeeDeductions;
        item = (appList || []).find((ov: any) => (ov.masterId?.toString() === key) || ((ov.name || '').toLowerCase() === key));
      }
      if (!item) continue;

      const entry = buildEntry(item, amt, key);
      if (entry) result.push(entry);
    }

    return result;
  };

  // Fetch component defaults (allowances/deductions) for a dept + gross salary (+optional empNo to include existing overrides)
  const fetchComponentDefaults = async (departmentId: string, grossSalary: number, empNo?: string, preserveOverrides: boolean = false) => {
    setLoadingComponents(true);
    try {
      const res = await api.getEmployeeComponentDefaults({ departmentId, grossSalary, empNo });
      if (res?.success && res?.data) {
        const allowances = Array.isArray(res.data.allowances) ? res.data.allowances : [];
        const deductions = Array.isArray(res.data.deductions) ? res.data.deductions : [];

        // Prefill overrides map from existing employee data if editing, or preserve current overrides if preserveOverrides is true
        const newOverrideAllowances: Record<string, number | null> = preserveOverrides ? { ...overrideAllowances } : {};
        const newOverrideDeductions: Record<string, number | null> = preserveOverrides ? { ...overrideDeductions } : {};
        const newOverrideAllowancesBasedOnPresentDays: Record<string, boolean> = preserveOverrides ? { ...overrideAllowancesBasedOnPresentDays } : {};
        const newOverrideDeductionsBasedOnPresentDays: Record<string, boolean> = preserveOverrides ? { ...overrideDeductionsBasedOnPresentDays } : {};

        // If preserveOverrides is true, we keep the existing overrides (set in handleEdit)
        // If preserveOverrides is false, we load from editingEmployee if available
        if (!preserveOverrides && editingEmployee?.employeeAllowances) {
          editingEmployee.employeeAllowances.forEach((ov: any) => {
            const key = ov.masterId ? ov.masterId.toString() : (ov.name || '').toLowerCase();
            if (key && (ov.amount !== null && ov.amount !== undefined)) {
              newOverrideAllowances[key] = Number(ov.amount);
              newOverrideAllowancesBasedOnPresentDays[key] = ov.basedOnPresentDays ?? false;
            }
          });
        }
        if (!preserveOverrides && editingEmployee?.employeeDeductions) {
          editingEmployee.employeeDeductions.forEach((ov: any) => {
            const key = ov.masterId ? ov.masterId.toString() : (ov.name || '').toLowerCase();
            if (key && (ov.amount !== null && ov.amount !== undefined)) {
              newOverrideDeductions[key] = Number(ov.amount);
              newOverrideDeductionsBasedOnPresentDays[key] = ov.basedOnPresentDays ?? false;
            }
          });
        }

        setComponentDefaults({ allowances, deductions });
        setOverrideAllowances(newOverrideAllowances);
        setOverrideDeductions(newOverrideDeductions);
        setOverrideAllowancesBasedOnPresentDays(newOverrideAllowancesBasedOnPresentDays);
        setOverrideDeductionsBasedOnPresentDays(newOverrideDeductionsBasedOnPresentDays);
      } else {
        if (!preserveOverrides) {
          setComponentDefaults({ allowances: [], deductions: [] });
          setOverrideAllowances({});
          setOverrideDeductions({});
        }
      }
    } catch (err) {
      console.error('Failed to load component defaults', err);
      if (!preserveOverrides) {
        setComponentDefaults({ allowances: [], deductions: [] });
        setOverrideAllowances({});
        setOverrideDeductions({});
      }
    } finally {
      setLoadingComponents(false);
    }
  };

  // Fetch components for approval dialog
  const fetchApprovalComponentDefaults = async (departmentId: string, grossSalary: number) => {
    setApprovalLoadingComponents(true);
    try {
      const res = await api.getEmployeeComponentDefaults({ departmentId, grossSalary });
      if (res?.success && res?.data) {
        const allowances = Array.isArray(res.data.allowances) ? res.data.allowances : [];
        const deductions = Array.isArray(res.data.deductions) ? res.data.deductions : [];

        const prefAllow: Record<string, number | null> = {};
        const prefDed: Record<string, number | null> = {};
        const prefAllowBasedOnPresentDays: Record<string, boolean> = {};
        const prefDedBasedOnPresentDays: Record<string, boolean> = {};

        if (selectedApplication?.employeeAllowances) {
          selectedApplication.employeeAllowances.forEach((ov: any) => {
            const key = ov.masterId ? ov.masterId.toString() : (ov.name || '').toLowerCase();
            prefAllow[key] = ov.amount ?? ov.overrideAmount ?? null;
            prefAllowBasedOnPresentDays[key] = ov.basedOnPresentDays ?? false;
          });
        }
        if (selectedApplication?.employeeDeductions) {
          selectedApplication.employeeDeductions.forEach((ov: any) => {
            const key = ov.masterId ? ov.masterId.toString() : (ov.name || '').toLowerCase();
            prefDed[key] = ov.amount ?? ov.overrideAmount ?? null;
            prefDedBasedOnPresentDays[key] = ov.basedOnPresentDays ?? false;
          });
        }

        setApprovalComponentDefaults({ allowances, deductions });
        setApprovalOverrideAllowances(prefAllow);
        setApprovalOverrideDeductions(prefDed);
        setApprovalOverrideAllowancesBasedOnPresentDays(prefAllowBasedOnPresentDays);
        setApprovalOverrideDeductionsBasedOnPresentDays(prefDedBasedOnPresentDays);
      } else {
        setApprovalComponentDefaults({ allowances: [], deductions: [] });
        setApprovalOverrideAllowances({});
        setApprovalOverrideDeductions({});
      }
    } catch (err) {
      console.error('Failed to load component defaults (approval)', err);
      setApprovalComponentDefaults({ allowances: [], deductions: [] });
      setApprovalOverrideAllowances({});
      setApprovalOverrideDeductions({});
    } finally {
      setApprovalLoadingComponents(false);
    }
  };

  const getKey = (item: any) => (item.masterId ? item.masterId.toString() : (item.name || '').toLowerCase());

  // Recompute salary summary (frontend-only) whenever salary or overrides change
  useEffect(() => {
    // Check both gross_salary and proposedSalary (form might use either)
    const gross = Number(formData.gross_salary || (formData as any).proposedSalary || 0);

    const sumWithOverrides = (items: any[], overrides: Record<string, number | null>) =>
      items.reduce((acc, item) => {
        const key = getKey(item);
        const overrideVal = Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : undefined;
        const amount = overrideVal === null || overrideVal === undefined ? item.amount || 0 : Number(overrideVal);
        return acc + (Number.isFinite(amount) ? Number(amount) : 0);
      }, 0);

    const totalAllowances = sumWithOverrides(componentDefaults.allowances, overrideAllowances);
    const totalDeductions = sumWithOverrides(componentDefaults.deductions, overrideDeductions);
    const netSalary = gross + totalAllowances - totalDeductions;
    const ctcSalary = gross + totalAllowances; // CTC = Gross + Allowances

    setSalarySummary({
      totalAllowances,
      totalDeductions,
      netSalary,
      ctcSalary,
    });
  }, [formData.gross_salary, componentDefaults, overrideAllowances, overrideDeductions]);

  // Application salary summary based on proposed salary and overrides
  useEffect(() => {
    const gross = Number((applicationFormData as any).proposedSalary || 0);

    const sumWithOverrides = (items: any[], overrides: Record<string, number | null>) =>
      items.reduce((acc, item) => {
        const key = getKey(item);
        const overrideVal = Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : undefined;
        const amount = overrideVal === null || overrideVal === undefined ? item.amount || 0 : Number(overrideVal);
        return acc + (Number.isFinite(amount) ? Number(amount) : 0);
      }, 0);

    const totalAllowances = sumWithOverrides(componentDefaults.allowances, overrideAllowances);
    const totalDeductions = sumWithOverrides(componentDefaults.deductions, overrideDeductions);
    const netSalary = gross + totalAllowances - totalDeductions;
    const ctcSalary = gross + totalAllowances; // CTC = Gross + Allowances

    setApplicationSalarySummary({
      totalAllowances,
      totalDeductions,
      netSalary,
      ctcSalary,
    });
  }, [applicationFormData, componentDefaults, overrideAllowances, overrideDeductions]);

  // Approval salary summary
  useEffect(() => {
    const gross = Number(approvalData.approvedSalary || selectedApplication?.proposedSalary || 0);

    const sumWithOverrides = (items: any[], overrides: Record<string, number | null>) =>
      items.reduce((acc, item) => {
        const key = getKey(item);
        const overrideVal = Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : undefined;
        const amount = overrideVal === null || overrideVal === undefined ? item.amount || 0 : Number(overrideVal);
        return acc + (Number.isFinite(amount) ? Number(amount) : 0);
      }, 0);

    const totalAllowances = sumWithOverrides(approvalComponentDefaults.allowances, approvalOverrideAllowances);
    const totalDeductions = sumWithOverrides(approvalComponentDefaults.deductions, approvalOverrideDeductions);
    const netSalary = gross + totalAllowances - totalDeductions;
    const ctcSalary = gross + totalAllowances; // CTC = Gross + Allowances

    setApprovalSalarySummary({
      totalAllowances,
      totalDeductions,
      netSalary,
      ctcSalary,
    });
  }, [approvalData.approvedSalary, selectedApplication?.proposedSalary, approvalComponentDefaults, approvalOverrideAllowances, approvalOverrideDeductions]);

  const handleOverrideChange = (
    type: 'allowance' | 'deduction',
    item: any,
    value: string
  ) => {
    const parsed = value === '' ? null : Number(value);
    if (Number.isNaN(parsed as number)) return;
    const key = getKey(item);
    if (type === 'allowance') {
      setOverrideAllowances((prev) => ({ ...prev, [key]: parsed }));
    } else {
      setOverrideDeductions((prev) => ({ ...prev, [key]: parsed }));
    }
  };

  const handleApprovalOverrideChange = (
    type: 'allowance' | 'deduction',
    item: any,
    value: string
  ) => {
    const parsed = value === '' ? null : Number(value);
    if (Number.isNaN(parsed as number)) return;
    const key = getKey(item);
    if (type === 'allowance') {
      setApprovalOverrideAllowances((prev) => ({ ...prev, [key]: parsed }));
    } else {
      setApprovalOverrideDeductions((prev) => ({ ...prev, [key]: parsed }));
    }
  };

  useEffect(() => {
    const user = auth.getUser();
    if (user) {
      setUserRole(user.role);
    }

    loadEmployees(1); // Load first page
    loadDivisions();
    loadDepartments();
    loadFormSettings();
    if (activeTab === 'applications') {
      loadApplications();
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'applications') {
      loadApplications();
    }
  }, [activeTab, selectedDivisionFilter, selectedDepartmentFilter, selectedDesignationFilter, selectedEmployeeGroupFilter]);

  useEffect(() => {
    if (showLeftDateModal && selectedEmployeeForLeftDate) {
      api.getResignationSettings()
        .then((res) => {
          const raw = res?.data?.noticePeriodDays ?? res?.data?.value?.noticePeriodDays;
          const days = Math.max(0, Number(raw) || 0);
          setResignationNoticePeriodDays(days);
          const d = new Date();
          d.setDate(d.getDate() + days);
          const minDateStr = toLocalDateString(d);
          const existingLeft = selectedEmployeeForLeftDate.leftDate ? toLocalDateString(new Date(selectedEmployeeForLeftDate.leftDate)) : null;
          setLeftDateForm((prev) => ({ ...prev, leftDate: existingLeft || minDateStr }));
        })
        .catch(() => setResignationNoticePeriodDays(0));
    }
  }, [showLeftDateModal, selectedEmployeeForLeftDate]);

  useEffect(() => {
    api.getSetting('allow_employee_bulk_process')
      .then((res) => { if (res?.success && res?.data != null) setAllowEmployeeBulkProcess(!!res.data.value); })
      .catch(() => setAllowEmployeeBulkProcess(false));
  }, []);

  const loadEmployeeGroupingConfig = async () => {
    try {
      const res = await api.getSetting('custom_employee_grouping_enabled');
      const on = !!(res?.success && res?.data != null && res.data.value);
      setCustomEmployeeGroupingEnabled(on);
      if (!on) {
        setEmployeeGroups([]);
        return;
      }
      const gRes = await api.getEmployeeGroups(true);
      if (gRes.success && Array.isArray(gRes.data)) setEmployeeGroups(gRes.data);
      else setEmployeeGroups([]);
    } catch {
      setCustomEmployeeGroupingEnabled(false);
      setEmployeeGroups([]);
    }
  };

  useEffect(() => {
    loadEmployeeGroupingConfig();
  }, []);

  // Re-check latest setting when dialogs open (setting can be changed from settings page).
  useEffect(() => {
    if (showApplicationDialog || showDialog || showBulkUpload || showEmployeeUpdateModal) {
      loadEmployeeGroupingConfig();
    }
  }, [showApplicationDialog, showDialog, showBulkUpload, showEmployeeUpdateModal]);

  const loadDivisions = async () => {
    try {
      const response = await api.getDivisions();
      if (response.success && response.data) {
        setDivisions(response.data);
      }
    } catch (err) {
      console.error('Error loading divisions:', err);
    }
  };


  useEffect(() => {
    // Show all designations since they are now global
    setFilteredDesignations(designations);
  }, [designations]);

  // Load allowance/deduction defaults when department and gross salary are set
  useEffect(() => {
    const deptId = formData.department_id;
    // Check both gross_salary and proposedSalary (form might use either)
    const gross = formData.gross_salary || (formData as any).proposedSalary;
    if (deptId && gross !== undefined && gross !== null && Number(gross) > 0) {
      // If editing and salary changed, preserve current overrides so user edits aren't lost
      const preserveOverrides = !!editingEmployee && (Object.keys(overrideAllowances).length > 0 || Object.keys(overrideDeductions).length > 0);
      fetchComponentDefaults(deptId as string, Number(gross), editingEmployee?.emp_no, preserveOverrides);
    } else {
      setComponentDefaults({ allowances: [], deductions: [] });
      setOverrideAllowances({});
      setOverrideDeductions({});
    }
  }, [formData.department_id, formData.gross_salary, (formData as any).proposedSalary, editingEmployee?.emp_no]);

  // Load allowance/deduction defaults for application dialog when dept + proposed salary are set
  useEffect(() => {
    const deptRaw = applicationFormData.department_id;
    const deptId = typeof deptRaw === 'string' ? deptRaw : deptRaw?._id;
    const gross = (applicationFormData as any).proposedSalary;
    if (deptId && gross !== undefined && gross !== null && Number(gross) > 0) {
      fetchComponentDefaults(deptId as string, Number(gross), undefined);
    }
  }, [applicationFormData.department_id, (applicationFormData as any).proposedSalary]);

  // Load allowance/deduction defaults for approval dialog when opened or salary changes
  useEffect(() => {
    if ((!showApprovalDialog && !showViewDialog) || !selectedApplication) return;
    const deptRaw = selectedApplication.department_id || selectedApplication.department?._id;
    const deptId = typeof deptRaw === 'string' ? deptRaw : (deptRaw as any)?._id;
    const gross = approvalData.approvedSalary || selectedApplication.proposedSalary;
    if (deptId && gross !== undefined && gross !== null && Number(gross) > 0) {
      fetchApprovalComponentDefaults(deptId as string, Number(gross));
    } else {
      setApprovalComponentDefaults({ allowances: [], deductions: [] });
      setApprovalOverrideAllowances({});
      setApprovalOverrideDeductions({});
    }
  }, [showApprovalDialog, showViewDialog, selectedApplication, approvalData.approvedSalary]);


  useEffect(() => {
    // Show all designations since they are now global
    setFilteredApplicationDesignations(designations);
  }, [designations]);

  // Load employee settings when bulk upload dialog opens; sync toggle default for preview
  useEffect(() => {
    if (!showBulkUpload) return;
    api.getEmployeeSettings()
      .then((res) => {
        const on = res?.data?.auto_generate_employee_number === true;
        setAutoGenerateEmployeeNumber(on);
        setBulkPreviewAutoGenerateEmpNo(on);
      })
      .catch(() => {
        setAutoGenerateEmployeeNumber(false);
        setBulkPreviewAutoGenerateEmpNo(false);
      });
  }, [showBulkUpload]);

  // Load auto-generate setting when add employee dialog opens (create mode only)
  useEffect(() => {
    if (!showDialog || editingEmployee) return;
    api.getEmployeeSettings()
      .then((res) => setAddFormAutoGenerateEmpNo(!!res?.data?.auto_generate_employee_number))
      .catch(() => setAddFormAutoGenerateEmpNo(false));
  }, [showDialog, editingEmployee]);

  // Load auto-generate setting when New Employee Application dialog opens
  useEffect(() => {
    if (!showApplicationDialog) return;
    api.getEmployeeSettings()
      .then((res) => setApplicationFormAutoGenerateEmpNo(!!res?.data?.auto_generate_employee_number))
      .catch(() => setApplicationFormAutoGenerateEmpNo(false));
  }, [showApplicationDialog]);

  const loadFormSettings = async () => {
    try {
      const response = await api.getFormSettings();
      if (response.success && response.data) {
        setFormSettings(response.data);
        generateDynamicTemplate(response.data);
      }
    } catch (err) {
      console.error('Error loading form settings:', err);
    }
  };

  const generateDynamicTemplate = (settings: any, opts?: { includeEmployeeGroup?: boolean }) => {
    if (!settings || !settings.groups) return;

    const headers: string[] = [];
    const sample: any = {};
    const columns: any[] = [];

    // Permanent fields that must always be there
    const permanentFields = [
      { id: 'emp_no', label: 'Emp No', sample: 'EMP001', width: '100px' },
      { id: 'employee_name', label: 'Name', sample: 'John Doe', width: '150px' },
      { id: 'doj', label: 'Date of Joining', sample: '2024-01-01', width: '120px', type: 'date' },
      { id: 'proposedSalary', label: 'Proposed Salary', sample: 50000, width: '120px', type: 'number' },
    ];

    permanentFields.forEach(f => {
      headers.push(f.id);
      sample[f.id] = f.sample;
      columns.push({ key: f.id, label: f.label, width: f.width, type: f.type || 'text' });
    });

    // Division, Department and Designation names (for matching)
    headers.push('division_name');
    sample['division_name'] = 'Main Division';
    columns.push({ key: 'division_name', label: 'Division' });

    headers.push('department_name');
    sample['department_name'] = 'Information Technology';
    columns.push({ key: 'department_name', label: 'Department' });

    headers.push('designation_name');
    sample['designation_name'] = 'Software Developer';
    columns.push({ key: 'designation_name', label: 'Designation' });

    if (opts?.includeEmployeeGroup) {
      headers.push('group_name');
      sample['group_name'] = 'Example Group';
      columns.push({ key: 'group_name', label: 'Employee group' });
    }

    // Add fields from settings
    settings.groups.forEach((group: any) => {
      if (!group.isEnabled) return;
      group.fields.forEach((field: any) => {
        if (!field.isEnabled) return;

        // CRITICAL CLEANUP: Skip technical ID fields and already added permanent fields
        if (field.id.endsWith('_id') ||
          field.id === 'department' ||
          field.id === 'designation' ||
          headers.includes(field.id)) return;

        headers.push(field.id);

        // Value placeholder/sample
        if (field.type === 'date') {
          sample[field.id] = '2024-01-01';
          columns.push({ key: field.id, label: field.label, type: 'date' });
        } else if (field.type === 'number') {
          sample[field.id] = 0;
          columns.push({ key: field.id, label: field.label, type: 'number' });
        } else if (field.type === 'select' || field.type === 'multiselect') {
          sample[field.id] = field.options?.[0]?.value || '';
          columns.push({ key: field.id, label: field.label, type: 'select', options: field.options });
        } else if (field.type === 'userselect') {
          sample[field.id] = 'Employee Name';
          columns.push({ key: field.id, label: field.label, type: 'select' }); // Type select for mapping
        } else if (field.type === 'array' || field.type === 'object') {
          if (field.id === 'qualifications' || field.id === 'experience') return;
          sample[field.id] = field.type === 'array' ? 'item1, item2' : 'key1:val1|key2:val2';
          columns.push({ key: field.id, label: field.label });
        } else {
          sample[field.id] = '';
          columns.push({ key: field.id, label: field.label });
        }
      });
    });

    // Special handling for qualifications if enabled
    if (settings.qualifications?.isEnabled) {
      if (!headers.includes('qualifications')) {
        const qualFields = settings.qualifications.fields || [];
        const format = qualFields.map((f: any) => f.label || f.id).join(':');

        headers.push('qualifications');
        sample['qualifications'] = `${format}, ${format}`;
        columns.push({
          key: 'qualifications',
          label: 'Qualifications',
          width: '300px',
          tooltip: `Format: ${format} (Comma separated for multiple entries, colons for internal fields)`
        });
      }
    }

    setDynamicTemplate({
      headers,
      sample: [sample],
      columns: columns.map(c => ({ ...c, width: c.width || '150px' }))
    });
  };

  useEffect(() => {
    if (formSettings) {
      generateDynamicTemplate(formSettings, { includeEmployeeGroup: customEmployeeGroupingEnabled });
    }
  }, [formSettings, customEmployeeGroupingEnabled]);

  const toggleSelectApplication = (id: string) => {
    setSelectedApplicationIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleBulkApprove = async () => {
    if (selectedApplicationIds.length === 0) return;

    if (!confirm(`Are you sure you want to approve ${selectedApplicationIds.length} selected applications using their proposed salaries?`)) {
      return;
    }

    try {
      setLoadingApplications(true);
      setError('');
      setSuccess('');

      // Simple bulk settings: proposed salary for all, today's DOJ
      const bulkSettings = {
        doj: new Date().toISOString().split('T')[0],
        comments: 'Bulk approved',
      };

      const response = await api.bulkApproveEmployeeApplications(selectedApplicationIds, bulkSettings);

      if (response.success) {
        setSuccess(`Bulk approval completed! Succeeded: ${response.data.successCount}, Failed: ${response.data.failCount}`);
      } else {
        setError(response.message || 'Bulk approval failed or partially failed');
        if (response.data?.successCount > 0) {
          setSuccess(`Partially completed. Succeeded: ${response.data.successCount}`);
        }
      }

      setSelectedApplicationIds([]);
      loadApplications();
      loadEmployees();
    } catch (err: any) {
      setError(err.message || 'An error occurred during bulk approval');
      console.error(err);
    } finally {
      setLoadingApplications(false);
    }
  };

  const handleBulkReject = async () => {
    if (selectedApplicationIds.length === 0) return;

    if (!confirm(`Are you sure you want to REJECT ${selectedApplicationIds.length} selected applications? This action cannot be undone.`)) {
      return;
    }

    try {
      setLoadingApplications(true);
      setError('');
      setSuccess('');

      const response = await api.bulkRejectEmployeeApplications(selectedApplicationIds, 'Bulk rejected via dashboard');

      if (response.success) {
        setSuccess(`Bulk rejection completed! Succeeded: ${response.data.successCount}, Failed: ${response.data.failCount}`);
      } else {
        setError(response.message || 'Bulk rejection failed or partially failed');
        if (response.data?.successCount > 0) {
          setSuccess(`Partially completed. Succeeded: ${response.data.successCount}`);
        }
      }

      setSelectedApplicationIds([]);
      loadApplications();
    } catch (err: any) {
      setError(err.message || 'An error occurred during bulk rejection');
      console.error(err);
    } finally {
      setLoadingApplications(false);
    }
  };

  const parseDynamicField = (value: any, fieldDef: any) => {
    if (value === undefined || value === null || value === '') return undefined;

    if (fieldDef.type === 'array') {
      if (fieldDef.dataType === 'object' || fieldDef.itemType === 'object') {
        return String(value).split(',').map((item: string) => {
          const obj: any = {};
          const trimmedItem = item.trim();
          if (trimmedItem.includes('|')) {
            trimmedItem.split('|').forEach(part => {
              const [k, v] = part.split(':').map(s => s.trim());
              if (k && v) obj[k] = v;
            });
          } else if (trimmedItem.includes(':')) {
            const parts = trimmedItem.split(':').map(s => s.trim());
            // Map each part to the corresponding field in the schema
            const fields = fieldDef.itemSchema?.fields || fieldDef.fields || [];
            parts.forEach((val, idx) => {
              if (fields[idx]) {
                const key = fields[idx].label || fields[idx].id;
                obj[key] = val;
              }
            });
          } else {
            // Just a string
            const fields = fieldDef.itemSchema?.fields || fieldDef.fields || [];
            if (fields[0]) {
              const key = fields[0].label || fields[0].id;
              obj[key] = trimmedItem;
            }
          }
          return obj;
        });
      } else {
        return String(value).split(',').map((item: string) => item.trim());
      }
    }

    if (fieldDef.type === 'object') {
      const obj: any = {};
      String(value).split('|').forEach((part: string) => {
        const [k, v] = part.split(':').map((s: string) => s.trim());
        if (k && v) obj[k] = v;
      });
      return obj;
    }

    if (fieldDef.type === 'number') return Number(value);

    return value;
  };

  const loadUpdateRequests = async () => {
    try {
      setLoadingUpdateRequests(true);
      const res = await api.getEmployeeUpdateRequests({
        status: updateRequestStatusFilter !== 'all' ? updateRequestStatusFilter : undefined
      });
      if (res.success) {
        setUpdateRequests(res.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch update requests');
    } finally {
      setLoadingUpdateRequests(false);
    }
  };

  const handleApproveUpdateRequest = async (id: string) => {
    const result = await alertConfirm(
      'Approve Changes?',
      'Are you sure you want to approve these changes? The employee profile will be updated immediately.'
    );
    if (!result.isConfirmed) return;

    try {
      setProcessingUpdateRequest(true);
      const res = await api.approveEmployeeUpdateRequest(id);
      if (res.success) {
        await alertSuccess('Approved!', 'Request approved successfully');
        setSelectedUpdateRequest(null);
        setShowViewDialog(false);
        setViewingEmployee(null);
        loadUpdateRequests();
        loadEmployees(currentPage);

      } else {
        await alertError('Failed', res.message || 'Failed to approve request');
      }
    } catch (err) {
      await alertError('Error', 'An error occurred');
    } finally {
      setProcessingUpdateRequest(false);
    }
  };

  const handleRejectUpdateRequest = async (id: string) => {
    if (!updateRequestRejectComments.trim()) {
      await alertError('Required', 'Please provide a reason for rejection');
      return;
    }

    try {
      setProcessingUpdateRequest(true);
      const res = await api.rejectEmployeeUpdateRequest(id, updateRequestRejectComments);
      if (res.success) {
        await alertSuccess('Rejected', 'Request rejected');
        setSelectedUpdateRequest(null);
        setShowViewDialog(false);
        setViewingEmployee(null);
        setUpdateRequestRejectComments('');
        loadUpdateRequests();

      } else {
        await alertError('Failed', res.message || 'Failed to reject request');
      }
    } catch (err) {
      await alertError('Error', 'An error occurred');
    } finally {
      setProcessingUpdateRequest(false);
    }
  };

  const loadEmployees = async (pageNum: number = 1) => {
    try {
      setLoading(true);

      const response = await api.getEmployees({
        includeLeft: includeLeftEmployees,
        search: searchQuery,
        division_id: selectedDivisionFilter,
        department_id: selectedDepartmentFilter,
        designation_id: selectedDesignationFilter,
        employee_group_id: selectedEmployeeGroupFilter || undefined,
        page: pageNum,
        limit: itemsPerPage,
      });

      if (response.success) {
        // Normalize employee data
        const employeesData = (response.data || []).map((emp: any) => ({
          ...emp,
          division: emp.division || (typeof emp.division_id === 'object' ? emp.division_id : null),
          department: emp.department || (typeof emp.department_id === 'object' ? emp.department_id : null),
          designation: emp.designation || (typeof emp.designation_id === 'object' ? emp.designation_id : null),
        }));

        setEmployees(employeesData);
        setDataSource(response.dataSource || 'mongodb');

        // Update pagination state
        const pagination = (response as any).pagination;
        if (pagination) {
          setTotalCount(pagination.total);
          setTotalPages(pagination.totalPages);
          setCurrentPage(pagination.page);
        }
      }
    } catch (err) {
      console.error('Error loading employees:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleBulkResendCredentials = async () => {
    const result = await alertConfirm(
      'Bulk Resend Credentials?',
      `This will resend login credentials to all employees matching the current filters (${totalCount} found). This operation may take some time.`,
      'Yes, Resend All'
    );

    if (result.isConfirmed) {
      alertLoading('Resending Credentials', 'Processing bulk requests, please wait...');
      try {
        const response = await api.bulkResendCredentials({
          search: searchQuery,
          divisionId: selectedDivisionFilter,
          departmentId: selectedDepartmentFilter,
          designationId: selectedDesignationFilter,
          includeLeft: includeLeftEmployees ? 'true' : 'false'
        });

        if (response.success) {
          alertSuccess(
            'Success',
            `Bulk resend operation complete. Sent: ${response.data.successCount}, Failed: ${response.data.failCount}`
          );
        } else {
          alertError('Failed', response.message || 'Error occurred during bulk resend');
        }
      } catch (err: any) {
        console.error('Error in bulk resend:', err);
        alertError('Error', err.message || 'An unexpected error occurred');
      }
    }
  };

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSearchQuery(searchTerm);
  };

  const loadDepartments = async () => {
    try {
      const response = await api.getDepartments();
      if (response.success) {
        setDepartments((response.data as any) || []);
      }

      const designationsResponse = await api.getAllDesignations();
      if (designationsResponse.success && designationsResponse.data) {
        setDesignations(designationsResponse.data);
      }
    } catch (err) {
      console.error('Error loading departments:', err);
    }
  };

  // Department options: when a division is selected, use that division's departments (from getDivisions — for workspace this is divisionMapping-only; for superadmin full link)
  const departmentOptions = useMemo(() => {
    if (selectedDivisionFilter) {
      const divId = String(selectedDivisionFilter);
      const div = divisions.find((d) => String(d._id) === divId);
      const depts = (div?.departments ?? []) as (string | Department)[];
      return depts.map((d) => (typeof d === 'string' ? { _id: d, name: d } : { _id: (d as any)._id, name: (d as any).name, code: (d as any).code }));
    }
    return departments;
  }, [selectedDivisionFilter, divisions, departments]);

  // Id -> name maps for resolving division/department/designation in history (e.g. previous value was raw ObjectId)
  const historyRefNames = useMemo(() => {
    const divMap: Record<string, string> = {};
    const deptMap: Record<string, string> = {};
    const desMap: Record<string, string> = {};
    (divisions || []).forEach((d: any) => {
      if (d._id != null && d.name != null) divMap[String(d._id)] = d.name;
    });
    (departments || []).forEach((d: any) => {
      if (d._id != null && d.name != null) deptMap[String(d._id)] = d.name;
    });
    (divisions || []).forEach((div: any) => {
      ((div.departments as any[]) || []).forEach((d: any) => {
        const id = typeof d === 'string' ? d : d?._id;
        const name = typeof d === 'string' ? d : d?.name;
        if (id != null && name != null) deptMap[String(id)] = name;
      });
    });
    (designations || []).forEach((d: any) => {
      if (d._id != null && d.name != null) desMap[String(d._id)] = d.name;
    });
    return { division: divMap, department: deptMap, designation: desMap };
  }, [divisions, departments, designations]);

  // Derived state for the currently viewed employee in the View Dialog
  const pendingUpdateForViewing = useMemo(() => {
    if (!viewingEmployee) return null;
    return updateRequests.find(r => r.emp_no === viewingEmployee.emp_no && r.status === 'pending');
  }, [viewingEmployee, updateRequests]);

  const pendingAppForViewing = useMemo(() => {
    if (!viewingEmployee) return null;
    return applications.find(a => a.emp_no === viewingEmployee.emp_no && a.status === 'verified');
  }, [viewingEmployee, applications]);


  // Trigger search and filter
  useEffect(() => {
    loadEmployees(1);
    // Also fetch requests count if not on requests tab to show badge if needed
    if (activeTab !== 'requests') {
      loadUpdateRequests();
    }
  }, [searchQuery, selectedDivisionFilter, selectedDepartmentFilter, selectedDesignationFilter, selectedEmployeeGroupFilter, includeLeftEmployees, itemsPerPage]);

  useEffect(() => {
    if (activeTab === 'requests') {
      loadUpdateRequests();
    }
  }, [activeTab, updateRequestStatusFilter]);

  const loadApplications = async () => {
    try {
      setLoadingApplications(true);
      const search = (applicationSearchTerm || searchTerm || '').trim() || undefined;
      const response = await api.getEmployeeApplications({
        ...(selectedDivisionFilter ? { division_id: selectedDivisionFilter } : {}),
        ...(selectedDepartmentFilter ? { department_id: selectedDepartmentFilter } : {}),
        ...(selectedDesignationFilter ? { designation_id: selectedDesignationFilter } : {}),
        ...(selectedEmployeeGroupFilter ? { employee_group_id: selectedEmployeeGroupFilter } : {}),
        ...(search ? { search } : {}),
      });
      if (response.success) {
        // Normalize applications data for consistent filtering
        const apps = (response.data || []).map((app: any) => ({
          ...app,
          // Ensure department is always an object with name if available in department_id
          department: app.department || (typeof app.department_id === 'object' ? app.department_id : undefined),
          // Ensure designation is also normalized if needed (though likely not populated in same way, but good practice)
          designation: app.designation || (typeof app.designation_id === 'object' ? app.designation_id : undefined),
          employee_group: app.employee_group || (typeof app.employee_group_id === 'object' ? app.employee_group_id : undefined),
        }));
        setApplications(apps);
        setSelectedApplicationIds([]); // Reset selection on reload
      }
    } catch (err) {
      console.error('Error loading applications:', err);
    } finally {
      setLoadingApplications(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    const processedValue = type === 'number'
      ? (value === '' ? (name === 'paidLeaves' || name === 'allottedLeaves' ? 0 : undefined) : Number(value))
      : value;

    setFormData(prev => {
      const updated: any = {
        ...prev,
        [name]: processedValue,
      };

      // Sync gross_salary and proposedSalary so calculations work with either field
      if (name === 'gross_salary') {
        updated.proposedSalary = processedValue as number;
      } else if (name === 'proposedSalary') {
        updated.gross_salary = processedValue as number;
      }

      return updated;
    });
  };

  const handleApplicationInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    // Convert empty strings to null/undefined for enum fields
    const enumFields = ['gender', 'marital_status', 'blood_group'];
    let processedValue = value;
    if (enumFields.includes(name) && value === '') {
      processedValue = null as any;
    } else if (type === 'number') {
      processedValue = (value ? Number(value) : undefined) as any;
    }
    setApplicationFormData(prev => ({
      ...prev,
      [name]: processedValue,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const requireEmpNo = !editingEmployee && !addFormAutoGenerateEmpNo;
    if (requireEmpNo && !formData.emp_no) {
      setError('Employee No and Name are required');
      return;
    }
    if (!formData.employee_name) {
      setError('Employee name is required');
      return;
    }

    try {
      // Build allowances and deductions: all existing employee overrides (with form edits) + any new overrides from global/dept
      let employeeAllowances = buildOverridePayload(
        componentDefaults.allowances,
        overrideAllowances,
        overrideAllowancesBasedOnPresentDays,
        'allowance',
        editingEmployee?.employeeAllowances
      );
      let employeeDeductions = buildOverridePayload(
        componentDefaults.deductions,
        overrideDeductions,
        overrideDeductionsBasedOnPresentDays,
        'deduction',
        editingEmployee?.employeeDeductions
      );

      // DEBUG: Check formData before creating submitData
      console.log('DEBUG: formData.gross_salary:', formData.gross_salary);

      // Clean up enum fields - convert empty strings to null/undefined
      const submitData = {
        ...formData,
        employeeAllowances,
        employeeDeductions,
        paidLeaves: formData.paidLeaves !== null && formData.paidLeaves !== undefined ? formData.paidLeaves : 0,
        allottedLeaves: formData.allottedLeaves !== null && formData.allottedLeaves !== undefined ? formData.allottedLeaves : 0,
        ctcSalary: salarySummary.ctcSalary,
        calculatedSalary: salarySummary.netSalary,
      };

      // DEBUG: Check submitData after creation
      console.log('DEBUG: submitData.gross_salary:', (submitData as any).gross_salary);

      // Consolidate 'reporting_to' and 'reporting_to_' - ensure we use 'reporting_to' only
      // If reporting_to_ has data and reporting_to is empty, use the data from reporting_to_
      if ((submitData as any).reporting_to_ && Array.isArray((submitData as any).reporting_to_) && (submitData as any).reporting_to_.length > 0) {
        if (!(submitData as any).reporting_to || !Array.isArray((submitData as any).reporting_to) || (submitData as any).reporting_to.length === 0) {
          (submitData as any).reporting_to = (submitData as any).reporting_to_;
        }
      }
      // Remove the redundant underscores field from payload
      delete (submitData as any).reporting_to_;
      delete (submitData as any).dynamicFields?.reporting_to_;

      const enumFields = ['gender', 'marital_status', 'blood_group'];
      enumFields.forEach(field => {
        if ((submitData as any)[field] === '' || (submitData as any)[field] === undefined) {
          (submitData as any)[field] = null;
        }
      });
      // Convert empty strings to undefined for other optional fields
      Object.keys(submitData).forEach(key => {
        if ((submitData as any)[key] === '' && !enumFields.includes(key) && key !== 'qualifications') {
          (submitData as any)[key] = undefined;
        }
      });

      // Construct FormData for multipart/form-data submission
      const payload = new FormData();

      // Append standard fields
      Object.entries(submitData).forEach(([key, value]) => {
        if (key === 'qualifications') return; // Handle separately
        if (value === undefined || value === null) return;

        if (typeof value === 'object' && !(value instanceof Date)) {
          payload.append(key, JSON.stringify(value));
        } else {
          payload.append(key, String(value));
        }
      });

      // DEBUG: Inspect payload
      console.log('DEBUG: Final Payload Entries (Standard):', Array.from((payload as any).entries ? (payload as any).entries() : []));

      // Handle Qualifications - Merge pre-filled rows (from settings) + applicant rows; map Field IDs to Labels
      const defaultRows = Array.isArray(formSettings?.qualifications?.defaultRows) ? formSettings.qualifications.defaultRows : [];
      const applicantQuals = Array.isArray(formData.qualifications) ? formData.qualifications : [];
      const isNewEmployee = !editingEmployee;
      const qualities = isNewEmployee
        ? [
          ...defaultRows.map((r: any) => ({ ...r, isPreFilled: true })),
          ...applicantQuals.map((q: any) => ({ ...q, isPreFilled: false })),
        ]
        : (Array.isArray(formData.qualifications) ? formData.qualifications : []);
      console.log('Skills/Qualities before processing:', qualities);

      const fieldIdToLabelMap: Record<string, string> = {};
      if (formSettings?.qualifications?.fields) {
        formSettings.qualifications.fields.forEach((f: any) => {
          fieldIdToLabelMap[f.id] = f.label;
        });
      }

      const cleanQualifications = qualities.map((q: any, index: number) => {
        const { certificateFile, isPreFilled, ...rest } = q;
        console.log(`Processing qual ${index}, has certificate file?`, !!certificateFile);
        if (certificateFile) console.log('File details:', certificateFile.name, certificateFile.type, certificateFile.size);

        const transformedQ: any = {};
        Object.entries(rest).forEach(([key, val]) => {
          const label = fieldIdToLabelMap[key] || key;
          transformedQ[label] = val;
        });
        if (isPreFilled !== undefined) transformedQ.isPreFilled = isPreFilled;

        if (certificateFile instanceof File) {
          payload.append(`qualification_cert_${index}`, certificateFile);
        }
        return transformedQ;
      });
      payload.append('qualifications', JSON.stringify(cleanQualifications));

      let response;
      if (editingEmployee) {
        response = await api.updateEmployee(editingEmployee.emp_no, payload as any);
      } else {
        response = await api.createEmployee(payload as any);
      }

      if (response.success) {
        setSuccess(response.message || (editingEmployee ? 'Employee updated successfully!' : 'Employee created successfully!'));
        setShowDialog(false);
        setEditingEmployee(null);
        setFormData(initialFormState);
        setComponentDefaults({ allowances: [], deductions: [] });
        setOverrideAllowances({});
        setOverrideDeductions({});
        loadEmployees();
      } else {
        // Display validation errors if available
        const errorMsg = response.message || 'Operation failed';
        const errorDetails = (response as any).errors ? Object.values((response as any).errors).join(', ') : '';
        setError(errorDetails ? `${errorMsg}: ${errorDetails}` : errorMsg);
        console.error('Update error:', response);
      }
    } catch (err) {
      setError('An error occurred');
      console.error(err);
    }
  };

  const handleEdit = (record: any) => {
    // Determine if we are editing an Employee or an Application based on activeTab
    if (activeTab === 'applications') {
      // --- APPLICATION EDIT LOGIC ---
      setEditingApplicationID(record._id);

      // Clone data to avoid mutation
      const appData = { ...record };

      // Reverse Map Qualification Labels -> Field IDs
      const appQualFields = formSettings?.qualifications?.fields;
      if (appData.qualifications && Array.isArray(appData.qualifications) && appQualFields) {
        appData.qualifications = appData.qualifications.map((q: any) => {
          const newQ: any = {};
          if (q.certificateUrl) newQ.certificateUrl = q.certificateUrl;
          if (q.isPreFilled !== undefined) newQ.isPreFilled = q.isPreFilled;

          Object.entries(q).forEach(([key, val]) => {
            if (key === 'certificateUrl' || key === 'isPreFilled') return;
            const fieldDef = appQualFields.find((f: any) => f.label === key);
            if (fieldDef) {
              newQ[fieldDef.id] = val;
            } else {
              newQ[key] = val;
            }
          });
          return newQ;
        });
      }

      setApplicationFormData(appData);
      setShowApplicationDialog(true);
      return;
    }

    // --- EMPLOYEE EDIT LOGIC (Existing) ---
    const employee = record as Employee;

    // Clone employee to avoid mutation during transformation
    const empData = { ...employee };

    // Reverse Map Qualification Labels -> Field IDs (Fix for Missing Values on Edit)
    const qualFields = formSettings?.qualifications?.fields;
    if (empData.qualifications && Array.isArray(empData.qualifications) && qualFields) {
      empData.qualifications = empData.qualifications.map((q: any) => {
        const newQ: any = {};
        if (q.certificateUrl) newQ.certificateUrl = q.certificateUrl;
        if (q.isPreFilled !== undefined) newQ.isPreFilled = q.isPreFilled;

        Object.entries(q).forEach(([key, val]) => {
          if (key === 'certificateUrl' || key === 'isPreFilled') return;
          const fieldDef = qualFields.find((f: any) => f.label === key);
          if (fieldDef) {
            newQ[fieldDef.id] = val;
          } else {
            newQ[key] = val;
          }
        });
        return newQ;
      });
    }

    setEditingEmployee(empData as Employee); // Use transform data
    setEditingApplicationID(null);

    // Extract paidLeaves
    let paidLeavesValue = 0;
    if (employee.paidLeaves !== undefined && employee.paidLeaves !== null) {
      paidLeavesValue = Number(employee.paidLeaves);
    } else if ((employee as any).paidLeaves !== undefined && (employee as any).paidLeaves !== null) {
      paidLeavesValue = Number((employee as any).paidLeaves);
    } else {
      const rawEmployee = employee as any;
      if (rawEmployee.paidLeaves !== undefined && rawEmployee.paidLeaves !== null) {
        paidLeavesValue = Number(rawEmployee.paidLeaves);
      }
    }

    // Extract allottedLeaves
    let allottedLeavesValue = 0;
    if (employee.allottedLeaves !== undefined && employee.allottedLeaves !== null) {
      allottedLeavesValue = Number(employee.allottedLeaves);
    } else if ((employee as any).allottedLeaves !== undefined && (employee as any).allottedLeaves !== null) {
      allottedLeavesValue = Number((employee as any).allottedLeaves);
    } else {
      const rawEmployee = employee as any;
      if (rawEmployee.allottedLeaves !== undefined && rawEmployee.allottedLeaves !== null) {
        allottedLeavesValue = Number(rawEmployee.allottedLeaves);
      }
    }

    // Get qualifications - check if it's an array (new format) or string (old format)
    let qualificationsValue: any[] = [];


    if (Array.isArray(employee.qualifications)) {
      qualificationsValue = employee.qualifications.map((qual: any) => {
        const normalized: any = {};

        // Strategy: Iterate through form settings fields to find values in the stored qualification object
        if (formSettings?.qualifications?.fields) {
          formSettings.qualifications.fields.forEach((field: any) => {
            const fieldId = field.id;
            const fieldLabel = field.label;

            // Search for the value using the Label (case-insensitive) as key
            const foundKey = Object.keys(qual).find(k => k.toLowerCase() === fieldLabel.toLowerCase());
            if (foundKey) {
              normalized[fieldId] = qual[foundKey];
            } else {
              // Fallback: Check if the ID itself is used as a key
              const foundIdKey = Object.keys(qual).find(k => k.toLowerCase() === fieldId.toLowerCase());
              if (foundIdKey) {
                normalized[fieldId] = qual[foundIdKey];
              }
            }
          });
        }

        // Always preserve certificate fields, isPreFilled, and normalize casing
        Object.keys(qual).forEach(key => {
          const lowerKey = key.toLowerCase();
          if (lowerKey === 'certificateurl') {
            normalized.certificateUrl = qual[key];
          } else if (lowerKey === 'certificatefile') {
            normalized.certificateFile = qual[key];
          } else if (lowerKey === 'isprefilled' || key === 'isPreFilled') {
            normalized.isPreFilled = qual[key];
          }
        });

        // Fallback if no settings or empty normalized
        if (Object.keys(normalized).length === 0 && (!formSettings?.qualifications?.fields || formSettings.qualifications.fields.length === 0)) {
          return { ...qual };
        }

        return normalized;
      });
    } else if (typeof employee.qualifications === 'string') {
      // Old format - convert to array with examination only
      qualificationsValue = employee.qualifications.split(',').map(s => ({ examination: s.trim() }));
    }

    // Also check in dynamicFields only if qualificationsValue is empty (to avoid overwriting valid data)
    if (qualificationsValue.length === 0 && employee.dynamicFields?.qualifications) {
      if (Array.isArray(employee.dynamicFields.qualifications)) {
        qualificationsValue = employee.dynamicFields.qualifications.map((qual: any) => {
          const normalized: any = {};

          Object.keys(qual).forEach(key => {
            const lowerKey = key.toLowerCase();
            if (key === 'certificateUrl' || key === 'certificateFile' || key === 'isPreFilled') {
              normalized[key] = qual[key];
            } else {
              normalized[lowerKey] = qual[key];
            }
          });

          return normalized;
        });
      }
    }

    // Merge dynamicFields into formData
    const dynamicFieldsData = employee.dynamicFields || {};

    // Handle reporting_to field - extract user IDs from populated objects or use existing IDs
    let reportingToValue: string[] = [];
    const reportingToField = (employee as any).reporting_to || (employee as any).reporting_to_ || dynamicFieldsData.reporting_to || dynamicFieldsData.reporting_to_;
    if (reportingToField && Array.isArray(reportingToField)) {
      reportingToValue = reportingToField.map((item: any) => {
        // If it's a populated user object, extract the _id
        if (typeof item === 'object' && item._id) {
          return item._id;
        }
        // If it's already a string ID, use it directly
        return String(item);
      }).filter(Boolean);
    }

    // Map gross_salary to proposedSalary for the form (form uses proposedSalary field)
    const salaryValue = employee.gross_salary || dynamicFieldsData.proposedSalary || 0;

    // Create form data object - merge all fields including dynamicFields
    const newFormData: any = {
      ...employee,
      department_id: employee.department?._id || employee.department_id || '',
      designation_id: employee.designation?._id || employee.designation_id || '',
      division_id: employee.division?._id || employee.division_id || '',
      doj: employee.doj ? new Date(employee.doj).toISOString().split('T')[0] : '',
      dob: employee.dob ? new Date(employee.dob).toISOString().split('T')[0] : '',
      paidLeaves: paidLeavesValue,
      allottedLeaves: allottedLeavesValue,
      qualifications: qualificationsValue,
      // Map gross_salary to proposedSalary for form compatibility
      proposedSalary: salaryValue,
      gross_salary: salaryValue,
      // Prefill employee overrides if present
      employeeAllowances: Array.isArray(employee.employeeAllowances) ? employee.employeeAllowances : [],
      employeeDeductions: Array.isArray(employee.employeeDeductions) ? employee.employeeDeductions : [],
      // Merge dynamicFields at root level for form
      ...dynamicFieldsData,
      // Override with processed values (after dynamicFields so they take precedence)
      second_salary: employee.second_salary, // Ensure root value takes precedence over dynamicFields
      reporting_to: reportingToValue,
      reporting_to_: reportingToValue,
      // Salary mode dropdown defaults to Cash when editing if not set
      salary_mode: (employee as any).salary_mode ?? dynamicFieldsData.salary_mode ?? 'Cash',
    };

    setFormData(newFormData);
    setShowDialog(true);

    // Pre-populate override state from existing employee overrides
    if (Array.isArray(employee.employeeAllowances) && employee.employeeAllowances.length > 0) {
      const allowanceOverrides: Record<string, number | null> = {};
      const allowanceBasedOnPresentDays: Record<string, boolean> = {};
      employee.employeeAllowances.forEach((allowance: any) => {
        const key = allowance.masterId ? allowance.masterId.toString() : (allowance.name || '').toLowerCase();
        if (key && (allowance.amount !== null && allowance.amount !== undefined)) {
          allowanceOverrides[key] = Number(allowance.amount);
          allowanceBasedOnPresentDays[key] = allowance.basedOnPresentDays ?? false;
        }
      });
      setOverrideAllowances(allowanceOverrides);
      setOverrideAllowancesBasedOnPresentDays(allowanceBasedOnPresentDays);
    }

    if (Array.isArray(employee.employeeDeductions) && employee.employeeDeductions.length > 0) {
      const deductionOverrides: Record<string, number | null> = {};
      const deductionBasedOnPresentDays: Record<string, boolean> = {};
      employee.employeeDeductions.forEach((deduction: any) => {
        const key = deduction.masterId ? deduction.masterId.toString() : (deduction.name || '').toLowerCase();
        if (key && (deduction.amount !== null && deduction.amount !== undefined)) {
          deductionOverrides[key] = Number(deduction.amount);
          deductionBasedOnPresentDays[key] = deduction.basedOnPresentDays ?? false;
        }
      });
      setOverrideDeductions(deductionOverrides);
      setOverrideDeductionsBasedOnPresentDays(deductionBasedOnPresentDays);
    }

    // Trigger fetch of component defaults after a brief delay to ensure formData is set
    // This ensures recalculation happens when editing
    // Use preserveOverrides: true to keep the overrides we just set
    setTimeout(() => {
      const deptId = newFormData.department_id;
      const gross = newFormData.gross_salary;
      if (deptId && gross !== undefined && gross !== null && gross > 0) {
        fetchComponentDefaults(deptId as string, Number(gross), employee.emp_no, true);
      }
    }, 100);
  };

  const handleDeactivate = async (empNo: string, currentStatus: boolean) => {
    if (updatingStatusIds.has(empNo)) return; // Prevent duplicate clicks

    const action = currentStatus ? 'deactivate' : 'activate';
    if (!confirm(`Are you sure you want to ${action} this employee?`)) return;

    // Track this employee as updating
    setUpdatingStatusIds(prev => new Set(prev).add(empNo));

    // Optimistic update for immediate feedback
    setEmployees((prev) =>
      prev.map((e) => (e.emp_no === empNo ? { ...e, is_active: !currentStatus } : e))
    );

    try {
      console.log(`Attempting to ${action} employee ${empNo}.`);
      const response = await api.updateEmployee(empNo, { is_active: !currentStatus });
      console.log(`API response for ${action} employee ${empNo}:`, response);

      if (response.success) {
        const syncMessage = response.syncError ? ' (MSSQL sync failed, but local update succeeded)' : '';
        setSuccess(`Employee ${action}d successfully!${syncMessage}`);
        // Update with actual server data if available to ensure consistency
        if (response.data) {
          setEmployees((prev) =>
            prev.map((e) =>
              e.emp_no === empNo ? { ...e, ...response.data } : e
            )
          );
        }
      } else {
        setError(response.message || `Failed to ${action} employee`);
        // Revert on failure
        setEmployees((prev) =>
          prev.map((e) => (e.emp_no === empNo ? { ...e, is_active: currentStatus } : e))
        );
      }
    } catch (err) {
      setError('An error occurred');
      console.error(err);
      // Revert on error
      setEmployees((prev) =>
        prev.map((e) => (e.emp_no === empNo ? { ...e, is_active: currentStatus } : e))
      );
    } finally {
      // Clear updating status
      setUpdatingStatusIds(prev => {
        const next = new Set(prev);
        next.delete(empNo);
        return next;
      });
    }
  };


  const handleSetLeftDate = (employee: Employee) => {
    setSelectedEmployeeForLeftDate(employee);
    const defaultLastWorking = (() => {
      const d = new Date();
      return d.toISOString().split('T')[0];
    })();
    setLeftDateForm({
      leftDate: employee.leftDate ? new Date(employee.leftDate).toISOString().split('T')[0] : defaultLastWorking,
      leftReason: employee.leftReason || '',
      requestType: 'resignation',
    });
    setShowLeftDateModal(true);
  };

  const handleSubmitLeftDate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployeeForLeftDate) return;

    if (!leftDateForm.leftDate) {
      setError('Left date is required');
      return;
    }

    try {
      setError('');
      setSuccess('');
      const resSettings = await api.getResignationSettings();
      const workflowEnabled = resSettings?.success && resSettings?.data?.workflow?.isEnabled !== false;

      if (workflowEnabled) {
        const response = await api.createResignationRequest({
          emp_no: selectedEmployeeForLeftDate.emp_no,
          leftDate: leftDateForm.leftDate,
          remarks: leftDateForm.leftReason || undefined,
          requestType: leftDateForm.requestType,
        } as any);
        if (response.success) {
          setSuccess('Resignation request submitted. It will be processed through the approval flow.');
          setShowLeftDateModal(false);
          setSelectedEmployeeForLeftDate(null);
          setLeftDateForm({ leftDate: '', leftReason: '' });
          loadEmployees();
        } else {
          setError(response.message || 'Failed to submit resignation request');
        }
      } else {
        const response = await api.setEmployeeLeftDate(
          selectedEmployeeForLeftDate.emp_no,
          leftDateForm.leftDate,
          leftDateForm.leftReason || undefined
        );
        if (response.success) {
          const syncMessage = response.syncError ? ' (MSSQL sync failed, but local update succeeded)' : '';
          setSuccess(`Employee left date set successfully!${syncMessage}`);
          setShowLeftDateModal(false);
          setSelectedEmployeeForLeftDate(null);
          setLeftDateForm({ leftDate: '', leftReason: '' });
          loadEmployees();
        } else {
          setError(response.message || 'Failed to set left date');
        }
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
      console.error(err);
    }
  };

  const handleRemoveLeftDate = async (employee: Employee) => {
    const result = await alertConfirm(
      'Reactivate employee?',
      `Are you sure you want to reactivate ${employee.employee_name}? This will remove their left date.`,
      'Yes, reactivate'
    );

    if (!result.isConfirmed) return;

    try {
      setError('');
      setSuccess('');
      const response = await api.removeEmployeeLeftDate(employee.emp_no);

      if (response.success) {
        await alertSuccess('Employee reactivated', 'Employee reactivated successfully!');
        loadEmployees();
      } else {
        await alertError('Failed to reactivate', response.message || 'Failed to reactivate employee');
      }
    } catch (err: any) {
      await alertError('An error occurred', err.message || 'An error occurred');
      console.error(err);
    }
  };

  const handleToggleDeductionPreference = async (key: string, value: boolean) => {
    if (!viewingEmployee) return;

    try {
      // Optimistic update
      const updatedEmployee = { ...viewingEmployee, [key]: value };
      setViewingEmployee(updatedEmployee as Employee);

      const response = await api.updateEmployee(viewingEmployee.emp_no, { [key]: value });

      if (response.success) {
        // Update the employees list as well if it's currently loaded
        setEmployees(prev => prev.map(emp => emp.emp_no === viewingEmployee.emp_no ? { ...emp, [key]: value } : emp));
      } else {
        // Rollback
        setViewingEmployee(viewingEmployee);
        await alertError('Failed to update', response.message || 'Failed to update deduction preference');
      }
    } catch (err: any) {
      setViewingEmployee(viewingEmployee);
      await alertError('Error', err.message || 'An error occurred');
      console.error(err);
    }
  };

  const handleViewEmployee = async (employee: Employee) => {
    // Initial set to show dialog immediately with available data
    setViewingEmployee(employee);
    setEmployeeViewTab('profile');
    setEmployeeHistory([]);
    setShowViewDialog(true);

    // Fetch latest data to ensure A&D overrides and other fields are fresh
    try {
      const response = await api.getEmployee(employee.emp_no);
      if (response.success && response.data) {
        setViewingEmployee(response.data);
      }
    } catch (error) {
      console.error('Error refreshing employee data:', error);
    }

    // Fetch employee history (Super Admin only; backend enforces authorization)
    try {
      setEmployeeHistoryLoading(true);
      const historyRes = await api.getEmployeeHistory(employee.emp_no);
      if (historyRes.success && Array.isArray(historyRes.data)) {
        setEmployeeHistory(historyRes.data);
      } else {
        setEmployeeHistory([]);
      }
    } finally {
      setEmployeeHistoryLoading(false);
    }

    // Check if there is a pending salary approval (verified application) for this employee
    const pendingApp = applications.find(a => a.emp_no === employee.emp_no && a.status === 'verified');
    if (pendingApp) {
      initApprovalState(pendingApp);
    }
  };



  const openCreateDialog = () => {
    setEditingEmployee(null);
    setFormData(initialFormState);
    setComponentDefaults({ allowances: [], deductions: [] });
    setOverrideAllowances({});
    setOverrideDeductions({});
    setShowDialog(true);
    setError('');
  };



  const filteredApplicationsBase = applications.filter(app => {
    const search = (applicationSearchTerm || searchTerm || '').trim();
    const matchesSearch = !search ||
      app.employee_name?.toLowerCase().includes(search.toLowerCase()) ||
      (app.emp_no ?? '')?.toString().toLowerCase().includes(search.toLowerCase()) ||
      ((app.department_id as any)?.name || app.department?.name || '')?.toLowerCase().includes(search.toLowerCase()) ||
      ((app.designation_id as any)?.name || app.designation?.name || '')?.toLowerCase().includes(search.toLowerCase());

    const appDivId = (app.division as any)?._id ?? (typeof app.division_id === 'string' ? app.division_id : (app.division_id as any)?._id);
    const appDivName = (app.division as any)?.name || (app.division_id as any)?.name || '';
    const divFilter = selectedDivisionFilter || applicationFilters['division.name'];
    const matchesDivision = !divFilter ||
      appDivId === selectedDivisionFilter ||
      appDivName === applicationFilters['division.name'];

    const appDeptId = typeof app.department_id === 'string' ? app.department_id : (app.department_id as any)?._id;
    const appDeptName = app.department?.name || (app.department_id as any)?.name || '';
    const deptFilter = selectedDepartmentFilter || applicationFilters['department.name'];
    const matchesDepartment = !deptFilter || appDeptId === selectedDepartmentFilter || appDeptName === applicationFilters['department.name'];

    const appDesigId = typeof app.designation_id === 'string' ? app.designation_id : (app.designation_id as any)?._id;
    const appDesigName = app.designation?.name || (app.designation_id as any)?.name || '';
    const desigFilter = selectedDesignationFilter || applicationFilters['designation.name'];
    const matchesDesignation = !desigFilter || appDesigId === selectedDesignationFilter || appDesigName === applicationFilters['designation.name'];

    return matchesSearch && matchesDivision && matchesDepartment && matchesDesignation;
  });

  // Apply column filters
  const filteredApplications = filterData(filteredApplicationsBase, applicationFilters);

  // Pagination Logic for Applications
  const totalApplicationPages = Math.ceil(filteredApplications.length / applicationRowsPerPage);
  const paginatedApplications = filteredApplications.slice(
    (applicationPage - 1) * applicationRowsPerPage,
    applicationPage * applicationRowsPerPage
  );

  const pendingApplications = filteredApplications.filter(app => app.status === 'pending');
  const pendingUpdateRequests = updateRequests.filter(r => r.status === 'pending');
  const approvedApplications = filteredApplications.filter(app => app.status === 'approved');
  const rejectedApplications = filteredApplications.filter(app => app.status === 'rejected');

  const handleCreateApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setFormErrors({});

    try {
      // 1. Clean up enum fields & Prepare Submit Data
      console.log('Submitting Application Payload:', applicationFormData); // DEBUG
      const submitData = {
        ...applicationFormData,
        employeeAllowances: buildOverridePayload(componentDefaults.allowances, overrideAllowances, overrideAllowancesBasedOnPresentDays, 'allowance'),
        employeeDeductions: buildOverridePayload(componentDefaults.deductions, overrideDeductions, overrideDeductionsBasedOnPresentDays, 'deduction'),
        ctcSalary: applicationSalarySummary.ctcSalary,
        calculatedSalary: applicationSalarySummary.netSalary,
      };

      const enumFields = ['gender', 'marital_status', 'blood_group'];
      enumFields.forEach(field => {
        if ((submitData as any)[field] === '' || (submitData as any)[field] === undefined) {
          (submitData as any)[field] = null;
        }
      });
      // Convert empty strings to undefined for other optional fields
      Object.keys(submitData).forEach(key => {
        if ((submitData as any)[key] === '' && !enumFields.includes(key) && key !== 'qualifications') {
          (submitData as any)[key] = undefined;
        }
      });

      // 2. Construct FormData
      const payload = new FormData();

      // Append standard fields
      Object.entries(submitData).forEach(([key, value]) => {
        if (key === 'qualifications') return; // Handle separately
        if (value === undefined || value === null) return;

        if (typeof value === 'object' && !(value instanceof Date)) {
          payload.append(key, JSON.stringify(value));
        } else {
          payload.append(key, String(value));
        }
      });

      // 3. Handle Qualifications (Label Mapping & Files)
      const qualities = Array.isArray(applicationFormData.qualifications) ? applicationFormData.qualifications : [];

      // Create a mapping from Field ID -> Label using formSettings
      const fieldIdToLabelMap: Record<string, string> = {};
      if (formSettings?.qualifications?.fields) {
        formSettings.qualifications.fields.forEach((f: any) => {
          fieldIdToLabelMap[f.id] = f.label;
        });
      }

      const cleanQualifications = qualities.map((q: any, index: number) => {
        const { certificateFile, ...rest } = q;

        // Transform keys from Field ID to Label
        const transformedQ: any = {};
        Object.entries(rest).forEach(([key, val]) => {
          const label = fieldIdToLabelMap[key] || key;
          transformedQ[label] = val;
        });

        if (certificateFile instanceof File) {
          payload.append(`qualification_cert_${index}`, certificateFile);
        }
        return transformedQ;
      });
      payload.append('qualifications', JSON.stringify(cleanQualifications));

      // 4. Submit
      let response;
      if (editingApplicationID) {
        response = await api.updateEmployeeApplication(editingApplicationID, payload as any);
      } else {
        response = await api.createEmployeeApplication(payload as any);
      }

      if (response.success) {
        setSuccess(editingApplicationID ? 'Application updated successfully!' : 'Application created successfully!');
        setShowApplicationDialog(false);
        setApplicationFormData({ ...initialFormState, qualifications: [], employeeAllowances: [], employeeDeductions: [] });
        setEditingApplicationID(null);
        // Refresh list
        loadApplications();
      } else {
        // Display validation errors if available
        const errorMsg = response.message || 'Operation failed';
        const errorDetails = (response as any).errors ? Object.values((response as any).errors).join(', ') : '';
        setError(errorDetails ? `${errorMsg}: ${errorDetails}` : errorMsg);
        console.error('Update error:', response);
      }
    } catch (err) {
      setError('An error occurred');
      console.error(err);
    }
  };

  const handleVerifyApplication = async (application: EmployeeApplication) => {
    if (!confirm(`Verify application for ${application.employee_name} and create employee record?`)) return;

    try {
      setLoadingApplications(true);
      setError('');
      setSuccess('');
      const response = await api.verifyEmployeeApplication(application._id);

      if (response.success) {
        setSuccess('Application verified and employee created! Now awaiting final salary approval.');
        loadApplications();
        loadEmployees();
      } else {
        setError(response.message || 'Verification failed');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoadingApplications(false);
    }
  };

  const handleApproveApplication = async () => {
    if (!selectedApplication) return;

    setError('');
    setSuccess('');

    if (!approvalData.approvedSalary || approvalData.approvedSalary <= 0) {
      setError('Valid approved salary is required');
      return;
    }

    if (!approvalData.doj) {
      setError('Date of Joining is required');
      return;
    }

    try {
      const response = await api.approveEmployeeSalary(selectedApplication._id, {
        approvedSalary: approvalData.approvedSalary,
        second_salary: (approvalData as any).second_salary || undefined,
        doj: approvalData.doj || undefined,
        comments: approvalData.comments,
        qualifications: (approvalData as any).qualifications,
        qualificationStatus: (approvalData as any).qualificationStatus,
        paidLeaves: (approvalData as any).paidLeaves,
        casualLeaves: (approvalData as any).casualLeaves,
        employeeAllowances: buildOverridePayload(approvalComponentDefaults.allowances, approvalOverrideAllowances, approvalOverrideAllowancesBasedOnPresentDays, 'allowance'),
        employeeDeductions: buildOverridePayload(approvalComponentDefaults.deductions, approvalOverrideDeductions, approvalOverrideDeductionsBasedOnPresentDays, 'deduction'),
        ctcSalary: approvalSalarySummary.ctcSalary,
        calculatedSalary: approvalSalarySummary.netSalary,
        applyESI: (approvalData as any).applyESI,
        applyProfessionTax: (approvalData as any).applyProfessionTax,
        applyAttendanceDeduction: (approvalData as any).applyAttendanceDeduction,
        deductLateIn: (approvalData as any).deductLateIn,
        deductEarlyOut: (approvalData as any).deductEarlyOut,
        deductPermission: (approvalData as any).deductPermission,
        deductAbsent: (approvalData as any).deductAbsent,
      } as any);

      if (response.success) {
        setSuccess(response.message || 'Application approved and employee created successfully!');
        setShowApprovalDialog(false);
        setShowViewDialog(false);
        setViewingEmployee(null);
        setSelectedApplication(null);

        setApprovalData({
          approvedSalary: 0,
          doj: '',
          comments: '',
          qualifications: [],
          qualificationStatus: 'Partial',
          paidLeaves: 0,
          casualLeaves: 0
        });
        loadApplications();
        loadEmployees(); // Reload employees list
      } else {
        setError(response.message || 'Failed to approve application');
      }
    } catch (err) {
      setError('An error occurred');
      console.error(err);
    }
  };

  const handleRejectApplication = async () => {
    if (!selectedApplication) return;

    setError('');
    setSuccess('');

    try {
      const response = await api.rejectEmployeeApplication(selectedApplication._id, {
        comments: approvalData.comments,
      });

      if (response.success) {
        setSuccess('Application rejected successfully!');
        setShowApprovalDialog(false);
        setShowViewDialog(false);
        setViewingEmployee(null);
        setSelectedApplication(null);

        setApprovalData({ approvedSalary: 0, doj: '', comments: '', qualifications: [], qualificationStatus: 'Partial', paidLeaves: 0, casualLeaves: 0 });
        loadApplications();
      } else {
        setError(response.message || 'Failed to reject application');
      }
    } catch (err) {
      setError('An error occurred');
      console.error(err);
    }
  };

  const initApprovalState = (application: EmployeeApplication) => {
    setSelectedApplication(application);
    // Use application DOJ if available, otherwise default to today
    let dojValue = '';
    if (application.doj) {
      try {
        dojValue = new Date(application.doj).toISOString().split('T')[0];
      } catch (e) {
        console.error('Error parsing application DOJ:', e);
        dojValue = new Date().toISOString().split('T')[0];
      }
    } else {
      dojValue = new Date().toISOString().split('T')[0];
    }

    setApprovalData({
      approvedSalary: application.approvedSalary || application.proposedSalary,
      second_salary: application.second_salary || undefined,
      doj: dojValue,
      comments: '',
      qualifications: application.qualifications ? structuredClone(application.qualifications) : [],
      qualificationStatus: application.qualificationStatus || 'Partial',
      paidLeaves: application.paidLeaves ?? application.dynamicFields?.paid_leaves ?? 0,
      casualLeaves: application.casualLeaves ?? application.dynamicFields?.casual_leaves ?? 0,
    });
    setFormData(prev => ({
      ...prev,
      applyPF: application.applyPF ?? defaultStatutory,
      applyESI: application.applyESI ?? defaultStatutory,
      applyProfessionTax: application.applyProfessionTax ?? defaultStatutory,
      applyAttendanceDeduction: application.applyAttendanceDeduction ?? defaultAttendance,
      deductLateIn: application.deductLateIn ?? defaultAttendance,
      deductEarlyOut: application.deductEarlyOut ?? defaultAttendance,
      deductPermission: application.deductPermission ?? defaultAttendance,
      deductAbsent: application.deductAbsent ?? defaultAttendance,
    }));
    setApprovalComponentDefaults({ allowances: [], deductions: [] });
    setApprovalOverrideAllowances({});
    setApprovalOverrideDeductions({});
    setApprovalSalarySummary({
      totalAllowances: 0,
      totalDeductions: 0,
      netSalary: 0,
      ctcSalary: 0,
    });
  };

  const openApprovalDialog = (application: EmployeeApplication) => {
    initApprovalState(application);
    setShowApprovalDialog(true);
    setError('');
    setSuccess('');
  };




  return (
    <div className="relative min-h-screen">
      <div className="relative z-10 mx-auto max-w-[1920px]">
        {/* Header - Unified Layout */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Employee Management</h1>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Manage employee records • Data source: <span className="font-medium text-green-600 dark:text-green-400">{dataSource.toUpperCase()}</span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Tab Slider */}
            <div className="relative flex h-10 items-center rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              <div
                className={`absolute h-8 rounded-lg bg-white shadow-sm transition-all duration-300 ease-in-out dark:bg-slate-700 ${activeTab === 'employees' ? 'left-1 w-[calc(33.33%-4px)]' :
                  activeTab === 'applications' ? 'left-[calc(33.33%)] w-[calc(33.33%-4px)]' :
                    'left-[calc(66.66%)] w-[calc(33.33%-4px)]'
                  }`}
              />
              <button
                onClick={() => setActiveTab('employees')}
                className={`relative z-10 w-32 px-4 py-1.5 text-sm font-semibold transition-colors ${activeTab === 'employees'
                  ? 'text-slate-900 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
                  }`}
              >
                Employees
              </button>
              <button
                onClick={() => setActiveTab('applications')}
                className={`relative z-10 w-32 px-4 py-1.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${activeTab === 'applications'
                  ? 'text-slate-900 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
                  }`}
              >
                Applications
                {pendingApplications.length > 0 && (
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] bg-red-500 text-white">
                    {pendingApplications.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('requests')}
                className={`relative z-10 w-36 px-4 py-1.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${activeTab === 'requests'
                  ? 'text-slate-900 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
                  }`}
              >
                Updates
                {pendingUpdateRequests.length > 0 && (
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] bg-indigo-500 text-white">
                    {pendingUpdateRequests.length}
                  </span>
                )}
              </button>
            </div>

            {/* Settings Button - Moved beside slider */}
            <Link
              href="/superadmin/employees/form-settings"
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              title="Form Settings"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Global Toolbar */}
        <div className="mb-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {activeTab === 'employees' ? (
              /* Advanced Filters for Employees */
              <div className="flex flex-wrap items-center gap-3">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSearch();
                  }}
                  className="relative min-w-[300px]"
                >
                  <input
                    type="text"
                    placeholder="Search name, emp no, phone..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSearch();
                      }
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white pl-11 pr-12 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <svg className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <button
                    type="submit"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-green-500 p-2 text-white hover:bg-green-600 transition-all flex items-center justify-center"
                    title="Search"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </button>
                </form>

                <div className="h-8 w-px bg-slate-200 dark:bg-slate-700 mx-1"></div>

                {/* Division Selection */}
                <div className="min-w-[150px]">
                  <select
                    value={selectedDivisionFilter}
                    onChange={(e) => {
                      setSelectedDivisionFilter(e.target.value);
                      setSelectedDepartmentFilter(''); // Reset dept on div change
                      setSelectedDesignationFilter(''); // Reset desig on div change
                      setSelectedEmployeeGroupFilter('');
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">All Divisions</option>
                    {divisions.map((d) => (
                      <option key={d._id} value={d._id}>{d.name}</option>
                    ))}
                  </select>
                </div>

                {/* Department Selection */}
                <div className="min-w-[150px]">
                  <select
                    value={selectedDepartmentFilter}
                    onChange={(e) => {
                      setSelectedDepartmentFilter(e.target.value);
                      setSelectedDesignationFilter(''); // Reset desig on dept change
                      setSelectedEmployeeGroupFilter('');
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">All Departments</option>
                    {departmentOptions.map((d) => (
                      <option key={d._id} value={d._id}>{d.name}</option>
                    ))}
                  </select>
                </div>

                {/* Designation Selection */}
                <div className="min-w-[150px]">
                  <select
                    value={selectedDesignationFilter}
                    onChange={(e) => setSelectedDesignationFilter(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">All Designations</option>
                    {designations.map((d) => (
                      <option key={d._id} value={d._id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                {customEmployeeGroupingEnabled && (
                  <div className="min-w-[150px]">
                    <select
                      value={selectedEmployeeGroupFilter}
                      onChange={(e) => setSelectedEmployeeGroupFilter(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <option value="">All Groups</option>
                      {employeeGroups.filter((g) => g.isActive !== false).map((g) => (
                        <option key={g._id} value={g._id}>{g.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Include Left Toggle */}
                <label className="flex items-center gap-2 cursor-pointer ml-2">
                  <input
                    type="checkbox"
                    checked={includeLeftEmployees}
                    onChange={(e) => setIncludeLeftEmployees(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-green-600 focus:ring-green-500"
                  />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Include Left</span>
                </label>
              </div>
            ) : (
              /* Search and filters for Applications (same scope as Employees) */
              <div className="flex flex-wrap items-center gap-3 flex-1">
                <div className="relative min-w-[200px] max-w-md flex-1">
                  <input
                    type="text"
                    placeholder="Search applications by name, emp no, dept..."
                    value={applicationSearchTerm}
                    onChange={(e) => setApplicationSearchTerm(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <svg className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <div className="h-8 w-px bg-slate-200 dark:bg-slate-700"></div>
                <div className="min-w-[140px]">
                  <select
                    value={selectedDivisionFilter}
                    onChange={(e) => {
                      setSelectedDivisionFilter(e.target.value);
                      setSelectedDepartmentFilter('');
                      setSelectedDesignationFilter('');
                      setSelectedEmployeeGroupFilter('');
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">All Divisions</option>
                    {divisions.map((d) => (
                      <option key={d._id} value={d._id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[140px]">
                  <select
                    value={selectedDepartmentFilter}
                    onChange={(e) => {
                      setSelectedDepartmentFilter(e.target.value);
                      setSelectedDesignationFilter('');
                      setSelectedEmployeeGroupFilter('');
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">All Departments</option>
                    {departmentOptions.map((d) => (
                      <option key={d._id} value={d._id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[140px]">
                  <select
                    value={selectedDesignationFilter}
                    onChange={(e) => setSelectedDesignationFilter(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">All Designations</option>
                    {designations.map((d) => (
                      <option key={d._id} value={d._id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                {customEmployeeGroupingEnabled && (
                  <div className="min-w-[140px]">
                    <select
                      value={selectedEmployeeGroupFilter}
                      onChange={(e) => setSelectedEmployeeGroupFilter(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <option value="">All Groups</option>
                      {employeeGroups.filter((g) => g.isActive !== false).map((g) => (
                        <option key={g._id} value={g._id}>{g.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={() => activeTab === 'employees' ? loadEmployees(currentPage) : loadApplications()}
                className="group flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              >
                <svg className={`h-4 w-4 ${(loading || loadingApplications) ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Refresh</span>
              </button>

              <div className="h-8 w-px bg-slate-200 dark:bg-slate-700"></div>

              {/* Employee Update Button */}
              {activeTab === 'employees' && allowEmployeeBulkProcess && (
                <button
                  onClick={() => setShowEmployeeUpdateModal(true)}
                  className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 transition-all hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <span>Bulk Update</span>
                </button>
              )}

              {(activeTab === 'employees' || activeTab === 'applications') && allowEmployeeBulkProcess && (
                <button
                  onClick={() => setShowBulkAllowancesDeductions(true)}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Bulk A&D Update
                </button>
              )}
              {(activeTab === 'employees' || activeTab === 'applications') && allowEmployeeBulkProcess && (
                <button
                  onClick={() => setShowBulkUpload(true)}
                  className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-sm font-medium text-green-700 transition-all hover:bg-green-100 dark:border-green-800 dark:bg-green-900/30 dark:text-green-400"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <span>Import</span>
                </button>
              )}

              {activeTab === 'employees' && (
                <button
                  onClick={() => {
                    setSelectedEmployeeForExport(null);
                    setShowExportDialog(true);
                  }}
                  className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-medium text-indigo-700 transition-all hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400"
                >
                  <Download className="h-4 w-4" />
                  <span>Bulk Export</span>
                </button>
              )}

              {(activeTab === 'employees' || activeTab === 'applications') && (
                <button
                  onClick={handleBulkResendCredentials}
                  className="flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 shadow-sm shadow-slate-900/10"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                  <span>Resend All</span>
                </button>
              )}

              <button
                onClick={() => setShowApplicationDialog(true)}
                className="flex items-center gap-2 rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-green-600/20 transition-all hover:bg-green-700"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Application
              </button>
            </div>
          </div>

          {/* Pagination Controls Bar */}
          {activeTab === 'employees' && totalPages > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white/50 backdrop-blur-sm px-6 py-3 dark:border-slate-700 dark:bg-slate-900/50">
              <div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
                <p>Showing <span className="font-semibold text-slate-900 dark:text-slate-100">{employees.length}</span> of <span className="font-semibold text-slate-900 dark:text-slate-100">{totalCount}</span> employees</p>
                <div className="h-4 w-px bg-slate-200 dark:bg-slate-700"></div>
                <div className="flex items-center gap-2">
                  <span>Rows per page:</span>
                  <select
                    value={itemsPerPage}
                    onChange={(e) => setItemsPerPage(Number(e.target.value))}
                    className="rounded-lg border border-slate-200 bg-transparent px-2 py-1 text-sm focus:outline-none dark:border-slate-700"
                  >
                    {[20, 50, 100, 200].map(size => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => loadEmployees(currentPage - 1)}
                  disabled={currentPage === 1 || loading}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Prev
                </button>

                <div className="flex items-center gap-1">
                  {[...Array(Math.min(5, totalPages))].map((_, i) => {
                    let pageNum = 1;
                    if (totalPages <= 5) pageNum = i + 1;
                    else if (currentPage <= 3) pageNum = i + 1;
                    else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                    else pageNum = currentPage - 2 + i;

                    return (
                      <button
                        key={pageNum}
                        onClick={() => loadEmployees(pageNum)}
                        className={`min-w-[32px] h-8 rounded-lg text-sm font-medium transition-all ${currentPage === pageNum
                          ? 'bg-green-600 text-white shadow-md shadow-green-600/20'
                          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                          }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={() => loadEmployees(currentPage + 1)}
                  disabled={currentPage === totalPages || loading}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  Next
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
            {success}
          </div>
        )}

        {/* Applications Tab */}
        {activeTab === 'applications' && (
          <>
            {/* Applications Header */}
            <div className="mb-6 flex items-center justify-between">
              {selectedApplicationIds.length > 0 && (userRole === 'super_admin' || userRole === 'sub_admin') && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleBulkReject}
                    className="group relative inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-red-600 to-rose-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-red-500/30 transition-all hover:from-red-700 hover:to-rose-700 hover:shadow-xl hover:shadow-red-500/40"
                  >
                    <span>Reject Selected</span>
                  </button>
                  <button
                    onClick={handleBulkApprove}
                    className="group relative inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition-all hover:from-blue-700 hover:to-indigo-700 hover:shadow-xl hover:shadow-blue-500/40"
                  >
                    <span>Approve Selected ({selectedApplicationIds.length})</span>
                  </button>
                </div>
              )}

            </div>

            {/* Applications List */}
            {loadingApplications ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm py-16 shadow-xl dark:border-slate-700 dark:bg-slate-900/80">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-green-500 border-t-transparent"></div>
                <p className="mt-4 text-sm font-medium text-slate-600 dark:text-slate-400">Loading applications...</p>
              </div>
            ) : applications.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-12 text-center shadow-xl dark:border-slate-700 dark:bg-slate-900/80">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-green-100 to-green-100 dark:from-green-900/30 dark:to-green-900/30">
                  <svg className="h-8 w-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">No applications found</p>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Create a new employee application to get started</p>
              </div>
            ) : filteredApplications.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-12 text-center shadow-xl dark:border-slate-700 dark:bg-slate-900/80">
                <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">No applications match the current filters</p>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Try adjusting division, department, designation or search.</p>
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setApplicationSearchTerm('');
                    setSelectedDivisionFilter('');
                    setSelectedDepartmentFilter('');
                    setSelectedDesignationFilter('');
                    setSelectedEmployeeGroupFilter('');
                    setApplicationFilters({});
                    loadApplications();
                  }}
                  className="mt-6 px-6 py-2.5 rounded-xl bg-slate-100 border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  Reset filters & refresh
                </button>
              </div>
            ) : (
              <div className="space-y-8">
                {/* Stage 1: Pending Applications */}
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm shadow-xl dark:border-slate-700 dark:bg-slate-900/80">
                  <div className="border-b border-slate-200 bg-gradient-to-r from-yellow-50 to-amber-50/50 px-6 py-4 dark:border-slate-700 dark:from-yellow-900/20 dark:to-amber-900/10 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">Stage 1: Pending Verification</h3>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Applications awaiting initial review and employee creation</p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-700 text-[10px] font-bold uppercase dark:bg-yellow-900/30 dark:text-yellow-400">
                      {pendingApplications.length} Pending
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-900/30">
                          <th className="px-6 py-4 text-left">
                            <input
                              type="checkbox"
                              checked={selectedApplicationIds.length === pendingApplications.length && pendingApplications.length > 0}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedApplicationIds(pendingApplications.map(app => app._id));
                                } else {
                                  setSelectedApplicationIds([]);
                                }
                              }}
                              className="h-4 w-4 rounded border-slate-300 text-green-600"
                            />
                          </th>
                          <th className="px-6 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">Employee</th>
                          <th className="px-6 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">Department</th>
                          <th className="px-6 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">Proposed Salary</th>
                          <th className="px-6 py-4 text-right text-[10px] font-bold uppercase tracking-widest text-slate-500">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {pendingApplications.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-6 py-12 text-center text-sm text-slate-500">No applications pending verification</td>
                          </tr>
                        ) : (
                          pendingApplications.map((app) => (
                            <tr key={app._id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                              <td className="px-6 py-4">
                                <input
                                  type="checkbox"
                                  checked={selectedApplicationIds.includes(app._id)}
                                  onChange={() => toggleSelectApplication(app._id)}
                                  className="h-4 w-4 rounded border-slate-300 text-green-600"
                                />
                              </td>
                              <td className="px-6 py-4">
                                <div className="font-bold text-slate-900 dark:text-slate-100">{app.employee_name}</div>
                                <div className="text-[10px] text-slate-500">{app.emp_no} • {app.email || 'No email'}</div>
                              </td>
                              <td className="px-6 py-4">
                                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                                  {(app.department_id as any)?.name || app.department?.name || '-'}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">₹{app.proposedSalary.toLocaleString()}</span>
                              </td>
                              <td className="px-6 py-4 text-right">
                                <button
                                  onClick={() => handleVerifyApplication(app)}
                                  className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20"
                                >
                                  Verify
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Stage 2: Verified Applications */}
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm shadow-xl dark:border-slate-700 dark:bg-slate-900/80">
                  <div className="border-b border-slate-200 bg-gradient-to-r from-indigo-50 to-blue-50/50 px-6 py-4 dark:border-slate-700 dark:from-indigo-900/20 dark:to-blue-900/10 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">Stage 2: Awaiting Salary Approval</h3>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Employee record created, finalizing salary structure</p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold uppercase dark:bg-indigo-900/30 dark:text-indigo-400">
                      {applications.filter(app => app.status === 'verified').length} Verified
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {applications.filter(app => app.status === 'verified').length === 0 ? (
                          <tr>
                            <td className="px-6 py-12 text-center text-sm text-slate-500">No applications awaiting salary approval</td>
                          </tr>
                        ) : (
                          applications.filter(app => app.status === 'verified').map((app) => (
                            <tr key={app._id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                              <td className="px-6 py-4">
                                <div className="font-bold text-slate-900 dark:text-slate-100">{app.employee_name}</div>
                                <div className="text-[10px] text-slate-500">
                                  {app.emp_no} • Verified by {app.verifiedBy?.name || 'System'}
                                  {app.verifiedAt && ` on ${new Date(app.verifiedAt).toLocaleDateString()}`}
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">₹{app.proposedSalary.toLocaleString()}</span>
                              </td>
                              <td className="px-6 py-4 text-right">
                                {canFinalizeSalary({ role: userRole } as any) && (
                                  <button
                                    onClick={() => openApprovalDialog(app)}
                                    className="px-4 py-1.5 rounded-lg bg-green-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-green-700 transition-all shadow-lg shadow-green-600/20"
                                  >
                                    Finalize Salary
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Stage 3: Processed Applications */}
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm shadow-xl dark:border-slate-700 dark:bg-slate-900/80">
                  <div className="border-b border-slate-200 bg-slate-50/80 px-6 py-4 dark:border-slate-700 dark:bg-slate-900/50">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">Finalized Applications</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-slate-50/30 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                          <th className="px-6 py-3 text-left">Employee</th>
                          <th className="px-6 py-3 text-left">Status</th>
                          <th className="px-6 py-3 text-left">Final Salary</th>
                          <th className="px-6 py-3 text-left">Processed By</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {paginatedApplications.filter(app => app.status === 'approved' || app.status === 'rejected').length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-6 py-8 text-center text-sm text-slate-500">No processed applications</td>
                          </tr>
                        ) : (
                          paginatedApplications.filter(app => app.status === 'approved' || app.status === 'rejected').map((app) => (
                            <tr key={app._id}>
                              <td className="px-6 py-4">
                                <div className="font-bold text-slate-900 dark:text-slate-100">{app.employee_name}</div>
                                <div className="text-[10px] text-slate-500">{app.emp_no}</div>
                              </td>
                              <td className="px-6 py-4">
                                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${app.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                  {app.status}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                                  {app.approvedSalary ? `₹${app.approvedSalary.toLocaleString()}` : '-'}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <div className="text-[10px] text-slate-500">{app.approvedBy?.name || app.rejectedBy?.name || '-'}</div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Updates Tab */}
        {activeTab === 'requests' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setUpdateRequestStatusFilter('pending')}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${updateRequestStatusFilter === 'pending'
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
                    }`}
                >
                  Pending
                </button>
                <button
                  onClick={() => setUpdateRequestStatusFilter('approved')}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${updateRequestStatusFilter === 'approved'
                    ? 'bg-green-600 text-white shadow-md'
                    : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
                    }`}
                >
                  Approved
                </button>
                <button
                  onClick={() => setUpdateRequestStatusFilter('rejected')}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${updateRequestStatusFilter === 'rejected'
                    ? 'bg-red-600 text-white shadow-md'
                    : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
                    }`}
                >
                  Rejected
                </button>
                <button
                  onClick={() => setUpdateRequestStatusFilter('all')}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${updateRequestStatusFilter === 'all'
                    ? 'bg-slate-600 text-white shadow-md'
                    : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
                    }`}
                >
                  All
                </button>
              </div>

              <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                <button
                  onClick={() => setUpdateRequestViewMode('list')}
                  className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${updateRequestViewMode === 'list'
                    ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-700 dark:text-indigo-400'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                >
                  <List className="h-3.5 w-3.5" />
                  List
                </button>
                <button
                  onClick={() => setUpdateRequestViewMode('card')}
                  className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${updateRequestViewMode === 'card'
                    ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-700 dark:text-indigo-400'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  Cards
                </button>
              </div>
            </div>

            {loadingUpdateRequests ? (
              <div className="flex flex-col items-center justify-center py-20">
                <Spinner className="h-10 w-10 text-indigo-600" />
                <p className="mt-4 text-slate-500">Loading updates...</p>
              </div>
            ) : updateRequests.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50/50 p-12 text-center dark:border-slate-700 dark:bg-slate-900/50">
                <p className="text-lg font-medium text-slate-600 dark:text-slate-400">No profile updates found</p>
                <p className="mt-1 text-sm text-slate-500">New profile update requests from employees will appear here.</p>
              </div>
            ) : updateRequestViewMode === 'list' ? (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/50">
                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Employee</th>
                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Requested Changes</th>
                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Date</th>
                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Status</th>
                        <th className="px-6 py-4 text-right text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {updateRequests.map((req) => (
                        <tr key={req._id} className="group transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-900/50">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              {req.employeeId?.profilePhoto ? (
                                <img src={req.employeeId.profilePhoto} alt="" className="h-10 w-10 rounded-xl object-cover ring-2 ring-slate-100 dark:ring-slate-800" />
                              ) : (
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-sm font-bold text-indigo-600 dark:bg-indigo-900/30">
                                  {req.employeeId?.employee_name?.charAt(0) || req.emp_no.charAt(0)}
                                </div>
                              )}
                              <div>
                                <h4 className="font-bold text-slate-900 dark:text-slate-100">{req.employeeId?.employee_name || 'Unknown'}</h4>
                                <p className="text-xs text-slate-500 font-medium">{req.emp_no}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="max-w-[300px] flex flex-wrap gap-1.5">
                              {Object.entries(req.requestedChanges).map(([field, newValue]) => {
                                const oldValue = req.previousValues?.[field] ??
                                  (req.employeeId as any)[field] ??
                                  (req.employeeId.dynamicFields?.[field]);
                                return (
                                  <div key={field} className="flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 text-[10px] ring-1 ring-slate-200 dark:bg-slate-800/50 dark:ring-slate-700">
                                    <span className="font-bold text-indigo-600 dark:text-indigo-400 capitalize">{field.replace(/_/g, ' ')}:</span>
                                    <span className="text-slate-400 line-through decoration-red-300/50">{String(oldValue || '—')}</span>
                                    <ArrowRight className="h-2 w-2 text-slate-400" />
                                    <span className="font-semibold text-slate-900 dark:text-slate-100">{String(newValue || '—')}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-xs font-semibold text-slate-500 dark:text-slate-400">
                            {new Date(req.createdAt).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${req.status === 'pending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                              req.status === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                              }`}>
                              {req.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-2">
                              {req.status === 'pending' && (
                                <>
                                  <button
                                    onClick={() => {
                                      setSelectedUpdateRequest(req);
                                      setUpdateRequestRejectComments(''); // Reset comments
                                    }}
                                    className="rounded-lg bg-red-50 p-2 text-red-600 transition-all hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40"
                                    title="Reject"
                                  >
                                    <XCircle className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => handleApproveUpdateRequest(req._id)}
                                    className="rounded-lg bg-indigo-50 p-2 text-indigo-600 transition-all hover:bg-indigo-100 dark:bg-indigo-900/20 dark:hover:bg-indigo-900/40"
                                    title="Approve"
                                  >
                                    <CheckCircle className="h-4 w-4" />
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => setSelectedUpdateRequest(req)}
                                className="rounded-lg bg-slate-50 p-2 text-slate-600 transition-all hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700"
                                title="View Details"
                              >
                                <Eye className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="grid gap-6 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
                {updateRequests.map((req) => (
                  <div
                    key={req._id}
                    className="group relative overflow-hidden rounded-3xl border border-slate-200 bg-white transition-all hover:border-indigo-300 hover:shadow-xl dark:border-slate-800 dark:bg-slate-950"
                  >
                    <div className="p-6">
                      {/* Header with Employee Info */}
                      <div className="mb-6 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          {req.employeeId?.profilePhoto ? (
                            <img src={req.employeeId.profilePhoto} alt="" className="h-14 w-14 rounded-2xl object-cover ring-2 ring-slate-100 dark:ring-slate-800" />
                          ) : (
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-2xl font-bold text-indigo-600 dark:bg-indigo-900/30">
                              {req.employeeId?.employee_name?.charAt(0) || req.emp_no.charAt(0)}
                            </div>
                          )}
                          <div>
                            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{req.employeeId?.employee_name || 'Unknown'}</h3>
                            <p className="text-sm font-medium text-slate-500">{req.emp_no}</p>
                          </div>
                        </div>
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${req.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                          req.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {req.status}
                        </span>
                      </div>

                      {/* Content: Changes */}
                      <div className="space-y-3">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Requested Changes</h4>
                        <div className="grid gap-2">
                          {Object.entries(req.requestedChanges).map(([field, newValue]) => {
                            const oldValue = req.previousValues?.[field] ??
                              (req.employeeId as any)[field] ??
                              (req.employeeId.dynamicFields?.[field]);
                            return (
                              <div key={field} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 transition-colors hover:border-indigo-100 hover:bg-white dark:border-slate-800 dark:bg-slate-900/50 dark:hover:bg-slate-900">
                                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                                  {getFieldLabel(field, formSettings)}
                                </label>
                                <div className="flex items-center gap-3">
                                  <div className="text-xs text-slate-400 line-through decoration-red-200">{String(oldValue || '—')}</div>
                                  <ArrowRight className="h-3 w-3 text-slate-300" />
                                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100">{String(newValue || '—')}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Footer Actions */}
                      <div className="mt-8 flex items-center justify-between gap-4 border-t border-slate-100 pt-6 dark:border-slate-800">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                          Requested on {new Date(req.createdAt).toLocaleDateString()}
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setSelectedUpdateRequest(req)}
                            className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600 transition-all hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                          >
                            Details
                          </button>
                          {req.status === 'pending' && (
                            <>
                              <button
                                onClick={() => {
                                  setSelectedUpdateRequest(req);
                                  setUpdateRequestRejectComments('');
                                }}
                                className="rounded-xl bg-red-100 px-4 py-2 text-xs font-bold text-red-600 transition-all hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
                              >
                                Reject
                              </button>
                              <button
                                onClick={() => handleApproveUpdateRequest(req._id)}
                                className="rounded-xl bg-indigo-600 px-6 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/20 transition-all hover:bg-indigo-700 hover:shadow-indigo-600/40"
                              >
                                Approve
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Employees Tab */}
        {activeTab === 'employees' && (
          <>



            {/* Employee List */}
            {
              loading ? (
                <div className="flex flex-col items-center justify-center rounded-3xl border border-slate-200 bg-white/95 py-16 shadow-lg dark:border-slate-800 dark:bg-slate-950/95">
                  <Spinner className="w-10 h-10" />
                  <p className="mt-4 text-sm font-medium text-slate-600 dark:text-slate-400">Loading employees...</p>
                </div>
              ) : employees.length === 0 ? (
                <div className="rounded-3xl border border-slate-200 bg-white/95 p-12 text-center shadow-lg dark:border-slate-800 dark:bg-slate-950/95">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-green-100 to-green-100 dark:from-green-900/30 dark:to-green-900/30">
                    <svg className="h-8 w-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">No employees found</p>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Add your first employee to get started</p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white/95 shadow-lg dark:border-slate-800 dark:bg-slate-950/95">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-900/50">
                          <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                            Emp No
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                            Name
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                            Division
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                            Department
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                            Designation
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                            Phone
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                            Status
                          </th>
                          <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        {employees.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-6 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                              No employees found matching your criteria
                            </td>
                          </tr>
                        ) : (
                          employees.map((employee) => (
                            <tr
                              key={employee.emp_no}
                              className="transition-colors hover:bg-green-50/30 dark:hover:bg-green-900/10 cursor-pointer"
                              onClick={() => handleViewEmployee(employee)}
                            >
                              <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-green-600 dark:text-green-400">
                                {employee.emp_no}
                              </td>
                              <td className="whitespace-nowrap px-6 py-4">
                                <div className="flex items-center gap-3">
                                  {(employee as any).profilePhoto ? (
                                    <img
                                      src={(employee as any).profilePhoto}
                                      alt=""
                                      className="h-9 w-9 shrink-0 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
                                    />
                                  ) : (
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-sm font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                                      {(employee.employee_name || '?').charAt(0).toUpperCase()}
                                    </div>
                                  )}
                                  <div>
                                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{employee.employee_name}</div>
                                    {employee.email && (
                                      <div className="text-xs text-slate-500 dark:text-slate-400">{employee.email}</div>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                                {employee.division?.name || '-'}
                              </td>
                              <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                                {employee.department?.name || '-'}
                              </td>
                              <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                                {employee.designation?.name || '-'}
                              </td>
                              <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                                {employee.phone_number || '-'}
                              </td>
                              <td className="whitespace-nowrap px-6 py-4">
                                <div className="flex flex-col gap-1">
                                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${isEmployeeActive(employee)
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                                    }`}>
                                    {isEmployeeActive(employee) ? 'Active' : 'Inactive'}
                                  </span>
                                  {employee.salaryStatus === 'pending_approval' && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-1 text-[10px] font-bold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 uppercase tracking-wider">
                                      <LucideClock className="w-3 h-3" />
                                      SALARY PENDING
                                    </span>
                                  )}
                                  {pendingUpdateRequests.some((r: any) => r.emp_no === employee.emp_no && r.status === 'pending') && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 uppercase tracking-wider">
                                      <Edit2 className="w-3 h-3" />
                                      UPDATE PENDING
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="whitespace-nowrap px-6 py-4 text-right">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedEmployeeForExport({ empNo: employee.emp_no, name: employee.employee_name });
                                    setShowExportDialog(true);
                                  }}
                                  className="mr-2 rounded-lg p-2 text-slate-400 transition-all hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-400"
                                  title="Download Data"
                                >
                                  <Download className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleEdit(employee);
                                  }}
                                  className="mr-2 rounded-lg p-2 text-slate-400 transition-all hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/30 dark:hover:text-blue-400"
                                  title="Edit"
                                >
                                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                </button>
                                {employee.leftDate ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRemoveLeftDate(employee);
                                    }}
                                    className="rounded-lg p-2 text-slate-400 transition-all hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/30 dark:hover:text-green-400"
                                    title="Reactivate Employee"
                                  >
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleSetLeftDate(employee);
                                      }}
                                      className="mr-2 rounded-lg p-2 text-slate-400 transition-all hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                                      title="Set Left Date"
                                    >
                                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                      </svg>
                                    </button>
                                    <button
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        const result = await alertConfirm(
                                          'Resend Credentials?',
                                          `Resend credentials to ${employee.employee_name}? Their current credentials will be sent without resetting the password.`
                                        );
                                        if (!result.isConfirmed) return;

                                        setIsResending(employee.emp_no);
                                        try {
                                          const res = await api.resendEmployeeCredentials(employee.emp_no, {
                                            notificationChannels: notificationChannels
                                          });
                                          if (res.success) {
                                            alertSuccess('Sent!', 'Credentials sent successfully!');
                                          } else {
                                            alertError('Failed', res.message || 'Failed to send');
                                          }
                                        } catch (err: any) {
                                          alertError('Error', err.message || 'Failed to resend');
                                        } finally {
                                          setIsResending(null);
                                        }
                                      }}
                                      disabled={isResending === employee.emp_no}
                                      className="ml-2 rounded-lg p-2 text-slate-400 transition-all hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/30 dark:hover:text-green-400 disabled:opacity-50"
                                      title="Resend Credentials"
                                    >
                                      {isResending === employee.emp_no ? (
                                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-green-500 border-t-transparent" />
                                      ) : (
                                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                        </svg>
                                      )}
                                    </button>
                                    <button
                                      onClick={async (e) => {
                                        e.stopPropagation();

                                        const result = await Swal.fire({
                                          title: 'Reset Credentials',
                                          text: `Reset credentials for ${employee.employee_name}? Enter a custom password or leave blank to auto-generate.`,
                                          input: 'text',
                                          inputPlaceholder: 'Enter custom password (optional)',
                                          showCancelButton: true,
                                          confirmButtonText: 'Reset & Send',
                                          cancelButtonText: 'Cancel',
                                          confirmButtonColor: '#f97316',
                                          inputAttributes: {
                                            autocapitalize: 'off',
                                            autocorrect: 'off'
                                          }
                                        });

                                        if (!result.isConfirmed) return;

                                        setIsResetting(employee.emp_no);
                                        try {
                                          const res = await api.resetEmployeeCredentials(employee.emp_no, { customPassword: result.value });
                                          if (res.success) {
                                            alertSuccess('Sent!', 'Credentials reset successfully!');
                                          } else {
                                            alertError('Failed', res.message || 'Failed to reset');
                                          }
                                        } catch (err: any) {
                                          alertError('Error', err.message || 'Failed to reset');
                                        } finally {
                                          setIsResetting(null);
                                        }
                                      }}
                                      disabled={isResetting === employee.emp_no}
                                      className="ml-2 rounded-lg p-2 text-slate-400 transition-all hover:bg-orange-50 hover:text-orange-600 dark:hover:bg-orange-900/30 dark:hover:text-orange-400 disabled:opacity-50"
                                      title="Reset Credentials"
                                    >
                                      {isResetting === employee.emp_no ? (
                                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
                                      ) : (
                                        <KeyRound className="h-4 w-4" />
                                      )}
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (updatingStatusIds.has(employee.emp_no)) return;
                                        const isActive = isEmployeeActive(employee);
                                        handleDeactivate(employee.emp_no, isActive);
                                      }}
                                      disabled={updatingStatusIds.has(employee.emp_no)}
                                      className={`rounded-lg p-2 transition-all ${isEmployeeActive(employee)
                                        ? 'text-amber-400 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-900/30 dark:hover:text-amber-400'
                                        : 'text-green-400 hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/30 dark:hover:text-green-400'
                                        } ${updatingStatusIds.has(employee.emp_no) ? 'opacity-50 cursor-not-allowed' : ''}`}
                                      title={isEmployeeActive(employee) ? 'Deactivate' : 'Activate'}
                                    >
                                      {updatingStatusIds.has(employee.emp_no) ? (
                                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                      ) : (
                                        isEmployeeActive(employee) ? (
                                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                          </svg>
                                        ) : (
                                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                          </svg>
                                        )
                                      )}
                                    </button>

                                  </>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            }
          </>
        )}

        {/* Application Creation Dialog */}
        {
          showApplicationDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowApplicationDialog(false)} />
              <div className="relative z-50 max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950/95">
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                      New Employee Application
                    </h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Create an application for a new employee. Superadmin will review and approve.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowApplicationDialog(false)}
                    className="rounded-xl border border-slate-200 bg-white p-2 text-slate-400 transition hover:border-red-200 hover:text-red-500 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {error && (
                  <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                    {error}
                  </div>
                )}

                {applicationFormAutoGenerateEmpNo && (
                  <div className="mb-4 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
                    <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Employee number will be auto-generated when you submit.
                  </div>
                )}

                <form onSubmit={handleCreateApplication} className="space-y-6">
                  {/* Profile photo (optional) - uploads to S3 profiles folder */}
                  <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                    <h3 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">Profile Photo (optional)</h3>
                    <div className="flex flex-wrap items-start gap-4">
                      {(applicationFormData as any).profilePhoto && (
                        <div className="relative">
                          <img
                            src={(applicationFormData as any).profilePhoto}
                            alt="Profile"
                            className="h-24 w-24 rounded-xl border border-slate-200 object-cover dark:border-slate-700"
                          />
                          <button
                            type="button"
                            onClick={() => setApplicationFormData(prev => ({ ...prev, profilePhoto: '' }))}
                            className="absolute -right-2 -top-2 rounded-full bg-red-500 p-1 text-white shadow hover:bg-red-600"
                          >
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      )}
                      <div>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/jpg"
                          className="block w-full max-w-xs text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-slate-700 dark:text-slate-300 dark:file:bg-slate-800 dark:file:text-slate-200"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            try {
                              const res = await api.uploadProfile(file) as { success?: boolean; url?: string };
                              if (res?.success && res?.url) setApplicationFormData(prev => ({ ...prev, profilePhoto: res.url }));
                            } catch (err) {
                              setError('Failed to upload profile photo. Try again.');
                            }
                            e.target.value = '';
                          }}
                        />
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">JPG or PNG, max 5MB. Stored in S3 profiles folder.</p>
                      </div>
                    </div>
                  </div>

                  <DynamicEmployeeForm
                    formData={applicationFormData as any}
                    onChange={setApplicationFormData}
                    departments={departments}
                    divisions={divisions}
                    employeeGroups={employeeGroups}
                    designations={filteredApplicationDesignations as any}
                    excludeFields={[
                      ...(applicationFormAutoGenerateEmpNo ? ['emp_no'] : []),
                      ...(customEmployeeGroupingEnabled ? ['employee_group_id'] : []),
                    ]}
                  />

                  {customEmployeeGroupingEnabled && (
                    <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                      <label className="mb-2 block text-sm font-semibold text-slate-900 dark:text-slate-100">Employee group</label>
                      <select
                        value={typeof (applicationFormData as any).employee_group_id === 'object'
                          ? (applicationFormData as any).employee_group_id?._id || ''
                          : (applicationFormData as any).employee_group_id || ''}
                        onChange={(e) => setApplicationFormData((prev: any) => ({ ...prev, employee_group_id: e.target.value || '' }))}
                        className="w-full max-w-md rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      >
                        <option value="">None</option>
                        {employeeGroups.filter((g) => g.isActive !== false).map((g) => (
                          <option key={g._id} value={g._id}>{g.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Leave Settings (Optional) */}
                  <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                    <h3 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">Leave Settings (Optional)</h3>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                          Monthly Paid Leaves
                        </label>
                          <input
                            type="number"
                            name="paidLeaves"
                            value={applicationFormData.paidLeaves ?? ''}
                            onChange={handleApplicationInputChange}
                            onWheel={(e) => e.currentTarget.blur()}
                            min="0"
                            step="0.5"
                            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm transition-all focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 no-spinner"
                            placeholder="Optional"
                          />
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Monthly recurring paid leaves
                        </p>
                      </div>
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                          Yearly Allotted Leaves
                        </label>
                          <input
                            type="number"
                            name="allottedLeaves"
                            value={applicationFormData.allottedLeaves ?? ''}
                            onChange={handleApplicationInputChange}
                            onWheel={(e) => e.currentTarget.blur()}
                            min="0"
                            step="0.5"
                            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm transition-all focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 no-spinner"
                            placeholder="Optional"
                          />
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Yearly total for without_pay/LOP leaves
                        </p>
                      </div>
                    </div>
                  </div>
                  {/* Allowances & Deductions Overrides */}
                  <div className="space-y-4 rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Allowances &amp; Deductions</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Defaults come from Department/Global. Enter an amount to override for this employee.
                        </p>
                      </div>
                      {loadingComponents && (
                        <div className="text-xs text-slate-500 dark:text-slate-400">Loading components...</div>
                      )}
                    </div>

                    {/* Salary summary */}
                    <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60 md:grid-cols-4">
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Proposed / Gross Salary</p>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          ₹{Number((applicationFormData as any).proposedSalary || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-green-700 dark:text-green-300">Total Allowances</p>
                        <p className="text-sm font-semibold text-green-700 dark:text-green-300">
                          ₹{applicationSalarySummary.totalAllowances.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-red-700 dark:text-red-300">Total Deductions</p>
                        <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                          ₹{applicationSalarySummary.totalDeductions.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Calculated / CTC</p>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          ₹{applicationSalarySummary.netSalary.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      {/* Allowances */}
                      <div className="rounded-xl border border-green-100 bg-green-50/70 p-3 dark:border-green-900/40 dark:bg-green-900/20">
                        <div className="mb-2 flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-green-800 dark:text-green-200">Allowances</h4>
                          <span className="text-xs text-green-700 dark:text-green-300">
                            {componentDefaults.allowances.length} items
                          </span>
                        </div>
                        <div className="space-y-2">
                          {componentDefaults.allowances.length === 0 && (
                            <p className="text-xs text-green-700/70 dark:text-green-200/70">No allowances available.</p>
                          )}
                          {componentDefaults.allowances.map((item) => {
                            const key = getKey(item);
                            const current = overrideAllowances[key] ?? item.amount ?? 0;
                            const isFixed = item.type === 'fixed';
                            const basedOnPresentDays = overrideAllowancesBasedOnPresentDays[key] ?? item.basedOnPresentDays ?? false;
                            return (
                              <div key={key} className="rounded-lg border border-green-100 bg-white/70 px-3 py-2 text-xs dark:border-green-900/50 dark:bg-green-950/40">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex-1">
                                    <div className="font-semibold text-green-900 dark:text-green-100">{item.name}</div>
                                    <div className="text-[11px] text-green-700 dark:text-green-300">
                                      {item.type === 'percentage'
                                        ? `${item.percentage || 0}% of ${item.base || item.percentageBase || 'basic'}`
                                        : 'Fixed'}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[11px] text-green-700 dark:text-green-300">Override</span>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={current === null ? '' : current}
                                      onChange={(e) => handleOverrideChange('allowance', item, e.target.value)}
                                      onWheel={(e) => e.currentTarget.blur()}
                                      className="w-24 rounded border border-green-200 bg-white px-2 py-1 text-[11px] text-green-900 focus:border-green-400 focus:outline-none dark:border-green-800 dark:bg-green-950 dark:text-green-100 no-spinner"
                                    />
                                  </div>
                                </div>
                                {isFixed && (
                                  <div className="mt-2 pt-2 border-t border-green-100 dark:border-green-900/50">
                                    <label className="flex items-start gap-1.5 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={basedOnPresentDays}
                                        onChange={(e) => {
                                          setOverrideAllowancesBasedOnPresentDays({
                                            ...overrideAllowancesBasedOnPresentDays,
                                            [key]: e.target.checked
                                          });
                                        }}
                                        className="mt-0.5 h-3 w-3 rounded border-green-300 text-green-600 focus:ring-green-500 dark:border-green-700"
                                      />
                                      <span className="text-[10px] leading-tight text-green-700 dark:text-green-300">
                                        Prorate based on present days
                                      </span>
                                    </label>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Deductions */}
                      <div className="rounded-xl border border-red-100 bg-red-50/70 p-3 dark:border-red-900/40 dark:bg-red-900/20">
                        <div className="mb-2 flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-red-800 dark:text-red-200">Deductions</h4>
                          <span className="text-xs text-red-700 dark:text-red-300">
                            {componentDefaults.deductions.length} items
                          </span>
                        </div>
                        <div className="space-y-2">
                          {componentDefaults.deductions.length === 0 && (
                            <p className="text-xs text-red-700/70 dark:text-red-200/70">No deductions available.</p>
                          )}
                          {componentDefaults.deductions.map((item) => {
                            const key = getKey(item);
                            const current = overrideDeductions[key] ?? item.amount ?? 0;
                            const isFixed = item.type === 'fixed';
                            const basedOnPresentDays = overrideDeductionsBasedOnPresentDays[key] ?? item.basedOnPresentDays ?? false;
                            return (
                              <div key={key} className="rounded-lg border border-red-100 bg-white/70 px-3 py-2 text-xs dark:border-red-900/50 dark:bg-red-950/40">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex-1">
                                    <div className="font-semibold text-red-900 dark:text-red-100">{item.name}</div>
                                    <div className="text-[11px] text-red-700 dark:text-red-300">
                                      {item.type === 'percentage'
                                        ? `${item.percentage || 0}% of ${item.base || item.percentageBase || 'basic'}`
                                        : 'Fixed'}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[11px] text-red-700 dark:text-red-300">Override</span>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={current === null ? '' : current}
                                      onChange={(e) => handleOverrideChange('deduction', item, e.target.value)}
                                      onWheel={(e) => e.currentTarget.blur()}
                                      className="w-24 rounded border border-red-200 bg-white px-2 py-1 text-[11px] text-red-900 focus:border-red-400 focus:outline-none dark:border-red-800 dark:bg-red-950 dark:text-red-100 no-spinner"
                                    />
                                  </div>
                                </div>
                                {isFixed && (
                                  <div className="mt-2 pt-2 border-t border-red-100 dark:border-red-900/50">
                                    <label className="flex items-start gap-1.5 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={basedOnPresentDays}
                                        onChange={(e) => {
                                          setOverrideDeductionsBasedOnPresentDays({
                                            ...overrideDeductionsBasedOnPresentDays,
                                            [key]: e.target.checked
                                          });
                                        }}
                                        className="mt-0.5 h-3 w-3 rounded border-red-300 text-red-600 focus:ring-red-500 dark:border-red-700"
                                      />
                                      <span className="text-[10px] leading-tight text-red-700 dark:text-red-300">
                                        Prorate based on present days
                                      </span>
                                    </label>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Deduction Preferences */}
                  <div className="rounded-2xl border border-slate-200 bg-white/70 p-5 dark:border-slate-700 dark:bg-slate-900/60">
                    <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Deduction Preferences</h3>
                    <div className="grid gap-6 sm:grid-cols-2">
                      <div>
                        <h4 className="mb-3 text-xs font-bold uppercase tracking-tight text-slate-400 dark:text-slate-500">Statutory</h4>
                        <div className="space-y-3">
                          {[
                            { id: 'applyPF', label: 'PF' },
                            { id: 'applyESI', label: 'ESI' },
                            { id: 'applyProfessionTax', label: 'Profession Tax' }
                          ].map((pref) => (
                            <label key={pref.id} className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 p-3 transition-all hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50">
                              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{pref.label}</span>
                              <div
                                onClick={() => {
                                  const newVal = !((formData as any)[pref.id] ?? true);
                                  setFormData(prev => ({ ...prev, [pref.id]: newVal }));
                                }}
                                className={`relative h-6 w-11 cursor-pointer rounded-full transition-colors duration-200 ease-in-out ${((formData as any)[pref.id] ?? true) ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-700'}`}
                              >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out mt-1 ml-1 ${((formData as any)[pref.id] ?? true) ? 'translate-x-5' : 'translate-x-0'}`} />
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h4 className="mb-3 text-xs font-bold uppercase tracking-tight text-slate-400 dark:text-slate-500">Attendance Deduction</h4>
                        <div className="space-y-3">
                          {[
                            { id: 'applyAttendanceDeduction', label: 'Apply attendance deduction' },
                            { id: 'deductLateIn', label: 'Late-ins' },
                            { id: 'deductEarlyOut', label: 'Early-outs' },
                            { id: 'deductPermission', label: 'Permission' },
                            { id: 'deductAbsent', label: 'Absents (extra LOP)' }
                          ].map((pref) => (
                            <label key={pref.id} className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 p-3 transition-all hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50">
                              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{pref.label}</span>
                              <div
                                onClick={() => {
                                  const newVal = !((formData as any)[pref.id] ?? true);
                                  setFormData(prev => ({ ...prev, [pref.id]: newVal }));
                                }}
                                className={`relative h-6 w-11 cursor-pointer rounded-full transition-colors duration-200 ease-in-out ${((formData as any)[pref.id] ?? true) ? 'bg-amber-600' : 'bg-slate-200 dark:bg-slate-700'}`}
                              >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out mt-1 ml-1 ${((formData as any)[pref.id] ?? true) ? 'translate-x-5' : 'translate-x-0'}`} />
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3 pt-2">
                    <button
                      type="submit"
                      className="flex-1 rounded-2xl bg-gradient-to-r from-green-500 to-green-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-green-500/30 transition-all hover:from-green-600 hover:to-green-600"
                    >
                      Submit Application
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowApplicationDialog(false)}
                      className="flex-1 rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )
        }

        {/* Approval Dialog with Salary Modification */}
        {
          showApprovalDialog && selectedApplication && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowApprovalDialog(false)} />
              <div className="relative z-50 max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950/95">
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                      Review Employee Application
                    </h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Review and approve or reject this employee application
                    </p>
                  </div>
                  <button
                    onClick={() => setShowApprovalDialog(false)}
                    className="rounded-xl border border-slate-200 bg-white p-2 text-slate-400 transition hover:border-red-200 hover:text-red-500 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {error && (
                  <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                    {error}
                  </div>
                )}

                <div className="space-y-6">
                  {/* Application Details */}
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50">
                    <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Application Details</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Employee No</p>
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{selectedApplication.emp_no}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Employee Name</p>
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{selectedApplication.employee_name}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Division</p>
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {(selectedApplication.division_id as any)?.name || (selectedApplication as any).division?.name || '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Department</p>
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {(selectedApplication.department_id as any)?.name || selectedApplication.department?.name || '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Designation</p>
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {(selectedApplication.designation_id as any)?.name || selectedApplication.designation?.name || '-'}
                        </p>
                      </div>
                      {customEmployeeGroupingEnabled && (
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Group</p>
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                            {(selectedApplication as any).employee_group?.name || (selectedApplication as any).employee_group_id?.name || '-'}
                          </p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Created By</p>
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{selectedApplication.createdBy?.name || '-'}</p>
                      </div>
                      {selectedApplication.verifiedBy && (
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Verified By</p>
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                            {selectedApplication.verifiedBy.name}
                            {selectedApplication.verifiedAt && ` on ${new Date(selectedApplication.verifiedAt).toLocaleDateString()}`}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Qualifications - Key Feature */}
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50">
                    <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Qualifications & Certificates</h3>
                    {(() => {
                      const quals = approvalData.qualifications || selectedApplication.qualifications;
                      if (!quals || (Array.isArray(quals) && quals.length === 0)) {
                        return <p className="text-sm italic text-slate-500 dark:text-slate-400">No qualifications provided.</p>;
                      }

                      if (Array.isArray(quals)) {
                        return (
                          <div className="grid gap-6 sm:grid-cols-2">
                            {quals.map((qual: any, idx: number) => {
                              const certificateUrl = qual.certificateUrl;
                              const isPDF = certificateUrl?.toLowerCase().endsWith('.pdf');

                              const displayEntries = Object.entries(qual).filter(([k, v]) =>
                                k !== 'certificateUrl' && k !== 'status' && v !== null && v !== undefined && v !== ''
                              );

                              const handleStatusChange = (newStatus: string) => {
                                const newQuals = [...quals];
                                newQuals[idx] = { ...newQuals[idx], status: newStatus };
                                setApprovalData({ ...approvalData, qualifications: newQuals });
                              };

                              return (
                                <div key={idx} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white transition-all hover:border-blue-300 hover:shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-700 flex flex-col h-full">
                                  {/* Card Image Area */}
                                  <div className="aspect-[3/2] w-full overflow-hidden bg-slate-100 dark:bg-slate-800 relative group-hover:bg-slate-50 dark:group-hover:bg-slate-800/80 transition-colors">
                                    {certificateUrl ? (
                                      isPDF ? (
                                        <div className="absolute inset-0 flex items-center justify-center">
                                          <svg className="h-20 w-20 text-red-500 opacity-80 group-hover:scale-110 transition-transform duration-300" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9v-2h2v2zm0-4H9V7h2v5z" />
                                          </svg>
                                          <span className="absolute bottom-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">PDF Document</span>
                                        </div>
                                      ) : (
                                        <img
                                          src={certificateUrl}
                                          alt="Certificate Preview"
                                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                                        />
                                      )
                                    ) : (
                                      <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-300 dark:text-slate-600">
                                        <svg className="h-16 w-16 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                        </svg>
                                        <span className="text-xs font-medium">No Certificate</span>
                                      </div>
                                    )}

                                    {/* Overlay Action */}
                                    {certificateUrl && (
                                      <a
                                        href={certificateUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="absolute inset-0 z-10 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-300 group-hover:bg-black/10 group-hover:opacity-100"
                                      >
                                        <div className="rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm backdrop-blur-sm hover:bg-white hover:scale-105 transition-all">
                                          View Full {isPDF ? 'Document' : 'Image'}
                                        </div>
                                      </a>
                                    )}
                                  </div>

                                  {/* Card Content Area */}
                                  <div className="flex flex-1 flex-col p-5">
                                    <div className="space-y-3">
                                      {/* Status Dropdown */}
                                      <div className="flex flex-col border-b border-slate-100 pb-3 last:border-0 last:pb-0 dark:border-slate-800">
                                        <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 mb-1">
                                          Verification Status
                                        </label>
                                        <select
                                          value={qual.status || 'Partial'}
                                          onChange={(e) => handleStatusChange(e.target.value)}
                                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                        >
                                          <option value="Partial">Partial</option>
                                          <option value="Not Certified">Not Certified</option>
                                          <option value="Certified">Certified</option>
                                        </select>
                                      </div>

                                      {displayEntries.length > 0 ? displayEntries.map(([key, value]) => {
                                        const fieldLabel = formSettings?.qualifications?.fields?.find((f: any) => f.id === key)?.label || key.replace(/_/g, ' ');
                                        return (
                                          <div key={key} className="flex flex-col border-b border-slate-100 pb-2 last:border-0 last:pb-0 dark:border-slate-800">
                                            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 mb-0.5">
                                              {fieldLabel}
                                            </span>
                                            <span className="text-sm font-medium text-slate-900 dark:text-slate-100 line-clamp-1" title={String(value)}>
                                              {String(value)}
                                            </span>
                                          </div>
                                        );
                                      }) : <span className="text-sm italic text-slate-400">No Qualification Details</span>}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      }

                      return <p className="text-sm text-slate-900 dark:text-slate-100">{String(quals)}</p>;
                    })()}
                  </div>

                  {/* Salary Section - Key Feature */}
                  <div className="rounded-2xl border-2 border-green-200 bg-green-50/50 p-5 dark:border-green-800 dark:bg-green-900/20">
                    <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-green-700 dark:text-green-400">Salary Approval</h3>
                    <div className="space-y-4">
                      {/* Proposed Salary - Strikethrough if modified */}
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Proposed Salary (HR)</p>
                        <p className={`text-lg font-semibold ${approvalData.approvedSalary !== selectedApplication.proposedSalary ? 'line-through text-slate-400' : 'text-slate-900 dark:text-slate-100'}`}>
                          ₹{selectedApplication.proposedSalary.toLocaleString()}
                        </p>
                      </div>

                      {selectedApplication.second_salary !== undefined && (
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Second Salary</p>
                          <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                            ₹{selectedApplication.second_salary.toLocaleString()}
                          </p>
                        </div>
                      )}

                      {/* Approved Salary Input */}
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                          Approved Salary (Monthly Gross)
                        </label>
                        <input
                          type="number"
                          value={approvalData.approvedSalary}
                          onChange={(e) => setApprovalData({ ...approvalData, approvedSalary: Number(e.target.value) })}
                          onWheel={(e) => e.currentTarget.blur()}
                          min="0"
                          step="0.01"
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-500/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 no-spinner"
                        />
                        {approvalData.approvedSalary !== selectedApplication.proposedSalary && (
                          <p className="mt-2 text-xs text-green-600 dark:text-green-400">
                            ✓ Salary modified from proposed amount
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                          Second Salary / Additional (Optional)
                        </label>
                        <input
                          type="number"
                          value={(approvalData as any).second_salary || ''}
                          onChange={(e) => setApprovalData({ ...approvalData, second_salary: Number(e.target.value) } as any)}
                          onWheel={(e) => e.currentTarget.blur()}
                          min="0"
                          step="0.01"
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold transition-all focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 no-spinner"
                          placeholder="Enter second salary if any"
                        />
                        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                          Additional salary component (e.g. fixed allowance not in components)
                        </p>
                      </div>

                      {/* Date of Joining */}
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                          Date of Joining *
                        </label>
                        <input
                          type="date"
                          value={approvalData.doj || ''}
                          onChange={(e) => setApprovalData({ ...approvalData, doj: e.target.value })}
                          required
                          className="w-full rounded-xl border-2 border-green-400 bg-white px-4 py-2.5 text-sm font-semibold transition-all focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-green-600 dark:bg-slate-900 dark:text-slate-100"
                        />
                        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                          Specify the employee's joining date
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Allowances & Deductions with summary in approval */}
                  <div className="space-y-4 rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Allowances &amp; Deductions</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Based on department/global defaults. Adjust overrides as needed before approval.
                        </p>
                      </div>
                      {approvalLoadingComponents && (
                        <div className="text-xs text-slate-500 dark:text-slate-400">Loading components...</div>
                      )}
                    </div>

                    <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60 md:grid-cols-4">
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Approved / Gross Salary</p>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          ₹{Number(approvalData.approvedSalary || selectedApplication.proposedSalary || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-green-700 dark:text-green-300">Total Allowances</p>
                        <p className="text-sm font-semibold text-green-700 dark:text-green-300">
                          ₹{approvalSalarySummary.totalAllowances.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-red-700 dark:text-red-300">Total Deductions</p>
                        <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                          ₹{approvalSalarySummary.totalDeductions.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Calculated / CTC</p>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          ₹{approvalSalarySummary.netSalary.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      {/* Allowances */}
                      <div className="rounded-xl border border-green-100 bg-green-50/70 p-3 dark:border-green-900/40 dark:bg-green-900/20">
                        <div className="mb-2 flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-green-800 dark:text-green-200">Allowances</h4>
                          <span className="text-xs text-green-700 dark:text-green-300">
                            {approvalComponentDefaults.allowances.length} items
                          </span>
                        </div>
                        <div className="space-y-2">
                          {approvalComponentDefaults.allowances.length === 0 && (
                            <p className="text-xs text-green-700/70 dark:text-green-200/70">No allowances available.</p>
                          )}
                          {approvalComponentDefaults.allowances.map((item) => {
                            const key = getKey(item);
                            const current = approvalOverrideAllowances[key] ?? item.amount ?? 0;
                            const isFixed = item.type === 'fixed';
                            const basedOnPresentDays = approvalOverrideAllowancesBasedOnPresentDays[key] ?? item.basedOnPresentDays ?? false;
                            return (
                              <div key={key} className="rounded-lg border border-green-100 bg-white/70 px-3 py-2 text-xs dark:border-green-900/50 dark:bg-green-950/40">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex-1">
                                    <div className="font-semibold text-green-900 dark:text-green-100">{item.name}</div>
                                    <div className="text-[11px] text-green-700 dark:text-green-300">
                                      {item.type === 'percentage'
                                        ? `${item.percentage || 0}% of ${item.base || item.percentageBase || 'basic'}`
                                        : 'Fixed'}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[11px] text-green-700 dark:text-green-300">Override</span>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={current === null ? '' : current}
                                      onChange={(e) => handleApprovalOverrideChange('allowance', item, e.target.value)}
                                      onWheel={(e) => e.currentTarget.blur()}
                                      className="w-24 rounded border border-green-200 bg-white px-2 py-1 text-[11px] text-green-900 focus:border-green-400 focus:outline-none dark:border-green-800 dark:bg-green-950 dark:text-green-100 no-spinner"
                                    />
                                  </div>
                                </div>
                                {isFixed && (
                                  <div className="mt-2 pt-2 border-t border-green-100 dark:border-green-900/50">
                                    <label className="flex items-start gap-1.5 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={basedOnPresentDays}
                                        onChange={(e) => {
                                          setApprovalOverrideAllowancesBasedOnPresentDays({
                                            ...approvalOverrideAllowancesBasedOnPresentDays,
                                            [key]: e.target.checked
                                          });
                                        }}
                                        className="mt-0.5 h-3 w-3 rounded border-green-300 text-green-600 focus:ring-green-500 dark:border-green-700"
                                      />
                                      <span className="text-[10px] leading-tight text-green-700 dark:text-green-300">
                                        Prorate based on present days
                                      </span>
                                    </label>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Deductions */}
                      <div className="rounded-xl border border-red-100 bg-red-50/70 p-3 dark:border-red-900/40 dark:bg-red-900/20">
                        <div className="mb-2 flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-red-800 dark:text-red-200">Deductions</h4>
                          <span className="text-xs text-red-700 dark:text-red-300">
                            {approvalComponentDefaults.deductions.length} items
                          </span>
                        </div>
                        <div className="space-y-2">
                          {approvalComponentDefaults.deductions.length === 0 && (
                            <p className="text-xs text-red-700/70 dark:text-red-200/70">No deductions available.</p>
                          )}
                          {approvalComponentDefaults.deductions.map((item) => {
                            const key = getKey(item);
                            const current = approvalOverrideDeductions[key] ?? item.amount ?? 0;
                            const isFixed = item.type === 'fixed';
                            const basedOnPresentDays = approvalOverrideDeductionsBasedOnPresentDays[key] ?? item.basedOnPresentDays ?? false;
                            return (
                              <div key={key} className="rounded-lg border border-red-100 bg-white/70 px-3 py-2 text-xs dark:border-red-900/50 dark:bg-red-950/40">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex-1">
                                    <div className="font-semibold text-red-900 dark:text-red-100">{item.name}</div>
                                    <div className="text-[11px] text-red-700 dark:text-red-300">
                                      {item.type === 'percentage'
                                        ? `${item.percentage || 0}% of ${item.base || item.percentageBase || 'basic'}`
                                        : 'Fixed'}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[11px] text-red-700 dark:text-red-300">Override</span>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={current === null ? '' : current}
                                      onChange={(e) => handleApprovalOverrideChange('deduction', item, e.target.value)}
                                      onWheel={(e) => e.currentTarget.blur()}
                                      className="w-24 rounded border border-red-200 bg-white px-2 py-1 text-[11px] text-red-900 focus:border-red-400 focus:outline-none dark:border-red-800 dark:bg-red-950 dark:text-red-100 no-spinner"
                                    />
                                  </div>
                                </div>
                                {isFixed && (
                                  <div className="mt-2 pt-2 border-t border-red-100 dark:border-red-900/50">
                                    <label className="flex items-start gap-1.5 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={basedOnPresentDays}
                                        onChange={(e) => {
                                          setApprovalOverrideDeductionsBasedOnPresentDays({
                                            ...approvalOverrideDeductionsBasedOnPresentDays,
                                            [key]: e.target.checked
                                          });
                                        }}
                                        className="mt-0.5 h-3 w-3 rounded border-red-300 text-red-600 focus:ring-red-500 dark:border-red-700"
                                      />
                                      <span className="text-[10px] leading-tight text-red-700 dark:text-red-300">
                                        Prorate based on present days
                                      </span>
                                    </label>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Deduction Preferences */}
                  <div className="rounded-2xl border border-slate-200 bg-white/70 p-5 dark:border-slate-700 dark:bg-slate-900/60">
                    <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Deduction Preferences</h3>
                    <div className="grid gap-6 sm:grid-cols-2">
                      {/* Statutory Deductions */}
                      <div>
                        <h4 className="mb-3 text-xs font-bold uppercase tracking-tight text-slate-400 dark:text-slate-500">Statutory</h4>
                        <div className="space-y-3">
                          {[
                            { id: 'applyPF', label: 'PF' },
                            { id: 'applyESI', label: 'ESI' },
                            { id: 'applyProfessionTax', label: 'Profession Tax' }
                          ].map((pref) => (
                            <label key={pref.id} className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 p-3 transition-all hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50">
                              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{pref.label}</span>
                              <div
                                onClick={() => {
                                  const newVal = !((approvalData as any)[pref.id] ?? true);
                                  setApprovalData(prev => ({ ...prev, [pref.id]: newVal }));
                                }}
                                className={`relative h-6 w-11 cursor-pointer rounded-full transition-colors duration-200 ease-in-out ${((approvalData as any)[pref.id] ?? true) ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-700'}`}
                              >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out mt-1 ml-1 ${((approvalData as any)[pref.id] ?? true) ? 'translate-x-5' : 'translate-x-0'}`} />
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Attendance Deductions */}
                      <div>
                        <h4 className="mb-3 text-xs font-bold uppercase tracking-tight text-slate-400 dark:text-slate-500">Attendance Deduction</h4>
                        <div className="space-y-3">
                          {[
                            { id: 'applyAttendanceDeduction', label: 'Apply attendance deduction' },
                            { id: 'deductLateIn', label: 'Late-ins' },
                            { id: 'deductEarlyOut', label: 'Early-outs' },
                            { id: 'deductPermission', label: 'Permission' },
                            { id: 'deductAbsent', label: 'Absents (extra LOP)' }
                          ].map((pref) => (
                            <label key={pref.id} className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 p-3 transition-all hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50">
                              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{pref.label}</span>
                              <div
                                onClick={() => {
                                  const newVal = !((approvalData as any)[pref.id] ?? true);
                                  setApprovalData(prev => ({ ...prev, [pref.id]: newVal }));
                                }}
                                className={`relative h-6 w-11 cursor-pointer rounded-full transition-colors duration-200 ease-in-out ${((approvalData as any)[pref.id] ?? true) ? 'bg-amber-600' : 'bg-slate-200 dark:bg-slate-700'}`}
                              >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out mt-1 ml-1 ${((approvalData as any)[pref.id] ?? true) ? 'translate-x-5' : 'translate-x-0'}`} />
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Comments */}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                      Comments (Optional)
                    </label>
                    <textarea
                      value={approvalData.comments}
                      onChange={(e) => setApprovalData({ ...approvalData, comments: e.target.value })}
                      rows={3}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 resize-none"
                      placeholder="Add any comments for this approval..."
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={handleApproveApplication}
                      className="flex-1 rounded-2xl bg-gradient-to-r from-indigo-500 to-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all hover:scale-[1.02] active:scale-95"
                    >
                      Approve Salary & Finalize
                    </button>
                    <button
                      onClick={handleRejectApplication}
                      className="flex-1 rounded-2xl bg-gradient-to-r from-red-500 to-red-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-red-500/30 transition-all hover:from-red-600 hover:to-red-600"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowApprovalDialog(false)}
                      className="flex-1 rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        }

        {/* Employee Dialog */}
        {
          showDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowDialog(false)} />
              <div className="relative z-50 max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950/95">
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                      {editingEmployee ? 'Edit Employee' : 'Add New Employee'}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {editingEmployee ? 'Update employee information' : 'Enter employee details below'}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowDialog(false)}
                    className="rounded-xl border border-slate-200 bg-white p-2 text-slate-400 transition hover:border-red-200 hover:text-red-500 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {error && (
                  <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                    {error}
                  </div>
                )}

                {!editingEmployee && addFormAutoGenerateEmpNo && (
                  <div className="mb-4 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
                    <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Employee number will be auto-generated when you submit.
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Profile photo (optional) - uploads to S3 profiles folder; when editing, add or update photo */}
                  <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                    <h3 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">Profile Photo (optional)</h3>
                    <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{editingEmployee ? 'Update or add a profile photo for this employee.' : 'Upload a profile photo. JPG or PNG, max 5MB.'}</p>
                    <div className="flex flex-wrap items-start gap-4">
                      {(formData as any).profilePhoto && (
                        <div className="relative">
                          <img
                            src={(formData as any).profilePhoto}
                            alt="Profile"
                            className="h-24 w-24 rounded-xl border border-slate-200 object-cover dark:border-slate-700"
                          />
                          <button
                            type="button"
                            onClick={() => setFormData(prev => ({ ...prev, profilePhoto: '' }))}
                            className="absolute -right-2 -top-2 rounded-full bg-red-500 p-1 text-white shadow hover:bg-red-600"
                          >
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      )}
                      <div>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/jpg"
                          className="block w-full max-w-xs text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-slate-700 dark:text-slate-300 dark:file:bg-slate-800 dark:file:text-slate-200"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            try {
                              const res = await api.uploadProfile(file) as { success?: boolean; url?: string };
                              if (res?.success && res?.url) setFormData(prev => ({ ...prev, profilePhoto: res.url }));
                            } catch (err) {
                              setError('Failed to upload profile photo. Try again.');
                            }
                            e.target.value = '';
                          }}
                        />
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">JPG or PNG, max 5MB. Stored in S3 profiles folder.</p>
                      </div>
                    </div>
                  </div>

                  <DynamicEmployeeForm
                    formData={formData}
                    onChange={(newData) => {
                      setFormData(newData);
                    }}
                    errors={{}}
                    divisions={divisions}
                    employeeGroups={employeeGroups}
                    departments={departments}
                    designations={designations as any}
                    onSettingsLoaded={setFormSettings}
                    excludeFields={!editingEmployee && addFormAutoGenerateEmpNo ? ['emp_no'] : []}
                    isEditingExistingEmployee={!!editingEmployee}
                  />

                  {/* Leave Settings (Optional) */}
                  <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                    <h3 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">Leave Settings (Optional)</h3>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                          Monthly Paid Leaves
                        </label>
                        <input
                          type="number"
                          name="paidLeaves"
                          value={formData.paidLeaves ?? ''}
                          onChange={handleInputChange}
                          onWheel={(e) => e.currentTarget.blur()}
                          min="0"
                          step="0.5"
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm transition-all focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 no-spinner"
                          placeholder="Optional"
                        />
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Monthly recurring paid leaves
                        </p>
                      </div>
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                          Yearly Allotted Leaves
                        </label>
                        <input
                          type="number"
                          name="allottedLeaves"
                          value={formData.allottedLeaves ?? ''}
                          onChange={handleInputChange}
                          onWheel={(e) => e.currentTarget.blur()}
                          min="0"
                          step="0.5"
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm transition-all focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 no-spinner"
                          placeholder="Optional"
                        />
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Yearly total for without_pay/LOP leaves
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Allowances & Deductions Overrides + Salary Summary */}
                  <div className="space-y-4 rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Allowances &amp; Deductions</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Defaults come from Department/Global. Enter an amount to override for this employee.
                        </p>
                      </div>
                      {loadingComponents && (
                        <div className="text-xs text-slate-500 dark:text-slate-400">Loading components...</div>
                      )}
                    </div>

                    {/* Salary summary */}
                    <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Gross Salary</p>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          ₹{Number(formData.gross_salary || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-green-700 dark:text-green-300">Total Allowances</p>
                        <p className="text-sm font-semibold text-green-700 dark:text-green-300">
                          ₹{salarySummary.totalAllowances.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-red-700 dark:text-red-300">Total Deductions</p>
                        <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                          ₹{salarySummary.totalDeductions.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">CTC Salary</p>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          ₹{salarySummary.ctcSalary.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Calculated (Net)</p>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          ₹{salarySummary.netSalary.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      {/* Allowances */}
                      <div className="rounded-xl border border-green-100 bg-green-50/70 p-3 dark:border-green-900/40 dark:bg-green-900/20">
                        <div className="mb-2 flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-green-800 dark:text-green-200">Allowances</h4>
                          <span className="text-xs text-green-700 dark:text-green-300">
                            {componentDefaults.allowances.length} items
                          </span>
                        </div>
                        <div className="space-y-2">
                          {componentDefaults.allowances.length === 0 && (
                            <p className="text-xs text-green-700/70 dark:text-green-200/70">No allowances available.</p>
                          )}
                          {componentDefaults.allowances.map((item) => {
                            const key = getKey(item);
                            const current = overrideAllowances[key] ?? item.amount ?? 0;
                            const isFixed = item.type === 'fixed';
                            const basedOnPresentDays = overrideAllowancesBasedOnPresentDays[key] ?? item.basedOnPresentDays ?? false;
                            return (
                              <div key={key} className="rounded-lg border border-green-100 bg-white/70 px-3 py-2 text-xs dark:border-green-900/50 dark:bg-green-950/40">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex-1">
                                    <div className="font-semibold text-green-900 dark:text-green-100">{item.name}</div>
                                    <div className="text-[11px] text-green-700 dark:text-green-300">
                                      {item.type === 'percentage'
                                        ? `${item.percentage || 0}% of ${item.base || item.percentageBase || 'basic'}`
                                        : 'Fixed'}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[11px] text-green-700 dark:text-green-300">Override</span>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={current === null ? '' : current}
                                      onChange={(e) => handleOverrideChange('allowance', item, e.target.value)}
                                      onWheel={(e) => e.currentTarget.blur()}
                                      className="w-24 rounded border border-green-200 bg-white px-2 py-1 text-[11px] text-green-900 focus:border-green-400 focus:outline-none dark:border-green-800 dark:bg-green-950 dark:text-green-100 no-spinner"
                                    />
                                  </div>
                                </div>
                                {isFixed && (
                                  <div className="mt-2 pt-2 border-t border-green-100 dark:border-green-900/50">
                                    <label className="flex items-start gap-1.5 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={basedOnPresentDays}
                                        onChange={(e) => {
                                          setOverrideAllowancesBasedOnPresentDays({
                                            ...overrideAllowancesBasedOnPresentDays,
                                            [key]: e.target.checked
                                          });
                                        }}
                                        className="mt-0.5 h-3 w-3 rounded border-green-300 text-green-600 focus:ring-green-500 dark:border-green-700"
                                      />
                                      <span className="text-[10px] leading-tight text-green-700 dark:text-green-300">
                                        Prorate based on present days
                                      </span>
                                    </label>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Deductions */}
                      <div className="rounded-xl border border-red-100 bg-red-50/70 p-3 dark:border-red-900/40 dark:bg-red-900/20">
                        <div className="mb-2 flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-red-800 dark:text-red-200">Deductions</h4>
                          <span className="text-xs text-red-700 dark:text-red-300">
                            {componentDefaults.deductions.length} items
                          </span>
                        </div>
                        <div className="space-y-2">
                          {componentDefaults.deductions.length === 0 && (
                            <p className="text-xs text-red-700/70 dark:text-red-200/70">No deductions available.</p>
                          )}
                          {componentDefaults.deductions.map((item) => {
                            const key = getKey(item);
                            const current = overrideDeductions[key] ?? item.amount ?? 0;
                            const isFixed = item.type === 'fixed';
                            const basedOnPresentDays = overrideDeductionsBasedOnPresentDays[key] ?? item.basedOnPresentDays ?? false;
                            return (
                              <div key={key} className="rounded-lg border border-red-100 bg-white/70 px-3 py-2 text-xs dark:border-red-900/50 dark:bg-red-950/40">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex-1">
                                    <div className="font-semibold text-red-900 dark:text-red-100">{item.name}</div>
                                    <div className="text-[11px] text-red-700 dark:text-red-300">
                                      {item.type === 'percentage'
                                        ? `${item.percentage || 0}% of ${item.base || item.percentageBase || 'basic'}`
                                        : 'Fixed'}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[11px] text-red-700 dark:text-red-300">Override</span>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={current === null ? '' : current}
                                      onChange={(e) => handleOverrideChange('deduction', item, e.target.value)}
                                      onWheel={(e) => e.currentTarget.blur()}
                                      className="w-24 rounded border border-red-200 bg-white px-2 py-1 text-[11px] text-red-900 focus:border-red-400 focus:outline-none dark:border-red-800 dark:bg-red-950 dark:text-red-100 no-spinner"
                                    />
                                  </div>
                                </div>
                                {isFixed && (
                                  <div className="mt-2 pt-2 border-t border-red-100 dark:border-red-900/50">
                                    <label className="flex items-start gap-1.5 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={basedOnPresentDays}
                                        onChange={(e) => {
                                          setOverrideDeductionsBasedOnPresentDays({
                                            ...overrideDeductionsBasedOnPresentDays,
                                            [key]: e.target.checked
                                          });
                                        }}
                                        className="mt-0.5 h-3 w-3 rounded border-red-300 text-red-600 focus:ring-red-500 dark:border-red-700"
                                      />
                                      <span className="text-[10px] leading-tight text-red-700 dark:text-red-300">
                                        Prorate based on present days
                                      </span>
                                    </label>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>


                  {/* Actions */}
                  <div className="flex gap-3 pt-2">
                    <button
                      type="submit"
                      className="flex-1 rounded-2xl bg-gradient-to-r from-green-500 to-green-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-green-500/30 transition-all hover:from-green-600 hover:to-green-600"
                    >
                      {editingEmployee ? 'Update Employee' : 'Create Employee'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDialog(false)}
                      className="flex-1 rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )
        }

        {/* Bulk Upload Dialog */}
        {
          allowEmployeeBulkProcess && showBulkUpload && (
            <BulkUpload
              title="Bulk Upload Employees"
              templateHeaders={dynamicTemplate.headers}
              templateSample={dynamicTemplate.sample}
              templateFilename="employee_template"
              infoMessage={undefined}
              showAutoGenerateEmpNoToggle={true}
              autoGenerateEmpNo={bulkPreviewAutoGenerateEmpNo}
              onAutoGenerateEmpNoChange={setBulkPreviewAutoGenerateEmpNo}
              columns={dynamicTemplate.columns.map(col => {
                // When "ignore from file" is ON, make employee number readonly and show it will be auto-assigned
                if (col.key === 'emp_no' && bulkPreviewAutoGenerateEmpNo) {
                  return { ...col, editable: false };
                }
                if (col.key === 'division_name') {
                  return {
                    ...col,
                    type: 'select',
                    options: divisions.map(d => ({ value: d.name, label: d.name }))
                  };
                }
                if (col.key === 'department_name') {
                  return {
                    ...col,
                    type: 'select',
                    options: (row: ParsedRow) => {
                      const rowDivName = String(row.division_name || '').trim();
                      if (!rowDivName) return [];

                      const div = divisions.find(d => d.name.toLowerCase().trim() === rowDivName.toLowerCase());
                      if (!div) return [];

                      // Prefer division.departments (populated by API) so dropdown shows departments correctly
                      const divDepts = (div as any).departments;
                      if (divDepts && Array.isArray(divDepts) && divDepts.length > 0) {
                        return divDepts.map((d: any) => ({
                          value: typeof d === 'object' && d?.name ? d.name : (departments.find(dept => dept._id === (typeof d === 'string' ? d : d._id))?.name || String(d)),
                          label: typeof d === 'object' && d?.name ? d.name : (departments.find(dept => dept._id === (typeof d === 'string' ? d : d._id))?.name || String(d))
                        }));
                      }
                      // Fallback: filter departments by department.divisions containing this division
                      return departments
                        .filter(dept => (dept as any).divisions?.some((d: any) => String(typeof d === 'string' ? d : d._id) === String(div._id)))
                        .map(dept => ({ value: dept.name, label: dept.name }));
                    }
                  };
                }
                if (col.key === 'designation_name') {
                  return {
                    ...col,
                    type: 'select',
                    options: designations.map(d => ({ value: d.name, label: d.name }))
                  };
                }
                if (col.key === 'group_name') {
                  return {
                    ...col,
                    type: 'select',
                    options: employeeGroups.filter((g) => g.isActive !== false).map((g) => ({ value: g.name, label: g.name })),
                  };
                }
                if (col.key === 'gender') {
                  return { ...col, type: 'select', options: [{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }, { value: 'Other', label: 'Other' }] };
                }
                if (col.key === 'marital_status') {
                  return { ...col, type: 'select', options: [{ value: 'Single', label: 'Single' }, { value: 'Married', label: 'Married' }, { value: 'Divorced', label: 'Divorced' }, { value: 'Widowed', label: 'Widowed' }] };
                }
                if (col.key === 'blood_group') {
                  return { ...col, type: 'select', options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg => ({ value: bg, label: bg })) };
                }

                // Handle userselect fields (like reporting_to)
                const field = formSettings?.groups?.flatMap((g: any) => g.fields).find((f: any) => f.id === col.key);
                if (field?.type === 'userselect' || col.key === 'reporting_to') {
                  return {
                    ...col,
                    type: 'select',
                    options: employees.map(e => ({ value: e._id, label: e.employee_name }))
                  };
                }
                return col;
              })}
              validateRow={(row, index, allData) => {
                const mappedUsers = employees.map(e => ({ _id: e._id, name: e.employee_name }));
                const result = validateEmployeeRow(row, divisions, departments, designations as any, mappedUsers, {
                  autoGenerateEmpNo: bulkPreviewAutoGenerateEmpNo,
                  customEmployeeGroupingEnabled,
                  employeeGroups: employeeGroups.filter((g) => g.isActive !== false),
                });
                const errors = [...result.errors];
                const fieldErrors = { ...result.fieldErrors };

                // Check for duplicates within the file (skip for auto-assigned rows when ignore-from-file is ON)
                const empNo = String(row.emp_no || '').trim().toUpperCase();
                const isAutoRow = bulkPreviewAutoGenerateEmpNo && (empNo === '' || empNo === '(AUTO)');
                if (empNo && !isAutoRow) {
                  const isDuplicateInFile = allData.some((r, i) => {
                    const other = String(r.emp_no || '').trim().toUpperCase();
                    if (i === index) return false;
                    if (bulkPreviewAutoGenerateEmpNo && (other === '' || other === '(AUTO)')) return false;
                    return other === empNo;
                  });
                  if (isDuplicateInFile) {
                    errors.push('Duplicate Employee No within this file');
                    fieldErrors.emp_no = 'File Duplicate';
                  }
                }

                // Validate dynamic fields from formSettings
                if (formSettings?.groups) {
                  formSettings.groups.forEach((group: any) => {
                    if (!group.isEnabled) return;
                    group.fields.forEach((field: any) => {
                      if (!field.isEnabled) return;

                      // Core fields are already validated in validateEmployeeRow, but we check their fieldId mapping
                      // Some fields in formSettings might have different IDs but we map them to headers in template
                      const value = row[field.id];

                      // Only validate fields that are NOT already handled by validateEmployeeRow
                      // validateEmployeeRow handles: emp_no, employee_name, division_name, department_name, designation_name, gender, dob, doj, marital_status, blood_group
                      const handledFields = ['emp_no', 'employee_name', 'division_name', 'department_name', 'designation_name', 'group_name', 'division_id', 'department_id', 'designation_id', 'employee_group_id', 'gender', 'dob', 'doj', 'marital_status', 'blood_group'];

                      if (!handledFields.includes(field.id) && field.isRequired) {
                        if (value === undefined || value === null || value === '') {
                          errors.push(`${field.label} is required`);
                          fieldErrors[field.id] = 'Required';
                        }
                      }

                      // Manual validation for phone numbers in preview (must be 10 digits)
                      if (field.id === 'phone_number' && value !== undefined && value !== null && value !== '') {
                        const digitsOnly = String(value).replace(/\D/g, '');
                        if (digitsOnly.length !== 10) {
                          errors.push('Phone number must be exactly 10 digits');
                          fieldErrors[field.id] = 'Must be 10 digits';
                        }
                      }
                    });
                  });
                }

                return { isValid: errors.length === 0, errors, fieldErrors, mappedRow: result.mappedRow };
              }}
              onSubmit={async (data) => {
                const batchData: any[] = [];
                const processingErrors: string[] = [];

                data.forEach((row) => {
                  try {
                    // Map division, department and designation names to IDs
                    const divId = divisions.find(d => d.name.toLowerCase().trim() === String(row.division_name || '').toLowerCase().trim())?._id;
                    const deptId = departments.find(d =>
                      d.name.toLowerCase().trim() === String(row.department_name || '').toLowerCase().trim()
                    )?._id;
                    const desigInput = String(row.designation_name || '').toLowerCase().trim();
                    const desigId = designations.find(d =>
                      d.name?.toLowerCase().trim() === desigInput ||
                      (d.code && String(d.code).toLowerCase().trim() === desigInput)
                    )?._id;
                    const groupNameInput = String(row.group_name || '').trim();
                    const groupIdSubmit =
                      customEmployeeGroupingEnabled && groupNameInput
                        ? employeeGroups.find(
                          (g) =>
                            g.isActive !== false &&
                            g.name.toLowerCase().trim() === groupNameInput.toLowerCase()
                        )?._id
                        : undefined;

                    const employeeData: any = {
                      ...row,
                      division_id: divId || undefined,
                      department_id: deptId || undefined,
                      designation_id: desigId || undefined,
                      employee_group_id: groupIdSubmit || undefined,
                      proposedSalary: row.proposedSalary || row.gross_salary || 0
                    };
                    delete employeeData.group_name;
                    // Never send the display placeholder "(Auto)" as emp_no. Send empty so backend assigns.
                    const empNoRaw = String(employeeData.emp_no || '').trim();
                    if (empNoRaw.toUpperCase() === '(AUTO)' || bulkPreviewAutoGenerateEmpNo) {
                      employeeData.emp_no = '';
                    }

                    // Handle dynamic fields based on form settings
                    const coreFields = ['emp_no', 'employee_name', 'proposedSalary', 'gross_salary', 'second_salary', 'division_id', 'department_id', 'designation_id', 'employee_group_id', 'division_name', 'department_name', 'designation_name', 'group_name', 'doj', 'dob', 'gender', 'marital_status', 'blood_group', 'qualifications', 'experience', 'address', 'location', 'aadhar_number', 'phone_number', 'alt_phone_number', 'email', 'pf_number', 'esi_number', 'bank_account_no', 'bank_name', 'bank_place', 'ifsc_code', 'salary_mode'];

                    if (formSettings?.groups) {
                      const dynamicFields: any = {};
                      formSettings.groups.forEach((group: any) => {
                        group.fields.forEach((field: any) => {
                          if (row[field.id] !== undefined && row[field.id] !== null && row[field.id] !== '') {
                            const val = parseDynamicField(row[field.id], field);
                            if (!coreFields.includes(field.id)) {
                              dynamicFields[field.id] = val;
                              delete employeeData[field.id];
                            } else {
                              employeeData[field.id] = val;
                            }
                          }
                        });
                      });
                      if (Object.keys(dynamicFields).length > 0) {
                        employeeData.dynamicFields = dynamicFields;
                      }
                    }

                    // Handle special case for qualifications if enabled
                    if (formSettings?.qualifications?.isEnabled && row.qualifications) {
                      const qualDef = {
                        type: 'array',
                        itemType: 'object',
                        fields: formSettings.qualifications.fields
                      };
                      employeeData.qualifications = parseDynamicField(row.qualifications, qualDef);
                    }

                    batchData.push(employeeData);
                  } catch (err: any) {
                    processingErrors.push(`${row.emp_no || 'Row'}: Failed to process row data`);
                  }
                });

                if (batchData.length === 0) {
                  return { success: false, message: 'No valid data to upload' };
                }

                try {
                  const response = await api.bulkCreateEmployeeApplications(batchData);
                  loadApplications();
                  loadEmployees();

                  if (response.success) {
                    return {
                      success: true,
                      message: `Successfully created ${response.data?.successCount || batchData.length} applications`
                    };
                  } else {
                    return {
                      success: false,
                      message: response.message || 'Partial upload failure',
                      failedRows: response.data?.errors || []
                    };
                  }
                } catch (err: any) {
                  console.error('Bulk upload request error:', err);
                  return { success: false, message: 'Failed to send bulk upload request' };
                }
              }}
              onClose={() => setShowBulkUpload(false)}
            />
          )
        }

        {/* Employee View Dialog */}
        {
          showViewDialog && viewingEmployee && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => { setShowViewDialog(false); setCertificatePreviewUrl(null); }} />
              <div className="relative z-50 max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950/95">
                <div className="mb-6 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {(viewingEmployee as any).profilePhoto ? (
                      <img
                        src={(viewingEmployee as any).profilePhoto}
                        alt={viewingEmployee.employee_name || 'Profile'}
                        className="h-16 w-16 rounded-xl border border-slate-200 object-cover dark:border-slate-700"
                      />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-xl font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                        {(viewingEmployee.employee_name || '?').charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div className="mb-1 flex items-center gap-3">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          Gross: {viewingEmployee.gross_salary ? `₹${viewingEmployee.gross_salary.toLocaleString()}` : '-'}
                        </span>
                        <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-semibold text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300">
                          Cert Status: {viewingEmployee.qualificationStatus || '—'}
                        </span>
                      </div>
                      <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                        {viewingEmployee.employee_name}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Employee No: {viewingEmployee.emp_no}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {viewingEmployee.leftDate && (
                      <button
                        onClick={() => {
                          setShowViewDialog(false);
                          setCertificatePreviewUrl(null);
                          handleRemoveLeftDate(viewingEmployee);
                        }}
                        className="rounded-xl bg-gradient-to-r from-green-500 to-green-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-green-500/30 transition-all hover:from-green-600 hover:to-green-600"
                      >
                        Reactivate
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setShowViewDialog(false);
                        setCertificatePreviewUrl(null);
                        handleEdit(viewingEmployee);
                      }}
                      className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => { setShowViewDialog(false); setCertificatePreviewUrl(null); }}
                      className="rounded-xl border border-slate-200 bg-white p-2 text-slate-400 transition hover:border-red-200 hover:text-red-500 dark:border-slate-700 dark:bg-slate-900"
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="space-y-6">
                  {/* Action Bar for Pending Items */}
                  {(pendingUpdateForViewing || pendingAppForViewing) && (
                    <div className="mb-6 overflow-hidden rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4 dark:border-indigo-900/30 dark:bg-indigo-900/10">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-400">
                            <AlertTriangle className="h-5 w-5" />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">Action Required</h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400">This employee has pending management actions.</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {pendingUpdateForViewing && (
                            <button
                              onClick={() => setSelectedUpdateRequest(pendingUpdateForViewing)}
                              className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-bold text-indigo-600 shadow-sm transition hover:bg-slate-50 dark:bg-slate-800 dark:text-indigo-400 dark:hover:bg-slate-700"
                            >
                              <LucideClock className="h-4 w-4" />
                              Review Profile Changes
                            </button>
                          )}
                          {pendingAppForViewing && (
                            <button
                              onClick={() => {
                                setEmployeeViewTab('profile');
                                setTimeout(() => {
                                  const element = document.getElementById('salary-approval-section');
                                  element?.scrollIntoView({ behavior: 'smooth' });
                                }, 100);
                              }}
                              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md transition hover:bg-indigo-700 hover:shadow-lg shadow-indigo-500/30"
                            >
                              <CheckCircle className="h-4 w-4" />
                              Finalize Salary Structure
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Status Badge */}

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={viewingEmployee.is_active !== false
                        ? 'inline-flex rounded-full px-3 py-1 text-sm font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'inline-flex rounded-full px-3 py-1 text-sm font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}>
                        {viewingEmployee.is_active !== false ? 'Active' : 'Inactive'}
                      </span>
                      {viewingEmployee.leftDate && (
                        <span className="inline-flex rounded-full px-3 py-1 text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          Last working date: {new Date(viewingEmployee.leftDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {/* Simple tabs: Profile / History (history visible for super admin users) */}
                    <div className="inline-flex rounded-full bg-slate-100 p-1 text-xs font-medium text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                      <button
                        type="button"
                        onClick={() => setEmployeeViewTab('profile')}
                        className={`px-3 py-1 rounded-full transition ${employeeViewTab === 'profile'
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                          : 'bg-transparent'
                          }`}
                      >
                        Profile
                      </button>
                      <button
                        type="button"
                        onClick={() => setEmployeeViewTab('history')}
                        className={`px-3 py-1 rounded-full transition ${employeeViewTab === 'history'
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                          : 'bg-transparent'
                          }`}
                      >
                        History
                      </button>
                    </div>
                  </div>

                  {employeeViewTab === 'profile' && (
                    <>


                      {/* Basic Information */}

                      <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50">
                        <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Basic Information</h3>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Employee Number</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.emp_no || '-'}</p>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Name</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.employee_name || '-'}</p>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Department</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.department?.name || '-'}</p>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Designation</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.designation?.name || '-'}</p>
                          </div>
                          {customEmployeeGroupingEnabled && (
                            <div>
                              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Group</label>
                              <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                                {(viewingEmployee as any).employee_group?.name || ((viewingEmployee as any).employee_group_id as any)?.name || '-'}
                              </p>
                            </div>
                          )}
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Date of Joining</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.doj ? new Date(viewingEmployee.doj).toLocaleDateString() : '-'}</p>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Date of Birth</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.dob ? new Date(viewingEmployee.dob).toLocaleDateString() : '-'}</p>
                          </div>

                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Gender</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.gender || '-'}</p>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Marital Status</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.marital_status || '-'}</p>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Blood Group</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.blood_group || '-'}</p>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Phone Number</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.phone_number || '-'}</p>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Alternate Phone</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.alt_phone_number || '-'}</p>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Email</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.email || '-'}</p>
                          </div>
                          <div className="sm:col-span-2 lg:col-span-3">
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Address</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.address || '-'}</p>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Location</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.location || '-'}</p>
                          </div>
                        </div>
                      </div>

                      {/* Financial Information */}
                      <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50">
                        <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Financial Information</h3>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">PF Number</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.pf_number || '-'}</p>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">ESI Number</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.esi_number || '-'}</p>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Aadhar Number</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.aadhar_number || '-'}</p>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Account Number</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.bank_account_no || '-'}</p>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Bank Name</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.bank_name || '-'}</p>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Bank Place</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.bank_place || '-'}</p>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">IFSC Code</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.ifsc_code || '-'}</p>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Salary Mode</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.salary_mode || 'Bank'}</p>
                          </div>
                        </div>
                        <div className="mt-4 flex justify-end">
                          <button
                            type="button"
                            onClick={() => setShowBankUpdateDialog(true)}
                            className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-300"
                          >
                            Update Bank Details
                          </button>
                        </div>
                      </div>

                      {/* Deduction Preferences - Statutory & Attendance flags */}
                      <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50">
                        <h3 className="mb-2 text-lg font-semibold text-slate-900 dark:text-slate-100">Deduction Preferences</h3>
                        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
                          Controls which statutory and attendance deductions apply to this employee during payroll. Disabled items are not calculated (amount 0).
                        </p>
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                          <div>
                            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Statutory</p>
                            <div className="space-y-3">
                              {[
                                { key: 'applyProfessionTax', label: 'Profession Tax' },
                                { key: 'applyESI', label: 'ESI' },
                                { key: 'applyPF', label: 'PF' },
                              ].map(({ key, label }) => {
                                const isEnabled = (viewingEmployee as any)[key] !== false;
                                return (
                                  <div key={key} className="flex items-center justify-between rounded-xl border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
                                    <button
                                      onClick={() => handleToggleDeductionPreference(key, !isEnabled)}
                                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isEnabled ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-700'
                                        }`}
                                    >
                                      <span
                                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isEnabled ? 'translate-x-6' : 'translate-x-1'
                                          }`}
                                      />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          <div>
                            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Attendance deduction</p>
                            <div className="space-y-3">
                              {[
                                { key: 'applyAttendanceDeduction', label: 'Apply attendance deduction' },
                                { key: 'deductLateIn', label: 'Late-ins' },
                                { key: 'deductEarlyOut', label: 'Early-outs' },
                                { key: 'deductPermission', label: 'Permission' },
                                { key: 'deductAbsent', label: 'Absents (extra LOP)' },
                              ].map(({ key, label }) => {
                                const isEnabled = (viewingEmployee as any)[key] !== false;
                                return (
                                  <div key={key} className="flex items-center justify-between rounded-xl border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
                                    <button
                                      onClick={() => handleToggleDeductionPreference(key, !isEnabled)}
                                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isEnabled ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-700'
                                        }`}
                                    >
                                      <span
                                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isEnabled ? 'translate-x-6' : 'translate-x-1'
                                          }`}
                                      />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Professional Information */}
                      <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50">
                        <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Professional Information</h3>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          <div className="sm:col-span-2 lg:col-span-3">
                            <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                              <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Qualifications</label>
                              {(() => {
                                const statuses = formSettings?.qualification_statuses || ['Partial', 'Not Certified', 'Certified'];
                                if (pendingAppForViewing) {
                                  return (
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                      <span className="text-xs font-medium text-slate-500">Overall Status:</span>
                                      <select
                                        value={approvalData.qualificationStatus || 'Partial'}
                                        onChange={(e) => setApprovalData({ ...approvalData, qualificationStatus: e.target.value })}
                                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
                                      >
                                        {statuses.map((st: any) => {
                                          const val = typeof st === 'object' ? st.value : st;
                                          const label = typeof st === 'object' ? st.label : st;
                                          return <option key={val} value={val}>{label}</option>;
                                        })}
                                      </select>
                                    </div>
                                  );
                                } else {
                                  return (
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                      <span className="text-xs font-medium text-slate-500">Overall Status:</span>
                                      <span className="rounded-full px-2.5 py-1 text-xs font-semibold bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300">
                                        {viewingEmployee.qualificationStatus || '—'}
                                      </span>
                                    </div>
                                  );
                                }
                              })()}
                            </div>
                            {(() => {
                              const quals = viewingEmployee.qualifications;
                              if (!quals || (Array.isArray(quals) && quals.length === 0)) {
                                return <p className="text-sm font-medium text-slate-900 dark:text-slate-100">-</p>;
                              }
                              if (Array.isArray(quals)) {
                                const qualFields = (formSettings?.qualifications?.fields || []).filter((f: any) => f.isEnabled !== false).sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
                                return (
                                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                                    <table className="w-full min-w-[700px] text-left text-sm">
                                      <thead>
                                        <tr className="border-b border-slate-200 bg-slate-100/80 dark:border-slate-700 dark:bg-slate-800/80">
                                          {qualFields.map((f: any) => (
                                            <th key={f.id} className="whitespace-nowrap px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">
                                              {f.label}
                                            </th>
                                          ))}
                                          <th className="w-20 px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">View</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {quals.map((qual: any, idx: number) => {
                                          const certificateUrl = qual.certificateUrl;
     
                                          return (
                                            <tr key={idx} className="border-b border-slate-100 dark:border-slate-700/50">
                                              {qualFields.map((f: any) => {
                                                const val = qual[f.id] ?? qual[f.label];
                                                const display = val != null && val !== '' ? (f.type === 'boolean' ? (val ? 'Yes' : 'No') : String(val)) : '—';
                                                return (
                                                  <td key={f.id} className="px-3 py-2 text-slate-700 dark:text-slate-300">
                                                    {display}
                                                  </td>
                                                );
                                              })}
                                              <td className="px-3 py-2">
                                                {certificateUrl ? (
                                                  <button
                                                    type="button"
                                                    onClick={() => setCertificatePreviewUrl(certificateUrl)}
                                                    className="rounded bg-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-300 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500"
                                                  >
                                                    View
                                                  </button>
                                                ) : (
                                                  <span className="text-slate-400 dark:text-slate-500">—</span>
                                                )}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                );
                              }
                              return <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{String(quals)}</p>;
                            })()}
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Experience (Years)</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.experience ?? '-'}</p>
                          </div>
                        </div>
                      </div>


                      {/* Salary and Leave Details */}
                      <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50">
                        <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Salary and Leave Details</h3>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Gross Salary</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.gross_salary ? `₹${viewingEmployee.gross_salary.toLocaleString()}` : '-'}</p>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Second Salary</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.second_salary ? `₹${viewingEmployee.second_salary.toLocaleString()}` : '-'}</p>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Paid Leaves</label>
                            {pendingAppForViewing ? (
                              <input
                                type="number"
                                value={approvalData.paidLeaves ?? 0}
                                onChange={(e) => setApprovalData({ ...approvalData, paidLeaves: Number(e.target.value) })}
                                onWheel={(e) => e.currentTarget.blur()}
                                className="mt-1 w-full max-w-[120px] rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white no-spinner"
                              />
                            ) : (
                              <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                                {(() => {
                                  const val = (viewingEmployee as any).paid_leaves ?? viewingEmployee.dynamicFields?.paid_leaves;
                                  return val !== undefined && val !== null ? String(val) : '0';
                                })()}
                              </p>
                            )}
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              Total paid leaves balance
                            </p>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Casual Leaves</label>
                            {pendingAppForViewing ? (
                              <input
                                type="number"
                                value={approvalData.casualLeaves ?? 0}
                                onChange={(e) => setApprovalData({ ...approvalData, casualLeaves: Number(e.target.value) })}
                                onWheel={(e) => e.currentTarget.blur()}
                                className="mt-1 w-full max-w-[120px] rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white no-spinner"
                              />
                            ) : (
                              <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                                {(() => {
                                  const val = viewingEmployee.casualLeaves ?? (viewingEmployee as any).casual_leaves ?? viewingEmployee.dynamicFields?.casual_leaves;
                                  return val !== undefined && val !== null ? String(val) : '0';
                                })()}
                              </p>
                            )}
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              Casual leaves count
                            </p>
                          </div>
                          {((viewingEmployee as any).ctcSalary !== undefined && (viewingEmployee as any).ctcSalary !== null) && (
                            <div>
                              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">CTC Salary</label>
                              <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                                ₹{Number((viewingEmployee as any).ctcSalary || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              </p>
                            </div>
                          )}
                          {((viewingEmployee as any).calculatedSalary !== undefined && (viewingEmployee as any).calculatedSalary !== null) && (
                            <div>
                              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Calculated Salary (Net)</label>
                              <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                                ₹{Number((viewingEmployee as any).calculatedSalary || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Integrated Salary Approval Section (Consolidated Flow) */}
                      {pendingAppForViewing && selectedApplication && (
                        <div id="salary-approval-section" className="mb-6 overflow-hidden rounded-2xl border-2 border-green-200 bg-green-50/50 shadow-sm dark:border-green-800 dark:bg-green-900/20">
                          <div className="border-b border-green-100 bg-green-100/30 px-5 py-3 dark:border-green-800 dark:bg-green-950/30">
                            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-green-800 dark:text-green-400">
                              <ShieldCheck className="h-4 w-4" />
                              Final Salary Approval
                            </h3>
                          </div>

                          <div className="p-5">
                            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                              {/* Left Column: Form Fields */}
                              <div className="space-y-4">
                                <div>
                                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    Approved Salary (Monthly Gross) *
                                  </label>
                                  <input
                                    type="number"
                                    value={approvalData.approvedSalary}
                                    onChange={(e) => setApprovalData({ ...approvalData, approvedSalary: Number(e.target.value) })}
                                    onWheel={(e) => e.currentTarget.blur()}
                                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-500/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 no-spinner"
                                  />
                                  <p className="mt-1.5 text-[10px] text-slate-500">Proposed by HR: ₹{selectedApplication.proposedSalary.toLocaleString()}</p>
                                </div>

                                <div>
                                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    Second Salary / Fixed Allowance
                                  </label>
                                  <input
                                    type="number"
                                    value={(approvalData as any).second_salary || ''}
                                    onChange={(e) => setApprovalData({ ...approvalData, second_salary: Number(e.target.value) } as any)}
                                    onWheel={(e) => e.currentTarget.blur()}
                                    placeholder="Enter additional amount"
                                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold transition-all focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 no-spinner"
                                  />
                                </div>

                                <div>
                                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    Date of Joining *
                                  </label>
                                  <input
                                    type="date"
                                    value={approvalData.doj || ''}
                                    onChange={(e) => setApprovalData({ ...approvalData, doj: e.target.value })}
                                    className="w-full rounded-xl border-2 border-green-400 bg-white px-4 py-2.5 text-sm font-bold transition-all focus:border-green-500 focus:outline-none dark:border-green-600 dark:bg-slate-900 dark:text-slate-100"
                                  />
                                </div>
                              </div>

                              {/* Right Column: Allowances/Deductions Preview */}
                              <div className="space-y-4">
                                <div className="rounded-xl border border-slate-200 bg-white/50 p-4 dark:border-slate-700 dark:bg-slate-900/50">
                                  <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Salary Summary</h4>
                                  <div className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">Gross Salary</span>
                                      <span className="font-semibold text-slate-900 dark:text-slate-100">₹{Number(approvalData.approvedSalary || 0).toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-green-600">Total Allowances</span>
                                      <span className="font-semibold text-green-600">+₹{approvalSalarySummary.totalAllowances.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-red-600">Total Deductions</span>
                                      <span className="font-semibold text-red-600">-₹{approvalSalarySummary.totalDeductions.toLocaleString()}</span>
                                    </div>
                                    <div className="mt-2 border-t border-slate-200 pt-2 flex justify-between font-bold text-slate-900 dark:text-slate-100">
                                      <span>Net Salary</span>
                                      <span>₹{approvalSalarySummary.netSalary.toLocaleString()}</span>
                                    </div>
                                  </div>
                                </div>

                                <div>
                                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Comments</label>
                                  <textarea
                                    value={approvalData.comments}
                                    onChange={(e) => setApprovalData({ ...approvalData, comments: e.target.value })}
                                    className="h-24 w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm transition-all focus:border-green-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    placeholder="Add notes about this approval..."
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Overrides Expanded Section (Optional toggle if too long) */}
                            <div className="mt-6">
                              <button
                                type="button"
                                onClick={() => setShowApprovalOverrides(!showApprovalOverrides)}
                                className="flex items-center gap-2 text-xs font-bold text-green-700 dark:text-green-400 hover:underline"
                              >
                                {showApprovalOverrides ? 'Hide component overrides' : 'Show component overrides (Allowances/Deductions)'}
                                <ChevronRight className={`h-4 w-4 transition-transform ${showApprovalOverrides ? 'rotate-90' : ''}`} />
                              </button>

                              {showApprovalOverrides && (
                                <div className="mt-4 grid gap-4 md:grid-cols-2">
                                  {/* Copying minimized version of override inputs here or just using the existing logic */}
                                  <div className="rounded-xl border border-green-100 bg-green-50/30 p-4">
                                    <h5 className="mb-3 text-[10px] font-bold uppercase text-green-700">Allowances</h5>
                                    <div className="space-y-3">
                                      {approvalComponentDefaults.allowances.map(item => {
                                        const key = getKey(item);
                                        const current = approvalOverrideAllowances[key] ?? item.amount ?? 0;
                                        return (
                                          <div key={key} className="flex items-center justify-between gap-4">
                                            <span className="text-xs text-slate-700 dark:text-slate-300">{item.name}</span>
                                            <input
                                              type="number"
                                              value={current === null ? '' : current}
                                              onChange={(e) => handleApprovalOverrideChange('allowance', item, e.target.value)}
                                              onWheel={(e) => e.currentTarget.blur()}
                                              className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-right no-spinner"
                                            />
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                  <div className="rounded-xl border border-red-100 bg-red-50/30 p-4">
                                    <h5 className="mb-3 text-[10px] font-bold uppercase text-red-700">Deductions</h5>
                                    <div className="space-y-3">
                                      {approvalComponentDefaults.deductions.map(item => {
                                        const key = getKey(item);
                                        const current = approvalOverrideDeductions[key] ?? item.amount ?? 0;
                                        return (
                                          <div key={key} className="flex items-center justify-between gap-4">
                                            <span className="text-xs text-slate-700 dark:text-slate-300">{item.name}</span>
                                            <input
                                              type="number"
                                              value={current === null ? '' : current}
                                              onChange={(e) => handleApprovalOverrideChange('deduction', item, e.target.value)}
                                              onWheel={(e) => e.currentTarget.blur()}
                                              className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-right no-spinner"
                                            />
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="mt-6 flex justify-end gap-3">
                              <button
                                onClick={handleRejectApplication}
                                className="rounded-xl px-6 py-2.5 text-sm font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
                              >
                                Reject Application
                              </button>
                              <button
                                onClick={handleApproveApplication}
                                className="rounded-xl bg-gradient-to-r from-green-600 to-green-700 px-8 py-2.5 text-sm font-bold text-white shadow-lg shadow-green-600/30 transition-all hover:scale-[1.02] active:scale-95"
                              >
                                Approve & Finalize
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {employeeViewTab === 'history' && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5 dark:border-slate-700 dark:bg-slate-900/60">
                      <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Employee History</h3>
                      {employeeHistoryLoading && (
                        <p className="text-sm text-slate-500 dark:text-slate-400">Loading history…</p>
                      )}
                      {!employeeHistoryLoading && employeeHistory.length === 0 && (
                        <p className="text-sm text-slate-500 dark:text-slate-400">No history recorded for this employee yet.</p>
                      )}
                      {!employeeHistoryLoading && employeeHistory.length > 0 && (
                        <ol className="relative space-y-4 border-l border-slate-200 pl-4 text-sm dark:border-slate-700">
                          {employeeHistory.map((h: any, index: number) => {
                            const ts = h.timestamp || h.created_at;
                            const when = ts ? new Date(ts).toLocaleString() : '-';
                            const actor = h.performedByName || 'System';
                            const role = h.performedByRole ? ` (${h.performedByRole})` : '';
                            const labelMap: Record<string, string> = {
                              application_created: 'Application created',
                              employee_verified: 'Employee verified',
                              salary_approved: 'Salary approved',
                              data_updated: 'Data updated',
                              status_changed: 'Status changed',
                              employee_updated: 'Profile updated',
                              resignation_submitted: 'Resignation submitted',
                              resignation_step_approved: 'Resignation step approved',
                              resignation_step_rejected: 'Resignation step rejected',
                              resignation_final_approved: 'Resignation fully approved',
                              resignation_rejected: 'Resignation rejected',
                              left_date_set: 'Left date set',
                              left_date_cleared: 'Left date cleared',
                              leave_applied: 'Leave applied',
                              leave_approved: 'Leave approved',
                              leave_rejected: 'Leave rejected',
                              od_applied: 'OD applied',
                              od_approved: 'OD approved',
                              od_rejected: 'OD rejected',
                              credentials_resent: 'Credentials resent',
                              password_reset: 'Password reset',
                              user_promoted: 'User promoted',
                              user_demoted: 'User role changed',
                              user_activated: 'User activated',
                              user_deactivated: 'User deactivated',
                              user_deleted: 'User deleted',
                            };
                            const label = labelMap[h.event] || h.event || 'Event';
                            const rawChanges = h.details?.changes;
                            const skipDisplayFields = new Set(['getQualifications', 'allData', 'updated_at', '__v', 'created_at']);
                            const changes = Array.isArray(rawChanges)
                              ? rawChanges.filter((c: any) => !skipDisplayFields.has(c.field))
                              : [];
                            const fieldLabelMap: Record<string, string> = {
                              division_id: 'Division',
                              department_id: 'Department',
                              designation_id: 'Designation',
                              qualifications: 'Qualifications',
                              dynamicFields: 'Dynamic fields',
                              name: 'Name',
                              employee_name: 'Name',
                              email: 'Email',
                              personal_email: 'Personal Email',
                              phone: 'Phone',
                              phone_number: 'Phone Number',
                              emp_no: 'Employee number',
                              date_of_joining: 'Date of joining',
                              date_of_birth: 'Date of Birth',
                              dob: 'Date of Birth',
                              doj: 'Joining Date',
                              gender: 'Gender',
                              marital_status: 'Marital Status',
                              blood_group: 'Blood Group',
                              address: 'Address',
                              leftDate: 'Left date',
                              leftReason: 'Left reason',
                            };
                            const refMaps = historyRefNames;
                            const formatChangeValue = (v: unknown, field?: string): string => {
                              if (v === undefined || v === null) return '—';
                              if (Array.isArray(v)) {
                                const arr = v as any[];
                                if (!arr.length) return '—';
                                if (field === 'qualifications') {
                                  const summaries = arr.map((item: any) => {
                                    if (item && typeof item === 'object') {
                                      const o = item as Record<string, any>;
                                      const primary = o.Examination ?? o['Examination'] ?? o.degree ?? o.course ?? o.title ?? o['School/College name'] ?? o.University ?? o['University/Board'] ?? o.name;
                                      if (primary != null) return String(primary);
                                      const keys = Object.keys(o).filter((k) => !k.startsWith('_'));
                                      if (keys.length) return `${keys[0]}: ${String(o[keys[0]])}`;
                                      return '[item]';
                                    }
                                    return String(item);
                                  });
                                  const preview = summaries.slice(0, 2).join(', ');
                                  return summaries.length > 2 ? `${preview} +${summaries.length - 2} more` : preview;
                                }
                                const allPrimitive = arr.every((it) => it == null || typeof it !== 'object');
                                if (allPrimitive) return arr.map((it) => String(it)).join(', ');
                                return `${arr.length} item(s)`;
                              }
                              if (typeof v === 'object' && v !== null) {
                                const o = v as Record<string, unknown>;
                                if (typeof o.name === 'string') return o.name;
                                const keys = Object.keys(o).filter((k) => !k.startsWith('_'));
                                if (keys.length) return `${keys.length} field(s)`;
                                return '[updated]';
                              }
                              const s = String(v);
                              if (s === '[object Object]') return '[updated]';
                              if (field === 'division_id' && /^[a-f\d]{24}$/i.test(s)) return refMaps.division[s] ?? s;
                              if (field === 'department_id' && /^[a-f\d]{24}$/i.test(s)) return refMaps.department[s] ?? s;
                              if (field === 'designation_id' && /^[a-f\d]{24}$/i.test(s)) return refMaps.designation[s] ?? s;
                              if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
                                try {
                                  return new Date(s).toLocaleDateString();
                                } catch {
                                  return s;
                                }
                              }
                              return s;
                            };
                            // Choose colour variant based on event category
                            let ringColor = 'border-slate-400';
                            let cardBorder = 'border-slate-200 dark:border-slate-700';
                            let pillBg = 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200';

                            const ev = h.event as string;
                            if (ev?.startsWith('resignation') || ev === 'left_date_set' || ev === 'left_date_cleared') {
                              ringColor = 'border-orange-500';
                              cardBorder = 'border-orange-200 dark:border-orange-700/70';
                              pillBg = 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200';
                            } else if (ev?.startsWith('leave_')) {
                              ringColor = 'border-emerald-500';
                              cardBorder = 'border-emerald-200 dark:border-emerald-700/70';
                              pillBg = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200';
                            } else if (ev?.startsWith('od_')) {
                              ringColor = 'border-sky-500';
                              cardBorder = 'border-sky-200 dark:border-sky-700/70';
                              pillBg = 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200';
                            } else if (ev === 'credentials_resent' || ev === 'password_reset' || ev?.startsWith('user_')) {
                              ringColor = 'border-violet-500';
                              cardBorder = 'border-violet-200 dark:border-violet-700/70';
                              pillBg = 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200';
                            } else if (ev === 'employee_updated') {
                              ringColor = 'border-amber-500';
                              cardBorder = 'border-amber-200 dark:border-amber-700/70';
                              pillBg = 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200';
                            }

                            return (

                              <li key={h._id || `${h.event}-${when}-${actor}-${index}`} className="relative pl-4">
                                {/* Timeline dot */}
                                <span
                                  className={`absolute -left-[9px] flex h-4 w-4 items-center justify-center rounded-full border-2 ${ringColor} bg-white dark:bg-slate-950`}
                                >
                                  <span className="h-1.5 w-1.5 rounded-full bg-slate-500 dark:bg-slate-300" />
                                </span>

                                {/* Card */}
                                <div
                                  className={`rounded-2xl border ${cardBorder} bg-white/90 p-3 shadow-sm shadow-slate-900/5 dark:bg-slate-950/70`}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="space-y-1">
                                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${pillBg}`}>
                                        {label}
                                      </span>
                                      <div className="text-xs text-slate-500 dark:text-slate-400">
                                        {when} • {actor}
                                        {role}
                                      </div>
                                    </div>
                                  </div>
                                  {h.comments && (
                                    <div className="mt-2 text-xs text-slate-700 dark:text-slate-200">
                                      {h.comments}
                                    </div>
                                  )}
                                  {h.details?.gross_salary && (
                                    <div className="mt-2 flex items-baseline gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                      <span>Gross Salary:</span>
                                      <span className="font-mono">₹{Number(h.details.gross_salary).toLocaleString()}</span>
                                    </div>
                                  )}
                                  {h.details?.action && !h.comments && (
                                    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 italic">
                                      {h.details.action}
                                    </div>
                                  )}
                                  {Array.isArray(changes) && changes.length > 0 && (
                                    <>
                                      <ul className="mt-2 space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
                                        {changes.map((c: any, idx: number) => {
                                          const fieldLabel = fieldLabelMap[c.field] ?? c.field;
                                          return (
                                            <li key={`${c.field}-${idx}`} className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                                              <span className="font-semibold">{fieldLabel}</span>{' '}
                                              changed from{' '}
                                              <span className="font-mono text-slate-700 dark:text-slate-100">
                                                {formatChangeValue(c.previous, c.field)}
                                              </span>{' '}
                                              to{' '}
                                              <span className="font-mono text-slate-700 dark:text-slate-100">
                                                {formatChangeValue(c.current, c.field)}
                                              </span>
                                            </li>
                                          );
                                        })}
                                      </ul>
                                      <button
                                        type="button"
                                        onClick={() => setHistoryViewComplete({
                                          eventLabel: label,
                                          changes: changes.map((c: any) => ({
                                            field: c.field,
                                            fieldLabel: fieldLabelMap[c.field] ?? c.field,
                                            previous: c.previous,
                                            current: c.current,
                                          })),
                                        })}
                                        className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/50"
                                      >
                                        View complete
                                      </button>
                                    </>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </div>
                  )}





                  {/* Profile Tab Content */}
                  {employeeViewTab === 'profile' && (
                    <>
                      {/* Allowances & Deductions */}
                      <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50">
                        <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Allowances & Deductions</h3>
                        {(Array.isArray(viewingEmployee.employeeAllowances) && viewingEmployee.employeeAllowances.length > 0) ? (
                          <div className="mb-6">
                            <h4 className="mb-3 text-sm font-semibold text-green-700 dark:text-green-400">Allowances</h4>
                            <div className="space-y-2">
                              {viewingEmployee.employeeAllowances.map((allowance: any, idx: number) => (
                                <div key={idx} className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50/50 p-3 dark:border-green-800 dark:bg-green-900/20">
                                  <div className="flex-1">
                                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{allowance.name || '-'}</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                      {allowance.type === 'percentage' ? `${allowance.percentage}% of ${allowance.percentageBase || 'basic'}` : 'Fixed Amount'}
                                      {allowance.isOverride && <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Override</span>}
                                    </p>
                                  </div>
                                  <p className="text-sm font-semibold text-green-700 dark:text-green-400">
                                    {allowance.amount !== null && allowance.amount !== undefined ? `₹${Number(allowance.amount).toLocaleString()}` : '-'}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                            <p className="text-sm text-slate-500 dark:text-slate-400">No allowance overrides. Defaults will be used.</p>
                          </div>
                        )}

                        {(Array.isArray(viewingEmployee.employeeDeductions) && viewingEmployee.employeeDeductions.length > 0) ? (
                          <div>
                            <h4 className="mb-3 text-sm font-semibold text-red-700 dark:text-red-400">Deductions</h4>
                            <div className="space-y-2">
                              {viewingEmployee.employeeDeductions.map((deduction: any, idx: number) => (
                                <div key={idx} className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50/50 p-3 dark:border-red-800 dark:bg-red-900/20">
                                  <div className="flex-1">
                                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{deduction.name || '-'}</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                      {deduction.type === 'percentage' ? `${deduction.percentage}% of ${deduction.percentageBase || 'basic'}` : 'Fixed Amount'}
                                      {deduction.isOverride && <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Override</span>}
                                    </p>
                                  </div>
                                  <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                                    {deduction.amount !== null && deduction.amount !== undefined ? `₹${Number(deduction.amount).toLocaleString()}` : '-'}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                            <p className="text-sm text-slate-500 dark:text-slate-400">No deduction overrides. Defaults will be used.</p>
                          </div>
                        )}
                      </div>

                      {/* Left Date Information */}
                      {viewingEmployee.leftDate && (
                        <div className="rounded-2xl border border-orange-200 bg-orange-50/50 p-5 dark:border-orange-800 dark:bg-orange-900/20 mb-5">
                          <h3 className="mb-4 text-lg font-semibold text-orange-900 dark:text-orange-100">Left Date Information</h3>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                              <label className="text-xs font-medium text-orange-700 dark:text-orange-300">Left Date</label>
                              <p className="mt-1 text-sm font-medium text-orange-900 dark:text-orange-100">{new Date(viewingEmployee.leftDate).toLocaleDateString()}</p>
                            </div>
                            {viewingEmployee.leftReason && (
                              <div>
                                <label className="text-xs font-medium text-orange-700 dark:text-orange-300">Reason</label>
                                <p className="mt-1 text-sm font-medium text-orange-900 dark:text-orange-100">{viewingEmployee.leftReason}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Leave Information */}
                      <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50">
                        <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Leave Information</h3>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Monthly Paid Leaves</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.paidLeaves ?? 0} days/month</p>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Yearly Allotted Leaves</label>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.allottedLeaves ?? 0} days/year</p>
                          </div>
                        </div>
                      </div>


                  {/* Generic dynamic form groups (profile view only) */}
                  {employeeViewTab === 'profile' && formSettings?.groups?.filter(g =>
                    g.isEnabled &&
                    !['basic_info', 'personal_info', 'contact_info', 'bank_details', 'reporting_authority', 'leave_info', 'leave_information'].includes(g.id) &&
                    !g.isSystem
                  )
                    .sort((a, b) => (a.order || 0) - (b.order || 0))
                    .map(group => (
                      <div key={group.id} className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50">
                        <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{group.label}</h3>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {group.fields
                            ?.filter(f => f.isEnabled !== false)
                            .sort((a, b) => (a.order || 0) - (b.order || 0))
                            .map(field => {
                              const value = (viewingEmployee as any)[field.id] ?? viewingEmployee.dynamicFields?.[field.id];
                              return (
                                <div key={field.id}>
                                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400">{field.label}</label>
                                  <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                                    {value != null && value !== '' ? (
                                      typeof value === 'object' ? JSON.stringify(value) : String(value)
                                    ) : '-'}
                                  </p>
                                  {field.description && (
                                    <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                                      {field.description}
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    ))}

                      {/* Reporting Authority */}
                      {((viewingEmployee as any).reporting_to || (viewingEmployee as any).reporting_to_) && (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50">
                          <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Reporting Authority</h3>
                          <p className="text-sm text-slate-500 dark:text-slate-400">Managers assigned.</p>
                        </div>
                      )}
                    </>
                  )}

                  {/* History Tab Content */}
                  {employeeViewTab === 'history' && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5 dark:border-slate-700 dark:bg-slate-900/60">
                      <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Employee History</h3>
                      {employeeHistoryLoading ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400">Loading history…</p>
                      ) : employeeHistory.length === 0 ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400">No history recorded.</p>
                      ) : (
                        <ol className="relative space-y-4 border-l border-slate-200 pl-4 text-sm dark:border-slate-700">
                          {employeeHistory.map((h: any, idx: number) => (
                            <li key={idx} className="relative pl-4">
                              <span className="absolute -left-[9px] h-4 w-4 rounded-full border-2 border-slate-400 bg-white dark:bg-slate-950" />
                              <div className="rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm dark:bg-slate-950/70">
                                <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-800">{h.event}</span>
                                <div className="text-xs text-slate-500">{new Date(h.timestamp || h.created_at).toLocaleString()}</div>
                              </div>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Certificate image/document popup */}
          {certificatePreviewUrl && (
            <CertificatePreviewModal
              url={certificatePreviewUrl}
              onClose={() => setCertificatePreviewUrl(null)}
            />
          )}


        {/* Modals outside main layout but within return */}
        {historyViewComplete && (
          <HistoryViewCompleteModal
            data={historyViewComplete}
            onClose={() => setHistoryViewComplete(null)}
          />
        )}

        {/* Left Date Modal */}
        {showLeftDateModal && selectedEmployeeForLeftDate && (
          <ResignationModal
            employee={selectedEmployeeForLeftDate}
            leftDateForm={leftDateForm}
            setLeftDateForm={setLeftDateForm}
            resignationNoticePeriodDays={resignationNoticePeriodDays}
            allowedToTerminate={true}
            error={error}
            success={success}
            onSubmit={handleSubmitLeftDate}
            onClose={() => {
              setShowLeftDateModal(false);
              setSelectedEmployeeForLeftDate(null);
              setLeftDateForm({ leftDate: '', leftReason: '' });
            }}
          />
        )}

        {allowEmployeeBulkProcess && showEmployeeUpdateModal && (
          <EmployeeUpdateModal
            onClose={() => setShowEmployeeUpdateModal(false)}
            onSuccess={() => {
              setShowEmployeeUpdateModal(false);
              loadEmployees(currentPage);
            }}
          />
        )}

        {allowEmployeeBulkProcess && showBulkAllowancesDeductions && (
          <BulkAllowancesDeductionsModal
            onClose={() => setShowBulkAllowancesDeductions(false)}
            onSuccess={(msg) => setSuccess(msg)}
            onError={(msg) => setError(msg)}
            setLoading={setLoading}
            loadEmployees={loadEmployees}
            currentPage={currentPage}
          />
        )}

        {/* Comparison Modal */}
        {selectedUpdateRequest && (
          <UpdateRequestReviewModal
            request={selectedUpdateRequest}
            rejectComments={updateRequestRejectComments}
            setRejectComments={setUpdateRequestRejectComments}
            processingUpdateRequest={processingUpdateRequest}
            formSettings={formSettings}
            getFieldLabel={getFieldLabel}
            onApprove={handleApproveUpdateRequest}
            onReject={handleRejectUpdateRequest}
            onClose={() => setSelectedUpdateRequest(null)}
          />
        )}

        <BankUpdateDialog
          isOpen={showBankUpdateDialog}
          onClose={() => setShowBankUpdateDialog(false)}
          employee={viewingEmployee}
          onSubmit={async (bankFormData) => {
            if (!viewingEmployee) return;
            setSubmittingBankUpdate(true);
            try {
              const res = await api.createEmployeeUpdateRequest({
                requestedChanges: bankFormData,
                comments: 'Bank detail update request',
                type: 'bank',
                employeeId: viewingEmployee._id
              });
              if (res.success) {
                setShowBankUpdateDialog(false);
                Swal.fire({
                  title: 'Submitted!',
                  text: 'Bank detail update request has been submitted for approval.',
                  icon: 'success',
                  confirmButtonColor: '#4f46e5',
                });
              } else {
                alertError(res.error || 'Failed to submit bank update request.');
              }
            } catch (err: any) {
              alertError(err.message || 'An error occurred.');
            } finally {
              setSubmittingBankUpdate(false);
            }
          }}
          submitting={submittingBankUpdate}
        />

        <EmployeeExportDialog
          isOpen={showExportDialog}
          onClose={() => setShowExportDialog(false)}
          empNo={selectedEmployeeForExport?.empNo}
          employeeName={selectedEmployeeForExport?.name}
          filters={{
            division_id: selectedDivisionFilter,
            department_id: selectedDepartmentFilter,
            designation_id: selectedDesignationFilter,
            employee_group_id: selectedEmployeeGroupFilter,
            includeLeft: includeLeftEmployees,
          }}
        />
      </div>
    </div>
  );
}
