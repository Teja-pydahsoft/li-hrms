'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api, Department } from '@/lib/api';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight, FileSpreadsheet, Search, Calendar, Building2, Download, AlertCircle } from 'lucide-react';

/** Negative value = show all loaded rows (API returns full set; table was capped by page size before). */
const ROWS_PER_PAGE_ALL = -1;
const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100, 250, 500, ROWS_PER_PAGE_ALL] as const;

function formatCell(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toLocaleString('en-IN');
    return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return String(value);
}

export default function PaysheetPage() {
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
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

  useEffect(() => {
    setPage(1);
  }, [rows.length, rowsPerPage, selectedMonth, selectedDepartment, searchFilter, paysheetKind]);

  useEffect(() => {
    const today = new Date();
    const defaultMonth =
      today.getDate() > 15
        ? today.toISOString().slice(0, 7)
        : new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 7);
    setSelectedMonth(defaultMonth);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const deptRes = await api.getDepartments().catch(() => ({ data: [] }));
        setDepartments(Array.isArray(deptRes?.data) ? deptRes.data : []);
      } catch (_) {}
    })();
  }, []);

  const loadExisting = useCallback(async () => {
    if (!selectedMonth) return;
    setLoadingExisting(true);
    try {
      const res = await api.getPaysheetData({
        month: selectedMonth,
        departmentId: selectedDepartment || undefined,
        search: searchFilter.trim() || undefined,
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
    } catch (_) {
      setHeaders([]);
      setRows([]);
      setDataSource(null);
    } finally {
      setLoadingExisting(false);
    }
  }, [selectedMonth, selectedDepartment, searchFilter, paysheetKind]);

  useEffect(() => {
    loadExisting();
  }, [loadExisting]);

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
        search: searchFilter.trim() || undefined,
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

  const loadPaysheet = async () => {
    if (paysheetKind === 'second_salary') {
      toast.info('2nd salary view lists saved runs only. Calculate from 2nd Salary Payments, then refresh.');
      return;
    }
    if (!selectedMonth) {
      toast.warning('Please select a month');
      return;
    }
    setLoading(true);
    try {
      const res = await api.getPaysheetData({
        month: selectedMonth,
        departmentId: selectedDepartment || undefined,
        search: searchFilter.trim() || undefined,
      });
      if (res?.success && res?.data) {
        setHeaders(res.data.headers || []);
        setRows(res.data.rows || []);
        setDataSource('calculated');
        if ((res.data.rows?.length ?? 0) === 0 && res.message) {
          toast.info(res.message);
        } else {
          toast.success(`Calculated and loaded ${res.data.rows?.length ?? 0} rows`);
        }
      } else {
        setHeaders([]);
        setRows([]);
        toast.error('Failed to load paysheet');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load paysheet';
      toast.error(msg);
      setHeaders([]);
      setRows([]);
    } finally {
      setLoading(false);
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

  const isLoading = loadingExisting && rows.length === 0;
  const isEmpty = !loadingExisting && headers.length === 0 && rows.length === 0;
  const hasData = headers.length > 0 && rows.length > 0;

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 dark:bg-slate-950/50">
      <div className="sticky top-0 z-40 bg-slate-50 dark:bg-slate-950/95">
        {/* Page header */}
        <div className="flex-shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/95">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 py-2">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-slate-900 dark:text-white tracking-tight">
                  Paysheet
                </h1>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                  {paysheetKind === 'second_salary'
                    ? 'Saved 2nd salary by month. With Payroll Configuration output columns set, columns match regular paysheet; otherwise legacy 2nd-salary layout.'
                    : 'Payroll records by month. Columns follow Payroll Configuration.'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => scrollTableHorizontally('left')}
                className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                aria-label="Scroll table left"
                title="Scroll table left"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => scrollTableHorizontally('right')}
                className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                aria-label="Scroll table right"
                title="Scroll table right"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={exportPaysheetBundle}
                disabled={!selectedMonth || exportingBundle}
                className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-violet-600 text-white text-sm font-semibold shadow-sm hover:bg-violet-700 disabled:opacity-50 disabled:pointer-events-none transition-colors"
                title="Excel with Regular, 2nd salary, and Comparison (paired columns + net difference)"
              >
                <Download className="h-4 w-4 shrink-0" />
                {exportingBundle ? 'Exporting…' : 'Export bundle'}
              </button>
            </div>
          </div>
        </div>

        {/* Filters bar */}
        <div className="flex-shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/30 py-2">
          <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Calendar className="h-3.5 w-3.5" />
              Month
            </label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Building2 className="h-3.5 w-3.5" />
              Department
            </label>
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className="h-9 min-w-[180px] rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none"
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Search className="h-3.5 w-3.5" />
              Search
            </label>
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Name or emp no"
              className="h-9 min-w-[160px] rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Paysheet</span>
            <div className="flex h-9 items-center rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-100/90 p-0.5 dark:bg-slate-800/80">
              <button
                type="button"
                onClick={() => setPaysheetKind('regular')}
                className={`h-8 flex-1 rounded-md px-3 text-xs font-semibold transition-colors ${
                  paysheetKind === 'regular'
                    ? 'bg-white text-violet-700 shadow-sm dark:bg-slate-900 dark:text-violet-300'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Regular
              </button>
              <button
                type="button"
                onClick={() => setPaysheetKind('second_salary')}
                className={`h-8 flex-1 rounded-md px-2 text-xs font-semibold transition-colors ${
                  paysheetKind === 'second_salary'
                    ? 'bg-white text-violet-700 shadow-sm dark:bg-slate-900 dark:text-violet-300'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                2nd salary
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={loadPaysheet}
            disabled={loading || !selectedMonth}
            className="hidden"
            aria-hidden
          >
            {loading ? 'Calculating…' : 'Load paysheet'}
          </button>
          </div>
        </div>
      </div>

      {/* Main content: loading / empty / table */}
      <div className="flex-1 min-h-0 flex flex-col">
        {isLoading && (
          <div className="flex-1 flex flex-col items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-violet-500 dark:border-slate-600" />
            <p className="mt-4 text-sm font-medium text-slate-600 dark:text-slate-400">
              Loading payroll records…
            </p>
          </div>
        )}

        {!isLoading && isEmpty && (
          <div className="flex-1 flex flex-col items-center justify-center py-8">
            <div className="rounded-full bg-slate-100 dark:bg-slate-800 p-4">
              <FileSpreadsheet className="h-8 w-8 text-slate-400 dark:text-slate-500" />
            </div>
            <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-300">
              {paysheetKind === 'second_salary'
                ? 'No 2nd salary records for this month'
                : 'No payroll records for this month'}
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 text-center max-w-sm">
              {paysheetKind === 'second_salary'
                ? 'Run a cycle from 2nd Salary Payments for this month, then switch back here or refresh.'
                : 'Adjust month or filters to load data.'}
            </p>
          </div>
        )}

        {!isLoading && hasData && (
          <div className="flex-1 min-h-0 flex flex-col bg-white dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-800">
            {/* Table summary */}
            <div className="flex-shrink-0 flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
              <span className="text-sm text-slate-600 dark:text-slate-400">
                <span className="font-medium text-slate-800 dark:text-slate-200">{totalRows}</span>
                {' '}row{totalRows !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Table wrapper: scrollable, full width */}
            <div ref={tableScrollRef} className="flex-1 min-h-0 overflow-auto">
              <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    {headers.map((h, i) => (
                      <th
                        key={i}
                        className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800/95 shadow-sm text-left px-4 py-3 font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap border-b border-slate-200 dark:border-slate-700 border-r border-slate-200 dark:border-slate-700 last:border-r-0"
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
                            <div className="flex flex-col">
                              <span>{formatCell(row[header])}</span>
                              {isNameColumn && leftDate && format(new Date(leftDate as string), 'yyyy-MM') === selectedMonth && (
                                <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                                  <AlertCircle className="h-3 w-3" />
                                  Left at {format(new Date(leftDate as string), 'yyyy-MM-dd')}
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

            {/* Pagination */}
            {totalRows > 0 && (
              <div className="flex-shrink-0 flex flex-col sm:flex-row items-center justify-between gap-3 py-2 border-t border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/30">
                <div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
                  <span>
                    Showing{' '}
                    <span className="font-medium text-slate-800 dark:text-slate-200">{startRow + 1}</span>
                    –<span className="font-medium text-slate-800 dark:text-slate-200">{endRow}</span>
                    {' '}of{' '}
                    <span className="font-medium text-slate-800 dark:text-slate-200">{totalRows}</span>
                  </span>
                  <label className="flex items-center gap-2">
                    <span>Rows per page</span>
                    <select
                      value={rowsPerPage}
                      onChange={(e) => setRowsPerPage(Number(e.target.value))}
                      className="h-8 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 pl-2 pr-8 text-sm text-slate-700 dark:text-slate-300 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none"
                    >
                      {ROWS_PER_PAGE_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                          {n === ROWS_PER_PAGE_ALL ? 'All rows' : n}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="min-w-[100px] text-center text-sm text-slate-600 dark:text-slate-400">
                    Page{' '}
                    <span className="font-medium text-slate-800 dark:text-slate-200">{page}</span>
                    {' '}of{' '}
                    <span className="font-medium text-slate-800 dark:text-slate-200">{totalPages}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
