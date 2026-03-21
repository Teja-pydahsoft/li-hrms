'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Calendar, Download, Search, Filter, Settings, Eye, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'react-hot-toast';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFixMe = any;

interface TransactionDetail {
    startDate: string;
    endDate: string;
    leaveType: string;
    transactionType: string;
    days: number;
    openingBalance: number;
    closingBalance: number;
    reason: string;
}

interface MonthlySubLedger {
    month: number;
    year: number;
    casualLeave: {
        openingBalance: number;
        accruedThisMonth: number;
        usedThisMonth: number;
        closingBalance: number;
        balance: number;
        earnedCCL?: number;
        expired?: number;
        carryForward?: number;
    };
    earnedLeave: {
        openingBalance: number;
        accruedThisMonth: number;
        usedThisMonth: number;
        closingBalance: number;
        balance: number;
    };
    compensatoryOff: {
        openingBalance: number;
        earned: number;
        used: number;
        expired: number;
        closingBalance: number;
        balance: number;
    };
    totalPaidBalance: number;
    transactions: TransactionDetail[];
}

interface Employee {
    employeeId: string;
    empNo: string;
    employeeName: string;
    designation: string;
    department: string;
    divisionName: string;
    clBalance: number;
    elBalance: number;
    compensatoryOffBalance: number;
    monthlyCLLimit: number;
    presentMonthAllowedLeaves: number;
    pendingCLThisMonth: number;
    cumulativeLeaves: number;
    yearlySummary?: {
        [key: string]: {
            totalCredits: number;
            totalDebits: number;
            adjustments: number;
        };
    };
    monthlySubLedgers?: MonthlySubLedger[];
}

interface EmployeeDetail {
    employeeId: string;
    empNo: string;
    employeeName: string;
    designation: string;
    department: string;
    divisionName: string;
    dateOfJoining: string;
    employmentStatus: string;
    yearlySummary?: {
        [key: string]: {
            totalCredits: number;
            totalDebits: number;
            adjustments: number;
        };
    };
    monthlySubLedgers: MonthlySubLedger[];
}

export default function LeaveRegisterPage() {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [showAdjustModal, setShowAdjustModal] = useState(false);
    const [adjustmentData, setAdjustmentData] = useState({
        employeeId: '',
        employeeName: '',
        empNo: '',
        clBalance: 0,
        newBalance: '', // target CL balance – creates ADJUSTMENT transaction
        reason: ''
    });
    const [showEmployeeDetailModal, setShowEmployeeDetailModal] = useState(false);
    const [selectedEmployeeDetail, setSelectedEmployeeDetail] = useState<EmployeeDetail | null>(null);
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [elEnabled, setElEnabled] = useState<boolean | null>(null);
    const [expandedMonths, setExpandedMonths] = useState<Set<number>>(new Set());

    const toggleMonth = (monthIdx: number) => {
        setExpandedMonths(prev => {
            const next = new Set(prev);
            if (next.has(monthIdx)) next.delete(monthIdx);
            else next.add(monthIdx);
            return next;
        });
    };

    // Load leave policy to know if Earned Leave is enabled; controls visibility of EL calculation button
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await api.getLeaveSettings('leave');
                if (!cancelled && res?.success && res.data?.settings?.earnedLeave) {
                    const enabled = res.data.settings.earnedLeave.enabled;
                    setElEnabled(enabled !== false);
                }
            } catch {
                if (!cancelled) setElEnabled(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const fetchLeaveRegister = useCallback(async () => {
        try {
            setLoading(true);
            const params: Record<string, string | number | boolean> = {
                balanceAsOf: true,
                year: selectedYear
            };

            const data = await api.getLeaveRegister(params);
            
            if (data.success) {
                const responseData = data as unknown as { data?: AnyFixMe[] };
                const formattedEmployees = (responseData.data || []).map((emp: AnyFixMe) => {
                    const employee = emp.employee || {};
                    const employeeId = employee.id || emp.employeeId?._id || emp.employeeId?.id || emp.employeeId;
                    
                    const subLedgers = emp.monthlySubLedgers || [];
                    const latestLedger = subLedgers.length > 0 ? subLedgers[subLedgers.length - 1] : {};

                    const backendMonthlyCLLimit = latestLedger.casualLeave?.monthlyCLLimit ?? 0;
                    const backendMonthlyLimit = (latestLedger.casualLeave?.allowedRemaining ?? 0) + (latestLedger.compensatoryOff?.balance ?? 0);

                    return {
                        employeeId,
                        empNo: employee.empNo ?? emp.empNo,
                        employeeName: employee.name ?? emp.employeeName,
                        designation: employee.designation ?? emp.designation,
                        department: employee.department ?? emp.department,
                        divisionName: employee.division ?? emp.divisionName ?? 'N/A',
                        clBalance: latestLedger.casualLeave?.balance ?? 0,
                        elBalance: latestLedger.earnedLeave?.balance ?? 0,
                        compensatoryOffBalance: latestLedger.compensatoryOff?.balance ?? 0,
                        monthlyCLLimit: backendMonthlyCLLimit,
                        presentMonthAllowedLeaves: backendMonthlyLimit,
                        pendingCLThisMonth: latestLedger.casualLeave?.pendingThisMonth ?? 0,
                        cumulativeLeaves: latestLedger.totalPaidBalance ?? 0,
                        yearlySummary: emp.yearlySummary,
                        monthlySubLedgers: emp.monthlySubLedgers
                    };
                });
                setEmployees(formattedEmployees);
            } else {
                toast.error('Failed to fetch leave register');
            }
        } catch (error) {
            console.error('Error fetching leave register:', error);
            toast.error('Error fetching leave register');
        } finally {
            setLoading(false);
        }
    }, [selectedYear]);

    useEffect(() => {
        fetchLeaveRegister();
    }, [fetchLeaveRegister]);

    const viewEmployeeLedger = (employee: Employee) => {
        const detail: EmployeeDetail = {
            employeeId: employee.employeeId,
            empNo: employee.empNo,
            employeeName: employee.employeeName,
            designation: employee.designation,
            department: employee.department,
            divisionName: employee.divisionName,
            dateOfJoining: '', // Optionally pass or fetch if needed
            employmentStatus: 'active',
            yearlySummary: employee.yearlySummary,
            monthlySubLedgers: employee.monthlySubLedgers || []
        };
        setSelectedEmployeeDetail(detail);
        setShowEmployeeDetailModal(true);
    };

    const fetchEmployeeDetail = async (employeeId: string) => {
        const emp = employees.find(e => e.employeeId === employeeId);
        if (emp) {
            viewEmployeeLedger(emp);
        } else {
            try {
                const data = await api.getEmployeeRegister(employeeId);
                if (data.success) {
                    setSelectedEmployeeDetail(data.data);
                    setShowEmployeeDetailModal(true);
                } else {
                    toast.error('Failed to fetch employee details');
                }
            } catch (error) {
                console.error('Error fetching employee details:', error);
                toast.error('Error fetching employee details');
            }
        }
    };

    const openAdjustModal = (employee: Employee) => {
        setAdjustmentData({
            employeeId: employee.employeeId,
            employeeName: employee.employeeName,
            empNo: employee.empNo,
            clBalance: employee.clBalance,
            newBalance: String(employee.clBalance),
            reason: ''
        });
        setShowAdjustModal(true);
    };

    const handleAdjustment = async () => {
        const newBal = parseFloat(adjustmentData.newBalance);
        if (adjustmentData.newBalance === '' || isNaN(newBal) || newBal < 0) {
            toast.error('Please enter a valid new balance (0 or more)');
            return;
        }
        if (!adjustmentData.reason.trim()) {
            toast.error('Please enter a reason for the adjustment');
            return;
        }

        try {
            const result = await api.adjustLeaveBalance({
                employeeId: adjustmentData.employeeId,
                leaveType: 'CL',
                amount: newBal,
                transactionType: 'ADJUSTMENT',
                reason: adjustmentData.reason.trim()
            });

            if (result.success) {
                toast.success('CL balance adjusted successfully');
                setShowAdjustModal(false);
                fetchLeaveRegister(); // Refresh data
            } else {
                toast.error(result.message || 'Failed to adjust CL balance');
            }
        } catch (error) {
            console.error('Error adjusting CL balance:', error);
            toast.error('Error adjusting CL balance');
        }
    };

    const handleCalculateELForPeriod = async () => {
        try {
            const result = await api.updateAllEL({
                month: new Date().getMonth() + 1,
                year: selectedYear
            });
            if (result.success) {
                toast.success(result.message || 'Earned leave calculated for current payroll period');
                // Refresh register so EL credits and balances are visible
                fetchLeaveRegister();
            } else {
                toast.error(result.message || 'Failed to calculate earned leave');
            }
        } catch (error) {
            console.error('Error triggering EL calculation:', error);
            toast.error('Error triggering earned leave calculation');
        }
    };

    const exportToExcel = () => {
        // TODO: Implement Excel export
        toast.success('Export feature coming soon!');
    };

    const filteredEmployees = useMemo(() => {
        if (!searchTerm.trim()) return employees;
        const term = searchTerm.toLowerCase().trim();
        return employees.filter(
            (emp) =>
                (emp.employeeName || '').toLowerCase().includes(term) ||
                (emp.empNo || '').toLowerCase().includes(term) ||
                (emp.designation || '').toLowerCase().includes(term) ||
                (emp.department || '').toLowerCase().includes(term) ||
                (emp.divisionName || '').toLowerCase().includes(term)
        );
    }, [employees, searchTerm]);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-96">
                <div className="animate-spin rounded-full h-12 w-12 border-2 border-gray-200 dark:border-gray-700 border-t-indigo-600 dark:border-t-indigo-500"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Leave Register</h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-0.5">
                        Complete leave ledger for all employees for {selectedYear}-{selectedYear + 1}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {elEnabled && (
                        <button
                            onClick={handleCalculateELForPeriod}
                            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-medium"
                        >
                            <span>Calculate EL for this payroll</span>
                        </button>
                    )}
                    <button
                        onClick={exportToExcel}
                        className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
                    >
                        <Download className="w-4 h-4" />
                        Export
                    </button>
                </div>
            </div>

            {/* Filters */}
            <section className="bg-white dark:bg-[#1E293B] rounded-xl border border-gray-200 dark:border-gray-800 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                    <div className="flex items-center gap-3">
                        <Filter className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Filters</span>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 w-4 h-4" />
                        <input
                            type="text"
                            placeholder="Search by name, emp no, designation, department..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 pr-4 py-2.5 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        />
                    </div>
                    <div className="flex items-center justify-end gap-2">
                        <Calendar className="w-4 h-4 text-gray-500 dark:text-gray-400 shrink-0" />
                        <select
                            value={selectedYear}
                            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                            className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        >
                            {[2024, 2025, 2026, 2027].map(year => (
                                <option key={year} value={year}>{year}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </section>

            {/* Employee Table */}
            <section className="bg-white dark:bg-[#1E293B] rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gray-50 dark:bg-gray-800/50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    Employee
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    Designation
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    Department
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    Division
                                </th>
                                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    CL
                                </th>
                                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    EL
                                </th>
                                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    Comp Off
                                </th>
                                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    CL Month Limit
                                </th>
                                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    Locked CL (Pending)
                                </th>
                                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    Month limit
                                </th>
                                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    Cumulative
                                </th>
                                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {filteredEmployees.map((employee) => (
                                <tr key={employee.employeeId} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                    <td className="px-4 py-3">
                                        <div>
                                            <div className="font-medium text-gray-900 dark:text-white">{employee.employeeName || '—'}</div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400">{employee.empNo || '—'}</div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{employee.designation || '—'}</td>
                                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{employee.department || '—'}</td>
                                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{employee.divisionName || '—'}</td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                            employee.clBalance > 0 ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                                        }`}>
                                            {employee.clBalance}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                            employee.elBalance > 0 ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                                        }`}>
                                            {employee.elBalance}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                            employee.compensatoryOffBalance > 0 ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' : 'bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-400'
                                        }`}>
                                            {employee.compensatoryOffBalance}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-center text-sm text-gray-900 dark:text-gray-100 font-medium">
                                        {employee.monthlyCLLimit}
                                    </td>
                                    <td className="px-4 py-3 text-center text-sm text-amber-700 dark:text-amber-300 font-medium">
                                        {employee.pendingCLThisMonth}
                                    </td>
                                    <td className="px-4 py-3 text-center text-sm text-gray-900 dark:text-gray-100 font-medium">
                                        {employee.presentMonthAllowedLeaves}
                                    </td>
                                    <td className="px-4 py-3 text-center text-sm text-gray-900 dark:text-gray-100">
                                        {employee.cumulativeLeaves}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center justify-center gap-2">
                                            <button
                                                onClick={() => fetchEmployeeDetail(employee.employeeId)}
                                                className="p-1 px-3 text-xs bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 font-bold rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors flex items-center gap-1.5"
                                            >
                                                <Eye size={12} />
                                                View
                                            </button>
                                            <button
                                                onClick={() => openAdjustModal(employee)}
                                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"
                                            >
                                                <Settings className="w-4 h-4" />
                                                Adjust
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {filteredEmployees.length === 0 && (
                    <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                        No employees to show for the selected period. Try another month or clear the search.
                    </div>
                )}
            </section>

            {/* Employee Yearly Ledger Modal */}
            {showEmployeeDetailModal && selectedEmployeeDetail && (
                <div className="fixed inset-0 z-50 overflow-y-auto">
                    <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                        <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={() => setShowEmployeeDetailModal(false)}>
                            <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
                        </div>
                        <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
                        <div className="inline-block align-middle bg-white dark:bg-[#1E293B] rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-6xl sm:w-full border border-gray-200 dark:border-gray-800">
                            <div className="bg-white dark:bg-[#1E293B] px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                                <div className="sm:flex sm:items-start justify-between">
                                    <div>
                                        <h3 className="text-xl leading-6 font-bold text-gray-900 dark:text-white">
                                            Yearly Leave Ledger - {selectedEmployeeDetail.employeeName} ({selectedEmployeeDetail.empNo})
                                        </h3>
                                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                            {selectedEmployeeDetail.designation} | {selectedEmployeeDetail.department}
                                        </p>
                                    </div>
                                    <button 
                                        onClick={() => setShowEmployeeDetailModal(false)}
                                        className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 focus:outline-none"
                                    >
                                        <span className="sr-only">Close</span>
                                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>

                                {/* Yearly Summary Cards */}
                                <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                                    {['CL', 'EL', 'CCL'].map(type => {
                                        const stats = selectedEmployeeDetail.yearlySummary?.[type] || { totalCredits: 0, totalDebits: 0, adjustments: 0 };
                                        const label = type === 'CL' ? 'Casual Leave' : type === 'EL' ? 'Earned Leave' : 'Comp. Off';
                                        const color = type === 'CL' ? 'indigo' : type === 'EL' ? 'emerald' : 'amber';
                                        
                                        return (
                                            <div key={type} className={`bg-${color}-50/50 dark:bg-${color}-900/10 border border-${color}-100 dark:border-${color}-900/20 rounded-xl p-4`}>
                                                <h4 className={`text-${color}-900 dark:text-${color}-400 font-semibold mb-2`}>{label} (Annual)</h4>
                                                <div className="grid grid-cols-3 gap-2 text-xs">
                                                    <div>
                                                        <p className="text-gray-500 dark:text-gray-400">Credits</p>
                                                        <p className="font-bold text-emerald-600 dark:text-emerald-400">+{stats.totalCredits}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-gray-500 dark:text-gray-400">Debits</p>
                                                        <p className="font-bold text-rose-600 dark:text-rose-400">-{stats.totalDebits}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-gray-500 dark:text-gray-400">Adjust</p>
                                                        <p className="font-bold text-indigo-600 dark:text-indigo-400">{stats.adjustments > 0 ? `+${stats.adjustments}` : stats.adjustments}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Monthly Sub-ledgers */}
                                <div className="mt-8 space-y-6">
                                    <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-2">
                                        <h4 className="text-lg font-bold text-gray-800 dark:text-gray-200">Monthly Sub-Ledgers</h4>
                                    </div>
                                    <div className="max-h-[50vh] overflow-y-auto space-y-6 pr-2 custom-scrollbar">
                                        {selectedEmployeeDetail.monthlySubLedgers.map((monthLedger: any, idx: number) => (
                                            <div key={idx} className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden bg-gray-50/30 dark:bg-gray-800/20">
                                                <div 
                                                    className="bg-gray-100/50 dark:bg-gray-800/50 px-4 py-3 flex justify-between items-center border-b border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors"
                                                    onClick={() => toggleMonth(idx)}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        {expandedMonths.has(idx) ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                                                        <span className="font-bold text-gray-700 dark:text-gray-300">
                                                            {new Date(0, monthLedger.month - 1).toLocaleString('default', { month: 'long' })} {monthLedger.year}
                                                        </span>
                                                    </div>
                                                    <div className="flex space-x-6 text-xs text-gray-600 dark:text-gray-400">
                                                        <span>Opening: <strong className="text-gray-900 dark:text-gray-200">{monthLedger.casualLeave.openingBalance}</strong></span>
                                                        <span>Closing: <strong className="text-gray-900 dark:text-gray-200">{monthLedger.casualLeave.closingBalance}</strong></span>
                                                    </div>
                                                </div>
                                                
                                                {expandedMonths.has(idx) && (
                                                <div className="p-4">
                                                    {/* Summary for the month */}
                                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 text-sm">
                                                        <div className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm">
                                                            <p className="text-indigo-600 dark:text-indigo-400 text-xs font-bold uppercase mb-2">Casual Leave</p>
                                                            <div className="flex justify-between items-center">
                                                                <span className="text-gray-500 dark:text-gray-400">Credits: +{monthLedger.casualLeave.accruedThisMonth}</span>
                                                                <span className="text-rose-500 dark:text-rose-400">Used: -{monthLedger.casualLeave.usedThisMonth}</span>
                                                            </div>
                                                        </div>
                                                        <div className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm">
                                                            <p className="text-emerald-600 dark:text-emerald-400 text-xs font-bold uppercase mb-2">Earned Leave</p>
                                                            <div className="flex justify-between items-center">
                                                                <span className="text-gray-500 dark:text-gray-400">Credits: +{monthLedger.earnedLeave.accruedThisMonth}</span>
                                                                <span className="text-rose-500 dark:text-rose-400">Used: -{monthLedger.earnedLeave.usedThisMonth}</span>
                                                            </div>
                                                        </div>
                                                        <div className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm">
                                                            <p className="text-amber-600 dark:text-amber-400 text-xs font-bold uppercase mb-2">Comp. Off</p>
                                                            <div className="flex justify-between items-center">
                                                                <span className="text-gray-500 dark:text-gray-400">Credits: +{monthLedger.compensatoryOff.earned}</span>
                                                                <span className="text-rose-500 dark:text-rose-400">Used: -{monthLedger.compensatoryOff.used}</span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Transactions Table for the month */}
                                                    {monthLedger.transactions && monthLedger.transactions.length > 0 ? (
                                                        <div className="overflow-hidden border border-gray-100 dark:border-gray-700 rounded-lg">
                                                            <table className="min-w-full divide-y divide-gray-100 dark:divide-gray-700">
                                                                <thead>
                                                                    <tr className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider bg-gray-50/50 dark:bg-gray-800/30">
                                                                        <th className="px-4 py-2.5">Date</th>
                                                                        <th className="px-4 py-2.5">Type</th>
                                                                        <th className="px-4 py-2.5 text-center">Activity</th>
                                                                        <th className="px-4 py-2.5 text-center">Days</th>
                                                                        <th className="px-4 py-2.5">Balance Change</th>
                                                                        <th className="px-4 py-2.5">Reason</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="bg-white dark:bg-gray-800/40 divide-y divide-gray-50 dark:divide-gray-700">
                                                                    {monthLedger.transactions.map((tx: any, txIdx: number) => (
                                                                        <tr key={txIdx} className="text-xs hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                                                                            <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300">
                                                                                {new Date(tx.startDate).toLocaleDateString()}
                                                                                {tx.endDate && tx.endDate !== tx.startDate && ` - ${new Date(tx.endDate).toLocaleDateString()}`}
                                                                            </td>
                                                                            <td className="px-4 py-2.5">
                                                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                                                                    tx.leaveType === 'CL' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' :
                                                                                    tx.leaveType === 'EL' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
                                                                                    'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                                                                                }`}>
                                                                                    {tx.leaveType}
                                                                                </span>
                                                                            </td>
                                                                            <td className="px-4 py-2.5 text-center">
                                                                                <span className={`font-bold ${
                                                                                    tx.transactionType === 'CREDIT' ? 'text-emerald-600 dark:text-emerald-400' :
                                                                                    tx.transactionType === 'DEBIT' ? 'text-rose-600 dark:text-rose-400' :
                                                                                    'text-indigo-600 dark:text-indigo-400'
                                                                                }`}>
                                                                                    {tx.transactionType}
                                                                                </span>
                                                                            </td>
                                                                            <td className="px-4 py-2.5 text-center font-bold text-gray-900 dark:text-white">
                                                                                {tx.transactionType === 'DEBIT' ? '-' : '+'}{tx.days}
                                                                            </td>
                                                                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">
                                                                                <span className="opacity-60">{tx.openingBalance}</span> → <span className="font-bold text-gray-900 dark:text-gray-100">{tx.closingBalance}</span>
                                                                            </td>
                                                                            <td className="px-4 py-2.5 italic text-gray-500 dark:text-gray-400 max-w-xs truncate">
                                                                                {tx.reason || '—'}
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    ) : (
                                                        <div className="text-center py-6 bg-white dark:bg-gray-800/40 rounded-lg border border-dashed border-gray-200 dark:border-gray-700">
                                                            <p className="text-gray-400 dark:text-gray-500 text-sm italic">No transactions recorded for this month.</p>
                                                        </div>
                                                    )}
                                                </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-4 flex justify-end gap-3 border-t border-gray-100 dark:border-gray-800">
                                <button
                                    type="button"
                                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-colors shadow-lg shadow-indigo-600/20"
                                    onClick={() => setShowEmployeeDetailModal(false)}
                                >
                                    Close Ledger
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* CL Balance Adjustment Modal */}
            {showAdjustModal && (
                <div className="fixed inset-0 bg-black/60 dark:bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-[#1E293B] rounded-xl border border-gray-200 dark:border-gray-800 w-full max-w-md shadow-xl">
                        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Adjust CL Balance</h2>
                            <button
                                onClick={() => setShowAdjustModal(false)}
                                className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                            >
                                ×
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Employee</label>
                                <input
                                    type="text"
                                    value={adjustmentData.employeeName ? `${adjustmentData.employeeName} (${adjustmentData.empNo})` : adjustmentData.employeeId}
                                    disabled
                                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-700 dark:text-gray-300"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Current CL Balance</label>
                                <input
                                    type="text"
                                    value={adjustmentData.clBalance}
                                    readOnly
                                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-700 dark:text-gray-300"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">New balance</label>
                                <input
                                    type="number"
                                    min={0}
                                    step={0.5}
                                    value={adjustmentData.newBalance}
                                    onChange={(e) => setAdjustmentData({ ...adjustmentData, newBalance: e.target.value })}
                                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/30 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                    placeholder="e.g. 12"
                                />
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">An ADJUSTMENT transaction will be created.</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Reason (required)</label>
                                <textarea
                                    value={adjustmentData.reason}
                                    onChange={(e) => setAdjustmentData({ ...adjustmentData, reason: e.target.value })}
                                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/30 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                    rows={3}
                                    placeholder="Enter reason for adjustment"
                                />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={() => setShowAdjustModal(false)}
                                    className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleAdjustment}
                                    className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 font-medium transition-colors"
                                >
                                    Adjust Balance
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
