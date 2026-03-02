'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { api, Department } from '@/lib/api';
import { toast } from 'react-toastify';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;

function formatCell(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toLocaleString('en-IN');
    return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return String(value);
}

export default function PaysheetPage() {
  const [loading, setLoading] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [dataSource, setDataSource] = useState<'existing' | 'calculated' | null>(null);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / rowsPerPage));
  const startRow = (page - 1) * rowsPerPage;
  const endRow = Math.min(startRow + rowsPerPage, totalRows);
  const paginatedRows = useMemo(
    () => rows.slice(startRow, endRow),
    [rows, startRow, endRow]
  );

  useEffect(() => {
    setPage(1);
  }, [rows.length, rowsPerPage, selectedMonth, selectedDepartment, searchFilter]);

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
  }, [selectedMonth, selectedDepartment, searchFilter]);

  useEffect(() => {
    loadExisting();
  }, [loadExisting]);

  const loadPaysheet = async () => {
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

  return (
    <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950/50 py-6">
      <header className="mb-8">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">
            Paysheet
          </h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
            Existing payroll records load on open. Use filters, then click “Load paysheet” to recalculate. Columns follow Payroll Configuration.
          </p>
      </header>

      <div className="mb-6 flex flex-wrap items-end gap-3 sm:gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Month
            </label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500 transition-shadow"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Department
            </label>
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm min-w-[160px] focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500"
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Search
            </label>
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Name or emp no"
              className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm min-w-[140px] focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500"
            />
          </div>
          <button
            type="button"
            onClick={loadPaysheet}
            disabled={loading || !selectedMonth}
            className="h-9 px-4 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 focus:ring-2 focus:ring-violet-500/50 disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            {loading ? 'Calculating…' : 'Load paysheet'}
          </button>
      </div>

      {(loadingExisting && rows.length === 0) ? (
          <div className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 p-16 text-center">
            <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-violet-500" />
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Loading existing records…</p>
          </div>
        ) : (
          <div className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 shadow-sm overflow-hidden">
            {headers.length === 0 && rows.length === 0 ? (
              <div className="p-16 text-center text-slate-500 dark:text-slate-400 text-sm">
                No payroll records for this month. Adjust filters or click “Load paysheet” to calculate.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto w-full">
                  <table className="w-full min-w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/50 sticky top-0 z-10">
                        {headers.map((h, i) => (
                          <th
                            key={i}
                            className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap first:pl-6 last:pr-6"
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
                          className="border-b border-slate-100 dark:border-slate-800/80 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                        >
                          {headers.map((header, cIdx) => (
                            <td
                              key={cIdx}
                              className="px-4 py-2.5 text-slate-700 dark:text-slate-300 whitespace-nowrap first:pl-6 last:pr-6"
                            >
                              {formatCell(row[header])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {totalRows > 0 && (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 sm:px-6 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30">
                    <div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
                      <span>
                        Showing <span className="font-medium text-slate-800 dark:text-slate-200">{startRow + 1}</span>
                        –<span className="font-medium text-slate-800 dark:text-slate-200">{endRow}</span>
                        {' '}of <span className="font-medium text-slate-800 dark:text-slate-200">{totalRows}</span>
                      </span>
                      <label className="flex items-center gap-2">
                        <span>Rows per page</span>
                        <select
                          value={rowsPerPage}
                          onChange={(e) => setRowsPerPage(Number(e.target.value))}
                          className="h-8 pl-2 pr-7 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-sm focus:ring-2 focus:ring-violet-500/50"
                        >
                          {ROWS_PER_PAGE_OPTIONS.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="flex items-center gap-1">
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
                        Page <span className="font-medium text-slate-800 dark:text-slate-200">{page}</span> of <span className="font-medium text-slate-800 dark:text-slate-200">{totalPages}</span>
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
              </>
            )}
          </div>
        )}
    </div>
  );
}
