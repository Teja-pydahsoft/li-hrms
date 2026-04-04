'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api, Department, Division, Designation } from '@/lib/api';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Search,
  Download,
  AlertCircle,
  RefreshCw,
  Loader2,
  X,
} from 'lucide-react';

const ROWS_PER_PAGE_ALL = -1;
const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100, 250, 500, ROWS_PER_PAGE_ALL] as const;

const SEARCH_DEBOUNCE_MS = 350;

function formatCell(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toLocaleString('en-IN');
    return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return String(value);
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export type PaysheetLayout = 'workspace' | 'superadmin';

export default function PaysheetPageContent({ layout = 'workspace' }: { layout?: PaysheetLayout }) {
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedDivision, setSelectedDivision] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedDesignation, setSelectedDesignation] = useState('');
  const [customEmployeeGroupingEnabled, setCustomEmployeeGroupingEnabled] = useState(false);
  const [employeeGroups, setEmployeeGroups] = useState<{ _id: string; name: string; isActive?: boolean }[]>([]);
  const [selectedEmployeeGroup, setSelectedEmployeeGroup] = useState('');
  const [employmentStatus, setEmploymentStatus] = useState<'active' | 'inactive' | ''>('');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [dataSource, setDataSource] = useState<'existing' | 'calculated' | null>(null);
  const [paysheetKind, setPaysheetKind] = useState<'regular' | 'second_salary'>('regular');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(100);
  const [exportingBundle, setExportingBundle] = useState(false);

  const totalRows = rows.length;
  const effectivePerPage = rowsPerPage === ROWS_PER_PAGE_ALL ? Math.max(totalRows, 1) : rowsPerPage;
  const totalPages = rowsPerPage === ROWS_PER_PAGE_ALL ? 1 : Math.max(1, Math.ceil(totalRows / effectivePerPage));
  const startRow = rowsPerPage === ROWS_PER_PAGE_ALL ? 0 : (page - 1) * effectivePerPage;
  const endRow = Math.min(startRow + effectivePerPage, totalRows);
  const paginatedRows = useMemo(
    () => rows.slice(startRow, endRow),
    [rows, startRow, endRow]
  );

  const isRefetching = loadingExisting && (headers.length > 0 || rows.length > 0);
  const isInitialLoading =
    !selectedMonth || (loadingExisting && headers.length === 0 && rows.length === 0);
  const isEmpty = !loadingExisting && headers.length === 0 && rows.length === 0;
  const hasData = headers.length > 0 && rows.length > 0;

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (selectedDivision) n++;
    if (selectedDepartment) n++;
    if (selectedDesignation) n++;
    if (employmentStatus) n++;
    if (debouncedSearch.trim()) n++;
    if (selectedEmployeeGroup) n++;
    return n;
  }, [selectedDivision, selectedDepartment, selectedDesignation, employmentStatus, debouncedSearch, selectedEmployeeGroup]);

  useEffect(() => {
    setPage(1);
  }, [rows.length, rowsPerPage, selectedMonth, selectedDepartment, selectedDivision, selectedDesignation, debouncedSearch, paysheetKind, employmentStatus, selectedEmployeeGroup]);

  const loadEmployeeGroupingConfig = useCallback(async () => {
    try {
      const res = await api.getSetting('custom_employee_grouping_enabled');
      const on = !!(res?.success && res?.data != null && res.data.value);
      setCustomEmployeeGroupingEnabled(on);
      if (!on) {
        setEmployeeGroups([]);
        setSelectedEmployeeGroup('');
        return;
      }
      const g = await api.getEmployeeGroups(true);
      if (g.success && Array.isArray(g.data)) setEmployeeGroups(g.data);
      else setEmployeeGroups([]);
    } catch {
      setCustomEmployeeGroupingEnabled(false);
      setEmployeeGroups([]);
      setSelectedEmployeeGroup('');
    }
  }, []);

  useEffect(() => {
    loadEmployeeGroupingConfig();
  }, [loadEmployeeGroupingConfig]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getPaysheetDefaultMonth();
        const m = res?.data?.month;
        if (!cancelled && m && /^\d{4}-\d{2}$/.test(m)) {
          setSelectedMonth(m);
          return;
        }
      } catch {
        /* fallback below */
      }
      if (cancelled) return;
      const today = new Date();
      const fallback =
        today.getDate() > 15
          ? today.toISOString().slice(0, 7)
          : new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 7);
      setSelectedMonth(fallback);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadDivisions = useCallback(async () => {
    try {
      const res = await api.getDivisions().catch(() => ({ data: [] }));
      setDivisions(Array.isArray(res?.data) ? res.data : []);
    } catch {
      setDivisions([]);
    }
  }, []);

  const loadDepartments = useCallback(async (divisionId?: string) => {
    try {
      const res = await api.getDepartments(undefined, divisionId || undefined).catch(() => ({ data: [] }));
      setDepartments(Array.isArray(res?.data) ? res.data : []);
    } catch {
      setDepartments([]);
    }
  }, []);

  const loadDesignations = useCallback(async (departmentId?: string) => {
    if (!departmentId) {
      setDesignations([]);
      return;
    }
    try {
      const res = await api.getDesignations(departmentId).catch(() => ({ data: [] }));
      setDesignations(Array.isArray(res?.data) ? res.data : []);
    } catch {
      setDesignations([]);
    }
  }, []);

  useEffect(() => {
    loadDivisions();
    loadDepartments();
  }, [loadDivisions, loadDepartments]);

  useEffect(() => {
    if (selectedDivision) loadDepartments(selectedDivision);
    else loadDepartments();
    setSelectedDepartment('');
    setSelectedDesignation('');
  }, [selectedDivision, loadDepartments]);

  useEffect(() => {
    if (selectedDepartment) loadDesignations(selectedDepartment);
    else {
      setDesignations([]);
      setSelectedDesignation('');
    }
  }, [selectedDepartment, loadDesignations]);

  const loadExisting = useCallback(async () => {
    if (!selectedMonth) return;
    setLoadingExisting(true);
    try {
      const res = await api.getPaysheetData({
        month: selectedMonth,
        departmentId: selectedDepartment || undefined,
        divisionId: selectedDivision || undefined,
        designationId: selectedDesignation || undefined,
        employee_group_id: selectedEmployeeGroup || undefined,
        status: employmentStatus || undefined,
        search: debouncedSearch || undefined,
        source: 'existing',
        secondSalary: paysheetKind === 'second_salary',
      });
      if (res?.success && res?.data) {
        setHeaders(res.data.headers || []);
        setRows(res.data.rows || []);
        setDataSource(res.source === 'existing' ? 'existing' : null);
        if ((res.data.rows?.length ?? 0) === 0 && res.message) {
          toast.info(res.message);
        }
      } else {
        setHeaders([]);
        setRows([]);
        setDataSource(null);
      }
    } catch {
      setHeaders([]);
      setRows([]);
      setDataSource(null);
    } finally {
      setLoadingExisting(false);
    }
  }, [
    selectedMonth,
    selectedDepartment,
    selectedDivision,
    selectedDesignation,
    debouncedSearch,
    paysheetKind,
    employmentStatus,
    selectedEmployeeGroup,
  ]);

  useEffect(() => {
    if (!selectedMonth) return;
    loadExisting();
  }, [loadExisting, selectedMonth]);

  const exportPaysheetBundle = async () => {
    if (!selectedMonth) {
      toast.warning('Please select a month');
      return;
    }
    setExportingBundle(true);
    try {
      const blob = await api.exportPaysheetBundleExcel({
        month: selectedMonth,
        departmentId: selectedDepartment || undefined,
        divisionId: selectedDivision || undefined,
        designationId: selectedDesignation || undefined,
        employee_group_id: selectedEmployeeGroup || undefined,
        status: employmentStatus || undefined,
        search: debouncedSearch || undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `paysheet_bundle_${selectedMonth}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Downloaded paysheet bundle (Regular, 2nd salary, Comparison)');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Export failed';
      toast.error(msg);
    } finally {
      setExportingBundle(false);
    }
  };

  const scrollTableHorizontally = (direction: 'left' | 'right') => {
    if (!tableScrollRef.current) return;
    const amount = Math.max(280, Math.floor(tableScrollRef.current.clientWidth * 0.6));
    tableScrollRef.current.scrollBy({
      left: direction === 'left' ? -amount : amount,
      behavior: 'smooth',
    });
  };

  const clearFilters = () => {
    setSelectedDivision('');
    setSelectedDepartment('');
    setSelectedDesignation('');
    setEmploymentStatus('');
    setSelectedEmployeeGroup('');
    setSearchInput('');
    setDebouncedSearch('');
  };

  const paginationBar = (edge: 'top' | 'bottom') =>
    totalRows > 0 ? (
      <div
        className={`flex-shrink-0 flex flex-col sm:flex-row items-center justify-between gap-3 py-2 border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/30 ${
          edge === 'top' ? 'border-b' : 'border-t'
        }`}
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Showing{' '}
          <span className="font-semibold text-slate-900 dark:text-slate-100">{startRow + 1}</span>
          {'–'}
          <span className="font-semibold text-slate-900 dark:text-slate-100">{endRow}</span>
          {' of '}
          <span className="font-semibold text-slate-900 dark:text-slate-100">{totalRows}</span>
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <span>Rows per page</span>
            <select
              value={rowsPerPage}
              onChange={(e) => setRowsPerPage(Number(e.target.value))}
              className="h-8 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 pl-2 pr-8 text-sm text-slate-700 dark:text-slate-300 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15 outline-none"
            >
              {ROWS_PER_PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n === ROWS_PER_PAGE_ALL ? 'All rows' : n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 disabled:opacity-40 disabled:pointer-events-none hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[100px] text-center text-sm text-slate-600 dark:text-slate-400 tabular-nums">
              Page <span className="font-semibold text-slate-900 dark:text-slate-100">{page}</span> /{' '}
              <span className="font-semibold text-slate-900 dark:text-slate-100">{totalPages}</span>
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 disabled:opacity-40 disabled:pointer-events-none hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    ) : null;

  const inner = (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 shrink-0">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 min-w-0 flex-1">
            <div className="flex flex-col min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                Paysheet
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
                {paysheetKind === 'second_salary'
                  ? 'Saved 2nd salary by month. Columns follow Payroll Configuration when set.'
                  : 'Payroll snapshots by month. Columns follow Payroll Configuration.'}
              </p>
            </div>
            <div className="hidden sm:block h-10 w-px shrink-0 bg-slate-200 dark:bg-slate-700" />
            <div className="flex items-center gap-2 shrink-0">
              {showSearch ? (
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      autoFocus
                      type="text"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="Name or employee no."
                      className="h-9 w-[min(100vw-8rem,220px)] sm:w-56 pl-9 pr-3 text-sm rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15 outline-none transition-all"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSearch(false);
                      setSearchInput('');
                    }}
                    className="h-9 w-9 inline-flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                    aria-label="Close search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowSearch(true)}
                  className="h-9 w-9 inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-500 hover:text-violet-600 hover:border-violet-200 hover:bg-violet-50/50 dark:hover:bg-violet-950/20 shadow-sm transition-all"
                  title="Search"
                >
                  <Search className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 justify-start lg:justify-end">
            <div className="flex items-center gap-0.5 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
              <button
                type="button"
                onClick={() => setSelectedMonth((m) => shiftMonth(m, -1))}
                disabled={!selectedMonth}
                className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="h-9 min-w-[10.5rem] max-w-[12rem] shrink-0 border-0 bg-transparent px-1 text-center text-sm font-semibold text-slate-800 dark:text-slate-100 focus:ring-0 focus:outline-none cursor-pointer [color-scheme:light] dark:[color-scheme:dark]"
                aria-label="Payroll month"
              />
              <button
                type="button"
                onClick={() => setSelectedMonth((m) => shiftMonth(m, 1))}
                disabled={!selectedMonth}
                className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3">
          <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-slate-100/60 dark:bg-slate-800/50 rounded-xl border border-slate-200/70 dark:border-slate-700/60 backdrop-blur-sm">
            <select
              value={selectedDivision}
              onChange={(e) => setSelectedDivision(e.target.value)}
              className="h-8 pl-2 pr-7 text-[11px] font-semibold bg-white dark:bg-slate-800 border-0 rounded-lg focus:ring-2 focus:ring-violet-500/20 text-slate-700 dark:text-slate-300 shadow-sm min-w-[108px] max-w-[170px] cursor-pointer"
            >
              <option value="">All divisions</option>
              {divisions.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name}
                </option>
              ))}
            </select>
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className="h-8 pl-2 pr-7 text-[11px] font-semibold bg-white dark:bg-slate-800 border-0 rounded-lg focus:ring-2 focus:ring-violet-500/20 text-slate-700 dark:text-slate-300 shadow-sm min-w-[108px] max-w-[170px] cursor-pointer"
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name}
                </option>
              ))}
            </select>
            {selectedDepartment ? (
              <select
                value={selectedDesignation}
                onChange={(e) => setSelectedDesignation(e.target.value)}
                className="h-8 pl-2 pr-7 text-[11px] font-semibold bg-white dark:bg-slate-800 border-0 rounded-lg focus:ring-2 focus:ring-violet-500/20 text-slate-700 dark:text-slate-300 shadow-sm min-w-[108px] max-w-[170px] cursor-pointer"
              >
                <option value="">All designations</option>
                {designations.map((d) => (
                  <option key={d._id} value={d._id}>
                    {d.name}
                  </option>
                ))}
              </select>
            ) : null}
            {customEmployeeGroupingEnabled && (
              <select
                value={selectedEmployeeGroup}
                onChange={(e) => setSelectedEmployeeGroup(e.target.value)}
                className="h-8 pl-2 pr-7 text-[11px] font-semibold bg-white dark:bg-slate-800 border-0 rounded-lg focus:ring-2 focus:ring-violet-500/20 text-slate-700 dark:text-slate-300 shadow-sm min-w-[108px] max-w-[170px] cursor-pointer"
              >
                <option value="">All groups</option>
                {employeeGroups
                  .filter((g) => g.isActive !== false)
                  .map((g) => (
                    <option key={g._id} value={g._id}>
                      {g.name}
                    </option>
                  ))}
              </select>
            )}
            <select
              value={employmentStatus}
              onChange={(e) => setEmploymentStatus((e.target.value as 'active' | 'inactive' | '') || '')}
              className="h-8 pl-2 pr-7 text-[11px] font-semibold bg-white dark:bg-slate-800 border-0 rounded-lg focus:ring-2 focus:ring-violet-500/20 text-slate-700 dark:text-slate-300 shadow-sm min-w-[108px] max-w-[150px] cursor-pointer"
            >
              <option value="">All employees</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
            <div className="flex h-8 items-center rounded-lg border border-slate-200/80 dark:border-slate-600/80 bg-violet-50/80 dark:bg-violet-950/30 p-0.5">
              <button
                type="button"
                onClick={() => setPaysheetKind('regular')}
                className={`h-7 px-2.5 rounded-md text-[11px] font-bold transition-colors ${
                  paysheetKind === 'regular'
                    ? 'bg-white text-violet-800 shadow-sm dark:bg-slate-900 dark:text-violet-200'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Regular
              </button>
              <button
                type="button"
                onClick={() => setPaysheetKind('second_salary')}
                className={`h-7 px-2 rounded-md text-[11px] font-bold transition-colors ${
                  paysheetKind === 'second_salary'
                    ? 'bg-white text-violet-800 shadow-sm dark:bg-slate-900 dark:text-violet-200'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                2nd salary
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="h-8 px-2.5 text-[11px] font-semibold rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                Clear filters ({activeFilterCount})
              </button>
            )}
            {loadingExisting && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-600 dark:text-violet-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                Updating…
              </span>
            )}
            <button
              type="button"
              onClick={() => loadExisting()}
              disabled={loadingExisting || !selectedMonth}
              className="h-9 w-9 inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 hover:text-violet-600 hover:border-violet-200 disabled:opacity-40 transition-colors shadow-sm"
              title="Reload saved paysheet"
            >
              <RefreshCw className={`h-4 w-4 ${loadingExisting ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => scrollTableHorizontally('left')}
              className="h-9 w-9 inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
              aria-label="Scroll table left"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => scrollTableHorizontally('right')}
              className="h-9 w-9 inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
              aria-label="Scroll table right"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={exportPaysheetBundle}
              disabled={!selectedMonth || exportingBundle}
              className="inline-flex items-center justify-center gap-2 h-9 px-3 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold shadow-sm hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none transition-opacity"
            >
              {exportingBundle ? <Loader2 className="h-4 w-4 animate-spin shrink-0" /> : <Download className="h-4 w-4 shrink-0" />}
              {exportingBundle ? 'Exporting…' : 'Export bundle'}
            </button>
          </div>
        </div>

        {dataSource === 'existing' && hasData && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Showing saved payroll snapshots for the selected month and filters.
          </p>
        )}
      </div>

      <div className="flex flex-col bg-white dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-800">
        {isInitialLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="h-10 w-10 text-violet-500 animate-spin" />
            <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Loading paysheet…</p>
          </div>
        )}

        {!isInitialLoading && isEmpty && (
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <div className="rounded-2xl bg-slate-100 dark:bg-slate-800/80 p-5 mb-4">
              <FileSpreadsheet className="h-10 w-10 text-slate-400 dark:text-slate-500" />
            </div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              {paysheetKind === 'second_salary'
                ? 'No 2nd salary records for this month'
                : 'No payroll records for this month'}
            </p>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 text-center max-w-md">
              {paysheetKind === 'second_salary'
                ? 'Run a cycle from 2nd Salary Payments, then reload.'
                : 'Try another month, clear filters, or reload after payroll is calculated in Pay Register.'}
            </p>
          </div>
        )}

        {!isInitialLoading && hasData && (
          <div className="relative flex flex-col">
            {isRefetching && (
              <div
                className="absolute inset-0 z-30 flex items-start justify-center pt-12 bg-white/60 dark:bg-slate-950/50 backdrop-blur-[1px] pointer-events-none"
                aria-hidden
              >
                <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-2 shadow-md">
                  <Loader2 className="h-4 w-4 text-violet-500 animate-spin" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Applying filters…</span>
                </div>
              </div>
            )}

            <div className="flex-shrink-0 flex flex-wrap items-center gap-3 py-2 text-sm text-slate-600 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
              <span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">{totalRows}</span>
                {totalRows === 1 ? ' row' : ' rows'}
              </span>
              {activeFilterCount > 0 && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-violet-100 dark:bg-violet-950/50 text-violet-800 dark:text-violet-200">
                  {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {paginationBar('top')}

            <div ref={tableScrollRef} className="w-full overflow-x-auto">
              <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    {headers.map((h, i) => (
                      <th
                        key={i}
                        className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 text-left px-4 py-3 font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap border-b border-slate-200 dark:border-slate-700 border-r border-slate-200 dark:border-slate-700 last:border-r-0 shadow-sm"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginatedRows.map((row, rIdx) => (
                    <tr
                      key={startRow + rIdx}
                      className="border-b border-slate-100 dark:border-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800/40 even:bg-slate-50/50 dark:even:bg-slate-800/20 transition-colors"
                    >
                      {headers.map((header, cIdx) => {
                        const isNameColumn = header.toLowerCase().includes('name');
                        const leftDate = row._leftDate as string | undefined;
                        return (
                          <td
                            key={cIdx}
                            className="px-4 py-2.5 text-slate-700 dark:text-slate-300 whitespace-nowrap border-r border-slate-100 dark:border-slate-800/80 last:border-r-0"
                          >
                            <div className="flex flex-col gap-0.5">
                              <span>{formatCell(row[header])}</span>
                              {isNameColumn &&
                                leftDate &&
                                format(new Date(leftDate as string), 'yyyy-MM') === selectedMonth && (
                                  <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400 inline-flex items-center gap-1">
                                    <AlertCircle className="h-3 w-3 shrink-0" />
                                    Left {format(new Date(leftDate as string), 'yyyy-MM-dd')}
                                  </span>
                                )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {paginationBar('bottom')}
          </div>
        )}
      </div>
    </div>
  );

  if (layout === 'workspace') {
    return (
      <div className="relative min-h-screen">
        <div
          className="pointer-events-none fixed inset-0 bg-[linear-gradient(to_right,#e2e8f01f_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f01f_1px,transparent_1px)] bg-[size:28px_28px] dark:bg-[linear-gradient(to_right,rgba(148,163,184,0.12)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.12)_1px,transparent_1px)]"
          aria-hidden
        />
        <div
          className="pointer-events-none fixed inset-0 bg-gradient-to-br from-violet-50/50 via-slate-50/30 to-transparent dark:from-slate-900/70 dark:via-slate-900/75 dark:to-slate-950/90"
          aria-hidden
        />
        <div className="relative z-10 mx-auto max-w-[1920px] w-full p-4 sm:p-6 flex flex-col pb-10">
          {inner}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 dark:bg-slate-950/50">
      <div className="mx-auto max-w-[1920px] w-full px-4 sm:px-6 py-6 flex flex-col pb-10">
        {inner}
      </div>
    </div>
  );
}
