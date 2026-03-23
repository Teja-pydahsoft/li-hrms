'use client';

import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { toast } from 'react-toastify';
import { alertConfirm } from '@/lib/customSwal';
import { SettingsSkeleton } from './SettingsSkeleton';
import { Settings, Calculator, RefreshCw, Save, AlertTriangle, Calendar, ChevronRight, Clock } from 'lucide-react';

interface LeavePolicySettings {
    financialYear: {
        startMonth: number;
        startDay: number;
        useCalendarYear: boolean;
    };
    earnedLeave: {
        enabled: boolean;
        earningType: 'attendance_based' | 'fixed';
        includeInMonthlyLimit?: boolean;
        useAsPaidInPayroll?: boolean;
        attendanceRules: {
            minDaysForFirstEL: number;
            daysPerEL: number;
            maxELPerMonth: number;
            maxELPerYear: number;
            considerPresentDays: boolean;
            considerHolidays: boolean;
            attendanceRanges: Array<{
                minDays: number;
                maxDays: number;
                elEarned: number;
                description: string;
            }>;
        };
        fixedRules: {
            elPerMonth: number;
            maxELPerYear: number;
        };
    };
    carryForward: {
        casualLeave: {
            enabled: boolean;
            maxMonths: number;
            expiryMonths: number;
            carryForwardToNextYear: boolean;
        };
        earnedLeave: {
            enabled: boolean;
            maxMonths: number;
            expiryMonths: number;
            carryForwardToNextYear: boolean;
        };
        compensatoryOff: {
            enabled: boolean;
            maxMonths: number;
            expiryMonths: number;
            carryForwardToNextYear: boolean;
        };
    };
    annualCLReset: {
        enabled: boolean;
        resetToBalance: number;
        /** Experience-based CL tiers (optional). First matching tier by years of service wins. */
        casualLeaveByExperience: Array<{ minYears: number; maxYears: number; casualLeave: number; description?: string }>;
        addCarryForward: boolean;
        /** When true, reset date = start of first payroll period (e.g. 26 Dec when payroll is 26th–25th). */
        usePayrollCycleForReset: boolean;
        resetMonth: number;
        resetDay: number;
    };
    autoUpdate: {
        enabled: boolean;
        updateFrequency: 'daily' | 'weekly' | 'monthly';
        updateDay: number;
    };
    monthlyLimitSettings: {
        mode: 'strict' | 'accumulative' | 'unrestricted';
        defaultMonthlyCap: number;
        maxUsableLimit: number;
        protectFutureMonths: boolean;
        includeCCL: boolean;
        includeEL: boolean;
        logicType: 'ADDITIVE' | 'CAP_INCLUSIVE';
    };
}

interface InitialSyncPreviewRow {
    employeeId: string;
    empNo: string;
    employeeName: string;
    designation?: string;
    department?: string;
    division?: string;
    currentBalances: { CL: number; EL: number; CCL: number };
    proposedBalances: { CL: number; EL: number; CCL: number };
}

const LeavePolicySettings = () => {
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState<any>(null);
    const [syncPreviewOpen, setSyncPreviewOpen] = useState(false);
    const [syncPreviewLoading, setSyncPreviewLoading] = useState(false);
    const [syncPreviewRows, setSyncPreviewRows] = useState<InitialSyncPreviewRow[]>([]);
    const [syncPreviewSearch, setSyncPreviewSearch] = useState('');
    const [syncApplyReason, setSyncApplyReason] = useState('');

    useEffect(() => {
        loadSettings();
    }, []);

    const getDefaultSettings = (): LeavePolicySettings => ({
        financialYear: {
            startMonth: 4,
            startDay: 1,
            useCalendarYear: false
        },
        earnedLeave: {
            enabled: true,
            earningType: 'attendance_based',
            includeInMonthlyLimit: true,
            useAsPaidInPayroll: true,
            attendanceRules: {
                minDaysForFirstEL: 20,
                daysPerEL: 20,
                maxELPerMonth: 2,
                maxELPerYear: 12,
                considerPresentDays: true,
                considerHolidays: true,
                attendanceRanges: [
                    { minDays: 1, maxDays: 10, elEarned: 0, description: '01-10 days = 0 EL' },
                    { minDays: 11, maxDays: 20, elEarned: 1, description: '11-20 days = 1 EL' },
                    { minDays: 21, maxDays: 25, elEarned: 1, description: '21-25 days = 1 EL' },
                    { minDays: 26, maxDays: 31, elEarned: 2, description: '26-31 days = 2 EL' }
                ]
            },
            fixedRules: {
                elPerMonth: 1,
                maxELPerYear: 12
            }
        },
        carryForward: {
            casualLeave: {
                enabled: true,
                maxMonths: 12,
                expiryMonths: 12,
                carryForwardToNextYear: true
            },
            earnedLeave: {
                enabled: true,
                maxMonths: 24,
                expiryMonths: 60,
                carryForwardToNextYear: true
            },
            compensatoryOff: {
                enabled: true,
                maxMonths: 6,
                expiryMonths: 6,
                carryForwardToNextYear: false
            }
        },
        annualCLReset: {
            enabled: true,
            resetToBalance: 12,
            casualLeaveByExperience: [],
            addCarryForward: true,
            usePayrollCycleForReset: false,
            resetMonth: 4,
            resetDay: 1
        },
        autoUpdate: {
            enabled: true,
            updateFrequency: 'monthly',
            updateDay: 1
        },
        monthlyLimitSettings: {
            mode: 'accumulative',
            defaultMonthlyCap: 1,
            maxUsableLimit: 4,
            protectFutureMonths: true,
            includeCCL: true,
            includeEL: true,
            logicType: 'ADDITIVE'
        }
    });

    const loadSettings = async () => {
        try {
            setLoading(true);
            const res = await api.getLeavePolicySettings();
            const defaults = getDefaultSettings();
            if (res.success && res.data) {
                const data = res.data as Record<string, any>;
                setSettings({
                    financialYear: { ...defaults.financialYear, ...data.financialYear },
                    earnedLeave: {
                        enabled: data.earnedLeave?.enabled ?? defaults.earnedLeave.enabled,
                        earningType: data.earnedLeave?.earningType ?? defaults.earnedLeave.earningType,
                        includeInMonthlyLimit: data.earnedLeave?.includeInMonthlyLimit ?? defaults.earnedLeave.includeInMonthlyLimit,
                        useAsPaidInPayroll: data.earnedLeave?.useAsPaidInPayroll ?? defaults.earnedLeave.useAsPaidInPayroll,
                        attendanceRules: {
                            ...defaults.earnedLeave.attendanceRules,
                            ...data.earnedLeave?.attendanceRules,
                            // Backend stores under earnedLeave.attendanceRules.attendanceRanges (legacy: earnedLeave.attendanceRanges)
                            attendanceRanges: Array.isArray(data.earnedLeave?.attendanceRules?.attendanceRanges)
                                ? data.earnedLeave.attendanceRules.attendanceRanges
                                : Array.isArray(data.earnedLeave?.attendanceRanges)
                                    ? data.earnedLeave.attendanceRanges
                                    : defaults.earnedLeave.attendanceRules.attendanceRanges
                        },
                        fixedRules: { ...defaults.earnedLeave.fixedRules, ...data.earnedLeave?.fixedRules }
                    },
                    carryForward: {
                        casualLeave: { ...defaults.carryForward.casualLeave, ...data.carryForward?.casualLeave },
                        earnedLeave: { ...defaults.carryForward.earnedLeave, ...data.carryForward?.earnedLeave },
                        compensatoryOff: { ...defaults.carryForward.compensatoryOff, ...data.carryForward?.compensatoryOff }
                    },
                    annualCLReset: {
                        ...defaults.annualCLReset,
                        ...data.annualCLReset,
                        casualLeaveByExperience: Array.isArray(data.annualCLReset?.casualLeaveByExperience)
                            ? data.annualCLReset.casualLeaveByExperience
                            : (defaults.annualCLReset.casualLeaveByExperience || [])
                    },
                    autoUpdate: { ...defaults.autoUpdate, ...data.autoUpdate },
                    monthlyLimitSettings: { 
                        ...defaults.monthlyLimitSettings, 
                        ...(data.monthlyLimitSettings || {
                            // Support legacy flag for EL inclusion if new object missing
                            includeEL: data.earnedLeave?.includeInMonthlyLimit ?? defaults.monthlyLimitSettings.includeEL
                        })
                    }
                });
            } else {
                setSettings(getDefaultSettings());
                console.log('[LeavePolicySettings] Using default settings');
            }
        } catch (error: any) {
            console.error('Error loading settings:', error);
            toast.error('Failed to load leave policy settings');
        } finally {
            setLoading(false);
        }
    };

    const saveSettings = async () => {
        if (!settings) return;
        
        setSaving(true);
        try {
            await api.updateLeavePolicySettings(settings);
            toast.success('Leave policy settings saved successfully!');
        } catch (error: any) {
            console.error('Error saving settings:', error);
            toast.error('Error saving settings: ' + error.message);
        } finally {
            setSaving(false);
        }
    };

    const updateSettings = (section: string, field: string, value: any) => {
        if (!settings) return;
        
        const keys = section.split('.');
        const updatedSettings = { ...settings };
        
        // Navigate nested object
        let current: any = updatedSettings;
        for (let i = 0; i < keys.length - 1; i++) {
            current = current[keys[i]];
        }
        
        // Special handling for attendanceRanges array
        if (keys[keys.length - 1] === 'attendanceRanges' && Array.isArray(value)) {
            current[keys[keys.length - 1]] = value;
        } else {
            current[keys[keys.length - 1]] = value;
        }
        
        setSettings(updatedSettings);
    };

    const addAttendanceRange = () => {
        if (!settings) return;
        
        const newRange = {
            minDays: 1,
            maxDays: 10,
            elEarned: 0,
            description: '01-10 days = 0 EL'
        };
        
        const updatedRanges = [...(settings.earnedLeave?.attendanceRules?.attendanceRanges ?? []), newRange];
        
        updateSettings('earnedLeave.attendanceRules.attendanceRanges', '', updatedRanges);
        toast.success('Attendance range added successfully!');
    };

    const removeAttendanceRange = (index: number) => {
        const ranges = settings?.earnedLeave?.attendanceRules?.attendanceRanges;
        if (!settings || !Array.isArray(ranges)) return;
        
        const updatedRanges = ranges.filter((_, i) => i !== index);
        
        updateSettings('earnedLeave.attendanceRules.attendanceRanges', '', updatedRanges);
        toast.success('Attendance range removed successfully!');
    };

    const updateAttendanceRange = (index: number, field: string, value: any) => {
        const ranges = settings?.earnedLeave?.attendanceRules?.attendanceRanges;
        if (!settings || !Array.isArray(ranges)) return;
        
        const updatedRanges = [...ranges];
        updatedRanges[index] = {
            ...updatedRanges[index],
            [field]: value
        };
        
        updateSettings('earnedLeave.attendanceRules.attendanceRanges', '', updatedRanges);
    };

    const openInitialSyncPreview = async () => {
        try {
            setSyncPreviewLoading(true);
            const res = await api.previewInitialCLSync({ page: 1, limit: 1000 });
            if (!res?.success) {
                toast.error(res?.message || 'Failed to load initial sync preview');
                return;
            }
            const rows = (res?.data?.employees || []) as InitialSyncPreviewRow[];
            setSyncPreviewRows(
                rows.map((r) => ({
                    ...r,
                    proposedBalances: {
                        CL: Number(r?.proposedBalances?.CL ?? r?.currentBalances?.CL ?? 0),
                        EL: Number(r?.proposedBalances?.EL ?? r?.currentBalances?.EL ?? 0),
                        CCL: Number(r?.proposedBalances?.CCL ?? r?.currentBalances?.CCL ?? 0),
                    },
                }))
            );
            setSyncPreviewSearch('');
            setSyncApplyReason('');
            setSyncPreviewOpen(true);
        } catch (e: any) {
            const msg = String(e?.message || '');
            if (msg.toLowerCase().includes('not found')) {
                toast.error('Preview API not available yet. Please restart backend and try again.');
            } else {
                toast.error(msg || 'Failed to load preview');
            }
        } finally {
            setSyncPreviewLoading(false);
        }
    };

    const applyInitialSyncFromPreview = async () => {
        if (syncPreviewRows.length === 0) {
            toast.info('No employees to apply');
            return;
        }
        const { isConfirmed } = await alertConfirm(
            'Apply reviewed initial sync?',
            `This will create adjustment transactions for ${syncPreviewRows.length} employees.`,
            'Apply'
        );
        if (!isConfirmed) return;

        try {
            setSaving(true);
            const payload = {
                confirm: true,
                reason: syncApplyReason?.trim() || undefined,
                employees: syncPreviewRows.map((r) => ({
                    employeeId: r.employeeId,
                    targetCL: Number(r.proposedBalances.CL ?? 0),
                    targetEL: Number(r.proposedBalances.EL ?? 0),
                    targetCCL: Number(r.proposedBalances.CCL ?? 0),
                })),
            };
            const res = await api.applyInitialCLSync(payload);
            if (res?.success) {
                toast.success(res?.message || 'Initial sync applied successfully.');
                setSyncPreviewOpen(false);
            } else {
                toast.error(res?.message || 'Initial sync apply failed.');
            }
        } catch (e: any) {
            toast.error(e?.message || 'Initial sync apply failed.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <SettingsSkeleton />;

    if (!settings) {
        return (
            <div className="flex items-center justify-center min-h-96">
                <div className="text-center">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Loading Settings...</h3>
                    <p className="text-gray-500 dark:text-gray-400">Please wait while we load leave policy settings</p>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full max-w-full space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="mb-10 flex items-end justify-between flex-wrap gap-4 border-b border-gray-200 dark:border-gray-800 pb-8">
                <div>
                    <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-2">
                        <span>Settings</span>
                        <ChevronRight className="h-3 w-3" />
                        <span className="text-indigo-600 dark:text-indigo-400">Leave Policy</span>
                    </div>
                    <h2 className="text-3xl font-black tracking-tight text-gray-900 dark:text-white">Leave Policy Configuration</h2>
                    <p className="mt-2 text-sm font-medium text-gray-500 dark:text-gray-400">
                        Configure financial year, earned leave rules, carry forward, and annual CL reset.
                    </p>
                </div>
                <button
                    onClick={saveSettings}
                    disabled={saving}
                    className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors text-sm font-medium shadow-sm"
                >
                    <Save className="w-4 h-4" />
                    {saving ? 'Saving...' : 'Save Settings'}
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 w-full">
                {/* ——— Left column: Financial Year + EL Earning Rules ——— */}
                <div className="space-y-8 min-w-0">
                    {/* 1. Financial Year */}
                    <section className="bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
                        <div className="px-6 sm:px-8 py-6 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
                            <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800/50">
                                <Calendar className="h-5 w-5" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Financial Year</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Leave cycles and annual reset.</p>
                            </div>
                        </div>
                        <div className="p-6 sm:p-8 space-y-6">

                        {/* Use calendar year — same toggle style as Leave Settings (Backdated / Future Dated) */}
                        <div className="flex items-center justify-between gap-4 p-3 rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 mb-4">
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Use calendar year (Jan–Dec)</span>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={settings.financialYear.useCalendarYear}
                                onClick={() => updateSettings('financialYear.useCalendarYear', '', !settings.financialYear.useCalendarYear)}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${settings.financialYear.useCalendarYear ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'}`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${settings.financialYear.useCalendarYear ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                        </div>

                        {!settings.financialYear.useCalendarYear && (
                            <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-1 duration-200">
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Start Month</label>
                                    <select
                                        value={settings.financialYear.startMonth}
                                        onChange={(e) => updateSettings('financialYear.startMonth', '', parseInt(e.target.value))}
                                        className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                                    >
                                        {[...Array(12)].map((_, i) => (
                                            <option key={i} value={i + 1}>{new Date(0, i).toLocaleString('default', { month: 'long' })}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Start Day</label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="31"
                                        value={settings.financialYear.startDay}
                                        onChange={(e) => updateSettings('financialYear.startDay', '', parseInt(e.target.value))}
                                        className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                                    />
                                </div>
                            </div>
                        )}
                        </div>
                    </section>

                    {/* 2. EL Earning Rules */}
                    <section className="bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
                        <div className="px-6 sm:px-8 py-6 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
                            <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800/50">
                                <Calculator className="h-5 w-5" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">EL Earning Rules</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Enable earned leave and set how EL is accrued (attendance-based or fixed).</p>
                            </div>
                        </div>
                        <div className="p-6 sm:p-8 space-y-6">

                        {/* Enable EL — same toggle style as Financial Year / Backdated */}
                        <div className="flex items-center justify-between gap-4 p-3 rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 mb-4">
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Enable Earned Leave (EL)</span>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={settings.earnedLeave.enabled}
                                onClick={() => updateSettings('earnedLeave.enabled', '', !settings.earnedLeave.enabled)}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${settings.earnedLeave.enabled ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'}`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${settings.earnedLeave.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                        </div>

                        {!settings.earnedLeave.enabled && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 italic">EL is disabled. Turn on to configure earning type and rules.</p>
                        )}

                        {settings.earnedLeave.enabled && (
                        <>
                        <div className="flex flex-col gap-3 mb-4">
                            <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2">
                                These two are opposite: when one is on, the other is off. When one is off, the other is off unless you turn it on.
                            </p>
                            <div className="flex items-center justify-between gap-4 p-3 rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30">
                                <div>
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Include EL in monthly allowed limit</span>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">When on, EL counts toward the leave register “month limit” (CL + CCL + EL).</p>
                                </div>
                                <button type="button" role="switch" aria-checked={settings.earnedLeave.includeInMonthlyLimit !== false}
                                    onClick={() => {
                                        const turnOn = settings.earnedLeave.includeInMonthlyLimit === false;
                                        setSettings((prev: any) => ({
                                            ...prev,
                                            earnedLeave: {
                                                ...prev.earnedLeave,
                                                includeInMonthlyLimit: turnOn,
                                                useAsPaidInPayroll: turnOn ? false : prev.earnedLeave.useAsPaidInPayroll
                                            }
                                        }));
                                    }}
                                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${settings.earnedLeave.includeInMonthlyLimit !== false ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'}`}>
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${settings.earnedLeave.includeInMonthlyLimit !== false ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>
                            <div className="flex items-center justify-between gap-4 p-3 rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30">
                                <div>
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Use EL as paid days in payroll</span>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">When on, EL days availed count as paid (salary). When off, EL is leave-only (no pay for those days).</p>
                                </div>
                                <button type="button" role="switch" aria-checked={settings.earnedLeave.useAsPaidInPayroll !== false}
                                    onClick={() => {
                                        const turnOn = settings.earnedLeave.useAsPaidInPayroll === false;
                                        setSettings((prev: any) => ({
                                            ...prev,
                                            earnedLeave: {
                                                ...prev.earnedLeave,
                                                useAsPaidInPayroll: turnOn,
                                                includeInMonthlyLimit: turnOn ? false : prev.earnedLeave.includeInMonthlyLimit
                                            }
                                        }));
                                    }}
                                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${settings.earnedLeave.useAsPaidInPayroll !== false ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'}`}>
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${settings.earnedLeave.useAsPaidInPayroll !== false ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        </div>
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
                            <div className="space-y-1.5">
                                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Earning type</label>
                                <select
                                    value={settings.earnedLeave.earningType}
                                    onChange={(e) => updateSettings('earnedLeave.earningType', '', e.target.value)}
                                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                                >
                                    <option value="attendance_based">Attendance based</option>
                                    <option value="fixed">Fixed amount</option>
                                </select>
                            </div>

                            {settings.earnedLeave.earningType === 'attendance_based' && (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1.5">
                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Min days (first EL)</label>
                                            <input type="number" min="1" max="31" value={settings.earnedLeave.attendanceRules.minDaysForFirstEL}
                                                onChange={(e) => updateSettings('earnedLeave.attendanceRules.minDaysForFirstEL', '', parseInt(e.target.value))}
                                                className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Days per EL</label>
                                            <input type="number" min="1" max="31" value={settings.earnedLeave.attendanceRules.daysPerEL}
                                                onChange={(e) => updateSettings('earnedLeave.attendanceRules.daysPerEL', '', parseInt(e.target.value))}
                                                className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Max EL / month</label>
                                            <input type="number" min="0" max="10" value={settings.earnedLeave.attendanceRules.maxELPerMonth}
                                                onChange={(e) => updateSettings('earnedLeave.attendanceRules.maxELPerMonth', '', parseInt(e.target.value))}
                                                className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Max EL / year</label>
                                            <input type="number" min="0" max="50" value={settings.earnedLeave.attendanceRules.maxELPerYear}
                                                onChange={(e) => updateSettings('earnedLeave.attendanceRules.maxELPerYear', '', parseInt(e.target.value))}
                                                className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all" />
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-4">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="checkbox" checked={settings.earnedLeave.attendanceRules.considerPresentDays}
                                                onChange={(e) => updateSettings('earnedLeave.attendanceRules.considerPresentDays', '', e.target.checked)}
                                                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                                            <span className="text-sm text-gray-700 dark:text-gray-300">Consider present days</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="checkbox" checked={settings.earnedLeave.attendanceRules.considerHolidays}
                                                onChange={(e) => updateSettings('earnedLeave.attendanceRules.considerHolidays', '', e.target.checked)}
                                                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                                            <span className="text-sm text-gray-700 dark:text-gray-300">Consider holidays</span>
                                        </label>
                                    </div>
                                </div>
                            )}

                            {settings.earnedLeave.earningType === 'fixed' && (
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">EL per month</label>
                                        <input type="number" min="0" max="10" value={settings.earnedLeave.fixedRules.elPerMonth}
                                            onChange={(e) => updateSettings('earnedLeave.fixedRules.elPerMonth', '', parseInt(e.target.value))}
                                            className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Max EL / year</label>
                                        <input type="number" min="0" max="50" value={settings.earnedLeave.fixedRules.maxELPerYear}
                                            onChange={(e) => updateSettings('earnedLeave.fixedRules.maxELPerYear', '', parseInt(e.target.value))}
                                            className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all" />
                                    </div>
                                </div>
                            )}
                        </div>

                        {settings.earnedLeave.earningType === 'attendance_based' && (
                            <div className="border-t border-gray-200 dark:border-gray-800 pt-4 mt-4">
                                <div className="flex justify-between items-center mb-3">
                                    <h4 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Attendance ranges (cumulative)</h4>
                                    <button type="button" onClick={() => addAttendanceRange()}
                                        className="px-3 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 text-xs font-medium transition-colors">
                                        Add range
                                    </button>
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 p-3 rounded-xl mb-4 border border-gray-100 dark:border-gray-700">
                                    Each range adds EL when attendance falls in that band. Example: 25 days → 0+1+1+2 = 4 EL.
                                </p>
                                <div className="grid grid-cols-1 gap-4">
                                        {(settings.earnedLeave?.attendanceRules?.attendanceRanges ?? []).map((range: any, index: number) => (
                                            <div key={index} className="bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 p-4 space-y-4">
                                                <div className="flex justify-between items-center">
                                                    <h4 className="text-sm font-medium text-gray-900 dark:text-white">Range {index + 1}</h4>
                                                    <button
                                                        onClick={() => removeAttendanceRange(index)}
                                                        className="px-3 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 text-xs font-medium transition-colors"
                                                    >
                                                        Remove
                                                    </button>
                                                </div>

                                                <div className="grid grid-cols-2 gap-4">
                                                    <div className="space-y-2">
                                                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest">
                                                            Min Days
                                                        </label>
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            max="31"
                                                            value={range.minDays}
                                                            onChange={(e) => updateAttendanceRange(index, 'minDays', parseInt(e.target.value))}
                                                            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20"
                                                        />
                                                    </div>

                                                    <div className="space-y-2">
                                                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest">
                                                            Max Days
                                                        </label>
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            max="31"
                                                            value={range.maxDays}
                                                            onChange={(e) => updateAttendanceRange(index, 'maxDays', parseInt(e.target.value))}
                                                            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20"
                                                        />
                                                    </div>

                                                    <div className="space-y-2">
                                                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest">
                                                            EL Earned
                                                        </label>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            max="10"
                                                            value={range.elEarned}
                                                            onChange={(e) => updateAttendanceRange(index, 'elEarned', parseInt(e.target.value))}
                                                            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20"
                                                        />
                                                    </div>

                                                    <div className="space-y-2">
                                                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest">
                                                            Description
                                                        </label>
                                                        <input
                                                            type="text"
                                                            value={range.description}
                                                            onChange={(e) => updateAttendanceRange(index, 'description', e.target.value)}
                                                            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20"
                                                        />
                                                    </div>
                                                </div>

                                                <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 p-3 rounded-xl border border-gray-100 dark:border-gray-700">
                                                    {String(range.minDays).padStart(2, '0')}-{range.maxDays} days = {range.elEarned} EL
                                                </div>
                                            </div>
                                        ))}
                                </div>
                            </div>
                        )}
                        </>
                        )}
                        </div>
                    </section>
                </div>

                {/* ——— Center/Right column: Monthly Limit Logic + Carry Forward ——— */}
                <div className="space-y-8 min-w-0">
                    {/* 2.5 Monthly Limit Logic */}
                    <section className="bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
                        <div className="px-6 sm:px-8 py-6 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
                            <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800/50">
                                <Settings className="h-5 w-5" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Monthly Limit Logic</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Configure how CL, CCL, and EL interact.</p>
                            </div>
                        </div>
                        <div className="p-6 sm:p-8 space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Limit Mode</label>
                                    <select
                                        value={settings.monthlyLimitSettings?.mode || 'accumulative'}
                                        onChange={(e) => updateSettings('monthlyLimitSettings.mode', '', e.target.value)}
                                        className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                                    >
                                        <option value="strict">Strict (Monthly quota lost if unused)</option>
                                        <option value="accumulative">Accumulative (Carry-forward limit)</option>
                                        <option value="unrestricted">Unrestricted (Allowed = Daily Balance)</option>
                                    </select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Monthly Usage Cap</label>
                                    <input
                                        type="number"
                                        min={0}
                                        value={settings.monthlyLimitSettings?.defaultMonthlyCap ?? 1}
                                        onChange={(e) => updateSettings('monthlyLimitSettings.defaultMonthlyCap', '', parseInt(e.target.value) || 0)}
                                        className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Max Usable (Master Cap)</label>
                                    <input
                                        type="number"
                                        min={1}
                                        value={settings.monthlyLimitSettings?.maxUsableLimit ?? 4}
                                        onChange={(e) => updateSettings('monthlyLimitSettings.maxUsableLimit', '', parseInt(e.target.value) || 1)}
                                        className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Calculation Type</label>
                                    <select
                                        value={settings.monthlyLimitSettings?.logicType || 'ADDITIVE'}
                                        onChange={(e) => updateSettings('monthlyLimitSettings.logicType', '', e.target.value)}
                                        className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                                    >
                                        <option value="ADDITIVE">Additive (Limit + CCL + EL)</option>
                                        <option value="CAP_INCLUSIVE">Absolute Cap (Total allowance = Cap)</option>
                                    </select>
                                </div>
                            </div>

                            <div className="flex flex-col gap-3">
                                <div className="flex items-center justify-between gap-4 p-3 rounded-xl border border-gray-100 dark:border-gray-700 bg-emerald-50/30 dark:bg-emerald-900/10">
                                    <div className="flex-1">
                                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Safety Rule: Protect Future Months</span>
                                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 italic">Ensures at least 1 leave remains available for each remaining month of the year.</p>
                                    </div>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={settings.monthlyLimitSettings?.protectFutureMonths}
                                        onClick={() => updateSettings('monthlyLimitSettings.protectFutureMonths', '', !settings.monthlyLimitSettings?.protectFutureMonths)}
                                        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${settings.monthlyLimitSettings?.protectFutureMonths ? 'bg-emerald-600' : 'bg-gray-200 dark:bg-gray-700'}`}
                                    >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${settings.monthlyLimitSettings?.protectFutureMonths ? 'translate-x-6' : 'translate-x-1'}`} />
                                    </button>
                                </div>

                                <div className="flex items-center justify-between gap-4 p-3 rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30">
                                    <div>
                                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Include CCL in monthly limit</span>
                                    </div>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={settings.monthlyLimitSettings?.includeCCL}
                                        onClick={() => updateSettings('monthlyLimitSettings.includeCCL', '', !settings.monthlyLimitSettings?.includeCCL)}
                                        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${settings.monthlyLimitSettings?.includeCCL ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'}`}
                                    >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${settings.monthlyLimitSettings?.includeCCL ? 'translate-x-6' : 'translate-x-1'}`} />
                                    </button>
                                </div>

                                <div className="flex items-center justify-between gap-4 p-3 rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30">
                                    <div>
                                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Include EL in monthly limit</span>
                                    </div>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={settings.monthlyLimitSettings?.includeEL}
                                        onClick={() => {
                                            const newVal = !settings.monthlyLimitSettings?.includeEL;
                                            setSettings((prev: any) => ({
                                                ...prev,
                                                monthlyLimitSettings: { ...(prev?.monthlyLimitSettings || {}), includeEL: newVal },
                                                // Sync with legacy flag
                                                earnedLeave: { ...(prev?.earnedLeave || {}), includeInMonthlyLimit: newVal }
                                            }));
                                        }}
                                        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${settings.monthlyLimitSettings?.includeEL ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'}`}
                                    >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${settings.monthlyLimitSettings?.includeEL ? 'translate-x-6' : 'translate-x-1'}`} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* 3. Carry Forward */}
                    <section className="bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
                        <div className="px-6 sm:px-8 py-6 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
                            <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800/50">
                                <RefreshCw className="h-5 w-5" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Carry Forward</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">CL, EL & CCL carry forward and expiry.</p>
                            </div>
                        </div>
                        <div className="p-6 sm:p-8">
                        <div className="grid grid-cols-1 gap-6">
                            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 p-4 space-y-3">
                                <h4 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Casual Leave (CL)</h4>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={settings.carryForward.casualLeave.enabled}
                                        onChange={(e) => updateSettings('carryForward.casualLeave.enabled', '', e.target.checked)}
                                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">Enable carry forward</span>
                                </label>
                                {settings.carryForward.casualLeave.enabled && (
                                    <div className="grid grid-cols-2 gap-3 pt-1">
                                        <div className="space-y-1.5">
                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Max months</label>
                                            <input type="number" min="1" max="12" value={settings.carryForward.casualLeave.maxMonths}
                                                onChange={(e) => updateSettings('carryForward.casualLeave.maxMonths', '', parseInt(e.target.value))}
                                                className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Expiry months</label>
                                            <input type="number" min="1" max="12" value={settings.carryForward.casualLeave.expiryMonths}
                                                onChange={(e) => updateSettings('carryForward.casualLeave.expiryMonths', '', parseInt(e.target.value))}
                                                className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all" />
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 p-4 space-y-3">
                                <h4 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Earned Leave (EL)</h4>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={settings.carryForward.earnedLeave.enabled}
                                        onChange={(e) => updateSettings('carryForward.earnedLeave.enabled', '', e.target.checked)}
                                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">Enable carry forward</span>
                                </label>
                                {settings.carryForward.earnedLeave.enabled && (
                                    <div className="grid grid-cols-2 gap-3 pt-1">
                                        <div className="space-y-1.5">
                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Max months</label>
                                            <input type="number" min="1" max="12" value={settings.carryForward.earnedLeave.maxMonths}
                                                onChange={(e) => updateSettings('carryForward.earnedLeave.maxMonths', '', parseInt(e.target.value))}
                                                className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Expiry months</label>
                                            <input type="number" min="1" max="12" value={settings.carryForward.earnedLeave.expiryMonths}
                                                onChange={(e) => updateSettings('carryForward.earnedLeave.expiryMonths', '', parseInt(e.target.value))}
                                                className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all" />
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 p-4 space-y-3">
                                <h4 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Compensatory Off (CCL)</h4>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={settings.carryForward.compensatoryOff.enabled}
                                        onChange={(e) => updateSettings('carryForward.compensatoryOff.enabled', '', e.target.checked)}
                                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">Enable carry forward</span>
                                </label>
                                {settings.carryForward.compensatoryOff.enabled && (
                                    <>
                                        <div className="grid grid-cols-2 gap-3 pt-1">
                                            <div className="space-y-1.5">
                                                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Max months</label>
                                                <input type="number" min="1" max="12" value={settings.carryForward.compensatoryOff.maxMonths}
                                                    onChange={(e) => updateSettings('carryForward.compensatoryOff.maxMonths', '', parseInt(e.target.value))}
                                                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all" />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Expiry months</label>
                                                <input type="number" min="1" max="12" value={settings.carryForward.compensatoryOff.expiryMonths}
                                                    onChange={(e) => updateSettings('carryForward.compensatoryOff.expiryMonths', '', parseInt(e.target.value))}
                                                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all" />
                                            </div>
                                        </div>
                                        <label className="flex items-center gap-2 cursor-pointer pt-1">
                                            <input type="checkbox" checked={settings.carryForward.compensatoryOff.carryForwardToNextYear}
                                                onChange={(e) => updateSettings('carryForward.compensatoryOff.carryForwardToNextYear', '', e.target.checked)}
                                                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                                            <span className="text-sm text-gray-700 dark:text-gray-300">Carry to next year</span>
                                        </label>
                                    </>
                                )}
                            </div>
                        </div>
                        </div>
                    </section>

                    {/* 4. Annual CL Reset */}
                    <section className="bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
                        <div className="px-6 sm:px-8 py-6 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
                            <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800/50">
                                <AlertTriangle className="h-5 w-5" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Annual CL Reset</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Reset CL at configured date (pay cycle / year). Default entitlement or experience-based tiers; optional carry forward.</p>
                            </div>
                        </div>
                        <div className="p-6 sm:p-8 space-y-6">
                        <label className="flex items-center gap-2 cursor-pointer mb-4">
                            <input type="checkbox" checked={settings.annualCLReset.enabled}
                                onChange={(e) => updateSettings('annualCLReset.enabled', '', e.target.checked)}
                                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                            <span className="text-sm text-gray-700 dark:text-gray-300">Enable annual reset</span>
                        </label>
                        {settings.annualCLReset.enabled && (
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Default CL entitlement</label>
                                        <input type="number" min="0" max="365" value={settings.annualCLReset.resetToBalance}
                                            onChange={(e) => updateSettings('annualCLReset.resetToBalance', '', parseInt(e.target.value) || 0)}
                                            className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                                            title="Used for all employees when experience tiers are empty or no tier matches" />
                                        <p className="text-[10px] text-gray-500 dark:text-gray-400">Used when no experience tier matches</p>
                                    </div>
                                </div>
                                <label className="flex items-center gap-2 cursor-pointer mt-3">
                                    <input type="checkbox" checked={settings.annualCLReset.usePayrollCycleForReset === true}
                                        onChange={(e) => updateSettings('annualCLReset.usePayrollCycleForReset', '', e.target.checked)}
                                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">Use payroll cycle for reset date</span>
                                </label>
                                <p className="text-[10px] text-gray-500 dark:text-gray-400 ml-6">When on: reset = start of first payroll period of the year (e.g. 26 Dec when payroll is 26th–25th). Off = use month/day below.</p>
                                {!settings.annualCLReset.usePayrollCycleForReset && (
                                <div className="grid grid-cols-2 gap-3 mt-2">
                                    <div className="space-y-1.5">
                                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Reset month</label>
                                        <select value={settings.annualCLReset.resetMonth}
                                            onChange={(e) => updateSettings('annualCLReset.resetMonth', '', parseInt(e.target.value))}
                                            className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all">
                                            {[...Array(12)].map((_, i) => (
                                                <option key={i} value={i + 1}>{new Date(0, i).toLocaleString('default', { month: 'long' })}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Reset day</label>
                                        <input type="number" min="1" max="31" value={settings.annualCLReset.resetDay}
                                            onChange={(e) => updateSettings('annualCLReset.resetDay', '', parseInt(e.target.value))}
                                            className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all" />
                                    </div>
                                </div>
                                )}
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={settings.annualCLReset.addCarryForward}
                                        onChange={(e) => updateSettings('annualCLReset.addCarryForward', '', e.target.checked)}
                                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">Add carried CL to reset balance</span>
                                </label>
                                <div className="space-y-2 mt-2">
                                    <h4 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Experience-based CL (optional)</h4>
                                    <p className="text-[10px] text-gray-500 dark:text-gray-400">By years of service at reset date. First matching tier wins. Empty = use default for all.</p>
                                    {(settings.annualCLReset.casualLeaveByExperience || []).map((tier: any, idx: number) => {
                                        const safeNum = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : '');
                                        return (
                                        <div key={idx} className="flex flex-wrap items-center gap-2 py-1">
                                            <input type="number" min={0} placeholder="Min years" value={safeNum(tier.minYears)} onChange={(e) => {
                                                const arr = [...(settings.annualCLReset.casualLeaveByExperience || [])];
                                                arr[idx] = { ...arr[idx], minYears: parseInt(e.target.value, 10) || 0 };
                                                updateSettings('annualCLReset.casualLeaveByExperience', '', arr);
                                            }} className="w-20 px-2.5 py-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20" />
                                            <span className="text-gray-400">–</span>
                                            <input type="number" min={0} placeholder="Max years" value={safeNum(tier.maxYears)} onChange={(e) => {
                                                const arr = [...(settings.annualCLReset.casualLeaveByExperience || [])];
                                                const parsed = parseInt(e.target.value, 10);
                                                arr[idx] = { ...arr[idx], maxYears: Number.isNaN(parsed) ? 999 : parsed };
                                                updateSettings('annualCLReset.casualLeaveByExperience', '', arr);
                                            }} className="w-20 px-2.5 py-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20" />
                                            <input type="number" min={0} placeholder="CL days" value={safeNum(tier.casualLeave)} onChange={(e) => {
                                                const arr = [...(settings.annualCLReset.casualLeaveByExperience || [])];
                                                arr[idx] = { ...arr[idx], casualLeave: parseInt(e.target.value, 10) || 0 };
                                                updateSettings('annualCLReset.casualLeaveByExperience', '', arr);
                                            }} className="w-16 px-2.5 py-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20" />
                                            <button type="button" onClick={() => {
                                                const arr = (settings.annualCLReset.casualLeaveByExperience || []).filter((_: any, i: number) => i !== idx);
                                                updateSettings('annualCLReset.casualLeaveByExperience', '', arr);
                                            }} className="px-3 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl text-xs font-medium transition-colors">Remove</button>
                                        </div>
                                        );
                                    })}
                                    <button type="button" onClick={() => {
                                        const arr = [...(settings.annualCLReset.casualLeaveByExperience || []), { minYears: 0, maxYears: 2, casualLeave: 12, description: '' }];
                                        updateSettings('annualCLReset.casualLeaveByExperience', '', arr);
                                    }} className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">+ Add experience tier</button>
                                </div>
                                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                                    <p className="text-xs text-amber-800 dark:text-amber-200">Reset runs at configured month/day. Entitlement = default or experience tier; then + carry forward if enabled. Use preview before running.</p>
                                </div>
                            </div>
                        )}

                        {/* Initial CL sync (manual) – not annual reset */}
                        <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-800">
                            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 p-4 space-y-3">
                                <h4 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Apply policy to all employees (initial sync)</h4>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Sets each employee&apos;s CL to current policy (default or experience-based) + optional carry forward. Creates one ADJUSTMENT transaction per employee. Use after configuring settings or to align balances. This is not the annual reset.</p>
                                <button
                                    type="button"
                                    onClick={openInitialSyncPreview}
                                    disabled={saving || syncPreviewLoading}
                                    className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl shadow-sm transition-colors"
                                >
                                    {syncPreviewLoading ? 'Preparing preview...' : 'Apply initial CL from policy'}
                                </button>
                            </div>
                        </div>
                        </div>
                    </section>

                    {/* 5. Auto Update */}
                    <section className="bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
                        <div className="px-6 sm:px-8 py-6 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
                            <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800/50">
                                <Clock className="h-5 w-5" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Auto Update</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Schedule automatic balance updates.</p>
                            </div>
                        </div>
                        <div className="p-6 sm:p-8 space-y-6">
                        <label className="flex items-center gap-2 cursor-pointer mb-4">
                            <input type="checkbox" checked={settings.autoUpdate.enabled}
                                onChange={(e) => updateSettings('autoUpdate.enabled', '', e.target.checked)}
                                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                            <span className="text-sm text-gray-700 dark:text-gray-300">Enable auto update</span>
                        </label>
                        {settings.autoUpdate.enabled && (
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Frequency</label>
                                    <select value={settings.autoUpdate.updateFrequency}
                                        onChange={(e) => updateSettings('autoUpdate.updateFrequency', '', e.target.value)}
                                        className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all">
                                        <option value="daily">Daily</option>
                                        <option value="weekly">Weekly</option>
                                        <option value="monthly">Monthly</option>
                                    </select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Update day</label>
                                    <input type="number" min="1" max="31" value={settings.autoUpdate.updateDay}
                                        onChange={(e) => updateSettings('autoUpdate.updateDay', '', parseInt(e.target.value))}
                                        className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all" />
                                </div>
                            </div>
                        )}
                        </div>
                    </section>
                </div>
            </div>

            {syncPreviewOpen && (
                <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-6xl max-h-[90vh] overflow-hidden bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-700 shadow-2xl flex flex-col">
                        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-4">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Initial Sync Preview</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Review and edit CL / EL / CCL target balances before applying.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSyncPreviewOpen(false)}
                                className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                            >
                                Close
                            </button>
                        </div>

                        <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-700 grid grid-cols-1 md:grid-cols-3 gap-3">
                            <input
                                type="text"
                                value={syncPreviewSearch}
                                onChange={(e) => setSyncPreviewSearch(e.target.value)}
                                placeholder="Search employee / emp no / department"
                                className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm"
                            />
                            <input
                                type="text"
                                value={syncApplyReason}
                                onChange={(e) => setSyncApplyReason(e.target.value)}
                                placeholder="Reason (optional)"
                                className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-[#0F172A] text-sm"
                            />
                            <div className="text-xs text-gray-500 dark:text-gray-400 self-center">
                                Rows: {
                                    syncPreviewRows.filter((r) => {
                                        const t = syncPreviewSearch.toLowerCase().trim();
                                        if (!t) return true;
                                        return (
                                            (r.employeeName || '').toLowerCase().includes(t) ||
                                            (r.empNo || '').toLowerCase().includes(t) ||
                                            (r.department || '').toLowerCase().includes(t)
                                        );
                                    }).length
                                }
                            </div>
                        </div>

                        <div className="overflow-auto p-4">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-xs uppercase text-gray-500 border-b border-gray-200 dark:border-gray-700">
                                        <th className="py-2 pr-2">Employee</th>
                                        <th className="py-2 pr-2">Current CL</th>
                                        <th className="py-2 pr-2">Target CL</th>
                                        <th className="py-2 pr-2">Current EL</th>
                                        <th className="py-2 pr-2">Target EL</th>
                                        <th className="py-2 pr-2">Current CCL</th>
                                        <th className="py-2 pr-2">Target CCL</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {syncPreviewRows
                                        .filter((r) => {
                                            const t = syncPreviewSearch.toLowerCase().trim();
                                            if (!t) return true;
                                            return (
                                                (r.employeeName || '').toLowerCase().includes(t) ||
                                                (r.empNo || '').toLowerCase().includes(t) ||
                                                (r.department || '').toLowerCase().includes(t)
                                            );
                                        })
                                        .map((row) => (
                                            <tr key={row.employeeId} className="border-b border-gray-100 dark:border-gray-800">
                                                <td className="py-2 pr-2">
                                                    <div className="font-medium text-gray-900 dark:text-white">{row.employeeName}</div>
                                                    <div className="text-xs text-gray-500">{row.empNo} • {row.department || 'N/A'}</div>
                                                </td>
                                                <td className="py-2 pr-2">{Number(row.currentBalances?.CL || 0)}</td>
                                                <td className="py-2 pr-2">
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step={0.5}
                                                        value={row.proposedBalances.CL}
                                                        onChange={(e) => {
                                                            const v = Number(e.target.value || 0);
                                                            setSyncPreviewRows((prev) => {
                                                                return prev.map((p) => p.employeeId === row.employeeId
                                                                    ? { ...p, proposedBalances: { ...p.proposedBalances, CL: v } }
                                                                    : p
                                                                );
                                                            });
                                                        }}
                                                        className="w-24 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-[#0F172A]"
                                                    />
                                                </td>
                                                <td className="py-2 pr-2">{Number(row.currentBalances?.EL || 0)}</td>
                                                <td className="py-2 pr-2">
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step={0.5}
                                                        value={row.proposedBalances.EL}
                                                        onChange={(e) => {
                                                            const v = Number(e.target.value || 0);
                                                            setSyncPreviewRows((prev) => {
                                                                return prev.map((p) => p.employeeId === row.employeeId
                                                                    ? { ...p, proposedBalances: { ...p.proposedBalances, EL: v } }
                                                                    : p
                                                                );
                                                            });
                                                        }}
                                                        className="w-24 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-[#0F172A]"
                                                    />
                                                </td>
                                                <td className="py-2 pr-2">{Number(row.currentBalances?.CCL || 0)}</td>
                                                <td className="py-2 pr-2">
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step={0.5}
                                                        value={row.proposedBalances.CCL}
                                                        onChange={(e) => {
                                                            const v = Number(e.target.value || 0);
                                                            setSyncPreviewRows((prev) => {
                                                                return prev.map((p) => p.employeeId === row.employeeId
                                                                    ? { ...p, proposedBalances: { ...p.proposedBalances, CCL: v } }
                                                                    : p
                                                                );
                                                            });
                                                        }}
                                                        className="w-24 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-[#0F172A]"
                                                    />
                                                </td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setSyncPreviewOpen(false)}
                                className="px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={applyInitialSyncFromPreview}
                                disabled={saving}
                                className="px-4 py-2 text-sm rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
                            >
                                {saving ? 'Applying...' : 'Proceed Apply'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Save — full width */}
            <div className="flex justify-end pt-6 border-t border-gray-200 dark:border-gray-800">
                <button
                    onClick={saveSettings}
                    disabled={saving}
                    className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 font-medium text-sm shadow-sm"
                >
                    {saving ? 'Saving...' : 'Save changes'}
                </button>
            </div>
            </div>
        );
};

export default LeavePolicySettings;
