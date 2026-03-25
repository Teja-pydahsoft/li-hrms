'use client';

import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2 } from 'lucide-react';

interface MultiSelectProps {
    label?: string;
    options: { id: string; name: string }[];
    selectedIds: string[];
    onChange: (ids: string[]) => void;
    placeholder?: string;
    disabled?: boolean;
    loading?: boolean;
    className?: string;
  single?: boolean;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
    label,
    options,
    selectedIds,
    onChange,
    placeholder = 'Select options...',
    disabled = false,
    loading = false,
    className = '',
    single = false
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [dropdownStyles, setDropdownStyles] = useState<React.CSSProperties>({});

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const isInsideTrigger = containerRef.current && containerRef.current.contains(event.target as Node);
            const isInsideDropdown = dropdownRef.current && dropdownRef.current.contains(event.target as Node);
            
            if (!isInsideTrigger && !isInsideDropdown) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Function to calculate dropdown position
    const updatePosition = () => {
        if (containerRef.current && isOpen) {
            const rect = containerRef.current.getBoundingClientRect();
            setDropdownStyles({
                position: 'fixed',
                top: rect.bottom + 4,
                left: rect.left,
                width: rect.width,
                zIndex: 9999,
            });
        }
    };

    useLayoutEffect(() => {
        if (isOpen) {
            updatePosition();
            window.addEventListener('scroll', updatePosition, true);
            window.addEventListener('resize', updatePosition);
        }
        return () => {
            window.removeEventListener('scroll', updatePosition, true);
            window.removeEventListener('resize', updatePosition);
        };
    }, [isOpen]);

    const toggleOption = (id: string) => {
        if (single) {
            onChange([id]);
            setIsOpen(false);
            return;
        }
        if (selectedIds.includes(id)) {
            onChange(selectedIds.filter(selectedId => selectedId !== id));
        } else {
            onChange([...selectedIds, id]);
        }
    };

    const toggleAll = () => {
        if (selectedIds.length === options.length) {
            onChange([]);
        } else {
            onChange(options.map(opt => opt.id));
        }
    };

    const getSelectedLabels = () => {
        if (selectedIds.length === 0) return placeholder;
        if (single) {
            const selected = options.find(o => o.id === selectedIds[0]);
            return selected ? selected.name : placeholder;
        }
        if (selectedIds.length === options.length && options.length > 0) return 'All Selected';
        if (selectedIds.length > 2) return `${selectedIds.length} Selected`;
        
        return options
            .filter(opt => selectedIds.includes(opt.id))
            .map(opt => opt.name)
            .join(', ');
    };

    return (
        <div className={`flex flex-col gap-1.5 relative ${className}`} ref={containerRef}>
            {label && <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">{label}</label>}
            <div
                onClick={() => !disabled && setIsOpen(!isOpen)}
                className={`
                    flex items-center justify-between h-9 px-3 rounded-lg border transition-all cursor-pointer
                    ${disabled ? 'opacity-50 cursor-not-allowed bg-slate-50' : 'bg-white hover:border-slate-300 dark:bg-slate-800 dark:border-slate-700'}
                    ${isOpen ? 'ring-2 ring-blue-500/20 border-blue-500' : 'border-slate-200 dark:border-slate-800 shadow-sm'}
                `}
            >
                <span className={`text-[11px] font-bold truncate ${selectedIds.length === 0 ? 'text-slate-400' : 'text-slate-900 dark:text-white'}`}>
                    {loading ? 'Loading...' : getSelectedLabels()}
                </span>
                <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </div>

            {isOpen && !disabled && typeof document !== 'undefined' && createPortal(
                <div 
                    ref={dropdownRef}
                    style={dropdownStyles}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 overflow-hidden min-w-[200px]"
                >
                    <div className="max-h-60 overflow-y-auto p-1 custom-scrollbar">
                        {loading ? (
                            <div className="p-4 text-center">
                                <Loader2 className="h-5 w-5 animate-spin text-blue-500 mx-auto" />
                                <p className="mt-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">Loading...</p>
                            </div>
                        ) : (
                            <>
                                {options.length > 0 && !single && (
                                    <div
                                        onClick={toggleAll}
                                        className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors group border-b border-slate-100 dark:border-slate-800/50 mb-1"
                                    >
                                        <div className={`
                                            w-4 h-4 rounded border flex items-center justify-center transition-all
                                            ${selectedIds.length === options.length ? 'bg-blue-600 border-blue-600' : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 group-hover:border-blue-400'}
                                        `}>
                                            {selectedIds.length === options.length && <Check className="h-2.5 w-2.5 text-white stroke-[3]" />}
                                        </div>
                                        <span className={`text-[11px] font-black uppercase tracking-tight ${selectedIds.length === options.length ? 'text-blue-600' : 'text-slate-500'}`}>
                                            {selectedIds.length === options.length ? 'Deselect All' : 'Select All'}
                                        </span>
                                    </div>
                                )}

                                {options.length > 0 ? (
                                    <div className="space-y-0.5">
                                        {options.map(option => (
                                            <div
                                                key={option.id}
                                                onClick={() => toggleOption(option.id)}
                                                className={`
                                                    flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all
                                                    ${selectedIds.includes(option.id) ? 'bg-blue-50/50 dark:bg-blue-900/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}
                                                `}
                                            >
                                                {!single && (
                                                    <div className={`
                                                        w-4 h-4 rounded border flex items-center justify-center transition-all
                                                        ${selectedIds.includes(option.id) ? 'bg-blue-600 border-blue-600' : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'}
                                                    `}>
                                                        {selectedIds.includes(option.id) && <Check className="h-2.5 w-2.5 text-white stroke-[3]" />}
                                                    </div>
                                                )}
                                                <span className={`text-xs font-bold transition-colors ${selectedIds.includes(option.id) ? 'text-blue-600' : 'text-slate-700 dark:text-slate-300'}`}>
                                                    {option.name}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="p-6 text-center">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">No Items Available</p>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};
