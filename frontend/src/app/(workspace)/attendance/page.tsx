'use client';



import { useState, useEffect, useRef, useMemo, type MouseEvent } from 'react';

import { api } from '@/lib/api';

import { formatHighlightContribution, highlightBadgeSubtitle } from '@/lib/attendanceHighlight';

import {
  normalizeCompleteSummaryColumns,
  workspaceVisibleCompleteKeys,
  type SuperadminCompleteAggregateKey,
  type WorkspaceCompleteAggregateKey,
} from '@/lib/attendanceCompleteAggregateColumns';

import { toast } from 'react-toastify';

import { useAuth } from '@/contexts/AuthContext';
import {
  canViewAttendance,
  canEditAttendance,  // Used as canManageAttendance
  isManagementRole
} from '@/lib/permissions';



interface AttendanceRecord {

  date: string;

  inTime: string | null;

  outTime: string | null;

  totalHours: number | null;

  status: 'PRESENT' | 'ABSENT' | 'PARTIAL' | 'LEAVE' | 'OD' | 'HALF_DAY' | 'HOLIDAY' | 'WEEK_OFF';

  shiftId?: { _id: string; name: string; startTime: string; endTime: string; duration: number; payableShifts?: number } | string | null;

  isLateIn?: boolean;

  isEarlyOut?: boolean;

  lateInMinutes?: number | null;

  earlyOutMinutes?: number | null;

  expectedHours?: number | null;

  hasLeave?: boolean;

  leaveInfo?: {

    leaveId: string;

    leaveType: string;

    isHalfDay: boolean;

    halfDayType?: string;

    purpose?: string;

    fromDate?: string;

    toDate?: string;

    numberOfDays?: number;

    dayInLeave?: number;

    appliedAt?: string;

    approvedBy?: { name: string; email?: string } | null;

    approvedAt?: string;

  } | null;

  hasOD?: boolean;

  odInfo?: {

    odId: string;

    odType: string;

    odType_extended?: 'full_day' | 'half_day' | 'hours' | null; // NEW: OD type

    isHalfDay: boolean;

    halfDayType?: string;

    purpose?: string;

    placeVisited?: string;

    fromDate?: string;

    toDate?: string;

    numberOfDays?: number;

    durationHours?: number; // NEW: Duration in hours for hour-based OD

    odStartTime?: string; // NEW: Start time for hour-based OD

    odEndTime?: string; // NEW: End time for hour-based OD

    dayInOD?: number;

    appliedAt?: string;

    approvedBy?: { name: string; email?: string } | null;

    approvedAt?: string;

  } | null;

  isConflict?: boolean;

  otHours?: number;

  extraHours?: number;

  permissionHours?: number;

  permissionCount?: number;

  shifts?: Array<{

    _id: string;

    shiftId: { _id: string; name: string; startTime: string; endTime: string } | string;

    inTime: string;

    outTime?: string;

    workingHours?: number;

    status?: string;

    lateInMinutes?: number;

    earlyOutMinutes?: number;

  }>;

  isEdited?: boolean;

  editHistory?: Array<{

    action: string;

    modifiedBy: string;

    modifiedByName?: string;

    modifiedAt: string;

    details: string;

  }>;

  source?: string[];

}



interface Employee {

  _id: string;

  emp_no: string;

  employee_name: string;

  department?: { _id: string; name: string };

  designation?: { _id: string; name: string };

  division?: { _id: string; name: string };

}



interface MonthlyAttendanceData {

  employee: Employee;

  dailyAttendance: Record<string, AttendanceRecord | null>;

  presentDays?: number;

  payableShifts?: number;

  summary?: {

    _id: string;

    employeeId: string;

    emp_no: string;

    month: string;

    year: number;

    totalLeaves: number;

    totalODs: number;

    totalWeeklyOffs?: number;

    totalHolidays?: number;

    totalPresentDays: number;

    totalDaysInMonth: number;

    totalPayableShifts: number;

    lateOrEarlyCount?: number;

    totalLateOrEarlyMinutes?: number;

    /** Policy-based (payroll-aligned) late/early + absent-extra deduction days */
    totalAttendanceDeductionDays?: number;

    attendanceDeductionBreakdown?: {
      lateInsCount?: number;
      earlyOutsCount?: number;
      combinedCount?: number;
      freeAllowedPerMonth?: number;
      effectiveCount?: number;
      daysDeducted?: number;
      lateEarlyDaysDeducted?: number;
      absentExtraDays?: number;
      absentDays?: number;
      lopDaysPerAbsent?: number | null;
      deductionType?: string | null;
      calculationMode?: string | null;
    };

    lastCalculatedAt: string;

    createdAt: string;

    updatedAt: string;

    contributingDates?: Record<string, Array<string | { date: string; value?: number; label?: string }>>;

  };

}



interface Department {

  _id: string;

  name: string;

  code?: string;

}



interface Designation {

  _id: string;

  name: string;

  department: string;

}



export default function AttendancePage() {

  const { user } = useAuth();

  const isEmployee = user?.role === 'employee';

  const isHR = !isEmployee;



  const [currentDate, setCurrentDate] = useState(new Date());



  // Helper to format time consistently
  const formatTime = (timeStr: string | null, showDateIfDifferent?: boolean, recordDate?: string) => {
    if (!timeStr) return '-';

    // Handle "HH:mm" or "HH:mm:ss" format directly (e.g. from legacy fields or raw input)
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(timeStr)) {
      const [hours, minutes] = timeStr.split(':').map(Number);
      const date = new Date();
      date.setHours(hours, minutes, 0, 0);
      return date.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata'
      });
    }

    try {
      const date = new Date(timeStr);
      if (isNaN(date.getTime())) return timeStr; // Fallback to raw string if invalid date

      const timeFormatted = date.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata'
      });

      // If showDateIfDifferent is true and recordDate is provided, check if dates differ
      if (showDateIfDifferent && recordDate) {
        // Use IST date for comparison
        const istDateStr = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(date);

        if (istDateStr !== recordDate) {
          const dateLabel = date.toLocaleDateString('en-IN', {
            month: 'short',
            day: 'numeric',
            timeZone: 'Asia/Kolkata'
          });
          return `${dateLabel}, ${timeFormatted}`;
        }
      }

      return timeFormatted;
    } catch {
      return timeStr;
    }
  };

  const appendHalfStatus = (base: string, marker: string) => {
    if (!marker) return base || '-';
    if (!base || base === '-') return marker;
    if (base === marker) return base;
    if (base === 'A') return marker;
    return `${base}/${marker}`;
  };

  const getBaseDisplayStatus = (record: AttendanceRecord | null) => {
    if (!record) return 'A';
    if (record.status === 'PRESENT') return 'P';
    if (record.status === 'HALF_DAY') return 'HD';
    if (record.status === 'PARTIAL') return 'PT';
    if (record.status === 'HOLIDAY') return 'H';
    if (record.status === 'WEEK_OFF') return 'WO';
    if (record.status === 'LEAVE' || record.hasLeave) {
      return (record.leaveInfo?.numberOfDays && record.leaveInfo.numberOfDays >= 3) ? 'LL' : 'L';
    }
    if (record.status === 'OD' || record.hasOD) return 'OD';
    return 'A';
  };

  const buildSplitCellStatus = (record: AttendanceRecord | null) => {
    if (!record) return null;

    const leaveInfo = record.leaveInfo;
    const odInfo = record.odInfo;

    const leaveMarker = leaveInfo ? ((leaveInfo.numberOfDays && leaveInfo.numberOfDays >= 3) ? 'LL' : 'L') : '';
    const odMarker = odInfo ? 'OD' : '';
    const hasHalfLeave = !!leaveInfo?.isHalfDay;
    const isHoursOD = !!(odInfo && odInfo.odType_extended === 'hours');
    const hasHalfOD = !!(odInfo && odInfo.odType_extended === 'half_day' && odInfo.isHalfDay);
    const hasFullLeave = !!(leaveInfo && !leaveInfo.isHalfDay);
    const hasFullOD = !!(odInfo && odInfo.odType_extended === 'full_day');

    const shouldSplit = !isHoursOD && (record.status === 'HALF_DAY' || hasHalfLeave || hasHalfOD);
    if (!shouldSplit) return null;

    let top = 'A';
    let bottom = 'A';

    if (record.status === 'PRESENT') {
      top = 'P';
      bottom = 'P';
    } else if (record.status === 'PARTIAL') {
      top = 'PT';
      bottom = 'PT';
    } else if (record.status === 'HALF_DAY') {
      const eo = Number(record.earlyOutMinutes) || 0;
      const li = Number(record.lateInMinutes) || 0;
      const workedHalf: 'first' | 'second' = eo > 120 ? 'first' : li > 120 ? 'second' : 'first';
      if (workedHalf === 'first') {
        top = 'HD';
        bottom = 'A';
      } else {
        top = 'A';
        bottom = 'HD';
      }
    }

    if (hasFullLeave && leaveMarker) {
      top = appendHalfStatus(top, leaveMarker);
      bottom = appendHalfStatus(bottom, leaveMarker);
    } else if (hasHalfLeave && leaveMarker) {
      if (leaveInfo?.halfDayType === 'second_half') bottom = appendHalfStatus(bottom, leaveMarker);
      else top = appendHalfStatus(top, leaveMarker);
    }

    if (hasFullOD && odMarker) {
      top = appendHalfStatus(top, odMarker);
      bottom = appendHalfStatus(bottom, odMarker);
    } else if (hasHalfOD && odMarker) {
      if (odInfo?.halfDayType === 'second_half') bottom = appendHalfStatus(bottom, odMarker);
      else top = appendHalfStatus(top, odMarker);
    }

    return { top, bottom };
  };

  const formatHalfTag = (halfDayType?: string | null) => {
    if (halfDayType === 'first_half') return '1H';
    if (halfDayType === 'second_half') return '2H';
    return 'HD';
  };

  const getLeaveCellLabel = (record: AttendanceRecord | null) => {
    if (!(record?.hasLeave || record?.status === 'LEAVE')) return '-';
    const base = (record?.leaveInfo?.numberOfDays && record.leaveInfo.numberOfDays >= 3) ? 'LL' : 'L';
    if (record?.leaveInfo?.isHalfDay) return `${base}-${formatHalfTag(record.leaveInfo.halfDayType)}`;
    return base;
  };

  const getODCellLabel = (record: AttendanceRecord | null) => {
    if (!(record?.hasOD || record?.status === 'OD')) return '-';
    if (record?.odInfo?.odType_extended === 'hours') {
      return `ODh${record.odInfo.durationHours != null ? `(${record.odInfo.durationHours}h)` : ''}`;
    }
    if (record?.odInfo?.isHalfDay || record?.odInfo?.odType_extended === 'half_day') {
      return `OD-${formatHalfTag(record.odInfo?.halfDayType)}`;
    }
    return 'OD';
  };



  const [showPayslipModal, setShowPayslipModal] = useState(false);

  const [selectedEmployeeForPayslip, setSelectedEmployeeForPayslip] = useState<Employee | null>(null);

  const [payslipData, setPayslipData] = useState<any>(null);

  const [loadingPayslip, setLoadingPayslip] = useState(false);

  const [calculatingPayroll, setCalculatingPayroll] = useState(false);

  const [monthlyData, setMonthlyData] = useState<MonthlyAttendanceData[]>([]);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [attendanceDetail, setAttendanceDetail] = useState<any>(null);

  const [showDetailDialog, setShowDetailDialog] = useState(false);

  const [attendanceData, setAttendanceData] = useState<Record<string, Record<string, AttendanceRecord | null>>>({});

  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  const [loading, setLoading] = useState(true);

  const [loadingAttendance, setLoadingAttendance] = useState(false);

  const [uploading, setUploading] = useState(false);

  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const [showUploadDialog, setShowUploadDialog] = useState(false);

  const [syncingShifts, setSyncingShifts] = useState(false);

  const [error, setError] = useState('');

  const [success, setSuccess] = useState('');

  const [showSummaryModal, setShowSummaryModal] = useState(false);

  const [selectedEmployeeForSummary, setSelectedEmployeeForSummary] = useState<Employee | null>(null);

  const [monthlySummary, setMonthlySummary] = useState<any>(null);

  const [loadingSummary, setLoadingSummary] = useState(false);

  // Pay period (same as superadmin)
  const [payrollCycleStartDay, setPayrollCycleStartDay] = useState<number | null>(null);
  const [payrollCycleEndDay, setPayrollCycleEndDay] = useState<number | null>(null);
  const [cycleDates, setCycleDates] = useState({ startDate: '', endDate: '', label: '' });

  // Filter states

  const [divisions, setDivisions] = useState<any[]>([]);

  const [departments, setDepartments] = useState<Department[]>([]);

  const [designations, setDesignations] = useState<Designation[]>([]);

  const [selectedDivision, setSelectedDivision] = useState<string>('');

  const [selectedDepartment, setSelectedDepartment] = useState<string>('');

  const [selectedDesignation, setSelectedDesignation] = useState<string>('');

  const [filteredMonthlyData, setFilteredMonthlyData] = useState<MonthlyAttendanceData[]>([]);



  // Search state

  const [showSearch, setShowSearch] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');



  // Pagination states for infinite scroll (NEW)

  const [page, setPage] = useState(1);

  const [limit, setLimit] = useState(50);

  const [totalPages, setTotalPages] = useState(1);

  const [totalCount, setTotalCount] = useState(0);

  const [loadingMore, setLoadingMore] = useState(false);

  const [hasMore, setHasMore] = useState(true);

  const observerTarget = useRef<HTMLDivElement>(null);  // NEW: Ref for IntersectionObserver

  const isFetchingRef = useRef(false); // NEW: Lock to prevent double-firing



  // Table type state

  const [tableType, setTableType] = useState<'complete' | 'present_absent' | 'in_out' | 'leaves' | 'od' | 'ot'>('complete');

  /** Organization Complete-table totals from attendance settings (superadmin-configured). */
  const [orgCompleteSummaryColumns, setOrgCompleteSummaryColumns] = useState<
    Record<SuperadminCompleteAggregateKey, boolean>
  >(() => normalizeCompleteSummaryColumns(undefined));

  // Employee view: table vs day cards

  const [employeeViewMode, setEmployeeViewMode] = useState<'table' | 'cards'>('cards');



  // OT conversion state

  const [convertingToOT, setConvertingToOT] = useState(false);

  const [hasExistingOT, setHasExistingOT] = useState(false);

  const [otRequestStatus, setOtRequestStatus] = useState<string | null>(null);



  // Type-specific summary state

  const [showTypeSummaryModal, setShowTypeSummaryModal] = useState(false);

  const [typeSummaryData, setTypeSummaryData] = useState<{ type: string; item: MonthlyAttendanceData } | null>(null);

  const [attendanceDeductionInfo, setAttendanceDeductionInfo] = useState<{
    employeeName: string;
    total: number;
    lateEarlyDays: number;
    absentDays: number;
  } | null>(null);

  const [activeHighlight, setActiveHighlight] = useState<{ employeeId: string; category: string } | null>(null);



  // Shift selection and out-time state

  const [availableShifts, setAvailableShifts] = useState<any[]>([]);

  const [loadingShifts, setLoadingShifts] = useState(false);

  const [selectedShiftId, setSelectedShiftId] = useState<string>('');

  const [editingShift, setEditingShift] = useState(false);

  const [outTimeInput, setOutTimeInput] = useState('');

  const [editingOutTime, setEditingOutTime] = useState(false);

  const [savingShift, setSavingShift] = useState(false);

  const [savingOutTime, setSavingOutTime] = useState(false);



  const [showOutTimeDialog, setShowOutTimeDialog] = useState(false);

  const [selectedRecordForOutTime, setSelectedRecordForOutTime] = useState<any>(null);

  const [selectedShiftRecordId, setSelectedShiftRecordId] = useState<string | null>(null);

  const [outTimeValue, setOutTimeValue] = useState('');

  const [updatingOutTime, setUpdatingOutTime] = useState(false);

  const [attendanceFeatureFlags, setAttendanceFeatureFlags] = useState<{
    allowInTimeEditing: boolean;
    allowOutTimeEditing: boolean;
    allowAttendanceUpload: boolean;
    allowShiftChange: boolean;
  }>({ allowInTimeEditing: true, allowOutTimeEditing: true, allowAttendanceUpload: true, allowShiftChange: true });

  const [showInTimeDialog, setShowInTimeDialog] = useState(false);
  const [selectedRecordForInTime, setSelectedRecordForInTime] = useState<any>(null);
  const [inTimeDialogValue, setInTimeDialogValue] = useState('');
  const [updatingInTime, setUpdatingInTime] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);

  // Leave conflict state

  const [leaveConflicts, setLeaveConflicts] = useState<any[]>([]);

  const [loadingConflicts, setLoadingConflicts] = useState(false);

  const [revokingLeave, setRevokingLeave] = useState(false);

  const [updatingLeave, setUpdatingLeave] = useState(false);



  const year = currentDate.getFullYear();

  const month = currentDate.getMonth() + 1;

  useEffect(() => {
    loadDivisions();
    loadDepartments();
  }, []); // Run on mount, relying on auth/permissions rather than workspace

  useEffect(() => {
    const loadFlags = async () => {
      try {
        const res = await api.getAttendanceSettings();
        if (res?.data?.featureFlags) {
          const ff = res.data.featureFlags;
          setAttendanceFeatureFlags({
            allowInTimeEditing: ff.allowInTimeEditing !== false,
            allowOutTimeEditing: ff.allowOutTimeEditing !== false,
            allowAttendanceUpload: ff.allowAttendanceUpload !== false,
            allowShiftChange: ff.allowShiftChange !== false,
          });
        }
        if (res?.data?.completeSummaryColumns) {
          setOrgCompleteSummaryColumns(normalizeCompleteSummaryColumns(res.data.completeSummaryColumns));
        }
      } catch {
        // keep defaults
      }
    };
    loadFlags();
  }, []);

  const loadPayrollSettings = async () => {
    try {
      const [startRes, endRes] = await Promise.all([
        api.getSetting('payroll_cycle_start_day'),
        api.getSetting('payroll_cycle_end_day')
      ]);

      if (startRes.success && startRes.data) {
        setPayrollCycleStartDay(parseInt(startRes.data.value, 10) || 1);
      }
      if (endRes.success && endRes.data) {
        setPayrollCycleEndDay(parseInt(endRes.data.value, 10) || 31);
      }
    } catch (err) {
      console.error('Error loading payroll settings:', err);
    }
  };

  useEffect(() => {
    loadPayrollSettings();
  }, []);

  useEffect(() => {
    if (payrollCycleStartDay != null && payrollCycleStartDay >= 1) {
      if (payrollCycleStartDay > 1) {
        let startYear = year;
        let startMonth = month - 1;
        if (startMonth === 0) {
          startMonth = 12;
          startYear = year - 1;
        }

        // Use payrollCycleEndDay if set, otherwise fallback to startDay - 1
        const endDay = payrollCycleEndDay || (payrollCycleStartDay - 1);
        const endDateObj = new Date(year, month - 1, endDay);
        const endYear = endDateObj.getFullYear();
        const endMonth = endDateObj.getMonth() + 1;
        const actualEndDay = endDateObj.getDate();

        const start = `${startYear}-${String(startMonth).padStart(2, '0')}-${String(payrollCycleStartDay).padStart(2, '0')}`;
        const end = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(actualEndDay).padStart(2, '0')}`;
        setCycleDates({ startDate: start, endDate: end, label: '' });
      } else {
        const start = `${year}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        // For calendar month, respects payrollCycleEndDay if it's less than lastDay
        const actualEndDay = Math.min(payrollCycleEndDay || 31, lastDay);
        const end = `${year}-${String(month).padStart(2, '0')}-${String(actualEndDay).padStart(2, '0')}`;
        setCycleDates({ startDate: start, endDate: end, label: '' });
      }
    }
  }, [year, month, payrollCycleStartDay, payrollCycleEndDay]);

  useEffect(() => {

    if (selectedDivision) {
      loadDepartments(selectedDivision);
    } else {
      // If no specific division is selected, reload the full allowed list
      loadDepartments();
      setSelectedDepartment('');
      setDesignations([]);
      setSelectedDesignation('');
    }

  }, [selectedDivision]);



  useEffect(() => {

    if (selectedDepartment) {

      loadDesignations(selectedDepartment);

    } else {

      setDesignations([]);

      setSelectedDesignation('');

    }

  }, [selectedDepartment]);



  useEffect(() => {
    if (isEmployee && user) {
      // Auto-select current employee

      const emp: Employee = {

        _id: user.id || (user as any)._id || '', // Handle different ID formats

        emp_no: user.emp_no || user.employeeId || '',

        employee_name: user.name,

        department: typeof user.department === 'object' ? user.department : undefined,

      };

      setSelectedEmployee(emp);
      // Load their specific attendance
      const fetchEmpAttendance = async () => {
        if (emp.emp_no) {
          setLoadingAttendance(true);
          try {
            const response = await api.getAttendanceCalendar(emp.emp_no, year, month);
            if (response.success) {
              setAttendanceData(prev => ({ ...prev, [emp._id]: response.data || {} }));
              // Populate monthlyData with just this employee so they see their own row
              setMonthlyData([{
                employee: emp,
                dailyAttendance: response.data || {}
              }]);
            }
          } catch (e) { console.error(e); }
          setLoadingAttendance(false);
        }
      }
      fetchEmpAttendance();

      // For employees, we load directly as they don't depend on custom cycle ranges for the initial view load
      setPage(1);
      setHasMore(true);
      loadMonthlyAttendance(true);
    }
    // Note: HR view is now handled by the [cycleDates.startDate] effect to avoid race conditions
  }, [year, month, isEmployee, user]);



  useEffect(() => {

    setActiveHighlight(null);

  }, [year, month, cycleDates.startDate, cycleDates.endDate]);



  // NEW: Reset page when filters change

  useEffect(() => {
    if (!cycleDates.startDate) return;
    
    // This is now the MAIN trigger for initial load and filter changes for HR
    if (!isEmployee) {
      setPage(1);
      setHasMore(true);
      loadMonthlyAttendance(true);
    }
  }, [selectedDivision, selectedDepartment, selectedDesignation, cycleDates.startDate, year, month]);



  // NEW: Handle Load More when page changes

  useEffect(() => {

    if (page > 1 && !isEmployee) {

      loadMonthlyAttendance(false);

    }

  }, [page]);



  // NEW: Intersection Observer for infinite scroll

  useEffect(() => {

    const observer = new IntersectionObserver(

      (entries) => {

        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore && !isFetchingRef.current) {
          setPage(prev => prev + 1);
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

  }, [hasMore, loading, loadingMore, page]);



  useEffect(() => {
    // Apply filters to monthly data
    let filtered = [...monthlyData];

    if (searchQuery) {

      const query = searchQuery.toLowerCase();

      filtered = filtered.filter(item =>

        item.employee.employee_name.toLowerCase().includes(query) ||

        item.employee.emp_no.toLowerCase().includes(query)

      );

    }

    setFilteredMonthlyData(filtered);
  }, [monthlyData, selectedDivision, selectedDepartment, selectedDesignation, searchQuery]);

  // Permission checks using read/write pattern
  // Write permission enables ALL actions (mark attendance, edit, export, assign shifts, process payroll)
  // Read permission blocks all actions (view only)
  // Future: When implementing granular permissions, only permissions.ts needs updating
  const hasViewPermission = user ? canViewAttendance(user as any) : false;
  const hasManagePermission = user ? canEditAttendance(user as any) : false; // Write permission for ALL actions


  const loadDivisions = async () => {
    try {
      const response = await api.getDivisions();
      console.log('api.getDivisions response:', response);
      if (response.success && response.data) {

        let divs = response.data;

        setDivisions(divs);

      }

    } catch (err) {

      console.error('Error loading divisions:', err);

    }

  };




  const loadDepartments = async (divisionId?: string) => {

    try {

      const response = await api.getDepartments(undefined, divisionId);

      if (response.success && response.data) {

        let depts = response.data;

        if (divisionId) {

          depts = depts.filter((d: any) =>

            d.division === divisionId ||

            (d.division?._id === divisionId) ||

            (Array.isArray(d.divisions) && d.divisions.some((div: any) => (typeof div === 'string' ? div : div._id) === divisionId))

          );

        }

        setDepartments(depts);

      }

    } catch (err) {

      console.error('Error loading departments:', err);

    }

  };



  const loadDesignations = async (departmentId: string) => {

    try {

      const response = await api.getDesignations(departmentId);

      if (response.success && response.data) {

        setDesignations(response.data);

      }

    } catch (err) {

      console.error('Error loading designations:', err);

    }

  };



  const loadMonthlyAttendance = async (reset: boolean = false) => {
    // 1. Guard against simultaneous fetches
    if (isFetchingRef.current) return;

    const targetPage = reset ? 1 : page;

    // 2. Guard against out-of-bounds page requests (unless resetting to 1)
    if (!reset && targetPage > totalPages && totalPages > 0) {
      setHasMore(false);
      return;
    }

    try {
      isFetchingRef.current = true;

      // Set appropriate loading state
      if (reset) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      const response = await api.getMonthlyAttendance(year, month, {
        page: targetPage,
        limit,
        search: searchQuery,
        divisionId: selectedDivision,
        departmentId: selectedDepartment,
        designationId: selectedDesignation,
        startDate: cycleDates.startDate || undefined,
        endDate: cycleDates.endDate || undefined
      });



      if (response.success) {

        const newData = response.data || [];



        if (reset) {

          setMonthlyData(newData);

        } else {

          // Append new data, filter out duplicates

          setMonthlyData(prev => {

            const existingIds = new Set(prev.map(i => i.employee._id));

            const uniqueNewData = newData.filter((i: any) => !existingIds.has(i.employee._id));

            return [...prev, ...uniqueNewData];

          });

        }



        // Update pagination status

        const pagInfo = (response as any).pagination;

        if (pagInfo) {

          setTotalPages(pagInfo.totalPages || 1);

          setTotalCount(pagInfo.total || 0);

          setHasMore(targetPage < pagInfo.totalPages);

        } else {

          setHasMore(false);

        }

      } else {

        setError(response.message || 'Failed to load monthly attendance');

      }

    } catch (err: any) {

      console.error('Error loading monthly attendance:', err);

      setError(err.message || 'Failed to load monthly attendance');

    } finally {
      if (reset) setLoading(false);
      setLoadingMore(false);
      isFetchingRef.current = false; // Reset lock
    }

  };



  const loadAllEmployeesAttendance = async () => {

    try {

      setLoadingAttendance(true);

      setError('');

      const response = await api.getMonthlyAttendance(year, month, {
        startDate: cycleDates.startDate || undefined,
        endDate: cycleDates.endDate || undefined
      });

      if (response.success) {

        // Convert monthly data to calendar format for all employees

        const calendarData: Record<string, Record<string, AttendanceRecord | null>> = {};

        (response.data || []).forEach((item: MonthlyAttendanceData) => {

          // Apply filters

          if (selectedDepartment && item.employee.department?._id !== selectedDepartment) return;

          if (selectedDesignation && item.employee.designation?._id !== selectedDesignation) return;



          // Store dailyAttendance for this employee

          calendarData[item.employee._id] = item.dailyAttendance;

        });

        setAttendanceData(calendarData);

        setMonthlyData(response.data || []);

      } else {

        setError(response.message || 'Failed to load attendance');

      }

    } catch (err: any) {

      console.error('Error loading attendance:', err);

      setError(err.message || 'Failed to load attendance');

    } finally {

      setLoadingAttendance(false);

    }

  };



  const loadAttendance = async () => {

    if (!selectedEmployee) return;



    try {

      setLoadingAttendance(true);

      const response = await api.getAttendanceCalendar(selectedEmployee.emp_no, year, month);

      if (response.success) {

        setAttendanceData(response.data || {});

      }

    } catch (err) {

      console.error('Error loading attendance:', err);

      setError('Failed to load attendance data');

    } finally {

      setLoadingAttendance(false);

    }

  };



  const loadAvailableShifts = async (employeeNumber: string, date: string) => {

    try {

      setLoadingShifts(true);

      const response = await api.getAvailableShifts(employeeNumber, date);

      if (response.success && response.data) {

        setAvailableShifts(response.data);

      }

    } catch (err) {

      console.error('Error loading available shifts:', err);

    } finally {

      setLoadingShifts(false);

    }

  };



  const handleAssignShift = async () => {

    if (!selectedEmployee || !selectedDate || !selectedShiftId) {

      setError('Please select a shift');

      return;

    }



    try {

      setSavingShift(true);

      setError('');

      setSuccess('');



      const response = await api.assignShiftToAttendance(
        selectedEmployee.emp_no,
        selectedDate,
        selectedShiftId,
        selectedShiftRecordId || undefined
      );



      if (response.success) {

        setSuccess('Shift assigned successfully!');

        setEditingShift(false);

        setSelectedShiftId('');



        // Optimistic update: mark as manually edited

        setMonthlyData(prevData => prevData.map(empData => {

          if (empData.employee.emp_no === selectedEmployee.emp_no) {

            const updatedDaily = { ...empData.dailyAttendance };

            if (updatedDaily[selectedDate]) {

              const record = updatedDaily[selectedDate];

              if (record) {

                const newSource = record.source ? [...record.source] : [];

                if (!newSource.includes('manual')) newSource.push('manual');

                updatedDaily[selectedDate] = { ...record, source: newSource };

              }

            }

            return { ...empData, dailyAttendance: updatedDaily };

          }

          return empData;

        }));



        // Reload attendance detail and monthly data

        await loadMonthlyAttendance();



        // Refresh the detail view

        const updatedResponse = await api.getAttendanceDetail(selectedEmployee.emp_no, selectedDate);

        if (updatedResponse.success) {

          setAttendanceDetail(updatedResponse.data);

        }



        setTimeout(() => {

          setSuccess('');

        }, 2000);

      } else {

        setError(response.message || 'Failed to assign shift');

      }

    } catch (err: any) {

      console.error('Error assigning shift:', err);

      setError(err.message || 'An error occurred while assigning shift');

    } finally {

      setSavingShift(false);

    }

  };



  const handleSaveOutTime = async () => {

    if (!selectedEmployee || !selectedDate || !outTimeInput) {

      setError('Please enter out-time');

      return;

    }



    try {

      setSavingOutTime(true);

      setError('');

      setSuccess('');



      // Combine date with time to create proper datetime string

      const [hours, mins] = outTimeInput.split(':').map(Number);
      const date = new Date(selectedDate);
      date.setHours(hours, mins, 0, 0);
      const outTimeDateTime = date.toISOString();



      const response = await api.updateAttendanceOutTime(
        selectedEmployee.emp_no,
        selectedDate,
        outTimeDateTime,
        selectedShiftRecordId || undefined
      );



      if (response.success) {

        setSuccess('Out-time updated successfully!');

        setEditingOutTime(false);

        setOutTimeInput('');



        // Optimistic update: mark as manually edited

        setMonthlyData(prevData => prevData.map(empData => {

          if (empData.employee.emp_no === selectedEmployee.emp_no) {

            const updatedDaily = { ...empData.dailyAttendance };

            if (updatedDaily[selectedDate]) {

              const record = updatedDaily[selectedDate];

              if (record) {

                const newSource = record.source ? [...record.source] : [];

                if (!newSource.includes('manual')) newSource.push('manual');

                updatedDaily[selectedDate] = { ...record, source: newSource };

              }

            }

            return { ...empData, dailyAttendance: updatedDaily };

          }

          return empData;

        }));



        // Reload attendance detail and monthly data

        await loadMonthlyAttendance();



        // Refresh the detail view

        const updatedResponse = await api.getAttendanceDetail(selectedEmployee.emp_no, selectedDate);

        if (updatedResponse.success) {

          setAttendanceDetail(updatedResponse.data);

        }



        setTimeout(() => {

          setSuccess('');

        }, 2000);

      } else {

        setError(response.message || 'Failed to update out-time');

      }

    } catch (err: any) {

      console.error('Error updating out-time:', err);

      setError(err.message || 'An error occurred while updating out-time');

    } finally {

      setSavingOutTime(false);

    }

  };



  const loadLeaveConflicts = async (employeeNumber: string, date: string) => {

    try {

      setLoadingConflicts(true);

      const response = await api.getLeaveConflicts(employeeNumber, date);

      if (response.success && response.data) {

        setLeaveConflicts(response.data);

      } else {

        setLeaveConflicts([]);

      }

    } catch (err) {

      console.error('Error loading leave conflicts:', err);

      setLeaveConflicts([]);

    } finally {

      setLoadingConflicts(false);

    }

  };



  const handleRevokeLeave = async (leaveId: string) => {

    if (!selectedEmployee || !selectedDate) return;



    try {

      setRevokingLeave(true);

      setError('');

      setSuccess('');



      const response = await api.revokeLeaveForAttendance(leaveId);



      if (response.success) {

        setSuccess('Leave revoked successfully!');

        setLeaveConflicts([]);



        // Reload attendance detail and monthly data

        await loadMonthlyAttendance();



        // Refresh the detail view

        const updatedResponse = await api.getAttendanceDetail(selectedEmployee.emp_no, selectedDate);

        if (updatedResponse.success) {

          setAttendanceDetail(updatedResponse.data);

        }



        // Reload conflicts

        await loadLeaveConflicts(selectedEmployee.emp_no, selectedDate);



        setTimeout(() => {

          setSuccess('');

        }, 3000);

      } else {

        setError(response.message || 'Failed to revoke leave');

      }

    } catch (err: any) {

      console.error('Error revoking leave:', err);

      setError(err.message || 'An error occurred while revoking leave');

    } finally {

      setRevokingLeave(false);

    }

  };



  const handleUpdateLeave = async (leaveId: string) => {

    if (!selectedEmployee || !selectedDate) return;



    try {

      setUpdatingLeave(true);

      setError('');

      setSuccess('');



      const response = await api.updateLeaveForAttendance(leaveId, selectedEmployee.emp_no, selectedDate);



      if (response.success) {

        setSuccess(response.message || 'Leave updated successfully!');

        setLeaveConflicts([]);



        // Reload attendance detail and monthly data

        await loadMonthlyAttendance();



        // Refresh the detail view

        const updatedResponse = await api.getAttendanceDetail(selectedEmployee.emp_no, selectedDate);

        if (updatedResponse.success) {

          setAttendanceDetail(updatedResponse.data);

        }



        // Reload conflicts

        await loadLeaveConflicts(selectedEmployee.emp_no, selectedDate);



        setTimeout(() => {

          setSuccess('');

        }, 3000);

      } else {

        setError(response.message || 'Failed to update leave');

      }

    } catch (err: any) {

      console.error('Error updating leave:', err);

      setError(err.message || 'An error occurred while updating leave');

    } finally {

      setUpdatingLeave(false);

    }

  };



  const handleDateClick = async (employee: Employee, date: string) => {

    setSelectedDate(date);

    setSelectedEmployee(employee);

    setHasExistingOT(false);

    setOtRequestStatus(null);

    setEditingShift(false);

    setEditingOutTime(false);

    setSelectedShiftId('');

    setOutTimeInput('');

    setLeaveConflicts([]);



    try {

      // Load available shifts for this employee/date

      await loadAvailableShifts(employee.emp_no, date);



      // Load leave conflicts

      await loadLeaveConflicts(employee.emp_no, date);



      // Get the daily attendance record from monthly data if available

      const employeeData = monthlyData.find(item => item.employee._id === employee._id);

      const dayRecord = employeeData?.dailyAttendance[date];



      // Check if OT already exists (pending or approved) - hide Convert button
      try {
        const otResponse = await api.getOTRequests({
          employeeId: employee._id,
          employeeNumber: employee.emp_no,
          date: date,
          // No status filter = get all; we consider pending/approved as "has OT"
        });
        const existing = (otResponse.data || []).filter((ot: any) =>
          ['pending', 'approved', 'manager_approved', 'hod_approved'].includes(ot?.status)
        );
        if (existing.length > 0) {
          setHasExistingOT(true);
          setOtRequestStatus(existing[0]?.status || null);
        } else {
          setHasExistingOT(false);
          setOtRequestStatus(null);
        }
      } catch (otErr) {
        console.error('Error checking existing OT:', otErr);
        setHasExistingOT(false);
        setOtRequestStatus(null);
      }



      // If we have the record with leave/OD info, use it directly

      if (dayRecord) {

        console.log('Day record from monthly data:', dayRecord);

        console.log('Leave info:', dayRecord.leaveInfo);

        setAttendanceDetail(dayRecord);

        setShowDetailDialog(true);

      } else {

        // Otherwise fetch from API

        const response = await api.getAttendanceDetail(employee.emp_no, date);

        if (response.success) {

          console.log('Day record from API:', response.data);

          setAttendanceDetail(response.data);

          setShowDetailDialog(true);

        }

      }

    } catch (err) {

      console.error('Error loading attendance detail:', err);

      setError('Failed to load attendance detail');

    }

  };



  const handleConvertExtraHoursToOT = async () => {

    if (!selectedEmployee || !selectedDate || !attendanceDetail) {

      setError('Missing employee or date information');

      return;

    }



    if (!attendanceDetail.extraHours || attendanceDetail.extraHours <= 0) {

      setError('No extra hours to convert');

      return;

    }



    if (hasExistingOT) {

      setError('OT record already exists for this date');

      return;

    }



    if (!attendanceDetail.shiftId) {

      setError('Shift not assigned. Please assign shift first.');

      return;

    }



    if (!confirm(`Convert ${attendanceDetail.extraHours.toFixed(2)} extra hours to OT for ${selectedDate}?`)) {

      return;

    }



    try {

      setConvertingToOT(true);

      setError('');

      setSuccess('');



      const response = await api.convertExtraHoursToOT({

        employeeId: selectedEmployee._id,

        employeeNumber: selectedEmployee.emp_no,

        date: selectedDate,

      });



      if (response.success) {

        setSuccess(response.message || 'OT conversion requested. Pending management approval.');

        setHasExistingOT(true);

        setOtRequestStatus('pending');



        // Keep extraHours visible until OT is approved; do not clear them here

        // Reload monthly attendance to refresh the view

        await loadMonthlyAttendance();

      } else {

        setError(response.message || 'Failed to convert extra hours to OT');

      }

    } catch (err: any) {

      console.error('Error converting extra hours to OT:', err);

      setError(err.message || 'An error occurred while converting');

    } finally {

      setConvertingToOT(false);

    }

  };



  const navigateMonth = (direction: 'prev' | 'next') => {

    setCurrentDate(prev => {

      const newDate = new Date(prev);

      if (direction === 'prev') {

        newDate.setMonth(newDate.getMonth() - 1);

      } else {

        newDate.setMonth(newDate.getMonth() + 1);

      }

      return newDate;

    });

  };



  const handleExcelUpload = async () => {

    if (!uploadFile) {

      setError('Please select a file to upload');

      return;

    }



    try {

      setUploading(true);

      setError('');

      setSuccess('');

      const response = await api.uploadAttendanceExcel(uploadFile);

      if (response.success) {

        if (response.isAsync) {

          // Large file, processing in background

          toast.info(response.data.message || 'Processing started in background');

        } else {

          toast.success(response.message || 'File uploaded successfully');

          loadMonthlyAttendance();

        }



        setUploadFile(null);

        setShowUploadDialog(false);

        const fileInput = document.getElementById('excel-upload-input') as HTMLInputElement;

        if (fileInput) fileInput.value = '';

      } else {

        toast.error(response.message || 'Upload failed');

        setError(response.message || 'Upload failed');

      }

    } catch (err: any) {

      setError(err.message || 'An error occurred during upload');

    } finally {

      setUploading(false);

    }

  };



  const handleDownloadTemplate = async () => {

    try {

      await api.downloadAttendanceTemplate();

      setSuccess('Template downloaded successfully');

    } catch (err) {

      setError('Failed to download template');

    }

  };



  const handleViewPayslip = async (employee: Employee) => {

    setSelectedEmployeeForPayslip(employee);

    setShowPayslipModal(true);

    setLoadingPayslip(true);

    setPayslipData(null);

    setError('');



    try {

      const monthStr = `${year}-${String(month).padStart(2, '0')}`;

      const response = await api.getPayslip(employee._id, monthStr);



      if (response.success && response.data) {

        setPayslipData(response.data);

      } else {

        // If payslip doesn't exist, offer to calculate

        setError('Payslip not found. Would you like to calculate payroll?');

      }

    } catch (err: any) {

      console.error('Error loading payslip:', err);

      if (err.message?.includes('not found') || err.message?.includes('404')) {

        setError('Payslip not found. Would you like to calculate payroll?');

      } else {

        setError('Failed to load payslip');

      }

    } finally {

      setLoadingPayslip(false);

    }

  };



  const handleCalculatePayroll = async () => {

    if (!selectedEmployeeForPayslip) return;



    try {

      setCalculatingPayroll(true);

      setError('');

      const monthStr = `${year}-${String(month).padStart(2, '0')}`;

      const response = await api.calculatePayroll(selectedEmployeeForPayslip._id, monthStr);



      if (response.success) {

        toast.success('Payroll calculated successfully!');

        // Reload payslip

        const payslipResponse = await api.getPayslip(selectedEmployeeForPayslip._id, monthStr);

        if (payslipResponse.success && payslipResponse.data) {

          setPayslipData(payslipResponse.data);

          setError('');

        }

      } else {

        const errorMsg = response.message || 'Failed to calculate payroll';

        setError(errorMsg);

        toast.error(errorMsg);

      }

    } catch (err: any) {

      console.error('Error calculating payroll:', err);

      setError(err.message || 'Failed to calculate payroll');

    } finally {

      setCalculatingPayroll(false);

    }

  };



  const handleEmployeeClick = async (employee: Employee) => {

    setSelectedEmployeeForSummary(employee);

    setShowSummaryModal(true);

    setLoadingSummary(true);

    try {

      // First try to get summary from the monthly data if available

      const employeeData = monthlyData.find(item => item.employee._id === employee._id);

      if (employeeData && employeeData.summary) {

        setMonthlySummary(employeeData.summary);

        setLoadingSummary(false);

        return;

      }



      // If not in monthly data, fetch from API

      const monthStr = `${year}-${String(month).padStart(2, '0')}`;

      const response = await api.getMonthlySummary(employee._id, monthStr);

      if (response.success) {

        setMonthlySummary(response.data);

      } else {

        setError('Failed to load monthly summary');

      }

    } catch (err: any) {

      console.error('Error loading monthly summary:', err);

      setError('Failed to load monthly summary');

    } finally {

      setLoadingSummary(false);

    }

  };



  const handleViewTypeSummary = (item: MonthlyAttendanceData, type: string) => {

    setTypeSummaryData({ item, type });

    setShowTypeSummaryModal(true);

  };



  const handleSummaryClick = (employeeId: string, category: string) => {

    setActiveHighlight((prev) => {

      if (prev?.employeeId === employeeId && prev?.category === category) return null;

      return { employeeId, category };

    });

  };



  const openAttendanceDeductionInfo = (
    e: MouseEvent<HTMLTableCellElement>,
    item: MonthlyAttendanceData
  ) => {
    e.stopPropagation();
    const breakdown = item.summary?.attendanceDeductionBreakdown || {};
    const total = Number(item.summary?.totalAttendanceDeductionDays ?? breakdown.daysDeducted ?? 0);
    const absentDays = Number(breakdown.absentExtraDays ?? 0);
    const lateEarlyDays = Number(breakdown.lateEarlyDaysDeducted ?? 0);
    setAttendanceDeductionInfo({
      employeeName: item.employee.employee_name,
      total,
      lateEarlyDays,
      absentDays,
    });
  };

  const onSummaryMetricClick = (

    e: MouseEvent<HTMLTableCellElement>,

    employeeId: string,

    apiCategory: string,

    modalType: string,

    item: MonthlyAttendanceData

  ) => {

    if (e.altKey) {

      handleViewTypeSummary(item, modalType);

      return;

    }

    handleSummaryClick(employeeId, apiCategory);

  };



  const handleExportPDF = async () => {
    try {
      setExportingPDF(true);
      setError('');
      setSuccess('');

      const params = {
        year: String(year),
        month: String(month),
        search: searchQuery,
        divisionId: selectedDivision,
        departmentId: selectedDepartment,
        designationId: selectedDesignation,
        startDate: cycleDates.startDate,
        endDate: cycleDates.endDate,
        groupBy: 'employee'
      };

      const blob = await api.exportAttendanceReportPDF(params);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance_report_${year}_${month}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      toast.success('PDF report downloaded successfully');
    } catch (err: any) {
      console.error('PDF Export error:', err);
      toast.error(err.message || 'Failed to export PDF');
      setError(err.message || 'Failed to export PDF');
    } finally {
      setExportingPDF(false);
    }
  };



  const handleSyncShifts = async () => {

    if (!confirm('This will sync shifts for all attendance records that don\'t have shifts assigned. This may take a few minutes. Continue?')) {

      return;

    }



    try {

      setSyncingShifts(true);

      setError('');

      setSuccess('');

      const response = await api.syncShifts();

      if (response.success) {

        setSuccess(response.message || `Processed ${response.data?.processed || 0} records: ${response.data?.assigned || 0} assigned, ${response.data?.confused || 0} flagged for review`);

        loadMonthlyAttendance();

      } else {

        setError(response.message || 'Failed to sync shifts');

      }

    } catch (err: any) {

      setError(err.message || 'An error occurred during shift sync');

    } finally {

      setSyncingShifts(false);

    }

  };



  const handleUpdateOutTime = async () => {

    if (!selectedRecordForOutTime || !outTimeValue) {

      alert('Please enter out time');

      return;

    }



    try {

      setUpdatingOutTime(true);

      setError('');

      setSuccess('');



      // Format datetime for API

      const outTimeDate = new Date(outTimeValue);

      const isoString = outTimeDate.toISOString();



      const response = await api.updateAttendanceOutTime(

        selectedRecordForOutTime.employee.emp_no,

        selectedRecordForOutTime.date,

        isoString,

        selectedRecordForOutTime.shiftRecordId

      );



      if (response.success) {

        setSuccess('Out time updated successfully. Shift will be automatically assigned.');

        setShowOutTimeDialog(false);

        setSelectedRecordForOutTime(null);

        setOutTimeValue('');



        // Optimistic update: mark as manually edited

        setMonthlyData(prevData => prevData.map(empData => {

          if (empData.employee.emp_no === selectedRecordForOutTime.employee.emp_no) {

            const updatedDaily = { ...empData.dailyAttendance };

            if (updatedDaily[selectedRecordForOutTime.date]) {

              const record = updatedDaily[selectedRecordForOutTime.date];

              if (record) {

                const newSource = record.source ? [...record.source] : [];

                if (!newSource.includes('manual')) newSource.push('manual');

                updatedDaily[selectedRecordForOutTime.date] = { ...record, source: newSource };

              }

            }

            return { ...empData, dailyAttendance: updatedDaily };

          }

          return empData;

        }));



        loadMonthlyAttendance();

      } else {

        setError(response.message || 'Failed to update out time');

      }

    } catch (err: any) {

      setError(err.message || 'An error occurred while updating out time');

    } finally {

      setUpdatingOutTime(false);

    }

  };

  const handleUpdateInTime = async () => {
    if (!selectedRecordForInTime || !inTimeDialogValue) {
      alert('Please enter in time');
      return;
    }
    try {
      setUpdatingInTime(true);
      setError('');
      setSuccess('');
      const isoString = inTimeDialogValue.includes('T')
        ? new Date(inTimeDialogValue).toISOString()
        : (() => {
          const [hours, mins] = inTimeDialogValue.split(':').map(Number);
          const d = new Date(selectedRecordForInTime.date);
          d.setHours(hours, mins, 0, 0);
          return d.toISOString();
        })();
      const response = await api.updateAttendanceInTime(
        selectedRecordForInTime.employee.emp_no,
        selectedRecordForInTime.date,
        isoString,
        selectedRecordForInTime.shiftRecordId
      );
      if (response.success) {
        setSuccess('In time updated successfully.');
        setShowInTimeDialog(false);
        setSelectedRecordForInTime(null);
        setInTimeDialogValue('');
        await loadMonthlyAttendance();
        if (attendanceDetail && selectedRecordForInTime?.employee?.emp_no === attendanceDetail.employee?.emp_no && selectedRecordForInTime?.date === attendanceDetail.date) {
          const updated = await api.getAttendanceDetail(selectedRecordForInTime.employee.emp_no, selectedRecordForInTime.date);
          if (updated?.success && updated?.data) setAttendanceDetail(updated.data);
        }
      } else {
        setError(response.message || 'Failed to update in time');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred while updating in time');
    } finally {
      setUpdatingInTime(false);
    }
  };

  const handleShiftOutTimeUpdate = async () => {

    if (!attendanceDetail || !outTimeInput) {

      alert('Please enter out time');

      return;

    }



    try {

      setSavingOutTime(true);

      setError('');

      setSuccess('');



      // Format datetime for API

      // Use the attendance date + time input

      const dateStr = attendanceDetail.date;

      const timeStr = outTimeInput; // HH:mm

      const dateTimeStr = `${dateStr}T${timeStr}:00.000Z`;

      // Note: The backend expects ISO. We should probably respect local time?

      // Actually, simple string concatenation might assume UTC if Z is appended.

      // Better to construct a Date object correctly.

      const [year, month, day] = dateStr.split('-').map(Number);

      const [hours, minutes] = timeStr.split(':').map(Number);

      const outTimeDate = new Date(year, month - 1, day, hours, minutes);



      // Adjust for timezone if necessary OR backend handles local time?

      // api.updateAttendanceOutTime implementation usually expects ISO.

      // Let's stick to a safe ISO conversion.

      const isoString = outTimeDate.toISOString();



      const response = await api.updateAttendanceOutTime(

        attendanceDetail.employee.emp_no,

        attendanceDetail.date,

        isoString,

        selectedShiftRecordId || undefined

      );



      if (response.success) {

        setSuccess('Out time updated successfully.');

        setEditingOutTime(false);

        setOutTimeInput('');

        setSelectedShiftRecordId(null);

        // Refresh detail

        const detailRes = await api.getAttendanceDetail(attendanceDetail.employee.emp_no, attendanceDetail.date);

        if (detailRes.success) {

          setAttendanceDetail(detailRes.data);

        }

        // Also refresh monthly list

        loadMonthlyAttendance();

      } else {

        setError(response.message || 'Failed to update out time');

      }

    } catch (err: any) {

      setError(err.message || 'An error occurred while saving out time');

    } finally {

      setSavingOutTime(false);

    }

  };



  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];



  const getDaysInMonth = () => {

    const lastDay = new Date(year, month, 0);

    return lastDay.getDate();

  };



  const getCalendarDays = () => {

    const firstDay = new Date(year, month - 1, 1);

    const lastDay = new Date(year, month, 0);

    const daysInMonth = lastDay.getDate();

    const startingDayOfWeek = firstDay.getDay();



    const days = [];



    // Add empty cells for days before the first day of the month

    for (let i = 0; i < startingDayOfWeek; i++) {

      days.push(null);

    }



    // Add all days of the month

    for (let day = 1; day <= daysInMonth; day++) {

      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      days.push({

        day,

        date: dateStr,

      });

    }



    return days;

  };



  const getStatusColor = (record: AttendanceRecord | null) => {

    if (!record) return '';

    if (record.status === 'PRESENT') return 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/10 dark:border-green-800 dark:text-green-400';

    if (record.status === 'HALF_DAY') return 'bg-orange-50 border-orange-200 text-orange-800 dark:bg-orange-900/10 dark:border-orange-800 dark:text-orange-400';

    if (record.status === 'PARTIAL') return 'bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-900/10 dark:border-yellow-800 dark:text-yellow-400';

    if (record.status === 'HOLIDAY') return 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/10 dark:border-red-800 dark:text-red-400';

    if (record.status === 'WEEK_OFF') return 'bg-orange-50 border-orange-200 text-orange-800 dark:bg-orange-900/10 dark:border-orange-800 dark:text-orange-400';

    return '';

  };



  const getCellBackgroundColor = (record: AttendanceRecord | null) => {

    if (!record) {

      return 'bg-slate-100 dark:bg-slate-800';

    }



    // Priority: Conflict (purple) > Leave (orange) > OD (blue) > Absent (gray) > Present (default)

    if (record.isConflict) {

      return 'bg-purple-100 border-purple-300 dark:bg-purple-900/30 dark:border-purple-700';

    }

    if (record.hasLeave && !record.hasOD) {

      if (record.leaveInfo?.numberOfDays && record.leaveInfo.numberOfDays >= 3) {

        return 'bg-amber-200 border-amber-400 dark:bg-amber-900/50 dark:border-amber-600';

      }

      return 'bg-orange-100 border-orange-300 dark:bg-orange-900/30 dark:border-orange-700';

    }

    if (record.hasOD && !record.hasLeave) {

      return 'bg-blue-100 border-blue-300 dark:bg-blue-900/30 dark:border-blue-700';

    }

    if (record.hasLeave && record.hasOD) {

      // Both leave and OD - show as conflict

      return 'bg-purple-100 border-purple-300 dark:bg-purple-900/30 dark:border-purple-700';

    }

    if (record.status === 'ABSENT' || record.status === 'LEAVE' || record.status === 'OD' || record.status === 'HALF_DAY') {

      return 'bg-slate-100 dark:bg-slate-800';

    }

    if (record.status === 'HOLIDAY') {

      return 'bg-red-100 dark:bg-red-900/20 border-red-300 dark:border-red-700';

    }

    if (record.status === 'WEEK_OFF') {

      return 'bg-orange-100 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700';

    }

    return '';

  };



  const formatHours = (hours: number | null | undefined) => {
    if (hours === null || hours === undefined || Number.isNaN(hours)) return '-';
    const totalMinutes = Math.round(hours * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
  };



  // Pay period days (same as superadmin): array of date strings in cycle range
  const daysArray = useMemo(() => {
    if (cycleDates.startDate && cycleDates.endDate) {
      const dates: string[] = [];
      let current = new Date(cycleDates.startDate);
      const end = new Date(cycleDates.endDate);
      let count = 0;
      while (current <= end && count <= 35) {
        dates.push(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`);
        current.setDate(current.getDate() + 1);
        count++;
      }
      return dates;
    }
    const lastDay = new Date(year, month, 0).getDate();
    return Array.from({ length: lastDay }, (_, i) => {
      const d = i + 1;
      return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    });
  }, [cycleDates.startDate, cycleDates.endDate, year, month]);

  const periodDays = daysArray.length;

  const visibleWorkspaceCompleteKeys = useMemo(
    () => workspaceVisibleCompleteKeys(orgCompleteSummaryColumns),
    [orgCompleteSummaryColumns]
  );

  /** Employee + day columns + trailing summary columns (matches thead) */
  const attendanceTableColSpan = useMemo(() => {
    const summaryCols =
      tableType === 'complete'
        ? Math.max(1, visibleWorkspaceCompleteKeys.length)
        : tableType === 'present_absent'
          ? 2
          : tableType === 'in_out'
            ? 1
            : tableType === 'leaves'
              ? 4
              : tableType === 'od'
                ? 1
                : tableType === 'ot'
                  ? 2
                  : 0;
    return 1 + daysArray.length + summaryCols;
  }, [tableType, daysArray.length, visibleWorkspaceCompleteKeys.length]);

  const activeHighlightDates = useMemo(() => {

    if (!activeHighlight) return new Map<string, { value: number; label: string }>();

    const empData = monthlyData.find((d) => d.employee._id === activeHighlight.employeeId);

    if (!empData) return new Map<string, { value: number; label: string }>();

    const map = new Map<string, { value: number; label: string }>();

    const cd = empData.summary?.contributingDates as Record<string, unknown> | undefined;

    const items = cd?.[activeHighlight.category];

    if (Array.isArray(items)) {

      items.forEach((item: unknown) => {

        if (typeof item === 'string') {

          map.set(item, { value: 1, label: '' });

        } else if (item && typeof item === 'object' && 'date' in item && (item as { date: string }).date) {

          const o = item as { date: string; value?: number; label?: string };

          map.set(o.date, { value: o.value ?? 1, label: o.label || '' });

        }

      });

      return map;

    }

    if (activeHighlight.category === 'absent' && empData.dailyAttendance) {

      for (const [dateStr, rec] of Object.entries(empData.dailyAttendance)) {

        if (rec?.status === 'ABSENT') map.set(dateStr, { value: 1, label: '' });

      }

    }

    return map;

  }, [activeHighlight, monthlyData]);

  return (

    <div className="relative min-h-screen">

      {/* Background */}

      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(to_right,#e2e8f01f_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f01f_1px,transparent_1px)] bg-[size:28px_28px] dark:bg-[linear-gradient(to_right,rgba(148,163,184,0.12)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.12)_1px,transparent_1px)]" />

      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-green-50/40 via-green-50/35 to-transparent dark:from-slate-900/60 dark:via-slate-900/65 dark:to-slate-900/80" />



      <div className="relative z-10 mx-auto max-w-[1920px]">

        {/* Header */}

        <div className="mb-6 flex flex-col sm:flex-row items-center sm:justify-between gap-4 pb-2">

          <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">

            {/* Title Section */}

            <div className="flex items-center justify-between sm:justify-start gap-3 w-full sm:w-auto">

              <div className="flex flex-col">
                <h1 className="text-xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">Attendance</h1>
              </div>

              <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block" />



              {/* Search Toggle */}

              <div className="flex items-center gap-2">

                {showSearch ? (

                  <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-300">

                    <div className="relative group">

                      <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">

                        <svg className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">

                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />

                        </svg>

                      </div>

                      <input
                        autoFocus
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            loadMonthlyAttendance(true);
                          }
                        }}
                        placeholder="Search..."
                        className="w-40 h-9 pl-9 pr-3 text-xs rounded-xl border border-slate-200 bg-white focus:border-green-500 focus:ring-2 focus:ring-green-500/10 transition-all dark:border-slate-700 dark:bg-slate-800 dark:text-white shadow-sm"
                      />

                    </div>
                    <button

                      onClick={() => { setShowSearch(false); setSearchQuery(''); }}

                      className="h-9 w-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 transition-all"

                    >

                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">

                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />

                      </svg>

                    </button>

                  </div>

                ) : (

                  <button

                    onClick={() => setShowSearch(true)}

                    className="h-9 w-9 flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-green-600 hover:border-green-200 hover:bg-green-50/50 transition-all shadow-sm dark:border-slate-700 dark:bg-slate-800"

                    title="Search Records"

                  >

                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">

                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />

                    </svg>

                  </button>

                )}

              </div>

            </div>

            {/* Filters Group - Hide for Employee */}
            {!isEmployee && (
              <div className="flex flex-nowrap items-center gap-1.5 p-1 bg-slate-100/50 dark:bg-slate-800/40 rounded-xl border border-slate-200/60 dark:border-slate-700/60 backdrop-blur-sm">
                <select
                  value={selectedDivision}
                  onChange={(e) => {
                    setSelectedDivision(e.target.value);
                    setSelectedDepartment('');
                    setSelectedDesignation('');
                    loadDepartments(e.target.value);
                  }}
                  className="h-8 pl-2 pr-6 text-[11px] font-semibold bg-white dark:bg-slate-800 border-0 rounded-lg focus:ring-2 focus:ring-green-500/20 text-slate-700 dark:text-slate-300 shadow-sm min-w-[100px] max-w-[140px]"
                >
                  <option value="">All Divisions</option>
                  {divisions.map((div) => (
                    <option key={div._id} value={div._id}>{div.name}</option>
                  ))}
                </select>

                <select
                  value={selectedDepartment}
                  onChange={(e) => {
                    setSelectedDepartment(e.target.value);
                    setSelectedDesignation('');
                  }}
                  className="h-8 pl-2 pr-6 text-[11px] font-semibold bg-white dark:bg-slate-800 border-0 rounded-lg focus:ring-2 focus:ring-green-500/20 text-slate-700 dark:text-slate-300 shadow-sm min-w-[100px] max-w-[140px]"
                >
                  <option value="">All Departments</option>
                  {departments.map((dept) => (
                    <option key={dept._id} value={dept._id}>{dept.name}</option>
                  ))}
                </select>

                {selectedDepartment && (
                  <select

                    value={selectedDesignation}

                    onChange={(e) => setSelectedDesignation(e.target.value)}
                    className="h-8 pl-2 pr-6 text-[11px] font-semibold bg-white dark:bg-slate-800 border-0 rounded-lg focus:ring-2 focus:ring-green-500/20 text-slate-700 dark:text-slate-300 shadow-sm min-w-[100px] max-w-[140px] animate-in slide-in-from-left-2"
                  >

                    <option value="">All Designations</option>

                    {designations.map((desig) => (
                      <option key={desig._id} value={desig._id}>{desig.name}</option>
                    ))}

                  </select>
                )}
                {/* Table Type Dropdown */}
                <select

                  value={tableType}

                  onChange={(e) => setTableType(e.target.value as any)}
                  className="h-8 pl-2 pr-6 text-[11px] font-bold bg-green-50 dark:bg-green-900/20 border-0 rounded-lg focus:ring-2 focus:ring-green-500/20 text-green-700 dark:text-green-400 shadow-sm cursor-pointer"
                >
                  <option value="complete">Complete</option>
                  <option value="present_absent">Pres/Abs</option>
                  <option value="in_out">In/Out</option>
                  <option value="leaves">Leaves</option>
                  <option value="od">OD</option>
                  <option value="ot">OT</option>
                </select>
              </div>

            )}

            {/* Employee: table type + view mode (Table / Cards) */}
            {isEmployee && (
              <div className="flex flex-wrap items-center gap-2 p-2 bg-slate-100/50 dark:bg-slate-800/40 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
                <select
                  value={tableType}
                  onChange={(e) => setTableType(e.target.value as any)}
                  className="h-8 pl-2 pr-6 text-[11px] font-bold bg-green-50 dark:bg-green-900/20 border-0 rounded-lg focus:ring-2 focus:ring-green-500/20 text-green-700 dark:text-green-400 shadow-sm cursor-pointer"
                >
                  <option value="complete">Complete</option>
                  <option value="present_absent">Pres/Abs</option>
                  <option value="in_out">In/Out</option>
                  <option value="leaves">Leaves</option>
                  <option value="od">OD</option>
                  <option value="ot">OT</option>
                </select>
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">View</span>
                <div className="flex rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setEmployeeViewMode('table')}
                    className={`px-3 py-1.5 text-[11px] font-semibold transition-colors ${employeeViewMode === 'table' ? 'bg-slate-700 text-white dark:bg-slate-600' : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'}`}
                  >
                    Table
                  </button>
                  <button
                    type="button"
                    onClick={() => setEmployeeViewMode('cards')}
                    className={`px-3 py-1.5 text-[11px] font-semibold transition-colors ${employeeViewMode === 'cards' ? 'bg-slate-700 text-white dark:bg-slate-600' : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'}`}
                  >
                    Cards
                  </button>
                </div>
              </div>
            )}

          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">

            {/* Month/Year Navigation */}

            <div className="flex items-center gap-0.5 p-0.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">

              <button

                onClick={() => navigateMonth('prev')}

                className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"

              >

                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">

                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />

                </svg>

              </button>

              <div className="flex items-center px-1 space-x-0.5">

                <select

                  value={month}

                  onChange={(e) => {

                    const newDate = new Date(currentDate);

                    newDate.setMonth(parseInt(e.target.value) - 1);

                    setCurrentDate(newDate);

                  }}

                  className="bg-transparent border-0 text-[11px] font-bold text-slate-900 dark:text-white focus:ring-0 p-0 cursor-pointer"

                >

                  {monthNames.map((name, idx) => (

                    <option key={idx} value={idx + 1}>{name.substring(0, 3)}</option>

                  ))}

                </select>

                <select

                  value={year}

                  onChange={(e) => {

                    const newDate = new Date(currentDate);

                    newDate.setFullYear(parseInt(e.target.value));

                    setCurrentDate(newDate);

                  }}

                  className="bg-transparent border-0 text-[11px] font-bold text-slate-900 dark:text-white focus:ring-0 p-0 cursor-pointer"

                >

                  {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (

                    <option key={y} value={y}>{y}</option>

                  ))}

                </select>

                {cycleDates.startDate && cycleDates.endDate && (
                  <span className="ml-2 text-[10px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap" title={`Pay period: ${cycleDates.startDate} to ${cycleDates.endDate}`}>
                    ({new Date(cycleDates.startDate + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – {new Date(cycleDates.endDate + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})
                  </span>
                )}

              </div>

              <button

                onClick={() => navigateMonth('next')}

                className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"

              >

                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">

                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />

                </svg>

              </button>

            </div>



            <div className="flex items-center gap-2">
              {hasManagePermission && (
                <button
                  onClick={handleSyncShifts}
                  disabled={syncingShifts}
                  title="Sync Shifts"
                  className="h-9 w-9 flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-green-600 hover:border-green-200 transition-all shadow-sm active:scale-95 disabled:opacity-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 md:w-auto md:px-3"
                >
                  {syncingShifts ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
                  ) : (
                    <svg className="h-4 w-4 md:mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  <span className="hidden md:inline text-xs font-semibold">Sync</span>
                </button>
              )}

              {hasManagePermission && attendanceFeatureFlags.allowAttendanceUpload && (
                <button
                  onClick={() => setShowUploadDialog(true)}
                  title="Upload Excel"
                  className="h-9 flex items-center px-4 rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 text-xs font-bold text-white shadow-lg shadow-green-500/25 hover:shadow-green-500/40 hover:-translate-y-0.5 transition-all active:scale-95"
                >
                  <svg className="mr-2 h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  Upload
                </button>
              )}

              <button
                onClick={handleExportPDF}
                disabled={exportingPDF}
                title="Download PDF Attendance Report"
                className="h-9 flex items-center px-4 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-red-600 hover:border-red-200 transition-all shadow-sm active:scale-95 disabled:opacity-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-red-400"
              >
                {exportingPDF ? (
                  <div className="mr-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
                ) : (
                  <svg className="mr-2 h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                )}
                {exportingPDF ? 'Generating...' : 'Download PDF'}
              </button>
            </div>

          </div>

        </div>


        {/* Employee: Monthly summary block above content */}
        {isEmployee && filteredMonthlyData.length > 0 && (() => {
          const item = filteredMonthlyData[0];
          const s = item.summary;
          const leaveRecords = Object.values(item.dailyAttendance).filter(
            (r) => r?.status === 'LEAVE' || r?.hasLeave
          );
          const totalLeaveDays = s?.totalLeaves ?? leaveRecords.length;
          const lopLeaveDays = leaveRecords.filter((r) => {
            const anyR = r as any;
            return (
              anyR?.leaveNature === 'lop' ||
              anyR?.leaveInfo?.leaveType?.toLowerCase().includes('lop') ||
              anyR?.leaveInfo?.leaveType?.toLowerCase().includes('loss of pay')
            );
          }).length;
          const paidLeaveDays = totalLeaveDays - lopLeaveDays;
          const dailyVals = Object.values(item.dailyAttendance);
          const otHoursSum = dailyVals.reduce((sum, r) => sum + ((r as any)?.otHours || 0), 0);
          const extraHoursSum = dailyVals.reduce((sum, r) => sum + ((r as any)?.extraHours || 0), 0);
          const permissionsSum = dailyVals.reduce((sum, r) => sum + ((r as any)?.permissionCount || 0), 0);

          type EmpCard = {
            id: string;
            /** Matches Complete-table org column; null = always show (not on that grid). */
            column: WorkspaceCompleteAggregateKey | null;
            label: string;
            value: string | number;
            color: string;
            bcolor: string;
          };

          const cards: EmpCard[] = [
            {
              id: 'present',
              column: 'present',
              label: 'Present',
              value: s?.totalPresentDays ?? item.presentDays ?? 0,
              color: 'text-slate-900 dark:text-white',
              bcolor: 'bg-slate-50 dark:bg-slate-700/30',
            },
            {
              id: 'totalLeave',
              column: 'leaves',
              label: 'Total leave',
              value: totalLeaveDays,
              color: 'text-amber-600 dark:text-amber-400',
              bcolor: 'bg-amber-50/50 dark:bg-amber-900/10',
            },
            {
              id: 'paidLeave',
              column: 'leaves',
              label: 'Paid leave',
              value: paidLeaveDays,
              color: 'text-yellow-700 dark:text-yellow-400',
              bcolor: 'bg-yellow-50/50 dark:bg-yellow-900/10',
            },
            {
              id: 'lop',
              column: 'leaves',
              label: 'LOP',
              value: lopLeaveDays,
              color: 'text-rose-600 dark:text-rose-400',
              bcolor: 'bg-rose-50/50 dark:bg-rose-900/10',
            },
            {
              id: 'wOff',
              column: 'weekOffs',
              label: 'W-Off',
              value: s?.totalWeeklyOffs ?? 0,
              color: 'text-orange-600 dark:text-orange-400',
              bcolor: 'bg-orange-50/50 dark:bg-orange-900/10',
            },
            {
              id: 'holiday',
              column: 'holidays',
              label: 'Holiday',
              value: s?.totalHolidays ?? 0,
              color: 'text-red-500 dark:text-red-400',
              bcolor: 'bg-red-50/50 dark:bg-red-900/10',
            },
            {
              id: 'otHours',
              column: 'otHours',
              label: 'OT hours',
              value: formatHours(otHoursSum),
              color: 'text-orange-700 dark:text-orange-400',
              bcolor: 'bg-orange-50/50 dark:bg-orange-900/10',
            },
            {
              id: 'extraHours',
              column: 'extraHours',
              label: 'Extra hours',
              value: formatHours(extraHoursSum),
              color: 'text-purple-700 dark:text-purple-300',
              bcolor: 'bg-purple-50/50 dark:bg-purple-900/10',
            },
            {
              id: 'permissions',
              column: 'permissions',
              label: 'Permissions',
              value: permissionsSum,
              color: 'text-cyan-700 dark:text-cyan-400',
              bcolor: 'bg-cyan-50/50 dark:bg-cyan-900/10',
            },
            {
              id: 'lateEarly',
              column: 'lateEarly',
              label: 'Late/Early',
              value: s?.lateOrEarlyCount ?? 0,
              color: 'text-rose-600 dark:text-rose-400',
              bcolor: 'bg-rose-50/50 dark:bg-rose-900/10',
            },
            {
              id: 'attDed',
              column: 'attDed',
              label: 'Att. deduction days',
              value: Number(s?.totalAttendanceDeductionDays ?? 0).toFixed(2).replace(/\.?0+$/, '') || '0',
              color: 'text-purple-700 dark:text-purple-300',
              bcolor: 'bg-purple-50/50 dark:bg-purple-900/10',
            },
            {
              id: 'payable',
              column: 'payableShifts',
              label: 'Payable',
              value: (s?.totalPayableShifts ?? item.payableShifts ?? 0).toFixed(1),
              color: 'text-green-600 dark:text-green-400',
              bcolor: 'bg-green-50/50 dark:bg-green-900/10',
            },
            {
              id: 'od',
              column: null,
              label: 'OD',
              value: s?.totalODs ?? 0,
              color: 'text-blue-600 dark:text-blue-400',
              bcolor: 'bg-blue-50/50 dark:bg-blue-900/10',
            },
            {
              id: 'period',
              column: null,
              label: 'Period Days',
              value: s?.totalDaysInMonth ?? 0,
              color: 'text-slate-600 dark:text-slate-400',
              bcolor: 'bg-slate-50/50 dark:bg-slate-700/20',
            },
          ];

          const visibleCards = cards.filter((c) => c.column == null || orgCompleteSummaryColumns[c.column]);

          return (
            <div className="mb-6 rounded-2xl border border-slate-200/60 bg-white/40 backdrop-blur-md p-4 sm:p-6 shadow-xl shadow-slate-200/20 dark:border-slate-700/50 dark:bg-slate-800/40 dark:shadow-none transition-all hover:shadow-2xl hover:shadow-slate-200/40 dark:hover:shadow-none">
              <div className="flex items-center justify-between mb-4 sm:mb-6">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                  Monthly Performance Summary
                </h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 xl:gap-6">
                {visibleCards.map((stat) => (
                  <div
                    key={stat.id}
                    className={`flex flex-col p-3 rounded-xl border border-transparent transition-all hover:border-slate-200 dark:hover:border-slate-700 hover:bg-white dark:hover:bg-slate-800 shadow-sm hover:shadow-md ${stat.bcolor}`}
                  >
                    <div className="text-[10px] xl:text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-tight mb-1">{stat.label}</div>
                    <div className={`text-lg xl:text-2xl font-black ${stat.color}`}>{stat.value}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Messages moved here */}

        {/* Messages */}
        {
          error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )
        }
        {
          success && (
            <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
              {success}
            </div>
          )
        }


        {/* Attendance: Table or Day Cards (Employee) */}
        {isEmployee && employeeViewMode === 'cards' && filteredMonthlyData.length > 0 ? (
          <div className="rounded-3xl border border-slate-200/60 bg-white/60 backdrop-blur-xl shadow-2xl shadow-slate-200/40 dark:border-slate-700/50 dark:bg-slate-900/60 dark:shadow-none overflow-hidden mx-auto max-w-6xl">
            <div className="grid grid-cols-7 gap-2 sm:gap-3 lg:gap-4 xl:gap-5 p-4 sm:p-6 lg:p-8">
              {/* Day Labels - Small Calendar Style */}
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
                <div key={i} className="text-center text-[9px] sm:text-[11px] xl:text-xs font-black text-slate-400 dark:text-slate-500 pb-2 sm:pb-4 uppercase tracking-widest">
                  {d}
                </div>
              ))}

              {/* Padding for first day of month */}
              {(() => {
                const firstDayStr = daysArray[0];
                const firstDay = new Date(firstDayStr + 'T12:00:00');
                const startDay = firstDay.getDay();
                return Array.from({ length: startDay }).map((_, i) => (
                  <div key={`pad-${i}`} className="aspect-square opacity-20" />
                ));
              })()}

              {daysArray.map((dateStr) => {
                const item = filteredMonthlyData[0];
                const record = item.dailyAttendance[dateStr] || null;
                const shifts = (record as any)?.shifts || [];
                const shiftName = record?.shiftId && typeof record.shiftId === 'object' ? record.shiftId.name : '-';
                const displayStatus = getBaseDisplayStatus(record);
                const splitStatus = buildSplitCellStatus(record);
                const hasData = record && (record.status || record.hasLeave || record.hasOD);
                const isLate = hasData && ((record && (record as any).lateInMinutes != null && (record as any).lateInMinutes > 0) || (shifts && shifts.some((s: any) => s.lateInMinutes != null && s.lateInMinutes > 0)));
                const isEarlyOut = hasData && ((record && (record as any).earlyOutMinutes != null && (record as any).earlyOutMinutes > 0) || (shifts && shifts.some((s: any) => s.earlyOutMinutes != null && s.earlyOutMinutes > 0)));
                const dayNum = new Date(dateStr + 'T12:00:00').getDate();
                const highlightInfo =
                  activeHighlight?.employeeId === item.employee._id ? activeHighlightDates.get(dateStr) : null;
                const isHighlighted = !!highlightInfo;
                const highlightSub =
                  isHighlighted && highlightInfo && activeHighlight
                    ? highlightBadgeSubtitle(activeHighlight.category, highlightInfo.label)
                    : null;
                return (
                  <div
                    key={dateStr}
                    onClick={() => (hasData || isHighlighted) && handleDateClick(item.employee, dateStr)}
                    className={`relative rounded-xl sm:rounded-2xl lg:rounded-3xl border p-1 sm:p-3 xl:p-4 aspect-square flex flex-col items-center justify-center transition-all duration-300 ${hasData || isHighlighted ? 'cursor-pointer hover:shadow-lg hover:shadow-green-500/10 hover:-translate-y-1 hover:ring-2 hover:ring-green-500/20' : 'opacity-80'} ${getCellBackgroundColor(record)} ${getStatusColor(record)} shadow-sm ${isHighlighted ? 'ring-2 ring-blue-400/60 ring-inset z-10 !bg-blue-50/90 dark:!bg-blue-900/60' : ''}`}
                  >
                    {isHighlighted && highlightInfo && (
                      <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none p-0.5">
                        <div className="bg-blue-600/90 text-white px-1 py-0.5 rounded-md shadow-md border border-white/30 flex flex-col items-center justify-center gap-0 leading-none max-w-[90%]">
                          <span className="text-[9px] sm:text-[10px] font-black tabular-nums tracking-tight">
                            {formatHighlightContribution(highlightInfo.value)}
                          </span>
                          {highlightSub ? (
                            <span
                              className={`text-[5px] sm:text-[6px] opacity-90 truncate text-center leading-tight ${
                                activeHighlight?.category === 'leaves' ? 'font-semibold normal-case' : 'font-bold uppercase'
                              }`}
                              title={highlightSub}
                            >
                              {highlightSub}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    )}
                    <div className="text-xs sm:text-base lg:text-xl xl:text-2xl font-black text-slate-800 dark:text-white leading-none tracking-tighter">
                      {dayNum}
                    </div>

                    {hasData ? (
                      <div className="mt-0.5 sm:mt-1 flex flex-col items-center">
                        {splitStatus ? (
                          <div className="overflow-hidden rounded border border-slate-300/80 dark:border-slate-600/80 bg-white/70 dark:bg-slate-900/50 leading-none">
                            <div className="px-1 py-[1px] text-[7px] sm:text-[9px] font-bold uppercase">{splitStatus.top}</div>
                            <div className="border-t border-slate-300/80 dark:border-slate-600/80 px-1 py-[1px] text-[7px] sm:text-[9px] font-bold uppercase">{splitStatus.bottom}</div>
                          </div>
                        ) : (
                          <div className="font-bold text-[7px] sm:text-[10px] uppercase leading-none">{displayStatus}</div>
                        )}
                        {(isLate || isEarlyOut) && (
                          <div className="flex gap-0.5 mt-0.5">
                            {isLate && <span className="h-1 w-1 sm:h-1.5 sm:w-1.5 rounded-full bg-amber-500" />}
                            {isEarlyOut && <span className="h-1 w-1 sm:h-1.5 sm:w-1.5 rounded-full bg-blue-500" />}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm shadow-xl dark:border-slate-700 dark:bg-slate-900/80">
            <div className="overflow-x-auto scrollbar-hide">
              <table className="w-full border-separate border-spacing-0 text-xs">
                <thead className="sticky top-0 z-20 shadow-sm">
                  <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800">
                    <th className="sticky left-0 z-30 w-[160px] min-w-[160px] border-r border-b border-slate-200 bg-slate-100 px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 shadow-[2px_0_5px_rgba(0,0,0,0.05)]">
                      Employee
                    </th>
                    {daysArray.map((dateStr) => {
                      const dayNum = new Date(dateStr + 'T12:00:00').getDate();
                      const dayName = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short' });
                      return (
                        <th
                          key={dateStr}
                          className="w-[35px] min-w-[35px] border-r border-slate-200 px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:text-slate-300"
                          title={dateStr}
                        >
                          <div className="font-bold">{dayNum}</div>
                          <div className="text-[8px] opacity-70">{dayName}</div>
                        </th>
                      );
                    })}
                    {tableType === 'complete' &&
                      visibleWorkspaceCompleteKeys.map((colKey, idx) => {
                        const isLast = idx === visibleWorkspaceCompleteKeys.length - 1;
                        const edge = isLast ? 'border-r-0' : 'border-r border-slate-200';
                        switch (colKey) {
                          case 'present':
                            return (
                              <th
                                key={colKey}
                                className={`w-[80px] ${edge} border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:bg-blue-900/20 bg-blue-50`}
                              >
                                Days Present
                              </th>
                            );
                          case 'leaves':
                            return (
                              <th
                                key={colKey}
                                className={`w-[70px] ${edge} border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:bg-amber-900/20 bg-amber-50`}
                              >
                                Leaves
                              </th>
                            );
                          case 'od':
                            return (
                              <th
                                key={colKey}
                                className={`w-[70px] ${edge} border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-indigo-700 dark:border-slate-700 dark:bg-indigo-900/20 bg-indigo-50`}
                              >
                                OD
                              </th>
                            );
                          case 'weekOffs':
                            return (
                              <th
                                key={colKey}
                                className={`w-[70px] ${edge} border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:bg-orange-900/20 bg-orange-100`}
                              >
                                Week Offs
                              </th>
                            );
                          case 'holidays':
                            return (
                              <th
                                key={colKey}
                                className={`w-[70px] ${edge} border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:bg-red-900/20 bg-red-50`}
                              >
                                Holidays
                              </th>
                            );
                          case 'otHours':
                            return (
                              <th
                                key={colKey}
                                className={`w-[80px] ${edge} border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:bg-orange-900/20 bg-orange-50`}
                              >
                                OT Hours
                              </th>
                            );
                          case 'extraHours':
                            return (
                              <th
                                key={colKey}
                                className={`w-[80px] ${edge} border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:bg-purple-900/20 bg-purple-50`}
                              >
                                Extra Hours
                              </th>
                            );
                          case 'permissions':
                            return (
                              <th
                                key={colKey}
                                className={`w-[80px] ${edge} border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:bg-cyan-900/20 bg-cyan-50`}
                              >
                                Permissions
                              </th>
                            );
                          case 'lateEarly':
                            return (
                              <th
                                key={colKey}
                                className={`w-[80px] ${edge} border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:bg-rose-900/20 bg-rose-50`}
                              >
                                Late/Early
                              </th>
                            );
                          case 'attDed':
                            return (
                              <th
                                key={colKey}
                                className={`w-[72px] ${edge} border-slate-200 px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-violet-900 dark:border-slate-700 dark:bg-violet-900/25 bg-violet-50`}
                                title="Policy attendance deduction days (late/early + absent extra)"
                              >
                                Att ded
                              </th>
                            );
                          case 'payableShifts':
                            return (
                              <th
                                key={colKey}
                                className={`w-[80px] ${edge} border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:bg-green-900/20 bg-green-50`}
                              >
                                Payable Shifts
                              </th>
                            );
                          default:
                            return null;
                        }
                      })}
                    {tableType === 'present_absent' && (
                      <>
                        <th className="w-[80px] border-r border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider bg-green-50 text-green-700">Present (M)</th>
                        <th className="w-[80px] border-r border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider bg-red-50 text-red-700">Absent (M)</th>
                      </>
                    )}
                    {tableType === 'in_out' && (
                      <th className="w-[100px] border-r border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider bg-blue-50 text-blue-700">Total Days Present</th>
                    )}
                    {tableType === 'leaves' && (
                      <>
                        <th className="w-[100px] border-r border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider bg-orange-50 text-orange-700">Total Leaves</th>
                        <th className="w-[100px] border-r border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider bg-red-50 text-red-700">Absent</th>
                        <th className="w-[100px] border-r border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider bg-yellow-50 text-yellow-700">Paid Leaves</th>
                        <th className="w-[100px] border-r border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider bg-rose-50 text-rose-700">LOPs</th>
                      </>
                    )}
                    {tableType === 'od' && (
                      <th className="w-[100px] border-r border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider bg-indigo-50 text-indigo-700">Total ODs</th>
                    )}
                    {tableType === 'ot' && (
                      <>
                        <th className="w-[80px] border-r border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider bg-orange-50 text-orange-700">OT Hours</th>
                        <th className="w-[80px] border-r border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider bg-purple-50 text-purple-700">Extra Hours</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {loading ? (
                    <>
                      {/* Skeleton Loading - only tbody cells */}
                      {[1, 2, 3, 4, 5].map((i) => (
                        <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                            <div className="h-4 w-32 animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div>
                            <div className="mt-1 h-3 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div>
                          </td>
                          {daysArray.map((dateStr) => (
                            <td
                              key={dateStr}
                              className="border-r border-slate-200 px-1 py-1.5 text-center dark:border-slate-700"
                            >
                              <div className="h-8 w-full animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div>
                            </td>
                          ))}
                          {tableType === 'complete' &&
                            visibleWorkspaceCompleteKeys.map((colKey, skIdx) => {
                              const isLast = skIdx === visibleWorkspaceCompleteKeys.length - 1;
                              const edge = isLast ? 'border-r-0' : 'border-r border-slate-200';
                              const bg =
                                colKey === 'present'
                                  ? 'bg-blue-50 dark:bg-blue-900/20'
                                  : colKey === 'leaves'
                                    ? 'bg-amber-50 dark:bg-amber-900/20'
                                    : colKey === 'weekOffs'
                                      ? 'bg-orange-100 dark:bg-orange-900/20'
                                      : colKey === 'holidays'
                                        ? 'bg-red-50 dark:bg-red-900/20'
                                        : colKey === 'otHours'
                                          ? 'bg-orange-50 dark:bg-orange-900/20'
                                          : colKey === 'extraHours'
                                            ? 'bg-purple-50 dark:bg-purple-900/20'
                                            : colKey === 'permissions'
                                              ? 'bg-cyan-50 dark:bg-cyan-900/20'
                                              : colKey === 'lateEarly'
                                                ? 'bg-rose-50 dark:bg-rose-900/20'
                                                : colKey === 'attDed'
                                                  ? 'bg-violet-50 dark:bg-violet-900/25'
                                                  : 'bg-green-50 dark:bg-green-900/20';
                              return (
                                <td
                                  key={colKey}
                                  className={`${edge} border-slate-200 px-2 py-2 text-center dark:border-slate-700 ${bg}`}
                                >
                                  <div className="h-4 w-8 mx-auto animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div>
                                </td>
                              );
                            })}
                          {tableType === 'present_absent' && (
                            <>
                              <td className="border-r border-slate-200 bg-green-50 px-2 py-2 text-center dark:border-slate-700"><div className="h-4 w-8 mx-auto animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div></td>
                              <td className="border-r border-slate-200 bg-red-50 px-2 py-2 text-center dark:border-slate-700"><div className="h-4 w-8 mx-auto animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div></td>
                            </>
                          )}
                          {tableType === 'in_out' && (
                            <td className="border-r border-slate-200 bg-blue-50 px-2 py-2 text-center dark:border-slate-700"><div className="h-4 w-8 mx-auto animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div></td>
                          )}
                          {tableType === 'leaves' && (
                            <>
                              <td className="border-r border-slate-200 bg-orange-50 px-2 py-2 text-center dark:border-slate-700"><div className="h-4 w-8 mx-auto animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div></td>
                              <td className="border-r border-slate-200 bg-red-50 px-2 py-2 text-center dark:border-slate-700"><div className="h-4 w-8 mx-auto animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div></td>
                              <td className="border-r border-slate-200 bg-yellow-50 px-2 py-2 text-center dark:border-slate-700"><div className="h-4 w-8 mx-auto animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div></td>
                              <td className="border-r border-slate-200 bg-rose-50 px-2 py-2 text-center dark:border-slate-700"><div className="h-4 w-8 mx-auto animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div></td>
                            </>
                          )}
                          {tableType === 'od' && (
                            <td className="border-r border-slate-200 bg-indigo-50 px-2 py-2 text-center dark:border-slate-700"><div className="h-4 w-8 mx-auto animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div></td>
                          )}
                          {tableType === 'ot' && (
                            <>
                              <td className="border-r border-slate-200 bg-orange-50 px-2 py-2 text-center dark:border-slate-700"><div className="h-4 w-8 mx-auto animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div></td>
                              <td className="border-r border-slate-200 bg-purple-50 px-2 py-2 text-center dark:border-slate-700"><div className="h-4 w-8 mx-auto animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div></td>
                            </>
                          )}
                        </tr>
                      ))}
                    </>
                  ) : (
                    <>
                      {filteredMonthlyData.length === 0 ? (
                        <tr>
                          <td colSpan={attendanceTableColSpan} className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                            No employees found matching the selected filters.
                          </td>
                        </tr>
                      ) : (
                        filteredMonthlyData.map((item) => {
                          const daysPresent = item.presentDays !== undefined
                            ? item.presentDays
                            : Object.values(item.dailyAttendance).filter(
                              (record) => record && (record.status === 'PRESENT' || record.status === 'PARTIAL')
                            ).length;
                          const payableShifts = item.payableShifts !== undefined ? item.payableShifts : 0;

                          // Helper calculations for specific tables
                          const monthPresent = Object.values(item.dailyAttendance).filter(r => r?.status === 'PRESENT').length;
                          const monthAbsent = Object.values(item.dailyAttendance).filter(r => r?.status === 'ABSENT').length;
                          const daysAbsent = periodDays - daysPresent;
                          const leaveRecords = Object.values(item.dailyAttendance).filter(r => r?.status === 'LEAVE' || r?.hasLeave);
                          const totalLeaves = item.summary?.totalLeaves ?? leaveRecords.length;
                          const weekOffsCount = item.summary?.totalWeeklyOffs ?? Object.values(item.dailyAttendance).filter(r => r?.status === 'WEEK_OFF').length;
                          const holidaysCount = item.summary?.totalHolidays ?? Object.values(item.dailyAttendance).filter(r => r?.status === 'HOLIDAY').length;
                          const lopCount = leaveRecords.filter(r => {
                            return (r as any)?.leaveNature === 'lop' ||
                              (r as any)?.leaveInfo?.leaveType?.toLowerCase().includes('lop') ||
                              (r as any)?.leaveInfo?.leaveType?.toLowerCase().includes('loss of pay');
                          }).length;
                          const paidLeaves = totalLeaves - lopCount;

                          const totalODs = Object.values(item.dailyAttendance).filter(r => r?.status === 'OD' || r?.hasOD).length;

                          const isHighAbsenteeism = monthAbsent > 2;

                          return (
                            <tr key={item.employee._id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 ${isHighAbsenteeism ? 'bg-red-50/30 dark:bg-red-900/10' : ''}`}>
                              <td className={`sticky left-0 z-10 border-r border-slate-200 px-3 py-2 text-[11px] font-medium text-slate-900 dark:border-slate-700 dark:text-white shadow-[2px_0_5px_rgba(0,0,0,0.05)] ${isHighAbsenteeism ? 'bg-red-50 dark:bg-red-900/20' : 'bg-white dark:bg-slate-900'}`}>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <div
                                      className="font-semibold truncate cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex-1"
                                      onClick={() => handleEmployeeClick(item.employee)}
                                      title="Click to view monthly summary"
                                    >
                                      {item.employee.employee_name}
                                    </div>

                                  </div>
                                  <div className="text-[9px] text-slate-500 dark:text-slate-400 truncate mt-1">
                                    {item.employee.emp_no}
                                    {item.employee.department && ` • ${(item.employee.department as any)?.name || ''}`}
                                  </div>
                                </div>
                              </td>
                              {daysArray.map((dateStr) => {
                                const record = item.dailyAttendance[dateStr] || null;
                                const shifts = (record as any)?.shifts || [];
                                const shiftName = record?.shiftId && typeof record.shiftId === 'object' ? record.shiftId.name : '-';

                                const displayStatus = getBaseDisplayStatus(record);
                                const splitStatus = buildSplitCellStatus(record);

                                // Check if there's any data to display (attendance, leave, or OD)
                                const hasData = record && (record.status || record.hasLeave || record.hasOD);
                                const isLate = hasData && (
                                  (record && (record as any).lateInMinutes != null && (record as any).lateInMinutes > 0) ||
                                  (shifts && shifts.some((s: any) => s.lateInMinutes != null && s.lateInMinutes > 0))
                                );
                                const isEarlyOut = hasData && (
                                  (record && (record as any).earlyOutMinutes != null && (record as any).earlyOutMinutes > 0) ||
                                  (shifts && shifts.some((s: any) => s.earlyOutMinutes != null && s.earlyOutMinutes > 0))
                                );

                                const highlightInfo =
                                  activeHighlight?.employeeId === item.employee._id ? activeHighlightDates.get(dateStr) : null;

                                const isHighlighted = !!highlightInfo;

                                const highlightSub =
                                  isHighlighted && highlightInfo && activeHighlight
                                    ? highlightBadgeSubtitle(activeHighlight.category, highlightInfo.label)
                                    : null;

                                return (
                                  <td
                                    key={dateStr}
                                    onClick={() => (hasData || isHighlighted) && handleDateClick(item.employee, dateStr)}
                                    className={`border-r border-slate-200 px-1 py-1.5 text-center dark:border-slate-700 relative ${hasData || isHighlighted ? 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800' : ''
                                      } ${getStatusColor(record)} ${getCellBackgroundColor(record)} ${isHighlighted ? 'ring-2 ring-blue-400/60 ring-inset z-10 !bg-blue-50/90 dark:!bg-blue-900/60 shadow-[0_0_20px_rgba(59,130,246,0.2)] scale-[1.02] rounded-md' : ''}`}
                                  >
                                    {isHighlighted && highlightInfo && (
                                      <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none px-0.5">
                                        <div className="bg-blue-600/90 text-white px-1 py-0.5 rounded-md shadow-md border border-white/30 flex flex-col items-center justify-center gap-0 leading-none min-w-[1.35rem] max-w-[42px]">
                                          <span className="text-[10px] font-black tabular-nums tracking-tight">
                                            {formatHighlightContribution(highlightInfo.value)}
                                          </span>
                                          {highlightSub ? (
                                            <span
                                              className={`text-[6px] opacity-90 truncate max-w-[40px] text-center leading-tight ${
                                                activeHighlight?.category === 'leaves'
                                                  ? 'font-semibold normal-case'
                                                  : 'font-bold uppercase'
                                              }`}
                                              title={highlightSub}
                                            >
                                              {highlightSub}
                                            </span>
                                          ) : null}
                                        </div>
                                      </div>
                                    )}
                                    {(isLate || isEarlyOut) && (
                                      <div className="absolute bottom-0.5 left-0 right-0 flex justify-center gap-0.5 z-10" title={`${isLate ? 'Late in' : ''}${isLate && isEarlyOut ? ' • ' : ''}${isEarlyOut ? 'Early out' : ''}`}>
                                        {isLate && <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" title="Late" />}
                                        {isEarlyOut && <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" title="Early out" />}
                                      </div>
                                    )}
                                    {hasData ? (
                                      <div className="space-y-0.5">
                                        {tableType === 'complete' && (
                                          <>
                                            {splitStatus ? (
                                              <div className="mx-auto w-fit overflow-hidden rounded border border-slate-300/80 dark:border-slate-600/80 bg-white/70 dark:bg-slate-900/50 leading-none">
                                                <div className="px-1 py-[1px] text-[8px] font-bold uppercase">{splitStatus.top}</div>
                                                <div className="border-t border-slate-300/80 dark:border-slate-600/80 px-1 py-[1px] text-[8px] font-bold uppercase">{splitStatus.bottom}</div>
                                              </div>
                                            ) : (
                                              <div className="font-semibold text-[9px]">{displayStatus}</div>
                                            )}
                                            {/* Shift Assignment - Only for HR */}
                                            {hasManagePermission ? (
                                              <div
                                                className="text-[8px] opacity-75 truncate cursor-pointer hover:text-blue-600 hover:underline"
                                                title={shiftName !== '-' ? shiftName : 'Assign Shift'}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  // Only open shift dialog if authorized
                                                  if (hasManagePermission) {
                                                    // Logic to open shift dialog would go here if not handled by row click
                                                    // For now, let row click handle it but visual cue is restricted
                                                  }
                                                }}
                                              >
                                                {shiftName !== '-' ? shiftName.substring(0, 3) : (record?.totalHours ? '' : 'Asgn')}
                                              </div>
                                            ) : (
                                              shiftName !== '-' && (
                                                <div className="text-[8px] opacity-75 truncate" title={shiftName}>{shiftName.substring(0, 3)}</div>
                                              )
                                            )}
                                            {record && record.totalHours !== null && (
                                              <div className="text-[8px] font-semibold">{formatHours(record.totalHours)}</div>
                                            )}
                                            {record?.odInfo?.odType_extended === 'hours' && (
                                              <div
                                                className="inline-flex items-center gap-1 rounded bg-indigo-100 px-1 py-[1px] text-[7px] font-extrabold text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200"
                                                title={`Hourly OD ${record.odInfo.durationHours != null ? `(${record.odInfo.durationHours}h)` : ''}`}
                                              >
                                                <span>ODh</span>
                                                {record.odInfo.durationHours != null ? <span>{record.odInfo.durationHours}h</span> : null}
                                              </div>
                                            )}
                                          </>
                                        )}
                                        {tableType === 'present_absent' && (
                                          <div className="font-bold text-[10px]">{displayStatus}</div>
                                        )}
                                        {tableType === 'in_out' && (
                                          <div className="text-[8px] font-medium leading-tight">
                                            {record?.shifts && record.shifts.length > 0 ? (
                                              record.shifts.map((s: any, idx: number) => (
                                                <div key={idx} className={idx > 0 ? "mt-1 pt-1 border-t border-slate-100 dark:border-slate-800" : ""}>
                                                  <div className="text-green-600 dark:text-green-400">{s.inTime ? formatTime(s.inTime) : '-'}</div>
                                                  <div className="text-red-600 dark:text-red-400">{s.outTime ? formatTime(s.outTime) : '-'}</div>
                                                </div>
                                              ))
                                            ) : (
                                              <>
                                                <div className="text-green-600 dark:text-green-400">{record?.inTime ? formatTime(record.inTime) : '-'}</div>
                                                <div className="text-red-600 dark:text-red-400">{record?.outTime ? formatTime(record.outTime) : '-'}</div>
                                              </>
                                            )}
                                          </div>
                                        )}
                                        {tableType === 'leaves' && (
                                          <div className={`font-bold text-[10px] ${displayStatus === 'LL' ? 'text-amber-800 dark:text-amber-300' : 'text-orange-600'}`}>
                                            {getLeaveCellLabel(record)}
                                          </div>
                                        )}
                                        {tableType === 'od' && (
                                          <div className="font-bold text-[10px] text-indigo-600">{getODCellLabel(record)}</div>
                                        )}
                                        {tableType === 'ot' && (
                                          <div className="text-[8px] font-medium leading-tight">
                                            <div className="text-orange-600">{record?.otHours ? formatHours(record.otHours) : '-'}</div>
                                            <div className="text-purple-600">{record?.extraHours ? formatHours(record.extraHours) : '-'}</div>
                                          </div>
                                        )}
                                        {(record?.source?.includes('manual') || record?.isEdited) && (
                                          <div className="text-[7px] text-indigo-600 dark:text-indigo-400 absolute top-0.5 right-0.5" title="Manually Edited">✎</div>
                                        )}
                                      </div>
                                    ) : (
                                      <>
                                        {record?.source?.includes('manual') && (
                                          <div className="text-[7px] text-indigo-600 dark:text-indigo-400 absolute top-0.5 right-0.5" title="Manually Edited">✎</div>
                                        )}
                                        <span className="text-slate-400 text-[9px]">-</span>
                                      </>
                                    )}
                                  </td>
                                );
                              })}
                              {tableType === 'complete' &&
                                visibleWorkspaceCompleteKeys.map((colKey, cIdx) => {
                                  const isLast = cIdx === visibleWorkspaceCompleteKeys.length - 1;
                                  const edge = isLast ? 'border-r-0' : 'border-r border-slate-200';
                                  switch (colKey) {
                                    case 'present':
                                      return (
                                        <td
                                          key={colKey}
                                          title="Click: highlight days in this total • Alt+click: open date list"
                                          onClick={(e) => onSummaryMetricClick(e, item.employee._id, 'present', 'present', item)}
                                          className={`${edge} border-slate-200 bg-blue-50 px-2 py-2 text-center text-[11px] font-bold text-blue-700 dark:border-slate-700 dark:bg-blue-900/20 dark:text-blue-300 cursor-pointer hover:bg-blue-100 ${activeHighlight?.employeeId === item.employee._id && activeHighlight?.category === 'present' ? 'ring-2 ring-blue-500 ring-inset shadow-inner dark:ring-blue-400' : ''}`}
                                        >
                                          {daysPresent}
                                        </td>
                                      );
                                    case 'leaves':
                                      return (
                                        <td
                                          key={colKey}
                                          title="Click: highlight days in this total • Alt+click: open date list"
                                          onClick={(e) => onSummaryMetricClick(e, item.employee._id, 'leaves', 'leaves', item)}
                                          className={`${edge} border-slate-200 bg-amber-50 px-2 py-2 text-center text-[11px] font-bold text-amber-700 dark:border-slate-700 dark:bg-amber-900/20 dark:text-amber-300 cursor-pointer hover:bg-amber-100 ${activeHighlight?.employeeId === item.employee._id && activeHighlight?.category === 'leaves' ? 'ring-2 ring-amber-500 ring-inset shadow-inner' : ''}`}
                                        >
                                          {totalLeaves}
                                        </td>
                                      );
                                    case 'od':
                                      return (
                                        <td
                                          key={colKey}
                                          title="Click: highlight OD dates"
                                          onClick={() => handleSummaryClick(item.employee._id, 'ods')}
                                          className={`${edge} border-slate-200 bg-indigo-50 px-2 py-2 text-center text-[11px] font-bold text-indigo-700 dark:border-slate-700 dark:bg-indigo-900/20 dark:text-indigo-300 cursor-pointer hover:bg-indigo-100 ${activeHighlight?.employeeId === item.employee._id && activeHighlight?.category === 'ods' ? 'ring-2 ring-indigo-500 ring-inset shadow-inner' : ''}`}
                                        >
                                          {totalODs}
                                        </td>
                                      );
                                    case 'weekOffs':
                                      return (
                                        <td
                                          key={colKey}
                                          title="Click: highlight week-off dates"
                                          onClick={() => handleSummaryClick(item.employee._id, 'weeklyOffs')}
                                          className={`${edge} border-slate-200 bg-orange-100 px-2 py-2 text-center text-[11px] font-bold text-orange-700 dark:border-slate-700 dark:bg-orange-900/20 dark:text-orange-300 cursor-pointer hover:bg-orange-200 ${activeHighlight?.employeeId === item.employee._id && activeHighlight?.category === 'weeklyOffs' ? 'ring-2 ring-orange-500 ring-inset shadow-inner' : ''}`}
                                        >
                                          {weekOffsCount}
                                        </td>
                                      );
                                    case 'holidays':
                                      return (
                                        <td
                                          key={colKey}
                                          title="Click: highlight holiday dates"
                                          onClick={() => handleSummaryClick(item.employee._id, 'holidays')}
                                          className={`${edge} border-slate-200 bg-red-50 px-2 py-2 text-center text-[11px] font-bold text-red-700 dark:border-slate-700 dark:bg-red-900/20 dark:text-red-300 cursor-pointer hover:bg-red-100 ${activeHighlight?.employeeId === item.employee._id && activeHighlight?.category === 'holidays' ? 'ring-2 ring-red-500 ring-inset shadow-inner' : ''}`}
                                        >
                                          {holidaysCount}
                                        </td>
                                      );
                                    case 'otHours':
                                      return (
                                        <td
                                          key={colKey}
                                          title="Click: highlight days with OT • Alt+click: open list"
                                          onClick={(e) => onSummaryMetricClick(e, item.employee._id, 'otHours', 'ot', item)}
                                          className={`${edge} border-slate-200 bg-orange-50 px-2 py-2 text-center text-[11px] font-bold text-orange-700 dark:border-slate-700 dark:bg-orange-900/20 dark:text-orange-300 cursor-pointer hover:bg-orange-100 ${activeHighlight?.employeeId === item.employee._id && activeHighlight?.category === 'otHours' ? 'ring-2 ring-orange-500 ring-inset shadow-inner' : ''}`}
                                        >
                                          {formatHours(Object.values(item.dailyAttendance).reduce((sum, record) => sum + (record?.otHours || 0), 0))}
                                        </td>
                                      );
                                    case 'extraHours':
                                      return (
                                        <td
                                          key={colKey}
                                          title="Click: highlight days with extra hours • Alt+click: open list"
                                          onClick={(e) => onSummaryMetricClick(e, item.employee._id, 'extraHours', 'extra', item)}
                                          className={`${edge} border-slate-200 bg-purple-50 px-2 py-2 text-center text-[11px] font-bold text-purple-700 dark:border-slate-700 dark:bg-purple-900/20 dark:text-purple-300 cursor-pointer hover:bg-purple-100 ${activeHighlight?.employeeId === item.employee._id && activeHighlight?.category === 'extraHours' ? 'ring-2 ring-purple-500 ring-inset shadow-inner' : ''}`}
                                        >
                                          {formatHours(Object.values(item.dailyAttendance).reduce((sum, record) => sum + (record?.extraHours || 0), 0))}
                                        </td>
                                      );
                                    case 'permissions':
                                      return (
                                        <td
                                          key={colKey}
                                          title="Click: highlight permission days • Alt+click: open list"
                                          onClick={(e) => onSummaryMetricClick(e, item.employee._id, 'permissions', 'permission', item)}
                                          className={`${edge} border-slate-200 bg-cyan-50 px-2 py-2 text-center text-[11px] font-bold text-cyan-700 dark:border-slate-700 dark:bg-cyan-900/20 dark:text-cyan-300 cursor-pointer hover:bg-cyan-100 ${activeHighlight?.employeeId === item.employee._id && activeHighlight?.category === 'permissions' ? 'ring-2 ring-cyan-500 ring-inset shadow-inner' : ''}`}
                                        >
                                          {Object.values(item.dailyAttendance).reduce((sum, record) => sum + (record?.permissionCount || 0), 0)}
                                        </td>
                                      );
                                    case 'lateEarly':
                                      return (
                                        <td
                                          key={colKey}
                                          title="Click: highlight late / early days"
                                          onClick={() => handleSummaryClick(item.employee._id, 'lateIn')}
                                          className={`${edge} border-slate-200 bg-rose-50 px-2 py-2 text-center text-[11px] font-bold text-rose-700 dark:border-slate-700 dark:bg-rose-900/20 dark:text-rose-300 w-[70px] min-w-[70px] cursor-pointer hover:bg-rose-100 ${activeHighlight?.employeeId === item.employee._id && activeHighlight?.category === 'lateIn' ? 'ring-2 ring-rose-500 ring-inset shadow-inner' : ''}`}
                                        >
                                          {item.summary?.lateOrEarlyCount ?? 0}
                                        </td>
                                      );
                                    case 'attDed':
                                      return (
                                        <td
                                          key={colKey}
                                          onClick={(e) => openAttendanceDeductionInfo(e, item)}
                                          className={`${edge} border-slate-200 bg-violet-50 px-1 py-2 text-center text-[10px] font-bold text-violet-900 dark:border-slate-700 dark:bg-violet-900/25 dark:text-violet-200 cursor-pointer hover:bg-violet-100/80 dark:hover:bg-violet-900/40`}
                                          title="Click to view deduction breakdown (late/early vs absent)"
                                        >
                                          {Number(item.summary?.totalAttendanceDeductionDays ?? 0).toLocaleString('en-IN', {
                                            minimumFractionDigits: 0,
                                            maximumFractionDigits: 2,
                                          })}
                                        </td>
                                      );
                                    case 'payableShifts':
                                      return (
                                        <td
                                          key={colKey}
                                          title="Click: highlight payable days • Alt+click: monthly summary"
                                          onClick={(e) => {
                                            if (e.altKey) {
                                              handleEmployeeClick(item.employee);
                                              return;
                                            }
                                            handleSummaryClick(item.employee._id, 'payableShifts');
                                          }}
                                          className={`${edge} border-slate-200 bg-green-50 px-2 py-2 text-center text-[11px] font-bold text-green-700 dark:border-slate-700 dark:bg-green-900/20 dark:text-green-300 cursor-pointer hover:bg-green-100 ${activeHighlight?.employeeId === item.employee._id && activeHighlight?.category === 'payableShifts' ? 'ring-2 ring-green-500 ring-inset shadow-inner' : ''}`}
                                        >
                                          {payableShifts.toFixed(2)}
                                        </td>
                                      );
                                    default:
                                      return null;
                                  }
                                })}
                              {tableType === 'present_absent' && (
                                <>
                                  <td
                                    title="Click: highlight • Alt+click: list"
                                    onClick={(e) => onSummaryMetricClick(e, item.employee._id, 'present', 'present', item)}
                                    className={`border-r border-slate-200 bg-green-50 px-2 py-2 text-center text-[11px] font-bold text-green-700 cursor-pointer hover:bg-green-100 ${activeHighlight?.employeeId === item.employee._id && activeHighlight?.category === 'present' ? 'ring-2 ring-green-500 ring-inset shadow-inner' : ''}`}
                                  >
                                    {monthPresent}
                                  </td>
                                  <td
                                    title="Click: highlight • Alt+click: list"
                                    onClick={(e) => onSummaryMetricClick(e, item.employee._id, 'absent', 'absent', item)}
                                    className={`border-r border-slate-200 bg-red-50 px-2 py-2 text-center text-[11px] font-bold text-red-700 cursor-pointer hover:bg-red-100 ${activeHighlight?.employeeId === item.employee._id && activeHighlight?.category === 'absent' ? 'ring-2 ring-red-500 ring-inset shadow-inner' : ''}`}
                                  >
                                    {monthAbsent}
                                  </td>
                                </>
                              )}
                              {tableType === 'in_out' && (
                                <td
                                  title="Click: highlight present days • Alt+click: in/out list"
                                  onClick={(e) => onSummaryMetricClick(e, item.employee._id, 'present', 'in_out', item)}
                                  className={`border-r border-slate-200 bg-blue-50 px-2 py-2 text-center text-[11px] font-bold text-blue-700 cursor-pointer hover:bg-blue-100 ${activeHighlight?.employeeId === item.employee._id && activeHighlight?.category === 'present' ? 'ring-2 ring-blue-500 ring-inset shadow-inner' : ''}`}
                                >
                                  {daysPresent}
                                </td>
                              )}
                              {tableType === 'leaves' && (
                                <>
                                  <td
                                    title="Click: highlight • Alt+click: list"
                                    onClick={(e) => onSummaryMetricClick(e, item.employee._id, 'leaves', 'leaves', item)}
                                    className={`border-r border-slate-200 bg-orange-50 px-2 py-2 text-center text-[11px] font-bold text-orange-700 cursor-pointer hover:bg-orange-100 ${activeHighlight?.employeeId === item.employee._id && activeHighlight?.category === 'leaves' ? 'ring-2 ring-orange-500 ring-inset shadow-inner' : ''}`}
                                  >
                                    {totalLeaves}
                                  </td>
                                  <td
                                    title="Click: highlight • Alt+click: list"
                                    onClick={(e) => onSummaryMetricClick(e, item.employee._id, 'absent', 'absent', item)}
                                    className={`border-r border-slate-200 bg-red-50 px-2 py-2 text-center text-[11px] font-bold text-red-700 cursor-pointer hover:bg-red-100 ${activeHighlight?.employeeId === item.employee._id && activeHighlight?.category === 'absent' ? 'ring-2 ring-red-500 ring-inset shadow-inner' : ''}`}
                                  >
                                    {monthAbsent}
                                  </td>
                                  <td className="border-r border-slate-200 bg-yellow-50 px-2 py-2 text-center text-[11px] font-bold text-yellow-700">{paidLeaves}</td>
                                  <td className="border-r border-slate-200 bg-rose-50 px-2 py-2 text-center text-[11px] font-bold text-rose-700">{lopCount}</td>
                                </>
                              )}
                              {tableType === 'od' && (
                                <td
                                  title="Click: highlight • Alt+click: list"
                                  onClick={(e) => onSummaryMetricClick(e, item.employee._id, 'ods', 'od', item)}
                                  className={`border-r border-slate-200 bg-indigo-50 px-2 py-2 text-center text-[11px] font-bold text-indigo-700 cursor-pointer hover:bg-indigo-100 ${activeHighlight?.employeeId === item.employee._id && activeHighlight?.category === 'ods' ? 'ring-2 ring-indigo-500 ring-inset shadow-inner' : ''}`}
                                >
                                  {totalODs}
                                </td>
                              )}
                              {tableType === 'ot' && (
                                <>
                                  <td
                                    title="Click: highlight • Alt+click: list"
                                    onClick={(e) => onSummaryMetricClick(e, item.employee._id, 'otHours', 'ot', item)}
                                    className={`border-r border-slate-200 bg-orange-50 px-2 py-2 text-center text-[11px] font-bold text-orange-700 cursor-pointer hover:bg-orange-100 ${activeHighlight?.employeeId === item.employee._id && activeHighlight?.category === 'otHours' ? 'ring-2 ring-orange-500 ring-inset shadow-inner' : ''}`}
                                  >
                                    {formatHours(Object.values(item.dailyAttendance).reduce((sum, record) => sum + (record?.otHours || 0), 0))}
                                  </td>
                                  <td
                                    title="Click: highlight • Alt+click: list"
                                    onClick={(e) => onSummaryMetricClick(e, item.employee._id, 'extraHours', 'extra', item)}
                                    className={`border-r border-slate-200 bg-purple-50 px-2 py-2 text-center text-[11px] font-bold text-purple-700 cursor-pointer hover:bg-purple-100 ${activeHighlight?.employeeId === item.employee._id && activeHighlight?.category === 'extraHours' ? 'ring-2 ring-purple-500 ring-inset shadow-inner' : ''}`}
                                  >
                                    {formatHours(Object.values(item.dailyAttendance).reduce((sum, record) => sum + (record?.extraHours || 0), 0))}
                                  </td>
                                </>
                              )}
                            </tr>
                          );
                        })
                      )}
                    </>
                  )}
                </tbody>
              </table>

              {/* Infinite Scroll Sentinel (NEW) */}
              <div ref={observerTarget} className="h-4 w-full" />

              {/* Loading More Indicator (NEW) */}
              {loadingMore && (
                <div className="flex justify-center items-center py-8">
                  <div className="flex items-center gap-3 text-slate-600 dark:text-slate-400">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span className="text-sm font-medium">Loading more attendance records...</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Status Legend - Improved for Mobile */}
        <div className="mt-8 mb-6 flex flex-col md:flex-row items-start md:items-center gap-4 px-4 py-4 rounded-2xl bg-white/50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 backdrop-blur-sm shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-500">
          <span className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest md:border-r md:border-slate-200 md:dark:border-slate-700 md:pr-4">Status Key</span>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:flex md:flex-wrap items-center gap-x-6 gap-y-3 w-full">
            {[
              { label: 'P', name: 'Present', color: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800' },
              { label: 'H', name: 'Holiday', color: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800' },
              { label: 'WO', name: 'Week Off', color: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800' },
              { label: 'L', name: 'Leave', color: 'bg-orange-50 text-orange-600 border-orange-100 dark:bg-orange-900/10 dark:text-orange-400 dark:border-orange-800' },
              { label: 'LL', name: 'Long Leave', color: 'bg-amber-200 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-400 dark:border-amber-700' },
              { label: 'OD', name: 'On Duty', color: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800' },
              { label: 'PT', name: 'Partial', color: 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800' },
              { label: 'HD', name: 'Half Day', color: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/10 dark:text-orange-400 dark:border-orange-900/30' },
              { label: 'A', name: 'Absent', color: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700' },
              { label: '!', name: 'Conflict', color: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800' },
              { label: '✎', name: 'Edited', color: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/10 dark:text-indigo-400 dark:border-indigo-800' },
              { label: '●', name: 'Late', color: 'bg-amber-500', dotOnly: true },
              { label: '●', name: 'Early out', color: 'bg-blue-500', dotOnly: true },
            ].map((item, idx) => (
              <div key={`${(item as any).name}-${idx}`} className="flex items-center gap-2 group cursor-help">
                <div className={`flex items-center justify-center rounded text-[10px] font-bold border shadow-sm transition-all duration-200 group-hover:scale-110 group-hover:shadow-md ${(item as any).dotOnly ? 'w-5 h-5 border-transparent' : 'w-6 h-6'} ${(item as any).dotOnly ? '' : item.color}`}>
                  {(item as any).dotOnly ? <span className={`inline-block h-2 w-2 rounded-full ${item.color}`} /> : item.label}
                </div>
                <span className="text-[10px] sm:text-[11px] font-bold text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">{item.name}</span>
              </div>
            ))}
          </div>
        </div>


        {/* Dialogs */}
        {

          showUploadDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Upload Attendance Excel</h3>
                  <button

                    onClick={() => {

                      setShowUploadDialog(false);

                      setUploadFile(null);

                    }}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>

                </div>

                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                      Select Excel File
                    </label>
                    <input
                      id="excel-upload-input"
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                    />
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                    <button
                      onClick={handleDownloadTemplate}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Download Template
                    </button>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={handleExcelUpload}
                      disabled={!uploadFile || uploading}
                      className="flex-1 rounded-xl bg-gradient-to-r from-green-500 to-green-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-green-500/30 transition-all hover:from-green-600 hover:to-green-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {uploading ? 'Uploading...' : 'Upload'}
                    </button>
                    <button
                      onClick={() => {
                        setShowUploadDialog(false);
                        setUploadFile(null);
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        }

        {/* OutTime Dialog for PARTIAL Attendance */}
        {
          showOutTimeDialog && selectedRecordForOutTime && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Enter Out Time</h3>
                  <button

                    onClick={() => {

                      setShowOutTimeDialog(false);

                      setSelectedRecordForOutTime(null);

                      setOutTimeValue('');

                    }}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>

                </div>

                <div className="space-y-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                    <div className="text-sm font-medium text-slate-900 dark:text-white">
                      {selectedRecordForOutTime.employee.employee_name}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-400">
                      {selectedRecordForOutTime.employee.emp_no} • {selectedRecordForOutTime.date}
                    </div>

                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                      Out Time *
                    </label>
                    <input
                      type="datetime-local"
                      value={outTimeValue}
                      onChange={(e) => setOutTimeValue(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      required
                    />
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Enter the logout date and time. For overnight shifts, select the <strong>next calendar day</strong> as the date.
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={handleUpdateOutTime}
                      disabled={!outTimeValue || updatingOutTime}
                      className="flex-1 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition-all hover:from-blue-600 hover:to-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {updatingOutTime ? 'Updating...' : 'Update Out Time'}
                    </button>
                    <button
                      onClick={() => {
                        setShowOutTimeDialog(false);
                        setSelectedRecordForOutTime(null);
                        setOutTimeValue('');
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        }

        {showInTimeDialog && selectedRecordForInTime && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Enter In Time</h3>
                <button
                  onClick={() => {
                    setShowInTimeDialog(false);
                    setSelectedRecordForInTime(null);
                    setInTimeDialogValue('');
                  }}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="space-y-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                  <div className="text-sm font-medium text-slate-900 dark:text-white">
                    {selectedRecordForInTime?.employee?.employee_name}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    {selectedRecordForInTime?.employee?.emp_no} • {selectedRecordForInTime?.date}
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">In Time (date + time) *</label>
                  <input
                    type="datetime-local"
                    value={inTimeDialogValue}
                    onChange={(e) => setInTimeDialogValue(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    required
                  />
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Enter the check-in date and time.</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleUpdateInTime}
                    disabled={!inTimeDialogValue || updatingInTime}
                    className="flex-1 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition-all hover:from-blue-600 hover:to-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updatingInTime ? 'Updating...' : 'Update In Time'}
                  </button>
                  <button
                    onClick={() => {
                      setShowInTimeDialog(false);
                      setSelectedRecordForInTime(null);
                      setInTimeDialogValue('');
                    }}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Detail Dialog */}
        {
          showDetailDialog && attendanceDetail && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-600">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                    Attendance Details - {selectedDate}
                    {selectedEmployee && (
                      <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">
                        ({selectedEmployee.employee_name})
                      </span>
                    )}
                  </h3>
                  <button
                    onClick={() => {
                      setShowDetailDialog(false);
                      setError('');
                      setSuccess('');
                    }}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Success/Error Messages */}
                {success && (
                  <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
                    {success}
                  </div>
                )}
                {error && (
                  <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                    {error}
                  </div>
                )}

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Status</label>
                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                        {attendanceDetail.status || 'ABSENT'}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Shift</label>
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                          {attendanceDetail.shifts && attendanceDetail.shifts.length > 0
                            ? attendanceDetail.shifts.map((s: any, index: number) => {
                              const sName = s.shiftId && typeof s.shiftId === 'object' ? (s.shiftId as any).name : '-';
                              return (
                                <span key={index} className="block">
                                  {sName} {attendanceDetail.shifts!.length > 1 ? `(#${index + 1})` : ''}
                                </span>
                              );
                            })
                            : (attendanceDetail.shiftId && typeof attendanceDetail.shiftId === 'object'
                              ? attendanceDetail.shiftId.name
                              : '-')}
                        </div>
                        {attendanceFeatureFlags.allowShiftChange && selectedEmployee && selectedDate && (attendanceDetail.shifts?.length > 0 || attendanceDetail.shiftId) && !editingShift && (
                          <button
                            type="button"
                            onClick={async () => {
                              const firstShiftId = attendanceDetail.shifts?.[0]?._id ?? null;
                              setSelectedShiftRecordId(firstShiftId);
                              setEditingShift(true);
                              if (availableShifts.length === 0 && selectedEmployee) {
                                await loadAvailableShifts(selectedEmployee.emp_no, selectedDate || attendanceDetail.date);
                              }
                            }}
                            className="text-xs font-semibold text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
                          >
                            Change shift
                          </button>
                        )}
                      </div>
                      {editingShift && selectedEmployee && selectedDate && (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <select
                            value={selectedShiftId}
                            onChange={(e) => setSelectedShiftId(e.target.value)}
                            className="h-8 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm min-w-[140px] focus:ring-2 focus:ring-violet-500/50"
                          >
                            <option value="">Select shift</option>
                            {availableShifts.map((s: any) => (
                              <option key={s._id} value={s._id}>{s.name}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={handleAssignShift}
                            disabled={savingShift || !selectedShiftId}
                            className="h-8 px-3 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 disabled:opacity-50"
                          >
                            {savingShift ? 'Saving…' : 'Assign'}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setEditingShift(false); setSelectedShiftId(''); setSelectedShiftRecordId(null); }}
                            className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-400">In Time</label>
                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                        {attendanceDetail.shifts && attendanceDetail.shifts.length > 0
                          ? attendanceDetail.shifts.map((s: any, i: number) => (
                            <div key={i}>{s.inTime ? formatTime(s.inTime) : '-'}</div>
                          ))
                          : (attendanceDetail.inTime ? formatTime(attendanceDetail.inTime) : '-')}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Out Time</label>
                      <div className="mt-1 flex flex-col gap-1">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                          {attendanceDetail.shifts && attendanceDetail.shifts.length > 0
                            ? attendanceDetail.shifts.map((s: any, i: number) => (
                              <div key={i}>
                                <span>{s.outTime ? formatTime(s.outTime) : '-'}</span>
                              </div>
                            ))
                            : (
                              <span>{attendanceDetail.outTime ? formatTime(attendanceDetail.outTime) : '-'}</span>
                            )}
                        </div>
                      </div>

                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Total Hours</label>
                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                        {formatHours(attendanceDetail.totalHours)}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Expected Hours</label>
                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                        {attendanceDetail.expectedHours ? formatHours(attendanceDetail.expectedHours) : '-'}
                      </div>
                    </div>
                    {selectedEmployee && selectedDate && attendanceDetail.date && (attendanceFeatureFlags.allowInTimeEditing || attendanceFeatureFlags.allowOutTimeEditing) && (
                      <div className="col-span-full sm:col-span-2 flex items-end gap-3">
                        {attendanceFeatureFlags.allowInTimeEditing && (
                          <button
                            type="button"
                            onClick={() => {
                              const firstShift = attendanceDetail.shifts?.[0];
                              const inTime = firstShift?.inTime ? new Date(firstShift.inTime) : null;
                              const baseDate = selectedDate || attendanceDetail.date;
                              const defaultDateTime = inTime
                                ? `${inTime.getFullYear()}-${String(inTime.getMonth() + 1).padStart(2, '0')}-${String(inTime.getDate()).padStart(2, '0')}T${String(inTime.getHours()).padStart(2, '0')}:${String(inTime.getMinutes()).padStart(2, '0')}`
                                : `${baseDate}T09:00`;
                              setInTimeDialogValue(defaultDateTime);
                              setSelectedRecordForInTime({
                                employee: selectedEmployee,
                                date: baseDate,
                                shiftRecordId: firstShift?._id,
                              });
                              setShowInTimeDialog(true);
                              setShowDetailDialog(false);
                            }}
                            className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                          >
                            Edit In Time
                          </button>
                        )}
                        {attendanceFeatureFlags.allowOutTimeEditing && (
                          <button
                            type="button"
                            onClick={() => {
                              const firstShift = attendanceDetail.shifts?.[0];
                              const outTime = firstShift?.outTime ? new Date(firstShift.outTime) : null;
                              const baseDate = selectedDate || attendanceDetail.date;
                              const defaultDateTime = outTime
                                ? `${outTime.getFullYear()}-${String(outTime.getMonth() + 1).padStart(2, '0')}-${String(outTime.getDate()).padStart(2, '0')}T${String(outTime.getHours()).padStart(2, '0')}:${String(outTime.getMinutes()).padStart(2, '0')}`
                                : `${baseDate}T18:00`;
                              setOutTimeValue(defaultDateTime);
                              setSelectedRecordForOutTime({
                                employee: selectedEmployee,
                                date: baseDate,
                                shiftRecordId: firstShift?._id,
                              });
                              setShowOutTimeDialog(true);
                              setShowDetailDialog(false);
                            }}
                            className="text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            Edit Out Time
                          </button>
                        )}
                      </div>
                    )}
                    {/* Late In Display - Support Multi-Shift */}
                    {(() => {
                      const shiftsWithLate = attendanceDetail.shifts?.filter((s: any) => s.lateInMinutes && s.lateInMinutes > 0) || [];
                      const hasRootLate = attendanceDetail.isLateIn && attendanceDetail.lateInMinutes;

                      if (shiftsWithLate.length > 0) {
                        return (
                          <div>
                            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Late In</label>
                            {shiftsWithLate.map((s: any, idx: number) => (
                              <div key={idx} className="mt-1 text-sm font-semibold text-orange-600 dark:text-orange-400">
                                {attendanceDetail.shifts && attendanceDetail.shifts.length > 1 ? `#${idx + 1}: ` : ''}
                                +{s.lateInMinutes} min
                              </div>
                            ))}
                          </div>
                        );
                      } else if (hasRootLate) {
                        return (
                          <div>
                            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Late In</label>
                            <div className="mt-1 text-sm font-semibold text-orange-600 dark:text-orange-400">
                              +{attendanceDetail.lateInMinutes} minutes
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {/* Early Out Display - Support Multi-Shift */}
                    {(() => {
                      const shiftsWithEarly = attendanceDetail.shifts?.filter((s: any) => s.earlyOutMinutes && s.earlyOutMinutes > 0) || [];
                      const hasRootEarly = attendanceDetail.isEarlyOut && attendanceDetail.earlyOutMinutes;

                      if (shiftsWithEarly.length > 0) {
                        return (
                          <div>
                            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Early Out</label>
                            {shiftsWithEarly.map((s: any, idx: number) => (
                              <div key={idx} className="mt-1 text-sm font-semibold text-orange-600 dark:text-orange-400">
                                {attendanceDetail.shifts && attendanceDetail.shifts.length > 1 ? `#${idx + 1}: ` : ''}
                                -{s.earlyOutMinutes} min
                              </div>
                            ))}
                            {attendanceDetail.earlyOutDeduction?.deductionApplied && (
                              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                                Deduction: {attendanceDetail.earlyOutDeduction.deductionType?.replace('_', ' ')}
                                {attendanceDetail.earlyOutDeduction.deductionDays ? ` (${attendanceDetail.earlyOutDeduction.deductionDays} day(s))` : ''}
                                {attendanceDetail.earlyOutDeduction.deductionAmount ? ` (₹${attendanceDetail.earlyOutDeduction.deductionAmount})` : ''}
                              </p>
                            )}
                          </div>
                        );
                      } else if (hasRootEarly) {
                        return (
                          <div>
                            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Early Out</label>
                            <div className="mt-1 text-sm font-semibold text-orange-600 dark:text-orange-400">
                              -{attendanceDetail.earlyOutMinutes} minutes
                            </div>
                            {attendanceDetail.earlyOutDeduction?.deductionApplied && (
                              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                                Deduction: {attendanceDetail.earlyOutDeduction.deductionType?.replace('_', ' ')}
                                {attendanceDetail.earlyOutDeduction.deductionDays ? ` (${attendanceDetail.earlyOutDeduction.deductionDays} day(s))` : ''}
                                {attendanceDetail.earlyOutDeduction.deductionAmount ? ` (₹${attendanceDetail.earlyOutDeduction.deductionAmount})` : ''}
                              </p>
                            )}
                          </div>
                        );
                      }
                      return null;
                    })()}
                    {attendanceDetail.otHours && attendanceDetail.otHours > 0 && (
                      <div>
                        <label className="text-xs font-medium text-slate-600 dark:text-slate-400">OT Hours</label>
                        <div className="mt-1 text-sm font-semibold text-orange-600 dark:text-orange-400">
                          {formatHours(attendanceDetail.otHours)} hrs
                        </div>
                      </div>
                    )}
                    {attendanceDetail.extraHours && attendanceDetail.extraHours > 0 && (
                      <div className="col-span-2">
                        <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Extra Hours</label>
                        <div className="mt-1 flex items-center justify-between">
                          <div className="text-sm font-semibold text-purple-600 dark:text-purple-400">
                            {formatHours(attendanceDetail.extraHours)} hrs
                          </div>
                          {!hasExistingOT && attendanceDetail.shiftId && (
                            <button
                              onClick={handleConvertExtraHoursToOT}
                              disabled={convertingToOT}
                              className="ml-3 rounded-lg bg-gradient-to-r from-purple-500 to-indigo-500 px-3 py-1.5 text-xs font-semibold text-white shadow-md shadow-purple-500/30 transition-all hover:from-purple-600 hover:to-indigo-600 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {convertingToOT ? 'Converting...' : 'Convert to OT'}
                            </button>

                          )}
                          {hasExistingOT && (
                            <span className={`ml-3 rounded-full px-2 py-1 text-[10px] font-medium ${otRequestStatus === 'approved'
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                              }`}>
                              {otRequestStatus === 'approved' ? 'Already Converted' : 'Pending approval'}
                            </span>
                          )}
                        </div>

                      </div>
                    )}
                    {attendanceDetail.permissionHours && attendanceDetail.permissionHours > 0 && (
                      <div>
                        <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Permission Hours</label>
                        <div className="mt-1 text-sm font-semibold text-cyan-600 dark:text-cyan-400">
                          {formatHours(attendanceDetail.permissionHours)} hrs ({attendanceDetail.permissionCount || 0} permissions)
                        </div>

                      </div>
                    )}

                    {/* Remarks / Notes */}
                    {attendanceDetail.notes && (
                      <div className="col-span-2 rounded-xl bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/50 p-4">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 text-blue-600 dark:text-blue-400">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </div>
                          <div>
                            <label className="text-[10px] font-black uppercase tracking-widest text-blue-600/70 dark:text-blue-400/70">System Remarks</label>
                            <div className="mt-1 text-sm font-bold text-blue-900 dark:text-blue-100 leading-relaxed italic">
                              &quot;{attendanceDetail.notes}&quot;
                            </div>
                          </div>
                        </div>

                      </div>
                    )}
                  </div>

                  {/* Leave Conflicts - Show if attendance is present and leave conflicts exist */}
                  {attendanceDetail.status === 'PRESENT' && leaveConflicts.length > 0 && (
                    <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
                      <div className="mb-3 flex items-center gap-2">
                        <svg className="h-5 w-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <h4 className="text-base font-semibold text-red-900 dark:text-red-200">Leave Conflict Detected</h4>
                      </div>
                      <p className="mb-3 text-sm text-red-800 dark:text-red-300">
                        Employee has approved leave but attendance is logged for this date.
                      </p>
                      {leaveConflicts.map((conflict) => (
                        <div key={conflict.leaveId} className="mb-3 rounded-lg border border-red-200 bg-white p-3 dark:border-red-700 dark:bg-slate-800">
                          <div className="mb-2 text-sm font-medium text-red-900 dark:text-red-200">
                            {conflict.leaveType} - {conflict.numberOfDays} day(s)
                          </div>
                          <div className="mb-2 text-xs text-red-700 dark:text-red-300">
                            {new Date(conflict.fromDate).toLocaleDateString()}
                            {conflict.fromDate !== conflict.toDate && ` - ${new Date(conflict.toDate).toLocaleDateString()}`}
                            {conflict.isHalfDay && ` (${conflict.halfDayType === 'first_half' ? 'First Half' : 'Second Half'})`}
                          </div>
                          <div className="flex gap-2">
                            {conflict.conflictType === 'full_day' ? (
                              <button
                                onClick={() => handleRevokeLeave(conflict.leaveId)}
                                disabled={revokingLeave}
                                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {revokingLeave ? 'Revoking...' : 'Revoke Leave'}
                              </button>
                            ) : (
                              <button
                                onClick={() => handleUpdateLeave(conflict.leaveId)}
                                disabled={updatingLeave}
                                className="rounded-lg bg-orange-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {updatingLeave ? 'Updating...' : 'Update Leave'}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Leave Information */}
                  {attendanceDetail.hasLeave && attendanceDetail.leaveInfo && (
                    <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-4 dark:border-orange-800 dark:bg-orange-900/20">
                      <h4 className="mb-3 text-base font-semibold text-orange-900 dark:text-orange-200">Leave Information</h4>

                      {/* Purpose/Reason */}
                      {attendanceDetail.leaveInfo.purpose ? (
                        <div className="mb-3">
                          <label className="text-xs font-medium text-orange-700 dark:text-orange-300">Purpose/Reason</label>
                          <div className="mt-1 text-sm text-orange-900 dark:text-orange-100">
                            {attendanceDetail.leaveInfo.purpose}
                          </div>
                        </div>
                      ) : null}

                      <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                        <div>
                          <label className="text-xs font-medium text-orange-700 dark:text-orange-300">Leave Type</label>
                          <div className="mt-1 font-semibold text-orange-900 dark:text-orange-100">
                            {attendanceDetail.leaveInfo.leaveType || 'N/A'}
                          </div>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-orange-700 dark:text-orange-300">Half Day</label>
                          <div className="mt-1 font-semibold text-orange-900 dark:text-orange-100">
                            {attendanceDetail.leaveInfo.isHalfDay ? 'Yes' : 'No'}
                            {attendanceDetail.leaveInfo.isHalfDay && attendanceDetail.leaveInfo.halfDayType && (
                              <span className="ml-1 text-xs">({attendanceDetail.leaveInfo.halfDayType === 'first_half' ? 'First Half' : 'Second Half'})</span>
                            )}
                          </div>

                        </div>
                      </div>

                      {/* Date Range */}
                      {attendanceDetail.leaveInfo.fromDate && attendanceDetail.leaveInfo.toDate && (
                        <div className="mb-3">
                          <label className="text-xs font-medium text-orange-700 dark:text-orange-300">Date Range</label>
                          <div className="mt-1 text-sm font-semibold text-orange-900 dark:text-orange-100">
                            {new Date(attendanceDetail.leaveInfo.fromDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} - {new Date(attendanceDetail.leaveInfo.toDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                          </div>
                        </div>
                      )}

                      {/* Number of Days and Day in Leave */}
                      <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                        <div>
                          <label className="text-xs font-medium text-orange-700 dark:text-orange-300">Total Days</label>
                          <div className="mt-1 font-semibold text-orange-900 dark:text-orange-100">
                            {attendanceDetail.leaveInfo.numberOfDays !== undefined && attendanceDetail.leaveInfo.numberOfDays !== null
                              ? `${attendanceDetail.leaveInfo.numberOfDays} ${attendanceDetail.leaveInfo.numberOfDays === 1 ? 'day' : 'days'}`
                              : 'N/A'}
                          </div>

                        </div>
                        {attendanceDetail.leaveInfo.dayInLeave !== undefined && attendanceDetail.leaveInfo.dayInLeave !== null && (
                          <div>
                            <label className="text-xs font-medium text-orange-700 dark:text-orange-300">Day in Leave</label>
                            <div className="mt-1 font-semibold text-orange-900 dark:text-orange-100">
                              {attendanceDetail.leaveInfo.dayInLeave === 1 ? '1st day' : attendanceDetail.leaveInfo.dayInLeave === 2 ? '2nd day' : attendanceDetail.leaveInfo.dayInLeave === 3 ? '3rd day' : `${attendanceDetail.leaveInfo.dayInLeave}th day`}
                            </div>

                          </div>

                        )}

                      </div>

                      {/* Applied Date */}
                      {attendanceDetail.leaveInfo.appliedAt && (
                        <div className="mb-3">
                          <label className="text-xs font-medium text-orange-700 dark:text-orange-300">Applied On</label>
                          <div className="mt-1 text-sm text-orange-900 dark:text-orange-100">
                            {new Date(attendanceDetail.leaveInfo.appliedAt).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      )}

                      {/* Approved By and When */}
                      {attendanceDetail.leaveInfo.approvedBy && (
                        <div className="mb-3 grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-medium text-orange-700 dark:text-orange-300">Approved By</label>
                            <div className="mt-1 text-sm font-semibold text-orange-900 dark:text-orange-100">
                              {attendanceDetail.leaveInfo.approvedBy.name || attendanceDetail.leaveInfo.approvedBy.email || 'N/A'}
                            </div>
                          </div>
                          {attendanceDetail.leaveInfo.approvedAt && (
                            <div>
                              <label className="text-xs font-medium text-orange-700 dark:text-orange-300">Approved On</label>
                              <div className="mt-1 text-sm text-orange-900 dark:text-orange-100">
                                {new Date(attendanceDetail.leaveInfo.approvedAt).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>

                          )}

                        </div>
                      )}

                      {attendanceDetail.isConflict && (
                        <div className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs font-semibold text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                          ⚠️ Conflict: Leave approved but attendance logged for this date
                        </div>
                      )}
                    </div>
                  )}

                  {/* OD Information */}
                  {attendanceDetail.hasOD && attendanceDetail.odInfo && (
                    <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
                      <h4 className="mb-3 text-base font-semibold text-blue-900 dark:text-blue-200">On Duty (OD) Information</h4>

                      {/* Early-Out Info */}
                      {attendanceDetail.earlyOutMinutes !== undefined && attendanceDetail.earlyOutMinutes !== null && (
                        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/20">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs font-medium text-amber-700 dark:text-amber-300">Early-Out Minutes</p>
                              <p className="text-lg font-semibold text-amber-900 dark:text-amber-100">
                                {attendanceDetail.earlyOutMinutes} min
                              </p>
                            </div>
                            {attendanceDetail.earlyOutDeduction?.deductionApplied && (
                              <div className="text-right">
                                <p className="text-xs font-medium text-amber-700 dark:text-amber-300">Deduction Applied</p>
                                <p className="text-sm font-semibold text-amber-900 dark:text-amber-100 capitalize">
                                  {attendanceDetail.earlyOutDeduction.deductionType?.replace('_', ' ') || 'N/A'}
                                </p>
                                {attendanceDetail.earlyOutDeduction.deductionDays && (
                                  <p className="text-xs text-amber-700 dark:text-amber-300">
                                    {attendanceDetail.earlyOutDeduction.deductionDays} day(s)
                                  </p>
                                )}
                                {attendanceDetail.earlyOutDeduction.deductionAmount && (
                                  <p className="text-xs text-amber-700 dark:text-amber-300">
                                    ₹{attendanceDetail.earlyOutDeduction.deductionAmount}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                          {attendanceDetail.earlyOutDeduction?.reason && (
                            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                              {attendanceDetail.earlyOutDeduction.reason}
                            </p>
                          )}

                        </div>
                      )}

                      {/* Purpose/Reason */}
                      {attendanceDetail.odInfo.purpose && (
                        <div className="mb-3">
                          <label className="text-xs font-medium text-blue-700 dark:text-blue-300">Purpose/Reason</label>
                          <div className="mt-1 text-sm text-blue-900 dark:text-blue-100">
                            {attendanceDetail.odInfo.purpose}
                          </div>
                        </div>
                      )}

                      {/* Place Visited */}
                      {attendanceDetail.odInfo.placeVisited && (
                        <div className="mb-3">
                          <label className="text-xs font-medium text-blue-700 dark:text-blue-300">Place Visited</label>
                          <div className="mt-1 text-sm text-blue-900 dark:text-blue-100">
                            {attendanceDetail.odInfo.placeVisited}
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3 text-sm mb-3">

                        <div>
                          <label className="text-xs font-medium text-blue-700 dark:text-blue-300">OD Type</label>
                          <div className="mt-1 font-semibold text-blue-900 dark:text-blue-100">
                            {attendanceDetail.odInfo.odType || 'N/A'}
                          </div>

                        </div>
                        <div>
                          <label className="text-xs font-medium text-blue-700 dark:text-blue-300">
                            {attendanceDetail.odInfo.odType_extended === 'hours' ? 'Duration Type' : 'Half Day'}
                          </label>
                          <div className="mt-1 font-semibold text-blue-900 dark:text-blue-100">
                            {attendanceDetail.odInfo.odType_extended === 'hours' ? (
                              'Hour-Based OD'
                            ) : attendanceDetail.odInfo.isHalfDay ? (
                              <>
                                Yes
                                {attendanceDetail.odInfo.halfDayType && (
                                  <span className="ml-1 text-xs">({attendanceDetail.odInfo.halfDayType === 'first_half' ? 'First Half' : 'Second Half'})</span>
                                )}
                              </>
                            ) : (
                              'No'
                            )}
                          </div>
                        </div>

                      </div>

                      {/* Date Range */}
                      {attendanceDetail.odInfo.fromDate && attendanceDetail.odInfo.toDate && (
                        <div className="mb-3">
                          <label className="text-xs font-medium text-blue-700 dark:text-blue-300">Date Range</label>
                          <div className="mt-1 text-sm font-semibold text-blue-900 dark:text-blue-100">
                            {new Date(attendanceDetail.odInfo.fromDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} - {new Date(attendanceDetail.odInfo.toDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                          </div>

                        </div>
                      )}

                      {/* Hour-Based OD: Show Hours */}
                      {attendanceDetail.odInfo.odType_extended === 'hours' && attendanceDetail.odInfo.durationHours && (
                        <div className="mb-3 p-3 rounded-lg bg-blue-100 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700">
                          <label className="text-xs font-medium text-blue-700 dark:text-blue-300 block mb-2">OD Hours</label>
                          <div className="text-lg font-bold text-blue-900 dark:text-blue-100">
                            {(() => {
                              const hours = Math.floor(attendanceDetail.odInfo.durationHours || 0);
                              const mins = Math.round((attendanceDetail.odInfo.durationHours || 0) % 1 * 60);
                              return `${hours}h ${mins}m`;
                            })()}
                          </div>
                          {attendanceDetail.odInfo.odStartTime && attendanceDetail.odInfo.odEndTime && (
                            <div className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                              Time: {attendanceDetail.odInfo.odStartTime} - {attendanceDetail.odInfo.odEndTime}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Full Day / Half Day: Show Days */}
                      {attendanceDetail.odInfo.odType_extended !== 'hours' && (
                        <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                          <div>
                            <label className="text-xs font-medium text-blue-700 dark:text-blue-300">Total Days</label>
                            <div className="mt-1 font-semibold text-blue-900 dark:text-blue-100">
                              {attendanceDetail.odInfo.numberOfDays || 'N/A'} {attendanceDetail.odInfo.numberOfDays === 1 ? 'day' : 'days'}
                            </div>

                          </div>
                          {attendanceDetail.odInfo.dayInOD && (
                            <div>
                              <label className="text-xs font-medium text-blue-700 dark:text-blue-300">Day in OD</label>
                              <div className="mt-1 font-semibold text-blue-900 dark:text-blue-100">
                                {attendanceDetail.odInfo.dayInOD === 1 ? '1st day' : attendanceDetail.odInfo.dayInOD === 2 ? '2nd day' : attendanceDetail.odInfo.dayInOD === 3 ? '3rd day' : `${attendanceDetail.odInfo.dayInOD}th day`}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Applied Date */}
                      {attendanceDetail.odInfo.appliedAt && (
                        <div className="mb-3">
                          <label className="text-xs font-medium text-blue-700 dark:text-blue-300">Applied On</label>
                          <div className="mt-1 text-sm text-blue-900 dark:text-blue-100">
                            {new Date(attendanceDetail.odInfo.appliedAt).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>

                      )}

                      {/* Approved By and When */}
                      {attendanceDetail.odInfo.approvedBy && (
                        <div className="mb-3 grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-medium text-blue-700 dark:text-blue-300">Approved By</label>
                            <div className="mt-1 text-sm font-semibold text-blue-900 dark:text-blue-100">
                              {attendanceDetail.odInfo.approvedBy.name || attendanceDetail.odInfo.approvedBy.email || 'N/A'}
                            </div>
                          </div>
                          {attendanceDetail.odInfo.approvedAt && (
                            <div>
                              <label className="text-xs font-medium text-blue-700 dark:text-blue-300">Approved On</label>
                              <div className="mt-1 text-sm text-blue-900 dark:text-blue-100">
                                {new Date(attendanceDetail.odInfo.approvedAt).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Only show conflict for full-day OD (not for half-day or hour-based OD) */}
                      {attendanceDetail.isConflict &&
                        attendanceDetail.odInfo &&
                        attendanceDetail.odInfo.odType_extended !== 'half_day' &&
                        attendanceDetail.odInfo.odType_extended !== 'hours' && (
                          <div className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs font-semibold text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                            ⚠️ Conflict: OD approved but attendance logged for this date
                          </div>
                        )}
                    </div>
                  )}

                  {/* Edit History Section */}
                  {attendanceDetail.editHistory && attendanceDetail.editHistory.length > 0 && (
                    <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                      <div className="flex items-center gap-2 mb-4">
                        <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Edit History</h4>
                      </div>
                      <div className="space-y-3">
                        {attendanceDetail.editHistory.map((edit: any, index: number) => (
                          <div key={index} className="relative pl-4 border-l-2 border-slate-200 dark:border-slate-700 py-1">
                            <div className="flex justify-between items-start">
                              <span className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-tighter">
                                {edit.action?.replace(/_/g, ' ')}
                              </span>
                              <span className="text-[10px] text-slate-400 font-medium">
                                {new Date(edit.modifiedAt).toLocaleString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed font-medium">
                              {edit.details}
                            </p>
                            <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-500 italic">
                              Modified by: <span className="font-bold text-slate-700 dark:text-slate-300">{edit.modifiedByName || 'System'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        }

        {attendanceDeductionInfo && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-24"
            onClick={() => setAttendanceDeductionInfo(null)}
          >
            <div
              className="w-full max-w-sm rounded-xl border border-violet-200 bg-white p-4 shadow-2xl dark:border-violet-800 dark:bg-slate-900"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-bold text-violet-900 dark:text-violet-200">Attendance Deduction Split</h4>
                <button
                  type="button"
                  className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => setAttendanceDeductionInfo(null)}
                >
                  Close
                </button>
              </div>
              <p className="mb-3 text-xs text-slate-600 dark:text-slate-300">{attendanceDeductionInfo.employeeName}</p>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300">Late/Early deduction days</span>
                  <span className="font-semibold text-rose-700 dark:text-rose-300">{attendanceDeductionInfo.lateEarlyDays.toFixed(2).replace(/\.?0+$/, '') || '0'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300">Absent extra deduction days</span>
                  <span className="font-semibold text-red-700 dark:text-red-300">{attendanceDeductionInfo.absentDays.toFixed(2).replace(/\.?0+$/, '') || '0'}</span>
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2 dark:border-slate-700">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">Total deduction days</span>
                  <span className="font-bold text-violet-900 dark:text-violet-200">{attendanceDeductionInfo.total.toFixed(2).replace(/\.?0+$/, '') || '0'}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Monthly Summary Modal */}
        {
          showSummaryModal && selectedEmployeeForSummary !== null && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900 print:shadow-none">
                <div className="mb-4 flex items-center justify-between print:hidden">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Monthly Attendance Summary</h3>
                  <button
                    onClick={() => {
                      setShowSummaryModal(false);
                      setSelectedEmployeeForSummary(null);
                      setMonthlySummary(null);
                    }}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {loadingSummary ? (
                  <div className="flex items-center justify-center p-12">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent"></div>
                  </div>
                ) : monthlySummary ? (
                  <div className="space-y-6">
                    {/* Employee Details */}
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
                      <h4 className="mb-3 text-base font-bold text-slate-900 dark:text-white">Employee Details</h4>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="font-medium text-slate-600 dark:text-slate-400">Name:</span>
                          <span className="ml-2 text-slate-900 dark:text-white">{selectedEmployeeForSummary?.employee_name || '-'}</span>
                        </div>
                        <div>
                          <span className="font-medium text-slate-600 dark:text-slate-400">Employee Number:</span>
                          <span className="ml-2 text-slate-900 dark:text-white">{selectedEmployeeForSummary?.emp_no || '-'}</span>
                        </div>
                        {selectedEmployeeForSummary && selectedEmployeeForSummary.department && (
                          <div>
                            <span className="font-medium text-slate-600 dark:text-slate-400">Department:</span>
                            <span className="ml-2 text-slate-900 dark:text-white">{(selectedEmployeeForSummary.department as any)?.name || '-'}</span>
                          </div>
                        )}
                        {selectedEmployeeForSummary && selectedEmployeeForSummary.designation && (
                          <div>
                            <span className="font-medium text-slate-600 dark:text-slate-400">Designation:</span>
                            <span className="ml-2 text-slate-900 dark:text-white">{(selectedEmployeeForSummary.designation as any)?.name || '-'}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Monthly Summary Table */}
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700">
                      <table className="w-full border-collapse text-sm">
                        <thead className="bg-slate-100 dark:bg-slate-800">
                          <tr>
                            <th className="border border-slate-300 px-4 py-2 text-left font-semibold text-slate-900 dark:border-slate-600 dark:text-white">Month</th>
                            <th className="border border-slate-300 px-4 py-2 text-right font-semibold text-slate-900 dark:border-slate-600 dark:text-white">Total Leaves</th>
                            <th className="border border-slate-300 px-4 py-2 text-right font-semibold text-slate-900 dark:border-slate-600 dark:text-white">Total ODs</th>
                            <th className="border border-slate-300 px-4 py-2 text-right font-semibold text-slate-900 dark:border-slate-600 dark:text-white">Present Days</th>
                            <th className="border border-slate-300 px-4 py-2 text-right font-semibold text-slate-900 dark:border-slate-600 dark:text-white">Total Days</th>
                            <th className="border border-slate-300 px-4 py-2 text-right font-semibold text-slate-900 dark:border-slate-600 dark:text-white">Payable Shifts</th>
                            <th className="border border-slate-300 px-4 py-2 text-right font-semibold text-slate-900 dark:border-slate-600 dark:text-white" title="Late/early policy + absent extra (same as payroll)">Att. deduction days</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td className="border border-slate-300 px-4 py-2 text-slate-900 dark:border-slate-600 dark:text-white">{monthlySummary.monthName || `${monthNames[month - 1]} ${year}`}</td>
                            <td className="border border-slate-300 px-4 py-2 text-right text-slate-900 dark:border-slate-600 dark:text-white">{monthlySummary.totalLeaves || 0}</td>
                            <td className="border border-slate-300 px-4 py-2 text-right text-slate-900 dark:border-slate-600 dark:text-white">{monthlySummary.totalODs || 0}</td>
                            <td className="border border-slate-300 px-4 py-2 text-right text-slate-900 dark:border-slate-600 dark:text-white">{monthlySummary.totalPresentDays || 0}</td>
                            <td className="border border-slate-300 px-4 py-2 text-right text-slate-900 dark:border-slate-600 dark:text-white">{monthlySummary.totalDaysInMonth || 0}</td>
                            <td className="border border-slate-300 px-4 py-2 text-right font-semibold text-slate-900 dark:border-slate-600 dark:text-white">{monthlySummary.totalPayableShifts?.toFixed(2) || '0.00'}</td>
                            <td className="border border-slate-300 px-4 py-2 text-right font-semibold text-purple-800 dark:text-purple-200">{Number(monthlySummary.totalAttendanceDeductionDays ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* Footer with Signature and Timestamp */}
                    <div className="mt-8 flex items-end justify-between border-t border-slate-200 pt-4 dark:border-slate-700 print:mt-12">
                      <div>
                        <div className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-400">Authorized Signature</div>
                        <div className="h-12 w-48 border-b border-slate-300 dark:border-slate-600"></div>
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Printed: {new Date().toLocaleString()}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex justify-end gap-3 print:hidden">
                      {hasManagePermission && (
                        <button
                          onClick={handleExportPDF}
                          className="rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition-all hover:from-blue-600 hover:to-indigo-600"
                        >
                          Export as PDF
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setShowSummaryModal(false);
                          setSelectedEmployeeForSummary(null);
                          setMonthlySummary(null);
                        }}
                        className="rounded-xl border border-slate-200 bg-white px-6 py-2.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-12 text-center text-slate-500 dark:text-slate-400">
                    No summary data available
                  </div>
                )}
              </div>
            </div>
          )
        }

        {/* Type-Specific Summary Modal */}
        {
          showTypeSummaryModal && typeSummaryData && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50">
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white capitalize">
                      {typeSummaryData.type.replace('_', ' ')} Details
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {typeSummaryData.item.employee.employee_name} • {monthNames[month - 1]} {year}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowTypeSummaryModal(false)}
                    className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 transition-colors"
                  >
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                  <div className="rounded-xl border border-slate-200 overflow-hidden dark:border-slate-700 shadow-sm">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300">
                        <tr>
                          <th className="px-4 py-3 font-semibold border-b border-slate-200 dark:border-slate-700">Date</th>
                          {typeSummaryData.type === 'in_out' ? (
                            <>
                              <th className="px-4 py-3 font-semibold border-b border-slate-200 dark:border-slate-700">In Time</th>
                              <th className="px-4 py-3 font-semibold border-b border-slate-200 dark:border-slate-700">Out Time</th>
                            </>
                          ) : typeSummaryData.type === 'ot' || typeSummaryData.type === 'extra' ? (
                            <>
                              <th className="px-4 py-3 font-semibold border-b border-slate-200 dark:border-slate-700">OT Hours</th>
                              <th className="px-4 py-3 font-semibold border-b border-slate-200 dark:border-slate-700">Extra Hours</th>
                            </>
                          ) : typeSummaryData.type === 'leaves' ? (
                            <>
                              <th className="px-4 py-3 font-semibold border-b border-slate-200 dark:border-slate-700">Leave Type</th>
                              <th className="px-4 py-3 font-semibold border-b border-slate-200 dark:border-slate-700">Paid / LOP</th>
                              <th className="px-4 py-3 font-semibold border-b border-slate-200 dark:border-slate-700">Reason</th>
                            </>
                          ) : typeSummaryData.type === 'od' ? (
                            <>
                              <th className="px-4 py-3 font-semibold border-b border-slate-200 dark:border-slate-700">OD Type</th>
                              <th className="px-4 py-3 font-semibold border-b border-slate-200 dark:border-slate-700">Place/Purpose</th>
                            </>
                          ) : (
                            <th className="px-4 py-3 font-semibold border-b border-slate-200 dark:border-slate-700">Status</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {Object.entries(typeSummaryData.item.dailyAttendance)
                          .filter(([_, record]) => {
                            if (!record) return false;
                            if (typeSummaryData.type === 'present') return record.status === 'PRESENT' || record.status === 'PARTIAL';
                            if (typeSummaryData.type === 'absent') return record.status === 'ABSENT' || (!record.status && !record.hasLeave && !record.hasOD);
                            if (typeSummaryData.type === 'leaves') return record.hasLeave || record.status === 'LEAVE';
                            if (typeSummaryData.type === 'od') return record.hasOD;
                            if (typeSummaryData.type === 'ot') return (record.otHours || 0) > 0;
                            if (typeSummaryData.type === 'extra') return (record.extraHours || 0) > 0;
                            if (typeSummaryData.type === 'permission') return (record.permissionCount || 0) > 0;
                            if (typeSummaryData.type === 'in_out') return !!record.inTime;
                            return true;
                          })
                          .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
                          .map(([date, record]) => (
                            <tr key={date} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                              <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                                {new Date(date).toLocaleDateString(undefined, { day: '2-digit', month: 'short', weekday: 'short' })}
                              </td>
                              {typeSummaryData.type === 'in_out' ? (
                                <>
                                  <td className="px-4 py-3 text-green-600 font-semibold">{record?.inTime ? formatTime(record.inTime) : '-'}</td>
                                  <td className="px-4 py-3 text-red-600 font-semibold">{record?.outTime ? formatTime(record.outTime) : '-'}</td>
                                </>
                              ) : typeSummaryData.type === 'ot' || typeSummaryData.type === 'extra' ? (
                                <>
                                  <td className="px-4 py-3 text-orange-600 font-bold">{record?.otHours?.toFixed(1) || '0.0'}</td>
                                  <td className="px-4 py-3 text-purple-600 font-bold">{record?.extraHours?.toFixed(1) || '0.0'}</td>
                                </>
                              ) : typeSummaryData.type === 'leaves' ? (
                                <>
                                  <td className="px-4 py-3 font-semibold text-orange-600">
                                    {record?.leaveInfo?.leaveType || 'Leave'}
                                    {record?.leaveInfo?.isHalfDay ? (
                                      <span className="ml-1 text-[10px] font-normal text-slate-500">(half)</span>
                                    ) : null}
                                  </td>
                                  <td className="px-4 py-3">
                                    {(() => {
                                      const anyR = record as any;
                                      const lop =
                                        anyR?.leaveNature === 'lop' ||
                                        anyR?.leaveInfo?.leaveType?.toLowerCase().includes('lop') ||
                                        anyR?.leaveInfo?.leaveType?.toLowerCase().includes('loss of pay');
                                      return (
                                        <span
                                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${lop ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'}`}
                                        >
                                          {lop ? 'LOP' : 'Paid'}
                                        </span>
                                      );
                                    })()}
                                  </td>
                                  <td className="px-4 py-3 text-slate-500 truncate max-w-[200px]" title={record?.leaveInfo?.purpose || ''}>{record?.leaveInfo?.purpose || '-'}</td>
                                </>
                              ) : typeSummaryData.type === 'od' ? (
                                <>
                                  <td className="px-4 py-3 font-semibold text-indigo-600">{record?.odInfo?.odType || 'OD'}</td>
                                  <td className="px-4 py-3 text-slate-500 truncate max-w-[200px]" title={`${record?.odInfo?.placeVisited || ''} ${record?.odInfo?.purpose || ''}`}>
                                    {record?.odInfo?.placeVisited || record?.odInfo?.purpose || '-'}
                                  </td>
                                </>
                              ) : (
                                <td className="px-4 py-3 font-semibold">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] ${record?.status === 'PRESENT' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                    {record?.status || 'ABSENT'}
                                  </span>
                                </td>
                              )}
                            </tr>
                          ))}
                        {Object.entries(typeSummaryData.item.dailyAttendance).filter(([_, record]) => {
                          if (!record) return false;
                          if (typeSummaryData.type === 'present') return record.status === 'PRESENT' || record.status === 'PARTIAL';
                          if (typeSummaryData.type === 'absent') return record.status === 'ABSENT' || (!record.status && !record.hasLeave && !record.hasOD);
                          if (typeSummaryData.type === 'leaves') return record.hasLeave || record.status === 'LEAVE';
                          if (typeSummaryData.type === 'od') return record.hasOD;
                          if (typeSummaryData.type === 'ot') return (record.otHours || 0) > 0;
                          if (typeSummaryData.type === 'extra') return (record.extraHours || 0) > 0;
                          if (typeSummaryData.type === 'permission') return (record.permissionCount || 0) > 0;
                          if (typeSummaryData.type === 'in_out') return !!record.inTime;
                          return true;
                        }).length === 0 && (
                            <tr>
                              <td
                                colSpan={
                                  typeSummaryData.type === 'leaves'
                                    ? 4
                                    : typeSummaryData.type === 'in_out' ||
                                        typeSummaryData.type === 'ot' ||
                                        typeSummaryData.type === 'extra' ||
                                        typeSummaryData.type === 'od'
                                      ? 3
                                      : 2
                                }
                                className="px-4 py-8 text-center text-slate-400 italic"
                              >
                                No records found for this category.
                              </td>
                            </tr>
                          )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="p-6 border-t border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 flex justify-end">
                  <button
                    onClick={() => setShowTypeSummaryModal(false)}
                    className="px-6 py-2 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl font-bold hover:bg-slate-300 dark:hover:bg-slate-600 transition-all shadow-sm"
                  >
                    Close
                  </button>

                </div>

              </div>
            </div>
          )
        }

        {/* Payslip Modal */}
        {

          showPayslipModal && selectedEmployeeForPayslip !== null && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900 print:shadow-none print:max-w-full print:rounded-none">
                <div className="mb-4 flex items-center justify-between print:hidden">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Payslip</h3>
                  <div className="flex items-center gap-2">
                    {error && error.includes('not found') && hasManagePermission && (
                      <button
                        onClick={handleCalculatePayroll}
                        disabled={calculatingPayroll}
                        className="rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50"
                      >
                        {calculatingPayroll ? 'Calculating...' : 'Calculate Payroll'}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setShowPayslipModal(false);
                        setSelectedEmployeeForPayslip(null);
                        setPayslipData(null);
                        setError('');
                      }}
                      className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {loadingPayslip ? (
                  <div className="flex items-center justify-center p-12">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent"></div>
                  </div>
                ) : error && !error.includes('not found') ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
                    {error}
                  </div>
                ) : payslipData ? (
                  <div className="space-y-4 print:space-y-3">
                    {/* Payslip Header */}
                    <div className="border-b-2 border-slate-300 pb-3 dark:border-slate-600">
                      <h2 className="text-center text-xl font-bold text-slate-900 dark:text-white">
                        PAYSLIP FOR THE MONTH OF: {(() => {
                          const monthStr = payslipData.month || `${monthNames[month - 1]} ${year}`;
                          // Format as "DEC 19" style
                          const monthMatch = monthStr.match(/(\w+)\s+(\d{4})/);
                          if (monthMatch) {
                            const monthName = monthMatch[1].substring(0, 3).toUpperCase();
                            const yearShort = monthMatch[2].substring(2);
                            return `${monthName} ${yearShort}`;
                          }
                          return monthStr.toUpperCase();
                        })()}
                      </h2>
                    </div>

                    {/* Employee Details - Matching exact format from image */}
                    <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                      <div className="flex">
                        <span className="font-semibold text-slate-700 dark:text-slate-300 w-24">Emp Code:</span>
                        <span className="text-slate-900 dark:text-white">{payslipData.employee?.emp_no || '-'}</span>
                      </div>
                      <div className="flex">
                        <span className="font-semibold text-slate-700 dark:text-slate-300 w-32">Emp Name:</span>
                        <span className="text-slate-900 dark:text-white">{payslipData.employee?.name || '-'}</span>
                      </div>
                      <div className="flex">
                        <span className="font-semibold text-slate-700 dark:text-slate-300 w-24">Department:</span>
                        <span className="text-slate-900 dark:text-white">{payslipData.employee?.department || '-'}</span>
                      </div>
                      <div className="flex">
                        <span className="font-semibold text-slate-700 dark:text-slate-300 w-32">Designation:</span>
                        <span className="text-slate-900 dark:text-white">{payslipData.employee?.designation || '-'}</span>
                      </div>
                      <div className="flex">
                        <span className="font-semibold text-slate-700 dark:text-slate-300 w-24">Location:</span>
                        <span className="text-slate-900 dark:text-white">{payslipData.employee?.location || '-'}</span>
                      </div>
                      <div className="flex">
                        <span className="font-semibold text-slate-700 dark:text-slate-300 w-32">Bank A/c No.:</span>
                        <span className="text-slate-900 dark:text-white">{payslipData.employee?.bank_account_no || '-'}</span>
                      </div>
                      <div className="flex">
                        <span className="font-semibold text-slate-700 dark:text-slate-300 w-24">PAID LEAVES:</span>
                        <span className="text-slate-900 dark:text-white">{payslipData.employee?.paidLeaves || 0}</span>
                      </div>
                      <div className="flex">
                        <span className="font-semibold text-slate-700 dark:text-slate-300 w-32">PAID DAYS:</span>
                        <span className="font-bold text-slate-900 dark:text-white">{payslipData.paidDays || payslipData.totalPayableShifts || 0}</span>
                      </div>
                      <div className="flex">
                        <span className="font-semibold text-slate-700 dark:text-slate-300 w-24">PF Code No.:</span>
                        <span className="text-slate-900 dark:text-white">{payslipData.employee?.pf_number || '-'}</span>
                      </div>
                      <div className="flex">
                        <span className="font-semibold text-slate-700 dark:text-slate-300 w-32">PF UAN:</span>
                        <span className="text-slate-900 dark:text-white">{payslipData.employee?.pf_number || '-'}</span>
                      </div>
                      <div className="flex">
                        <span className="font-semibold text-slate-700 dark:text-slate-300 w-24">ESI No.:</span>
                        <span className="text-slate-900 dark:text-white">{payslipData.employee?.esi_number || '-'}</span>
                      </div>
                    </div>

                    {/* Earnings and Deductions Side by Side */}
                    <div className="grid grid-cols-2 gap-4">
                      {/* Earnings Section - Left Side */}
                      <div className="border border-slate-300 dark:border-slate-600">
                        <h3 className="border-b border-slate-300 bg-slate-100 px-4 py-2 text-left font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white">
                          EARNINGS
                        </h3>
                        <div className="divide-y divide-slate-200 dark:divide-slate-700">
                          <div className="flex justify-between px-4 py-2">
                            <span className="text-slate-700 dark:text-slate-300">Basic:</span>
                            <span className="font-semibold text-slate-900 dark:text-white">{payslipData.earnings?.basicPay?.toFixed(2) || '0.00'}</span>
                          </div>
                          {/* Map allowances - VDA, HRA, WA, etc. */}
                          {payslipData.earnings?.allowances && payslipData.earnings.allowances.length > 0 && payslipData.earnings.allowances.map((allowance: any, idx: number) => (
                            <div key={idx} className="flex justify-between px-4 py-2">
                              <span className="text-slate-700 dark:text-slate-300">{allowance.name?.toUpperCase() || 'ALLOWANCE'}:</span>
                              <span className="font-semibold text-slate-900 dark:text-white">{allowance.amount?.toFixed(2) || '0.00'}</span>
                            </div>
                          ))}
                          {payslipData.earnings?.incentive !== 0 && (
                            <div className="flex justify-between px-4 py-2">
                              <span className="text-slate-700 dark:text-slate-300">INCENTIVE:</span>
                              <span className="font-semibold text-slate-900 dark:text-white">{payslipData.earnings?.incentive?.toFixed(2) || '0.00'}</span>
                            </div>
                          )}
                          {payslipData.earnings?.otPay > 0 && (
                            <div className="flex justify-between px-4 py-2">
                              <span className="text-slate-700 dark:text-slate-300">OT PAY:</span>
                              <span className="font-semibold text-slate-900 dark:text-white">{payslipData.earnings?.otPay?.toFixed(2) || '0.00'}</span>
                            </div>
                          )}
                          <div className="flex justify-between border-t-2 border-slate-300 bg-slate-100 px-4 py-2 font-bold dark:border-slate-600 dark:bg-slate-800">
                            <span className="text-slate-900 dark:text-white">Gross Salary Rs.:</span>
                            <span className="text-slate-900 dark:text-white">{payslipData.earnings?.grossSalary?.toFixed(2) || '0.00'}</span>
                          </div>
                        </div>

                      </div>

                      {/* Deductions Section - Right Side */}
                      <div className="border border-slate-300 dark:border-slate-600">
                        <h3 className="border-b border-slate-300 bg-slate-100 px-4 py-2 text-left font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white">
                          DEDUCTIONS
                        </h3>
                        <div className="divide-y divide-slate-200 dark:divide-slate-700">
                          {/* Other deductions first (PF, ESIC, TDS, etc.) */}
                          {payslipData.deductions?.otherDeductions && payslipData.deductions.otherDeductions.length > 0 && payslipData.deductions.otherDeductions.map((deduction: any, idx: number) => (
                            <div key={idx} className="flex justify-between px-4 py-2">
                              <span className="text-slate-700 dark:text-slate-300">{deduction.name || 'Deduction'}:</span>
                              <span className="font-semibold text-red-600 dark:text-red-400">{deduction.amount?.toFixed(2) || '0.00'}</span>
                            </div>
                          ))}
                          {/* TDS - if exists in other deductions, otherwise show if configured */}
                          {payslipData.deductions?.attendanceDeduction > 0 && (
                            <div className="flex justify-between px-4 py-2">
                              <span className="text-slate-700 dark:text-slate-300">Attendance Deduction:</span>
                              <span className="font-semibold text-red-600 dark:text-red-400">{payslipData.deductions.attendanceDeduction.toFixed(2)}</span>
                            </div>
                          )}
                          {payslipData.deductions?.permissionDeduction > 0 && (
                            <div className="flex justify-between px-4 py-2">
                              <span className="text-slate-700 dark:text-slate-300">Permission Deduction:</span>
                              <span className="font-semibold text-red-600 dark:text-red-400">{payslipData.deductions.permissionDeduction.toFixed(2)}</span>
                            </div>
                          )}
                          {payslipData.deductions?.leaveDeduction > 0 && (
                            <div className="flex justify-between px-4 py-2">
                              <span className="text-slate-700 dark:text-slate-300">Leave Deduction:</span>
                              <span className="font-semibold text-red-600 dark:text-red-400">{payslipData.deductions.leaveDeduction.toFixed(2)}</span>
                            </div>
                          )}
                          {payslipData.loanAdvance?.advanceDeduction > 0 && (
                            <div className="flex justify-between px-4 py-2">
                              <span className="text-slate-700 dark:text-slate-300">AdV:</span>
                              <span className="font-semibold text-red-600 dark:text-red-400">{payslipData.loanAdvance.advanceDeduction.toFixed(2)}</span>
                            </div>
                          )}
                          {payslipData.loanAdvance?.totalEMI > 0 && (
                            <div className="flex justify-between px-4 py-2">
                              <span className="text-slate-700 dark:text-slate-300">Loan EMI:</span>
                              <span className="font-semibold text-red-600 dark:text-red-400">{payslipData.loanAdvance.totalEMI.toFixed(2)}</span>
                            </div>
                          )}
                          {/* BANK PAY and CASH PAY - these would be calculated from net salary */}
                          <div className="flex justify-between border-t-2 border-slate-300 bg-slate-100 px-4 py-2 font-bold dark:border-slate-600 dark:bg-slate-800">
                            <span className="text-slate-900 dark:text-white">Total Deductions:</span>
                            <span className="text-red-600 dark:text-red-400">
                              {((payslipData.deductions?.totalDeductions || 0) + (payslipData.loanAdvance?.totalEMI || 0) + (payslipData.loanAdvance?.advanceDeduction || 0)).toFixed(2)}
                            </span>
                          </div>
                        </div>

                      </div>

                    </div>

                    {/* Net Salary and Payment Details */}
                    <div className="space-y-3">
                      {/* Net Salary */}
                      <div className="border-2 border-green-500 bg-green-50 p-3 dark:border-green-600 dark:bg-green-900/20">
                        <div className="flex justify-between items-center">
                          <span className="text-lg font-bold text-green-900 dark:text-green-200">Net Salary:</span>
                          <span className="text-2xl font-bold text-green-900 dark:text-green-200">{payslipData.netSalary?.toFixed(2) || '0.00'}</span>
                        </div>
                      </div>

                      {/* Rupees In Words */}
                      <div className="border border-slate-300 bg-slate-50 px-4 py-2 dark:border-slate-600 dark:bg-slate-800">
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Rupees In Words:</span>
                        {/* removed numberToWords display */}
                      </div>

                    </div>

                    {/* Print Button */}
                    <div className="flex justify-end gap-3 print:hidden">
                      <button
                        onClick={() => window.print()}
                        className="rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-6 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:from-blue-600 hover:to-indigo-700"
                      >
                        Print Payslip
                      </button>
                    </div>

                  </div>
                ) : (
                  <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
                    {error || 'Payslip not found. Please calculate payroll first.'}
                  </div>
                )}
              </div>
            </div>
          )
        }
      </div>
    </div >
  );

}
