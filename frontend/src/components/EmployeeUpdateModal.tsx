'use client';

import { useState, useEffect } from 'react';
import { X, Upload, FileSpreadsheet, AlertCircle, CheckCircle, Download, ChevronRight, Check } from 'lucide-react';
import { api } from '@/lib/api';

interface EmployeeUpdateModalProps {
    onClose: () => void;
    onSuccess: () => void;
}

export default function EmployeeUpdateModal({ onClose, onSuccess }: EmployeeUpdateModalProps) {
    const [step, setStep] = useState<'select' | 'upload'>('select');
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [stats, setStats] = useState<{ total: number; updated: number; failed: number; errors?: any[] } | null>(null);

    const [formSettings, setFormSettings] = useState<any>(null);
    const [selectedFields, setSelectedFields] = useState<string[]>([]);
    const [loadingSettings, setLoadingSettings] = useState(true);
    const [customEmployeeGroupingEnabled, setCustomEmployeeGroupingEnabled] = useState(false);

    useEffect(() => {
        loadFormSettings();
        loadGroupingSetting();
    }, []);

    const loadFormSettings = async () => {
        try {
            const res = await api.getFormSettings();
            if (res.success) {
                setFormSettings(res.data);
            }
        } catch (err) {
            console.error('Failed to load form settings', err);
            setError('Failed to load field options');
        } finally {
            setLoadingSettings(false);
        }
    };

    const loadGroupingSetting = async () => {
        try {
            const res = await api.getSetting('custom_employee_grouping_enabled');
            setCustomEmployeeGroupingEnabled(!!(res?.success && res?.data?.value));
        } catch {
            setCustomEmployeeGroupingEnabled(false);
        }
    };

    const toggleField = (fieldId: string) => {
        setSelectedFields(prev =>
            prev.includes(fieldId)
                ? prev.filter(id => id !== fieldId)
                : [...prev, fieldId]
        );
    };

    const handleDownloadTemplate = async () => {
        if (selectedFields.length === 0) {
            setError('Please select at least one field to update');
            return;
        }
        try {
            await api.downloadEmployeeUpdateTemplate(selectedFields);
            setStep('upload');
            setError('');
        } catch (err: any) {
            setError(err.message || 'Failed to download template');
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setError('');
            setStats(null);
        }
    };

    const handleUpload = async () => {
        if (!file) {
            setError('Please select a file first');
            return;
        }

        setUploading(true);
        setError('');
        setStats(null);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await api.updateEmployeeBulk(formData);

            if (res.success) {
                setSuccess(res.message || 'Update successful');
                setStats(res.data);
                setTimeout(() => {
                    onSuccess();
                }, 2000);
            } else {
                setError(res.message || 'Failed to update employees');
            }
        } catch (err: any) {
            setError(err.message || 'An error occurred during upload');
        } finally {
            setUploading(false);
        }
    };

    // Filter out restricted fields (only emp_no; gross_salary, second_salary and proposedSalary are allowed for bulk update)
    const isFieldRestricted = (id: string) => ['emp_no'].includes(id);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative z-50 flex w-full max-w-2xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl dark:bg-slate-900">

                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-6 py-4 dark:border-slate-800 dark:bg-slate-900/50">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600">
                            <Upload className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Bulk Employee Update</h2>
                            <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Generic Update Service</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-white hover:text-slate-600 dark:hover:bg-slate-800">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Stepper */}
                <div className="flex items-center gap-4 px-6 py-4 bg-slate-50/30 dark:bg-slate-800/20 border-b border-slate-100 dark:border-slate-800">
                    <div className={`flex items-center gap-2 text-xs font-bold ${step === 'select' ? 'text-indigo-600' : 'text-emerald-600'}`}>
                        <div className={`h-6 w-6 rounded-full flex items-center justify-center border-2 ${step === 'select' ? 'border-indigo-600' : 'border-emerald-600 bg-emerald-600 text-white'}`}>
                            {step === 'select' ? '1' : <Check className="h-3 w-3" />}
                        </div>
                        Select Fields
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                    <div className={`flex items-center gap-2 text-xs font-bold ${step === 'upload' ? 'text-indigo-600' : 'text-slate-400'}`}>
                        <div className={`h-6 w-6 rounded-full flex items-center justify-center border-2 ${step === 'upload' ? 'border-indigo-600' : 'border-slate-300'}`}>
                            2
                        </div>
                        Upload & Update
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto max-h-[60vh]">
                    {step === 'select' ? (
                        <div className="space-y-6">
                            <div className="rounded-xl bg-indigo-50 p-4 border border-indigo-100 dark:bg-indigo-900/20 dark:border-indigo-800">
                                <h3 className="text-sm font-bold text-indigo-800 dark:text-indigo-300 mb-2">Step 1: Choose Update Scope</h3>
                                <p className="text-xs text-indigo-700 dark:text-indigo-400">
                                    Select the fields you want to update for all active employees (e.g. Employee Name, Division, Designation, Second Salary, Gross Salary). Then download the template, fill it with data, and upload it in the next step.
                                </p>
                            </div>

                            {loadingSettings ? (
                                <div className="flex justify-center p-8">
                                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent"></div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {formSettings?.groups?.map((group: any) => (
                                        group.isEnabled && (
                                            <div key={group.id} className="space-y-2">
                                                <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{group.label}</h4>
                                                <div className="grid grid-cols-2 gap-2">
                                                    {group.fields.map((field: any) => (
                                                        field.isEnabled && !isFieldRestricted(field.id) && (
                                                            <button
                                                                key={field.id}
                                                                onClick={() => toggleField(field.id)}
                                                                className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${selectedFields.includes(field.id)
                                                                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30'
                                                                        : 'border-slate-200 hover:border-indigo-300 dark:border-slate-700 dark:hover:border-indigo-500/50'
                                                                    }`}
                                                            >
                                                                <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-all ${selectedFields.includes(field.id) ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 dark:border-slate-600'
                                                                    }`}>
                                                                    {selectedFields.includes(field.id) && <Check className="h-3 w-3" />}
                                                                </div>
                                                                <span className="text-xs font-semibold">{field.id === 'proposedSalary' ? 'Gross Salary' : field.label}</span>
                                                            </button>
                                                        )
                                                    ))}
                                                </div>
                                            </div>
                                        )
                                    ))}
                                    {customEmployeeGroupingEnabled && (
                                        <div className="space-y-2">
                                            <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">System</h4>
                                            <div className="grid grid-cols-2 gap-2">
                                                <button
                                                    onClick={() => toggleField('employee_group_id')}
                                                    className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${selectedFields.includes('employee_group_id')
                                                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30'
                                                        : 'border-slate-200 hover:border-indigo-300 dark:border-slate-700 dark:hover:border-indigo-500/50'
                                                        }`}
                                                >
                                                    <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-all ${selectedFields.includes('employee_group_id') ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 dark:border-slate-600'
                                                        }`}>
                                                        {selectedFields.includes('employee_group_id') && <Check className="h-3 w-3" />}
                                                    </div>
                                                    <span className="text-xs font-semibold">Employee Group</span>
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <div className="rounded-xl bg-emerald-50 p-4 border border-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-800">
                                <h3 className="text-sm font-bold text-emerald-800 dark:text-emerald-300 mb-2">Step 2: Upload Data</h3>
                                <ul className="list-disc list-inside text-xs text-emerald-700 dark:text-emerald-400 space-y-1">
                                    <li>Ensure <strong>Employee ID</strong> is correct.</li>
                                    <li>Do not change the header names in the template.</li>
                                    <li>Only data for the selected columns will be updated.</li>
                                </ul>
                            </div>

                            <div className={`relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 transition-all ${file ? 'border-emerald-500 bg-emerald-50/30 dark:border-emerald-500/50 dark:bg-emerald-900/10' : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-indigo-500/50 dark:hover:bg-slate-800'
                                }`}>
                                <input type="file" accept=".xlsx, .xls" onChange={handleFileChange} className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0" />
                                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-sm dark:bg-slate-800">
                                    {file ? <FileSpreadsheet className="h-8 w-8 text-emerald-500" /> : <Upload className="h-8 w-8 text-slate-400" />}
                                </div>
                                <p className="mt-4 text-sm font-bold text-slate-700 dark:text-slate-200">
                                    {file ? file.name : 'Drop the filled template here'}
                                </p>
                                {!file && <p className="text-xs text-slate-500 mt-1">Supports Excel (.xlsx) files</p>}
                            </div>

                            {stats && (
                                <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                                    <h4 className="text-xs font-bold uppercase text-slate-500 mb-3">Process Summary</h4>
                                    <div className="grid grid-cols-3 gap-2 text-center">
                                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800">
                                            <div className="text-xl font-bold text-slate-700 dark:text-slate-300">{stats.total}</div>
                                            <div className="text-[10px] text-slate-500">Rows</div>
                                        </div>
                                        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20">
                                            <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{stats.updated}</div>
                                            <div className="text-[10px] text-emerald-600/70">Success</div>
                                        </div>
                                        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-900/20">
                                            <div className="text-xl font-bold text-rose-600 dark:text-rose-400">{stats.failed}</div>
                                            <div className="text-[10px] text-rose-600/70">Failed</div>
                                        </div>
                                    </div>
                                    {stats.errors && stats.errors.length > 0 && (
                                        <div className="mt-4 max-h-32 overflow-y-auto space-y-1 rounded-lg border border-rose-100 p-2 dark:border-rose-900/30">
                                            {stats.errors.slice(0, 10).map((err: any, i: number) => (
                                                <div key={i} className="text-[10px] text-rose-500 py-1 border-b border-rose-50 last:border-0 dark:border-rose-900/10">
                                                    {err.empNo ? `Emp ${err.empNo}: ` : ''} {err.error}
                                                </div>
                                            ))}
                                            {stats.errors.length > 10 && <div className="text-[10px] text-slate-400 text-center">... and {stats.errors.length - 10} more</div>}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {error && (
                        <div className="mt-4 flex items-center gap-2 rounded-xl bg-rose-50 p-4 text-sm text-rose-600 dark:bg-rose-900/20 dark:text-rose-400">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            {error}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex gap-4 p-6 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                        onClick={step === 'upload' ? () => setStep('select') : onClose}
                        className="flex-1 rounded-2xl border border-slate-200 py-3 text-sm font-bold text-slate-600 transition-all hover:bg-slate-50 dark:border-slate-800 dark:text-slate-400"
                        disabled={uploading}
                    >
                        {step === 'upload' ? 'Back' : 'Cancel'}
                    </button>
                    {step === 'select' ? (
                        <button
                            onClick={handleDownloadTemplate}
                            disabled={selectedFields.length === 0}
                            className="flex-[2] flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/20 transition-all hover:bg-indigo-700 disabled:opacity-50"
                        >
                            <Download className="h-4 w-4" />
                            Download & Continue
                        </button>
                    ) : (
                        <button
                            onClick={handleUpload}
                            disabled={!file || uploading}
                            className={`flex-[2] rounded-2xl py-3 text-sm font-bold text-white shadow-lg transition-all ${!file ? 'bg-slate-300' : 'bg-emerald-600 shadow-emerald-500/20 hover:bg-emerald-700'
                                }`}
                        >
                            {uploading ? 'Processing...' : 'Run Update'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
