/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import {
  api,
  DataScope,
  Department,
  Division,
  Employee,
  User,
} from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import {
  canViewUsers,
  canCreateUser,
  canEditUser,
  canDeleteUser,
  canResetPassword,
  isManagementRole
} from '@/lib/permissions';
import { MODULE_CATEGORIES } from '@/config/moduleCategories';
import Spinner from '@/components/Spinner';
import {
  Plus,
  Edit,
  Eye,
  EyeOff,
  Filter,
  Globe,
  Info,
  Layers,
  LayoutGrid,
  Lock,
  Mail,
  RefreshCw,
  RotateCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldHalf,
  Trash2,
  User as UserIcon,
  UserCheck,
  UserCircle,
  UserPlus,
  UserX,
  Users,
  X,
  Building,
  Check,
  CheckCircle,
  CheckCircle2,
  ChevronRight,
  Key,
  Clock
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

// Custom Stat Card for User Management
const StatCard = ({ title, value, icon: Icon, bgClass, iconClass, dekorClass, trend }: { title: string, value: number | string, icon: any, bgClass: string, iconClass: string, dekorClass?: string, trend?: { value: string, positive: boolean } }) => (
  <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 transition-all hover:shadow-xl dark:border-slate-800 dark:bg-slate-900">
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{title}</p>
        <div className="mt-2 flex items-baseline gap-2">
          <h3 className="text-3xl font-black text-slate-900 dark:text-white">{value}</h3>
          {trend && (
            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${trend.positive ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'}`}>
              {trend.value}
            </span>
          )}
        </div>
      </div>
      <div className={`flex h-14 w-14 items-center justify-center rounded-[1.25rem] ${bgClass} ${iconClass}`}>
        <Icon className="h-7 w-7" />
      </div>
    </div>
    {dekorClass && <div className={`absolute -right-4 -bottom-4 h-24 w-24 rounded-full ${dekorClass}`} />}
  </div>
);

interface UserFormData {
  email: string;
  name?: string;
  role: string;
  password?: string;
  autoGeneratePassword: boolean;
  departmentType?: 'single' | 'multiple';
  department?: string;
  departments?: string[];
  featureControl?: string[];
  dataScope?: DataScope | string;
  allowedDivisions?: (string | Division)[];
  divisionMapping?: { division: string | Division; departments: (string | Department)[] }[];
  division?: string;
  employeeId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface UserStats {
  totalUsers: number;
  activeUsers: number;
  inactiveUsers: number;
  byRole: Record<string, number>;
}

const ROLES = [
  { value: 'super_admin', label: 'Super Admin', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' },
  { value: 'sub_admin', label: 'Sub Admin', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  { value: 'hr', label: 'HR', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  { value: 'manager', label: 'Manager', color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
  { value: 'hod', label: 'HOD', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' },
  { value: 'employee', label: 'Employee', color: 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400' },
];

const getRoleColor = (role: string) => {
  return ROLES.find((r) => r.value === role)?.color || 'bg-slate-100 text-slate-700';
};

const getRoleLabel = (role: string) => {
  return ROLES.find((r) => r.value === role)?.label || role;
};

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [employeesWithoutAccount, setEmployeesWithoutAccount] = useState<Employee[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const scopedUsers = useMemo(() => {
    if (!currentUser || currentUser.role === 'super_admin') return users;

    const myMappings = (currentUser as any).divisionMapping || [];
    if (myMappings.length === 0 && !['hr', 'sub_admin'].includes(currentUser.role)) return [];

    // HR and Sub Admin without mappings might see all in workspace context, 
    // but HOD/Manager MUST have mappings to see anything specific.
    if (currentUser.role !== 'hr' && currentUser.role !== 'sub_admin' && myMappings.length === 0) return [];
    if (['hr', 'sub_admin'].includes(currentUser.role) && myMappings.length === 0) return users;

    const myDivIds = myMappings.map((m: any) => typeof m.division === 'string' ? m.division : m.division?._id);

    return users.filter(u => {
      if (u.role === 'super_admin') return false; // Usually don't show super_admins to others

      const uMappings = u.divisionMapping || [];
      if (uMappings.length === 0) return ['hr', 'sub_admin'].includes(currentUser.role);

      return uMappings.some((um: any) => {
        const umDivId = typeof um.division === 'string' ? um.division : um.division?._id;
        return myDivIds.includes(umDivId);
      });
    });
  }, [users, currentUser]);

  // Dialogs
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showFromEmployeeDialog, setShowFromEmployeeDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);

  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [resetPasswordState, setResetPasswordState] = useState({
    newPassword: '',
    confirmPassword: '',
    showNew: false,
    showConfirm: false,
    autoGenerate: true
  });
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedViewUser, setSelectedViewUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'permissions'>('overview');

  const [formData, setFormData] = useState<UserFormData>({
    email: '',
    name: '',
    role: 'super_admin',
    departmentType: 'single',
    department: '',
    departments: [],
    password: '',
    autoGeneratePassword: true,
    featureControl: [],
    dataScope: 'all',
    allowedDivisions: [],
    divisionMapping: [],
    division: '',
  });

  // Form state for create from employee
  const [employeeFormData, setEmployeeFormData] = useState<UserFormData>({
    employeeId: '',
    email: '',
    role: 'employee',
    departmentType: 'single',
    departments: [],
    autoGeneratePassword: true,
    featureControl: [],
    dataScope: 'all',
    allowedDivisions: [],
    divisionMapping: [],
    division: '',
  });

  const [employeeSearch, setEmployeeSearch] = useState('');
  const [showEmployeeDropdown, setShowEmployeeDropdown] = useState(false);
  const employeeDropdownRef = useRef<HTMLDivElement>(null);

  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successModalData, setSuccessModalData] = useState({
    username: '',
    password: '',
    message: ''
  });
  const [managerDeptSearch, setManagerDeptSearch] = useState('');

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, deptRes, divRes, statsRes] = await Promise.all([
        api.getUsers({
          role: roleFilter || undefined,
          isActive: statusFilter ? statusFilter === 'active' : undefined,
          search: search || undefined,
        }),
        api.getDepartments(true),
        api.getDivisions(),
        api.getUserStats(),
      ]);

      if (usersRes.success) setUsers(usersRes.data || []);
      if (deptRes.success) setDepartments(deptRes.data || []);
      if (divRes.success) setDivisions(divRes.data || []);
      if (statsRes.success) setStats(statsRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [roleFilter, statusFilter, search]);

  const loadEmployeesWithoutAccount = async () => {
    try {
      const res = await api.getEmployeesWithoutAccount();
      if (res.success) {
        setEmployeesWithoutAccount(res.data || []);
      }
    } catch (err) {
      console.error('Failed to load employees:', err);
    }
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Clear messages
  useEffect(() => {
    if (error || success) {
      const timer = setTimeout(() => {
        setError('');
        setSuccess('');
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, success]);

  // Load default feature controls when role changes (not on every formData change)
  const previousRoleRef = useRef<string>('');

  useEffect(() => {
    const loadRoleDefaults = async () => {
      // Only load if role actually changed (not just formData update)
      if (!formData.role || formData.role === previousRoleRef.current) return;

      previousRoleRef.current = formData.role;

      try {
        const settingKey = `feature_control_${formData.role === 'hod' ? 'hod' : formData.role === 'hr' ? 'hr' : 'employee'}`;
        const res = await api.getSetting(settingKey);

        if (res.success && res.data?.value?.activeModules) {
          const defaultScope = formData.role === 'manager' ? 'division' : (formData.role === 'hod' ? 'department' : 'all');
          setFormData(prev => ({
            ...prev,
            featureControl: res.data?.value?.activeModules || [],
            dataScope: defaultScope as DataScope
          }));
        }
      } catch (err) {
        console.error('Failed to load role defaults:', err);
      }
    };

    loadRoleDefaults();
  }, [formData.role]);

  // Handle create user
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const payload: Partial<User> & {
        autoGeneratePassword?: boolean;
        password?: string;
        assignWorkspace?: boolean;
        department?: string | null;
        dataScope?: DataScope | string;
        allowedDivisions?: string[];
        divisionMapping?: any[];
        featureControl?: string[];
        division?: string;
      } = {
        email: formData.email,
        name: formData.name,
        role: formData.role,
        autoGeneratePassword: formData.autoGeneratePassword,
        assignWorkspace: true,
        division: formData.division,
      };

      if (!formData.autoGeneratePassword && formData.password) {
        payload.password = formData.password;
      }

      // Handle scoping
      payload.dataScope = formData.dataScope as DataScope;

      // Always include divisionMapping if available
      if (formData.divisionMapping && formData.divisionMapping.length > 0) {
        payload.divisionMapping = (formData.divisionMapping || []).map(m => ({
          division: typeof m.division === 'string' ? m.division : m.division._id,
          departments: (m.departments || []).map(d => typeof d === 'string' ? d : d._id)
        }));
      }

      if (formData.dataScope === 'department') {
        (payload as any).department = formData.department || null;
      } else if (formData.dataScope === 'division') {
        payload.allowedDivisions = (formData.allowedDivisions || []).map(d => typeof d === 'string' ? d : d._id);

        // For Manager/HOD specific mapping if divisionMapping is not already set or needs overrides
        if (!payload.divisionMapping || payload.divisionMapping.length === 0) {
          if (formData.role === 'manager' && payload.allowedDivisions && payload.allowedDivisions.length === 1) {
            const divId = payload.allowedDivisions[0];
            const depts = (formData.departments || []).map((d: any) => typeof d === 'string' ? d : d._id);
            payload.divisionMapping = [{
              division: divId,
              departments: depts
            }];
          } else if (formData.role === 'hod' && formData.division && formData.department) {
            payload.divisionMapping = [{
              division: formData.division,
              departments: [formData.department]
            }];
          }
        }
      }

      // Force HOD to use 'department' scope; keep full divisionMapping (allows multiple departments)
      if (formData.role === 'hod') {
        payload.dataScope = 'department';
        (payload as any).department = formData.department || (formData.divisionMapping?.[0]?.departments?.[0] && (typeof formData.divisionMapping[0].departments[0] === 'string' ? formData.divisionMapping[0].departments[0] : (formData.divisionMapping[0].departments[0] as any)?._id)) || null;
        (payload as any).division = formData.division || (formData.divisionMapping?.[0]?.division && (typeof formData.divisionMapping[0].division === 'string' ? formData.divisionMapping[0].division : (formData.divisionMapping[0].division as any)?._id)) || null;
        // Only set single division+department when divisionMapping was not already provided (e.g. from division mapping UI with multiple departments)
        if ((!payload.divisionMapping || payload.divisionMapping.length === 0) && formData.division && formData.department) {
          payload.divisionMapping = [{
            division: formData.division,
            departments: [formData.department]
          }];
        }
      }

      // Add feature control (always send to ensure overrides work)
      payload.featureControl = formData.featureControl;

      const res = await api.createUser(payload as any);

      if (res.success) {
        setSuccessModalData({
          username: res.data.user.email || res.data.identifier,
          password: res.data.generatedPassword || formData.password,
          message: 'User created successfully. Please copy the credentials below.'
        });
        setShowSuccessModal(true);
        setShowCreateDialog(false);
        resetForm();
        loadData();
      } else {
        setError(res.message || res.error || 'Failed to create user');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    }
  };

  // Handle create from employee
  const handleCreateFromEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const payload: { employeeId: string; role: string; autoGeneratePassword: boolean; email?: string; dataScope?: DataScope | string; department?: string | null; allowedDivisions?: string[]; divisionMapping?: { division: string | Division; departments: (string | Department)[] }[]; featureControl?: string[] } = {
        employeeId: employeeFormData.employeeId || '',
        role: employeeFormData.role,
        autoGeneratePassword: employeeFormData.autoGeneratePassword,
      };

      if (employeeFormData.email) {
        payload.email = employeeFormData.email;
      }

      // Handle scoping
      payload.dataScope = employeeFormData.dataScope || 'all';

      // Always include divisionMapping if available
      if (employeeFormData.divisionMapping && employeeFormData.divisionMapping.length > 0) {
        payload.divisionMapping = (employeeFormData.divisionMapping || []).map(m => ({
          division: typeof m.division === 'string' ? m.division : m.division?._id,
          departments: (m.departments || []).map(d => typeof d === 'string' ? d : d?._id)
        })) as any;
      }

      if (payload.dataScope === 'department') {
        payload.department = (employeeFormData.departments || [])[0] || null;
      } else if (payload.dataScope === 'division') {
        payload.allowedDivisions = (employeeFormData.allowedDivisions || []).map(d => typeof d === 'string' ? d : d._id);

        // For HOD/Manager specific mapping overrides
        if (!payload.divisionMapping || payload.divisionMapping.length === 0) {
          if (employeeFormData.role === 'manager' && payload.allowedDivisions && payload.allowedDivisions.length === 1) {
            const divId = payload.allowedDivisions[0];
            const depts = (employeeFormData.departments || []).map((d: any) => typeof d === 'string' ? d : d._id);
            payload.divisionMapping = [{
              division: divId,
              departments: depts
            }] as any;
          } else if (employeeFormData.role === 'hod' && employeeFormData.division && (employeeFormData.departments || []).length > 0) {
            const deptIds = (employeeFormData.departments || []).map((d: any) => typeof d === 'string' ? d : d?._id);
            payload.divisionMapping = [{
              division: employeeFormData.division,
              departments: deptIds
            }] as any;
          }
        }
      }

      // HOD: keep full divisionMapping (multiple departments); fallback to single only when mapping empty
      if (employeeFormData.role === 'hod') {
        payload.dataScope = 'department';
        payload.department = employeeFormData.department || (employeeFormData.departments || [])[0] || (employeeFormData.divisionMapping?.[0]?.departments?.[0] && (typeof employeeFormData.divisionMapping[0].departments[0] === 'string' ? employeeFormData.divisionMapping[0].departments[0] : (employeeFormData.divisionMapping[0].departments[0] as any)?._id)) || null;
        (payload as any).division = employeeFormData.division || (employeeFormData.divisionMapping?.[0]?.division && (typeof employeeFormData.divisionMapping[0].division === 'string' ? employeeFormData.divisionMapping[0].division : (employeeFormData.divisionMapping[0].division as any)?._id)) || null;
        if ((!payload.divisionMapping || payload.divisionMapping.length === 0) && employeeFormData.division && (employeeFormData.department || (employeeFormData.departments || []).length > 0)) {
          const deptIds = (employeeFormData.departments || []).map((d: any) => typeof d === 'string' ? d : d?._id);
          payload.divisionMapping = [{
            division: employeeFormData.division,
            departments: deptIds.length > 0 ? deptIds : [employeeFormData.department]
          }] as any;
        }
      }

      // Add feature control (always send to ensure overrides work)
      payload.featureControl = employeeFormData.featureControl;

      const res = await api.createUserFromEmployee(payload);

      if (res.success) {
        setSuccessModalData({
          username: res.data.email || res.data.identifier,
          password: res.data.generatedPassword || '',
          message: 'User created from employee successfully. Please copy the credentials below.'
        });
        setShowSuccessModal(true);
        setShowFromEmployeeDialog(false);
        resetEmployeeForm();
        loadData();
      } else {
        setError(res.message || res.error || 'Failed to create user');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create user');
    }
  };

  // Handle update user
  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setError('');

    try {
      const payload: any = {
        name: formData.name,
        role: formData.role,
      };

      // Handle scoping
      payload.dataScope = formData.dataScope;

      // Always include divisionMapping if available
      if (formData.divisionMapping && formData.divisionMapping.length > 0) {
        payload.divisionMapping = (formData.divisionMapping || []).map(m => ({
          division: typeof m.division === 'string' ? m.division : m.division?._id,
          departments: (m.departments || []).map((d: any) => typeof d === 'string' ? d : d?._id)
        }));
      }

      if (formData.dataScope === 'department') {
        (payload as any).department = formData.department || null;
      } else if (formData.dataScope === 'division') {
        payload.allowedDivisions = formData.allowedDivisions;

        // Manager specific override
        if (formData.role === 'manager' && payload.allowedDivisions && payload.allowedDivisions.length === 1) {
          const divId = typeof payload.allowedDivisions[0] === 'string' ? payload.allowedDivisions[0] : payload.allowedDivisions[0]._id;
          const depts = (formData.departments || []).map((d: any) => typeof d === 'string' ? d : d._id);
          payload.divisionMapping = [{
            division: divId,
            departments: depts
          }];
        }
      }

      // HOD: keep full divisionMapping (allows multiple departments); fallback to single only when mapping empty
      if (formData.role === 'hod') {
        payload.dataScope = 'department';
        (payload as any).department = formData.department || (formData.divisionMapping?.[0]?.departments?.[0] && (typeof formData.divisionMapping[0].departments[0] === 'string' ? formData.divisionMapping[0].departments[0] : (formData.divisionMapping[0].departments[0] as any)?._id)) || null;
        (payload as any).division = formData.division || (formData.divisionMapping?.[0]?.division && (typeof formData.divisionMapping[0].division === 'string' ? formData.divisionMapping[0].division : (formData.divisionMapping[0].division as any)?._id)) || null;
        if ((!payload.divisionMapping || payload.divisionMapping.length === 0) && formData.division && formData.department) {
          payload.divisionMapping = [{
            division: formData.division,
            departments: [formData.department]
          }];
        }
      }

      // Add feature control (always send to ensure overrides work)
      payload.featureControl = formData.featureControl;

      const res = await api.updateUser(selectedUser._id, payload);

      if (res.success) {
        setSuccess('User updated successfully');
        setShowEditDialog(false);
        setSelectedUser(null);
        loadData();
      } else {
        setError(res.message || res.error || 'Failed to update user');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update user');
    }
  };

  // Handle reset password
  const handleResetPassword = async () => {
    if (!selectedUser) return;
    setError('');

    if (!resetPasswordState.autoGenerate) {
      if (resetPasswordState.newPassword.length < 6) {
        setError('Password must be at least 6 characters');
        return;
      }
      if (resetPasswordState.newPassword !== resetPasswordState.confirmPassword) {
        setError('Passwords do not match');
        return;
      }
    }

    try {
      const res = await api.resetUserPassword(selectedUser._id, {
        autoGenerate: resetPasswordState.autoGenerate,
        newPassword: resetPasswordState.autoGenerate ? undefined : resetPasswordState.newPassword
      });

      if (res.success) {
        setSuccess(res.message || 'Password reset successfully');
        if (res.newPassword) {
          setSuccessModalData({
            username: selectedUser.email,
            password: res.newPassword,
            message: 'Password has been reset successfully.'
          });
          setShowSuccessModal(true);
        }
        setShowPasswordDialog(false);
        setSelectedUser(null);
        setResetPasswordState({
          newPassword: '',
          confirmPassword: '',
          showNew: false,
          showConfirm: false,
          autoGenerate: true
        });
      } else {
        setError(res.message || 'Failed to reset password');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to reset password');
    }
  };

  const getPasswordStrength = (password: string) => {
    let score = 0;
    if (!password) return { label: 'None', score: 0, color: 'bg-slate-200' };

    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    const ratings = [
      { label: 'Poor', score: 1, color: 'bg-red-500' },
      { label: 'Weak', score: 2, color: 'bg-orange-500' },
      { label: 'Good', score: 3, color: 'bg-yellow-500' },
      { label: 'Strong', score: 4, color: 'bg-green-500' }
    ];

    return ratings.find(r => r.score >= score) || ratings[0];
  };

  // Handle toggle status
  const handleToggleStatus = async (user: User) => {
    try {
      const res = await api.toggleUserStatus(user._id);
      if (res.success) {
        const isNowActive = res.data?.isActive ?? !user.isActive;
        const syncMessage = res.syncError ? ' (MSSQL sync failed, but local update succeeded)' : '';
        setSuccess(`User ${isNowActive ? 'activated' : 'deactivated'} successfully${syncMessage}`);
        loadData();
      } else {
        setError(res.message || 'Failed to update status');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update status');
    }
  };

  // Handle delete
  const handleDelete = async (user: User) => {
    if (!confirm(`Are you sure you want to delete user "${user.name}"?`)) return;

    try {
      const res = await api.deleteUser(user._id);
      if (res.success) {
        setSuccess('User deleted successfully');
        loadData();
      } else {
        setError(res.message || 'Failed to delete user');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete user');
    }
  };

  // Open edit dialog
  const openEditDialog = (user: User) => {
    setSelectedUser(user);

    // Normalize divisionMapping to IDs
    const normalizedMapping = (user.divisionMapping || []).map(m => ({
      division: typeof m.division === 'string' ? m.division : m.division?._id,
      departments: (m.departments || []).map((d: any) => typeof d === 'string' ? d : d?._id)
    }));

    // For HOD/Manager, prioritize the managed division and departments from division mapping
    let mapping = normalizedMapping.length > 0 ? normalizedMapping[0] : null;
    let finalMapping = normalizedMapping;

    // HOD fallback: if user has department but no divisionMapping, derive division from department (legacy)
    const deptId = (user as any).department?._id || (typeof (user as any).department === 'string' ? (user as any).department : '') || (mapping?.departments || [])[0];
    if (user.role === 'hod' && deptId && (!mapping || !mapping.division)) {
      let divId = '';
      const dept = departments.find((d: Department) => d._id === deptId);
      const firstDiv = dept?.divisions?.[0];
      if (firstDiv) {
        divId = typeof firstDiv === 'string' ? firstDiv : (firstDiv as any)?._id || '';
      }
      // Fallback: find division that contains this department (Division.departments)
      if (!divId && divisions.length > 0) {
        const divWithDept = divisions.find((d: Division) =>
          (d.departments || []).some((dep: any) => (typeof dep === 'string' ? dep : dep?._id) === deptId)
        );
        if (divWithDept) divId = (divWithDept as any)._id;
      }
      if (divId) {
        mapping = { division: divId, departments: [deptId] };
        finalMapping = [mapping];
      }
    }

    const totalDeptsFromMapping = (finalMapping || []).reduce((sum: number, m: any) => sum + (m.departments || []).length, 0);
    const isMultiple = (finalMapping || []).length > 1 || totalDeptsFromMapping > 1;

    setFormData({
      email: user.email,
      name: user.name,
      role: user.role,
      departmentType: user.departmentType || (isMultiple ? 'multiple' : 'single'),
      department: user.role === 'hod' && mapping && mapping.departments?.length > 0 ? mapping.departments[0] : (deptId || (user as any).department?._id || ''),
      departments: user.role === 'manager' && mapping ? mapping.departments : (finalMapping || []).flatMap((m: any) => m.departments || []),
      password: '',
      autoGeneratePassword: false,
      featureControl: user.featureControl || [],
      dataScope: user.dataScope || 'all',
      allowedDivisions: user.allowedDivisions?.map(d => typeof d === 'string' ? d : d?._id) || [],
      divisionMapping: finalMapping,
      division: (user.role === 'hod' || user.role === 'manager') && mapping ? mapping.division : '',
    });
    // Prevent useEffect from reloading defaults and overwriting user data
    previousRoleRef.current = user.role;
    setShowEditDialog(true);
  };

  // Open from employee dialog
  const openFromEmployeeDialog = () => {
    loadEmployeesWithoutAccount();
    setEmployeeSearch('');
    setShowEmployeeDropdown(false);
    setShowFromEmployeeDialog(true);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (employeeDropdownRef.current && !employeeDropdownRef.current.contains(event.target as Node)) {
        setShowEmployeeDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Copy to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setSuccess('Copied to clipboard!');
  };

  // Reset forms
  const resetForm = () => {
    setFormData({
      email: '',
      name: '',
      role: 'super_admin',
      departmentType: 'single',
      department: '',
      departments: [],
      password: '',
      autoGeneratePassword: true,
      featureControl: [],
      dataScope: 'all',
      allowedDivisions: [],
      divisionMapping: [],
      division: '',
    });
    setManagerDeptSearch('');
    previousRoleRef.current = '';
  };

  const resetEmployeeForm = () => {
    setEmployeeFormData({
      employeeId: '',
      email: '',
      role: 'employee',
      departmentType: 'single',
      departments: [],
      autoGeneratePassword: true,
      featureControl: [],
      dataScope: 'all',
      allowedDivisions: [],
      divisionMapping: [],
      division: '',
    });
    previousRoleRef.current = '';
  };



  const toggleDivisionMapping = (divisionId: string, deptId: string | null = null, isEmployee = false) => {
    const setFunc = isEmployee ? setEmployeeFormData : setFormData;

    setFunc((prev: any) => {
      let newMapping = [...(prev.divisionMapping || [])];
      const existingDivisionIdx = newMapping.findIndex(m => {
        const mDivId = typeof m.division === 'string' ? m.division : m.division?._id;
        return mDivId === divisionId;
      });

      if (deptId === null) {
        // Toggle Division Header
        if (existingDivisionIdx !== -1) {
          // If already has specific departments, clicking header makes it "All Departments"
          if (newMapping[existingDivisionIdx].departments.length > 0) {
            newMapping[existingDivisionIdx] = { ...newMapping[existingDivisionIdx], departments: [] };
          } else {
            // Was already "All Departments", so remove it entirely
            newMapping.splice(existingDivisionIdx, 1);
          }
        } else {
          // Not selected, add it as "All Departments"
          newMapping.push({ division: divisionId, departments: [] });
        }
      } else {
        // Toggle Specific Department
        if (existingDivisionIdx === -1) {
          newMapping.push({ division: divisionId, departments: [deptId] });
        } else {
          const currentDepts = [...newMapping[existingDivisionIdx].departments];
          if (currentDepts.includes(deptId)) {
            newMapping[existingDivisionIdx] = {
              ...newMapping[existingDivisionIdx],
              departments: currentDepts.filter(d => d !== deptId)
            };
          } else {
            newMapping[existingDivisionIdx] = {
              ...newMapping[existingDivisionIdx],
              departments: [...currentDepts, deptId]
            };
          }
        }
      }

      return {
        ...prev,
        divisionMapping: newMapping,
        allowedDivisions: newMapping.map(m => typeof m.division === 'string' ? m.division : m.division?._id)
      };
    });
  };

  const ScopingSelector = ({ data, setData, asEmployee = false }: { data: UserFormData, setData: React.Dispatch<React.SetStateAction<UserFormData>>, asEmployee?: boolean }) => {
    // Specialized UI for Manager Role (Single Division)
    if (data.role === 'manager') {
      const selectedDivisionId = data.division || (data.allowedDivisions?.[0]
        ? (typeof data.allowedDivisions[0] === 'string' ? data.allowedDivisions[0] : (data.allowedDivisions[0] as Division)._id)
        : '');

      const handleManagerDivisionChange = (divId: string) => {
        setData({
          ...data,
          division: divId,
          allowedDivisions: divId ? [divId] : [],
          divisionMapping: [], // Managers don't need department mapping usually, or implicit all
          department: '',
          departments: [],
          dataScope: 'division'
        });
      };

      return (
        <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 dark:bg-blue-900/10 dark:border-blue-800">
            <h3 className="flex items-center gap-2 text-sm font-bold text-blue-800 dark:text-blue-400 mb-4">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-800/50">
                <Building className="h-4 w-4" />
              </span>
              Division Manager Assignment
            </h3>

            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                Select Division *
              </label>
              <select
                value={selectedDivisionId}
                onChange={(e) => handleManagerDivisionChange(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
              >
                <option value="">-- Choose Division --</option>
                {divisions.map(d => (
                  <option key={d._id} value={d._id}>{d.name}</option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                This user will be assigned as the Manager for the selected Division.
              </p>
            </div>

            {/* Manager Department Selection */}
            {selectedDivisionId && (
              <div className="mt-4 pt-4 border-t border-blue-200 dark:border-blue-800">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Allowed Departments
                  </label>
                  <button
                    type="button"
                    onClick={() => setData({ ...data, departments: [] })}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400"
                    title="Clear selection to allow access to ALL departments in this division"
                  >
                    Select All (Clear Restrictions)
                  </button>
                </div>

                <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 p-2 space-y-2 bg-white/50 dark:bg-slate-800/50">
                  {departments
                    .filter(dept =>
                      dept.divisions?.some((div: any) => {
                        const dId = typeof div === 'string' ? div : div._id;
                        return dId === selectedDivisionId;
                      })
                    )
                    .map((dept) => (
                      <label key={dept._id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-blue-100/50 dark:hover:bg-blue-900/30 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={data.departments?.includes(dept._id)}
                          onChange={() => {
                            const currentDepts = data.departments || [];
                            if (currentDepts.includes(dept._id)) {
                              setData({ ...data, departments: currentDepts.filter(d => d !== dept._id) });
                            } else {
                              setData({ ...data, departments: [...currentDepts, dept._id] });
                            }
                          }}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-slate-700 dark:text-slate-300">{dept.name}</span>
                      </label>
                    ))}
                  {departments.filter(dept =>
                    dept.divisions?.some((div: any) => {
                      const dId = typeof div === 'string' ? div : div._id;
                      return dId === selectedDivisionId;
                    })
                  ).length === 0 && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 p-2">No departments found in this division</p>
                    )}
                </div>
                {(!data.departments || data.departments.length === 0) && (
                  <p className="mt-2 text-xs text-green-600 dark:text-green-400 font-medium">
                    ✓ Access granted to ALL departments in this division
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    // HOD: use full division mapping (multiple divisions, multiple departments per division)
    if (data.role === 'hod') {
      return (
        <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 dark:bg-amber-900/10 dark:border-amber-800">
            <h3 className="flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-400 mb-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-800/50">
                <Users className="h-4 w-4" />
              </span>
              HOD – Division & Department Assignment
            </h3>
            <p className="text-xs text-amber-700 dark:text-amber-500 mb-4">
              Select one or more divisions and the departments this HOD will head. One HOD can be assigned to multiple departments.
            </p>

            <div className="space-y-4">
              {divisions.map((div) => {
                const isSelected = data.divisionMapping?.some((m: any) => {
                  const mDivId = typeof m.division === 'string' ? m.division : m.division?._id;
                  return mDivId === div._id;
                });
                const mapping = data.divisionMapping?.find((m: any) => {
                  const mDivId = typeof m.division === 'string' ? m.division : m.division?._id;
                  return mDivId === div._id;
                });

                return (
                  <div key={div._id} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`flex items-center justify-between p-3 cursor-pointer ${isSelected ? 'bg-amber-50 dark:bg-amber-900/20' : ''}`}
                      onClick={() => toggleDivisionMapping(div._id, null, asEmployee)}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          readOnly
                          className="rounded border-slate-300 text-amber-600"
                        />
                        <span className="text-sm font-medium dark:text-white">{div.name}</span>
                      </div>
                      {isSelected && (
                        <span className="text-[10px] font-bold uppercase text-amber-600 dark:text-amber-400">
                          {mapping?.departments?.length === 0 ? 'All Departments' : `${mapping?.departments?.length} Dept(s)`}
                        </span>
                      )}
                    </div>

                    {isSelected && (
                      <div className="p-3 border-t border-slate-100 dark:border-slate-700 grid grid-cols-2 gap-2">
                        {departments.filter(dept => dept.divisions?.some((d: any) => (typeof d === 'string' ? d : d._id) === div._id)).map(dept => {
                          const deptId = dept._id;
                          const isDeptSelected = (mapping?.departments || []).some((d: any) => (typeof d === 'string' ? d : d?._id) === deptId);
                          return (
                            <label key={dept._id} className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isDeptSelected}
                                onChange={() => toggleDivisionMapping(div._id, dept._id, asEmployee)}
                                className="rounded border-slate-300 text-amber-600 scale-75"
                              />
                              <span className="text-[11px] text-slate-600 dark:text-slate-400 truncate">{dept.name}</span>
                            </label>
                          );
                        })}
                        {departments.filter(dept => dept.divisions?.some((d: any) => (typeof d === 'string' ? d : d._id) === div._id)).length === 0 && (
                          <div className="col-span-2 text-center py-2 text-[10px] text-slate-400">No departments linked to this division</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      );
    }

    // Default Scoping UI for other roles
    return (
      <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Data Scope *</label>
          <select
            value={data.dataScope}
            onChange={(e) => setData({ ...data, dataScope: e.target.value })}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          >
            <option value="all">All Data (Across All Divisions)</option>
            <option value="division">Specific Divisions / Departments</option>
            {/* option value="department" removed for HOD as it's handled above, but kept if needed for others */}
            <option value="own">Self Only</option>
          </select>
        </div>

        {data.dataScope === 'division' && (
          <div className="space-y-4 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
            <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
              Division & Department Access Mapping
            </label>

            <div className="space-y-4">
              {divisions.map((div) => {
                const isSelected = data.divisionMapping?.some((m: any) => {
                  const mDivId = typeof m.division === 'string' ? m.division : m.division?._id;
                  return mDivId === div._id;
                });
                const mapping = data.divisionMapping?.find((m: any) => {
                  const mDivId = typeof m.division === 'string' ? m.division : m.division?._id;
                  return mDivId === div._id;
                });

                return (
                  <div key={div._id} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`flex items-center justify-between p-3 cursor-pointer ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                      onClick={() => toggleDivisionMapping(div._id, null, asEmployee)}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          readOnly
                          className="rounded border-slate-300 text-blue-600"
                        />
                        <span className="text-sm font-medium dark:text-white">{div.name}</span>
                      </div>
                      {isSelected && (
                        <span className="text-[10px] font-bold uppercase text-blue-600 dark:text-blue-400">
                          {mapping?.departments.length === 0 ? 'All Departments' : `${mapping?.departments.length} Departments`}
                        </span>
                      )}
                    </div>

                    {isSelected && (
                      <div className="p-3 border-t border-slate-100 dark:border-slate-700 grid grid-cols-2 gap-2">
                        {departments.filter(dept => dept.divisions?.some((d: any) => (typeof d === 'string' ? d : d._id) === div._id)).map(dept => (
                          <label key={dept._id} className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={mapping?.departments.includes(dept._id)}
                              onChange={() => toggleDivisionMapping(div._id, dept._id, asEmployee)}
                              className="rounded border-slate-300 text-blue-600 scale-75"
                            />
                            <span className="text-[11px] text-slate-600 dark:text-slate-400 truncate">{dept.name}</span>
                          </label>
                        ))}
                        {departments.filter(dept => dept.divisions?.some((d: any) => (typeof d === 'string' ? d : d._id) === div._id)).length === 0 && (
                          <div className="col-span-2 text-center py-2 text-[10px] text-slate-400">No departments linked to this division</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {data.dataScope === 'department' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Select Department
            </label>
            <select
              value={data.department || ''}
              onChange={(e) => setData({ ...data, department: e.target.value })}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="">Select Department</option>
              {departments.map((dept) => (
                <option key={dept._id} value={dept._id}>
                  {dept.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    );
  };

  if (loading && users.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner />
      </div>
    );
  }

  // Permission Check
  if (currentUser && !canViewUsers(currentUser as any)) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center p-6 text-center">
        <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-rose-50 text-rose-500 dark:bg-rose-900/20">
          <Lock className="h-12 w-12" />
        </div>
        <h2 className="mb-2 text-2xl font-black text-slate-900 dark:text-white">Not Authorized</h2>
        <p className="max-w-md text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
          You do not have the required permissions to view this page.
          Access is restricted to authorized personnel only.
        </p>
        <button
          onClick={() => window.history.back()}
          className="mt-8 rounded-2xl bg-slate-900 px-8 py-3.5 text-sm font-black uppercase tracking-widest text-white transition-all hover:bg-black active:scale-95 dark:bg-white dark:text-slate-900"
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-slate-50 p-6 dark:bg-slate-950/50">
      {/* Background Decorations */}
      <div className="pointer-events-none absolute " />

      <div className="relative mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
                <Shield className="h-5 w-5" />
              </span>
              <span className="text-sm font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400">System Control</span>
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">User Management</h1>
            <p className="mt-1 text-base text-slate-500 dark:text-slate-400">
              Configure system access, manage roles, and monitor user activity.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={loadData}
              className="group flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
            >
              <RotateCw className={`h-4 w-4 transition-transform group-hover:rotate-180 ${loading ? 'animate-spin' : ''}`} />
              Sync Data
            </button>
            {currentUser && canCreateUser(currentUser as any) && (
              <>
                <button
                  onClick={openFromEmployeeDialog}
                  className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 transition-all hover:bg-emerald-100 dark:border-emerald-800/50 dark:bg-emerald-900/20 dark:text-emerald-400"
                >
                  <UserPlus className="h-4 w-4" />
                  Upgrade Employee
                </button>
                <button
                  onClick={() => setShowCreateDialog(true)}
                  className="flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-bold text-white shadow-xl shadow-slate-900/20 transition-all hover:scale-[1.02] hover:bg-slate-800 active:scale-95 dark:bg-white dark:text-slate-900 dark:shadow-none"
                >
                  <Plus className="h-4 w-4" />
                  New User
                </button>
              </>
            )}
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-6 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/30">
              <span className="text-xl">⚠️</span>
            </div>
            <p className="font-medium">{error}</p>
          </div>
        )}
        {success && (
          <div className="mb-6 flex items-center gap-3 rounded-2xl border border-green-200 bg-green-50 p-4 text-green-700 dark:border-green-800/50 dark:bg-green-900/20 dark:text-green-400">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-green-100 dark:bg-green-900/30">
              <CheckCircle className="h-6 w-6" />
            </div>
            <p className="font-medium">{success}</p>
          </div>
        )}

        {/* Stats Grid */}
        {stats && (
          <div className="mb-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              title="Total Accounts"
              value={stats.totalUsers}
              icon={Users}
              bgClass="bg-blue-500/10"
              iconClass="text-blue-600 dark:text-blue-400"
            // dekorClass="bg-blue-500/5"
            />
            <StatCard
              title="Active Users"
              value={stats.activeUsers}
              icon={UserCheck}
              bgClass="bg-emerald-500/10"
              iconClass="text-emerald-600 dark:text-emerald-400"
              // dekorClass="bg-emerald-500/5"
              trend={{ value: "+12%", positive: true }}
            />
            <StatCard
              title="HODs"
              value={stats.byRole?.hod || 0}
              icon={Shield}
              bgClass="bg-violet-500/10"
              iconClass="text-violet-600 dark:text-violet-400"
            // dekorClass="bg-violet-500/5"
            />
            <StatCard
              title="Managers"
              value={stats.byRole?.manager || 0}
              icon={Building}
              bgClass="bg-sky-500/10"
              iconClass="text-sky-600 dark:text-sky-400"
            // dekorClass="bg-sky-500/5"
            />
            <StatCard
              title="Inactive"
              value={stats.inactiveUsers}
              icon={UserX}
              bgClass="bg-rose-500/10"
              iconClass="text-rose-600 dark:text-rose-400"
            // dekorClass="bg-rose-500/5"
            />
          </div>
        )}

        {/* Filters & Actions Bar */}
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search users by name, email, or emp ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-12 pr-4 text-sm transition-all focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:focus:border-blue-500"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900">
              <Filter className="h-4 w-4 text-slate-400" />
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="bg-transparent text-sm font-medium text-slate-600 focus:outline-none dark:text-slate-300"
              >
                <option value="">All Roles</option>
                {ROLES.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-transparent text-sm font-medium text-slate-600 focus:outline-none dark:text-slate-300"
              >
                <option value="">Any Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
        </div>

        {/* Users Table */}
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/50">
                  <th className="px-6 py-5 text-left text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    System User
                  </th>
                  <th className="px-6 py-5 text-left text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    Role & Permissions
                  </th>
                  <th className="px-6 py-5 text-left text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    Access Scope
                  </th>
                  <th className="px-6 py-5 text-left text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    Identifier
                  </th>
                  <th className="px-6 py-5 text-left text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    Account Status
                  </th>
                  <th className="px-6 py-5 text-right text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {scopedUsers.map((user) => (
                  <tr key={user._id} className="group transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-4">
                        <div
                          className="relative flex h-11 w-11 flex-shrink-0 cursor-pointer items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 font-bold text-white shadow-lg shadow-blue-500/20 transition-transform group-hover:scale-110"
                          onClick={() => {
                            setSelectedViewUser(user);
                            setShowViewDialog(true);
                          }}
                        >
                          {user.name?.[0]?.toUpperCase() || '?'}
                          <div className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-white bg-emerald-500 dark:border-slate-900 ${!user.isActive && 'bg-slate-400 hover:bg-slate-500'}`} />
                        </div>
                        <div className="min-w-0">
                          <button
                            onClick={() => {
                              setSelectedViewUser(user);
                              setShowViewDialog(true);
                            }}
                            className="block truncate text-sm font-bold text-slate-900 transition-colors hover:text-blue-600 dark:text-white dark:hover:text-blue-400"
                          >
                            {user.name}
                          </button>
                          <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                            <span className="truncate">{user.email}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-[11px] font-bold uppercase tracking-tight ${getRoleColor(user.role)}`}>
                        <Shield className="h-3 w-3" />
                        {getRoleLabel(user.role)}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex flex-wrap gap-1.5">
                        {(() => {
                          const mapping = user.divisionMapping || [];
                          const depts = mapping.flatMap((m: any) =>
                            (m.departments || []).map((d: any) => ({
                              _id: typeof d === 'string' ? d : d?._id,
                              name: typeof d === 'object' && d?.name ? d.name : departments.find((dep) => dep._id === (typeof d === 'string' ? d : d?._id))?.name || 'Dept',
                            }))
                          ).filter((d: { _id?: string }) => d._id);
                          const allDivLabels = mapping
                            .filter((m: any) => !m.departments || m.departments.length === 0)
                            .map((m: any) => {
                              const divId = typeof m.division === 'string' ? m.division : m.division?._id;
                              const divName = divisions.find((d) => d._id === divId)?.name || (typeof m.division === 'object' && m.division?.name) || 'Division';
                              return { _id: `div-${divId}`, name: `All in ${divName}` };
                            });
                          const items = [...depts, ...allDivLabels];
                          return items.length > 0 ? (
                            <>
                              {items.slice(0, 2).map((item: { _id: string; name: string }, idx: number) => (
                                <span key={`${user._id}-${item._id}-${idx}`} className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                  <Building className="h-2.5 w-2.5" />
                                  {item.name}
                                </span>
                              ))}
                              {items.length > 2 && (
                                <span className="rounded-md bg-blue-100/50 px-2 py-0.5 text-[10px] font-bold text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                                  +{items.length - 2} more
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-[11px] font-medium text-slate-400 italic">No dept assigned</span>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <code className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                        {user.employeeId || user.employeeRef?.emp_no || 'SYSTEM'}
                      </code>
                    </td>
                    <td className="px-6 py-5">
                      <button
                        onClick={() => handleToggleStatus(user)}
                        disabled={user.role === 'super_admin'}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold transition-all ${user.isActive
                          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-400'
                          } ${user.role === 'super_admin' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${user.isActive ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                        {user.isActive ? 'ACTIVE' : 'DISABLED'}
                      </button>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex justify-end gap-2">
                        {currentUser && canEditUser(currentUser as any) && (
                          <button
                            onClick={() => {
                              setSelectedUser(user);
                              openEditDialog(user);
                            }}
                            className="rounded-xl border border-slate-200 p-2 text-slate-400 transition-all hover:bg-blue-50 hover:text-blue-600 dark:border-slate-800 dark:hover:bg-blue-900/30"
                            title="Edit User"
                          >
                            <Edit className="h-4.5 w-4.5" />
                          </button>
                        )}
                        {currentUser && canResetPassword(currentUser as any) && (
                          <button
                            onClick={() => {
                              setSelectedUser(user);
                              setShowPasswordDialog(true);
                            }}
                            className="rounded-xl border border-slate-200 p-2 text-slate-400 transition-all hover:bg-amber-50 hover:text-amber-600 dark:border-slate-800 dark:hover:bg-amber-900/30"
                            title="Reset Password"
                          >
                            <Key className="h-4.5 w-4.5" />
                          </button>
                        )}
                        {currentUser && canDeleteUser(currentUser as any) && (
                          <button
                            onClick={() => handleDelete(user)}
                            className="rounded-xl border border-slate-200 p-2 text-slate-400 transition-all hover:bg-rose-50 hover:text-rose-600 dark:border-slate-800 dark:hover:bg-rose-900/30"
                            title="Delete User"
                          >
                            <Trash2 className="h-4.5 w-4.5" />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setSelectedViewUser(user);
                            setShowViewDialog(true);
                          }}
                          className="rounded-xl border border-slate-200 p-2 text-slate-400 transition-all hover:bg-indigo-50 hover:text-indigo-600 dark:border-slate-800 dark:hover:bg-indigo-900/30"
                          title="View Details"
                        >
                          <Eye className="h-4.5 w-4.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {scopedUsers.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100 dark:bg-slate-800">
                <Users className="h-8 w-8 text-slate-400" />
              </div>
              <p className="text-lg font-bold text-slate-900 dark:text-white">No Users Found</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">Try adjusting your filters or search query.</p>
            </div>
          )}
        </div>

        {/* Create User Dialog */}
        {
          showCreateDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-md" onClick={() => setShowCreateDialog(false)} />
              <div className="relative z-50 w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900">

                {/* Modern Gradient Header */}
                <div className="relative bg-gradient-to-br from-indigo-600 via-purple-600 to-indigo-700 px-8 py-6 text-white overflow-hidden">
                  <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48cGF0dGVybiBpZD0iZ3JpZCIgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cGF0aCBkPSJNIDQwIDAgTCAwIDAgMCA0MCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLW9wYWNpdHk9IjAuMSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-30"></div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowCreateDialog(false);
                    }}
                    className="absolute right-6 top-6 z-10 rounded-xl p-2 text-white/80 transition-all hover:bg-white/10 hover:text-white"
                  >
                    <X className="h-5 w-5" />
                  </button>
                  <div className="relative flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm ring-2 ring-white/20">
                      <UserPlus className="h-7 w-7" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold">Create New User</h2>
                      <p className="text-sm text-indigo-100 font-medium">Add a new team member to the system</p>
                    </div>
                  </div>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
                  <form onSubmit={handleCreateUser} className="flex flex-col lg:flex-row h-full">

                    {/* LEFT COLUMN - Main Form Fields */}
                    <div className="flex-1 p-8 space-y-6 lg:border-r lg:border-slate-200 dark:lg:border-slate-800">
                      {/* Basic Information Card */}
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                        <div className="mb-5 flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10">
                            <UserCircle className="h-5 w-5" />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Basic Information</h3>
                            <p className="text-xs text-slate-500">User identity and contact details</p>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="space-y-2">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                              Full Name <span className="text-rose-500">*</span>
                            </label>
                            <input
                              type="text"
                              value={formData.name}
                              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                              required
                              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 placeholder-slate-400 transition-all focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                              placeholder="e.g. John Doe"
                            />
                          </div>

                          <div className="space-y-2">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                              Email Address <span className="text-rose-500">*</span>
                            </label>
                            <div className="relative">
                              <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                              <input
                                type="email"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                required
                                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pl-11 text-sm font-medium text-slate-900 placeholder-slate-400 transition-all focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                                placeholder="john@example.com"
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                              System Role <span className="text-rose-500">*</span>
                            </label>
                            <div className="relative">
                              <Shield className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                              <select
                                value={formData.role}
                                onChange={(e) => {
                                  const role = e.target.value;
                                  setFormData({
                                    ...formData,
                                    role,
                                    dataScope: ['hr', 'sub_admin', 'super_admin'].includes(role) ? 'all' : (role === 'hod' ? 'division' : 'department'),
                                    department: '',
                                    departments: [],
                                    divisionMapping: []
                                  });
                                }}
                                className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 py-3 pl-11 text-sm font-medium text-slate-900 transition-all focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                              >
                                {ROLES.filter(r => r.value !== 'employee').map((role) => (
                                  <option key={role.value} value={role.value}>
                                    {role.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Password Configuration Card */}
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                        <div className="mb-5 flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-500/10">
                            <Lock className="h-5 w-5" />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Password Configuration</h3>
                            <p className="text-xs text-slate-500">Set initial access credentials</p>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <label className="flex items-center gap-3 cursor-pointer group rounded-xl border border-slate-200 bg-slate-50 p-4 transition-all hover:border-indigo-300 hover:bg-indigo-50/50 dark:border-slate-700 dark:bg-slate-800/50">
                            <div className={`relative flex h-5 w-5 items-center justify-center rounded-md border-2 transition-all ${formData.autoGeneratePassword ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300 bg-white'}`}>
                              {formData.autoGeneratePassword && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                              <input
                                type="checkbox"
                                className="sr-only"
                                checked={formData.autoGeneratePassword}
                                onChange={(e) => setFormData({ ...formData, autoGeneratePassword: e.target.checked })}
                              />
                            </div>
                            <div className="flex-1">
                              <span className="block text-sm font-semibold text-slate-900 dark:text-white">Auto-generate secure password</span>
                              <span className="text-xs text-slate-500">System will create and email a temporary password</span>
                            </div>
                          </label>

                          {!formData.autoGeneratePassword && (
                            <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Password <span className="text-rose-500">*</span>
                              </label>
                              <div className="relative">
                                <Key className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                <input
                                  type="password"
                                  value={formData.password}
                                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                  placeholder="Enter a secure password"
                                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pl-11 text-sm font-medium text-slate-900 placeholder-slate-400 transition-all focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Access Scoping Card */}
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                        <div className="mb-5 flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10">
                            <Building className="h-5 w-5" />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Access Scoping</h3>
                            <p className="text-xs text-slate-500">Define organizational access boundaries</p>
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/30">
                          <ScopingSelector data={formData} setData={setFormData} />
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-3 pt-2">
                        <button
                          type="button"
                          onClick={() => setShowCreateDialog(false)}
                          className="flex-1 rounded-xl border-2 border-slate-200 bg-white px-6 py-3.5 text-sm font-bold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="flex-1 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/30 transition-all hover:shadow-xl hover:shadow-indigo-500/40 active:scale-[0.98]"
                        >
                          Create User Account
                        </button>
                      </div>
                    </div>

                    {/* RIGHT COLUMN - Feature Privileges */}
                    <div className="flex-1 p-8 space-y-6 bg-slate-50/50 dark:bg-slate-900/30">
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                        <div className="mb-5 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-500/10">
                              <Layers className="h-5 w-5" />
                            </div>
                            <div>
                              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Feature Privileges</h3>
                              <p className="text-xs text-slate-500">Grant read/write access to modules</p>
                            </div>
                          </div>

                          {/* Bulk Selection Buttons */}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const allModules = MODULE_CATEGORIES.flatMap(cat => cat.modules.map(m => m.code));
                                const readPermissions = allModules.map(code => `${code}:read`);
                                const existingWrite = (formData.featureControl || []).filter(fc => fc.endsWith(':write'));
                                setFormData({ ...formData, featureControl: [...readPermissions, ...existingWrite] });
                              }}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20 transition-colors"
                            >
                              Read All
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const allModules = MODULE_CATEGORIES.flatMap(cat => cat.modules.map(m => m.code));
                                const writePermissions = allModules.map(code => `${code}:write`);
                                const existingRead = (formData.featureControl || []).filter(fc => fc.endsWith(':read'));
                                setFormData({ ...formData, featureControl: [...existingRead, ...writePermissions] });
                              }}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20 transition-colors"
                            >
                              Write All
                            </button>
                          </div>
                        </div>

                        <div className="space-y-4">
                          {MODULE_CATEGORIES.map((category) => (
                            <div key={category.code} className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/30">
                              <div className="mb-3 flex items-center gap-2">
                                <span className="text-lg">{category.icon}</span>
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white">{category.name}</h4>
                              </div>
                              <div className="grid grid-cols-1 gap-2">
                                {category.modules.map((module) => {
                                  const hasRead = formData.featureControl?.includes(`${module.code}:read`) || false;
                                  const hasWrite = formData.featureControl?.includes(`${module.code}:write`) || false;
                                  const hasVerify = (module as any).verifiable ? (formData.featureControl?.includes(`${module.code}:verify`) || false) : false;

                                  const hasBank = (module as any).bankable ? (formData.featureControl?.includes(`${module.code}:bank`) || false) : false;

                                  const toggleRead = () => {
                                    const currentFeatures = formData.featureControl || [];
                                    const readPerm = `${module.code}:read`;
                                    const newFeatures = hasRead
                                      ? currentFeatures.filter(f => f !== readPerm)
                                      : [...currentFeatures, readPerm];
                                    setFormData({ ...formData, featureControl: newFeatures });
                                  };

                                  const toggleWrite = () => {
                                    const currentFeatures = formData.featureControl || [];
                                    const writePerm = `${module.code}:write`;
                                    const newFeatures = hasWrite
                                      ? currentFeatures.filter(f => f !== writePerm)
                                      : [...currentFeatures, writePerm];
                                    setFormData({ ...formData, featureControl: newFeatures });
                                  };

                                  const toggleVerify = () => {
                                    const currentFeatures = formData.featureControl || [];
                                    const verifyPerm = `${module.code}:verify`;
                                    const newFeatures = hasVerify
                                      ? currentFeatures.filter(f => f !== verifyPerm)
                                      : [...currentFeatures, verifyPerm];
                                    setFormData({ ...formData, featureControl: newFeatures });
                                  };

                                  const toggleBank = () => {
                                    const currentFeatures = formData.featureControl || [];
                                    const bankPerm = `${module.code}:bank`;
                                    const newFeatures = hasBank
                                      ? currentFeatures.filter(f => f !== bankPerm)
                                      : [...currentFeatures, bankPerm];
                                    setFormData({ ...formData, featureControl: newFeatures });
                                  };

                                  return (
                                    <div
                                      key={module.code}
                                      className="flex items-center justify-between rounded-lg p-2 transition-colors hover:bg-white dark:hover:bg-slate-700/50"
                                    >
                                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{module.label}</span>
                                      <div className="flex gap-2">
                                        {/* Read Toggle */}
                                        <button
                                          type="button"
                                          onClick={toggleRead}
                                          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${hasRead
                                            ? 'bg-blue-500 text-white shadow-sm'
                                            : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                                            }`}
                                        >
                                          Read
                                        </button>
                                        {/* Write Toggle */}
                                        <button
                                          type="button"
                                          onClick={toggleWrite}
                                          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${hasWrite
                                            ? 'bg-emerald-500 text-white shadow-sm'
                                            : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                                            }`}
                                        >
                                          Write
                                        </button>
                                        {/* Verify Toggle — only for verifiable modules (e.g. EMPLOYEES) */}
                                        {(module as any).verifiable && (
                                          <button
                                            type="button"
                                            onClick={toggleVerify}
                                            title="Verify: grants access to the Applications tab and ability to verify applications. Independent of Read/Write."
                                            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${hasVerify
                                              ? 'bg-violet-500 text-white shadow-sm'
                                              : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                                              }`}
                                          >
                                            Verify
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                  </form>
                </div>
              </div>
            </div>
          )}

        {/* Update User Dialog */}
        {showFromEmployeeDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-md" onClick={() => setShowFromEmployeeDialog(false)} />
            <div className="relative z-50 w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900">

              {/* Modern Gradient Header - Emerald Theme */}
              <div className="relative bg-gradient-to-br from-emerald-600 via-teal-600 to-emerald-700 px-8 py-6 text-white overflow-hidden">
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48cGF0dGVybiBpZD0iZ3JpZCIgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cGF0aCBkPSJNIDQwIDAgTCAwIDAgMCA0MCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLW9wYWNpdHk9IjAuMSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-30"></div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowFromEmployeeDialog(false);
                  }}
                  className="absolute right-6 top-6 z-10 rounded-xl p-2 text-white/80 transition-all hover:bg-white/10 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
                <div className="relative flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm ring-2 ring-white/20">
                    <UserPlus className="h-7 w-7" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold">Upgrade Employee</h2>
                    <p className="text-sm text-emerald-100 font-medium">Grant system access to existing employee</p>
                  </div>
                </div>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
                <form onSubmit={handleCreateFromEmployee} className="flex flex-col lg:flex-row h-full">

                  {/* LEFT COLUMN - Main Form Fields */}
                  <div className="flex-1 p-8 space-y-6 lg:border-r lg:border-slate-200 dark:lg:border-slate-800">
                    {/* Employee Selection Card */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                      <div className="mb-5 flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10">
                          <UserCircle className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Select Employee</h3>
                          <p className="text-xs text-slate-500">Choose an employee to grant system access</p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Search Employee <span className="text-rose-500">*</span>
                        </label>
                        <div className="relative" ref={employeeDropdownRef}>
                          <div className="relative">
                            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                              type="text"
                              placeholder="Search by name or employee ID..."
                              value={employeeSearch}
                              onFocus={() => setShowEmployeeDropdown(true)}
                              onChange={(e) => {
                                setEmployeeSearch(e.target.value);
                                setShowEmployeeDropdown(true);
                                if (e.target.value === '') {
                                  setEmployeeFormData({ ...employeeFormData, employeeId: '', email: '' });
                                }
                              }}
                              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pl-11 pr-10 text-sm font-medium text-slate-900 placeholder-slate-400 transition-all focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            />
                            <button
                              type="button"
                              onClick={() => setShowEmployeeDropdown(!showEmployeeDropdown)}
                              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition-transform"
                            >
                              <ChevronRight className={`h-4 w-4 transition-transform ${showEmployeeDropdown ? 'rotate-90' : ''}`} />
                            </button>
                          </div>

                          {showEmployeeDropdown && (
                            <div className="absolute z-10 mt-2 w-full max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800">
                              {employeesWithoutAccount.filter(emp =>
                                !employeeSearch ||
                                emp.employee_name.toLowerCase().includes(employeeSearch.toLowerCase()) ||
                                emp.emp_no.toLowerCase().includes(employeeSearch.toLowerCase())
                              ).length === 0 ? (
                                <div className="p-6 text-center">
                                  <UserX className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                                  <p className="text-sm font-medium text-slate-500">No matching employees found</p>
                                  <p className="text-xs text-slate-400 mt-1">Try a different search term</p>
                                </div>
                              ) : (
                                <div className="p-2 space-y-1">
                                  {employeesWithoutAccount
                                    .filter(emp =>
                                      !employeeSearch ||
                                      emp.employee_name.toLowerCase().includes(employeeSearch.toLowerCase()) ||
                                      emp.emp_no.toLowerCase().includes(employeeSearch.toLowerCase())
                                    )
                                    .map((emp) => (
                                      <button
                                        key={emp._id}
                                        type="button"
                                        onClick={() => {
                                          setEmployeeFormData({
                                            ...employeeFormData,
                                            employeeId: emp.emp_no,
                                            email: emp?.email || '',
                                          });
                                          setEmployeeSearch(`${emp.emp_no} - ${emp.employee_name}`);
                                          setShowEmployeeDropdown(false);
                                        }}
                                        className={`flex w-full items-center justify-between rounded-lg p-3 text-left transition-all ${employeeFormData.employeeId === emp.emp_no
                                          ? 'bg-emerald-50 ring-2 ring-emerald-500/20 dark:bg-emerald-900/20'
                                          : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                                          }`}
                                      >
                                        <div className="flex items-center gap-3">
                                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 font-bold text-sm text-white shadow-sm">
                                            {emp.employee_name[0]}
                                          </div>
                                          <div>
                                            <div className="text-sm font-bold text-slate-900 dark:text-white">{emp.employee_name}</div>
                                            <div className="text-xs text-slate-500">{emp.emp_no} • {emp.department_id?.name || 'General'}</div>
                                          </div>
                                        </div>
                                        {employeeFormData.employeeId === emp.emp_no && <CheckCircle className="h-5 w-5 text-emerald-500" />}
                                      </button>
                                    ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Account Configuration Card */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                      <div className="mb-5 flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10">
                          <Shield className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Account Configuration</h3>
                          <p className="text-xs text-slate-500">Set login credentials and permissions</p>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                            Login Email
                          </label>
                          <div className="relative">
                            <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                              type="email"
                              value={employeeFormData.email}
                              onChange={(e) => setEmployeeFormData({ ...employeeFormData, email: e.target.value })}
                              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pl-11 text-sm font-medium text-slate-900 placeholder-slate-400 transition-all focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                              placeholder="email@example.com"
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                            System Role <span className="text-rose-500">*</span>
                          </label>
                          <div className="relative">
                            <Shield className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <select
                              value={employeeFormData.role}
                              onChange={(e) => {
                                const role = e.target.value;
                                setEmployeeFormData({
                                  ...employeeFormData,
                                  role,
                                  dataScope: ['hr', 'sub_admin'].includes(role) ? 'all' : (role === 'hod' ? 'division' : 'department'),
                                  departments: [],
                                  divisionMapping: []
                                });
                              }}
                              className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 py-3 pl-11 text-sm font-medium text-slate-900 transition-all focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            >
                              {ROLES.filter((r) => !['super_admin', 'employee'].includes(r.value)).map((role) => (
                                <option key={role.value} value={role.value}>{role.label}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Access Scoping Card */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                      <div className="mb-5 flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-500/10">
                          <Building className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Access Scoping</h3>
                          <p className="text-xs text-slate-500">Define organizational access boundaries</p>
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/30">
                        <ScopingSelector data={employeeFormData} setData={(val) => setEmployeeFormData(val)} asEmployee={true} />
                      </div>
                    </div>

                    {/* Info Banner */}
                    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800/50 dark:bg-amber-900/10">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-800/30">
                        <Key className="h-4 w-4 text-amber-600 dark:text-amber-500" />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-semibold text-amber-900 dark:text-amber-300 mb-1">Auto-generated Password</p>
                        <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                          A secure temporary password will be automatically generated and sent to the employee's email address.
                        </p>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowFromEmployeeDialog(false);
                          resetEmployeeForm();
                        }}
                        className="flex-1 rounded-xl border-2 border-slate-200 bg-white px-6 py-3.5 text-sm font-bold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={!employeeFormData.employeeId}
                        className="flex-1 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/30 transition-all hover:shadow-xl hover:shadow-emerald-500/40 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Upgrade Employee
                      </button>
                    </div>
                  </div>

                  {/* RIGHT COLUMN - Feature Privileges */}
                  <div className="flex-1 p-8 space-y-6 bg-slate-50/50 dark:bg-slate-900/30">
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                      <div className="mb-5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-500/10">
                            <Layers className="h-5 w-5" />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Feature Privileges</h3>
                            <p className="text-xs text-slate-500">Grant read/write access to modules</p>
                          </div>
                        </div>

                        {/* Bulk Selection Buttons */}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const allModules = MODULE_CATEGORIES.flatMap(cat => cat.modules.map(m => m.code));
                              const readPermissions = allModules.map(code => `${code}:read`);
                              const existingWrite = (employeeFormData.featureControl || []).filter(fc => fc.endsWith(':write'));
                              setEmployeeFormData({ ...employeeFormData, featureControl: [...readPermissions, ...existingWrite] });
                            }}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20 transition-colors"
                          >
                            Read All
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const allModules = MODULE_CATEGORIES.flatMap(cat => cat.modules.map(m => m.code));
                              const writePermissions = allModules.map(code => `${code}:write`);
                              const existingRead = (employeeFormData.featureControl || []).filter(fc => fc.endsWith(':read'));
                              setEmployeeFormData({ ...employeeFormData, featureControl: [...existingRead, ...writePermissions] });
                            }}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20 transition-colors"
                          >
                            Write All
                          </button>
                        </div>
                      </div>

                      <div className="space-y-4">
                        {MODULE_CATEGORIES.map((category) => (
                          <div key={category.code} className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/30">
                            <div className="mb-3 flex items-center gap-2">
                              <span className="text-lg">{category.icon}</span>
                              <h4 className="text-sm font-bold text-slate-900 dark:text-white">{category.name}</h4>
                            </div>
                            <div className="grid grid-cols-1 gap-2">
                              {category.modules.map((module) => {
                                const hasRead = employeeFormData.featureControl?.includes(`${module.code}:read`) || false;
                                const hasWrite = employeeFormData.featureControl?.includes(`${module.code}:write`) || false;
                                const hasVerify = (module as any).verifiable ? (employeeFormData.featureControl?.includes(`${module.code}:verify`) || false) : false;
                                const hasBank = (module as any).bankable ? (employeeFormData.featureControl?.includes(`${module.code}:bank`) || false) : false;

                                const toggleRead = () => {
                                  const currentFeatures = employeeFormData.featureControl || [];
                                  const readPerm = `${module.code}:read`;
                                  const newFeatures = hasRead
                                    ? currentFeatures.filter(f => f !== readPerm)
                                    : [...currentFeatures, readPerm];
                                  setEmployeeFormData({ ...employeeFormData, featureControl: newFeatures });
                                };

                                const toggleWrite = () => {
                                  const currentFeatures = employeeFormData.featureControl || [];
                                  const writePerm = `${module.code}:write`;
                                  const newFeatures = hasWrite
                                    ? currentFeatures.filter(f => f !== writePerm)
                                    : [...currentFeatures, writePerm];
                                  setEmployeeFormData({ ...employeeFormData, featureControl: newFeatures });
                                };

                                const toggleVerify = () => {
                                  const currentFeatures = employeeFormData.featureControl || [];
                                  const verifyPerm = `${module.code}:verify`;
                                  const newFeatures = hasVerify
                                    ? currentFeatures.filter(f => f !== verifyPerm)
                                    : [...currentFeatures, verifyPerm];
                                  setEmployeeFormData({ ...employeeFormData, featureControl: newFeatures });
                                };

                                const toggleBank = () => {
                                  const currentFeatures = employeeFormData.featureControl || [];
                                  const bankPerm = `${module.code}:bank`;
                                  const newFeatures = hasBank
                                    ? currentFeatures.filter(f => f !== bankPerm)
                                    : [...currentFeatures, bankPerm];
                                  setEmployeeFormData({ ...employeeFormData, featureControl: newFeatures });
                                };

                                return (
                                  <div
                                    key={module.code}
                                    className="flex items-center justify-between rounded-lg p-2 transition-colors hover:bg-white dark:hover:bg-slate-700/50"
                                  >
                                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{module.label}</span>
                                    <div className="flex gap-2">
                                      <button
                                        type="button"
                                        onClick={toggleRead}
                                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${hasRead
                                          ? 'bg-blue-500 text-white shadow-sm'
                                          : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                                          }`}
                                      >
                                        Read
                                      </button>
                                      <button
                                        type="button"
                                        onClick={toggleWrite}
                                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${hasWrite
                                          ? 'bg-emerald-500 text-white shadow-sm'
                                          : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                                          }`}
                                      >
                                        Write
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                </form>
              </div>
            </div>
          </div>
        )
        }

        {/* Edit User Dialog */}
        {
          showEditDialog && selectedUser && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-md" onClick={() => setShowEditDialog(false)} />
              <div className="relative z-50 w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900">

                {/* Modern Gradient Header - Indigo Theme */}
                <div className="relative bg-gradient-to-br from-indigo-600 via-blue-600 to-indigo-700 px-8 py-6 text-white overflow-hidden">
                  <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48cGF0dGVybiBpZD0iZ3JpZCIgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cGF0aCBkPSJNIDQwIDAgTCAwIDAgMCA0MCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLW9wYWNpdHk9IjAuMSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-30"></div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowEditDialog(false);
                    }}
                    className="absolute right-6 top-6 z-10 rounded-xl p-2 text-white/80 transition-all hover:bg-white/10 hover:text-white"
                  >
                    <X className="h-5 w-5" />
                  </button>
                  <div className="relative flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm ring-2 ring-white/20">
                      <Edit className="h-7 w-7" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold">Edit User Account</h2>
                      <p className="text-sm text-indigo-100 font-medium">Update user information and permissions</p>
                    </div>
                  </div>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
                  <form onSubmit={handleUpdateUser} className="flex flex-col lg:flex-row h-full">

                    {/* LEFT COLUMN - Main Form Fields */}
                    <div className="flex-1 p-8 space-y-6 lg:border-r lg:border-slate-200 dark:lg:border-slate-800">
                      {/* Account Information Card */}
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                        <div className="mb-5 flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10">
                            <UserCircle className="h-5 w-5" />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Account Information</h3>
                            <p className="text-xs text-slate-500">User identity and role configuration</p>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="space-y-2">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                              Email Address
                            </label>
                            <div className="relative">
                              <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                              <input
                                type="email"
                                value={formData.email}
                                disabled
                                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 pl-11 text-sm font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800/50"
                              />
                              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                                <div className="rounded-lg bg-slate-200 px-2 py-1 text-xs font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-400">
                                  Read-only
                                </div>
                              </div>
                            </div>
                            <p className="text-xs text-slate-500">Email address cannot be changed</p>
                          </div>

                          <div className="space-y-2">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                              Display Name <span className="text-rose-500">*</span>
                            </label>
                            <div className="relative">
                              <UserCircle className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                              <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                required
                                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pl-11 text-sm font-medium text-slate-900 placeholder-slate-400 transition-all focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                              System Role <span className="text-rose-500">*</span>
                            </label>
                            <div className="relative">
                              <Shield className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                              <select
                                value={formData.role}
                                onChange={(e) => {
                                  const role = e.target.value;
                                  setFormData({
                                    ...formData,
                                    role,
                                    dataScope: ['hr', 'sub_admin', 'super_admin'].includes(role) ? 'all' : (role === 'hod' ? 'division' : 'department'),
                                    divisionMapping: []
                                  });
                                }}
                                disabled={selectedUser.role === 'super_admin'}
                                className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 py-3 pl-11 text-sm font-medium text-slate-900 transition-all focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {ROLES.filter((r) => !['super_admin', 'employee'].includes(r.value)).map((role) => (
                                  <option key={role.value} value={role.value}>
                                    {role.label}
                                  </option>
                                ))}
                                {selectedUser.role === 'super_admin' && (
                                  <option value="super_admin">Super Admin</option>
                                )}
                              </select>
                            </div>
                            {selectedUser.role === 'super_admin' && (
                              <p className="text-xs text-amber-600 dark:text-amber-500">Super Admin role cannot be changed</p>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Access Scoping Card */}
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                        <div className="mb-5 flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10">
                            <Building className="h-5 w-5" />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Access Scoping</h3>
                            <p className="text-xs text-slate-500">Define organizational access boundaries</p>
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/30">
                          <ScopingSelector data={formData} setData={setFormData} />
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-3 pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setShowEditDialog(false);
                            setSelectedUser(null);
                          }}
                          className="flex-1 rounded-xl border-2 border-slate-200 bg-white px-6 py-3.5 text-sm font-bold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={loading}
                          className="flex-1 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/30 transition-all hover:shadow-xl hover:shadow-indigo-500/40 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {loading ? 'Saving Changes...' : 'Save Changes'}
                        </button>
                      </div>
                    </div>

                    {/* RIGHT COLUMN - Feature Privileges */}
                    <div className="flex-1 p-8 space-y-6 bg-slate-50/50 dark:bg-slate-900/30">
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                        <div className="mb-5 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-500/10">
                              <Layers className="h-5 w-5" />
                            </div>
                            <div>
                              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Feature Privileges</h3>
                              <p className="text-xs text-slate-500">Grant read/write access to modules</p>
                            </div>
                          </div>

                          {/* Bulk Selection Buttons */}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const allModules = MODULE_CATEGORIES.flatMap(cat => cat.modules.map(m => m.code));
                                const readPermissions = allModules.map(code => `${code}:read`);
                                const existingWrite = (formData.featureControl || []).filter(fc => fc.endsWith(':write'));
                                setFormData({ ...formData, featureControl: [...readPermissions, ...existingWrite] });
                              }}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20 transition-colors"
                            >
                              Read All
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const allModules = MODULE_CATEGORIES.flatMap(cat => cat.modules.map(m => m.code));
                                const writePermissions = allModules.map(code => `${code}:write`);
                                const existingRead = (formData.featureControl || []).filter(fc => fc.endsWith(':read'));
                                setFormData({ ...formData, featureControl: [...existingRead, ...writePermissions] });
                              }}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20 transition-colors"
                            >
                              Write All
                            </button>
                          </div>
                        </div>

                        <div className="space-y-4">
                          {MODULE_CATEGORIES.map((category) => (
                            <div key={category.code} className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/30">
                              <div className="mb-3 flex items-center gap-2">
                                <span className="text-lg">{category.icon}</span>
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white">{category.name}</h4>
                              </div>
                              <div className="grid grid-cols-1 gap-2">
                                {category.modules.map((module) => {
                                  const hasRead = formData.featureControl?.includes(`${module.code}:read`) || false;
                                  const hasWrite = formData.featureControl?.includes(`${module.code}:write`) || false;
                                  const hasVerify = (module as any).verifiable ? (formData.featureControl?.includes(`${module.code}:verify`) || false) : false;

                                  const toggleRead = () => {
                                    const currentFeatures = formData.featureControl || [];
                                    const readPerm = `${module.code}:read`;
                                    const newFeatures = hasRead
                                      ? currentFeatures.filter(f => f !== readPerm)
                                      : [...currentFeatures, readPerm];
                                    setFormData({ ...formData, featureControl: newFeatures });
                                  };

                                  const toggleWrite = () => {
                                    const currentFeatures = formData.featureControl || [];
                                    const writePerm = `${module.code}:write`;
                                    const newFeatures = hasWrite
                                      ? currentFeatures.filter(f => f !== writePerm)
                                      : [...currentFeatures, writePerm];
                                    setFormData({ ...formData, featureControl: newFeatures });
                                  };

                                  const toggleVerify = () => {
                                    const currentFeatures = formData.featureControl || [];
                                    const verifyPerm = `${module.code}:verify`;
                                    const newFeatures = hasVerify
                                      ? currentFeatures.filter(f => f !== verifyPerm)
                                      : [...currentFeatures, verifyPerm];
                                    setFormData({ ...formData, featureControl: newFeatures });
                                  };

                                  return (
                                    <div
                                      key={module.code}
                                      className="flex items-center justify-between rounded-lg p-2 transition-colors hover:bg-white dark:hover:bg-slate-700/50"
                                    >
                                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{module.label}</span>
                                      <div className="flex gap-2">
                                        <button
                                          type="button"
                                          onClick={toggleRead}
                                          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${hasRead
                                            ? 'bg-blue-500 text-white shadow-sm'
                                            : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                                            }`}
                                        >
                                          Read
                                        </button>
                                        <button
                                          type="button"
                                          onClick={toggleWrite}
                                          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${hasWrite
                                            ? 'bg-emerald-500 text-white shadow-sm'
                                            : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                                            }`}
                                        >
                                          Write
                                        </button>
                                        {/* Verify Toggle — only for verifiable modules (e.g. EMPLOYEES) */}
                                        {(module as any).verifiable && (
                                          <button
                                            type="button"
                                            onClick={toggleVerify}
                                            title="Verify: grants access to the Applications tab and ability to verify applications. Independent of Read/Write."
                                            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${hasVerify
                                              ? 'bg-violet-500 text-white shadow-sm'
                                              : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                                              }`}
                                          >
                                            Verify
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                  </form>
                </div>
              </div>
            </div>
          )
        }

        {/* Password Reset Dialog */}
        {
          showPasswordDialog && selectedUser && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowPasswordDialog(false)} />
              <div className="relative z-50 flex w-full max-sm:max-w-full max-w-md max-h-[90vh] flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl dark:bg-slate-900">
                <div className="relative bg-gradient-to-r from-amber-500 to-orange-600 px-8 py-6 text-white text-center">
                  <button
                    onClick={() => setShowPasswordDialog(false)}
                    className="absolute right-4 top-4 rounded-xl p-2 text-white/60 hover:bg-white/10 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 mb-3">
                    <Key className="h-6 w-6" />
                  </div>
                  <h2 className="text-xl font-bold">Security Reset</h2>
                  <p className="text-amber-100 text-[10px] font-bold uppercase tracking-widest opacity-80">Credential Reconstruction</p>
                </div>

                <div className="flex-1 overflow-y-auto p-8 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
                  <div className="space-y-6">
                    <div className="flex items-center gap-2 p-1.5 bg-slate-100 dark:bg-slate-800/50 rounded-2xl">
                      <button
                        onClick={() => setResetPasswordState(prev => ({ ...prev, autoGenerate: true }))}
                        className={`flex-1 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${resetPasswordState.autoGenerate ? 'bg-white shadow-md text-amber-600 dark:bg-slate-700' : 'text-slate-400'}`}
                      >
                        Automated
                      </button>
                      <button
                        onClick={() => setResetPasswordState(prev => ({ ...prev, autoGenerate: false }))}
                        className={`flex-1 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${!resetPasswordState.autoGenerate ? 'bg-white shadow-md text-amber-600 dark:bg-slate-700' : 'text-slate-400'}`}
                      >
                        Manual
                      </button>
                    </div>

                    {!resetPasswordState.autoGenerate ? (
                      <div className="space-y-5 animate-in fade-in slide-in-from-top-4 duration-300">
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">New Password</label>
                          <div className="relative">
                            <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                              type={resetPasswordState.showNew ? "text" : "password"}
                              value={resetPasswordState.newPassword}
                              onChange={(e) => setResetPasswordState(prev => ({ ...prev, newPassword: e.target.value }))}
                              className="w-full rounded-2xl border border-slate-200 bg-white py-3.5 pl-11 pr-12 text-sm focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                              placeholder="Min. 8 characters"
                            />
                            <button
                              type="button"
                              onClick={() => setResetPasswordState(prev => ({ ...prev, showNew: !prev.showNew }))}
                              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-amber-500 transition-colors"
                            >
                              {resetPasswordState.showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>

                          {/* Enhanced Strength Meter */}
                          <div className="space-y-2 pt-2">
                            <div className="flex justify-between items-center px-1">
                              <span className="text-[10px] font-bold text-slate-400 uppercase">Security Score</span>
                              <span className={`text-[10px] font-black uppercase tracking-wider ${getPasswordStrength(resetPasswordState.newPassword).score >= 3 ? "text-emerald-500" :
                                getPasswordStrength(resetPasswordState.newPassword).score === 2 ? "text-amber-500" : "text-rose-500"
                                }`}>
                                {getPasswordStrength(resetPasswordState.newPassword).label}
                              </span>
                            </div>
                            <div className="flex gap-1.5 h-1.5 px-0.5">
                              {[1, 2, 3, 4].map((step) => (
                                <div
                                  key={step}
                                  className={`flex-1 rounded-full transition-all duration-700 ${getPasswordStrength(resetPasswordState.newPassword).score >= step
                                    ? getPasswordStrength(resetPasswordState.newPassword).color
                                    : 'bg-slate-100 dark:bg-slate-800'
                                    }`}
                                />
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Confirm Password</label>
                          <div className="relative">
                            <CheckCircle className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                              type={resetPasswordState.showConfirm ? "text" : "password"}
                              value={resetPasswordState.confirmPassword}
                              onChange={(e) => setResetPasswordState(prev => ({ ...prev, confirmPassword: e.target.value }))}
                              className={`w-full rounded-2xl border py-3.5 pl-11 pr-12 text-sm transition-all focus:ring-4 ${resetPasswordState.confirmPassword
                                ? (resetPasswordState.confirmPassword === resetPasswordState.newPassword
                                  ? 'border-emerald-500/50 bg-emerald-50/20 focus:ring-emerald-500/10 dark:border-emerald-500/30'
                                  : 'border-rose-500/50 bg-rose-50/20 focus:ring-rose-500/10 dark:border-rose-500/30')
                                : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 focus:border-amber-500 focus:ring-amber-500/10'
                                }`}
                              placeholder="••••••••••••"
                            />
                            <button
                              type="button"
                              onClick={() => setResetPasswordState(prev => ({ ...prev, showConfirm: !prev.showConfirm }))}
                              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-amber-500 transition-colors"
                            >
                              {resetPasswordState.showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-100 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/50">
                          {[
                            { label: '8+ chars', met: resetPasswordState.newPassword.length >= 8 },
                            { label: 'Uppercase', met: /[A-Z]/.test(resetPasswordState.newPassword) },
                            { label: 'Number', met: /[0-9]/.test(resetPasswordState.newPassword) },
                            { label: 'Symbol', met: /[^A-Za-z0-9]/.test(resetPasswordState.newPassword) }
                          ].map((c, i) => (
                            <div key={i} className={`flex items-center gap-2 text-[10px] font-bold uppercase ${c.met ? 'text-emerald-600' : 'text-slate-400'}`}>
                              {c.met ? <CheckCircle className="h-3 w-3" /> : <div className="h-3 w-3 rounded-full border-2 border-slate-200" />}
                              <span>{c.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="relative group overflow-hidden rounded-3xl border border-amber-100 bg-gradient-to-br from-amber-50 to-orange-50 p-8 text-center dark:border-amber-900/30 dark:from-amber-900/10 dark:to-orange-900/10 animate-in fade-in duration-300">
                        <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-amber-200/20 blur-2xl group-hover:bg-amber-300/30 transition-colors" />
                        <div className="relative z-10">
                          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-xl shadow-amber-500/10 dark:bg-slate-800">
                            <RefreshCw className="h-7 w-7 text-amber-500" />
                          </div>
                          <h3 className="text-lg font-bold text-amber-900 dark:text-amber-400">Smart Reset</h3>
                          <p className="mt-2 text-[11px] leading-relaxed text-amber-700/70 dark:text-amber-500/70">
                            System will generate a high-entropy 12-character password. Credentials will be securely delivered via encrypted channels.
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="flex gap-4">
                      <button
                        onClick={() => {
                          setShowPasswordDialog(false);
                          setSelectedUser(null);
                        }}
                        className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-xs font-bold uppercase tracking-widest text-slate-500 transition-all hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
                      >
                        Discard
                      </button>
                      <button
                        onClick={handleResetPassword}
                        disabled={!resetPasswordState.autoGenerate && (resetPasswordState.newPassword.length < 6 || resetPasswordState.newPassword !== resetPasswordState.confirmPassword)}
                        className="flex-1 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-3.5 text-xs font-bold uppercase tracking-widest text-white shadow-xl shadow-amber-500/30 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:grayscale disabled:pointer-events-none"
                      >
                        Process
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        }
        {/* Redesigned User Detail Dialog */}
        {
          showViewDialog && selectedViewUser && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6">
              <div
                className="fixed inset-0 bg-slate-900/60 backdrop-blur-xl transition-all duration-500 animate-in fade-in"
                onClick={() => setShowViewDialog(false)}
              />
              <div className="relative z-[70] flex h-full max-h-[850px] w-full max-w-6xl flex-col overflow-hidden rounded-[2.5rem] bg-white shadow-2xl transition-all dark:bg-slate-900 border border-white/20 dark:border-slate-800 animate-in fade-in zoom-in duration-300">

                {/* Premium Header - Reimagined */}
                <div className="relative border-b border-slate-100 bg-gradient-to-r from-slate-50/50 to-white px-8 py-8 dark:border-slate-800 dark:from-slate-900/50 dark:to-slate-900">
                  <div className="absolute right-0 top-0 h-64 w-64 translate-x-12 -translate-y-12 rounded-full bg-blue-500/10 blur-3xl" />

                  <div className="relative flex flex-col items-center justify-between gap-6 md:flex-row">
                    <div className="flex items-center gap-6">
                      <div className="relative group">
                        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 text-3xl font-black text-white shadow-xl dark:from-blue-600 dark:to-indigo-600 transition-transform group-hover:scale-105">
                          {selectedViewUser.name?.[0]?.toUpperCase() || '?'}
                        </div>
                        {selectedViewUser.isActive && (
                          <div className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full border-4 border-white bg-emerald-500 shadow-lg dark:border-slate-900">
                            <div className="absolute inset-0 animate-ping rounded-full bg-emerald-500 opacity-40" />
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-3">
                          <h2 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">
                            {selectedViewUser.name}
                          </h2>
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider ${getRoleColor(selectedViewUser.role)} border border-current/10 shadow-sm`}>
                            {getRoleLabel(selectedViewUser.role)}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-4 text-sm font-bold text-slate-500">
                          <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-blue-500" /> {selectedViewUser.email}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-slate-100/50 p-1.5 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-700/50">
                      <button
                        onClick={() => setActiveTab('overview')}
                        className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'overview' ? 'bg-white text-blue-600 shadow-lg dark:bg-slate-700 dark:text-blue-400' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}
                      >
                        <Layers className="h-4 w-4" />
                        Overview
                      </button>
                      <button
                        onClick={() => setActiveTab('permissions')}
                        className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'permissions' ? 'bg-white text-blue-600 shadow-lg dark:bg-slate-700 dark:text-blue-400' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}
                      >
                        <Lock className="h-4 w-4" />
                        Feature Access
                      </button>
                    </div>

                    <button
                      onClick={() => setShowViewDialog(false)}
                      className="absolute -right-4 -top-4 rounded-xl bg-slate-100 p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:bg-slate-800 dark:hover:bg-rose-900/40 transition-colors"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-hidden">
                  <div className="grid h-full grid-cols-1 lg:grid-cols-12">

                    {/* Sidebar - Profile Summary */}
                    <div className="lg:col-span-4 border-r border-slate-100 bg-slate-50/30 p-8 dark:border-slate-800 dark:bg-slate-950/20">
                      <div className="space-y-8">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-4">Metadata Bar</p>
                          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-500">Security Grade</span>
                                <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                                  <ShieldCheck className="h-3 w-3" /> A+
                                </span>
                              </div>
                              <div className="h-px bg-slate-100 dark:bg-slate-800" />
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-500">Visibility Scope</span>
                                <span className="text-xs font-black uppercase text-slate-700 dark:text-slate-300">
                                  {selectedViewUser.dataScope === 'all' ? 'Universal' : selectedViewUser.dataScope === 'own' ? 'Strict' : 'Regional'}
                                </span>
                              </div>
                              <div className="h-px bg-slate-100 dark:bg-slate-800" />
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-bold text-slate-500 flex items-center gap-2"><Clock className="h-3.5 w-3.5" /> Last Active</span>
                                <span className="font-black text-slate-700 dark:text-slate-300">Just Now</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div>
                          <div className="flex flex-col gap-3">
                            <button
                              onClick={() => {
                                setShowViewDialog(false);
                                openEditDialog(selectedViewUser);
                              }}
                              className="flex items-center justify-center gap-3 rounded-2xl bg-slate-900 px-6 py-4 text-xs font-black uppercase tracking-widest text-white shadow-xl shadow-slate-900/20 transition-all hover:bg-black hover:scale-[1.02] active:scale-[0.98] dark:bg-blue-600 dark:shadow-blue-500/20"
                            >
                              <Edit className="h-4 w-4" /> Edit Profile
                            </button>
                            <button
                              onClick={() => setShowViewDialog(false)}
                              className="rounded-2xl border border-slate-200 bg-white px-6 py-4 text-xs font-black uppercase tracking-widest text-slate-500 transition-all hover:bg-slate-50 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Main Content Area */}
                    <div className="lg:col-span-8 overflow-y-auto p-10 bg-white dark:bg-slate-900">
                      {activeTab === 'overview' ? (
                        <div className="animate-in slide-in-from-bottom-4 fade-in duration-500 space-y-10">
                          <section>
                            <div className="mb-6 flex items-center gap-3">
                              <Building className="h-5 w-5 text-blue-500" />
                              <h3 className="text-xl font-black tracking-tight text-slate-900 dark:text-white uppercase">Hierarchy Analysis</h3>
                            </div>

                            <div className="grid gap-6 sm:grid-cols-2">
                              {/* Group by Division Mapping */}
                              {selectedViewUser.divisionMapping && selectedViewUser.divisionMapping.length > 0 ? (
                                selectedViewUser.divisionMapping.map((map: any, idx: number) => {
                                  const divId = typeof map.division === 'string' ? map.division : map.division?._id;
                                  const div = divisions.find(d => d._id === divId) || map.division;
                                  const depts = (map.departments || []).map((d: any) => {
                                    const dId = typeof d === 'string' ? d : d?._id;
                                    return departments.find(dep => dep._id === dId) || d;
                                  });

                                  return (
                                    <div key={idx} className="group rounded-3xl border border-slate-100 bg-slate-50/50 p-6 transition-all hover:border-blue-500/20 hover:bg-white dark:border-slate-800 dark:bg-slate-900/50 shadow-sm hover:shadow-lg">
                                      <div className="mb-4 flex items-center justify-between">
                                        <div className="h-10 w-10 rounded-xl bg-white shadow-sm dark:bg-slate-800 flex items-center justify-center">
                                          <Globe className="h-5 w-5 text-blue-500" />
                                        </div>
                                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Division</span>
                                      </div>
                                      <h4 className="text-lg font-black text-slate-900 dark:text-white mb-4">
                                        {typeof div === 'string' ? div : div?.name || 'Assigned Division'}
                                      </h4>
                                      <div className="flex flex-wrap gap-2">
                                        {depts.length > 0 ? depts.map((dept: any, dIdx: number) => (
                                          <span key={dIdx} className="rounded-lg bg-white px-3 py-1.5 text-[10px] font-bold text-slate-600 border border-slate-100 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700">
                                            {typeof dept === 'string' ? dept : dept?.name || 'Department'}
                                          </span>
                                        )) : (
                                          <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Global Division Access</span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })
                              ) : (
                                <div className="col-span-full py-12 rounded-3xl border-2 border-dashed border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center text-center">
                                  <Info className="h-10 w-10 text-slate-200 mb-4" />
                                  <p className="text-sm font-bold text-slate-400 italic">No specific business unit mapping assigned.</p>
                                  <p className="text-xs text-slate-400 mt-1 uppercase tracking-widest font-black">Inheriting from Global Scope</p>
                                </div>
                              )}
                            </div>
                          </section>

                          <div className="rounded-3xl bg-blue-50/50 p-6 border border-blue-100/50 dark:bg-blue-900/10 dark:border-blue-800/50">
                            <div className="flex gap-4">
                              <ShieldCheck className="h-6 w-6 text-blue-500 shrink-0" />
                              <div>
                                <h4 className="text-sm font-black text-blue-900 dark:text-blue-400 uppercase tracking-widest">Access Policy Note</h4>
                                <p className="mt-1 text-xs leading-relaxed text-blue-700/70 dark:text-blue-500/70">
                                  This user follows the standard organizational data visibility policy. All access to business units and sensitive data points is logged according to the ISO 27001 security compliance standards.
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="animate-in slide-in-from-bottom-4 fade-in duration-500">
                          <div className="mb-6 flex items-center gap-3">
                            <Lock className="h-5 w-5 text-emerald-500" />
                            <h3 className="text-xl font-black tracking-tight text-slate-900 dark:text-white uppercase font-sans">Permission Matrix</h3>
                          </div>

                          {!selectedViewUser.featureControl || selectedViewUser.featureControl.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-center bg-slate-50/50 dark:bg-slate-900/50 rounded-3xl border-2 border-dashed border-slate-100 dark:border-slate-800">
                              <ShieldAlert className="h-16 w-16 text-slate-200 mb-6" />
                              <p className="text-sm font-black text-slate-500 uppercase tracking-widest">Standard Privileges</p>
                              <p className="mt-2 text-xs text-slate-400 font-medium max-w-xs">Using default hierarchical module access based on the {getRoleLabel(selectedViewUser.role)} role profile.</p>
                            </div>
                          ) : (
                            <div className="space-y-6">
                              {MODULE_CATEGORIES.map(category => {
                                const modulesWithPerms = category.modules.map(m => ({
                                  ...m,
                                  hasRead: selectedViewUser.featureControl?.includes(`${m.code}:read`) || false,
                                  hasWrite: selectedViewUser.featureControl?.includes(`${m.code}:write`) || false,
                                  hasVerify: (m as any).verifiable ? (selectedViewUser.featureControl?.includes(`${m.code}:verify`) || false) : false
                                })).filter(m => m.hasRead || m.hasWrite || m.hasVerify);

                                if (modulesWithPerms.length === 0) return null;

                                return (
                                  <div key={category.code} className="rounded-[2rem] border border-slate-100 bg-slate-50/50 p-6 dark:border-slate-800 dark:bg-slate-900/50">
                                    <div className="mb-4 flex items-center gap-3">
                                      <div className="h-8 w-8 rounded-lg bg-white shadow-sm dark:bg-slate-800 flex items-center justify-center text-lg">
                                        {category.icon}
                                      </div>
                                      <h4 className="text-sm font-black uppercase tracking-widest text-slate-900 dark:text-white">{category.name}</h4>
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                      {modulesWithPerms.map(m => (
                                        <div key={m.code} className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 shadow-sm transition-all hover:border-emerald-500/20">
                                          <span className="text-[11px] font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">{m.label}</span>
                                          <div className="flex gap-2">
                                            {m.hasRead && (
                                              <span className="flex items-center gap-1.5 rounded-lg bg-blue-50 px-2 py-1 text-[9px] font-black text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                                                <div className="h-1 w-1 rounded-full bg-blue-500" /> READ
                                              </span>
                                            )}
                                            {m.hasWrite && (
                                              <span className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2 py-1 text-[9px] font-black text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                                                <div className="h-1 w-1 rounded-full bg-emerald-500" /> WRITE
                                              </span>
                                            )}
                                            {(m as any).hasVerify && (
                                              <span className="flex items-center gap-1.5 rounded-lg bg-violet-50 px-2 py-1 text-[9px] font-black text-violet-600 dark:bg-violet-500/10 dark:text-violet-400">
                                                <div className="h-1 w-1 rounded-full bg-violet-500" /> VERIFY
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        }

        {/* Success Modal */}
        {
          showSuccessModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md" />
              <div className="relative z-[110] w-full max-w-md scale-in-center">
                <div className="overflow-hidden rounded-[2.5rem] bg-white shadow-[0_32px_64px_-16px_rgba(0,0,0,0.3)] dark:bg-slate-900">
                  <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-10 text-center text-white">
                    <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-[2rem] bg-white p-5 shadow-2xl">
                      <CheckCircle className="h-16 w-16 text-emerald-500" />
                    </div>
                    <h2 className="text-3xl font-black tracking-tight">Access Granted!</h2>
                    <p className="mt-2 text-emerald-100">The account has been successfully provisioned</p>
                  </div>

                  <div className="p-10">
                    <div className="space-y-6">
                      <div className="rounded-3xl border border-slate-100 bg-slate-50 p-6 dark:border-slate-800 dark:bg-slate-950">
                        <div className="mb-4 flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Security Credentials</span>
                          <ShieldCheck className="h-4 w-4 text-emerald-500" />
                        </div>
                        <div className="space-y-4">
                          <div className="flex justify-between items-center group cursor-pointer" onClick={() => {
                            if (typeof window !== 'undefined') {
                              navigator.clipboard.writeText(successModalData.username);
                            }
                          }}>
                            <span className="text-[10px] font-black uppercase text-slate-400">Login Identifier</span>
                            <span className="text-sm font-bold text-slate-700 dark:text-slate-200 group-hover:text-blue-500 transition-colors uppercase">{successModalData.username}</span>
                          </div>
                          <div className="h-px bg-slate-200/50 dark:bg-slate-800" />
                          <div className="flex justify-between items-center group cursor-pointer" onClick={() => {
                            if (typeof window !== 'undefined') {
                              navigator.clipboard.writeText(successModalData.password);
                            }
                          }}>
                            <span className="text-[10px] font-black uppercase text-slate-400">Temporary Access Key</span>
                            <code className="rounded-lg bg-emerald-100 px-3 py-1 text-sm font-black text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 group-hover:scale-105 transition-transform">{successModalData.password}</code>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 rounded-2xl bg-blue-50/50 p-4 border border-blue-100/50 dark:bg-blue-900/10 dark:border-blue-800/50">
                        <Info className="h-5 w-5 text-blue-500 mt-0.5" />
                        <p className="text-[11px] leading-relaxed text-blue-700/80 dark:text-blue-400/80">
                          These credentials have been dispatched to the user&apos;s primary contact endpoint. Please ensure they update their access key upon first authentication.
                        </p>
                      </div>

                      <button
                        onClick={() => setShowSuccessModal(false)}
                        className="w-full rounded-2xl bg-slate-900 py-4.5 text-sm font-black uppercase tracking-widest text-white shadow-xl shadow-slate-900/20 transition-all hover:bg-black active:scale-[0.98] dark:bg-emerald-600 dark:hover:bg-emerald-700"
                      >
                        Close & Dispatch
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        }
      </div>
    </div>
  );
}
