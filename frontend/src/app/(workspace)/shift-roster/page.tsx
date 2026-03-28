'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'react-hot-toast';
import { format, parseISO } from 'date-fns';

type Shift = { _id: string; name: string; code?: string; color?: string };
type Employee = { _id: string; employee_name?: string; emp_no: string; doj?: string; department?: { name: string; _id: string } };
type RosterCell = { shiftId?: string | null; status?: 'WO' | 'HOL' };
type RosterState = Map<string, Record<string, RosterCell>>;

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const ROSTER_PAGE_SIZE = 50;

type DepartmentOption = { _id: string; name: string };

function formatMonthInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatSimpleDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Helper to get array of date strings between two dates
function getDaysInRange(startDate: Date, endDate: Date) {
  const days: string[] = [];
  const current = new Date(startDate);
  // Reset time to avoid issues
  current.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  while (current <= end) {
    days.push(formatSimpleDate(current));
    current.setDate(current.getDate() + 1);
  }
  return days;
}

function navigateMonth(current: string, direction: 'prev' | 'next'): string {
  const [y, m] = current.split('-').map(Number);
  const d = new Date(y, m - 1 + (direction === 'next' ? 1 : -1), 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftLabel(shift?: Shift | null) {
  if (!shift) return '';
  if (shift.code) return shift.code;
  return shift.name || '';
}

function RosterPage() {
  const [month, setMonth] = useState(formatMonthInput(new Date()));
  const [strict, setStrict] = useState(false);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [divisions, setDivisions] = useState<DepartmentOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [selectedDivision, setSelectedDivision] = useState<string>('');
  const [selectedDept, setSelectedDept] = useState<string>('');
  const [employeeGroups, setEmployeeGroups] = useState<DepartmentOption[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedShiftForAssign, setSelectedShiftForAssign] = useState<string>('');
  const [roster, setRoster] = useState<RosterState>(new Map());
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingProgress, setSavingProgress] = useState<number | null>(null);
  const [autoFillLoading, setAutoFillLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'roster' | 'assigned'>('roster');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(ROSTER_PAGE_SIZE);
  const [totalPages, setTotalPages] = useState(1);
  const [totalEmployees, setTotalEmployees] = useState(0);

  // Payroll Cycle Config
  const [cycleStartDay, setCycleStartDay] = useState<number>(1);
  const [cycleDates, setCycleDates] = useState<{ startDate: string; endDate: string; label: string } | null>(null);
  const [alignedToCycle, setAlignedToCycle] = useState(false);

  const [showWeekOff, setShowWeekOff] = useState(false);
  const [weekOffDays, setWeekOffDays] = useState<Record<string, boolean>>(
    weekdays.reduce((acc, w) => ({ ...acc, [w]: false }), {})
  );

  // Fetch settings on mount
  useEffect(() => {
    api.getSetting('payroll_cycle_start_day').then((res) => {
      if (res.success && res.data) {
        setCycleStartDay(Number(res.data.value) || 1);
      }
    }).catch(err => console.error('Failed to load payroll cycle settings', err));
  }, []);

  // Once we know the cycle start day, align initial month so that the selected pay cycle contains today
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

  // Calculate cycle dates whenever month or cycleStartDay changes
  useEffect(() => {
    if (!month) return;
    const [y, m] = month.split('-').map(Number);

    // Standard cycle (1st to end of month)
    if (cycleStartDay === 1) {
      const end = new Date(y, m, 0);
      setCycleDates({
        startDate: formatSimpleDate(new Date(y, m - 1, 1)),
        endDate: formatSimpleDate(end),
        label: new Date(y, m - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' })
      });
    } else {
      // Custom cycle (e.g. 26th Prev to 25th Curr)
      const start = new Date(y, m - 2, cycleStartDay); // Previous month
      const end = new Date(y, m - 1, cycleStartDay - 1); // Current month, day before start

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

  const loadData = async () => {
    if (!cycleDates) return;

    try {
      setLoading(true);

      const filters: any = { page, limit };
      if (selectedDept) filters.department_id = selectedDept;
      if (selectedDivision) filters.division_id = selectedDivision;
      if (selectedGroup) filters.employee_group_id = selectedGroup;
      if (searchQuery) filters.search = searchQuery;
      if (cycleDates?.startDate && cycleDates?.endDate) {
        filters.startDate = cycleDates.startDate;
        filters.endDate = cycleDates.endDate;
      }

      const [shiftRes, empRes, rosterRes, divRes, deptRes, groupRes] = await Promise.all([
        api.getShifts().catch((err) => {
          console.error('Failed to load shifts:', err);
          return { data: [] };
        }),
        api.getEmployees(filters).catch((err) => {
          console.error('Failed to load employees:', err);
          return { data: [], pagination: { total: 0, totalPages: 0 } };
        }),
        api.getRoster(month, {
          departmentId: selectedDept || undefined,
          divisionId: selectedDivision || undefined,
          startDate: cycleDates.startDate,
          endDate: cycleDates.endDate
        }).catch((err) => {
          console.error('Failed to load roster:', err);
          return { data: { entries: [], strict: false } };
        }),
        api.getDivisions().catch((err) => {
          console.error('Failed to load divisions:', err);
          return { data: [] };
        }),
        api.getDepartments().catch((err) => {
          console.error('Failed to load departments:', err);
          return { data: [] };
        }),
        api.getEmployeeGroups(true).catch((err) => {
          console.error('Failed to load employee groups:', err);
          return { data: [] };
        }),
      ]);

      // Ensure arrays
      const shiftList = Array.isArray(shiftRes?.data) ? shiftRes.data : (Array.isArray(shiftRes) ? shiftRes : []);
      setShifts(shiftList);

      const empList = Array.isArray(empRes?.data) ? empRes.data : (Array.isArray(empRes) ? empRes : []);
      setEmployees(empList);
      const pagination = (empRes as any)?.pagination;
      setTotalPages(pagination?.totalPages ?? 1);
      setTotalEmployees(pagination?.total ?? empList.length);

      // Build division options
      const divList = Array.isArray(divRes?.data) ? divRes.data : (Array.isArray(divRes) ? divRes : []);
      setDivisions(divList.map((d: any) => ({ _id: d._id, name: d.name })));

      // Build department options (filter by division if selected)
      let deptList = Array.isArray(deptRes?.data) ? deptRes.data : (Array.isArray(deptRes) ? deptRes : []);
      if (selectedDivision) {
        deptList = deptList.filter((d: any) =>
          d.divisions?.some((div: any) => (typeof div === 'string' ? div : div._id) === selectedDivision)
        );
      }
      setDepartments(deptList.map((d: any) => ({ _id: d._id, name: d.name })));
      const groupList = Array.isArray(groupRes?.data) ? groupRes.data : [];
      setEmployeeGroups(groupList.map((g: any) => ({ _id: g._id, name: g.name })));

      const map: RosterState = new Map();
      const rosterData = rosterRes?.data as { entries?: { employeeNumber: string; date: string; shiftId?: string; status?: string }[]; strict?: boolean } | null;
      const entries = Array.isArray(rosterData?.entries) ? rosterData!.entries! : [];
      setStrict(Boolean(rosterData?.strict));

      entries.forEach((e: any) => {
        const emp = e.employeeNumber;
        if (!emp) return;
        if (!map.has(emp)) map.set(emp, {});
        const row = map.get(emp)!;
        // Backend now explicitly returns status: 'WO' or 'HOL'
        // Also handle legacy data where shiftId is null (fallback)
        const status = e.status || ((!e.shiftId && !e.shift) ? 'WO' : undefined);
        row[e.date] = {
          shiftId: e.shiftId || null,
          status: status as any
        };
      });

      setRoster(map);
      setDirtyKeys(new Set());
    } catch (err: any) {
      console.error('Error loading roster data:', err);
      toast.error(err.message || 'Failed to load roster');
      // Ensure arrays are set even on error
      setShifts([]);
      setEmployees([]);
      setDepartments([]);
      setRoster(new Map());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { setPage(1); }, [month, selectedDept, selectedDivision, selectedGroup, searchQuery]);
  useEffect(() => {
    loadData();
  }, [month, selectedDept, selectedDivision, selectedGroup, searchQuery, cycleDates, page, limit]);

  const updateCell = (empNo: string, date: string, value: RosterCell) => {
    // Check joining date (doj)
    const emp = employees.find(e => e.emp_no === empNo);
    if (emp?.doj) {
      const dojStr = format(parseISO(emp.doj), 'yyyy-MM-dd');
      if (date < dojStr) {
        toast.error(`Cannot assign shift before joining date (${dojStr}) for ${emp.employee_name || empNo}`);
        return;
      }
    }

    setRoster((prev) => {
      const map = new Map(prev);
      const row = { ...(map.get(empNo) || {}) };
      row[date] = value;
      map.set(empNo, row);
      return map;
    });
    setDirtyKeys((prev) => new Set(prev).add(`${empNo}|${date}`));
  };

  const applyAllEmployees = (shiftId: string | null, status?: 'WO') => {
    if (!Array.isArray(employees) || employees.length === 0) {
      toast.error('No employees available');
      return;
    }
    setRoster((prev) => {
      const map = new Map(prev);
      employees.forEach((emp) => {
        const dojStr = emp.doj ? format(parseISO(emp.doj), 'yyyy-MM-dd') : null;
        const row: Record<string, RosterCell> = { ...(map.get(emp.emp_no) || {}) };
        days.forEach((d) => {
          if (dojStr && d < dojStr) return;
          row[d] = { shiftId, status };
        });
        map.set(emp.emp_no, row);
      });
      return map;
    });
    setDirtyKeys((prev) => {
      const next = new Set(prev);
      employees.forEach((emp) => {
        const dojStr = emp.doj ? format(parseISO(emp.doj), 'yyyy-MM-dd') : null;
        days.forEach((d) => {
          if (dojStr && d < dojStr) return;
          next.add(`${emp.emp_no}|${d}`);
        });
      });
      return next;
    });
  };

  const applyEmployeeAllDays = (empNo: string, shiftId: string | null, status?: 'WO') => {
    const emp = employees.find(e => e.emp_no === empNo);
    const dojStr = emp?.doj ? format(parseISO(emp.doj), 'yyyy-MM-dd') : null;

    setRoster((prev) => {
      const map = new Map(prev);
      const row: Record<string, RosterCell> = { ...(map.get(empNo) || {}) };
      days.forEach((d) => {
        if (dojStr && d < dojStr) return;
        row[d] = { shiftId, status };
      });
      map.set(empNo, row);
      return map;
    });
    setDirtyKeys((prev) => {
      const next = new Set(prev);
      days.forEach((d) => {
        if (dojStr && d < dojStr) return;
        next.add(`${empNo}|${d}`);
      });
      return next;
    });
  };

  const saveRoster = async () => {
    try {
      setSaving(true);
      setSavingProgress(10);
      const entries: any[] = [];
      if (dirtyKeys.size > 0) {
        dirtyKeys.forEach((key) => {
          const [empNo, date] = key.split('|');
          const row = roster.get(empNo);
          if (!row) return;
          const cell = row[date];
          if (!cell) return;
          if (!cell.shiftId && cell.status !== 'WO' && cell.status !== 'HOL') return;
          const entry: any = { employeeNumber: empNo, date };
          if (cell.status === 'WO' || cell.status === 'HOL') {
            entry.shiftId = null;
            entry.status = cell.status;
          } else {
            if (!cell.shiftId) return;
            entry.shiftId = cell.shiftId;
          }
          entries.push(entry);
        });
      }
      if (entries.length === 0) {
        toast.success(dirtyKeys.size === 0 ? 'No changes to save' : 'No valid entries to save');
        setSaving(false);
        setSavingProgress(null);
        return;
      }
      setSavingProgress(30);
      const resp = await api.saveRoster({
        month,
        strict,
        entries,
        startDate: cycleDates?.startDate,
        endDate: cycleDates?.endDate
      });
      setSavingProgress(90);
      if (resp?.success) {
        setDirtyKeys(new Set());
        toast.success(`Roster saved: ${entries.length} entries updated`);
        await loadData();
      } else {
        const errorMsg = resp?.message || resp?.error || 'Failed to save roster';
        toast.error(errorMsg);
        console.error('Save roster error:', resp);
      }
    } catch (err: any) {
      console.error('Save roster exception:', err);
      toast.error(err.message || err.response?.data?.message || 'Failed to save roster');
    } finally {
      setSaving(false);
      setSavingProgress(null);
    }
  };

  const applyWeekOffs = () => {
    const activeDays = Object.entries(weekOffDays)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (activeDays.length === 0) {
      toast.error('Select at least one weekday');
      return;
    }
    if (!Array.isArray(employees) || employees.length === 0) {
      toast.error('No employees available');
      return;
    }
    const activeDates = days.filter((d) => activeDays.includes(weekdays[new Date(d).getDay()]));
    setRoster((prev) => {
      const map = new Map(prev);
      employees.forEach((emp) => {
        const dojStr = emp.doj ? format(parseISO(emp.doj), 'yyyy-MM-dd') : null;
        const row: Record<string, RosterCell> = { ...(map.get(emp.emp_no) || {}) };
        days.forEach((d) => {
          if (dojStr && d < dojStr) return;
          const dow = weekdays[new Date(d).getDay()];
          if (activeDays.includes(dow)) {
            row[d] = { shiftId: null, status: 'WO' };
          }
        });
        map.set(emp.emp_no, row);
      });
      return map;
    });
    setDirtyKeys((prev) => {
      const next = new Set(prev);
      employees.forEach((emp) => {
        const dojStr = emp.doj ? format(parseISO(emp.doj), 'yyyy-MM-dd') : null;
        activeDates.forEach((d) => {
          if (dojStr && d < dojStr) return;
          next.add(`${emp.emp_no}|${d}`);
        });
      });
      return next;
    });
    setShowWeekOff(false);
    toast.success('Weekly offs applied');
  };

  const handleAutoFillNextCycle = async () => {
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
      const data = (res as any)?.data;
      if ((res as any)?.success && data) {
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
  };

  const handleAssignAll = () => {
    if (!selectedShiftForAssign) {
      toast.error('Please select a shift first');
      return;
    }
    applyAllEmployees(selectedShiftForAssign);
    toast.success(`Assigned ${shiftLabel(shifts.find((s) => s._id === selectedShiftForAssign))} to all employees`);
  };

  // Calculate assigned shifts summary
  const assignedShiftsSummary = useMemo(() => {
    const summary: Array<{
      employee: Employee;
      shifts: Array<{ shiftId: string | null; shiftLabel: string; days: number; dates: string[] }>;
      totalDays: number;
      weekOffs: number;
    }> = [];

    // Ensure employees is an array
    if (!Array.isArray(employees)) {
      return [];
    }

    employees.forEach((emp) => {
      const row = roster.get(emp.emp_no) || {};
      const shiftMap = new Map<string | null, { label: string; dates: string[] }>();

      Object.entries(row).forEach(([date, cell]) => {
        // Check for non-working status: either status exists or shiftId is null (default WO)
        const isNonWorking = cell?.status === 'WO' || cell?.status === 'HOL';
        const shiftId = isNonWorking ? cell?.status : (cell?.shiftId || null);
        const label = cell?.status === 'WO' ? 'Week Off' : (cell?.status === 'HOL' ? 'Holiday' : (shiftId ? shiftLabel(shifts.find((s) => s._id === shiftId)) : 'Unassigned'));

        // Use a consistent key for grouping
        const mapKey = (isNonWorking ? cell?.status : shiftId) ?? null;

        if (!shiftMap.has(mapKey)) {
          shiftMap.set(mapKey, { label, dates: [] });
        }
        shiftMap.get(mapKey)!.dates.push(date);
      });

      // Include employees even if they only have week offs
      if (shiftMap.size > 0) {
        const shiftsList = Array.from(shiftMap.entries())
          .map(([shiftId, data]) => ({
            shiftId,
            shiftLabel: data.label,
            days: data.dates.length,
            dates: data.dates.sort(),
          }))
          // Sort to show week offs first, then other shifts
          .sort((a, b) => {
            if (a.shiftId === 'WO') return -1;
            if (a.shiftId === 'HOL') return -1;
            if (b.shiftId === 'WO') return 1;
            if (b.shiftId === 'HOL') return 1;
            return 0;
          });

        const totalDays = shiftsList.reduce((sum, s) => sum + s.days, 0);
        const weekOffs = shiftsList.find((s) => s.shiftId === 'WO')?.days || 0;
        summary.push({ employee: emp, shifts: shiftsList, totalDays, weekOffs });
      }
    });

    return summary.sort((a, b) => (a.employee.employee_name || a.employee.emp_no).localeCompare(b.employee.employee_name || b.employee.emp_no));
  }, [employees, roster, shifts]);

  const isInitialLoad = loading && employees.length === 0;

  const handleSearch = () => {
    setSearchQuery(searchTerm.trim());
    setPage(1);
  };

  if (isInitialLoad) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4" />
        <p className="text-slate-600 dark:text-slate-300 font-medium">Loading roster data...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-4 dark:bg-green-950/20">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Shift Roster</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Assign shifts for the selected month</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 bg-white/50 dark:bg-slate-800/30 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 backdrop-blur-sm">
            <span className="text-[11px] font-bold text-slate-900 dark:text-slate-700 uppercase tracking-wider mr-1">Shifts:</span>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full border border-orange-200 bg-orange-100 shadow-sm"></div>
              <span className="text-xs text-slate-600 dark:text-slate-700">WO</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full border border-red-200 bg-red-100 shadow-sm"></div>
              <span className="text-xs text-slate-600 dark:text-slate-700">HOL</span>
            </div>
            {shifts.map(shift => (
              <div key={shift._id} className="flex items-center gap-1.5">
                <div
                  className="w-2.5 h-2.5 rounded-full shadow-sm"
                  style={{ backgroundColor: shift.color || '#3b82f6' }}
                ></div>
                <span className="text-xs text-slate-600 dark:text-slate-400">{shiftLabel(shift)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-nowrap items-center gap-10 px-3 py-1.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-all hover:shadow-md overflow-x-auto scrollbar-hide">
          <div className="flex items-center gap-1.5">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">Search:</label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSearch();
                }
              }}
              placeholder="Name / Emp No"
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950 dark:text-white min-w-[140px] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
            />
            <button
              type="button"
              onClick={handleSearch}
              className="px-2.5 py-1 rounded-lg bg-blue-600 text-white text-[10px] font-bold uppercase tracking-wider hover:bg-blue-700 transition-all shadow-sm"
            >
              Search
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">Division:</label>
            <select
              value={selectedDivision}
              onChange={(e) => {
                setSelectedDivision(e.target.value);
                setSelectedDept(''); // Reset department when division changes
              }}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950 dark:text-white min-w-[110px] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
            >
              <option value="">All Divisions</option>
              {divisions.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">Department:</label>
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950 dark:text-white min-w-[110px] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">Group:</label>
            <select
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950 dark:text-white min-w-[110px] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
            >
              <option value="">All groups</option>
              {employeeGroups.map((g) => (
                <option key={g._id} value={g._id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          {/* Month Navigator: Prev / Cycle Label / Next */}
          <div className="flex items-center gap-0 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
            <button
              onClick={() => setMonth(navigateMonth(month, 'prev'))}
              className="flex items-center justify-center w-7 h-7 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors border-r border-slate-200 dark:border-slate-700"
              title="Previous month"
            >
              <ChevronLeft size={14} />
            </button>
            <div className="px-3 py-1 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap min-w-[140px] text-center">
              {cycleDates ? cycleDates.label : month}
            </div>
            <button
              onClick={() => setMonth(navigateMonth(month, 'next'))}
              className="flex items-center justify-center w-7 h-7 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors border-l border-slate-200 dark:border-slate-700"
              title="Next month"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <input
              type="checkbox"
              id="strict-mode"
              checked={strict}
              onChange={(e) => setStrict(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500/20 transition-all cursor-pointer"
            />
            <label htmlFor="strict-mode" className="text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer select-none">
              Strict
            </label>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">Shift:</label>
              <select
                value={selectedShiftForAssign}
                onChange={(e) => setSelectedShiftForAssign(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950 dark:text-white min-w-[100px] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
              >
                <option value="">Select shift</option>
                {shifts.map((s) => (
                  <option key={s._id} value={s._id}>
                    {shiftLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleAssignAll}
              disabled={!selectedShiftForAssign}
              className="px-3 py-1 rounded-lg bg-blue-600 text-white text-[10px] font-bold uppercase tracking-wider hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md active:scale-95 whitespace-nowrap"
            >
              Assign All
            </button>
            <button
              onClick={() => setShowWeekOff(true)}
              className="px-3 py-1 rounded-lg bg-slate-800 text-white text-[10px] font-bold uppercase tracking-wider hover:bg-slate-900 dark:bg-indigo-600 dark:hover:bg-indigo-700 transition-all shadow-sm hover:shadow-md active:scale-95 whitespace-nowrap"
            >
              Weekly Offs
            </button>
          </div>
        </div>
      </div>



      {/* Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-700">
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab('roster')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === 'roster'
              ? 'text-blue-600 border-b-2 border-blue-600 dark:text-blue-400 dark:border-blue-400'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
          >
            Roster View
          </button>
          <button
            onClick={() => setActiveTab('assigned')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === 'assigned'
              ? 'text-blue-600 border-b-2 border-blue-600 dark:text-blue-400 dark:border-blue-400'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
          >
            Assigned Shifts
          </button>
        </div>
      </div>

      {/* Roster View */}
      {activeTab === 'roster' && (
        <div className={`relative border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-xl transition-opacity duration-300 ${loading ? 'opacity-70' : 'opacity-100'}`}>
          {loading && (
            <div className="absolute inset-0 z-40 bg-white/10 dark:bg-slate-900/10 backdrop-blur-[1px] flex items-center justify-center">
              <div className="bg-white/80 dark:bg-slate-800/80 px-4 py-2 rounded-full shadow-lg border border-slate-200 dark:border-slate-700 flex items-center gap-3">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Updating...</span>
              </div>
            </div>
          )}
          {/* Pagination: only render many rows per page to avoid browser freeze */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-50/80 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-600 dark:text-slate-400">
                Showing <strong>{employees.length}</strong> of <strong>{totalEmployees}</strong> employees
              </span>
              <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                Per page:
                <select
                  value={limit}
                  onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
                  className="rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="p-1.5 rounded border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 disabled:pointer-events-none"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="p-1.5 rounded border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 disabled:pointer-events-none"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-slate-50/80 dark:bg-slate-800/80 sticky top-0 z-20 backdrop-blur-sm shadow-sm">
                <tr>
                  <th className="px-4 py-2 text-left w-16 sticky left-0 z-30 bg-slate-50 dark:bg-slate-800 font-semibold text-slate-700 dark:text-slate-200 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.05)] border-b border-r border-black dark:border-slate-500">
                    Employee
                  </th>
                  {days.map((d) => {
                    const date = new Date(d);
                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                    return (
                      <th
                        key={d}
                        className={`w-6 px-0.5 py-2 text-center text-[10px] border-b border-r border-black dark:border-slate-500 ${isWeekend ? 'bg-slate-100/50 dark:bg-slate-800' : ''
                          }`}
                      >
                        <div className="font-semibold text-slate-700 dark:text-slate-300">{date.getDate()}</div>
                        <div className="text-[9px] text-slate-400 font-normal uppercase">{weekdays[date.getDay()].slice(0, 2)}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => {
                  const row = roster.get(emp.emp_no) || {};
                  return (
                    <tr key={emp._id} className="group border-b border-slate-300 dark:border-slate-700/30 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-2 py-2 sticky left-0 z-10 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/50 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.05)] border-r border-black dark:border-slate-500">
                        <div className="flex flex-col gap-1.5">
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-white truncate max-w-[7rem] text-xs">{emp.employee_name || emp.emp_no}</div>
                            <div className="text-[10px] text-slate-500 flex items-center gap-1.5">
                              <span>{emp.emp_no}</span>
                              {emp.department && <span className="px-1 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[9px] truncate max-w-[4rem]">{emp.department.name}</span>}
                            </div>
                          </div>
                          <select
                            className="w-24 text-[9px] rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 py-1 cursor-pointer hover:border-blue-400 transition-colors focus:ring-1 focus:ring-blue-500 focus:outline-none"
                            onChange={(e) => applyEmployeeAllDays(emp.emp_no, e.target.value || null, e.target.value === 'WO' ? 'WO' : undefined)}
                            defaultValue=""
                          >
                            <option value="">Apply to all days...</option>
                            <option value="WO">Set Week Off</option>
                            <option value="HOL">Set Holiday</option>
                            {shifts.map((s) => (
                              <option key={s._id} value={s._id}>
                                Set {shiftLabel(s)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      {days.map((d) => {
                        const cell = row[d];
                        const current = cell?.status || cell?.shiftId || '';
                        const isWeekend = new Date(d).getDay() === 0 || new Date(d).getDay() === 6;
                        const dojStr = emp.doj ? format(parseISO(emp.doj), 'yyyy-MM-dd') : null;
                        const isBeforeJoining = dojStr && d < dojStr;
                        return (
                          <td
                            key={d}
                            className={`p-0.5 text-center relative h-10 border-r border-black dark:border-slate-500 last:border-r-0 ${isWeekend ? 'bg-slate-50/50 dark:bg-slate-800/30' : ''
                              } ${isBeforeJoining ? 'bg-slate-200/50 dark:bg-slate-900/40 cursor-not-allowed opacity-50' : ''}`}
                            title={isBeforeJoining ? `Pre-joining period (Joined: ${format(parseISO(emp.doj!), 'dd-MMM-yyyy')})` : undefined}
                            style={
                              !isBeforeJoining && current && current !== 'WO' && current !== 'HOL'
                                ? { backgroundColor: `${shifts.find(s => s._id === current)?.color || '#3b82f6'}30` }
                                : current === 'WO' ? { backgroundColor: '#ffedd5' } : current === 'HOL' ? { backgroundColor: '#fee2e2' } : {}
                            }
                          >
                            <div className={isBeforeJoining ? 'pointer-events-none' : ''}>
                              <select
                                value={current}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === 'WO' || val === 'HOL') {
                                    updateCell(emp.emp_no, d, { shiftId: null, status: val as any });
                                  } else {
                                    updateCell(emp.emp_no, d, { shiftId: val || null, status: undefined });
                                  }
                                }}
                                className="w-full h-full text-[10px] font-medium rounded bg-transparent px-1 py-1 focus:ring-0 focus:outline-none appearance-none text-center cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                                style={{
                                  color: current === 'WO' ? '#c2410c' : (current === 'HOL' ? '#b91c1c' : 'inherit'),
                                }}
                              >
                                <option value="">-</option>
                                <option value="WO">WO</option>
                                <option value="HOL">HOL</option>
                                {shifts.map((s) => (
                                  <option key={s._id} value={s._id} style={{ color: s.color }}>
                                    {shiftLabel(s)}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Custom downward arrow for cleaner look, hidden if empty to look like a clean cell */}
                            {
                              !current && (
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-20">
                                  <div className="w-1 h-1 rounded-full bg-slate-400"></div>
                                </div>
                              )
                            }
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )
      }

      {/* Assigned Shifts View */}
      {
        activeTab === 'assigned' && (
          <div className="space-y-4">
            {assignedShiftsSummary.length === 0 ? (
              <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                <p className="text-lg font-medium mb-2">No shifts assigned</p>
                <p className="text-sm">Switch to Roster View to assign shifts to employees</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {assignedShiftsSummary.map((item) => (
                  <div
                    key={item.employee._id}
                    className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-white dark:bg-slate-800 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-semibold text-slate-900 dark:text-white text-lg">
                          {item.employee.employee_name || item.employee.emp_no}
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400">{item.employee.emp_no}</p>
                        {item.employee.department && (
                          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{item.employee.department.name}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-right">
                        <div>
                          <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Week Offs</div>
                          <div className={`text-lg font-bold ${item.weekOffs > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-slate-400 dark:text-slate-500'}`}>
                            {item.weekOffs}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Total Days</div>
                          <div className="text-lg font-bold text-blue-600 dark:text-blue-400">{item.totalDays}</div>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {item.shifts.map((shift, idx) => {
                        const originalShift = shifts.find(s => s._id === shift.shiftId);
                        const shiftColor = originalShift?.color || '#3b82f6';

                        return (
                          <div
                            key={idx}
                            className={`p-3 rounded-lg border ${shift.shiftId === 'WO'
                              ? 'bg-orange-50 border-orange-200 dark:bg-orange-900/20 dark:border-orange-800'
                              : 'bg-white border-slate-200 dark:bg-slate-800 dark:border-slate-700'
                              }`}
                            style={shift.shiftId !== 'WO' ? {
                              borderLeftWidth: '4px',
                              borderLeftColor: shiftColor,
                              backgroundColor: `${shiftColor}10`
                            } : {}}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span
                                className={`font-semibold text-sm ${shift.shiftId === 'WO' ? 'text-orange-700 dark:text-orange-300' : ''}`}
                                style={shift.shiftId !== 'WO' ? { color: shiftColor } : {}}
                              >
                                {shift.shiftLabel}
                              </span>
                              <span className={`text-xs font-medium px-2 py-0.5 rounded ${shift.shiftId === 'WO'
                                ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300'
                                : shift.shiftId === 'HOL'
                                  ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                                  : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                                }`}>
                                {shift.days} {shift.days === 1 ? 'day' : 'days'}
                              </span>
                            </div>
                            <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                              <div className="font-medium">Dates:</div>
                              <div className="flex flex-wrap gap-1">
                                {shift.dates.slice(0, 5).map((d) => (
                                  <span key={d} className="px-1.5 py-0.5 bg-white dark:bg-slate-700 rounded text-xs">
                                    {new Date(d).getDate()}
                                  </span>
                                ))}
                                {shift.dates.length > 5 && (
                                  <span className="px-1.5 py-0.5 bg-white dark:bg-slate-700 rounded text-xs">
                                    +{shift.dates.length - 5} more
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      }

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Employees: {totalEmployees} total (showing {employees.length} on this page) | Days: {days.length}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAutoFillNextCycle}
            disabled={autoFillLoading}
            className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold disabled:opacity-60 flex items-center gap-1.5"
            title="Fill next pay cycle from previous (by weekday); holidays respected"
          >
            <Copy size={14} />{autoFillLoading ? 'Filling...' : 'Auto-fill next cycle'}
          </button>
          <button
            onClick={saveRoster}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save roster'}
          </button>
        </div>
      </div>
      {
        saving && (
          <div className="h-1 w-full rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: `${savingProgress ?? 50}%` }}
            />
          </div>
        )
      }

      {
        showWeekOff && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
            <div className="bg-white dark:bg-slate-800 rounded-xl p-4 w-full max-w-md space-y-4">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Assign Weekly Offs</h3>
              <div className="grid grid-cols-2 gap-2">
                {weekdays.map((w) => (
                  <label key={w} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={weekOffDays[w]}
                      onChange={(e) => setWeekOffDays((prev) => ({ ...prev, [w]: e.target.checked }))}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    {w}
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowWeekOff(false)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm">
                  Cancel
                </button>
                <button onClick={applyWeekOffs} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold">
                  Apply
                </button>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
}

export default RosterPage;

