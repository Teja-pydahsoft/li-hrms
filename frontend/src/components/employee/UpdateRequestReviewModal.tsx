import React from 'react';
import { Edit2, Plus, ShieldCheck } from 'lucide-react';
import Spinner from '@/components/Spinner';

interface UpdateRequestReviewModalProps {
    request: {
        _id: string;
        emp_no: string;
        status: string;
        employeeId: {
            employee_name: string;
            dynamicFields?: Record<string, unknown>;
            [key: string]: unknown;
        };
        requestedChanges: Record<string, unknown>;
        previousValues?: Record<string, unknown>;
    };
    rejectComments: string;
    setRejectComments: (comments: string) => void;
    processingUpdateRequest: boolean;
    formSettings: unknown;
    getFieldLabel: (field: string, settings: unknown) => string;
    onApprove: (id: string) => void;
    onReject: (id: string) => void;
    onClose: () => void;
}

export default function UpdateRequestReviewModal({
    request,
    rejectComments,
    setRejectComments,
    processingUpdateRequest,
    formSettings,
    getFieldLabel,
    onApprove,
    onReject,
    onClose,
}: UpdateRequestReviewModalProps) {
    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-950">
                {/* Modal Header */}
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 p-6 dark:border-slate-800 dark:bg-slate-900/50">
                    <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500 text-white shadow-lg shadow-indigo-500/20">
                            <Edit2 className="h-6 w-6" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">Review Update Request</h3>
                            <p className="text-sm text-slate-500">From {request.employeeId?.employee_name} ({request.emp_no})</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                        <Plus className="h-6 w-6 rotate-45" />
                    </button>
                </div>

                {/* Modal Body */}
                <div className="max-h-[60vh] overflow-y-auto p-6">
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-3 text-xs font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-900">
                            <span>Current Value</span>
                            <span>Requested Change</span>
                        </div>
                        {Object.entries(request.requestedChanges).map(([field, newValue]) => {
                            const oldValue = request.previousValues?.[field] ??
                                (request.employeeId as Record<string, unknown>)[field] ??
                                (request.employeeId.dynamicFields?.[field]);

                            return (
                                <div key={field} className="group rounded-2xl border border-slate-100 p-4 transition-all hover:border-indigo-100 hover:bg-indigo-50/20 dark:border-slate-800 dark:hover:bg-indigo-900/10">
                                    <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                                        {getFieldLabel(field, formSettings)}
                                    </label>
                                    <div className="grid grid-cols-2 gap-8">
                                        <div className="text-sm text-slate-500 line-through decoration-red-300/50">
                                            {String(oldValue || '—')}
                                        </div>
                                        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                            {String(newValue || '—')}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {request.status === 'pending' && (
                        <div className="mt-8 border-t border-slate-100 pt-6 dark:border-slate-800">
                            <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-300">
                                Rejection Comments (Optional)
                            </label>
                            <textarea
                                value={rejectComments}
                                onChange={(e) => setRejectComments(e.target.value)}
                                placeholder="Enter reason if rejecting..."
                                className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-sm transition-all focus:border-indigo-400 focus:outline-none focus:ring-4 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-indigo-900/20"
                                rows={3}
                            />
                        </div>
                    )}
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-end gap-3 bg-slate-50/50 p-6 dark:bg-slate-900/50">
                    <button
                        onClick={onClose}
                        className="rounded-xl px-6 py-2.5 text-sm font-semibold text-slate-600 transition-all hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                    >
                        Close
                    </button>
                    {request.status === 'pending' && (
                        <>
                            <button
                                onClick={() => onReject(request._id)}
                                disabled={processingUpdateRequest}
                                className="rounded-xl bg-red-50 px-6 py-2.5 text-sm font-bold text-red-600 transition-all hover:bg-red-100 disabled:opacity-50 dark:bg-red-900/20"
                            >
                                Reject
                            </button>
                            <button
                                onClick={() => onApprove(request._id)}
                                disabled={processingUpdateRequest}
                                className="group relative flex items-center gap-2 rounded-xl bg-indigo-600 px-8 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition-all hover:bg-indigo-700 hover:shadow-indigo-600/40 disabled:opacity-50"
                            >
                                {processingUpdateRequest ? (
                                    <Spinner className="h-4 w-4 border-white" />
                                ) : (
                                    <ShieldCheck className="h-4 w-4" />
                                )}
                                Approve Changes
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
