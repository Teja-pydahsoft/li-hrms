'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Spinner from '@/components/Spinner';

interface EmployeeExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  filters?: any;
  empNo?: string;
  employeeName?: string;
}

export default function EmployeeExportDialog({
  isOpen,
  onClose,
  filters,
  empNo,
  employeeName
}: EmployeeExportDialogProps) {
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [groups, setGroups] = useState<any[]>([]);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await api.getEmployeeFormSettings();
      if (res.success && res.data) {
        setGroups(res.data.groups || []);
        // Default select some important fields
        const defaultFields = ['emp_no', 'employee_name', 'division_id', 'department_id', 'designation_id', 'doj'];
        setSelectedFields(defaultFields);
      }
    } catch (error) {
      console.error('Failed to load form settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleField = (fieldId: string) => {
    setSelectedFields(prev =>
      prev.includes(fieldId)
        ? prev.filter(id => id !== fieldId)
        : [...prev, fieldId]
    );
  };

  const toggleGroup = (groupId: string, fields: any[]) => {
    const fieldIds = fields.map(f => f.id);
    const allSelected = fieldIds.every(id => selectedFields.includes(id));

    if (allSelected) {
      setSelectedFields(prev => prev.filter(id => !fieldIds.includes(id)));
    } else {
      setSelectedFields(prev => [...new Set([...prev, ...fieldIds])]);
    }
  };

  const handleSelectAll = () => {
    const allFieldIds: string[] = [];
    groups.forEach(g => g.fields.forEach((f: any) => allFieldIds.push(f.id)));
    // Add common fields
    allFieldIds.push('emp_no', 'employee_name', 'division_id', 'department_id', 'designation_id', 'doj', 'is_active');
    setSelectedFields([...new Set(allFieldIds)]);
  };

  const handleClearAll = () => {
    setSelectedFields([]);
  };

  const handleExport = async () => {
    if (selectedFields.length === 0) {
      alert('Please select at least one field to export');
      return;
    }

    setExporting(true);
    try {
      const blob = await api.exportEmployees(selectedFields, filters, empNo);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = empNo ? `employee_${empNo}_export.csv` : `employees_export_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      onClose();
    } catch (error: any) {
      console.error('Export failed:', error);
      alert(error.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-[70] flex h-full max-h-[85vh] w-full max-w-2xl flex-col rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4">
          <div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              {empNo ? `Download Data: ${employeeName || empNo}` : 'Download Employee Data'}
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Select the fields you want to include in the CSV export.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-400 transition hover:border-red-200 hover:text-red-500 dark:border-slate-700 dark:bg-slate-900"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex gap-4 px-6 pb-4">
          <button
            onClick={handleSelectAll}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
          >
            Select All
          </button>
          <button
            onClick={handleClearAll}
            className="text-xs font-semibold text-slate-500 hover:text-slate-600 dark:text-slate-400"
          >
            Clear All
          </button>
          <div className="ml-auto text-xs text-slate-400">
            {selectedFields.length} fields selected
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-2">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <div className="space-y-6 pb-6">
              {/* Common Fields Group */}
              <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/50">
                <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Core Information</h4>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    { id: 'emp_no', label: 'Employee No' },
                    { id: 'employee_name', label: 'Employee Name' },
                    { id: 'division_id', label: 'Division' },
                    { id: 'department_id', label: 'Department' },
                    { id: 'designation_id', label: 'Designation' },
                    { id: 'doj', label: 'Joining Date' },
                    { id: 'is_active', label: 'Status' },
                  ].map(field => (
                    <label key={field.id} className="flex cursor-pointer items-center gap-2 rounded-lg p-1 hover:bg-white dark:hover:bg-slate-800">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        checked={selectedFields.includes(field.id)}
                        onChange={() => toggleField(field.id)}
                      />
                      <span className="text-sm text-slate-700 dark:text-slate-300">{field.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Dynamic Groups */}
              {groups.map(group => (
                <div key={group.id} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">{group.label}</h4>
                    <button
                      onClick={() => toggleGroup(group.id, group.fields)}
                      className="text-[10px] font-bold text-indigo-500 hover:underline"
                    >
                      {group.fields.every((f: any) => selectedFields.includes(f.id)) ? 'Deselect Group' : 'Select Group'}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {group.fields.map((field: any) => (
                      <label key={field.id} className="flex cursor-pointer items-center gap-2 rounded-lg p-1 hover:bg-slate-50 dark:hover:bg-slate-900">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          checked={selectedFields.includes(field.id)}
                          onChange={() => toggleField(field.id)}
                        />
                        <span className="text-sm text-slate-600 dark:text-slate-400">{field.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-slate-100 p-6 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || loading || selectedFields.length === 0}
            className="flex-[2] rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-200 transition hover:from-indigo-700 hover:to-violet-700 disabled:opacity-50 dark:shadow-none"
          >
            {exporting ? 'Exporting...' : 'Download CSV'}
          </button>
        </div>
      </div>
    </div>
  );
}
