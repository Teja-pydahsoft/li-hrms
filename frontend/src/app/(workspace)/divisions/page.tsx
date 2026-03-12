'use client';

import React, { useState, useEffect } from 'react';
import { api, Division, Department, Designation, Shift } from '@/lib/api';
import Spinner from '@/components/Spinner';
import { useAuth } from '@/contexts/AuthContext';
import { useRoleAccess } from '@/hooks/useRoleAccess';

interface Manager {
    _id: string;
    name: string;
    email: string;
}

// Helper Components
function StatCard({ title, value, icon, trend, color }: {
    title: string;
    value: number;
    icon: React.ReactNode;
    trend: string;
    color: 'emerald' | 'amber' | 'blue' | 'indigo';
}) {
    const gradients = {
        emerald: 'from-emerald-500 to-emerald-600 shadow-emerald-500/20',
        amber: 'from-amber-500 to-amber-600 shadow-amber-500/20',
        blue: 'from-blue-500 to-blue-600 shadow-blue-500/20',
        indigo: 'from-indigo-500 to-indigo-600 shadow-indigo-500/20',
    };

    const bgColors = {
        emerald: 'bg-emerald-50 border-emerald-100',
        amber: 'bg-amber-50 border-amber-100',
        blue: 'bg-blue-50 border-blue-100',
        indigo: 'bg-indigo-50 border-indigo-100',
    };

    return (
        <div className="relative p-4 rounded-2xl transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 group bg-white border border-slate-100 shadow-sm flex items-center gap-4">
            <div className={`shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br ${gradients[color]} flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                {React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<any>, { className: 'w-5 h-5' }) : icon}
            </div>
            <div className="min-w-0">
                <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mb-1 truncate">{title}</p>
                <div className="flex items-center gap-2">
                    <h3 className="text-xl font-black text-slate-900 tracking-tight">{value}</h3>
                    <div className={`hidden sm:inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-bold ${bgColors[color]} text-${color}-700 whitespace-nowrap`}>
                        {trend}
                    </div>
                </div>
            </div>
        </div>
    );
}

// Icons
const EditIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
);

const TrashIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
);

const UserIcon = ({ className = "w-4 h-4" }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
);

const BuildingIcon = ({ className = "w-6 h-6" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
);

const UsersIcon = ({ className = "w-6 h-6" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
);

const ArrowPathIcon = ({ className = "w-6 h-6" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
);

const CheckBadgeIcon = ({ className = "w-6 h-6" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
    </svg>
);

export default function DivisionsPage() {
    const { user, loading: authLoading } = useAuth();
    const { isHR, isSubAdmin, isSuperAdmin } = useRoleAccess();

    const [divisions, setDivisions] = useState<Division[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [managers, setManagers] = useState<Manager[]>([]);
    const [shifts, setShifts] = useState<Shift[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Division form state
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [showEditDialog, setShowEditDialog] = useState<Division | null>(null);
    const [showLinkDeptDialog, setShowLinkDeptDialog] = useState<Division | null>(null);
    const [showShiftDialog, setShowShiftDialog] = useState<Division | null>(null);

    const [name, setName] = useState('');
    const [code, setCode] = useState('');
    const [description, setDescription] = useState('');
    const [managerId, setManagerId] = useState('');
    const [selectedDeptIds, setSelectedDeptIds] = useState<string[]>([]);
    const [linkDeptSearch, setLinkDeptSearch] = useState('');
    const [selectedShifts, setSelectedShifts] = useState<{ shiftId: string; gender: string }[]>([]);
    const [shiftSearch, setShiftSearch] = useState('');

    const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

    // Hierarchical Shift Assignment State
    const [targetScope, setTargetScope] = useState<'division' | 'department' | 'designation'>('division');
    const [targetDeptId, setTargetDeptId] = useState('');
    const [targetDesigId, setTargetDesigId] = useState('');
    const [designations, setDesignations] = useState<Designation[]>([]); // For the selected department

    useEffect(() => {
        if (!authLoading && (isHR || isSubAdmin || isSuperAdmin)) {
            loadData();
        }
    }, [authLoading, isHR, isSubAdmin, isSuperAdmin]);

    const loadData = async () => {
        try {
            setLoading(true);
            const [divRes, deptRes, shiftRes, managerRes] = await Promise.all([
                api.getDivisions(),
                api.getDepartments(true), // Fetch populated departments with designations
                api.getShifts(),
                api.getUsers({ role: 'manager' })
            ]);

            if (divRes.success) setDivisions(divRes.data || []);
            if (deptRes.success) setDepartments(deptRes.data || []);
            if (shiftRes.success) setShifts(shiftRes.data || []);
            if (managerRes.success) setManagers(managerRes.data || []);
        } catch (err) {
            console.error('Error loading division data:', err);
            setError('Failed to load data');
        } finally {
            setLoading(false);
        }
    };

    // Update designations list when department is selected
    useEffect(() => {
        if (targetDeptId) {
            const dept = departments.find(d => d._id === targetDeptId);
            if (dept && dept.designations) {
                // Filter out string references, keep only populated Designation objects
                setDesignations(dept.designations.filter((d): d is Designation => typeof d !== 'string'));
            } else {
                setDesignations([]);
            }
        } else {
            setDesignations([]);
        }
    }, [targetDeptId, departments]);

    // Fetch existing shift assignments when scope/target changes
    useEffect(() => {
        if (!showShiftDialog) return;

        const loadExistingShifts = async () => {
            let existingShifts: { shiftId: string; gender: string }[] = [];
            const divisionId = showShiftDialog._id;

            // Helper to parse Mixed backend response (string ID or Object with shiftId/gender)
            // Backend migration ensures objects, but we handle robustly.
            const parseShifts = (shifts: any[]) => {
                return (shifts || []).map(s => {
                    if (typeof s === 'string') return { shiftId: s, gender: 'All' }; // Should not happen after migration
                    // If it's the new object structure
                    if (s.shiftId) return {
                        shiftId: typeof s.shiftId === 'string' ? s.shiftId : s.shiftId._id,
                        gender: s.gender || 'All'
                    };
                    // Fallback for old object structure (direct Shift object)
                    return { shiftId: s._id, gender: 'All' };
                });
            };

            if (targetScope === 'division') {
                // Load division defaults
                existingShifts = parseShifts(showShiftDialog.shifts || []);
            }
            else if (targetScope === 'department' && targetDeptId) {
                // Load department overrides for this division
                const dept = departments.find(d => d._id === targetDeptId);
                if (dept && dept.divisionDefaults) {
                    const defaultForDiv = dept.divisionDefaults.find(dd => dd.division === divisionId || (dd.division as any)?._id === divisionId);
                    if (defaultForDiv && defaultForDiv.shifts) {
                        existingShifts = parseShifts(defaultForDiv.shifts);
                    }
                }
            }
            else if (targetScope === 'designation' && targetDesigId && targetDeptId) {
                // Load designation overrides for this department AND division
                try {
                    setLoading(true);
                    const res = await api.getDesignation(targetDesigId);
                    if (res.success && res.data) {
                        const des = res.data as Designation;
                        if (des.departmentShifts) {
                            const shiftConfig = des.departmentShifts.find(ds =>
                                (ds.division?.toString() === divisionId || (ds.division as any)?._id === divisionId) &&
                                (ds.department?.toString() === targetDeptId || (ds.department as any)?._id === targetDeptId)
                            );
                            if (shiftConfig) {
                                existingShifts = parseShifts(shiftConfig.shifts);
                            }
                        }
                    }
                } catch (err) {
                    console.error("Error fetching designation shifts", err);
                } finally {
                    setLoading(false);
                }
            }

            setSelectedShifts(existingShifts);
        };

        loadExistingShifts();
    }, [targetScope, targetDeptId, targetDesigId, showShiftDialog, departments]);

    const handleCreateDivision = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const payload: Partial<Division> = { name, code, description };
            if (managerId) payload.manager = managerId as any;
            const res = await api.createDivision(payload);
            if (res.success) {
                setShowCreateDialog(false);
                resetForm();
                loadData();
            } else {
                setError(res.message || 'Failed to create division');
            }
        } catch (err) {
            console.error('Create error:', err);
            setError('An error occurred');
        }
    };

    const handleUpdateDivision = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!showEditDialog) return;
        try {
            const payload: Partial<Division> = { name, code, description };
            if (managerId) payload.manager = managerId as any;
            const res = await api.updateDivision(showEditDialog._id, payload);
            if (res.success) {
                setShowEditDialog(null);
                resetForm();
                loadData();
            } else {
                setError(res.message || 'Failed to update division');
            }
        } catch (err) {
            console.error('Update error:', err);
            setError('An error occurred');
        }
    };

    const handleLinkDepartments = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!showLinkDeptDialog) return;
        try {
            const res = await api.linkDepartmentsToDivision(showLinkDeptDialog._id, { departmentIds: selectedDeptIds, action: 'link' });
            if (res.success) {
                setShowLinkDeptDialog(null);
                setLinkDeptSearch('');
                loadData();
            } else {
                setError(res.message || 'Failed to link departments');
            }
        } catch (err) {
            console.error('Link error:', err);
            setError('An error occurred');
        }
    };

    const handleAssignShifts = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!showShiftDialog) return;

        const payload: { shifts: { shiftId: string; gender: string }[]; targetType?: string; targetId?: string | { designationId: string; departmentId: string } } = { shifts: selectedShifts };

        if (targetScope === 'division') {
            payload.targetType = 'division_general';
        } else if (targetScope === 'department') {
            if (!targetDeptId) {
                setError('Please select a department');
                return;
            }
            payload.targetType = 'department_in_division';
            payload.targetId = targetDeptId;
        } else if (targetScope === 'designation') {
            if (!targetDeptId) {
                setError('Please select a department');
                return;
            }
            if (!targetDesigId) {
                setError('Please select a designation');
                return;
            }
            // Case 4: Designation in Department in Division
            payload.targetType = 'designation_in_dept_in_div';
            payload.targetId = {
                designationId: targetDesigId,
                departmentId: targetDeptId
            };
        }

        try {
            // Assert payload properties as they are definitely assigned above
            const res = await api.assignShiftsToDivision(showShiftDialog._id, payload as any);
            if (res.success) {
                setShowShiftDialog(null);
                setShiftSearch('');
                loadData();
            } else {
                setError(res.message || 'Failed to assign shifts');
            }
        } catch (err) {
            console.error('Assign error:', err);
            setError('An error occurred');
        }
    };

    const handleDeleteDivision = async (id: string) => {
        if (!confirm('Are you sure you want to delete this division?')) return;
        try {
            const res = await api.deleteDivision(id);
            if (res.success) {
                loadData();
            } else {
                alert(res.message || 'Failed to delete division');
            }
        } catch (err) {
            console.error(err);
        }
    };

    const resetForm = () => {
        setName('');
        setCode('');
        setDescription('');
        setManagerId('');
        setError('');
    };

    const resetShiftForm = () => {
        setTargetScope('division');
        setTargetDeptId('');
        setTargetDesigId('');
        setSelectedShifts([]);
        setError('');
    };

    const openShiftDialog = (div: Division) => {
        setShowShiftDialog(div);
        resetShiftForm();
        // Shift loading is handled by useEffect when dialog opens
    };

    if (authLoading) return <div className="flex items-center justify-center h-screen"><Spinner /></div>;

    if (!isHR && !isSubAdmin && !isSuperAdmin) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 text-center">
                <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mb-4 text-red-500">
                    <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 4h.01M5.93 5.43L7.35 6.85m12.72 12.72l-1.42-1.42M9 9l1.41-1.41M15 15l1.41-1.41M12 7h.01M12 11h.01m-4.24 6.36l-1.42-1.42m12.72-12.72l1.42 1.42" />
                    </svg>
                </div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Access Denied</h1>
                <p className="text-slate-500 max-w-md">You are not authorized to access this page. This section is restricted to HR and administrative personnel.</p>
            </div>
        );
    }

    if (loading && divisions.length === 0) return <div className="flex items-center justify-center h-screen"><Spinner /></div>;

    return (
        <div className="relative min-h-screen">


            <div className="relative z-10 px-6 py-2 sm:p-8 lg:p-10">
                <div className="mb-8 flex items-center justify-between gap-4">
                    <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white">Divisions</h1>
                    <button
                        onClick={() => { resetForm(); setShowCreateDialog(true); }}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-700 active:scale-95"
                    >
                        <span className="text-lg leading-none">+</span>
                        <span>Create Division</span>
                    </button>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-6 mb-8">
                    <StatCard
                        title="Total Units"
                        value={divisions.length}
                        icon={<BuildingIcon />}
                        trend="Active divisions"
                        color="blue"
                    />
                    <StatCard
                        title="Linked Depts"
                        value={divisions.reduce((acc, div) => acc + (div.departments?.length || 0), 0)}
                        icon={<UsersIcon />}
                        trend="Across all units"
                        color="emerald"
                    />
                    <StatCard
                        title="Avg. Hierarchy"
                        value={divisions.length ? Math.round(divisions.reduce((acc, div) => acc + (div.departments?.length || 0), 0) / divisions.length) : 0}
                        icon={<ArrowPathIcon />}
                        trend="Depts per division"
                        color="amber"
                    />
                    <StatCard
                        title="Governance"
                        value={divisions.filter(d => d.manager).length}
                        icon={<CheckBadgeIcon />}
                        trend="Units with manager"
                        color="indigo"
                    />
                </div>

                {/* Main Content Area */}
                <div className="bg-white rounded-3xl border border-slate-100 p-4 md:p-8 shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                            <span className="w-1.5 h-6 bg-blue-500 rounded-full" />
                            Organizational Units
                        </h2>
                        <div className="flex items-center gap-4">
                            <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest hidden sm:inline-block">{divisions.length} Divisions Found</span>
                            <div className="flex bg-slate-100 p-1 rounded-lg">
                                <button
                                    onClick={() => setViewMode('cards')}
                                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'cards' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                >
                                    Cards
                                </button>
                                <button
                                    onClick={() => setViewMode('table')}
                                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'table' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                >
                                    Table
                                </button>
                            </div>
                        </div>
                    </div>

                    {divisions.length === 0 ? (
                        <div className="py-20 text-center">
                            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                                <BuildingIcon className="w-10 h-10" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-900">No divisions yet</h3>
                            <p className="text-slate-500 mt-2">Start by creating your first organizational unit.</p>
                        </div>
                    ) : viewMode === 'cards' ? (
                        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
                            {divisions.map((div) => (
                                <div key={div._id} className="group relative flex flex-col p-5 md:p-6 rounded-2xl md:rounded-3xl bg-white border border-slate-300 hover:border-blue-200 hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                                    <div className="flex items-start justify-between mb-6">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center font-black shadow-inner border border-blue-100 group-hover:scale-110 transition-transform">
                                                {div.code.substring(0, 2)}
                                            </div>
                                            <div>
                                                <h3 className="text-lg font-bold text-slate-900 tracking-tight group-hover:text-blue-600 transition-colors">{div.name}</h3>
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{div.code}</span>
                                            </div>
                                        </div>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => { setShowEditDialog(div); setName(div.name); setCode(div.code); setDescription(div.description || ''); setManagerId(typeof div.manager === 'string' ? div.manager : div.manager?._id || ''); }} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"><EditIcon /></button>
                                            <button onClick={() => handleDeleteDivision(div._id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"><TrashIcon /></button>
                                        </div>
                                    </div>

                                    {div.description && (
                                        <p className="text-sm text-slate-500 line-clamp-2 mb-6 min-h-[40px]">
                                            {div.description}
                                        </p>
                                    )}

                                    <div className="mt-auto space-y-4">
                                        <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100/50">
                                            <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center text-slate-400 shadow-sm">
                                                <UserIcon className="w-4 h-4" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Manager</p>
                                                <p className="text-sm font-bold text-slate-700 truncate">{div.manager ? (typeof div.manager === 'string' ? div.manager : (div.manager as any).name) : 'Vacant Position'}</p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            <button
                                                onClick={() => { setShowLinkDeptDialog(div); setSelectedDeptIds(div.departments?.map(d => typeof d === 'string' ? d : d._id) || []); }}
                                                className="flex flex-col items-center justify-center p-3 rounded-2xl bg-indigo-50/50 border border-indigo-100/50 hover:bg-indigo-50 hover:border-indigo-200 transition-all group/btn"
                                            >
                                                <span className="text-lg font-black text-indigo-600">{div.departments?.length || 0}</span>
                                                <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Departments</span>
                                            </button>
                                            <button
                                                onClick={() => openShiftDialog(div)}
                                                className="flex flex-col items-center justify-center p-3 rounded-2xl bg-amber-50/50 border border-amber-100/50 hover:bg-amber-50 hover:border-amber-200 transition-all group/btn"
                                            >
                                                <span className="text-lg font-black text-amber-600 tracking-tighter">Assign</span>
                                                <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">Shifts</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm text-slate-600">
                                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                                    <tr>
                                        <th className="px-4 py-3 font-semibold rounded-tl-xl">Division</th>
                                        <th className="px-4 py-3 font-semibold">Code</th>
                                        <th className="px-4 py-3 font-semibold">Manager</th>
                                        <th className="px-4 py-3 font-semibold text-center">Departments</th>
                                        <th className="px-4 py-3 font-semibold text-right rounded-tr-xl">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {divisions.map((div) => (
                                        <tr key={div._id} className="hover:bg-slate-50/50 transition-colors">
                                            <td className="px-4 py-4 whitespace-nowrap">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs ring-1 ring-blue-100">
                                                        {div.code.substring(0, 2)}
                                                    </div>
                                                    <div>
                                                        <div className="font-bold text-slate-900">{div.name}</div>
                                                        {div.description && <div className="text-xs text-slate-400 max-w-[200px] truncate">{div.description}</div>}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-4 whitespace-nowrap">
                                                <span className="px-2 py-1 bg-slate-100 text-slate-600 font-medium text-xs rounded-md border border-slate-200">
                                                    {div.code}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4 whitespace-nowrap">
                                                <div className="flex items-center gap-2">
                                                    <UserIcon className="w-4 h-4 text-slate-400" />
                                                    <span className="font-medium text-slate-700">
                                                        {div.manager ? (typeof div.manager === 'string' ? div.manager : (div.manager as any).name) : 'Vacant'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-4 whitespace-nowrap text-center">
                                                <div className="inline-flex items-center gap-2">
                                                    <span className="font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md min-w-[2rem] text-center">
                                                        {div.departments?.length || 0}
                                                    </span>
                                                    <button
                                                        onClick={() => { setShowLinkDeptDialog(div); setSelectedDeptIds(div.departments?.map(d => typeof d === 'string' ? d : d._id) || []); }}
                                                        className="text-xs font-semibold text-indigo-500 hover:text-indigo-700 underline underline-offset-2"
                                                    >
                                                        Manage
                                                    </button>
                                                </div>
                                            </td>
                                            <td className="px-4 py-4 whitespace-nowrap text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button
                                                        onClick={() => openShiftDialog(div)}
                                                        className="px-2.5 py-1 text-xs font-medium text-amber-600 bg-amber-50 rounded-md hover:bg-amber-100 transition-colors"
                                                    >
                                                        Shifts
                                                    </button>
                                                    <button
                                                        onClick={() => { setShowEditDialog(div); setName(div.name); setCode(div.code); setDescription(div.description || ''); setManagerId(typeof div.manager === 'string' ? div.manager : div.manager?._id || ''); }}
                                                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                                                    >
                                                        <EditIcon />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteDivision(div._id)}
                                                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                                    >
                                                        <TrashIcon />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Create/Edit Dialog */}
                {(showCreateDialog || showEditDialog) && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => { setShowCreateDialog(false); setShowEditDialog(null); resetForm(); }} />
                        <div className="relative z-50 w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
                            <h2 className="text-xl font-semibold mb-6">{showEditDialog ? 'Edit Division' : 'Create Division'}</h2>
                            <form onSubmit={showEditDialog ? handleUpdateDivision : handleCreateDivision} className="space-y-4">
                                <div>
                                    <label className="mb-2 block text-sm font-medium">Name *</label>
                                    <input type="text" value={name} onChange={e => setName(e.target.value)} required className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900" />
                                </div>
                                <div>
                                    <label className="mb-2 block text-sm font-medium">Code *</label>
                                    <input type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())} required className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900" />
                                </div>
                                <div>
                                    <label className="mb-2 block text-sm font-medium">Description</label>
                                    <textarea value={description} onChange={e => setDescription(e.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900" rows={3} />
                                </div>
                                <div>
                                    <label className="mb-2 block text-sm font-medium">Division Manager (Optional)</label>
                                    <select value={managerId} onChange={e => setManagerId(e.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900">
                                        <option value="">Select Manager (Optional)</option>
                                        {managers.map(user => <option key={user._id} value={user._id}>{user.name} ({user.email})</option>)}
                                    </select>
                                </div>
                                {error && <p className="text-sm text-red-500">{error}</p>}
                                <div className="flex gap-3 pt-2">
                                    <button type="submit" className="flex-1 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700">{showEditDialog ? 'Update' : 'Create'}</button>
                                    <button type="button" onClick={() => { setShowCreateDialog(false); setShowEditDialog(null); resetForm(); }} className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Cancel</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Link Departments Dialog */}
                {showLinkDeptDialog && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => { setShowLinkDeptDialog(null); setLinkDeptSearch(''); }} />
                        <div className="relative z-50 w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
                            <h2 className="text-xl font-semibold mb-4">Link Departments to {showLinkDeptDialog.name}</h2>
                            <form onSubmit={handleLinkDepartments} className="space-y-4">
                                {/* Search */}
                                <div className="relative">
                                    <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                    </svg>
                                    <input
                                        type="text"
                                        placeholder="Search departments by name or code..."
                                        value={linkDeptSearch}
                                        onChange={(e) => setLinkDeptSearch(e.target.value)}
                                        className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-4 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                                    />
                                </div>
                                {/* Select All / Deselect All */}
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const filtered = departments.filter((dept) => {
                                                const search = linkDeptSearch.toLowerCase();
                                                if (!search) return true;
                                                const name = (dept.name || '').toLowerCase();
                                                const code = (dept.code || '').toLowerCase();
                                                return name.includes(search) || code.includes(search);
                                            });
                                            const filteredIds = filtered.map((d) => d._id);
                                            setSelectedDeptIds((prev) => [...new Set([...prev, ...filteredIds])]);
                                        }}
                                        className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400 dark:hover:bg-indigo-900/40"
                                    >
                                        Select All
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const filtered = departments.filter((dept) => {
                                                const search = linkDeptSearch.toLowerCase();
                                                if (!search) return true;
                                                const name = (dept.name || '').toLowerCase();
                                                const code = (dept.code || '').toLowerCase();
                                                return name.includes(search) || code.includes(search);
                                            });
                                            const filteredIds = new Set(filtered.map((d) => d._id));
                                            setSelectedDeptIds((prev) => prev.filter((id) => !filteredIds.has(id)));
                                        }}
                                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                                    >
                                        Deselect All
                                    </button>
                                </div>
                                <div className="max-h-96 overflow-y-auto rounded-2xl border border-slate-100 p-2 dark:border-slate-800">
                                    {departments
                                        .filter((dept) => {
                                            const search = linkDeptSearch.toLowerCase();
                                            if (!search) return true;
                                            const name = (dept.name || '').toLowerCase();
                                            const code = (dept.code || '').toLowerCase();
                                            return name.includes(search) || code.includes(search);
                                        })
                                        .map(dept => (
                                            <label key={dept._id} className="flex items-center gap-3 rounded-xl p-3 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedDeptIds.includes(dept._id)}
                                                    onChange={() => setSelectedDeptIds(prev => prev.includes(dept._id) ? prev.filter(id => id !== dept._id) : [...prev, dept._id])}
                                                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                                                />
                                                <span className="text-sm text-slate-700 dark:text-slate-300 font-medium">{dept.name} <span className="text-xs text-slate-400">({dept.code})</span></span>
                                            </label>
                                        ))}
                                </div>
                                <div className="flex gap-3 pt-4">
                                    <button type="submit" className="flex-1 rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 shadow-lg shadow-indigo-500/30">Save Selection</button>
                                    <button type="button" onClick={() => { setShowLinkDeptDialog(null); setLinkDeptSearch(''); }} className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Cancel</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Assign Shifts Dialog */}
                {showShiftDialog && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => { setShowShiftDialog(null); setShiftSearch(''); }} />
                        <div className="relative z-50 w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
                            <h2 className="text-xl font-semibold mb-4">Assign Shifts - {showShiftDialog.name}</h2>

                            <form onSubmit={handleAssignShifts} className="space-y-4">
                                {/* Scope Selector */}
                                <div className="space-y-2">
                                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Target Scope</label>
                                    <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                                        {(['division', 'department', 'designation'] as const).map((scope) => (
                                            <button
                                                key={scope}
                                                type="button"
                                                onClick={() => { setTargetScope(scope); setSelectedShifts([]); }}
                                                className={`flex-1 rounded-lg py-2 text-xs font-semibold capitalize transition-all ${targetScope === scope
                                                    ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-700 dark:text-blue-400'
                                                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                                                    }`}
                                            >
                                                {scope}
                                            </button>
                                        ))}
                                    </div>
                                    <p className="text-[10px] text-slate-500">
                                        {targetScope === 'division' && "Default shifts for everyone in this Division."}
                                        {targetScope === 'department' && "Override shifts for a specific Department within this Division."}
                                        {targetScope === 'designation' && "Override shifts for a specific Designation within a Department."}
                                    </p>
                                </div>

                                {/* Dynamic Selectors */}
                                {targetScope !== 'division' && (
                                    <div>
                                        <label className="mb-2 block text-sm font-medium">Select Department</label>
                                        <select
                                            value={targetDeptId}
                                            onChange={e => setTargetDeptId(e.target.value)}
                                            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                                            required
                                        >
                                            <option value="">-- Choose Department --</option>
                                            {/* Show only linked departments for this division */}
                                            {showShiftDialog.departments?.map((d: any) => {
                                                const deptDetails = departments.find(dept => dept._id === (typeof d === 'string' ? d : d._id));
                                                return deptDetails ? (
                                                    <option key={deptDetails._id} value={deptDetails._id}>{deptDetails.name}</option>
                                                ) : null;
                                            })}
                                        </select>
                                    </div>
                                )}

                                {targetScope === 'designation' && targetDeptId && (
                                    <div>
                                        <label className="mb-2 block text-sm font-medium">Select Designation</label>
                                        <select
                                            value={targetDesigId}
                                            onChange={e => setTargetDesigId(e.target.value)}
                                            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                                            required
                                        >
                                            <option value="">-- Choose Designation --</option>
                                            {designations.map(desig => (
                                                <option key={desig._id} value={desig._id}>{desig.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <label className="block text-xs font-semibold uppercase text-slate-500">Select Shifts</label>
                                    <div className="relative">
                                        <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                        </svg>
                                        <input
                                            type="text"
                                            placeholder="Search shifts by name or time..."
                                            value={shiftSearch}
                                            onChange={(e) => setShiftSearch(e.target.value)}
                                            className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-4 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                                        />
                                    </div>
                                </div>
                                <div className="max-h-60 overflow-y-auto rounded-2xl border border-slate-100 p-2 dark:border-slate-800">
                                    {shifts.filter(shift => {
                                        const search = shiftSearch.toLowerCase();
                                        if (!search) return true;
                                        const name = (shift.name || '').toLowerCase();
                                        const startTime = (shift.startTime || '').toLowerCase();
                                        const endTime = (shift.endTime || '').toLowerCase();
                                        return name.includes(search) || startTime.includes(search) || endTime.includes(search);
                                    }).map(shift => {
                                        const isSelected = selectedShifts.some(s => s.shiftId === shift._id);
                                        const selectedConfig = selectedShifts.find(s => s.shiftId === shift._id);

                                        return (
                                            <div key={shift._id} className="flex items-center gap-3 rounded-xl p-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => {
                                                        if (isSelected) {
                                                            setSelectedShifts(prev => prev.filter(s => s.shiftId !== shift._id));
                                                        } else {
                                                            setSelectedShifts(prev => [...prev, { shiftId: shift._id, gender: 'All' }]);
                                                        }
                                                    }}
                                                    className="rounded border-slate-300 text-amber-600 focus:ring-amber-500 h-4 w-4 cursor-pointer"
                                                />
                                                <div className="flex-1 cursor-pointer" onClick={() => {
                                                    if (!isSelected) {
                                                        setSelectedShifts(prev => [...prev, { shiftId: shift._id, gender: 'All' }]);
                                                    }
                                                }}>
                                                    <div className="text-sm text-slate-700 dark:text-slate-300 font-semibold">{shift.name}</div>
                                                    <div className="text-[10px] text-slate-500">{shift.startTime} - {shift.endTime} ({shift.duration} mins)</div>
                                                </div>

                                                {/* Gender Selector - Only visible if checked */}
                                                {isSelected && (
                                                    <select
                                                        value={selectedConfig?.gender || 'All'}
                                                        onChange={(e) => {
                                                            const newGender = e.target.value;
                                                            setSelectedShifts(prev => prev.map(s =>
                                                                s.shiftId === shift._id ? { ...s, gender: newGender } : s
                                                            ));
                                                        }}
                                                        className="text-xs rounded-lg border-slate-200 bg-white px-2 py-1 focus:border-amber-500 focus:outline-none dark:bg-slate-900 dark:border-slate-700"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <option value="All">All Genders</option>
                                                        <option value="Male">Male Only</option>
                                                        <option value="Female">Female Only</option>
                                                        <option value="Other">Other</option>
                                                    </select>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                {error && <p className="text-sm text-red-500">{error}</p>}

                                <div className="flex gap-3 pt-4">
                                    <button type="submit" className="flex-1 rounded-2xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white hover:bg-amber-700 shadow-lg shadow-amber-500/30">
                                        Save Assignments
                                    </button>
                                    <button type="button" onClick={() => { setShowShiftDialog(null); setShiftSearch(''); }} className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Cancel</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// End of file
