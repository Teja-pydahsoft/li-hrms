import React, { memo } from 'react';
import { Search } from 'lucide-react';
import { AssignmentsViewProps } from '../types';

const AssignmentsView = memo(({
    filteredAssignedSummary,
    shifts,
    shiftLabel
}: AssignmentsViewProps) => {
    if (filteredAssignedSummary.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 bg-white/40 dark:bg-slate-900/40 rounded-[2rem] border border-dashed border-slate-300 dark:border-slate-700">
                <div className="p-4 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 mb-4">
                    <Search size={32} />
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-1">No matching assignments</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs text-center">Try adjusting your search or filters to see assignment summaries.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
            {filteredAssignedSummary.map((item) => (
                <div
                    key={item.employee._id}
                    className="group relative flex flex-col rounded-[2rem] border border-slate-200/60 bg-white/80 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-md dark:border-slate-800/60 dark:bg-slate-950/80 hover:shadow-[0_12px_40px_rgb(0,0,0,0.06)] transition-all duration-300 overflow-hidden"
                >
                    {/* Decorative Element */}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-blue-500/5 to-transparent rounded-bl-[100px] pointer-events-none"></div>

                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6 relative z-10">
                        <div className="flex items-center gap-4">
                            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xl font-black shadow-lg shadow-blue-500/20">
                                {(item.employee.employee_name || 'U')[0].toUpperCase()}
                            </div>
                            <div>
                                <h3 className="text-xs font-black text-slate-900 dark:text-slate-50 uppercase tracking-tight leading-tight">
                                    {item.employee.employee_name || item.employee.emp_no}
                                </h3>
                                <div className="flex flex-col gap-0.5 mt-0.5">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{item.employee.emp_no}</span>
                                        <div className="h-0.5 w-0.5 rounded-full bg-slate-300 dark:bg-slate-700"></div>
                                        <span className="text-[8px] font-black text-slate-500/80 dark:text-slate-400/80 uppercase tracking-wider">{item.employee.designation?.name || 'Staff'}</span>
                                    </div>
                                    <span className="text-[8px] font-black text-blue-500/80 dark:text-blue-400/80 uppercase tracking-wider truncate max-w-[120px]">
                                        {item.employee.department?.name || 'No Dept'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            <div className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 text-center">
                                <div className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-0.5">Offs</div>
                                <div className={`text-sm font-black ${item.weekOffs > 0 ? 'text-orange-500' : 'text-slate-300 dark:text-slate-700'}`}>
                                    {item.weekOffs}
                                </div>
                            </div>
                            <div className="px-3 py-1.5 rounded-xl bg-blue-50/50 dark:bg-blue-900/20 border border-blue-100/50 dark:border-blue-800/50 text-center">
                                <div className="text-[8px] font-black text-blue-400/80 dark:text-blue-500/80 uppercase tracking-widest mb-0.5">Days</div>
                                <div className="text-sm font-black text-blue-600 dark:text-blue-400">
                                    {item.totalDays}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 relative z-10">
                        {item.shifts.map((shift, idx) => {
                            const originalShift = shifts.find(s => s._id === shift.shiftId);
                            const shiftColor = originalShift?.color || '#3b82f6';

                            return (
                                <div
                                    key={idx}
                                    className={`p-3.5 rounded-2xl border transition-all ${shift.shiftId === 'WO'
                                        ? 'bg-orange-500/5 border-orange-200/50 dark:bg-orange-500/10 dark:border-orange-900/50'
                                        : shift.shiftId === 'HOL'
                                            ? 'bg-red-500/5 border-red-200/50 dark:bg-red-500/10 dark:border-red-900/50'
                                            : 'bg-white border-slate-200/60 dark:bg-slate-900/40 dark:border-slate-800/60'
                                        }`}
                                >
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            {shift.shiftId !== 'WO' && shift.shiftId !== 'HOL' && (
                                                <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: shiftColor }}></div>
                                            )}
                                            <span className={`text-[11px] font-black uppercase tracking-widest ${shift.shiftId === 'WO' ? 'text-orange-600 dark:text-orange-400' :
                                                shift.shiftId === 'HOL' ? 'text-red-500' :
                                                    'text-slate-700 dark:text-slate-300'
                                                }`}>
                                                {shift.shiftLabel}
                                            </span>
                                        </div>
                                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-lg bg-white/80 dark:bg-slate-800 text-slate-500 border border-slate-100 dark:border-slate-700">
                                            {shift.days}d
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 ml-0.5">
                                        {shift.dates.slice(0, 8).map((d) => (
                                            <div key={d} className="w-5 h-5 flex items-center justify-center rounded-md bg-white dark:bg-slate-800 text-[9px] font-bold text-slate-600 dark:text-slate-400 border border-slate-100 dark:border-slate-700/50 hover:border-blue-500/30 transition-colors cursor-default">
                                                {new Date(d).getDate()}
                                            </div>
                                        ))}
                                        {shift.dates.length > 8 && (
                                            <div className="h-5 flex items-center px-1.5 rounded-md bg-slate-50 dark:bg-slate-800/50 text-[8px] font-black text-slate-400 uppercase tracking-tighter border border-slate-100 dark:border-slate-800">
                                                +{shift.dates.length - 8} More
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
});

AssignmentsView.displayName = 'AssignmentsView';

export default AssignmentsView;
