'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { toast } from 'react-hot-toast';
import { format } from 'date-fns';
import QRScanner from '@/components/QRScanner';

interface PermissionRequests {
    _id: string;
    employeeId: {
        _id: string;
        employee_name: string;
        emp_no: string;
        department_id?: { name: string };
        designation_id?: { name: string };
        photo?: string;
    };
    date: string;
    permissionStartTime: string;
    permissionEndTime: string;
    purpose: string;
    status: string;
    gateOutTime?: string;
    gateInTime?: string;
    gateOutVerifiedBy?: string;
    gateInVerifiedBy?: string;
}

export default function SecurityGatePage() {
    const [permissions, setPermissions] = useState<PermissionRequests[]>([]);
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState(false);
    const [manualCode, setManualCode] = useState('');
    const [verifying, setVerifying] = useState(false);

    // Stats
    const [stats, setStats] = useState({
        total: 0,
        out: 0,
        in: 0,
        pending: 0
    });

    const fetchPermissions = async () => {
        try {
            setLoading(true);
            const response = await api.getTodayPermissions();
            if (response.success) {
                setPermissions(response.data);
                calculateStats(response.data);
            }
        } catch (error) {
            console.error('Failed to fetch permissions', error);
            toast.error('Failed to load today\'s permissions');
        } finally {
            setLoading(false);
        }
    };

    const calculateStats = (data: PermissionRequests[]) => {
        const total = data.length;
        const out = data.filter(p => p.gateOutTime && !p.gateInTime).length;
        const completed = data.filter(p => p.gateOutTime && p.gateInTime).length;
        const pending = total - out - completed;

        setStats({ total, out, in: completed, pending });
    };

    useEffect(() => {
        fetchPermissions();
        // Refresh every minute to keep statuses up to date
        const interval = setInterval(fetchPermissions, 60000);
        return () => clearInterval(interval);
    }, []);

    const lastScannedCodeRef = useRef<string | null>(null);
    const lastScanTimeRef = useRef<number>(0);

    const handleVerify = async (code: string) => {
        if (!code) return;

        // Debounce: Ignore if same code scanned within 3 seconds
        const now = Date.now();
        if (code === lastScannedCodeRef.current && (now - lastScanTimeRef.current < 3000)) {
            return;
        }

        try {
            setVerifying(true);
            lastScannedCodeRef.current = code;
            lastScanTimeRef.current = now;

            const response = await api.verifyGatePass(code);

            if (response.success) {
                toast.success(response.message || 'Gate Pass Verified');
                setScanning(false);
                setManualCode('');
                // Clear debounce ref on success so next scan (even if same code? No, keep it to prevent accidental double-tap)
                // Actually, if successful, we closed the scanner, so it's fine.
                // If we re-open scanner for same person immediately, 'already verified' will handle it backend side.
                fetchPermissions(); // Refresh list
            } else {
                toast.error(response.message || 'Verification Failed');
                // Allow retrying different code immediately, but force wait for same code
            }
        } catch (error: any) {
            toast.error(error.message || 'Verification Failed');
        } finally {
            setVerifying(false);
        }
    };

    // Status Badge Component
    const StatusBadge = ({ p }: { p: PermissionRequests }) => {
        if (p.gateInTime) {
            return (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    <span className="h-2 w-2 rounded-full bg-green-500"></span>
                    Completed
                </span>
            );
        }
        if (p.gateOutTime) {
            return (
                <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-semibold text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                    <span className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse"></span>
                    OUT
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                <span className="h-2 w-2 rounded-full bg-blue-500"></span>
                Approved
            </span>
        );
    };

    const sortedPermissions = [...permissions].sort((a, b) => {
        const getLatestTime = (p: PermissionRequests) => {
            if (p.gateInTime) return new Date(p.gateInTime).getTime();
            if (p.gateOutTime) return new Date(p.gateOutTime).getTime();
            if (p.permissionStartTime) return new Date(p.permissionStartTime).getTime();
            return 0;
        };
        return getLatestTime(b) - getLatestTime(a);
    });

    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Security Gate</h1>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Monitor and verify employee movements for {format(new Date(), 'dd MMM yyyy')}
                    </p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={() => fetchPermissions()}
                        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Refresh
                    </button>
                    <button
                        onClick={() => setScanning(true)}
                        className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-blue-500/30 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                        </svg>
                        Scan QR Code
                    </button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {[
                    { label: 'Total', value: stats.total, color: 'text-slate-700', bg: 'bg-white' },
                    { label: 'Out', value: stats.out, color: 'text-yellow-600', bg: 'bg-yellow-50' },
                    { label: 'Returned', value: stats.in, color: 'text-green-600', bg: 'bg-green-50' },
                    { label: 'Pending', value: stats.pending, color: 'text-blue-600', bg: 'bg-blue-50' },
                ].map((stat, i) => (
                    <div key={i} className={`rounded-2xl border border-slate-200 p-4 dark:border-slate-700 dark:bg-slate-900 ${stat.bg} dark:bg-opacity-10`}>
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{stat.label}</p>
                        <p className={`mt-2 text-3xl font-bold ${stat.color} dark:text-slate-100`}>{stat.value}</p>
                    </div>
                ))}
            </div>

            {/* Permissions List */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50">
                            <tr>
                                <th className="px-6 py-4 font-semibold text-slate-700 dark:text-slate-300">Employee</th>
                                <th className="px-6 py-4 font-semibold text-slate-700 dark:text-slate-300">Purpose</th>
                                <th className="px-6 py-4 font-semibold text-slate-700 dark:text-slate-300">Scheduled Time</th>
                                <th className="px-6 py-4 font-semibold text-slate-700 dark:text-slate-300">Gate Out</th>
                                <th className="px-6 py-4 font-semibold text-slate-700 dark:text-slate-300">Gate In</th>
                                <th className="px-6 py-4 font-semibold text-slate-700 dark:text-slate-300">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {loading ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                                        Loading permissions...
                                    </td>
                                </tr>
                            ) : permissions.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                                        No approved permissions found for today.
                                    </td>
                                </tr>
                            ) : (
                                sortedPermissions.map((p) => (
                                    <tr key={p._id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500 dark:bg-slate-800">
                                                    {p.employeeId?.employee_name?.charAt(0)}
                                                </div>
                                                <div>
                                                    <div className="font-medium text-slate-900 dark:text-slate-100">{p.employeeId?.employee_name}</div>
                                                    <div className="text-xs text-slate-500">{p.employeeId?.emp_no}</div>
                                                    {p.employeeId?.department_id && <div className="text-[10px] text-zinc-400">{p.employeeId.department_id.name}</div>}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-slate-600 dark:text-slate-400">
                                            {p.purpose}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="font-medium text-slate-900 dark:text-slate-100">
                                                {format(new Date(p.permissionStartTime), 'hh:mm a')} - {format(new Date(p.permissionEndTime), 'hh:mm a')}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {p.gateOutTime ? (
                                                <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                                                    {format(new Date(p.gateOutTime), 'hh:mm a')}
                                                </span>
                                            ) : (
                                                <span className="text-slate-400">-</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            {p.gateInTime ? (
                                                <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                                                    {format(new Date(p.gateInTime), 'hh:mm a')}
                                                </span>
                                            ) : (
                                                <span className="text-slate-400">-</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <StatusBadge p={p} />
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Scanner Modal */}
            {scanning && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
                        <div className="mb-4 flex items-center justify-between">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Verify Gate Pass</h3>
                            <button onClick={() => setScanning(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="space-y-6">
                            {/* Input Method */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                    Manual Entry / Scanner Input
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={manualCode}
                                        onChange={(e) => setManualCode(e.target.value)}
                                        placeholder="Click here and scan..."
                                        className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                                        autoFocus
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                handleVerify(manualCode);
                                            }
                                        }}
                                    />
                                    <button
                                        onClick={() => handleVerify(manualCode)}
                                        disabled={verifying || !manualCode}
                                        className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                                    >
                                        {verifying ? '...' : 'Verify'}
                                    </button>
                                </div>
                                <p className="mt-2 text-xs text-slate-500">
                                    Use a handheld scanner or type the code manually.
                                </p>
                            </div>

                            <div className="relative flex items-center py-2">
                                <div className="flex-grow border-t border-slate-200 dark:border-slate-700"></div>
                                <span className="flex-shrink-0 mx-4 text-slate-400 text-xs text-center uppercase tracking-wider font-semibold">Live Camera Scanner</span>
                                <div className="flex-grow border-t border-slate-200 dark:border-slate-700"></div>
                            </div>

                            <div className="rounded-2xl bg-black border-2 border-slate-800 shadow-2xl overflow-hidden relative group">
                                <QRScanner
                                    onScanSuccess={(code) => handleVerify(code)}
                                    fps={15}
                                    qrbox={250}
                                />
                                <div className="absolute top-4 left-4 z-10">
                                    <span className="inline-flex items-center rounded-full bg-red-500/20 px-2.5 py-1 text-xs font-semibold text-red-500 backdrop-blur-md">
                                        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse"></span>
                                        Live
                                    </span>
                                </div>
                            </div>

                            <p className="text-center text-xs text-slate-500 italic">
                                Position the QR code within the frame for automatic detection.
                            </p>

                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
