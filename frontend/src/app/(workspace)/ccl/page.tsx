'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useMemo } from 'react';
import { api } from '@/lib/api';
import { auth } from '@/lib/auth';
import Spinner from '@/components/Spinner';
import { useAuth } from '@/contexts/AuthContext';
import {
  Plus,
  Check,
  X,
  Calendar,
  Briefcase,
  Clock3,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Search,
  Filter,
  Eye,
  AlertCircle,
  Clock,
  ChevronRight,
  RotateCw
} from 'lucide-react';
import WorkflowTimeline from '@/components/WorkflowTimeline';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Swal from 'sweetalert2';

// Premium Stat Card
const StatCard = ({ title, value, icon: Icon, bgClass, iconClass, dekorClass, trend, loading }: { title: string, value: number | string, icon: any, bgClass: string, iconClass: string, dekorClass?: string, trend?: { value: string, positive: boolean }, loading?: boolean }) => (
  <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 transition-all hover:shadow-xl dark:border-slate-800 dark:bg-slate-900">
    <div className="flex items-center justify-between gap-3 sm:gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 truncate">{title}</p>
        <div className="mt-1 sm:mt-2 flex items-baseline gap-2">
          {loading ? (
            <div className="h-6 w-16 bg-slate-200 dark:bg-slate-700 rounded animate-pulse"></div>
          ) : (
            <h3 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">{value}</h3>
          )}
          {!loading && trend && (
            <span className={`text-[9px] sm:text-[10px] font-black px-1.5 py-0.5 rounded-md ${trend.positive ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'}`}>
              {trend.value}
            </span>
          )}
        </div>
      </div>
      <div className={`flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-2xl shrink-0 ${bgClass} ${iconClass}`}>
        <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
      </div>
    </div>
    {dekorClass && <div className={`absolute -right-4 -bottom-4 h-20 w-20 sm:h-24 sm:w-24 rounded-full ${dekorClass}`} />}
  </div>
);

const StatusBadge = ({ status }: { status: string }) => {
  const isApproved = status === 'approved';
  const isRejected = status === 'rejected';
  const isPending = !isApproved && !isRejected;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${isApproved ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
        isRejected ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
          'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
        }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${isApproved ? 'bg-emerald-500' : isRejected ? 'bg-red-500' : 'bg-amber-500'}`} />
      {status}
    </span>
  );
};

interface Employee {
  _id: string;
  emp_no: string;
  employee_name: string;
  department?: { _id: string; name: string };
}

interface User {
  _id: string;
  name: string;
  email: string;
  role: string;
}

interface CCLRequest {
  _id: string;
  employeeId: Employee;
  emp_no: string;
  date: string;
  isHalfDay: boolean;
  halfDayType?: 'first_half' | 'second_half' | null;
  inTime?: string | null;
  outTime?: string | null;
  totalHours?: number | null;
  attendanceNote?: string | null;
  assignedBy: User;
  purpose: string;
  status: string;
  appliedBy: { name: string; email: string };
  appliedAt: string;
  workflow?: {
    approvalChain: Array<{ stepOrder: number; role: string; label: string; status: string }>;
    nextApproverRole: string;
  };
}

const formatDate = (d: string) => {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatTime = (t: string | Date | null) => {
  if (!t) return '-';
  return new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
};

export default function CCLPage() {
  const { user } = useAuth();
  const currentUser = auth.getUser();

  const isManagement = currentUser && ['manager', 'hod', 'hr', 'super_admin', 'sub_admin'].includes(currentUser.role);

  const canApplyCCLForSelf = !!currentUser;
  const canApplyCCLForOthers = !!isManagement;

  const [activeTab, setActiveTab] = useState<'my' | 'pending'>('my');
  const [loading, setLoading] = useState(false);
  const [myCCLs, setMyCCLs] = useState<CCLRequest[]>([]);
  const [pendingCCLs, setPendingCCLs] = useState<CCLRequest[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedCCL, setSelectedCCL] = useState<CCLRequest | null>(null);

  const [actionModal, setActionModal] = useState<{ cclId: string; action: 'approve' | 'reject' } | null>(null);
  const [actionComment, setActionComment] = useState('');


  const [showFilters, setShowFilters] = useState(false);

  const [employees, setEmployees] = useState<{ _id: string; emp_no: string; employee_name: string }[]>([]);
  const [searchTerm, setSearchTerm] = useState(''); // Global search

  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    isHalfDay: false,
    halfDayType: null as 'first_half' | 'second_half' | null,
    assignedBy: '',
    purpose: '',
    empNo: '',
    employeeId: '',
  });

  const [cclFilters, setCclFilters] = useState({
    employeeNumber: '',
    status: '',
    startDate: '',
    endDate: ''
  });

  const [assignedByUsers, setAssignedByUsers] = useState<User[]>([]);
  const [dateValid, setDateValid] = useState<boolean | null>(null);
  const [dateValidationMessage, setDateValidationMessage] = useState<string>('');
  const [cclWorkflowAllowHigherAuthority, setCclWorkflowAllowHigherAuthority] = useState(false);
  const [cclWorkflowRoleOrder, setCclWorkflowRoleOrder] = useState<string[]>([]);

  const filterData = (data: CCLRequest[]) => {
    return data.filter(item => {
      // 1. Employee Number / Name Search
      const searchContent = cclFilters.employeeNumber.toLowerCase();
      const matchesSearch = !searchContent ||
        (item.employeeId?.employee_name?.toLowerCase().includes(searchContent)) ||
        (item.emp_no?.toLowerCase().includes(searchContent));

      // 2. Status Filter
      const matchesStatus = !cclFilters.status || item.status === cclFilters.status;

      // 3. Date Range Filter
      let matchesDate = true;
      if (cclFilters.startDate || cclFilters.endDate) {
        const itemDate = new Date(item.date).getTime();
        const start = cclFilters.startDate ? new Date(cclFilters.startDate).getTime() : 0;
        const end = cclFilters.endDate ? new Date(cclFilters.endDate).getTime() : Infinity;
        matchesDate = itemDate >= start && itemDate <= end;
      }

      return matchesSearch && matchesStatus && matchesDate;
    });
  };

  const filteredCCLs = useMemo(() => filterData(myCCLs), [myCCLs, cclFilters]);
  const filteredPendingCCLs = useMemo(() => filterData(pendingCCLs), [pendingCCLs, cclFilters]);

  const stats = useMemo(() => {
    const counts = {
      my: { approved: 0, pending: 0, rejected: 0 },
      pendingApproval: filteredPendingCCLs.length,
      total: { approved: 0, pending: 0, rejected: 0 }
    };

    filteredCCLs.forEach(ccl => {
      const status = ccl.status?.toLowerCase();
      if (status === 'approved') counts.my.approved++;
      else if (status === 'rejected') counts.my.rejected++;
      else counts.my.pending++;

      if (status === 'approved') counts.total.approved++;
      else if (status === 'rejected') counts.total.rejected++;
      else counts.total.pending++;
    });

    return counts;
  }, [filteredCCLs, filteredPendingCCLs]);

  const loadData = async () => {
    setLoading(true);
    try {
      const role = currentUser?.role;
      const isEmployee = role === 'employee';

      if (isEmployee) {
        const [myRes, pendingRes] = await Promise.all([
          api.getMyCCLs(),
          api.getPendingCCLApprovals(),
        ]);
        if (myRes.success) setMyCCLs(myRes.data || []);
        if (pendingRes.success) setPendingCCLs(pendingRes.data || []);
      } else {
        const [cclsRes, pendingRes] = await Promise.all([
          api.getCCLs({ limit: 500 }),
          api.getPendingCCLApprovals(),
        ]);
        if (cclsRes.success) setMyCCLs(cclsRes.data || []);
        if (pendingRes.success) setPendingCCLs(pendingRes.data || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const loadEmployees = async () => {
    try {
      if (!currentUser) return;

      if (currentUser.role === 'employee') {
        const identifier = (currentUser as any).emp_no || currentUser.employeeId;
        if (identifier) {
          const r = await api.getEmployee(identifier);
          if (r.success && r.data) setEmployees([r.data]);
          else setEmployees([]);
        } else setEmployees([]);
      } else {
        const query: any = { is_active: true };
        if (currentUser.role === 'hod') {
          const deptId = typeof currentUser.department === 'object' && currentUser.department ? (currentUser.department as any)._id : currentUser.department;
          if (deptId) query.department_id = deptId;
        }
        const r = await api.getEmployees(query);
        if (r.success && Array.isArray(r.data)) setEmployees(r.data || []);
        else setEmployees([]);
      }
    } catch (e) {
      console.error(e);
      setEmployees([]);
    }
  };

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (!currentUser || currentUser.role === 'employee') return;
    api.getLeaveSettings('ccl').then((res) => {
      if (res.success && res.data?.workflow) {
        const wf = res.data.workflow as { allowHigherAuthorityToApproveLowerLevels?: boolean; steps?: { stepOrder: number; approverRole: string }[] };
        setCclWorkflowAllowHigherAuthority(Boolean(wf.allowHigherAuthorityToApproveLowerLevels));
        const steps = wf.steps || [];
        const order = steps.slice().sort((a, b) => (a.stepOrder ?? 999) - (b.stepOrder ?? 999)).map(s => String(s.approverRole || '').toLowerCase()).filter(Boolean);
        setCclWorkflowRoleOrder(order);
      }
    }).catch(() => {});
  }, [currentUser]);

  useEffect(() => {
    if (currentUser && showForm) loadEmployees();
  }, [currentUser, showForm]);

  // Resolve employee: selected for on-behalf, or self
  const resolvedEmpNo = formData.empNo || (user as any)?.emp_no || (user as any)?.employeeId;
  const resolvedEmpId = formData.employeeId || (user as any)?.employeeRef;

  useEffect(() => {
    if (!showForm || (!resolvedEmpNo && !resolvedEmpId)) return;
    api.getCCLAssignedByUsers({ employeeId: resolvedEmpId || undefined, empNo: resolvedEmpNo || undefined }).then((r) => {
      if (r.success) setAssignedByUsers(r.data || []);
    });
  }, [showForm, resolvedEmpId, resolvedEmpNo]);

  useEffect(() => {
    if (!formData.date || (!resolvedEmpNo && !resolvedEmpId)) {
      setDateValid(null);
      setDateValidationMessage('');
      return;
    }
    api
      .validateCCLDate(formData.date, {
        employeeId: resolvedEmpId || undefined,
        empNo: resolvedEmpNo || undefined,
        isHalfDay: formData.isHalfDay,
        halfDayType: formData.halfDayType || undefined,
      })
      .then((r: any) => {
        setDateValid(r.valid);
        setDateValidationMessage(r.message || '');
      })
      .catch(() => { setDateValid(false); setDateValidationMessage('Validation failed'); });
  }, [formData.date, formData.isHalfDay, formData.halfDayType, resolvedEmpId, resolvedEmpNo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.assignedBy || !formData.purpose.trim()) return;
    if (dateValid === false) {
      alert(dateValidationMessage || 'Selected date is not valid. It must be a holiday/week-off and no existing CCL for that day.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.applyCCL({
        date: formData.date,
        isHalfDay: formData.isHalfDay,
        halfDayType: formData.isHalfDay ? formData.halfDayType || undefined : undefined,
        assignedBy: formData.assignedBy,
        purpose: formData.purpose.trim(),
        ...(formData.employeeId ? { employeeId: formData.employeeId } : formData.empNo ? { empNo: formData.empNo } : {}),
      });
      if (res.success) {
        setShowForm(false);
        setFormData({
          date: new Date().toISOString().split('T')[0],
          isHalfDay: false,
          halfDayType: null,
          assignedBy: '',
          purpose: '',
          empNo: '',
          employeeId: '',
        });
        loadData();
      } else {
        alert(res.error || 'Failed to submit');
      }
    } catch (err: any) {
      alert(err.message || 'Failed to submit');
    } finally {
      setLoading(false);
    }
  };

  const getRoleOrderFromCCL = (ccl: CCLRequest): string[] => {
    const chain = (ccl as any).workflow?.approvalChain;
    if (!chain || !Array.isArray(chain) || chain.length === 0) return [];
    const sorted = chain.slice().sort((a: any, b: any) => (a.stepOrder ?? 999) - (b.stepOrder ?? 999));
    return sorted.map((s: any) => String(s.role || s.stepRole || '').toLowerCase()).filter(Boolean);
  };

  const canPerformAction = (ccl: CCLRequest) => {
    const u = user as any;
    if (!u?.role) return false;
    const next = (ccl.workflow?.nextApproverRole || '').toLowerCase().trim();
    if (!next) return false;
    const userRole = String(u.role || '').toLowerCase().trim();
    if (next === userRole) return true;
    if (next === 'final_authority' && userRole === 'hr') return true;
    // Reporting manager step: allow if user is in workflow.reportingManagerIds (e.g. HR who is RM for this employee)
    if (next === 'reporting_manager') {
      if (['manager', 'hod'].includes(userRole)) return true;
      const reportingManagerIds = (ccl as any).workflow?.reportingManagerIds as string[] | undefined;
      const userId = String(u.id ?? u._id ?? '').trim();
      if (reportingManagerIds?.length && userId && reportingManagerIds.some((id: string) => String(id).trim() === userId)) return true;
    }
    // Allow higher authority to approve lower levels (from CCL workflow settings)
    if (cclWorkflowAllowHigherAuthority && cclWorkflowRoleOrder.length > 0) {
      const itemRoleOrder = getRoleOrderFromCCL(ccl);
      const roleOrder = itemRoleOrder.length > 0 ? itemRoleOrder : cclWorkflowRoleOrder;
      const nextIdx = roleOrder.indexOf(next);
      let userIdx = roleOrder.indexOf(userRole);
      if (userIdx === -1 && (userRole === 'hr' || userRole === 'super_admin')) userIdx = roleOrder.length;
      if (userIdx === -1 && userRole === 'manager') {
        const reportingIdx = roleOrder.indexOf('reporting_manager');
        const hrIdx = roleOrder.indexOf('hr');
        userIdx = reportingIdx >= 0 ? reportingIdx : (hrIdx >= 0 ? hrIdx : roleOrder.length);
      }
      if (nextIdx >= 0 && userIdx >= 0 && userIdx >= nextIdx) return true;
    }
    return false;
  };

  const openActionModal = (id: string, action: 'approve' | 'reject') => {
    setActionModal({ cclId: id, action });
    setActionComment('');
  };

  const handleActionSubmit = async () => {
    if (!actionModal) return;
    setLoading(true);
    try {
      const res = await api.processCCLAction(actionModal.cclId, actionModal.action, actionComment.trim() || undefined);
      if (res.success) {
        setActionModal(null);
        setActionComment('');
        setSelectedCCL(null);
        loadData();
      } else alert(res.error || 'Action failed');
    } catch (err: any) {
      alert(err.message || 'Action failed');
    } finally {
      setLoading(false);
    }
  };

  const list = activeTab === 'my' ? filteredCCLs : filteredPendingCCLs;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 pb-10 pt-1">
      {/* Sticky Header */}
      <div className="sticky px-2 top-4 z-40 md:px-4 mb-2 md:mb-8">
        <div className="max-w-[1920px] mx-auto md:bg-white/70 md:dark:bg-slate-900/70 md:backdrop-blur-2xl md:rounded-[2.5rem] md:border md:border-white/20 md:dark:border-slate-800 md:shadow-2xl md:shadow-slate-200/50 md:dark:shadow-none min-h-[4.5rem] flex flex-row items-center justify-between gap-4 px-0 sm:px-8 py-2 md:py-0">
          <div className="flex items-center gap-4">
            <div className="hidden md:flex h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 items-center justify-center text-white shadow-lg shadow-indigo-500/20">
              <Briefcase className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base md:text-xl font-black bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 uppercase tracking-tight whitespace-nowrap">
                Compensatory Leave
              </h1>
              <p className="hidden md:flex text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] items-center gap-2">
                Workspace <span className="h-1 w-1 rounded-full bg-slate-300"></span> Leave Management
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 w-auto overflow-x-auto hide-scrollbar">


            {(canApplyCCLForSelf || canApplyCCLForOthers) && (
              <button
                onClick={() => setShowForm(true)}
                className="group h-7 sm:h-11 p-1 sm:px-6 rounded-full sm:rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[9px] sm:text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-slate-900/10 dark:shadow-white/10 shrink-0"
              >
                <Plus className="w-5 h-5 sm:w-3.5 sm:h-3.5" />
                <span className="hidden sm:inline">Apply CCL</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-[1920px] mx-auto px-2 sm:px-6">
        {/* Toast Container */}
        <ToastContainer
          position="top-right"
          autoClose={3000}
          hideProgressBar={false}
          newestOnTop={false}
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
          theme="light"
        />

        {/* Stats Grid */}
        {/* Stats Grid - Desktop */}
        <div className="hidden md:grid mb-8 grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Approved CCLs"
            value={stats.my.approved}
            icon={CheckCircle2}
            bgClass="bg-emerald-500/10"
            iconClass="text-emerald-600 dark:text-emerald-400"
            dekorClass="bg-emerald-500/5"
            loading={loading}
          />
          <StatCard
            title="Pending My CCL"
            value={stats.my.pending}
            icon={Clock3}
            bgClass="bg-amber-500/10"
            iconClass="text-amber-600 dark:text-amber-400"
            dekorClass="bg-amber-500/5"
            loading={loading}
          />
          <StatCard
            title="Rejected CCLs"
            value={stats.my.rejected}
            icon={XCircle}
            bgClass="bg-rose-500/10"
            iconClass="text-rose-600 dark:text-rose-400"
            dekorClass="bg-rose-500/5"
            loading={loading}
          />
          <StatCard
            title="Pending Approvals"
            value={stats.pendingApproval}
            icon={ShieldCheck}
            bgClass="bg-indigo-500/10"
            iconClass="text-indigo-600 dark:text-indigo-400"
            dekorClass="bg-indigo-500/5"
            loading={loading}
          />
        </div>

        {/* Mobile Stats (Grouped) */}
        <div className="md:hidden grid grid-cols-1 gap-3 mb-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-10">
              <Calendar className="w-12 h-12 text-blue-500" />
            </div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">CCL Stats</h3>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                  <span className="text-xs text-slate-600 dark:text-slate-400">Approved</span>
                </div>
                <span className="text-sm font-bold text-slate-900 dark:text-white">{stats.my.approved}</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                  <span className="text-xs text-slate-600 dark:text-slate-400">Pending</span>
                </div>
                <span className="text-sm font-bold text-slate-900 dark:text-white">{stats.my.pending}</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-rose-500"></div>
                  <span className="text-xs text-slate-600 dark:text-slate-400">Rejected</span>
                </div>
                <span className="text-sm font-bold text-slate-900 dark:text-white">{stats.my.rejected}</span>
              </div>
            </div>
            {/* Pending Approvals Summary for Management */}
            {stats.pendingApproval > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                    <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">Approvals Pending</span>
                  </div>
                  <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{stats.pendingApproval}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Controls Section (Filters) */}
        <div className="mb-6 animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="md:p-5 md:rounded-[2.5rem] md:border md:border-white/20 md:dark:border-slate-800 md:bg-white/60 md:dark:bg-slate-900/60 md:backdrop-blur-xl md:shadow-xl md:shadow-slate-200/50 md:dark:shadow-none transition-all">
            <div className="flex flex-wrap items-center gap-2 md:gap-6">
              {/* Search & Toggle */}
              <div className="flex items-center gap-2 w-full md:w-auto md:flex-1">
                <div className="flex-1 min-w-[200px] relative group">
                  <div className="absolute inset-0 bg-blue-500/5 rounded-2xl blur-xl transition-opacity opacity-0 group-focus-within:opacity-100" />
                  <input
                    type="text"
                    placeholder="Search Employee..."
                    value={cclFilters.employeeNumber}
                    onChange={(e) => setCclFilters(prev => ({ ...prev, employeeNumber: e.target.value }))}
                    className="relative w-full h-10 md:h-11 pl-4 pr-12 rounded-xl md:rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs md:text-sm font-semibold focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all dark:text-white shadow-sm"
                  />
                  {/* Embedded Search Button */}
                  <button
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-blue-500 text-white shadow-lg shadow-blue-500/20 active:scale-95 transition-all"
                  >
                    <Search className="w-4 h-4" />
                  </button>
                </div>
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`md:hidden h-10 w-10 flex items-center justify-center rounded-xl border transition-all ${showFilters
                    ? 'bg-blue-500 border-blue-500 text-white'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                    }`}
                >
                  <Filter className="w-5 h-5" />
                </button>
              </div>

              <div className={`grid grid-cols-2 gap-2 w-full md:flex md:w-auto md:items-center md:gap-4 ${showFilters ? 'grid' : 'hidden md:flex'}`}>
                {/* Status Filter */}
                <div className="relative">
                  <Filter className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <select
                    value={cclFilters.status}
                    onChange={(e) => setCclFilters(prev => ({ ...prev, status: e.target.value }))}
                    className="h-10 pl-9 pr-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all appearance-none cursor-pointer w-full"
                  >
                    <option value="">All Status</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>

                {/* Date Range */}
                <div className="col-span-2 flex items-center flex-nowrap gap-2 px-0 py-0 bg-transparent border-0 md:px-3 md:py-1.5 md:rounded-xl md:bg-slate-100 md:dark:bg-slate-800 md:border md:border-slate-200 md:dark:border-slate-700">
                  <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <input
                    type="date"
                    value={cclFilters.startDate}
                    onChange={(e) => setCclFilters(prev => ({ ...prev, startDate: e.target.value }))}
                    className="bg-transparent text-xs font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer w-full sm:w-auto min-w-[100px]"
                  />
                  <span className="text-slate-300 dark:text-slate-600 font-bold shrink-0">→</span>
                  <input
                    type="date"
                    value={cclFilters.endDate}
                    onChange={(e) => setCclFilters(prev => ({ ...prev, endDate: e.target.value }))}
                    className="bg-transparent text-xs font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer w-full sm:w-auto min-w-[100px]"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="grid grid-cols-2 sm:inline-flex items-center p-1 rounded-xl bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 backdrop-blur-sm shadow-inner w-full sm:w-auto gap-1 sm:gap-0">
            {[
              { id: 'my', label: 'My CCL', icon: Calendar, count: myCCLs.length, activeColor: 'blue' },
              { id: 'pending', label: 'Pending Approvals', icon: Clock3, count: pendingCCLs.length, activeColor: 'orange' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`group relative flex items-center justify-center gap-2 px-2 sm:px-6 py-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all duration-300 whitespace-nowrap ${activeTab === tab.id
                  ? `bg-white dark:bg-slate-700 text-${tab.id === 'my' ? 'blue' : 'orange'}-600 dark:text-${tab.id === 'my' ? 'blue' : 'orange'}-400 shadow-sm ring-1 ring-slate-200/50 dark:ring-0`
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
              >
                <tab.icon className={`w-3.5 h-3.5 ${activeTab === tab.id ? `text-${tab.id === 'my' ? 'blue' : 'orange'}-600 dark:text-${tab.id === 'my' ? 'blue' : 'orange'}-400` : 'text-slate-400 group-hover:text-slate-600'}`} />
                <span>{tab.label}</span>
                {tab.count > 0 && (
                  <span className={`flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-md text-[10px] font-black ${activeTab === tab.id
                    ? `bg-${tab.id === 'my' ? 'blue' : 'orange'}-50 text-${tab.id === 'my' ? 'blue' : 'orange'}-600 dark:bg-${tab.id === 'my' ? 'blue' : 'orange'}-900/30 dark:text-${tab.id === 'my' ? 'blue' : 'orange'}-300`
                    : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                    }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Table Card */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 transition-all hover:shadow-md">
          <div className="hidden md:block overflow-x-auto scrollbar-hide">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
              <thead className="bg-slate-50/50 dark:bg-slate-800/50">
                <tr>
                  <th scope="col" className="py-4 pl-6 pr-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Employee</th>
                  <th scope="col" className="px-3 py-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Date</th>
                  <th scope="col" className="px-3 py-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Type</th>
                  <th scope="col" className="px-3 py-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Assigned By</th>
                  <th scope="col" className="px-3 py-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Purpose</th>
                  <th scope="col" className="px-3 py-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Status</th>
                  <th scope="col" className="relative py-4 pl-3 pr-6 text-right text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900/50">
                {loading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-xl bg-slate-200 dark:bg-slate-700" />
                          <div className="space-y-1.5">
                            <div className="h-3 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
                            <div className="h-2 w-16 bg-slate-200 dark:bg-slate-700 rounded" />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-4"><div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded" /></td>
                      <td className="px-3 py-4"><div className="h-5 w-20 bg-slate-200 dark:bg-slate-700 rounded" /></td>
                      <td className="px-3 py-4"><div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded" /></td>
                      <td className="px-3 py-4"><div className="h-4 w-40 bg-slate-200 dark:bg-slate-700 rounded" /></td>
                      <td className="px-3 py-4"><div className="h-5 w-24 bg-slate-200 dark:bg-slate-700 rounded-full" /></td>
                      <td className="px-3 py-4"><div className="h-8 w-8 bg-slate-200 dark:bg-slate-700 rounded ml-auto" /></td>
                    </tr>
                  ))
                ) : list.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-20 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <div className="h-12 w-12 rounded-2xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center">
                          <AlertCircle className="w-6 h-6 text-slate-300" />
                        </div>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">No CCL requests found</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  list.map((ccl) => (
                    <tr
                      key={ccl._id}
                      className="group cursor-pointer transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/30"
                      onClick={() => setSelectedCCL(ccl)}
                    >
                      <td className="whitespace-nowrap py-4 pl-6 pr-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 font-black text-xs">
                            {(ccl.employeeId?.employee_name || ccl.emp_no).charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-sm font-bold text-slate-900 dark:text-white transition-colors group-hover:text-indigo-600 dark:group-hover:text-indigo-400">{ccl.employeeId?.employee_name || ccl.emp_no}</div>
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{ccl.emp_no}</div>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{formatDate(ccl.date)}</span>
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Compensatory Day</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-widest ${ccl.isHalfDay ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'}`}>
                          {ccl.isHalfDay ? `Half (${ccl.halfDayType || '-'})` : 'Full Day'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4">
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                            <ShieldCheck className="w-3 h-3 text-slate-400" />
                          </div>
                          <span className="text-xs font-bold text-slate-600 dark:text-slate-400">{ccl.assignedBy?.name || '-'}</span>
                        </div>
                      </td>
                      <td className="px-3 py-4">
                        <p className="max-w-[200px] truncate text-xs font-medium text-slate-600 dark:text-slate-400">{ccl.purpose}</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4">
                        <StatusBadge status={ccl.status} />
                      </td>
                      <td className="whitespace-nowrap py-4 pl-3 pr-6 text-right">
                        <div className="flex justify-end gap-2">
                          {activeTab === 'pending' && canPerformAction(ccl) && (
                            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => openActionModal(ccl._id, 'approve')}
                                className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500 hover:text-white transition-all flex items-center justify-center"
                                title="Approve"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => openActionModal(ccl._id, 'reject')}
                                className="h-8 w-8 rounded-lg bg-rose-500/10 text-rose-600 hover:bg-rose-500 hover:text-white transition-all flex items-center justify-center"
                                title="Reject"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                          <button className="h-8 w-8 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 transition-all flex items-center justify-center">
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-4 p-4">
            {loading ? (
              [...Array(3)].map((_, i) => (
                <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm animate-pulse">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-700"></div>
                      <div className="space-y-2">
                        <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded"></div>
                        <div className="h-3 w-20 bg-slate-200 dark:bg-slate-700 rounded"></div>
                      </div>
                    </div>
                    <div className="h-6 w-20 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
                  </div>
                  <div className="h-16 bg-slate-50 dark:bg-slate-800 rounded-xl"></div>
                </div>
              ))
            ) : list.length === 0 ? (
              <div className="text-center py-10 text-slate-500 text-sm italic">
                No CCL requests found
              </div>
            ) : (
              list.map((ccl) => (
                <div
                  key={ccl._id}
                  onClick={() => setSelectedCCL(ccl)}
                  className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm active:scale-[0.98] transition-all"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-700 dark:text-indigo-400 font-bold text-xs shrink-0">
                        {(ccl.employeeId?.employee_name || ccl.emp_no).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                          {ccl.employeeId?.employee_name || ccl.emp_no}
                        </h4>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                          {ccl.emp_no}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={ccl.status} />
                  </div>

                  <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl mb-3">
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase font-bold text-slate-400">Duration</span>
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {ccl.isHalfDay ? `Half Day (${ccl.halfDayType === 'first_half' ? '1st' : '2nd'})` : 'Full Day'}
                      </span>
                    </div>
                    <div className="h-8 w-px bg-slate-200 dark:bg-slate-700"></div>
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] uppercase font-bold text-slate-400">Date</span>
                      <span className="font-semibold text-slate-900 dark:text-white text-right">
                        {formatDate(ccl.date)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Assigned by: <span className="font-semibold text-slate-700 dark:text-slate-300">{ccl.assignedBy?.name || '-'}</span></span>
                    </div>

                    {activeTab === 'pending' && canPerformAction(ccl) ? (
                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => openActionModal(ccl._id, 'approve')}
                          className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500 hover:text-white transition-all flex items-center justify-center"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => openActionModal(ccl._id, 'reject')}
                          className="h-8 w-8 rounded-lg bg-rose-500/10 text-rose-600 hover:bg-rose-500 hover:text-white transition-all flex items-center justify-center"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline">
                        View Details
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Apply Form Modal */}
      {
        showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setShowForm(false)} />
            <div className="relative z-50 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-white/20 dark:border-slate-800 shadow-2xl p-4 sm:p-8 animate-in zoom-in-95 duration-300">
              <div className="mb-4 sm:mb-8">
                <h2 className="text-lg sm:text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300">
                  Apply CCL
                </h2>
                <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm mt-1">Compensatory leave for holiday/week-off work.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                {canApplyCCLForOthers && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">Employee (on behalf)</label>
                    <select
                      value={formData.employeeId}
                      onChange={(e) => {
                        const val = e.target.value;
                        const emp = employees.find((x) => x._id === val);
                        setFormData((p) => ({ ...p, employeeId: val || '', empNo: emp?.emp_no || '' }));
                      }}
                      className="w-full h-11 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold transition-all focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="">Self</option>
                      {employees.map((emp) => (
                        <option key={emp._id} value={emp._id}>{emp.employee_name} ({emp.emp_no})</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">Date *</label>
                    <input
                      type="date"
                      value={formData.date}
                      onChange={(e) => setFormData((p) => ({ ...p, date: e.target.value }))}
                      className="w-full h-11 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold transition-all focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      required
                    />
                    {dateValid !== null && (
                      <p className={`text-[10px] font-bold ${dateValid ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {dateValidationMessage || (dateValid ? 'Valid holiday/week-off' : 'Not a valid date')}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">Assigned By *</label>
                    <select
                      value={formData.assignedBy}
                      onChange={(e) => setFormData((p) => ({ ...p, assignedBy: e.target.value }))}
                      className="w-full h-11 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold transition-all focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      required
                    >
                      <option value="">Select User</option>
                      {assignedByUsers.map((u) => (
                        <option key={u._id} value={u._id}>{u.name} ({u.role})</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">Work Duration</label>
                  <div className="inline-flex w-full p-1 rounded-2xl bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-700/50">
                    <button
                      type="button"
                      onClick={() => setFormData((p) => ({ ...p, isHalfDay: false, halfDayType: null }))}
                      className={`flex-1 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${!formData.isHalfDay
                        ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                        }`}
                    >
                      Full Day
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData((p) => ({ ...p, isHalfDay: true }))}
                      className={`flex-1 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${formData.isHalfDay
                        ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                        }`}
                    >
                      Half Day
                    </button>
                  </div>
                </div>

                {formData.isHalfDay && (
                  <div className="space-y-1.5 animate-in slide-in-from-top-2 duration-300">
                    <label className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">Half Selection</label>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        type="button"
                        onClick={() => setFormData((p) => ({ ...p, halfDayType: 'first_half' }))}
                        className={`h-11 rounded-xl border font-bold text-xs transition-all ${formData.halfDayType === 'first_half'
                          ? 'border-indigo-500 bg-indigo-50/50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400'
                          : 'border-slate-200 text-slate-500 dark:border-slate-700'
                          }`}
                      >
                        First Half
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData((p) => ({ ...p, halfDayType: 'second_half' }))}
                        className={`h-11 rounded-xl border font-bold text-xs transition-all ${formData.halfDayType === 'second_half'
                          ? 'border-indigo-500 bg-indigo-50/50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400'
                          : 'border-slate-200 text-slate-500 dark:border-slate-700'
                          }`}
                      >
                        Second Half
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">Purpose / Reason *</label>
                  <textarea
                    value={formData.purpose}
                    onChange={(e) => setFormData((p) => ({ ...p, purpose: e.target.value }))}
                    rows={3}
                    required
                    className="w-full rounded-xl border border-slate-200 bg-white p-4 text-xs font-medium transition-all focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    placeholder="Explain the reason for compensatory leave..."
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="flex-1 h-11 rounded-xl border border-slate-200 bg-white text-[10px] font-black uppercase tracking-widest text-slate-600 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 h-11 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[10px] font-black uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                  >
                    {loading ? 'Submitting...' : 'Apply Request'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )
      }

      {/* Detail Modal */}
      {
        selectedCCL && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setSelectedCCL(null)} />
            <div className="relative z-50 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-white/20 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
              {/* Header */}
              <div className="shrink-0 px-6 py-4 sm:px-8 sm:py-6 border-b border-white/10 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-md">
                      <Briefcase className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-base sm:text-lg font-black uppercase tracking-wider">CCL Detail</h2>
                      <p className="text-white/70 text-[10px] font-bold uppercase tracking-widest">Workspace Management</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedCCL(null)}
                    className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="p-6 sm:p-8 space-y-8">
                {/* Employee & Status */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-xl bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 flex items-center justify-center font-black text-lg">
                      {(selectedCCL.employeeId?.employee_name || selectedCCL.emp_no).charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 dark:text-white">{selectedCCL.employeeId?.employee_name || selectedCCL.emp_no}</h3>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{selectedCCL.emp_no}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <StatusBadge status={selectedCCL.status} />
                    <div className="flex items-center gap-1.5 text-slate-400 font-bold text-[10px] uppercase tracking-wider">
                      <Clock3 className="w-3.5 h-3.5" />
                      Applied {formatDate(selectedCCL.appliedAt)}
                    </div>
                  </div>
                </div>

                {/* Grid Info */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 flex items-center gap-2">
                        <Calendar className="w-3 h-3" /> Event Date
                      </span>
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{formatDate(selectedCCL.date)}</p>
                    </div>
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 flex items-center gap-2">
                        <Clock className="w-3 h-3" /> Type & Duration
                      </span>
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                        {selectedCCL.isHalfDay ? `Half Day (${selectedCCL.halfDayType || '-'})` : 'Full Day'}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 flex items-center gap-2">
                        <ShieldCheck className="w-3 h-3" /> Assigned By
                      </span>
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{selectedCCL.assignedBy?.name || '-'}</p>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 flex items-center gap-2">
                        <RotateCw className="w-3 h-3" /> Attendance Context
                      </span>
                      <div className="space-y-1 text-xs font-medium text-slate-600 dark:text-slate-400">
                        <p>In: {formatTime(selectedCCL.inTime || null)}</p>
                        <p>Out: {formatTime(selectedCCL.outTime || null)}</p>
                        <p>Duration: {selectedCCL.totalHours != null ? `${selectedCCL.totalHours}h` : '-'}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">Purpose / Detailed Reason</span>
                  <p className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/30 border border-slate-200/60 dark:border-slate-700/60 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    {selectedCCL.purpose}
                  </p>
                </div>

                {selectedCCL.attendanceNote && (
                  <div className="space-y-1.5 animate-pulse">
                    <span className="text-[10px] font-black uppercase tracking-[0.15em] text-amber-500 flex items-center gap-2">
                      <AlertCircle className="w-3 h-3" /> Attendance Note
                    </span>
                    <p className="p-3 rounded-lg bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200/50 dark:border-amber-700/50 text-[11px] font-medium text-amber-700 dark:text-amber-300 italic">
                      {selectedCCL.attendanceNote}
                    </p>
                  </div>
                )}
              </div>

              {selectedCCL.workflow?.approvalChain?.length ? (
                <div className="mt-4 shrink-0 px-6 sm:px-8 py-6 bg-slate-50/50 dark:bg-slate-800/20 border-t border-slate-200/60 dark:border-slate-700/60">
                  <div className="mb-4 text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">Approval Workflow</div>
                  <WorkflowTimeline workflow={selectedCCL.workflow as any} />
                </div>
              ) : null}

              {/* Sticky Footer */}
              <div className="shrink-0 p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex flex-col sm:flex-row gap-3 justify-end items-stretch sm:items-center">
                {activeTab === 'pending' && canPerformAction(selectedCCL) && (
                  <div className="flex gap-2 flex-1 sm:flex-none">
                    <button
                      onClick={() => { setSelectedCCL(null); openActionModal(selectedCCL._id, 'approve'); }}
                      className="flex-1 sm:flex-none h-10 px-6 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2"
                    >
                      <Check className="w-4 h-4" /> Approve
                    </button>
                    <button
                      onClick={() => { setSelectedCCL(null); openActionModal(selectedCCL._id, 'reject'); }}
                      className="flex-1 sm:flex-none h-10 px-6 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-lg shadow-rose-500/20 transition-all flex items-center justify-center gap-2"
                    >
                      <X className="w-4 h-4" /> Reject
                    </button>
                  </div>
                )}
                <button
                  onClick={() => setSelectedCCL(null)}
                  className="h-10 px-6 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Approve/Reject Comment Modal */}
      {
        actionModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-sm" onClick={() => setActionModal(null)}>
            <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700" onClick={(e) => e.stopPropagation()}>
              <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {actionModal.action === 'approve' ? 'Approve CCL' : 'Reject CCL'}
                </h3>
              </div>
              <div className="p-6">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {actionModal.action === 'approve' ? 'Comments (optional)' : 'Reason (optional)'}
                </label>
                <textarea
                  value={actionComment}
                  onChange={(e) => setActionComment(e.target.value)}
                  placeholder={actionModal.action === 'approve' ? 'Add a comment...' : 'Add a reason...'}
                  rows={3}
                  autoFocus
                  className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                />
                <div className="mt-5 flex justify-end gap-3">
                  <button onClick={() => setActionModal(null)} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600">
                    Cancel
                  </button>
                  <button
                    onClick={handleActionSubmit}
                    disabled={loading}
                    className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${actionModal.action === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'
                      }`}
                  >
                    {loading ? 'Processing...' : actionModal.action === 'approve' ? 'Approve' : 'Reject'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
}
