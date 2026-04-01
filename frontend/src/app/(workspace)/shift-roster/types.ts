import { Shift, Employee, Holiday } from '@/lib/api';

export type RosterCell = {
    shiftId?: string | null;
    status?: 'WO' | 'HOL';
    notes?: string
};

export type RosterState = Map<string, Record<string, RosterCell>>;

export interface RosterFiltersProps {
    selectedDivision: string;
    setSelectedDivision: (val: string) => void;
    divisions: Array<{ _id: string; name: string }>;
    selectedDept: string;
    setSelectedDept: (val: string) => void;
    departments: Array<{ _id: string; name: string }>;
    selectedGroup: string;
    setSelectedGroup: (val: string) => void;
    groups: any[];
    month: string;
    setMonth: (val: string) => void;
    setPage: (p: number) => void;
    cycleDates: { startDate: string; endDate: string; label: string } | null;
}

export interface SearchSectionProps {
    value: string;
    onSearchChange: (term: string) => void;
    onSearchSubmit: () => void;
}

export interface QuickAssignSectionProps {
    weekdays: string[];
    shiftAssignDays: Record<string, boolean>;
    setShiftAssignDays: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    selectedShiftForAssign: string;
    setSelectedShiftForAssign: (val: string) => void;
    shifts: Shift[];
    handleAssignAll: () => void;
    shiftLabel: (s?: Shift | null) => string;
}

export interface RosterGridProps {
    loading: boolean;
    filteredEmployees: Employee[];
    totalEmployees: number;
    page: number;
    setPage: (p: number) => void;
    limit: number;
    setLimit: (l: number) => void;
    totalPages: number;
    days: string[];
    weekdays: string[];
    roster: RosterState;
    holidayCache: Map<string, Set<string>>;
    shifts: Shift[];
    updateCell: (empNo: string, date: string, value: RosterCell) => void;
    applyEmployeeAllDays: (empNo: string, shiftId: string | null, status?: 'WO' | 'HOL') => void;
    globalHolidayDates: Set<string>;
    shiftLabel: (s?: Shift | null) => string;
}

export interface AssignmentSummaryItem {
    employee: Employee;
    shifts: Array<{ shiftId: string | null; shiftLabel: string; days: number; dates: string[] }>;
    totalDays: number;
    weekOffs: number;
    holidays: number;
}

export interface AssignmentsViewProps {
    filteredAssignedSummary: AssignmentSummaryItem[];
    shifts: Shift[];
    shiftLabel: (s?: Shift | null) => string;
}

export interface WeekOffModalProps {
    showWeekOff: boolean;
    setShowWeekOff: (val: boolean) => void;
    weekOffDays: Record<string, boolean>;
    setWeekOffDays: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    applyWeekOffs: () => void;
    weekdays: string[];
}
