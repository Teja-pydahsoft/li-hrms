'use client';

import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { toast, ToastContainer } from 'react-toastify';
import Swal from 'sweetalert2';
import 'react-toastify/dist/ReactToastify.css';
import { api, Department, Division, Designation } from '@/lib/api';
import ArrearsDetailDialog from '@/components/Arrears/ArrearsDetailDialog';
import ArrearsForm from '@/components/Arrears/ArrearsForm';
import Spinner from '@/components/Spinner';

import {
  Plus,
  Search,
  Eye,
  CheckCircle,
  Clock,
  TrendingUp,
  XCircle,
  AlertCircle,
  Filter,
  ArrowRight,
  IndianRupee,
  LayoutDashboard,
  Calendar,
  History,
  FileText,
  ShieldCheck,
  Users,
  Loader2
} from 'lucide-react';

// Custom Stat Card for Arrears
const StatCard = ({ title, value, icon: Icon, bgClass, iconClass, dekorClass, trend }: { title: string, value: number | string, icon: any, bgClass: string, iconClass: string, dekorClass: string, trend?: { value: string, positive: boolean } }) => (
  <div className="relative overflow-hidden rounded-3xl border border-slate-300 bg-slate-50/90 p-6 transition-all hover:shadow-xl dark:border-slate-800 dark:bg-slate-900 shadow-sm">
    <div className="relative z-10 flex items-center justify-between gap-4">
      <div className="flex-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">{title}</p>
        <div className="mt-2 flex items-baseline gap-2">
          <h3 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-white">{value}</h3>
          {trend && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${trend.positive ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-700 dark:text-rose-400'}`}>
              {trend.value}
            </span>
          )}
        </div>
      </div>
      <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${bgClass} ${iconClass} shadow-inner`}>
        <Icon className="h-7 w-7" />
      </div>
    </div>
    <div className={`absolute -right-4 -bottom-4 h-24 w-24 rounded-full opacity-30 ${dekorClass} blur-2xl`} />
  </div>
);

const getStatusColor = (status: string) => {
  switch (status) {
    case 'approved':
      return 'bg-emerald-100 border-emerald-300 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'pending_hod':
    case 'pending_hr':
    case 'pending_admin':
      return 'bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
    case 'rejected':
      return 'bg-rose-100 border-rose-300 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400';
    case 'partially_settled':
      return 'bg-blue-100 border-blue-300 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
    case 'settled':
      return 'bg-violet-100 border-violet-300 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400';
    default:
      return 'bg-slate-100 border-slate-300 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400';
  }
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'approved': return <CheckCircle className="h-3.5 w-3.5" />;
    case 'rejected': return <XCircle className="h-3.5 w-3.5" />;
    case 'settled': return <TrendingUp className="h-3.5 w-3.5" />;
    default: return <Clock className="h-3.5 w-3.5" />;
  }
};

const getStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    draft: 'Draft',
    pending_hod: 'Pending HOD',
    pending_hr: 'Pending HR',
    pending_admin: 'Pending Admin',
    approved: 'Approved',
    rejected: 'Rejected',
    partially_settled: 'Partially Settled',
    settled: 'Settled',
    cancelled: 'Cancelled'
  };
  return labels[status] || status;
};

interface Arrears {
  _id: string;
  type?: 'incremental' | 'direct';
  employee: { _id: string; emp_no: string; employee_name?: string; first_name?: string; last_name?: string; division_id?: string; department_id?: string; designation_id?: string; };
  startMonth?: string;
  endMonth?: string;
  totalAmount: number;
  remainingAmount: number;
  status: string;
  reason: string;
  createdAt: string;
}

interface BulkArrearRow {
  employee: any;
  amount: number;
  remarks: string;
}

export default function ArrearsPage() {
  const [arrears, setArrears] = useState<Arrears[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [selectedArrearsId, setSelectedArrearsId] = useState<string | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [employees, setEmployees] = useState([]);

  // Filter States
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [selectedDivisionFilter, setSelectedDivisionFilter] = useState('');
  const [selectedDepartmentFilter, setSelectedDepartmentFilter] = useState('');
  const [selectedDesignationFilter, setSelectedDesignationFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [bulkDivisionId, setBulkDivisionId] = useState('');
  const [bulkDepartmentId, setBulkDepartmentId] = useState('');
  const [bulkRows, setBulkRows] = useState<BulkArrearRow[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkSectionOpen, setBulkSectionOpen] = useState(false);

  // Derived state to get departments under the selected division
  const filteredDepartments = React.useMemo(() => {
    if (selectedDivisionFilter) {
      const divId = String(selectedDivisionFilter);
      const div = divisions.find((d) => String(d._id) === divId);
      const depts = (div?.departments ?? []) as (string | Department)[];
      return depts.map((d) => (typeof d === 'string' ? { _id: d, name: d } : { _id: (d as any)._id, name: (d as any).name, code: (d as any).code }));
    }
    return departments;
  }, [selectedDivisionFilter, divisions, departments]);

  useEffect(() => {
    loadData();
    loadEmployees();
    loadDivisions();
    loadDepartments();
    loadDesignations();
  }, []);

  const loadData = () => {
    setLoading(true);

    Promise.resolve(api.getArrears({ limit: 100 }))
      .then((response: any) => {
        if (response.success) {
          setArrears(response.data || []);
        } else {
          toast.error(response.message || 'Failed to load arrears');
        }
      })
      .catch((err: any) => {
        toast.error(err.message || 'Failed to load arrears');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const loadEmployees = () => {
    Promise.resolve(api.getEmployees({ is_active: true }))
      .then((response: any) => {
        if (response.success) {
          setEmployees(response.data || []);
        }
      })
      .catch((err: any) => {
        console.error('Failed to load employees:', err);
      });
  };

  const loadDivisions = async () => {
    try {
      const response = await api.getDivisions();
      if (response.success && response.data) {
        setDivisions(response.data);
      }
    } catch (err) {
      console.error('Error loading divisions:', err);
    }
  };

  const loadDepartments = async () => {
    try {
      const response = await api.getDepartments();
      if (response.success && response.data) {
        setDepartments(response.data);
      }
    } catch (err) {
      console.error('Error loading departments:', err);
    }
  };

  const loadDesignations = async () => {
    try {
      const response = await api.getAllDesignations();
      if (response.success && response.data) {
        setDesignations(response.data);
      }
    } catch (err) {
      console.error('Error loading designations:', err);
    }
  };

  const handleViewDetails = (id: string) => {
    setSelectedArrearsId(id);
    setDetailDialogOpen(true);
  };

  const handleCreateArrears = async (data: any) => {
    try {
      const response = await api.createArrears(data);
      if (response.success) {
        toast.success('Arrears created successfully');
        setFormOpen(false);
        loadData();
      } else {
        toast.error(response.message || 'Failed to create arrears');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to create arrears');
    }
  };

  const filteredArrears = arrears.filter(ar => {
    // Search Term Match
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      const empName = getEmployeeName(ar.employee).toLowerCase();
      const empNo = ar.employee.emp_no?.toLowerCase() || '';
      if (!empName.includes(searchLower) && !empNo.includes(searchLower)) {
        return false;
      }
    }

    // Role Filters Match
    if (selectedDivisionFilter && String(ar.employee.division_id) !== String(selectedDivisionFilter)) return false;
    if (selectedDepartmentFilter && String(ar.employee.department_id) !== String(selectedDepartmentFilter)) return false;
    if (selectedDesignationFilter && String(ar.employee.designation_id) !== String(selectedDesignationFilter)) return false;

    // Tab Match
    if (activeTab === 'pending') {
      return ['pending_hod', 'pending_hr', 'pending_admin'].includes(ar.status);
    }
    if (activeTab === 'all') return true;
    return ar.status === activeTab;
  });

  const stats = {
    pending: arrears.filter(ar => ['pending_hod', 'pending_hr', 'pending_admin'].includes(ar.status)).length,
    approved: arrears.filter(ar => ar.status === 'approved').length,
    settled: arrears.filter(ar => ar.status === 'settled').length,
    rejected: arrears.filter(ar => ar.status === 'rejected').length
  };

  const getEmployeeName = (emp: any) => {
    if (emp.employee_name) return emp.employee_name;
    if (emp.first_name && emp.last_name) return `${emp.first_name} ${emp.last_name}`;
    if (emp.first_name) return emp.first_name;
    return emp.emp_no;
  };

  const filteredBulkDepartments = React.useMemo(() => {
    if (!bulkDivisionId) return departments;
    const div = divisions.find((d) => String(d._id) === String(bulkDivisionId));
    const deptIds = ((div?.departments ?? []) as any[]).map((d: any) => (typeof d === 'string' ? d : d?._id));
    if (!deptIds.length) return departments;
    return departments.filter((d: any) => deptIds.includes(String(d._id)));
  }, [bulkDivisionId, divisions, departments]);

  const loadBulkEmployees = async () => {
    setBulkLoading(true);
    try {
      const filters: any = { is_active: true, limit: 500 };
      if (bulkDivisionId) filters.division_id = bulkDivisionId;
      if (bulkDepartmentId) filters.department_id = bulkDepartmentId;
      const r: any = await api.getEmployees(filters);
      const list = (r?.data ?? r) || [];
      const rows: BulkArrearRow[] = list.map((emp: any) => ({
        employee: emp,
        amount: 0,
        remarks: '',
      }));
      setBulkRows(rows);
      toast.info(rows.length ? `Loaded ${rows.length} employees` : 'No employees match filters');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load employees');
    } finally {
      setBulkLoading(false);
    }
  };

  const updateBulkRow = (index: number, field: 'amount' | 'remarks', value: number | string) => {
    setBulkRows((prev) => {
      const next = [...prev];
      if (next[index]) next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleBulkSave = async () => {
    const toCreate = bulkRows.filter((r) => Number(r.amount) > 0);
    if (toCreate.length === 0) {
      toast.warn('Enter amount > 0 for at least one employee');
      return;
    }
    setBulkSaving(true);
    try {
      const settled = await Promise.allSettled(
        toCreate.map((r) =>
          api.createArrears({
            type: 'direct',
            employee: r.employee._id,
            totalAmount: Number(r.amount),
            reason: (r.remarks || 'Bulk arrear').trim(),
          })
        )
      );
      const success = settled.filter((x) => x.status === 'fulfilled').length;
      const failed = settled.length - success;
      if (success > 0) {
        toast.success(`${success} arrears request(s) created`);
        loadData();
        setBulkRows((prev) =>
          prev.map((r) => (Number(r.amount) > 0 ? { ...r, amount: 0, remarks: '' } : r))
        );
      }
      if (failed > 0) {
        toast.error(`${failed} request(s) failed`);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Bulk create failed');
    } finally {
      setBulkSaving(false);
    }
  };

  return (
    <div className=" md:p-8">
      <ToastContainer
        position="top-right"
        autoClose={3000}
        toastClassName="rounded-2xl border-none shadow-2xl dark:bg-slate-900 dark:text-white"
      />

      {/* Refined Professional Header */}
      <div className="relative mb-10 overflow-hidden rounded-[2rem] border border-slate-300 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50 shadow-sm">
        <div className="absolute right-0 top-0 h-48 w-48 -translate-y-12 translate-x-12 rounded-full bg-blue-500/[0.05] blur-3xl" />

        <div className="relative z-10 flex flex-col gap-6 px-8 py-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-5">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100/50 text-blue-700 shadow-sm dark:bg-white/10 dark:text-blue-400 border border-blue-200">
                <History className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">Arrears</h1>
                  <span className="rounded-full bg-blue-600/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-400 border border-blue-200/50">
                    System Hub
                  </span>
                </div>
                <p className="text-sm font-medium text-slate-600">Payroll Calculation & Arrearage Protocols</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={() => setFormOpen(true)}
                className="group relative flex items-center justify-center gap-3 overflow-hidden rounded-xl bg-slate-950 px-6 py-3 text-xs font-bold uppercase tracking-widest text-white transition-all hover:bg-blue-700 active:scale-[0.98] dark:bg-white dark:text-slate-900 shadow-lg"
              >
                <Plus className="h-4 w-4" />
                <span>Provision Arrear</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Premium Statistics Cards */}
      <div className="mb-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Pending Review"
          value={stats.pending}
          icon={Clock}
          bgClass="bg-amber-500/10"
          iconClass="text-amber-700 dark:text-amber-400"
          dekorClass="bg-amber-500/10"
        />
        <StatCard
          title="Approved Arrears"
          value={stats.approved}
          icon={CheckCircle}
          bgClass="bg-emerald-500/10"
          iconClass="text-emerald-700 dark:text-emerald-400"
          dekorClass="bg-emerald-500/10"
          trend={{ value: "+8%", positive: true }}
        />
        <StatCard
          title="Total Settled"
          value={stats.settled}
          icon={TrendingUp}
          bgClass="bg-violet-500/10"
          iconClass="text-violet-700 dark:text-violet-400"
          dekorClass="bg-violet-500/10"
        />
        <StatCard
          title="Rejected / Void"
          value={stats.rejected}
          icon={XCircle}
          bgClass="bg-rose-500/10"
          iconClass="text-rose-700 dark:text-rose-400"
          dekorClass="bg-rose-500/10"
        />
      </div>

      {/* Bulk create section */}
      <div className="mb-10 rounded-2xl border border-slate-300 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50 overflow-hidden">
        <button
          type="button"
          onClick={() => setBulkSectionOpen((o) => !o)}
          className="flex w-full items-center justify-between p-6 text-left"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-200 dark:bg-slate-700">
              <Users className="h-5 w-5 text-slate-700 dark:text-slate-300" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-950 dark:text-white">Bulk create arrears</h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">Filter employees, enter amount and remarks, then create one direct arrears request per row (amount &gt; 0)</p>
            </div>
          </div>
          <span className="text-slate-500">{bulkSectionOpen ? '▼' : '▶'}</span>
        </button>
        {bulkSectionOpen && (
          <div className="border-t border-slate-200 dark:border-slate-700 p-6 space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Division</label>
                <select
                  value={bulkDivisionId}
                  onChange={(e) => { setBulkDivisionId(e.target.value); setBulkDepartmentId(''); }}
                  className="rounded-lg border border-slate-300 bg-white dark:bg-slate-800 dark:border-slate-600 dark:text-white px-3 py-2 text-sm min-w-[180px]"
                >
                  <option value="">All divisions</option>
                  {divisions.map((d: any) => (
                    <option key={d._id} value={d._id}>{d.name || d.code || d._id}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Department</label>
                <select
                  value={bulkDepartmentId}
                  onChange={(e) => setBulkDepartmentId(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white dark:bg-slate-800 dark:border-slate-600 dark:text-white px-3 py-2 text-sm min-w-[180px]"
                >
                  <option value="">All departments</option>
                  {filteredBulkDepartments.map((d: any) => (
                    <option key={d._id} value={d._id}>{d.name || d.code || d._id}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={loadBulkEmployees}
                disabled={bulkLoading}
                className="rounded-xl bg-slate-800 dark:bg-slate-700 text-white px-4 py-2 text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              >
                {bulkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                Load employees
              </button>
            </div>
            {bulkRows.length > 0 && (
              <>
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800/50 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                        <th className="px-4 py-3 text-left">Employee</th>
                        <th className="px-4 py-3 text-left">Code / Dept</th>
                        <th className="px-4 py-3 text-right w-32">Amount (₹)</th>
                        <th className="px-4 py-3 text-left min-w-[200px]">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {bulkRows.map((row, idx) => (
                        <tr key={row.employee._id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                          <td className="px-4 py-2 font-medium text-slate-950 dark:text-white">
                            {row.employee.employee_name || [row.employee.first_name, row.employee.last_name].filter(Boolean).join(' ') || row.employee.emp_no || '—'}
                          </td>
                          <td className="px-4 py-2 text-slate-600 dark:text-slate-400">
                            {row.employee.emp_no || '—'}
                            {(row.employee.department_id as any)?.name && ` / ${(row.employee.department_id as any).name}`}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              value={row.amount === 0 ? '' : row.amount}
                              onChange={(e) => updateBulkRow(idx, 'amount', e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)}
                              className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-white px-2 py-1.5 text-right"
                              placeholder="0"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <input
                              type="text"
                              value={row.remarks}
                              onChange={(e) => updateBulkRow(idx, 'remarks', e.target.value)}
                              className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-white px-2 py-1.5"
                              placeholder="Remarks"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {bulkRows.filter((r) => Number(r.amount) > 0).length} row(s) with amount &gt; 0 will create arrears requests
                  </p>
                  <button
                    type="button"
                    onClick={handleBulkSave}
                    disabled={bulkSaving || bulkRows.every((r) => Number(r.amount) <= 0)}
                    className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 text-sm font-bold uppercase flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {bulkSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Save (create requests)
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="rounded-[2.5rem] border border-slate-300 bg-slate-50 shadow-xl dark:border-slate-800 dark:bg-slate-900/50 overflow-hidden">
        {/* Navigation & Search Bar */}
        <div className="border-b border-slate-200 bg-slate-100/50 p-6 dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-1.5 rounded-2xl bg-slate-200/80 p-1.5 dark:bg-slate-800/50 backdrop-blur-sm shadow-inner overflow-x-auto">
              {['all', 'pending', 'approved', 'settled', 'rejected'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-xl px-5 py-2.5 text-xs font-bold uppercase tracking-widest transition-all duration-300 ${activeTab === tab
                    ? 'bg-white text-slate-950 shadow-md dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white'
                    }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-4 items-center">
              {/* Division Filter */}
              <select
                value={selectedDivisionFilter}
                onChange={(e) => {
                  setSelectedDivisionFilter(e.target.value);
                  setSelectedDepartmentFilter(''); // Reset department when division changes
                }}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                <option value="">All Divisions</option>
                {divisions.map((div) => (
                  <option key={div._id} value={div._id}>
                    {div.name}
                  </option>
                ))}
              </select>

              {/* Department Filter */}
              <select
                value={selectedDepartmentFilter}
                onChange={(e) => setSelectedDepartmentFilter(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                <option value="">All Departments</option>
                {filteredDepartments.map((dept) => (
                  <option key={(dept as any)._id} value={(dept as any)._id}>
                    {(dept as any).name}
                  </option>
                ))}
              </select>

              {/* Designation Filter */}
              <select
                value={selectedDesignationFilter}
                onChange={(e) => setSelectedDesignationFilter(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                <option value="">All Designations</option>
                {designations.map((desig) => (
                  <option key={desig._id} value={desig._id}>
                    {desig.name}
                  </option>
                ))}
              </select>

              <div className="relative group min-w-[280px]">
                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600 transition-colors group-hover:text-blue-600" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by employee or ID..."
                  className="w-full rounded-2xl border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm font-semibold text-slate-950 transition-all focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex h-96 flex-col items-center justify-center gap-4">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600 dark:border-slate-800 dark:border-t-blue-400" />
              <p className="text-xs font-bold uppercase tracking-widest text-slate-600">Synchronizing Data...</p>
            </div>
          ) : filteredArrears.length === 0 ? (
            <div className="flex h-96 flex-col items-center justify-center text-center">
              <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-slate-100 dark:bg-slate-800 border border-slate-200">
                <AlertCircle className="h-10 w-10 text-slate-500" />
              </div>
              <h3 className="text-xl font-bold text-slate-950 dark:text-white">No Records Found</h3>
              <p className="mt-2 text-sm font-semibold text-slate-600">There are no arrears matching the selected filter criteria.</p>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-100 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-700 dark:bg-slate-900/50 border-b border-slate-200">
                  <th className="px-8 py-6 text-left">Employee Entity</th>
                  <th className="px-8 py-6 text-left">Fiscal Period</th>
                  <th className="px-8 py-6 text-right">Agreed Value</th>
                  <th className="px-8 py-6 text-right">Outstanding</th>
                  <th className="px-8 py-6 text-left">Processing State</th>
                  <th className="px-8 py-6 text-center">Operations</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredArrears.map((ar) => (
                  <tr
                    key={ar._id}
                    className="group transition-colors hover:bg-slate-100/60 dark:hover:bg-slate-800/50"
                  >
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 font-bold text-white shadow-lg transition-transform group-hover:scale-110">
                          {getEmployeeName(ar.employee).charAt(0).toUpperCase()}
                          <div className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-white bg-emerald-500 dark:border-slate-900" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-950 dark:text-white">{getEmployeeName(ar.employee)}</p>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{ar.employee.emp_no}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      {ar.type === 'direct' ? (
                        <span className="text-slate-500 dark:text-slate-400">—</span>
                      ) : (
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                          <Calendar className="h-3.5 w-3.5 text-slate-600" />
                          <span>{ar.startMonth ?? '—'}</span>
                          <ArrowRight className="h-3 w-3 text-slate-500" />
                          <span>{ar.endMonth ?? '—'}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex flex-col items-end">
                        <span className="text-sm font-bold text-slate-950 dark:text-white">
                          ₹{ar.totalAmount.toLocaleString('en-IN')}
                        </span>
                        <span className="text-[10px] font-bold tracking-widest text-slate-600 uppercase">Total Commitment</span>
                      </div>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className={`inline-flex flex-col items-end rounded-xl px-3 py-1.5 border shadow-sm ${ar.remainingAmount > 0
                        ? 'bg-amber-100 border-amber-300 text-amber-800 dark:text-amber-400'
                        : 'bg-emerald-100 border-emerald-300 text-emerald-800 dark:text-emerald-400'
                        }`}>
                        <span className="text-sm font-bold">
                          ₹{ar.remainingAmount.toLocaleString('en-IN')}
                        </span>
                        <span className="text-[9px] font-bold uppercase tracking-tighter opacity-80">
                          {ar.remainingAmount > 0 ? 'Residual Balance' : 'Fully Liquidated'}
                        </span>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider border shadow-sm ${getStatusColor(ar.status)}`}>
                        {getStatusIcon(ar.status)}
                        {getStatusLabel(ar.status)}
                      </span>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex items-center justify-center">
                        <button
                          onClick={() => handleViewDetails(ar._id)}
                          className="group/btn relative flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white shadow-sm transition-all hover:border-blue-600 hover:bg-blue-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-blue-400 dark:hover:bg-blue-400/10"
                        >
                          <Eye className="h-4 w-4 text-slate-700 transition-colors group-hover/btn:text-blue-600 dark:text-slate-400 dark:group-hover/btn:text-blue-400" />
                          <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-950 px-2 py-1 text-[10px] font-bold text-white opacity-0 transition-opacity group-hover/btn:opacity-100">
                            View Details
                          </div>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <ArrearsDetailDialog
        open={detailDialogOpen}
        onClose={() => setDetailDialogOpen(false)}
        arrearsId={selectedArrearsId}
        onUpdate={loadData}
      />

      {formOpen && (
        <ArrearsForm
          open={formOpen}
          onClose={() => setFormOpen(false)}
          onSubmit={handleCreateArrears}
          employees={employees}
        />
      )}
    </div>
  );
}
