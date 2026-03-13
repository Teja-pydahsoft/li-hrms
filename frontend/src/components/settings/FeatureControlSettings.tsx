'use client';

import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { toast } from 'react-toastify';
import Spinner from '@/components/Spinner';
import { SettingsSkeleton } from './SettingsSkeleton';
import { Save, User, Users, Briefcase, ChevronRight, UserCog } from 'lucide-react';

const availableModules: { id: string; label: string }[] = [
  { id: 'DASHBOARD', label: 'Dashboard' },
  { id: 'PROFILE', label: 'My Profile' },
  { id: 'EMPLOYEES', label: 'Employees' },
  { id: 'RESIGNATION', label: 'Resignations' },
  { id: 'ATTENDANCE', label: 'Attendance' },
  { id: 'LEAVE_OD', label: 'Leave & OD' },
  { id: 'OT_PERMISSIONS', label: 'OT & Permissions' },
  { id: 'SHIFTS', label: 'Shifts' },
  { id: 'DEPARTMENTS', label: 'Departments' },
  { id: 'PAYSLIPS', label: 'Payslips' },
  { id: 'PAY_REGISTER', label: 'Pay Register' },
  { id: 'ALLOWANCES_DEDUCTIONS', label: 'Allowances & Deductions' },
  { id: 'LOANS', label: 'Loans & Salary Advance' },
  { id: 'CCL', label: 'CCL' },
  { id: 'HOLIDAY_CALENDAR', label: 'Holidays' },
  { id: 'SETTINGS', label: 'Settings' },
];

type FeatureControlRole = 'employee' | 'hod' | 'hr' | 'manager';

/** Normalize stored activeModules: plain "MODULE" → "MODULE:write" so UI and save use :read/:write consistently */
function normalizeActiveModules(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string').map((v) => {
    const s = String(v).trim();
    if (!s) return null;
    if (s.includes(':')) return s; // already "MODULE:read" or "MODULE:write"
    return `${s}:write`; // legacy plain id → treat as write
  }).filter(Boolean) as string[];
}

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

      const val = (r: typeof resEmp) => r?.data?.value;
      if (resEmp?.success) setFeatureControlEmployee(normalizeActiveModules(val(resEmp)?.activeModules));
      if (resHOD?.success) setFeatureControlHOD(normalizeActiveModules(val(resHOD)?.activeModules));
      if (resHR?.success) setFeatureControlHR(normalizeActiveModules(val(resHR)?.activeModules));
      if (resManager?.success) setFeatureControlManager(normalizeActiveModules(val(resManager)?.activeModules));
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

  /** Current permission state for a module from activeModules array */
  const getModuleState = (state: string[], moduleId: string): 'disabled' | 'read' | 'write' => {
    if (state.includes(`${moduleId}:write`)) return 'write';
    if (state.includes(moduleId)) return 'write'; // legacy plain id
    if (state.includes(`${moduleId}:read`)) return 'read';
    return 'disabled';
  };

  /** Cycle tile: disabled → read → write → disabled */
  const cycleModule = (role: FeatureControlRole, moduleId: string) => {
    const setters: Record<FeatureControlRole, [string[], React.Dispatch<React.SetStateAction<string[]>>]> = {
      employee: [featureControlEmployee, setFeatureControlEmployee],
      hod: [featureControlHOD, setFeatureControlHOD],
      hr: [featureControlHR, setFeatureControlHR],
      manager: [featureControlManager, setFeatureControlManager],
    };
    const [current, setter] = setters[role];
    const state = getModuleState(current, moduleId);
    const without = current.filter((id) => id !== moduleId && id !== `${moduleId}:read` && id !== `${moduleId}:write`);
    if (state === 'disabled') {
      setter([...without, `${moduleId}:read`]);
    } else if (state === 'read') {
      setter([...without, `${moduleId}:write`]);
    } else {
      setter(without);
    }
  };

  if (loading) return <SettingsSkeleton />;

  const RoleCard = ({ role, title, icon: Icon, colorClass, state }: { role: FeatureControlRole; title: string; icon: React.ComponentType<{ className?: string }>; colorClass: string; state: string[] }) => (
    <section className="bg-white dark:bg-slate-900/80 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col">
      <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-700/80 flex items-center gap-3">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${colorClass}`}>
          <Icon className="h-4 w-4" />
        </div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
      </div>
      <div className="p-4 flex-1">
        <div className="grid grid-cols-2 gap-2">
          {availableModules.map((mod) => {
            const tileState = getModuleState(state, mod.id);
            return (
              <button
                key={mod.id}
                type="button"
                onClick={() => cycleModule(role, mod.id)}
                title={`${mod.label} — ${tileState === 'disabled' ? 'Off' : tileState === 'read' ? 'Read' : 'Write'} (click to cycle)`}
                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-all ${
                  tileState === 'write'
                    ? 'border-emerald-500/80 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-600/60'
                    : tileState === 'read'
                    ? 'border-blue-500/80 bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-600/60'
                    : 'border-slate-200 bg-slate-50/50 text-slate-500 hover:border-slate-300 hover:bg-slate-100/80 dark:border-slate-600 dark:bg-slate-800/30 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:bg-slate-800/50'
                }`}
              >
                <span className="truncate">{mod.label}</span>
                {tileState === 'write' ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                ) : tileState === 'read' ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" aria-hidden />
                ) : (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300 dark:bg-slate-500" aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );

  return (
    <div className="w-full max-w-[1600px] space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-700">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span>Settings</span>
            <ChevronRight className="h-3.5 w-3.5 opacity-70" />
            <span className="text-indigo-600 dark:text-indigo-400 font-medium">Feature Control</span>
          </div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Permissions by role</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Control which modules each role can see and whether they have read or write access.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={loadSettings}
            className="px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {saving ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            Save
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-medium text-slate-600 dark:text-slate-300">Legend:</span>
        <span><span className="inline-block h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-500 align-middle mr-1" />Off</span>
        <span><span className="inline-block h-2 w-2 rounded-full bg-blue-500 align-middle mr-1" />Read</span>
        <span><span className="inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle mr-1" />Write</span>
        <span className="text-slate-400 dark:text-slate-500">— Click a tile to cycle.</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
        <RoleCard role="employee" title="Employee" icon={User} colorClass="bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" state={featureControlEmployee} />
        <RoleCard role="manager" title="Manager" icon={UserCog} colorClass="bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400" state={featureControlManager} />
        <RoleCard role="hod" title="Head of Department" icon={Briefcase} colorClass="bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400" state={featureControlHOD} />
        <RoleCard role="hr" title="Human Resources" icon={Users} colorClass="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400" state={featureControlHR} />
      </div>
    </div>
  );
};

export default FeatureControlSettings;
