'use client';

import { useState, useEffect, useMemo } from 'react';
import { api } from '@/lib/api';
import { auth } from '@/lib/auth';
import Spinner from '@/components/Spinner';
import { User, Mail, Phone, Briefcase, Calendar, Shield, Key, Building, MapPin, X, RefreshCw, AlertTriangle, Check, Clock, Users } from 'lucide-react';

interface UserProfile {
  _id: string;
  name: string;
  email: string;
  role: string;
  roles: string[];
  department?: { _id: string; name: string };
  employeeId?: string;
  emp_no?: string;
  phone?: string;
  isActive?: boolean;
  is_active?: boolean;
  createdAt: string;
  lastLogin?: string;
  profilePhoto?: string | null;
}

interface HierarchyPerson {
  name: string;
  email?: string;
  role?: string;
  _id?: string;
}

interface EmployeeProfile {
  _id: string;
  emp_no: string;
  employee_name: string;
  joining_date?: string;
  designation?: { name: string; _id?: string };
  department?: { name: string; _id?: string };
  department_id?: string | { _id?: string; name?: string };
  division?: { name: string; _id?: string };
  division_id?: string | { _id?: string; name?: string };
  /** Legacy / SQL-shaped single reporting link */
  reporting_manager?: { employee_name?: string; name?: string; email?: string };
  /** Populated User refs from dynamicFields (leave workflow) */
  reporting_to?: Array<{ _id?: string; name?: string; email?: string; role?: string } | string>;
  dynamicFields?: {
    reporting_to?: Array<{ _id?: string; name?: string; email?: string; role?: string } | string>;
  };
  shiftId?: { name: string; startTime: string; endTime: string };
  employment_status?: string;
  blood_group?: string;
  personal_email?: string;
  address?: string;
}

function resolveId(val: unknown): string | undefined {
  if (val == null) return undefined;
  if (typeof val === 'string' && val.trim()) return val.trim();
  if (typeof val === 'object' && val !== null && '_id' in val) {
    const id = (val as { _id?: unknown })._id;
    if (id != null) return String(id);
  }
  return undefined;
}

function collectReportingManagers(emp: EmployeeProfile | null): HierarchyPerson[] {
  if (!emp) return [];
  const raw =
    (Array.isArray(emp.reporting_to) && emp.reporting_to.length > 0
      ? emp.reporting_to
      : Array.isArray(emp.dynamicFields?.reporting_to) && emp.dynamicFields.reporting_to.length > 0
        ? emp.dynamicFields!.reporting_to!
        : null);

  if (raw && raw.length > 0) {
    const out: HierarchyPerson[] = [];
    for (const item of raw) {
      if (item == null) continue;
      if (typeof item === 'string') {
        if (mongooseObjectIdShape(item)) {
          /* still an unresolved id — skip label */
          continue;
        }
        out.push({ name: item });
        continue;
      }
      const name =
        item.name ||
        (item as { employee_name?: string }).employee_name ||
        item.email ||
        '';
      if (!name) continue;
      out.push({
        name,
        email: item.email,
        role: item.role,
        _id: item._id != null ? String(item._id) : undefined,
      });
    }
    return out;
  }

  const leg = emp.reporting_manager;
  if (leg) {
    const name = leg.employee_name || leg.name;
    if (name) return [{ name, email: leg.email }];
  }
  return [];
}

function mongooseObjectIdShape(s: string) {
  return /^[a-f\d]{24}$/i.test(s);
}

function divisionHodForEmployee(
  department: { divisionHODs?: Array<{ division?: unknown; hod?: unknown }>; hod?: unknown } | null,
  divisionIdStr: string | undefined
): HierarchyPerson | null {
  if (!department) return null;
  if (divisionIdStr && Array.isArray(department.divisionHODs)) {
    const match = department.divisionHODs.find((dh) => {
      const id = resolveId(dh.division);
      return id && id === divisionIdStr;
    });
    const hod = match?.hod;
    if (hod && typeof hod === 'object' && hod !== null && 'name' in hod && (hod as { name?: string }).name) {
      const h = hod as { name: string; email?: string; role?: string; _id?: string };
      return { name: h.name, email: h.email, role: h.role, _id: h._id != null ? String(h._id) : undefined };
    }
  }
  const legacy = department.hod;
  if (legacy && typeof legacy === 'object' && legacy !== null && 'name' in legacy && (legacy as { name?: string }).name) {
    const h = legacy as { name: string; email?: string; role?: string };
    return { name: h.name, email: h.email, role: h.role };
  }
  return null;
}

/** Narrow `getDivision` / `getDepartment` style responses without unsafe casts on failure unions */
function orgRecordFromApiResponse(res: unknown): Record<string, unknown> | null {
  if (res == null || typeof res !== 'object' || !('success' in res)) return null;
  const r = res as { success?: boolean; data?: unknown };
  if (!r.success || r.data == null || typeof r.data !== 'object' || Array.isArray(r.data)) return null;
  return r.data as Record<string, unknown>;
}

export default function ProfilePage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [employee, setEmployee] = useState<EmployeeProfile | null>(null);
  /** Division + department with populated manager / division HODs for hierarchy display */
  const [orgHierarchy, setOrgHierarchy] = useState<{ division: Record<string, unknown> | null; department: Record<string, unknown> | null }>({
    division: null,
    department: null,
  });
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({ name: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'employment' | 'security'>('profile');

  // Password change state
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  // Toast notifications
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Profile Update Request state
  const [updateConfig, setUpdateConfig] = useState<any>(null);
  const [formGroups, setFormGroups] = useState<any[]>([]);
  const [allDivisions, setAllDivisions] = useState<any[]>([]);
  const [allDepartments, setAllDepartments] = useState<any[]>([]);
  const [allDesignations, setAllDesignations] = useState<any[]>([]);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestedChanges, setRequestedChanges] = useState<any>({});
  const [requestComments, setRequestComments] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);

  useEffect(() => {
    fetchUserProfile();
  }, []);

  const loadOrgHierarchyForEmployee = async (emp: EmployeeProfile) => {
    const divId = resolveId(emp.division_id) || resolveId(emp.division);
    const depId = resolveId(emp.department_id) || resolveId(emp.department);
    if (!divId && !depId) {
      setOrgHierarchy({ division: null, department: null });
      return;
    }
    try {
      const [divRes, depRes] = await Promise.all([
        divId ? api.getDivision(divId) : Promise.resolve({ success: false as const }),
        depId ? api.getDepartment(depId) : Promise.resolve({ success: false as const }),
      ]);
      setOrgHierarchy({
        division: orgRecordFromApiResponse(divRes),
        department: orgRecordFromApiResponse(depRes),
      });
    } catch {
      setOrgHierarchy({ division: null, department: null });
    }
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const hierarchyPeople = useMemo(() => {
    if (!employee) {
      return { reporting: [] as HierarchyPerson[], hod: null as HierarchyPerson | null, divManager: null as HierarchyPerson | null };
    }
    const reporting = collectReportingManagers(employee);
    const divisionIdStr = resolveId(employee.division_id) || resolveId(employee.division);
    const hod = divisionHodForEmployee(
      orgHierarchy.department as Parameters<typeof divisionHodForEmployee>[0],
      divisionIdStr
    );
    const mgrRaw = orgHierarchy.division?.manager as { name?: string; email?: string } | undefined;
    const divManager =
      mgrRaw?.name && typeof mgrRaw.name === 'string'
        ? { name: mgrRaw.name, email: mgrRaw.email }
        : null;
    return { reporting, hod, divManager };
  }, [employee, orgHierarchy]);

  const fetchUserProfile = async () => {
    try {
      const response = await api.getCurrentUser();
      if (response.success && response.data) {
        const userData = response.data.user;
        setUser(userData);
        setEditData({
          name: userData.name || '',
          phone: userData.phone || '',
        });

        // Fetch Employee Details if applicable
        const empIdentifier = (userData as any).emp_no || userData.employeeId;
        if (empIdentifier) {
          try {
            const empRes = await api.getEmployee(empIdentifier);
            if (empRes.success && empRes.data) {
              setEmployee(empRes.data);
              await loadOrgHierarchyForEmployee(empRes.data as EmployeeProfile);
            } else {
              setOrgHierarchy({ division: null, department: null });
            }
          } catch (err) {
            console.error('Error fetching linked employee profile:', err);
            setOrgHierarchy({ division: null, department: null });
          }
        } else {
          setOrgHierarchy({ division: null, department: null });
        }
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
      setToast({ type: 'error', message: 'Failed to load profile' });
    } finally {
      setLoading(false);
    }

    // Fetch Profile Update Configuration
    try {
      const [configRes, formRes, divisionsRes, departmentsRes, designationsRes] = await Promise.all([
        api.getSetting('profile_update_request_config'),
        api.getFormSettings(),
        api.getDivisions(undefined, undefined, true),
        api.getDepartments(undefined, undefined, true),
        api.getAllDesignations()
      ]);

      if (configRes.success && configRes.data) {
        setUpdateConfig(configRes.data.value);
      }

      if (formRes.success && formRes.data) {
        setFormGroups(formRes.data.groups);
      }

      if (divisionsRes.success && Array.isArray(divisionsRes.data)) {
        setAllDivisions(divisionsRes.data);
      }

      if (departmentsRes.success && Array.isArray(departmentsRes.data)) {
        setAllDepartments(departmentsRes.data);
      }

      if (designationsRes.success && Array.isArray(designationsRes.data)) {
        setAllDesignations(designationsRes.data);
      }
    } catch (err) {
      console.error('Error fetching update config:', err);
    }
  };

  const handleSubmitUpdateRequest = async () => {
    if (Object.keys(requestedChanges).length === 0) {
      setToast({ type: 'error', message: 'No changes requested' });
      return;
    }

    setSubmittingRequest(true);
    // Filter only fields that have actually changed
    const filteredChanges: any = {};
    Object.keys(requestedChanges).forEach(key => {
      const currentRawValue = getRawFieldValue(key);
      const normalizedCurrent = normalizeFieldValueForInput(key, currentRawValue);
      const normalizedRequested = normalizeFieldValueForInput(key, requestedChanges[key]);
      if (String(normalizedRequested ?? '') !== String(normalizedCurrent ?? '')) {
        filteredChanges[key] = requestedChanges[key];
      }
    });

    if (Object.keys(filteredChanges).length === 0) {
      setToast({ type: 'error', message: 'Please modify at least one field to request an update.' });
      setSubmittingRequest(false);
      return;
    }

    try {
      const response = await api.createEmployeeUpdateRequest({
        requestedChanges: filteredChanges,
        comments: requestComments
      });
      if (response.success) {
        setToast({ type: 'success', message: 'Update request submitted successfully' });
        setShowRequestModal(false);
        setRequestedChanges({});
        setRequestComments('');
      } else {
        setToast({ type: 'error', message: response.message || 'Failed to submit request' });
      }
    } catch (error: any) {
      setToast({ type: 'error', message: error.message || 'Failed to submit request' });
    } finally {
      setSubmittingRequest(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!editData.name.trim()) {
      setToast({ type: 'error', message: 'Name is required' });
      return;
    }

    setSaving(true);
    try {
      const response = await api.updateProfile(editData);
      if (response.success) {
        setUser((prev) => (prev ? { ...prev, ...editData } : null));
        // Update local storage user data
        const currentUser = auth.getUser();
        if (currentUser) {
          auth.setUser({ ...currentUser, name: editData.name });
        }
        setIsEditing(false);
        setToast({ type: 'success', message: 'Profile updated successfully' });
      } else {
        setToast({ type: 'error', message: response.message || 'Failed to update profile' });
      }
    } catch (error: any) {
      setToast({ type: 'error', message: error.message || 'Failed to update profile' });
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    // Validation
    if (!passwordData.currentPassword) {
      setPasswordError('Current password is required');
      return;
    }
    if (!passwordData.newPassword) {
      setPasswordError('New password is required');
      return;
    }
    if (passwordData.newPassword.length < 4) {
      setPasswordError('New password must be at least 4 characters');
      return;
    }
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }
    if (passwordData.currentPassword === passwordData.newPassword) {
      setPasswordError('New password must be different from current password');
      return;
    }

    setPasswordLoading(true);
    try {
      const response = await api.changePassword(passwordData.currentPassword, passwordData.newPassword);
      if (response.success) {
        setPasswordSuccess('Password changed successfully!');
        setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
      } else {
        setPasswordError(response.message || 'Failed to change password');
      }
    } catch (error: any) {
      setPasswordError(error.message || 'Failed to change password');
    } finally {
      setPasswordLoading(false);
    }
  };

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      super_admin: 'Super Admin',
      sub_admin: 'Sub Admin',
      hr: 'HR Manager',
      hod: 'Head of Department',
      employee: 'Employee',
      manager: 'Manager',
    };
    return labels[role] || role;
  };

  const getRoleBadgeColor = (role: string) => {
    const colors: Record<string, string> = {
      super_admin: 'bg-indigo-100 text-indigo-700 border-indigo-200',
      sub_admin: 'bg-blue-100 text-blue-700 border-blue-200',
      hr: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      hod: 'bg-amber-100 text-amber-700 border-amber-200',
      manager: 'bg-orange-100 text-orange-700 border-orange-200',
      employee: 'bg-slate-100 text-slate-700 border-slate-200',
    };
    return colors[role] || 'bg-slate-100 text-slate-700 border-slate-200';
  };

  const formatDate = (dateString?: string, includeTime = true) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      ...(includeTime && { hour: '2-digit', minute: '2-digit' }),
    });
  };

  const isDateLike = (value: string) => {
    if (!value) return false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return true;
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return true;
    return false;
  };

  const getPrimitiveValue = (value: any): string => {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) {
      return value
        .map((item) => getPrimitiveValue(item))
        .filter(Boolean)
        .join(', ');
    }
    if (typeof value === 'object') {
      const preferredKeys = ['name', 'label', 'title', 'employee_name', 'emp_no', 'code', 'value'];
      for (const key of preferredKeys) {
        if (value[key] !== undefined && value[key] !== null && value[key] !== '') {
          return String(value[key]);
        }
      }
      return '';
    }
    return String(value);
  };

  const formatFieldValue = (value: any): string => {
    const primitive = getPrimitiveValue(value);
    if (!primitive) return '—';
    if (isDateLike(primitive)) return formatDate(primitive, false);
    return primitive;
  };

  const getFieldDefinition = (fieldId: string) => {
    for (const group of formGroups) {
      const field = group?.fields?.find((f: any) => f.id === fieldId);
      if (field) return field;
    }
    return null;
  };

  const fieldAliases: Record<string, string[]> = {
    phone: ['phone_number', 'contact_number', 'mobile_number'],
    phone_number: ['phone', 'contact_number', 'mobile_number'],
    contact_number: ['phone_number', 'phone', 'mobile_number'],
    personal_email: ['email'],
    email: ['personal_email'],
    date_of_birth: ['dob', 'birth_date'],
    dob: ['date_of_birth', 'birth_date'],
    joining_date: ['doj', 'date_of_joining'],
    doj: ['joining_date', 'date_of_joining'],
    designation: ['designation_id'],
    designation_id: ['designation'],
    department: ['department_id'],
    department_id: ['department'],
    division: ['division_id'],
    division_id: ['division'],
  };

  const firstDefined = (...values: any[]) => {
    for (const value of values) {
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
  };

  const getRawFieldValue = (fieldId: string): any => {
    const aliases = fieldAliases[fieldId] || [];
    const candidateKeys = [fieldId, ...aliases];

    for (const key of candidateKeys) {
      const value = firstDefined(
        (user as any)?.[key],
        (employee as any)?.[key],
        (employee as any)?.dynamicFields?.[key]
      );
      if (value !== undefined) return value;
    }
    return undefined;
  };

  const toDateInputValue = (value: any): string => {
    const raw = getPrimitiveValue(value);
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().split('T')[0];
  };

  const toSelectInputValue = (rawValue: any, field: any): string => {
    const options = getFieldOptionsForRequest(field);
    const primitive = getPrimitiveValue(rawValue);
    const objectCandidates = rawValue && typeof rawValue === 'object'
      ? [rawValue._id, rawValue.id, rawValue.value, rawValue.code, rawValue.name, rawValue.label]
      : [];
    const candidates = [...objectCandidates, primitive]
      .filter((v) => v !== undefined && v !== null && v !== '')
      .map((v) => String(v).trim().toLowerCase());

    if (candidates.length === 0) return '';
    const matched = options.find((opt: any) => {
      const optValue = String(opt?.value ?? '').trim().toLowerCase();
      const optLabel = String(opt?.label ?? '').trim().toLowerCase();
      return candidates.includes(optValue) || candidates.includes(optLabel);
    });

    if (matched) return String(matched.value ?? '');
    return primitive || '';
  };

  const normalizeFieldValueForInput = (fieldId: string, rawValue: any): string => {
    const field = getFieldDefinition(fieldId);
    if (!field) return getPrimitiveValue(rawValue);

    if (field.type === 'date') return toDateInputValue(rawValue);
    if (field.type === 'select' || field.type === 'dropdown') return toSelectInputValue(rawValue, field);
    return getPrimitiveValue(rawValue);
  };

  const getFieldOptionsForRequest = (field: any) => {
    const fieldId = String(field?.id || '').toLowerCase();
    if (fieldId === 'division' || fieldId === 'division_id') {
      return allDivisions.map((d: any) => ({ value: String(d._id), label: d.name || d.code || String(d._id) }));
    }
    if (fieldId === 'department' || fieldId === 'department_id') {
      return allDepartments.map((d: any) => ({ value: String(d._id), label: d.name || d.code || String(d._id) }));
    }
    if (fieldId === 'designation' || fieldId === 'designation_id') {
      return allDesignations.map((d: any) => ({ value: String(d._id), label: d.name || d.code || String(d._id) }));
    }
    return field?.options || [];
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <div className="flex flex-col items-center gap-3 text-center">
          <Spinner />
          <p className="text-slate-500 font-medium text-sm sm:text-base">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <div className="text-center max-w-sm w-full">
          <p className="text-slate-500 text-base sm:text-lg">Unable to load profile</p>
          <button
            type="button"
            onClick={fetchUserProfile}
            className="mt-4 w-full sm:w-auto px-4 py-3 sm:py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 touch-manipulation min-h-[44px]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] px-3 sm:px-6 lg:px-8 overflow-x-hidden">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed z-50 left-3 right-3 top-[max(0.75rem,env(safe-area-inset-top))] sm:left-auto sm:right-4 sm:top-[max(1rem,env(safe-area-inset-top))] px-4 py-3 sm:px-6 sm:py-4 rounded-xl shadow-xl animate-slide-in max-w-[calc(100vw-1.5rem)] sm:max-w-md ${toast.type === 'success'
            ? 'bg-emerald-600 text-white'
            : 'bg-red-600 text-white'
            }`}
        >
          <div className="flex items-start gap-3">
            {toast.type === 'success' ? (
              <Shield className="w-5 h-5 shrink-0 mt-0.5" />
            ) : (
              <Shield className="w-5 h-5 shrink-0 mt-0.5" />
            )}
            <span className="font-medium text-sm sm:text-base break-words">{toast.message}</span>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto w-full min-w-0 space-y-4 sm:space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">My Profile</h1>
          {/* <p className="text-slate-500 mt-1">View and manage your account and employment details</p> */}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 lg:gap-8">

          {/* Left Column: Profile Card */}
          <div className="lg:col-span-4 space-y-4 sm:space-y-6 min-w-0">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden lg:sticky lg:top-8">
              {/* Cover Gradient - blue to teal/green */}
              <div className="h-24 bg-gradient-to-r from-blue-600 via-blue-500 to-teal-500 relative">
                {/* Active badge - top right, light background, green dot */}
                <div className="absolute top-4 right-4 flex items-center gap-2 bg-slate-100/95 backdrop-blur-sm px-3 py-1.5 rounded-full border border-slate-200/80">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${user.isActive || user.is_active !== false ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  <span className="text-xs font-medium text-slate-700">
                    {user.isActive || user.is_active !== false ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>

              {/* Avatar & Basic Info - photo overlaps header with white border */}
              <div className="px-4 sm:px-6 pb-5 sm:pb-6 text-center -mt-12 relative">
                <div className="w-20 h-20 sm:w-24 sm:h-24 mx-auto rounded-full bg-white border-4 border-white shadow-xl relative group ring-2 ring-slate-200/50">
                  {user.profilePhoto ? (
                    <img src={user.profilePhoto} alt={user.name} className="w-full h-full rounded-full object-cover" />
                  ) : (
                    <div className="w-full h-full rounded-full bg-slate-100 flex items-center justify-center text-4xl font-bold text-slate-400">
                      {user.name?.[0]?.toUpperCase() || 'U'}
                    </div>
                  )}
                  <label className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                    <span className="text-white text-xs font-medium px-2 text-center">Change photo</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/jpg"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const res = await api.uploadProfile(file) as { success?: boolean; url?: string };
                          if (res?.success && res?.url) {
                            await api.updateProfile({ profilePhoto: res.url });
                            setUser(prev => prev ? { ...prev, profilePhoto: res.url } : null);
                            setToast({ type: 'success', message: 'Profile photo updated' });
                          }
                        } catch (err) {
                          setToast({ type: 'error', message: 'Failed to upload photo' });
                        }
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>

                <div className="mt-4 px-0.5">
                  <h2 className="text-lg sm:text-xl font-bold text-slate-900 uppercase tracking-tight break-words">{user.name}</h2>
                  <p className="text-slate-500 text-xs sm:text-sm mt-1 break-all">{user.email}</p>
                </div>

                {/* Role & Department - pill tags, light grey bg and border */}
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
                    {getRoleLabel(user.role)}
                  </span>
                  {user.department && (
                    <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
                      {user.department.name}
                    </span>
                  )}
                </div>

                {/* Joined & Last Login - labels uppercase light grey, values dark */}
                <div className="mt-4 pt-4 border-t border-slate-100 space-y-2 text-left">
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:items-center">
                    <p className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold shrink-0">Joined</p>
                    <p className="text-xs font-medium text-slate-800 text-right sm:text-right break-words">{user.createdAt ? formatDate(user.createdAt, false) : '—'}</p>
                  </div>
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:items-center">
                    <p className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold shrink-0">Last Login</p>
                    <p className="text-xs font-medium text-slate-800 text-right sm:text-right break-words">{user.lastLogin ? formatDate(user.lastLogin, true) : 'Never'}</p>
                  </div>
                </div>
              </div>
            </div>

            {employee && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-3 sm:p-4 min-w-0">
                <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <Users className="w-4 h-4 text-indigo-500" />
                  Reporting & supervisors
                </h4>
                <div className="flex flex-col gap-4">
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Reporting manager(s)</p>
                    {hierarchyPeople.reporting.length > 0 ? (
                      <ul className="space-y-2">
                        {hierarchyPeople.reporting.map((p, idx) => (
                          <li key={p._id || `r-${p.name}-${idx}`} className="flex items-start gap-2">
                            <div className="w-8 h-8 shrink-0 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700">
                              {(p.name?.[0] || '?').toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-800 break-words">{p.name}</p>
                              {p.email ? (
                                <p className="text-xs text-slate-500 break-all" title={p.email}>
                                  {p.email}
                                </p>
                              ) : null}
                              {p.role ? (
                                <span className="mt-0.5 inline-block text-[10px] font-medium text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                                  {getRoleLabel(p.role)}
                                </span>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-400">—</p>
                    )}
                  </div>
                  <div className="pt-3 border-t border-slate-100">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Division manager</p>
                    {hierarchyPeople.divManager ? (
                      <div className="flex items-start gap-2">
                        <div className="w-8 h-8 shrink-0 rounded-full bg-orange-100 flex items-center justify-center text-xs font-bold text-orange-800">
                          {(hierarchyPeople.divManager.name?.[0] || 'M').toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800 break-words">{hierarchyPeople.divManager.name}</p>
                          {hierarchyPeople.divManager.email ? (
                            <p className="text-xs text-slate-500 break-all">{hierarchyPeople.divManager.email}</p>
                          ) : null}
                          <span className="mt-0.5 inline-block text-[10px] font-medium text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                            Manager
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400">—</p>
                    )}
                  </div>
                  <div className="pt-3 border-t border-slate-100">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Head of department</p>
                    {hierarchyPeople.hod ? (
                      <div className="flex items-start gap-2">
                        <div className="w-8 h-8 shrink-0 rounded-full bg-amber-100 flex items-center justify-center text-xs font-bold text-amber-900">
                          {(hierarchyPeople.hod.name?.[0] || 'H').toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800 break-words">{hierarchyPeople.hod.name}</p>
                          {hierarchyPeople.hod.email ? (
                            <p className="text-xs text-slate-500 break-all">{hierarchyPeople.hod.email}</p>
                          ) : null}
                          <span className="mt-0.5 inline-block text-[10px] font-medium text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                            HOD
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400">—</p>
                    )}
                  </div>
                </div>
               
              </div>
            )}
          </div>

          {/* Right Column: Information Tabs */}
          <div className="lg:col-span-8 min-w-0">
            {/* Tabs Header */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-1 mb-4 sm:mb-6 flex flex-col sm:flex-row gap-1 sm:gap-0">
              <button
                type="button"
                onClick={() => setActiveTab('profile')}
                className={`flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-2 sm:px-5 py-2.5 rounded-lg text-[11px] sm:text-sm font-medium transition-all duration-200 text-center leading-snug whitespace-normal min-h-[48px] sm:min-h-0 touch-manipulation
                  ${activeTab === 'profile' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900 active:bg-slate-100'}`}
              >
                <User className="w-4 h-4 shrink-0" />
                Personal Profile
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('employment')}
                className={`flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-2 sm:px-5 py-2.5 rounded-lg text-[11px] sm:text-sm font-medium transition-all duration-200 text-center leading-snug whitespace-normal min-h-[48px] sm:min-h-0 touch-manipulation
                  ${activeTab === 'employment' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900 active:bg-slate-100'}`}
              >
                <Briefcase className="w-4 h-4 shrink-0" />
                Employment Details
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('security')}
                className={`flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-2 sm:px-5 py-2.5 rounded-lg text-[11px] sm:text-sm font-medium transition-all duration-200 text-center leading-snug whitespace-normal min-h-[48px] sm:min-h-0 touch-manipulation
                  ${activeTab === 'security' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900 active:bg-slate-100'}`}
              >
                <Shield className="w-4 h-4 shrink-0" />
                Security
              </button>
            </div>

            {/* Tab Content */}
            <div className="space-y-6">

              {/* PROFILE TAB */}
              {activeTab === 'profile' && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6 animate-in fade-in zoom-in-95 duration-300 min-w-0">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
                    <h3 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                      Personal Information
                    </h3>
                    {!isEditing && user.role !== 'employee' && (
                      <button
                        type="button"
                        onClick={() => setIsEditing(true)}
                        className="text-sm font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-4 py-2.5 rounded-lg transition-colors w-full sm:w-auto touch-manipulation"
                      >
                        Edit Details
                      </button>
                    )}
                    {isEditing && (
                      <div className="flex flex-wrap gap-2 w-full sm:w-auto justify-stretch sm:justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            setIsEditing(false);
                            setEditData({ name: user.name, phone: user.phone || '' });
                          }}
                          className="flex-1 sm:flex-none px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg touch-manipulation min-h-[44px]"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveProfile}
                          disabled={saving}
                          className="flex-1 sm:flex-none px-3 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 touch-manipulation min-h-[44px]"
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                    <div className="group">
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Display Name</label>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editData.name}
                          onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                          className="w-full px-4 py-3 sm:py-2 text-base sm:text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                      ) : (
                        <div className="text-base font-medium text-slate-800 flex items-center gap-2 break-words">
                          <User className="w-4 h-4 text-slate-400 shrink-0" />
                          {user.name}
                        </div>
                      )}
                    </div>

                    <div className="group">
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Email Address</label>
                      <div className="text-base font-medium text-slate-800 flex items-start gap-2 bg-slate-50 p-2 rounded-lg border border-transparent group-hover:border-slate-200 transition-colors break-all">
                        <Mail className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                        {user.email}
                      </div>
                    </div>

                    <div className="group">
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Phone Number</label>
                      {isEditing ? (
                        <input
                          type="tel"
                          value={editData.phone}
                          onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
                          className="w-full px-4 py-3 sm:py-2 text-base sm:text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                          placeholder="+91..."
                        />
                      ) : (
                        <div className="text-base font-medium text-slate-800 flex items-center gap-2">
                          <Phone className="w-4 h-4 text-slate-400" />
                          {user.phone || <span className="text-slate-400 italic">Not added</span>}
                        </div>
                      )}
                    </div>

                    <div className="group">
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Role</label>
                      <div className="text-base font-medium text-slate-800 flex items-center gap-2 bg-slate-50 p-2 rounded-lg border border-transparent group-hover:border-slate-200 transition-colors">
                        <Briefcase className="w-4 h-4 text-slate-400" />
                        <span className="capitalize">{getRoleLabel(user.role)}</span>
                      </div>
                    </div>

                    <div className="group">
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Department</label>
                      <div className="text-base font-medium text-slate-800 flex items-center gap-2 bg-slate-50 p-2 rounded-lg border border-transparent group-hover:border-slate-200 transition-colors">
                        <Building className="w-4 h-4 text-slate-400" />
                        <span>{user.department?.name || '—'}</span>
                      </div>
                    </div>

                    {employee?.address && (
                      <div className="md:col-span-2 group">
                        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Address (From Records)</label>
                        <div className="text-sm text-slate-700 bg-slate-50 p-3 rounded-lg flex items-start gap-2">
                          <MapPin className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                          {employee.address}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* EMPLOYMENT TAB */}
              {activeTab === 'employment' && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6 lg:p-8 animate-in fade-in zoom-in-95 duration-300 min-w-0">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5 sm:mb-8">
                    <h3 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                      Employment Records
                    </h3>
                    {user.role === 'employee' && updateConfig?.enabled && (
                      <button
                        type="button"
                        onClick={() => {
                          // Pre-fill requestedChanges with current values
                          const initialChanges: any = {};
                          updateConfig.requestableFields.forEach((fieldId: string) => {
                            const rawValue = getRawFieldValue(fieldId);
                            if (rawValue !== undefined) {
                              initialChanges[fieldId] = normalizeFieldValueForInput(fieldId, rawValue);
                            }
                          });
                          if (updateConfig.allowQualifications && employee?.blood_group) {
                            // Qualifications handles specially
                          }
                          setRequestedChanges(initialChanges);
                          setShowRequestModal(true);
                        }}
                        className="text-sm font-medium text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-4 py-2.5 rounded-lg transition-colors border border-emerald-100 flex items-center justify-center gap-2 w-full sm:w-auto touch-manipulation min-h-[44px]"
                      >
                        <RefreshCw className="w-4 h-4 shrink-0" />
                        Request Update
                      </button>
                    )}
                  </div>

                  {employee ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Employee ID</label>
                        <p className="text-lg font-bold text-slate-900 font-mono tracking-tight">{employee.emp_no}</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Designation</label>
                        <p className="text-base font-medium text-slate-800">{employee.designation?.name || '—'}</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Department</label>
                        <p className="text-base font-medium text-slate-800">{employee.department?.name || '—'}</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Division</label>
                        <p className="text-base font-medium text-slate-800">{employee.division?.name || '—'}</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Date of Joining</label>
                        <p className="text-base font-medium text-slate-800 flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-slate-400" />
                          {/* Try multiple potential field names for joining date */}
                          {(employee.joining_date || (employee as any).date_of_joining || (employee as any).joiningDate || (employee as any).doj)
                            ? formatDate(employee.joining_date || (employee as any).date_of_joining || (employee as any).joiningDate || (employee as any).doj, false)
                            : '—'}
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Shift</label>
                        <p className="text-base font-medium text-slate-800 flex flex-wrap items-center gap-2 break-words">
                          <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                          {employee.shiftId ? `${employee.shiftId.name} (${employee.shiftId.startTime} - ${employee.shiftId.endTime})` : 'General'}
                        </p>
                      </div>
                      {/* Requestable Fields Display Area */}
                      {user.role === 'employee' && updateConfig?.enabled && (
                        <div className="md:col-span-2 pt-5 mt-4 border-t border-slate-100">
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-3">
                            <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.18em]">Requestable Profile Details</h4>
                            <span className="text-[10px] text-slate-400 shrink-0">Scrollable panel</span>
                          </div>
                          <div className="max-h-64 overflow-y-auto pr-1">
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-3">
                            {updateConfig.requestableFields.map((fieldId: string, idx: number) => {
                              // Find field label from formGroups
                              let label = fieldId;
                              formGroups.forEach(g => {
                                const f = g.fields.find((f: any) => f.id === fieldId);
                                if (f) label = f.label;
                              });

                              const value = getRawFieldValue(fieldId);

                              return (
                                <div key={`${fieldId}-${idx}`} className="group">
                                  <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">{label}</label>
                                  <div className="text-sm font-medium text-slate-800 flex items-center justify-between group-hover:bg-slate-50 p-2 rounded-lg transition-colors">
                                    <span>{formatFieldValue(value)}</span>
                                    <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-tight bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 opacity-0 group-hover:opacity-100 transition-opacity">Editable</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-12 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
                      <Briefcase className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                      <p className="text-slate-500 font-medium">No employee record linked to this account.</p>
                      <p className="text-xs text-slate-400 mt-1">Please contact HR to link your employee profile.</p>
                    </div>
                  )}
                </div>
              )}

              {/* SECURITY TAB */}
              {activeTab === 'security' && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6 lg:p-8 animate-in fade-in zoom-in-95 duration-300 min-w-0">
                  <h3 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2 mb-2">
                    Security & Password
                  </h3>
                  <p className="text-slate-500 text-sm mb-6 sm:mb-8">Manage your password and security settings periodically for safety.</p>

                  <form onSubmit={handlePasswordChange} className="w-full max-w-lg space-y-5">
                    {passwordError && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-700">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                        {passwordError}
                      </div>
                    )}

                    {passwordSuccess && (
                      <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-sm text-green-700">
                        <Check className="w-4 h-4 flex-shrink-0" />
                        {passwordSuccess}
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Current Password</label>
                      <div className="relative">
                        <input
                          type="password"
                          value={passwordData.currentPassword}
                          onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                          className="w-full pl-10 pr-4 py-3 sm:py-2.5 text-base sm:text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                          placeholder="••••••••"
                        />
                        <Key className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">New Password</label>
                      <div className="relative">
                        <input
                          type="password"
                          value={passwordData.newPassword}
                          onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                          className="w-full pl-10 pr-4 py-3 sm:py-2.5 text-base sm:text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                          placeholder="At least 4 characters"
                        />
                        <Shield className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Confirm New Password</label>
                      <div className="relative">
                        <input
                          type="password"
                          value={passwordData.confirmPassword}
                          onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                          className="w-full pl-10 pr-4 py-3 sm:py-2.5 text-base sm:text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                          placeholder="Re-enter new password"
                        />
                        <Shield className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      </div>
                    </div>

                    <div className="pt-2">
                      <button
                        type="submit"
                        disabled={passwordLoading}
                        className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium py-3 sm:py-2.5 rounded-lg shadow-lg shadow-slate-900/10 transition-all disabled:opacity-70 disabled:cursor-not-allowed flex justify-center items-center gap-2 touch-manipulation min-h-[48px] sm:min-h-0"
                      >
                        {passwordLoading ? 'Updating...' : 'Update Password'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes slide-in {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
        }
        .hide-scrollbar::-webkit-scrollbar {
            display: none;
        }
        .hide-scrollbar {
            -ms-overflow-style: none;
            scrollbar-width: none;
        }
      `}</style>

      {/* Request Update Modal */}
      {
        showRequestModal && (
          <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[min(92dvh,100vh)] sm:max-h-[90vh] min-h-0">
              <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
                <div className="min-w-0 pr-2">
                  <h3 className="text-base sm:text-lg font-bold text-slate-900">Request Profile Update</h3>
                  <p className="text-xs text-slate-500 mt-0.5 leading-snug">Your request will be sent to the administrator for approval.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRequestModal(false)}
                  className="p-2 -mr-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors shrink-0 touch-manipulation min-h-[44px] min-w-[44px] flex items-center justify-center"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5 space-y-5 min-h-0">
                {/* Requestable Fields */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {formGroups.map((group, groupIdx) => {
                    const allowedFieldsInGroup = group.fields.filter((f: any) => updateConfig?.requestableFields?.includes(f.id));
                    if (allowedFieldsInGroup.length === 0) return null;

                    return (
                      <div key={group._id || `group-${groupIdx}`} className="md:col-span-2 space-y-2">
                        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-50 pb-2">{group.name}</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {allowedFieldsInGroup.map((field: any, fieldIdx: number) => (
                            <div key={field.id || `field-${fieldIdx}`} className="space-y-1">
                              <label className="text-[11px] font-bold text-slate-600 uppercase tracking-tight">{field.label}</label>
                              {field.type === 'select' || field.type === 'dropdown' ? (
                                (() => {
                                  const fieldOptions = getFieldOptionsForRequest(field);
                                  return (
                                <select
                                  value={requestedChanges[field.id] ?? ''}
                                  onChange={(e) => setRequestedChanges({ ...requestedChanges, [field.id]: e.target.value })}
                                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                                >
                                  <option value="">Select Option</option>
                                  {requestedChanges[field.id] &&
                                    !fieldOptions?.some((opt: any) => String(opt?.value) === String(requestedChanges[field.id])) && (
                                      <option value={requestedChanges[field.id]}>{requestedChanges[field.id]}</option>
                                    )}
                                  {fieldOptions?.map((opt: any, optIdx: number) => (
                                    <option key={`${opt.value}-${optIdx}`} value={opt.value}>{opt.label}</option>
                                  ))}
                                </select>
                                  );
                                })()
                              ) : (
                                <input
                                  type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
                                  value={requestedChanges[field.id] ?? ''}
                                  onChange={(e) => setRequestedChanges({ ...requestedChanges, [field.id]: e.target.value })}
                                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                                  placeholder={`Enter ${field.label}...`}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {(() => {
                    const renderedIds = new Set(
                      formGroups.flatMap((g: any) =>
                        (g.fields || [])
                          .filter((f: any) => updateConfig?.requestableFields?.includes(f.id))
                          .map((f: any) => f.id)
                      )
                    );
                    const missingFieldIds = (updateConfig?.requestableFields || []).filter((id: string) => !renderedIds.has(id));
                    if (missingFieldIds.length === 0) return null;

                    return (
                      <div className="md:col-span-2 space-y-2">
                        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-50 pb-2">Other Requestable Fields</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {missingFieldIds.map((fieldId: string, idx: number) => (
                            <div key={`${fieldId}-${idx}`} className="space-y-1.5">
                              <label className="text-[11px] font-bold text-slate-600 uppercase tracking-tight">{fieldId.replace(/_/g, ' ')}</label>
                              <input
                                type={fieldId.toLowerCase().includes('date') || fieldId === 'dob' || fieldId === 'doj' ? 'date' : 'text'}
                                value={requestedChanges[fieldId] ?? ''}
                                onChange={(e) => setRequestedChanges({ ...requestedChanges, [fieldId]: e.target.value })}
                                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                                placeholder={`Enter ${fieldId.replace(/_/g, ' ')}...`}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Qualifications Section */}
                  {updateConfig?.allowQualifications && (
                    <div className="md:col-span-2 space-y-2">
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-50 pb-2">Qualifications</h4>
                      <p className="text-xs text-slate-500 italic">Please describe the education or certification changes you wish to request.</p>
                      <textarea
                        value={requestedChanges.qualifications || ''}
                        onChange={(e) => setRequestedChanges({ ...requestedChanges, qualifications: e.target.value })}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none transition-all min-h-[100px]"
                        placeholder="e.g. Added MBA degree from XYZ University, 2024..."
                      />
                    </div>
                  )}
                </div>

                {/* General Comments */}
                <div className="pt-6 border-t border-slate-100">
                  <label className="text-[11px] font-bold text-slate-600 uppercase tracking-tight mb-2 block">Reason / Additional Comments</label>
                  <textarea
                    value={requestComments}
                    onChange={(e) => setRequestComments(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none transition-all min-h-[80px]"
                    placeholder="Explain why you are requesting these changes..."
                  />
                </div>
              </div>

              <div className="px-4 py-4 sm:px-8 sm:py-6 bg-slate-50 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3 border-t border-slate-100 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowRequestModal(false)}
                  className="text-sm font-medium text-slate-600 hover:text-slate-900 px-4 py-3 sm:py-2 hover:bg-slate-200 rounded-lg transition-colors touch-manipulation min-h-[44px] w-full sm:w-auto"
                  disabled={submittingRequest}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmitUpdateRequest}
                  disabled={submittingRequest || Object.keys(requestedChanges).length === 0}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 sm:py-2.5 px-6 sm:px-8 rounded-xl text-sm shadow-lg shadow-emerald-500/20 active:scale-[0.99] transition-all disabled:opacity-50 flex items-center justify-center gap-2 touch-manipulation min-h-[44px] w-full sm:w-auto"
                >
                  {submittingRequest ? <Spinner className="w-4 h-4 text-white" /> : <Mail className="w-4 h-4 shrink-0" />}
                  {submittingRequest ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </div>
          </div>
        )
      }
    </div>
  );
}




