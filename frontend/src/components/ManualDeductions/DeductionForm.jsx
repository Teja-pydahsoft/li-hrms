'use client';

import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { api } from '@/lib/api';
import { X, User, Calendar, IndianRupee, FileText, Zap, TrendingDown } from 'lucide-react';
import EmployeeSelect from '@/components/EmployeeSelect';

const DeductionForm = ({ open, onClose, onSubmit, employees = [] }) => {
  const [deductionType, setDeductionType] = useState('incremental');
  const [formData, setFormData] = useState({
    employee: '',
    startMonth: '',
    endMonth: '',
    monthlyAmount: '',
    totalAmount: '',
    directAmount: '',
    reason: ''
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [fetchingAttendance, setFetchingAttendance] = useState(false);
  const [localEmployees, setLocalEmployees] = useState(employees);
  const [attendanceData, setAttendanceData] = useState([]);
  const [calculationBreakdown, setCalculationBreakdown] = useState([]);

  useEffect(() => {
    if (employees?.length > 0) setLocalEmployees(employees);
    else loadEmployees();
  }, [employees, open]);

  useEffect(() => {
    if (deductionType !== 'incremental') { setAttendanceData([]); return; }
    if (formData.employee && formData.startMonth && formData.endMonth && formData.startMonth <= formData.endMonth) {
      setFetchingAttendance(true);
      api.getAttendanceDataRange(formData.employee, formData.startMonth, formData.endMonth)
        .then((r) => { if (r.success && Array.isArray(r.data)) setAttendanceData(r.data); else setAttendanceData([]); })
        .catch(() => setAttendanceData([]))
        .finally(() => setFetchingAttendance(false));
    } else setAttendanceData([]);
  }, [deductionType, formData.employee, formData.startMonth, formData.endMonth]);

  useEffect(() => {
    if (deductionType !== 'incremental') { setCalculationBreakdown([]); return; }
    if (!formData.startMonth || !formData.endMonth || !formData.monthlyAmount) {
      setCalculationBreakdown([]);
      setFormData((p) => ({ ...p, totalAmount: '0' }));
      return;
    }
    const [startYear, startMonthNum] = formData.startMonth.split('-').map(Number);
    const [endYear, endMonthNum] = formData.endMonth.split('-').map(Number);
    const months = [];
    let currYear = startYear, currMonth = startMonthNum;
    while (currYear < endYear || (currYear === endYear && currMonth <= endMonthNum)) {
      months.push(`${currYear}-${String(currMonth).padStart(2, '0')}`);
      currMonth++; if (currMonth > 12) { currMonth = 1; currYear++; }
    }
    const monthlyAmount = parseFloat(formData.monthlyAmount) || 0;
    const breakdown = months.map((m) => {
      const record = attendanceData.find((r) => String(r.month) === String(m));
      const totalDays = record ? (Number(record.totalDaysInMonth) || new Date(m.split('-')[0], m.split('-')[1], 0).getDate()) : new Date(m.split('-')[0], m.split('-')[1], 0).getDate();
      const paidDays = record?.attendance != null ? Number(record.attendance.totalPaidDays) || 0 : 0;
      const proratedAmount = totalDays > 0 ? (monthlyAmount / totalDays) * paidDays : 0;
      return { month: m, monthlyAmount, totalDays, paidDays, proratedAmount, hasRecord: !!record };
    });
    setCalculationBreakdown(breakdown);
    const total = breakdown.reduce((sum, item) => sum + item.proratedAmount, 0);
    setFormData((p) => ({ ...p, totalAmount: total.toFixed(2) }));
  }, [deductionType, attendanceData, formData.monthlyAmount, formData.startMonth, formData.endMonth]);

  const loadEmployees = () => {
    api.getEmployees({ is_active: true }).then((r) => { if (r.success) setLocalEmployees(r.data || []); }).catch(() => {});
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.employee) newErrors.employee = 'Required';
    if (!formData.reason) newErrors.reason = 'Required';
    if (deductionType === 'direct') {
      const amt = parseFloat(formData.directAmount);
      if (!formData.directAmount || isNaN(amt) || amt <= 0) newErrors.directAmount = 'Valid amount required';
    } else {
      if (!formData.startMonth) newErrors.startMonth = 'Required';
      if (!formData.endMonth) newErrors.endMonth = 'Required';
      if (!formData.monthlyAmount) newErrors.monthlyAmount = 'Required';
      if (formData.startMonth && formData.endMonth && formData.startMonth > formData.endMonth) newErrors.endMonth = 'Must be after start';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setLoading(true);
    const submitData = deductionType === 'direct'
      ? { type: 'direct', employee: formData.employee, totalAmount: parseFloat(formData.directAmount), reason: formData.reason.trim() }
      : {
          type: 'incremental',
          employee: formData.employee,
          startMonth: formData.startMonth,
          endMonth: formData.endMonth,
          monthlyAmount: parseFloat(formData.monthlyAmount),
          totalAmount: parseFloat(formData.totalAmount),
          reason: formData.reason,
          calculationBreakdown: calculationBreakdown.map((b) => ({ month: b.month, monthlyAmount: b.monthlyAmount, totalDays: b.totalDays, paidDays: b.paidDays, proratedAmount: parseFloat(b.proratedAmount.toFixed(2)) }))
        };
    Promise.resolve(onSubmit(submitData))
      .then(() => { setFormData({ employee: '', startMonth: '', endMonth: '', monthlyAmount: '', totalAmount: '', directAmount: '', reason: '' }); setCalculationBreakdown([]); setErrors({}); })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-50 flex w-full max-w-xl max-h-[90vh] flex-col overflow-hidden rounded-3xl bg-slate-50 shadow-xl dark:bg-slate-950 border border-slate-300 dark:border-slate-800">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100 px-6 py-4 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-900/20 border border-rose-200">
              <TrendingDown className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight text-slate-950 dark:text-white">Create Manual Deduction</h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Deduction from pay</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"> <X className="h-4 w-4" /> </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <form id="deduction-form" onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-700">Deduction Type</label>
              <div className="flex rounded-xl border border-slate-300 dark:border-slate-700 overflow-hidden bg-slate-100 dark:bg-slate-900/50 p-1">
                <button type="button" onClick={() => setDeductionType('incremental')} className={`flex-1 py-2.5 text-[10px] font-bold uppercase transition-all ${deductionType === 'incremental' ? 'bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-400'}`}>Incremental (Period)</button>
                <button type="button" onClick={() => setDeductionType('direct')} className={`flex-1 py-2.5 text-[10px] font-bold uppercase transition-all ${deductionType === 'direct' ? 'bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-400'}`}>Direct (Amount + Remarks)</button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-700 flex items-center gap-2"><User className="h-3 w-3" /> Employee</label>
              <EmployeeSelect value={formData.employee} onChange={(emp) => setFormData((p) => ({ ...p, employee: emp ? emp._id : '' }))} placeholder="Select employee" error={errors.employee} />
              {errors.employee && <p className="text-[9px] font-bold text-rose-700 ml-1">{errors.employee}</p>}
            </div>
            {deductionType === 'direct' && (
              <>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-700 flex items-center gap-2"><IndianRupee className="h-3 w-3" /> Amount to deduct</label>
                  <input type="number" step="0.01" min="0" value={formData.directAmount} onChange={(e) => setFormData((p) => ({ ...p, directAmount: e.target.value }))} placeholder="0.00" className={`w-full rounded-xl border bg-white py-2.5 px-4 text-xs font-semibold dark:bg-slate-900 dark:text-white ${errors.directAmount ? 'border-rose-500' : 'border-slate-300 dark:border-slate-700'}`} />
                  {errors.directAmount && <p className="text-[9px] font-bold text-rose-700 ml-1">{errors.directAmount}</p>}
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-700 flex items-center gap-2"><FileText className="h-3 w-3" /> Remarks</label>
                  <textarea value={formData.reason} onChange={(e) => setFormData((p) => ({ ...p, reason: e.target.value }))} placeholder="Reason for this deduction..." rows={2} className={`w-full rounded-xl border bg-white p-4 text-xs dark:bg-slate-900 dark:text-white ${errors.reason ? 'border-rose-500' : 'border-slate-300 dark:border-slate-700'}`} />
                  {errors.reason && <p className="text-[9px] font-bold text-rose-700 ml-1">{errors.reason}</p>}
                </div>
              </>
            )}
            {deductionType === 'incremental' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-slate-700">Start Period</label>
                    <input type="month" value={formData.startMonth} onChange={(e) => setFormData((p) => ({ ...p, startMonth: e.target.value }))} className={`w-full rounded-xl border py-2.5 px-4 text-xs dark:bg-slate-900 dark:text-white ${errors.startMonth ? 'border-rose-500' : 'border-slate-300'}`} />
                    {errors.startMonth && <p className="text-[9px] text-rose-700">{errors.startMonth}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-slate-700">End Period</label>
                    <input type="month" value={formData.endMonth} onChange={(e) => setFormData((p) => ({ ...p, endMonth: e.target.value }))} className={`w-full rounded-xl border py-2.5 px-4 text-xs dark:bg-slate-900 dark:text-white ${errors.endMonth ? 'border-rose-500' : 'border-slate-300'}`} />
                    {errors.endMonth && <p className="text-[9px] text-rose-700">{errors.endMonth}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-slate-700">Monthly deduction</label>
                    <input type="number" step="0.01" min="0" value={formData.monthlyAmount} onChange={(e) => setFormData((p) => ({ ...p, monthlyAmount: e.target.value }))} placeholder="0.00" className={`w-full rounded-xl border py-2.5 px-4 text-xs dark:bg-slate-900 dark:text-white ${errors.monthlyAmount ? 'border-rose-500' : 'border-slate-300'}`} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-slate-700 flex items-center gap-2"><Zap className="h-3 w-3" /> Total (prorated)</label>
                    <div className="flex h-[38px] items-center rounded-xl bg-slate-200/50 px-4 text-xs font-bold dark:bg-slate-900/50 border border-slate-300">₹{(parseFloat(formData.totalAmount) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-700">Reason</label>
                  <textarea value={formData.reason} onChange={(e) => setFormData((p) => ({ ...p, reason: e.target.value }))} placeholder="Reason for deduction..." rows={2} className={`w-full rounded-xl border p-4 text-xs dark:bg-slate-900 dark:text-white ${errors.reason ? 'border-rose-500' : 'border-slate-300'}`} />
                  {errors.reason && <p className="text-[9px] text-rose-700">{errors.reason}</p>}
                </div>
                {calculationBreakdown.length > 0 && (
                  <div className="rounded-xl border border-slate-300 dark:border-slate-700 overflow-hidden">
                    <div className="px-4 py-2 bg-slate-200 dark:bg-slate-900 text-[9px] font-bold uppercase">Compute Log</div>
                    <div className="max-h-28 overflow-y-auto">
                      {calculationBreakdown.map((item, idx) => (
                        <div key={idx} className="flex justify-between px-4 py-2 text-[10px] border-t border-slate-200 dark:border-slate-700">
                          <span>{format(new Date(item.month + '-01'), 'MMM yy')}</span>
                          <span>{item.paidDays}/{item.totalDays} days → ₹{item.proratedAmount.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </form>
        </div>
        <div className="border-t border-slate-300 bg-slate-100 p-4 dark:border-slate-800 dark:bg-slate-950 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl py-2.5 text-[10px] font-bold uppercase text-slate-600">Discard</button>
          <button form="deduction-form" type="submit" disabled={loading} className="flex-[2] rounded-xl bg-slate-950 py-2.5 text-[10px] font-bold uppercase text-white dark:bg-white dark:text-slate-900 disabled:opacity-50">
            {loading ? 'Processing...' : 'Provision Deduction'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeductionForm;
