/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @next/next/no-img-element */
'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { api, Department, Division, Designation } from '@/lib/api';
import { auth } from '@/lib/auth';
import {
  canViewEmployees,
  canEditEmployee,
  canViewApplications as hasViewApplicationsPermission,
  canVerifyFeature,
  canUpdateBankDetails,
  canFinalizeSalary
} from '@/lib/permissions';
import {
  Users,
  Settings,
  Upload,
  Plus,
  Search,
  Filter,
  MoreVertical,
  Eye,
  Edit2,
  Trash2,
  Mail,
  KeyRound,
  ChevronRight,
  ChevronLeft,
  UserCheck,
  UserX,
  Clock as LucideClock,
  ShieldCheck,
  CheckCircle,
  Download
} from 'lucide-react';
import BulkUpload from '@/components/BulkUpload';
import DynamicEmployeeForm from '@/components/DynamicEmployeeForm';
import Spinner from '@/components/Spinner';
import BankUpdateDialog from '@/components/employee/BankUpdateDialog';
import EmployeeExportDialog from '@/components/employee/EmployeeExportDialog';
import Swal from 'sweetalert2';
import {
  EMPLOYEE_TEMPLATE_HEADERS,
  EMPLOYEE_TEMPLATE_SAMPLE,
  validateEmployeeRow,
  ParsedRow,
} from '@/lib/bulkUpload';

interface Employee {
  _id: string;
  emp_no: string;
  employee_name: string;
  division_id?: string | { _id: string; name: string };
  department_id?: string | { _id: string; name: string };
  designation_id?: string | { _id: string; name: string };
  employee_group_id?: string | { _id: string; name: string };
  employee_group?: { _id: string; name: string };
  division?: { _id: string; name: string; code?: string };
  department?: { _id: string; name: string; code?: string };
  designation?: { _id: string; name: string; code?: string };
  doj?: string;
  dob?: string;
  gross_salary?: number;
  paidLeaves?: number;
  allottedLeaves?: number;
  gender?: string;
  marital_status?: string;
  blood_group?: string;
  qualifications?: any[] | string;
  experience?: number;
  address?: string;
  location?: string;
  aadhar_number?: string;
  phone_number?: string;
  alt_phone_number?: string;
  email?: string;
  pf_number?: string;
  esi_number?: string;
  bank_account_no?: string;
  bank_name?: string;
  bank_place?: string;
  ifsc_code?: string;
  salary_mode?: string;
  second_salary?: number;
  is_active?: boolean;
  leftDate?: string | null;
  leftReason?: string | null;
  dynamicFields?: any;
  employeeAllowances?: any[];
  employeeDeductions?: any[];
  salaryStatus?: 'pending_approval' | 'approved';
  qualificationStatus?: string;
  profilePhoto?: string;
}



interface EmployeeApplication {
  _id: string;
  emp_no: string;
  employee_name: string;
  division_id?: string | { _id: string; name: string; code?: string };
  department_id?: string | { _id: string; name: string; code?: string };
  designation_id?: string | { _id: string; name: string; code?: string };
  employee_group_id?: string | { _id: string; name: string; code?: string };
  employee_group?: { _id: string; name: string; code?: string };
  department?: { _id: string; name: string; code?: string };
  designation?: { _id: string; name: string; code?: string };
  proposedSalary: number;
  approvedSalary?: number;
  status: 'pending' | 'verified' | 'approved' | 'rejected';
  createdBy?: { _id: string; name: string; email: string };
  verifiedBy?: { _id: string; name: string; email: string };
  verifiedAt?: string;
  approvedBy?: { _id: string; name: string; email: string };
  approvedAt?: string;
  rejectedBy?: { _id: string; name: string; email: string };
  approvalComments?: string;
  rejectionComments?: string;
  created_at?: string;
  rejectedAt?: string;
  // All other employee fields
  doj?: string;
  dob?: string;
  gender?: string;
  marital_status?: string;
  blood_group?: string;
  qualifications?: any[] | string;
  experience?: number;
  address?: string;
  location?: string;
  aadhar_number?: string;
  phone_number?: string;
  alt_phone_number?: string;
  email?: string;
  pf_number?: string;
  esi_number?: string;
  bank_account_no?: string;
  bank_name?: string;
  bank_place?: string;
  ifsc_code?: string;
  is_active?: boolean;
  employeeAllowances?: any[];
  employeeDeductions?: any[];
}

/** Format date as YYYY-MM-DD in local time (avoids UTC shift for resignation last working date) */
const toLocalDateString = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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

// Start of Component
export default function EmployeesPage() {
  const [currentUser, setCurrentUser] = useState<any>(null); // To track logged-in user for view logic
  const [activeTab, setActiveTab] = useState<'employees' | 'applications'>('employees');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [applications, setApplications] = useState<EmployeeApplication[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [filteredDesignations, setFilteredDesignations] = useState<Designation[]>([]);
  const [filteredApplicationDesignations, setFilteredApplicationDesignations] = useState<Designation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingApplications, setLoadingApplications] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [showApplicationDialog, setShowApplicationDialog] = useState(false);
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const [selectedApplication, setSelectedApplication] = useState<EmployeeApplication | null>(null);
  const [viewingEmployee, setViewingEmployee] = useState<Employee | null>(null);
  const [viewingApplication, setViewingApplication] = useState<EmployeeApplication | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editingApplicationID, setEditingApplicationID] = useState<string | null>(null); // Track ID of application being edited
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [showBankUpdateDialog, setShowBankUpdateDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [selectedEmployeeForExport, setSelectedEmployeeForExport] = useState<Employee | null>(null);
  const [submittingBankUpdate, setSubmittingBankUpdate] = useState(false);
  const [formData, setFormData] = useState<Partial<Employee>>(initialFormState);
  const [formSettings, setFormSettings] = useState<any>(null); // To store dynamic settings for mapping
  const [applicationFormData, setApplicationFormData] = useState<Partial<EmployeeApplication & { proposedSalary: number }>>({ ...initialFormState, proposedSalary: 0 });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [approvalData, setApprovalData] = useState({ approvedSalary: 0, doj: '', comments: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dataSource, setDataSource] = useState<string>('mongodb');
  const [selectedDivision, setSelectedDivision] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
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
  const [canViewApplications, setCanViewApplications] = useState(false);
  const [hasVerifyPermission, setHasVerifyPermission] = useState(false);
  const [hasBankUpdatePermission, setHasBankUpdatePermission] = useState(false);
  /** Role-based feature control when user has none (so permissions respect Settings > Feature Control) */
  const [resolvedFeatureControl, setResolvedFeatureControl] = useState<string[] | null>(null);
  const [showLeftDateModal, setShowLeftDateModal] = useState(false);
  const [selectedEmployeeForLeftDate, setSelectedEmployeeForLeftDate] = useState<Employee | null>(null);
  const [leftDateForm, setLeftDateForm] = useState({ leftDate: '', leftReason: '' });
  const [resignationNoticePeriodDays, setResignationNoticePeriodDays] = useState(0);
  const [includeLeftEmployees, setIncludeLeftEmployees] = useState(false);
  const [passwordMode, setPasswordMode] = useState<'random' | 'phone_empno'>('random');
  const [notificationChannels, setNotificationChannels] = useState({ email: true, sms: true });
  const [isResending, setIsResending] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState<string | null>(null);

  const SENSITIVE_FIELDS = [
    'gross_salary',
    'pf_number',
    'esi_number',
    'aadhar_number',
    'bank_account_no',
    'bank_name',
    'bank_place',
    'ifsc_code',
    'salary_mode',
    'second_salary',
    'proposedSalary'
  ];
  const [selectedApplicationIds, setSelectedApplicationIds] = useState<string[]>([]);
  const [employeeFilters, setEmployeeFilters] = useState<Record<string, string>>({});
  const [applicationFilters, setApplicationFilters] = useState<Record<string, string>>({});
  const [activeFilterColumn, setActiveFilterColumn] = useState<string | null>(null);
  const [filterPos, setFilterPos] = useState({ top: 0, left: 0 });

  // Infinite scrolling state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMoreEmployees, setHasMoreEmployees] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const observerTarget = useRef<HTMLDivElement>(null);

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

  // Helper to extract unique values for a column
  const getUniqueValues = (data: any[], key: string, nestedKey?: string) => {
    const values = data.map(item => {
      const val = nestedKey ? item[key]?.[nestedKey] : item[key];
      return val || '';
    }).filter((v, i, a) => v && a.indexOf(v) === i);
    return values.sort();
  };


  const [dynamicTemplate, setDynamicTemplate] = useState<{ headers: string[]; sample: any[]; columns: any[] }>({
    headers: EMPLOYEE_TEMPLATE_HEADERS,
    sample: EMPLOYEE_TEMPLATE_SAMPLE,
    columns: [],
  });






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
  // Approval dialog allowance/deduction state
  const [approvalComponentDefaults, setApprovalComponentDefaults] = useState<{ allowances: any[]; deductions: any[] }>({
    allowances: [],
    deductions: [],
  });
  const [approvalOverrideAllowances, setApprovalOverrideAllowances] = useState<Record<string, number | null>>({});
  const [approvalOverrideDeductions, setApprovalOverrideDeductions] = useState<Record<string, number | null>>({});
  const [approvalOverrideAllowancesBasedOnPresentDays, setApprovalOverrideAllowancesBasedOnPresentDays] = useState<Record<string, boolean>>({});
  const [approvalOverrideDeductionsBasedOnPresentDays, setApprovalOverrideDeductionsBasedOnPresentDays] = useState<Record<string, boolean>>({});
  const [approvalLoadingComponents, setApprovalLoadingComponents] = useState(false);
  const [approvalSalarySummary, setApprovalSalarySummary] = useState({
    totalAllowances: 0,
    totalDeductions: 0,
    netSalary: 0,
    ctcSalary: 0,
  });

  // Build override payload: only include rows user changed (matched by masterId or name)
  const buildOverridePayload = (
    defaults: any[],
    overrides: Record<string, number | null>,
    basedOnPresentDaysMap: Record<string, boolean>,
    categoryFallback: 'allowance' | 'deduction'
  ) => {
    return defaults
      .map((item) => {
        const key = item.masterId ? item.masterId.toString() : (item.name || '').toLowerCase();
        if (Object.prototype.hasOwnProperty.call(overrides, key)) {
          const amt = overrides[key];
          const itemType = item.type || (item.base ? 'percentage' : 'fixed');
          const basedOnPresentDays = itemType === 'fixed' ? (basedOnPresentDaysMap[key] ?? item.basedOnPresentDays ?? false) : false;
          return {
            masterId: item.masterId || null,
            code: item.code || null,
            name: item.name || '',
            category: item.category || categoryFallback,
            type: itemType,
            amount: amt === null || amt === undefined ? null : Number(amt),
            overrideAmount: amt === null || amt === undefined ? null : Number(amt),
            percentage: item.type === 'percentage' ? (item.percentage ?? null) : null,
            percentageBase: item.base || item.percentageBase || null,
            minAmount: item.minAmount ?? null,
            maxAmount: item.maxAmount ?? null,
            basedOnPresentDays: basedOnPresentDays,
          };
        }
        return null;
      })
      .filter(Boolean);
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
      setCurrentUser(user);
      const hasExplicitControl = user.featureControl && Array.isArray(user.featureControl) && user.featureControl.length > 0;
      if (!hasExplicitControl) {
        const settingKey = `feature_control_${user.role === 'hod' ? 'hod' : user.role === 'hr' ? 'hr' : user.role === 'manager' ? 'manager' : 'employee'}`;
        api.getSetting(settingKey)
          .then((res) => {
            if (res?.success && res?.data?.value?.activeModules) {
              setResolvedFeatureControl(Array.isArray(res.data.value.activeModules) ? res.data.value.activeModules : []);
            } else {
              setResolvedFeatureControl([]);
            }
          })
          .catch(() => setResolvedFeatureControl([]));
      } else {
        setResolvedFeatureControl(null);
      }
    }
    loadEmployees(1, false); // Load first page
    loadDivisions();
    loadDepartments();
    loadFormSettings();
    if (activeTab === 'applications') {
      loadApplications();
    }
  }, []);

  const userForPermissions = useMemo(() => {
    const u = currentUser || auth.getUser();
    if (!u) return null;
    const hasExplicit = u.featureControl && Array.isArray(u.featureControl) && u.featureControl.length > 0;
    const fc = hasExplicit ? u.featureControl : (resolvedFeatureControl ?? []);
    return { ...u, featureControl: fc };
  }, [currentUser, resolvedFeatureControl]);

  useEffect(() => {
    if (!userForPermissions) return;
    setCanViewApplications(hasViewApplicationsPermission(userForPermissions as any));
    setHasVerifyPermission(canVerifyFeature(userForPermissions as any, 'EMPLOYEES'));
    setHasBankUpdatePermission(canUpdateBankDetails(userForPermissions as any));
  }, [userForPermissions]);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
    setHasMoreEmployees(true);
    loadEmployees(1, false);
  }, [includeLeftEmployees]);

  // Server-side search with debounce removed - Search only on Enter or Button click
  // useEffect(() => {
  //   const handler = setTimeout(() => {
  //     // Reset to page 1 for new search
  //     setCurrentPage(1);
  //     setHasMoreEmployees(true);
  //     loadEmployees(1, false);
  //   }, 500);
  //   return () => clearTimeout(handler);
  // }, [searchTerm]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreEmployees && !loading && !loadingMore) {
          loadMoreEmployees();
        }
      },
      { threshold: 0.1 }
    );

    const currentTarget = observerTarget.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [hasMoreEmployees, loading, loadingMore, currentPage]);

  useEffect(() => {
    if (activeTab === 'applications') {
      if (!canViewApplications && userRole) {
        // Redirect to employees tab if user has no verify permission
        setActiveTab('employees');
        return;
      }
      loadApplications();
    }
  }, [activeTab, canViewApplications, userRole]);

  useEffect(() => {
    setFilteredDesignations(designations);
  }, [designations]);

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

  // Load allowance/deduction defaults when department and gross salary are set
  useEffect(() => {
    const deptId = formData.department_id;
    // Check both gross_salary and proposedSalary (form might use either)
    const gross = formData.gross_salary || (formData as any).proposedSalary;
    if (deptId && gross !== undefined && gross !== null && gross > 0) {
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
    if (!showApprovalDialog || !selectedApplication) return;
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
  }, [showApprovalDialog, selectedApplication, approvalData.approvedSalary]);

  useEffect(() => {
    setFilteredApplicationDesignations(designations);
  }, [designations]);

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
      const g = await api.getEmployeeGroups(true);
      if (g.success && Array.isArray(g.data)) setEmployeeGroups(g.data);
      else setEmployeeGroups([]);
    } catch {
      setCustomEmployeeGroupingEnabled(false);
      setEmployeeGroups([]);
    }
  };

  useEffect(() => {
    loadEmployeeGroupingConfig();
  }, []);

  // Re-check latest grouping setting when dialogs open (setting might have changed in another page).
  useEffect(() => {
    if (showApplicationDialog || showDialog || showBulkUpload) {
      loadEmployeeGroupingConfig();
    }
  }, [showApplicationDialog, showDialog, showBulkUpload]);

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
        // BullMQ returns jobId, not immediate results
        setSuccess(`Bulk approval job queued successfully! Processing ${selectedApplicationIds.length} applications in the background. Job ID: ${response.jobId || 'N/A'}`);
      } else {
        setError(response.message || 'Bulk approval failed');
      }

      setSelectedApplicationIds([]);
      // Reload after a short delay to see updated results
      setTimeout(() => {
        loadApplications();
        loadEmployees();
      }, 2000);
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

  const loadEmployees = async (pageNum: number = 1, append: boolean = false) => {
    try {
      if (!append) setLoading(true);
      // Derive division_id, department_id, designation_id from selectedDivision and header filters (by name)
      const divisionId = selectedDivision
        || (employeeFilters['division.name'] ? divisions.find((d) => d.name === employeeFilters['division.name'])?._id : undefined);
      const departmentId = employeeFilters['department.name']
        ? departments.find((d) => d.name === employeeFilters['department.name'])?._id
        : undefined;
      const designationId = employeeFilters['designation.name']
        ? designations.find((d) => d.name === employeeFilters['designation.name'])?._id
        : undefined;
      const employeeGroupId = employeeFilters['employee_group.name']
        ? employeeGroups.find((g) => g.name === employeeFilters['employee_group.name'])?._id
        : undefined;
      const response = await api.getEmployees({
        ...(includeLeftEmployees ? { includeLeft: true } : {}),
        page: pageNum,
        limit: 50,
        search: searchTerm || undefined,
        ...(divisionId ? { division_id: divisionId } : {}),
        ...(departmentId ? { department_id: departmentId } : {}),
        ...(designationId ? { designation_id: designationId } : {}),
        ...(employeeGroupId ? { employee_group_id: employeeGroupId } : {}),
      });
      if (response.success) {
        // Ensure paidLeaves is always included and is a number
        const employeesData = (response.data || []).map((emp: any, index: number) => {
          const paidLeaves = emp.paidLeaves !== undefined && emp.paidLeaves !== null ? Number(emp.paidLeaves) : 0;
          // Debug: Log first employee to check paidLeaves and reporting_to
          if (index === 0 && pageNum === 1) {
            console.log('Loading employee:', {
              emp_no: emp.emp_no,
              paidLeaves,
              original: emp.paidLeaves,
              reporting_to: emp.reporting_to,
              dynamicFields: emp.dynamicFields,
              reporting_to_in_dynamicFields: emp.dynamicFields?.reporting_to
            });
          }
          // Debug: Log any employee with reporting_to or reporting_to_
          if (emp.reporting_to || emp.reporting_to_ || emp.dynamicFields?.reporting_to || emp.dynamicFields?.reporting_to_) {
            console.log('Employee with reporting_to:', {
              emp_no: emp.emp_no,
              reporting_to_root: emp.reporting_to,
              reporting_to__root: emp.reporting_to_,
              reporting_to_dynamic: emp.dynamicFields?.reporting_to,
              reporting_to__dynamic: emp.dynamicFields?.reporting_to_,
              isArray: Array.isArray(emp.reporting_to || emp.reporting_to_ || emp.dynamicFields?.reporting_to || emp.dynamicFields?.reporting_to_),
              firstItem: (emp.reporting_to || emp.reporting_to_ || emp.dynamicFields?.reporting_to || emp.dynamicFields?.reporting_to_)?.[0]
            });
          }
          return {
            ...emp,
            status: emp.leftDate ? 'Left' : ((emp.is_active === false || emp.is_active === 'false' || emp.is_active === 0) ? 'Inactive' : 'Active'),
            paidLeaves,
          };
        });

        if (append) {
          setEmployees(prev => [...prev, ...employeesData]);
        } else {
          setEmployees(employeesData);
        }

        setDataSource(response.dataSource || 'mongodb');

        // Update pagination state
        const pagination = response.pagination;
        if (pagination) {
          setHasMoreEmployees(pagination.page < pagination.totalPages);
          setCurrentPage(pagination.page);
          setTotalPages(pagination.totalPages || 0);
          setTotalCount(pagination.total || 0);
        } else {
          setHasMoreEmployees(false);
        }
      }
    } catch (err) {
      console.error('Error loading employees:', err);
    } finally {
      if (append) {
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  };

  const loadMoreEmployees = useCallback(async () => {
    if (loadingMore || !hasMoreEmployees) return;

    setLoadingMore(true);
    const nextPage = currentPage + 1;
    await loadEmployees(nextPage, true);
  }, [currentPage, hasMoreEmployees, loadingMore, loadEmployees]);

  const loadDivisions = async () => {
    try {
      const res = await api.getDivisions(true); // Fetch only active divisions
      if (res.success) {
        setDivisions(res.data || []);
      }
    } catch (err) {
      console.error('Failed to load divisions', err);
    }
  };

  const loadDepartments = async () => {
    try {
      const response = await api.getDepartments(true);
      if (response.success && response.data) {
        setDepartments(response.data);

        // Load all designations globally
        const desigRes = await api.getAllDesignations();
        if (desigRes.success && desigRes.data) {
          setDesignations(desigRes.data);
        }
      }
    } catch (err) {
      console.error('Error loading departments:', err);
    }
  };

  const loadApplications = async () => {
    try {
      setLoadingApplications(true);
      const divisionId = selectedDivision ||
        (employeeFilters['division.name'] ? divisions.find((d) => d.name === employeeFilters['division.name'])?._id : undefined);
      const departmentId = employeeFilters['department.name']
        ? departments.find((d) => d.name === employeeFilters['department.name'])?._id
        : undefined;
      const designationId = employeeFilters['designation.name']
        ? designations.find((d) => d.name === employeeFilters['designation.name'])?._id
        : undefined;
      const employeeGroupId = employeeFilters['employee_group.name']
        ? employeeGroups.find((g) => g.name === employeeFilters['employee_group.name'])?._id
        : undefined;
      const search = (applicationSearchTerm || searchTerm || '').trim() || undefined;
      const response = await api.getEmployeeApplications({
        ...(divisionId ? { division_id: divisionId } : {}),
        ...(departmentId ? { department_id: departmentId } : {}),
        ...(designationId ? { designation_id: designationId } : {}),
        ...(employeeGroupId ? { employee_group_id: employeeGroupId } : {}),
        ...(search ? { search } : {}),
      });
      if (response.success) {
        const apps = (response.data || []).map((app: any) => ({
          ...app,
          status: app.status || 'pending',
          department: app.department || (typeof app.department_id === 'object' ? app.department_id : undefined),
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
      const normalizeEntityRef = (val: any) => {
        if (val === undefined || val === null || val === '') return val;
        if (typeof val === 'object') return val._id || val.id || '';
        if (typeof val === 'string') {
          const trimmed = val.trim();
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              const parsed = JSON.parse(trimmed);
              return parsed?._id || parsed?.id || '';
            } catch {
              return val;
            }
          }
        }
        return val;
      };

      // Build allowances and deductions from form overrides
      let employeeAllowances = buildOverridePayload(componentDefaults.allowances, overrideAllowances, overrideAllowancesBasedOnPresentDays, 'allowance');
      let employeeDeductions = buildOverridePayload(componentDefaults.deductions, overrideDeductions, overrideDeductionsBasedOnPresentDays, 'deduction');

      // When editing: always send both sides. If one side is empty but employee had data, preserve existing so we don't clear it
      const toPayloadItem = (item: any, category: 'allowance' | 'deduction') => ({
        masterId: item.masterId ?? null,
        code: item.code ?? null,
        name: item.name ?? '',
        category: item.category || category,
        type: item.type ?? null,
        amount: item.amount ?? item.overrideAmount ?? null,
        overrideAmount: item.overrideAmount ?? item.amount ?? null,
        percentage: item.percentage ?? null,
        percentageBase: item.percentageBase ?? null,
        minAmount: item.minAmount ?? null,
        maxAmount: item.maxAmount ?? null,
        basedOnPresentDays: item.basedOnPresentDays ?? false,
        isOverride: true,
      });
      if (editingEmployee) {
        if (employeeAllowances.length === 0 && Array.isArray(editingEmployee.employeeAllowances) && editingEmployee.employeeAllowances.length > 0) {
          employeeAllowances = editingEmployee.employeeAllowances.map((item: any) => toPayloadItem(item, 'allowance'));
        }
        if (employeeDeductions.length === 0 && Array.isArray(editingEmployee.employeeDeductions) && editingEmployee.employeeDeductions.length > 0) {
          employeeDeductions = editingEmployee.employeeDeductions.map((item: any) => toPayloadItem(item, 'deduction'));
        }
      }

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

      // Ensure ObjectId refs are submitted as plain IDs, never serialized objects.
      ['division_id', 'department_id', 'designation_id', 'employee_group_id'].forEach((key) => {
        (submitData as any)[key] = normalizeEntityRef((submitData as any)[key]);
      });

      // Guard against stale/invalid employee group IDs on no-change updates.
      const normalizedGroupId = String((submitData as any).employee_group_id || '').trim();
      if (!customEmployeeGroupingEnabled || !normalizedGroupId || !employeeGroups.some((g) => String(g._id) === normalizedGroupId)) {
        (submitData as any).employee_group_id = undefined;
      }

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

      // Handle Qualifications - Map Field IDs to Labels
      const qualities = Array.isArray(formData.qualifications) ? formData.qualifications : [];

      // Create a mapping from Field ID -> Label using formSettings
      const fieldIdToLabelMap: Record<string, string> = {};
      if (formSettings?.qualifications?.fields) {
        formSettings.qualifications.fields.forEach((f: any) => {
          fieldIdToLabelMap[f.id] = f.label;
        });
      }

      const cleanQualifications = qualities.map((q: any, index: number) => {
        const { certificateFile, ...rest } = q;

        // Transform keys from Field ID to Label (e.g. key "degree" -> "Degree")
        const transformedQ: any = {};
        Object.entries(rest).forEach(([key, val]) => {
          // If key matches a known field ID, use its label; otherwise keep key
          const label = fieldIdToLabelMap[key] || key;
          transformedQ[label] = val;
        });

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
      if (appData.qualifications && Array.isArray(appData.qualifications) && formSettings?.qualifications?.fields) {
        appData.qualifications = appData.qualifications.map((q: any) => {
          const newQ: any = {};
          // Preserve certificate meta
          if (q.certificateUrl) newQ.certificateUrl = q.certificateUrl;

          // Map fields
          Object.entries(q).forEach(([key, val]) => {
            if (key === 'certificateUrl') return;

            // Find field definition where label matches key
            const fieldDef = formSettings.qualifications.fields.find((f: any) => f.label === key);
            if (fieldDef) {
              newQ[fieldDef.id] = val;
            } else {
              // Keep original if no match (fallback)
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
    if (empData.qualifications && Array.isArray(empData.qualifications) && formSettings?.qualifications?.fields) {
      empData.qualifications = empData.qualifications.map((q: any) => {
        const newQ: any = {};
        if (q.certificateUrl) newQ.certificateUrl = q.certificateUrl;

        Object.entries(q).forEach(([key, val]) => {
          if (key === 'certificateUrl') return;
          const fieldDef = formSettings.qualifications.fields.find((f: any) => f.label === key);
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

    if (employee.qualifications) {
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

          // Always preserve certificate fields and normalize casing
          Object.keys(qual).forEach(key => {
            const lowerKey = key.toLowerCase();
            if (lowerKey === 'certificateurl') {
              normalized.certificateUrl = qual[key];
            } else if (lowerKey === 'certificatefile') {
              normalized.certificateFile = qual[key];
            }
          });

          // Fallback if no settings or empty normalized (copy everything as best effort)
          if (Object.keys(normalized).length === 0 && (!formSettings?.qualifications?.fields || formSettings.qualifications.fields.length === 0)) {
            return { ...qual };
          }

          return normalized;
        });
      } else if (typeof employee.qualifications === 'string') {
        // Old format - convert to array with examination only
        qualificationsValue = employee.qualifications.split(',').map(s => ({ examination: s.trim() }));
      }
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
      division_id: employee.division?._id || employee.division_id || '',
      department_id: employee.department?._id || employee.department_id || '',
      designation_id: employee.designation?._id || employee.designation_id || '',
      employee_group_id: (employee as any).employee_group?._id || (employee as any).employee_group_id || '',
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
    // Legacy support: if currentStatus is false (inactive), route to handleActivate for clarity
    if (!currentStatus) {
      return handleActivate(empNo);
    }

    if (!confirm(`Are you sure you want to deactivate this employee?`)) return;

    try {
      setError('');
      setSuccess('');
      const response = await api.updateEmployee(empNo, { is_active: false });

      if (response.success) {
        // Optimistic update
        setEmployees(prev => prev.map(e => {
          if (e.emp_no === empNo) {
            return { ...e, is_active: false, status: 'Inactive' };
          }
          return e;
        }));

        let msg = `Employee deactivated successfully!`;
        if ((response as any).syncError) {
          msg += ` (MSSQL sync failed, but local update succeeded: ${(response as any).syncError})`;
        }
        setSuccess(msg);
        // Force reload to update UI status immediately
        await loadEmployees();
      } else {
        setError(response.message || `Failed to deactivate employee`);
      }
    } catch (err) {
      setError('An error occurred');
      console.error(err);
    }
  };

  const handleActivate = async (empNo: string) => {
    if (!confirm('Are you sure you want to activate this employee?')) return;

    try {
      setError('');
      setSuccess('');
      const response = await api.updateEmployee(empNo, { is_active: true });

      if (response.success) {
        // Optimistic update
        setEmployees(prev => prev.map(e => {
          if (e.emp_no === empNo) {
            return { ...e, is_active: true, status: 'Active' };
          }
          return e;
        }));

        let msg = 'Employee activated successfully!';
        if ((response as any).syncError) {
          msg += ` (MSSQL sync failed, but local update succeeded: ${(response as any).syncError})`;
        }
        setSuccess(msg);
        // Force reload to update UI status immediately
        await loadEmployees();
      } else {
        setError(response.message || 'Failed to activate employee');
      }
    } catch (err) {
      setError('An error occurred');
      console.error(err);
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
        });
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
          setSuccess('Employee left date set successfully!');
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
    if (!confirm(`Are you sure you want to reactivate ${employee.employee_name}? This will remove their left date.`)) return;

    try {
      setError('');
      setSuccess('');
      const response = await api.removeEmployeeLeftDate(employee.emp_no);

      if (response.success) {
        setSuccess('Employee reactivated successfully!');
        loadEmployees();
      } else {
        setError(response.message || 'Failed to reactivate employee');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
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
        // Update the employees list
        setEmployees(prev => prev.map(emp => emp.emp_no === viewingEmployee.emp_no ? { ...emp, [key]: value } : emp));
      } else {
        // Rollback
        setViewingEmployee(viewingEmployee);
        // await alertError('Failed to update', response.message || 'Failed to update deduction preference'); // Reverted to original error handling
        setError(response.message || 'Failed to update deduction preference');
      }
    } catch (err: any) {
      setViewingEmployee(viewingEmployee);
      // await alertError('Error', err.message || 'An error occurred'); // Reverted to original error handling
      setError(err.message || 'An error occurred');
      console.error(err);
    }
  };

  const handleViewEmployee = async (employee: Employee) => {
    setViewingEmployee(employee);
    setShowViewDialog(true);

    // Fetch full employee so view always has both employeeAllowances and employeeDeductions
    try {
      const response = await api.getEmployee(employee.emp_no);
      if (response.success && response.data) {
        setViewingEmployee(response.data);
      }
    } catch (error) {
      console.error('Error refreshing employee data for view:', error);
    }
  };

  const openCreateDialog = () => {
    setEditingEmployee(null);
    setFormData(initialFormStateWithDefaults);
    setComponentDefaults({ allowances: [], deductions: [] });
    setOverrideAllowances({});
    setOverrideDeductions({});
    setShowDialog(true);
    setError('');
  };

  const filteredEmployees = employees.filter(emp => {
    // Search, division, department, designation are now applied server-side via getEmployees params

    // Filter by selected division
    const matchesDivision = !selectedDivision ||
      ((emp as any).division?._id === selectedDivision || emp.division_id === selectedDivision);

    // Filter by active status
    const matchesLeftFilter = includeLeftEmployees || !emp.leftDate;
    const matchesActive = includeLeftEmployees || emp.is_active !== false;

    // Apply only non-scope header filters (e.g. status); division/department/designation are server-side
    const scopeFilterKeys = ['division.name', 'department.name', 'designation.name', 'employee_group.name'];
    const matchesHeaderFilters = Object.entries(employeeFilters).every(([key, value]) => {
      if (!value || scopeFilterKeys.includes(key)) return true;
      const [mainKey, subKey] = key.split('.');
      const actualValue = subKey ? (emp as any)[mainKey]?.[subKey] : (emp as any)[mainKey];
      return String(actualValue || '') === value;
    });

    return matchesLeftFilter && matchesActive && matchesHeaderFilters;
  });



  const filteredApplications = applications.filter(app => {
    const search = (applicationSearchTerm || searchTerm || '').trim();
    const matchesSearch = !search ||
      app.employee_name?.toLowerCase().includes(search.toLowerCase()) ||
      (app.emp_no ?? '')?.toString().toLowerCase().includes(search.toLowerCase()) ||
      ((app.department_id as any)?.name || app.department?.name || '')?.toLowerCase().includes(search.toLowerCase()) ||
      ((app.designation_id as any)?.name || app.designation?.name || '')?.toLowerCase().includes(search.toLowerCase());

    const divFilter = selectedDivision || applicationFilters['division.name'];
    const appDivName = (app as any).division?.name || (app.division_id as any)?.name || '';
    const appDivId = (app as any).division?._id || (typeof app.division_id === 'string' ? app.division_id : (app.division_id as any)?._id);
    const matchesDivision = !divFilter ||
      appDivId === selectedDivision ||
      appDivName === applicationFilters['division.name'];

    const deptFilter = employeeFilters['department.name'] || applicationFilters['department.name'];
    const appDeptName = app.department?.name || (app.department_id as any)?.name || '';
    const matchesDepartment = !deptFilter || appDeptName === deptFilter;

    const desigFilter = employeeFilters['designation.name'] || applicationFilters['designation.name'];
    const appDesigName = app.designation?.name || (app.designation_id as any)?.name || '';
    const matchesDesignation = !desigFilter || appDesigName === desigFilter;

    const groupFilter = employeeFilters['employee_group.name'] || applicationFilters['employee_group.name'];
    const appGroupName = (app as any).employee_group?.name || (app.employee_group_id as any)?.name || '';
    const matchesGroup = !groupFilter || appGroupName === groupFilter;

    const matchesHeaderFilters = Object.entries(applicationFilters).every(([key, value]) => {
      if (!value) return true;
      const [mainKey, subKey] = key.split('.');
      const actualValue = subKey ? (app as any)[mainKey]?.[subKey] : (app as any)[mainKey];
      return String(actualValue || '') === value;
    });

    return matchesSearch && matchesDivision && matchesDepartment && matchesDesignation && matchesGroup && matchesHeaderFilters;
  });


  const pendingApplications = filteredApplications.filter(app => app.status === 'pending');
  const verifiedApplications = filteredApplications.filter(app => app.status === 'verified');
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
        // ... error handling
        const errorMsg = response.message || 'Operation failed';
        const errorDetails = (response as any).errors ? Object.values((response as any).errors).join(', ') : '';
        setError(errorDetails ? `${errorMsg}: ${errorDetails}` : errorMsg);
      }
    } catch (err) {
      console.error('Submit error:', err);
      setError('An error occurred');
    }
  };

  const handleVerifyApplication = async (application: EmployeeApplication) => {
    if (!confirm(`Verify application for ${application.employee_name}? This will create their employee record and send credentials.`)) return;

    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const response = await api.verifyEmployeeApplication(application._id);

      if (response.success) {
        setSuccess('Application verified successfully! Employee record created and credentials sent.');
        loadApplications();
        loadEmployees();
      } else {
        setError(response.message || 'Failed to verify application');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
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
      // Use the new Stage 3 API
      const response = await api.approveEmployeeSalary(selectedApplication._id, {
        approvedSalary: approvalData.approvedSalary,
        doj: approvalData.doj || undefined,
        comments: approvalData.comments,
        second_salary: (approvalData as any).second_salary || 0,
        employeeAllowances: buildOverridePayload(approvalComponentDefaults.allowances, approvalOverrideAllowances, approvalOverrideAllowancesBasedOnPresentDays, 'allowance'),
        employeeDeductions: buildOverridePayload(approvalComponentDefaults.deductions, approvalOverrideDeductions, approvalOverrideDeductionsBasedOnPresentDays, 'deduction'),
        ctcSalary: approvalSalarySummary.ctcSalary,
        calculatedSalary: approvalSalarySummary.netSalary,
        applyPF: (approvalData as any).applyPF,
        applyESI: (approvalData as any).applyESI,
        applyProfessionTax: (approvalData as any).applyProfessionTax,
        applyAttendanceDeduction: (approvalData as any).applyAttendanceDeduction,
        deductLateIn: (approvalData as any).deductLateIn,
        deductEarlyOut: (approvalData as any).deductEarlyOut,
        deductPermission: (approvalData as any).deductPermission,
        deductAbsent: (approvalData as any).deductAbsent,
      });

      if (response.success) {
        setSuccess(response.message || 'Salary approved and employee finalized successfully!');
        setShowApprovalDialog(false);
        setSelectedApplication(null);
        setApprovalData({
          approvedSalary: 0,
          doj: '',
          comments: ''
        });
        loadApplications();
        loadEmployees(); // Reload employees list
      } else {
        setError(response.message || 'Failed to approve salary');
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
        setSelectedApplication(null);
        setApprovalData({
          approvedSalary: 0,
          doj: '',
          comments: ''
        });
        loadApplications();
      } else {
        setError(response.message || 'Failed to reject application');
      }
    } catch (err) {
      setError('An error occurred');
      console.error(err);
    }
  };

  const openApprovalDialog = (application: EmployeeApplication) => {
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
      doj: dojValue,
      comments: '',
    });
    setFormData(prev => ({
      ...prev,
      applyPF: (application as any).applyPF ?? defaultStatutory,
      applyESI: (application as any).applyESI ?? defaultStatutory,
      applyProfessionTax: (application as any).applyProfessionTax ?? defaultStatutory,
      applyAttendanceDeduction: (application as any).applyAttendanceDeduction ?? defaultAttendance,
      deductLateIn: (application as any).deductLateIn ?? defaultAttendance,
      deductEarlyOut: (application as any).deductEarlyOut ?? defaultAttendance,
      deductPermission: (application as any).deductPermission ?? defaultAttendance,
      deductAbsent: (application as any).deductAbsent ?? defaultAttendance,
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
    setShowApprovalDialog(true);
    setError('');
    setSuccess('');
  };

  const openApplicationDialog = () => {
    setApplicationFormData({ ...initialFormStateWithDefaults, proposedSalary: 0 });
    setComponentDefaults({ allowances: [], deductions: [] });
    setOverrideAllowances({});
    setOverrideDeductions({});
    setApplicationSalarySummary({
      totalAllowances: 0,
      totalDeductions: 0,
      netSalary: 0,
      ctcSalary: 0,
    });
    setShowApplicationDialog(true);
    setError('');
  };

  const getEntityId = (entity: any) => {
    if (!entity) return null;
    if (typeof entity === 'string') return entity;
    return entity._id || entity.toString();
  };

  // Determine common Division/Department for Header
  // Priority 1: Context from filtered employees (excluding self)
  // Priority 2: User's assigned scope (if they are restricted to a single division/department)

  // 1. Employee List Context
  const contextEmployees = filteredEmployees.filter(e => {
    if (currentUser) {
      if (currentUser.emp_no && e.emp_no === currentUser.emp_no) return false;
      if (currentUser.email && e.email && currentUser.email.toLowerCase() === e.email.toLowerCase()) return false;
      if (currentUser.employeeId && e._id === currentUser.employeeId) return false;
    }
    return true;
  });
  const employeesForContext = contextEmployees.length > 0 ? contextEmployees : filteredEmployees;

  // Calculate based on list
  const mappedDivs = employeesForContext.map(e => getEntityId(e.division_id) || getEntityId(e.division));
  const uniqueDivIdsList = Array.from(new Set(mappedDivs.filter((x): x is string => !!x)));
  let commonDivision = uniqueDivIdsList.length === 1 ? divisions.find(d => d._id === uniqueDivIdsList[0]) : null;

  const mappedDepts = employeesForContext.map(e => getEntityId(e.department_id) || getEntityId(e.department));
  const uniqueDeptIdsList = Array.from(new Set(mappedDepts.filter((x): x is string => !!x)));
  let commonDepartment = uniqueDeptIdsList.length === 1 ? departments.find(d => d._id === uniqueDeptIdsList[0]) : null;

  // 2. User Scope Fallback (Result of "or else check the users thing")
  if (currentUser) {
    // Check for Single Division Assignment
    if (!commonDivision) {
      let userDivId = '';

      // Case A: Manager with allowedDivisions
      if (currentUser.role === 'manager' && currentUser.allowedDivisions?.length === 1) {
        userDivId = typeof currentUser.allowedDivisions[0] === 'string'
          ? currentUser.allowedDivisions[0]
          : currentUser.allowedDivisions[0]._id;
      }
      // Case B: HOD with divisionMapping
      else if (currentUser.role === 'hod' && currentUser.divisionMapping?.length === 1) {
        const mapping = currentUser.divisionMapping[0];
        userDivId = typeof mapping.division === 'string' ? mapping.division : mapping.division._id;
      }
      // Case C: Standard Single Division Assignment
      else if (currentUser.division) {
        userDivId = typeof currentUser.division === 'string' ? currentUser.division : currentUser.division._id;
      }

      if (userDivId) {
        commonDivision = divisions.find(d => d._id === userDivId) || null;
      }
    }

    // Check for Single Department Assignment (Only if Division is determined or consistent)
    if (!commonDepartment) {
      let userDeptId = '';

      // Case A: HOD with divisionMapping targeting 1 department
      if (currentUser.role === 'hod' && currentUser.divisionMapping?.length === 1) {
        const mapping = currentUser.divisionMapping[0];
        if (mapping.departments?.length === 1) {
          const d = mapping.departments[0];
          userDeptId = typeof d === 'string' ? d : d._id;
        }
      }
      // Case B: Standard Department Assignment
      else if (currentUser.department) {
        userDeptId = typeof currentUser.department === 'string' ? currentUser.department : currentUser.department._id;
      }
      // Case C: Departments array has exactly 1
      else if (currentUser.departments?.length === 1) {
        userDeptId = currentUser.departments[0]._id;
      }

      if (userDeptId) {
        // Only show department badge if it belongs to the common division (if one exists), or if no division context prevents it
        const dept = departments.find(d => d._id === userDeptId);
        if (dept) {
          // Verification: Does this department belong to the common division? (If commonDivision is set)
          // If commonDivision is set, we strictly check if dept is in it. If loosely coupled, we might show it anyway.
          // Given user request "single division assigned... single department... display those both", we imply validity.
          commonDepartment = dept;
        }
      }
    }
  }

  const mappedDesigs = filteredEmployees.map(e => getEntityId(e.designation_id) || getEntityId(e.designation));
  const uniqueDesigIds = Array.from(new Set(mappedDesigs.filter((x): x is string => !!x)));
  const commonDesignation = uniqueDesigIds.length === 1 ? designations.find(d => d._id === uniqueDesigIds[0]) : null;

  const hideDepartmentColumn = !!commonDepartment;
  const hideDesignationColumn = !!commonDesignation;

  // Scoped Divisions and Departments logic
  const scopedDivisions = useMemo(() => {
    if (!currentUser || currentUser.dataScope === 'all') return divisions;

    // 1. Manager/HR/SubAdmin with allowedDivisions
    if (currentUser.allowedDivisions && currentUser.allowedDivisions.length > 0) {
      const allowedIds = currentUser.allowedDivisions.map((d: any) => typeof d === 'string' ? d : d._id);
      return divisions.filter(d => allowedIds.includes(d._id));
    }

    // 2. HOD logic (via divisionMapping)
    if (currentUser.divisionMapping && currentUser.divisionMapping.length > 0) {
      const mappedDivIds = currentUser.divisionMapping.map((m: any) =>
        typeof m.division === 'string' ? m.division : m.division._id
      );
      return divisions.filter(d => mappedDivIds.includes(d._id));
    }

    // 3. Simple Division Assignment (Legacy Manager)
    if (currentUser.division) {
      const divId = typeof currentUser.division === 'string' ? currentUser.division : currentUser.division._id;
      return divisions.filter(d => d._id === divId);
    }

    // If restricted but no specific breakdown found (shouldn't happen often if configured right), return empty or all?
    // Safer to return all if scope is not explicitly restricted to IDs, OR empty if strict.
    // Given "restricted" scope usually implies some assignment, we'll return empty if nothing matches to be safe.
    if (currentUser.scope === 'restricted') return [];

    return divisions;
  }, [currentUser, divisions]);

  const getScopedDepartments = (selectedDivisionId: string) => {
    // Start with departments belonging to the selected division
    const eligibleDepts = departments.filter(d => {
      if (!selectedDivisionId) return true;

      // Check if department belongs to division
      // 1. Check division's departments array
      const div = divisions.find(dv => dv._id === selectedDivisionId);
      if (div && div.departments) {
        const divDeptIds = div.departments.map((dd: any) => typeof dd === 'string' ? dd : dd._id);
        if (divDeptIds.includes(d._id)) return true;
      }

      // 2. Fallback: check department's divisions array
      if ((d as any).divisions) {
        const deptDivIds = (d as any).divisions.map((dv: any) => typeof dv === 'string' ? dv : dv._id);
        if (deptDivIds.includes(selectedDivisionId)) return true;
      }

      // 3. Fallback: check department's division_id (if it's a single assignment)
      if ((d as any).division_id) {
        const dDivId = typeof (d as any).division_id === 'string' ? (d as any).division_id : (d as any).division_id._id;
        if (dDivId === selectedDivisionId) return true;
      }

      return false;
    });

    if (!currentUser || currentUser.dataScope === 'all') return eligibleDepts;

    // Filter by User's specific department access
    // 1. Division Mapping (HOD)
    if (currentUser.divisionMapping && currentUser.divisionMapping.length > 0) {
      // Find mapping for the selected division
      const mapping = currentUser.divisionMapping.find((m: any) => {
        const mDivId = typeof m.division === 'string' ? m.division : m.division._id;
        return mDivId === selectedDivisionId;
      });

      if (mapping) {
        // If departments array is empty, it usually means ALL departments in that division
        if (!mapping.departments || mapping.departments.length === 0) return eligibleDepts;

        const allowedDeptIds = mapping.departments.map((dd: any) => typeof dd === 'string' ? dd : dd._id);
        return eligibleDepts.filter(d => allowedDeptIds.includes(d._id));
      }
    }

    // 2. Direct Department Assignment
    if (currentUser.departments && currentUser.departments.length > 0) {
      const allowedDeptIds = currentUser.departments.map((d: any) => d._id);
      return eligibleDepts.filter(d => allowedDeptIds.includes(d._id));
    }

    if (currentUser.department) {
      const deptId = typeof currentUser.department === 'string' ? currentUser.department : currentUser.department._id;
      return eligibleDepts.filter(d => d._id === deptId);
    }

    return eligibleDepts;
  }

  // Permission checks using read/write pattern (respects Feature Control from Settings when user has no explicit list)
  const user = auth.getUser();
  const hasViewPermission = userForPermissions ? canViewEmployees(userForPermissions as any) : false;
  const hasManagePermission = userForPermissions ? canEditEmployee(userForPermissions as any) : false; // Write permission for ALL actions

  const handleSubmitBankUpdate = async (bankFormData: any) => {
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
        setSuccess('Bank detail update request submitted successfully. It will be applied after Superadmin approval.');
        setShowBankUpdateDialog(false);
        Swal.fire({
          title: 'Submitted!',
          text: 'Bank detail update request has been submitted for approval.',
          icon: 'success',
          confirmButtonColor: '#4f46e5',
        });
      } else {
        setError(res.error || 'Failed to submit bank update request.');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred.');
    } finally {
      setSubmittingBankUpdate(false);
    }
  };

  const RenderFilterHeader = ({
    label,
    filterKey,
    options,
    currentFilters,
    setFilters
  }: {
    label: string,
    filterKey: string,
    nestedKey?: string,
    options: string[],
    currentFilters: Record<string, string>,
    setFilters: (filters: Record<string, string>) => void
  }) => {
    const isActive = activeFilterColumn === filterKey;
    const currentFilterValue = currentFilters[filterKey] || '';

    return (
      <th className="relative px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-text-secondary">
        <div className="flex items-center gap-2">
          <span>{label}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              setFilterPos({ top: rect.bottom, left: rect.left });
              setActiveFilterColumn(isActive ? null : filterKey);
            }}
            className={`rounded-lg p-1.5 transition-all ${currentFilterValue ? 'text-indigo-600 bg-indigo-500/10' : 'text-text-secondary hover:bg-bg-base/80'}`}
          >
            <Filter className="h-3 w-3" />
          </button>
        </div>

        {isActive && typeof document !== 'undefined' && createPortal(
          <div className="fixed inset-0 z-[100] flex items-start justify-start">
            <div
              className="fixed inset-0 bg-transparent"
              onClick={() => setActiveFilterColumn(null)}
            />
            <div
              className="z-[101] mt-2 min-w-[220px] rounded-2xl border border-border-base bg-bg-surface/95 p-2 shadow-2xl backdrop-blur-xl fixed animate-in fade-in zoom-in-95 duration-200"
              style={{
                top: filterPos.top,
                left: filterPos.left,
              }}
            >
              <div className="mb-2 px-3 py-2 border-b border-border-base/50">
                <span className="text-[10px] font-black uppercase tracking-widest text-text-secondary">Filter by {label}</span>
              </div>
              <div className="max-h-60 overflow-y-auto custom-scrollbar p-1 space-y-1">
                <button
                  onClick={() => {
                    const newFilters = { ...currentFilters };
                    delete newFilters[filterKey];
                    setFilters(newFilters);
                    setActiveFilterColumn(null);
                  }}
                  className={`flex w-full items-center rounded-xl px-3 py-2 text-xs font-bold transition-all ${!currentFilterValue ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-text-secondary hover:bg-bg-base hover:text-text-primary'}`}
                >
                  All {label}s
                </button>
                {options.map(opt => (
                  <button
                    key={opt}
                    onClick={() => {
                      setFilters({ ...currentFilters, [filterKey]: opt });
                      setActiveFilterColumn(null);
                    }}
                    className={`flex w-full items-center rounded-xl px-3 py-2 text-xs font-bold transition-all ${currentFilterValue === opt ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-text-secondary hover:bg-bg-base hover:text-text-primary'}`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )}
      </th>
    );
  };





  return (
    <div className="relative min-h-screen bg-bg-base overflow-x-hidden">


      <div className="relative z-10 max-w-[1920px] mx-auto  sm:px-8 py-6 sm:py-8 space-y-8">
        {/* Header - Unified Layout */}
        <div className="space-y-4 mb-2">
          {/* Top Row: Title and Icon */}
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl hidden md:flex bg-gradient-to-br from-indigo-500 to-indigo-600 items-center justify-center text-white shadow-lg shadow-indigo-500/20">
              <Users className="w-5 h-5 md:w-6 md:h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                {(commonDepartment || commonDesignation) ? (
                  <>
                    {commonDepartment && (
                      <span className="text-xs font-bold text-indigo-500 uppercase tracking-wider">{commonDepartment.name}</span>
                    )}
                    {commonDepartment && commonDesignation && (
                      <span className="text-text-secondary/30">/</span>
                    )}
                    {commonDesignation && (
                      <span className="text-xs font-bold text-blue-500 uppercase tracking-wider">{commonDesignation.name}</span>
                    )}
                  </>
                ) : commonDivision && (
                  <span className="text-xs font-bold text-indigo-500 uppercase tracking-wider">{commonDivision.name}</span>
                )}
              </div>
              <h1 className="text-base md:text-2xl font-black tracking-tight text-text-primary">Employee Management</h1>
              {/* <p className="text-xs md:text-sm text-text-secondary font-medium">Manage workforce records • <span className="text-indigo-500">Source: {dataSource.toUpperCase()}</span></p> */}
            </div>
          </div>

          {/* Bottom Row: Action Buttons - Full Width on Desktop */}
          <div className="flex flex-wrap md:flex-nowrap items-center gap-1.5 md:gap-3">
            {(commonDivision || commonDepartment) && (
              <div className="hidden items-center gap-2 sm:flex">
                {commonDivision && (
                  <span className="inline-flex items-center rounded-lg bg-bg-surface px-2.5 py-1 text-xs font-bold text-text-secondary border border-border-base">
                    {commonDivision.name}
                  </span>
                )}
                <div className="h-4 w-px bg-border-base mx-1"></div>
              </div>
            )}

            {/* Tab Slider or Single Badge */}
            {canViewApplications ? (
              <div className="relative grid grid-cols-2 items-center rounded-2xl bg-bg-surface/50 border border-border-base p-1 backdrop-blur-md shadow-sm">
                <div
                  className={`absolute h-8 rounded-xl bg-bg-base border border-border-base shadow-sm transition-all duration-300 ease-in-out`}
                  style={{
                    width: activeTab === 'employees' ? 'calc(50% - 4px)' : 'calc(50% - 4px)',
                    transform: activeTab === 'employees' ? 'translateX(0px)' : 'translateX(calc(100% + 4px))'
                  }}
                />
                <button
                  onClick={() => setActiveTab('employees')}
                  className={`relative z-10 w-full flex items-center justify-center px-2 py-1 md:px-4 md:py-1.5 text-[9px] md:text-xs font-black uppercase tracking-widest transition-colors ${activeTab === 'employees'
                    ? 'text-text-primary'
                    : 'text-text-secondary hover:text-text-primary'
                    }`}
                >
                  Employees
                </button>
                <button
                  onClick={() => setActiveTab('applications')}
                  className={`relative z-10 w-full px-2 py-1 md:px-4 md:py-1.5 text-[9px] md:text-xs font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2 ${activeTab === 'applications'
                    ? 'text-text-primary'
                    : 'text-text-secondary hover:text-text-primary'
                    }`}
                >
                  <span className="md:hidden">Apps</span>
                  <span className="hidden md:inline">Applications</span>
                  {pendingApplications.length > 0 && (
                    <span className="flex h-4 min-w-[16px] md:h-5 md:min-w-[20px] items-center justify-center rounded-full bg-status-negative px-1 text-[9px] md:text-[10px] text-white font-bold">
                      {pendingApplications.length}
                    </span>
                  )}
                </button>
              </div>
            ) : (
              <div className="flex items-center rounded-xl bg-bg-surface/50 border border-border-base px-3 py-1.5 md:px-4 md:py-2 backdrop-blur-md shadow-sm">
                <span className="text-[10px] md:text-xs font-black uppercase tracking-widest text-text-primary">
                  Employees
                </span>
              </div>
            )}

            {/* Settings Button */}
            {hasManagePermission && (
              <Link
                href="/employees/form-settings"
                className="flex items-center justify-center rounded-xl md:rounded-2xl border border-border-base bg-bg-surface/50 p-1.5 md:p-2.5 text-text-secondary transition-all hover:bg-bg-surface hover:text-indigo-500 backdrop-blur-md shadow-sm"
                title="Form Settings"
              >
                <Settings className="h-4 w-4 md:h-5 md:w-5" />
              </Link>
            )}

            {/* Import Button */}
            {hasManagePermission && allowEmployeeBulkProcess && (
              <button
                onClick={() => setShowBulkUpload(true)}
                className="flex items-center gap-2 rounded-xl md:rounded-2xl border border-border-base bg-bg-surface/50 px-2 py-1.5 md:px-4 md:py-2.5 text-xs md:text-sm font-bold text-text-secondary transition-all hover:bg-bg-surface hover:text-indigo-500 backdrop-blur-md shadow-sm"
              >
                <div className="w-4 h-4 md:w-5 md:h-5 flex items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
                  <Upload className="h-3 w-3 md:h-3.5 md:w-3.5" />
                </div>
                <span className="hidden sm:inline uppercase tracking-widest text-[10px]">Import</span>
              </button>
            )}

            {/* Export Button */}
            {hasViewPermission && (
              <button
                onClick={() => {
                  setSelectedEmployeeForExport(null);
                  setShowExportDialog(true);
                }}
                className="flex items-center gap-2 rounded-xl md:rounded-2xl border border-border-base bg-bg-surface/50 px-2 py-1.5 md:px-4 md:py-2.5 text-xs md:text-sm font-bold text-text-secondary transition-all hover:bg-bg-surface hover:text-indigo-500 backdrop-blur-md shadow-sm"
              >
                <div className="w-4 h-4 md:w-5 md:h-5 flex items-center justify-center rounded-lg bg-green-500/10 text-green-500">
                  <Download className="h-3 w-3 md:h-3.5 md:w-3.5" />
                </div>
                <span className="hidden sm:inline uppercase tracking-widest text-[10px]">Export</span>
              </button>
            )}

            {/* New Application Button - Responsive */}
            {hasManagePermission && (
              <>
                {/* Mobile: Icon Only */}
                <button
                  onClick={() => setShowApplicationDialog(true)}
                  className="md:hidden flex items-center justify-center rounded-xl border border-border-base bg-bg-surface/50 p-1.5 text-text-secondary transition-all hover:bg-bg-surface hover:text-indigo-500 backdrop-blur-md shadow-sm"
                  title="New Application"
                >
                  <Plus className="h-4 w-4" />
                </button>

                {/* Desktop: Full Button */}
                <button
                  onClick={() => setShowApplicationDialog(true)}
                  className="hidden md:flex md:items-center md:gap-2 md:rounded-2xl md:bg-gradient-to-br md:from-indigo-500 md:to-indigo-600 md:px-5 md:py-2.5 md:text-xs md:font-black md:uppercase md:tracking-widest md:text-white md:shadow-xl md:shadow-indigo-500/20 md:transition-all md:hover:scale-[1.02] md:active:scale-95"
                >
                  <Plus className="h-4 w-4" />
                  <span>New Application</span>
                </button>
              </>
            )}

          </div>
        </div>

        {/* Pagination Controls & Search */}
        {/* Pagination Controls & Search */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 md:gap-6 md:p-5 md:rounded-[2.5rem] md:border md:border-border-base md:bg-bg-surface/40 md:backdrop-blur-2xl md:shadow-xl md:shadow-indigo-500/5">
          {/* Search Section - Full width on desktop, stacked on mobile */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 md:gap-4 flex-1">
            <div className="relative flex-1 lg:max-w-2xl group w-full">
              <div className="absolute inset-0 bg-indigo-500/5 rounded-2xl blur-xl transition-opacity opacity-0 group-focus-within:opacity-100" />
              <Search className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 md:w-4 md:h-4 text-text-secondary transition-colors group-focus-within:text-indigo-500" />
              <input
                type="text"
                placeholder="Search by name, emp no, or department..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadEmployees(1, false)}
                className="relative w-full h-10 md:h-12 pl-10 md:pl-12 pr-10 md:pr-4 rounded-xl md:rounded-2xl border border-border-base bg-bg-base/60 text-xs md:text-sm font-semibold focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all text-text-primary placeholder:text-text-secondary/40 shadow-sm"
              />
              {/* Mobile Embedded Search Button */}
              <button
                onClick={() => loadEmployees(1, false)}
                className="md:hidden absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 active:scale-95 transition-all"
              >
                <Search className="w-4 h-4" />
              </button>
            </div>

            {/* Desktop Search Button */}
            <button
              onClick={() => loadEmployees(1, false)}
              className="hidden md:flex h-10 md:h-12 px-6 md:px-8 rounded-xl md:rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 text-white text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/40 hover:scale-[1.02] active:scale-95 transition-all items-center justify-center gap-2 whitespace-nowrap flex-shrink-0"
            >
              <Search className="w-3 h-3 md:w-3.5 h-3.5" />
              <span>Search</span>
            </button>


          </div>

          {/* Desktop: Pagination on right */}
          <div className="hidden lg:flex items-center justify-end gap-6 md:gap-8 flex-shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-black uppercase tracking-widest text-text-secondary">Page</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => loadEmployees(currentPage - 1, false)}
                  disabled={currentPage <= 1 || loading}
                  className="w-10 h-10 flex items-center justify-center rounded-xl border border-border-base bg-bg-base/50 text-text-secondary hover:text-indigo-500 hover:border-indigo-500/50 disabled:opacity-30 disabled:hover:border-border-base disabled:hover:text-text-secondary transition-all"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="min-w-[80px] text-center px-1">
                  <span className="text-sm font-black text-text-primary">{currentPage}</span>
                  <span className="mx-1.5 text-[10px] font-bold text-text-secondary">of</span>
                  <span className="text-sm font-black text-text-primary">{totalPages || 1}</span>
                </div>
                <button
                  onClick={() => loadEmployees(currentPage + 1, false)}
                  disabled={currentPage >= totalPages || loading}
                  className="w-10 h-10 flex items-center justify-center rounded-xl border border-border-base bg-bg-base/50 text-text-secondary hover:text-indigo-500 hover:border-indigo-500/50 disabled:opacity-30 disabled:hover:border-border-base disabled:hover:text-text-secondary transition-all"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="hidden sm:block h-8 w-px bg-border-base"></div>

            <div className="flex flex-col items-end">
              <span className="text-[10px] font-black uppercase tracking-widest text-text-secondary mb-0.5">Total Records</span>
              <span className="text-sm font-black text-indigo-500">{totalCount}</span>
            </div>

          </div>

          {/* Mobile: Minimized Pagination */}
          <div className="lg:hidden flex items-center justify-between mt-2 w-full px-2 gap-2">

            {/* Total Count */}
            <span className="text-[10px] font-black uppercase tracking-widest text-text-secondary whitespace-nowrap">
              Total: <span className="text-indigo-500">{totalCount}</span>
            </span>

            {/* Controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => loadEmployees(currentPage - 1, false)}
                disabled={currentPage <= 1 || loading}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-bg-surface border border-border-base text-text-secondary hover:text-indigo-500 disabled:opacity-30 disabled:hover:text-text-secondary transition-all shadow-sm"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="text-xs font-black text-text-primary uppercase tracking-widest">
                {currentPage} / {totalPages || 1}
              </span>

              <button
                onClick={() => loadEmployees(currentPage + 1, false)}
                disabled={currentPage >= totalPages || loading}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-bg-surface border border-border-base text-text-secondary hover:text-indigo-500 disabled:opacity-30 disabled:hover:text-text-secondary transition-all shadow-sm"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* Employee List with Skeleton Loading */}
      {loading || (activeTab === 'applications' && loadingApplications) ? (
        <div className="overflow-hidden rounded-3xl border border-border-base bg-bg-surface/50 backdrop-blur-md shadow-sm">
          <div className="overflow-x-auto scrollbar-hide">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-base bg-bg-base/50">
                  <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-text-secondary">
                    {activeTab === 'employees' ? 'Emp No' : 'App No'}
                  </th>
                  <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-text-secondary">Name</th>
                  <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-text-secondary">Division</th>
                  {!hideDepartmentColumn && <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-text-secondary">Department</th>}
                  {activeTab === 'employees' && !hideDesignationColumn && <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-text-secondary">Designation</th>}
                  {activeTab === 'employees' && customEmployeeGroupingEnabled && (
                    <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-text-secondary">Group</th>
                  )}
                  {activeTab === 'employees' && userRole !== 'hod' && userRole !== 'employee' && (
                    <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-text-secondary">Gross Salary</th>
                  )}
                  {activeTab === 'employees' && (
                    <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-text-secondary">Cert Status</th>
                  )}
                  {activeTab === 'applications' && <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-text-secondary">Proposed Salary</th>}
                  <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-text-secondary">Status</th>
                  <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-widest text-text-secondary">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-base">
                {[...Array(5)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-6 py-4"><div className="h-4 w-12 rounded bg-bg-base" /></td>
                    <td className="px-6 py-4">
                      <div className="h-4 w-32 rounded bg-bg-base mb-2" />
                      <div className="h-3 w-24 rounded bg-bg-base/50" />
                    </td>
                    <td className="px-6 py-4"><div className="h-4 w-24 rounded bg-bg-base" /></td>
                    {!hideDepartmentColumn && <td className="px-6 py-4"><div className="h-4 w-24 rounded bg-bg-base" /></td>}
                    {activeTab === 'employees' && !hideDesignationColumn && <td className="px-6 py-4"><div className="h-4 w-24 rounded bg-bg-base" /></td>}
                    {activeTab === 'employees' && customEmployeeGroupingEnabled && (
                      <td className="px-6 py-4"><div className="h-4 w-24 rounded bg-bg-base" /></td>
                    )}
                    {activeTab === 'employees' && userRole !== 'hod' && userRole !== 'employee' && (
                      <td className="px-6 py-4"><div className="h-4 w-20 rounded bg-bg-base" /></td>
                    )}
                    {activeTab === 'employees' && (
                      <td className="px-6 py-4"><div className="h-4 w-20 rounded bg-bg-base" /></td>
                    )}
                    {activeTab === 'applications' && <td className="px-6 py-4"><div className="h-4 w-24 rounded bg-bg-base" /></td>}
                    <td className="px-6 py-4"><div className="h-6 w-16 rounded-full bg-bg-base" /></td>
                    <td className="px-6 py-4 text-right"><div className="ml-auto h-8 w-24 rounded bg-bg-base" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === 'employees' ? (
        filteredEmployees.length === 0 ? (
          <div className="rounded-3xl border border-border-base bg-bg-surface/50 p-12 text-center backdrop-blur-md shadow-sm">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-500">
              <Users className="h-10 w-10" />
            </div>
            <h3 className="text-xl font-black text-text-primary tracking-tight">No employees found</h3>
            <p className="mt-2 text-sm text-text-secondary font-medium max-w-xs mx-auto">We couldn&apos;t find any employee records matching your criteria. Try adjusting your filters or search term.</p>
            <button
              onClick={() => {
                setSearchTerm('');
                setEmployeeFilters({});
                setSelectedDivision('');
              }}
              className="mt-6 px-6 py-2.5 rounded-xl bg-bg-base border border-border-base text-xs font-black uppercase tracking-widest text-text-primary hover:bg-bg-surface transition-colors"
            >
              Reset All Filters
            </button>
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-hidden rounded-3xl border border-border-base bg-bg-surface/50 backdrop-blur-md shadow-sm">
              <div className="overflow-x-auto scrollbar-hide">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border-base bg-bg-base/50">
                      <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-text-secondary">Emp No</th>
                      <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-text-secondary">Name</th>

                      <RenderFilterHeader
                        label="Division"
                        filterKey="division.name"
                        options={Array.from(new Set(employees.map(e => {
                          const div = divisions.find(d => d._id === (e.division_id || e.division?._id));
                          return div?.name || e.division?.name || (e.division_id as any)?.name;
                        }).filter((x) => !!x))) as string[]}
                        currentFilters={employeeFilters}
                        setFilters={setEmployeeFilters}
                      />
                      {!hideDepartmentColumn && (
                        <RenderFilterHeader
                          label="Department"
                          filterKey="department.name"
                          options={Array.from(new Set(employees.map(e => {
                            const dept = departments.find(d => d._id === (e.department_id || e.department?._id));
                            return dept?.name || e.department?.name || (e.department_id as any)?.name;
                          }).filter((x) => !!x))) as string[]}
                          currentFilters={employeeFilters}
                          setFilters={setEmployeeFilters}
                        />
                      )}
                      {!hideDesignationColumn && (
                        <RenderFilterHeader
                          label="Designation"
                          filterKey="designation.name"
                          options={Array.from(new Set(employees.map(e => {
                            const desig = designations.find(d => d._id === (e.designation_id || e.designation?._id));
                            return desig?.name || e.designation?.name || (e.designation_id as any)?.name;
                          }).filter((x) => !!x))) as string[]}
                          currentFilters={employeeFilters}
                          setFilters={setEmployeeFilters}
                        />
                      )}
                      {customEmployeeGroupingEnabled && (
                        <RenderFilterHeader
                          label="Group"
                          filterKey="employee_group.name"
                          options={Array.from(new Set(employees.map((e) => {
                            const eg = employeeGroups.find((g) => g._id === ((e as any).employee_group_id || (e as any).employee_group?._id));
                            return eg?.name || (e as any).employee_group?.name || ((e as any).employee_group_id as any)?.name;
                          }).filter((x) => !!x))) as string[]}
                          currentFilters={employeeFilters}
                          setFilters={setEmployeeFilters}
                        />
                      )}
                      {userRole !== 'hod' && userRole !== 'employee' && (
                        <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-text-secondary">Gross Salary</th>
                      )}
                      {userRole !== 'hod' && userRole !== 'employee' && (
                        <RenderFilterHeader
                          label="Cert Status"
                          filterKey="qualificationStatus"
                          options={Array.from(new Set(employees.map(e => e.qualificationStatus).filter((x) => !!x))) as string[]}
                          currentFilters={employeeFilters}
                          setFilters={setEmployeeFilters}
                        />
                      )}
                      <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-text-secondary">Phone</th>
                      <RenderFilterHeader
                        label="Status"
                        filterKey="status"
                        options={['Active', 'Inactive', 'Left']}
                        currentFilters={employeeFilters}
                        setFilters={setEmployeeFilters}
                      />
                      <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-widest text-text-secondary">Actions</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-border-base">
                    {filteredEmployees.map((employee) => (
                      <tr
                        key={employee.emp_no}
                        className="transition-all hover:bg-bg-base/80 group cursor-pointer"
                        onClick={() => handleViewEmployee(employee)}
                      >
                        <td className="whitespace-nowrap px-6 py-4 text-sm font-black text-indigo-500">
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
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-sm font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                                {(employee.employee_name || '?').charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div>
                              <div className="text-sm font-black text-text-primary uppercase tracking-tight">{employee.employee_name}</div>
                              {employee.email && (
                                <div className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">{employee.email}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-xs font-bold text-text-secondary">
                          {employee.division?.name || (employee.division_id as { name?: string })?.name || '-'}
                        </td>

                        {!hideDepartmentColumn && (
                          <td className="whitespace-nowrap px-6 py-4 text-xs font-bold text-text-secondary">
                            {employee.department?.name || '-'}
                          </td>
                        )}
                        {!hideDesignationColumn && (
                          <td className="whitespace-nowrap px-6 py-4 text-xs font-bold text-text-secondary">
                            {employee.designation?.name || '-'}
                          </td>
                        )}
                        {customEmployeeGroupingEnabled && (
                          <td className="whitespace-nowrap px-6 py-4 text-xs font-bold text-text-secondary">
                            {(employee as any).employee_group?.name || ((employee as any).employee_group_id as any)?.name || '-'}
                          </td>
                        )}
                        {userRole !== 'hod' && userRole !== 'employee' && (
                          <td className="whitespace-nowrap px-6 py-4 text-xs font-black text-text-primary">
                            {employee.gross_salary ? `₹${employee.gross_salary.toLocaleString()}` : '-'}
                          </td>
                        )}
                        {userRole !== 'hod' && userRole !== 'employee' && (
                          <td className="whitespace-nowrap px-6 py-4">
                            <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${employee.qualificationStatus === 'verified'
                              ? 'bg-status-positive/10 text-status-positive'
                              : employee.qualificationStatus === 'pending'
                                ? 'bg-status-warning/10 text-status-warning'
                                : 'bg-text-secondary/10 text-text-secondary'
                              }`}>
                              {employee.qualificationStatus === 'verified' ? <CheckCircle className="w-3 h-3" /> : <LucideClock className="w-3 h-3" />}
                              {employee.qualificationStatus || 'Not Uploaded'}
                            </span>
                          </td>
                        )}
                        <td className="whitespace-nowrap px-6 py-4 text-xs font-bold text-text-secondary">
                          {employee.phone_number || '-'}
                        </td>

                        <td className="whitespace-nowrap px-6 py-4">
                          <div className="flex flex-wrap gap-2">
                            <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${employee.is_active !== false
                              ? 'bg-status-positive/10 text-status-positive'
                              : 'bg-text-secondary/10 text-text-secondary'
                              }`}>
                              {employee.is_active !== false ? <UserCheck className="w-3 h-3" /> : <UserX className="w-3 h-3" />}
                              {employee.is_active !== false ? 'Active' : 'Inactive'}
                            </span>
                            {employee.salaryStatus === 'pending_approval' && (
                              <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-widest bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
                                <LucideClock className="w-3 h-3" />
                                SALARY PENDING
                              </span>
                            )}
                            {employee.leftDate && (
                              <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-widest bg-status-warning/10 text-status-warning">
                                <LucideClock className="w-3 h-3" />
                                Left: {new Date(employee.leftDate).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1  group-hover:opacity-100 transition-opacity">
                            {hasManagePermission && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleEdit(employee); }}
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-text-secondary hover:bg-indigo-500/10 hover:text-indigo-500 transition-all font-bold"
                                title="Edit"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); handleViewEmployee(employee); }}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-text-secondary hover:bg-indigo-500/10 hover:text-indigo-500 transition-all font-bold"
                              title="View"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedEmployeeForExport(employee);
                                setShowExportDialog(true);
                              }}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-text-secondary hover:bg-green-500/10 hover:text-green-500 transition-all font-bold"
                              title="Download"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                            {hasManagePermission && (
                              <>
                                {employee.leftDate ? (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleRemoveLeftDate(employee); }}
                                    className="w-8 h-8 flex items-center justify-center rounded-lg text-text-secondary hover:bg-status-positive/10 hover:text-status-positive transition-all font-bold"
                                    title="Reactivate Employee"
                                  >
                                    <UserCheck className="h-3.5 w-3.5" />
                                  </button>
                                ) : (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleSetLeftDate(employee); }}
                                    className="w-8 h-8 flex items-center justify-center rounded-lg text-text-secondary hover:bg-status-negative/10 hover:text-status-negative transition-all font-bold"
                                    title="Set Left Date"
                                  >
                                    <UserX className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (employee.is_active !== false) handleDeactivate(employee.emp_no, true);
                                    else handleActivate(employee.emp_no);
                                  }}
                                  className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all font-bold ${employee.is_active !== false
                                    ? 'text-text-secondary hover:bg-status-negative/10 hover:text-status-negative'
                                    : 'text-text-secondary hover:bg-status-positive/10 hover:text-status-positive'
                                    }`}
                                  title={employee.is_active !== false ? 'Deactivate' : 'Activate'}
                                >
                                  {employee.is_active !== false ? <Settings className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                                </button>
                              </>
                            )}
                            {hasManagePermission && !employee.leftDate && (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (!confirm(`Resend credentials to ${employee.employee_name}? Their current credentials will be sent without resetting the password.`)) return;
                                  setIsResending(employee.emp_no);
                                  try {
                                    await api.resendEmployeeCredentials(employee.emp_no, { notificationChannels });
                                    setSuccess('Credentials sent!');
                                  } catch (err) {
                                    setError('Failed to resend');
                                  } finally {
                                    setIsResending(null);
                                  }
                                }}
                                disabled={isResending === employee.emp_no}
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-text-secondary hover:bg-indigo-500/10 hover:text-indigo-500 transition-all font-bold disabled:opacity-50"
                                title="Resend Credentials"
                              >
                                {isResending === employee.emp_no ? (
                                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
                                ) : (
                                  <Mail className="h-3.5 w-3.5" />
                                )}
                              </button>
                            )}
                            {hasManagePermission && !employee.leftDate && (
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
                                    await api.resetEmployeeCredentials(employee.emp_no, { customPassword: result.value });
                                    setSuccess('Credentials reset and sent!');
                                  } catch (err) {
                                    setError('Failed to reset');
                                  } finally {
                                    setIsResetting(null);
                                  }
                                }}
                                disabled={isResetting === employee.emp_no}
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-text-secondary hover:bg-orange-500/10 hover:text-orange-500 transition-all font-bold disabled:opacity-50"
                                title="Reset Credentials"
                              >
                                {isResetting === employee.emp_no ? (
                                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
                                ) : (
                                  <KeyRound className="h-3.5 w-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-border-base bg-bg-base/30 px-6 py-4 flex items-center justify-between">
                <p className="text-xs font-bold text-text-secondary uppercase tracking-widest">
                  Showing <span className="text-indigo-500">{filteredEmployees.length}</span> of <span className="text-indigo-500">{totalCount}</span> Employees
                </p>
                {/* Add pagination controls here if needed */}
              </div>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden space-y-3">
              {filteredEmployees.map((employee) => (
                <div
                  key={employee.emp_no}
                  onClick={() => handleViewEmployee(employee)}
                  className="relative rounded-xl border border-border-base bg-bg-surface/70 p-3 shadow-sm backdrop-blur-md transition-all hover:shadow-md active:scale-[0.99] cursor-pointer"
                >
                  {/* Card Header */}
                  <div className="mb-2 flex items-start justify-between gap-2">
                    {(employee as any).profilePhoto ? (
                      <img
                        src={(employee as any).profilePhoto}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-lg border border-border-base object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border-base bg-bg-base text-sm font-bold text-text-secondary">
                        {(employee.employee_name || '?').charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-black text-indigo-500">{employee.emp_no}</span>
                        {employee.is_active !== false ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-status-positive/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-status-positive">
                            <UserCheck className="w-2.5 h-2.5" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-text-secondary/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-text-secondary">
                            <UserX className="w-2.5 h-2.5" />
                            Inactive
                          </span>
                        )}
                      </div>
                      <h3 className="text-sm font-black text-text-primary uppercase tracking-tight truncate">{employee.employee_name}</h3>
                      {employee.email && (
                        <p className="text-[10px] font-medium text-text-secondary truncate">{employee.email}</p>
                      )}
                    </div>
                  </div>

                  {/* Card Info */}
                  <div className="space-y-1.5 mb-3">
                    {(employee.division?.name || (employee.division_id as { name?: string })?.name) && (
                      <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <span className="font-medium">Division:</span>
                        <span className="font-bold">{employee.division?.name || (employee.division_id as { name?: string })?.name}</span>
                      </div>
                    )}
                    {employee.department?.name && (
                      <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <span className="font-medium">Dept:</span>
                        <span className="font-bold">{employee.department.name}</span>
                      </div>
                    )}
                    {employee.designation?.name && (
                      <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <span className="font-medium">Role:</span>
                        <span className="font-bold">{employee.designation.name}</span>
                      </div>
                    )}
                    {employee.phone_number && (
                      <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <span className="font-bold">{employee.phone_number}</span>
                      </div>
                    )}
                    {userRole !== 'hod' && userRole !== 'employee' && employee.gross_salary && (
                      <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <span className="font-medium">Gross Salary:</span>
                        <span className="font-black text-text-primary">₹{employee.gross_salary.toLocaleString()}</span>
                      </div>
                    )}
                    {userRole !== 'hod' && userRole !== 'employee' && (
                      <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <span className="font-medium">Cert Status:</span>
                        <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${employee.qualificationStatus === 'verified'
                          ? 'bg-status-positive/10 text-status-positive'
                          : employee.qualificationStatus === 'pending'
                            ? 'bg-status-warning/10 text-status-warning'
                            : 'bg-text-secondary/10 text-text-secondary'
                          }`}>
                          {employee.qualificationStatus || 'Not Uploaded'}
                        </span>
                      </div>
                    )}
                    {employee.leftDate && (
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <span className="inline-flex items-center gap-1 rounded-md bg-status-warning/10 px-1.5 py-0.5 font-black uppercase tracking-wider text-status-warning">
                          <LucideClock className="w-2.5 h-2.5" />
                          Left: {new Date(employee.leftDate).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>


                  {/* Card Actions */}
                  <div className="flex items-center gap-1.5 pt-2 border-t border-border-base/50">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleViewEmployee(employee); }}
                      className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-indigo-500/10 px-1.5 py-1.5 text-[9px] font-black uppercase tracking-wider text-indigo-500 transition-colors hover:bg-indigo-500/20"
                      title="View"
                    >
                      <Eye className="h-2.5 w-2.5" />
                      <span>View</span>
                    </button>
                    {hasManagePermission && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleEdit(employee); }}
                        className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-blue-500/10 px-1.5 py-1.5 text-[9px] font-black uppercase tracking-wider text-blue-500 transition-colors hover:bg-blue-500/20"
                        title="Edit"
                      >
                        <Edit2 className="h-2.5 w-2.5" />
                        <span>Edit</span>
                      </button>
                    )}
                    {hasManagePermission && (
                      <>
                        {employee.leftDate ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRemoveLeftDate(employee); }}
                            className="p-1.5 rounded-lg bg-status-positive/10 text-status-positive hover:bg-status-positive/20 transition-colors"
                            title="Reactivate Employee"
                          >
                            <UserCheck className="h-3 w-3" />
                          </button>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSetLeftDate(employee); }}
                            className="p-1.5 rounded-lg bg-status-negative/10 text-status-negative hover:bg-status-negative/20 transition-colors"
                            title="Set Left Date"
                          >
                            <UserX className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (employee.is_active !== false) handleDeactivate(employee.emp_no, true);
                            else handleActivate(employee.emp_no);
                          }}
                          className={`p-1.5 rounded-lg transition-colors ${employee.is_active !== false
                            ? 'bg-status-warning/10 text-status-warning hover:bg-status-warning/20'
                            : 'bg-status-positive/10 text-status-positive hover:bg-status-positive/20'
                            }`}
                          title={employee.is_active !== false ? 'Deactivate' : 'Activate'}
                        >
                          {employee.is_active !== false ? <Settings className="h-3 w-3" /> : <UserCheck className="h-3 w-3" />}
                        </button>
                      </>
                    )}
                    {hasManagePermission && !employee.leftDate && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!confirm(`Resend credentials to ${employee.employee_name}? Their current credentials will be sent without resetting the password.`)) return;
                          setIsResending(employee.emp_no);
                          try {
                            await api.resendEmployeeCredentials(employee.emp_no, { notificationChannels });
                            setSuccess('Credentials sent!');
                          } catch (err) {
                            setError('Failed to resend');
                          } finally {
                            setIsResending(null);
                          }
                        }}
                        disabled={isResending === employee.emp_no}
                        className="p-1.5 rounded-lg bg-purple-500/10 text-purple-500 hover:bg-purple-500/20 transition-colors disabled:opacity-50"
                        title="Resend Credentials"
                      >
                        {isResending === employee.emp_no ? (
                          <div className="h-3 w-3 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
                        ) : (
                          <Mail className="h-3 w-3" />
                        )}
                      </button>
                    )}
                    {hasManagePermission && !employee.leftDate && (
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
                            await api.resetEmployeeCredentials(employee.emp_no, { customPassword: result.value });
                            setSuccess('Credentials reset and sent!');
                          } catch (err) {
                            setError('Failed to reset');
                          } finally {
                            setIsResetting(null);
                          }
                        }}
                        disabled={isResetting === employee.emp_no}
                        className="p-1.5 rounded-lg bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 transition-colors disabled:opacity-50"
                        title="Reset Credentials"
                      >
                        {isResetting === employee.emp_no ? (
                          <div className="h-3 w-3 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
                        ) : (
                          <KeyRound className="h-3 w-3" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {/* Mobile Stats Footer */}
              <div className="rounded-xl border border-border-base bg-bg-surface/40 px-4 py-3 text-center backdrop-blur-md">
                <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
                  Showing <span className="text-indigo-500">{filteredEmployees.length}</span> of <span className="text-indigo-500">{totalCount}</span> Employees
                </p>
              </div>
            </div>
          </>
        )) : (
        /* Applications Tab */
        <>
          {/* Applications Bulk Actions */}
          {selectedApplicationIds.length > 0 && hasManagePermission && (
            <div className="mb-6 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <button
                onClick={handleBulkReject}
                className="px-4 md:px-6 py-2 md:py-2.5 rounded-xl bg-status-negative text-white text-xs font-black uppercase tracking-widest hover:bg-red-600 shadow-lg shadow-status-negative/20 transition-all flex items-center justify-center gap-2"
              >
                <UserX className="w-3.5 h-3.5 md:w-4 md:h-4" />
                <span>Reject Selected ({selectedApplicationIds.length})</span>
              </button>
              <button
                onClick={handleBulkApprove}
                className="px-4 md:px-6 py-2 md:py-2.5 rounded-xl bg-indigo-500 text-white text-xs font-black uppercase tracking-widest hover:bg-indigo-600 shadow-lg shadow-indigo-500/20 transition-all flex items-center justify-center gap-2"
              >
                <UserCheck className="w-3.5 h-3.5 md:w-4 md:h-4" />
                <span>Approve Selected ({selectedApplicationIds.length})</span>
              </button>
            </div>
          )}

          {filteredApplications.length === 0 ? (
            <div className="rounded-3xl border border-border-base bg-bg-surface/50 p-12 text-center backdrop-blur-md shadow-sm">
              <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-500">
                <LucideClock className="h-10 w-10" />
              </div>
              <h3 className="text-xl font-black text-text-primary tracking-tight">No applications found</h3>
              <p className="mt-2 text-sm text-text-secondary font-medium max-w-xs mx-auto">No applications match the current filters or search. Try adjusting division, department, designation, or search.</p>
              <button
                onClick={() => {
                  setSearchTerm('');
                  setApplicationSearchTerm('');
                  setApplicationFilters({});
                  setEmployeeFilters({});
                  setSelectedDivision('');
                  loadApplications();
                }}
                className="mt-6 px-6 py-2.5 rounded-xl bg-bg-base border border-border-base text-xs font-black uppercase tracking-widest text-text-primary hover:bg-bg-surface transition-colors"
              >
                Reset filters & refresh
              </button>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Pending Approvals Table */}
              <div className="overflow-hidden rounded-3xl border border-border-base bg-bg-surface/50 backdrop-blur-md shadow-sm">
                <div className="border-b border-border-base bg-bg-base/30 px-4 md:px-6 py-3 md:py-4 flex items-center justify-between">
                  <h3 className="text-[10px] font-black text-text-secondary uppercase tracking-widest flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-status-warning animate-pulse" />
                    Pending Approvals ({pendingApplications.length})
                  </h3>
                </div>

                {/* Desktop Table View */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border-base bg-bg-base/50">
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
                            className="h-4 w-4 rounded border-border-base text-indigo-600 focus:ring-indigo-500 focus:ring-offset-0 bg-bg-base"
                          />
                        </th>
                        <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-text-secondary">Emp No</th>
                        <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-text-secondary">Name</th>
                        <RenderFilterHeader
                          label="Division"
                          filterKey="division.name"
                          options={Array.from(new Set(pendingApplications.map(a => {
                            const div = divisions.find(d => d._id === (a.division_id || (a as any).division?._id));
                            return div?.name || (a as any).division?.name || (a.division_id as any)?.name;
                          }).filter((x) => !!x))) as string[]}
                          currentFilters={applicationFilters}
                          setFilters={setApplicationFilters}
                        />
                        <RenderFilterHeader
                          label="Department"
                          filterKey="department.name"
                          options={Array.from(new Set(pendingApplications.map(a => {
                            const dept = departments.find(d => d._id === (a.department_id || a.department?._id));
                            return dept?.name || a.department?.name || (a.department_id as any)?.name;
                          }).filter((x) => !!x))) as string[]}
                          currentFilters={applicationFilters}
                          setFilters={setApplicationFilters}
                        />
                        {customEmployeeGroupingEnabled && (
                          <RenderFilterHeader
                            label="Group"
                            filterKey="employee_group.name"
                            options={Array.from(new Set(pendingApplications.map((a) => {
                              const g = employeeGroups.find((x) => x._id === ((a as any).employee_group_id || (a as any).employee_group?._id));
                              return g?.name || (a as any).employee_group?.name || ((a as any).employee_group_id as any)?.name;
                            }).filter((x) => !!x))) as string[]}
                            currentFilters={applicationFilters}
                            setFilters={setApplicationFilters}
                          />
                        )}
                        {userRole !== 'hod' && userRole !== 'employee' && <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-text-secondary">Proposed Salary</th>}
                        <th className="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-text-secondary">Created By</th>
                        <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-widest text-text-secondary">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-base">
                      {pendingApplications.length === 0 ? (
                        <tr>
                          <td colSpan={customEmployeeGroupingEnabled ? 9 : 8} className="px-6 py-12 text-center text-xs font-bold text-text-secondary uppercase">No pending approvals</td>
                        </tr>
                      ) : (
                        pendingApplications.map((app) => (
                          <tr
                            key={app._id}
                            className="transition-all hover:bg-bg-base/80 group cursor-pointer"
                            onClick={() => setViewingApplication(app)}
                          >
                            <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedApplicationIds.includes(app._id)}
                                onChange={() => toggleSelectApplication(app._id)}
                                className="h-4 w-4 rounded border-border-base text-indigo-600 focus:ring-indigo-500 focus:ring-offset-0 bg-bg-base"
                              />
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-sm font-black text-indigo-500">
                              {app.emp_no}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4">
                              <div className="text-sm font-black text-text-primary uppercase tracking-tight">{app.employee_name}</div>
                              {app.email && <div className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">{app.email}</div>}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-xs font-bold text-text-secondary">
                              {(app as any).division?.name || (app.division_id as { name?: string })?.name || '-'}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-xs font-bold text-text-secondary">
                              {app.department?.name || (app.department_id as { name?: string })?.name || '-'}
                            </td>
                            {customEmployeeGroupingEnabled && (
                              <td className="whitespace-nowrap px-6 py-4 text-xs font-bold text-text-secondary">
                                {(app as any).employee_group?.name || ((app as any).employee_group_id as any)?.name || '-'}
                              </td>
                            )}
                            {userRole !== 'hod' && userRole !== 'employee' && (
                              <td className="whitespace-nowrap px-6 py-4 text-sm font-black text-text-primary">
                                ₹{app.proposedSalary.toLocaleString()}
                              </td>
                            )}
                            <td className="whitespace-nowrap px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-widest">
                              {app.createdBy?.name || 'Unknown'}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-right">
                              {hasManagePermission && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setViewingApplication(app); }}
                                  className="px-4 py-1.5 rounded-lg bg-indigo-500 text-white text-[10px] font-black uppercase tracking-widest hover:bg-indigo-600 transition-colors shadow-sm shadow-indigo-500/10"
                                >
                                  View Details
                                </button>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card View */}
                <div className="md:hidden p-3 space-y-3">
                  {pendingApplications.length === 0 ? (
                    <p className="px-3 py-8 text-center text-xs font-bold text-text-secondary uppercase">No pending approvals</p>
                  ) : (
                    pendingApplications.map((app) => (
                      <div
                        key={app._id}
                        onClick={() => setViewingApplication(app)}
                        className="relative rounded-xl border border-border-base bg-bg-base/40 p-3 shadow-sm transition-all hover:shadow-md active:scale-[0.99] cursor-pointer"
                      >
                        {/* Checkbox */}
                        <div className="absolute top-2 right-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedApplicationIds.includes(app._id)}
                            onChange={() => toggleSelectApplication(app._id)}
                            className="h-4 w-4 rounded border-border-base text-indigo-600 focus:ring-indigo-500 focus:ring-offset-0 bg-bg-base"
                          />
                        </div>

                        {/* Card Content */}
                        <div className="pr-8">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-black text-indigo-500">{app.emp_no}</span>
                            <span className="inline-flex items-center gap-1 rounded-md bg-status-warning/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-status-warning">
                              <LucideClock className="w-2.5 h-2.5" />
                              Pending
                            </span>
                          </div>
                          <h4 className="text-sm font-black text-text-primary uppercase tracking-tight truncate mb-1">{app.employee_name}</h4>
                          {app.email && <p className="text-[10px] font-medium text-text-secondary truncate mb-2">{app.email}</p>}

                          <div className="space-y-1">
                            {((app as any).division?.name || (app.division_id as { name?: string })?.name) && (
                              <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                                <span className="font-medium">Division:</span>
                                <span className="font-bold">{(app as any).division?.name || (app.division_id as { name?: string })?.name}</span>
                              </div>
                            )}
                            {(app.department?.name || (app.department_id as { name?: string })?.name) && (
                              <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                                <span className="font-medium">Dept:</span>
                                <span className="font-bold">{app.department?.name || (app.department_id as { name?: string })?.name}</span>
                              </div>
                            )}
                            {userRole !== 'hod' && userRole !== 'employee' && (
                              <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                                <span className="font-medium">Salary:</span>
                                <span className="font-bold text-text-primary">₹{app.proposedSalary.toLocaleString()}</span>
                              </div>
                            )}
                            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                              <span className="font-medium">By:</span>
                              <span className="font-bold">{app.createdBy?.name || 'Unknown'}</span>
                            </div>
                          </div>
                        </div>

                        {/* Action Buttons */}
                        {hasManagePermission && (
                          <div className="mt-3 pt-2 border-t border-border-base/50 flex gap-2">
                            {app.status === 'pending' ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); setViewingApplication(app); }}
                                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-indigo-500/10 px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-indigo-500 transition-colors hover:bg-indigo-500/20"
                              >
                                <Eye className="h-3 w-3" />
                                <span>View Details</span>
                              </button>
                            ) : app.status === 'verified' && canFinalizeSalary(userForPermissions as any) ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); openApprovalDialog(app); }}
                                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-blue-500/10 px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-blue-500 transition-colors hover:bg-blue-500/20"
                              >
                                <ShieldCheck className="h-3 w-3" />
                                <span>Finalize Salary</span>
                              </button>
                            ) : null}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          )}
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
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">JPG or PNG, max 5MB.</p>
                    </div>
                  </div>
                </div>

                <DynamicEmployeeForm
                  formData={applicationFormData}
                  onChange={setApplicationFormData}
                  errors={formErrors}
                  departments={getScopedDepartments(getEntityId(applicationFormData.division_id) || '')}
                  divisions={scopedDivisions}
                  employeeGroups={employeeGroups}
                  designations={filteredApplicationDesignations as any}
                  isEditingExistingEmployee={false}
                  excludeFields={[
                    ...(userRole === 'hod' ? SENSITIVE_FIELDS : []),
                    ...(applicationFormAutoGenerateEmpNo ? ['emp_no'] : []),
                  ]}
                />

                {/* Allowances & Deductions Overrides */}
                {userRole !== 'hod' && (
                  <div className="space-y-4 rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Allowances &amp; Deductions</h3>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Defaults come from Department/Global. Enter an amount to override for this employee.
                        </p>
                      </div>
                      {loadingComponents && (
                        <div className="text-xs text-slate-500 dark:text-slate-400">Loading components...</div>
                      )}
                    </div>

                    {/* Salary summary */}
                    {userRole !== 'hod' && (
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
                    )}

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
                                      onWheel={(e) => e.currentTarget.blur()}
                                      className="w-24 rounded border border-red-200 bg-white px-2 py-1 text-[11px] text-red-900 focus:border-red-400 focus:outline-none dark:border-red-800 dark:bg-green-950 dark:text-green-100 no-spinner"
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
                )}

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
                          <label
                            key={pref.id}
                            title={!hasManagePermission ? "Write permission (EMPLOYEES:write) required to toggle preferences" : ""}
                            className={`flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 p-3 transition-all dark:border-slate-800 dark:bg-slate-900/50 ${hasManagePermission ? 'cursor-pointer hover:bg-slate-50' : 'cursor-not-allowed opacity-60'}`}
                          >
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{pref.label}</span>
                            <div
                              onClick={() => {
                                if (!hasManagePermission) return;
                                const newVal = !((applicationFormData as any)[pref.id] ?? true);
                                setApplicationFormData(prev => ({ ...prev, [pref.id]: newVal }));
                              }}
                              className={`relative h-6 w-11 rounded-full transition-colors duration-200 ease-in-out ${hasManagePermission ? 'cursor-pointer' : 'cursor-not-allowed'} ${((applicationFormData as any)[pref.id] ?? true) ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-700'}`}
                            >
                              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out mt-1 ml-1 ${((applicationFormData as any)[pref.id] ?? true) ? 'translate-x-5' : 'translate-x-0'}`} />
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
                          <label
                            key={pref.id}
                            title={!hasManagePermission ? "Write permission (EMPLOYEES:write) required to toggle preferences" : ""}
                            className={`flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 p-3 transition-all dark:border-slate-800 dark:bg-slate-900/50 ${hasManagePermission ? 'cursor-pointer hover:bg-slate-50' : 'cursor-not-allowed opacity-60'}`}
                          >
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{pref.label}</span>
                            <div
                              onClick={() => {
                                if (!hasManagePermission) return;
                                const newVal = !((applicationFormData as any)[pref.id] ?? true);
                                setApplicationFormData(prev => ({ ...prev, [pref.id]: newVal }));
                              }}
                              className={`relative h-6 w-11 rounded-full transition-colors duration-200 ease-in-out ${hasManagePermission ? 'cursor-pointer' : 'cursor-not-allowed'} ${((applicationFormData as any)[pref.id] ?? true) ? 'bg-amber-600' : 'bg-slate-200 dark:bg-slate-700'}`}
                            >
                              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out mt-1 ml-1 ${((applicationFormData as any)[pref.id] ?? true) ? 'translate-x-5' : 'translate-x-0'}`} />
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="sticky bottom-0 z-20 -mx-6 mt-2 flex gap-3 border-t border-slate-200 bg-white/95 px-6 py-3 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-950/95">
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
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Created By</p>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{selectedApplication.createdBy?.name || '-'}</p>
                    </div>
                  </div>
                </div>

                {/* Qualifications - Key Feature */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50">
                  <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Qualifications & Certificates</h3>
                  {(() => {
                    const quals = selectedApplication.qualifications;
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
                              k !== 'certificateUrl' && v !== null && v !== undefined && v !== ''
                            );

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
                {userRole !== 'hod' && (
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

                      {/* Approved Salary Input */}
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                          Approved Salary *
                        </label>
                        <input
                          type="number"
                          value={approvalData.approvedSalary || ''}
                          onChange={(e) => setApprovalData({ ...approvalData, approvedSalary: Number(e.target.value) })}
                          onWheel={(e) => e.currentTarget.blur()}
                          required
                          min="0"
                          step="0.01"
                          className="w-full rounded-xl border-2 border-green-400 bg-white px-4 py-2.5 text-lg font-semibold transition-all focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-green-600 dark:bg-slate-900 dark:text-slate-100 no-spinner"
                          placeholder="Enter approved salary"
                        />
                        {approvalData.approvedSalary !== selectedApplication.proposedSalary && (
                          <p className="mt-2 text-xs text-green-600 dark:text-green-400">
                            ✓ Salary modified from proposed amount
                          </p>
                        )}
                      </div>

                      {/* Second Salary (If applicable) */}
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
                          Specify the employee&apos;s joining date
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Allowances & Deductions with summary in approval */}
                {userRole !== 'hod' && (
                  <div className="space-y-4 rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Allowances &amp; Deductions</h3>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Based on department/global defaults. Adjust overrides as needed before approval.
                        </p>
                      </div>
                      {approvalLoadingComponents && (
                        <div className="text-xs text-slate-500 dark:text-slate-400">Loading components...</div>
                      )}
                    </div>

                    {userRole !== 'hod' && (
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
                    )}

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
                              <div key={key} className="rounded-lg border border-red-100 bg-white/70 px-3 py-2 text-xs dark:border-red-900/50 dark:bg-green-950/40">
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
                                      className="w-24 rounded border border-red-200 bg-white px-2 py-1 text-[11px] text-red-900 focus:border-red-400 focus:outline-none dark:border-red-800 dark:bg-green-950 dark:text-green-100 no-spinner"
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
                )}

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

              <form onSubmit={handleSubmit} className="space-y-6 pb-24">
                {/* Profile photo (optional); when editing, add or update photo */}
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
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">JPG or PNG, max 5MB.</p>
                    </div>
                  </div>
                </div>

                <DynamicEmployeeForm
                  formData={formData}
                  onChange={setFormData}
                  errors={{}}
                  departments={departments}
                  divisions={divisions}
                  employeeGroups={employeeGroups}
                  designations={filteredDesignations as any}
                  onSettingsLoaded={setFormSettings}
                  isEditingExistingEmployee={!!editingEmployee}
                  excludeFields={[
                    ...(userRole === 'hod' ? SENSITIVE_FIELDS : []),
                    ...(!editingEmployee && addFormAutoGenerateEmpNo ? ['emp_no'] : []),
                  ]}
                />

                {/* Leave Settings */}
                <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                  <h3 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">Leave Settings</h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                        Monthly Paid Leaves
                      </label>
                      <input
                        type="number"
                        name="paidLeaves"
                        value={formData.paidLeaves ?? 0}
                        onChange={handleInputChange}
                        onWheel={(e) => e.currentTarget.blur()}
                        min="0"
                        step="0.5"
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm transition-all focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 no-spinner"
                        placeholder="0"
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
                        value={formData.allottedLeaves ?? 0}
                        onChange={handleInputChange}
                        onWheel={(e) => e.currentTarget.blur()}
                        min="0"
                        step="0.5"
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm transition-all focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 no-spinner"
                        placeholder="0"
                      />
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Yearly total for without_pay/LOP leaves (for balance tracking)
                      </p>
                    </div>
                  </div>
                </div>

                {/* Allowances & Deductions Overrides + Salary Summary */}
                {userRole !== 'hod' && (
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
                    {userRole !== 'hod' && (
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
                    )}

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
                              <div key={key} className="rounded-lg border border-red-100 bg-white/70 px-3 py-2 text-xs dark:border-red-900/50 dark:bg-green-950/40">
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
                )}

                {/* Deduction Preferences */}
                {userRole !== 'hod' && (
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
                            <label key={pref.id} title={!hasManagePermission ? "Write permission (EMPLOYEES:write) required to toggle preferences" : ""} className={`flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 p-3 transition-all dark:border-slate-800 dark:bg-slate-900/50 ${hasManagePermission ? 'cursor-pointer hover:bg-slate-50' : 'cursor-not-allowed opacity-60'}`}>
                              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{pref.label}</span>
                              <div
                                onClick={() => {
                                  if (!hasManagePermission) return;
                                  const newVal = !((formData as any)[pref.id] ?? true);
                                  setFormData(prev => ({ ...prev, [pref.id]: newVal }));
                                }}
                                className={`relative h-6 w-11 rounded-full transition-colors duration-200 ease-in-out ${hasManagePermission ? 'cursor-pointer' : 'cursor-not-allowed'} ${((formData as any)[pref.id] ?? true) ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-700'}`}
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
                            <label key={pref.id} title={!hasManagePermission ? "Write permission (EMPLOYEES:write) required to toggle preferences" : ""} className={`flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 p-3 transition-all dark:border-slate-800 dark:bg-slate-900/50 ${hasManagePermission ? 'cursor-pointer hover:bg-slate-50' : 'cursor-not-allowed opacity-60'}`}>
                              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{pref.label}</span>
                              <div
                                onClick={() => {
                                  if (!hasManagePermission) return;
                                  const newVal = !((formData as any)[pref.id] ?? true);
                                  setFormData(prev => ({ ...prev, [pref.id]: newVal }));
                                }}
                                className={`relative h-6 w-11 rounded-full transition-colors duration-200 ease-in-out ${hasManagePermission ? 'cursor-pointer' : 'cursor-not-allowed'} ${((formData as any)[pref.id] ?? true) ? 'bg-amber-600' : 'bg-slate-200 dark:bg-slate-700'}`}
                              >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out mt-1 ml-1 ${((formData as any)[pref.id] ?? true) ? 'translate-x-5' : 'translate-x-0'}`} />
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}


                {/* Actions */}
                <div className="sticky bottom-0 z-20 mt-2 flex gap-3 border-t border-slate-200 bg-white/95 pt-3 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-950/95">
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

                    // Mirror the robust logic from getScopedDepartments
                    return departments.filter(d => {
                      // 1. Check division's departments array
                      if (div.departments) {
                        const divDeptIds = div.departments.map((dd: any) => typeof dd === 'string' ? dd : dd._id);
                        if (divDeptIds.includes(d._id)) return true;
                      }

                      // 2. Check department's divisions array
                      if ((d as any).divisions) {
                        const deptDivIds = (d as any).divisions.map((dv: any) => typeof dv === 'string' ? dv : dv._id);
                        if (deptDivIds.includes(div._id)) return true;
                      }

                      // 3. Check department's division_id
                      const dDivId = (d as any).division_id?._id || (d as any).division_id;
                      if (dDivId && String(dDivId) === String(div._id)) return true;

                      return false;
                    }).map(d => ({ value: d.name, label: d.name }));
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

              // Check for duplicates within the file (skip for auto-assigned rows when auto-generate is ON)
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

                    const value = row[field.id];
                    const handledFields = ['emp_no', 'employee_name', 'division_name', 'department_name', 'designation_name', 'group_name', 'gender', 'dob', 'doj', 'marital_status', 'blood_group'];

                    if (!handledFields.includes(field.id) && field.isRequired) {
                      if (value === undefined || value === null || value === '') {
                        errors.push(`${field.label} is required`);
                        fieldErrors[field.id] = 'Required';
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
                  const coreFields = ['emp_no', 'employee_name', 'proposedSalary', 'gross_salary', 'division_id', 'department_id', 'designation_id', 'employee_group_id', 'division_name', 'department_name', 'designation_name', 'group_name', 'doj', 'dob', 'gender', 'marital_status', 'blood_group', 'qualifications', 'experience', 'address', 'location', 'aadhar_number', 'phone_number', 'alt_phone_number', 'email', 'pf_number', 'esi_number', 'bank_account_no', 'bank_name', 'bank_place', 'ifsc_code'];

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
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowViewDialog(false)} />
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
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                      {viewingEmployee.employee_name}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Employee No: {viewingEmployee.emp_no}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {hasBankUpdatePermission && (
                    <button
                      type="button"
                      onClick={() => setShowBankUpdateDialog(true)}
                      className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-black uppercase tracking-widest text-indigo-700 transition hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900/20 dark:text-slate-400"
                    >
                      Update Bank Details
                    </button>
                  )}
                  <button
                    onClick={() => setShowViewDialog(false)}
                    className="rounded-xl border border-slate-200 bg-white p-2 text-slate-400 transition hover:border-red-200 hover:text-red-500 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="space-y-6">
                {/* Status Badge */}
                <div className="flex items-center gap-2">
                  <span className={viewingEmployee.is_active !== false
                    ? 'inline-flex rounded-full px-3 py-1 text-sm font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'inline-flex rounded-full px-3 py-1 text-sm font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}>
                    {viewingEmployee.is_active !== false ? 'Active' : 'Inactive'}
                  </span>
                </div>

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
                    {userRole !== 'hod' && userRole !== 'employee' && (
                      <>
                        <div>
                          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Certificate Status</label>
                          <p className={`mt-1 text-sm font-bold ${viewingEmployee.qualificationStatus === 'verified' ? 'text-green-600' : viewingEmployee.qualificationStatus === 'pending' ? 'text-orange-500' : 'text-slate-600'}`}>
                            {viewingEmployee.qualificationStatus || 'Not Uploaded'}
                          </p>
                        </div>
                      </>
                    )}
                    <div>
                      <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Date of Joining</label>
                      <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.doj ? new Date(viewingEmployee.doj).toLocaleDateString() : '-'}</p>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Date of Birth</label>
                      <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.dob ? new Date(viewingEmployee.dob).toLocaleDateString() : '-'}</p>
                    </div>
                    {userRole !== 'hod' && (
                      <>
                        <div>
                          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Gross Salary</label>
                          <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.gross_salary ? `₹${viewingEmployee.gross_salary.toLocaleString()}` : '-'}</p>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">CTC Salary</label>
                          <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{(viewingEmployee as any).ctcSalary ? `₹${(viewingEmployee as any).ctcSalary.toLocaleString()}` : '-'}</p>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Calculated Salary (Net)</label>
                          <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{(viewingEmployee as any).calculatedSalary ? `₹${(viewingEmployee as any).calculatedSalary.toLocaleString()}` : '-'}</p>
                        </div>
                      </>
                    )}
                    <div>
                      <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Paid Leaves</label>
                      <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.paidLeaves ?? '-'}</p>
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
                  </div>
                </div>

                {/* Contact Information */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50">
                  <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Contact Information</h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

                {/* Professional Information */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50">
                  <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Professional Information</h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 block">Qualifications</label>
                      <div className="space-y-3">
                        {(() => {
                          const quals = viewingEmployee.qualifications;
                          if (!quals || (Array.isArray(quals) && quals.length === 0)) {
                            return <p className="text-sm font-medium text-slate-900 dark:text-slate-100">-</p>;
                          }

                          // Handle array of objects (new format)
                          if (Array.isArray(quals)) {
                            return (
                              <div className="grid gap-6 sm:grid-cols-2">
                                {quals.map((qual: any, idx: number) => {
                                  const certificateUrl = qual.certificateUrl;
                                  const isPDF = certificateUrl?.toLowerCase().endsWith('.pdf');
                                  // Filter out internal keys like certificateUrl for list display
                                  const displayEntries = Object.entries(qual).filter(([k, v]) =>
                                    k !== 'certificateUrl' && v !== null && v !== undefined && v !== ''
                                  );

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

                          // Fallback for string
                          return <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{String(quals)}</p>;
                        })()}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Experience (Years)</label>
                      <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{viewingEmployee.experience ?? '-'}</p>
                    </div>
                  </div>
                </div>

                {/* Financial Information */}
                {userRole !== 'hod' && (
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
                    </div>
                  </div>
                )}

                {/* Deduction Preferences - Statutory & Attendance flags */}
                {userRole !== 'hod' && (
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
                                  disabled={!hasManagePermission}
                                  title={!hasManagePermission ? "Write permission (EMPLOYEES:write) required to toggle preferences" : ""}
                                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isEnabled ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-700'
                                    } ${!hasManagePermission ? 'opacity-50 cursor-not-allowed' : ''}`}
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
                                  disabled={!hasManagePermission}
                                  title={!hasManagePermission ? "Write permission (EMPLOYEES:write) required to toggle preferences" : ""}
                                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isEnabled ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-700'
                                    } ${!hasManagePermission ? 'opacity-50 cursor-not-allowed' : ''}`}
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
                )}

                {/* Bank Details */}
                {userRole !== 'hod' && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50">
                    <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Bank Details</h3>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                    </div>
                  </div>
                )}

                {/* Allowances & Deductions - Hide from HOD */}
                {userRole !== 'hod' && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50">
                    <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Allowances & Deductions</h3>

                    {/* Allowances */}
                    {(Array.isArray(viewingEmployee.employeeAllowances) && viewingEmployee.employeeAllowances.length > 0) ? (
                      <div className="mb-6">
                        <h4 className="mb-3 text-sm font-semibold text-green-700 dark:text-green-400">Allowances</h4>
                        <div className="space-y-2">
                          {viewingEmployee.employeeAllowances.map((allowance: any, idx: number) => (
                            <div key={idx} className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50/50 p-3 dark:border-green-800 dark:bg-green-900/20">
                              <div className="flex-1">
                                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{allowance.name || '-'}</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                  {allowance.type === 'percentage'
                                    ? `${allowance.percentage}% of ${allowance.percentageBase || 'basic'}`
                                    : 'Fixed Amount'}
                                  {allowance.isOverride && (
                                    <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                      Override
                                    </span>
                                  )}
                                </p>
                              </div>
                              <p className="text-sm font-semibold text-green-700 dark:text-green-400">
                                {allowance.amount !== null && allowance.amount !== undefined
                                  ? `₹${Number(allowance.amount).toLocaleString()}`
                                  : '-'}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          No employee-level allowance overrides. Default allowances from Department/Global settings will be used during payroll calculation.
                        </p>
                      </div>
                    )}

                    {/* Deductions */}
                    {(Array.isArray(viewingEmployee.employeeDeductions) && viewingEmployee.employeeDeductions.length > 0) ? (
                      <div>
                        <h4 className="mb-3 text-sm font-semibold text-red-700 dark:text-red-400">Deductions</h4>
                        <div className="space-y-2">
                          {viewingEmployee.employeeDeductions.map((deduction: any, idx: number) => (
                            <div key={idx} className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50/50 p-3 dark:border-red-800 dark:bg-red-900/20">
                              <div className="flex-1">
                                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{deduction.name || '-'}</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                  {deduction.type === 'percentage'
                                    ? `${deduction.percentage}% of ${deduction.percentageBase || 'basic'}`
                                    : 'Fixed Amount'}
                                  {deduction.isOverride && (
                                    <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                      Override
                                    </span>
                                  )}
                                </p>
                              </div>
                              <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                                {deduction.amount !== null && deduction.amount !== undefined
                                  ? `₹${Number(deduction.amount).toLocaleString()}`
                                  : '-'}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          No employee-level deduction overrides. Default deductions from Department/Global settings will be used during payroll calculation.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Left Date Information */}
                {viewingEmployee.leftDate && (
                  <div className="rounded-2xl border border-orange-200 bg-orange-50/50 p-5 dark:border-orange-800 dark:bg-orange-900/20 mb-5">
                    <h3 className="mb-4 text-lg font-semibold text-orange-900 dark:text-orange-100">Left Date Information</h3>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="text-xs font-medium text-orange-700 dark:text-orange-300">Left Date</label>
                        <p className="mt-1 text-sm font-medium text-orange-900 dark:text-orange-100">
                          {new Date(viewingEmployee.leftDate).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })}
                        </p>
                      </div>
                      {viewingEmployee.leftReason && (
                        <div>
                          <label className="text-xs font-medium text-orange-700 dark:text-orange-300">Reason</label>
                          <p className="mt-1 text-sm font-medium text-orange-900 dark:text-orange-100">
                            {viewingEmployee.leftReason}
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="mt-4">
                      {hasManagePermission && (
                        <button
                          onClick={() => {
                            setShowViewDialog(false);
                            handleRemoveLeftDate(viewingEmployee);
                          }}
                          className="rounded-xl bg-gradient-to-r from-green-500 to-green-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-green-500/30 transition-all hover:from-green-600 hover:to-green-600"
                        >
                          Reactivate Employee
                        </button>
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
                      <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                        {viewingEmployee.paidLeaves !== undefined && viewingEmployee.paidLeaves !== null
                          ? `${viewingEmployee.paidLeaves} days/month`
                          : '0 days/month'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Recurring monthly paid leaves
                      </p>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Yearly Allotted Leaves</label>
                      <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                        {viewingEmployee.allottedLeaves !== undefined && viewingEmployee.allottedLeaves !== null
                          ? `${viewingEmployee.allottedLeaves} days/year`
                          : '0 days/year'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Total for without_pay/LOP leaves (for balance tracking)
                      </p>
                    </div>
                    {userRole !== 'hod' && ((viewingEmployee as any).ctcSalary !== undefined && (viewingEmployee as any).ctcSalary !== null) && (
                      <div>
                        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">CTC Salary</label>
                        <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                          ₹{Number((viewingEmployee as any).ctcSalary || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    )}
                    {userRole !== 'hod' && ((viewingEmployee as any).calculatedSalary !== undefined && (viewingEmployee as any).calculatedSalary !== null) && (
                      <div>
                        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Calculated Salary (Net)</label>
                        <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                          ₹{Number((viewingEmployee as any).calculatedSalary || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Reporting Authority Section - Check both root and dynamicFields, handle both reporting_to and reporting_to_ */}
                {((viewingEmployee as any).reporting_to || (viewingEmployee as any).reporting_to_ || viewingEmployee.dynamicFields?.reporting_to || viewingEmployee.dynamicFields?.reporting_to_) && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50">
                    <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Reporting Authority</h3>
                    {(() => {
                      const reportingTo = (viewingEmployee as any).reporting_to || (viewingEmployee as any).reporting_to_ || viewingEmployee.dynamicFields?.reporting_to || viewingEmployee.dynamicFields?.reporting_to_;
                      console.log('Displaying reporting_to:', reportingTo);

                      if (!reportingTo || !Array.isArray(reportingTo) || reportingTo.length === 0) {
                        return <p className="text-sm text-slate-500 dark:text-slate-400">No reporting managers assigned</p>;
                      }

                      const isPopulated = reportingTo[0] && typeof reportingTo[0] === 'object' && reportingTo[0].name;
                      console.log('Is populated:', isPopulated, 'First item:', reportingTo[0]);

                      return (
                        <div className="space-y-2">
                          {isPopulated ? (
                            reportingTo.map((user: any, idx: number) => (
                              <div key={idx} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                  </svg>
                                </div>
                                <div className="flex-1">
                                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{user.name || 'Unknown'}</p>
                                  <p className="text-xs text-slate-500 dark:text-slate-400">{user.email || ''}</p>
                                </div>
                                {user.role && (
                                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                    {user.role}
                                  </span>
                                )}
                              </div>
                            ))
                          ) : (
                            // Fallback if not populated (show IDs)
                            reportingTo.map((id: any, idx: number) => (
                              <div key={idx} className="text-sm text-slate-600 dark:text-slate-400">
                                {typeof id === 'object' ? id._id || JSON.stringify(id) : id}
                              </div>
                            ))
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

              </div>
            </div>
          </div>
        )
      }

      {/* Left Date Modal */}
      {
        showLeftDateModal && selectedEmployeeForLeftDate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowLeftDateModal(false)} />
            <div className="relative z-50 w-full max-w-md rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950/95">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                    Resignation
                  </h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {selectedEmployeeForLeftDate.employee_name} ({selectedEmployeeForLeftDate.emp_no}) — Enter last working date and remarks. If resignation workflow is enabled in settings, the request will go through approval.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowLeftDateModal(false);
                    setSelectedEmployeeForLeftDate(null);
                    setLeftDateForm({ leftDate: '', leftReason: '' });
                  }}
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

              {success && (
                <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
                  {success}
                </div>
              )}

              <form onSubmit={handleSubmitLeftDate} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Last working date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    readOnly
                    value={leftDateForm.leftDate}
                    min={(() => {
                      const d = new Date();
                      d.setDate(d.getDate() + resignationNoticePeriodDays);
                      return d.toISOString().split('T')[0];
                    })()}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300 cursor-not-allowed"
                  />
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    This date will be recorded as the employee&apos;s last day in office. They will be included in pay register until this month, then excluded from future months.
                  </p>
                  {resignationNoticePeriodDays > 0 && (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                      Notice period: {resignationNoticePeriodDays} day(s). Last working date must be at least {resignationNoticePeriodDays} days from today.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Remarks for resignation (Optional)
                  </label>
                  <textarea
                    value={leftDateForm.leftReason}
                    onChange={(e) => setLeftDateForm({ ...leftDateForm, leftReason: e.target.value })}
                    rows={3}
                    placeholder="Enter remarks for resignation..."
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowLeftDateModal(false);
                      setSelectedEmployeeForLeftDate(null);
                      setLeftDateForm({ leftDate: '', leftReason: '' });
                    }}
                    className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-xl bg-gradient-to-r from-red-500 to-orange-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-red-500/30 transition-all hover:from-red-600 hover:to-orange-600"
                  >
                    Submit Resignation
                  </button>
                </div>
              </form>
            </div>
          </div>
        )
      }

      {/* Application View Dialog */}
      {viewingApplication && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setViewingApplication(null)} />
          <div className="relative z-50 max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950/95">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 uppercase tracking-tight">
                  {viewingApplication.employee_name}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <p className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                    ID: <span className="font-mono text-indigo-500">{viewingApplication._id}</span>
                  </p>
                  <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${viewingApplication.status === 'pending'
                    ? 'bg-amber-500/10 text-amber-500'
                    : viewingApplication.status === 'verified'
                      ? 'bg-indigo-500/10 text-indigo-500'
                      : 'bg-green-500/10 text-green-500'
                    }`}>
                    <LucideClock className="w-3 h-3" />
                    {viewingApplication.status}
                  </span>
                  {viewingApplication.verifiedBy && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-indigo-500">
                      <ShieldCheck className="w-3 h-3" />
                      Verified by {(viewingApplication.verifiedBy as any).name || viewingApplication.verifiedBy}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setViewingApplication(null)}
                className="rounded-xl border border-slate-200 bg-white p-2 text-slate-400 transition hover:border-red-200 hover:text-red-500 dark:border-slate-700 dark:bg-slate-900"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-6">
              {/* Basic Information */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50">
                <h3 className="mb-4 text-xs font-black text-slate-900 dark:text-slate-100 flex items-center gap-2 uppercase tracking-[0.2em]">
                  <Users className="w-4 h-4 text-indigo-500" />
                  Basic Information
                </h3>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Proposed ID</label>
                    <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100 uppercase">{viewingApplication.emp_no || '-'}</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Full Name</label>
                    <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100 uppercase">{viewingApplication.employee_name || '-'}</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Division</label>
                    <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100 uppercase">
                      {divisions.find(d => d._id === (getEntityId(viewingApplication.division_id) || getEntityId((viewingApplication as any).division)))?.name || (viewingApplication.division_id as any)?.name || (viewingApplication as any).division?.name || '-'}
                    </p>
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Department</label>
                    <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100 uppercase">
                      {departments.find(d => d._id === (getEntityId(viewingApplication.department_id) || getEntityId((viewingApplication as any).department)))?.name || (viewingApplication.department_id as any)?.name || (viewingApplication as any).department?.name || '-'}
                    </p>
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Designation</label>
                    <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100 uppercase">
                      {designations.find(d => d._id === (getEntityId(viewingApplication.designation_id) || getEntityId((viewingApplication as any).designation)))?.name || (viewingApplication.designation_id as any)?.name || (viewingApplication as any).designation?.name || '-'}
                    </p>
                  </div>
                  {customEmployeeGroupingEnabled && (
                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Group</label>
                      <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100 uppercase">
                        {employeeGroups.find(g => g._id === (getEntityId((viewingApplication as any).employee_group_id) || getEntityId((viewingApplication as any).employee_group)))?.name || ((viewingApplication as any).employee_group_id as any)?.name || (viewingApplication as any).employee_group?.name || '-'}
                      </p>
                    </div>
                  )}
                  {userRole !== 'hod' && (
                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Proposed Salary</label>
                      <p className="mt-1 text-sm font-black text-indigo-600 dark:text-indigo-400">₹{viewingApplication.proposedSalary?.toLocaleString() || '-'}</p>
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Experience</label>
                    <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100">{(viewingApplication as any).experience || 0} Years</p>
                  </div>
                </div>
              </div>

              {/* Personal Details */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50">
                <h3 className="mb-4 text-xs font-black text-slate-900 dark:text-slate-100 flex items-center gap-2 uppercase tracking-[0.2em]">
                  <Mail className="w-4 h-4 text-indigo-500" />
                  Personal & Contact Details
                </h3>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Email Address</label>
                    <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100">{(viewingApplication as any).email || '-'}</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Phone Number</label>
                    <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100">{(viewingApplication as any).phone_number || '-'}</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Gender</label>
                    <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100 uppercase">{(viewingApplication as any).gender || '-'}</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Date of Birth</label>
                    <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100">{(viewingApplication as any).dob ? new Date((viewingApplication as any).dob).toLocaleDateString() : '-'}</p>
                  </div>
                  {userRole !== 'hod' && (
                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Aadhar Number</label>
                      <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100 uppercase">{(viewingApplication as any).aadhar_number || '-'}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Qualifications */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50">
                <h3 className="mb-4 text-xs font-black text-slate-900 dark:text-slate-100 flex items-center gap-2 uppercase tracking-[0.2em]">
                  <ShieldCheck className="w-4 h-4 text-indigo-500" />
                  Qualifications
                </h3>
                <div className="space-y-3">
                  {(() => {
                    const quals = (viewingApplication as any).qualifications;
                    if (!quals || (Array.isArray(quals) && quals.length === 0)) {
                      return <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">No qualifications provided</p>;
                    }

                    if (Array.isArray(quals)) {
                      return (
                        <div className="grid gap-4 sm:grid-cols-2">
                          {quals.map((qual: any, idx: number) => {
                            const certificateUrl = qual.certificateUrl;
                            return (
                              <div key={idx} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 shadow-sm">
                                <div className="space-y-1">
                                  {Object.entries(qual).filter(([k]) => k !== 'certificateUrl').map(([k, v]) => (
                                    <div key={k} className="flex justify-between text-xs">
                                      <span className="text-slate-500 uppercase font-black text-[9px] tracking-wider">{k.replace(/_/g, ' ')}</span>
                                      <span className="font-bold text-slate-900 dark:text-slate-100">{String(v || '-')}</span>
                                    </div>
                                  ))}
                                </div>
                                {certificateUrl && (
                                  <a href={certificateUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-[10px] font-black text-indigo-500 uppercase tracking-widest hover:underline ring-1 ring-indigo-500/10 px-2 py-1 rounded-md bg-indigo-50/50">
                                    View Certificate →
                                  </a>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    }
                    return <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{String(quals)}</p>;
                  })()}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-8 flex gap-3 border-t border-slate-100 pt-6 dark:border-slate-800">
              {hasVerifyPermission && viewingApplication.status === 'pending' && (
                <button
                  onClick={() => {
                    handleVerifyApplication(viewingApplication);
                    setViewingApplication(null);
                  }}
                  className="flex-1 rounded-2xl bg-indigo-500 px-6 py-3 text-sm font-black uppercase tracking-[0.15em] text-white shadow-lg shadow-indigo-500/30 transition-all hover:scale-[1.02] active:scale-95"
                >
                  Verify Application
                </button>
              )}
              <button
                onClick={() => setViewingApplication(null)}
                className="flex-1 rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-black uppercase tracking-[0.15em] text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}
      <BankUpdateDialog
        isOpen={showBankUpdateDialog}
        onClose={() => setShowBankUpdateDialog(false)}
        employee={viewingEmployee}
        onSubmit={handleSubmitBankUpdate}
        submitting={submittingBankUpdate}
      />
      <EmployeeExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        empNo={selectedEmployeeForExport?.emp_no}
        employeeName={selectedEmployeeForExport?.employee_name}
        filters={{
          searchTerm,
          includeLeft: includeLeftEmployees,
          division_id: selectedDivision || (employeeFilters['division.name'] ? divisions.find((d) => d.name === employeeFilters['division.name'])?._id : undefined),
          department_id: employeeFilters['department.name'] ? departments.find((d) => d.name === employeeFilters['department.name'])?._id : undefined,
          designation_id: employeeFilters['designation.name'] ? designations.find((d) => d.name === employeeFilters['designation.name'])?._id : undefined,
          employee_group_id: employeeFilters['employee_group.name'] ? employeeGroups.find((g) => g.name === employeeFilters['employee_group.name'])?._id : undefined,
        }}
      />
    </div>
  );
}
