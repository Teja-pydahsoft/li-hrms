import React from 'react';
import { api } from '@/lib/api';

interface BulkAllowancesDeductionsModalProps {
    onClose: () => void;
    onSuccess: (message: string) => void;
    onError: (message: string) => void;
    setLoading: (loading: boolean) => void;
    loadEmployees: (page?: number) => void;
    currentPage: number;
}

export default function BulkAllowancesDeductionsModal({
    onClose,
    onSuccess,
    onError,
    setLoading,
    loadEmployees,
    currentPage,
}: BulkAllowancesDeductionsModalProps) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-800">
                <h3 className="mb-4 text-xl font-bold text-slate-800 dark:text-white">Bulk Allowances & Deductions Update</h3>
                <p className="mb-6 text-slate-600 dark:text-slate-400">
                    Download the template with current values, modify them, and upload to update.
                </p>

                <div className="space-y-4">
                    <button
                        onClick={async () => {
                            try {
                                const blob = await api.downloadAllowanceDeductionTemplate();
                                const url = window.URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = 'AD_Template.xlsx';
                                document.body.appendChild(a);
                                a.click();
                                window.URL.revokeObjectURL(url);
                                document.body.removeChild(a);
                            } catch {
                                onError('Failed to download template');
                            }
                        }}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-purple-200 bg-purple-50 p-4 text-purple-700 hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-900/20 dark:text-purple-300"
                    >
                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download Current Template
                    </button>

                    <div className="relative">
                        <input
                            type="file"
                            accept=".xlsx,.xls"
                            onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;

                                try {
                                    setLoading(true);
                                    const res = await api.bulkUpdateAllowancesDeductions(file);
                                    if (res.success) {
                                        onSuccess(res.message || 'Updated successfully');
                                        onClose();
                                        loadEmployees(currentPage);
                                    } else {
                                        onError(res.message || 'Upload failed');
                                    }
                                } catch (err: unknown) {
                                    onError(err instanceof Error ? err.message : 'Upload failed');
                                } finally {
                                    setLoading(false);
                                }
                            }}
                            className="hidden"
                            id="ad-bulk-upload"
                        />
                        <label
                            htmlFor="ad-bulk-upload"
                            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-purple-600 p-4 font-medium text-white hover:bg-purple-700"
                        >
                            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                            </svg>
                            Upload Updated Template
                        </label>
                    </div>
                </div>

                <div className="mt-6 flex justify-end">
                    <button
                        onClick={onClose}
                        className="rounded-lg px-4 py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}
