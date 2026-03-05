'use client';

import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { toast } from 'react-toastify';

interface DeductionForPayroll {
  _id: string;
  type?: string;
  employee: { _id: string; emp_no?: string; employee_name?: string };
  totalAmount: number;
  remainingAmount: number;
  reason?: string;
}

interface DeductionsPayrollSectionProps {
  month?: string;
  year?: number;
  departmentId?: string;
  employeeId?: string;
  onDeductionsSelected: (deductions: Array<{ id: string; amount: number; employeeId?: string }>) => void;
}

export default function DeductionsPayrollSection({
  month,
  year,
  departmentId,
  employeeId,
  onDeductionsSelected,
}: DeductionsPayrollSectionProps) {
  const [deductions, setDeductions] = useState<DeductionForPayroll[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchDeductions();
  }, [month, year, employeeId]);

  const fetchDeductions = async () => {
    try {
      setLoading(true);
      const params: { employeeId?: string; month?: string; year?: string } = {};
      if (employeeId) params.employeeId = employeeId;
      if (month) params.month = month;
      if (year) params.year = String(year);
      const response = await api.getDeductionsForPayroll(params);
      const data = (response?.data && Array.isArray(response.data)) ? response.data : [];
      setDeductions(data as DeductionForPayroll[]);
      const initial: Record<string, number> = {};
      (data as DeductionForPayroll[]).forEach((d) => {
        initial[d._id] = d.remainingAmount || 0;
      });
      setSelected(initial);
      onDeductionsSelected(
        Object.entries(initial).map(([id, amount]) => ({
          id,
          amount,
          employeeId: (data as DeductionForPayroll[]).find((x) => x._id === id)?.employee?._id,
        }))
      );
    } catch (error) {
      console.error('Failed to load deductions for payroll:', error);
      toast.error('Failed to load deductions');
      setDeductions([]);
      setSelected({});
      onDeductionsSelected([]);
    } finally {
      setLoading(false);
    }
  };

  const filtered = departmentId
    ? deductions.filter((d) => {
        const dept = (d.employee as any)?.department_id;
        const deptId = typeof dept === 'object' ? dept?._id : dept;
        return deptId === departmentId;
      })
    : deductions;

  const handleAmountChange = (id: string, value: number) => {
    const d = deductions.find((x) => x._id === id);
    const max = d ? d.remainingAmount : 0;
    const amt = Math.max(0, Math.min(max, value));
    setSelected((prev) => {
      const next = { ...prev, [id]: amt };
      onDeductionsSelected(
        Object.entries(next).map(([idd, a]) => ({
          id: idd,
          amount: a,
          employeeId: deductions.find((x) => x._id === idd)?.employee?._id,
        }))
      );
      return next;
    });
  };

  if (loading) return <div className="p-4 text-sm text-slate-500">Loading deductions...</div>;
  if (filtered.length === 0) return <div className="p-4 text-sm text-slate-500">No pending manual deductions for this period.</div>;

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase text-slate-600 dark:text-slate-400">Select amount to deduct in this payroll</p>
      <div className="max-h-40 overflow-y-auto space-y-2">
        {filtered.map((d) => (
          <div key={d._id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 p-2">
            <span className="text-xs truncate flex-1">
              {(d.employee as any)?.employee_name || (d.employee as any)?.emp_no || d._id} — ₹{Number(d.remainingAmount).toFixed(2)} max
            </span>
            <input
              type="number"
              step="0.01"
              min={0}
              max={d.remainingAmount}
              value={selected[d._id] ?? 0}
              onChange={(e) => handleAmountChange(d._id, parseFloat(e.target.value) || 0)}
              className="w-24 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
