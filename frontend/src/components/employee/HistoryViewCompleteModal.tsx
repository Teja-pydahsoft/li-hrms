import React from 'react';

interface HistoryViewCompleteModalProps {
    data: {
        eventLabel: string;
        changes: Array<{
            field: string;
            fieldLabel: string;
            previous: unknown;
            current: unknown;
        }>;
    };
    onClose: () => void;
}

export default function HistoryViewCompleteModal({ data, onClose }: HistoryViewCompleteModalProps) {
    return (
        <div className="fixed inset-0 z-[55] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative z-10 flex max-h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {data.eventLabel} – complete data
                    </h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                    >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
                <div className="overflow-auto p-4 space-y-4">
                    {data.changes.map((c, idx) => (
                        <div key={`${c.field}-${idx}`} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                            <p className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">{c.fieldLabel}</p>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Previous</p>
                                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white p-2 text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-200">
                                        {typeof c.previous === 'object' && c.previous !== null
                                            ? JSON.stringify(c.previous, null, 2)
                                            : String(c.previous ?? '—')}
                                    </pre>
                                </div>
                                <div>
                                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Current</p>
                                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white p-2 text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-200">
                                        {typeof c.current === 'object' && c.current !== null
                                            ? JSON.stringify(c.current, null, 2)
                                            : String(c.current ?? '—')}
                                    </pre>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
