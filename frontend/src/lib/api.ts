import { auth } from './auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

// Workspace types - defined first as they're used in ApiResponse
export interface WorkspaceModule {
  moduleId: {
    _id: string;
    name: string;
    code: string;
    icon: string;
    route: string;
  };
  moduleCode: string;
  permissions: {
    canView?: boolean;
    canCreate?: boolean;
    canEdit?: boolean;
    canDelete?: boolean;
    canApprove?: boolean;
    canForward?: boolean;
    canExport?: boolean;
  };
  dataScope: 'own' | 'department' | 'assigned' | 'all';
  settings?: any;
  isEnabled: boolean;
  sortOrder: number;
}



export interface Workspace {
  _id: string;
  name: string;
  code: string;
  type: 'employee' | 'department' | 'hr' | 'subadmin' | 'superadmin' | 'custom';
  description?: string;
  theme?: {
    primaryColor?: string;
    icon?: string;
    layout?: string;
  };
  modules: WorkspaceModule[];
  defaultModuleCode?: string;
  role?: string;
  isPrimary?: boolean;
  scopeConfig?: {
    departments?: string[];
    allDepartments?: boolean;
    divisions?: string[];
    divisionMapping?: {
      division: string;
      departments: string[];
    }[];
  };
}

export type PayrollBatchStatus = 'pending' | 'approved' | 'freeze' | 'complete';

export interface BonusPolicy {
  _id: string;
  name: string;
  description?: string;
  policyType: 'attendance_regular' | 'payroll_based';
  salaryComponent: 'gross_salary' | 'fixed_amount';
  fixedBonusAmount?: number;
  grossSalaryMultiplier?: number;
  tiers: {
    minPercentage: number;
    maxPercentage: number;
    bonusPercentage: number;
  }[];
  isActive: boolean;
  createdAt: string;
}

export interface BonusBatch {
  _id: string;
  batchName: string;
  startMonth: string;
  endMonth: string;
  year: number;
  division?: { _id: string; name: string };
  department?: { _id: string; name: string };
  policy: { _id: string; name: string } | string;
  status: 'pending' | 'approved' | 'frozen';
  totalEmployees: number;
  totalBonusAmount: number;
  recalculationRequest?: {
    isRequested: boolean;
    reason: string;
    status: string;
    requestedBy: any;
    requestedAt: string;
  };
  createdBy?: any;
  approvedBy?: any;
  frozenBy?: any;
  createdAt: string;
}

export interface BonusRecord {
  _id: string;
  batchId: string;
  employeeId: { _id: string; employee_name: string; emp_no: string };
  emp_no: string;
  month: string;
  salaryComponentValue: number;
  attendancePercentage: number;
  attendanceDays: number;
  totalMonthDays: number;
  appliedTier?: {
    minPercentage: number;
    maxPercentage: number;
    bonusMultiplier: number;
  };
  calculatedBonus: number;
  finalBonus: number;
  isManualOverride: boolean;
  remarks?: string;
}

export interface RecalculationHistory {
  _id: string;
  recalculatedAt: string;
  recalculatedBy: {
    _id: string;
    name: string;
    email: string;
  };
  reason: string;
  previousSnapshot: any;
  changes: any[];
}

export interface PayrollBatch {
  id: string;
  _id: string;
  batchNumber: string;
  department: {
    _id: string;
    name: string;
    code: string;
  };
  month: string;
  year: number;
  monthNumber: number;
  division?: {
    _id: string;
    name: string;
    code: string;
  } | string;

  employeePayrolls: any[]; // Can be IDs or populated objects
  totalEmployees: number;

  totalGrossSalary: number;
  totalDeductions: number;
  totalNetSalary: number;
  totalArrears: number;

  status: PayrollBatchStatus;
  statusHistory: {
    status: PayrollBatchStatus;
    changedBy: any;
    changedAt: string;
    reason: string;
  }[];

  recalculationPermission?: {
    granted: boolean;
    grantedBy?: any;
    grantedAt?: string;
    expiresAt?: string;
    reason?: string;
    requestedBy?: any;
    requestedAt?: string;
  };

  recalculationHistory: RecalculationHistory[];

  validationStatus?: {
    allEmployeesCalculated: boolean;
    missingEmployees: string[];
    lastValidatedAt: string;
  };

  createdBy: any;
  approvedBy?: any;
  createdAt: string;
  updatedAt: string;

  // Virtuals
  monthName?: string;
}

/** Attendance deduction breakdown (late-in/early-out) */
export interface AttendanceDeductionBreakdown {
  lateInsCount?: number;
  earlyOutsCount?: number;
  combinedCount?: number;
  daysDeducted?: number;
  deductionType?: string | null;
  calculationMode?: string | null;
}

/** Payroll record / payslip attendance with late deduction clarity */
export interface PayrollAttendance {
  totalDaysInMonth?: number;
  presentDays?: number;
  paidLeaveDays?: number;
  odDays?: number;
  weeklyOffs?: number;
  holidays?: number;
  absentDays?: number;
  payableShifts?: number;
  extraDays?: number;
  totalPaidDays?: number;
  paidDays?: number;
  /** Days deducted due to late-in/early-out (attendance deduction) */
  attendanceDeductionDays?: number;
  /** Final paid days = total paid days minus attendance deduction days */
  finalPaidDays?: number;
  otHours?: number;
  otDays?: number;
  earnedSalary?: number;
}

/** Payroll record (from GET /payroll/record/:id) or payslip response */
export interface PayrollRecordResponse {
  _id: string;
  employeeId?: any;
  emp_no?: string;
  month?: string;
  monthName?: string;
  year?: number;
  monthNumber?: number;
  attendance?: PayrollAttendance;
  earnings?: any;
  deductions?: {
    attendanceDeduction?: number;
    attendanceDeductionBreakdown?: AttendanceDeductionBreakdown;
    permissionDeduction?: number;
    leaveDeduction?: number;
    totalOtherDeductions?: number;
    otherDeductions?: any[];
    totalDeductions?: number;
  };
  loanAdvance?: { totalEMI?: number; advanceDeduction?: number };
  netSalary?: number;
  status?: string;
  arrearsAmount?: number;
  roundOff?: number;
  /** Top-level: days deducted for late (from breakdown) */
  attendanceDeductionDays?: number;
  /** Top-level: final paid days after late deduction */
  finalPaidDays?: number;
}

/** Per-step component (allowance or deduction: fixed, percentage, or formula) */
export interface PayrollStepComponent {
  id: string;
  /** Reference to dynamic allowance/deduction master (AllowanceDeductionMaster) */
  masterId?: string | null;
  name?: string;
  type: 'fixed' | 'percentage' | 'formula';
  amount?: number;
  percentage?: number;
  base?: 'basic' | 'gross';
  /** Optional formula override for this component */
  formula?: string;
  order?: number;
}

/** Payroll configuration: calculation steps order + output/paysheet columns */
export interface PayrollConfigStep {
  id: string;
  type: string;
  label?: string;
  order: number;
  enabled: boolean;
  /** Optional formula for this step */
  formula?: string;
  /** Components (e.g. allowances in allowances step, deductions in other_deductions step) */
  components?: PayrollStepComponent[];
  config?: Record<string, unknown>;
}

export interface PayrollOutputColumn {
  header: string;
  source: 'field' | 'formula';
  field?: string;
  formula?: string;
  order?: number;
}

export interface PayrollConfig {
  _id?: string;
  enabled: boolean;
  steps: PayrollConfigStep[];
  outputColumns: PayrollOutputColumn[];
  /** Header of the output column whose value is used as paid days for statutory proration (e.g. "Paid Days", "Present days"). */
  statutoryProratePaidDaysColumnHeader?: string;
  /** Header of the output column whose value is used as total days in month for statutory proration. */
  statutoryProrateTotalDaysColumnHeader?: string;
  updatedAt?: string;
}

export interface StatutoryESI {
  enabled: boolean;
  employeePercent: number;
  employerPercent: number;
  wageBasePercentOfBasic: number;
  wageCeiling: number;
}
export interface StatutoryPF {
  enabled: boolean;
  employeePercent: number;
  employerPercent: number;
  wageCeiling: number;
  base: 'basic' | 'basic_da';
}
export interface ProfessionTaxSlab {
  min: number;
  max: number | null;
  amount: number;
}
export interface StatutoryProfessionTax {
  enabled: boolean;
  state: string;
  slabs: ProfessionTaxSlab[];
}
export interface StatutoryDeductionConfig {
  esi?: StatutoryESI;
  pf?: StatutoryPF;
  professionTax?: StatutoryProfessionTax;
  updatedAt?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  dataSource?: string;
  source?: string;
  jobId?: string;
  status?: string;
  pagination?: {
    total: number;
    totalPages: number;
    page: number;
    limit: number;
  };
  // Flat pagination fields for consistency
  total?: number;
  page?: number;
  totalPages?: number;
  count?: number;
  stats?: any;
  // For backward compatibility with various response formats
  durations?: any[];
  warnings?: string[];
  // For workspace responses
  workspaces?: Workspace[];
  activeWorkspace?: Workspace;
  workspace?: Workspace;
  qrSecret?: string;
  waitTime?: number;
  newPassword?: string;
  syncError?: any;
  identifier?: string;
  generatedPassword?: string;
}

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    roles: string[];
    department?: string;
    scope?: 'global' | 'restricted';
    departments?: { _id: string; name: string; code?: string }[];
    dataScope?: 'all' | 'division' | 'department' | 'own';
    allowedDivisions?: string[];
    divisionMapping?: {
      division: string;
      departments: string[];
    }[];
  };
  workspaces?: Workspace[];
  activeWorkspace?: Workspace;
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Merge existing headers if any
  if (options.headers) {
    const existingHeaders = options.headers as Record<string, string>;
    Object.assign(headers, existingHeaders);
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  try {
    const url = `${API_BASE_URL}${endpoint}`;
    // console.log(`[API Request] ${options.method || 'GET'} ${url}`, options.body instanceof FormData ? 'FormData' : (options.body ? JSON.parse(options.body as string) : ''));


    const response = await fetch(url, {
      ...options,
      headers,
    });

    const data = await response.json();
    console.log(`[API Response] ${response.status} ${url}`, data);

    if (!response.ok) {
      // Handle unauthorized (expired token)
      if (response.status === 401 && !endpoint.includes('/auth/login')) {
        console.warn(`[API 401] Unauthorized access to ${endpoint}. Triggering logout.`);
        auth.logout();
      }

      return {
        success: false,
        message: data.message || 'An error occurred',
        error: data.error || data.message || `HTTP ${response.status}`,
      };
    }

    return {
      success: true,
      ...data,
    };
  } catch (error) {
    console.error(`[API Error] ${options.method || 'GET'} ${API_BASE_URL}${endpoint}`, error);
    const errorMessage = error instanceof Error ? error.message : 'Network error occurred';
    const isNetworkError = errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError');

    return {
      success: false,
      message: isNetworkError
        ? 'Unable to connect to server. Please check your network connection and ensure the backend is running.'
        : errorMessage,
      error: errorMessage,
    };
  }
}

// Timeout wrapper for long-running operations
async function apiRequestWithTimeout<T>(
  endpoint: string,
  options: RequestInit = {},
  timeoutMs: number = 60000 // 60 seconds default
): Promise<ApiResponse<T>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await apiRequest<T>(endpoint, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return {
        success: false,
        message: 'Request timed out. The operation is taking longer than expected. Please check the server logs.',
        error: 'Request timeout',
      };
    }
    throw error;
  }
}


export interface Shift {
  _id: string;
  name: string;
  startTime: string;
  endTime: string;
  duration: number;
  code?: string;
  payableShifts?: number;
  isActive?: boolean;
  color?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Setting {
  _id: string;
  key: string;
  value: any;
  description?: string;
  category: string;
}

export interface Designation {
  _id: string;
  name: string;
  code: string;
  description?: string;
  department?: string | Department;
  shifts?: (string | Shift)[];
  divisionDefaults?: { division: string | Division; shifts: (string | Shift)[] }[];
  departmentShifts?: Array<{
    division?: string | Division;
    department: string | Department | { _id: string; name: string; code?: string };
    shifts: (string | Shift)[];
    _id?: string;
  }>;
  paidLeaves?: number;
  deductionRules?: any[];
  isActive?: boolean;
}

export interface Department {
  _id: string;
  name: string;
  code?: string;
  description?: string;
  hod?: any;
  divisionHODs?: {
    division: Division | string;
    hod: any; // User object
  }[];
  hr?: any;
  attendanceConfig: {
    lateInLimit: number;
    earlyOutLimit: number;
    lateInGraceTime: number;
    earlyOutGraceTime: number;
  };
  permissionPolicy: {
    dailyLimit: number;
    monthlyLimit: number;
    deductFromSalary: boolean;
    deductionAmount: number;
  };
  autoDeductionRules: Array<{
    trigger: 'late_in' | 'early_out' | 'permission';
    count: number;
    action: 'half_day' | 'full_day' | 'deduct_amount';
    amount?: number;
  }>;
  shifts?: (string | Shift)[];
  paidLeaves?: number;
  leaveLimits?: {
    casual: number;
    sick: number;
    earned: number;
  };
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
  divisions?: (string | Division)[];
  designations?: (string | Designation)[];
  divisionDefaults?: { division: string | Division; shifts: (string | Shift)[] }[];
}

export interface Division {
  _id: string;
  name: string;
  code: string;
  description?: string;
  manager?: { _id: string; name: string; email: string };
  departments?: (string | Department)[];
  shifts?: (string | Shift)[];
  isActive?: boolean;
}

export type DataScope = 'own' | 'department' | 'departments' | 'division' | 'divisions' | 'all';

export interface User {
  _id: string;
  email: string;
  name: string;
  role: string;
  roles: string[];
  department?: any;
  departmentType?: 'single' | 'multiple';
  departments?: any[];
  employeeId?: string;
  employeeRef?: any;
  dataScope?: DataScope;
  allowedDivisions?: any[];
  divisionMapping?: any[];
  isActive: boolean;
  featureControl?: string[];
  lastLogin?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Employee {
  _id: string;
  emp_no: string;
  employee_name: string;
  division_id?: any;
  department_id?: any;
  designation_id?: any;
  doj?: string;
  dob?: string;
  gross_salary?: number;
  gender?: string;
  marital_status?: string;
  blood_group?: string;
  qualifications?: any;
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
  salary_mode?: 'Bank' | 'Cash';
  second_salary?: number;
  paidLeaves?: number;
  casualLeaves?: number;
  allottedLeaves?: number;
  employeeAllowances?: any[];
  employeeDeductions?: any[];
  ctcSalary?: number;
  calculatedSalary?: number;
  dynamicFields?: any;
  is_active: boolean;
  leftDate?: string;
  leftReason?: string;
  created_at?: string;
  updated_at?: string;
  salaryStatus?: 'pending_approval' | 'approved';
  qualificationStatus?: string;
  // Populated fields (from virtuals or population)
  department?: any;
  division?: any;
  designation?: any;
  profilePhoto?: string;
}

export interface Allowance {
  _id?: string;
  name: string;
  amount: number;
  type: string;
  masterId?: string;
  code?: string;
  category?: 'allowance';
  basedOnPresentDays?: boolean;
}

export interface Deduction {
  _id?: string;
  name: string;
  amount: number;
  type: string;
  masterId?: string;
  code?: string;
  category?: 'deduction';
  basedOnPresentDays?: boolean;
}

export interface EmployeeApplication extends Partial<Employee> {
  _id: string;
  proposedSalary: number;
  approvedSalary?: number;
  status: 'pending' | 'verified' | 'approved' | 'rejected';
  createdBy?: { _id: string; name: string; email: string };
  verifiedBy?: { _id: string; name: string; email: string };
  approvedBy?: { _id: string; name: string; email: string };
  rejectedBy?: { _id: string; name: string; email: string };
  approvalComments?: string;
  rejectionComments?: string;
  created_at?: string;
  verifiedAt?: string;
  approvedAt?: string;
  rejectedAt?: string;
  employeeAllowances?: (Allowance & { overrideAmount?: number })[];
  employeeDeductions?: (Deduction & { overrideAmount?: number })[];
}

export interface LiveAttendanceEmployee {
  id: string;
  empNo: string;
  name: string;
  department: string;
  designation: string;
  division: string;
  shift: string;
  shiftStartTime: string | null;
  shiftEndTime: string | null;
  inTime: string;
  outTime: string | null;
  status: string;
  date: string;
  hoursWorked: number;
  isLate: boolean;
  lateMinutes: number;
  isEarlyOut: boolean;
  earlyOutMinutes: number;
  otHours: number;
  extraHours: number;
}

export interface ShiftStat {
  name: string;
  working: number;
  completed: number;
}

export interface DepartmentStat {
  id: string;
  name: string;
  divisionId: string;
  divisionName: string;
  totalEmployees: number;
  working: number;
  completed: number;
  present: number;
  absent: number;
}

export interface LiveAttendanceReportData {
  date: string;
  summary: {
    currentlyWorking: number;
    completedShift: number;
    totalPresent: number;
    totalActiveEmployees: number;
    absentEmployees: number;
    shiftBreakdown: ShiftStat[];
    departmentBreakdown: DepartmentStat[];
  };
  currentlyWorking: LiveAttendanceEmployee[];
  completedShift: LiveAttendanceEmployee[];
}

export interface LiveAttendanceFilterOption {
  id: string;
  name: string;
}

export interface HolidayGroup {
  _id: string;
  name: string;
  description?: string;
  divisionMapping: {
    division: string | Division; // ID or Populated
    departments: (string | Department)[]; // IDs or Populated
  }[];
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
}

export interface Holiday {
  _id: string;
  name: string;
  date: string; // ISO Date string
  endDate?: string; // Optional end date
  type: 'National' | 'Regional' | 'Optional' | 'Company' | 'Academic' | 'Observance' | 'Seasonal';
  isMaster: boolean;
  scope: 'GLOBAL' | 'GROUP';
  applicableTo?: 'ALL' | 'SPECIFIC_GROUPS';
  targetGroupIds?: (string | HolidayGroup)[];
  groupId?: string | HolidayGroup;
  overridesMasterId?: string | Holiday;
  description?: string;
  sourceHolidayId?: string | Holiday; // For propagated copies
  isSynced?: boolean; // True if synced with global, false if edited
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export const api = {
  login: async (identifier: string, password: string) => {
    return apiRequest<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, email: identifier, password }),
    });
  },

  /** SSO login: exchange external token for HRMS session (same response shape as login). */
  ssoLogin: async (encryptedToken: string) => {
    return apiRequest<LoginResponse>('/auth/sso-login', {
      method: 'POST',
      body: JSON.stringify({ encryptedToken }),
    });
  },
  // Payroll include-missing setting (global)
  getIncludeMissingSetting: async () => {
    return apiRequest<Setting>('/settings/include_missing_employee_components', { method: 'GET' });
  },
  saveIncludeMissingSetting: async (value: boolean) => {
    return apiRequest<Setting>('/settings', {
      method: 'POST',
      body: JSON.stringify({
        key: 'include_missing_employee_components',
        value,
        category: 'payroll',
        description: 'Include Missing Allowances & Deductions for Employees',
      }),
    });
  },

  getAbsentDeductionSettings: async () => {
    const [enableRes, lopRes] = await Promise.all([
      apiRequest<Setting>('/settings/enable_absent_deduction', { method: 'GET' }),
      apiRequest<Setting>('/settings/lop_days_per_absent', { method: 'GET' })
    ]);
    return {
      enable: enableRes.success ? !!enableRes.data?.value : false,
      lopDays: lopRes.success ? Number(lopRes.data?.value) : 1
    };
  },

  saveAbsentDeductionSettings: async (enable: boolean, lopDays: number) => {
    return Promise.all([
      apiRequest<Setting>('/settings', {
        method: 'POST',
        body: JSON.stringify({
          key: 'enable_absent_deduction',
          value: enable,
          category: 'payroll'
        }),
      }),
      apiRequest<Setting>('/settings', {
        method: 'POST',
        body: JSON.stringify({
          key: 'lop_days_per_absent',
          value: lopDays,
          category: 'payroll'
        }),
      })
    ]);
  },

  // Employee allowance/deduction defaults (resolved with includeMissing)
  getEmployeeComponentDefaults: async (params: { departmentId: string; grossSalary: number; empNo?: string }) => {
    const searchParams = new URLSearchParams();
    searchParams.set('departmentId', params.departmentId);
    searchParams.set('grossSalary', String(params.grossSalary));
    if (params.empNo) searchParams.set('empNo', params.empNo);
    return apiRequest<any>(`/employees/components/defaults?${searchParams.toString()}`, { method: 'GET' });
  },

  // Get current user profile
  getCurrentUser: async () => {
    return apiRequest<{
      user: {
        _id: string;
        name: string;
        email: string;
        role: string;
        roles: string[];
        department?: { _id: string; name: string };
        employeeId?: string;
        employeeRef?: string;
        phone?: string;
        isActive: boolean;
        createdAt: string;
        lastLogin?: string;
      };
      workspaces: any[];
      activeWorkspace: any;
    }>('/auth/me', { method: 'GET' });
  },

  // Change password
  changePassword: async (currentPassword: string, newPassword: string) => {
    return apiRequest<{ message: string }>('/auth/change-password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },

  // Update user profile
  updateProfile: async (data: { name?: string; phone?: string; profilePhoto?: string }) => {
    return apiRequest<any>('/users/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // Holidays
  getAllHolidaysAdmin: async (year?: number) => {
    const query = year ? `?year=${year}` : '';
    return apiRequest<{ holidays: Holiday[]; groups: HolidayGroup[] }>(`/holidays/admin${query}`, { method: 'GET' });
  },

  getMyHolidays: async (year?: number) => {
    const query = year ? `?year=${year}` : '';
    return apiRequest<Holiday[]>(`/holidays/my${query}`, { method: 'GET' });
  },

  saveHolidayGroup: async (data: Partial<HolidayGroup>) => {
    return apiRequest<HolidayGroup>('/holidays/groups', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  deleteHolidayGroup: async (id: string) => {
    return apiRequest<void>(`/holidays/groups/${id}`, { method: 'DELETE' });
  },

  saveHoliday: async (data: Partial<Holiday>) => {
    return apiRequest<Holiday>('/holidays', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  createHoliday: async (data: Partial<Holiday>) => {
    return apiRequest<Holiday>('/holidays', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateHoliday: async (data: Partial<Holiday>) => {
    return apiRequest<Holiday>('/holidays', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  deleteHoliday: async (id: string) => {
    return apiRequest<void>(`/holidays/${id}`, { method: 'DELETE' });
  },

  // Shifts
  getShifts: async (isActive?: boolean) => {
    const query = isActive !== undefined ? `?isActive=${String(isActive)}` : '';
    return apiRequest<Shift[]>(`/shifts${query}`, { method: 'GET' });
  },

  getShift: async (id: string) => {
    return apiRequest<Shift>(`/shifts/${id}`, { method: 'GET' });
  },

  createShift: async (data: { name: string; startTime?: string; endTime?: string; duration?: number }) => {
    return apiRequest<Shift>('/shifts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateShift: async (id: string, data: Partial<Shift>) => {
    return apiRequest<Shift>(`/shifts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  deleteShift: async (id: string) => {
    return apiRequest<void>(`/shifts/${id}`, { method: 'DELETE' });
  },

  getAllowedDurations: async () => {
    return apiRequest<{ data: number[]; durations: any[] }>('/shifts/durations', { method: 'GET' });
  },

  // Shift Durations
  getShiftDurations: async () => {
    return apiRequest<{ success: boolean; count: number; data: number[]; durations: any[] }>('/shifts/durations/all', { method: 'GET' });
  },

  createShiftDuration: async (data: { duration: number; label?: string }) => {
    return apiRequest<any>('/shifts/durations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateShiftDuration: async (id: string, data: { duration?: number; label?: string; isActive?: boolean }) => {
    return apiRequest<any>(`/shifts/durations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  deleteShiftDuration: async (id: string) => {
    return apiRequest<void>(`/shifts/durations/${id}`, { method: 'DELETE' });
  },

  // Users
  getUsers: async (filters?: { role?: string; department?: string; isActive?: boolean; search?: string; page?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.role) params.append('role', filters.role);
    if (filters?.department) params.append('department', filters.department);
    if (filters?.isActive !== undefined) params.append('isActive', String(filters.isActive));
    if (filters?.search) params.append('search', filters.search);
    if (filters?.page) params.append('page', String(filters.page));
    if (filters?.limit) params.append('limit', String(filters.limit));
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<any>(`/users${query}`, { method: 'GET' });
  },

  getUser: async (id: string) => {
    return apiRequest<any>(`/users/${id}`, { method: 'GET' });
  },

  getUserStats: async () => {
    return apiRequest<any>('/users/stats', { method: 'GET' });
  },

  getDashboardStats: async () => {
    return apiRequest<any>('/dashboard/stats', { method: 'GET' });
  },

  getDashboardAnalytics: async () => {
    return apiRequest<any>('/dashboard/analytics', { method: 'GET' });
  },

  getEmployeesWithoutAccount: async () => {
    return apiRequest<any>('/users/employees-without-account', { method: 'GET' });
  },

  createUser: async (data: {
    email: string;
    password?: string;
    name: string;
    role: string;
    roles?: string[];
    department?: string;
    departments?: string[];
    employeeId?: string;
    autoGeneratePassword?: boolean;
    assignWorkspace?: boolean;
    scope?: 'global' | 'restricted';
  }) => {
    return apiRequest<any>('/users/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  createUserFromEmployee: async (data: {
    employeeId: string;
    email?: string;
    password?: string;
    role: string;
    roles?: string[];
    departments?: string[];
    autoGeneratePassword?: boolean;
    scope?: 'global' | 'restricted';
  }) => {
    return apiRequest<any>('/users/from-employee', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateUser: async (id: string, data: any) => {
    return apiRequest<any>(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  resetUserPassword: async (id: string, data: { newPassword?: string; autoGenerate?: boolean }) => {
    return apiRequest<any>(`/users/${id}/reset-password`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  toggleUserStatus: async (id: string) => {
    return apiRequest<any>(`/users/${id}/toggle-status`, { method: 'PUT' });
  },

  deleteUser: async (id: string) => {
    return apiRequest<any>(`/users/${id}`, { method: 'DELETE' });
  },

  // Departments
  getDepartments: async (isActive?: boolean, divisionId?: string) => {
    const params = new URLSearchParams();
    if (isActive !== undefined) params.append('isActive', String(isActive));
    if (divisionId) params.append('division', divisionId);
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<Department[]>(`/departments${query}`, { method: 'GET' });
  },

  getDepartment: async (id: string) => {
    return apiRequest<Department>(`/departments/${id}`, { method: 'GET' });
  },

  getDepartmentEmployees: async (id: string) => {
    return apiRequest<any[]>(`/departments/${id}/employees`, { method: 'GET' });
  },

  createDepartment: async (data: Partial<Department>) => {
    return apiRequest<Department>('/departments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Divisions


  // Divisions
  getDivisions: async (isActive?: boolean, divisionId?: string) => {
    const params = new URLSearchParams();
    if (isActive !== undefined) params.append('isActive', String(isActive));
    if (divisionId) params.append('division', divisionId);
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<Division[]>(`/divisions${query}`, { method: 'GET' });
  },

  getDivision: async (id: string) => {
    return apiRequest<Division>(`/divisions/${id}`, { method: 'GET' });
  },

  createDivision: async (data: Partial<Division>) => {
    return apiRequest<Division>('/divisions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateDivision: async (id: string, data: Partial<Division>) => {
    return apiRequest<Division>(`/divisions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  deleteDivision: async (id: string) => {
    return apiRequest<void>(`/divisions/${id}`, { method: 'DELETE' });
  },

  linkDepartmentsToDivision: async (id: string, data: { departmentIds: string[]; action: 'link' | 'unlink' }) => {
    return apiRequest<any>(`/divisions/${id}/departments`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  assignShiftsToDivision: async (id: string, data: { shifts: (string | { shiftId: string; gender: string })[]; targetType: string; targetId?: string | { designationId: string; departmentId: string } }) => {
    return apiRequest<any>(`/divisions/${id}/shifts`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateDepartment: async (id: string, data: Partial<Department>) => {
    return apiRequest<Department>(`/departments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  deleteDepartment: async (id: string) => {
    return apiRequest<void>(`/departments/${id}`, { method: 'DELETE' });
  },

  // Department Settings
  getDepartmentSettings: async (deptId: string, divisionId?: string) => {
    let url = `/departments/${deptId}/settings`;
    if (divisionId) url += `?divisionId=${divisionId}`;
    return apiRequest<any>(url, { method: 'GET' });
  },

  // Bulk Allowance & Deduction
  downloadAllowanceDeductionTemplate: async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const response = await fetch(`${API_BASE_URL}/allowances-deductions/template`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Download failed');
    }

    return response.blob();
  },

  bulkUpdateAllowancesDeductions: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiRequest<any>('/allowances-deductions/bulk-update', {
      method: 'POST',
      body: formData,
    });
  },

  updateDepartmentSettings: async (deptId: string, data: {
    leaves?: {
      leavesPerDay?: number | null;
      paidLeavesCount?: number | null;
      dailyLimit?: number | null;
      monthlyLimit?: number | null;
    };
    loans?: {
      interestRate?: number | null;
      isInterestApplicable?: boolean | null;
      minTenure?: number | null;
      maxTenure?: number | null;
      minAmount?: number | null;
      maxAmount?: number | null;
      maxPerEmployee?: number | null;
      maxActivePerEmployee?: number | null;
      minServicePeriod?: number | null;
    };
    salaryAdvance?: {
      interestRate?: number | null;
      isInterestApplicable?: boolean | null;
      minTenure?: number | null;
      maxTenure?: number | null;
      minAmount?: number | null;
      maxAmount?: number | null;
      maxPerEmployee?: number | null;
      maxActivePerEmployee?: number | null;
      minServicePeriod?: number | null;
    };
    permissions?: {
      perDayLimit?: number | null;
      monthlyLimit?: number | null;
      deductFromSalary?: boolean | null;
      deductionAmount?: number | null;
    };
  }, divisionId?: string) => {
    let url = `/departments/${deptId}/settings`;
    if (divisionId) url += `?divisionId=${divisionId}`;
    return apiRequest<any>(url, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  getResolvedDepartmentSettings: async (deptId: string, type?: 'leaves' | 'loans' | 'salary_advance' | 'permissions' | 'ot' | 'overtime' | 'all', divisionId?: string) => {
    let query = type ? `?type=${type}` : '';
    if (divisionId) query += `${query ? '&' : '?'}divisionId=${divisionId}`;
    return apiRequest<any>(`/departments/${deptId}/settings/resolved${query}`, { method: 'GET' });
  },

  assignHOD: async (id: string, hodId: string, divisionId: string) => {
    return apiRequest<Department>(`/departments/${id}/assign-hod`, {
      method: 'PUT',
      body: JSON.stringify({ hodId, divisionId }),
    });
  },

  assignHR: async (id: string, hrId: string) => {
    return apiRequest<Department>(`/departments/${id}/assign-hr`, {
      method: 'PUT',
      body: JSON.stringify({ hrId }),
    });
  },

  assignShifts: async (id: string, shiftIds: (string | { shiftId: string; gender: string })[]) => {
    return apiRequest<Department>(`/departments/${id}/shifts`, {
      method: 'PUT',
      body: JSON.stringify({ shiftIds }),
    });
  },

  // Designations
  // Global designation endpoints (independent of department)
  getAllDesignations: async (isActive?: boolean) => {
    const query = isActive !== undefined ? `?isActive=${isActive}` : '';
    return apiRequest<any[]>(`/departments/designations${query}`, { method: 'GET' });
  },

  createGlobalDesignation: async (data: any) => {
    return apiRequest<any>('/departments/designations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Department-specific designation endpoints
  getDesignations: async (departmentId: string) => {
    return apiRequest<any[]>(`/departments/${departmentId}/designations`, { method: 'GET' });
  },

  getDesignation: async (id: string) => {
    return apiRequest<any>(`/departments/designations/${id}`, { method: 'GET' });
  },

  createDesignation: async (departmentId: string, data: any) => {
    return apiRequest<any>(`/departments/${departmentId}/designations`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateDesignation: async (id: string, data: any) => {
    return apiRequest<any>(`/departments/designations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  deleteDesignation: async (id: string) => {
    return apiRequest<void>(`/departments/designations/${id}`, { method: 'DELETE' });
  },

  assignShiftsToDesignation: async (id: string, shiftIds: (string | { shiftId: string; gender: string })[], departmentId?: string) => {
    return apiRequest<any>(`/departments/designations/${id}/shifts`, {
      method: 'PUT',
      body: JSON.stringify({ shiftIds, departmentId }),
    });
  },

  linkDesignationToDepartment: async (departmentId: string, designationId: string) => {
    return apiRequest<any>(`/departments/${departmentId}/designations/link`, {
      method: 'POST',
      body: JSON.stringify({ designationId }),
    });
  },

  // Settings
  getSettings: async (category?: string) => {
    const query = category ? `?category=${category}` : '';
    return apiRequest<Setting[]>(`/settings${query}`, { method: 'GET' });
  },

  getSetting: async (key: string) => {
    return apiRequest<Setting>(`/settings/${key}`, { method: 'GET' });
  },

  upsertSetting: async (data: { key: string; value: any; description?: string; category?: string }) => {
    return apiRequest<Setting>('/settings', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Permission Deduction Settings
  getPermissionDeductionSettings: async () => {
    return apiRequest<any>('/permissions/settings/deduction', { method: 'GET' });
  },

  savePermissionDeductionSettings: async (data: any) => {
    return apiRequest<any>('/permissions/settings/deduction', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Attendance Deduction Settings
  getAttendanceDeductionSettings: async () => {
    return apiRequest<any>('/attendance/settings/deduction', { method: 'GET' });
  },

  saveAttendanceDeductionSettings: async (data: { deductionRules: any }) => {
    return apiRequest<any>('/attendance/settings/deduction', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Early-Out Settings
  getEarlyOutSettings: async () => {
    return apiRequest<any>('/attendance/settings/early-out', { method: 'GET' });
  },

  saveEarlyOutSettings: async (data: { isEnabled?: boolean; allowedDurationMinutes?: number; minimumDuration?: number; deductionRanges?: any[] }) => {
    return apiRequest<any>('/attendance/settings/early-out', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  addEarlyOutRange: async (data: { minMinutes: number; maxMinutes: number; deductionType: string; deductionAmount?: number; description?: string }) => {
    return apiRequest<any>('/attendance/settings/early-out/ranges', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateEarlyOutRange: async (rangeId: string, data: { minMinutes?: number; maxMinutes?: number; deductionType?: string; deductionAmount?: number; description?: string }) => {
    return apiRequest<any>(`/attendance/settings/early-out/ranges/${rangeId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  deleteEarlyOutRange: async (rangeId: string) => {
    return apiRequest<any>(`/attendance/settings/early-out/ranges/${rangeId}`, {
      method: 'DELETE',
    });
  },

  updateSetting: async (key: string, data: { value: any; description?: string; category?: string }) => {
    return apiRequest<Setting>(`/settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // Employees
  getEmployees: async (filters?: { is_active?: boolean; department_id?: string; division_id?: string; designation_id?: string; includeLeft?: boolean; search?: string; page?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.is_active !== undefined) params.append('is_active', String(filters.is_active));
    if (filters?.department_id) params.append('department_id', filters.department_id);
    if (filters?.division_id) params.append('division_id', filters.division_id);
    if (filters?.designation_id) params.append('designation_id', filters.designation_id);
    if (filters?.includeLeft !== undefined) params.append('includeLeft', String(filters.includeLeft));
    if (filters?.search) params.append('search', filters.search);
    if (filters?.page) params.append('page', String(filters.page));
    if (filters?.limit) params.append('limit', String(filters.limit));
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<any>(`/employees${query}`, { method: 'GET' });
  },

  getEmployee: async (empNo: string) => {
    return apiRequest<any>(`/employees/${empNo}`, { method: 'GET' });
  },

  getEmployeeHistory: async (empNo: string) => {
    return apiRequest<any>(`/employees/${empNo}/history`, { method: 'GET' });
  },

  createEmployee: async (data: any) => {
    return apiRequest<any>('/employees', {
      method: 'POST',
      body: data instanceof FormData ? data : JSON.stringify(data),
    });
  },

  updateEmployee: async (empNo: string, data: any) => {
    return apiRequest<any>(`/employees/${empNo}`, {
      method: 'PUT',
      body: data instanceof FormData ? data : JSON.stringify(data),
    });
  },

  // Set employee left date (deactivate)
  setEmployeeLeftDate: async (empNo: string, leftDate: string, leftReason?: string) => {
    return apiRequest<any>(`/employees/${empNo}/left-date`, {
      method: 'PUT',
      body: JSON.stringify({ leftDate, leftReason }),
    });
  },

  // Remove employee left date (reactivate)
  removeEmployeeLeftDate: async (empNo: string) => {
    return apiRequest<any>(`/employees/${empNo}/left-date`, {
      method: 'DELETE',
    });
  },

  // Resend credentials
  resendEmployeeCredentials: async (empNo: string, data: { notificationChannels?: any }) => {
    return apiRequest<any>(`/employees/${empNo}/resend-credentials`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Reset credentials
  resetEmployeeCredentials: async (empNo: string, data?: { passwordMode?: string; customPassword?: string }) => {
    return apiRequest<any>(`/employees/${empNo}/reset-credentials`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  },

  // Bulk resend credentials
  bulkResendCredentials: async (filters: { search?: string; divisionId?: string; departmentId?: string; designationId?: string; includeLeft?: string }) => {
    return apiRequest<any>('/employees/bulk-resend-credentials', {
      method: 'POST',
      body: JSON.stringify(filters),
    });
  },

  // Bulk export passwords
  bulkExportEmployeePasswords: async (data: { empNos?: string[]; passwordMode: string }) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const response = await fetch(`${API_BASE_URL}/employees/bulk-export-passwords`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Export failed');
    return response.blob();
  },

  // Employee Applications
  createEmployeeApplication: async (data: any) => {
    return apiRequest<any>('/employee-applications', {
      method: 'POST',
      body: data instanceof FormData ? data : JSON.stringify(data),
    });
  },

  bulkCreateEmployeeApplications: async (data: any[]) => {
    return apiRequest<any>('/employee-applications/bulk', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateEmployeeApplication: async (id: string, data: any) => {
    return apiRequest<any>(`/employee-applications/${id}`, {
      method: 'PUT',
      body: data instanceof FormData ? data : JSON.stringify(data),
    });
  },

  getEmployeeApplications: async (params?: {
    status?: string;
    division_id?: string;
    department_id?: string;
    designation_id?: string;
    search?: string;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.division_id) searchParams.set('division_id', params.division_id);
    if (params?.department_id) searchParams.set('department_id', params.department_id);
    if (params?.designation_id) searchParams.set('designation_id', params.designation_id);
    if (params?.search?.trim()) searchParams.set('search', params.search.trim());
    const query = searchParams.toString() ? `?${searchParams.toString()}` : '';
    return apiRequest<any[]>(`/employee-applications${query}`, { method: 'GET' });
  },

  getEmployeeApplication: async (id: string) => {
    return apiRequest<any>(`/employee-applications/${id}`, { method: 'GET' });
  },

  approveEmployeeApplication: async (id: string, data: { approvedSalary?: number; doj?: string; comments?: string; qualificationStatus?: string; paidLeaves?: number; casualLeaves?: number; employeeAllowances?: any[]; employeeDeductions?: any[]; ctcSalary?: number; calculatedSalary?: number }) => {
    return apiRequest<any>(`/employee-applications/${id}/approve`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  verifyEmployeeApplication: async (id: string) => {
    return apiRequest<any>(`/employee-applications/${id}/verify`, {
      method: 'PUT',
    });
  },

  approveEmployeeSalary: async (id: string, data: { approvedSalary?: number; doj?: string; comments?: string; second_salary?: number; qualificationStatus?: string; paidLeaves?: number; casualLeaves?: number; employeeAllowances?: any[]; employeeDeductions?: any[]; ctcSalary?: number; calculatedSalary?: number }) => {
    return apiRequest<any>(`/employee-applications/${id}/approve-salary`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  rejectEmployeeApplication: async (id: string, data: { comments?: string }) => {
    return apiRequest<any>(`/employee-applications/${id}/reject`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  bulkApproveEmployeeApplications: async (applicationIds: string[], bulkSettings: any) => {
    // Use timeout for bulk operations - allow up to 2 minutes for large batches
    const timeoutMs = Math.max(60000, applicationIds.length * 500); // At least 60s, or 500ms per application
    return apiRequestWithTimeout<any>('/employee-applications/bulk-approve', {
      method: 'PUT',
      body: JSON.stringify({ applicationIds, bulkSettings }),
    }, timeoutMs);
  },

  bulkRejectEmployeeApplications: async (applicationIds: string[], comments?: string) => {
    return apiRequest<any>('/employee-applications/bulk-reject', {
      method: 'PUT',
      body: JSON.stringify({ applicationIds, comments }),
    });
  },

  // Employee Application Form Settings
  getFormSettings: async () => {
    return apiRequest<any>('/employee-applications/form-settings', { method: 'GET' });
  },
  initializeFormSettings: async () => {
    return apiRequest<any>('/employee-applications/form-settings/initialize', {
      method: 'POST',
    });
  },
  updateFormSettings: async (data: any) => {
    return apiRequest<any>('/employee-applications/form-settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
  addFormGroup: async (data: any) => {
    return apiRequest<any>('/employee-applications/form-settings/groups', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  updateFormGroup: async (groupId: string, data: any) => {
    return apiRequest<any>(`/employee-applications/form-settings/groups/${groupId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
  deleteFormGroup: async (groupId: string) => {
    return apiRequest<any>(`/employee-applications/form-settings/groups/${groupId}`, {
      method: 'DELETE',
    });
  },
  addFormField: async (groupId: string, data: any) => {
    return apiRequest<any>(`/employee-applications/form-settings/groups/${groupId}/fields`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  updateFormField: async (groupId: string, fieldId: string, data: any) => {
    return apiRequest<any>(`/employee-applications/form-settings/groups/${groupId}/fields/${fieldId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
  deleteFormField: async (groupId: string, fieldId: string) => {
    return apiRequest<any>(`/employee-applications/form-settings/groups/${groupId}/fields/${fieldId}`, {
      method: 'DELETE',
    });
  },
  reorderFormGroups: async (groupIds: string[]) => {
    return apiRequest<any>('/employee-applications/form-settings/reorder-groups', {
      method: 'PUT',
      body: JSON.stringify({ groupIds }),
    });
  },
  reorderFormFields: async (groupId: string, fieldIds: string[]) => {
    return apiRequest<any>(`/employee-applications/form-settings/groups/${groupId}/reorder-fields`, {
      method: 'PUT',
      body: JSON.stringify({ fieldIds }),
    });
  },

  // Qualifications management
  updateQualificationsConfig: async (config: { isEnabled?: boolean; enableCertificateUpload?: boolean; defaultRows?: Record<string, unknown>[] }) => {
    return apiRequest<any>('/employee-applications/form-settings/qualifications', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },
  addQualificationsField: async (data: {
    id: string;
    label: string;
    type: string;
    isRequired?: boolean;
    isEnabled?: boolean;
    placeholder?: string;
    validation?: any;
    options?: Array<{ label: string; value: string }>;
    order?: number;
  }) => {
    return apiRequest<any>('/employee-applications/form-settings/qualifications/fields', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  updateQualificationsField: async (fieldId: string, data: {
    label?: string;
    type?: string;
    isRequired?: boolean;
    isEnabled?: boolean;
    placeholder?: string;
    validation?: any;
    options?: Array<{ label: string; value: string }>;
    order?: number;
  }) => {
    return apiRequest<any>(`/employee-applications/form-settings/qualifications/fields/${fieldId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
  deleteQualificationsField: async (fieldId: string) => {
    return apiRequest<any>(`/employee-applications/form-settings/qualifications/fields/${fieldId}`, {
      method: 'DELETE',
    });
  },
  reorderQualificationsFields: async (fieldIds: string[]) => {
    return apiRequest<any>('/employee-applications/form-settings/qualifications/reorder-fields', {
      method: 'PUT',
      body: JSON.stringify({ fieldIds }),
    });
  },


  deleteEmployee: async (empNo: string) => {
    return apiRequest<any>(`/employees/${empNo}`, { method: 'DELETE' });
  },

  getEmployeeCount: async (is_active?: boolean) => {
    const query = is_active !== undefined ? `?is_active=${is_active}` : '';
    return apiRequest<any>(`/employees/count${query}`, { method: 'GET' });
  },

  getEmployeeSettings: async () => {
    return apiRequest<any>('/employees/settings', { method: 'GET' });
  },

  updateEmployeeSettings: async (data: any) => {
    return apiRequest<any>('/employees/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },


  // Employee Profile Update Requests
  getEmployeeUpdateRequests: async (params?: { status?: string }) => {
    const query = params?.status ? `?status=${params.status}` : '';
    return apiRequest<any[]>(`/employee-updates${query}`, { method: 'GET' });
  },

  createEmployeeUpdateRequest: async (data: { requestedChanges: any; comments?: string }) => {
    return apiRequest<any>('/employee-updates', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  approveEmployeeUpdateRequest: async (id: string) => {
    return apiRequest<any>(`/employee-updates/${id}/approve`, {
      method: 'PUT',
    });
  },

  rejectEmployeeUpdateRequest: async (id: string, comments?: string) => {
    return apiRequest<any>(`/employee-updates/${id}/reject`, {
      method: 'PUT',
      body: JSON.stringify({ comments }),
    });
  },

  // Workspaces
  getMyWorkspaces: async () => {
    return apiRequest<any>('/workspaces/my-workspaces', { method: 'GET' });
  },

  switchWorkspace: async (workspaceId: string) => {
    return apiRequest<any>('/workspaces/switch', {
      method: 'POST',
      body: JSON.stringify({ workspaceId }),
    });
  },

  getWorkspaces: async () => {
    return apiRequest<any>('/workspaces', { method: 'GET' });
  },





  getWorkspace: async (id: string) => {
    return apiRequest<any>(`/workspaces/${id}`, { method: 'GET' });
  },

  createWorkspace: async (data: any) => {
    return apiRequest<any>('/workspaces', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateWorkspace: async (id: string, data: any) => {
    return apiRequest<any>(`/workspaces/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  deleteWorkspace: async (id: string) => {
    return apiRequest<any>(`/workspaces/${id}`, { method: 'DELETE' });
  },

  // Workspace modules
  addModuleToWorkspace: async (workspaceId: string, data: any) => {
    return apiRequest<any>(`/workspaces/${workspaceId}/modules`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateWorkspaceModule: async (workspaceId: string, moduleCode: string, data: any) => {
    return apiRequest<any>(`/workspaces/${workspaceId}/modules/${moduleCode}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  removeModuleFromWorkspace: async (workspaceId: string, moduleCode: string) => {
    return apiRequest<any>(`/workspaces/${workspaceId}/modules/${moduleCode}`, { method: 'DELETE' });
  },

  // Workspace users
  getWorkspaceUsers: async (workspaceId: string) => {
    return apiRequest<any>(`/workspaces/${workspaceId}/users`, { method: 'GET' });
  },

  assignUserToWorkspace: async (workspaceId: string, data: { userId: string; role?: string; isPrimary?: boolean; scopeConfig?: any }) => {
    return apiRequest<any>(`/workspaces/${workspaceId}/assign`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  removeUserFromWorkspace: async (workspaceId: string, userId: string) => {
    return apiRequest<any>(`/workspaces/${workspaceId}/users/${userId}`, { method: 'DELETE' });
  },

  // Modules (system modules management)
  getModules: async () => {
    return apiRequest<any>('/workspaces/modules', { method: 'GET' });
  },

  getModule: async (id: string) => {
    return apiRequest<any>(`/workspaces/modules/${id}`, { method: 'GET' });
  },

  createModule: async (data: any) => {
    return apiRequest<any>('/workspaces/modules', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateModule: async (id: string, data: any) => {
    return apiRequest<any>(`/workspaces/modules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  deleteModule: async (id: string) => {
    return apiRequest<any>(`/workspaces/modules/${id}`, { method: 'DELETE' });
  },

  // ==========================================
  // ARREARS MANAGEMENT
  // ==========================================

  // Get arrears for payroll inclusion
  getArrearsForPayroll: async (filters: { employeeId?: string; month?: number; year?: number }) => {
    const params = new URLSearchParams();
    if (filters.employeeId) params.append('employeeId', filters.employeeId);
    if (filters.month) params.append('month', filters.month.toString());
    if (filters.year) params.append('year', filters.year.toString());

    return apiRequest<{ data: any[]; count: number }>(`/arrears/for-payroll?${params.toString()}`);
  },

  // Update arrears settlement status
  updateArrearsSettlement: async (id: string, data: { amount: number; payrollId?: string; month: number; year: number }) => {
    return apiRequest(`/arrears/${id}/settlement`, {
      method: 'PUT',
      body: JSON.stringify(data),
      headers: {
        'Content-Type': 'application/json',
      },
    });
  },

  // Generic GET method
  get: async <T = any>(url: string): Promise<ApiResponse<T>> => {
    return apiRequest<T>(url, { method: 'GET' });
  },

  // Generic PUT method
  put: async <T = any>(url: string, data: any): Promise<ApiResponse<T>> => {
    const response = await fetch(`${API_BASE_URL}${url}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(await auth.getAuthHeader())
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Request failed');
    }

    return response.json();
  },

  // Generic DELETE method
  delete: async <T = any>(url: string): Promise<ApiResponse<T>> => {
    const response = await fetch(`${API_BASE_URL}${url}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(await auth.getAuthHeader())
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Request failed');
    }

    return response.json();
  },

  // Generic POST method
  post: async <T = any>(url: string, data: any): Promise<ApiResponse<T>> => {
    const response = await fetch(`${API_BASE_URL}${url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await auth.getAuthHeader())
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Request failed');
    }

    return response.json();
  },

  // ==========================================
  // LEAVE MANAGEMENT
  // ==========================================

  // Get my leaves
  getMyLeaves: async (filters?: { status?: string; fromDate?: string; toDate?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.fromDate) params.append('fromDate', filters.fromDate);
    if (filters?.toDate) params.append('toDate', filters.toDate);
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<any>(`/leaves/my${query}`, { method: 'GET' });
  },

  // Get all leaves (admin) - supports pagination, search, division, designation
  getLeaves: async (filters?: { status?: string; employeeId?: string; department?: string; division?: string; designation?: string; search?: string; fromDate?: string; toDate?: string; page?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.employeeId) params.append('employeeId', filters.employeeId);
    if (filters?.department) params.append('department', filters.department);
    if (filters?.division) params.append('division', filters.division);
    if (filters?.designation) params.append('designation', filters.designation);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.fromDate) params.append('fromDate', filters.fromDate);
    if (filters?.toDate) params.append('toDate', filters.toDate);
    if (filters?.page != null) params.append('page', String(filters.page));
    if (filters?.limit != null) params.append('limit', String(filters.limit));
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<any>(`/leaves${query}`, { method: 'GET' });
  },

  // Dashboard stats (global or filtered) for superadmin cards
  getLeaveDashboardStats: async (filters?: { search?: string; division?: string; department?: string; designation?: string }) => {
    const params = new URLSearchParams();
    if (filters?.search) params.append('search', filters.search);
    if (filters?.division) params.append('division', filters.division);
    if (filters?.department) params.append('department', filters.department);
    if (filters?.designation) params.append('designation', filters.designation);
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<{ data: { totalLeaves: number; totalODs: number; totalPending: number; totalApproved: number } }>(`/leaves/dashboard-stats${query}`, { method: 'GET' });
  },

  // Get single leave
  getLeave: async (id: string) => {
    return apiRequest<any>(`/leaves/${id}`, { method: 'GET' });
  },

  // Apply for leave
  applyLeave: async (data: any) => {
    return apiRequest<any>('/leaves', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Update leave
  updateLeave: async (id: string, data: any) => {
    return apiRequest<any>(`/leaves/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // Cancel leave
  cancelLeave: async (id: string, reason?: string) => {
    return apiRequest<any>(`/leaves/${id}/cancel`, {
      method: 'PUT',
      body: JSON.stringify({ reason }),
    });
  },

  // Get pending leave approvals (supports pagination and filters)
  getPendingLeaveApprovals: async (params?: { page?: number; limit?: number; search?: string; leaveType?: string; fromDate?: string; toDate?: string; department?: string; division?: string; designation?: string }) => {
    const q = new URLSearchParams();
    if (params?.page != null) q.append('page', String(params.page));
    if (params?.limit != null) q.append('limit', String(params.limit));
    if (params?.search) q.append('search', params.search);
    if (params?.leaveType) q.append('leaveType', params.leaveType);
    if (params?.fromDate) q.append('fromDate', params.fromDate);
    if (params?.toDate) q.append('toDate', params.toDate);
    if (params?.department) q.append('department', params.department);
    if (params?.division) q.append('division', params.division);
    if (params?.designation) q.append('designation', params.designation);
    const query = q.toString();
    return apiRequest<any>(`/leaves/pending-approvals${query ? `?${query}` : ''}`, { method: 'GET' });
  },

  // Process leave action (approve/reject)
  processLeaveAction: async (id: string, action: 'approve' | 'reject', comments?: string) => {
    return apiRequest<any>(`/leaves/${id}/action`, {
      method: 'PUT',
      body: JSON.stringify({ action, comments }),
    });
  },

  // Revoke leave approval (within 2-3 hours)
  revokeLeaveApproval: async (id: string, reason?: string) => {
    return apiRequest<any>(`/leaves/${id}/revoke`, {
      method: 'PUT',
      body: JSON.stringify({ reason }),
    });
  },

  // ==========================================
  // SHIFT ROSTER
  // ==========================================
  // Roster
  getRoster: (month: string, params?: {
    departmentId?: string;
    divisionId?: string;
    startDate?: string;
    endDate?: string;
  }) => {
    const qs = new URLSearchParams({ month });
    if (params?.departmentId) qs.append('departmentId', params.departmentId);
    if (params?.divisionId) qs.append('divisionId', params.divisionId);
    if (params?.startDate) qs.append('startDate', params.startDate);
    if (params?.endDate) qs.append('endDate', params.endDate);
    return apiRequest(`/shifts/roster?${qs.toString()}`);
  },
  saveRoster: (data: {
    month: string;
    strict: boolean;
    entries: any[];
    startDate?: string;
    endDate?: string;
  }) => apiRequest('/shifts/roster', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  autoFillNextCycleRoster: (params?: { targetMonth?: string; departmentId?: string; divisionId?: string }) =>
    apiRequest<{ filled: number; holidaysRespected: number; previousRange: { startDate: string; endDate: string }; nextRange: { startDate: string; endDate: string } }>('/shifts/roster/auto-fill-next-cycle', {
      method: 'POST',
      body: JSON.stringify(params || {}),
    }),

  // ==========================================
  // LEAVE SPLIT APIs
  // ==========================================

  // Validate splits before creating
  validateLeaveSplits: async (leaveId: string, splits: any[]) => {
    return apiRequest<any>(`/leaves/${leaveId}/validate-splits`, {
      method: 'POST',
      body: JSON.stringify({ splits }),
    });
  },

  // Create splits for a leave
  createLeaveSplits: async (leaveId: string, splits: any[]) => {
    return apiRequest<any>(`/leaves/${leaveId}/split`, {
      method: 'POST',
      body: JSON.stringify({ splits }),
    });
  },

  // Get splits for a leave
  getLeaveSplits: async (leaveId: string) => {
    return apiRequest<any>(`/leaves/${leaveId}/splits`, { method: 'GET' });
  },

  // Get split summary for a leave
  getLeaveSplitSummary: async (leaveId: string) => {
    return apiRequest<any>(`/leaves/${leaveId}/split-summary`, { method: 'GET' });
  },

  // Update a single split
  updateLeaveSplit: async (leaveId: string, splitId: string, data: any) => {
    return apiRequest<any>(`/leaves/${leaveId}/splits/${splitId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // Delete a split
  deleteLeaveSplit: async (leaveId: string, splitId: string) => {
    return apiRequest<any>(`/leaves/${leaveId}/splits/${splitId}`, { method: 'DELETE' });
  },

  // Get approved records for a date (for conflict checking)
  getApprovedRecordsForDate: async (employeeId: string, employeeNumber: string, date: string) => {
    const params = new URLSearchParams();
    if (employeeId) params.append('employeeId', employeeId);
    if (employeeNumber) params.append('employeeNumber', employeeNumber);
    if (date) params.append('date', date);
    return apiRequest<any>(`/leaves/approved-records?${params.toString()}`, {
      method: 'GET',
    });
  },

  // Get leave statistics
  getLeaveStats: async (filters?: { employeeId?: string; department?: string; year?: string }) => {
    const params = new URLSearchParams();
    if (filters?.employeeId) params.append('employeeId', filters.employeeId);
    if (filters?.department) params.append('department', filters.department);
    if (filters?.year) params.append('year', filters.year);
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<any>(`/leaves/stats${query}`, { method: 'GET' });
  },

  // Delete leave
  deleteLeave: async (id: string) => {
    return apiRequest<any>(`/leaves/${id}`, { method: 'DELETE' });
  },

  // ==========================================
  // CCL (Compensatory Casual Leave) APIs
  // ==========================================
  getCCLAssignedByUsers: async (params: { employeeId?: string; empNo?: string }) => {
    const q = new URLSearchParams();
    if (params.employeeId) q.append('employeeId', params.employeeId);
    if (params.empNo) q.append('empNo', params.empNo);
    return apiRequest<any>(`/leaves/ccl/assigned-by-users?${q.toString()}`, { method: 'GET' });
  },
  validateCCLDate: async (date: string, params?: { employeeId?: string; empNo?: string; isHalfDay?: boolean; halfDayType?: 'first_half' | 'second_half' | null }) => {
    const q = new URLSearchParams();
    q.append('date', date);
    if (params?.employeeId) q.append('employeeId', params.employeeId);
    if (params?.empNo) q.append('empNo', params.empNo);
    if (params?.isHalfDay !== undefined) q.append('isHalfDay', String(params.isHalfDay));
    if (params?.halfDayType) q.append('halfDayType', params.halfDayType);
    return apiRequest<any>(`/leaves/ccl/validate-date?${q.toString()}`, { method: 'GET' });
  },
  getMyCCLs: async () => apiRequest<any>('/leaves/ccl/my', { method: 'GET' }),
  getPendingCCLApprovals: async () => apiRequest<any>('/leaves/ccl/pending-approvals', { method: 'GET' }),
  getCCLs: async (params?: { status?: string; employeeId?: string; fromDate?: string; toDate?: string; page?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.append('status', params.status);
    if (params?.employeeId) q.append('employeeId', params.employeeId);
    if (params?.fromDate) q.append('fromDate', params.fromDate);
    if (params?.toDate) q.append('toDate', params.toDate);
    if (params?.page) q.append('page', String(params.page));
    if (params?.limit) q.append('limit', String(params.limit));
    return apiRequest<any>(`/leaves/ccl${q.toString() ? `?${q.toString()}` : ''}`, { method: 'GET' });
  },
  getCCL: async (id: string) => apiRequest<any>(`/leaves/ccl/${id}`, { method: 'GET' }),
  applyCCL: async (data: { date: string; isHalfDay: boolean; halfDayType?: 'first_half' | 'second_half'; assignedBy: string; purpose: string; empNo?: string; employeeId?: string }) => {
    return apiRequest<any>('/leaves/ccl', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  processCCLAction: async (id: string, action: 'approve' | 'reject', comments?: string) => {
    return apiRequest<any>(`/leaves/ccl/${id}/action`, {
      method: 'PUT',
      body: JSON.stringify({ action, comments }),
    });
  },
  cancelCCL: async (id: string, reason?: string) => {
    return apiRequest<any>(`/leaves/ccl/${id}/cancel`, {
      method: 'PUT',
      body: JSON.stringify({ reason }),
    });
  },

  // Get leave conflicts for attendance date
  getLeaveConflicts: async (employeeNumber: string, date: string) => {
    return apiRequest<any>(`/leaves/conflicts?employeeNumber=${employeeNumber}&date=${date}`, {
      method: 'GET',
    });
  },

  // Revoke leave for attendance (full-day leave)
  revokeLeaveForAttendance: async (leaveId: string) => {
    return apiRequest<any>(`/leaves/${leaveId}/revoke-for-attendance`, {
      method: 'POST',
    });
  },

  // Update leave for attendance (multi-day leave adjustments)
  updateLeaveForAttendance: async (leaveId: string, employeeNumber: string, date: string) => {
    return apiRequest<any>(`/leaves/${leaveId}/update-for-attendance`, {
      method: 'POST',
      body: JSON.stringify({ employeeNumber, date }),
    });
  },

  // ==========================================
  // OD (ON DUTY) MANAGEMENT
  // ==========================================

  // Get my ODs
  getMyODs: async (filters?: { status?: string; fromDate?: string; toDate?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.fromDate) params.append('fromDate', filters.fromDate);
    if (filters?.toDate) params.append('toDate', filters.toDate);
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<any>(`/leaves/od/my${query}`, { method: 'GET' });
  },

  // Get all ODs (admin) - supports pagination, search, division, designation
  getODs: async (filters?: { status?: string; employeeId?: string; department?: string; division?: string; designation?: string; search?: string; fromDate?: string; toDate?: string; page?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.employeeId) params.append('employeeId', filters.employeeId);
    if (filters?.department) params.append('department', filters.department);
    if (filters?.division) params.append('division', filters.division);
    if (filters?.designation) params.append('designation', filters.designation);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.fromDate) params.append('fromDate', filters.fromDate);
    if (filters?.toDate) params.append('toDate', filters.toDate);
    if (filters?.page != null) params.append('page', String(filters.page));
    if (filters?.limit != null) params.append('limit', String(filters.limit));
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<any>(`/leaves/od${query}`, { method: 'GET' });
  },

  // Get single OD
  getOD: async (id: string) => {
    return apiRequest<any>(`/leaves/od/${id}`, { method: 'GET' });
  },

  // Apply for OD
  applyOD: async (data: any) => {
    return apiRequest<any>('/leaves/od', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Update OD
  updateOD: async (id: string, data: any) => {
    return apiRequest<any>(`/leaves/od/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // Cancel OD
  cancelOD: async (id: string, reason?: string) => {
    return apiRequest<any>(`/leaves/od/${id}/cancel`, {
      method: 'PUT',
      body: JSON.stringify({ reason }),
    });
  },

  // Get pending OD approvals (supports pagination and filters)
  getPendingODApprovals: async (params?: { page?: number; limit?: number; search?: string; odType?: string; fromDate?: string; toDate?: string; department?: string; division?: string; designation?: string }) => {
    const q = new URLSearchParams();
    if (params?.page != null) q.append('page', String(params.page));
    if (params?.limit != null) q.append('limit', String(params.limit));
    if (params?.search) q.append('search', params.search);
    if (params?.odType) q.append('odType', params.odType);
    if (params?.fromDate) q.append('fromDate', params.fromDate);
    if (params?.toDate) q.append('toDate', params.toDate);
    if (params?.department) q.append('department', params.department);
    if (params?.division) q.append('division', params.division);
    if (params?.designation) q.append('designation', params.designation);
    const query = q.toString();
    return apiRequest<any>(`/leaves/od/pending-approvals${query ? `?${query}` : ''}`, { method: 'GET' });
  },

  // Process OD action (approve/reject)
  processODAction: async (id: string, action: 'approve' | 'reject', comments?: string) => {
    return apiRequest<any>(`/leaves/od/${id}/action`, {
      method: 'PUT',
      body: JSON.stringify({ action, comments }),
    });
  },

  // Revoke OD approval (within 2-3 hours)
  revokeODApproval: async (id: string, reason?: string) => {
    return apiRequest<any>(`/leaves/od/${id}/revoke`, {
      method: 'PUT',
      body: JSON.stringify({ reason }),
    });
  },

  // Update OD outcome
  updateODOutcome: async (id: string, data: { actualOutcome?: string; actualExpense?: number }) => {
    return apiRequest<any>(`/leaves/od/${id}/outcome`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // Delete OD
  deleteOD: async (id: string) => {
    return apiRequest<any>(`/leaves/od/${id}`, { method: 'DELETE' });
  },

  // ==========================================
  // DIVISION/DEPARTMENT MANAGEMENT
  // ==========================================



  // ==========================================
  // LEAVE/OD SETTINGS
  // ==========================================

  // Get leave/OD/CCL settings
  getLeaveSettings: async (type: 'leave' | 'od' | 'ccl') => {
    return apiRequest<any>(`/leaves/settings/${type}`, { method: 'GET' });
  },

  // Save leave/OD/CCL settings
  saveLeaveSettings: async (type: 'leave' | 'od' | 'ccl', data: any) => {
    return apiRequest<any>(`/leaves/settings/${type}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Update leave/OD/CCL settings (alias for saveLeaveSettings)
  updateLeaveSettings: async (type: 'leave' | 'od' | 'ccl', data: any) => {
    return apiRequest<any>(`/leaves/settings/${type}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Get leave/OD/CCL types
  getLeaveTypes: async (type: 'leave' | 'od' | 'ccl') => {
    return apiRequest<any>(`/leaves/types/${type}`, { method: 'GET' });
  },

  // ==========================================
  // RESIGNATION POLICY & REQUESTS
  // ==========================================
  getResignationSettings: async () => {
    return apiRequest<any>('/resignations/settings', { method: 'GET' });
  },
  saveResignationSettings: async (data: any) => {
    return apiRequest<any>('/resignations/settings', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  createResignationRequest: async (data: { emp_no: string; leftDate: string; remarks?: string }) => {
    return apiRequest<any>('/resignations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  getResignationPendingApprovals: async () => {
    return apiRequest<any>('/resignations/pending-approvals', { method: 'GET' });
  },
  approveResignationRequest: async (id: string, action: 'approve' | 'reject', comments?: string) => {
    return apiRequest<any>(`/resignations/${id}/approve`, {
      method: 'PUT',
      body: JSON.stringify({ action, comments }),
    });
  },
  getResignationRequests: async (params?: { emp_no?: string }) => {
    const q = params?.emp_no ? `?emp_no=${encodeURIComponent(params.emp_no)}` : '';
    return apiRequest<any>(`/resignations${q}`, { method: 'GET' });
  },

  // ==========================================
  // LOAN & SALARY ADVANCE APIs
  // ==========================================

  // Get loan/salary advance settings
  getLoanSettings: async (type: 'loan' | 'salary_advance') => {
    return apiRequest<any>(`/loans/settings/${type}`, { method: 'GET' });
  },

  // Save loan/salary advance settings
  saveLoanSettings: async (type: 'loan' | 'salary_advance', data: any) => {
    return apiRequest<any>(`/loans/settings/${type}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Update loan/salary advance settings
  updateLoanSettings: async (type: 'loan' | 'salary_advance', data: any) => {
    return apiRequest<any>(`/loans/settings/${type}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  getLoanWorkflow: async (type: 'loan' | 'salary_advance') => {
    return apiRequest<any>(`/loans/settings/${type}/workflow`, { method: 'GET' });
  },

  updateLoanWorkflow: async (type: 'loan' | 'salary_advance', workflow: any) => {
    return apiRequest<any>(`/loans/settings/${type}/workflow`, {
      method: 'PUT',
      body: JSON.stringify(workflow),
    });
  },



  // Get all loans
  getLoans: async (filters?: { status?: string; employeeId?: string; department?: string; requestType?: string; page?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.employeeId) params.append('employeeId', filters.employeeId);
    if (filters?.department) params.append('department', filters.department);
    if (filters?.requestType) params.append('requestType', filters.requestType);
    if (filters?.page) params.append('page', String(filters.page));
    if (filters?.limit) params.append('limit', String(filters.limit));
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<any>(`/loans${query}`, { method: 'GET' });
  },

  // Get my loans
  getMyLoans: async (filters?: { status?: string; requestType?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.requestType) params.append('requestType', filters.requestType);
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<any>(`/loans/my${query}`, { method: 'GET' });
  },

  // Get single loan
  getLoan: async (id: string) => {
    return apiRequest<any>(`/loans/${id}`, { method: 'GET' });
  },

  // Apply for loan/advance
  applyLoan: async (data: any) => {
    return apiRequest<any>('/loans', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Update loan/advance
  updateLoan: async (id: string, data: any) => {
    return apiRequest<any>(`/loans/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // Get pending approvals
  getPendingLoanApprovals: async () => {
    return apiRequest<any>('/loans/pending-approvals', { method: 'GET' });
  },

  // Process loan action (approve/reject/forward)
  processLoanAction: async (id: string, action: string, comments?: string) => {
    return apiRequest<any>(`/loans/${id}/action`, {
      method: 'PUT',
      body: JSON.stringify({ action, comments }),
    });
  },

  // Cancel loan
  cancelLoan: async (id: string, reason?: string) => {
    return apiRequest<any>(`/loans/${id}/cancel`, {
      method: 'PUT',
      body: JSON.stringify({ reason }),
    });
  },

  // Disburse loan
  disburseLoan: async (id: string, data: { disbursementMethod?: string; transactionReference?: string; remarks?: string }) => {
    return apiRequest<any>(`/loans/${id}/disburse`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // Record EMI payment
  payEMI: async (id: string, data: { amount: number; paymentDate?: string; remarks?: string; payrollCycle?: string }) => {
    return apiRequest<any>(`/loans/${id}/pay-emi`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Record advance deduction
  payAdvance: async (id: string, data: { amount: number; paymentDate?: string; remarks?: string; payrollCycle?: string }) => {
    return apiRequest<any>(`/loans/${id}/pay-advance`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Get transaction history
  getLoanTransactions: async (id: string) => {
    return apiRequest<any>(`/loans/${id}/transactions`, { method: 'GET' });
  },

  // Get early settlement preview
  getSettlementPreview: async (id: string, settlementDate?: string) => {
    const query = settlementDate ? `?settlementDate=${settlementDate}` : '';
    return apiRequest<any>(`/loans/${id}/settlement-preview${query}`, { method: 'GET' });
  },

  // Add leave/OD/CCL type
  addLeaveType: async (type: 'leave' | 'od' | 'ccl', data: any) => {
    return apiRequest<any>(`/leaves/types/${type}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },



  // Initialize default settings
  initializeLeaveSettings: async () => {
    return apiRequest<any>('/leaves/settings/initialize', { method: 'POST' });
  },

  // ==========================================
  // LEAVE REGISTER
  // ==========================================

  // Get leave register data (employeeId or empNo for single-employee balance, e.g. CL for apply form; balanceAsOf=true for balance as of that month)
  getLeaveRegister: async (filters?: { divisionId?: string; departmentId?: string; searchTerm?: string; month?: number; year?: number; employeeId?: string; empNo?: string; balanceAsOf?: boolean; baseDate?: string }) => {
    const params = new URLSearchParams();
    if (filters?.divisionId) params.append('divisionId', filters.divisionId);
    if (filters?.departmentId) params.append('departmentId', filters.departmentId);
    if (filters?.searchTerm) params.append('searchTerm', filters.searchTerm);
    if (filters?.month) params.append('month', String(filters.month));
    if (filters?.year) params.append('year', String(filters.year));
    if (filters?.employeeId) params.append('employeeId', filters.employeeId);
    if (filters?.empNo) params.append('empNo', filters.empNo);
    if (filters?.balanceAsOf) params.append('balanceAsOf', 'true');
    if (filters?.baseDate) params.append('baseDate', filters.baseDate);
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<any>(`/leaves/register${query}`, { method: 'GET' });
  },

  // Get employee leave register data
  getEmployeeRegister: async (employeeId: string) => {
    return apiRequest<any>(`/leaves/register/employee/${employeeId}`, { method: 'GET' });
  },

  // Get employee ledger for specific leave type
  getEmployeeLedger: async (employeeId: string, leaveType: string) => {
    return apiRequest<any>(`/leaves/register/employee/${employeeId}/ledger/${leaveType}`, { method: 'GET' });
  },

  // Adjust leave balance (any type: CREDIT, DEBIT, or ADJUSTMENT)
  adjustLeaveBalance: async (data: {
    employeeId: string;
    leaveType: string;
    amount: number;
    transactionType: 'CREDIT' | 'DEBIT' | 'ADJUSTMENT';
    reason: string;
  }) => {
    return apiRequest<any>('/leaves/register/adjust', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // ==========================================
  // EARNED LEAVE (EL)
  // ==========================================

  // Trigger bulk EL update for all employees for a given payroll month/year
  updateAllEL: async (payload: { month?: number; year?: number }) => {
    return apiRequest<any>('/leaves/earned/update-all', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Adjust CL balance by days (positive = add, negative = subtract)
  adjustCLBalance: async (data: { employeeId: string; days: number; reason: string }) => {
    const amount = Math.abs(data.days);
    const transactionType = data.days >= 0 ? 'CREDIT' : 'DEBIT';
    return apiRequest<any>('/leaves/register/adjust', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: data.employeeId,
        leaveType: 'CL',
        amount,
        transactionType,
        reason: data.reason,
      }),
    });
  },

  // Attendance
  // Monthly Summary
  getMonthlySummary: async (employeeId?: string, month?: string, year?: number, monthNumber?: number) => {
    const params = new URLSearchParams();
    if (month) params.append('month', month);
    if (year) params.append('year', String(year));
    if (monthNumber) params.append('monthNumber', String(monthNumber));
    const query = params.toString() ? `?${params.toString()}` : '';
    const endpoint = employeeId ? `/attendance/monthly-summary/${employeeId}${query}` : `/attendance/monthly-summary${query}`;
    return apiRequest<any>(endpoint, { method: 'GET' });
  },

  calculateMonthlySummary: async (employeeId: string, year?: number, monthNumber?: number) => {
    return apiRequest<any>(`/attendance/monthly-summary/calculate/${employeeId}`, {
      method: 'POST',
      body: JSON.stringify({ year, monthNumber }),
    });
  },

  calculateAllMonthlySummaries: async (year?: number, monthNumber?: number) => {
    return apiRequest<any>('/attendance/monthly-summary/calculate-all', {
      method: 'POST',
      body: JSON.stringify({ year, monthNumber }),
    });
  },

  getAttendanceCalendar: async (employeeNumber: string, year?: number, month?: number) => {
    const params = new URLSearchParams();
    params.append('employeeNumber', employeeNumber);
    if (year) params.append('year', String(year));
    if (month) params.append('month', String(month));
    return apiRequest<any>(`/attendance/calendar?${params.toString()}`, { method: 'GET' });
  },

  getAttendanceList: async (employeeNumber: string, startDate?: string, endDate?: string, page?: number, limit?: number) => {
    const params = new URLSearchParams();
    params.append('employeeNumber', employeeNumber);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (page) params.append('page', String(page));
    if (limit) params.append('limit', String(limit));
    return apiRequest<any>(`/attendance/list?${params.toString()}`, { method: 'GET' });
  },

  getAttendanceDetail: async (employeeNumber: string, date: string) => {
    const params = new URLSearchParams();
    params.append('employeeNumber', employeeNumber);
    params.append('date', date);
    return apiRequest<any>(`/attendance/detail?${params.toString()}`, { method: 'GET' });
  },

  getEmployeesWithAttendance: async (date?: string) => {
    const query = date ? `?date=${date}` : '';
    return apiRequest<any>(`/attendance/employees${query}`, { method: 'GET' });
  },

  getMonthlyAttendance: async (year: number, month: number, filters?: { page?: number; limit?: number; search?: string; divisionId?: string; departmentId?: string; designationId?: string; startDate?: string; endDate?: string }) => {
    const params = new URLSearchParams();
    params.append('year', String(year));
    params.append('month', String(month));

    if (filters?.page) params.append('page', String(filters.page));
    if (filters?.limit) params.append('limit', String(filters.limit));
    if (filters?.search) params.append('search', filters.search);
    if (filters?.divisionId) params.append('divisionId', filters.divisionId);
    if (filters?.departmentId) params.append('departmentId', filters.departmentId);
    if (filters?.designationId) params.append('designationId', filters.designationId);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);

    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<any>(`/attendance/monthly${query}`, {
      method: 'GET',
    });
  },

  // Attendance Settings
  getAttendanceSettings: async () => {
    return apiRequest<any>('/attendance/settings', { method: 'GET' });
  },

  updateAttendanceSettings: async (data: any) => {
    return apiRequest<any>('/attendance/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // Attendance Sync
  manualSyncAttendance: async (fromDate?: string, toDate?: string) => {
    return apiRequest<any>('/attendance/sync', {
      method: 'POST',
      body: JSON.stringify({ fromDate, toDate }),
    });
  },

  getAttendanceSyncStatus: async () => {
    return apiRequest<any>('/attendance/sync/status', { method: 'GET' });
  },

  // Attendance Upload
  uploadAttendanceExcel: async (file: File) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const formData = new FormData();
    formData.append('file', file);

    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}/attendance/upload`, {
      method: 'POST',
      headers,
      body: formData,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Upload failed');
    }
    return data;
  },

  downloadAttendanceTemplate: async () => {
    const response = await fetch(`${API_BASE_URL}/attendance/upload/template`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
      },
    });
    if (!response.ok) throw new Error('Failed to download template');
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'attendance_template.xlsx';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },

  getScopedShiftData: async () => {
    return apiRequest<{
      divisions: Division[];
      departments: Department[];
      designations: Designation[];
    }>('/shifts/scoped', { method: 'GET' });
  },

  // Confused Shifts
  getConfusedShifts: async (filters?: { status?: string; startDate?: string; endDate?: string; department?: string; page?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.department) params.append('department', filters.department);
    if (filters?.page) params.append('page', String(filters.page));
    if (filters?.limit) params.append('limit', String(filters.limit));
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<any>(`/shifts/confused${query}`, { method: 'GET' });
  },

  getConfusedShift: async (id: string) => {
    return apiRequest<any>(`/shifts/confused/${id}`, { method: 'GET' });
  },

  resolveConfusedShift: async (id: string, shiftId: string, comments?: string) => {
    return apiRequest<any>(`/shifts/confused/${id}/resolve`, {
      method: 'PUT',
      body: JSON.stringify({ shiftId, comments }),
    });
  },

  dismissConfusedShift: async (id: string, comments?: string) => {
    return apiRequest<any>(`/shifts/confused/${id}/dismiss`, {
      method: 'PUT',
      body: JSON.stringify({ comments }),
    });
  },

  autoAssignConfusedShift: async (id: string) => {
    return apiRequest<any>(`/shifts/confused/${id}/auto-assign`, {
      method: 'PUT',
    });
  },

  autoAssignAllConfusedShifts: async () => {
    return apiRequest<any>('/shifts/confused/auto-assign-all', {
      method: 'PUT',
    });
  },

  getConfusedShiftStats: async () => {
    return apiRequest<any>('/shifts/confused/stats', { method: 'GET' });
  },

  // Pre-Scheduled Shifts
  getPreScheduledShifts: async (filters?: { employeeNumber?: string; startDate?: string; endDate?: string; shiftId?: string; page?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.employeeNumber) params.append('employeeNumber', filters.employeeNumber);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.shiftId) params.append('shiftId', filters.shiftId);
    if (filters?.page) params.append('page', String(filters.page));
    if (filters?.limit) params.append('limit', String(filters.limit));
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<any>(`/shifts/pre-schedule${query}`, { method: 'GET' });
  },

  createPreScheduledShift: async (data: { employeeNumber: string; shiftId: string; date: string; notes?: string }) => {
    return apiRequest<any>('/shifts/pre-schedule', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  bulkCreatePreScheduledShifts: async (schedules: Array<{ employeeNumber: string; shiftId: string; date: string; notes?: string }>) => {
    return apiRequest<any>('/shifts/pre-schedule/bulk', {
      method: 'POST',
      body: JSON.stringify({ schedules }),
    });
  },

  updatePreScheduledShift: async (id: string, data: { shiftId?: string; notes?: string }) => {
    return apiRequest<any>(`/shifts/pre-schedule/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  deletePreScheduledShift: async (id: string) => {
    return apiRequest<any>(`/shifts/pre-schedule/${id}`, { method: 'DELETE' });
  },

  // Shift Sync
  syncShifts: async (startDate?: string, endDate?: string) => {
    return apiRequest<any>('/shifts/sync', {
      method: 'POST',
      body: JSON.stringify({ startDate, endDate }),
    });
  },

  // ==========================================
  // OVERTIME (OT) APIs
  // ==========================================

  // Get OT requests
  getOTRequests: async (filters?: { employeeId?: string; employeeNumber?: string; date?: string; status?: string; startDate?: string; endDate?: string }) => {
    const params = new URLSearchParams();
    if (filters?.employeeId) params.append('employeeId', filters.employeeId);
    if (filters?.employeeNumber) params.append('employeeNumber', filters.employeeNumber);
    if (filters?.date) params.append('date', filters.date);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    return apiRequest<any>(`/ot?${params.toString()}`);
  },

  // Get single OT request
  getOTRequest: async (id: string) => {
    return apiRequest<any>(`/ot/${id}`);
  },

  // Create OT request
  createOT: async (data: { employeeId: string; employeeNumber: string; date: string; otOutTime: string; shiftId?: string; manuallySelectedShiftId?: string; comments?: string; photoEvidence?: any; geoLocation?: any }) => {
    return apiRequest<any>('/ot', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Approve OT request
  approveOT: async (id: string) => {
    return apiRequest<any>(`/ot/${id}/approve`, {
      method: 'PUT',
    });
  },

  // Reject OT request
  rejectOT: async (id: string, reason?: string) => {
    return apiRequest<any>(`/ot/${id}/reject`, {
      method: 'PUT',
      body: JSON.stringify({ reason }),
    });
  },

  // Check ConfusedShift for employee date
  checkConfusedShift: async (employeeNumber: string, date: string) => {
    return apiRequest<any>(`/ot/check-confused/${employeeNumber}/${date}`);
  },

  // Convert extra hours from attendance to OT
  convertExtraHoursToOT: async (data: { employeeId: string; employeeNumber: string; date: string }) => {
    return apiRequest<any>('/ot/convert-from-attendance', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // ==========================================
  // PERMISSION APIs
  // ==========================================

  // Get permission requests
  getPermissions: async (filters?: { employeeId?: string; employeeNumber?: string; date?: string; status?: string; startDate?: string; endDate?: string }) => {
    const params = new URLSearchParams();
    if (filters?.employeeId) params.append('employeeId', filters.employeeId);
    if (filters?.employeeNumber) params.append('employeeNumber', filters.employeeNumber);
    if (filters?.date) params.append('date', filters.date);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    return apiRequest<any>(`/permissions?${params.toString()}`);
  },

  // Get single permission request
  getPermission: async (id: string) => {
    return apiRequest<any>(`/permissions/${id}`);
  },

  // Create permission request
  createPermission: async (data: { employeeId: string; employeeNumber: string; date: string; permissionStartTime: string; permissionEndTime: string; purpose: string; comments?: string; photoEvidence?: any; geoLocation?: any }) => {
    return apiRequest<any>('/permissions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Approve permission request
  approvePermission: async (id: string) => {
    return apiRequest<any>(`/permissions/${id}/approve`, {
      method: 'PUT',
    });
  },

  // Reject permission request
  rejectPermission: async (id: string, reason?: string) => {
    return apiRequest<any>(`/permissions/${id}/reject`, {
      method: 'PUT',
      body: JSON.stringify({ reason }),
    });
  },

  getPermissionQR: async (id: string) => {
    return apiRequest<any>(`/permissions/${id}/qr`);
  },



  // Get outpass by QR code (public - no auth required)
  getOutpassByQR: async (qrCode: string) => {
    // Public endpoint - don't send auth token
    const url = `${API_BASE_URL}/permissions/outpass/${qrCode}`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'An error occurred',
          error: data.error || data.message || `HTTP ${response.status}`,
        };
      }

      return {
        success: true,
        ...data,
      };
    } catch (error) {
      console.error(`[API Error] GET ${url}`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Network error occurred',
        error: error instanceof Error ? error.message : 'Network error occurred',
      };
    }
  },

  // Update inTime for attendance
  updateAttendanceInTime: async (employeeNumber: string, date: string, inTime: string, shiftRecordId?: string) => {
    return apiRequest<any>(`/attendance/${employeeNumber}/${date}/intime`, {
      method: 'PUT',
      body: JSON.stringify({ inTime, shiftRecordId }),
    });
  },

  // Update outTime for attendance
  updateAttendanceOutTime: async (employeeNumber: string, date: string, outTime: string, shiftRecordId?: string) => {
    return apiRequest<any>(`/attendance/${employeeNumber}/${date}/outtime`, {
      method: 'PUT',
      body: JSON.stringify({ outTime, shiftRecordId }),
    });
  },

  // Get available shifts for an employee
  getAvailableShifts: async (employeeNumber: string, date: string) => {
    return apiRequest<any>(`/attendance/${employeeNumber}/${date}/available-shifts`, {
      method: 'GET',
    });
  },

  // Assign shift to attendance record
  assignShiftToAttendance: async (employeeNumber: string, date: string, shiftId: string, shiftRecordId?: string) => {
    return apiRequest<any>(`/attendance/${employeeNumber}/${date}/shift`, {
      method: 'PUT',
      body: JSON.stringify({ shiftId, shiftRecordId }),
    });
  },

  // Allowances & Deductions
  getAllAllowancesDeductions: async (category?: 'allowance' | 'deduction', isActive?: boolean) => {
    const params = new URLSearchParams();
    if (category) params.append('category', category);
    if (isActive !== undefined) params.append('isActive', String(isActive));
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<any[]>(`/allowances-deductions${query}`, { method: 'GET' });
  },

  getAllowances: async (isActive?: boolean) => {
    const query = isActive !== undefined ? `?isActive=${isActive}` : '';
    return apiRequest<any[]>(`/allowances-deductions/allowances${query}`, { method: 'GET' });
  },

  getDeductions: async (isActive?: boolean) => {
    const query = isActive !== undefined ? `?isActive=${isActive}` : '';
    return apiRequest<any[]>(`/allowances-deductions/deductions${query}`, { method: 'GET' });
  },

  getAllowanceDeduction: async (id: string) => {
    return apiRequest<any>(`/allowances-deductions/${id}`, { method: 'GET' });
  },

  createAllowanceDeduction: async (data: {
    name: string;
    category: 'allowance' | 'deduction';
    description?: string;
    globalRule: {
      type: 'fixed' | 'percentage';
      amount?: number;
      percentage?: number;
      percentageBase?: 'basic' | 'gross';
      minAmount?: number | null;
      maxAmount?: number | null;
    };
    isActive?: boolean;
  }) => {
    return apiRequest<any>('/allowances-deductions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateAllowanceDeduction: async (id: string, data: {
    name?: string;
    description?: string;
    globalRule?: {
      type: 'fixed' | 'percentage';
      amount?: number;
      percentage?: number;
      percentageBase?: 'basic' | 'gross';
      minAmount?: number | null;
      maxAmount?: number | null;
    };
    isActive?: boolean;
  }) => {
    return apiRequest<any>(`/allowances-deductions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  addOrUpdateDepartmentRule: async (id: string, data: {
    divisionId?: string;
    departmentId: string;
    type: 'fixed' | 'percentage';
    amount?: number;
    percentage?: number;
    percentageBase?: 'basic' | 'gross';
    minAmount?: number | null;
    maxAmount?: number | null;
    basedOnPresentDays?: boolean;
  }) => {
    return apiRequest<any>(`/allowances-deductions/${id}/department-rule`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  removeDepartmentRule: async (id: string, deptId: string, divisionId?: string) => {
    const url = divisionId
      ? `/allowances-deductions/${id}/department-rule/${deptId}?divisionId=${encodeURIComponent(divisionId)}`
      : `/allowances-deductions/${id}/department-rule/${deptId}`;
    return apiRequest<void>(url, {
      method: 'DELETE',
    });
  },

  getResolvedRule: async (id: string, deptId: string) => {
    return apiRequest<any>(`/allowances-deductions/${id}/resolved/${deptId}`, { method: 'GET' });
  },

  deleteAllowanceDeduction: async (id: string) => {
    return apiRequest<void>(`/allowances-deductions/${id}`, { method: 'DELETE' });
  },

  // Overtime Settings
  // Overtime Settings
  getOvertimeSettings: async () => {
    return apiRequest<any>('/ot/settings', { method: 'GET' });
  },

  saveOvertimeSettings: async (data: {
    payPerHour?: number;
    multiplier?: number;
    minOTHours?: number;
    roundingMinutes?: number;
    workflow?: any
  }) => {
    return apiRequest<any>('/ot/settings', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Payroll
  calculatePayroll: async (
    employeeId: string,
    month: string,
    query: string = '',
    arrears?: Array<{ id: string; amount: number; employeeId?: string }>,
    deductions?: Array<{ id: string; amount: number; employeeId?: string }>
  ) => {
    const path = `/payroll/calculate${query || ''}`;
    const formattedArrears = arrears?.map((a) => ({ arrearId: a.id, amount: a.amount, employeeId: a.employeeId })) || [];
    const formattedDeductions = deductions?.map((d) => ({ deductionId: d.id, amount: d.amount, employeeId: d.employeeId })) || [];
    return apiRequest<any>(path, {
      method: 'POST',
      body: JSON.stringify({
        employeeId,
        month,
        arrears: formattedArrears,
        deductions: formattedDeductions,
      }),
    });
  },

  calculatePayrollBulk: async (data: { month: string; divisionId?: string; departmentId?: string; strategy?: string }) => {
    return apiRequest<any>('/payroll/bulk-calculate', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  exportPayrollExcel: async (params: {
    month: string;
    departmentId?: string;
    divisionId?: string;
    status?: string;
    search?: string;
    employeeIds?: string[];
    strategy?: 'new' | 'legacy' | 'dynamic';
  }) => {
    const query = new URLSearchParams();
    query.append('month', params.month);
    if (params.departmentId) query.append('departmentId', params.departmentId);
    if (params.divisionId) query.append('divisionId', params.divisionId);
    if (params.status) query.append('status', params.status);
    if (params.search) query.append('search', params.search);
    if (params.employeeIds && params.employeeIds.length > 0) {
      query.append('employeeIds', params.employeeIds.join(','));
    }
    if (params.strategy) {
      query.append('strategy', params.strategy);
    }

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}/payroll/export?${query.toString()}`, {
      method: 'GET',
      credentials: 'include',
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to export payroll');
    }

    const blob = await response.blob();
    return blob;
  },

  getPayrollRecord: async (employeeId: string, month: string) => {
    return apiRequest<any>(`/payroll/${employeeId}/${month}`, { method: 'GET' });
  },

  getPayslip: async (employeeId: string, month: string) => {
    return apiRequest<any>(`/payroll/payslip/${employeeId}/${month}`, { method: 'GET' });
  },

  getPayrollRecords: async (params: { month?: string; employeeId?: string; departmentId?: string; divisionId?: string; status?: string }) => {
    const queryParams = new URLSearchParams();
    if (params.month) queryParams.append('month', params.month);
    if (params.employeeId) queryParams.append('employeeId', params.employeeId);
    if (params.departmentId) queryParams.append('departmentId', params.departmentId);
    if (params.divisionId) queryParams.append('divisionId', params.divisionId);
    if (params.status) queryParams.append('status', params.status);
    const query = queryParams.toString();
    return apiRequest<any>(`/payroll${query ? `?${query}` : ''}`, { method: 'GET' });
  },

  /** Paysheet table data: headers + rows from config output columns (same as Excel export) */
  getPaysheetData: async (params: { month: string; departmentId?: string; divisionId?: string; status?: string; search?: string; employeeIds?: string[]; source?: 'existing' | 'calculate' }) => {
    const queryParams = new URLSearchParams();
    if (params.month) queryParams.append('month', params.month);
    if (params.departmentId) queryParams.append('departmentId', params.departmentId);
    if (params.divisionId) queryParams.append('divisionId', params.divisionId);
    if (params.status) queryParams.append('status', params.status);
    if (params.search) queryParams.append('search', params.search);
    if (params.employeeIds?.length) queryParams.append('employeeIds', params.employeeIds.join(','));
    if (params.source) queryParams.append('source', params.source);
    const query = queryParams.toString();
    return apiRequest<{ headers: string[]; rows: Record<string, unknown>[] }>(
      `/payroll/paysheet${query ? `?${query}` : ''}`,
      { method: 'GET' }
    );
  },

  getPayrollById: async (payrollId: string) => {
    return apiRequest<PayrollRecordResponse>(`/payroll/record/${payrollId}`, { method: 'GET' });
  },

  getPayrollConfig: async () => {
    return apiRequest<{ success: boolean; data: PayrollConfig }>('/payroll/config', { method: 'GET' });
  },

  putPayrollConfig: async (body: {
    enabled?: boolean;
    steps?: PayrollConfigStep[];
    outputColumns?: PayrollOutputColumn[];
    statutoryProratePaidDaysColumnHeader?: string;
    statutoryProrateTotalDaysColumnHeader?: string;
  }) => {
    return apiRequest<{ success: boolean; data: PayrollConfig }>('/payroll/config', { method: 'PUT', body: JSON.stringify(body) });
  },

  getStatutoryConfig: async () => {
    return apiRequest<StatutoryDeductionConfig>('/payroll/statutory-config', { method: 'GET' });
  },
  putStatutoryConfig: async (body: { esi?: Partial<StatutoryESI>; pf?: Partial<StatutoryPF>; professionTax?: Partial<StatutoryProfessionTax> }) => {
    return apiRequest<StatutoryDeductionConfig>('/payroll/statutory-config', { method: 'PUT', body: JSON.stringify(body) });
  },

  getPayRegisterSummary: async (params?: { month?: string; filter_department?: string; filter_status?: string }) => {
    const queryParams = new URLSearchParams();
    if (params?.month) queryParams.append('month', params.month);
    if (params?.filter_department) queryParams.append('filter_department', params.filter_department);
    if (params?.filter_status) queryParams.append('filter_status', params.filter_status);
    const query = queryParams.toString();
    return apiRequest<any>(`/pay-register/summary${query ? `?${query}` : ''}`, { method: 'GET' });
  },

  // Payroll Batch API
  getPayrollBatches: async (params?: { month?: string; departmentId?: string; divisionId?: string; status?: string; page?: number; limit?: number }) => {
    const queryParams = new URLSearchParams();
    if (params?.month) queryParams.append('month', params.month);
    if (params?.departmentId) queryParams.append('departmentId', params.departmentId);
    if (params?.divisionId) queryParams.append('divisionId', params.divisionId);
    if (params?.status) queryParams.append('status', params.status);
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    const query = queryParams.toString();
    return apiRequest<any>(`/payroll-batch${query ? `?${query}` : ''}`, { method: 'GET' });
  },

  getPayrollBatch: async (id: string) => {
    return apiRequest<any>(`/payroll-batch/${id}`, { method: 'GET' });
  },

  calculatePayrollBatch: async (data: { departmentId?: string; divisionId?: string; month: string; calculateAll?: boolean }) => {
    return apiRequest<any>(`/payroll-batch/calculate`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  approveBatch: async (id: string, reason?: string) => {
    return apiRequest<any>(`/payroll-batch/${id}/approve`, {
      method: 'PUT',
      body: JSON.stringify({ reason }),
    });
  },

  freezeBatch: async (id: string, reason?: string) => {
    return apiRequest<any>(`/payroll-batch/${id}/freeze`, {
      method: 'PUT',
      body: JSON.stringify({ reason }),
    });
  },

  completeBatch: async (id: string, reason?: string) => {
    return apiRequest<any>(`/payroll-batch/${id}/complete`, {
      method: 'PUT',
      body: JSON.stringify({ reason }),
    });
  },

  requestRecalculation: async (id: string, reason: string) => {
    return apiRequest<any>(`/payroll-batch/${id}/request-recalculation`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  grantRecalculation: async (id: string, reason: string = 'Granted via UI', expiryHours: number = 24) => {
    return apiRequest<any>(`/payroll-batch/${id}/grant-recalculation`, {
      method: 'POST',
      body: JSON.stringify({ reason, expiryHours }),
    });
  },

  bulkApproveBatches: async (batchIds: string[], reason?: string) => {
    return apiRequest<any>(`/payroll-batch/bulk-approve`, {
      method: 'POST',
      body: JSON.stringify({ batchIds, reason }),
    });
  },

  approvePayroll: async (payrollRecordId: string, comments?: string) => {
    return apiRequest<any>(`/payroll/${payrollRecordId}/approve`, {
      method: 'PUT',
      body: JSON.stringify({ comments }),
    });
  },

  processPayroll: async (payrollRecordId: string) => {
    return apiRequest<any>(`/payroll/${payrollRecordId}/process`, {

      method: 'PUT',
    });
  },

  recalculatePayroll: async (employeeId: string, month: string) => {
    return apiRequest<any>('/payroll/recalculate', {
      method: 'POST',
      body: JSON.stringify({ employeeId, month }),
    });
  },

  getPayrollTransactionsWithAnalytics: async (params?: { month: string; employeeId?: string; departmentId?: string }) => {
    const query = new URLSearchParams();
    if (params?.month) query.append('month', params.month);
    if (params?.employeeId) query.append('employeeId', params.employeeId);
    if (params?.departmentId) query.append('departmentId', params.departmentId);
    return apiRequest<any>(`/payroll/transactions/analytics${query.toString() ? `?${query.toString()}` : ''}`, {
      method: 'GET',
    });
  },

  // Pay Register APIs
  getPayRegister: async (employeeId: string, month: string) => {
    return apiRequest<any>(`/pay-register/${employeeId}/${month}`, {
      method: 'GET',
    });
  },

  createPayRegister: async (employeeId: string, month: string) => {
    return apiRequest<any>(`/pay-register/${employeeId}/${month}`, {
      method: 'POST',
    });
  },

  updatePayRegister: async (employeeId: string, month: string, data: any) => {
    return apiRequest<any>(`/pay-register/${employeeId}/${month}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  updateDailyRecord: async (employeeId: string, month: string, date: string, data: any) => {
    return apiRequest<any>(`/pay-register/${employeeId}/${month}/daily/${date}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  syncPayRegister: async (employeeId: string, month: string) => {
    return apiRequest<any>(`/pay-register/${employeeId}/${month}/sync`, {
      method: 'POST',
    });
  },

  getPayRegisterHistory: async (employeeId: string, month: string) => {
    return apiRequest<any>(`/pay-register/${employeeId}/${month}/history`, {
      method: 'GET',
    });
  },

  getEmployeesWithPayRegister: async (month: string, departmentId?: string, divisionId?: string, status?: string, page?: number, limit?: number) => {
    const query = new URLSearchParams();
    if (departmentId) query.append('departmentId', departmentId);
    if (divisionId) query.append('divisionId', divisionId);
    if (status) query.append('status', status);
    if (page) query.append('page', page.toString());
    if (limit) query.append('limit', limit.toString());
    return apiRequest<any>(`/pay-register/employees/${month}${query.toString() ? `?${query.toString()}` : ''}`, {
      method: 'GET',
    });
  },

  exportPayRegisterSummary: async (params: {
    month: string;
    departmentId?: string;
    divisionId?: string;
  }) => {
    const query = new URLSearchParams();
    query.append('month', params.month);
    if (params.departmentId) query.append('departmentId', params.departmentId);
    if (params.divisionId) query.append('divisionId', params.divisionId);

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}/pay-register/export-summary/${params.month}?${query.toString()}`, {
      method: 'GET',
      credentials: 'include',
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to export pay register summary');
    }

    const blob = await response.blob();
    return blob;
  },

  uploadPayRegisterSummary: async (month: string, data: any[]) => {
    return apiRequest<any>(`/pay-register/upload-summary/${month}`, {
      method: 'POST',
      body: JSON.stringify({ data }),
    });
  },

  // Get attendance data for a range of months (NEW)
  getAttendanceDataRange: async (employeeId: string, startMonth: string, endMonth: string) => {
    const query = new URLSearchParams();
    query.append('employeeId', employeeId);
    query.append('startMonth', startMonth);
    query.append('endMonth', endMonth);
    return apiRequest<any>(`/payroll/attendance-range?${query.toString()}`, { method: 'GET' });
  },

  // Arrears APIs - Get all arrears
  getArrears: async (filters?: { status?: string; employeeId?: string; department?: string; page?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.employeeId) params.append('employeeId', filters.employeeId);
    if (filters?.department) params.append('department', filters.department);
    if (filters?.page) params.append('page', String(filters.page));
    if (filters?.limit) params.append('limit', String(filters.limit));
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<any>(`/arrears${query}`, { method: 'GET' });
  },

  // Get single arrears
  getArrearsById: async (id: string) => {
    return apiRequest<any>(`/arrears/${id}`, { method: 'GET' });
  },

  // Create arrears
  createArrears: async (data: any) => {
    return apiRequest<any>('/arrears', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Update arrears
  updateArrears: async (id: string, data: any) => {
    return apiRequest<any>(`/arrears/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // Get pending arrears for employee
  getPendingArrears: async (employeeId: string) => {
    return apiRequest<any>(`/arrears/employee/${employeeId}/pending`, { method: 'GET' });
  },

  // Get pending arrears approvals
  getPendingArrearsApprovals: async () => {
    return apiRequest<any>('/arrears/pending-approvals', { method: 'GET' });
  },

  // Process arrears action (approve/reject/forward)
  processArrearsAction: async (id: string, action: 'approve' | 'reject' | 'forward', comments?: string) => {
    return apiRequest<any>(`/arrears/${id}/action`, {
      method: 'PUT',
      body: JSON.stringify({ action, comments }),
    });
  },

  // Revoke arrears approval
  revokeArrearsApproval: async (id: string, reason?: string) => {
    return apiRequest<any>(`/arrears/${id}/revoke`, {
      method: 'PUT',
      body: JSON.stringify({ reason }),
    });
  },

  // Get arrears statistics
  getArrearsStats: async () => {
    return apiRequest<any>('/arrears/stats/summary', { method: 'GET' });
  },

  // Edit arrears details (at any approval level)
  editArrears: async (id: string, data: { startMonth?: string; endMonth?: string; monthlyAmount?: number; totalAmount?: number; reason?: string }) => {
    return apiRequest<any>(`/arrears/${id}/edit`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // Uploads (backend returns { success, url, key, filename } at top level; apiRequest spreads it)
  uploadEvidence: async (file: File): Promise<ApiResponse<{ url: string; key: string; filename: string }> & { url?: string; key?: string; filename?: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    return apiRequest<{ url: string; key: string; filename: string }>('/upload/evidence', {
      method: 'POST',
      body: formData,
    }) as Promise<ApiResponse<{ url: string; key: string; filename: string }> & { url?: string; key?: string; filename?: string }>;
  },

  uploadProfile: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiRequest<{ url: string; filename: string }>('/upload/profile', {
      method: 'POST',
      body: formData,
    });
  },

  // Transition arrears to next approval level (SuperAdmin)
  transitionArrears: async (id: string, nextStatus: string, data?: { startMonth?: string; endMonth?: string; monthlyAmount?: number; totalAmount?: number; reason?: string; comments?: string }) => {
    return apiRequest<any>(`/arrears/${id}/transition`, {
      method: 'PUT',
      body: JSON.stringify({ nextStatus, ...data }),
    });
  },

  // Manual Deductions APIs (same flow as arrears, but applied as deduction)
  getManualDeductions: async (filters?: { status?: string; employee?: string; department?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.employee) params.append('employee', filters.employee);
    if (filters?.department) params.append('department', filters.department);
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<any>(`/manual-deductions${query}`, { method: 'GET' });
  },
  getDeductionById: async (id: string) => apiRequest<any>(`/manual-deductions/${id}`, { method: 'GET' }),
  createDeduction: async (data: any) => apiRequest<any>('/manual-deductions', { method: 'POST', body: JSON.stringify(data) }),
  createDeductionsBulk: async (items: Array<{ employee: string; amount: number; reason?: string; remarks?: string }>) =>
    apiRequest<any>('/manual-deductions/bulk', { method: 'POST', body: JSON.stringify({ items }) }),
  bulkApproveDeductions: async (ids: string[]) =>
    apiRequest<any>('/manual-deductions/bulk-approve', { method: 'PUT', body: JSON.stringify({ ids }) }),
  updateDeduction: async (id: string, data: any) => apiRequest<any>(`/manual-deductions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getPendingDeductions: async (employeeId: string) => apiRequest<any>(`/manual-deductions/employee/${employeeId}/pending`, { method: 'GET' }),
  getPendingDeductionApprovals: async () => apiRequest<any>('/manual-deductions/pending-approvals', { method: 'GET' }),
  processDeductionAction: async (id: string, approved: boolean, comments?: string, modifiedAmount?: number) => apiRequest<any>(`/manual-deductions/${id}/action`, {
    method: 'PUT',
    body: JSON.stringify({ approved, comments, modifiedAmount }),
  }),
  submitDeductionForApproval: async (id: string) => apiRequest<any>(`/manual-deductions/${id}/submit`, { method: 'PUT' }),
  cancelDeduction: async (id: string) => apiRequest<any>(`/manual-deductions/${id}/cancel`, { method: 'PUT' }),
  revokeDeductionApproval: async (id: string, reason?: string) => apiRequest<any>(`/manual-deductions/${id}/revoke`, { method: 'PUT', body: JSON.stringify({ reason }) }),
  getDeductionStats: async () => apiRequest<any>('/manual-deductions/stats/summary', { method: 'GET' }),
  editDeduction: async (id: string, data: { startMonth?: string; endMonth?: string; monthlyAmount?: number; totalAmount?: number; reason?: string }) =>
    apiRequest<any>(`/manual-deductions/${id}/edit`, { method: 'PUT', body: JSON.stringify(data) }),
  transitionDeduction: async (id: string, nextStatus: string, data?: Record<string, unknown>) =>
    apiRequest<any>(`/manual-deductions/${id}/transition`, { method: 'PUT', body: JSON.stringify({ nextStatus, ...data }) }),
  getDeductionsForPayroll: async (params?: { employeeId?: string; month?: string; year?: string }) => {
    const q = new URLSearchParams();
    if (params?.employeeId) q.append('employeeId', params.employeeId);
    if (params?.month) q.append('month', params.month);
    if (params?.year) q.append('year', params.year);
    return apiRequest<any>(`/manual-deductions/for-payroll?${q.toString()}`, { method: 'GET' });
  },

  // Workflows
  // (Workflow methods moved up to avoid duplicates)
  // Activity Feed
  getRecentActivity: async () => {
    return apiRequest<any>('/attendance/activity/recent', { method: 'GET' });
  },

  // Live Attendance
  getLiveAttendanceReport: async (params?: { date?: string; division?: string; department?: string; shift?: string }) => {
    const query = new URLSearchParams();
    if (params?.date) query.append('date', params.date);
    if (params?.division) query.append('division', params.division);
    if (params?.department) query.append('department', params.department);
    if (params?.shift) query.append('shift', params.shift);
    const queryString = query.toString() ? `?${query.toString()}` : '';
    return apiRequest<LiveAttendanceReportData>(`/attendance/reports/live${queryString}`, { method: 'GET' });
  },

  getLiveAttendanceFilterOptions: async () => {
    return apiRequest<{
      divisions: LiveAttendanceFilterOption[];
      departments: LiveAttendanceFilterOption[];
      shifts: LiveAttendanceFilterOption[];
    }>('/attendance/reports/live/filters', { method: 'GET' });
  },

  // Security Gate Pass
  getTodayPermissions: async () => {
    return apiRequest<any>('/security/permissions/today', { method: 'GET' });
  },

  verifyGatePass: async (qrSecret: string) => {
    return apiRequest<any>('/security/verify', {
      method: 'POST',
      body: JSON.stringify({ qrSecret }),
    });
  },

  generateGateOutQR: async (permissionId: string) => {
    return apiRequest<any>(`/security/gate-pass/out/${permissionId}`, { method: 'POST' });
  },

  generateGateInQR: async (permissionId: string) => {
    return apiRequest<any>(`/security/gate-pass/in/${permissionId}`, { method: 'POST' });
  },

  // ==========================================
  // BONUS MANAGEMENT APIs
  // ==========================================

  getBonusPolicies: async () => {
    return apiRequest<BonusPolicy[]>('/bonus/policies', { method: 'GET' });
  },

  getBonusPolicy: async (id: string) => {
    return apiRequest<BonusPolicy>(`/bonus/policies/${id}`, { method: 'GET' });
  },

  createBonusPolicy: async (data: Partial<BonusPolicy>) => {
    return apiRequest<BonusPolicy>('/bonus/policies', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateBonusPolicy: async (id: string, data: Partial<BonusPolicy>) => {
    return apiRequest<BonusPolicy>(`/bonus/policies/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  deleteBonusPolicy: async (id: string) => {
    return apiRequest<void>(`/bonus/policies/${id}`, { method: 'DELETE' });
  },

  getBonusBatches: async (filters?: { startMonth?: string; endMonth?: string; department?: string; division?: string }) => {
    const query = filters ? '?' + new URLSearchParams(filters as any).toString() : '';
    return apiRequest<BonusBatch[]>(`/bonus/batches${query}`, { method: 'GET' });
  },

  createBonusBatch: async (data: { startMonth: string; endMonth: string; policyId: string; departmentId?: string; divisionId?: string }) => {
    return apiRequest<BonusBatch>('/bonus/batches', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getBonusBatch: async (id: string) => {
    return apiRequest<{ batch: BonusBatch; records: BonusRecord[] }>(`/bonus/batches/${id}`, { method: 'GET' });
  },

  updateBonusBatchStatus: async (id: string, status: 'approved' | 'frozen') => {
    return apiRequest<BonusBatch>(`/bonus/batches/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
  },

  requestBonusRecalculation: async (id: string, reason: string) => {
    return apiRequest<BonusBatch>(`/bonus/batches/${id}/recalculate-request`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  updateBonusRecord: async (id: string, data: { finalBonus: number; remarks?: string }) => {
    return apiRequest<BonusRecord>(`/bonus/records/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // Bulk Employee A&D Update
  downloadEmployeeADUpdateTemplate: async () => {
    return api.downloadAllowanceDeductionTemplate();
  },

  updateEmployeeADBulk: async (data: FormData) => {
    return apiRequest<any>('/allowances-deductions/bulk-update', {
      method: 'POST',
      body: data,
    });
  },

  // Bulk Employee Update (backend: /api/salary-updates/bulk-update/*)
  downloadEmployeeUpdateTemplate: async (fields?: string[]) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    let url = `${API_BASE_URL}/salary-updates/bulk-update/template`;
    if (fields && fields.length > 0) {
      url += `?fields=${encodeURIComponent(fields.join(','))}`;
    }
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) throw new Error('Failed to download template');
    const blob = await response.blob();
    if (typeof window !== 'undefined' && window.URL && document) {
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = 'EmployeeUpdateTemplate.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(objectUrl);
      document.body.removeChild(a);
    }
    return blob;
  },

  updateEmployeeBulk: async (data: FormData) => {
    return apiRequest<any>('/salary-updates/bulk-update/upload', {
      method: 'POST',
      body: data,
    });
  },

  // Second Salary Bulk Update
  downloadSecondSalaryTemplate: async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const response = await fetch(`${API_BASE_URL}/salary-updates/second-salary/template`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) throw new Error('Failed to download template');
    return response.blob();
  },

  updateSecondSalaryBulk: async (data: FormData) => {
    return apiRequest<any>('/salary-updates/second-salary/upload', {
      method: 'POST',
      body: data,
    });
  },

  exportSecondSalaryExcel: async (params: {
    month: string;
    departmentId?: string;
    divisionId?: string;
    employeeIds?: string[];
    search?: string;
  }) => {
    const query = new URLSearchParams();
    query.append('month', params.month);
    if (params.departmentId) query.append('departmentId', params.departmentId);
    if (params.divisionId) query.append('divisionId', params.divisionId);
    if (params.search) query.append('search', params.search);
    if (params.employeeIds && params.employeeIds.length > 0) {
      query.append('employeeIds', params.employeeIds.join(','));
    }

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}/second-salary/export?${query.toString()}`, {
      method: 'GET',
      credentials: 'include',
      headers,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to export second salary');
    }

    const blob = await response.blob();
    return blob;
  },

  exportSalaryComparisonExcel: async (params: {
    month: string;
    departmentId?: string;
    divisionId?: string;
    designationId?: string;
    search?: string;
  }) => {
    const query = new URLSearchParams();
    query.append('month', params.month);
    if (params.departmentId) query.append('departmentId', params.departmentId);
    if (params.divisionId) query.append('divisionId', params.divisionId);
    if (params.designationId) query.append('designationId', params.designationId);
    if (params.search) query.append('search', params.search);

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}/second-salary/comparison/export?${query.toString()}`, {
      method: 'GET',
      credentials: 'include',
      headers,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to export salary comparison');
    }

    const blob = await response.blob();
    return blob;
  },

  getJobStatus: async (jobId: string, queue: string = 'payroll') => {
    return apiRequest<any>(`/jobs/status/${jobId}?queue=${queue}`, { method: 'GET' });
  },

  // ==========================================
  // LEAVE POLICY SETTINGS
  // ==========================================

  getLeavePolicySettings: async () => {
    return apiRequest<any>('/settings/leave-policy', { method: 'GET' });
  },

  updateLeavePolicySettings: async (data: any) => {
    return apiRequest<any>('/settings/leave-policy', {
      method: 'PUT',
      body: JSON.stringify(data),
      headers: {
        'Content-Type': 'application/json'
      }
    });
  },

  resetLeavePolicySettings: async () => {
    return apiRequest<any>('/settings/leave-policy/reset', {
      method: 'POST'
    });
  },

  previewELCalculation: async (data: { employeeId: string; month: number; year: number }) => {
    return apiRequest<any>('/settings/leave-policy/preview', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // ==========================================
  // ANNUAL CL RESET API
  // ==========================================

  performAnnualCLReset: async (data: { targetYear?: number; confirmReset?: boolean }) => {
    return apiRequest<any>('/leaves/annual-reset', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  getCLResetStatus: async (filters?: { employeeIds?: string; departmentId?: string; divisionId?: string }) => {
    const params = new URLSearchParams();
    if (filters?.employeeIds) params.append('employeeIds', filters.employeeIds);
    if (filters?.departmentId) params.append('departmentId', filters.departmentId);
    if (filters?.divisionId) params.append('divisionId', filters.divisionId);
    const query = params.toString() ? `?${params.toString()}` : '';

    return apiRequest<any>(`/leaves/annual-reset/status${query}`, { method: 'GET' });
  },

  getNextCLResetDate: async () => {
    return apiRequest<any>('/leaves/annual-reset/next-date', { method: 'GET' });
  },

  previewAnnualReset: async (data: { sampleSize?: number }) => {
    return apiRequest<any>('/leaves/annual-reset/preview', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  /** Apply initial CL balance from policy to all employees (manual; creates ADJUSTMENT transactions). Not the annual reset. */
  performInitialCLSync: async (confirm: boolean = true) => {
    return apiRequest<any>('/leaves/initial-cl-sync', {
      method: 'POST',
      body: JSON.stringify({ confirm }),
    });
  },

  initLeavePolicySettings: async () => {
    return apiRequest<any>('/settings/leave-policy/init', {
      method: 'POST'
    });
  },

  // ==========================================
  // REPORTS API
  // ==========================================

  getAttendanceReportSummary: async (params: {
    startDate?: string;
    endDate?: string;
    employeeId?: string;
    departmentId?: string;
    divisionId?: string;
    page?: number;
    limit?: number;
    search?: string;
  }) => {
    const query = new URLSearchParams();
    if (params.startDate) query.append('startDate', params.startDate);
    if (params.endDate) query.append('endDate', params.endDate);
    if (params.employeeId) query.append('employeeId', params.employeeId);
    if (params.departmentId) query.append('departmentId', params.departmentId);
    if (params.divisionId) query.append('divisionId', params.divisionId);
    if (params.page) query.append('page', params.page.toString());
    if (params.limit) query.append('limit', params.limit.toString());
    if (params.search) query.append('search', params.search);

    return apiRequest<any>(`/attendance/reports/summary?${query.toString()}`, { method: 'GET' });
  },

  getThumbReports: async (params: {
    startDate?: string;
    endDate?: string;
    employeeId?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) => {
    const query = new URLSearchParams();
    if (params.startDate) query.append('startDate', params.startDate);
    if (params.endDate) query.append('endDate', params.endDate);
    if (params.employeeId) query.append('employeeId', params.employeeId);
    if (params.search) query.append('search', params.search);
    if (params.page) query.append('page', params.page.toString());
    if (params.limit) query.append('limit', params.limit.toString());

    return apiRequest<any>(`/attendance/reports/thumb?${query.toString()}`, { method: 'GET' });
  },

  exportAttendanceReport: async (params: {
    startDate: string;
    endDate: string;
    employeeId?: string;
    search?: string;
    departmentId?: string;
    divisionId?: string;
    strict?: boolean;
  }) => {
    const query = new URLSearchParams();
    query.append('startDate', params.startDate);
    query.append('endDate', params.endDate);
    if (params.employeeId) query.append('employeeId', params.employeeId);
    if (params.search) query.append('search', params.search);
    if (params.departmentId) query.append('departmentId', params.departmentId);
    if (params.divisionId) query.append('divisionId', params.divisionId);
    if (params.strict) query.append('strict', 'true');

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}/attendance/reports/export?${query.toString()}`, {
      method: 'GET',
      credentials: 'include',
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      let errorMsg = 'Failed to export report';
      try {
        const json = JSON.parse(text);
        errorMsg = json.message || errorMsg;
      } catch (e) { }
      throw new Error(errorMsg);
    }

    return await response.blob();
  },
};
