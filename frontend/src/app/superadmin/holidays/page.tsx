'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { api, Holiday, HolidayGroup, Division, Department, EmployeeGroup } from '@/lib/api';
import { toast } from 'react-toastify';
import Swal from 'sweetalert2';

import {
    format,
    addMonths,
    subMonths,
    startOfMonth,
    endOfMonth,
    startOfWeek,
    endOfWeek,
    eachDayOfInterval,
    isSameMonth,
    isToday,
    parseISO
} from 'date-fns';
import { Trash2, Users, Filter, Plus, ChevronLeft, ChevronRight, ChevronDown, Calendar as CalendarIcon, Save, X } from 'lucide-react';
import { HolidaySkeleton } from './HolidaySkeleton';

export default function HolidayManagementPage() {
    const [activeTab, setActiveTab] = useState<'master' | 'groups'>('master');
    const [loading, setLoading] = useState(true);
    const [allHolidays, setAllHolidays] = useState<Holiday[]>([]);
    const [groups, setGroups] = useState<HolidayGroup[]>([]);
    const [divisions, setDivisions] = useState<Division[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [employeeGroups, setEmployeeGroups] = useState<EmployeeGroup[]>([]);
    const [selectedGroupId, setSelectedGroupId] = useState<string>('GLOBAL');

    // Form States
    const [showHolidayForm, setShowHolidayForm] = useState(false);
    const [editingHoliday, setEditingHoliday] = useState<Holiday | null>(null);
    const [showGroupForm, setShowGroupForm] = useState(false);
    const [editingGroup, setEditingGroup] = useState<HolidayGroup | null>(null);
    const [prefilledDate, setPrefilledDate] = useState<string | null>(null);
    const [applicableTo, setApplicableTo] = useState<"ALL" | "SPECIFIC_GROUPS">("ALL");

    useEffect(() => {
        if (showHolidayForm) {
            setApplicableTo(editingHoliday?.applicableTo || 'ALL');
        }
    }, [showHolidayForm, editingHoliday]);

    // Filter Date/Year
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const selectedYear = currentMonth.getFullYear();

    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            const response = await api.getAllHolidaysAdmin(selectedYear);
            if (response.success && response.data) {
                setAllHolidays(response.data.holidays);
                setGroups(response.data.groups);
            }
        } catch (err) {
            console.error('Error loading holidays:', err);
        } finally {
            setLoading(false);
        }
    }, [selectedYear]);

    const loadDivisionsAndDepartments = useCallback(async () => {
        try {
            const [divRes, deptRes, groupRes] = await Promise.all([
                api.getDivisions(),
                api.getDepartments(),
                api.getEmployeeGroups(true)
            ]);
            if (divRes.success) setDivisions(divRes.data || []);
            if (deptRes.success) setDepartments(deptRes.data || []);
            if (groupRes.success) setEmployeeGroups(groupRes.data || []);
        } catch (err) {
            console.error('Error loading metadata:', err);
        }
    }, []);

    useEffect(() => {
        loadData();
        loadDivisionsAndDepartments();
    }, [loadData, loadDivisionsAndDepartments]);

    const handleDeleteHoliday = async (id: string) => {
        const holiday = allHolidays.find(h => h._id === id);
        const isGroupView = selectedGroupId !== 'GLOBAL';

        if (isGroupView && holiday?.scope === 'GLOBAL') {
            alert('You cannot delete a Global holiday from a Group view. Please edit the Global calendar to remove it, or use an override to mark it as a working day (feature coming soon).');
            return;
        }

        if (!confirm('Are you sure you want to delete this holiday?')) return;
        try {
            await api.deleteHoliday(id, { onDeleteAction: 'RESTORE_PATTERN' });
            loadData();
        } catch (err) {
            console.error('Error deleting holiday:', err);
        }
    };

    const handleDeleteGroup = async (id: string) => {
        if (!confirm('Are you sure you want to delete this group?')) return;
        try {
            const response = await api.deleteHolidayGroup(id);
            if (response.success) {
                loadData();
            } else {
                alert(response.message);
            }
        } catch (err) {
            console.error('Error deleting group:', err);
        }
    };

    const calendarDays = useMemo(() => {
        const monthStart = startOfMonth(currentMonth);
        const monthEnd = endOfMonth(monthStart);
        const startDate = startOfWeek(monthStart);
        const endDate = endOfWeek(monthEnd);

        return eachDayOfInterval({
            start: startDate,
            end: endDate,
        });
    }, [currentMonth]);

    const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
    const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

    const currentHolidays = useMemo(() => {
        if (selectedGroupId === 'GLOBAL') {
            return allHolidays.filter(h => h.scope === 'GLOBAL');
        } else {
            // With Propagation Logic, we don't need to merge Global holidays manually.
            // The Group copies already exist in the database.
            return allHolidays.filter(h =>
                (h.scope === 'GROUP' && (h.groupId && typeof h.groupId === 'object' ? h.groupId._id : h.groupId) === selectedGroupId)
            );
        }
    }, [allHolidays, selectedGroupId]);

    const getHolidaysForDate = (date: Date) => {
        const dateStr = format(date, 'yyyy-MM-dd');
        return currentHolidays.filter(h => {
            const hDate = typeof h.date === 'string' ? parseISO(h.date) : new Date(h.date);
            const startDateStr = format(hDate, 'yyyy-MM-dd');

            if (h.endDate) {
                const hEndDate = typeof h.endDate === 'string' ? parseISO(h.endDate) : new Date(h.endDate);
                const endDateStr = format(hEndDate, 'yyyy-MM-dd');
                return dateStr >= startDateStr && dateStr <= endDateStr;
            }

            return startDateStr === dateStr;
        });
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
            <div className="mx-auto w-full px-4 py-8 sm:px-6 lg:px-8">
                {/* Header */}
                <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Holiday Calendar</h1>
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Manage master holidays and group-specific calendars</p>
                    </div>
                </div>

                {/* Tabs */}
                <div className="mb-6 border-b border-slate-200 dark:border-slate-700">
                    <nav className="-mb-px flex space-x-8">
                        <button
                            onClick={() => setActiveTab('master')}
                            className={`whitespace-nowrap border-b-2 px-1 pb-4 text-sm font-medium transition-colors ${activeTab === 'master'
                                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
                                }`}
                        >
                            Calendar View
                        </button>
                        <button
                            onClick={() => setActiveTab('groups')}
                            className={`whitespace-nowrap border-b-2 px-1 pb-4 text-sm font-medium transition-colors ${activeTab === 'groups'
                                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
                                }`}
                        >
                            Holiday Groups
                        </button>
                    </nav>
                </div>

                {loading ? (
                    <HolidaySkeleton />
                ) : (
                    <div>
                        {activeTab === 'master' ? (
                            <div className="space-y-6">
                                {/* Calendar Header Controls */}
                                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800">
                                    <div className="flex items-center gap-4">
                                        <div className="relative group">
                                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                <Filter className="h-4 w-4 text-slate-400 group-hover:text-blue-500 transition-colors" />
                                            </div>
                                            <select
                                                value={selectedGroupId}
                                                onChange={(e) => setSelectedGroupId(e.target.value)}
                                                className="pl-9 pr-10 py-2 bg-slate-50 dark:bg-slate-800 border-none text-sm font-bold text-slate-700 dark:text-slate-200 rounded-xl cursor-pointer focus:ring-2 focus:ring-blue-500/20 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-all appearance-none"
                                            >
                                                <option value="GLOBAL">Global Calendar</option>
                                                {groups.map(g => (
                                                    <option key={g._id} value={g._id}>{g.name}</option>
                                                ))}
                                            </select>
                                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                                                <ChevronDown className="h-4 w-4 text-slate-400" />
                                            </div>
                                        </div>

                                        <div className="h-8 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block"></div>

                                        <div className="flex items-center gap-3">
                                            <h2 className="text-lg font-bold text-slate-900 dark:text-white min-w-[140px]">
                                                {format(currentMonth, 'MMMM yyyy')}
                                            </h2>
                                            <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-1 gap-1">
                                                <button
                                                    onClick={prevMonth}
                                                    className="p-1 hover:bg-white dark:hover:bg-slate-700 rounded-md shadow-sm text-slate-500 dark:text-slate-400 transition-all"
                                                >
                                                    <ChevronLeft className="h-4 w-4" />
                                                </button>
                                                <button
                                                    onClick={() => setCurrentMonth(new Date())}
                                                    className="px-3 py-1 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider hover:text-blue-600 transition-colors"
                                                >
                                                    Today
                                                </button>
                                                <button
                                                    onClick={nextMonth}
                                                    className="p-1 hover:bg-white dark:hover:bg-slate-700 rounded-md shadow-sm text-slate-500 dark:text-slate-400 transition-all"
                                                >
                                                    <ChevronRight className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3 w-full sm:w-auto">
                                        <button
                                            onClick={() => {
                                                setEditingHoliday(null);
                                                setPrefilledDate(null);
                                                setShowHolidayForm(true);
                                            }}
                                            className="flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-500/25 hover:bg-blue-700 hover:scale-105 active:scale-95 transition-all"
                                        >
                                            <Plus className="h-5 w-5" />
                                            Add Holiday
                                        </button>
                                    </div>
                                </div>

                                {/* Calendar Grid */}
                                <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/50 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
                                    {/* Days Header */}
                                    <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/80 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
                                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                                            <div key={day} className="py-4 text-center text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                                                {day}
                                            </div>
                                        ))}
                                    </div>
                                    <div className="grid grid-cols-7 border-slate-100 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 gap-px">
                                        {calendarDays.map((date, idx) => {
                                            const holidays = getHolidaysForDate(date);
                                            const isCurrentMonth = isSameMonth(date, currentMonth);
                                            const isTodayDate = isToday(date);

                                            return (
                                                <div
                                                    key={idx}
                                                    onClick={() => {
                                                        if (holidays.length === 0) {
                                                            setPrefilledDate(format(date, 'yyyy-MM-dd'));
                                                            setEditingHoliday(null);
                                                            setShowHolidayForm(true);
                                                        }
                                                    }}
                                                    className={`min-h-[140px] p-2 bg-white dark:bg-slate-900 transition-all hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer group relative ${!isCurrentMonth ? 'bg-slate-50/50 text-slate-300 dark:bg-slate-900/50 dark:text-slate-700' : ''
                                                        }`}
                                                >
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-all ${isTodayDate
                                                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30 scale-110'
                                                            : isCurrentMonth ? 'text-slate-700 group-hover:bg-slate-100 dark:text-slate-300 dark:group-hover:bg-slate-800' : 'text-slate-400 dark:text-slate-600'
                                                            }`}>
                                                            {format(date, 'd')}
                                                        </span>
                                                        {holidays.length > 0 && (
                                                            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 ring-2 ring-blue-100 dark:ring-blue-900/30"></span>
                                                        )}
                                                    </div>

                                                    <div className="space-y-1.5 overflow-y-auto max-h-[90px] scrollbar-hide">
                                                        {holidays.map(h => (
                                                            <div
                                                                key={h._id}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setEditingHoliday(h);
                                                                    setPrefilledDate(null);
                                                                    setShowHolidayForm(true);
                                                                }}
                                                                className={`group/event relative flex flex-col rounded-lg px-2.5 py-1.5 transition-all hover:scale-[1.02] hover:shadow-md cursor-pointer border ${h.type === 'National' ? 'bg-emerald-50 border-emerald-100/50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-800/30 dark:text-emerald-400' :
                                                                    h.type === 'Regional' ? 'bg-blue-50 border-blue-100/50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:border-blue-800/30 dark:text-blue-400' :
                                                                        h.type === 'Optional' ? 'bg-fuchsia-50 border-fuchsia-100/50 text-fuchsia-700 hover:bg-fuchsia-100 dark:bg-fuchsia-900/20 dark:border-fuchsia-800/30 dark:text-fuchsia-400' :
                                                                            h.type === 'Academic' ? 'bg-cyan-50 border-cyan-100/50 text-cyan-700 hover:bg-cyan-100 dark:bg-cyan-900/20 dark:border-cyan-800/30 dark:text-cyan-400' :
                                                                                h.type === 'Observance' ? 'bg-slate-100 border-slate-200/50 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:border-slate-700/30 dark:text-slate-300' :
                                                                                    h.type === 'Seasonal' ? 'bg-lime-50 border-lime-100/50 text-lime-700 hover:bg-lime-100 dark:bg-lime-900/20 dark:border-lime-800/30 dark:text-lime-400' :
                                                                                        'bg-amber-50 border-amber-100/50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/20 dark:border-amber-800/30 dark:text-amber-400'
                                                                    }`}
                                                            >
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className="text-[10px] font-bold uppercase tracking-tight truncate leading-tight flex-1">
                                                                        {h.name}
                                                                    </span>
                                                                    {h.sourceHolidayId && (
                                                                        <div className={`h-1.5 w-1.5 rounded-full ring-1 ring-offset-1 ring-offset-white dark:ring-offset-slate-900 ${h.isSynced !== false ? 'bg-blue-500 ring-blue-500' : 'bg-amber-500 ring-amber-500'}`} title={h.isSynced !== false ? 'Global Holiday (Synced)' : 'Global Holiday (Modified)'} />
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center justify-between gap-1 overflow-hidden mt-0.5">
                                                                    <span className="text-[9px] opacity-70 font-semibold truncate uppercase tracking-wider">
                                                                        {h.type}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                <div className="flex justify-end">
                                    <button
                                        onClick={() => {
                                            setEditingGroup(null);
                                            setShowGroupForm(true);
                                        }}
                                        className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
                                    >
                                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                        </svg>
                                        Create Holiday Group
                                    </button>
                                </div>

                                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                                    {groups.map((group) => (
                                        <div key={group._id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                                            <div className="mb-4 flex items-start justify-between">
                                                <div>
                                                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{group.name}</h3>
                                                    <p className="text-sm text-slate-500 dark:text-slate-400">{group.description || 'No description'}</p>
                                                </div>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => {
                                                            setEditingGroup(group);
                                                            setShowGroupForm(true);
                                                        }}
                                                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                                                    >
                                                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                        </svg>
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteGroup(group._id)}
                                                        className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                                                    >
                                                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="mt-auto space-y-3">
                                                <div className="mt-1 space-y-1">
                                                    {(group.divisionMapping || []).map((map, idx: number) => (
                                                        <div key={idx} className="flex flex-wrap items-center gap-1 text-[11px] bg-slate-50 dark:bg-slate-900 px-2 py-1 rounded border border-slate-100 dark:border-slate-700">
                                                            <span className="font-bold text-slate-700 dark:text-slate-300">
                                                                {typeof map.division === 'object' ? map.division.name : 'Division'}
                                                            </span>
                                                            <span className="text-slate-400">→</span>
                                                            <span className="text-blue-600 dark:text-blue-400">
                                                                {map.departments && map.departments.length > 0 ? (
                                                                    map.departments.map((d, i: number) => (
                                                                        <span key={i}>
                                                                            {typeof d === 'object' ? d.name : 'Dept'}
                                                                            {i < map.departments.length - 1 ? ', ' : ''}
                                                                        </span>
                                                                    ))
                                                                ) : 'All Departments'}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            <button
                                                onClick={() => {
                                                    setSelectedGroupId(group._id);
                                                    setActiveTab('master');
                                                }}
                                                className="mt-4 flex items-center justify-center gap-2 w-full py-2.5 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/30 rounded-xl transition-all"
                                            >
                                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                </svg>
                                                View Group Calendar
                                            </button>
                                        </div>
                                    ))}
                                    {groups.length === 0 && (
                                        <div className="col-span-full rounded-xl border border-dashed border-slate-300 p-12 text-center dark:border-slate-700">
                                            <p className="text-slate-500 dark:text-slate-400">No holiday groups created yet.</p>
                                            <button
                                                onClick={() => setShowGroupForm(true)}
                                                className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
                                            >
                                                Create your first group
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Holiday Form Drawer */}
            {
                showHolidayForm && (
                    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm transition-opacity">
                        {/* Drawer Container */}
                        <div className="w-full max-w-md h-full bg-white dark:bg-slate-900 shadow-2xl border-l border-slate-200 dark:border-slate-700 flex flex-col transform transition-transform animate-in slide-in-from-right duration-300">

                            {/* Drawer Header */}
                            <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md z-10">
                                <div>
                                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                                        {editingHoliday ? 'Edit Holiday' : (selectedGroupId === 'GLOBAL' ? 'Add Global Holiday' : 'Add Group Holiday')}
                                    </h2>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                        {selectedGroupId === 'GLOBAL' ? 'Visible to all employees' : `For ${groups.find(g => g._id === selectedGroupId)?.name}`}
                                    </p>
                                </div>
                                <button
                                    onClick={() => {
                                        setShowHolidayForm(false);
                                        setPrefilledDate(null);
                                    }}
                                    className="p-2 -mr-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Drawer Body - Scrollable */}
                            <div className="flex-1 overflow-y-auto custom-scrollbar">
                                <form id="holiday-form" onSubmit={async (e) => {
                                    e.preventDefault();
                                    const formData = new FormData(e.currentTarget);
                                    const isGlobalContext = editingHoliday ? editingHoliday.scope === 'GLOBAL' : selectedGroupId === 'GLOBAL';
                                    const isCreatingOverride = !isGlobalContext && editingHoliday?.scope === 'GLOBAL';
                                    const applicableTo = isGlobalContext ? (formData.get('applicableTo') as "ALL" | "SPECIFIC_GROUPS") : 'SPECIFIC_GROUPS';

                                    // START LOADING
                                    const submitBtn = e.currentTarget.querySelector('button[type="submit"]') as HTMLButtonElement;
                                    if (submitBtn) {
                                        submitBtn.disabled = true;
                                        submitBtn.innerHTML = `<span class="flex items-center gap-2"><svg class="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Processing...</span>`;
                                    }

                                    try {
                                        const data: Partial<Holiday> & { isMaster: boolean, scope: string, applicableTo: string, groupId?: string, targetGroupIds?: string[], endDate?: string, overridesMasterId?: string } = {
                                            name: formData.get('name') as string,
                                            date: formData.get('date') as string,
                                            endDate: formData.get('endDate') as string || undefined,
                                            type: formData.get('type') as Holiday['type'],
                                            description: formData.get('description') as string,
                                            isMaster: isGlobalContext,
                                            scope: isGlobalContext ? 'GLOBAL' : 'GROUP',
                                            applicableTo,
                                            groupId: isGlobalContext ? undefined : (selectedGroupId !== 'GLOBAL' ? selectedGroupId : (editingHoliday?.groupId as string)),
                                            targetGroupIds: isGlobalContext && applicableTo === 'SPECIFIC_GROUPS' ? formData.getAll('targetGroupIds') as string[] : undefined
                                        };

                                        if (editingHoliday) {
                                            if (isCreatingOverride) {
                                                data.overridesMasterId = editingHoliday._id;
                                            } else {
                                                data._id = editingHoliday._id;
                                            }
                                            const res = await api.updateHoliday({ ...data, rosterFillMode: 'HOL' });
                                            if (!res.success) throw new Error(res.message);

                                            await Swal.fire({
                                                icon: 'success',
                                                title: isCreatingOverride ? 'Override Created' : 'Holiday Updated',
                                                text: isCreatingOverride ? 'Holiday override created successfully.' : 'Holiday details updated successfully.',
                                                timer: 2000,
                                                showConfirmButton: false,
                                                customClass: { popup: 'rounded-2xl' }
                                            });
                                        } else {
                                            const res = await api.createHoliday({ ...data, rosterFillMode: 'HOL' });
                                            if (!res.success) throw new Error(res.message);

                                            await Swal.fire({
                                                icon: 'success',
                                                title: 'Holiday Created',
                                                text: 'New holiday has been added to the calendar.',
                                                timer: 2000,
                                                showConfirmButton: false,
                                                customClass: { popup: 'rounded-2xl' }
                                            });
                                        }

                                        setShowHolidayForm(false);
                                        loadData();
                                        setEditingHoliday(null);

                                    } catch (error: unknown) {
                                        console.error(error);
                                        const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred.';
                                        await Swal.fire({
                                            icon: 'error',
                                            title: 'Operation Failed',
                                            text: errorMessage,
                                            customClass: { popup: 'rounded-2xl' }
                                        });
                                    } finally {
                                        // STOP LOADING
                                        if (submitBtn) {
                                            submitBtn.disabled = false;
                                            submitBtn.innerHTML = editingHoliday ? (
                                                selectedGroupId !== 'GLOBAL' && editingHoliday.scope === 'GLOBAL' ? 'Create Override' : 'Update Event'
                                            ) : 'Create Event';
                                        }
                                    }
                                }} className="p-6 space-y-8">

                                    {/* Section 1: Basic Details */}
                                    <div className="space-y-5">
                                        <div className="flex items-center gap-2 mb-2">
                                            <CalendarIcon className="h-4 w-4 text-blue-500" />
                                            <h3 className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">Event Details</h3>
                                        </div>

                                        <div className="space-y-4">
                                            <div>
                                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Event Title <span className="text-red-500">*</span></label>
                                                <input
                                                    type="text"
                                                    name="name"
                                                    required
                                                    defaultValue={editingHoliday?.name}
                                                    placeholder="e.g., Independence Day"
                                                    className="w-full rounded-xl border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:border-blue-500 focus:ring-blue-500 transition-all text-sm py-2.5"
                                                />
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Type</label>
                                                    <select
                                                        name="type"
                                                        defaultValue={editingHoliday?.type || 'National'}
                                                        className="w-full rounded-xl border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:border-blue-500 focus:ring-blue-500 text-sm py-2.5"
                                                    >
                                                        <option value="National">National</option>
                                                        <option value="Regional">Regional</option>
                                                        <option value="Optional">Optional</option>
                                                        <option value="Observance">Observance</option>
                                                        <option value="Seasonal">Seasonal</option>
                                                        <option value="Academic">Academic</option>
                                                    </select>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Start Date <span className="text-red-500">*</span></label>
                                                    <input
                                                        type="date"
                                                        name="date"
                                                        required
                                                        defaultValue={prefilledDate || (editingHoliday ? format(parseISO(editingHoliday.date), 'yyyy-MM-dd') : '')}
                                                        className="w-full rounded-xl border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:border-blue-500 focus:ring-blue-500 transition-all text-sm py-2.5"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">End Date</label>
                                                    <input
                                                        type="date"
                                                        name="endDate"
                                                        defaultValue={editingHoliday?.endDate ? format(parseISO(editingHoliday.endDate), 'yyyy-MM-dd') : ''}
                                                        className="w-full rounded-xl border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:border-blue-500 focus:ring-blue-500 text-sm py-2.5"
                                                    />
                                                </div>
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Description</label>
                                                <textarea
                                                    name="description"
                                                    rows={3}
                                                    defaultValue={editingHoliday?.description}
                                                    className="w-full rounded-xl border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:border-blue-500 focus:ring-blue-500 text-sm p-3"
                                                    placeholder="Additional details..."
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="w-full h-px bg-slate-100 dark:bg-slate-700/50"></div>

                                    {/* Section 2: Target Audience */}
                                    <div className="space-y-5">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Users className="h-4 w-4 text-orange-500" />
                                            <h3 className="text-xs font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wider">Target Audience</h3>
                                        </div>

                                        <div className="space-y-4">
                                            {(editingHoliday ? editingHoliday.scope === 'GLOBAL' : selectedGroupId === 'GLOBAL') ? (
                                                <>
                                                    <div className="space-y-3">
                                                        <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${applicableTo === 'ALL' ? 'bg-blue-50 border-blue-200 shadow-sm ring-1 ring-blue-500/20' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-blue-300'}`}>
                                                            <input
                                                                type="radio"
                                                                name="applicableTo"
                                                                value="ALL"
                                                                checked={applicableTo === 'ALL'}
                                                                onChange={() => setApplicableTo('ALL')}
                                                                className="mt-1 h-4 w-4 text-blue-600 border-slate-300 focus:ring-blue-500"
                                                            />
                                                            <div>
                                                                <span className="block text-sm font-bold text-slate-900 dark:text-white">Global (All Employees)</span>
                                                                <span className="text-xs text-slate-500 dark:text-slate-400">Applies to everyone across all groups</span>
                                                            </div>
                                                        </label>

                                                        <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${applicableTo === 'SPECIFIC_GROUPS' ? 'bg-blue-50 border-blue-200 shadow-sm ring-1 ring-blue-500/20' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-blue-300'}`}>
                                                            <input
                                                                type="radio"
                                                                name="applicableTo"
                                                                value="SPECIFIC_GROUPS"
                                                                checked={applicableTo === 'SPECIFIC_GROUPS'}
                                                                onChange={() => setApplicableTo('SPECIFIC_GROUPS')}
                                                                className="mt-1 h-4 w-4 text-blue-600 border-slate-300 focus:ring-blue-500"
                                                            />
                                                            <div>
                                                                <span className="block text-sm font-bold text-slate-900 dark:text-white">Specific Holiday Groups</span>
                                                                <span className="text-xs text-slate-500 dark:text-slate-400">Select specific groups to apply this holiday to</span>
                                                            </div>
                                                        </label>
                                                    </div>

                                                    <div className={`space-y-2 transition-all duration-300 origin-top ${applicableTo === 'SPECIFIC_GROUPS' ? 'opacity-100 max-h-[400px]' : 'opacity-40 max-h-[100px] pointer-events-none blur-[1px]'}`}>
                                                        <div className="flex items-center justify-between">
                                                            <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Select Groups</div>
                                                        </div>

                                                        <div className="max-h-[220px] overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                                                            {groups.map(group => (
                                                                <label key={group._id} className="flex items-center gap-3 p-2.5 rounded-lg border border-transparent hover:bg-white hover:border-slate-200 dark:hover:bg-slate-800 dark:hover:border-slate-700 transition-all cursor-pointer group/item">
                                                                    <input
                                                                        type="checkbox"
                                                                        name="targetGroupIds"
                                                                        value={group._id}
                                                                        defaultChecked={editingHoliday?.targetGroupIds?.some(tg => (typeof tg === 'object' ? tg._id : tg) === group._id)}
                                                                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 transition-colors"
                                                                    />
                                                                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 group-hover/item:text-slate-900 dark:group-hover/item:text-white transition-colors">
                                                                        {group.name}
                                                                    </span>
                                                                </label>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="space-y-4">
                                                    <div className="p-4 bg-orange-50 dark:bg-orange-900/20 rounded-xl border border-orange-100 dark:border-orange-800">
                                                        <h4 className="text-xs font-bold text-orange-700 dark:text-orange-400 mb-1">Group Context</h4>
                                                        <p className="text-[11px] text-orange-600 dark:text-orange-500 leading-normal">
                                                            This holiday is exclusive to <strong>{groups.find(g => g._id === (editingHoliday?.groupId as string || selectedGroupId))?.name}</strong>.
                                                        </p>
                                                    </div>

                                                    <div className="space-y-3">
                                                        <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase">Applicable Divisions</label>
                                                        {groups.find(g => g._id === (editingHoliday?.groupId as string || selectedGroupId))?.divisionMapping.map((m, idx) => (
                                                            <div key={idx} className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
                                                                <div className="text-xs font-bold text-slate-900 dark:text-white">
                                                                    {typeof m.division === 'object' ? m.division.name : 'Selected Division'}
                                                                </div>
                                                                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                                                                    {m.departments.length > 0 ? m.departments.map(d => typeof d === 'object' ? d.name : 'Dept').join(', ') : 'All Departments'}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </form>
                            </div>

                            {/* Drawer Footer - Fixed */}
                            <div className="p-6 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                                <div className="flex items-center justify-between gap-4">
                                    <div className="flex gap-2">
                                        {editingHoliday && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    Swal.fire({
                                                        title: 'Are you sure?',
                                                        text: selectedGroupId !== 'GLOBAL' && editingHoliday.scope === 'GROUP' && (editingHoliday.sourceHolidayId || editingHoliday.isMaster)
                                                            ? "This will remove this holiday from THIS group only. The Global holiday will remain."
                                                            : "You won't be able to revert this!",
                                                        icon: 'warning',
                                                        showCancelButton: true,
                                                        confirmButtonColor: '#ef4444',
                                                        cancelButtonColor: '#64748b',
                                                        confirmButtonText: 'Yes, delete it!',
                                                        customClass: {
                                                            popup: 'rounded-3xl',
                                                            confirmButton: 'rounded-xl',
                                                            cancelButton: 'rounded-xl'
                                                        }
                                                    }).then((result) => {
                                                        if (result.isConfirmed) {
                                                            handleDeleteHoliday(editingHoliday._id);
                                                            setShowHolidayForm(false);
                                                            toast.success('Holiday deleted.');
                                                        }
                                                    });
                                                }}
                                                className="p-2.5 text-red-500 hover:bg-red-50 hover:text-red-600 rounded-xl transition-colors"
                                                title="Delete Holiday"
                                            >
                                                <Trash2 className="h-5 w-5" />
                                            </button>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={() => setShowHolidayForm(false)}
                                            className="px-6 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="submit"
                                            form="holiday-form"
                                            className="flex items-center gap-2 px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-lg shadow-blue-500/30 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed"
                                        >
                                            <Save className="h-4 w-4" />
                                            {editingHoliday ? (
                                                selectedGroupId !== 'GLOBAL' && editingHoliday.scope === 'GLOBAL' ? 'Create Override' : 'Update Event'
                                            ) : 'Create Event'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Group Form Modal */}
            {
                showGroupForm && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                        <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                            <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
                                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                                    {editingGroup ? 'Edit Holiday Group' : 'Create Holiday Group'}
                                </h2>
                                <button
                                    onClick={() => setShowGroupForm(false)}
                                    className="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300"
                                >
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            <HolidayGroupForm
                                editing={editingGroup}
                                divisions={divisions}
                                departments={departments}
                                employeeGroups={employeeGroups}
                                onClose={() => setShowGroupForm(false)}
                                onSave={() => {
                                    setShowGroupForm(false);
                                    loadData();
                                }}
                            />
                        </div>
                    </div>
                )
            }
        </div >
    );
}

function HolidayGroupForm({ editing, divisions, departments, employeeGroups, onClose, onSave }: {
    editing: HolidayGroup | null;
    divisions: Division[];
    departments: Department[];
    employeeGroups: EmployeeGroup[];
    onClose: () => void;
    onSave: () => void;
}) {
    const [name, setName] = useState(editing?.name || '');
    const [description, setDescription] = useState(editing?.description || '');
    const [mapping, setMapping] = useState<{ division: string; departments: string[]; employeeGroups: string[] }[]>(
        editing?.divisionMapping?.map(m => ({
            division: typeof m.division === 'object' ? m.division._id : m.division,
            departments: m.departments.map(d => typeof d === 'object' ? d._id : d),
            employeeGroups: (m.employeeGroups || []).map(g => typeof g === 'object' ? g._id : g)
        })) || [{ division: '', departments: [], employeeGroups: [] }]
    );

    const addMapping = () => setMapping([...mapping, { division: '', departments: [], employeeGroups: [] }]);
    const removeMapping = (idx: number) => setMapping(mapping.filter((_, i) => i !== idx));

    const updateMapping = (idx: number, field: 'division' | 'departments' | 'employeeGroups', value: string | string[]) => {
        const newMapping = [...mapping];
        newMapping[idx] = { ...newMapping[idx], [field]: value };
        setMapping(newMapping);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const data = {
                _id: editing?._id,
                name,
                description,
                divisionMapping: mapping.filter(m => m.division),
                isActive: true
            };
            const res = await api.saveHolidayGroup(data);
            if (!res.success) throw new Error(res.message);
            onSave();
        } catch (err: unknown) {
            console.error(err);
            const errorMessage = err instanceof Error ? err.message : 'Failed to save group';
            toast.error(errorMessage);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto custom-scrollbar">
            <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Group Name *</label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description</label>
                <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                />
            </div>

            <div className="pt-4">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Division & Department Mappings</h3>
                    <button
                        type="button"
                        onClick={addMapping}
                        className="text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-500 flex items-center gap-1"
                    >
                        <Plus className="h-3 w-3" /> Add Mapping
                    </button>
                </div>

                <div className="space-y-4">
                    {mapping.map((m, idx) => (
                        <div key={idx} className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 relative">
                            {mapping.length > 1 && (
                                <button
                                    type="button"
                                    onClick={() => removeMapping(idx)}
                                    className="absolute top-2 right-2 text-slate-400 hover:text-red-500 transition-colors"
                                >
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            )}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Division *</label>
                                    <select
                                        value={m.division}
                                        onChange={(e) => {
                                            const newMapping = [...mapping];
                                            newMapping[idx] = { division: e.target.value, departments: [], employeeGroups: [] };
                                            setMapping(newMapping);
                                        }}
                                        required
                                        className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                                    >
                                        <option value="">Select Division</option>
                                        {divisions.map(div => (
                                            <option key={div._id} value={div._id}>{div.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <div className="space-y-2">
                                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Department Targeting</label>
                                        <div className="flex items-center gap-4 text-xs">
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="radio"
                                                    checked={m.departments.length === 0}
                                                    onChange={() => updateMapping(idx, 'departments', [])}
                                                    className="h-3.5 w-3.5 text-blue-600"
                                                />
                                                <span className="text-slate-700 dark:text-slate-300">All departments</span>
                                            </label>
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="radio"
                                                    checked={m.departments.length > 0}
                                                    onChange={() => {
                                                        const availableDepts = departments
                                                            .filter(dept => (dept.divisions || [])
                                                                .some((div: string | Division) => (typeof div === 'object' ? div._id : div) === m.division));
                                                        if (availableDepts.length > 0) {
                                                            updateMapping(idx, 'departments', [availableDepts[0]._id]);
                                                        }
                                                    }}
                                                    className="h-3.5 w-3.5 text-blue-600"
                                                />
                                                <span className="text-slate-700 dark:text-slate-300">Select multiple departments</span>
                                            </label>
                                        </div>
                                    </div>
                                    <select
                                        multiple
                                        value={m.departments}
                                        disabled={!m.division || m.departments.length === 0}
                                        onChange={(e) => {
                                            const values = Array.from(e.target.selectedOptions).map(opt => opt.value);
                                            updateMapping(idx, 'departments', values);
                                        }}
                                        className={`w-full h-24 px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white transition-opacity ${(!m.division || m.departments.length === 0) ? 'opacity-50 grayscale-[0.5]' : 'opacity-100'}`}
                                    >
                                        {departments.filter(dept => (dept.divisions || []).some((div: string | Division) => (typeof div === 'object' ? div._id : div) === m.division)).map(dept => (
                                            <option key={dept._id} value={dept._id}>{dept.name}</option>
                                        ))}
                                    </select>
                                    <p className="mt-1 text-[10px] text-slate-500">
                                        {m.departments.length === 0 ? 'Currently targeting ALL departments in this division.' : 'Ctrl+Click to select multiple.'}
                                    </p>
                                </div>
                                <div>
                                    <div className="space-y-2">
                                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Employee Group Targeting</label>
                                        <div className="flex items-center gap-4 text-xs">
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="radio"
                                                    checked={m.employeeGroups.length === 0}
                                                    onChange={() => updateMapping(idx, 'employeeGroups', [])}
                                                    className="h-3.5 w-3.5 text-blue-600"
                                                />
                                                <span className="text-slate-700 dark:text-slate-300">All groups</span>
                                            </label>
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="radio"
                                                    checked={m.employeeGroups.length > 0}
                                                    onChange={() => {
                                                        if (employeeGroups.length > 0) {
                                                            updateMapping(idx, 'employeeGroups', [employeeGroups[0]._id]);
                                                        }
                                                    }}
                                                    className="h-3.5 w-3.5 text-blue-600"
                                                />
                                                <span className="text-slate-700 dark:text-slate-300">Select multiple groups</span>
                                            </label>
                                        </div>
                                    </div>
                                    <select
                                        multiple
                                        value={m.employeeGroups}
                                        disabled={m.employeeGroups.length === 0}
                                        onChange={(e) => {
                                            const values = Array.from(e.target.selectedOptions).map(opt => opt.value);
                                            updateMapping(idx, 'employeeGroups', values);
                                        }}
                                        className={`w-full h-24 px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white transition-opacity ${m.employeeGroups.length === 0 ? 'opacity-50 grayscale-[0.5]' : 'opacity-100'}`}
                                    >
                                        {employeeGroups.map((eg) => (
                                            <option key={eg._id} value={eg._id}>{eg.name}</option>
                                        ))}
                                    </select>
                                    <p className="mt-1 text-[10px] text-slate-500">
                                        {m.employeeGroups.length === 0 ? 'Currently targeting ALL employee groups in this scope.' : 'Ctrl+Click to select multiple groups.'}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex justify-end gap-3 pt-6 border-t border-slate-200 dark:border-slate-700">
                <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600 dark:hover:bg-slate-700"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
                >
                    {editing ? 'Update' : 'Create'} Group
                </button>
            </div>
        </form>
    );
}
