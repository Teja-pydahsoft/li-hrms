import React, { memo } from 'react';
import { Plus } from 'lucide-react';
import { QuickAssignSectionProps } from '../types';

const QuickAssignSection = memo(({
    weekdays,
    shiftAssignDays,
    setShiftAssignDays,
    selectedShiftForAssign,
    setSelectedShiftForAssign,
    shifts,
    handleAssignAll,
    shiftLabel
}: QuickAssignSectionProps) => {
    return (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-indigo-50/50 dark:bg-indigo-900/10 px-4 py-2 rounded-xl border border-indigo-200/60 dark:border-indigo-900/30 shadow-sm transition-all hover:bg-white dark:hover:bg-slate-900">
            <div className="flex items-center gap-2">
                <Plus size={16} className="text-indigo-600 dark:text-indigo-400" />
                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400">Quick Assign</span>
            </div>

            {/* Weekday Selector for Shifts */}
            <div className="flex items-center gap-1 bg-white/50 dark:bg-slate-900/50 p-1 rounded-lg border border-indigo-100/50 dark:border-indigo-900/30">
                {weekdays.map((w) => (
                    <button
                        key={w}
                        onClick={() => setShiftAssignDays(prev => ({ ...prev, [w]: !prev[w] }))}
                        className={`w-6 h-6 rounded-md text-[9px] font-black transition-all flex items-center justify-center uppercase ${shiftAssignDays[w]
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                    >
                        {w[0]}
                    </button>
                ))}
            </div>

            <div className="flex items-center gap-2">
                <select
                    value={selectedShiftForAssign}
                    onChange={(e) => setSelectedShiftForAssign(e.target.value)}
                    className="bg-white dark:bg-slate-900 border border-indigo-100 dark:border-indigo-900/50 rounded-lg text-[10px] font-black uppercase tracking-widest text-indigo-700 dark:text-indigo-300 focus:outline-none px-2.5 py-2 min-w-[120px] shadow-sm"
                >
                    <option value="">Select Shift</option>
                    {shifts.map((s) => (
                        <option key={s._id} value={s._id}>{shiftLabel(s)}</option>
                    ))}
                </select>
                <button
                    onClick={handleAssignAll}
                    disabled={!selectedShiftForAssign}
                    className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-md active:scale-95"
                >
                    Apply to All
                </button>
            </div>

            <div className="hidden sm:block h-6 w-[1px] bg-indigo-200 dark:bg-indigo-800 mx-1" />

            <div className="flex flex-wrap gap-1.5">
                {shifts.slice(0, 4).map(shift => (
                    <button
                        key={shift._id}
                        onClick={() => setSelectedShiftForAssign(shift._id)}
                        className={`px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase tracking-tight transition-all ${selectedShiftForAssign === shift._id
                            ? 'border-indigo-500 bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                            : 'border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-900 hover:border-indigo-300'
                            }`}
                    >
                        {shiftLabel(shift)}
                    </button>
                ))}
            </div>
        </div>
    );
});

QuickAssignSection.displayName = 'QuickAssignSection';

export default QuickAssignSection;
