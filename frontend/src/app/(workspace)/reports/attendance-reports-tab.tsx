'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { api, Department, Division, Employee, Designation } from '@/lib/api';
import { MultiSelect } from '@/components/MultiSelect';
import {
    Search,
    Download,
    Users,
    CheckCircle2,
    XCircle,
    Clock,
    Loader2,
    Calendar,
    LayoutGrid,
    List,
    ChevronRight,
    Filter,
    X
} from 'lucide-react';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import { format } from 'date-fns';

interface AttendanceSummary {
    id: string;
    name: string;
    totalCount: number;
    present: number;
    absent: number;
    wo: number;
    hol: number;
    avgPresent: string;
    avgAbsent: string;
    presentPercent: string;
    late: number;
    leave: number;
    od?: number;
    totalPresent?: number;
    totalAbsent?: number;
    totalWO?: number;
    totalHOL?: number;
    totalLate?: number;
    totalOD?: number;
    lateMinutes: number;
}

interface AttendanceRecord {
    _id: string;
    employeeNumber: string;
    employee: {
        emp_no: string;
        employee_name: string;
        department_id?: { name: string };
        division_id?: { name: string };
    };
    date: string;
    status: string;
    firstInTime?: string;
    lastOutTime?: string;
    totalWorkingHours?: number;
    payableShifts?: number;
    totalLateInMinutes?: number;
    totalEarlyOutMinutes?: number;
}

export default function AttendanceReportsTab() {
    const [loading, setLoading] = useState(false);
    const [fetchingFilters, setFetchingFilters] = useState(false);
    const [records, setRecords] = useState<AttendanceRecord[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [divisions, setDivisions] = useState<Division[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);

    // View & Tab states
    const [viewMode, setViewMode] = useState<'detailed' | 'abstract'>('abstract');
    const [dateMode, setDateMode] = useState<'pay_cycle' | 'monthly' | 'range'>('pay_cycle');

    // Pagination states
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [limit] = useState(50);
    const [reportStats, setReportStats] = useState({ 
        present: 0, 
        absent: 0, 
        late: 0, 
        onLeave: 0, 
        daysInRange: 1 
    });

    // Monthly selection states
    const [selectedMonth, setSelectedMonth] = useState<string>((new Date().getMonth() + 1).toString());
    const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());

    // Filter states
    const [startDate, setStartDate] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
    const [endDate, setEndDate] = useState(dayjs().format('YYYY-MM-DD'));
    const [divisionIds, setDivisionIds] = useState<string[]>([]);
    const [departmentIds, setDepartmentIds] = useState<string[]>([]);
    const [designationIds, setDesignationIds] = useState<string[]>([]);
    const [employeeIds, setEmployeeIds] = useState<string[]>([]);
    const [allDesignations, setAllDesignations] = useState<Designation[]>([]);
    const [designations, setDesignations] = useState<Designation[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [payrollStartDay, setPayrollStartDay] = useState<number>(1);
    const [fetchingSettings, setFetchingSettings] = useState(false);
    
    // Drill-down states
    const [drilldownLevel, setDrilldownLevel] = useState<'all' | 'division' | 'department' | 'employee'>('all');
    const [summaries, setSummaries] = useState<AttendanceSummary[]>([]);

    // Export Dialog states
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
    const [exportParams, setExportParams] = useState({
        startDate: dayjs().startOf('month').format('YYYY-MM-DD'),
        endDate: dayjs().format('YYYY-MM-DD'),
        departmentId: 'all',
        divisionId: 'all',
        employeeId: 'all',
        strict: false
    });

    const loadReport = useCallback(async (pageToLoad: number = page) => {
        setLoading(true);
        try {
            // Determine groupBy based on drilldownLevel
            let groupBy: string | undefined;
            if (viewMode === 'abstract') {
                if (drilldownLevel === 'all') groupBy = 'division';
                else if (drilldownLevel === 'division') groupBy = 'department';
                else if (drilldownLevel === 'department') groupBy = 'employee';
            }

            const params: any = {
                page: pageToLoad,
                limit,
                search: searchQuery,
                groupBy
            };

            if (dateMode === 'monthly') {
                params.month = selectedMonth;
                params.year = selectedYear;
            } else if (dateMode === 'pay_cycle') {
                // Calculate pay cycle dates
                const startDay = payrollStartDay;
                const year = parseInt(selectedYear);
                const month = parseInt(selectedMonth);
                
                // If cycle starts on 1st, it's just the full month
                if (startDay === 1) {
                    params.startDate = dayjs(`${year}-${month}-01`).format('YYYY-MM-DD');
                    params.endDate = dayjs(`${year}-${month}-01`).endOf('month').format('YYYY-MM-DD');
                } else {
                    // Cycle from (startDay) of prev month to (startDay - 1) of current month
                    const currentMonthStart = dayjs(`${year}-${month}-${startDay}`);
                    const prevMonthStart = currentMonthStart.subtract(1, 'month');
                    params.startDate = prevMonthStart.format('YYYY-MM-DD');
                    params.endDate = currentMonthStart.subtract(1, 'day').format('YYYY-MM-DD');
                }
            } else {
                params.startDate = startDate;
                params.endDate = endDate;
            }

            if (departmentIds.length > 0) params.departmentId = departmentIds;
            if (divisionIds.length > 0) params.divisionId = divisionIds;
            if (designationIds.length > 0) params.designationId = designationIds;
            if (employeeIds.length > 0) params.employeeId = employeeIds;

            const response = await api.getAttendanceReportSummary(params);
            if (response.success) {
                setRecords(response.data || []);
                setTotalPages(response.totalPages || 1);
                setTotalCount(response.total || 0);
                setPage(response.page || pageToLoad);
                setSummaries(response.summaries || []);
                if (response.stats) {
                    setReportStats({
                        present: response.stats.present || 0,
                        absent: response.stats.absent || 0,
                        late: response.stats.late || 0,
                        onLeave: response.stats.onLeave || 0,
                        daysInRange: response.stats.daysInRange || 1
                    });
                }
            } else {
                toast.error(response.message || 'Failed to load report');
            }
        } catch (error) {
            console.error('Error loading report:', error);
            toast.error('Error loading report');
        } finally {
            setLoading(false);
        }
    }, [page, limit, searchQuery, viewMode, drilldownLevel, dateMode, selectedMonth, selectedYear, startDate, endDate, departmentIds, divisionIds, designationIds, employeeIds]);

    useEffect(() => {
        loadInitialFilters();
    }, []);

    useEffect(() => {
        loadReport(1);
    }, [loadReport, drilldownLevel, divisionIds, departmentIds, designationIds, employeeIds, viewMode, dateMode, selectedMonth, selectedYear]);

    const loadInitialFilters = async () => {
        setFetchingFilters(true);
        setFetchingSettings(true);
        try {
            const [divRes, desRes, settingRes] = await Promise.all([
                api.getDivisions(true),
                api.getAllDesignations(),
                api.getSetting('payroll_cycle_start_day')
            ]);
            if (divRes.success) setDivisions(divRes.data || []);
            if (desRes.success) {
                setAllDesignations(desRes.data || []);
                setDesignations(desRes.data || []);
            }
            if (settingRes?.success && settingRes.data?.value) {
                setPayrollStartDay(parseInt(settingRes.data.value));
            }
        } catch (error) {
            console.error('Error loading initial filters or settings:', error);
        } finally {
            setFetchingFilters(false);
            setFetchingSettings(false);
        }
    };

    const handleDivisionChange = async (ids: string[]) => {
        setDivisionIds(ids);
        setDepartmentIds([]);
        setEmployeeIds([]);
        setDepartments([]);
        setEmployees([]);
        setDesignationIds([]);

        if (ids.length > 0) {
            setDrilldownLevel('division');
            try {
                // Fetch departments for all selected divisions
                const deptPromises = ids.map(id => api.getDepartments(true, id));
                const results = await Promise.all(deptPromises);
                let allDepts: Department[] = [];
                results.forEach(res => {
                    if (res.success) allDepts = [...allDepts, ...(res.data || [])];
                });
                // Unique depts by ID
                const uniqueDepts = Array.from(new Map(allDepts.map(item => [item._id, item])).values());
                setDepartments(uniqueDepts);

                // Filter designations: Show only those that belong to these departments or are global
                // Collect all designation IDs from departments
                const linkedDesignationIds = new Set<string>();
                uniqueDepts.forEach(dept => {
                    if (dept.designations) {
                        dept.designations.forEach((des: any) => {
                            linkedDesignationIds.add(typeof des === 'string' ? des : des._id);
                        });
                    }
                });
                
                const filtered = allDesignations.filter(des => 
                    linkedDesignationIds.has(des._id) || !des.department
                );
                setDesignations(filtered);

            } catch (error) {
                console.error('Error loading departments:', error);
            }
        } else {
            setDrilldownLevel('all');
            setDesignations(allDesignations);
        }
    };

    const handleDepartmentChange = async (ids: string[]) => {
        setDepartmentIds(ids);
        setEmployeeIds([]);
        setEmployees([]);
        setDesignationIds([]);

        if (ids.length > 0) {
            setDrilldownLevel('department');
            try {
                // Fetch employees for all selected departments
                const empPromises = ids.map(id => api.getEmployees({ department_id: id, is_active: true }));
                const results = await Promise.all(empPromises);
                let allEmps: Employee[] = [];
                results.forEach(res => {
                    if (res.success) allEmps = [...allEmps, ...(res.data || [])];
                });
                const uniqueEmps = Array.from(new Map(allEmps.map(item => [item._id, item])).values());
                setEmployees(uniqueEmps);

                // Filter designations to only those in selected departments
                const linkedDesignationIds = new Set<string>();
                departments.filter(d => ids.includes(d._id)).forEach(dept => {
                    if (dept.designations) {
                        dept.designations.forEach((des: any) => {
                            linkedDesignationIds.add(typeof des === 'string' ? des : des._id);
                        });
                    }
                });
                const filtered = allDesignations.filter(des => linkedDesignationIds.has(des._id));
                setDesignations(filtered.length > 0 ? filtered : allDesignations.filter(des => !des.department));
            } catch (error) {
                console.error('Error loading employees:', error);
            }
        } else {
            setDrilldownLevel(divisionIds.length === 0 ? 'all' : 'division');
            if (divisionIds.length > 0) {
                // Re-apply division filter for designations
                const linkedDesignationIds = new Set<string>();
                departments.forEach(dept => {
                    if (dept.designations) {
                        dept.designations.forEach((des: any) => {
                            linkedDesignationIds.add(typeof des === 'string' ? des : des._id);
                        });
                    }
                });
                setDesignations(allDesignations.filter(des => linkedDesignationIds.has(des._id) || !des.department));
            } else {
                setDesignations(allDesignations);
            }
        }
    };

    const handleAdvancedExport = async (format: 'xlsx' | 'pdf' = 'xlsx') => {
        const toastId = toast.loading(`Preparing your ${format.toUpperCase()} report...`);
        try {
            const params: any = {
                startDate: exportParams.startDate,
                endDate: exportParams.endDate,
                divisionId: divisionIds,
                departmentId: departmentIds,
                designationId: designationIds,
                employeeId: employeeIds,
                groupBy: drilldownLevel === 'all' ? 'division' : (drilldownLevel === 'division' ? 'department' : 'employee')
            };
            if (exportParams.strict) params.strict = true;

            if (dateMode === 'monthly') {
                params.month = selectedMonth;
                params.year = selectedYear;
                delete params.startDate;
                delete params.endDate;
            } else if (dateMode === 'pay_cycle') {
                const startDay = payrollStartDay;
                const year = parseInt(selectedYear);
                const month = parseInt(selectedMonth);
                if (startDay === 1) {
                    params.startDate = dayjs(`${year}-${month}-01`).format('YYYY-MM-DD');
                    params.endDate = dayjs(`${year}-${month}-01`).endOf('month').format('YYYY-MM-DD');
                } else {
                    const currentMonthStart = dayjs(`${year}-${month}-${startDay}`);
                    const prevMonthStart = currentMonthStart.subtract(1, 'month');
                    params.startDate = prevMonthStart.format('YYYY-MM-DD');
                    params.endDate = currentMonthStart.subtract(1, 'day').format('YYYY-MM-DD');
                }
            }

            let blob;
            let extension;
            if (format === 'xlsx') {
                blob = await api.exportAttendanceReport(params);
                extension = 'xlsx';
            } else {
                blob = await api.exportAttendanceReportPDF(params);
                extension = 'pdf';
            }

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `attendance_report_${params.startDate || 'payroll'}_to_${params.endDate || 'period'}.${extension}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
            toast.success(`${format.toUpperCase()} report downloaded successfully`, { id: toastId });
            setIsExportDialogOpen(false);
        } catch (error: any) {
            console.error('Export error:', error);
            toast.error(error.message || 'Export failed', { id: toastId });
        }
    };

    const navigateTo = (level: 'all' | 'division' | 'department' | 'employee', id?: string) => {
        if (level === 'employee') {
            setViewMode('detailed');
            if (id) setEmployeeIds([id]);
            setDrilldownLevel('employee');
        } else {
            setViewMode('abstract');
            if (level === 'all') {
                setDivisionIds([]);
                setDepartmentIds([]);
                setEmployeeIds([]);
                setDesignationIds([]);
                setDrilldownLevel('all');
            } else if (level === 'division') {
                if (id) {
                    setDivisionIds([id]);
                    handleDivisionChange([id]);
                }
                setDepartmentIds([]);
                setEmployeeIds([]);
                setDesignationIds([]);
                setDrilldownLevel('division');
            } else if (level === 'department') {
                if (id) {
                    setDepartmentIds([id]);
                    handleDepartmentChange([id]);
                }
                setEmployeeIds([]);
                setDesignationIds([]);
                setDrilldownLevel('department');
            }
        }
        setPage(1);
    };

    const isFiltered = divisionIds.length > 0 || departmentIds.length > 0 || designationIds.length > 0 || employeeIds.length > 0;
    const getBreadcrumbs = () => {
        const items = [{ label: 'Reports', level: 'all', id: 'all' }];
        if (divisionIds.length > 0) {
            const div = divisions.find(d => d._id === divisionIds[0]);
            items.push({ label: div?.name || 'Division', level: 'division', id: divisionIds[0] });
        }
        if (departmentIds.length > 0) {
            const dept = departments.find(d => d._id === departmentIds[0]);
            items.push({ label: dept?.name || 'Department', level: 'department', id: departmentIds[0] });
        }
        if (employeeIds.length > 0) {
            items.push({ label: 'Employee Stats', level: 'employee', id: employeeIds[0] });
        }
        return items;
    };

    const formatDuration = (mins: number) => {
        if (!mins) return '0m';
        const totalMins = Math.round(mins);
        const h = Math.floor(totalMins / 60);
        const m = totalMins % 60;
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'PRESENT': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30' ;
            case 'HALF_DAY': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30' ;
            case 'ABSENT': return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30' ;
            case 'PARTIAL': return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30' ;
            default: return 'bg-slate-100 text-slate-700 dark:bg-slate-800' ;
        }
    };

    function renderAbstractView() {
        return (
            <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex justify-between items-center">
                        <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-widest">
                            {drilldownLevel === 'all' ? 'Attendance by Division' :
                                drilldownLevel === 'division' ? `Departments in ${divisions.find(d => d._id === divisionIds[0])?.name || 'Selected Division'}` :
                                    `Employees in ${departments.find(d => d._id === departmentIds[0])?.name || 'Selected Department'}`}
                        </h3>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">Double-click row to drill-down</p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-800/20">
                                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">{drilldownLevel === 'all' ? 'Division' : (drilldownLevel === 'division' ? 'Department' : 'Employee')}</th>
                                    <th className="px-4 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Days</th>
                                    <th className="px-4 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center" title="Present">P</th>
                                    <th className="px-4 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center" title="Absent">A</th>
                                    <th className="px-4 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center" title="Late">L</th>
                                    <th className="px-4 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center" title="On Duty">OD</th>
                                    <th className="px-4 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center" title="Leaves">LVE</th>
                                    <th className="px-4 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center" title="Week Off">WO</th>
                                    <th className="px-4 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center" title="Holiday">HOL</th>
                                    <th className="px-4 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center" title="Average Present Days per Employee">P. Days</th>
                                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Present %</th>
                                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {loading && summaries.length === 0 ? (
                                    <tr>
                                        <td colSpan={12} className="py-20 text-center">
                                            <Loader2 className="h-8 w-8 animate-spin text-indigo-500 mx-auto" />
                                            <p className="mt-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Aggregating Data...</p>
                                        </td>
                                    </tr>
                                ) : summaries.map((item) => (
                                    <tr
                                        key={item.id}
                                        className="group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all cursor-pointer select-none active:bg-indigo-50/50"
                                        onDoubleClick={() => {
                                            if (drilldownLevel === 'all') navigateTo('division', item.id);
                                            else if (drilldownLevel === 'division') navigateTo('department', item.id);
                                            // No drilldown for employee level
                                        }}
                                    >
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="h-8 w-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-all duration-300">
                                                    {drilldownLevel === 'all' ? 'Div' : (drilldownLevel === 'division' ? 'Dept' : 'Emp')}
                                                </div>
                                                <span className="text-xs font-black text-slate-900 dark:text-white group-hover:translate-x-1 transition-transform">{item.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 text-center text-xs font-bold text-slate-600 dark:text-slate-400">
                                            {reportStats.daysInRange}
                                        </td>
                                        <td className="px-4 py-4 text-center text-xs font-bold text-slate-600 dark:text-slate-400">
                                            {item.avgPresent}
                                        </td>
                                        <td className="px-4 py-4 text-center text-xs font-bold text-rose-600 dark:text-rose-400">
                                            {item.avgAbsent}
                                        </td>
                                        <td className="px-4 py-4 text-center">
                                            <p className="text-xs font-black text-amber-500">{item.totalLate ?? item.late}</p>
                                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter mt-0.5">{formatDuration(item.lateMinutes)}</p>
                                        </td>
                                        <td className="px-4 py-4 text-center text-xs font-bold text-slate-600 dark:text-slate-400">
                                            {item.totalOD ?? item.od ?? 0}
                                        </td>
                                        <td className="px-4 py-4 text-center text-xs font-bold text-emerald-600 dark:text-emerald-400">
                                            {item.leave || 0}
                                        </td>
                                        <td className="px-4 py-4 text-center text-xs font-bold text-slate-600 dark:text-slate-400">
                                            {item.totalWO ?? item.wo ?? 0}
                                        </td>
                                        <td className="px-4 py-4 text-center text-xs font-bold text-slate-600 dark:text-slate-400">
                                            {item.totalHOL ?? item.hol ?? 0}
                                        </td>
                                        <td className="px-4 py-4 text-center">
                                            <span className="text-xs font-black text-indigo-600 dark:text-indigo-400">
                                                {item.avgPresent}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black ${
                                                Number(item.presentPercent) >= 90 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30' :
                                                    Number(item.presentPercent) >= 75 ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30' :
                                                        'bg-rose-100 text-rose-700 dark:bg-rose-900/30'
                                            }`}>
                                                {item.presentPercent}%
                                            </span>
                                        </td>
                                         <td className="px-6 py-4 text-center">
                                            {drilldownLevel !== 'department' ? (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (drilldownLevel === 'all') navigateTo('division', item.id);
                                                        else if (drilldownLevel === 'division') navigateTo('department', item.id);
                                                    }}
                                                    className="relative text-[10px] font-black text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 uppercase tracking-widest transition-all flex items-center gap-1 mx-auto group/btn"
                                                >
                                                    <span className="relative z-10">Drill Down</span>
                                                    <ChevronRight className="h-3 w-3 group-hover/btn:translate-x-1 transition-transform" />
                                                    <span className="absolute -inset-x-2 -inset-y-1 bg-indigo-50 dark:bg-indigo-900/20 rounded-md scale-0 group-hover/btn:scale-100 transition-transform origin-center"></span>
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        navigateTo('employee', item.id);
                                                    }}
                                                    className="text-[10px] font-black text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 uppercase tracking-widest transition-all flex items-center gap-1 mx-auto group/btn"
                                                >
                                                    View Detailed
                                                    <List className="h-3 w-3 group-hover/btn:scale-110 transition-transform" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    }

    function renderDetailedView() {
        return (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50/50 border-b border-slate-200 dark:bg-slate-800/30 dark:border-slate-800">
                                <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Employee</th>
                                <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Date</th>
                                <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-center">Status</th>
                                <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">In Time</th>
                                <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Out Time</th>
                                <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Hours</th>
                                <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right text-rose-500">Late</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {loading ? (
                                <tr>
                                    <td colSpan={7} className="px-4 py-12 text-center">
                                        <div className="flex flex-col items-center">
                                            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
                                            <p className="mt-3 text-xs text-slate-500 font-bold uppercase tracking-widest">Updating Records...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : records.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-4 py-12 text-center text-xs text-slate-500 font-bold uppercase tracking-widest">
                                        No attendance records found
                                    </td>
                                </tr>
                            ) : (
                                records.map((record) => (
                                    <tr key={record._id} className="hover:bg-slate-50/80 transition-all dark:hover:bg-slate-800/50">
                                        <td className="px-4 py-3">
                                            <p className="text-xs font-bold text-slate-900 dark:text-slate-100">{record.employee?.employee_name}</p>
                                            <p className="text-[10px] text-slate-400 font-bold mt-0.5">{record.employeeNumber}</p>
                                        </td>
                                        <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400 font-bold whitespace-nowrap">
                                            {dayjs(record.date).format('DD MMM, YYYY')}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-tighter ${getStatusColor(record.status)}`}>
                                                {record.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400 font-bold whitespace-nowrap">
                                            {record.firstInTime ? dayjs(record.firstInTime).format('hh:mm A') : '-'}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400 font-bold whitespace-nowrap">
                                            {record.lastOutTime ? dayjs(record.lastOutTime).format('hh:mm A') : '-'}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-right font-black text-slate-900 dark:text-white">
                                            {record.totalWorkingHours?.toFixed(2) || '0.00'}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-right text-rose-500 font-black">
                                            {record.totalLateInMinutes ? `${record.totalLateInMinutes}m` : '-'}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="bg-slate-50/50 px-4 py-3 border-t border-slate-200 flex items-center justify-between dark:bg-slate-800/30 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                        Showing {(page - 1) * limit + 1} to {Math.min(page * limit, totalCount)} of {totalCount}
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1 || loading}
                            className="px-3 py-1 text-[10px] font-bold border border-slate-200 rounded-lg hover:bg-white disabled:opacity-50 transition-all dark:border-slate-700 dark:text-slate-300"
                        >
                            Previous
                        </button>
                        <div className="text-[10px] font-black text-slate-900 bg-white dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 dark:text-white">
                            {page} / {totalPages}
                        </div>
                        <button
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages || loading}
                            className="px-3 py-1 text-[10px] font-bold border border-slate-200 rounded-lg hover:bg-white disabled:opacity-50 transition-all dark:border-slate-700 dark:text-slate-300"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                        {getBreadcrumbs().map((item, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                                {idx > 0 && <ChevronRight className="h-3 w-3 text-slate-300" />}
                                <button
                                    onClick={() => navigateTo(item.level as any, item.id === 'all' ? undefined : item.id)}
                                    className={`hover:text-indigo-600 transition-colors ${idx === getBreadcrumbs().length - 1 ? 'text-indigo-600' : ''}`}
                                >
                                    {item.label}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                        <button
                            onClick={() => setViewMode('abstract')}
                            className={`p-1.5 rounded-lg transition-all ${viewMode === 'abstract' ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-700' : 'text-slate-500'}`}
                        >
                            <LayoutGrid className="h-4 w-4" />
                        </button>
                        <button
                            onClick={() => setViewMode('detailed')}
                            className={`p-1.5 rounded-lg transition-all ${viewMode === 'detailed' ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-700' : 'text-slate-500'}`}
                        >
                            <List className="h-4 w-4" />
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => {
                            setDivisionIds([]);
                            setDepartmentIds([]);
                            setEmployeeIds([]);
                            setDesignationIds([]);
                            setDesignations(allDesignations);
                            setDrilldownLevel('all');
                        }}
                        className="h-10 px-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                    >
                        <X className="h-4 w-4" />
                        Clear
                    </button>
                    <button
                        onClick={() => loadReport(1)}
                        className="h-10 px-6 rounded-xl bg-indigo-600 text-white text-xs font-bold shadow-lg shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 transition-all flex items-center gap-2"
                        disabled={loading}
                    >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        Apply
                    </button>
                    <button
                        onClick={() => setIsExportDialogOpen(true)}
                        className="h-10 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-indigo-200 dark:shadow-none active:scale-95 flex items-center gap-2"
                    >
                        <Download className="h-4 w-4" />
                        Export XLSX
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 relative z-10">
                {/* Hierarchy Filters */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm dark:bg-slate-900 dark:border-slate-800 flex flex-col h-full relative z-30">
                    <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 dark:bg-slate-800/50 dark:border-slate-800 flex items-center justify-between rounded-t-2xl">
                        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                            <Filter className="h-3.5 w-3.5" />
                            Hierarchy Filters
                        </h4>
                        {fetchingFilters && <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />}
                    </div>
                    <div className="p-5 grid gap-4 grid-cols-2">
                        <MultiSelect
                            label="Division"
                            options={divisions.map(d => ({ id: d._id, name: d.name }))}
                            selectedIds={divisionIds}
                            onChange={handleDivisionChange}
                            loading={fetchingFilters}
                        />
                        <MultiSelect
                            label="Department"
                            options={departments.map(d => ({ id: d._id, name: d.name }))}
                            selectedIds={departmentIds}
                            onChange={handleDepartmentChange}
                            disabled={divisionIds.length === 0}
                        />
                        <MultiSelect
                            label="Designation"
                            options={designations.map(d => ({ id: d._id, name: d.name }))}
                            selectedIds={designationIds}
                            onChange={setDesignationIds}
                            loading={fetchingFilters}
                        />
                        <MultiSelect
                            label="Employee"
                            options={employees.map(e => ({ id: e._id, name: `${e.employee_name} (${e.emp_no})` }))}
                            selectedIds={employeeIds}
                            onChange={setEmployeeIds}
                            disabled={departmentIds.length === 0}
                        />
                    </div>
                </div>

                <div className="space-y-6">
                    {/* Period Selector Card */}
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden dark:bg-slate-900 dark:border-slate-800 flex flex-col">
                        <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 dark:bg-slate-800/50 dark:border-slate-800 flex items-center justify-between">
                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                <Calendar className="h-3.5 w-3.5" />
                                {dateMode === 'monthly' ? 'Monthly Period' : (dateMode === 'range' ? 'Date Range' : 'Pay Cycle Period')}
                            </h4>
                            <div className="flex items-center p-1 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                                <button
                                    onClick={() => setDateMode('pay_cycle')}
                                    className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${dateMode === 'pay_cycle' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200 dark:shadow-none' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                    Pay Cycle
                                </button>
                                <button
                                    onClick={() => setDateMode('monthly')}
                                    className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${dateMode === 'monthly' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200 dark:shadow-none' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                    Monthly
                                </button>
                                <button
                                    onClick={() => setDateMode('range')}
                                    className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${dateMode === 'range' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200 dark:shadow-none' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                    Range
                                </button>
                            </div>
                        </div>
                        <div className="p-5 flex-1 flex flex-col justify-center">
                            {(dateMode === 'monthly' || dateMode === 'pay_cycle') && (
                                <div className="flex flex-col gap-4">
                                    <div className="flex items-center gap-3">
                                        <div className="flex-1 space-y-1.5">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Month</label>
                                            <select
                                                value={selectedMonth}
                                                onChange={(e) => setSelectedMonth(e.target.value)}
                                                className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50/50 px-3 text-[10px] font-black uppercase tracking-widest focus:ring-2 focus:ring-indigo-500/20 outline-none dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                            >
                                                {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((m, i) => (
                                                    <option key={i} value={(i + 1).toString()}>{m}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="flex-1 space-y-1.5">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Year</label>
                                            <select
                                                value={selectedYear}
                                                onChange={(e) => setSelectedYear(e.target.value)}
                                                className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50/50 px-3 text-[10px] font-black uppercase tracking-widest focus:ring-2 focus:ring-indigo-500/20 outline-none dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                            >
                                                {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map(y => (
                                                    <option key={y} value={y.toString()}>{y}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-2 p-3 bg-indigo-50/50 dark:bg-indigo-900/10 rounded-xl border border-indigo-100/50 dark:border-indigo-900/20">
                                        <Clock className="h-3.5 w-3.5 text-indigo-500 mt-0.5" />
                                        <p className="text-[10px] font-bold text-slate-500 leading-normal">
                                            {dateMode === 'pay_cycle' 
                                                ? `Payroll logic applied: Cycle from ${payrollStartDay} of previous month to ${payrollStartDay - 1} of current month.`
                                                : 'Monthly logic applied: Data shown from 1st to last day of selected month.'}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {dateMode === 'range' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Start Date</label>
                                        <input
                                            type="date"
                                            value={startDate}
                                            onChange={(e) => setStartDate(e.target.value)}
                                            className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50/50 px-4 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">End Date</label>
                                        <input
                                            type="date"
                                            value={endDate}
                                            onChange={(e) => setEndDate(e.target.value)}
                                            className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50/50 px-4 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Stats Overview */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="relative overflow-hidden group rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 shadow-sm">
                    <div className="flex flex-row items-center justify-between pb-2 border-b border-slate-50 dark:border-slate-800 mb-4">
                        <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                            Total Working Days
                        </span>
                        <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        </div>
                    </div>
                    <p className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter">
                        {reportStats.daysInRange}
                    </p>
                    <p className="mt-1 text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                        Calculated payroll days
                    </p>
                </div>

                <div className="relative overflow-hidden group rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 shadow-sm">
                    <div className="flex flex-row items-center justify-between pb-2 border-b border-slate-50 dark:border-slate-800 mb-4">
                        <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                            Total P. Days
                        </span>
                        <div className="p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl">
                            <Users className="h-4 w-4 text-indigo-600" />
                        </div>
                    </div>
                    <p className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter">
                        {reportStats.present.toFixed(1)}
                    </p>
                    <p className="mt-1 text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                        Total Present Days (Group)
                    </p>
                </div>

                <div className="relative overflow-hidden group rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 shadow-sm">
                    <div className="flex flex-row items-center justify-between pb-2 border-b border-slate-50 dark:border-slate-800 mb-4">
                        <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                             Total A. Days
                        </span>
                        <div className="p-2 bg-rose-50 dark:bg-rose-900/20 rounded-xl">
                            <XCircle className="h-4 w-4 text-rose-600" />
                        </div>
                    </div>
                    <p className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter">
                        {reportStats.absent.toFixed(1)}
                    </p>
                    <p className="mt-1 text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                        Total Absent Days (Group)
                    </p>
                </div>

                <div className="relative overflow-hidden group rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 shadow-sm">
                    <div className="flex flex-row items-center justify-between pb-2 border-b border-slate-50 dark:border-slate-800 mb-4">
                        <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                            Total Leave
                        </span>
                        <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-xl">
                            <Calendar className="h-4 w-4 text-amber-600" />
                        </div>
                    </div>
                    <p className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter">
                        {reportStats.onLeave}
                    </p>
                    <p className="mt-1 text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                        Approved leave count
                    </p>
                </div>
            </div>

            {/* Filters Section for Range Tab */}
            {dateMode === 'range' && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 flex flex-wrap items-end gap-4">
                    <div className="space-y-1.5 min-w-[140px]">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Start Date</label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50/50 px-4 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all dark:bg-slate-800 dark:border-slate-700"
                        />
                    </div>
                    <div className="space-y-1.5 min-w-[140px]">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">End Date</label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50/50 px-4 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all dark:bg-slate-800 dark:border-slate-700"
                        />
                    </div>
                </div>
            )}

            {/* Main Content Area */}
            {viewMode === 'abstract' ? renderAbstractView() : renderDetailedView()}

            {/* Ready for Export Card - consistent with Leave/OD */}
            <div className="p-6 bg-white border border-slate-200 rounded-2xl shadow-sm dark:bg-slate-900 dark:border-slate-800 flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center dark:bg-rose-900/20 border border-rose-100 dark:border-rose-900/30">
                        <Download className="h-6 w-6 text-rose-600 shadow-sm" />
                    </div>
                    <div>
                        <p className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">Attendance PDF Report</p>
                        <p className="text-[11px] text-slate-500 font-medium">Download the current view as a professional PDF document.</p>
                    </div>
                </div>
                
                <button
                    onClick={() => handleAdvancedExport('pdf')}
                    disabled={loading}
                    className="w-full md:w-auto flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-8 py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all shadow-[0_8px_20px_rgba(225,29,72,0.3)] active:scale-95 disabled:opacity-50 disabled:active:scale-100"
                >
                    {loading ? (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Generating...
                        </>
                    ) : (
                        <>
                            <Download className="h-4 w-4" />
                            Download PDF
                        </>
                    )}
                </button>
            </div>

            {isExportDialogOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm">
                    <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                            <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-widest">Advanced Export</h3>
                            <p className="text-[10px] text-slate-500 font-bold mt-1 uppercase tracking-wider">Configure export parameters</p>
                        </div>
                        <div className="p-6 space-y-4">
                             <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black uppercase text-slate-500">Start Date</label>
                                    <input type="date" value={exportParams.startDate} onChange={e => setExportParams({...exportParams, startDate: e.target.value})} className="w-full h-10 rounded-xl border border-slate-200 px-3 text-xs font-bold shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black uppercase text-slate-500">End Date</label>
                                    <input type="date" value={exportParams.endDate} onChange={e => setExportParams({...exportParams, endDate: e.target.value})} className="w-full h-10 rounded-xl border border-slate-200 px-3 text-xs font-bold" />
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-4 bg-indigo-50 dark:bg-indigo-900/10 rounded-2xl border border-indigo-100 dark:border-indigo-900/30">
                                <input type="checkbox" checked={exportParams.strict} onChange={e => setExportParams({...exportParams, strict: e.target.checked})} className="h-4 w-4 rounded" />
                                <label className="text-[10px] font-black uppercase text-indigo-700">Strict HRMS Mapping</label>
                            </div>
                        </div>
                        <div className="p-6 bg-slate-50 dark:bg-slate-800/50 flex flex-wrap gap-3">
                            <button onClick={() => setIsExportDialogOpen(false)} className="flex-1 h-10 text-[10px] font-black uppercase text-slate-500 hover:text-slate-700 transition-colors">Cancel</button>
                            <button onClick={() => handleAdvancedExport('xlsx')} className="flex-[2] min-w-[120px] h-10 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase hover:bg-indigo-700 transition-colors shadow-sm">Export XLSX</button>
                            <button onClick={() => handleAdvancedExport('pdf')} className="flex-[2] min-w-[120px] h-10 bg-rose-600 text-white rounded-xl text-[10px] font-black uppercase hover:bg-rose-700 transition-colors shadow-sm">Export PDF</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

