'use client';

import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { toast } from 'react-toastify';
import Spinner from '@/components/Spinner';
import { SettingsSkeleton } from './SettingsSkeleton';
import { Save, User, Users, Briefcase, ChevronRight, UserCog } from 'lucide-react';

const availableModules: { id: string; label: string; hint?: string }[] = [
    { id: 'DASHBOARD', label: 'Dashboard' },
    { id: 'PROFILE', label: 'My Profile' },
    { id: 'EMPLOYEES', label: 'Employees' },
    { id: 'RESIGNATION', label: 'Resignations', hint: 'Resignation requests & approvals' },
    { id: 'ATTENDANCE', label: 'Attendance' },
    { id: 'LEAVE_OD', label: 'Leave & OD' },
    { id: 'OT_PERMISSIONS', label: 'OT & Permissions' },
    { id: 'SHIFTS', label: 'Shifts' },
    { id: 'DEPARTMENTS', label: 'Departments/Nodes' },
    { id: 'PAYSLIPS', label: 'Payslips' },
    { id: 'PAY_REGISTER', label: 'Payroll Register' },
    { id: 'ALLOWANCES_DEDUCTIONS', label: 'Allowance/Deduction' },
    { id: 'CCL', label: 'CCL Management' },
    { id: 'HOLIDAY_CALENDAR', label: 'Holiday Calendar' },
    { id: 'SETTINGS', label: 'System Settings' },
];

type FeatureControlRole = 'employee' | 'hod' | 'hr' | 'manager';

const FeatureControlSettings = () => {
    const [featureControlEmployee, setFeatureControlEmployee] = useState<string[]>([]);
    const [featureControlHOD, setFeatureControlHOD] = useState<string[]>([]);
    const [featureControlHR, setFeatureControlHR] = useState<string[]>([]);
    const [featureControlManager, setFeatureControlManager] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const loadSettings = async () => {
        try {
            setLoading(true);
            const [resEmp, resHOD, resHR, resManager] = await Promise.all([
                api.getSetting('feature_control_employee'),
                api.getSetting('feature_control_hod'),
                api.getSetting('feature_control_hr'),
                api.getSetting('feature_control_manager'),
            ]);

            if (resEmp.success && Array.isArray(resEmp.data?.value?.activeModules)) setFeatureControlEmployee(resEmp.data.value.activeModules);
            if (resHOD.success && Array.isArray(resHOD.data?.value?.activeModules)) setFeatureControlHOD(resHOD.data.value.activeModules);
            if (resHR.success && Array.isArray(resHR.data?.value?.activeModules)) setFeatureControlHR(resHR.data.value.activeModules);
            if (resManager.success && Array.isArray(resManager.data?.value?.activeModules)) setFeatureControlManager(resManager.data.value.activeModules);
        } catch (err) {
            console.error('Failed to load feature control settings', err);
            toast.error('Failed to load settings');
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
            await Promise.all([
                api.upsertSetting({ key: 'feature_control_employee', value: { activeModules: featureControlEmployee }, category: 'feature_control' }),
                api.upsertSetting({ key: 'feature_control_hod', value: { activeModules: featureControlHOD }, category: 'feature_control' }),
                api.upsertSetting({ key: 'feature_control_hr', value: { activeModules: featureControlHR }, category: 'feature_control' }),
                api.upsertSetting({ key: 'feature_control_manager', value: { activeModules: featureControlManager }, category: 'feature_control' }),
            ]);
            toast.success('Feature control settings saved successfully');
        } catch (err) {
            toast.error('Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    // Permission state for a module: disabled | read | write (for single-tile cycle and styling)
    const getModuleState = (state: string[], moduleId: string): 'disabled' | 'read' | 'write' => {
        if (state.includes(moduleId) || state.includes(`${moduleId}:write`)) return 'write';
        if (state.includes(`${moduleId}:read`)) return 'read';
        return 'disabled';
    };

    // Single tap cycles: disabled → read (blue) → write (green) → disabled
    const cycleModule = (role: FeatureControlRole, moduleId: string) => {
        const setters: Record<FeatureControlRole, [string[], React.Dispatch<React.SetStateAction<string[]>>]> = {
            employee: [featureControlEmployee, setFeatureControlEmployee],
            hod: [featureControlHOD, setFeatureControlHOD],
            hr: [featureControlHR, setFeatureControlHR],
            manager: [featureControlManager, setFeatureControlManager],
        };
        const [current, setter] = setters[role];
        const state = getModuleState(current, moduleId);
        const without = current.filter(id => id !== moduleId && id !== `${moduleId}:read` && id !== `${moduleId}:write`);
        if (state === 'disabled') {
            setter([...without, `${moduleId}:read`]);
        } else if (state === 'read') {
            setter([...without, `${moduleId}:write`]);
        } else {
            setter(without);
        }
    };

    if (loading) return <SettingsSkeleton />;

    const RoleCard = ({ role, title, icon: Icon, colorClass, state }: { role: FeatureControlRole; title: string; icon: any; colorClass: string; state: string[] }) => (
        <section className="bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${colorClass}`}>
                    <Icon className="h-4 w-4" />
                </div>
                <h3 className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wider">{title}</h3>
            </div>

            <div className="p-6 flex-1 bg-gray-50/30 dark:bg-black/10">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Tap tile: Disabled → Read (blue) → Write (green) → Disabled</p>
                <div className="grid grid-cols-2 gap-2">
                    {availableModules.map((mod) => {
                        const tileState = getModuleState(state, mod.id);
                        return (
                            <button
                                key={mod.id}
                                type="button"
                                onClick={() => cycleModule(role, mod.id)}
                                title={`${mod.label}: ${tileState === 'disabled' ? 'Disabled' : tileState === 'read' ? 'Read' : 'Write'} — tap to cycle`}
                                className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-[11px] font-bold transition-all ${
                                    tileState === 'write'
                                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/25 dark:text-emerald-400 shadow-sm shadow-emerald-500/10'
                                        : tileState === 'read'
                                        ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/25 dark:text-blue-400 shadow-sm shadow-blue-500/10'
                                        : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300 dark:border-gray-700 dark:bg-[#0F172A] dark:hover:border-gray-600'
                                }`}
                            >
                                <span>{mod.label}</span>
                                {tileState === 'write' ? (
                                    <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" title="Write" />
                                ) : tileState === 'read' ? (
                                    <div className="h-2 w-2 rounded-full bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.5)]" title="Read" />
                                ) : (
                                    <div className="h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600" title="Disabled" />
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
        </section>
    );

    return (
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-end justify-between border-b border-gray-200 dark:border-gray-800 pb-5">
                <div>
                    <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-2">
                        <span>Settings</span>
                        <ChevronRight className="h-3 w-3" />
                        <span className="text-indigo-600">Permissions</span>
                    </div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">Feature Control</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Configure module visibility and access for different system roles. Enable <strong>Resignations</strong> for a role to show the Resignations page in the sidebar and allow applying/approving resignations.</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={loadSettings}
                        className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-900 transition-colors"
                    >
                        Reset
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-500/20 transition hover:bg-indigo-700 disabled:opacity-50 transform active:scale-95"
                    >
                        {saving ? <Spinner className="h-3 w-3" /> : <Save className="h-3.5 w-3.5" />}
                        Save Changes
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                <RoleCard
                    role="employee"
                    title="Employee"
                    icon={User}
                    colorClass="bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
                    state={featureControlEmployee}
                />
                <RoleCard
                    role="manager"
                    title="Manager"
                    icon={UserCog}
                    colorClass="bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400"
                    state={featureControlManager}
                />
                <RoleCard
                    role="hod"
                    title="Head of Department"
                    icon={Briefcase}
                    colorClass="bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400"
                    state={featureControlHOD}
                />
                <RoleCard
                    role="hr"
                    title="Human Resources"
                    icon={Users}
                    colorClass="bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400"
                    state={featureControlHR}
                />
            </div>
        </div>
    );
};

export default FeatureControlSettings;
