import React, { memo } from 'react';
import { ChevronLeft, ChevronRight, Plus, Users, Hash } from 'lucide-react';
import { Employee, Shift } from '@/lib/api';
import { RosterCell, RosterGridProps } from '../types';

// Skeleton Loading Row - Reduced Height
const RosterSkeletonRow = ({ daysCount }: { daysCount: number }) => (
    <tr className="animate-pulse border-b border-slate-200/40 dark:border-slate-800/40">
        <td className="px-5 py-1 sticky left-0 z-10 bg-white dark:bg-slate-950 shadow-sm border-r border-slate-200/60 dark:border-slate-800/60">
            <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800"></div>
                <div className="space-y-1 flex-1">
                    <div className="h-2 w-16 bg-slate-100 dark:bg-slate-800 rounded-sm"></div>
                    <div className="h-1.5 w-10 bg-slate-50 dark:bg-slate-900 rounded-sm"></div>
                </div>
            </div>
        </td>
        {Array(daysCount).fill(0).map((_, i) => (
            <td key={i} className="p-0 border-r border-slate-200/40 dark:border-slate-800/40 opacity-50">
                <div className="h-[36px] w-full bg-slate-50/50 dark:bg-slate-900/30"></div>
            </td>
        ))}
    </tr>
);

// Soft Color Utility - Flattened & Ultra-Subtle
const getSoftShiftStyle = (color: string) => ({
    backgroundColor: `${color}14`, // ~8% opacity for extreme comfort
    borderLeft: `2.5px solid ${color}`,
    color: color
});

// Memoized Cell Component - Reduced Height & Soft Styling
const RosterCellComponent = memo(({
    empNo,
    date,
    cell,
    isHoliday,
    isWeekend,
    shifts,
    doj,
    onUpdate
}: {
    empNo: string;
    date: string;
    cell: RosterCell;
    isHoliday: boolean;
    isWeekend: boolean;
    shifts: Shift[];
    doj?: string;
    onUpdate: (empNo: string, date: string, value: RosterCell) => void;
}) => {
    const { format, parseISO } = require('date-fns');
    const isBeforeJoining = doj && date < format(parseISO(doj), 'yyyy-MM-dd');
    const current = cell?.status === 'WO' ? 'WO' : (cell?.status === 'HOL' ? 'HOL' : cell?.shiftId || '');
    const shift = shifts.find(s => s._id === current);
    const shiftColor = shift?.color || '#3b82f6';
    const softStyle = shift ? getSoftShiftStyle(shiftColor) : {};

    return (
        <td
            className={`p-0 text-center relative h-[38px] border-r border-slate-200/30 dark:border-slate-800/20 last:border-r-0 ${isWeekend ? 'bg-slate-50/10 dark:bg-indigo-500/5' : ''} ${isHoliday ? 'bg-rose-50/10 dark:bg-rose-500/5' : ''} ${isBeforeJoining ? 'bg-slate-100/30 dark:bg-slate-900/40 cursor-not-allowed opacity-60' : ''} transition-colors`}
            title={isBeforeJoining ? `Pre-joining period (Joined: ${format(parseISO(doj!), 'dd-MMM-yyyy')})` : undefined}
        >
            <div className={`relative w-full h-full flex flex-col items-center justify-center group/cell overflow-hidden ${isBeforeJoining ? 'pointer-events-none' : ''}`}>
                {/* Interaction Layer: Fully transparent but functional */}
                <select
                    value={current}
                    onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'WO') onUpdate(empNo, date, { status: 'WO', shiftId: null });
                        else if (val === 'HOL') onUpdate(empNo, date, { status: 'HOL', shiftId: null });
                        else if (!val) onUpdate(empNo, date, { shiftId: null, status: undefined });
                        else onUpdate(empNo, date, { shiftId: val, status: undefined });
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20 focus:ring-0 focus:outline-none"
                >
                    <option value="">-</option>
                    <option value="WO">WO</option>
                    <option value="HOL">HOL</option>
                    {shifts.map((s) => (
                        <option key={s._id} value={s._id}>{s.code || s.name}</option>
                    ))}
                </select>

                {/* Single Visual representation layer */}
                <div
                    className={`absolute inset-0 flex items-center justify-center text-[9px] font-black tracking-tight transition-opacity ${current ? 'opacity-100' : 'opacity-0 group-hover/cell:opacity-20'}`}
                    style={current === 'WO'
                        ? { backgroundColor: '#fff7ed', color: '#ea580c', borderLeft: '2.5px solid #f97316' }
                        : (current === 'HOL' ? { backgroundColor: '#fff1f2', color: '#e11d48', borderLeft: '2.5px solid #f43f5e' }
                            : softStyle)
                    }
                >
                    {current === 'WO' ? 'WO' : (current === 'HOL' ? 'HOL' : (shift ? (shift.code || shift.name) : <Plus size={10} className="text-slate-400" />))}
                </div>
            </div>
        </td>
    );
});
RosterCellComponent.displayName = 'RosterCellComponent';

// Memoized Row Component - Enhanced Staff Info
const RosterRow = memo(({
    emp,
    days,
    row,
    empHolidays,
    shifts,
    onUpdate,
    onBulkUpdate,
    shiftLabel
}: {
    emp: Employee;
    days: string[];
    row: Record<string, RosterCell>;
    empHolidays: Set<string>;
    shifts: Shift[];
    onUpdate: (empNo: string, date: string, value: RosterCell) => void;
    onBulkUpdate: (empNo: string, shiftId: string | null, status?: 'WO' | 'HOL') => void;
    shiftLabel: (s?: Shift | null) => string;
}) => {
    return (
        <tr className="group border-b border-slate-200/40 dark:border-slate-800/40 hover:bg-slate-50/50 dark:hover:bg-slate-900/20 transition-colors">
            <td className="px-5 py-1 sticky left-0 z-10 bg-white dark:bg-slate-950 group-hover:bg-slate-50 dark:group-hover:bg-slate-900 shadow-[10px_0_15px_-10px_rgba(0,0,0,0.05)] border-r border-slate-200/60 dark:border-slate-800/60 transition-colors min-w-[200px]">
                <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-tight truncate max-w-[140px]">{emp.employee_name}</span>
                        <span className="text-[8px] font-bold text-slate-400 dark:text-slate-600 bg-slate-50 dark:bg-slate-900 px-1 rounded">#{emp.emp_no}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                        <span className="text-[8px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate max-w-[160px]">{emp.designation?.name || 'Staff'}</span>
                        {emp.department && (
                            <span className="text-[8px] font-bold text-blue-500/80 dark:text-blue-400/80 uppercase tracking-widest truncate max-w-[160px]">{emp.department.name}</span>
                        )}
                    </div>
                    <div className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <select
                            onChange={(e) => {
                                const val = e.target.value;
                                if (val === 'WO') onBulkUpdate(emp.emp_no, null, 'WO');
                                else if (val === 'HOL') onBulkUpdate(emp.emp_no, null, 'HOL');
                                else if (val) onBulkUpdate(emp.emp_no, val);
                                e.target.value = '';
                            }}
                            className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-1 py-0.5 text-[8px] font-black uppercase tracking-widest text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30 cursor-pointer w-full"
                        >
                            <option value="">Bulk Assign</option>
                            <option value="WO">All Week Off</option>
                            <option value="HOL">All Holiday</option>
                            {shifts.map((s) => (
                                <option key={s._id} value={s._id}>
                                    All {shiftLabel(s)}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </td>
            {days.map((d) => (
                <RosterCellComponent
                    key={d}
                    empNo={emp.emp_no}
                    date={d}
                    cell={row[d]}
                    isHoliday={empHolidays.has(d)}
                    isWeekend={new Date(d).getDay() === 0 || new Date(d).getDay() === 6}
                    shifts={shifts}
                    doj={emp.doj}
                    onUpdate={onUpdate}
                />
            ))}
        </tr>
    );
});
RosterRow.displayName = 'RosterRow';

const RosterGrid = memo(({
    loading,
    filteredEmployees,
    totalEmployees,
    page,
    setPage,
    limit,
    setLimit,
    totalPages,
    days,
    weekdays,
    roster,
    holidayCache,
    shifts,
    updateCell,
    applyEmployeeAllDays,
    globalHolidayDates,
    shiftLabel
}: RosterGridProps) => {
    return (
        <div className="bg-white/60 dark:bg-slate-950/40 rounded-[2rem] border border-slate-200/60 dark:border-slate-800/60 shadow-[0_20px_50px_rgba(0,0,0,0.04)] backdrop-blur-xl overflow-hidden">

            {/* Top Pagination & Search Summary */}
            <div className="flex flex-col sm:flex-row items-center justify-between px-6 py-4 bg-white/80 dark:bg-slate-900/80 border-b border-slate-200/60 dark:border-slate-800/60 backdrop-blur-md">
                <div className="flex items-center gap-4 mb-3 sm:mb-0">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100/50 dark:border-blue-800/30">
                        <Users size={14} className="text-blue-600 dark:text-blue-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">
                            {totalEmployees} <span className="text-blue-400 dark:text-blue-500/60">Staff</span>
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Show</label>
                        <select
                            value={limit}
                            onChange={(e) => {
                                setLimit(Number(e.target.value));
                                setPage(1);
                            }}
                            className="bg-transparent border-none text-[10px] font-black text-slate-700 dark:text-slate-300 focus:ring-0 cursor-pointer"
                        >
                            <option value={20}>20Rows</option>
                            <option value={50}>50Rows</option>
                            <option value={100}>100Rows</option>
                        </select>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <span className="hidden sm:inline text-[9px] font-black uppercase tracking-widest text-slate-400">Page {page} of {totalPages}</span>
                    <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200/60 dark:border-slate-800/60">
                        <button
                            onClick={() => setPage(Math.max(1, page - 1))}
                            disabled={page === 1 || loading}
                            className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-slate-900 text-slate-500 hover:text-blue-600 disabled:opacity-30 transition-all active:scale-90"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <div className="flex items-center px-2">
                            <span className="text-[10px] font-black text-slate-700 dark:text-slate-300">{page}</span>
                        </div>
                        <button
                            onClick={() => setPage(Math.min(totalPages, page + 1))}
                            disabled={page === totalPages || loading}
                            className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-slate-900 text-slate-500 hover:text-blue-600 disabled:opacity-30 transition-all active:scale-90"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            </div>

            <div className="overflow-x-auto custom-scrollbar relative">
                <table className="w-full border-separate border-spacing-0">
                    <thead>
                        <tr className="bg-slate-50/30 dark:bg-slate-900/10 transition-all">
                            <th className="px-5 py-3 text-left sticky left-0 z-20 bg-slate-50 dark:bg-slate-950 shadow-md border-r border-b border-slate-200/60 dark:border-slate-800/60">
                                <div className="flex items-center gap-2">
                                    <Hash size={12} className="text-slate-400" />
                                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Employee List</span>
                                </div>
                            </th>
                            {days.map((d) => {
                                const dateObj = new Date(d);
                                const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
                                const isGlobalHoliday = globalHolidayDates.has(d);
                                return (
                                    <th
                                        key={d}
                                        className={`px-1 py-1.5 text-center min-w-[46px] border-r border-b border-slate-200/40 dark:border-slate-800/40 last:border-r-0 ${isWeekend ? 'bg-slate-100/30 dark:bg-slate-800/20' : ''}`}
                                    >
                                        <div className="flex flex-col items-center">
                                            <span className={`text-[7px] font-black uppercase tracking-tighter ${isWeekend ? 'text-blue-500' : 'text-slate-400'}`}>
                                                {weekdays[dateObj.getDay()].substring(0, 3)}
                                            </span>
                                            <span className={`text-[10px] font-black ${isWeekend ? 'text-blue-600 dark:text-blue-400' : 'text-slate-900 dark:text-slate-50'} ${isGlobalHoliday ? 'text-red-500 underline decoration-red-500/30 underline-offset-2' : ''}`}>
                                                {dateObj.getDate()}
                                            </span>
                                        </div>
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            Array(10).fill(0).map((_, i) => <RosterSkeletonRow key={i} daysCount={days.length} />)
                        ) : filteredEmployees.length === 0 ? (
                            <tr>
                                <td colSpan={days.length + 1} className="py-20 text-center text-slate-400 uppercase text-[10px] font-black tracking-widest italic opacity-60">
                                    No staff members found
                                </td>
                            </tr>
                        ) : (
                            filteredEmployees.map((emp) => (
                                <RosterRow
                                    key={emp.emp_no}
                                    emp={emp}
                                    days={days}
                                    row={roster.get(emp.emp_no) || {}}
                                    empHolidays={holidayCache.get(emp.emp_no) || new Set()}
                                    shifts={shifts}
                                    onUpdate={updateCell}
                                    onBulkUpdate={applyEmployeeAllDays}
                                    shiftLabel={shiftLabel}
                                />
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Sub-footer Information */}
            <div className="px-6 py-3 bg-slate-50/10 dark:bg-slate-950/5 border-t border-slate-200/40 dark:border-slate-800/40 flex items-center gap-6">
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-500"></div>
                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Regular Shift</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded" style={{ backgroundColor: '#fdf2f2', borderLeft: '2px solid #f97316' }}></div>
                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Week Off</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded" style={{ backgroundColor: '#fff1f2', borderLeft: '2px solid #f43f5e' }}></div>
                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Holiday</span>
                </div>
            </div>
        </div>
    );
});

RosterGrid.displayName = 'RosterGrid';

export default RosterGrid;
