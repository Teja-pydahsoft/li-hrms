'use client';

import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { toast } from 'react-toastify';
import Spinner from '@/components/Spinner';
import { SettingsSkeleton } from './SettingsSkeleton';
import { Save, Clock, ChevronRight } from 'lucide-react';

const GeneralSettings = () => {
  const [lateInGrace, setLateInGrace] = useState<number>(15);
  const [earlyOutGrace, setEarlyOutGrace] = useState<number>(15);
  const [allowEmployeeBulkProcess, setAllowEmployeeBulkProcess] = useState<boolean>(false);
  const [customEmployeeGroupingEnabled, setCustomEmployeeGroupingEnabled] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const [resLate, resEarly, resBulk, resGrouping] = await Promise.all([
        api.getSetting('late_in_grace_time'),
        api.getSetting('early_out_grace_time'),
        api.getSetting('allow_employee_bulk_process'),
        api.getSetting('custom_employee_grouping_enabled'),
      ]);

      if (resLate.success && resLate.data) setLateInGrace(Number(resLate.data.value));
      if (resEarly.success && resEarly.data) setEarlyOutGrace(Number(resEarly.data.value));
      if (resBulk.success && resBulk.data) setAllowEmployeeBulkProcess(!!resBulk.data.value);
      if (resGrouping.success && resGrouping.data) setCustomEmployeeGroupingEnabled(!!resGrouping.data.value);
    } catch (err) {
      console.error('Failed to load general settings', err);
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
      const [resLate, resEarly, resBulk, resGrouping] = await Promise.all([
        api.upsertSetting({
          key: 'late_in_grace_time',
          value: lateInGrace,
          category: 'general',
          description: 'Global Late In Grace Period (Minutes)'
        }),
        api.upsertSetting({
          key: 'early_out_grace_time',
          value: earlyOutGrace,
          category: 'general',
          description: 'Global Early Out Grace Period (Minutes)'
        }),
        api.upsertSetting({
          key: 'allow_employee_bulk_process',
          value: allowEmployeeBulkProcess,
          category: 'employee',
          description: 'Allow bulk upload / bulk process for employees'
        }),
        api.upsertSetting({
          key: 'custom_employee_grouping_enabled',
          value: customEmployeeGroupingEnabled,
          category: 'employee',
          description: 'Enable custom employee groups (CRUD, applications, bulk upload, filters)'
        })
      ]);

      if (resLate.success && resEarly.success && resBulk.success && resGrouping.success) {
        toast.success('General settings saved successfully');
      } else {
        toast.error('Failed to save general settings');
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
          <span className="text-indigo-600">General</span>
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">General Details</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Comprehensive Overview of Core Configuration and General Settings</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
        <div className="xl:col-span-2 space-y-8">
          <section className="bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden p-4 sm:p-6 lg:p-8">
            <div className="px-8 py-6 border-b border-gray-100 dark:border-gray-800">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Attendance Grace Periods</h3>
            </div>

            <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-2">
                <label htmlFor="lateInGrace" className="block text-xs font-bold text-gray-500 uppercase tracking-widest">
                  Late In Grace Period <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    id="lateInGrace"
                    value={lateInGrace}
                    onChange={(e) => setLateInGrace(Number(e.target.value))}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-700 dark:bg-[#0F172A] dark:text-white transition-all"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-400 uppercase">Mins</span>
                </div>
                <p className="text-[10px] text-gray-400">Minutes allowed after shift start time before marked late.</p>
              </div>

              <div className="space-y-2">
                <label htmlFor="earlyOutGrace" className="block text-xs font-bold text-gray-500 uppercase tracking-widest">
                  Early Out Grace Period <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    id="earlyOutGrace"
                    value={earlyOutGrace}
                    onChange={(e) => setEarlyOutGrace(Number(e.target.value))}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-700 dark:bg-[#0F172A] dark:text-white transition-all"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-400 uppercase">Mins</span>
                </div>
                <p className="text-[10px] text-gray-400">Minutes allowed before shift end time before marked early exit.</p>
              </div>
            </div>
          </section>

          <section className="bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden p-4 sm:p-6 lg:p-8">
            <div className="px-8 py-6 border-b border-gray-100 dark:border-gray-800">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Employee Bulk Process</h3>
            </div>
            <div className="p-8">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <label htmlFor="allowEmployeeBulkProcess" className="block text-sm font-medium text-gray-900 dark:text-white">
                    Allow bulk process for employees
                  </label>
                  <p className="text-[10px] text-gray-400 mt-1">When ON, the Import (bulk upload) option is shown on the Employees page. When OFF, bulk upload is hidden.</p>
                </div>
                <button
                  id="allowEmployeeBulkProcess"
                  type="button"
                  role="switch"
                  aria-checked={allowEmployeeBulkProcess}
                  onClick={() => setAllowEmployeeBulkProcess((v) => !v)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${allowEmployeeBulkProcess ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${allowEmployeeBulkProcess ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
          </section>

          <section className="bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden p-4 sm:p-6 lg:p-8">
            <div className="px-8 py-6 border-b border-gray-100 dark:border-gray-800">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Employee custom groups</h3>
            </div>
            <div className="p-8">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <label htmlFor="customEmployeeGrouping" className="block text-sm font-medium text-gray-900 dark:text-white">
                    Enable custom employee grouping
                  </label>
                  <p className="text-[10px] text-gray-400 mt-1">
                    When ON, you can maintain employee groups, assign them on applications and bulk upload, and filter employees by group.
                  </p>
                </div>
                <button
                  id="customEmployeeGrouping"
                  type="button"
                  role="switch"
                  aria-checked={customEmployeeGroupingEnabled}
                  onClick={() => setCustomEmployeeGroupingEnabled((v) => !v)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${customEmployeeGroupingEnabled ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${customEmployeeGroupingEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
          </section>

          {/* Placeholder for future general settings to match reference grid */}
          <section className="bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden opacity-50 p-4 sm:p-6 lg:p-8">
            <div className="px-8 py-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">System Localization</h3>
              <span className="text-[10px] font-bold bg-gray-100 px-2 py-0.5 rounded text-gray-500">COMING SOON</span>
            </div>
            <div className="p-8 grid grid-cols-2 gap-8 grayscale">
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest text-opacity-50">Language</label>
                <div className="w-full h-11 bg-gray-50 rounded-xl border border-gray-100" />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest text-opacity-50">Timezone</label>
                <div className="w-full h-11 bg-gray-50 rounded-xl border border-gray-100" />
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-8">
          <div className="bg-indigo-600 rounded-2xl p-8 text-white shadow-xl shadow-indigo-500/20">
            <h3 className="text-lg font-bold mb-2">Need Help?</h3>
            <p className="text-xs opacity-80 leading-relaxed mb-6">
              Grace periods affect how attendance is calculated globally across all shifts and departments.
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

export default GeneralSettings;
