'use client';

import { useState, useEffect, useMemo } from 'react';
import { api } from '@/lib/api';
import { CertificateUpload } from '@/components/CertificateUpload';
import Spinner from '@/components/Spinner';

interface Field {
  id: string;
  label: string;
  type: string;
  dataType: string;
  isRequired: boolean;
  isSystem: boolean;
  placeholder?: string;
  defaultValue?: any;
  validation?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    custom?: string;
  };
  options?: Array<{ label: string; value: string }>;
  itemType?: string;
  itemSchema?: {
    fields: Field[];
  };
  minItems?: number;
  maxItems?: number;
  dateFormat?: string;
  order: number;
  isEnabled: boolean;
}

interface Group {
  id: string;
  label: string;
  description?: string;
  isSystem: boolean;
  isArray: boolean;
  fields: Field[];
  order: number;
  isEnabled: boolean;
}

interface QualificationsField {
  id: string;
  label: string;
  type: string;
  isRequired: boolean;
  isEnabled: boolean;
  placeholder?: string;
  validation?: {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
  };
  options?: Array<{ label: string; value: string }>;
  order: number;
}

interface QualificationsConfig {
  isEnabled: boolean;
  enableCertificateUpload?: boolean;
  fields: QualificationsField[];
  defaultRows?: Record<string, unknown>[];
}

interface FormSettings {
  groups: Group[];
  qualifications?: QualificationsConfig;
}

interface DynamicEmployeeFormProps {
  formData: any;
  onChange: (data: any) => void;
  errors?: Record<string, string>;
  departments?: Array<{ _id: string; name: string }>;
  designations?: Array<{ _id: string; name: string; department: string }>;
  divisions?: Array<{ _id: string; name: string }>;
  employeeGroups?: Array<{ _id: string; name: string; isActive?: boolean }>;
  onSettingsLoaded?: (settings: FormSettings) => void;
  simpleUpload?: boolean;
  isViewMode?: boolean;
  excludeFields?: string[];
  /** When true (editing existing employee), only pre-filled qualification cells are read-only; all others stay editable. When false (create), a cell becomes read-only after the user edits it (except certificate fields). */
  isEditingExistingEmployee?: boolean;
}

export default function DynamicEmployeeForm({
  formData,
  onChange,
  errors = {},
  departments = [],
  designations = [],
  onSettingsLoaded,
  simpleUpload = false,
  isViewMode = false,
  divisions = [],
  employeeGroups = [],
  excludeFields = [],
  isEditingExistingEmployee = false,
}: DynamicEmployeeFormProps) {
  const [settings, setSettings] = useState<FormSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<Array<{ _id: string; name: string; email: string; role?: string; divisionMapping?: Array<{ division?: { _id: string } | string }> }>>([]);
  const [groupingEnabled, setGroupingEnabled] = useState(false);
  const [fallbackEmployeeGroups, setFallbackEmployeeGroups] = useState<Array<{ _id: string; name: string; isActive?: boolean }>>([]);

  // Reporting-to dropdown: filter by selected division using each user's divisionMapping; super_admin and sub_admin shown for all divisions
  const divisionId = typeof formData?.division_id === 'object' ? (formData?.division_id as any)?._id : formData?.division_id;
  const reportingToUsers = useMemo(() => {
    if (!users.length) return [];
    const divId = divisionId ? String(divisionId).trim() : null;
    if (!divId) return users;
    return users.filter((u: any) => {
      const role = (u.role || '').toLowerCase().replace(/\s/g, '_');
      if (role === 'super_admin' || role === 'sub_admin') return true;
      const mapping = u.divisionMapping || [];
      return mapping.some((m: any) => {
        const d = m?.division;
        const mDivId = d != null ? (typeof d === 'object' ? d._id : d) : null;
        return mDivId != null && String(mDivId).trim() === divId;
      });
    });
  }, [users, divisionId]);

  useEffect(() => {
    loadSettings();
    loadUsers();
    loadGroupingConfig();
  }, []);

  const loadUsers = async () => {
    try {
      const response = await api.getUsers({ isActive: true, limit: 1000 });
      if (response.success && response.data) {
        setUsers(Array.isArray(response.data) ? response.data : []);
      }
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const loadSettings = async () => {
    try {
      const response = await api.getFormSettings();
      if (response.success) {
        setSettings(response.data);
        if (onSettingsLoaded) onSettingsLoaded(response.data);
      } else {
        // Try to initialize if settings don't exist
        const initResponse = await api.initializeFormSettings();
        if (initResponse.success) {
          setSettings(initResponse.data);
          if (onSettingsLoaded) onSettingsLoaded(initResponse.data);
        }
      }
    } catch (error) {
      console.error('Error loading form settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadGroupingConfig = async () => {
    try {
      const settingRes = await api.getSetting('custom_employee_grouping_enabled');
      const isEnabled = !!(settingRes?.success && settingRes?.data?.value);
      setGroupingEnabled(isEnabled);
      if (!isEnabled) {
        setFallbackEmployeeGroups([]);
        return;
      }
      const groupsRes = await api.getEmployeeGroups(true);
      if (groupsRes.success && Array.isArray(groupsRes.data)) {
        setFallbackEmployeeGroups(groupsRes.data);
      } else {
        setFallbackEmployeeGroups([]);
      }
    } catch {
      setGroupingEnabled(false);
      setFallbackEmployeeGroups([]);
    }
  };

  const effectiveEmployeeGroups = employeeGroups.length > 0 ? employeeGroups : fallbackEmployeeGroups;

  const handleFieldChange = (fieldId: string, value: any) => {
    const newData = {
      ...formData,
      [fieldId]: value,
    };

    // Cascading logic: Reset department if division changes
    if (fieldId === 'division_id') {
      newData.department_id = '';
      // Optionally reset designation if it's dependent on department
      newData.designation_id = '';
    }

    // Reset designation if department changes
    if (fieldId === 'department_id') {
      newData.designation_id = '';
    }

    onChange(newData);
  };

  const handleArrayItemChange = (fieldId: string, index: number, value: any) => {
    const currentArray = formData[fieldId] || [];
    const newArray = [...currentArray];
    newArray[index] = value;
    handleFieldChange(fieldId, newArray);
  };

  const handleArrayItemAdd = (fieldId: string, itemSchema?: { fields: Field[] }) => {
    const currentArray = formData[fieldId] || [];
    const newItem = itemSchema
      ? itemSchema.fields.reduce((acc, field) => {
        acc[field.id] = field.defaultValue || (field.type === 'number' ? 0 : '');
        return acc;
      }, {} as any)
      : '';
    handleFieldChange(fieldId, [...currentArray, newItem]);
  };

  const handleArrayItemRemove = (fieldId: string, index: number) => {
    const currentArray = formData[fieldId] || [];
    const newArray = currentArray.filter((_: any, i: number) => i !== index);
    handleFieldChange(fieldId, newArray);
  };

  const getEntityIdValue = (val: any): string => {
    if (val == null || val === '') return '';
    if (typeof val === 'object') return String(val._id || '');
    return String(val);
  };

  const renderField = (field: Field, groupId: string, arrayIndex?: number) => {
    if (excludeFields.includes(field.id)) return null;

    // When editing an employee (formData.gross_salary exists), map proposedSalary field to gross_salary
    const actualFieldId = field.id === 'proposedSalary' && formData?.gross_salary !== undefined
      ? 'gross_salary'
      : field.id;

    const fieldId = arrayIndex !== undefined ? `${actualFieldId}[${arrayIndex}]` : actualFieldId;
    const value = arrayIndex !== undefined
      ? formData[actualFieldId]?.[arrayIndex]
      : groupId === 'salaries'
        ? ((formData.salaries && typeof formData.salaries === 'object' ? formData.salaries[field.id] : undefined) ??
            formData[actualFieldId])
        : formData[actualFieldId];
    const error = errors[actualFieldId] || errors[fieldId];
    const fieldKey = `${groupId}-${field.id}${arrayIndex !== undefined ? `-${arrayIndex}` : ''}`;
    const displayLabel =
      // In employee edit flows, salary is stored as `gross_salary` but settings may expose it as `proposedSalary`.
      // Show a clearer label so users understand they're editing the employee gross salary.
      field.id === 'proposedSalary' && formData?.gross_salary !== undefined
        ? 'Gross Salary'
        : field.label;

    const localHandleFieldChange = (id: string, v: any) => {
      if (groupId === 'salaries' && arrayIndex === undefined) {
        onChange({
          ...formData,
          salaries: {
            ...(formData.salaries && typeof formData.salaries === 'object' ? formData.salaries : {}),
            [id]: v,
          },
        });
        return;
      }
      handleFieldChange(id, v);
    };

  // Special handling for division_id, department_id, designation_id and employee_group_id
    if (field.id === 'division_id') {
      const selectedDivisionId = getEntityIdValue(value);
      const selectedDivisionOptionMissing =
        selectedDivisionId && !divisions.some((div) => String(div._id) === selectedDivisionId);
      const selectedDivisionLabel =
        typeof value === 'object'
          ? String((value as any)?.name || selectedDivisionId)
          : selectedDivisionId;
      return (
        <div key={fieldKey}>
          <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
            {field.label} {field.isRequired && '*'}
          </label>
          <select
            value={selectedDivisionId}
            onChange={(e) => localHandleFieldChange(field.id, e.target.value)}
            required={field.isRequired}
            disabled={isViewMode}
            className={`w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${error ? 'border-red-300 dark:border-red-700' : 'border-slate-200 bg-white'
              }`}
          >
            <option value="">Select Division</option>
            {selectedDivisionOptionMissing && (
              <option value={selectedDivisionId}>{selectedDivisionLabel}</option>
            )}
            {divisions.map((div) => (
              <option key={div._id} value={div._id}>
                {div.name}
              </option>
            ))}
          </select>
          {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
      );
    }

    if (field.id === 'department_id') {
      // Filter departments based on selected division if division_id is set
      let filteredDepartments = departments;
      if (formData.division_id) {
        const selDivId = String(formData.division_id?._id || formData.division_id);
        const selectedDivision = (divisions as any[]).find(d => String(d._id) === selDivId);

        // Mirror the robust logic from page.tsx to ensure consistency
        filteredDepartments = departments.filter(d => {
          // 1. Check division's departments array
          if (selectedDivision?.departments) {
            const divDeptIds = selectedDivision.departments.map((dd: any) => typeof dd === 'string' ? dd : dd._id);
            if (divDeptIds.includes(d._id)) return true;
          }

          // 2. Check department's divisions array
          if ((d as any).divisions) {
            const deptDivIds = (d as any).divisions.map((dv: any) => typeof dv === 'string' ? dv : dv._id);
            if (deptDivIds.includes(selDivId)) return true;
          }

          // 3. Check department's division_id
          const dDivId = (d as any).division_id?._id || (d as any).division_id;
          if (dDivId && String(dDivId) === selDivId) return true;

          return false;
        });
      }

      const selectedDepartmentId = getEntityIdValue(value);
      const selectedDepartmentOptionMissing =
        selectedDepartmentId && !filteredDepartments.some((dept) => String(dept._id) === selectedDepartmentId);
      const selectedDepartmentLabel =
        typeof value === 'object'
          ? String((value as any)?.name || selectedDepartmentId)
          : selectedDepartmentId;
      return (
        <div key={fieldKey}>
          <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
            {field.label} {field.isRequired && '*'}
          </label>
          <select
            value={selectedDepartmentId}
            onChange={(e) => localHandleFieldChange(field.id, e.target.value)}
            required={field.isRequired}
            disabled={isViewMode || (divisions.length > 0 && !formData.division_id)}
            className={`w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${error ? 'border-red-300 dark:border-red-700' : 'border-slate-200 bg-white'
              }`}
          >
            <option value="">{formData.division_id ? 'Select Department' : 'Please select a Division first'}</option>
            {selectedDepartmentOptionMissing && (
              <option value={selectedDepartmentId}>{selectedDepartmentLabel}</option>
            )}
            {filteredDepartments.map((dept) => (
              <option key={dept._id} value={dept._id}>
                {dept.name}
              </option>
            ))}
          </select>
          {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
      );
    }

    if (field.id === 'designation_id') {
      // Show all designations (no department filtering)
      const filteredDesignations = designations;
      const selectedDesignationId = getEntityIdValue(value);
      const selectedDesignationOptionMissing =
        selectedDesignationId && !filteredDesignations.some((desig) => String(desig._id) === selectedDesignationId);
      const selectedDesignationLabel =
        typeof value === 'object'
          ? String((value as any)?.name || selectedDesignationId)
          : selectedDesignationId;
      return (
        <div key={fieldKey}>
          <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
            {field.label} {field.isRequired && '*'}
          </label>
          <select
            value={selectedDesignationId}
            onChange={(e) => localHandleFieldChange(field.id, e.target.value)}
            required={field.isRequired}
            disabled={isViewMode}
            className={`w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${error ? 'border-red-300 dark:border-red-700' : 'border-slate-200 bg-white'
              }`}
          >
            <option value="">Select Designation</option>
            {selectedDesignationOptionMissing && (
              <option value={selectedDesignationId}>{selectedDesignationLabel}</option>
            )}
            {filteredDesignations.map((desig) => (
              <option key={desig._id} value={desig._id}>
                {desig.name}
              </option>
            ))}
          </select>
          {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
      );
    }

    if (field.id === 'employee_group_id') {
      const activeGroups = effectiveEmployeeGroups.filter((g) => g.isActive !== false);
      const selectedGroupId =
        value && typeof value === 'object'
          ? ((value as any)._id || '')
          : (value || '');
      return (
        <div key={fieldKey}>
          <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
            {field.label} {field.isRequired && '*'}
          </label>
          <select
            value={selectedGroupId}
            onChange={(e) => localHandleFieldChange(field.id, e.target.value)}
            required={field.isRequired}
            disabled={isViewMode}
            className={`w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${error ? 'border-red-300 dark:border-red-700' : 'border-slate-200 bg-white'
              }`}
          >
            <option value="">Select Employee Group</option>
            {activeGroups.map((group) => (
              <option key={group._id} value={group._id}>
                {group.name}
              </option>
            ))}
          </select>
          {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
      );
    }

    switch (field.type) {
      case 'text':
      case 'tel':
      case 'email':
        return (
          <div key={fieldKey}>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {displayLabel} {field.isRequired && '*'}
            </label>
            <input
              type={field.type}
              value={value || ''}
              onChange={(e) => {
                const newValue = field.id === 'emp_no' ? e.target.value.toUpperCase() : e.target.value;
                localHandleFieldChange(field.id, newValue);
              }}
              placeholder={field.placeholder}
              required={field.isRequired}
              maxLength={field.validation?.maxLength}
              disabled={isViewMode}
              className={`w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${error ? 'border-red-300 dark:border-red-700' : 'border-slate-200 bg-white'
                } ${field.id === 'emp_no' || field.id === 'ifsc_code' ? 'uppercase' : ''}`}
            />
            {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        );

      case 'textarea':
        return (
          <div key={fieldKey} className={field.id === 'address' ? 'sm:col-span-2' : ''}>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {displayLabel} {field.isRequired && '*'}
            </label>
            <textarea
              value={value || ''}
              onChange={(e) => localHandleFieldChange(actualFieldId, e.target.value)}
              placeholder={field.placeholder}
              required={field.isRequired}
              rows={3}
              maxLength={field.validation?.maxLength}
              disabled={isViewMode}
              className={`w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${error ? 'border-red-300 dark:border-red-700' : 'border-slate-200 bg-white'
                }`}
            />
            {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        );

      case 'number':
        return (
          <div key={fieldKey}>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {displayLabel} {field.isRequired && '*'}
            </label>
            <input
              type="number"
              value={value || ''}
              onChange={(e) => localHandleFieldChange(actualFieldId, parseFloat(e.target.value) || 0)}
              onWheel={(e) => e.currentTarget.blur()}
              placeholder={field.placeholder}
              required={field.isRequired}
              min={field.validation?.min}
              max={field.validation?.max}
              step={field.id === 'proposedSalary' ? '0.01' : '1'}
              disabled={isViewMode}
              className={`w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 no-spinner ${error ? 'border-red-300 dark:border-red-700' : 'border-slate-200 bg-white'
                }`}
            />
            {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        );

      case 'date':
        return (
          <div key={fieldKey}>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {displayLabel} {field.isRequired && '*'}
            </label>
            <input
              type="date"
              value={value ? new Date(value).toISOString().split('T')[0] : ''}
              onChange={(e) => localHandleFieldChange(actualFieldId, e.target.value)}
              required={field.isRequired}
              className={`w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${error ? 'border-red-300 dark:border-red-700' : 'border-slate-200 bg-white'
                }`}
            />
            {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        );

      case 'select':
        return (
          <div key={fieldKey}>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {displayLabel} {field.isRequired && '*'}
            </label>
            <select
              value={value || ''}
              onChange={(e) => localHandleFieldChange(field.id, e.target.value || null)}
              required={field.isRequired}
              className={`w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${error ? 'border-red-300 dark:border-red-700' : 'border-slate-200 bg-white'
                }`}
            >
              <option value="">Select</option>
              {field.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        );

      case 'array':
        const arrayValue = formData[field.id] || [];
        return (
          <div key={fieldKey} className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {displayLabel} {field.isRequired && '*'}
              </label>
              {!isViewMode && (
                <button
                  type="button"
                  onClick={() => handleArrayItemAdd(field.id, field.itemSchema)}
                  className="rounded-lg bg-green-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-green-600"
                >
                  + Add
                </button>
              )}
            </div>

            {arrayValue.map((item: any, index: number) => (
              <div
                key={index}
                className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                    {field.label} #{index + 1}
                  </span>
                  {!isViewMode && (
                    <button
                      type="button"
                      onClick={() => handleArrayItemRemove(field.id, index)}
                      className="rounded-lg p-1 text-red-500 transition hover:bg-red-50 dark:hover:bg-red-900/30"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>

                {field.itemType === 'object' && field.itemSchema ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {field.itemSchema.fields.map((nestedField) => {
                      const nestedValue = item[nestedField.id];
                      const nestedError = errors[`${field.id}[${index}].${nestedField.id}`];
                      return (
                        <div key={`${fieldKey}-nested-${nestedField.id}`}>
                          <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                            {nestedField.label} {nestedField.isRequired && '*'}
                          </label>
                          {nestedField.type === 'text' || nestedField.type === 'textarea' ? (
                            nestedField.type === 'textarea' ? (
                              <textarea
                                value={nestedValue || ''}
                                onChange={(e) => {
                                  const newItem = { ...item, [nestedField.id]: e.target.value };
                                  handleArrayItemChange(field.id, index, newItem);
                                }}
                                placeholder={nestedField.placeholder}
                                required={nestedField.isRequired}
                                rows={3}
                                disabled={isViewMode}
                                className={`w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${nestedError ? 'border-red-300 dark:border-red-700' : 'border-slate-200 bg-white'
                                  }`}
                              />
                            ) : (
                              <input
                                type={nestedField.type}
                                value={nestedValue || ''}
                                onChange={(e) => {
                                  const newItem = { ...item, [nestedField.id]: e.target.value };
                                  handleArrayItemChange(field.id, index, newItem);
                                }}
                                placeholder={nestedField.placeholder}
                                required={nestedField.isRequired}
                                disabled={isViewMode}
                                className={`w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${nestedError ? 'border-red-300 dark:border-red-700' : 'border-slate-200 bg-white'
                                  }`}
                              />
                            )
                          ) : nestedField.type === 'number' ? (
                            <input
                              type="number"
                              value={nestedValue || ''}
                              onChange={(e) => {
                                const newItem = { ...item, [nestedField.id]: parseFloat(e.target.value) || 0 };
                                handleArrayItemChange(field.id, index, newItem);
                              }}
                              onWheel={(e) => e.currentTarget.blur()}
                              placeholder={nestedField.placeholder}
                              required={nestedField.isRequired}
                              min={nestedField.validation?.min}
                              max={nestedField.validation?.max}
                              disabled={isViewMode}
                              className={`w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 no-spinner ${nestedError ? 'border-red-300 dark:border-red-700' : 'border-slate-200 bg-white'
                                }`}
                            />
                          ) : nestedField.type === 'select' ? (
                            <select
                              value={nestedValue || ''}
                              onChange={(e) => {
                                const newItem = { ...item, [nestedField.id]: e.target.value || null };
                                handleArrayItemChange(field.id, index, newItem);
                              }}
                              required={nestedField.isRequired}
                              disabled={isViewMode}
                              className={`w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${nestedError ? 'border-red-300 dark:border-red-700' : 'border-slate-200 bg-white'
                                }`}
                            >
                              <option value="">Select</option>
                              {nestedField.options?.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          ) : null}
                          {nestedError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{nestedError}</p>}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <input
                    type={field.itemType === 'number' ? 'number' : 'text'}
                    value={item || ''}
                    onChange={(e) => {
                      const newValue = field.itemType === 'number' ? parseFloat(e.target.value) || 0 : e.target.value;
                      handleArrayItemChange(field.id, index, newValue);
                    }}
                    onWheel={(e) => field.itemType === 'number' && e.currentTarget.blur()}
                    placeholder={field.placeholder}
                    disabled={isViewMode}
                    className={`w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${field.itemType === 'number' ? 'no-spinner' : ''}`}
                  />
                )}
              </div>
            ))}

            {arrayValue.length === 0 && (
              <p className="text-sm text-slate-500 dark:text-slate-400">No items added yet</p>
            )}
            {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        );

      case 'email':
        return (
          <div key={fieldKey}>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {displayLabel} {field.isRequired && '*'}
            </label>
            <input
              type="email"
              value={value || ''}
              onChange={(e) => localHandleFieldChange(field.id, e.target.value)}
              placeholder={field.placeholder || 'example@email.com'}
              required={field.isRequired}
              className={`w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${error ? 'border-red-300 dark:border-red-700' : 'border-slate-200 bg-white'
                }`}
            />
            {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        );

      case 'tel':
        return (
          <div key={fieldKey}>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {displayLabel} {field.isRequired && '*'}
            </label>
            <input
              type="tel"
              value={value || ''}
              onChange={(e) => localHandleFieldChange(field.id, e.target.value)}
              placeholder={field.placeholder || '+91 1234567890'}
              required={field.isRequired}
              className={`w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${error ? 'border-red-300 dark:border-red-700' : 'border-slate-200 bg-white'
                }`}
            />
            {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        );

      case 'file':
        return (
          <div key={fieldKey}>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {displayLabel} {field.isRequired && '*'}
            </label>
            <input
              type="file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  // Store file name for now, you can enhance this to upload and store file URL
                  localHandleFieldChange(field.id, file.name);
                }
              }}
              required={field.isRequired}
              className={`w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${error ? 'border-red-300 dark:border-red-700' : 'border-slate-200 bg-white'
                }`}
            />
            {value && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Selected: {value}</p>}
            {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        );

      case 'multiselect':
        const multiValue = Array.isArray(value) ? value : value ? [value] : [];
        return (
          <div key={fieldKey}>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {displayLabel} {field.isRequired && '*'}
            </label>
            <div className="space-y-2">
              {field.options?.map((opt) => {
                const isChecked = multiValue.includes(opt.value);
                return (
                  <label key={opt.value} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        let newValue: any[] = [...multiValue];
                        if (e.target.checked) {
                          if (!newValue.includes(opt.value)) {
                            newValue.push(opt.value);
                          }
                        } else {
                          newValue = newValue.filter((v) => v !== opt.value);
                        }
                        localHandleFieldChange(field.id, newValue);
                      }}
                      disabled={isViewMode}
                      className="h-4 w-4 rounded border-slate-300 text-green-600 focus:ring-green-500"
                    />
                    <span className="text-sm text-slate-700 dark:text-slate-300">{opt.label}</span>
                  </label>
                );
              })}
            </div>
            {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        );

      case 'object':
        const objectValue = value || {};
        if (!field.itemSchema?.fields) {
          return (
            <div key={fieldKey} className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/50">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Object field "{field.label}" requires itemSchema configuration
              </p>
            </div>
          );
        }
        return (
          <div key={fieldKey} className="space-y-4">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {displayLabel} {field.isRequired && '*'}
            </label>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {field.itemSchema.fields.map((nestedField) => {
                  const nestedValue = objectValue[nestedField.id];
                  const nestedError = errors[`${field.id}.${nestedField.id}`];
                  return (
                    <div key={nestedField.id}>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                        {nestedField.label} {nestedField.isRequired && '*'}
                      </label>
                      {nestedField.type === 'text' || nestedField.type === 'email' || nestedField.type === 'tel' ? (
                        <input
                          type={nestedField.type}
                          value={nestedValue || ''}
                          onChange={(e) => {
                            localHandleFieldChange(field.id, {
                              ...objectValue,
                              [nestedField.id]: e.target.value,
                            });
                          }}
                          placeholder={nestedField.placeholder}
                          required={nestedField.isRequired}
                          disabled={isViewMode}
                          className={`w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${nestedError ? 'border-red-300 dark:border-red-700' : 'border-slate-200 bg-white'
                            }`}
                        />
                      ) : nestedField.type === 'textarea' ? (
                        <textarea
                          value={nestedValue || ''}
                          onChange={(e) => {
                            localHandleFieldChange(field.id, {
                              ...objectValue,
                              [nestedField.id]: e.target.value,
                            });
                          }}
                          placeholder={nestedField.placeholder}
                          required={nestedField.isRequired}
                          rows={3}
                          disabled={isViewMode}
                          className={`w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${nestedError ? 'border-red-300 dark:border-red-700' : 'border-slate-200 bg-white'
                            }`}
                        />
                      ) : nestedField.type === 'number' ? (
                        <input
                          type="number"
                          value={nestedValue || ''}
                          onChange={(e) => {
                            localHandleFieldChange(field.id, {
                              ...objectValue,
                              [nestedField.id]: parseFloat(e.target.value) || 0,
                            });
                          }}
                          onWheel={(e) => e.currentTarget.blur()}
                          placeholder={nestedField.placeholder}
                          required={nestedField.isRequired}
                          min={nestedField.validation?.min}
                          max={nestedField.validation?.max}
                          disabled={isViewMode}
                          className={`w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 no-spinner ${nestedError ? 'border-red-300 dark:border-red-700' : 'border-slate-200 bg-white'
                            }`}
                        />
                      ) : nestedField.type === 'date' ? (
                        <input
                          type="date"
                          value={nestedValue ? new Date(nestedValue).toISOString().split('T')[0] : ''}
                          onChange={(e) => {
                            localHandleFieldChange(field.id, {
                              ...objectValue,
                              [nestedField.id]: e.target.value,
                            });
                          }}
                          required={nestedField.isRequired}
                          className={`w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${nestedError ? 'border-red-300 dark:border-red-700' : 'border-slate-200 bg-white'
                            }`}
                        />
                      ) : nestedField.type === 'select' ? (
                        <select
                          value={nestedValue || ''}
                          onChange={(e) => {
                            localHandleFieldChange(field.id, {
                              ...objectValue,
                              [nestedField.id]: e.target.value || null,
                            });
                          }}
                          required={nestedField.isRequired}
                          className={`w-full rounded-xl border px-4 py-2.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${nestedError ? 'border-red-300 dark:border-red-700' : 'border-slate-200 bg-white'
                            }`}
                        >
                          <option value="">Select</option>
                          {nestedField.options?.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      {nestedError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{nestedError}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
            {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        );

      case 'userselect': {
        const selectedUserIds = Array.isArray(value) ? value : value ? [value] : [];
        const maxUsers = (field.validation as any)?.maxItems || 2;
        const isReportingTo = field.id === 'reporting_to' || field.id === 'reporting_to_';
        const usersForSelect = isReportingTo ? reportingToUsers : users;
        const canAddMore = selectedUserIds.length < maxUsers;
        const selectedUsers = selectedUserIds
          .map((id) => users.find((u) => u._id === id))
          .filter(Boolean) as typeof users;

        if (isReportingTo) {
          return (
            <div key={fieldKey} className="sm:col-span-2">
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                {displayLabel} {field.isRequired && '*'}
                {maxUsers > 1 && (
                  <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                    (Select up to {maxUsers})
                  </span>
                )}
              </label>
              <select
                value=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id || selectedUserIds.includes(id) || selectedUserIds.length >= maxUsers) return;
                  localHandleFieldChange(field.id, [...selectedUserIds, id]);
                  e.target.value = '';
                }}
                disabled={isViewMode || !canAddMore}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="">{divisionId ? 'Select from division…' : 'Select reporting manager…'}</option>
                {usersForSelect
                  .filter((u) => !selectedUserIds.includes(u._id))
                  .map((user) => (
                    <option key={user._id} value={user._id}>
                      {user.name} ({user.email})
                    </option>
                  ))}
              </select>
              {selectedUsers.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedUsers.map((user) => (
                    <span
                      key={user._id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300"
                    >
                      {user.name}
                      {!isViewMode && (
                        <button
                          type="button"
                          onClick={() => localHandleFieldChange(field.id, selectedUserIds.filter((id) => id !== user._id))}
                          className="rounded p-0.5 hover:bg-green-200 dark:hover:bg-green-800"
                          aria-label={`Remove ${user.name}`}
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
              {divisionId && usersForSelect.length === 0 && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  No users in this division. Select a division above or choose super admin / sub admin if available.
                </p>
              )}
              {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
            </div>
          );
        }

        return (
          <div key={fieldKey} className="sm:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {displayLabel} {field.isRequired && '*'}
              {maxUsers > 1 && (
                <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                  (Select up to {maxUsers})
                </span>
              )}
            </label>
            <div className="space-y-2">
              {usersForSelect.map((user) => {
                const isSelected = selectedUserIds.includes(user._id);
                const canSelect = isSelected || selectedUserIds.length < maxUsers;
                return (
                  <label
                    key={user._id}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all ${isSelected
                      ? 'border-green-400 bg-green-50 dark:border-green-600 dark:bg-green-900/20'
                      : canSelect
                        ? 'border-slate-200 bg-white hover:border-green-200 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600'
                        : 'border-slate-200 bg-slate-50 opacity-50 cursor-not-allowed dark:border-slate-700 dark:bg-slate-900/50'
                      }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        let newValue: string[] = [...selectedUserIds];
                        if (e.target.checked) {
                          if (!newValue.includes(user._id) && newValue.length < maxUsers) {
                            newValue.push(user._id);
                          }
                        } else {
                          newValue = newValue.filter((id) => id !== user._id);
                        }
                        localHandleFieldChange(field.id, newValue);
                      }}
                      disabled={!canSelect || isViewMode}
                      className="h-4 w-4 rounded border-slate-300 text-green-600 focus:ring-green-500 disabled:opacity-50"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{user.name}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{user.email}</div>
                    </div>
                    {isSelected && (
                      <svg className="h-5 w-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </label>
                );
              })}
              {selectedUserIds.length > 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedUserIds.length} of {maxUsers} selected
                </p>
              )}
            </div>
            {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        );
      }

      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
        Form settings not found. Please initialize settings first.
      </div>
    );
  }

  // Sort groups by desired priority first, then by their own order
  const groupPriority: Record<string, number> = {
    basic_info: 1,
    personal_info: 2,
    contact_info: 3,
    bank_details: 4,
  };
  const sortedGroups = [...settings.groups]
    .filter((g) => g.isEnabled)
    .sort((a, b) => {
      const pa = groupPriority[a.id] ?? 5;
      const pb = groupPriority[b.id] ?? 5;
      if (pa !== pb) return pa - pb;
      return a.order - b.order;
    });

  // Render qualifications section
  const renderQualifications = () => {
    if (!settings.qualifications || !settings.qualifications.isEnabled) {
      return null;
    }

    const qualFields = settings.qualifications.fields
      .filter((f) => f.isEnabled !== false && f.id !== 's_no')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    if (qualFields.length === 0) {
      return null;
    }

    const rawQualifications = formData.qualifications || [];
    const hasPreFilledFlags = Array.isArray(rawQualifications) && rawQualifications.some((r: any) => r && (r.isPreFilled === true || r.isPreFilled === false));
    const defaultRowsToShow = hasPreFilledFlags
      ? (rawQualifications as any[]).filter((r: any) => r.isPreFilled === true)
      : (settings.qualifications?.defaultRows || []);
    const applicantRowsToShow = hasPreFilledFlags
      ? (rawQualifications as any[]).filter((r: any) => r.isPreFilled !== true)
      : rawQualifications;
    const qualifications = hasPreFilledFlags ? rawQualifications : applicantRowsToShow;
    const defaultRows = defaultRowsToShow;
    /** Full merged list for reading (default rows + applicant rows) so default-row empty cells read/write correctly */
    const fullQualificationsForDisplay =
      hasPreFilledFlags ? rawQualifications : [...defaultRowsToShow.map((r: any) => ({ ...r, isPreFilled: true })), ...applicantRowsToShow];

    const qualIndexForApplicant = (applicantIndex: number) =>
      hasPreFilledFlags ? defaultRowsToShow.length + applicantIndex : applicantIndex;

    const handleQualificationChange = (applicantIndex: number, fieldId: string, value: any) => {
      const qualIndex = qualIndexForApplicant(applicantIndex);
      handleQualificationChangeByQualIndex(qualIndex, fieldId, value);
    };

    /** Update a single cell by global row index. Used for both default rows (empty cells) and applicant rows. */
    const handleQualificationChangeByQualIndex = (qualIndex: number, fieldId: string, value: any) => {
      const defaultLen = defaultRowsToShow.length;
      const fullArray = hasPreFilledFlags
        ? [...rawQualifications]
        : [...defaultRowsToShow.map((r: any) => ({ ...r, isPreFilled: true })), ...applicantRowsToShow];
      if (!fullArray[qualIndex]) fullArray[qualIndex] = {};
      fullArray[qualIndex] = { ...fullArray[qualIndex], [fieldId]: value };
      if (qualIndex < defaultLen) fullArray[qualIndex].isPreFilled = true;
      else fullArray[qualIndex].isPreFilled = false;
      handleFieldChange('qualifications', fullArray);
    };

    const handleAddQualification = () => {
      const newQual = qualFields.reduce((acc, field) => {
        if (field.type === 'number') acc[field.id] = 0;
        else if (field.type === 'boolean') acc[field.id] = false;
        else acc[field.id] = '';
        return acc;
      }, {} as any) as any;
      if (hasPreFilledFlags) newQual.isPreFilled = false;
      handleFieldChange('qualifications', [...(hasPreFilledFlags ? rawQualifications : applicantRowsToShow), newQual]);
    };

    const handleRemoveQualification = (applicantIndex: number) => {
      const qualIndex = qualIndexForApplicant(applicantIndex);
      const newQualifications = (hasPreFilledFlags ? rawQualifications : applicantRowsToShow).filter((_: any, i: number) => i !== qualIndex);
      handleFieldChange('qualifications', newQualifications);
    };

    const inputCls = (hasError: boolean) =>
      `w-full min-w-0 rounded-lg border px-2.5 py-1.5 text-sm transition-all focus:border-green-400 focus:outline-none focus:ring-1 focus:ring-green-400/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 ${hasError ? 'border-red-300 dark:border-red-700' : 'border-slate-200 bg-white'}`;

    const renderQualificationValueSpan = (value: any, field: QualificationsField) => {
      const display =
        field.type === 'boolean' ? (value ? 'Yes' : 'No')
          : field.type === 'date' && value && field.id === 'month_year_of_pass' ? String(value).slice(0, 7)
            : value != null && value !== '' ? String(value) : '—';
      return <span className="text-slate-700 dark:text-slate-300">{display}</span>;
    };

    /** Renders a single table cell for a qualification field (no label – headers are static). S.No is read-only. */
    const renderQualificationCell = (field: QualificationsField, qualIndex: number, applicantRowIndex: number) => {
      if (excludeFields.includes(field.id)) return null;
      const raw = qualifications[qualIndex]?.[field.id];
      const value = field.type === 'boolean' ? !!raw : (raw ?? '');
      const error = errors[`qualifications[${qualIndex}].${field.id}`];
      switch (field.type) {
        case 'text':
          return (
            <>
              <input
                type="text"
                value={value}
                onChange={(e) => handleQualificationChange(applicantRowIndex, field.id, e.target.value)}
                placeholder={field.placeholder}
                required={field.isRequired}
                disabled={isViewMode}
                className={inputCls(!!error)}
              />
              {error && <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
            </>
          );
        case 'textarea':
          return (
            <>
              <textarea
                value={value}
                onChange={(e) => handleQualificationChange(applicantRowIndex, field.id, e.target.value)}
                placeholder={field.placeholder}
                required={field.isRequired}
                rows={2}
                disabled={isViewMode}
                className={inputCls(!!error)}
              />
              {error && <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
            </>
          );
        case 'number':
          return (
            <>
              <input
                type="number"
                value={value}
                onChange={(e) => handleQualificationChange(applicantRowIndex, field.id, parseFloat(e.target.value) || 0)}
                placeholder={field.placeholder}
                required={field.isRequired}
                min={field.validation?.min}
                max={field.validation?.max}
                disabled={isViewMode}
                className={inputCls(!!error)}
              />
              {error && <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
            </>
          );
        case 'date': {
          const isMonthYear = field.id === 'month_year_of_pass';
          const dateValue = value ?? '';
          const monthInputValue = isMonthYear && dateValue ? String(dateValue).slice(0, 7) : dateValue;
          return (
            <>
              <input
                type={isMonthYear ? 'month' : 'date'}
                value={isMonthYear ? (monthInputValue && monthInputValue.length >= 7 ? monthInputValue : '') : dateValue}
                onChange={(e) => handleQualificationChange(applicantRowIndex, field.id, isMonthYear ? (e.target.value ? `${e.target.value}-01` : '') : e.target.value)}
                required={field.isRequired}
                disabled={isViewMode}
                className={inputCls(!!error)}
              />
              {error && <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
            </>
          );
        }
        case 'select':
          return (
            <>
              <select
                value={value}
                onChange={(e) => handleQualificationChange(applicantRowIndex, field.id, e.target.value)}
                required={field.isRequired}
                disabled={isViewMode}
                className={inputCls(!!error)}
              >
                <option value="">Select</option>
                {field.options?.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {error && <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
            </>
          );
        case 'boolean':
          return (
            <>
              <select
                value={value ? 'true' : 'false'}
                onChange={(e) => handleQualificationChange(applicantRowIndex, field.id, e.target.value === 'true')}
                disabled={isViewMode}
                className={inputCls(!!error)}
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
              {error && <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
            </>
          );
        default:
          return null;
      }
    };

    /** Renders an editable cell by global qualIndex (used for empty cells in default/pre-filled rows). */
    const renderQualificationCellByQualIndex = (field: QualificationsField, qualIndex: number) => {
      if (excludeFields.includes(field.id)) return null;
      const rowData = fullQualificationsForDisplay[qualIndex] || {};
      const raw = rowData[field.id];
      const value = field.type === 'boolean' ? !!raw : (raw ?? '');
      const error = errors[`qualifications[${qualIndex}].${field.id}`];
      const onChange = (v: any) => handleQualificationChangeByQualIndex(qualIndex, field.id, v);

      switch (field.type) {
        case 'text':
          return (
            <>
              <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={field.placeholder}
                required={field.isRequired}
                disabled={isViewMode}
                className={inputCls(!!error)}
              />
              {error && <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
            </>
          );
        case 'textarea':
          return (
            <>
              <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={field.placeholder}
                required={field.isRequired}
                rows={2}
                disabled={isViewMode}
                className={inputCls(!!error)}
              />
              {error && <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
            </>
          );
        case 'number':
          return (
            <>
              <input
                type="number"
                value={value}
                onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
                placeholder={field.placeholder}
                required={field.isRequired}
                min={field.validation?.min}
                max={field.validation?.max}
                disabled={isViewMode}
                className={inputCls(!!error)}
              />
              {error && <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
            </>
          );
        case 'date': {
          const isMonthYear = field.id === 'month_year_of_pass';
          const dateValue = value ?? '';
          const monthInputValue = isMonthYear && dateValue ? String(dateValue).slice(0, 7) : dateValue;
          return (
            <>
              <input
                type={isMonthYear ? 'month' : 'date'}
                value={isMonthYear ? (monthInputValue && monthInputValue.length >= 7 ? monthInputValue : '') : dateValue}
                onChange={(e) => onChange(isMonthYear ? (e.target.value ? `${e.target.value}-01` : '') : e.target.value)}
                required={field.isRequired}
                disabled={isViewMode}
                className={inputCls(!!error)}
              />
              {error && <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
            </>
          );
        }
        case 'select':
          return (
            <>
              <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                required={field.isRequired}
                disabled={isViewMode}
                className={inputCls(!!error)}
              >
                <option value="">Select</option>
                {field.options?.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {error && <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
            </>
          );
        case 'boolean':
          return (
            <>
              <select
                value={value ? 'true' : 'false'}
                onChange={(e) => onChange(e.target.value === 'true')}
                disabled={isViewMode}
                className={inputCls(!!error)}
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
              {error && <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
            </>
          );
        default:
          return null;
      }
    };

    /** True if this cell was pre-filled by the org (from form settings). Use original default rows, not current row, so applicant edits are not treated as pre-filled. Certificate submitted is always editable. */
    const hasPreFilledCellValueForDefaultRow = (rowIndex: number, field: QualificationsField) => {
      if (field.id === 's_no') return true;
      if (field.id === 'certificate_submitted') return false; // always editable in application and edit
      const originalDefaultRows = settings.qualifications?.defaultRows ?? [];
      const originalRow = originalDefaultRows[rowIndex] as Record<string, unknown> | undefined;
      if (!originalRow) return false;
      const v = originalRow[field.id];
      if (v === undefined || v === null || v === '') return false;
      const type = (field.type || '').toLowerCase();
      if (type === 'boolean') {
        return v === true || v === 'true';
      }
      return String(v).trim() !== '';
    };

    const certUploadEnabled = settings.qualifications?.enableCertificateUpload;
    const inputClsFile = "block w-full text-sm text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-green-50 file:text-green-700 hover:file:bg-green-100 dark:file:bg-green-900/20 dark:file:text-green-400";

    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Qualifications
        </h3>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          {defaultRows.length > 0
            ? 'Pre-filled rows: only cells with a value set by your organization are read-only. Empty cells are editable—fill them in and add more rows below if needed.'
            : 'Add rows for each exam (e.g. 10th, 12th, degree). Headers are fixed; fill only the values in each row.'}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100/80 dark:border-slate-700 dark:bg-slate-800/80">
                <th className="w-12 whitespace-nowrap px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-300">S.No</th>
                {qualFields.map((field) => (
                  <th key={field.id} className="whitespace-nowrap px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-300">
                    {field.label}
                    {field.isRequired && <span className="text-red-500"> *</span>}
                  </th>
                ))}
                {!isViewMode && !isEditingExistingEmployee && <th className="w-24 px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-300">Action</th>}
                {certUploadEnabled && <th className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-300">Certificate</th>}
              </tr>
            </thead>
            <tbody>
              {/* Pre-filled rows: only cells with a value are read-only; empty cells are editable */}
              {defaultRows.map((row: Record<string, unknown>, rowIndex: number) => (
                <tr key={`default-${rowIndex}`} className="border-b border-slate-100 bg-slate-50/50 dark:border-slate-700/50 dark:bg-slate-800/20">
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{rowIndex + 1}</td>
                  {qualFields.map((field) => (
                    <td key={field.id} className="align-top px-3 py-2">
                      {hasPreFilledCellValueForDefaultRow(rowIndex, field) ? (
                        field.id === 's_no' ? (
                          <span className="text-slate-600 dark:text-slate-400">{rowIndex + 1}</span>
                        ) : field.type === 'boolean' ? (
                          <span className="text-slate-700 dark:text-slate-300">{row[field.id] ? 'Yes' : 'No'}</span>
                        ) : field.type === 'date' && row[field.id] ? (
                          <span className="text-slate-700 dark:text-slate-300">
                            {field.id === 'month_year_of_pass' ? String(row[field.id]).slice(0, 7) : String(row[field.id])}
                          </span>
                        ) : (
                          <span className="text-slate-700 dark:text-slate-300">{row[field.id] != null && row[field.id] !== '' ? String(row[field.id]) : '—'}</span>
                        )
                      ) : (
                        renderQualificationCellByQualIndex(field, rowIndex)
                      )}
                    </td>
                  ))}
                  {!isViewMode && !isEditingExistingEmployee && <td className="align-top px-3 py-2 text-slate-400 dark:text-slate-500">—</td>}
                  {certUploadEnabled && (
                    <td className="align-top px-3 py-2">
                      {!isViewMode ? (
                        simpleUpload ? (
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/jpg,application/pdf"
                            onChange={(e) => handleQualificationChangeByQualIndex(rowIndex, 'certificateFile', e.target.files?.[0] || null)}
                            className={inputClsFile}
                          />
                        ) : (
                          <CertificateUpload
                            qualificationIndex={rowIndex}
                            certificateUrl={fullQualificationsForDisplay[rowIndex]?.certificateUrl}
                            onFileChange={(file) => handleQualificationChangeByQualIndex(rowIndex, 'certificateFile', file)}
                            onDelete={() => {
                              handleQualificationChangeByQualIndex(rowIndex, 'certificateFile', null);
                              handleQualificationChangeByQualIndex(rowIndex, 'certificateUrl', '');
                            }}
                            isViewMode={isViewMode}
                          />
                        )
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {/* Applicant rows: editable */}
              {applicantRowsToShow.map((qual: any, index: number) => {
                const qualIndex = qualIndexForApplicant(index);
                return (
                  <tr key={`app-${index}`} className="border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{defaultRowsToShow.length + index + 1}</td>
                    {qualFields.map((field) => (
                      <td key={field.id} className="align-top px-3 py-2">
                        {renderQualificationCell(field, qualIndex, index)}
                      </td>
                    ))}
                    {!isViewMode && !isEditingExistingEmployee && (
                      <td className="align-top px-3 py-2">
                        <button
                          type="button"
                          onClick={() => handleRemoveQualification(index)}
                          className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                        >
                          Remove
                        </button>
                      </td>
                    )}
                    {certUploadEnabled && (
                      <td className="align-top px-3 py-2">
                        {simpleUpload ? (
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/jpg,application/pdf"
                            onChange={(e) => handleQualificationChange(index, 'certificateFile', e.target.files?.[0] || null)}
                            disabled={isViewMode}
                            className={inputClsFile}
                          />
                        ) : (
                          <CertificateUpload
                            qualificationIndex={qualIndex}
                            certificateUrl={qualifications[qualIndex]?.certificateUrl}
                            onFileChange={(file) => handleQualificationChange(index, 'certificateFile', file)}
                            onDelete={() => {
                              handleQualificationChange(index, 'certificateFile', null);
                              handleQualificationChange(index, 'certificateUrl', '');
                            }}
                            isViewMode={isViewMode}
                          />
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!isViewMode && !isEditingExistingEmployee && (
          <button
            type="button"
            onClick={handleAddQualification}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-600 transition-colors hover:border-green-400 hover:bg-green-50 hover:text-green-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-green-500 dark:hover:bg-green-900/20 dark:hover:text-green-400"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add row
          </button>
        )}
      </div>
    );
  };

  const qualificationsBlock = renderQualifications();
  const shouldRenderEmployeeGroup =
    groupingEnabled &&
    effectiveEmployeeGroups.length > 0 &&
    !excludeFields.includes('employee_group_id');

  return (
    <div className="space-y-6">
      {sortedGroups.map((group) => {
        // Sort fields by order
        const sortedFields = [...group.fields]
          .filter((f) => f.isEnabled)
          .sort((a, b) => a.order - b.order);

        if (sortedFields.length === 0) return null;

        return (
          <div key={group.id}>
            <div
              className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50"
            >
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {group.label}
              </h3>
              {group.description && (
                <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">{group.description}</p>
              )}

              <div
                className={`grid grid-cols-1 gap-4 ${group.id === 'basic_info'
                  ? 'sm:grid-cols-2 lg:grid-cols-3'
                  : group.id === 'personal_info'
                    ? 'sm:grid-cols-2 lg:grid-cols-4'
                    : group.id === 'contact_info'
                      ? 'sm:grid-cols-2 lg:grid-cols-4'
                      : group.id === 'bank_details'
                        ? 'sm:grid-cols-2 lg:grid-cols-4'
                        : group.id === 'reporting_authority'
                          ? 'sm:grid-cols-1'
                          : 'sm:grid-cols-2'
                  }`}
              >
                {sortedFields.map((field) => renderField(field, group.id))}
                {group.id === 'basic_info' && shouldRenderEmployeeGroup && renderField({
                  id: 'employee_group_id',
                  label: 'Employee Group',
                  type: 'select',
                  dataType: 'string',
                  isRequired: false,
                  isSystem: true,
                  order: 9999,
                  isEnabled: true,
                } as Field, group.id)}
              </div>
            </div>

            {/* Render qualifications immediately after personal info */}
            {group.id === 'personal_info' && qualificationsBlock && (
              <div className="mt-6">{qualificationsBlock}</div>
            )}
          </div>
        );
      })}

      {/* If no personal info group exists, still show qualifications at the end */}
      {!sortedGroups.some((g) => g.id === 'personal_info') && qualificationsBlock}
    </div>
  );
}

