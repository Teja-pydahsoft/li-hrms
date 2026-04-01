import React, { memo } from 'react';
import { X } from 'lucide-react';
import { WeekOffModalProps } from '../types';

const WeekOffModal = memo(({
    showWeekOff,
    setShowWeekOff,
    weekOffDays,
    setWeekOffDays,
    applyWeekOffs,
    weekdays
}: WeekOffModalProps) => {
    if (!showWeekOff) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-300">
                <div className="p-8">
                    <div className="flex items-center justify-between mb-8">
                        <h3 className="text-xl font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight">Assign Week Offs</h3>
                        <button
                            onClick={() => setShowWeekOff(false)}
                            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-all hover:text-slate-600"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    <p className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-6 px-1">Select days to assign as off for current list:</p>

                    <div className="grid grid-cols-2 gap-3 mb-8">
                        {weekdays.map((w) => (
                            <label
                                key={w}
                                className={`flex items-center gap-3 p-4 rounded-2xl border transition-all cursor-pointer group ${weekOffDays[w]
                                    ? 'bg-blue-500/10 border-blue-500/40 dark:bg-blue-500/20'
                                    : 'bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800 hover:border-blue-200'
                                    }`}
                            >
                                <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all ${weekOffDays[w]
                                    ? 'bg-blue-500 border-blue-500 text-white'
                                    : 'border-slate-200 dark:border-slate-800'
                                    }`}>
                                    <input
                                        type="checkbox"
                                        checked={weekOffDays[w]}
                                        onChange={(e) => setWeekOffDays((prev) => ({ ...prev, [w]: e.target.checked }))}
                                        className="sr-only"
                                    />
                                    {weekOffDays[w] && <div className="w-2 h-2 rounded-[2px] bg-white" />}
                                </div>
                                <span className={`text-[10px] font-black uppercase tracking-[0.15em] transition-colors ${weekOffDays[w] ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500'}`}>
                                    {w}
                                </span>
                            </label>
                        ))}
                    </div>

                    <div className="flex gap-4">
                        <button
                            onClick={() => setShowWeekOff(false)}
                            className="flex-1 px-6 py-4 rounded-2xl border border-slate-200 dark:border-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all active:scale-95"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={applyWeekOffs}
                            className="flex-1 px-6 py-4 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-500/20 hover:from-blue-700 hover:to-indigo-800 transition-all active:scale-95"
                        >
                            Apply Offs
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});

WeekOffModal.displayName = 'WeekOffModal';

export default WeekOffModal;
