'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import {
    Download,
    Fingerprint,
    Smartphone,
    Loader2,
    Clock
} from 'lucide-react';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

interface ThumbLog {
    _id: string;
    employeeId: string;
    employeeName?: string;
    timestamp: string;
    logType: string;
    deviceName: string;
    deviceId: string;
    receivedAt?: string;
}

export default function ThumbReportsTab() {
    const [loading, setLoading] = useState(false);
    const [logs, setLogs] = useState<ThumbLog[]>([]);

    // Pagination states
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [limit] = useState(50);

    // Filter states
    const [startDate, setStartDate] = useState(dayjs().format('YYYY-MM-DD'));
    const [endDate, setEndDate] = useState(dayjs().format('YYYY-MM-DD'));
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        loadLogs(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadLogs = async (pageToLoad: number = page) => {
        setLoading(true);
        try {
            const response = await api.getThumbReports({
                startDate: dayjs(startDate).startOf('day').toISOString(),
                endDate: dayjs(endDate).endOf('day').toISOString(),
                search: searchQuery || undefined,
                page: pageToLoad,
                limit
            });

            if (response.success) {
                setLogs(response.data || []);
                setTotalPages(response.totalPages || 1);
                setTotalCount(response.total || 0);
                setPage(response.page || pageToLoad);
            } else {
                toast.error(response.message || 'Failed to load thumb logs');
            }
        } catch (error) {
            console.error('Error loading thumb logs:', error);
            toast.error('Error connecting to biometric logs');
        } finally {
            setLoading(false);
        }
    };

    const stats = {
        totalPunches: totalCount,
        activeDevices: [...new Set(logs.map(l => l.deviceId))].length,
        lastPunch: logs.length > 0 ? dayjs(logs[0].timestamp).format('hh:mm A') : 'N/A'
    };

    const handleExport = () => {
        const headers = ['Timestamp', 'Employee ID', 'Name', 'Log Type', 'Device Name', 'Received At'];
        const rows = logs.map(l => [
            dayjs(l.timestamp).format('YYYY-MM-DD HH:mm:ss'),
            l.employeeId,
            l.employeeName || 'Unknown',
            l.logType,
            l.deviceName,
            l.receivedAt ? dayjs(l.receivedAt).format('YYYY-MM-DD HH:mm:ss') : '-'
        ]);

        const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `thumb_logs_${startDate}.csv`);
        link.click();
    };

    const handlePairedExport = async () => {
        const toastId = toast.loading('Preparing paired report (36h window)...');
        try {
            const blob = await api.exportAttendanceReport({
                startDate,
                endDate,
                search: searchQuery || undefined,
                strict: false // Use biometric logs without requiring HRMS employee match if needed
            });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `paired_biometric_report_${startDate}_to_${endDate}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
            toast.success('Report downloaded successfully', { id: toastId });
        } catch (error: any) {
            console.error('Export error:', error);
            toast.error(error.message || 'Export failed', { id: toastId });
        }
    };

    return (
        <div className="space-y-4">
            {/* Stats Overview - Reduced padding and smaller text */}
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-lg border-none bg-indigo-50 p-3 dark:bg-indigo-950/20">
                    <div className="flex flex-row items-center justify-between pb-1">
                        <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">Total Punches</span>
                        <Fingerprint className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                        <div className="text-xl font-bold text-indigo-900 dark:text-indigo-100">{totalCount}</div>
                    </div>
                </div>

                <div className="rounded-lg border-none bg-emerald-50 p-3 dark:bg-emerald-950/20">
                    <div className="flex flex-row items-center justify-between pb-1">
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Active Devices</span>
                        <Smartphone className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                        <div className="text-xl font-bold text-emerald-900 dark:text-emerald-100">{stats.activeDevices}</div>
                    </div>
                </div>

                <div className="rounded-lg border-none bg-amber-50 p-3 dark:bg-amber-950/20">
                    <div className="flex flex-row items-center justify-between pb-1">
                        <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">Latest Punch</span>
                        <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                        <div className="text-xl font-bold text-amber-900 dark:text-amber-100">{stats.lastPunch}</div>
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
                    <div className="space-y-1 flex-1 min-w-[200px]">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Search Employee</label>
                        <div className="relative">
                            <Smartphone className="absolute left-2 top-2 h-3.5 w-3.5 text-slate-400" />
                            <input
                                type="text"
                                placeholder="ID or Name..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && loadLogs(1)}
                                className="w-full h-8 pl-8 rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:border-indigo-500 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            />
                        </div>
                    </div>
                    <div className="flex space-x-2 shrink-0">
                        <button
                            onClick={() => loadLogs(1)}
                            className="h-8 rounded bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
                            disabled={loading}
                        >
                            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mx-auto" /> : 'Apply'}
                        </button>
                        <div className="h-8 w-[1px] bg-slate-200 dark:bg-slate-700" />
                        <button
                            className="h-8 flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2 text-[10px] font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
                            onClick={handleExport}
                            title="Download Raw CSV"
                        >
                            <Download className="h-3 w-3" />
                            CSV
                        </button>
                        <button
                            className="h-8 flex items-center gap-1.5 rounded bg-emerald-600 px-2 text-[10px] font-bold text-white hover:bg-emerald-700 transition-all shadow-sm active:scale-95"
                            onClick={handlePairedExport}
                            title="Paired IN/OUT Excel"
                        >
                            <Download className="h-3 w-3" />
                            Paired XLSX
                        </button>
                    </div>
                </div>
            </div>

            {/* Data Table */}
            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 dark:bg-slate-800/50 dark:border-slate-800">
                                <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-tight">Timestamp</th>
                                <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-tight">Employee</th>
                                <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-tight">Type</th>
                                <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-tight">Device</th>
                                <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-tight">Received At</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="px-3 py-10 text-center">
                                        <div className="flex flex-col items-center">
                                            <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
                                            <p className="mt-2 text-xs text-slate-500 font-medium">Fetching Biometric Logs...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : logs.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-3 py-10 text-center text-xs text-slate-500 font-medium">
                                        No biometric logs found.
                                    </td>
                                </tr>
                            ) : (
                                logs.map((log) => (
                                    <tr key={log._id} className="hover:bg-slate-50/50 transition-colors dark:hover:bg-slate-800/30">
                                        <td className="px-3 py-2">
                                            <div className="flex items-center space-x-2">
                                                <Clock className="h-3 w-3 text-slate-400" />
                                                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                                                    {dayjs(log.timestamp).format('DD MMM, hh:mm:ss A')}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2">
                                            <p className="text-xs font-bold text-slate-900 dark:text-slate-100">{log.employeeName || 'Unknown'}</p>
                                            <p className="text-[10px] text-slate-500 font-medium">{log.employeeId}</p>
                                        </td>
                                        <td className="px-3 py-2">
                                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${log.logType?.includes('IN')
                                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                                : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                                                }`}>
                                                {log.logType}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
                                            <div className="flex flex-col">
                                                <span className="font-semibold">{log.deviceName}</span>
                                                <span className="text-[9px] text-slate-400">{log.deviceId}</span>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-[10px] text-slate-500 italic font-medium">
                                            {log.receivedAt ? dayjs(log.receivedAt).fromNow() : '-'}
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
                        Showing {(page - 1) * limit + 1} to {Math.min(page * limit, totalCount)} of {totalCount} logs
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => loadLogs(page - 1)}
                            disabled={page === 1 || loading}
                            className="px-2 py-1 text-[10px] font-bold border border-slate-300 rounded hover:bg-white disabled:opacity-50 transition-colors dark:border-slate-700 dark:text-slate-300"
                        >
                            Previous
                        </button>
                        <div className="text-xs font-bold text-slate-600 dark:text-slate-400">
                            Page {page} of {totalPages}
                        </div>
                        <button
                            onClick={() => loadLogs(page + 1)}
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
