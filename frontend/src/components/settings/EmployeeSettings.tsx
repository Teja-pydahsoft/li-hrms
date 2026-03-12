'use client';

import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { toast } from 'react-toastify';

import { SettingsSkeleton } from './SettingsSkeleton';
import { AlertCircle, ChevronRight } from 'lucide-react';

const EmployeeSettings = () => {
    const [employeeDataSource, setEmployeeDataSource] = useState<string>('mongodb');
    const [employeeDeleteTarget, setEmployeeDeleteTarget] = useState<string>('both');
    const [autoGenerateEmployeeNumber, setAutoGenerateEmployeeNumber] = useState(false);
    const [mssqlConnected, setMssqlConnected] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [updateRequestConfig, setUpdateRequestConfig] = useState({
        enabled: false,
        requestableFields: [] as string[],
        allowQualifications: false
    });
    const [defaultApplyStatutoryDeductions, setDefaultApplyStatutoryDeductions] = useState(true);
    const [defaultApplyAttendanceDeductions, setDefaultApplyAttendanceDeductions] = useState(true);
    const [allFields, setAllFields] = useState<{ id: string; label: string; group: string }[]>([]);

    const loadSettings = async () => {
        try {
            setLoading(true);
            const res = await api.getEmployeeSettings();
            if (res.success && res.data) {
                setEmployeeDataSource(res.data.dataSource || 'mongodb');
                setEmployeeDeleteTarget(res.data.deleteTarget || 'both');
                setAutoGenerateEmployeeNumber(!!res.data.auto_generate_employee_number);
                setMssqlConnected(res.data.mssqlConnected || false);
            }

            // Load profile update request config
            const configRes = await api.getSetting('profile_update_request_config');
            if (configRes.success && configRes.data) {
                setUpdateRequestConfig(configRes.data.value);
            }

            // Load deduction defaults
            const statutoryRes = await api.getSetting('default_apply_statutory_deductions');
            if (statutoryRes.success && statutoryRes.data) {
                setDefaultApplyStatutoryDeductions(!!statutoryRes.data.value);
            }
            const attendanceRes = await api.getSetting('default_apply_attendance_deductions');
            if (attendanceRes.success && attendanceRes.data) {
                setDefaultApplyAttendanceDeductions(!!attendanceRes.data.value);
            }

            // Load form settings to get all fields
            const formSettingsRes = await api.getFormSettings();
            if (formSettingsRes.success && formSettingsRes.data) {
                const fields: any[] = [];
                formSettingsRes.data.groups.forEach((group: any) => {
                    group.fields.forEach((field: any) => {
                        fields.push({
                            id: field.id,
                            label: field.label,
                            group: group.name
                        });
                    });
                });
                setAllFields(fields);
            }
        } catch (err) {
            console.error('Error loading employee settings:', err);
            toast.error('Failed to load employee settings');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadSettings();
    }, []);

    const handleSave = async () => {
        try {
            setSaving(true);
            const res = await api.updateEmployeeSettings({
                dataSource: employeeDataSource,
                deleteTarget: employeeDeleteTarget,
                auto_generate_employee_number: autoGenerateEmployeeNumber,
            });

            // Save profile update request config
            await api.upsertSetting({
                key: 'profile_update_request_config',
                value: updateRequestConfig,
                category: 'employee',
                description: 'Configuration for employee profile update requests'
            });

            // Save deduction defaults
            await api.upsertSetting({
                key: 'default_apply_statutory_deductions',
                value: defaultApplyStatutoryDeductions,
                category: 'employee',
                description: 'Default setting for statutory deductions (PT, ESI, PF) for new employees'
            });
            await api.upsertSetting({
                key: 'default_apply_attendance_deductions',
                value: defaultApplyAttendanceDeductions,
                category: 'employee',
                description: 'Default setting for attendance deductions (Late-in, Early-out, etc.) for new employees'
            });

            if (res.success) {
                toast.success('Employee settings saved successfully');
            } else {
                toast.error(res.message || 'Failed to save settings');
            }
        } catch (err) {
            toast.error('An error occurred while saving');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <SettingsSkeleton />;

    return (
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="border-b border-gray-200 dark:border-gray-800 pb-5">
                <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-2">
                    <span>Settings</span>
                    <ChevronRight className="h-3 w-3" />
                    <span className="text-indigo-600">Employee</span>
                </div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Employee Setup</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Configure data sources and deletion policies for employee records.</p>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
                <div className="xl:col-span-2 space-y-8">
                    <section className="bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden p-4 sm:p-6 lg:p-8">
                        <div className="px-8 py-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                            <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Storage Configuration</h3>
                            <div className="flex items-center gap-2">
                                {mssqlConnected ? (
                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-600 border border-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-900/30 uppercase tracking-tight">
                                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                        MSSQL Link Active
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1 text-[10px] font-bold text-gray-400 border border-gray-100 uppercase tracking-tight">
                                        <div className="h-1.5 w-1.5 rounded-full bg-gray-300" />
                                        Local Storage Only
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-2">
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest">
                                    Primary Data Source <span className="text-red-500">*</span>
                                </label>
                                <select
                                    value={employeeDataSource}
                                    onChange={(e) => setEmployeeDataSource(e.target.value)}
                                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-700 dark:bg-[#0F172A] dark:text-white transition-all appearance-none"
                                >
                                    <option value="mongodb">Internal (MongoDB)</option>
                                    <option value="mssql">External (MSSQL Server)</option>
                                    <option value="both">Both (Hybrid)</option>
                                </select>
                                <p className="text-[10px] text-gray-400">Determines where employee data is primarily fetched from.</p>
                            </div>

                            <div className="space-y-2">
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest">
                                    Deletion Policy <span className="text-red-500">*</span>
                                </label>
                                <select
                                    value={employeeDeleteTarget}
                                    onChange={(e) => setEmployeeDeleteTarget(e.target.value)}
                                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium focus:border-red-500 focus:ring-2 focus:ring-red-500/20 dark:border-gray-700 dark:bg-[#0F172A] dark:text-white transition-all appearance-none"
                                >
                                    <option value="mongodb">Internal Only</option>
                                    <option value="mssql">External Only</option>
                                    <option value="both">Both Database Targets</option>
                                </select>
                                <p className="text-[10px] text-gray-400">Determines which systems are affected when an employee is deleted.</p>
                            </div>

                            <div className="md:col-span-2 flex items-start gap-4 pt-2">
                                <div className="flex h-10 items-center">
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={autoGenerateEmployeeNumber}
                                        onClick={() => setAutoGenerateEmployeeNumber((v) => !v)}
                                        className={`${autoGenerateEmployeeNumber ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-0 transition-colors duration-200 ease-in-out focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2`}
                                    >
                                        <span className={`${autoGenerateEmployeeNumber ? 'translate-x-5' : 'translate-x-1'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`} />
                                    </button>
                                </div>
                                <div className="space-y-0.5">
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest">Auto generate employee number</label>
                                    <p className="text-[10px] text-gray-400">When ON, new employees (and bulk upload rows without a number) get the next number automatically. When OFF, employee number is required.</p>
                                </div>
                            </div>
                        </div>
                    </section>

                    <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/20 rounded-2xl p-6 flex items-start gap-4">
                        <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div>
                            <h4 className="text-sm font-bold text-amber-900 dark:text-amber-200">Critical: Deletion Policy</h4>
                            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 leading-relaxed">
                                Setting the deletion policy to &quot;Both&quot; will permanently remove records from both MongoDB and the connected MSSQL server. This action cannot be undone.
                            </p>
                        </div>
                    </div>

                    {/* Profile Update Request Configuration */}
                    <section className="bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden p-4 sm:p-6 lg:p-8">
                        <div className="px-8 py-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                            <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Profile Update Request Configuration</h3>
                            <div className="flex items-center gap-4">
                                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold border uppercase tracking-tight ${updateRequestConfig.enabled ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-gray-50 text-gray-400 border-gray-100'}`}>
                                    {updateRequestConfig.enabled ? 'Enabled' : 'Disabled'}
                                </span>
                                <div className="flex h-10 items-center">
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={updateRequestConfig.enabled}
                                        onClick={() => setUpdateRequestConfig(prev => ({ ...prev, enabled: !prev.enabled }))}
                                        className={`${updateRequestConfig.enabled ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-0 transition-colors duration-200 ease-in-out focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2`}
                                    >
                                        <span className={`${updateRequestConfig.enabled ? 'translate-x-5' : 'translate-x-1'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`} />
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="p-8 space-y-6">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest">Allow Qualifications Update</label>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={updateRequestConfig.allowQualifications}
                                        onClick={() => setUpdateRequestConfig(prev => ({ ...prev, allowQualifications: !prev.allowQualifications }))}
                                        className={`${updateRequestConfig.allowQualifications ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-0 transition-colors duration-200 ease-in-out focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2`}
                                    >
                                        <span className={`${updateRequestConfig.allowQualifications ? 'translate-x-5' : 'translate-x-1'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`} />
                                    </button>
                                </div>
                                <p className="text-[10px] text-gray-400">When enabled, employees can request updates to their educational and professional qualifications.</p>
                            </div>

                            <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">Select Requestable Fields</label>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {allFields.map(field => (
                                        <label key={field.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-[#0F172A] cursor-pointer transition-colors">
                                            <input
                                                type="checkbox"
                                                checked={updateRequestConfig.requestableFields.includes(field.id)}
                                                onChange={(e) => {
                                                    const fields = e.target.checked
                                                        ? [...updateRequestConfig.requestableFields, field.id]
                                                        : updateRequestConfig.requestableFields.filter(id => id !== field.id);
                                                    setUpdateRequestConfig(prev => ({ ...prev, requestableFields: fields }));
                                                }}
                                                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                            />
                                            <div className="min-w-0">
                                                <p className="text-xs font-bold text-gray-700 dark:text-gray-300 truncate">{field.label}</p>
                                                <p className="text-[10px] text-gray-400 truncate">{field.group}</p>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden p-4 sm:p-6 lg:p-8">
                        <div className="px-8 py-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                            <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Default Employee Preferences</h3>
                        </div>

                        <div className="p-8 space-y-6">
                            <div className="flex items-start gap-4">
                                <div className="flex h-10 items-center">
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={defaultApplyStatutoryDeductions}
                                        onClick={() => setDefaultApplyStatutoryDeductions((v) => !v)}
                                        className={`${defaultApplyStatutoryDeductions ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-0 transition-colors duration-200 ease-in-out focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2`}
                                    >
                                        <span className={`${defaultApplyStatutoryDeductions ? 'translate-x-5' : 'translate-x-1'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`} />
                                    </button>
                                </div>
                                <div className="space-y-0.5">
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest">Default Statutory Deductions</label>
                                    <p className="text-[10px] text-gray-400">Apply Profession Tax, ESI, and PF by default for new employees.</p>
                                </div>
                            </div>

                            <div className="flex items-start gap-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                                <div className="flex h-10 items-center">
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={defaultApplyAttendanceDeductions}
                                        onClick={() => setDefaultApplyAttendanceDeductions((v) => !v)}
                                        className={`${defaultApplyAttendanceDeductions ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-0 transition-colors duration-200 ease-in-out focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2`}
                                    >
                                        <span className={`${defaultApplyAttendanceDeductions ? 'translate-x-5' : 'translate-x-1'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`} />
                                    </button>
                                </div>
                                <div className="space-y-0.5">
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest">Default Attendance Deductions</label>
                                    <p className="text-[10px] text-gray-400">Apply Late-in, Early-out, Permission, and Absent deductions by default for new employees.</p>
                                </div>
                            </div>
                        </div>
                    </section>

                </div>

                <div className="space-y-8">
                    <div className="bg-indigo-600 rounded-2xl p-8 text-white shadow-xl shadow-indigo-500/20">
                        <h3 className="text-lg font-bold mb-2">Sync Status</h3>
                        <p className="text-xs opacity-80 leading-relaxed mb-6">
                            Configure how the system handles employee records across multiple data sources.
                        </p>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="w-full py-3 bg-white text-indigo-600 rounded-xl text-xs font-bold hover:bg-gray-50 transition-colors shadow-lg active:scale-95 disabled:opacity-50"
                        >
                            {saving ? 'Saving...' : 'Save Settings Now'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EmployeeSettings;
