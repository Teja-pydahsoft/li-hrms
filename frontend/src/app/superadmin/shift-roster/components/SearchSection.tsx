import React, { memo } from 'react';
import { Search } from 'lucide-react';

interface SearchSectionProps {
    value: string;
    onSearchChange: (term: string) => void;
    onSearchSubmit: () => void;
}

const SearchSection = memo(({
    value,
    onSearchChange,
    onSearchSubmit
}: SearchSectionProps) => {
    return (
        <div className="w-full">
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 transition-all focus-within:ring-2 focus-within:ring-blue-500/10 group/search">
                <Search size={15} className="text-slate-400 group-focus-within/search:text-blue-500 transition-colors" />
                <input
                    type="text"
                    placeholder="Search staff members..."
                    value={value}
                    onChange={(e) => onSearchChange(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            onSearchSubmit();
                        }
                    }}
                    className="bg-transparent text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-none w-full"
                />
                <button
                    type="button"
                    onClick={onSearchSubmit}
                    className="px-2.5 py-1 rounded-md bg-blue-600 text-white text-[10px] font-black uppercase tracking-wider hover:bg-blue-700 transition-colors shrink-0"
                >
                    Go
                </button>
            </div>
        </div>
    );
});

SearchSection.displayName = 'SearchSection';

export default SearchSection;
