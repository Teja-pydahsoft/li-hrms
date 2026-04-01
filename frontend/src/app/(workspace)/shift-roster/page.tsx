'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { toast } from 'react-hot-toast';
import { format, parseISO } from 'date-fns';

import { Holiday, HolidayGroup, Shift, Employee } from '@/lib/api';
import {
  LayoutGrid,
  Save,
  Download,
  Settings2,
  CheckCircle2,
  Copy
} from 'lucide-react';

import {
  RosterCell,
  RosterState,
  AssignmentSummaryItem
} from './types';

import {
  checkGroupApplicability,
  formatMonthInput,
  formatSimpleDate,
  getDaysInRange,
  shiftLabel
} from './utils';

import RosterFilters from './components/RosterFilters';
import SearchSection from './components/SearchSection';
import QuickAssignSection from './components/QuickAssignSection';

// Heavy components: load on demand to keep initial bundle smaller
const RosterGrid = dynamic(() => import('./components/RosterGrid'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-24">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
    </div>
  ),
});

const AssignmentsView = dynamic(() => import('./components/AssignmentsView'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-24">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
    </div>
  ),
});

const WeekOffModal = dynamic(() => import('./components/WeekOffModal'), { ssr: false });

const ROSTER_LIMIT = 50;

export default function RosterPage() {
  const [month, setMonth] = useState(formatMonthInput(new Date()));
  const [strict, setStrict] = useState(false);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [divisions, setDivisions] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [selectedDivision, setSelectedDivision] = useState<string>('');
  const [selectedDept, setSelectedDept] = useState<string>('');
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [employeeGroups, setEmployeeGroups] = useState<any[]>([]);
  const [selectedShiftForAssign, setSelectedShiftForAssign] = useState<string>('');
  const [roster, setRoster] = useState<RosterState>(new Map());
  /** Keys of modified cells: `${empNo}|${date}` — only these are sent on save to avoid updating whole roster */
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingProgress, setSavingProgress] = useState<number | null>(null);
  const [autoFillLoading, setAutoFillLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'roster' | 'assigned'>('roster');
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidayGroups, setHolidayGroups] = useState<HolidayGroup[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(ROSTER_LIMIT);
  const [totalPages, setTotalPages] = useState(1);
  const [totalEmployees, setTotalEmployees] = useState(0);

  const [showWeekOff, setShowWeekOff] = useState(false);
  const weekdays = useMemo(() => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], []);
  const [weekOffDays, setWeekOffDays] = useState<Record<string, boolean>>(
    weekdays.reduce((acc, w) => ({ ...acc, [w]: false }), {})
  );
  const [shiftAssignDays, setShiftAssignDays] = useState<Record<string, boolean>>(
    weekdays.reduce((acc, w) => ({ ...acc, [w]: false }), {})
  );

  // Payroll Cycle Config
  const [cycleStartDay, setCycleStartDay] = useState<number>(1);
  const [cycleDates, setCycleDates] = useState<{ startDate: string; endDate: string; label: string } | null>(null);
  const [alignedToCycle, setAlignedToCycle] = useState(false);

  // Fetch payroll cycle setting on mount
  useEffect(() => {
    api.getSetting('payroll_cycle_start_day').then((res) => {
      if (res.success && res.data) setCycleStartDay(Number(res.data.value) || 1);
    }).catch(() => { });
  }, []);

  // After we know the cycle start day, adjust initial month so that the pay cycle contains today
  useEffect(() => {
    if (alignedToCycle || !cycleStartDay) return;
    const today = new Date();
    let y = today.getFullYear();
    let m = today.getMonth() + 1;
    if (cycleStartDay > 1 && today.getDate() >= cycleStartDay) {
      if (m === 12) {
        m = 1;
        y += 1;
      } else {
        m += 1;
      }
    }
    setMonth(formatMonthInput(new Date(y, m - 1, 1)));
    setAlignedToCycle(true);
  }, [cycleStartDay, alignedToCycle]);

  // Recalculate cycle dates when month or cycleStartDay changes
  useEffect(() => {
    if (!month) return;
    const [y, m] = month.split('-').map(Number);
    if (cycleStartDay === 1) {
      setCycleDates({
        startDate: formatSimpleDate(new Date(y, m - 1, 1)),
        endDate: formatSimpleDate(new Date(y, m, 0)),
        label: new Date(y, m - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' })
      });
    } else {
      const start = new Date(y, m - 2, cycleStartDay);
      const end = new Date(y, m - 1, cycleStartDay - 1);
      setCycleDates({
        startDate: formatSimpleDate(start),
        endDate: formatSimpleDate(end),
        label: `${start.getDate()} ${start.toLocaleString('default', { month: 'short' })} - ${end.getDate()} ${end.toLocaleString('default', { month: 'short', year: 'numeric' })}`
      });
    }
  }, [month, cycleStartDay]);

  const days = useMemo(() => {
    if (!cycleDates) return [];
    return getDaysInRange(new Date(cycleDates.startDate), new Date(cycleDates.endDate));
  }, [cycleDates]);

  // Debounced search to prevent UI lag
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const globalHolidayDates = useMemo(() => {
    const dates = new Set<string>();
    holidays.forEach(h => {
      const start = h.date ? format(parseISO(h.date), 'yyyy-MM-dd') : '';
      const end = h.endDate ? format(parseISO(h.endDate), 'yyyy-MM-dd') : start;
      if (!start) return;
      days.forEach(d => {
        if (d >= start && d <= end) dates.add(d);
      });
    });
    return dates;
  }, [holidays, days]);

  const holidayCache = useMemo(() => {
    const cache = new Map<string, Set<string>>();
    if (!employees || !holidays || holidays.length === 0 || days.length === 0) return cache;
    const monthStart = days[0];
    const monthEnd = days[days.length - 1];
    const monthHolidays = holidays.filter(h => {
      const start = h.date ? format(parseISO(h.date), 'yyyy-MM-dd') : '';
      const end = h.endDate ? format(parseISO(h.endDate), 'yyyy-MM-dd') : start;
      return (start && start <= monthEnd) && (end && end >= monthStart);
    });
    if (monthHolidays.length === 0) return cache;
    employees.forEach(emp => {
      const empHolidays = new Set<string>();
      monthHolidays.forEach(h => {
        const start = h.date ? format(parseISO(h.date), 'yyyy-MM-dd') : '';
        const end = h.endDate ? format(parseISO(h.endDate), 'yyyy-MM-dd') : start;
        let isApplicable = false;
        if (h.scope === 'GLOBAL') {
          if (h.applicableTo === 'ALL') {
            const override = monthHolidays.find(o =>
              o.overridesMasterId === h._id && o.scope === 'GROUP' && checkGroupApplicability(o, emp, holidayGroups)
            );
            isApplicable = !override;
          } else if (h.applicableTo === 'SPECIFIC_GROUPS') {
            isApplicable = checkGroupApplicability(h, emp, holidayGroups);
          } else isApplicable = true;
        } else if (h.scope === 'GROUP') isApplicable = checkGroupApplicability(h, emp, holidayGroups);
        if (isApplicable) days.forEach(d => { if (d >= start && d <= end) empHolidays.add(d); });
      });
      cache.set(emp.emp_no, empHolidays);
    });
    return cache;
  }, [employees, holidays, holidayGroups, days]);

  const loadData = useCallback(async () => {
    if (!cycleDates) return;
    setLoading(true);
    try {
      // In workspace mode, some admin endpoints might be restricted. 
      // We wrap holidays in a try-catch to ensure roster works without them if blocked.
      const fetchData = async () => {
        const [shiftRes, divRes, deptRes, groupRes] = await Promise.all([
          api.getShifts(),
          api.getDivisions(),
          api.getDepartments(),
          api.getEmployeeGroups(true),
        ]);
        
        let holidaysData: Holiday[] = [];
        let holidayGroupsData: HolidayGroup[] = [];
        try {
          // Attempt to fetch holidays (superadmin version uses getAllHolidaysAdmin)
          // If this fails due to scope/permissions, the roster will simply load without holidays.
          const holidayRes = await api.getAllHolidaysAdmin(parseInt(month.split('-')[0]));
          if (holidayRes && holidayRes.data) {
            if (Array.isArray(holidayRes.data)) holidaysData = holidayRes.data;
            else {
              holidaysData = holidayRes.data.holidays || [];
              holidayGroupsData = holidayRes.data.groups || [];
            }
          }
        } catch (hErr) {
          console.warn('Holiday fetch failed, roster will load without holiday markers:', hErr);
        }

        return { shiftRes, divRes, deptRes, groupRes, holidaysData, holidayGroupsData };
      };

      const { shiftRes, divRes, deptRes, groupRes, holidaysData, holidayGroupsData } = await fetchData();
      
      setShifts(shiftRes.data || []);
      setDivisions(divRes.data || []);
      setDepartments(deptRes.data || []);
      setEmployeeGroups(groupRes.data || []);
      setHolidays(holidaysData);
      setHolidayGroups(holidayGroupsData);

      const empParams: Record<string, unknown> = { page, limit };
      if (selectedDept) empParams.department_id = selectedDept;
      if (selectedDivision) empParams.division_id = selectedDivision;
      if (selectedGroup) empParams.employee_group_id = selectedGroup;
      if (searchQuery) empParams.search = searchQuery;
      if (cycleDates?.startDate && cycleDates?.endDate) {
        empParams.startDate = cycleDates.startDate;
        empParams.endDate = cycleDates.endDate;
      }
      const empRes = await api.getEmployees(empParams) as { data: Employee[]; pagination?: { totalPages: number; total: number } };
      const empList = empRes.data || [];
      setEmployees(empList);
      setTotalPages(empRes.pagination?.totalPages || 1);
      setTotalEmployees(empRes.pagination?.total || empList.length);

      const rosterRes = await api.getRoster(month, {
        departmentId: selectedDept || undefined,
        divisionId: selectedDivision || undefined,
        startDate: cycleDates.startDate,
        endDate: cycleDates.endDate
      });
      const rosterData = rosterRes.data as { entries: { employeeNumber: string; date: string; shiftId?: string; status?: string }[]; strict?: boolean } | null;
      const entries = rosterData?.entries || [];
      const map = new Map<string, Record<string, RosterCell>>();
      entries.forEach((e: { employeeNumber: string; date: string; shiftId?: string; status?: string }) => {
        if (!e.employeeNumber) return;
        if (!map.has(e.employeeNumber)) map.set(e.employeeNumber, {});
        map.get(e.employeeNumber)![e.date] = {
          shiftId: e.shiftId || null,
          status: e.status === 'WO' ? 'WO' : (e.status === 'HOL' ? 'HOL' : undefined)
        };
      });
      setRoster(map);
      setDirtyKeys(new Set());
    } catch (err) {
      console.error('Error loading roster data:', err);
      toast.error('Failed to load roster');
    } finally { setLoading(false); }
  }, [month, selectedDept, selectedDivision, selectedGroup, searchQuery, page, limit, cycleDates]);

  useEffect(() => { loadData(); }, [loadData]);

  const updateCell = useCallback((empNo: string, date: string, value: RosterCell) => {
    const emp = employees.find(e => e.emp_no === empNo);
    if (emp?.doj) {
      const dojStr = format(parseISO(emp.doj), 'yyyy-MM-dd');
      if (date < dojStr) {
        toast.error(`Cannot assign shift before joining date (${dojStr}) for ${emp.employee_name || empNo}`);
        return;
      }
    }
    setRoster(prev => {
      const next = new Map(prev);
      const row = { ...(next.get(empNo) || {}) };
      row[date] = value;
      next.set(empNo, row);
      return next;
    });
    setDirtyKeys(prev => new Set(prev).add(`${empNo}|${date}`));
  }, [employees]);

  const applyEmployeeAllDays = useCallback((empNo: string, shiftId: string | null, status?: 'WO' | 'HOL') => {
    const emp = employees.find(e => e.emp_no === empNo);
    const dojStr = emp?.doj ? format(parseISO(emp.doj), 'yyyy-MM-dd') : null;
    setRoster(prev => {
      const next = new Map(prev);
      const row = { ...(next.get(empNo) || {}) };
      days.forEach(d => {
        if (dojStr && d < dojStr) return;
        if (shiftId && (row[d]?.status === 'WO' || row[d]?.status === 'HOL')) return;
        row[d] = { shiftId, status };
      });
      next.set(empNo, row);
      return next;
    });
    setDirtyKeys(prev => {
      const next = new Set(prev);
      days.forEach(d => {
        if (dojStr && d < dojStr) return;
        next.add(`${empNo}|${d}`);
      });
      return next;
    });
  }, [days, employees]);

  const applyAssignDays = useCallback((shiftId: string | null, status?: 'WO' | 'HOL') => {
    const activeDays = Object.keys(shiftAssignDays).filter(d => shiftAssignDays[d]);
    if (activeDays.length === 0) return;
    const activeDates = days.filter(d => activeDays.includes(weekdays[new Date(d).getDay()]));
    setRoster(prev => {
      const next = new Map(prev);
      employees.forEach(emp => {
        const dojStr = emp.doj ? format(parseISO(emp.doj), 'yyyy-MM-dd') : null;
        const row = { ...(next.get(emp.emp_no) || {}) };
        days.forEach(d => {
          if (dojStr && d < dojStr) return;
          if (activeDays.includes(weekdays[new Date(d).getDay()])) {
            if (shiftId && (row[d]?.status === 'WO' || row[d]?.status === 'HOL')) return;
            row[d] = { shiftId, status };
          }
        });
        next.set(emp.emp_no, row);
      });
      return next;
    });
    setDirtyKeys(prev => {
      const next = new Set(prev);
      employees.forEach(emp => {
        const dojStr = emp.doj ? format(parseISO(emp.doj), 'yyyy-MM-dd') : null;
        activeDates.forEach(d => {
          if (dojStr && d < dojStr) return;
          next.add(`${emp.emp_no}|${d}`);
        });
      });
      return next;
    });
  }, [days, shiftAssignDays, weekdays, employees]);

  const handleAssignAll = useCallback(() => {
    if (!selectedShiftForAssign) return;
    applyAssignDays(selectedShiftForAssign);
    toast.success('Assigned shift to all employees on selected weekdays');
  }, [selectedShiftForAssign, applyAssignDays]);

  const applyWeekOffs = useCallback(() => {
    const activeDays = Object.keys(weekOffDays).filter(d => weekOffDays[d]);
    if (activeDays.length === 0) return;
    const activeDates = days.filter(d => activeDays.includes(weekdays[new Date(d).getDay()]));
    setRoster(prev => {
      const next = new Map(prev);
      employees.forEach(emp => {
        const dojStr = emp.doj ? format(parseISO(emp.doj), 'yyyy-MM-dd') : null;
        const row = { ...(next.get(emp.emp_no) || {}) };
        days.forEach(d => {
          if (dojStr && d < dojStr) return;
          if (activeDays.includes(weekdays[new Date(d).getDay()])) row[d] = { shiftId: null, status: 'WO' };
        });
        next.set(emp.emp_no, row);
      });
      return next;
    });
    setDirtyKeys(prev => {
      const next = new Set(prev);
      employees.forEach(emp => {
        const dojStr = emp.doj ? format(parseISO(emp.doj), 'yyyy-MM-dd') : null;
        activeDates.forEach(d => {
          if (dojStr && d < dojStr) return;
          next.add(`${emp.emp_no}|${d}`);
        });
      });
      return next;
    });
    setShowWeekOff(false);
    toast.success('Assigned week offs');
  }, [days, weekOffDays, weekdays, employees]);

  const saveRoster = async () => {
    setSaving(true);
    setSavingProgress(0);
    try {
      const entries: { employeeNumber: string; date: string; shiftId: string | null; status: string }[] = [];
      if (dirtyKeys.size > 0) {
        dirtyKeys.forEach(key => {
          const [empNo, date] = key.split('|');
          const row = roster.get(empNo);
          if (!row) return;
          const cell = row[date];
          if (cell?.shiftId || cell?.status) {
            entries.push({
              employeeNumber: empNo,
              date,
              shiftId: cell.shiftId || null,
              status: cell.status || 'SHIFT'
            });
          }
        });
      }
      if (entries.length === 0) {
        toast.success(dirtyKeys.size === 0 ? 'No changes to save' : 'No valid entries to save');
        setSaving(false);
        setSavingProgress(null);
        return;
      }
      const batchSize = 100;
      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        await api.saveRoster({
          month,
          entries: batch,
          strict,
          startDate: cycleDates?.startDate,
          endDate: cycleDates?.endDate
        });
        setSavingProgress(Math.min(100, Math.round(((i + batchSize) / entries.length) * 100)));
      }
      setDirtyKeys(new Set());
      toast.success(`Roster saved: ${entries.length} entries updated`);
    } catch (err) {
      console.error('Error saving roster:', err);
      toast.error('Failed to save roster');
    } finally {
      setSaving(false);
      setSavingProgress(null);
    }
  };

  const assignedShiftsSummary = useMemo(() => {
    if (activeTab !== 'assigned') return [];
    const summary: AssignmentSummaryItem[] = [];
    employees.forEach(emp => {
      const row = roster.get(emp.emp_no) || {};
      const shiftMap = new Map<string | null, { label: string; dates: string[] }>();
      Object.entries(row).forEach(([date, cell]) => {
        const isWO = cell?.status === 'WO', isHOL = cell?.status === 'HOL';
        const shiftId = isWO ? 'WO' : (isHOL ? 'HOL' : (cell?.shiftId || null));
        const label = isWO ? 'Week Off' : (isHOL ? 'Holiday' : (shiftId ? shiftLabel(shifts.find(s => s._id === shiftId)) : 'Unassigned'));
        const key = isWO ? 'WO' : (isHOL ? 'HOL' : shiftId);
        if (!shiftMap.has(key)) shiftMap.set(key, { label, dates: [] });
        shiftMap.get(key)!.dates.push(date);
      });
      if (shiftMap.size > 0) {
        const shiftsList = Array.from(shiftMap.entries()).map(([sid, data]) => ({
          shiftId: sid, shiftLabel: data.label, days: data.dates.length, dates: data.dates.sort()
        })).sort((a, b) => (a.shiftId === 'WO' ? -1 : b.shiftId === 'WO' ? 1 : (a.shiftId === 'HOL' ? -1 : b.shiftId === 'HOL' ? 1 : 0)));
        summary.push({
          employee: emp, shifts: shiftsList,
          totalDays: shiftsList.reduce((s, x) => s + x.days, 0),
          weekOffs: shiftsList.find(s => s.shiftId === 'WO')?.days || 0,
          holidays: shiftsList.find(s => s.shiftId === 'HOL')?.days || 0
        });
      }
    });
    return summary.sort((a, b) => (a.employee.employee_name || a.employee.emp_no).localeCompare(b.employee.employee_name || b.employee.emp_no));
  }, [employees, roster, shifts, activeTab]);

  const filteredAssignedSummary = useMemo(() => {
    if (activeTab !== 'assigned' || !assignedShiftsSummary) return [];
    if (!debouncedSearch) return assignedShiftsSummary;
    const term = debouncedSearch.toLowerCase();
    return assignedShiftsSummary.filter(it =>
      (it.employee.employee_name || '').toLowerCase().includes(term) || (it.employee.emp_no || '').toLowerCase().includes(term)
    );
  }, [assignedShiftsSummary, debouncedSearch, activeTab]);

  const handleExportExcel = async () => {
    const exportToast = toast.loading('Preparing export...');
    try {
      const divisionName = selectedDivision ? (divisions.find(d => d._id === selectedDivision)?.name || 'Division') : 'All';
      const deptName = selectedDept ? (departments.find(d => d._id === selectedDept)?.name || 'Dept') : 'All';
      const [allEmpsRes, allRosterRes, xlsxMod] = await Promise.all([
        api.getEmployees({
          limit: 10000,
          department_id: selectedDept || undefined,
          division_id: selectedDivision || undefined,
          employee_group_id: selectedGroup || undefined,
          search: searchQuery || undefined,
        }),
        api.getRoster(month, { departmentId: selectedDept || undefined, divisionId: selectedDivision || undefined }),
        import('xlsx'),
      ]);
      const XLSX: typeof import('xlsx') = (xlsxMod as any).default ?? xlsxMod;
      const allEmps = (allEmpsRes.data || []) as { emp_no: string; employee_name?: string; division?: { name: string }; department?: { name: string } }[];
      const allRosterData = allRosterRes.data as { entries: { employeeNumber: string; date: string; shiftId?: string; status?: string }[] } | null;
      const allEntries = allRosterData?.entries || [];
      const fullMap = new Map<string, any>();
      allEntries.forEach((e: any) => {
        if (!e.employeeNumber) return;
        if (!fullMap.has(e.employeeNumber)) fullMap.set(e.employeeNumber, {});
        fullMap.get(e.employeeNumber)![e.date] = { shiftId: e.shiftId || null, status: e.status };
      });
      const data: any[][] = [[`Shift Roster - ${divisionName} / ${deptName} - ${month}`], [], ['Emp No', 'Name', 'Division', 'Dept', ...days.map(d => format(parseISO(d), 'dd-MMM'))]];
      allEmps.forEach((emp: any) => {
        const row = [emp.emp_no, emp.employee_name || '-', emp.division?.name || '-', emp.department?.name || '-'];
        days.forEach(d => {
          const cell = (fullMap.get(emp.emp_no) || {})[d];
          if (cell?.status === 'WO') row.push('WO');
          else if (cell?.status === 'HOL') row.push('HOL');
          else if (cell?.shiftId) row.push(shiftLabel(shifts.find(s => s._id === cell.shiftId)));
          else row.push('-');
        });
        data.push(row);
      });
      const ws = XLSX.utils.aoa_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Roster');
      XLSX.writeFile(wb, `Shift_Roster_${month}.xlsx`);
      toast.success('Roster exported');
    } catch (err) { console.error('Export error:', err); toast.error('Export failed'); } finally { toast.dismiss(exportToast); }
  };

  const filteredEmployees = useMemo(() => {
    if (!debouncedSearch) return employees;
    const term = debouncedSearch.toLowerCase();
    return employees.filter(emp => (emp.employee_name || '').toLowerCase().includes(term) || (emp.emp_no || '').toLowerCase().includes(term));
  }, [employees, debouncedSearch]);

  const handleSearchSubmit = useCallback(() => {
    setSearchQuery(searchTerm.trim());
    setPage(1);
  }, [searchTerm]);

  const handleAutoFillNextCycle = useCallback(async () => {
    const [y, m] = month.split('-').map(Number);
    const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    const nextLabel = new Date(nextMonth + '-01').toLocaleString('default', { month: 'long', year: 'numeric' });
    if (!confirm(`This will fill the next pay cycle (${nextLabel}) from the previous cycle by weekday. Holidays in the target period will be set to HOL. Continue?`)) return;
    setAutoFillLoading(true);
    try {
      const res = await api.autoFillNextCycleRoster({
        targetMonth: nextMonth,
        departmentId: selectedDept || undefined,
        divisionId: selectedDivision || undefined,
      });
      const data = res?.data;
      if (res?.success && data) {
        toast.success(`${data.filled} entries filled; ${data.holidaysRespected} days as holiday.`);
        setMonth(nextMonth);
        setPage(1);
      } else {
        toast.error((res as any)?.message || 'Auto-fill failed');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Auto-fill failed');
    } finally {
      setAutoFillLoading(false);
    }
  }, [month, selectedDept, selectedDivision, selectedGroup, searchQuery]);

  return (
    <div className="relative min-h-screen">
      <div className="relative z-10 w-auto -mt-4 sm:-mt-5 lg:-mt-6 -mx-4 sm:-mx-5 lg:-mx-6 pb-6 space-y-0.5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200/60 bg-white/80 p-4 shadow-[0_2px_15px_rgba(0,0,0,0.02)] backdrop-blur-md dark:border-slate-800/60 dark:bg-slate-950/80 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400"><LayoutGrid size={18} /></div>
            <h1 className="text-lg font-black tracking-tight text-slate-900 dark:text-slate-50 uppercase">Shift Roster</h1>
          </div>
          <div className="flex flex-wrap items-center gap-4 lg:justify-end">
            <div className="flex flex-wrap items-center gap-y-2 gap-x-4">
              <div className="flex items-center gap-1.5 py-1 px-2.5 rounded-lg bg-orange-50/50 dark:bg-orange-950/20 border border-orange-100 dark:border-orange-900/40">
                <span className="h-2 w-2 rounded-full bg-orange-400"></span><span className="text-[9px] font-black uppercase text-orange-700 dark:text-orange-400">Week Off</span>
              </div>
              <div className="flex items-center gap-1.5 py-1 px-2.5 rounded-lg bg-red-50/50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/40">
                <span className="h-2 w-2 rounded-full bg-red-400"></span><span className="text-[9px] font-black uppercase text-red-700 dark:text-red-400">Holiday</span>
              </div>
              {shifts.slice(0, 6).map(s => (
                <div key={s._id} className="flex items-center gap-1.5 py-1 px-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/60">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color || '#3b82f6' }}></span>
                  <span className="text-[9px] font-black uppercase text-slate-600 dark:text-slate-400">{shiftLabel(s)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:px-6 py-3 bg-white/40 dark:bg-slate-950/20 border-b border-slate-200/40 dark:border-slate-800/40">
          <RosterFilters
            selectedDivision={selectedDivision} setSelectedDivision={setSelectedDivision} divisions={divisions}
            selectedDept={selectedDept} setSelectedDept={setSelectedDept} departments={departments}
            selectedGroup={selectedGroup} setSelectedGroup={setSelectedGroup} groups={employeeGroups}
            month={month} setMonth={setMonth} setPage={setPage}
            cycleDates={cycleDates}
          />

          <div className="w-full flex flex-col lg:flex-row lg:items-center gap-2.5">
            <div className="w-full lg:max-w-sm">
              <SearchSection value={searchTerm} onSearchChange={setSearchTerm} onSearchSubmit={handleSearchSubmit} />
            </div>

            <div className="w-full lg:w-auto grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button 
                onClick={handleAutoFillNextCycle} 
                disabled={autoFillLoading} 
                className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-amber-600 border border-amber-700 text-white text-[10px] font-black uppercase tracking-wider hover:bg-amber-700 transition-all shadow-md disabled:opacity-50" 
                title="Fill next pay cycle from previous (by weekday); holidays respected">
                <Copy size={13} />{autoFillLoading ? 'Filling...' : 'Auto-fill'}
              </button>
              <button onClick={handleExportExcel} className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-green-600 border border-green-700 text-white text-[10px] font-black uppercase tracking-wider hover:bg-green-700 transition-all shadow-md"><Download size={13} />Export</button>
              <button onClick={() => setShowWeekOff(true)} className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-white text-[10px] font-black uppercase tracking-wider transition-all shadow-md dark:bg-slate-800/80"><Settings2 size={13} />Assign Offs</button>
              <button onClick={saveRoster} disabled={saving} className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white text-[10px] font-black uppercase tracking-wider shadow-lg shadow-blue-500/20 disabled:opacity-50 transition-all"><Save size={14} />{saving ? `...${savingProgress}%` : 'Save'}</button>
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white/40 dark:bg-slate-950/20 border-b border-slate-200/40 dark:border-slate-800/40 sm:px-6 py-2">
          <div className="flex items-center gap-4">
            <div className="flex gap-1.5 p-1 rounded-xl bg-indigo-50/20 dark:bg-slate-900/30 border border-slate-200/60 dark:border-slate-800/60 backdrop-blur-sm">
              <button onClick={() => setActiveTab('roster')} className={`flex items-center gap-2 px-6 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${activeTab === 'roster' ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-900 dark:text-blue-400' : 'text-slate-500'}`}><LayoutGrid size={12} />Grid View</button>
              <button onClick={() => setActiveTab('assigned')} className={`flex items-center gap-2 px-6 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${activeTab === 'assigned' ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-900 dark:text-blue-400' : 'text-slate-500'}`}><CheckCircle2 size={12} />Assignments</button>
            </div>
          </div>
          <QuickAssignSection
            weekdays={weekdays} shiftAssignDays={shiftAssignDays} setShiftAssignDays={setShiftAssignDays}
            selectedShiftForAssign={selectedShiftForAssign} setSelectedShiftForAssign={setSelectedShiftForAssign}
            shifts={shifts} handleAssignAll={handleAssignAll} shiftLabel={shiftLabel}
          />
        </div>

        <div className="p-0 sm:p-2 lg:p-4">
          {activeTab === 'roster' ? (
            <RosterGrid
              loading={loading} filteredEmployees={filteredEmployees} totalEmployees={totalEmployees}
              page={page} setPage={setPage} totalPages={totalPages}
              limit={limit} setLimit={setLimit}
              days={days} weekdays={weekdays}
              roster={roster} holidayCache={holidayCache} shifts={shifts} updateCell={updateCell}
              applyEmployeeAllDays={applyEmployeeAllDays} globalHolidayDates={globalHolidayDates} shiftLabel={shiftLabel}
            />
          ) : (
            <AssignmentsView
              filteredAssignedSummary={filteredAssignedSummary} shifts={shifts} shiftLabel={shiftLabel}
            />
          )}
        </div>

        <WeekOffModal
          showWeekOff={showWeekOff} setShowWeekOff={setShowWeekOff} weekOffDays={weekOffDays}
          setWeekOffDays={setWeekOffDays} applyWeekOffs={applyWeekOffs} weekdays={weekdays}
        />
      </div>
    </div>
  );
}
