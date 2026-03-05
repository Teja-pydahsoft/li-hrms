'use client';

import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { toast } from 'react-toastify';

interface DeductionForPayroll {
  _id: string;
  type?: string;
  employee: {
    _id: string;
    emp_no?: string;
    employee_name?: string;
    department_id?: string | { _id: string; name?: string };
    division_id?: string | { _id: string; name?: string };
  };
  totalAmount: number;
  remainingAmount: number;
  reason?: string;
}

interface DeductionsPayrollSectionProps {
  month?: string;
  year?: number;
  divisionId?: string;
  departmentId?: string;
  employeeId?: string;
  onDeductionsSelected: (deductions: Array<{ id: string; amount: number; employeeId?: string }>) => void;
}

export default function DeductionsPayrollSection({
  month,
  year,
  divisionId,
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
      const raw = response as { success?: boolean; data?: unknown; count?: number };
      const data = Array.isArray(raw?.data) ? raw.data : [];
      setDeductions(data as DeductionForPayroll[]);
      const initial: Record<string, number> = {};
      (data as DeductionForPayroll[]).forEach((d) => {
        initial[d._id] = d.remainingAmount || 0;
      });
      setSelected(initial);
      onDeductionsSelected(
        Object.entries(initial).map(([id, amount]) => {
          const emp = (data as DeductionForPayroll[]).find((x) => x._id === id)?.employee;
          const employeeId = emp?._id != null ? String(emp._id) : undefined;
          return { id, amount, employeeId };
        })
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

  const filtered = deductions.filter((d) => {
    const emp = d.employee as any;
    const deptId = typeof emp?.department_id === 'object' ? emp?.department_id?._id : emp?.department_id;
    const divId = typeof emp?.division_id === 'object' ? emp?.division_id?._id : emp?.division_id;
    if (divisionId && divId !== divisionId) return false;
    if (departmentId && deptId !== departmentId) return false;
    return true;
  });

  const syncSelectionToParent = (nextSelected: Record<string, number>) => {
    onDeductionsSelected(
      Object.entries(nextSelected).map(([id, amount]) => {
        const emp = deductions.find((x) => x._id === id)?.employee;
        const employeeId = emp?._id != null ? String(emp._id) : undefined;
        return { id, amount, employeeId };
      })
    );
  };

  const toggleDeduction = (id: string, include: boolean) => {
    const d = deductions.find((x) => x._id === id);
    if (!d) return;
    const maxAmount = d.remainingAmount || 0;
    setSelected((prev) => {
      const next = { ...prev };
      if (include) {
        next[id] = maxAmount;
      } else {
        delete next[id];
      }
      syncSelectionToParent(next);
      return next;
    });
  };

  const handleAmountChange = (id: string, value: number) => {
    const d = deductions.find((x) => x._id === id);
    const max = d ? d.remainingAmount : 0;
    const amt = Math.max(0, Math.min(max, value));
    setSelected((prev) => {
      const next = { ...prev, [id]: amt };
      syncSelectionToParent(next);
      return next;
    });
  };

  if (loading) return <div className="p-4 text-sm text-slate-500">Loading deductions...</div>;
  if (filtered.length === 0) {
    return (
      <div className="p-4 text-sm text-slate-500">
        No pending manual deductions for this period{divisionId || departmentId ? ' matching the selected filter' : ''}.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <p className="text-xs font-bold uppercase text-slate-600 dark:text-slate-400 mb-2">
        Include deductions (checkbox) and set amount to deduct in this payroll. Filtered by selected division/department above.
      </p>
      <table className="min-w-full bg-white dark:bg-slate-800 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
        <thead className="bg-slate-50 dark:bg-slate-700">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase">Include</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase">Employee</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase">Reason</th>
            <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 dark:text-slate-300 uppercase">Remaining</th>
            <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 dark:text-slate-300 uppercase">Amount to deduct</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
          {filtered.map((d) => {
            const isSelected = selected.hasOwnProperty(d._id);
            const maxAmt = d.remainingAmount || 0;
            const emp = d.employee as any;
            return (
              <tr key={d._id} className={isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''}>
                <td className="px-4 py-2 whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => toggleDeduction(d._id, e.target.checked)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 rounded"
                  />
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-slate-900 dark:text-white">
                  {emp?.employee_name || emp?.emp_no || d._id}
                </td>
                <td className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 max-w-[200px] truncate" title={d.reason}>
                  {d.reason || '—'}
                </td>
                <td className="px-4 py-2 text-sm text-right text-slate-900 dark:text-white">
                  ₹{Number(maxAmt).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    max={maxAmt}
                    value={isSelected ? (selected[d._id] ?? maxAmt) : ''}
                    onChange={(e) => handleAmountChange(d._id, parseFloat(e.target.value) || 0)}
                    disabled={!isSelected}
                    className="w-28 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs text-right"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
