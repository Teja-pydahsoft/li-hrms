'use client';

import React from 'react';
import { ShieldCheck, Plus, Trash2, ArrowRight, UserCheck, LucideIcon } from 'lucide-react';

export interface WorkflowStep {
    stepOrder: number;
    stepName: string;
    approverRole: string;
    isActive: boolean;
    canEditLWD?: boolean;
}

export interface WorkflowData {
    isEnabled: boolean;
    steps: WorkflowStep[];
    finalAuthority: {
        role: string;
        anyHRCanApprove: boolean;
    };
    /** When true, approvers with a role later in the chain can act on requests still at an earlier step */
    allowHigherAuthorityToApproveLowerLevels?: boolean;
}

interface WorkflowManagerProps {
    workflow: WorkflowData;
    onChange: (workflow: WorkflowData) => void;
    title?: string;
    description?: string;
    icon?: LucideIcon;
    addStepLabel?: string;
    isResignationWorkflow?: boolean;
}

const WorkflowManager = ({
    workflow,
    onChange,
    title = "Multi-Level Approval",
    description = "Workflow Engine for automated authorization.",
    icon: Icon = ShieldCheck,
    addStepLabel = "Add Next Approval Stage",
    isResignationWorkflow = false
}: WorkflowManagerProps) => {
    const steps = workflow?.steps || [];

    const updateStatus = (newWorkflow: Partial<WorkflowData>) => {
        const finalWorkflow = {
            isEnabled: true, // Always force true now
            steps: steps,
            finalAuthority: workflow?.finalAuthority || { role: 'admin', anyHRCanApprove: false },
            allowHigherAuthorityToApproveLowerLevels: workflow?.allowHigherAuthorityToApproveLowerLevels ?? false,
            ...newWorkflow
        } as WorkflowData;

        if (finalWorkflow.steps.length > 0) {
            const lastStep = finalWorkflow.steps[finalWorkflow.steps.length - 1];
            finalWorkflow.finalAuthority = {
                ...finalWorkflow.finalAuthority,
                role: lastStep.approverRole
            };
        }
        onChange(finalWorkflow);
    };

    const update = <K extends keyof WorkflowData>(key: K, value: WorkflowData[K]) => {
        updateStatus({ ...workflow, [key]: value });
    };

    const addStep = () => {
        const nextOrder = steps.length + 1;
        const newSteps: WorkflowStep[] = [
            ...steps,
            {
                stepOrder: nextOrder,
                approverRole: 'manager',
                stepName: `Level ${nextOrder} Approval`,
                isActive: true,
                canEditLWD: false,
            },
        ];
        update('steps', newSteps);
    };

    const removeStep = (idx: number) => {
        const newSteps = steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stepOrder: i + 1 }));
        update('steps', newSteps);
    };

    const updateStep = <K extends keyof WorkflowStep>(idx: number, field: K, value: WorkflowStep[K]) => {
        const next = [...steps];
        next[idx] = { ...next[idx], [field]: value };
        update('steps', next);
    };

    const formatRoleName = (role: string) => {
        if (!role) return 'Admin';
        if (role === 'super_admin') return 'Admin';
        return role.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    };

    return (
        <div className="space-y-8 animate-in fade-in zoom-in-95 duration-300">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">
                        <Icon className="h-5 w-5" />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-widest">{title}</h3>
                        <p className="text-xs text-gray-500">{description}</p>
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                {/* Visual Progression Path */}
                <div className="flex flex-wrap items-center gap-3 mb-8 overflow-x-auto pb-2 scrollbar-none">
                    <div className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-[10px] font-bold text-gray-400 uppercase whitespace-nowrap">Employee Application</div>
                    <ArrowRight className="h-3 w-3 text-gray-300 shrink-0" />
                    {steps.map((step, idx) => (
                        <React.Fragment key={idx}>
                            <div className="px-3 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/30 text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase flex items-center gap-2 whitespace-nowrap">
                                {step.stepName || `Level ${step.stepOrder}`}
                            </div>
                            <ArrowRight className="h-3 w-3 text-gray-300 shrink-0" />
                        </React.Fragment>
                    ))}
                    <div className="px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase whitespace-nowrap">Final Approval</div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                    {steps.map((step, idx) => (
                        <div key={idx} className="flex items-center gap-6 p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm relative group">
                            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400 font-bold">
                                {step.stepOrder}
                            </div>
                            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-1">
                                    <label className="text-[10px] text-gray-400 uppercase font-bold tracking-tighter">Step Label</label>
                                    <input
                                        type="text"
                                        value={step.stepName}
                                        onChange={(e) => updateStep(idx, 'stepName', e.target.value)}
                                        className="w-full bg-transparent border-b border-gray-100 dark:border-gray-800 py-1 text-sm outline-none font-medium dark:text-white focus:border-purple-500 transition-colors"
                                        placeholder="e.g. HOD Approval"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] text-gray-400 uppercase font-bold tracking-tighter">Approver Role</label>
                                    <select
                                        value={step.approverRole}
                                        onChange={(e) => updateStep(idx, 'approverRole', e.target.value)}
                                        className="w-full bg-transparent border-b border-gray-100 dark:border-gray-800 py-1 text-sm outline-none font-bold text-purple-600 dark:text-purple-400 cursor-pointer"
                                    >
                                        <option value="reporting_manager">Reporting Manager</option>
                                        <option value="manager">Division Manager</option>
                                        <option value="hod">Dept. Head (HOD)</option>
                                        <option value="hr">HR Executive/Admin</option>
                                        <option value="super_admin">Admin</option>
                                    </select>
                                    {step.approverRole === 'reporting_manager' && (
                                        <p className="text-[9px] text-gray-400 mt-1 italic leading-tight">* Falls back to HOD if no manager is assigned</p>
                                    )}
                                </div>
                                {isResignationWorkflow && (
                                    <div className="flex flex-col justify-center gap-1">
                                        <label className="text-[10px] text-gray-400 uppercase font-bold tracking-tighter">Can Edit LWD</label>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => updateStep(idx, 'canEditLWD', !step.canEditLWD)}
                                                className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${step.canEditLWD ? 'bg-purple-600' : 'bg-gray-200 dark:bg-gray-700'}`}
                                            >
                                                <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${step.canEditLWD ? 'translate-x-5' : 'translate-x-1'}`} />
                                            </button>
                                            <span className="text-[10px] font-medium text-gray-500 uppercase">{step.canEditLWD ? 'Yes' : 'No'}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={() => removeStep(idx)}
                                className="p-2 text-gray-300 hover:text-red-500 transition-colors"
                            >
                                <Trash2 className="h-5 w-5" />
                            </button>
                        </div>
                    ))}
                    <button
                        onClick={addStep}
                        className="flex items-center justify-center gap-2 text-xs font-bold text-gray-400 hover:text-purple-600 py-6 border-2 border-dashed border-gray-100 dark:border-gray-800 rounded-3xl transition-all hover:bg-purple-50/10"
                    >
                        <Plus className="h-4 w-4" /> {addStepLabel}
                    </button>
                </div>

                {/* Allow higher authority to approve lower levels */}
                <div className="flex items-center justify-between p-5 rounded-2xl bg-gray-50/50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800">
                    <div>
                        <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Allow higher authority to approve lower levels</h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">When ON, approvers later in the chain (e.g. HR) can approve or reject even when the request is still at an earlier step (e.g. waiting for HOD).</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => update('allowHigherAuthorityToApproveLowerLevels', !(workflow?.allowHigherAuthorityToApproveLowerLevels ?? false))}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${(workflow?.allowHigherAuthorityToApproveLowerLevels ?? false) ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-700'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${(workflow?.allowHigherAuthorityToApproveLowerLevels ?? false) ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>

                {/* Final Authority Summary Card */}
                <div className="mt-8 p-6 rounded-3xl bg-gray-50/50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
                                <UserCheck className="h-5 w-5" />
                            </div>
                            <div>
                                <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Final Authority</h4>
                                <p className="text-xs font-black text-gray-900 dark:text-white uppercase transition-all">
                                    {steps.length > 0
                                        ? formatRoleName(steps[steps.length - 1].approverRole)
                                        : 'Admin'}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 bg-white dark:bg-gray-800 p-2 sm:p-3 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                            <span className="text-[10px] font-bold text-gray-400 uppercase whitespace-nowrap">Any HR can approve</span>
                            <button
                                onClick={() => update('finalAuthority', {
                                    role: workflow?.finalAuthority?.role || 'admin',
                                    anyHRCanApprove: !workflow?.finalAuthority?.anyHRCanApprove
                                })}
                                className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors ${workflow?.finalAuthority?.anyHRCanApprove ? 'bg-emerald-600' : 'bg-gray-300 dark:bg-gray-700'}`}
                            >
                                <div className={`h-3 w-3 bg-white rounded-full transition-transform ${workflow?.finalAuthority?.anyHRCanApprove ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default WorkflowManager;
