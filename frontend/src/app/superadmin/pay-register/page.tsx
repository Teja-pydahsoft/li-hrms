'use client';

import { useState, useEffect } from 'react';
import { useRouter } from "next/navigation";
import Link from 'next/link';
import { api, apiRequest, Employee, Division } from '@/lib/api';
import ArrearsPayrollSection from '@/components/Arrears/ArrearsPayrollSection';
import * as XLSX from 'xlsx';
import Swal from 'sweetalert2';




interface DailyRecord {
  date: string;
  firstHalf: {
    status: 'present' | 'absent' | 'leave' | 'od' | 'holiday' | 'week_off';
    leaveType: string | null;
    leaveNature: 'paid' | 'lop' | 'without_pay' | null;
    isOD: boolean;
    otHours: number;
    shiftId: string | null;
    remarks: string | null;
  };
  secondHalf: {
    status: 'present' | 'absent' | 'leave' | 'od' | 'holiday' | 'week_off';
    leaveType: string | null;
    leaveNature: 'paid' | 'lop' | 'without_pay' | null;
    isOD: boolean;
    otHours: number;
    shiftId: string | null;
    remarks: string | null;
  };
  status: 'present' | 'absent' | 'leave' | 'od' | 'holiday' | 'week_off' | 'partial' | null;
  leaveType: string | null;
  leaveNature: 'paid' | 'lop' | 'without_pay' | null;
  isOD: boolean;
  isSplit: boolean;
  shiftId: string | null;
  shiftName: string | null;
  otHours: number;
  remarks: string | null;
  isManuallyEdited?: boolean;
  isLate?: boolean;
  isEarlyOut?: boolean;
}

interface PayRegisterSummary {
  _id: string;
  employeeId: Employee | string;
  emp_no: string;
  month: string;
  monthName: string;
  year: number;
  monthNumber: number;
  totalDaysInMonth: number;
  dailyRecords: DailyRecord[];
  totals: {
    presentDays: number;
    presentHalfDays: number;
    totalPresentDays: number;
    absentDays: number;
    absentHalfDays: number;
    totalAbsentDays: number;
    paidLeaveDays: number;
    paidLeaveHalfDays: number;
    totalPaidLeaveDays: number;
    unpaidLeaveDays: number;
    unpaidLeaveHalfDays: number;
    totalUnpaidLeaveDays: number;
    lopDays: number;
    lopHalfDays: number;
    totalLopDays: number;
    totalLeaveDays: number;
    odDays: number;
    odHalfDays: number;
    totalODDays: number;
    totalOTHours: number;
    totalPayableShifts: number;
    totalWeeklyOffs?: number;
    totalHolidays?: number;
    lateCount?: number;
    earlyOutCount?: number;
  };
  status: 'draft' | 'in_review' | 'finalized';
  lastAutoSyncedAt: string | null;
  lastEditedAt: string | null;
  payrollId?: string;
  startDate?: string;
  endDate?: string;
}

interface Shift {
  _id: string;
  name: string;
  payableShifts: number;
}

type TableType = 'all' | 'present' | 'absent' | 'leaves' | 'od' | 'ot' | 'extraHours' | 'shifts';

export default function PayRegisterPage() {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [payRegisters, setPayRegisters] = useState<PayRegisterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState(false);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [activeTable, setActiveTable] = useState<TableType>('all');
  const [departments, setDepartments] = useState<any[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [selectedDivision, setSelectedDivision] = useState<string>('');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('');
  const [leaveTypes, setLeaveTypes] = useState<any[]>([]);
  const [calculatingId, setCalculatingId] = useState<string | null>(null);
  const [bulkCalculating, setBulkCalculating] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [calculatingJobId, setCalculatingJobId] = useState<string | null>(null);
  const [calculationProgress, setCalculationProgress] = useState<any>(null);
  const [payrollStrategy, setPayrollStrategy] = useState<'new' | 'legacy' | 'dynamic'>('new');



  // Permission Request State
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [pendingBatchId, setPendingBatchId] = useState<string | null>(null);
  const [permissionReason, setPermissionReason] = useState('');

  // Bulk Summary Upload State
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadingSummary, setUploadingSummary] = useState(false);
  const [uploadResults, setUploadResults] = useState<{ success: number; failed: number; total: number; errors: string[] } | null>(null);

  // Department Batch Status State (Map of DeptID -> Batch Info)
  const [departmentBatchStatus, setDepartmentBatchStatus] = useState<Map<string, { status: string, permissionGranted: boolean, batchId: string }>>(new Map());
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedArrears, setSelectedArrears] = useState<Array<{ id: string, amount: number, employeeId?: string }>>([]);
  const [payrollStartDate, setPayrollStartDate] = useState<string | null>(null);
  const [payrollEndDate, setPayrollEndDate] = useState<string | null>(null);
  const [cycleStartDay, setCycleStartDay] = useState<number | null>(null);
  const [alignedToCycle, setAlignedToCycle] = useState(false);

  useEffect(() => {
    let pollInterval: any;

    if (calculatingJobId) {
      pollInterval = setInterval(async () => {
        try {
          const status = await api.getJobStatus(calculatingJobId);
          if (status.success) {
            // Correctly map the progress object
            if (status.data.progress) {
              setCalculationProgress(status.data.progress);
            }

            // BullMQ state is returned as 'state', not 'status'
            if (status.data.state === 'completed') {
              clearInterval(pollInterval);
              setCalculatingJobId(null);
              setBulkCalculating(false);
              setCalculationProgress(null);
              Swal.fire({
                icon: 'success',
                title: 'Calculation Complete',
                text: 'Payroll calculation finished successfully.',
                timer: 3000,
                showConfirmButton: false,
                toast: true,
                position: 'top-end'
              });
              loadPayRegisters();
            } else if (status.data.state === 'failed') {
              clearInterval(pollInterval);
              setCalculatingJobId(null);
              setBulkCalculating(false);
              setCalculationProgress(null);
              Swal.fire({
                icon: 'error',
                title: 'Calculation Failed',
                text: status.data.failedReason || 'The background job failed.',
              });
            }
          }
        } catch (err) {
          console.error('Error polling job status:', err);
        }
      }, 1500);
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [calculatingJobId]);

  // Load payroll cycle start day, then align initial selectedMonth/Year
  useEffect(() => {
    api.getSetting('payroll_cycle_start_day')
      .then((res) => {
        if (res.success && res.data) {
          setCycleStartDay(Number(res.data.value) || 1);
        } else {
          setCycleStartDay(1);
        }
      })
      .catch(() => setCycleStartDay(1));
  }, []);

  useEffect(() => {
    if (alignedToCycle || cycleStartDay == null) return;
    const today = new Date();
    let effYear = today.getFullYear();
    let effMonth = today.getMonth() + 1;
    if (cycleStartDay > 1 && today.getDate() >= cycleStartDay) {
      // After cycle start: treat current payroll month as the one whose END is next calendar month
      if (effMonth === 12) {
        effMonth = 1;
        effYear += 1;
      } else {
        effMonth += 1;
      }
    }
    setSelectedYear(effYear);
    setSelectedMonth(effMonth);
    setAlignedToCycle(true);
  }, [cycleStartDay, alignedToCycle]);

  const normalizeHalfDay = (
    half?: Partial<DailyRecord['firstHalf']>,
    statusFallback: DailyRecord['status'] = 'absent'
  ): DailyRecord['firstHalf'] => {
    const allowedStatuses: DailyRecord['firstHalf']['status'][] = [
      'present',
      'absent',
      'leave',
      'od',
      'holiday',
      'week_off',
    ];
    const fallbackStatus = allowedStatuses.includes(statusFallback as any)
      ? (statusFallback as DailyRecord['firstHalf']['status'])
      : 'absent';
    const resolvedStatus = allowedStatuses.includes(half?.status as any)
      ? (half?.status as DailyRecord['firstHalf']['status'])
      : fallbackStatus;

    return {
      status: resolvedStatus || fallbackStatus,
      leaveType: half?.leaveType ?? null,
      leaveNature: half?.leaveNature ?? null,
      isOD: half?.isOD ?? false,
      otHours: half?.otHours ?? 0,
      shiftId: half?.shiftId ?? null,
      remarks: half?.remarks ?? null,
    };
  };

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState<{ employeeId: string; month: string; date: string; record: DailyRecord; employee: Employee } | null>(null);
  const [editData, setEditData] = useState<Partial<DailyRecord>>({});
  const [isHalfDayMode, setIsHalfDayMode] = useState(false);

  // Pagination State
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [paginationTotal, setPaginationTotal] = useState(0);
  const [paginationTotalPages, setPaginationTotalPages] = useState(1);
  const PAGE_SIZE = 50;
  const [loadingMore, setLoadingMore] = useState(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const daysInMonth = new Date(year, month, 0).getDate();

  // Use the configured range from the backend if available, otherwise compute calendar month
  const displayDays = payrollStartDate && payrollEndDate
    ? (() => {
      const start = new Date(payrollStartDate);
      const end = new Date(payrollEndDate);
      const dates = [];
      let curr = new Date(start);
      // Safety break to prevent infinite loop
      let count = 0;
      while (curr <= end && count < 40) {
        dates.push(curr.toISOString().split('T')[0]);
        curr.setDate(curr.getDate() + 1);
        count++;
      }
      return dates;
    })()
    : Array.from({ length: daysInMonth }, (_, i) => {
      const d = new Date(year, month - 1, i + 1);
      // Using UTC to avoid local timezone shifts during string conversion
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
    });

  const daysArray = displayDays; // For compatibility with existing loop names

  const isPastMonth = new Date(year, month - 1, 1).getTime() < new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();

  useEffect(() => {
    loadShifts();
    loadDivisions();
    loadDepartments();
    loadLeaveTypes();
  }, []);

  const loadDivisions = async () => {
    try {
      const response = await api.getDivisions(); // Assuming getDivisions exists and returns all
      if (response.success) {
        setDivisions(response.data || []);
      }
    } catch (err) {
      console.error('Error loading divisions:', err);
    }
  };

  const loadLeaveTypes = async () => {
    try {
      const response = await api.getLeaveSettings('leave');
      if (response.success && response.data && response.data.types) {
        setLeaveTypes(response.data.types);
      }
    } catch (err) {
      console.error('Error loading leave types:', err);
    }
  };

  useEffect(() => {
    setPage(1);
    setHasMore(true);
    loadPayRegisters(1, false);
    checkBatchLocks();
  }, [year, month, selectedDepartment, selectedDivision]);

  const checkBatchLocks = async () => {
    try {
      const divId = selectedDivision && selectedDivision.trim() !== '' ? selectedDivision : undefined;
      const response = await api.getPayrollBatches({ month: monthStr, divisionId: divId });
      if (response && response.data) {
        const statusMap = new Map<string, { status: string, permissionGranted: boolean, batchId: string }>();
        // response.data is array of batches
        const batches = Array.isArray(response.data) ? response.data : [];
        batches.forEach((batch: any) => {
          const deptId = typeof batch.department === 'object' ? batch.department._id : batch.department;
          statusMap.set(deptId, {
            status: batch.status,
            permissionGranted: !!batch.recalculationPermission?.granted,
            batchId: batch._id
          });
        });
        setDepartmentBatchStatus(statusMap);
      }
    } catch (err) {
      console.error('Error checking batch locks:', err);
    }
  };

  const loadDepartments = async () => {
    try {
      const response = await api.getDepartments(true);
      if (response.success) {
        setDepartments(response.data || []);
      }
    } catch (err) {
      console.error('Error loading departments:', err);
    }
  };

  const loadShifts = async () => {
    try {
      const response = await api.getShifts();
      if (response.success && response.data) {
        setShifts(response.data.map((s: any) => ({ ...s, payableShifts: s.payableShifts || 0 })));
      }
    } catch (err) {
      console.error('Error loading shifts:', err);
    }
  };

  const loadPayRegisters = async (pageToLoad = 1, append = false) => {
    try {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      console.log('[Pay Register] Loading pay registers:', { monthStr, selectedDepartment, page: pageToLoad });

      // Ensure we pass undefined instead of empty string
      const targetDeptId = selectedDepartment && selectedDepartment.trim() !== '' ? selectedDepartment : undefined;
      const targetDivId = selectedDivision && selectedDivision.trim() !== '' ? selectedDivision : undefined;

      const limit = PAGE_SIZE;
      const response = await api.getEmployeesWithPayRegister(monthStr, targetDeptId, targetDivId, undefined, pageToLoad, limit);

      if (response.success) {
        const payRegisterList = response.data || [];
        console.log('[Pay Register] Loaded page', pageToLoad, 'count:', payRegisterList.length);

        if ((response as any).startDate) setPayrollStartDate((response as any).startDate);
        if ((response as any).endDate) setPayrollEndDate((response as any).endDate);

        if (append) {
          setPayRegisters(prev => [...prev, ...payRegisterList]);
        } else {
          setPayRegisters(payRegisterList);
        }

        if (response.pagination) {
          setPaginationTotal((response.pagination as any).total ?? 0);
          setPaginationTotalPages((response.pagination as any).totalPages ?? 1);
          setHasMore(pageToLoad < (response.pagination as any).totalPages);
        } else {
          setHasMore(payRegisterList.length === limit);
        }

        if (payRegisterList.length === 0 && !append) {
          Swal.fire({
            icon: 'info',
            title: 'No Employees',
            text: 'No employees found for this selection',
            timer: 2000,
            showConfirmButton: false,
            toast: true,
            position: 'top-end'
          });
        }
      } else {
        console.error('[Pay Register] API call failed:', response);
        if (!append) {
          setPayRegisters([]);
          setPaginationTotal(0);
          setPaginationTotalPages(1);
        }
        if (response.message) {
          Swal.fire({
            icon: 'error',
            title: 'API Error',
            text: response.message,
          });
        }
      }
    } catch (err: any) {
      console.error('[Pay Register] Error loading pay registers:', err);
      if (!append) {
        setPayRegisters([]);
        setPaginationTotal(0);
        setPaginationTotalPages(1);
      }
      Swal.fire({
        icon: 'error',
        title: 'Load Failed',
        text: err.message || 'Failed to load pay registers',
      });
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    loadPayRegisters(nextPage, true);
  };

  const handleSyncAll = async () => {
    try {
      setSyncing(true);

      // 1. First trigger a global attendance sync for this payroll cycle's date range
      // This ensures MongoDB records are updated from MSSQL/Biometric for the spanned dates
      if (payrollStartDate && payrollEndDate) {
        Swal.fire({
          icon: 'info',
          title: 'Syncing',
          text: 'Syncing logs from biometric source...',
          timer: 2000,
          showConfirmButton: false,
          toast: true,
          position: 'top-end'
        });
        await apiRequest('/attendance/sync', {
          method: 'POST',
          body: JSON.stringify({
            fromDate: payrollStartDate,
            toDate: payrollEndDate
          })
        });
      }

      // 2. Now sync individual pay registers from the updated MongoDB records
      const syncPromises = payRegisters.map((pr) => {
        const employeeId = typeof pr.employeeId === 'object' ? pr.employeeId._id : pr.employeeId;
        return api.syncPayRegister(employeeId, monthStr);
      });

      await Promise.all(syncPromises);
      await loadPayRegisters();
      Swal.fire({
        icon: 'success',
        title: 'Synced',
        text: 'All data synced successfully',
        timer: 2000,
        showConfirmButton: false,
        toast: true,
        position: 'top-end'
      });
    } catch (err: any) {
      console.error('Error syncing pay registers:', err);
      Swal.fire({
        icon: 'error',
        title: 'Sync Failed',
        text: err.message || 'Failed to sync pay registers',
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveDate = async () => {
    if (!editingRecord) return;

    try {
      setSaving({ ...saving, [editingRecord.employeeId]: true });

      // First, ensure pay register exists - create if it doesn't
      try {
        await api.getPayRegister(editingRecord.employeeId, monthStr);
      } catch (err: any) {
        // If pay register doesn't exist, create it
        console.log('[Pay Register] Creating pay register for employee:', editingRecord.employeeId);
        await api.createPayRegister(editingRecord.employeeId, monthStr);
      }

      // Prepare update data with isSplit flag
      const updatePayload = {
        ...editData,
        isSplit: isHalfDayMode,
      };

      // Now update the daily record
      const response = await api.updateDailyRecord(
        editingRecord.employeeId,
        monthStr,
        editingRecord.date,
        updatePayload
      );
      if (response.success && response.data) {
        await loadPayRegisters();
        setShowEditModal(false);
        setEditingRecord(null);
        setIsHalfDayMode(false);
        Swal.fire({
          icon: 'success',
          title: 'Updated',
          text: 'Date updated successfully',
          timer: 2000,
          showConfirmButton: false,
          toast: true,
          position: 'top-end'
        });
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Update Failed',
          text: response.message || 'Failed to update date',
        });
      }
    } catch (err: any) {
      console.error('Error updating date:', err);
      Swal.fire({
        icon: 'error',
        title: 'Update Failed',
        text: err.message || 'Failed to update date',
      });
    } finally {
      setSaving({ ...saving, [editingRecord.employeeId]: false });
    }
  };

  const handleDateClick = (employee: Employee, date: string, record: DailyRecord) => {
    const isSplit = record.isSplit || record.firstHalf.status !== record.secondHalf.status;
    setEditingRecord({ employeeId: typeof employee === 'object' ? employee._id : employee, month: monthStr, date, record, employee });
    setIsHalfDayMode(isSplit);
    setEditData({
      firstHalf: {
        ...record.firstHalf,
        leaveType: record.firstHalf.leaveType || null,
        leaveNature: record.firstHalf.leaveNature || null,
      },
      secondHalf: {
        ...record.secondHalf,
        leaveType: record.secondHalf.leaveType || null,
        leaveNature: record.secondHalf.leaveNature || null,
      },
      status: record.status,
      leaveType: record.leaveType || null,
      leaveNature: record.leaveNature || null,
      isOD: record.isOD,
      isSplit: isSplit,
      shiftId: record.shiftId || null,
      shiftName: record.shiftName || null,
      otHours: record.otHours,
      remarks: record.remarks || null,
    });
    setShowEditModal(true);
  };

  const getLeaveTotal = (totals: any) =>
    totals?.totalLeaveDays ??
    ((totals?.totalPaidLeaveDays || 0) +
      (totals?.totalUnpaidLeaveDays || 0) +
      (totals?.totalLopDays || 0));

  const getSummaryRows = () =>
    payRegisters.map((pr) => {
      const totals = pr.totals || {};
      const present = totals.totalPresentDays || 0;
      const absent = totals.totalAbsentDays || 0;
      const leave = getLeaveTotal(totals);
      const od = totals.totalODDays || 0;
      const ot = totals.totalOTHours || 0;
      const extra = (totals.totalPayableShifts || 0) - (totals.totalPresentDays || 0);
      const weeklyOffs = totals.totalWeeklyOffs || 0;
      const holidays = totals.totalHolidays || 0;
      const lop = totals.totalLopDays || 0;
      const paidLeave = totals.totalPaidLeaveDays || 0;
      const lateCount = totals.lateCount || 0;
      const holidayAndWeekoffs = (totals.totalWeeklyOffs || 0) + (totals.totalHolidays || 0);

      const monthDays = pr.totalDaysInMonth || daysArray.length || daysInMonth;

      // User Definition:
      // Counted Days = Present + Absent + Holidays + Weekoffs + Total Leaves
      const countedDays = present + absent + holidays + weeklyOffs + leave;
      const matchesMonth = Math.abs(countedDays - monthDays) < 0.001;
      const payableShifts = totals.totalPayableShifts ?? 0;
      return {
        pr,
        present,
        absent,
        leave,
        od,
        ot,
        extra,
        weeklyOffs,
        holidays,
        payableShifts,
        lop,
        paidLeave,
        lateCount,
        holidayAndWeekoffs,
        monthDays,
        countedDays,
        matchesMonth,
      };
    });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'present':
        return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
      case 'absent':
        return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
      case 'leave':
        return 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';
      case 'od':
        return 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
      case 'holiday':
        return 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800';
      case 'week_off':
        return 'bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-800';
      default:
        return 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700';
    }
  };

  /** Primary status for a daily record (full day or first half when split) for coloring in "All" view */
  const getPrimaryStatus = (record: DailyRecord): string => {
    if (record.status && ['present', 'absent', 'leave', 'od', 'holiday', 'week_off'].includes(record.status))
      return record.status;
    const s1 = record.firstHalf?.status;
    const s2 = record.secondHalf?.status;
    if (s1 && ['present', 'absent', 'leave', 'od', 'holiday', 'week_off'].includes(s1)) return s1;
    if (s2 && ['present', 'absent', 'leave', 'od', 'holiday', 'week_off'].includes(s2)) return s2;
    return 'absent';
  };

  const getStatusDisplay = (record: DailyRecord | null): string => {
    if (!record) return '-';
    if (record.isSplit) {
      // Show both halves
      const first = record.firstHalf.status.charAt(0).toUpperCase();
      const second = record.secondHalf.status.charAt(0).toUpperCase();
      return `${first}/${second}`;
    }
    if (record.status === 'leave') return 'L';
    if (record.status === 'od') return 'OD';
    if (record.status === 'present') return 'P';
    if (record.status === 'absent') return 'A';
    if (record.status === 'holiday') return 'H';
    if (record.status === 'week_off') return 'WO';
    return '-';
  };

  const getCellBackgroundColor = (record: DailyRecord | null, tableType: TableType): string => {
    if (!record) return '';

    if (record.isManuallyEdited) {
      return 'bg-amber-100 dark:bg-amber-900/30 ring-inset ring-1 ring-amber-300 dark:ring-amber-700';
    }

    if (tableType === 'all') {
      return getStatusColor(getPrimaryStatus(record));
    }

    if (tableType === 'present') {
      if (record.status === 'present' || record.firstHalf.status === 'present' || record.secondHalf.status === 'present') {
        return 'bg-green-100 dark:bg-green-900/30';
      }
    }
    if (tableType === 'absent') {
      if (record.status === 'absent' || record.firstHalf.status === 'absent' || record.secondHalf.status === 'absent') {
        return 'bg-red-100 dark:bg-red-900/30';
      }
    }
    if (tableType === 'leaves') {
      if (record.status === 'leave' || record.firstHalf.status === 'leave' || record.secondHalf.status === 'leave') {
        return 'bg-yellow-100 dark:bg-yellow-900/30';
      }
    }
    if (tableType === 'od') {
      if (record.status === 'od' || record.isOD || record.firstHalf.status === 'od' || record.secondHalf.status === 'od' || record.firstHalf.isOD || record.secondHalf.isOD) {
        return 'bg-blue-100 dark:bg-blue-900/30';
      }
    }
    if (tableType === 'ot' || tableType === 'extraHours') {
      if (record.otHours > 0 || record.firstHalf.otHours > 0 || record.secondHalf.otHours > 0) {
        return 'bg-orange-100 dark:bg-orange-900/30';
      }
    }
    if (tableType === 'shifts') {
      if (record.shiftId !== null || record.shiftName !== null || record.firstHalf.shiftId !== null || record.secondHalf.shiftId !== null) {
        return 'bg-indigo-100 dark:bg-indigo-900/30';
      }
    }
    return '';
  };

  const shouldShowInTable = (record: DailyRecord | null, tableType: TableType): boolean => {
    if (!record) return false;

    switch (tableType) {
      case 'all':
        return true;
      case 'present':
        return record.status === 'present' || record.firstHalf.status === 'present' || record.secondHalf.status === 'present';
      case 'absent':
        return record.status === 'absent' || record.firstHalf.status === 'absent' || record.secondHalf.status === 'absent';
      case 'leaves':
        return record.status === 'leave' || record.firstHalf.status === 'leave' || record.secondHalf.status === 'leave';
      case 'od':
        return record.status === 'od' || record.isOD || record.firstHalf.status === 'od' || record.secondHalf.status === 'od' || record.firstHalf.isOD || record.secondHalf.isOD;
      case 'ot':
      case 'extraHours':
        return record.otHours > 0 || record.firstHalf.otHours > 0 || record.secondHalf.otHours > 0;
      case 'shifts':
        return record.shiftId !== null || record.shiftName !== null || record.firstHalf.shiftId !== null || record.secondHalf.shiftId !== null;
      default:
        return false;
    }
  };

  // Show ALL employees in ALL tables - no filtering
  const getFilteredPayRegisters = (): PayRegisterSummary[] => {
    // Return all pay registers - don't filter by table type
    return payRegisters;
  };

  const handleViewPayslip = (employee: Employee) => {
    // Navigate to payslip or open payslip modal
    router.push(`/superadmin/payroll-transactions?employeeId=${employee._id}&month=${monthStr}`);
  };

  const handleCalculatePayroll = async (employee: Employee) => {
    try {
      const employeeId = typeof employee === 'object' ? employee._id : employee;
      const params = payrollStrategy === 'legacy' ? '?strategy=legacy' : payrollStrategy === 'dynamic' ? '?strategy=dynamic' : '?strategy=new';
      setCalculatingId(employeeId);
      Swal.fire({
        icon: 'info',
        title: 'Calculating',
        text: 'Calculating payroll...',
        timer: 1200,
        showConfirmButton: false,
        toast: true,
        position: 'top-end'
      });

      // Filter arrears for this specific employee
      // Note: ArrearsPayrollSection component stores arrears with employee info
      // We need to filter selectedArrears to only include those for this employee
      const employeeArrears = selectedArrears.filter((arrear) => {
        // Filter arrears strictly for this employee
        return arrear.employeeId === employeeId;
      });

      const response = await api.calculatePayroll(employeeId, monthStr, params, employeeArrears);

      if (response && response.data && response.data.batchId) {
        Swal.fire({
          icon: 'success',
          title: 'Calculated',
          text: 'Payroll calculated! Redirecting to batch...',
          timer: 2000,
          showConfirmButton: false,
          toast: true,
          position: 'top-end'
        });
        // Small delay to let the toast be seen
        setTimeout(() => {
          router.push(`/superadmin/payments/${response.data.batchId}`);
        }, 1000);
      } else {
        Swal.fire({
          icon: 'success',
          title: 'Success',
          text: 'Payroll calculated',
          timer: 2000,
          showConfirmButton: false,
          toast: true,
          position: 'top-end'
        });
      }
    } catch (err: any) {
      console.error('Error calculating payroll:', err);

      // Check for BATCH_LOCKED error
      // API might return error message in err.message. Check if it contains specific text or if err object has code
      // Note: frontend api wrapper might throw Error(message), so we might check message content
      if (err.message && (err.message.includes('BATCH_LOCKED') || err.message.includes('Recalculation requires permission'))) {
        // Try to extract batchId if possible. Since standard Error doesn't have custom props, 
        // we might need to rely on the backend response.
        // Ideally, we'd need to fetch the batch ID for this department/month or Parse it from somewhere.
        // For now, let's try to parse it from the response if available or fetch it.
        // Use the error info if attached to the error object (requires custom error handling in api.ts)

        // A more robust way: If api sets properties on the error object
        if (err.batchId) {
          setPendingBatchId(err.batchId);
          setShowPermissionModal(true);
          return;
        } else {
          // Fallback: If we can't find batchId, we show a generic error or try to find it.
          // But since we just failed to calc, the backend knows the ID.
          // Let's assume for now api.ts might be updated or we rely on message/manual lookup.
          // IF we can't get ID, we can't request permission easily.
          // Let's check api.ts later. For now, show the message.
        }
      }

      Swal.fire({
        icon: 'error',
        title: 'Calculation Error',
        text: err.message || 'Failed to calculate payroll',
      });
    } finally {
      setCalculatingId(null);
    }
  };

  const handleRequestRecalculation = async () => {
    if (!pendingBatchId) return;
    try {
      const response = await api.requestRecalculation(pendingBatchId, permissionReason);
      if (response.success) {
        Swal.fire({
          icon: 'success',
          title: 'Permission Requested',
          text: 'Permission requested successfully',
          timer: 2000,
          showConfirmButton: false,
          toast: true,
          position: 'top-end'
        });
        setShowPermissionModal(false);
        setPendingBatchId(null);
        setPermissionReason('');
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Request Failed',
          text: response.message || 'Failed to request permission',
        });
      }
    } catch (error: any) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: error.message || 'Error asking for permission',
      });
    }
  };

  const downloadPayrollExcel = async (employeeIds?: string[]) => {
    try {
      setExportingExcel(true);
      const targetDeptId = selectedDepartment && selectedDepartment.trim() !== '' ? selectedDepartment : undefined;
      const targetDivId = selectedDivision && selectedDivision.trim() !== '' ? selectedDivision : undefined;

      const blob = await api.exportPayrollExcel({
        month: monthStr,
        departmentId: targetDeptId,
        divisionId: targetDivId,
        strategy: payrollStrategy,
        employeeIds,
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payslips_${monthStr}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      Swal.fire({
        icon: 'success',
        title: 'Ready',
        text: 'Payroll Excel ready',
        timer: 2000,
        showConfirmButton: false,
        toast: true,
        position: 'top-end'
      });
    } catch (err: any) {
      // Debug: Log the error details
      console.log('[Export Error]', err?.message || err);
      // Show user-friendly error message via toast
      const errorMessage = err?.message || 'Failed to export payroll Excel';
      console.log('[Showing Toast]', errorMessage);
      Swal.fire({
        icon: 'error',
        title: 'Export Failed',
        text: errorMessage,
      });
    } finally {
      setExportingExcel(false);
    }
  };

  const handleCalculatePayrollForAll = async () => {
    if (!payRegisters || payRegisters.length === 0) {
      Swal.fire({
        icon: 'info',
        title: 'No Employees',
        text: 'No employees to calculate payroll for.',
        timer: 2000,
        showConfirmButton: false,
        toast: true,
        position: 'top-end'
      });
      return;
    }
    const params = payrollStrategy === 'new' ? '?strategy=new' : '?strategy=legacy';
    let successCount = 0;
    let failCount = 0;
    const batchIds = new Set<string>(); // Store unique batch IDs

    setBulkCalculating(true);
    Swal.fire({
      icon: 'info',
      title: 'Calculating',
      text: 'Calculating payroll for listed employees...',
      timer: 2000,
      showConfirmButton: false,
      toast: true,
      position: 'top-end'
    });
    try {
      const requestData = {
        month: monthStr,
        divisionId: selectedDivision === 'all' ? undefined : selectedDivision,
        departmentId: selectedDepartment === 'all' ? undefined : selectedDepartment,
        strategy: payrollStrategy
      };

      console.log('[Bulk Calculate] Request:', requestData);

      const response = await api.calculatePayrollBulk(requestData);

      console.log('[Bulk Calculate] Response:', response);

      if (response.success) {
        if (response.status === 'queued' || response.jobId) {
          setCalculatingJobId(response.jobId || null);
          Swal.fire({
            icon: 'info',
            title: 'Calculation Queued',
            text: 'Bulk payroll calculation has been queued. You can track progress below.',
            timer: 2000,
            showConfirmButton: false,
            toast: true,
            position: 'top-end'
          });
          return;
        }

        successCount = response.data.successCount;
        failCount = response.data.failCount;
        if (response.data.batchIds) {
          response.data.batchIds.forEach((id: string) => batchIds.add(id));
        }

        if (failCount === 0) {
          Swal.fire({
            icon: 'success',
            title: 'Success',
            text: 'Payroll calculated successfully for all employees',
          });
        } else {
          Swal.fire({
            icon: 'warning',
            title: 'Partial Success',
            text: `Calculation completed with ${failCount} failures`,
          });
        }
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Bulk Calculation Failed',
          text: response.message || 'Bulk calculation failed',
        });
      }

      // Redirect logic based on batches created
      if (batchIds.size === 1) {
        // Single batch -> Redirect to that batch
        const batchId = Array.from(batchIds)[0];
        Swal.fire({
          icon: 'info',
          title: 'Redirecting',
          text: 'Redirecting to Batch Details...',
          timer: 1500,
          showConfirmButton: false,
          toast: true,
          position: 'top-end'
        });
        setTimeout(() => {
          router.push(`/superadmin/payments/${batchId}`);
        }, 1500);
      } else if (batchIds.size > 1) {
        // Multiple batches -> Redirect to list
        Swal.fire({
          icon: 'info',
          title: 'Redirecting',
          text: 'Redirecting to Payments List...',
          timer: 1500,
          showConfirmButton: false,
          toast: true,
          position: 'top-end'
        });
        setTimeout(() => {
          router.push('/superadmin/payments');
        }, 1500);
      }
      else if (successCount > 0) {
        // No batches but legacy/success -> Download Excel
        const listedEmployeeIds = payRegisters.map((pr) =>
          typeof pr.employeeId === 'object' ? pr.employeeId._id : pr.employeeId
        );
        await downloadPayrollExcel(listedEmployeeIds);
      } else {
        Swal.fire({
          icon: 'warning',
          title: 'No Export',
          text: 'Calculation failed for all employees. Nothing to export.',
          timer: 2000,
          showConfirmButton: false,
          toast: true,
          position: 'top-end'
        });
      }

    } catch (error: any) {
      console.log('[Bulk Calculate] Error:', error);
      Swal.fire({
        icon: 'error',
        title: 'Calculation Failed',
        text: error?.message || 'Failed to calculate payroll',
      });
    } finally {
      setBulkCalculating(false);
    }
  };

  const handleArrearsSelected = (arrears: Array<{ id: string, amount: number, employeeId?: string }>) => {
    setSelectedArrears(arrears);
  };

  const processPayroll = async () => {
    try {
      if (!selectedEmployee) {
        Swal.fire({
          icon: 'error',
          title: 'No Employee Selected',
          text: 'Please select an employee',
        });
        return;
      }

      // Prepare payroll data
      const payrollData = {
        employeeId: selectedEmployee._id,
        month: selectedMonth,
        year: selectedYear,
        arrears: selectedArrears,
        // Add other payroll data as needed
      };

      // Submit payroll data
      // Use apiRequest for generic post
      const response = await apiRequest<any>('/payroll/process', {
        method: 'POST',
        body: JSON.stringify(payrollData)
      });

      // Process arrears settlement after successful payroll
      if (response.success) {
        if (selectedArrears.length > 0) {
          await settleArrears(response.data.payrollId);
        }
        Swal.fire({
          icon: 'success',
          title: 'Success',
          text: 'Payroll processed successfully',
          timer: 2000,
          showConfirmButton: false,
          toast: true,
          position: 'top-end'
        });
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Processing Failed',
          text: response.message || 'Failed to process payroll',
        });
      }
    } catch (error: any) {
      console.error('Error processing payroll:', error);
      Swal.fire({
        icon: 'error',
        title: 'Processing Failed',
        text: 'Failed to process payroll',
      });
    }
  };

  const settleArrears = async (payrollId: string) => {
    try {
      // Process each selected arrear
      for (const arrear of selectedArrears) {
        await api.updateArrearsSettlement(arrear.id, {
          amount: arrear.amount,
          payrollId,
          month: selectedMonth,
          year: selectedYear,
        });
      }
      Swal.fire({
        icon: 'success',
        title: 'Arrears Settled',
        text: 'Arrears settled successfully',
        timer: 2000,
        showConfirmButton: false,
        toast: true,
        position: 'top-end'
      });
    } catch (error) {
      console.error('Error settling arrears:', error);
      Swal.fire({
        icon: 'error',
        title: 'Settlement Failed',
        text: 'Failed to settle arrears',
      });
    }
  };

  return (
    <div className="relative min-h-screen">
      <div className="relative z-10 mx-auto max-w-[1920px] p-6">
        {/* Header - real content; only Period and Employee count use skeleton when loading */}
        <div className="mb-1 flex flex-wrap items-center justify-between gap-4 pb-2">
          <div className="flex flex-wrap items-center gap-4">
            {/* Title Section */}
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex flex-col">
                <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">Pay Register</h1>
                {loading ? (
                  <div className="h-3 w-40 animate-pulse rounded bg-slate-200 dark:bg-slate-700 mt-0.5" />
                ) : payrollStartDate && payrollEndDate ? (
                  <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                    Period: {new Date(payrollStartDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} - {new Date(payrollEndDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                ) : null}
              </div>

              <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 hidden md:block" />
            </div>

            {/* Filters Group */}
            <div className="flex flex-nowrap items-center gap-1.5 p-1 bg-slate-100/50 dark:bg-slate-800/40 rounded-xl border border-slate-200/60 dark:border-slate-700/60 backdrop-blur-sm">
              {/* Division Filter */}
              <select
                value={selectedDivision}
                onChange={(e) => {
                  setSelectedDivision(e.target.value);
                  setSelectedDepartment('');
                }}
                className="h-8 pl-2 pr-6 text-[11px] font-semibold bg-white dark:bg-slate-800 border-0 rounded-lg focus:ring-2 focus:ring-blue-500/20 text-slate-700 dark:text-slate-300 shadow-sm min-w-[100px] max-w-[140px]"
              >
                <option value="">All Divisions</option>
                {divisions.map((div) => (
                  <option key={div._id} value={div._id}>{div.name}</option>
                ))}
              </select>

              {/* Department Filter */}
              <select
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                className="h-8 pl-2 pr-6 text-[11px] font-semibold bg-white dark:bg-slate-800 border-0 rounded-lg focus:ring-2 focus:ring-blue-500/20 text-slate-700 dark:text-slate-300 shadow-sm min-w-[100px] max-w-[140px]"
              >
                <option value="">All Departments</option>
                {departments
                  .filter(dept => {
                    if (!selectedDivision) return true;
                    const currentDivision = divisions.find(d => d._id === selectedDivision);
                    return currentDivision?.departments?.some((d: any) => d === dept._id || d._id === dept._id);
                  })
                  .map((dept) => (
                    <option key={dept._id} value={dept._id}>{dept.name}</option>
                  ))}
              </select>

              {/* Payroll Engine selector (Previously Payroll Strategy) */}
              <select
                value={payrollStrategy}
                onChange={(e) => setPayrollStrategy(e.target.value as any)}
                className="h-8 pl-2 pr-6 text-[11px] font-semibold bg-blue-50 dark:bg-blue-900/20 border-0 rounded-lg focus:ring-2 focus:ring-blue-500/20 text-blue-700 dark:text-blue-400 shadow-sm"
              >
                <option value="new">Engine: New</option>
                <option value="legacy">Engine: Legacy</option>
                <option value="dynamic">Engine: Dynamic</option>
              </select>
            </div>

            {/* Month/Year Navigation */}
            <div className="flex items-center gap-0.5 p-0.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <button
                onClick={() => {
                  const newDate = new Date(currentDate);
                  newDate.setMonth(currentDate.getMonth() - 1);
                  setCurrentDate(newDate);
                }}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>

              <input
                type="month"
                value={monthStr}
                onChange={(e) => {
                  const [y, m] = e.target.value.split('-');
                  setCurrentDate(new Date(parseInt(y), parseInt(m) - 1));
                }}
                className="h-8 bg-transparent border-0 text-[11px] font-bold text-slate-900 dark:text-white focus:ring-0 p-0 cursor-pointer w-[100px]"
              />

              <button
                onClick={() => {
                  const newDate = new Date(currentDate);
                  newDate.setMonth(currentDate.getMonth() + 1);
                  setCurrentDate(newDate);
                }}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex flex-nowrap items-center gap-3 shrink-0">
            <button
              onClick={handleSyncAll}
              disabled={syncing}
              className="h-9 px-4 flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-sm disabled:opacity-50 transition-all"
            >
              <svg className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {syncing ? 'Syncing...' : 'Sync All'}
            </button>

            {(() => {
              const exportExcelButton = (
                <button
                  key="export-excel"
                  onClick={async () => {
                    await downloadPayrollExcel();
                  }}
                  disabled={exportingExcel || payRegisters.length === 0}
                  className="h-9 px-4 flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-xl shadow-sm disabled:opacity-50 transition-all"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  {exportingExcel ? 'Exporting...' : 'Export Excel'}
                </button>
              );

              if (selectedDepartment) {
                const batchInfo = departmentBatchStatus.get(selectedDepartment);
                const status = batchInfo?.status || 'pending';
                const permissionGranted = batchInfo?.permissionGranted || false;

                if (status === 'freeze' || status === 'complete') {
                  return exportExcelButton;
                }

                if (status === 'approved' && !permissionGranted) {
                  return (
                    <>
                      <button
                        onClick={() => {
                          if (batchInfo?.batchId) {
                            setPendingBatchId(batchInfo.batchId);
                            setShowPermissionModal(true);
                          } else {
                            Swal.fire({
                              icon: 'error',
                              title: 'Error',
                              text: "Batch ID not found",
                            });
                          }
                        }}
                        className="h-9 px-4 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-xl shadow-sm transition-all"
                      >
                        Permission Required
                      </button>
                      {exportExcelButton}
                    </>
                  );
                }

                return (
                  <>
                    <button
                      onClick={handleCalculatePayrollForAll}
                      disabled={bulkCalculating || exportingExcel}
                      className="h-9 px-4 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-xl shadow-sm disabled:opacity-50 transition-all"
                    >
                      {bulkCalculating ? 'Calculating...' : 'Recalculate Payroll'}
                    </button>
                    {exportExcelButton}
                  </>
                );
              }

              return (
                <>
                  <button
                    onClick={handleCalculatePayrollForAll}
                    disabled={bulkCalculating || exportingExcel}
                    className="h-9 px-4 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-xl shadow-sm disabled:opacity-50 transition-all"
                  >
                    {bulkCalculating ? 'Calculating...' : 'Calculate Payroll'}
                  </button>
                  {exportExcelButton}
                </>
              );
            })()}
          </div>

          {/* Employee count - own row below header; skeleton when loading */}
          {(loading || paginationTotal > 0 || payRegisters.length > 0) && (
            <div className="w-full mt-1 mb-0 px-1 basis-full">
              {loading ? (
                <div className="h-3 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
              ) : (
                <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  {paginationTotal > 0
                    ? (() => {
                      const from = (page - 1) * PAGE_SIZE + 1;
                      const to = Math.min(page * PAGE_SIZE, paginationTotal);
                      return paginationTotal <= PAGE_SIZE
                        ? `${paginationTotal} employee${paginationTotal !== 1 ? 's' : ''}`
                        : `Showing ${from}–${to} of ${paginationTotal} employees`;
                    })()
                    : `${payRegisters.length} employee${payRegisters.length !== 1 ? 's' : ''} listed`}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Progress Bar for Bulk Calculation */}
        {calculationProgress && (
          <div className="mb-6 animate-fade-in relative z-20">
            <div className="mt-6 space-y-3 p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-900/30 shadow-sm backdrop-blur-sm">
              <div className="flex justify-between items-center text-sm font-medium">
                <span className="text-indigo-700 dark:text-indigo-300 flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {calculationProgress.currentEmployee ? `Calculating for: ${calculationProgress.currentEmployee}` : 'Processing bulk payroll...'}
                </span>
                <span className="text-indigo-600 dark:text-indigo-400 font-bold">
                  {calculatingJobId && <span className="mr-3 opacity-50 font-mono text-[10px] font-normal">ID: {calculatingJobId}</span>}
                  {calculationProgress.processed} / {calculationProgress.total} ({calculationProgress.percentage}%)
                </span>
              </div>
              <div className="w-full bg-indigo-200/50 dark:bg-indigo-900/50 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-indigo-600 h-2.5 rounded-full transition-all duration-500 ease-out shadow-sm"
                  style={{ width: `${calculationProgress.percentage}%` }}
                ></div>
              </div>
            </div>
          </div>
        )}

        {/* Permission Request Modal */}
        {showPermissionModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30 mb-4">
                <svg className="h-6 w-6 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>

              <h3 className="text-lg font-bold text-center text-slate-900 dark:text-white mb-2">
                Batch Locked
              </h3>

              <p className="text-sm text-center text-slate-500 dark:text-slate-400 mb-6">
                The payroll batch for this month is finalized/approved. Recalculation is restricted.
                <br />
                Would you like to request permission to modify it?
              </p>

              <textarea
                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none mb-4 min-h-[80px]"
                placeholder="Reason for recalculation..."
                value={permissionReason}
                onChange={(e) => setPermissionReason(e.target.value)}
              ></textarea>

              <div className="flex gap-3">
                <button
                  type="button"
                  className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  onClick={() => {
                    setShowPermissionModal(false);
                    setPendingBatchId(null);
                    setPermissionReason('');
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium shadow-sm transition-colors"
                  onClick={handleRequestRecalculation}
                >
                  Request Permission
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Summary Table - skeleton when loading */}
      {loading && (
        <div className="mt-2 mb-6 rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm shadow-lg dark:border-slate-700 dark:bg-slate-900/80 overflow-x-auto">
          <div className="p-4 pt-3">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-3">Monthly Summary</h3>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                  <th className="sticky left-0 z-10 w-[180px] border-r border-slate-200 bg-slate-50 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    Employee
                  </th>
                  {[
                    'Total Present',
                    'Total Absent',
                    'Total Leaves',
                    'Paid Leaves',
                    'LOP Count',
                    'Total OD',
                    'Total OT Hours',
                    'Total Extra Days',
                    'Lates',
                    'Holidays & Weekoffs',
                    'Present Days',
                    'Payable Shifts',
                    'Month Days',
                    'Counted Days',
                  ].map((label) => (
                    <th
                      key={label}
                      className="border-r border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:text-slate-300 last:border-r-0"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                      <div className="h-4 w-32 rounded bg-slate-200 dark:bg-slate-700" />
                      <div className="mt-1 h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" />
                    </td>
                    {Array.from({ length: 14 }).map((_, j) => (
                      <td key={j} className="px-2 py-2 text-center">
                        <div className="h-4 w-8 mx-auto rounded bg-slate-200 dark:bg-slate-700" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Summary Table - real data */}
      {!loading && payRegisters.length > 0 && (
        <div className="mt-2 mb-6 rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm shadow-lg dark:border-slate-700 dark:bg-slate-900/80 overflow-x-auto">
          <div className="p-4 pt-3">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-3">Monthly Summary</h3>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                  <th className="sticky left-0 z-10 w-[180px] border-r border-slate-200 bg-slate-50 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    Employee
                  </th>
                  {[
                    'Total Present',
                    'Total Absent',
                    'Total Leaves',
                    'Paid Leaves',
                    'LOP Count',
                    'Total OD',
                    'Total OT Hours',
                    'Total Extra Days',
                    'Lates',
                    'Holidays & Weekoffs',
                    'Present Days',
                    'Payable Shifts',
                    'Month Days',
                    'Counted Days',
                  ].map((label) => (
                    <th
                      key={label}
                      className="border-r border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:text-slate-300 last:border-r-0"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {getSummaryRows().map((row) => {
                  const employee = typeof row.pr.employeeId === 'object' ? row.pr.employeeId : null;
                  const empNo =
                    typeof row.pr.employeeId === 'object' ? row.pr.employeeId.emp_no : row.pr.emp_no;
                  const empName = typeof row.pr.employeeId === 'object' ? row.pr.employeeId.employee_name : '';
                  const department =
                    typeof row.pr.employeeId === 'object' && row.pr.employeeId.department_id
                      ? typeof row.pr.employeeId.department_id === 'object'
                        ? row.pr.employeeId.department_id.name
                        : ''
                      : '';
                  const leftDate = employee && 'leftDate' in employee ? (employee as any).leftDate : null;
                  const leftDateStr = leftDate ? (typeof leftDate === 'string' ? new Date(leftDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '') : '';
                  return (
                    <tr key={row.pr._id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-3 py-2 text-[11px] font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white">
                        <div>
                          <div className="font-semibold truncate">{empName}</div>
                          <div className="text-[9px] text-slate-500 dark:text-slate-400 truncate">
                            {empNo}
                            {department && ` • ${department}`}
                          </div>
                          {leftDateStr && (
                            <div className="text-[9px] text-amber-600 dark:text-amber-400 font-medium mt-0.5" title="Left in this payroll period">
                              Left {leftDateStr}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="text-center px-2 py-2">{row.present.toFixed(1)}</td>
                      <td className="text-center px-2 py-2">{row.absent.toFixed(1)}</td>
                      <td className="text-center px-2 py-2">{row.leave.toFixed(1)}</td>
                      <td className="text-center px-2 py-2 font-medium text-green-600 dark:text-green-400">{row.paidLeave.toFixed(1)}</td>
                      <td className="text-center px-2 py-2 font-medium text-red-600 dark:text-red-400">{row.lop.toFixed(1)}</td>
                      <td className="text-center px-2 py-2">{row.od.toFixed(1)}</td>
                      <td className="text-center px-2 py-2">{row.ot.toFixed(1)}</td>
                      <td className="text-center px-2 py-2">{row.extra.toFixed(1)}</td>
                      <td className="text-center px-2 py-2 font-bold text-amber-600 dark:text-amber-400">{row.lateCount}</td>
                      <td className="text-center px-2 py-2">{row.holidayAndWeekoffs.toFixed(1)}</td>
                      <td className="text-center px-2 py-2 font-medium text-green-600 dark:text-green-400" title="Includes OD days">{row.present.toFixed(1)}</td>
                      <td className="text-center px-2 py-2 font-bold text-slate-700 dark:text-slate-300">{row.payableShifts.toFixed(1)}</td>
                      <td className="text-center px-2 py-2">{row.monthDays}</td>
                      <td
                        className={`text-center px-2 py-2 font-semibold ${row.matchesMonth
                          ? 'text-green-700 dark:text-green-400'
                          : 'text-red-700 dark:text-red-400'
                          }`}
                      >
                        {row.countedDays.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Pagination below Summary table */}
          {paginationTotalPages > 1 && (
            <div className="flex items-center justify-center gap-2 p-4 border-t border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => { setPage(p => Math.max(1, p - 1)); loadPayRegisters(Math.max(1, page - 1), false); }}
                disabled={page <= 1 || loading}
                className="h-8 px-3 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Page {page} of {paginationTotalPages}
              </span>
              <button
                type="button"
                onClick={() => { setPage(p => Math.min(paginationTotalPages, p + 1)); loadPayRegisters(Math.min(paginationTotalPages, page + 1), false); }}
                disabled={page >= paginationTotalPages || loading}
                className="h-8 px-3 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )
      }

      {/* Table Tabs */}
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow mb-8">
        <div className="border-b border-slate-200 dark:border-slate-700">
          <nav className="flex -mb-px">
            {[
              { id: 'all' as TableType, label: 'All', color: 'slate' },
              { id: 'present' as TableType, label: 'Present', color: 'green' },
              { id: 'absent' as TableType, label: 'Absent', color: 'red' },
              { id: 'leaves' as TableType, label: 'Leaves', color: 'yellow' },
              { id: 'od' as TableType, label: 'OD', color: 'blue' },
              { id: 'ot' as TableType, label: 'OT', color: 'orange' },
              { id: 'extraHours' as TableType, label: 'Extra Hours', color: 'purple' },
              { id: 'shifts' as TableType, label: 'Shifts', color: 'indigo' },
            ].map((tab) => {
              // Count employees with data in this table type
              const count = payRegisters.filter(pr => {
                if (tab.id === 'all') return true;
                if (!pr.dailyRecords || pr.dailyRecords.length === 0) return false;
                switch (tab.id) {
                  case 'present':
                    return pr.dailyRecords.some(r => r.status === 'present' || r.firstHalf.status === 'present' || r.secondHalf.status === 'present');
                  case 'absent':
                    return pr.dailyRecords.some(r => r.status === 'absent' || r.firstHalf.status === 'absent' || r.secondHalf.status === 'absent');
                  case 'leaves':
                    return pr.dailyRecords.some(r => r.status === 'leave' || r.firstHalf.status === 'leave' || r.secondHalf.status === 'leave');
                  case 'od':
                    return pr.dailyRecords.some(r => r.status === 'od' || r.isOD || r.firstHalf.status === 'od' || r.secondHalf.status === 'od' || r.firstHalf.isOD || r.secondHalf.isOD);
                  case 'ot':
                  case 'extraHours':
                    return pr.dailyRecords.some(r => r.otHours > 0 || r.firstHalf.otHours > 0 || r.secondHalf.otHours > 0);
                  case 'shifts':
                    return pr.dailyRecords.some(r => r.shiftId !== null || r.shiftName !== null || r.firstHalf.shiftId !== null || r.secondHalf.shiftId !== null);
                  default:
                    return true;
                }
              }).length;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTable(tab.id)}
                  className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTable === tab.id
                    ? `border-${tab.color}-500 text-${tab.color}-600 dark:text-${tab.color}-400`
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-300'
                    }`}
                >
                  {tab.label}
                  <span className="ml-2 px-2 py-0.5 text-xs bg-slate-100 dark:bg-slate-700 rounded-full">
                    {count}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Grid Table View - skeleton when loading */}
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm shadow-xl dark:border-slate-700 dark:bg-slate-900/80">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                    <th className="sticky left-0 z-10 w-[180px] border-r border-slate-200 bg-slate-50 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">Employee</th>
                    {daysArray.map((day) => (
                      <th key={day} className="border-r border-slate-200 px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{parseInt(day.split('-')[2])}</th>
                    ))}
                    <th className="w-[80px] border-r-0 border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                        <div className="h-4 w-32 rounded bg-slate-200 dark:bg-slate-700" />
                        <div className="mt-1 h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" />
                      </td>
                      {daysArray.map((day) => (
                        <td key={day} className="border-r border-slate-200 px-1 py-1.5 text-center dark:border-slate-700">
                          <div className="h-6 w-full max-w-[28px] mx-auto rounded bg-slate-200 dark:bg-slate-700" />
                        </td>
                      ))}
                      <td className="border-r-0 border-slate-200 px-2 py-2 text-center dark:border-slate-700">
                        <div className="h-4 w-10 mx-auto rounded bg-slate-200 dark:bg-slate-700" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm shadow-xl dark:border-slate-700 dark:bg-slate-900/80">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                    <th className="sticky left-0 z-10 w-[180px] border-r border-slate-200 bg-slate-50 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      Employee
                    </th>
                    {daysArray.map((day) => (
                      <th
                        key={day}
                        className={'w-[calc((100%-180px-' + (activeTable === 'leaves' ? '320px' : activeTable === 'all' ? '160px' : '80px') + '/' + daysArray.length + ')] border-r border-slate-200 px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}
                      >
                        {parseInt(day.split('-')[2])}
                      </th>
                    ))}
                    {activeTable === 'all' && (
                      <>
                        <th className="w-[80px] border-r border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:text-slate-300 bg-green-50 dark:bg-green-900/20" title="OD days are included in present days">
                          Present Days
                        </th>
                        <th className="w-[80px] border-r-0 border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/50">
                          Payable Shifts
                        </th>
                      </>
                    )}
                    {activeTable === 'present' && (
                      <th className="w-[80px] border-r-0 border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:text-slate-300 bg-green-50 dark:bg-green-900/20">
                        Total Present Days
                      </th>
                    )}
                    {activeTable === 'absent' && (
                      <th className="w-[80px] border-r-0 border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:text-slate-300 bg-red-50 dark:bg-red-900/20">
                        Total Absent Days
                      </th>
                    )}
                    {activeTable === 'leaves' && (
                      <>
                        <th className="w-[80px] border-r border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:text-slate-300 bg-yellow-50 dark:bg-yellow-900/20">
                          Total Leaves
                        </th>
                        <th className="w-[80px] border-r border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:text-slate-300 bg-green-50 dark:bg-green-900/20">
                          Paid Leaves
                        </th>
                        <th className="w-[80px] border-r border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:text-slate-300 bg-red-50 dark:bg-red-900/20">
                          LOP
                        </th>
                        <th className="w-[80px] border-r-0 border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:text-slate-300 bg-orange-50 dark:bg-orange-900/20">
                          Without Pay
                        </th>
                      </>
                    )}
                    {activeTable === 'od' && (
                      <th className="w-[80px] border-r-0 border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:text-slate-300 bg-blue-50 dark:bg-blue-900/20">
                        Total OD Days
                      </th>
                    )}
                    {activeTable === 'ot' && (
                      <th className="w-[80px] border-r-0 border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:text-slate-300 bg-orange-50 dark:bg-orange-900/20">
                        Total OT Hours
                      </th>
                    )}
                    {activeTable === 'extraHours' && (
                      <th className="w-[80px] border-r-0 border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:text-slate-300 bg-purple-50 dark:bg-purple-900/20">
                        Total Extra Hours
                      </th>
                    )}
                    {activeTable === 'shifts' && (
                      <th className="w-[80px] border-r-0 border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-700 dark:text-slate-300 bg-indigo-50 dark:bg-indigo-900/20">
                        Total Shifts
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {getFilteredPayRegisters().length === 0 ? (
                    <tr>
                      <td colSpan={daysArray.length + (activeTable === 'leaves' ? 4 : activeTable === 'all' ? 2 : 1)} className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                        No records found{activeTable !== 'all' ? ` for ${activeTable === 'shifts' ? 'shifts' : activeTable} table` : ''}
                      </td>
                    </tr>
                  ) : (
                    getFilteredPayRegisters().map((pr) => {
                      const employee = typeof pr.employeeId === 'object' ? pr.employeeId : null;
                      const employeeId = typeof pr.employeeId === 'object' ? pr.employeeId._id : pr.employeeId;
                      const emp_no = typeof pr.employeeId === 'object' ? pr.employeeId.emp_no : pr.emp_no;
                      const employee_name = typeof pr.employeeId === 'object' ? pr.employeeId.employee_name : '';
                      const department = typeof pr.employeeId === 'object' && pr.employeeId.department_id
                        ? (typeof pr.employeeId.department_id === 'object' ? pr.employeeId.department_id.name : '')
                        : '';
                      const leftDateDaily = employee && 'leftDate' in employee ? (employee as any).leftDate : null;
                      const leftDateStrDaily = leftDateDaily ? (typeof leftDateDaily === 'string' ? new Date(leftDateDaily).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '') : '';

                      // Create a map of daily records for quick lookup
                      const dailyRecordsMap = new Map(pr.dailyRecords.map(r => [r.date, r]));

                      const deptId = employee && employee.department_id
                        ? (typeof employee.department_id === 'object' ? employee.department_id._id : employee.department_id)
                        : '';

                      const batchInfo = deptId ? departmentBatchStatus.get(deptId) : null;
                      const batchStatus = batchInfo?.status || 'pending';
                      const hasPermission = batchInfo?.permissionGranted || false;

                      const isLocked = (['approved', 'freeze', 'complete'].includes(batchStatus) && !hasPermission);
                      const isFrozenOrComplete = ['freeze', 'complete'].includes(batchStatus);

                      return (
                        <tr key={pr._id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-3 py-2 text-[11px] font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white">
                            <div>
                              <div className="flex items-center gap-2">
                                <div className="font-semibold truncate flex-1 flex items-center gap-1">
                                  {employee_name}
                                  {leftDateStrDaily && (
                                    <span className="text-[9px] text-amber-600 dark:text-amber-400 font-medium" title="Left in this payroll period">(Left {leftDateStrDaily})</span>
                                  )}
                                  {isLocked && (
                                    <span title={`Payroll ${batchStatus}`} className="text-slate-400">
                                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                                        <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                                      </svg>
                                    </span>
                                  )}
                                </div>
                                <div className="flex gap-2">
                                  {!pr.payrollId ? (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (employee) handleCalculatePayroll(employee);
                                      }}
                                      className="rounded-md px-2 py-1 text-[9px] font-semibold text-white shadow-sm transition-all hover:shadow-md bg-amber-500 hover:bg-amber-600"
                                      title="Calculate Payroll"
                                    >
                                      Calculate
                                    </button>
                                  ) : (
                                    <Link
                                      href={`/superadmin/payroll-transactions?employeeId=${employeeId}&month=${monthStr}`}
                                      onClick={(e) => e.stopPropagation()}
                                      className="rounded-md px-2 py-1 text-[9px] font-semibold text-white shadow-sm transition-all hover:shadow-md bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 inline-block"
                                      title="View Payslip"
                                    >
                                      Payslip
                                    </Link>
                                  )}

                                  {!isFrozenOrComplete && (
                                    <div />
                                  )}
                                </div>
                              </div>
                              <div className="text-[9px] text-slate-500 dark:text-slate-400 truncate mt-1">
                                {emp_no}
                                {department && ` • ${department}`}
                              </div>
                            </div>
                          </td>
                          {daysArray.map((day) => {
                            const dateStr = day;
                            const record = dailyRecordsMap.get(dateStr) || null;
                            const shouldShow = shouldShowInTable(record, activeTable);
                            const displayStatus = getStatusDisplay(record);
                            const bgColor = getCellBackgroundColor(record, activeTable);

                            return (
                              <td
                                key={day}
                                onClick={() => {
                                  if (employee && !isLocked) {
                                    if (record) {
                                      handleDateClick(employee, dateStr, record);
                                    } else {
                                      // Create empty record for editing if no record exists
                                      const emptyRecord: DailyRecord = {
                                        date: dateStr,
                                        firstHalf: {
                                          status: 'absent',
                                          leaveType: null,
                                          leaveNature: null,
                                          isOD: false,
                                          otHours: 0,
                                          shiftId: null,
                                          remarks: null,
                                        },
                                        secondHalf: {
                                          status: 'absent',
                                          leaveType: null,
                                          leaveNature: null,
                                          isOD: false,
                                          otHours: 0,
                                          shiftId: null,
                                          remarks: null,
                                        },
                                        status: 'absent',
                                        leaveType: null,
                                        leaveNature: null,
                                        isOD: false,
                                        isSplit: false,
                                        shiftId: null,
                                        shiftName: null,
                                        otHours: 0,
                                        remarks: null,
                                      };
                                      handleDateClick(employee, dateStr, emptyRecord);
                                    }
                                  }
                                }}
                                className={`border-r border-slate-200 px-1 py-1.5 text-center dark:border-slate-700
                                ${employee && !isLocked ? 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800' : 'cursor-not-allowed opacity-75 bg-slate-50 dark:bg-slate-800/50'} 
                                ${bgColor}`}
                              >
                                {shouldShow && record ? (
                                  <div className="space-y-0.5">
                                    {activeTable === 'shifts' ? (
                                      <>
                                        {record.shiftName ? (
                                          <div className="font-semibold text-[9px] text-indigo-700 dark:text-indigo-300" title={record.shiftName}>
                                            {record.shiftName.length > 8 ? record.shiftName.substring(0, 8) + '...' : record.shiftName}
                                          </div>
                                        ) : (
                                          <div className="font-semibold text-[9px] text-slate-500">-</div>
                                        )}
                                        {record.isSplit && (
                                          <div className="text-[7px] opacity-75 text-slate-500">
                                            {record.firstHalf.shiftId ? '1st' : ''}
                                            {record.firstHalf.shiftId && record.secondHalf.shiftId ? '/' : ''}
                                            {record.secondHalf.shiftId ? '2nd' : ''}
                                          </div>
                                        )}
                                      </>
                                    ) : (
                                      <>
                                        <div className="font-semibold text-[9px]">{displayStatus}</div>
                                        {record.isSplit && (
                                          <div className="text-[8px] opacity-75">
                                            {record.firstHalf.status.charAt(0).toUpperCase()}/{record.secondHalf.status.charAt(0).toUpperCase()}
                                          </div>
                                        )}
                                        {activeTable === 'all' && (record.isLate || record.isEarlyOut) && (
                                          <div className="text-[7px] font-medium text-amber-600 dark:text-amber-400 mt-0.5" title={[record.isLate && 'Late', record.isEarlyOut && 'Early out'].filter(Boolean).join(', ')}>
                                            {record.isLate && 'L'}
                                            {record.isLate && record.isEarlyOut && ' '}
                                            {record.isEarlyOut && 'E'}
                                          </div>
                                        )}
                                        {record.otHours > 0 && (activeTable === 'ot' || activeTable === 'extraHours' || activeTable === 'all') && (
                                          <div className="text-[8px] font-semibold text-blue-600 dark:text-blue-300">{record.otHours}h</div>
                                        )}
                                        {record.shiftName && activeTable === 'all' && (
                                          <div className="text-[8px] opacity-75 truncate" title={record.shiftName}>{record.shiftName.substring(0, 3)}</div>
                                        )}
                                      </>
                                    )}
                                    {record.isManuallyEdited && (
                                      <div className="text-[7px] text-indigo-600 dark:text-indigo-400" title="Manually Edited">✎</div>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-slate-400 text-[9px]">-</span>
                                )}
                              </td>
                            );
                          })}
                          {/* Dynamic columns based on active tab */}
                          {activeTable === 'all' && (
                            <>
                              <td className="border-r border-slate-200 bg-green-50 dark:bg-green-900/20 px-2 py-2 text-center text-[11px] font-bold text-green-700 dark:text-green-300" title="Includes OD days">
                                {(pr.totals?.totalPresentDays ?? 0).toFixed(1)}
                              </td>
                              <td className="border-r-0 border-slate-200 bg-slate-50 dark:bg-slate-800 px-2 py-2 text-center text-[11px] font-bold text-slate-700 dark:text-slate-300 dark:bg-slate-700/50">
                                {(pr.totals?.totalPayableShifts ?? 0).toFixed(1)}
                              </td>
                            </>
                          )}
                          {activeTable === 'present' && (
                            <td className="border-r-0 border-slate-200 bg-green-50 px-2 py-2 text-center text-[11px] font-bold text-green-700 dark:border-slate-700 dark:bg-green-900/20 dark:text-green-300">
                              {(pr.totals.totalPresentDays + pr.totals.totalODDays).toFixed(1)}
                            </td>
                          )}
                          {activeTable === 'absent' && (
                            <td className="border-r-0 border-slate-200 bg-red-50 px-2 py-2 text-center text-[11px] font-bold text-red-700 dark:border-slate-700 dark:bg-red-900/20 dark:text-red-300">
                              {pr.totals.totalAbsentDays.toFixed(1)}
                            </td>
                          )}
                          {activeTable === 'leaves' && (
                            <>
                              <td className="border-r border-slate-200 bg-yellow-50 px-2 py-2 text-center text-[11px] font-bold text-yellow-700 dark:border-slate-700 dark:bg-yellow-900/20 dark:text-yellow-300">
                                {pr.totals.totalLeaveDays.toFixed(1)}
                              </td>
                              <td className="border-r border-slate-200 bg-green-50 px-2 py-2 text-center text-[11px] font-bold text-green-700 dark:border-slate-700 dark:bg-green-900/20 dark:text-green-300">
                                {pr.totals.totalPaidLeaveDays.toFixed(1)}
                              </td>
                              <td className="border-r border-slate-200 bg-red-50 px-2 py-2 text-center text-[11px] font-bold text-red-700 dark:border-slate-700 dark:bg-red-900/20 dark:text-red-300">
                                {pr.totals.totalLopDays.toFixed(1)}
                              </td>
                              <td className="border-r-0 border-slate-200 bg-orange-50 px-2 py-2 text-center text-[11px] font-bold text-orange-700 dark:border-slate-700 dark:bg-orange-900/20 dark:text-orange-300">
                                {pr.totals.totalUnpaidLeaveDays.toFixed(1)}
                              </td>
                            </>
                          )}
                          {activeTable === 'od' && (
                            <td className="border-r-0 border-slate-200 bg-blue-50 px-2 py-2 text-center text-[11px] font-bold text-blue-700 dark:border-slate-700 dark:bg-blue-900/20 dark:text-blue-300">
                              {pr.totals.totalODDays.toFixed(1)}
                            </td>
                          )}
                          {activeTable === 'ot' && (
                            <td className="border-r-0 border-slate-200 bg-orange-50 px-2 py-2 text-center text-[11px] font-bold text-orange-700 dark:border-slate-700 dark:bg-orange-900/20 dark:text-orange-300">
                              {pr.totals.totalOTHours.toFixed(1)}
                            </td>
                          )}
                          {activeTable === 'extraHours' && (
                            <td className="border-r-0 border-slate-200 bg-purple-50 px-2 py-2 text-center text-[11px] font-bold text-purple-700 dark:border-slate-700 dark:bg-purple-900/20 dark:text-purple-300">
                              {pr.totals.totalOTHours.toFixed(1)}
                            </td>
                          )}
                          {activeTable === 'shifts' && (
                            <td className="border-r-0 border-slate-200 bg-indigo-50 px-2 py-2 text-center text-[11px] font-bold text-indigo-700 dark:border-slate-700 dark:bg-indigo-900/20 dark:text-indigo-300">
                              {pr.dailyRecords.filter(r => r.shiftId !== null || r.shiftName !== null || r.firstHalf.shiftId !== null || r.secondHalf.shiftId !== null).length}
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {/* Pagination below grid table */}
            {paginationTotalPages > 1 && (
              <div className="flex items-center justify-center gap-2 p-4 border-t border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => { setPage(p => Math.max(1, p - 1)); loadPayRegisters(Math.max(1, page - 1), false); }}
                  disabled={page <= 1 || loading}
                  className="h-8 px-3 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Page {page} of {paginationTotalPages}
                </span>
                <button
                  type="button"
                  onClick={() => { setPage(p => Math.min(paginationTotalPages, p + 1)); loadPayRegisters(Math.min(paginationTotalPages, page + 1), false); }}
                  disabled={page >= paginationTotalPages || loading}
                  className="h-8 px-3 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit Modal - Tab-specific dialogs */}
      {
        showEditModal && editingRecord && (
          <div className="fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto border border-slate-200 dark:border-slate-700">
              <div className="p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                    Edit: {editingRecord.date} - {editingRecord.employee.employee_name}
                  </h2>
                  <button
                    onClick={() => setShowEditModal(false)}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-6">
                  {/* Half-Day Mode Toggle */}
                  <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isHalfDayMode}
                        onChange={(e) => {
                          setIsHalfDayMode(e.target.checked);
                          if (!e.target.checked) {
                            // When disabling half-day mode, sync both halves to the same status
                            const currentStatus = editData.status || editData.firstHalf?.status || 'absent';
                            setEditData({
                              ...editData,
                              status: currentStatus,
                              firstHalf: normalizeHalfDay(editData.firstHalf, currentStatus as any),
                              secondHalf: normalizeHalfDay(editData.secondHalf, currentStatus as any),
                              isSplit: false,
                            });
                          } else {
                            setEditData({
                              ...editData,
                              isSplit: true,
                            });
                          }
                        }}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Enable Half-Day Mode
                      </span>
                    </label>
                    {isHalfDayMode && (
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        (Edit first and second half separately)
                      </span>
                    )}
                  </div>

                  {/* First Half - Only show if half-day mode is enabled */}
                  {isHalfDayMode && (
                    <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                      <h3 className="text-lg font-semibold mb-3 text-slate-900 dark:text-white">First Half</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Status
                          </label>
                          <select
                            value={editData.firstHalf?.status || 'absent'}
                            onChange={(e) => setEditData({
                              ...editData,
                              firstHalf: {
                                ...editData.firstHalf!,
                                status: e.target.value as any,
                                leaveType: e.target.value === 'leave' ? (editData.firstHalf?.leaveType || null) : null,
                                leaveNature: e.target.value === 'leave' ? (editData.firstHalf?.leaveNature || null) : null,
                                isOD: e.target.value === 'od',
                              },
                            })}
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md dark:bg-slate-700 dark:text-white"
                          >
                            <option value="present">Present</option>
                            <option value="absent">Absent</option>
                            <option value="leave">Leave</option>
                            <option value="od">OD</option>
                            <option value="holiday">Holiday</option>
                            <option value="week_off">Week Off</option>
                          </select>
                        </div>
                        {editData.firstHalf?.status === 'leave' && (
                          <>
                            <div>
                              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                Leave Type
                              </label>
                              <select
                                value={editData.firstHalf?.leaveType || ''}
                                onChange={(e) => setEditData({
                                  ...editData,
                                  firstHalf: {
                                    ...editData.firstHalf!,
                                    leaveType: e.target.value,
                                  },
                                })}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md dark:bg-slate-700 dark:text-white"
                              >
                                <option value="">Select Leave Type</option>
                                {leaveTypes.map((lt) => (
                                  <option key={lt.code} value={lt.code}>
                                    {lt.name} ({lt.code})
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                Leave Nature
                              </label>
                              <select
                                value={editData.firstHalf?.leaveNature || 'paid'}
                                onChange={(e) => setEditData({
                                  ...editData,
                                  firstHalf: {
                                    ...editData.firstHalf!,
                                    leaveNature: e.target.value as any,
                                  },
                                })}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md dark:bg-slate-700 dark:text-white"
                              >
                                <option value="paid">Paid</option>
                                <option value="lop">LOP (Loss of Pay)</option>
                              </select>
                            </div>
                          </>
                        )}
                        <div>
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            OT Hours
                          </label>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            value={editData.firstHalf?.otHours || 0}
                            onChange={(e) => setEditData({
                              ...editData,
                              firstHalf: {
                                ...editData.firstHalf!,
                                otHours: parseFloat(e.target.value) || 0,
                              },
                            })}
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md dark:bg-slate-700 dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Shift
                          </label>
                          <select
                            value={editData.shiftId || ''}
                            onChange={(e) => {
                              const shift = shifts.find((s) => s._id === e.target.value);
                              setEditData({
                                ...editData,
                                shiftId: e.target.value || null,
                                shiftName: shift?.name || null,
                                firstHalf: {
                                  ...editData.firstHalf!,
                                  shiftId: e.target.value || null,
                                },
                                secondHalf: {
                                  ...editData.secondHalf!,
                                  shiftId: e.target.value || null,
                                },
                              });
                            }}
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md dark:bg-slate-700 dark:text-white"
                          >
                            <option value="">Select Shift</option>
                            {shifts.map((shift) => (
                              <option key={shift._id} value={shift._id}>
                                {shift.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Second Half - Only show if half-day mode is enabled */}
                  {isHalfDayMode && (
                    <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                      <h3 className="text-lg font-semibold mb-3 text-slate-900 dark:text-white">Second Half</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Status
                          </label>
                          <select
                            value={editData.secondHalf?.status || 'absent'}
                            onChange={(e) => setEditData({
                              ...editData,
                              secondHalf: {
                                ...editData.secondHalf!,
                                status: e.target.value as any,
                                leaveType: e.target.value === 'leave' ? (editData.secondHalf?.leaveType || null) : null,
                                leaveNature: e.target.value === 'leave' ? (editData.secondHalf?.leaveNature || null) : null,
                                isOD: e.target.value === 'od',
                              },
                            })}
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md dark:bg-slate-700 dark:text-white"
                          >
                            <option value="present">Present</option>
                            <option value="absent">Absent</option>
                            <option value="leave">Leave</option>
                            <option value="od">OD</option>
                            <option value="holiday">Holiday</option>
                            <option value="week_off">Week Off</option>
                          </select>
                        </div>
                        {editData.secondHalf?.status === 'leave' && (
                          <>
                            <div>
                              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                Leave Type
                              </label>
                              <select
                                value={editData.secondHalf?.leaveType || ''}
                                onChange={(e) => setEditData({
                                  ...editData,
                                  secondHalf: {
                                    ...editData.secondHalf!,
                                    leaveType: e.target.value,
                                  },
                                })}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md dark:bg-slate-700 dark:text-white"
                              >
                                <option value="">Select Leave Type</option>
                                {leaveTypes.map((lt) => (
                                  <option key={lt.code} value={lt.code}>
                                    {lt.name} ({lt.code})
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                Leave Nature
                              </label>
                              <select
                                value={editData.secondHalf?.leaveNature || 'paid'}
                                onChange={(e) => setEditData({
                                  ...editData,
                                  secondHalf: {
                                    ...editData.secondHalf!,
                                    leaveNature: e.target.value as any,
                                  },
                                })}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md dark:bg-slate-700 dark:text-white"
                              >
                                <option value="paid">Paid</option>
                                <option value="lop">LOP (Loss of Pay)</option>
                              </select>
                            </div>
                          </>
                        )}
                        <div>
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            OT Hours
                          </label>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            value={editData.secondHalf?.otHours || 0}
                            onChange={(e) => setEditData({
                              ...editData,
                              secondHalf: {
                                ...editData.secondHalf!,
                                otHours: parseFloat(e.target.value) || 0,
                              },
                            })}
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md dark:bg-slate-700 dark:text-white"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Full Day Fields - Show when NOT in half-day mode OR for specific tabs */}
                  {!isHalfDayMode && (
                    <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                      <h3 className="text-lg font-semibold mb-3 text-slate-900 dark:text-white">
                        {activeTable === 'all' ? 'Day Status' :
                          activeTable === 'present' ? 'Present Status' :
                            activeTable === 'absent' ? 'Absent Status' :
                              activeTable === 'leaves' ? 'Leave Details' :
                                activeTable === 'od' ? 'OD Details' :
                                  activeTable === 'ot' || activeTable === 'extraHours' ? 'OT Hours' :
                                    'Full Day'}
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {(activeTable === 'all' || activeTable === 'present' || activeTable === 'absent' || activeTable === 'leaves' || activeTable === 'od') && (
                          <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                              Status
                            </label>
                            <select
                              value={editData.status || 'absent'}
                              onChange={(e) => {
                                const newStatus = e.target.value as any;
                                setEditData({
                                  ...editData,
                                  status: newStatus,
                                  firstHalf: {
                                    ...editData.firstHalf!,
                                    status: newStatus,
                                    leaveType: newStatus === 'leave' ? (editData.firstHalf?.leaveType || null) : null,
                                    leaveNature: newStatus === 'leave' ? (editData.firstHalf?.leaveNature || null) : null,
                                    isOD: newStatus === 'od',
                                  },
                                  secondHalf: {
                                    ...editData.secondHalf!,
                                    status: newStatus,
                                    leaveType: newStatus === 'leave' ? (editData.secondHalf?.leaveType || null) : null,
                                    leaveNature: newStatus === 'leave' ? (editData.secondHalf?.leaveNature || null) : null,
                                    isOD: newStatus === 'od',
                                  },
                                  leaveType: newStatus === 'leave' ? (editData.leaveType || null) : null,
                                  leaveNature: newStatus === 'leave' ? (editData.leaveNature || null) : null,
                                  isOD: newStatus === 'od',
                                  isSplit: false,
                                });
                              }}
                              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md dark:bg-slate-700 dark:text-white"
                            >
                              <option value="present">Present</option>
                              <option value="absent">Absent</option>
                              <option value="leave">Leave</option>
                              <option value="od">OD</option>
                              <option value="holiday">Holiday</option>
                              <option value="week_off">Week Off</option>
                            </select>
                          </div>
                        )}
                        {editData.status === 'leave' && (activeTable === 'leaves' || !isHalfDayMode) && (
                          <>
                            <div>
                              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                Leave Type
                              </label>
                              <select
                                value={editData.leaveType || ''}
                                onChange={(e) => setEditData({
                                  ...editData,
                                  leaveType: e.target.value,
                                  firstHalf: {
                                    ...editData.firstHalf!,
                                    leaveType: e.target.value,
                                  },
                                  secondHalf: {
                                    ...editData.secondHalf!,
                                    leaveType: e.target.value,
                                  },
                                })}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md dark:bg-slate-700 dark:text-white"
                              >
                                <option value="">Select Leave Type</option>
                                {leaveTypes.map((lt) => (
                                  <option key={lt.code} value={lt.code}>
                                    {lt.name} ({lt.code})
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                Leave Nature
                              </label>
                              <select
                                value={editData.leaveNature || 'paid'}
                                onChange={(e) => setEditData({
                                  ...editData,
                                  leaveNature: e.target.value as any,
                                  firstHalf: {
                                    ...editData.firstHalf!,
                                    leaveNature: e.target.value as any,
                                  },
                                  secondHalf: {
                                    ...editData.secondHalf!,
                                    leaveNature: e.target.value as any,
                                  },
                                })}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md dark:bg-slate-700 dark:text-white"
                              >
                                <option value="paid">Paid</option>
                                <option value="lop">LOP (Loss of Pay)</option>
                                <option value="without_pay">Without Pay</option>
                              </select>
                            </div>
                          </>
                        )}
                        {/* Shift field for full day */}
                        <div>
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Shift
                          </label>
                          <select
                            value={editData.shiftId || ''}
                            onChange={(e) => {
                              const shift = shifts.find((s) => s._id === e.target.value);
                              setEditData({
                                ...editData,
                                shiftId: e.target.value || null,
                                shiftName: shift?.name || null,
                                firstHalf: {
                                  ...editData.firstHalf!,
                                  shiftId: e.target.value || null,
                                },
                                secondHalf: {
                                  ...editData.secondHalf!,
                                  shiftId: e.target.value || null,
                                },
                              });
                            }}
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md dark:bg-slate-700 dark:text-white"
                          >
                            <option value="">Select Shift</option>
                            {shifts.map((shift) => (
                              <option key={shift._id} value={shift._id}>
                                {shift.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Full Day OT Hours - Show for OT/Extra Hours tabs or when not in half-day mode */}
                  {(activeTable === 'ot' || activeTable === 'extraHours' || !isHalfDayMode) && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        {isHalfDayMode ? 'Total OT Hours (First + Second Half)' : 'Total OT Hours (Full Day)'}
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={editData.otHours || 0}
                        onChange={(e) => {
                          const otValue = parseFloat(e.target.value) || 0;
                          if (isHalfDayMode) {
                            // Distribute OT hours equally between halves
                            setEditData({
                              ...editData,
                              otHours: otValue,
                              firstHalf: {
                                ...editData.firstHalf!,
                                otHours: otValue / 2,
                              },
                              secondHalf: {
                                ...editData.secondHalf!,
                                otHours: otValue / 2,
                              },
                            });
                          } else {
                            setEditData({
                              ...editData,
                              otHours: otValue,
                              firstHalf: {
                                ...editData.firstHalf!,
                                otHours: otValue,
                              },
                              secondHalf: {
                                ...editData.secondHalf!,
                                otHours: otValue,
                              },
                            });
                          }
                        }}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md dark:bg-slate-700 dark:text-white"
                      />
                    </div>
                  )}

                  {/* Remarks */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Remarks
                    </label>
                    <textarea
                      value={editData.remarks || ''}
                      onChange={(e) => setEditData({
                        ...editData,
                        remarks: e.target.value,
                      })}
                      rows={3}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md dark:bg-slate-700 dark:text-white"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-6">
                  <button
                    onClick={handleSaveDate}
                    disabled={saving[editingRecord.employeeId]}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving[editingRecord.employeeId] ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => {
                      setShowEditModal(false);
                      setEditingRecord(null);
                      setIsHalfDayMode(false);
                    }}
                    className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }

      {/* Arrears Section - Placed at the bottom of the page */}
      <div className="mt-8 bg-white dark:bg-slate-800 rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-white">Arrears for Payroll</h2>
        <div className="mb-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            The following arrears are approved but not fully settled. All arrears are selected by default.
            You can deselect or adjust the amount to be included in this month's payroll processing.
          </p>
        </div>
        {/* Arrears Selection Section */}
        <ArrearsPayrollSection
          month={month}
          year={year}
          departmentId={selectedDepartment}
          onArrearsSelected={handleArrearsSelected}
        />
      </div>
    </div>
  );
}
