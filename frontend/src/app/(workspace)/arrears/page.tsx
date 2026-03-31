'use client';

import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { toast, ToastContainer } from 'react-toastify';
import Swal from 'sweetalert2';
import 'react-toastify/dist/ReactToastify.css';
import { api } from '@/lib/api';
import ArrearsDetailDialog from '@/components/Arrears/ArrearsDetailDialog';
import ArrearsForm from '@/components/Arrears/ArrearsForm';
import Spinner from '@/components/Spinner';
import { Users, Loader2 } from 'lucide-react';

// Icons
const PlusIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
  </svg>
);

const EyeIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

const ClockIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const getStatusColor = (status: string) => {
  switch (status) {
    case 'approved':
      return 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800';
    case 'pending_hod':
    case 'pending_hr':
    case 'pending_admin':
      return 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800';
    case 'rejected':
      return 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800';
    case 'partially_settled':
      return 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800';
    case 'settled':
      return 'bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800';
    default:
      return 'bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-900/20 dark:text-slate-400 dark:border-slate-800';
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
  employee: { _id: string; emp_no: string; employee_name?: string; first_name?: string; last_name?: string };
  type?: 'incremental' | 'direct';
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
  const [divisions, setDivisions] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [bulkDivisionId, setBulkDivisionId] = useState('');
  const [bulkDepartmentId, setBulkDepartmentId] = useState('');
  const [bulkRows, setBulkRows] = useState<BulkArrearRow[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkSectionOpen, setBulkSectionOpen] = useState(false);

  useEffect(() => {
    loadData();
    loadEmployees();
    api.getDivisions?.().then((r: any) => { if (r?.success && r?.data) setDivisions(r.data); if (Array.isArray(r)) setDivisions(r); }).catch(() => {});
    api.getDepartments?.().then((r: any) => { if (r?.success && r?.data) setDepartments(r.data); if (Array.isArray(r)) setDepartments(r); }).catch(() => {});
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
    const div = divisions.find((d: any) => String(d._id) === String(bulkDivisionId));
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
      if (failed > 0) toast.error(`${failed} request(s) failed`);
    } catch (err: any) {
      toast.error(err?.message || 'Bulk create failed');
    } finally {
      setBulkSaving(false);
    }
  };

  return (
    <div className="min-h-screen p-6">
      <ToastContainer position="top-right" autoClose={3000} />

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Arrears Management</h1>
            <p className="text-slate-600 dark:text-slate-400">Manage employee arrears requests and approvals</p>
          </div>
          <button
            onClick={() => setFormOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-lg font-medium transition-all duration-200 shadow-lg hover:shadow-xl"
          >
            <PlusIcon />
            Create Arrears
          </button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {[
          { label: 'Pending Approval', value: stats.pending, color: 'from-amber-500 to-orange-600', icon: '⏳' },
          { label: 'Approved', value: stats.approved, color: 'from-emerald-500 to-green-600', icon: '✓' },
          { label: 'Settled', value: stats.settled, color: 'from-green-500 to-emerald-600', icon: '✓✓' },
          { label: 'Rejected', value: stats.rejected, color: 'from-red-500 to-rose-600', icon: '✕' }
        ].map((stat, idx) => (
          <div
            key={idx}
            className="bg-white dark:bg-slate-800 rounded-xl shadow-md hover:shadow-lg transition-all duration-200 p-6 border border-slate-200 dark:border-slate-700"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-600 dark:text-slate-400 text-sm font-medium mb-1">{stat.label}</p>
                <p className="text-3xl font-bold text-slate-900 dark:text-white">{stat.value}</p>
              </div>
              <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${stat.color} flex items-center justify-center text-white text-xl`}>
                {stat.icon}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Bulk create section */}
      <div className="mb-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
        <button
          type="button"
          onClick={() => setBulkSectionOpen((o) => !o)}
          className="flex w-full items-center justify-between p-5 text-left"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700">
              <Users className="h-5 w-5 text-slate-700 dark:text-slate-200" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Bulk create arrears</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">Load employees, enter amount and remarks, create direct arrears requests</p>
            </div>
          </div>
          <span className="text-slate-500">{bulkSectionOpen ? '▼' : '▶'}</span>
        </button>
        {bulkSectionOpen && (
          <div className="border-t border-slate-200 dark:border-slate-700 p-5 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Division</label>
                <select
                  value={bulkDivisionId}
                  onChange={(e) => { setBulkDivisionId(e.target.value); setBulkDepartmentId(''); }}
                  className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white px-3 py-2 text-sm min-w-[180px]"
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
                  className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white px-3 py-2 text-sm min-w-[180px]"
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
                className="rounded-lg bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              >
                {bulkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                Load employees
              </button>
            </div>
            {bulkRows.length > 0 && (
              <>
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                        <th className="px-3 py-2 text-left">Employee</th>
                        <th className="px-3 py-2 text-left">Code / Dept</th>
                        <th className="px-3 py-2 text-right">Amount (₹)</th>
                        <th className="px-3 py-2 text-left">Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkRows.map((row, idx) => (
                        <tr key={row.employee._id} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">
                            {row.employee.employee_name || [row.employee.first_name, row.employee.last_name].filter(Boolean).join(' ') || row.employee.emp_no || '—'}
                          </td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                            {row.employee.emp_no || '—'}
                            {(row.employee.department_id as any)?.name && ` / ${(row.employee.department_id as any).name}`}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              value={row.amount === 0 ? '' : row.amount}
                              onChange={(e) => updateBulkRow(idx, 'amount', e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)}
                              className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white px-2 py-1.5 text-right"
                              placeholder="0"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={row.remarks}
                              onChange={(e) => updateBulkRow(idx, 'remarks', e.target.value)}
                              className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white px-2 py-1.5"
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
                    className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    {bulkSaving ? 'Saving...' : 'Save (create requests)'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-slate-200 dark:border-slate-700 overflow-hidden mb-6">
        <div className="flex border-b border-slate-200 dark:border-slate-700">
          {['pending', 'approved', 'settled', 'rejected', 'all'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 px-4 py-4 font-medium transition-all duration-200 ${activeTab === tab
                  ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner />
            </div>
          ) : filteredArrears.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-slate-500 dark:text-slate-400">No arrears found</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                  <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900 dark:text-white">Employee</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900 dark:text-white">Period</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-slate-900 dark:text-white">Amount</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-slate-900 dark:text-white">Remaining</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900 dark:text-white">Status</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900 dark:text-white">Created</th>
                  <th className="px-6 py-4 text-center text-sm font-semibold text-slate-900 dark:text-white">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredArrears.map((ar, idx) => (
                  <tr
                    key={ar._id}
                    className={`border-b border-slate-200 dark:border-slate-700 transition-colors duration-200 ${idx % 2 === 0
                        ? 'bg-white dark:bg-slate-800'
                        : 'bg-slate-50 dark:bg-slate-900/50'
                      } hover:bg-blue-50 dark:hover:bg-blue-900/20`}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-semibold text-sm">
                          {getEmployeeName(ar.employee).charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-slate-900 dark:text-white">{getEmployeeName(ar.employee)}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{ar.employee.emp_no}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-700 dark:text-slate-300">
                      {ar.type === 'direct' ? (
                        <span className="text-slate-500 dark:text-slate-400">—</span>
                      ) : (
                        <span>{ar.startMonth ?? '—'} to {ar.endMonth ?? '—'}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right font-semibold text-slate-900 dark:text-white">
                      ₹{ar.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${ar.remainingAmount > 0
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        }`}>
                        ₹{ar.remainingAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(ar.status)}`}>
                        {getStatusLabel(ar.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                      {format(new Date(ar.createdAt), 'dd MMM yyyy')}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => handleViewDetails(ar._id)}
                        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors duration-200"
                      >
                        <EyeIcon />
                        View
                      </button>
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

