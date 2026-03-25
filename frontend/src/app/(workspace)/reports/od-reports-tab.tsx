'use client';

import { useState, useEffect } from 'react';
import { api, Division, Department, Employee, Designation } from '@/lib/api';
import { MultiSelect } from '@/components/MultiSelect';
import { 
    Briefcase, 
    Download, 
    Loader2, 
    Calendar,
    Filter,
    Users,
    MapPin,
    CheckCircle2,
    XCircle,
    AlertCircle,
    Clock,
    Search,
    ChevronLeft,
    ChevronRight
} from 'lucide-react';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';

export default function ODReportsTab() {
    const [loading, setLoading] = useState(false);
    const [loadingXlsx, setLoadingXlsx] = useState(false);
    const [fetchingFilters, setFetchingFilters] = useState(false);
    
    // Hierarchy states
    const [divisions, setDivisions] = useState<Division[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    
    const [designations, setDesignations] = useState<Designation[]>([]);
    
    // Selection states
    const [divisionIds, setDivisionIds] = useState<string[]>([]);
    const [departmentIds, setDepartmentIds] = useState<string[]>([]);
    const [designationIds, setDesignationIds] = useState<string[]>([]);
    const [employeeIds, setEmployeeIds] = useState<string[]>([]);
    
    // Date/Mode states
    const [dateMode, setDateMode] = useState<'pay_cycle' | 'monthly' | 'range'>('pay_cycle');
    const [selectedMonth, setSelectedMonth] = useState<string>((new Date().getMonth() + 1).toString());
    const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
    const [startDate, setStartDate] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
    const [endDate, setEndDate] = useState(dayjs().endOf('month').format('YYYY-MM-DD'));
    const [payrollStartDay, setPayrollStartDay] = useState<number>(1);
    const [searchQuery, setSearchQuery] = useState('');

    // Report data states
    const [reportData, setReportData] = useState<any[]>([]);
    const [reportStats, setReportStats] = useState({
        totalODs: 0,
        totalApprovedODs: 0,
        totalPendingODs: 0
    });
    const [loadingData, setLoadingData] = useState(false);
    const [page, setPage] = useState(1);
    const [totalRecords, setTotalRecords] = useState(0);
    const limit = 10;

    useEffect(() => {
        loadInitialFilters();
    }, []);

    const loadInitialFilters = async () => {
        setFetchingFilters(true);
        try {
            const [divRes, desRes, settingRes] = await Promise.all([
                api.getDivisions(true),
                api.getAllDesignations(),
                api.getSetting('payroll_cycle_start_day')
            ]);
            if (divRes.success) setDivisions(divRes.data || []);
            if (desRes.success) setDesignations(desRes.data || []);
            if (settingRes?.success && settingRes.data?.value) {
                setPayrollStartDay(parseInt(settingRes.data.value));
            }
        } catch (error) {
            console.error('Error loading initial filters:', error);
        } finally {
            setFetchingFilters(false);
        }
    };

    const handleDivisionChange = async (ids: string[]) => {
        setDivisionIds(ids);
        setDepartmentIds([]);
        setEmployeeIds([]);
        setDepartments([]);
        setEmployees([]);

        if (ids.length > 0) {
            try {
                const deptPromises = ids.map(id => api.getDepartments(true, id));
                const results = await Promise.all(deptPromises);
                let allDepts: Department[] = [];
                results.forEach(res => {
                    if (res.success) allDepts = [...allDepts, ...(res.data || [])];
                });
                const uniqueDepts = Array.from(new Map(allDepts.map(item => [item._id, item])).values());
                setDepartments(uniqueDepts);
            } catch (error) {
                console.error('Error loading departments:', error);
            }
        }
    };

    const handleDepartmentChange = async (ids: string[]) => {
        setDepartmentIds(ids);
        setEmployeeIds([]);
        setEmployees([]);

        if (ids.length > 0) {
            try {
                const empPromises = ids.map(id => api.getEmployees({ department_id: id, is_active: true }));
                const results = await Promise.all(empPromises);
                let allEmps: Employee[] = [];
                results.forEach(res => {
                    if (res.success) allEmps = [...allEmps, ...(res.data || [])];
                });
                const uniqueEmps = Array.from(new Map(allEmps.map(item => [item._id, item])).values());
                setEmployees(uniqueEmps);
            } catch (error) {
                console.error('Error loading employees:', error);
            }
        }
    };

    // Memoized date range based on mode
    const effectiveDates = (() => {
        if (dateMode === 'monthly') {
            const start = dayjs(`${selectedYear}-${selectedMonth}-01`).format('YYYY-MM-DD');
            const end = dayjs(`${selectedYear}-${selectedMonth}-01`).endOf('month').format('YYYY-MM-DD');
            return { start, end };
        } else if (dateMode === 'pay_cycle') {
            const startDay = payrollStartDay;
            const year = parseInt(selectedYear);
            const month = parseInt(selectedMonth);
            if (startDay === 1) {
                const start = dayjs(`${year}-${month}-01`).format('YYYY-MM-DD');
                const end = dayjs(`${year}-${month}-01`).endOf('month').format('YYYY-MM-DD');
                return { start, end };
            } else {
                const currentMonthStart = dayjs(`${year}-${month}-${startDay}`);
                const prevMonthStart = currentMonthStart.subtract(1, 'month');
                return {
                    start: prevMonthStart.format('YYYY-MM-DD'),
                    end: currentMonthStart.subtract(1, 'day').format('YYYY-MM-DD')
                };
            }
        }
        return { start: startDate, end: endDate };
    })();

    const fetchReportData = async () => {
        setLoadingData(true);
        try {
            const query = new URLSearchParams({
                page: page.toString(),
                limit: limit.toString(),
                fromDate: effectiveDates.start,
                toDate: effectiveDates.end,
                ...(searchQuery ? { search: searchQuery } : {}),
                division: divisionIds.join(','),
                department: departmentIds.join(','),
                designation: designationIds.join(','),
                employeeId: employeeIds.join(',')
            }).toString();

            const res = await api.get(`/leaves/od?${query}`);
            if (res.success) {
                setReportData(res.data || []);
                setTotalRecords(res.total || 0);
            }
        } catch (error) {
            console.error('Error fetching report data:', error);
        } finally {
            setLoadingData(false);
        }
    };

    const fetchStats = async () => {
        try {
            const query = new URLSearchParams({
                fromDate: effectiveDates.start,
                toDate: effectiveDates.end,
                ...(searchQuery ? { search: searchQuery } : {}),
                division: divisionIds.join(','),
                department: departmentIds.join(','),
                designation: designationIds.join(','),
                employeeId: employeeIds.join(',')
            }).toString();

            const res = await api.get(`/leaves/dashboard-stats?${query}`);
            if (res.success && res.data) {
                setReportStats(res.data);
            }
        } catch (error) {
            console.error('Error fetching stats:', error);
        }
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            fetchReportData();
            fetchStats();
        }, 500);
        return () => clearTimeout(timer);
    }, [divisionIds, departmentIds, designationIds, employeeIds, dateMode, selectedMonth, selectedYear, startDate, endDate, searchQuery, page, payrollStartDay]);

    // Reset pagination on filter change
    useEffect(() => {
        setPage(1);
    }, [divisionIds, departmentIds, designationIds, employeeIds, dateMode, selectedMonth, selectedYear, startDate, endDate, searchQuery]);

    const handleExport = async () => {
        const toastId = toast.loading('Generating On-Duty (OD) PDF report...');
        setLoading(true);
        
        try {
            const blob = await api.downloadLeaveODReportPDF({
                fromDate: effectiveDates.start,
                toDate: effectiveDates.end,
                search: searchQuery || undefined,
                division: divisionIds,
                department: departmentIds,
                designation: designationIds,
                employeeId: employeeIds,
                includeLeaves: false, // Strictly OD
                includeODs: true,
                includeSummary: true
            });

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `OD_Report_${startDate}_to_${endDate}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
            
            toast.success('OD PDF Downloaded Successfully!', { id: toastId });
        } finally {
            setLoading(false);
        }
    };

    const handleExportXLSX = async () => {
        const toastId = toast.loading('Generating On-Duty (OD) Excel report...');
        setLoadingXlsx(true);
        
        try {
            const blob = await api.downloadLeaveODReportXLSX({
                fromDate: effectiveDates.start,
                toDate: effectiveDates.end,
                search: searchQuery || undefined,
                division: divisionIds,
                department: departmentIds,
                designation: designationIds,
                employeeId: employeeIds,
                includeLeaves: false,
                includeODs: true
            });

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `OD_Report_${dayjs().format('YYYY-MM-DD')}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
            
            toast.success('OD Excel Downloaded Successfully!', { id: toastId });
        } catch (error: any) {
            console.error('Export error:', error);
            toast.error(error.message || 'Failed to generate Excel', { id: toastId });
        } finally {
            setLoadingXlsx(false);
        }
    };

    return (
        <div className="space-y-6 w-full pb-10">
            {/* Header Description */}
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5 dark:bg-emerald-950/20 dark:border-emerald-900/30">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex gap-4">
                        <div className="bg-emerald-600 p-2.5 rounded-xl shrink-0 shadow-lg shadow-emerald-600/20">
                            <MapPin className="h-5 w-5 text-white" />
                        </div>
                        <div>
                            <h3 className="text-sm font-black text-emerald-900 dark:text-emerald-100 uppercase tracking-wider">On-Duty (OD) Report</h3>
                            <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80 mt-1 font-medium">
                                Generate detailed PDF reports for On-Duty requests. 
                            </p>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={handleExport}
                            disabled={loading || loadingXlsx}
                            className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-600/20 active:scale-95 disabled:opacity-50"
                        >
                            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                            {loading ? 'Generating...' : 'Export PDF'}
                        </button>

                        <button
                            onClick={handleExportXLSX}
                            disabled={loading || loadingXlsx}
                            className="flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-emerald-600 border border-emerald-200 px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 disabled:opacity-50"
                        >
                            {loadingXlsx ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                            {loadingXlsx ? 'Generating...' : 'Export XLSX'}
                        </button>
                    </div>
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
                        {fetchingFilters && <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />}
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

                 {/* Period & Search */}
                 <div className="bg-white rounded-2xl border border-slate-200 shadow-sm dark:bg-slate-900 dark:border-slate-800 flex flex-col h-full relative z-20 overflow-visible">
                    <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 dark:bg-slate-800/50 dark:border-slate-800 flex items-center justify-between rounded-t-2xl">
                        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                            <Calendar className="h-3.5 w-3.5" />
                            {dateMode === 'monthly' ? 'Monthly Period' : (dateMode === 'range' ? 'Date Range' : 'Pay Cycle Period')}
                        </h4>
                        <div className="flex items-center p-1 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                            <button
                                onClick={() => setDateMode('pay_cycle')}
                                className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${dateMode === 'pay_cycle' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200 dark:shadow-none' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                Pay Cycle
                            </button>
                            <button
                                onClick={() => setDateMode('monthly')}
                                className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${dateMode === 'monthly' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200 dark:shadow-none' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                Monthly
                            </button>
                            <button
                                onClick={() => setDateMode('range')}
                                className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${dateMode === 'range' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200 dark:shadow-none' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                Range
                            </button>
                        </div>
                    </div>
                    <div className="p-5 flex flex-col gap-6 flex-1 justify-center">
                        {(dateMode === 'monthly' || dateMode === 'pay_cycle') && (
                            <div className="flex flex-col gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="flex-1 space-y-1.5">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Month</label>
                                        <select
                                            value={selectedMonth}
                                            onChange={(e) => setSelectedMonth(e.target.value)}
                                            className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50/50 px-3 text-[10px] font-black uppercase tracking-widest focus:ring-2 focus:ring-emerald-500/20 outline-none dark:bg-slate-800 dark:border-slate-700 dark:text-white"
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
                                            className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50/50 px-3 text-[10px] font-black uppercase tracking-widest focus:ring-2 focus:ring-emerald-500/20 outline-none dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                        >
                                            {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map(y => (
                                                <option key={y} value={y.toString()}>{y}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <div className="flex items-start gap-2 p-3 bg-emerald-50/50 dark:bg-emerald-900/10 rounded-xl border border-emerald-100/50 dark:border-emerald-900/20">
                                    <Clock className="h-3.5 w-3.5 text-emerald-500 mt-0.5" />
                                    <p className="text-[10px] font-bold text-slate-500 leading-normal">
                                        {dateMode === 'pay_cycle' 
                                            ? `Payroll logic applied: Cycle from ${payrollStartDay} of previous month to ${payrollStartDay - 1} of current month.`
                                            : 'Monthly logic applied: Data shown from 1st to last day of selected month.'}
                                    </p>
                                </div>
                            </div>
                        )}

                        {dateMode === 'range' && (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">From Date</label>
                                    <div className="relative">
                                        <Calendar className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                                        <input
                                            type="date"
                                            value={startDate}
                                            onChange={(e) => setStartDate(e.target.value)}
                                            className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50/50 pl-10 pr-3 text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">To Date</label>
                                    <div className="relative">
                                        <Calendar className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                                        <input
                                            type="date"
                                            value={endDate}
                                            onChange={(e) => setEndDate(e.target.value)}
                                            className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50/50 pl-10 pr-3 text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Quick Search</label>
                            <div className="relative">
                                <Users className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Search by name or ID manually..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50/50 pl-10 pr-3 text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Stats Overview */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 relative z-0">
                <div className="bg-white rounded-2xl border border-slate-200 p-5 dark:bg-slate-900 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-50 dark:border-slate-800">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Total OD Requests</span>
                        <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
                            <MapPin className="h-4 w-4 text-emerald-600" />
                        </div>
                    </div>
                    <p className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter">{reportStats.totalODs}</p>
                    <p className="mt-1 text-[10px] font-bold text-slate-400 uppercase tracking-tight">Total on-duty in period</p>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 p-5 dark:bg-slate-900 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-50 dark:border-slate-800">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Approved</span>
                        <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        </div>
                    </div>
                    <p className="text-3xl font-black text-emerald-600 tracking-tighter">{reportStats.totalApprovedODs}</p>
                    <p className="mt-1 text-[10px] font-bold text-slate-400 uppercase tracking-tight">Finalized & closed</p>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 p-5 dark:bg-slate-900 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-50 dark:border-slate-800">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Pending</span>
                        <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-xl">
                            <Clock className="h-4 w-4 text-amber-600" />
                        </div>
                    </div>
                    <p className="text-3xl font-black text-amber-600 tracking-tighter">{reportStats.totalPendingODs}</p>
                    <p className="mt-1 text-[10px] font-bold text-slate-400 uppercase tracking-tight">Awaiting approval</p>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 p-5 dark:bg-slate-900 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-50 dark:border-slate-800">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Rejected / Cancelled</span>
                        <div className="p-2 bg-rose-50 dark:bg-rose-900/20 rounded-xl">
                            <XCircle className="h-4 w-4 text-rose-600" />
                        </div>
                    </div>
                    <p className="text-3xl font-black text-rose-600 tracking-tighter">
                        {reportStats.totalODs - (reportStats.totalApprovedODs + reportStats.totalPendingODs)}
                    </p>
                    <p className="mt-1 text-[10px] font-bold text-slate-400 uppercase tracking-tight">Not processed</p>
                </div>
            </div>

            {/* Data Preview Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden dark:bg-slate-900 dark:border-slate-800">
                <div className="bg-slate-50 px-5 py-4 border-b border-slate-200 dark:bg-slate-800/50 dark:border-slate-800 flex items-center justify-between">
                    <div>
                        <h4 className="text-[10px] font-black text-slate-900 dark:text-white uppercase tracking-widest flex items-center gap-2">
                            <Search className="h-3.5 w-3.5 text-emerald-500" />
                            Data Preview
                        </h4>
                        <p className="text-[10px] text-slate-500 mt-1 font-medium">Showing {reportData.length} records out of {totalRecords}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            disabled={page === 1 || loadingData}
                            onClick={() => setPage(p => p - 1)}
                            className="p-1.5 rounded-lg border border-slate-200 hover:bg-white disabled:opacity-30 dark:border-slate-700 transition-all"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <span className="text-[10px] font-black text-slate-600 dark:text-slate-400 px-2 uppercase tracking-widest">Page {page}</span>
                        <button
                            disabled={page * limit >= totalRecords || loadingData}
                            onClick={() => setPage(p => p + 1)}
                            className="p-1.5 rounded-lg border border-slate-200 hover:bg-white disabled:opacity-30 dark:border-slate-700 transition-all"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto min-h-[300px] relative">
                    {loadingData && (
                        <div className="absolute inset-0 bg-white/50 dark:bg-slate-900/50 backdrop-blur-[1px] z-10 flex items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
                        </div>
                    )}
                    
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50/50 dark:bg-slate-800/30">
                                <th className="px-5 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Employee</th>
                                <th className="px-5 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">OD Type</th>
                                <th className="px-5 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Duration</th>
                                <th className="px-5 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Status</th>
                                <th className="px-5 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Hours</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {reportData.length > 0 ? reportData.map((od) => (
                                <tr key={od._id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                                    <td className="px-5 py-3">
                                        <div className="flex flex-col">
                                            <span className="text-xs font-black text-slate-900 dark:text-white capitalize leading-tight">
                                                {od.employeeId?.employee_name || 'Unknown'}
                                            </span>
                                            <span className="text-[10px] font-black text-emerald-500/80 mt-0.5 tracking-wider uppercase">
                                                {od.employeeId?.emp_no || 'N/A'}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-3">
                                        <div className="flex items-center gap-1.5">
                                            <MapPin className="h-3 w-3 text-slate-400" />
                                            <span className="text-[10px] font-black text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                                                {od.odType || 'General'}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-3">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] font-black text-slate-700 dark:text-slate-300">
                                                {dayjs(od.fromDate).format('DD MMM')} - {dayjs(od.toDate).format('DD MMM')}
                                            </span>
                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter mt-0.5">
                                                {dayjs(od.fromDate).format('YYYY')}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-3">
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${
                                            od.status === 'approved' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30' :
                                            od.status === 'rejected' ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/30' :
                                            'bg-amber-50 text-amber-600 dark:bg-amber-950/30'
                                        }`}>
                                            {od.status}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 text-right">
                                        <span className="text-xs font-black text-slate-900 dark:text-white">
                                            {od.durationHours ? `${od.durationHours}h` : `${od.numberOfDays}d`}
                                        </span>
                                    </td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan={5} className="px-5 py-20 text-center">
                                        <div className="flex flex-col items-center justify-center gap-3">
                                            <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center dark:bg-slate-800/50">
                                                <AlertCircle className="h-6 w-6 text-slate-300" />
                                            </div>
                                            <div>
                                                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">No OD Records Found</p>
                                                <p className="text-[10px] text-slate-400/60 mt-1 font-medium italic">Adjust filters to see preview data</p>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
