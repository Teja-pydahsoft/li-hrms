'use client';

import { useState, useEffect, Fragment } from 'react';
import { api } from '@/lib/api';
import Spinner from '@/components/Spinner';
import { alertSuccess, alertError, alertConfirm } from '@/lib/customSwal';
import {
  Plus,
  ChevronDown,
  ChevronRight,
  Trash2,
  GripVertical,
  X,
  HelpCircle,
  Layers,
  GraduationCap,
  Pencil,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';

export interface FormField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'multiselect' | 'email' | 'tel' | 'file' | 'array' | 'object' | 'userselect';
  dataType: string;
  placeholder?: string;
  options?: Array<{ label: string; value: any }>;
  validation?: { minLength?: number; maxLength?: number; min?: number; max?: number; pattern?: string; custom?: string; maxItems?: number };
  isRequired: boolean;
  isSystem: boolean;
  isEnabled: boolean;
  order: number;
  itemType?: string;
  itemSchema?: any;
  description?: string;
}

export interface FormGroup {
  id: string;
  label: string;
  description?: string;
  order: number;
  isSystem: boolean;
  isEnabled: boolean;
  fields: FormField[];
}

/** Qualification field from API (id, label, type, placeholder, validation, options, order, etc.) */
export interface QualificationField {
  id: string;
  label: string;
  type: string;
  isRequired?: boolean;
  isEnabled?: boolean;
  placeholder?: string;
  validation?: { minLength?: number; maxLength?: number; min?: number; max?: number };
  options?: Array<{ label: string; value: string }>;
  order?: number;
  _id?: string;
}

export interface FormSettings {
  _id?: string;
  groups: FormGroup[];
  qualifications?: {
    isEnabled?: boolean;
    enableCertificateUpload?: boolean;
    fields?: QualificationField[];
    defaultRows?: Record<string, unknown>[];
  };
  version?: number;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

const QUESTION_TYPES: { value: FormField['type']; label: string }[] = [
  { value: 'text', label: 'Short answer' },
  { value: 'textarea', label: 'Paragraph' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'email', label: 'Email' },
  { value: 'tel', label: 'Phone number' },
  { value: 'select', label: 'Dropdown' },
  { value: 'multiselect', label: 'Checkboxes' },
  { value: 'file', label: 'File upload' },
  { value: 'userselect', label: 'Choose from list (person)' },
  { value: 'array', label: 'List of items' },
  { value: 'object', label: 'Group of fields' },
];

function getQuestionTypeLabel(type: string): string {
  return QUESTION_TYPES.find((t) => t.value === type)?.label || type;
}

const QUAL_FIELD_TYPES = [
  { value: 'text', label: 'Short answer' },
  { value: 'textarea', label: 'Paragraph' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Dropdown' },
  { value: 'boolean', label: 'Yes/No' },
];

function getQualTypeLabel(type: string): string {
  return QUAL_FIELD_TYPES.find((t) => t.value === type)?.label || type;
}



export default function FormSettingsBuilder() {
  const [settings, setSettings] = useState<FormSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [editingQuestion, setEditingQuestion] = useState<{ groupId: string; fieldId: string } | null>(null);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [showAddSection, setShowAddSection] = useState(false);
  const [showAddQuestion, setShowAddQuestion] = useState<string | null>(null);
  const [newSection, setNewSection] = useState({ label: '', description: '' });
  const [newQuestion, setNewQuestion] = useState<Partial<FormField>>({
    label: '',
    type: 'text',
    dataType: 'string',
    isRequired: false,
    isEnabled: true,
    placeholder: '',
    order: 0,
  });
  const [newOption, setNewOption] = useState('');
  const [editingQualFieldId, setEditingQualFieldId] = useState<string | null>(null);
  const [showAddQualField, setShowAddQualField] = useState(false);
  const [newQualField, setNewQualField] = useState<{
    id: string;
    label: string;
    type: string;
    isRequired: boolean;
    isEnabled: boolean;
    placeholder: string;
    order: number;
    validation?: { minLength?: number; maxLength?: number; min?: number; max?: number };
  }>({
    id: '',
    label: '',
    type: 'text',
    isRequired: false,
    isEnabled: true,
    placeholder: '',
    order: 0,
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const response = await api.getFormSettings();
      const data = (response && (response as any).data !== undefined) ? (response as any).data : response;
      const success = (response && (response as any).success !== undefined) ? (response as any).success : true;
      if (data && (data.groups || Array.isArray(data.groups))) {
        setSettings(data as FormSettings);
        setExpandedSections(new Set((data.groups || []).map((g: FormGroup) => g.id)));
      } else if (!success || !data) {
        const initResponse = await api.initializeFormSettings();
        const initData = (initResponse && (initResponse as any).data !== undefined) ? (initResponse as any).data : initResponse;
        if (initData && (initData.groups || Array.isArray(initData.groups))) {
          setSettings(initData as FormSettings);
          setExpandedSections(new Set((initData.groups || []).map((g: FormGroup) => g.id)));
        } else {
          alertError('Failed to load', 'Could not load form. Please try again.');
        }
      }
    } catch (error: any) {
      alertError('Error', error.message || 'Failed to load form settings');
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (id: string) => {
    const next = new Set(expandedSections);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedSections(next);
  };

  const handleAddSection = async () => {
    if (!newSection.label.trim()) {
      alertError('Required', 'Section title is required');
      return;
    }
    try {
      setSaving(true);
      const id = newSection.label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      const maxOrder = settings?.groups?.length ? Math.max(...settings.groups.map((g) => g.order)) : 0;
      const response = await api.addFormGroup({
        id,
        label: newSection.label,
        description: newSection.description || '',
        order: maxOrder + 1,
        isSystem: false,
        isEnabled: true,
        fields: [],
      });
      if (response.success) {
        await loadSettings();
        setShowAddSection(false);
        setNewSection({ label: '', description: '' });
        alertSuccess('Section added', 'The section was created successfully.');
      } else {
        alertError('Failed to add section', response.message || 'Could not add section.');
      }
    } catch (error: any) {
      alertError('Error', error.message || 'Failed to add section');
    } finally {
      setSaving(false);
    }
  };

  const handleAddQuestion = async (groupId: string) => {
    if (!newQuestion.label?.trim()) {
      alertError('Required', 'Question is required');
      return;
    }
    const group = settings?.groups?.find((g) => g.id === groupId);
    if (!group) return;
    try {
      setSaving(true);
      const fieldId = newQuestion.label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      const maxOrder = group.fields.length ? Math.max(...group.fields.map((f) => f.order)) : 0;
      let dataType: string = 'string';
      if (newQuestion.type === 'number') dataType = 'number';
      else if (newQuestion.type === 'date') dataType = 'date';
      else if (newQuestion.type === 'array') dataType = 'array';
      else if (newQuestion.type === 'object') dataType = 'object';
      else if (newQuestion.type === 'userselect') dataType = 'array';

      const fieldData = {
        id: fieldId,
        label: newQuestion.label,
        type: newQuestion.type,
        dataType,
        placeholder: newQuestion.placeholder || '',
        isRequired: newQuestion.isRequired || false,
        isSystem: false,
        isEnabled: newQuestion.isEnabled !== false,
        order: maxOrder + 1,
        options: (newQuestion.type === 'select' || newQuestion.type === 'multiselect') ? (newQuestion.options || []) : undefined,
        validation: newQuestion.validation,
      };

      const response = await api.addFormField(groupId, fieldData);
      if (response.success) {
        await loadSettings();
        setShowAddQuestion(null);
        setNewQuestion({ label: '', type: 'text', dataType: 'string', isRequired: false, isEnabled: true, order: 0, placeholder: '' });
        setNewOption('');
        alertSuccess('Question added', 'The question was added to this section.');
      } else {
        alertError('Failed to add question', response.message || 'Could not add question.');
      }
    } catch (error: any) {
      alertError('Error', error.message || 'Failed to add question');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateSection = async (groupId: string, updates: Partial<FormGroup>) => {
    try {
      setSaving(true);
      const response = await api.updateFormGroup(groupId, updates);
      if (response.success) {
        await loadSettings();
        setEditingSection(null);
        alertSuccess('Section updated', 'Changes were saved.');
      } else {
        alertError('Failed to update section', response.message || 'Could not update section.');
      }
    } catch (error: any) {
      alertError('Error', error.message || 'Failed to update section');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateQuestion = async (groupId: string, fieldId: string, updates: Partial<FormField>) => {
    try {
      setSaving(true);
      const response = await api.updateFormField(groupId, fieldId, updates);
      if (response.success) {
        await loadSettings();
        setEditingQuestion(null);
        alertSuccess('Question updated', 'Changes were saved.');
      } else {
        alertError('Failed to update question', response.message || 'Could not update question.');
      }
    } catch (error: any) {
      alertError('Error', error.message || 'Failed to update question');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSection = async (groupId: string) => {
    const group = settings?.groups?.find((g) => g.id === groupId);
    const confirmed = await alertConfirm('Delete section?', `Delete "${group?.label}"? All questions in it will be removed.`, 'Delete');
    if (!confirmed.isConfirmed) return;
    try {
      setSaving(true);
      const response = await api.deleteFormGroup(groupId);
      if (response.success) {
        await loadSettings();
        alertSuccess('Section deleted', 'The section was removed.');
      } else {
        alertError('Failed to delete section', response.message || 'Could not delete section.');
      }
    } catch (error: any) {
      alertError('Error', error.message || 'Failed to delete section');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteQuestion = async (groupId: string, fieldId: string) => {
    const field = settings?.groups?.find((g) => g.id === groupId)?.fields?.find((f) => f.id === fieldId);
    const confirmed = await alertConfirm('Delete question?', `Delete "${field?.label}"?`, 'Delete');
    if (!confirmed.isConfirmed) return;
    try {
      setSaving(true);
      const response = await api.deleteFormField(groupId, fieldId);
      if (response.success) {
        await loadSettings();
        setEditingQuestion(null);
        alertSuccess('Question deleted', 'The question was removed.');
      } else {
        alertError('Failed to delete question', response.message || 'Could not delete question.');
      }
    } catch (error: any) {
      alertError('Error', error.message || 'Failed to delete question');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/20">
        <p className="text-red-700 dark:text-red-300">Could not load form settings.</p>
        <button onClick={loadSettings} className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
          Retry
        </button>
      </div>
    );
  }

  const handleMoveGroup = async (groupId: string, direction: 'up' | 'down') => {
    if (!settings) return;
    const sorted = [...settings.groups].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((g) => g.id === groupId);
    if ((direction === 'up' && idx <= 0) || (direction === 'down' && idx >= sorted.length - 1)) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    [sorted[idx], sorted[swapIdx]] = [sorted[swapIdx], sorted[idx]];
    const groupIds = sorted.map((g) => g.id);
    try {
      setSaving(true);
      const response = await api.reorderFormGroups(groupIds);
      if (response.success) await loadSettings();
      else alertError('Reorder failed', response.message || 'Could not reorder sections.');
    } catch (error: any) {
      alertError('Error', error.message || 'Failed to reorder sections');
    } finally {
      setSaving(false);
    }
  };

  const handleMoveField = async (groupId: string, fieldId: string, direction: 'up' | 'down') => {
    if (!settings) return;
    const group = settings.groups.find((g) => g.id === groupId);
    if (!group) return;
    const sorted = [...group.fields].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((f) => f.id === fieldId);
    if ((direction === 'up' && idx <= 0) || (direction === 'down' && idx >= sorted.length - 1)) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    [sorted[idx], sorted[swapIdx]] = [sorted[swapIdx], sorted[idx]];
    const fieldIds = sorted.map((f) => f.id);
    try {
      setSaving(true);
      const response = await api.reorderFormFields(groupId, fieldIds);
      if (response.success) await loadSettings();
      else alertError('Reorder failed', response.message || 'Could not reorder fields.');
    } catch (error: any) {
      alertError('Error', error.message || 'Failed to reorder fields');
    } finally {
      setSaving(false);
    }
  };

  const handleMoveQualField = async (fieldId: string, direction: 'up' | 'down') => {
    if (!settings?.qualifications?.fields) return;
    const sorted = [...settings.qualifications.fields].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const idx = sorted.findIndex((f) => f.id === fieldId);
    if ((direction === 'up' && idx <= 0) || (direction === 'down' && idx >= sorted.length - 1)) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    [sorted[idx], sorted[swapIdx]] = [sorted[swapIdx], sorted[idx]];
    const fieldIds = sorted.map((f) => f.id);
    try {
      setSaving(true);
      const response = await api.reorderQualificationsFields(fieldIds);
      if (response.success) await loadSettings();
      else alertError('Reorder failed', response.message || 'Could not reorder qualification columns.');
    } catch (error: any) {
      alertError('Error', error.message || 'Failed to reorder columns');
    } finally {
      setSaving(false);
    }
  };

  const handleAddQualField = async () => {
    if (!newQualField.label.trim()) {
      alertError('Required', 'Column name is required');
      return;
    }
    try {
      setSaving(true);
      const id = newQualField.label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      const maxOrder = settings?.qualifications?.fields?.length ? Math.max(...settings.qualifications.fields.map((f) => f.order ?? 0)) : 0;

      const response = await api.addQualificationsField({
        id,
        label: newQualField.label,
        type: newQualField.type,
        isRequired: newQualField.isRequired,
        isEnabled: newQualField.isEnabled,
        placeholder: newQualField.placeholder,
        order: maxOrder + 1,
      });

      if (response.success) {
        await loadSettings();
        setShowAddQualField(false);
        setNewQualField({ id: '', label: '', type: 'text', isRequired: false, isEnabled: true, placeholder: '', order: 0 });
        alertSuccess('Column added', 'The qualification column was added.');
      } else {
        alertError('Failed to add column', response.message || 'Could not add column.');
      }
    } catch (error: any) {
      alertError('Error', error.message || 'Failed to add column');
    } finally {
      setSaving(false);
    }
  };

  const sortedGroups = [...(settings.groups || [])].sort((a, b) => a.order - b.order);

  return (
    <div className="w-full space-y-8 rounded-2xl bg-slate-50/60 p-6 dark:bg-slate-900/30 md:p-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-800 dark:text-white">Form builder</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Configure sections and questions for the employee application form.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddSection(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
        >
          <Plus className="h-4 w-4" />
          Add section
        </button>
      </div>

      {/* Add Section modal */}
      {showAddSection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm p-4" onClick={() => setShowAddSection(false)}>
          <div
            className="w-full max-w-md rounded-2xl border border-slate-100 bg-white p-6 shadow-lg dark:border-slate-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-slate-800 dark:text-white">New section</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Sections group related questions (e.g. Personal info, Contact).</p>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">Section title</label>
                <input
                  type="text"
                  value={newSection.label}
                  onChange={(e) => setNewSection({ ...newSection, label: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-800 shadow-sm focus:border-violet-400 focus:ring-1 focus:ring-violet-400 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                  placeholder="e.g. Personal information"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">Description (optional)</label>
                <input
                  type="text"
                  value={newSection.description}
                  onChange={(e) => setNewSection({ ...newSection, description: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-800 shadow-sm focus:border-violet-400 focus:ring-1 focus:ring-violet-400 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                  placeholder="Brief description for this section"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShowAddSection(false); setNewSection({ label: '', description: '' }); }}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddSection}
                disabled={saving || !newSection.label.trim()}
                className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? 'Adding…' : 'Add section'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Qualification Field modal */}
      {showAddQualField && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm p-4" onClick={() => setShowAddQualField(false)}>
          <div
            className="w-full max-w-md rounded-2xl border border-slate-100 bg-white p-6 shadow-lg dark:border-slate-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-slate-800 dark:text-white">New qualification column</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Add a new field to the qualifications table.</p>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">Column name</label>
                <input
                  type="text"
                  value={newQualField.label}
                  onChange={(e) => setNewQualField({ ...newQualField, label: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-800 shadow-sm focus:border-violet-400 focus:ring-1 focus:ring-violet-400 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                  placeholder="e.g. Percentage"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">Type</label>
                <select
                  value={newQualField.type}
                  onChange={(e) => setNewQualField({ ...newQualField, type: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-violet-400 focus:ring-1 focus:ring-violet-400 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                >
                  {QUAL_FIELD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">Placeholder (optional)</label>
                <input
                  type="text"
                  value={newQualField.placeholder}
                  onChange={(e) => setNewQualField({ ...newQualField, placeholder: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-800 shadow-sm focus:border-violet-400 focus:ring-1 focus:ring-violet-400 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                  placeholder="e.g. E.g., 85%"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newQualField.isRequired}
                  onChange={(e) => setNewQualField({ ...newQualField, isRequired: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                />
                <span className="text-sm text-slate-600 dark:text-slate-300">Required field</span>
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddQualField(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddQualField}
                disabled={saving || !newQualField.label.trim()}
                className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? 'Adding…' : 'Add column'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sections */}
      <div className="space-y-4">
        {sortedGroups.map((group) => (
          <div
            key={group.id}
            className="overflow-hidden rounded-2xl border border-slate-100 bg-white/90 shadow-sm dark:border-slate-700/50 dark:bg-slate-900/80"
          >
            {/* Section header */}
            <div
              className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/50"
              onClick={() => toggleSection(group.id)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-slate-400">
                  {expandedSections.has(group.id) ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                </span>
                <div className="min-w-0">
                  <h3 className="font-medium text-slate-900 dark:text-white truncate">{group.label}</h3>
                  {group.description && (
                    <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{group.description}</p>
                  )}
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                    {group.fields?.length ?? 0} question{(group.fields?.length ?? 0) !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                {/* Add question: allowed for all groups including system */}
                <button
                  type="button"
                  onClick={() => {
                    setShowAddQuestion(group.id);
                    setNewQuestion({
                      label: '',
                      type: 'text',
                      dataType: 'string',
                      isRequired: false,
                      isEnabled: true,
                      placeholder: '',
                      order: 0,
                    });
                    setNewOption('');
                    if (!expandedSections.has(group.id)) setExpandedSections(prev => new Set(prev).add(group.id));
                  }}
                  className="rounded-xl p-2 text-violet-600 hover:bg-violet-50 dark:text-violet-400 dark:hover:bg-violet-900/30"
                  title="Add question"
                >
                  <Plus className="h-4 w-4" />
                </button>
                {/* Section action buttons */}
                <button
                  type="button"
                  onClick={() => handleMoveGroup(group.id, 'up')}
                  disabled={saving}
                  className="rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 disabled:opacity-30"
                  title="Move section up"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleMoveGroup(group.id, 'down')}
                  disabled={saving}
                  className="rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 disabled:opacity-30"
                  title="Move section down"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingSection(group.id)}
                  className="rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                  title="Edit section"
                >
                  <Layers className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteSection(group.id)}
                  className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-slate-800 dark:hover:text-red-400"
                  title="Delete section"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Edit section inline */}
            {editingSection === group.id && (
              <div className="border-t border-slate-200 bg-slate-50/50 px-4 py-4 dark:border-slate-700 dark:bg-slate-800/30">
                <div className="flex flex-col gap-3 max-w-md">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Section title</label>
                    <input
                      type="text"
                      value={group.label}
                      onChange={(e) => {
                        const next = settings.groups.map((g) => (g.id === group.id ? { ...g, label: e.target.value } : g));
                        setSettings({ ...settings, groups: next });
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Description</label>
                    <input
                      type="text"
                      value={group.description || ''}
                      onChange={(e) => {
                        const next = settings.groups.map((g) => (g.id === group.id ? { ...g, description: e.target.value } : g));
                        setSettings({ ...settings, groups: next });
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                      placeholder="Optional"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleUpdateSection(group.id, { label: group.label, description: group.description })}
                      disabled={saving}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditingSection(null); loadSettings(); }}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Section content: questions */}
            {expandedSections.has(group.id) && (
              <div className="border-t border-slate-200 px-4 py-4 dark:border-slate-700">
                {/* Add question form */}
                {showAddQuestion === group.id && (
                  <div className="mb-6 rounded-2xl border border-violet-100 bg-violet-50/50 p-5 dark:border-violet-900/30 dark:bg-violet-900/10">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">New question</h4>
                    <div className="mt-4 space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Question</label>
                        <input
                          type="text"
                          value={newQuestion.label || ''}
                          onChange={(e) => setNewQuestion({ ...newQuestion, label: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                          placeholder="e.g. Full name"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Description / help text (optional)</label>
                        <input
                          type="text"
                          value={newQuestion.placeholder || ''}
                          onChange={(e) => setNewQuestion({ ...newQuestion, placeholder: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                          placeholder="Shown below the question"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Question type</label>
                        <select
                          value={newQuestion.type || 'text'}
                          onChange={(e) => {
                            const type = e.target.value as FormField['type'];
                            let dataType = 'string';
                            if (type === 'number') dataType = 'number';
                            else if (type === 'date') dataType = 'date';
                            else if (type === 'array') dataType = 'array';
                            else if (type === 'object') dataType = 'object';
                            else if (type === 'userselect') dataType = 'array';
                            setNewQuestion({ ...newQuestion, type, dataType, options: (type === 'select' || type === 'multiselect') ? (newQuestion.options || []) : undefined });
                          }}
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                        >
                          {QUESTION_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newQuestion.isRequired || false}
                            onChange={(e) => setNewQuestion({ ...newQuestion, isRequired: e.target.checked })}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="text-sm text-slate-700 dark:text-slate-300">Required</span>
                        </label>
                      </div>
                      {(newQuestion.type === 'select' || newQuestion.type === 'multiselect') && (
                        <div>
                          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Options</label>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {(newQuestion.options || []).map((opt, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-3 py-1 text-sm dark:bg-slate-700"
                              >
                                {opt.label}
                                <button
                                  type="button"
                                  onClick={() => setNewQuestion({ ...newQuestion, options: (newQuestion.options || []).filter((_, j) => j !== i) })}
                                  className="rounded p-0.5 hover:bg-slate-300 dark:hover:bg-slate-600"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                          <div className="mt-2 flex gap-2">
                            <input
                              type="text"
                              value={newOption}
                              onChange={(e) => setNewOption(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  if (newOption.trim()) {
                                    setNewQuestion({ ...newQuestion, options: [...(newQuestion.options || []), { label: newOption.trim(), value: newOption.trim() }] });
                                    setNewOption('');
                                  }
                                }
                              }}
                              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                              placeholder="Add option"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (newOption.trim()) {
                                  setNewQuestion({ ...newQuestion, options: [...(newQuestion.options || []), { label: newOption.trim(), value: newOption.trim() }] });
                                  setNewOption('');
                                }
                              }}
                              className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300 dark:bg-slate-600 dark:text-white dark:hover:bg-slate-500"
                            >
                              Add option
                            </button>
                          </div>
                        </div>
                      )}
                      {(newQuestion.type === 'text' || newQuestion.type === 'textarea' || newQuestion.type === 'email' || newQuestion.type === 'tel') && (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Min length</label>
                            <input
                              type="number"
                              min={0}
                              value={newQuestion.validation?.minLength ?? ''}
                              onChange={(e) => {
                                const v = e.target.value ? Number(e.target.value) : undefined;
                                setNewQuestion({ ...newQuestion, validation: { ...newQuestion.validation, minLength: v } });
                              }}
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                              placeholder="Optional"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Max length</label>
                            <input
                              type="number"
                              min={0}
                              value={newQuestion.validation?.maxLength ?? ''}
                              onChange={(e) => {
                                const v = e.target.value ? Number(e.target.value) : undefined;
                                setNewQuestion({ ...newQuestion, validation: { ...newQuestion.validation, maxLength: v } });
                              }}
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                              placeholder="Optional"
                            />
                          </div>
                        </div>
                      )}
                      {newQuestion.type === 'number' && (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Min value</label>
                            <input
                              type="number"
                              value={newQuestion.validation?.min ?? ''}
                              onChange={(e) => {
                                const v = e.target.value === '' ? undefined : Number(e.target.value);
                                setNewQuestion({ ...newQuestion, validation: { ...newQuestion.validation, min: v } });
                              }}
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Max value</label>
                            <input
                              type="number"
                              value={newQuestion.validation?.max ?? ''}
                              onChange={(e) => {
                                const v = e.target.value === '' ? undefined : Number(e.target.value);
                                setNewQuestion({ ...newQuestion, validation: { ...newQuestion.validation, max: v } });
                              }}
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleAddQuestion(group.id)}
                        disabled={saving || !newQuestion.label?.trim()}
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {saving ? 'Adding…' : 'Add question'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowAddQuestion(null); setNewOption(''); }}
                        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Questions list - cards in grid (2–3 per row); edit opens inside that card only */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {(group.fields || [])
                    .sort((a, b) => a.order - b.order)
                    .map((field) => {
                      const isEditingThis = editingQuestion?.groupId === group.id && editingQuestion?.fieldId === field.id;
                      return (
                        <div
                          key={field.id}
                          className={`overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-md shadow-slate-200/50 transition-shadow hover:shadow-lg hover:shadow-slate-200/50 dark:border-slate-700/60 dark:bg-slate-800/50 dark:shadow-slate-900/30 dark:hover:shadow-slate-900/40 ${isEditingThis ? 'sm:col-span-2 xl:col-span-3' : ''}`}
                        >
                          {isEditingThis ? (
                            /* Edit form inside this card only */
                            <div className="p-5">
                              <h4 className="text-sm font-semibold text-slate-800 dark:text-white">Edit question</h4>
                              <div className="mt-4 space-y-4">
                                <div>
                                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Question</label>
                                  <input
                                    type="text"
                                    value={field.label}
                                    onChange={(e) => {
                                      const next = settings.groups.map((g) =>
                                        g.id === group.id
                                          ? { ...g, fields: g.fields.map((f) => (f.id === field.id ? { ...f, label: e.target.value } : f)) }
                                          : g
                                      );
                                      setSettings({ ...settings, groups: next });
                                    }}
                                    disabled={field.isSystem}
                                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Description / help text</label>
                                  <input
                                    type="text"
                                    value={field.placeholder || ''}
                                    onChange={(e) => {
                                      const next = settings.groups.map((g) =>
                                        g.id === group.id
                                          ? { ...g, fields: g.fields.map((f) => (f.id === field.id ? { ...f, placeholder: e.target.value } : f)) }
                                          : g
                                      );
                                      setSettings({ ...settings, groups: next });
                                    }}
                                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                                    placeholder="Optional"
                                  />
                                </div>
                                <div className="flex items-center gap-4">
                                  <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={field.isRequired || false}
                                      onChange={(e) => {
                                        const next = settings.groups.map((g) =>
                                          g.id === group.id
                                            ? { ...g, fields: g.fields.map((f) => (f.id === field.id ? { ...f, isRequired: e.target.checked } : f)) }
                                            : g
                                        );
                                        setSettings({ ...settings, groups: next });
                                      }}
                                      disabled={field.isSystem}
                                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <span className="text-sm text-slate-700 dark:text-slate-300">Required</span>
                                  </label>
                                  <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={field.isEnabled !== false}
                                      onChange={(e) => {
                                        const next = settings.groups.map((g) =>
                                          g.id === group.id
                                            ? { ...g, fields: g.fields.map((f) => (f.id === field.id ? { ...f, isEnabled: e.target.checked } : f)) }
                                            : g
                                        );
                                        setSettings({ ...settings, groups: next });
                                      }}
                                      disabled={field.isSystem}
                                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <span className="text-sm text-slate-700 dark:text-slate-300">Enabled</span>
                                  </label>
                                </div>
                                {(field.type === 'select' || field.type === 'multiselect') && (
                                  <div>
                                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Options</label>
                                    <div className="mt-1 flex flex-wrap gap-2">
                                      {(field.options || []).map((opt, i) => (
                                        <span key={i} className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-3 py-1 text-sm dark:bg-slate-700">
                                          {opt.label}
                                          {!field.isSystem && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                const opts = (field.options || []).filter((_, j) => j !== i);
                                                const next = settings.groups.map((g) =>
                                                  g.id === group.id ? { ...g, fields: g.fields.map((f) => (f.id === field.id ? { ...f, options: opts } : f)) } : g
                                                );
                                                setSettings({ ...settings, groups: next });
                                              }}
                                              className="rounded p-0.5 hover:bg-slate-300 dark:hover:bg-slate-600"
                                            >
                                              <X className="h-3 w-3" />
                                            </button>
                                          )}
                                        </span>
                                      ))}
                                    </div>
                                    {!field.isSystem && (
                                      <div className="mt-2 flex gap-2">
                                        <input
                                          type="text"
                                          id={`add-opt-${field.id}`}
                                          placeholder="Add option"
                                          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                                          onKeyDown={(e) => {
                                            const input = e.target as HTMLInputElement;
                                            if (e.key === 'Enter' && input.value.trim()) {
                                              const opts = [...(field.options || []), { label: input.value.trim(), value: input.value.trim() }];
                                              const next = settings.groups.map((g) =>
                                                g.id === group.id ? { ...g, fields: g.fields.map((f) => (f.id === field.id ? { ...f, options: opts } : f)) } : g
                                              );
                                              setSettings({ ...settings, groups: next });
                                              input.value = '';
                                            }
                                          }}
                                        />
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const input = document.getElementById(`add-opt-${field.id}`) as HTMLInputElement;
                                            if (input?.value.trim()) {
                                              const opts = [...(field.options || []), { label: input.value.trim(), value: input.value.trim() }];
                                              const next = settings.groups.map((g) =>
                                                g.id === group.id ? { ...g, fields: g.fields.map((f) => (f.id === field.id ? { ...f, options: opts } : f)) } : g
                                              );
                                              setSettings({ ...settings, groups: next });
                                              input.value = '';
                                            }
                                          }}
                                          className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300 dark:bg-slate-600 dark:text-white"
                                        >
                                          Add option
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="mt-4 flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const f = settings?.groups?.find((g) => g.id === group.id)?.fields?.find((x) => x.id === field.id);
                                    if (f) {
                                      handleUpdateQuestion(group.id, field.id, {
                                        label: f.label,
                                        placeholder: f.placeholder,
                                        isRequired: f.isRequired,
                                        isEnabled: f.isEnabled,
                                        options: f.options,
                                      });
                                    }
                                  }}
                                  disabled={saving}
                                  className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                                >
                                  {saving ? 'Saving…' : 'Save'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setEditingQuestion(null); loadSettings(); }}
                                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            /* View mode - same card */
                            <div className="flex items-start gap-4 p-5">
                              <span className="text-slate-300 dark:text-slate-500 mt-1 shrink-0"><GripVertical className="h-4 w-4" /></span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium text-slate-800 dark:text-white">{field.label}</span>
                                  {field.isRequired && (
                                    <span className="rounded-lg bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Required</span>
                                  )}
                                </div>
                                {field.placeholder && (
                                  <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                                    <HelpCircle className="h-3.5 w-3 shrink-0" /> {field.placeholder}
                                  </p>
                                )}
                                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{getQuestionTypeLabel(field.type)}</p>
                              </div>
                              <div className="flex gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleMoveField(group.id, field.id, 'up')}
                                  disabled={saving}
                                  className="rounded-xl p-2.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300 transition-colors disabled:opacity-30"
                                  title="Move up"
                                >
                                  <ArrowUp className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMoveField(group.id, field.id, 'down')}
                                  disabled={saving}
                                  className="rounded-xl p-2.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300 transition-colors disabled:opacity-30"
                                  title="Move down"
                                >
                                  <ArrowDown className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingQuestion({ groupId: group.id, fieldId: field.id })}
                                  className="rounded-xl p-2.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300 transition-colors"
                                  title="Edit question"
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteQuestion(group.id, field.id)}
                                  className="rounded-xl p-2.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-slate-700 dark:hover:text-red-400 transition-colors"
                                  title="Delete question"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Qualifications / Education & credentials */}
      {settings.qualifications && (
        <div className="rounded-2xl border border-slate-100 bg-white/80 p-6 shadow-sm backdrop-blur-sm dark:border-slate-700/50 dark:bg-slate-900/50">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600 dark:bg-violet-900/20 dark:text-violet-400">
                <GraduationCap className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-800 dark:text-white">Education & qualifications</h3>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Table columns for qualifications. Enable/disable columns below; applicants fill one row per exam (e.g. 10th, 12th, B.Tech).</p>
                <div className="mt-4 flex flex-wrap items-center gap-6">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.qualifications.isEnabled !== false}
                      onChange={async (e) => {
                        try {
                          await api.updateQualificationsConfig({ isEnabled: e.target.checked });
                          await loadSettings();
                          alertSuccess('Qualifications', 'Qualifications section updated.');
                        } catch (err: any) {
                          alertError('Error', err.message || 'Failed to update');
                        }
                      }}
                      className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                    />
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Enable qualifications</span>
                  </label>
                  {settings.qualifications.isEnabled !== false && (
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.qualifications.enableCertificateUpload || false}
                        onChange={async (e) => {
                          try {
                            await api.updateQualificationsConfig({ enableCertificateUpload: e.target.checked });
                            await loadSettings();
                            alertSuccess('Certificate upload', 'Setting updated.');
                          } catch (err: any) {
                            alertError('Error', err.message || 'Failed to update');
                          }
                        }}
                        className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                      />
                      <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Allow certificate upload</span>
                    </label>
                  )}
                </div>
              </div>
            </div>
          </div>

          {settings.qualifications.isEnabled !== false && (
            <>
              {/* Table: predefined qualification columns – enable/disable per column */}
              <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800/30">
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50">
                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Qualifications table columns</h4>
                  <button
                    type="button"
                    onClick={() => setShowAddQualField(true)}
                    className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add column</span>
                  </button>
                </div>
                {(settings.qualifications.fields && settings.qualifications.fields.length > 0) ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-800/50">
                          <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 w-14">S.No</th>
                          <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Column name</th>
                          <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 w-32">Type</th>
                          <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 w-20">Required</th>
                          <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 w-24">Enabled</th>
                          <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 w-24 text-center">Order</th>
                          <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 w-20">Edit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...(settings.qualifications.fields)]
                          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                          .map((field, index) => {
                            const isEditingThis = editingQualFieldId === field.id;
                            const updateQualFieldInSettings = (updates: Partial<QualificationField>) => {
                              setSettings(prev => {
                                if (!prev?.qualifications?.fields) return prev;
                                return {
                                  ...prev,
                                  qualifications: {
                                    ...prev.qualifications!,
                                    fields: prev.qualifications.fields.map(f => f.id === field.id ? { ...f, ...updates } : f),
                                  },
                                };
                              });
                            };
                            return (
                              <Fragment key={field._id ?? field.id}>
                                {isEditingThis ? (
                                  <tr className="bg-violet-50/50 dark:bg-slate-800/50">
                                    <td colSpan={7} className="p-4">
                                      <h4 className="text-sm font-semibold text-slate-800 dark:text-white">Edit qualification field</h4>
                                      <div className="mt-4 space-y-4">
                                        <div>
                                          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Field name</label>
                                          <input
                                            type="text"
                                            value={field.label}
                                            onChange={(e) => updateQualFieldInSettings({ label: e.target.value })}
                                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-violet-400 focus:ring-1 focus:ring-violet-400 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                                            placeholder="e.g. Degree"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Type</label>
                                          <select
                                            value={field.type}
                                            onChange={(e) => updateQualFieldInSettings({ type: e.target.value })}
                                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-violet-400 focus:ring-1 focus:ring-violet-400 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                                          >
                                            {QUAL_FIELD_TYPES.map((t) => (
                                              <option key={t.value} value={t.value}>{t.label}</option>
                                            ))}
                                          </select>
                                        </div>
                                        <div>
                                          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Placeholder (optional)</label>
                                          <input
                                            type="text"
                                            value={field.placeholder || ''}
                                            onChange={(e) => updateQualFieldInSettings({ placeholder: e.target.value })}
                                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-violet-400 focus:ring-1 focus:ring-violet-400 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                                            placeholder="e.g. E.g., B.Tech, MBA"
                                          />
                                        </div>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={field.isRequired || false}
                                            onChange={(e) => updateQualFieldInSettings({ isRequired: e.target.checked })}
                                            className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                                          />
                                          <span className="text-sm text-slate-600 dark:text-slate-300">Required</span>
                                        </label>
                                      </div>
                                      <div className="mt-4 flex gap-2">
                                        <button
                                          type="button"
                                          onClick={async () => {
                                            try {
                                              setSaving(true);
                                              await api.updateQualificationsField(field.id, {
                                                label: field.label,
                                                type: field.type,
                                                isRequired: field.isRequired,
                                                placeholder: field.placeholder || undefined,
                                              });
                                              await loadSettings();
                                              setEditingQualFieldId(null);
                                              alertSuccess('Qualification field updated', 'Changes were saved.');
                                            } catch (err: any) {
                                              alertError('Error', err.message || 'Failed to update');
                                            } finally {
                                              setSaving(false);
                                            }
                                          }}
                                          disabled={saving}
                                          className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                                        >
                                          {saving ? 'Saving…' : 'Save'}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => { setEditingQualFieldId(null); loadSettings(); }}
                                          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ) : (
                                  <tr className="border-b border-slate-100 hover:bg-slate-50/50 dark:border-slate-700 dark:hover:bg-slate-800/30">
                                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{index + 1}</td>
                                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-white">{field.label}</td>
                                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{getQualTypeLabel(field.type)}</td>
                                    <td className="px-4 py-3">
                                      {field.isRequired ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Yes</span> : <span className="text-slate-400 dark:text-slate-500">—</span>}
                                    </td>
                                    <td className="px-4 py-3">
                                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={field.isEnabled !== false}
                                          onChange={async (e) => {
                                            try {
                                              await api.updateQualificationsField(field.id, { isEnabled: e.target.checked });
                                              await loadSettings();
                                              alertSuccess('Field updated', 'Changes were saved.');
                                            } catch (err: any) {
                                              alertError('Error', err.message || 'Failed to update');
                                            }
                                          }}
                                          className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                                        />
                                        <span className="text-xs text-slate-500 dark:text-slate-400">{field.isEnabled !== false ? 'On' : 'Off'}</span>
                                      </label>
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="flex items-center justify-center gap-1">
                                        <button
                                          type="button"
                                          onClick={() => handleMoveQualField(field.id, 'up')}
                                          disabled={saving}
                                          className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30"
                                          title="Move up"
                                        >
                                          <ArrowUp className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleMoveQualField(field.id, 'down')}
                                          disabled={saving}
                                          className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30"
                                          title="Move down"
                                        >
                                          <ArrowDown className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="flex items-center gap-1">
                                        <button
                                          type="button"
                                          onClick={() => setEditingQualFieldId(field.id)}
                                          className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                                          title="Edit column"
                                        >
                                          <Pencil className="h-4 w-4" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={async () => {
                                            const confirmed = await alertConfirm('Delete column?', `Delete "${field.label}" from the database? This cannot be undone. Use Enable/Disable to hide the column without deleting.`, 'Delete');
                                            if (!confirmed.isConfirmed) return;
                                            try {
                                              await api.deleteQualificationsField(field.id);
                                              await loadSettings();
                                              alertSuccess('Column deleted', 'The column was removed from the database.');
                                            } catch (err: any) {
                                              alertError('Error', err.message || 'Failed to delete');
                                            }
                                          }}
                                          className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-slate-700 dark:hover:text-red-400"
                                          title="Delete column from database"
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-8 text-center dark:border-slate-700 dark:bg-slate-800/20">
                    <GraduationCap className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
                    <p className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-400">No qualification fields yet</p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-500">Predefined columns (Examination, University/Board, etc.) will appear after you load or initialize form settings.</p>
                  </div>
                )}
              </div>

              {/* Pre-filled rows: super admin fills these; applicants see them read-only */}
              {settings.qualifications.fields && settings.qualifications.fields.filter((f) => f.isEnabled !== false).length > 0 && (
                <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800/30">
                  <h4 className="border-b border-slate-200 bg-slate-50/80 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
                    Pre-filled rows (read-only for applicants)
                  </h4>
                  <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    Rows you add here will appear at the top of the qualifications table on the application form. Applicants cannot edit or remove them; they can only add and fill their own rows below.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[800px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-800/50">
                          <th className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-400 w-12">S.No</th>
                          {[...(settings.qualifications.fields)]
                            .filter((f) => f.isEnabled !== false)
                            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                            .map((f) => (
                              <th key={f.id} className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-400">
                                {f.label}
                              </th>
                            ))}
                          <th className="w-20 px-3 py-2 font-semibold text-slate-600 dark:text-slate-400">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {((settings.qualifications.defaultRows) || []).map((row: Record<string, unknown>, rowIndex: number) => (
                          <tr key={rowIndex} className="border-b border-slate-100 dark:border-slate-700/50">
                            <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{rowIndex + 1}</td>
                            {[...(settings.qualifications!.fields!)]
                              .filter((f) => f.isEnabled !== false)
                              .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                              .map((f) => (
                                <td key={f.id} className="px-3 py-2">
                                  {f.type === 'boolean' ? (
                                    <label className="flex items-center gap-1.5">
                                      <input
                                        type="checkbox"
                                        checked={!!row[f.id]}
                                        onChange={(e) => {
                                          const rows = [...(settings.qualifications!.defaultRows || [])];
                                          if (!rows[rowIndex]) rows[rowIndex] = {};
                                          rows[rowIndex] = { ...rows[rowIndex], [f.id]: e.target.checked };
                                          setSettings((prev) => prev ? { ...prev, qualifications: { ...prev.qualifications!, defaultRows: rows } } : prev);
                                        }}
                                        className="h-4 w-4 rounded border-slate-300 text-violet-600"
                                      />
                                      <span className="text-xs text-slate-500">Yes/No</span>
                                    </label>
                                  ) : f.type === 'date' ? (
                                    <input
                                      type={f.id === 'month_year_of_pass' ? 'month' : 'date'}
                                      value={row[f.id] ? String(row[f.id]).slice(0, f.id === 'month_year_of_pass' ? 7 : 10) : ''}
                                      onChange={(e) => {
                                        const rows = [...(settings.qualifications!.defaultRows || [])];
                                        if (!rows[rowIndex]) rows[rowIndex] = {};
                                        rows[rowIndex] = { ...rows[rowIndex], [f.id]: e.target.value ? (f.id === 'month_year_of_pass' ? `${e.target.value}-01` : e.target.value) : '' };
                                        setSettings((prev) => prev ? { ...prev, qualifications: { ...prev.qualifications!, defaultRows: rows } } : prev);
                                      }}
                                      className="w-full min-w-0 rounded-lg border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                                    />
                                  ) : (
                                    <input
                                      type={f.type === 'number' ? 'number' : 'text'}
                                      value={String(row[f.id] ?? '')}
                                      onChange={(e) => {
                                        const rows = [...(settings.qualifications!.defaultRows || [])];
                                        if (!rows[rowIndex]) rows[rowIndex] = {};
                                        rows[rowIndex] = { ...rows[rowIndex], [f.id]: f.type === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value };
                                        setSettings((prev) => prev ? { ...prev, qualifications: { ...prev.qualifications!, defaultRows: rows } } : prev);
                                      }}
                                      placeholder={f.placeholder}
                                      className="w-full min-w-0 rounded-lg border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                                    />
                                  )}
                                </td>
                              ))}
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => {
                                  const rows = (settings.qualifications!.defaultRows || []).filter((_: unknown, i: number) => i !== rowIndex);
                                  setSettings((prev) => prev ? { ...prev, qualifications: { ...prev.qualifications!, defaultRows: rows } } : prev);
                                }}
                                className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex gap-2 border-t border-slate-200 p-3 dark:border-slate-700">
                    <button
                      type="button"
                      onClick={() => {
                        const qualFields = [...(settings.qualifications!.fields!)].filter((f) => f.isEnabled !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                        const newRow = qualFields.reduce((acc, f) => {
                          acc[f.id] = f.type === 'number' ? 0 : f.type === 'boolean' ? false : '';
                          return acc;
                        }, {} as Record<string, unknown>);
                        const rows = [...(settings.qualifications!.defaultRows || []), newRow];
                        setSettings((prev) => prev ? { ...prev, qualifications: { ...prev.qualifications!, defaultRows: rows } } : prev);
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    >
                      Add row
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          setSaving(true);
                          await api.updateQualificationsConfig({
                            isEnabled: settings.qualifications!.isEnabled,
                            enableCertificateUpload: settings.qualifications!.enableCertificateUpload,
                            defaultRows: settings.qualifications!.defaultRows || [],
                          });
                          await loadSettings();
                          alertSuccess('Pre-filled rows saved', 'Applicants will see these rows as read-only.');
                        } catch (err: any) {
                          alertError('Error', err.message || 'Failed to save');
                        } finally {
                          setSaving(false);
                        }
                      }}
                      disabled={saving}
                      className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save pre-filled rows'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}