'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { api, EmployeeGroup } from '@/lib/api';
import { toast } from 'react-toastify';
import Spinner from '@/components/Spinner';
import { Layers, Plus, Pencil, Trash2 } from 'lucide-react';

export default function EmployeeGroupsClient() {
  const [groups, setGroups] = useState<EmployeeGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [checking, setChecking] = useState(true);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getEmployeeGroups();
      if (res.success && Array.isArray(res.data)) {
        setGroups(res.data);
      } else {
        setGroups([]);
      }
    } catch {
      toast.error('Failed to load employee groups');
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.getSetting('custom_employee_grouping_enabled');
        setEnabled(!!res?.data?.value);
      } catch {
        setEnabled(false);
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!checking) {
      void load();
    }
  }, [checking, load]);

  const resetForm = () => {
    setName('');
    setCode('');
    setDescription('');
    setEditingId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        const res = await api.updateEmployeeGroup(editingId, {
          name: name.trim(),
          code: code.trim(),
          description: description.trim(),
        });
        if (res.success) {
          toast.success('Group updated');
          resetForm();
          await load();
        } else {
          toast.error(res.message || 'Update failed');
        }
      } else {
        const res = await api.createEmployeeGroup({
          name: name.trim(),
          code: code.trim(),
          description: description.trim(),
        });
        if (res.success) {
          toast.success('Group created');
          resetForm();
          await load();
        } else {
          toast.error(res.message || 'Create failed');
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (g: EmployeeGroup) => {
    setEditingId(g._id);
    setName(g.name);
    setCode(g.code || '');
    setDescription(g.description || '');
  };

  const toggleActive = async (g: EmployeeGroup) => {
    const res = await api.updateEmployeeGroup(g._id, { isActive: !g.isActive });
    if (res.success) {
      toast.success(g.isActive ? 'Group deactivated' : 'Group activated');
      await load();
    } else {
      toast.error(res.message || 'Update failed');
    }
  };

  const handleDelete = async (g: EmployeeGroup) => {
    if (!confirm(`Delete group "${g.name}"? Employees will keep employee_group_id until cleared manually.`)) return;
    const res = await api.deleteEmployeeGroup(g._id);
    if (res.success) {
      toast.success('Group deleted');
      if (editingId === g._id) resetForm();
      await load();
    } else {
      toast.error(res.message || 'Delete failed');
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-amber-200 bg-amber-50/80 p-8 text-center dark:border-amber-900/40 dark:bg-amber-950/30">
        <Layers className="mx-auto mb-4 h-10 w-10 text-amber-600 dark:text-amber-400" />
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Custom employee grouping is off</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Turn on <strong>Enable custom employee grouping</strong> in General Settings, then return here to manage groups.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Employee groups</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Cross-cutting cohorts (teams, batches, etc.) assigned to employees and applications.
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {editingId ? 'Edit group' : 'New group'}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase text-slate-400">Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase text-slate-400">Code</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-bold uppercase text-slate-400">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {editingId ? 'Save changes' : 'Create group'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : groups.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">No groups yet. Create one above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-950/50">
                <tr>
                  <th className="px-4 py-3 font-bold text-slate-500">Name</th>
                  <th className="px-4 py-3 font-bold text-slate-500">Code</th>
                  <th className="px-4 py-3 font-bold text-slate-500">Active</th>
                  <th className="px-4 py-3 text-right font-bold text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {groups.map((g) => (
                  <tr key={g._id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">{g.name}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{g.code || '—'}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => void toggleActive(g)}
                        className={`rounded-full px-2 py-0.5 text-xs font-bold ${g.isActive !== false ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}
                      >
                        {g.isActive !== false ? 'Yes' : 'No'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => startEdit(g)}
                        className="mr-2 inline-flex rounded-lg p-2 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                        aria-label="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(g)}
                        className="inline-flex rounded-lg p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
