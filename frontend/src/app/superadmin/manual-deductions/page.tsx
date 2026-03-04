'use client';

import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { api } from '@/lib/api';
import DeductionForm from '@/components/ManualDeductions/DeductionForm';
import Spinner from '@/components/Spinner';
import { Plus, Search, Eye, CheckCircle, Clock, TrendingDown, XCircle, AlertCircle } from 'lucide-react';

const StatCard = ({ title, value, icon: Icon, bgClass, iconClass }: { title: string; value: number | string; icon: any; bgClass: string; iconClass: string }) => (
  <div className="rounded-3xl border border-slate-300 bg-slate-50/90 p-6 dark:border-slate-800 dark:bg-slate-900">
    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">{title}</p>
    <div className="mt-2 flex items-center gap-3">
      <h3 className="text-3xl font-bold text-slate-950 dark:text-white">{value}</h3>
      <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${bgClass} ${iconClass}`}><Icon className="h-6 w-6" /></div>
    </div>
  </div>
);

const getStatusColor = (status: string) => {
  switch (status) {
    case 'approved': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'pending_hod':
    case 'pending_hr':
    case 'pending_admin': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
    case 'rejected': return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400';
    case 'partially_settled': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
    case 'settled': return 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400';
    default: return 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-300';
  }
};

const getStatusLabel = (s: string) => ({ draft: 'Draft', pending_hod: 'Pending HOD', pending_hr: 'Pending HR', pending_admin: 'Pending Admin', approved: 'Approved', rejected: 'Rejected', partially_settled: 'Partially Settled', settled: 'Settled', cancelled: 'Cancelled' }[s] || s);

interface Deduction {
  _id: string;
  type?: 'incremental' | 'direct';
  employee: { _id: string; emp_no?: string; employee_name?: string; first_name?: string; last_name?: string };
  startMonth?: string;
  endMonth?: string;
  totalAmount: number;
  remainingAmount: number;
  status: string;
  reason: string;
  createdAt: string;
}

export default function ManualDeductionsPage() {
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => { loadData(); }, []);

  const loadData = () => {
    setLoading(true);
    api.getDeductions({})
      .then((r: any) => { if (r.success) setDeductions(r.data || []); else toast.error(r.message || 'Failed to load'); })
      .catch((e: any) => toast.error(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };

  const handleCreateSubmit = (data: any) => {
    return api.createDeduction(data).then((r: any) => {
      if (r.success) { toast.success('Manual deduction created'); setFormOpen(false); loadData(); }
      else throw new Error(r.message || 'Create failed');
    });
  };

  const filtered = deductions.filter((d) => {
    const empName = (d.employee?.employee_name || d.employee?.first_name || d.employee?.emp_no || '').toString().toLowerCase();
    const empNo = (d.employee?.emp_no || '').toString().toLowerCase();
    const matchSearch = !searchTerm || empName.includes(searchTerm.toLowerCase()) || empNo.includes(searchTerm.toLowerCase());
    if (!matchSearch) return false;
    if (activeTab === 'all') return true;
    if (activeTab === 'pending') return ['pending_hod', 'pending_hr', 'pending_admin'].includes(d.status);
    return d.status === activeTab;
  });

  const stats = {
    pending: deductions.filter((d) => ['pending_hod', 'pending_hr', 'pending_admin'].includes(d.status)).length,
    approved: deductions.filter((d) => d.status === 'approved').length,
    settled: deductions.filter((d) => d.status === 'settled').length,
    rejected: deductions.filter((d) => d.status === 'rejected').length,
  };

  const getEmployeeName = (emp: any) => emp?.employee_name || (emp?.first_name && emp?.last_name ? `${emp.first_name} ${emp.last_name}` : emp?.first_name) || emp?.emp_no || '—';

  return (
    <div className="md:p-8">
      <ToastContainer position="top-right" autoClose={3000} />

      <div className="mb-10 rounded-2xl border border-slate-300 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50 p-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-900/30 border border-rose-200">
              <TrendingDown className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-950 dark:text-white">Manual Deductions</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400">Deduction from pay — same flow as arrears, applied as deduction</p>
            </div>
          </div>
          <button
            onClick={() => setFormOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-slate-950 px-6 py-3 text-xs font-bold uppercase text-white dark:bg-white dark:text-slate-900"
          >
            <Plus className="h-4 w-4" /> Provision Deduction
          </button>
        </div>
      </div>

      <div className="mb-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Pending Review" value={stats.pending} icon={Clock} bgClass="bg-amber-500/10" iconClass="text-amber-700 dark:text-amber-400" />
        <StatCard title="Approved" value={stats.approved} icon={CheckCircle} bgClass="bg-emerald-500/10" iconClass="text-emerald-700 dark:text-emerald-400" />
        <StatCard title="Settled" value={stats.settled} icon={TrendingDown} bgClass="bg-violet-500/10" iconClass="text-violet-700 dark:text-violet-400" />
        <StatCard title="Rejected" value={stats.rejected} icon={XCircle} bgClass="bg-rose-500/10" iconClass="text-rose-700 dark:text-rose-400" />
      </div>

      <div className="rounded-2xl border border-slate-300 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50 overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-100/50 p-6 dark:border-slate-800 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-1.5 rounded-xl bg-slate-200/80 p-1.5 dark:bg-slate-800/50 overflow-x-auto">
            {['all', 'pending', 'approved', 'settled', 'rejected'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`rounded-lg px-4 py-2 text-xs font-bold uppercase ${activeTab === tab ? 'bg-white dark:bg-slate-700 text-slate-950 dark:text-white shadow' : 'text-slate-600 dark:text-slate-400'}`}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="relative min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search employee..."
              className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm dark:bg-slate-800 dark:text-white dark:border-slate-700"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex h-64 items-center justify-center"><Spinner /></div>
          ) : filtered.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center text-center">
              <AlertCircle className="h-12 w-12 text-slate-400 mb-4" />
              <h3 className="text-lg font-bold text-slate-950 dark:text-white">No deductions found</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Create a manual deduction or adjust filters.</p>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-900/50 text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                  <th className="px-6 py-4 text-left">Employee</th>
                  <th className="px-6 py-4 text-left">Period / Type</th>
                  <th className="px-6 py-4 text-right">Total</th>
                  <th className="px-6 py-4 text-right">Remaining</th>
                  <th className="px-6 py-4 text-left">Status</th>
                  <th className="px-6 py-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {filtered.map((d) => (
                  <tr key={d._id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-6 py-4 text-sm font-medium text-slate-950 dark:text-white">{getEmployeeName(d.employee)}</td>
                    <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                      {d.type === 'direct' ? 'Direct' : (d.startMonth && d.endMonth ? `${d.startMonth} – ${d.endMonth}` : '—')}
                    </td>
                    <td className="px-6 py-4 text-sm text-right font-semibold text-rose-700 dark:text-rose-400">₹{Number(d.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 text-sm text-right">₹{Number(d.remainingAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${getStatusColor(d.status)}`}>{getStatusLabel(d.status)}</span>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => { setSelectedId(d._id); setDetailOpen(true); }}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-200 dark:bg-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600"
                      >
                        <Eye className="h-3.5 w-3.5" /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {formOpen && (
        <DeductionForm
          open={formOpen}
          onClose={() => setFormOpen(false)}
          onSubmit={handleCreateSubmit}
        />
      )}

      {detailOpen && selectedId && (
        <DeductionDetailModal
          deductionId={selectedId}
          onClose={() => { setDetailOpen(false); setSelectedId(null); }}
          onUpdate={loadData}
        />
      )}
    </div>
  );
}

function DeductionDetailModal({ deductionId, onClose, onUpdate }: { deductionId: string; onClose: () => void; onUpdate: () => void }) {
  const [deduction, setDeduction] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (deductionId) {
      setLoading(true);
      api.getDeductionById(deductionId)
        .then((r: any) => { if (r.success) setDeduction(r.data); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [deductionId]);

  if (!deductionId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50" onClick={onClose} />
      <div className="relative z-50 w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-950 dark:text-white">Deduction Details</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">×</button>
        </div>
        <div className="p-6">
          {loading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : deduction ? (
            <div className="space-y-4 text-sm">
              <p><span className="font-semibold text-slate-600 dark:text-slate-400">Employee:</span> {deduction.employee?.employee_name || deduction.employee?.emp_no || '—'}</p>
              <p><span className="font-semibold text-slate-600 dark:text-slate-400">Type:</span> {deduction.type === 'direct' ? 'Direct' : 'Incremental'}</p>
              {deduction.type !== 'direct' && deduction.startMonth && deduction.endMonth && (
                <p><span className="font-semibold text-slate-600 dark:text-slate-400">Period:</span> {deduction.startMonth} – {deduction.endMonth}</p>
              )}
              <p><span className="font-semibold text-slate-600 dark:text-slate-400">Total amount:</span> <span className="text-rose-700 dark:text-rose-400 font-bold">₹{Number(deduction.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></p>
              <p><span className="font-semibold text-slate-600 dark:text-slate-400">Remaining:</span> ₹{Number(deduction.remainingAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
              <p><span className="font-semibold text-slate-600 dark:text-slate-400">Status:</span> {getStatusLabel(deduction.status)}</p>
              <p><span className="font-semibold text-slate-600 dark:text-slate-400">Reason:</span> {deduction.reason || '—'}</p>
            </div>
          ) : (
            <p className="text-slate-500">Failed to load deduction.</p>
          )}
        </div>
      </div>
    </div>
  );
}
