'use client';

import { useState, useEffect, useMemo } from 'react';
import { api } from '@/lib/api';
import { auth } from '@/lib/auth';
import { canViewResignation, canApplyResignation, canApproveResignation } from '@/lib/permissions';
import { toast, ToastContainer } from 'react-toastify';
import Swal from 'sweetalert2';
import 'react-toastify/dist/ReactToastify.css';

import {
  LogOut,
  Search,
  Eye,
  Check,
  X,
  Filter,
  CheckCircle2,
  XCircle,
  Clock,
  Clock3,
  ListTodo,
  Plus,
  Calendar,
} from 'lucide-react';

const StatCard = ({ title, value, icon: Icon, bgClass, iconClass, dekorClass, loading }: { title: string; value: number | string; icon: React.ComponentType<{ className?: string }>; bgClass: string; iconClass: string; dekorClass?: string; loading?: boolean }) => (
  <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 transition-all hover:shadow-xl dark:border-slate-800 dark:bg-slate-900">
    <div className="flex items-center justify-between gap-3 sm:gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 truncate">{title}</p>
        <div className="mt-1 sm:mt-2 flex items-baseline gap-2">
          {loading ? (
            <div className="h-6 w-16 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
          ) : (
            <h3 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">{value}</h3>
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

interface ResignationRequest {
  _id: string;
  employeeId?: {
    _id: string;
    employee_name?: string;
    first_name?: string;
    last_name?: string;
    emp_no: string;
    department_id?: { name: string };
    division_id?: { name: string };
  };
  emp_no: string;
  leftDate: string;
  remarks: string;
  status: string;
  requestedBy?: { _id: string; name: string; email?: string };
  createdAt: string;
  workflow?: {
    currentStepRole?: string;
    nextApproverRole?: string;
    isCompleted?: boolean;
    approvalChain?: Array<{
      stepOrder?: number;
      role?: string;
      label?: string;
      status?: string;
      actionByName?: string;
      actionByRole?: string;
      comments?: string;
      updatedAt?: string;
    }>;
    history?: Array<{
      step?: string;
      action?: string;
      actionByName?: string;
      actionByRole?: string;
      comments?: string;
      timestamp?: string;
    }>;
    reportingManagerIds?: string[];
  };
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'approved':
      return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    case 'pending':
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
    case 'rejected':
    case 'cancelled':
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400';
  }
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

/** Format date as YYYY-MM-DD in local time (avoids UTC shift that makes "today + 90" show as previous day) */
const toLocalDateString = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const getEmployeeName = (req: ResignationRequest) => {
  const emp = req.employeeId;
  if (!emp) return req.emp_no || '—';
  if (emp.employee_name) return emp.employee_name;
  if (emp.first_name && emp.last_name) return `${emp.first_name} ${emp.last_name}`;
  if (emp.first_name) return emp.first_name;
  return emp.emp_no || '—';
};

const getEmployeeInitials = (req: ResignationRequest) => {
  const name = getEmployeeName(req);
  const parts = name.trim().split(' ');
  if (parts.length >= 2) {
    return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
  }
  return (name[0] || 'E').toUpperCase();
};

const isEmployeeRole = (user: any) => String(user?.role || '').toLowerCase() === 'employee';

export default function ResignationsPage() {
  const [activeTab, setActiveTab] = useState<'all' | 'pending'>('all');
  const [allRequests, setAllRequests] = useState<ResignationRequest[]>([]);
  const [pendingRequests, setPendingRequests] = useState<ResignationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);

  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ResignationRequest | null>(null);
  const [actionComment, setActionComment] = useState('');

  const [showApplyModal, setShowApplyModal] = useState(false);
  const [applySelfOnly, setApplySelfOnly] = useState(false);
  const [applyEmployees, setApplyEmployees] = useState<{ emp_no: string; name: string }[]>([]);
  const [applySelectedEmpNo, setApplySelectedEmpNo] = useState('');
  const [applyRemarks, setApplyRemarks] = useState('');
  const [applyLastWorkingDate, setApplyLastWorkingDate] = useState('');
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyModalLoading, setApplyModalLoading] = useState(false);

  const [filters, setFilters] = useState({
    search: '',
    status: '',
  });

  useEffect(() => {
    const user = auth.getUser();
    if (user) setCurrentUser(user);
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const user = auth.getUser();
      const isEmployee = isEmployeeRole(user);
      const allRes = await api.getResignationRequests();
      if (allRes.success && allRes.data) setAllRequests(Array.isArray(allRes.data) ? allRes.data : []);
      else setAllRequests([]);
      if (!isEmployee) {
        const pendingRes = await api.getResignationPendingApprovals();
        if (pendingRes.success && pendingRes.data) setPendingRequests(Array.isArray(pendingRes.data) ? pendingRes.data : []);
        else setPendingRequests([]);
      } else {
        setPendingRequests([]);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load data';
      toast.error(message);
      setAllRequests([]);
      setPendingRequests([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openApplyModal = (selfOnly: boolean = false) => {
    setApplySelfOnly(!!selfOnly);
    const user = auth.getUser();
    const myEmpNo = user?.emp_no || (user as any)?.employeeId;
    if (selfOnly && myEmpNo) {
      setApplySelectedEmpNo(String(myEmpNo));
    } else {
      setApplySelectedEmpNo('');
    }
    setApplyRemarks('');
    setApplyLastWorkingDate('');
    setShowApplyModal(true);
  };

  useEffect(() => {
    if (!showApplyModal) return;
    let cancelled = false;
    const load = async () => {
      setApplyModalLoading(true);
      try {
        if (applySelfOnly) {
          const settingsRes = await api.getResignationSettings();
          if (cancelled) return;
          const raw = settingsRes?.data?.noticePeriodDays ?? settingsRes?.data?.value?.noticePeriodDays;
          const noticeDays = Math.max(0, Number(raw) || 0);
          const minDate = new Date();
          minDate.setDate(minDate.getDate() + noticeDays);
          minDate.setHours(0, 0, 0, 0);
          setApplyLastWorkingDate(toLocalDateString(minDate));
        } else {
          const [settingsRes, empRes] = await Promise.all([
            api.getResignationSettings(),
            api.getEmployees({ is_active: true, limit: 500, page: 1 }),
          ]);
          if (cancelled) return;
          const raw = settingsRes?.data?.noticePeriodDays ?? settingsRes?.data?.value?.noticePeriodDays;
          const noticeDays = Math.max(0, Number(raw) || 0);
          const minDate = new Date();
          minDate.setDate(minDate.getDate() + noticeDays);
          minDate.setHours(0, 0, 0, 0);
          setApplyLastWorkingDate(toLocalDateString(minDate));
          const list = empRes?.data?.employees ?? empRes?.data ?? [];
          const arr = Array.isArray(list) ? list : [];
          const options = arr
            .filter((e: any) => e.emp_no && !e.leftDate)
            .map((e: any) => ({
              emp_no: e.emp_no,
              name: e.employee_name || [e.first_name, e.last_name].filter(Boolean).join(' ') || e.emp_no,
            }));
          setApplyEmployees(options);
          if (options.length > 0 && !applySelectedEmpNo) setApplySelectedEmpNo(options[0].emp_no);
        }
      } catch (_) {
        if (!cancelled && !applySelfOnly) setApplyEmployees([]);
      } finally {
        if (!cancelled) setApplyModalLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [showApplyModal, applySelfOnly]);

  const handleSubmitResignation = async () => {
    if (!applySelectedEmpNo || !applyLastWorkingDate) {
      toast.error(applySelfOnly ? 'Last working date is required.' : 'Please select an employee and ensure last working date is set.');
      return;
    }
    setApplyLoading(true);
    try {
      const res = await api.createResignationRequest({
        emp_no: applySelectedEmpNo,
        leftDate: applyLastWorkingDate,
        remarks: applyRemarks.trim() || undefined,
      });
      if (res?.success) {
        Swal.fire({ icon: 'success', title: 'Submitted', text: 'Resignation request submitted successfully.', timer: 2000, showConfirmButton: false });
        setShowApplyModal(false);
        loadData();
      } else {
        Swal.fire({ icon: 'error', title: 'Failed', text: (res as any)?.message || 'Submit failed.' });
      }
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'Error', text: err?.message || 'Submit failed.' });
    } finally {
      setApplyLoading(false);
    }
  };

  const canPerformAction = (item: ResignationRequest) => {
    if (!currentUser) return false;
    if (item.status !== 'pending') return false;

    const role = (currentUser.role || '').toLowerCase();
    if (['super_admin', 'sub_admin'].includes(role)) return true;

    const nextRole = String(item.workflow?.nextApproverRole || '').toLowerCase().trim();
    if (!nextRole) return false;
    if (role === nextRole) return true;
    if (nextRole === 'final_authority' && role === 'hr') return true;
    if (nextRole === 'reporting_manager') {
      const reportingManagerIds = item.workflow?.reportingManagerIds as string[] | undefined;
      const userId = String((currentUser as any).id ?? (currentUser as any)._id ?? '').trim();
      if (reportingManagerIds?.length && userId && reportingManagerIds.some((id: string) => String(id).trim() === userId)) return true;
    }
    return false;
  };

  const handleDetailAction = async (action: 'approve' | 'reject') => {
    if (!selectedRequest) return;
    try {
      const response = await api.approveResignationRequest(selectedRequest._id, action, actionComment);
      if (response.success) {
        Swal.fire({
          icon: 'success',
          title: 'Done',
          text: action === 'approve' ? 'Resignation approved.' : 'Resignation rejected.',
          timer: 2000,
          showConfirmButton: false,
        });
        setShowDetailDialog(false);
        setSelectedRequest(null);
        setActionComment('');
        loadData();
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Failed',
          text: (response as any).message || (response as any).error || 'Action failed',
        });
      }
    } catch (err: any) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: err.message || 'Action failed',
      });
    }
  };

  const handleCardAction = async (id: string, action: 'approve' | 'reject') => {
    try {
      const response = await api.approveResignationRequest(id, action, '');
      if (response.success) {
        Swal.fire({
          icon: 'success',
          title: 'Done',
          text: action === 'approve' ? 'Resignation approved.' : 'Resignation rejected.',
          timer: 2000,
          showConfirmButton: false,
        });
        loadData();
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Failed',
          text: (response as any).message || (response as any).error || 'Action failed',
        });
      }
    } catch (err: any) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: err.message || 'Action failed',
      });
    }
  };

  const filteredAll = useMemo(() => {
    return allRequests.filter((r) => {
      const matchSearch =
        !filters.search ||
        getEmployeeName(r).toLowerCase().includes(filters.search.toLowerCase()) ||
        (r.emp_no || '').toLowerCase().includes(filters.search.toLowerCase());
      const matchStatus = !filters.status || r.status === filters.status;
      return matchSearch && matchStatus;
    });
  }, [allRequests, filters]);

  const stats = useMemo(
    () => ({
      total: allRequests.length,
      approved: allRequests.filter((r) => r.status === 'approved').length,
      pending: allRequests.filter((r) => r.status === 'pending').length,
      rejected: allRequests.filter((r) => ['rejected', 'cancelled'].includes(r.status)).length,
      pendingApprovals: pendingRequests.length,
    }),
    [allRequests, pendingRequests]
  );

  if (currentUser && !canViewResignation(currentUser as any)) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="text-center max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 shadow-lg">
          <LogOut className="w-12 h-12 mx-auto text-slate-400 dark:text-slate-500 mb-4" />
          <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Access restricted</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">You do not have permission to view the Resignations page. Contact your administrator if you need access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 pb-10 pt-1">
      <div className="sticky px-2 top-4 z-40 md:px-4 mb-2 md:mb-8">
        <div className="max-w-[1920px] mx-auto md:bg-white/70 md:dark:bg-slate-900/70 md:backdrop-blur-2xl md:rounded-[2.5rem] md:border md:border-white/20 md:dark:border-slate-800 md:shadow-2xl md:shadow-slate-200/50 md:dark:shadow-none min-h-[4.5rem] flex flex-row items-center justify-between gap-4 px-0 sm:px-8 py-2 md:py-0">
          <div className="flex items-center gap-4">
            <div className="hidden md:flex h-10 w-10 rounded-xl bg-gradient-to-br from-green-500 to-green-600 items-center justify-center text-white shadow-lg shadow-green-500/20">
              <LogOut className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base md:text-xl font-black bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 uppercase tracking-tight whitespace-nowrap">
                Resignations
              </h1>
              <p className="hidden md:flex text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] items-center gap-2">
                Workspace <span className="h-1 w-1 rounded-full bg-slate-300" /> Requested resignations & approvals
              </p>
            </div>
          </div>
          {canApplyResignation(currentUser as any) && (
            <button
              type="button"
              onClick={() => openApplyModal(isEmployeeRole(currentUser))}
              className="inline-flex items-center gap-2 rounded-xl bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 text-sm font-bold shadow-lg shadow-green-500/20 transition active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">{isEmployeeRole(currentUser) ? 'Submit resignation' : 'Apply for Resignation'}</span>
              <span className="sm:hidden">{isEmployeeRole(currentUser) ? 'Submit' : 'New'}</span>
            </button>
          )}
        </div>
      </div>

      <div className="max-w-[1920px] mx-auto px-2 sm:px-6">
        {!isEmployeeRole(currentUser) && (
          <>
        <div className="hidden md:grid mb-8 grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total" value={stats.total} icon={ListTodo} bgClass="bg-slate-500/10" iconClass="text-slate-600 dark:text-slate-400" dekorClass="bg-slate-500/5" loading={loading} />
          <StatCard title="Approved" value={stats.approved} icon={CheckCircle2} bgClass="bg-emerald-500/10" iconClass="text-emerald-600 dark:text-emerald-400" dekorClass="bg-emerald-500/5" loading={loading} />
          <StatCard title="Pending" value={stats.pending} icon={Clock3} bgClass="bg-amber-500/10" iconClass="text-amber-600 dark:text-amber-400" dekorClass="bg-amber-500/5" loading={loading} />
          <StatCard title="Pending approvals (you)" value={stats.pendingApprovals} icon={Clock} bgClass="bg-blue-500/10" iconClass="text-blue-600 dark:text-blue-400" dekorClass="bg-blue-500/5" loading={loading} />
        </div>

        <div className="md:hidden grid grid-cols-2 gap-3 mb-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-10">
              <LogOut className="w-12 h-12 text-green-500" />
            </div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Resignation Stats</h3>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-slate-500" />
                  <span className="text-xs text-slate-600 dark:text-slate-400">Total</span>
                </div>
                <span className="text-sm font-bold text-slate-900 dark:text-white">{loading ? '—' : stats.total}</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-xs text-slate-600 dark:text-slate-400">Approved</span>
                </div>
                <span className="text-sm font-bold text-slate-900 dark:text-white">{loading ? '—' : stats.approved}</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-xs text-slate-600 dark:text-slate-400">Pending</span>
                </div>
                <span className="text-sm font-bold text-slate-900 dark:text-white">{loading ? '—' : stats.pending}</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-rose-500" />
                  <span className="text-xs text-slate-600 dark:text-slate-400">Rejected</span>
                </div>
                <span className="text-sm font-bold text-slate-900 dark:text-white">{loading ? '—' : stats.rejected}</span>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-10">
              <Clock className="w-12 h-12 text-blue-500" />
            </div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Your approvals</h3>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="text-xs text-slate-600 dark:text-slate-400">Pending (you)</span>
                </div>
                <span className="text-sm font-bold text-slate-900 dark:text-white">{loading ? '—' : stats.pendingApprovals}</span>
              </div>
            </div>
          </div>
        </div>
          </>
        )}

        {!isEmployeeRole(currentUser) && (
        <div className="mb-6 animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="md:p-5 md:rounded-[2.5rem] md:border md:border-white/20 md:dark:border-slate-800 md:bg-white/60 md:dark:bg-slate-900/60 md:backdrop-blur-xl md:shadow-xl md:shadow-slate-200/50 md:dark:shadow-none transition-all">
            <div className="flex flex-wrap items-center gap-2 md:gap-6">
              <div className="flex items-center gap-2 w-full md:w-auto md:flex-1">
                <div className="flex-1 min-w-[200px] relative group">
                  <div className="absolute inset-0 bg-green-500/5 rounded-2xl blur-xl transition-opacity opacity-0 group-focus-within:opacity-100" />
                  <input
                    type="text"
                    placeholder="Search by name or emp no..."
                    value={filters.search}
                    onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                    className="relative w-full h-10 md:h-11 pl-4 pr-12 rounded-xl md:rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs md:text-sm font-semibold focus:ring-4 focus:ring-green-500/10 focus:border-green-500 outline-none transition-all dark:text-white shadow-sm"
                  />
                  <button type="button" className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-green-500 text-white shadow-lg shadow-green-500/20 active:scale-95 transition-all">
                    <Search className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex md:items-center md:gap-4 w-full md:w-auto">
                <div className="relative flex-1 md:flex-none">
                  <Filter className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <select
                    value={filters.status}
                    onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                    className="h-10 pl-9 pr-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 focus:ring-4 focus:ring-green-500/10 outline-none transition-all appearance-none cursor-pointer w-full"
                  >
                    <option value="">All Status</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="grid grid-cols-2 sm:inline-flex items-center p-1 rounded-xl bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 backdrop-blur-sm shadow-inner w-full sm:w-auto gap-1 sm:gap-0">
            {[
              { id: 'all' as const, label: 'All requests', icon: ListTodo, count: allRequests.length, activeColor: 'green' },
              { id: 'pending' as const, label: 'Pending', icon: Clock3, count: stats.pendingApprovals, activeColor: 'orange' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`group relative flex items-center justify-center gap-2 px-2 sm:px-6 py-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all duration-300 whitespace-nowrap ${activeTab === tab.id
                  ? 'bg-white dark:bg-slate-700 shadow-sm ring-1 ring-slate-200/50 dark:ring-0 ' + (tab.activeColor === 'green' ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400')
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
              >
                <tab.icon className={`w-3.5 h-3.5 ${activeTab === tab.id ? (tab.activeColor === 'green' ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400') : 'text-slate-400 group-hover:text-slate-600'}`} />
                <span>{tab.label}</span>
                {tab.count > 0 && (
                  <span className={`flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-md text-[10px] font-black ${activeTab === tab.id
                    ? (tab.activeColor === 'green' ? 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-300' : 'bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300')
                    : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                    }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'all' && (
          <div className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-40 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 animate-pulse" />
                ))}
              </div>
            ) : filteredAll.length === 0 ? (
              <div className="text-center py-10 text-slate-500 dark:text-slate-400 text-sm bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
                No resignation requests found.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredAll.map((req) => (
                  <div
                    key={req._id}
                    className="group relative flex flex-col rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-green-200/60 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="absolute top-0 left-0 w-1 h-full bg-green-500/80 rounded-l-2xl group-hover:w-1.5 transition-all" />
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-600 font-bold dark:bg-green-900/30 dark:text-green-400">
                          {getEmployeeInitials(req)}
                        </div>
                        <div>
                          <h4 className="font-semibold text-slate-900 dark:text-white line-clamp-1">{getEmployeeName(req)}</h4>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{req.emp_no}</p>
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${getStatusColor(req.status)}`}>
                        {req.status}
                      </span>
                    </div>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-500 dark:text-slate-400">Last working date</span>
                        <span className="font-medium text-slate-700 dark:text-slate-300">{formatDate(req.leftDate)}</span>
                      </div>
                      {req.remarks && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 pt-1 border-t border-slate-100 dark:border-slate-700">
                          {req.remarks}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedRequest(req);
                        setActionComment('');
                        setShowDetailDialog(true);
                      }}
                      className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" /> View details
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'pending' && (
          <div className="mt-4 p-4 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-56 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse" />
                ))}
              </div>
            ) : pendingRequests.length === 0 ? (
              <div className="text-center py-10 text-slate-500 dark:text-slate-400 text-sm bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
                No pending approvals for you.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {pendingRequests.map((req) => (
                  <div
                    key={req._id}
                    className="group relative flex flex-col justify-between rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-orange-200/60 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="absolute top-0 left-0 w-1 h-full bg-orange-500/80 rounded-l-2xl group-hover:w-1.5 transition-all" />
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-600 font-bold dark:bg-orange-900/30 dark:text-orange-400">
                          {getEmployeeInitials(req)}
                        </div>
                        <div>
                          <h4 className="font-semibold text-slate-900 dark:text-white line-clamp-1">{getEmployeeName(req)}</h4>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{req.emp_no}</p>
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusColor(req.status)}`}>Pending</span>
                    </div>
                    <div className="mb-4 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-500 dark:text-slate-400">Last working date</span>
                        <span className="font-medium text-slate-700 dark:text-slate-300">{formatDate(req.leftDate)}</span>
                      </div>
                      {req.remarks && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">"{req.remarks}"</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRequest(req);
                          setActionComment('');
                          setShowDetailDialog(true);
                        }}
                        className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <Eye className="w-3.5 h-3.5" /> View
                      </button>
                      {canPerformAction(req) && canApproveResignation(currentUser as any) && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleCardAction(req._id, 'approve')}
                            className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-green-500/10 py-2 text-sm font-semibold text-green-600 transition-colors hover:bg-green-500 hover:text-white dark:bg-green-500/20 dark:text-green-400 dark:hover:bg-green-500 dark:hover:text-white"
                          >
                            <Check className="w-4 h-4" /> Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCardAction(req._id, 'reject')}
                            className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-red-500/10 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-500 hover:text-white dark:bg-red-500/20 dark:text-red-400 dark:hover:bg-red-500 dark:hover:text-white"
                          >
                            <X className="w-4 h-4" /> Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showApplyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => !applyLoading && setShowApplyModal(false)} />
          <div className="relative z-50 w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <LogOut className="w-5 h-5 text-green-500" />
                {applySelfOnly ? 'Submit resignation' : 'Apply for Resignation'}
              </h2>
              <button type="button" onClick={() => !applyLoading && setShowApplyModal(false)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            {applyModalLoading ? (
              <div className="py-8 text-center text-slate-500">Loading...</div>
            ) : (
              <div className="space-y-4">
                {!applySelfOnly && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Employee</label>
                  <select
                    value={applySelectedEmpNo}
                    onChange={(e) => setApplySelectedEmpNo(e.target.value)}
                    className="w-full h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium text-slate-900 dark:text-white focus:ring-4 focus:ring-green-500/10 focus:border-green-500 outline-none"
                  >
                    <option value="">Select employee</option>
                    {applyEmployees.map((emp) => (
                      <option key={emp.emp_no} value={emp.emp_no}>{emp.name} ({emp.emp_no})</option>
                    ))}
                  </select>
                </div>
                )}
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Remarks for resignation</label>
                  <textarea
                    value={applyRemarks}
                    onChange={(e) => setApplyRemarks(e.target.value)}
                    placeholder="Optional remarks..."
                    rows={3}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium text-slate-900 dark:text-white focus:ring-4 focus:ring-green-500/10 focus:border-green-500 outline-none resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Last working date</label>
                  <div className="flex items-center gap-2 h-11 pl-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 text-sm font-medium">
                    <Calendar className="w-4 h-4 text-slate-400" />
                    <span>{applyLastWorkingDate ? new Date(applyLastWorkingDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-400">Auto-set from notice period; last day in office.</p>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => !applyLoading && setShowApplyModal(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                    Cancel
                  </button>
                  <button type="button" onClick={handleSubmitResignation} disabled={applyLoading || !applySelectedEmpNo || !applyLastWorkingDate} className="flex-1 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold text-sm shadow-lg shadow-green-500/20 flex items-center justify-center gap-2">
                    {applyLoading ? 'Submitting...' : (applySelfOnly ? 'Submit resignation' : 'Submit Resignation')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showDetailDialog && selectedRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => { setShowDetailDialog(false); setSelectedRequest(null); }} />
          <div className="relative z-50 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Resignation request</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Employee</span>
                <span className="font-medium text-slate-900 dark:text-white">{getEmployeeName(selectedRequest)} ({selectedRequest.emp_no})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Last working date</span>
                <span className="font-medium text-slate-900 dark:text-white">{formatDate(selectedRequest.leftDate)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Status</span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${getStatusColor(selectedRequest.status)}`}>{selectedRequest.status}</span>
              </div>
              {selectedRequest.remarks && (
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block mb-1">Remarks</span>
                  <p className="text-slate-700 dark:text-slate-300">{selectedRequest.remarks}</p>
                </div>
              )}
              {selectedRequest.requestedBy && (
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Requested by</span>
                  <span className="font-medium text-slate-900 dark:text-white">{selectedRequest.requestedBy.name}</span>
                </div>
              )}
            </div>

            {selectedRequest.workflow?.approvalChain && selectedRequest.workflow.approvalChain.length > 0 && (
              <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">Approval workflow</h3>
                <div className="space-y-2">
                  {selectedRequest.workflow.approvalChain.map((step, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs">
                      <span className="text-slate-700 dark:text-slate-300">{step.label || step.role}</span>
                      <span className={`rounded-full px-2 py-0.5 font-medium ${step.status === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : step.status === 'rejected' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                        {step.status || 'pending'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedRequest.status === 'pending' && canPerformAction(selectedRequest) && canApproveResignation(currentUser as any) && (
              <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700 flex flex-col gap-3">
                <textarea
                  value={actionComment}
                  onChange={(e) => setActionComment(e.target.value)}
                  placeholder="Add a comment (optional)..."
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm dark:bg-slate-800 dark:text-white resize-none"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleDetailAction('approve')}
                    className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-lg"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDetailAction('reject')}
                    className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-lg"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => { setShowDetailDialog(false); setSelectedRequest(null); }}
              className="mt-4 w-full py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </div>
      )}

      <ToastContainer position="top-right" autoClose={3000} hideProgressBar={false} newestOnTop={false} closeOnClick pauseOnFocusLoss draggable pauseOnHover theme="light" />
    </div>
  );
}
