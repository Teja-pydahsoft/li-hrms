'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { toast } from 'react-toastify';
import { Save, ChevronRight, LogOut } from 'lucide-react';
import { SettingsSkeleton } from './SettingsSkeleton';
import WorkflowManager, { WorkflowData } from './shared/WorkflowManager';

const ResignationSettings = () => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<{
    noticePeriodDays: number;
    workflow: WorkflowData;
  }>({
    noticePeriodDays: 0,
    workflow: {
      isEnabled: true,
      steps: [],
      finalAuthority: { role: 'hr', anyHRCanApprove: true },
    },
  });

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getResignationSettings();
      if (res.success && res.data) {
        const d = res.data;
        const noticeDays = Math.max(0, Number(d.noticePeriodDays ?? d.value?.noticePeriodDays ?? 0) || 0);
        setSettings({
          noticePeriodDays: noticeDays,
          workflow: {
            isEnabled: d.workflow?.isEnabled !== false,
            steps: (d.workflow?.steps || []).map((s: { 
              stepOrder: number; 
              stepName?: string; 
              approverRole?: string; 
              role?: string; 
              canEditLWD?: boolean; 
            }) => ({
              stepOrder: s.stepOrder,
              stepName: s.stepName || s.approverRole,
              approverRole: s.approverRole || s.role || 'hr',
              isActive: true,
              canEditLWD: s.canEditLWD || false,
            })),
            finalAuthority: d.workflow?.finalAuthority || { role: 'hr', anyHRCanApprove: true },
            allowHigherAuthorityToApproveLowerLevels: d.workflow?.allowHigherAuthorityToApproveLowerLevels ?? false,
          },
        });
      }
    } catch (err) {
      console.error('Error loading resignation settings', err);
      toast.error('Failed to load resignation policy settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const payload = {
        noticePeriodDays: settings.noticePeriodDays,
        workflow: {
          isEnabled: settings.workflow.isEnabled,
          steps: settings.workflow.steps.map((s) => ({
            stepOrder: s.stepOrder,
            stepName: s.stepName,
            approverRole: s.approverRole,
            canEditLWD: s.canEditLWD || false,
          })),
          finalAuthority: settings.workflow.finalAuthority,
          allowHigherAuthorityToApproveLowerLevels: settings.workflow.allowHigherAuthorityToApproveLowerLevels ?? false,
        },
      };
      const res = await api.saveResignationSettings(payload);
      if (res.success) {
        toast.success('Resignation policy settings saved successfully');
      } else {
        toast.error(res.message || 'Failed to save settings');
      }
    } catch {
      toast.error('An error occurred during save');
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
          <span className="text-indigo-600">Resignation Policy</span>
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Resignation Policy</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Configure notice period and approval workflow for resignation requests. When workflow is enabled, setting a left date goes through this approval flow.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
        <div className="xl:col-span-2 space-y-8">
          <section className="bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden p-4 sm:p-6 lg:p-8">
            <div className="px-8 py-6 border-b border-gray-100 dark:border-gray-800">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                <LogOut className="h-4 w-4 text-amber-500" />
                Notice Period & Workflow
              </h3>
            </div>
            <div className="p-8 space-y-8">
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest">
                  Notice period (days)
                </label>
                <input
                  type="number"
                  min={0}
                  value={settings.noticePeriodDays}
                  onChange={(e) => setSettings((s) => ({ ...s, noticePeriodDays: Number(e.target.value) || 0 }))}
                  className="w-full max-w-[120px] rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-700 dark:bg-[#0F172A] dark:text-white"
                />
                <p className="text-[10px] text-gray-400">Minimum notice period in days (0 = no minimum).</p>
              </div>
              <WorkflowManager
                workflow={settings.workflow}
                onChange={(workflow) => setSettings((s) => ({ ...s, workflow }))}
                title="Resignation approval workflow"
                description="Approval steps before employee left date is set."
                isResignationWorkflow={true}
              />
            </div>
          </section>
        </div>
        <div>
          <div className="bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-6">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider mb-4">Save</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Resignation requests will follow this workflow. When fully approved, the employee&apos;s left date will be set automatically.
            </p>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResignationSettings;
