import React from 'react';

interface CertificatePreviewModalProps {
    url: string;
    onClose: () => void;
}

export default function CertificatePreviewModal({ url, onClose }: CertificatePreviewModalProps) {
    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <div className="relative z-10 max-h-[90vh] max-w-[90vw] rounded-2xl bg-white shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-end gap-2 border-b border-slate-200 p-2 dark:border-slate-700">
                    <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                        Open in new tab
                    </a>
                    <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                        Close
                    </button>
                </div>
                <div className="p-2">
                    {url.toLowerCase().endsWith('.pdf') ? (
                        <iframe src={url} title="Certificate" className="h-[80vh] w-[85vw] max-w-4xl rounded-lg border-0" />
                    ) : (
                        <img src={url} alt="Certificate" className="max-h-[80vh] max-w-full rounded-lg object-contain" />
                    )}
                </div>
            </div>
        </div>
    );
}
