import React, { memo } from 'react';
import { Building2, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { navigateMonth } from '../utils';
import { RosterFiltersProps } from '../types';

const RosterFilters = memo(({
    selectedDivision,
    setSelectedDivision,
    divisions,
    selectedDept,
    setSelectedDept,
    departments,
    selectedGroup,
    setSelectedGroup,
    groups,
    month,
    setMonth,
    setPage,
    cycleDates
}: RosterFiltersProps) => {
    return (
        <div className="w-full flex flex-wrap items-center gap-2.5">
            {/* Division Filter */}
            <div className="flex-1 min-w-[160px] sm:flex-none flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 transition-all hover:border-blue-500/30">
                <Building2 size={14} className="text-slate-400" />
                <select
                    value={selectedDivision}
                    onChange={(e) => {
                        setSelectedDivision(e.target.value);
                        setSelectedDept('');
                        setPage(1);
                    }}
                    className="bg-transparent text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-300 focus:outline-none min-w-[110px]"
                >
                    <option value="">All Divisions</option>
                    {divisions.map((d) => (
                        <option key={d._id} value={d._id}>{d.name}</option>
                    ))}
                </select>
            </div>

            {/* Department Filter */}
            <div className="flex-1 min-w-[160px] sm:flex-none flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 transition-all hover:border-blue-500/30">
                <Filter size={14} className="text-slate-400" />
                <select
                    value={selectedDept}
                    onChange={(e) => {
                        setSelectedDept(e.target.value);
                        setPage(1);
                    }}
                    className="bg-transparent text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-300 focus:outline-none min-w-[120px]"
                >
                    <option value="">All Depts</option>
                    {departments.map((d) => (
                        <option key={d._id} value={d._id}>{d.name}</option>
                    ))}
                </select>
            </div>

            {/* Group Filter */}
            <div className="flex-1 min-w-[160px] sm:flex-none flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 transition-all hover:border-blue-500/30">
                <Filter size={14} className="text-slate-400" />
                <select
                    value={selectedGroup}
                    onChange={(e) => {
                        setSelectedGroup(e.target.value);
                        setPage(1);
                    }}
                    className="bg-transparent text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-300 focus:outline-none min-w-[120px]"
                >
                    <option value="">All Groups</option>
                    {groups.map((g) => (
                        <option key={g._id} value={g._id}>{g.name}</option>
                    ))}
                </select>
            </div>

            {/* Month Navigator: Prev / Cycle Label / Next */}
            <div className="w-full sm:w-auto flex items-center gap-0 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm bg-white dark:bg-slate-900">
                <button
                    onClick={() => { setMonth(navigateMonth(month, 'prev')); setPage(1); }}
                    className="flex items-center justify-center w-8 h-9 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors border-r border-slate-200 dark:border-slate-800"
                    title="Previous month"
                >
                    <ChevronLeft size={14} />
                </button>
                <div className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200 whitespace-nowrap min-w-[150px] text-center">
                    {cycleDates ? cycleDates.label : month}
                </div>
                <button
                    onClick={() => { setMonth(navigateMonth(month, 'next')); setPage(1); }}
                    className="flex items-center justify-center w-8 h-9 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors border-l border-slate-200 dark:border-slate-800"
                    title="Next month"
                >
                    <ChevronRight size={14} />
                </button>
            </div>
        </div>
    );
});

RosterFilters.displayName = 'RosterFilters';

export default RosterFilters;
