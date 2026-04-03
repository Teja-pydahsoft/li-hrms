'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { api, PayrollConfig, PayrollConfigStep, PayrollOutputColumn, PayrollStepComponent, StatutoryDeductionConfig } from '@/lib/api';
import { toast } from 'react-toastify';
import { FileSpreadsheet, Save, Plus, Trash2, ChevronDown, ChevronRight, HelpCircle, ArrowRight, GripVertical } from 'lucide-react';

const DEFAULT_STEP_TYPES: { type: string; label: string }[] = [
  { type: 'attendance', label: 'Attendance & paid days' },
  { type: 'basic_pay', label: 'Basic pay' },
  { type: 'ot_pay', label: 'OT pay' },
  { type: 'allowances', label: 'Allowances' },
  { type: 'attendance_deduction', label: 'Attendance deduction' },
  { type: 'other_deductions', label: 'Other deductions' },
  { type: 'statutory_deductions', label: 'Statutory (ESI, PF, PT)' },
  { type: 'loan_advance', label: 'Loan & salary advance' },
  { type: 'round_off', label: 'Round-off & net' },
];

/** Step types that have configurable components (allowances / deductions list) */
const STEP_TYPES_WITH_COMPONENTS = ['allowances', 'other_deductions'];

/** All selectable components for the paysheet (fields from payroll data).
 * Removed: net salary, total deductions, final paid days, total paid days, extra days,
 * total allowances, gross salary (use basic pay / formulas and deductions cumulative instead).
 */
const OUTPUT_FIELD_OPTIONS: { value: string; label: string }[] = [
  { value: 'employee.emp_no', label: 'Employee Code' },
  { value: 'employee.name', label: 'Name' },
  { value: 'employee.designation', label: 'Designation' },
  { value: 'employee.department', label: 'Department' },
  { value: 'employee.division', label: 'Division' },
  { value: 'employee.bank_account_no', label: 'Bank Account No' },
  { value: 'employee.bank_name', label: 'Bank Name' },
  { value: 'employee.bank_place', label: 'Bank Branch' },
  { value: 'employee.ifsc_code', label: 'IFSC Code' },
  { value: 'employee.payment_mode', label: 'Salary Mode' },
  { value: 'earnings.basicPay', label: 'Basic pay' },
  { value: 'earnings.otPay', label: 'OT pay' },
  { value: 'earnings.allowancesCumulative', label: 'Allowances cumulative' },
  { value: 'earnings.incentive', label: 'Incentive' },
  { value: 'earnings.perDayBasicPay', label: 'Per day basic' },
  { value: 'attendance.presentDays', label: 'Present days' },
  { value: 'attendance.payableShifts', label: 'Payable shifts' },
  { value: 'attendance.totalDaysInMonth', label: 'Month days' },
  { value: 'attendance.weeklyOffs', label: 'Week offs' },
  { value: 'attendance.holidays', label: 'Holidays' },
  { value: 'attendance.paidLeaveDays', label: 'Paid leave days' },
  { value: 'attendance.elUsedInPayroll', label: 'EL (Earned leave used in payroll)' },
  { value: 'attendance.lopDays', label: 'LOP leave days' },
  { value: 'attendance.odDays', label: 'OD days' },
  { value: 'attendance.absentDays', label: 'Absent days' },
  { value: 'deductions.deductionsCumulative', label: 'Deductions cumulative' },
  { value: 'deductions.statutoryCumulative', label: 'Statutory cumulative' },
  { value: 'deductions.attendanceDeduction', label: 'Attendance deduction' },
  { value: 'attendance.attendanceDeductionDays', label: 'Attendance deduction days' },
  { value: 'loanAdvance.advanceDeduction', label: 'Advance deduction' },
  { value: 'loanAdvance.totalEMI', label: 'Loan EMI' },
  { value: 'loanAdvance.remainingBalance', label: 'Loans (remaining balance)' },
  { value: 'roundOff', label: 'Round off' },
  { value: 'arrears.arrearsAmount', label: 'Arrears' },
  { value: 'manualDeductions.manualDeductionsAmount', label: 'Manual deductions' },
];

export default function PayrollConfigPage() {
  const [config, setConfig] = useState<PayrollConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [steps, setSteps] = useState<PayrollConfigStep[]>([]);
  const [outputColumns, setOutputColumns] = useState<PayrollOutputColumn[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [formulaHelpOpen, setFormulaHelpOpen] = useState(false);
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null);
  const [statutoryConfig, setStatutoryConfig] = useState<StatutoryDeductionConfig | null>(null);
  const [statutoryProratePaidDaysColumnHeader, setStatutoryProratePaidDaysColumnHeader] = useState('');
  const [statutoryProrateTotalDaysColumnHeader, setStatutoryProrateTotalDaysColumnHeader] = useState('');
  const [professionTaxSlabEarningsColumnHeader, setProfessionTaxSlabEarningsColumnHeader] = useState('');

  const outputFieldOptions = useMemo(() => {
    const extra = config?.employeeSalaryFieldOptions ?? [];
    if (extra.length === 0) return OUTPUT_FIELD_OPTIONS;
    const seen = new Set(OUTPUT_FIELD_OPTIONS.map((o) => o.value));
    const merged = [...OUTPUT_FIELD_OPTIONS];
    for (const o of extra) {
      if (o?.value && !seen.has(o.value)) {
        seen.add(o.value);
        merged.push(o);
      }
    }
    return merged;
  }, [config?.employeeSalaryFieldOptions]);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const [payrollRes, statutoryRes] = await Promise.all([
        api.getPayrollConfig(),
        api.getStatutoryConfig().catch(() => ({ data: null })),
      ]);
      const data = (payrollRes as { data?: PayrollConfig })?.data ?? null;
      const statutory = (statutoryRes as { data?: StatutoryDeductionConfig })?.data ?? null;
      setStatutoryConfig(statutory ?? null);
      setConfig(data);
      setEnabled(data?.enabled ?? false);
      if (Array.isArray(data?.steps) && data.steps.length > 0) {
        setSteps(data.steps.map((s, i) => ({
          ...s,
          order: s.order ?? i,
          formula: s.formula ?? '',
          components: Array.isArray(s.components) ? s.components.map((c, j) => ({ ...c, order: c.order ?? j })) : [],
        })));
      } else {
        setSteps(
          DEFAULT_STEP_TYPES.map((t, i) => ({
            id: `${t.type}_${i}`,
            type: t.type,
            label: t.label,
            order: i,
            enabled: true,
            formula: '',
            components: [],
          }))
        );
      }
      if (Array.isArray(data?.outputColumns) && data.outputColumns.length > 0) {
        setOutputColumns(data.outputColumns.map((c, i) => ({ ...c, order: c.order ?? i })));
      } else {
        setOutputColumns([]);
      }
      setStatutoryProratePaidDaysColumnHeader(data?.statutoryProratePaidDaysColumnHeader ?? '');
      setStatutoryProrateTotalDaysColumnHeader(data?.statutoryProrateTotalDaysColumnHeader ?? '');
      setProfessionTaxSlabEarningsColumnHeader(data?.professionTaxSlabEarningsColumnHeader ?? '');
    } catch (e) {
      console.error(e);
      toast.error('Failed to load payroll config');
      setSteps(
        DEFAULT_STEP_TYPES.map((t, i) => ({
          id: `${t.type}_${i}`,
          type: t.type,
          label: t.label,
          order: i,
          enabled: true,
          formula: '',
          components: [],
        }))
      );
      setOutputColumns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const normalizedColumns = outputColumns.map((c, i) => {
        const header = (c.header != null && String(c.header).trim()) ? String(c.header).trim() : `Column ${i + 1}`;
        return { ...c, header, order: i };
      });
      const payload = {
        enabled,
        steps: steps.map((s, i) => ({ ...s, order: i })),
        outputColumns: normalizedColumns,
        statutoryProratePaidDaysColumnHeader: statutoryProratePaidDaysColumnHeader.trim(),
        statutoryProrateTotalDaysColumnHeader: statutoryProrateTotalDaysColumnHeader.trim(),
        professionTaxSlabEarningsColumnHeader: professionTaxSlabEarningsColumnHeader.trim(),
      };
      await api.putPayrollConfig(payload);
      toast.success('Payroll configuration saved');
      await loadConfig();
    } catch (e) {
      console.error(e);
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const moveStep = (index: number, dir: number) => {
    const next = index + dir;
    if (next < 0 || next >= steps.length) return;
    const arr = [...steps];
    [arr[index], arr[next]] = [arr[next], arr[index]];
    setSteps(arr.map((s, i) => ({ ...s, order: i })));
  };

  const addOutputColumn = () => {
    setOutputColumns((prev) => [...prev, { header: '', source: 'field', field: 'employee.emp_no', order: prev.length }]);
  };

  /** Add only the cumulative column for a step. Components (allowances, deductions, PF/ESI/PT) are calculated by payroll services and stored; we only expose the cumulative so the engine/Excel shows the sum. */
  const addColumnsFromStep = (stepType: string) => {
    const nextOrder = outputColumns.length;
    let newCol: PayrollOutputColumn | null = null;
    if (stepType === 'allowances') {
      newCol = { header: 'Allowances cumulative', source: 'field', field: 'earnings.allowancesCumulative', formula: '', order: nextOrder };
    } else if (stepType === 'other_deductions') {
      newCol = { header: 'Deductions cumulative', source: 'field', field: 'deductions.deductionsCumulative', formula: '', order: nextOrder };
    } else if (stepType === 'statutory_deductions') {
      newCol = { header: 'Statutory cumulative', source: 'field', field: 'deductions.statutoryCumulative', formula: '', order: nextOrder };
    }
    if (newCol) {
      const withOrder = { ...newCol, order: newCol.order ?? nextOrder };
      setOutputColumns((prev) => prev.map((c, i) => ({ ...c, order: i })).concat([withOrder]));
      toast.success('Added cumulative column');
    }
  };

  const removeOutputColumn = (index: number) => {
    setOutputColumns((prev) => prev.filter((_, i) => i !== index));
  };

  const moveOutputColumn = (index: number, dir: number) => {
    const next = index + dir;
    if (next < 0 || next >= outputColumns.length) return;
    const arr = [...outputColumns];
    [arr[index], arr[next]] = [arr[next], arr[index]];
    setOutputColumns(arr.map((c, i) => ({ ...c, order: i })));
  };

  const sortedSteps = [...steps].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const updateStepFormula = (stepIndex: number, formula: string) => {
    setSteps((prev) => prev.map((s, i) => (i === stepIndex ? { ...s, formula } : s)));
  };

  const addStepComponent = (stepIndex: number) => {
    const step = steps[stepIndex];
    const comps = step?.components ?? [];
    const newComp: PayrollStepComponent = {
      id: `comp_${Date.now()}_${comps.length}`,
      name: '',
      type: 'fixed',
      amount: 0,
      order: comps.length,
    };
    setSteps((prev) => prev.map((s, i) => (i === stepIndex ? { ...s, components: [...(s.components ?? []), newComp] } : s)));
  };

  const updateStepComponent = (stepIndex: number, compIndex: number, patch: Partial<PayrollStepComponent>) => {
    setSteps((prev) =>
      prev.map((s, i) => {
        if (i !== stepIndex) return s;
        const comps = [...(s.components ?? [])];
        if (compIndex < 0 || compIndex >= comps.length) return s;
        comps[compIndex] = { ...comps[compIndex], ...patch };
        return { ...s, components: comps };
      })
    );
  };

  const removeStepComponent = (stepIndex: number, compIndex: number) => {
    setSteps((prev) =>
      prev.map((s, i) => {
        if (i !== stepIndex) return s;
        const comps = (s.components ?? []).filter((_, j) => j !== compIndex).map((c, j) => ({ ...c, order: j }));
        return { ...s, components: comps };
      })
    );
  };

  const moveStepComponent = (stepIndex: number, compIndex: number, dir: number) => {
    const step = steps[stepIndex];
    const comps = step?.components ?? [];
    const next = compIndex + dir;
    if (next < 0 || next >= comps.length) return;
    const arr = [...comps];
    [arr[compIndex], arr[next]] = [arr[next], arr[compIndex]];
    setSteps((prev) =>
      prev.map((s, i) => (i === stepIndex ? { ...s, components: arr.map((c, j) => ({ ...c, order: j })) } : s))
    );
  };

  return (
    <div className="min-h-screen bg-slate-50/80 dark:bg-slate-950/50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8">
        {/* Header – static */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">
              Payroll configuration
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              The paysheet flow (columns in order) is the payroll flow configuration. Field values (OT pay, attendance deduction, etc.) come from the dedicated functions in the services and controllers—for the respective employee we get those values from them. Add cumulative columns to place allowances/deductions/statutory sums. Enabled components from the employee form <strong>Salaries</strong> group appear under the field dropdown as <code className="text-xs">employee.salaries.&lt;field id&gt;</code>.
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-medium shadow-sm hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>

        {/* Payroll flow – flowchart + step detail */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900/80 shadow-sm overflow-hidden">
          <div className="px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-700/80">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Payroll flow (internal steps)</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Execution order of the engine. The actual payroll flow you configure is the paysheet columns below (order, fields, formulas). Here you can add components (allowances / deductions) per step.
            </p>
          </div>
          <div className="p-4 sm:p-6">
            {loading ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                    <div key={i} className="h-10 w-[120px] rounded-xl bg-slate-200 dark:bg-slate-700 animate-pulse" />
                  ))}
                </div>
                <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-700/80">
                  <div className="h-4 w-32 rounded bg-slate-200 dark:bg-slate-700 animate-pulse mb-3" />
                  <div className="h-10 w-full rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
                </div>
              </>
            ) : (
              <>
                {/* Flowchart: horizontal steps */}
                <div className="flex flex-wrap items-center gap-2 sm:gap-1">
                  {sortedSteps.map((step, idx) => {
                    const stepIndex = steps.findIndex((s) => s.id === step.id);
                    const isSelected = selectedStepIndex === stepIndex;
                    const compCount = (step.components ?? []).length;
                    return (
                      <div key={step.id} className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setSelectedStepIndex(stepIndex)}
                          className={`px-3 py-2 rounded-xl text-left text-sm font-medium transition-all border min-w-[100px] sm:min-w-[120px] ${isSelected ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 ring-2 ring-violet-500/50' : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 hover:border-violet-300 dark:hover:border-violet-700'}`}
                        >
                          <span className="block truncate">{step.label || step.type}</span>
                          {STEP_TYPES_WITH_COMPONENTS.includes(step.type) && compCount > 0 && (
                            <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">{compCount} items</span>
                          )}
                        </button>
                        {idx < sortedSteps.length - 1 && (
                          <ArrowRight className="h-4 w-4 text-slate-300 dark:text-slate-500 shrink-0 hidden sm:block" />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Step detail: components or formula */}
                {selectedStepIndex !== null && steps[selectedStepIndex] && (
                  <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-700/80">
                    {(() => {
                      const step = steps[selectedStepIndex];
                      const hasComponents = STEP_TYPES_WITH_COMPONENTS.includes(step.type);
                      const comps = step.components ?? [];
                      return (
                        <>
                          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">
                            {step.label || step.type}
                          </h3>
                          {hasComponents ? (
                            <>
                              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                                Add {step.type === 'allowances' ? 'allowances' : 'deductions'} (fixed amount, percentage of basic/gross, or formula).
                              </p>
                              <div className="space-y-3">
                                {comps.map((comp, cIdx) => (
                                  <div
                                    key={comp.id}
                                    className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-800/30"
                                  >
                                    <div className="flex items-center gap-2 shrink-0">
                                      <GripVertical className="h-4 w-4 text-slate-400" />
                                      <button type="button" onClick={() => moveStepComponent(selectedStepIndex, cIdx, -1)} disabled={cIdx === 0} className="p-1 rounded text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-30">↑</button>
                                      <button type="button" onClick={() => moveStepComponent(selectedStepIndex, cIdx, 1)} disabled={cIdx === comps.length - 1} className="p-1 rounded text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-30">↓</button>
                                      <button type="button" onClick={() => removeStepComponent(selectedStepIndex, cIdx)} className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 className="h-4 w-4" /></button>
                                    </div>
                                    <input
                                      type="text"
                                      value={comp.name ?? ''}
                                      onChange={(e) => updateStepComponent(selectedStepIndex, cIdx, { name: e.target.value })}
                                      placeholder="Name"
                                      className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/50 text-sm"
                                    />
                                    <div className="flex flex-wrap gap-2">
                                      <div className="flex rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden p-0.5 bg-slate-100 dark:bg-slate-700/30">
                                        {(['fixed', 'percentage', 'formula'] as const).map((t) => (
                                          <button
                                            key={t}
                                            type="button"
                                            onClick={() => updateStepComponent(selectedStepIndex, cIdx, { type: t })}
                                            className={`px-2 py-1 text-xs font-medium capitalize ${comp.type === t ? 'bg-white dark:bg-slate-600 text-violet-600 dark:text-violet-400 shadow' : 'text-slate-500'}`}
                                          >
                                            {t}
                                          </button>
                                        ))}
                                      </div>
                                      {comp.type === 'fixed' && (
                                        <input
                                          type="number"
                                          value={comp.amount ?? 0}
                                          onChange={(e) => updateStepComponent(selectedStepIndex, cIdx, { amount: Number(e.target.value) || 0 })}
                                          placeholder="Amount"
                                          className="w-24 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/50 text-sm"
                                        />
                                      )}
                                      {comp.type === 'percentage' && (
                                        <>
                                          <input
                                            type="number"
                                            value={comp.percentage ?? 0}
                                            onChange={(e) => updateStepComponent(selectedStepIndex, cIdx, { percentage: Number(e.target.value) || 0 })}
                                            placeholder="%"
                                            className="w-16 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/50 text-sm"
                                          />
                                          <select
                                            value={comp.base ?? 'basic'}
                                            onChange={(e) => updateStepComponent(selectedStepIndex, cIdx, { base: e.target.value as 'basic' | 'gross' })}
                                            className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/50 text-sm"
                                          >
                                            <option value="basic">of basic</option>
                                            <option value="gross">of gross</option>
                                          </select>
                                        </>
                                      )}
                                      {comp.type === 'formula' && (
                                        <input
                                          type="text"
                                          value={comp.formula ?? ''}
                                          onChange={(e) => updateStepComponent(selectedStepIndex, cIdx, { formula: e.target.value })}
                                          placeholder="e.g. Math.min(basicPay * 0.12, 1800)"
                                          className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/50 text-sm font-mono"
                                        />
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <button
                                type="button"
                                onClick={() => addStepComponent(selectedStepIndex)}
                                className="mt-3 inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-violet-500 hover:text-violet-600 dark:hover:text-violet-400 text-sm"
                              >
                                <Plus className="h-4 w-4" />
                                Add component
                              </button>
                            </>
                          ) : (
                            <div>
                              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Formula (optional)</label>
                              <input
                                type="text"
                                value={step.formula ?? ''}
                                onChange={(e) => updateStepFormula(selectedStepIndex, e.target.value)}
                                placeholder="e.g. perDayBasicPay * totalPaidDays"
                                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/50 text-sm font-mono text-slate-900 dark:text-white placeholder:text-slate-400"
                              />
                              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                Variables: basicPay, perDayBasicPay, totalPaidDays, presentDays, grossSalary, netSalary, allowancesCumulative, deductionsCumulative, statutoryCumulative, attendanceDeductionDays, etc.
                              </p>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Use for Excel – card */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900/80 shadow-sm overflow-hidden">
          <div className="p-5 sm:p-6">
            {loading ? (
              <div className="flex items-start gap-3">
                <div className="mt-1 h-4 w-4 rounded border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 animate-pulse shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" />
                  <div className="h-3 w-full max-w-sm rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
                </div>
              </div>
            ) : (
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="mt-1 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                />
                <div>
                  <span className="text-sm font-medium text-slate-900 dark:text-white group-hover:text-slate-700">
                    Use this design for Excel export
                  </span>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    When on, the payroll Excel file will show exactly the columns you define below. When off, the default layout is used.
                  </p>
                </div>
              </label>
            )}
          </div>
        </div>

        {/* Formula help – collapsible card */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900/80 shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setFormulaHelpOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-3 px-5 sm:px-6 py-4 text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <HelpCircle className="h-4 w-4 text-violet-500" />
              Formula help
            </span>
            {formulaHelpOpen ? (
              <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
            )}
          </button>
          {formulaHelpOpen && (
            <div className="px-5 sm:px-6 pb-5 pt-0 border-t border-slate-100 dark:border-slate-700/80">
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                In formulas you can use numbers, + - * / ( ) and variables like basicPay, grossSalary, netSalary, presentDays, payableShifts, monthDays, weeklyOffs, holidays, paidLeaveDays, elUsedInPayroll, lopDays, attendanceDeductionDays, allowancesCumulative, deductionsCumulative, statutoryCumulative, etc. You can reference earlier columns by header in lowercase with spaces as underscores (e.g. &quot;PF Basic&quot; → pf_basic). Math: Math.min, Math.max, Math.round, Math.floor, Math.ceil, Math.abs.
              </p>
              <p className="mt-2 text-xs font-mono text-slate-500 dark:text-slate-500 bg-slate-100 dark:bg-slate-800/60 rounded-lg px-3 py-2">
                Math.min(basicPay, 15000) &nbsp; basicPay * 0.5 &nbsp; (basicPay / monthDays) * presentDays
              </p>
            </div>
          )}
        </div>

        {/* Paysheet columns – modern list */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900/80 shadow-sm overflow-hidden">
          <div className="px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-700/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Paysheet flow (payroll flow configuration)
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                This is the actual payroll flow: add columns in order. Field values (OT pay, attendance deduction, basic pay, etc.) come from the dedicated functions in the services and controllers—for the respective employee we get those values from them. Use &quot;Add cumulative from step&quot; to place Allowances cumulative, Deductions cumulative, or Statutory cumulative for that employee. <strong>Include a &quot;Paid Days&quot; or &quot;Present days&quot; column before those cumulatives</strong> so statutory, allowances and deductions use it for proration (see section below).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {loading ? (
                <>
                  <div className="h-10 w-44 rounded-xl bg-slate-200 dark:bg-slate-700 animate-pulse" />
                  <div className="h-10 w-28 rounded-xl bg-slate-200 dark:bg-slate-700 animate-pulse" />
                </>
              ) : (
                <>
                  <div className="relative group">
                    <select
                      onChange={(e) => {
                        const v = e.target.value;
                        e.target.value = '';
                        if (v) addColumnsFromStep(v);
                      }}
                      className="appearance-none inline-flex items-center gap-2 pl-4 pr-8 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent cursor-pointer"
                      value=""
                    >
                      <option value="" disabled>Add cumulative from step...</option>
                      <option value="allowances">Allowances cumulative</option>
                      <option value="other_deductions">Deductions cumulative</option>
                      <option value="statutory_deductions">Statutory cumulative</option>
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                  </div>
                  <button
                    type="button"
                    onClick={addOutputColumn}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 text-sm font-medium hover:bg-violet-100 dark:hover:bg-violet-900/30 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    Add column
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-700/80">
            {loading ? (
              [...Array(4)].map((_, i) => (
                <div key={i} className="px-5 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex gap-2 shrink-0">
                    <div className="h-8 w-8 rounded-lg bg-slate-200 dark:bg-slate-700 animate-pulse" />
                    <div className="h-8 w-8 rounded-lg bg-slate-200 dark:bg-slate-700 animate-pulse" />
                    <div className="h-8 w-8 rounded-lg bg-slate-200 dark:bg-slate-700 animate-pulse" />
                  </div>
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="h-10 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
                    <div className="sm:col-span-2 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
                  </div>
                </div>
              ))
            ) : outputColumns.length === 0 ? (
              <div className="px-5 sm:px-6 py-12 text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800/60 text-slate-400 dark:text-slate-500 mb-4">
                  <FileSpreadsheet className="h-6 w-6" />
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  No columns yet. Add columns in flow order; field values come from the dedicated functions in the services and controllers for the respective employee.
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                  Add columns in flow order. Fields get values from the payroll record (OT pay, attendance deduction, etc.). Use &quot;Add cumulative from step&quot; for Allowances / Deductions / Statutory cumulative. Or add a column and pick a field or formula.
                </p>
                <button
                  type="button"
                  onClick={addOutputColumn}
                  className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  Add your first column
                </button>
              </div>
            ) : (
              outputColumns.map((col, index) => (
                <div
                  key={index}
                  className="px-5 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-4 bg-white dark:bg-slate-900/80 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
                >
                  <div className="flex items-center gap-2 shrink-0 order-2 sm:order-1">
                    <span className="text-xs font-medium text-slate-400 dark:text-slate-500 w-6">
                      {index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => moveOutputColumn(index, -1)}
                      disabled={index === 0}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                      title="Move left"
                    >
                      <ChevronRight className="h-4 w-4 rotate-180" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveOutputColumn(index, 1)}
                      disabled={index === outputColumns.length - 1}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                      title="Move right"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeOutputColumn(index)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      title="Remove column"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-4 min-w-0 order-1 sm:order-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                        Column name
                      </label>
                      <input
                        type="text"
                        value={col.header}
                        onChange={(e) =>
                          setOutputColumns((prev) =>
                            prev.map((c, i) => (i === index ? { ...c, header: e.target.value } : c))
                          )
                        }
                        placeholder="e.g. Employee Code"
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/50 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-shadow"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                        Data source
                      </label>
                      <div className="flex gap-2">
                        <div className="flex rounded-xl border border-slate-200 dark:border-slate-600 overflow-hidden bg-slate-50/50 dark:bg-slate-800/30 p-0.5">
                          <button
                            type="button"
                            onClick={() =>
                              setOutputColumns((prev) =>
                                prev.map((c, i) => (i === index ? { ...c, source: 'field' as const } : c))
                              )
                            }
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${col.source === 'field' ? 'bg-white dark:bg-slate-700 text-violet-600 dark:text-violet-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                          >
                            Field
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setOutputColumns((prev) =>
                                prev.map((c, i) => (i === index ? { ...c, source: 'formula' as const } : c))
                              )
                            }
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${col.source === 'formula' ? 'bg-white dark:bg-slate-700 text-violet-600 dark:text-violet-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                          >
                            Formula
                          </button>
                        </div>
                        {col.source === 'field' ? (
                          <select
                            value={col.field ?? ''}
                            onChange={(e) =>
                              setOutputColumns((prev) =>
                                prev.map((c, i) => (i === index ? { ...c, field: e.target.value } : c))
                              )
                            }
                            className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/50 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                          >
                            <option value="">Select field...</option>
                            {outputFieldOptions.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={col.formula ?? ''}
                            onChange={(e) =>
                              setOutputColumns((prev) =>
                                prev.map((c, i) => (i === index ? { ...c, formula: e.target.value } : c))
                              )
                            }
                            placeholder="e.g. Math.min(basicPay, 15000)"
                            className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/50 text-sm font-mono text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {!loading && outputColumns.length > 0 && (
            <div className="px-5 sm:px-6 py-3 border-t border-slate-100 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-800/30">
              <button
                type="button"
                onClick={addOutputColumn}
                className="inline-flex items-center gap-2 text-sm text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 font-medium transition-colors"
              >
                <Plus className="h-4 w-4" />
                Add another column
              </button>
            </div>
          )}
          {loading && (
            <div className="px-5 sm:px-6 py-3 border-t border-slate-100 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-800/30">
              <div className="h-8 w-36 rounded-lg bg-slate-200 dark:bg-slate-700 animate-pulse" />
            </div>
          )}
        </div>

        {/* Required column for proration: statutory, allowances, deductions all use this paid days column when present */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900/80 shadow-sm overflow-hidden">
          <div className="px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-700/80">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Required column for proration (statutory, allowances, deductions)
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              The <strong>paid days</strong> (or working days) column value is used to prorate <strong>statutory deductions</strong> (ESI, PF, Profession Tax), <strong>allowances</strong>, and <strong>other deductions</strong>. You can select a column here, or leave empty: <strong>the system auto-detects by column name</strong> (e.g. &quot;Paid Days&quot;, &quot;Present days&quot;, &quot;Working Days&quot;, &quot;Month days&quot;). The chosen or detected column must appear <strong>before</strong> Allowances cumulative, Deductions cumulative, and Statutory cumulative in the list above.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800">
                Statutory (ESI, PF, PT)
              </span>
              <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800">
                Allowances
              </span>
              <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800">
                Other deductions
              </span>
            </div>
          </div>
          <div className="px-5 sm:px-6 py-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                Paid days column (header)
              </label>
              <select
                value={statutoryProratePaidDaysColumnHeader}
                onChange={(e) => setStatutoryProratePaidDaysColumnHeader(e.target.value)}
                className="w-full max-w-md px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/50 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              >
                <option value="">Auto-detect by name (Paid Days, Present days, …)</option>
                {[...outputColumns]
                  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                  .map((c) => {
                    const header = (c.header && String(c.header).trim()) || `Column ${(c.order ?? 0) + 1}`;
                    return (
                      <option key={header + (c.order ?? 0)} value={header}>
                        {header}
                      </option>
                    );
                  })}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                Total days column (optional)
              </label>
              <select
                value={statutoryProrateTotalDaysColumnHeader}
                onChange={(e) => setStatutoryProrateTotalDaysColumnHeader(e.target.value)}
                className="w-full max-w-md px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/50 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              >
                <option value="">Auto-detect by name (Month days, Total days, …)</option>
                {[...outputColumns]
                  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                  .map((c) => {
                    const header = (c.header && String(c.header).trim()) || `Column ${(c.order ?? 0) + 1}`;
                    return (
                      <option key={header + (c.order ?? 0)} value={header}>
                        {header}
                      </option>
                    );
                  })}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                Profession Tax slab — earnings column (optional)
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 max-w-xl">
                Dynamic payroll only. If you pick a column here, the <strong>numeric value of that column</strong> (after it is calculated) is used to choose the Profession Tax slab. Leave empty to keep the default: slab from <strong>prorated basic pay</strong>. The column must appear <strong>before</strong> Statutory cumulative in the output column list, and the header must match exactly.
              </p>
              <select
                value={professionTaxSlabEarningsColumnHeader}
                onChange={(e) => setProfessionTaxSlabEarningsColumnHeader(e.target.value)}
                className="w-full max-w-md px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/50 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              >
                <option value="">Use prorated basic pay for PT slab</option>
                {[...outputColumns]
                  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                  .map((c) => {
                    const header = (c.header && String(c.header).trim()) || `Column ${(c.order ?? 0) + 1}`;
                    return (
                      <option key={`pt-${header}-${c.order ?? 0}`} value={header}>
                        {header}
                      </option>
                    );
                  })}
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
