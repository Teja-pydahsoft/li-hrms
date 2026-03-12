'use client';

import { useState, useEffect } from 'react';
import { api, Department, Division } from '@/lib/api';
import {
    Search,
    Download,
    Users,
    CheckCircle2,
    XCircle,
    Clock,
    Loader2
} from 'lucide-react';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';

interface AttendanceRecord {
    _id: string;
    employeeNumber: string;
    employee: {
        emp_no: string;
        employee_name: string;
        department_id?: { name: string };
        division_id?: { name: string };
    };
    date: string;
    status: string;
    firstInTime?: string;
    lastOutTime?: string;
    totalWorkingHours?: number;
    payableShifts?: number;
    totalLateInMinutes?: number;
    totalEarlyOutMinutes?: number;
}

export default function AttendanceReportsTab() {
    const [loading, setLoading] = useState(false);
    const [records, setRecords] = useState<AttendanceRecord[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [divisions, setDivisions] = useState<Division[]>([]);

    // Pagination states
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [limit] = useState(50);
    const [reportStats, setReportStats] = useState({ present: 0, absent: 0, late: 0 });

    // Filter states
    const [startDate, setStartDate] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
    const [endDate, setEndDate] = useState(dayjs().format('YYYY-MM-DD'));
    const [departmentId, setDepartmentId] = useState<string>('all');
    const [divisionId, setDivisionId] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');

    // Export Dialog states
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
    const [exportParams, setExportParams] = useState({
        startDate: dayjs().startOf('month').format('YYYY-MM-DD'),
        endDate: dayjs().format('YYYY-MM-DD'),
        departmentId: 'all',
        divisionId: 'all',
        strict: false
    });

    useEffect(() => {
        loadFilters();
        loadReport(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadFilters = async () => {
        try {
            const [deptRes, divRes] = await Promise.all([
                api.getDepartments(),
                api.getDivisions()
            ]);
            if (deptRes.success) setDepartments(deptRes.data || []);
            if (divRes.success) setDivisions(divRes.data || []);
        } catch (error) {
            console.error('Error loading filters:', error);
        }
    };

    const loadReport = async (pageToLoad: number = page) => {
        setLoading(true);
        try {
            const params: any = {
                startDate,
                endDate,
                page: pageToLoad,
                limit,
                search: searchQuery
            };
            if (departmentId !== 'all') params.departmentId = departmentId;
            if (divisionId !== 'all') params.divisionId = divisionId;

            const response = await api.getAttendanceReportSummary(params);
            if (response.success) {
                setRecords(response.data || []);
                setTotalPages(response.totalPages || 1);
                setTotalCount(response.total || 0);
                setPage(response.page || pageToLoad);
                if (response.stats) {
                    setReportStats(response.stats);
                }
            } else {
                toast.error(response.message || 'Failed to load report');
            }
        } catch (error) {
            console.error('Error loading report:', error);
            toast.error('Error loading report');
        } finally {
            setLoading(false);
        }
    };

    const handleAdvancedExport = async () => {
        const toastId = toast.loading('Preparing your report...');
        try {
            const params: any = {
                startDate: exportParams.startDate,
                endDate: exportParams.endDate
            };
            if (exportParams.departmentId !== 'all') params.departmentId = exportParams.departmentId;
            if (exportParams.divisionId !== 'all') params.divisionId = exportParams.divisionId;
            if (exportParams.strict) params.strict = true;

            const blob = await api.exportAttendanceReport(params);
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `attendance_report_${params.startDate}_to_${params.endDate}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
            toast.success('Report downloaded successfully', { id: toastId });
            setIsExportDialogOpen(false);
        } catch (error: any) {
            console.error('Export error:', error);
            toast.error(error.message || 'Export failed', { id: toastId });
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'PRESENT': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
            case 'HALF_DAY': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
            case 'ABSENT': return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400';
            case 'PARTIAL': return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400';
            default: return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400';
        }
    };

    return (
        <div className="space-y-4">
            {/* Stats Overview - Reduced padding and smaller text */}
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border-none bg-emerald-50 p-3 dark:bg-emerald-950/20">
                    <div className="flex flex-row items-center justify-between pb-1">
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Present</span>
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                        <div className="text-xl font-bold text-emerald-900 dark:text-emerald-100">{reportStats.present}</div>
                    </div>
                </div>

                <div className="rounded-lg border-none bg-rose-50 p-3 dark:bg-rose-950/20">
                    <div className="flex flex-row items-center justify-between pb-1">
                        <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">Absent</span>
                        <XCircle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
                    </div>
                    <div>
                        <div className="text-xl font-bold text-rose-900 dark:text-rose-100">{reportStats.absent}</div>
                    </div>
                </div>

                <div className="rounded-lg border-none bg-amber-50 p-3 dark:bg-amber-950/20">
                    <div className="flex flex-row items-center justify-between pb-1">
                        <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">Late</span>
                        <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                        <div className="text-xl font-bold text-amber-900 dark:text-amber-100">{reportStats.late}</div>
                    </div>
                </div>

                <div className="rounded-lg border-none bg-indigo-50 p-3 dark:bg-indigo-950/20">
                    <div className="flex flex-row items-center justify-between pb-1">
                        <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">Total</span>
                        <Users className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                        <div className="text-xl font-bold text-indigo-900 dark:text-indigo-100">{totalCount}</div>
                    </div>
                </div>
            </div>

            {/* Filters & Actions - More compact */}
            <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1 min-w-[140px]">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Start Date</label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="w-full h-8 rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:border-indigo-500 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                    </div>
                    <div className="space-y-1 min-w-[140px]">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">End Date</label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="w-full h-8 rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:border-indigo-500 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                    </div>
                    <div className="space-y-1 min-w-[160px]">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Department</label>
                        <select
                            value={departmentId}
                            onChange={(e) => setDepartmentId(e.target.value)}
                            className="w-full h-8 rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:border-indigo-500 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                            <option value="all">All Departments</option>
                            {departments.map(d => (
                                <option key={d._id} value={d._id}>{d.name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="space-y-1 min-w-[160px]">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Division</label>
                        <select
                            value={divisionId}
                            onChange={(e) => setDivisionId(e.target.value)}
                            className="w-full h-8 rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:border-indigo-500 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                            <option value="all">All Divisions</option>
                            {divisions.map(d => (
                                <option key={d._id} value={d._id}>{d.name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="space-y-1 flex-1 min-w-[200px]">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Search Employee</label>
                        <div className="relative">
                            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Name or ID..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && loadReport(1)}
                                className="w-full h-8 pl-8 rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:border-indigo-500 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            />
                        </div>
                    </div>
                    <div className="flex space-x-2 shrink-0">
                        <button
                            onClick={() => loadReport(1)}
                            className="h-8 rounded bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
                            disabled={loading}
                        >
                            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mx-auto" /> : 'Apply'}
                        </button>
                        <button
                            className="h-8 w-8 flex items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
                            onClick={() => setIsExportDialogOpen(true)}
                            title="Download Excel Report"
                        >
                            <Download className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Export Dialog Modal */}
            {isExportDialogOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Download Attendance Report</h3>
                            <p className="text-xs text-slate-500">Excel export with dynamic IN/OUT columns.</p>
                        </div>

                        <div className="p-4 space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Start Date</label>
                                    <input
                                        type="date"
                                        value={exportParams.startDate}
                                        onChange={(e) => setExportParams({ ...exportParams, startDate: e.target.value })}
                                        className="w-full h-10 rounded border border-slate-300 bg-white px-3 text-sm outline-none focus:ring-1 focus:ring-indigo-500 dark:bg-slate-800 dark:border-slate-700"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">End Date</label>
                                    <input
                                        type="date"
                                        value={exportParams.endDate}
                                        onChange={(e) => setExportParams({ ...exportParams, endDate: e.target.value })}
                                        className="w-full h-10 rounded border border-slate-300 bg-white px-3 text-sm outline-none focus:ring-1 focus:ring-indigo-500 dark:bg-slate-800 dark:border-slate-700"
                                    />
                                </div>
                            </div>

                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Department</label>
                                <select
                                    value={exportParams.departmentId}
                                    onChange={(e) => setExportParams({ ...exportParams, departmentId: e.target.value })}
                                    className="w-full h-10 rounded border border-slate-300 bg-white px-3 text-sm outline-none focus:ring-1 focus:ring-indigo-500 dark:bg-slate-800 dark:border-slate-700"
                                >
                                    <option value="all">All Departments</option>
                                    {departments.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}
                                </select>
                            </div>

                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Division</label>
                                <select
                                    value={exportParams.divisionId}
                                    onChange={(e) => setExportParams({ ...exportParams, divisionId: e.target.value })}
                                    className="w-full h-10 rounded border border-slate-300 bg-white px-3 text-sm outline-none focus:ring-1 focus:ring-indigo-500 dark:bg-slate-800 dark:border-slate-700"
                                >
                                    <option value="all">All Divisions</option>
                                    {divisions.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}
                                </select>
                            </div>

                            <div className="flex items-center gap-3 p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                                <input
                                    type="checkbox"
                                    id="strict-mode"
                                    checked={exportParams.strict}
                                    onChange={(e) => setExportParams({ ...exportParams, strict: e.target.checked })}
                                    className="w-4 h-4 rounded border-slate-300 text-indigo-600"
                                />
                                <label htmlFor="strict-mode" className="text-xs font-semibold text-indigo-900 dark:text-indigo-200 cursor-pointer">
                                    Strict Mode (Only HRMS Employees)
                                </label>
                            </div>
                        </div>

                        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2 bg-slate-50 dark:bg-slate-800/50">
                            <button
                                onClick={() => setIsExportDialogOpen(false)}
                                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAdvancedExport}
                                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded shadow-lg transition-all active:scale-95"
                            >
                                Download XLSX
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Data Table */}
            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 dark:bg-slate-800/50 dark:border-slate-800">
                                <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-tight">Employee</th>
                                <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-tight">Date</th>
                                <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-tight text-center">Status</th>
                                <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-tight">In Time</th>
                                <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-tight">Out Time</th>
                                <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-tight text-right">Hours</th>
                                <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-tight text-right text-rose-500">Late</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {loading ? (
                                <tr>
                                    <td colSpan={7} className="px-3 py-10 text-center">
                                        <div className="flex flex-col items-center">
                                            <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
                                            <p className="mt-2 text-xs text-slate-500 font-medium">Loading...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : records.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-3 py-10 text-center text-xs text-slate-500 font-medium">
                                        No records found.
                                    </td>
                                </tr>
                            ) : (
                                records.map((record) => (
                                    <tr key={record._id} className="hover:bg-slate-50/50 transition-colors dark:hover:bg-slate-800/30">
                                        <td className="px-3 py-2">
                                            <p className="text-xs font-bold text-slate-900 dark:text-slate-100">{record.employee?.employee_name}</p>
                                            <p className="text-[10px] text-slate-500 font-medium">{record.employeeNumber}</p>
                                        </td>
                                        <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400 font-medium whitespace-nowrap">
                                            {dayjs(record.date).format('DD MMM, YYYY')}
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${getStatusColor(record.status)}`}>
                                                {record.status}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400 font-medium whitespace-nowrap">
                                            {record.firstInTime ? dayjs(record.firstInTime).format('hh:mm A') : '-'}
                                        </td>
                                        <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400 font-medium whitespace-nowrap">
                                            {record.lastOutTime ? dayjs(record.lastOutTime).format('hh:mm A') : '-'}
                                        </td>
                                        <td className="px-3 py-2 text-xs text-right font-bold text-slate-900 dark:text-slate-100">
                                            {record.totalWorkingHours?.toFixed(2) || '0.00'}
                                        </td>
                                        <td className="px-3 py-2 text-xs text-right text-rose-500 font-bold">
                                            {record.totalLateInMinutes ? `${record.totalLateInMinutes}m` : '-'}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Footer */}
                <div className="bg-slate-50 px-3 py-2 border-t border-slate-200 flex items-center justify-between dark:bg-slate-800/50 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">
                        Showing {(page - 1) * limit + 1} to {Math.min(page * limit, totalCount)} of {totalCount} records
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => loadReport(page - 1)}
                            disabled={page === 1 || loading}
                            className="px-2 py-1 text-[10px] font-bold border border-slate-300 rounded hover:bg-white disabled:opacity-50 transition-colors dark:border-slate-700 dark:text-slate-300"
                        >
                            Previous
                        </button>
                        <div className="text-xs font-bold text-slate-600 dark:text-slate-400">
                            Page {page} of {totalPages}
                        </div>
                        <button
                            onClick={() => loadReport(page + 1)}
                            disabled={page === totalPages || loading}
                            className="px-2 py-1 text-[10px] font-bold border border-slate-300 rounded hover:bg-white disabled:opacity-50 transition-colors dark:border-slate-700 dark:text-slate-300"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
