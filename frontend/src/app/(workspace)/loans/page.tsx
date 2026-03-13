'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { auth } from '@/lib/auth';
import { canManageLoans } from '@/lib/permissions';
import { ToastContainer } from 'react-toastify';
import Swal from 'sweetalert2';
import 'react-toastify/dist/ReactToastify.css';

import {
  Wallet,
  Banknote,
  Clock,
  CheckCircle2,
  XCircle,
  Calendar,
  ChevronRight,
  Search,
  Plus,
  LayoutList,
  LayoutGrid
} from 'lucide-react';

interface LoanApplication {
  _id: string;
  employeeId?: {
    _id: string;
    employee_name?: string;
    emp_no: string;
    gross_salary?: number;
  };
  emp_no?: string;
  requestType: 'loan' | 'salary_advance';
  amount: number;
  reason: string;
  remarks?: string;
  duration: number;
  status: string;
  appliedAt: string;
  department?: { _id: string; name: string };
  designation?: { _id: string; name: string };
  loanConfig?: {
    emiAmount: number;
    interestRate: number;
    totalAmount: number;
  };
  advanceConfig?: {
    deductionCycles: number;
    deductionPerCycle: number;
  };
  repayment?: {
    totalPaid: number;
    remainingBalance: number;
    installmentsPaid: number;
    totalInstallments: number;
    lastPaymentDate?: string;
    nextPaymentDate?: string;
  };
  transactions?: Array<{
    transactionType: string;
    amount: number;
    transactionDate: string;
    payrollCycle?: string;
    processedBy?: { name: string; email: string };
    remarks?: string;
    createdAt: string;
  }>;
  changeHistory?: Array<{
    field: string;
    originalValue: any;
    newValue: any;
    modifiedBy?: { _id: string; name: string; email: string; role: string };
    modifiedByName: string;
    modifiedByRole: string;
    modifiedAt: string;
    reason?: string;
  }>;
  guarantors?: Array<{
    employeeId: any;
    emp_no: string;
    name: string;
    status: 'pending' | 'accepted' | 'rejected';
    actionAt?: string;
    remarks?: string;
  }>;
}

interface Employee {
  _id: string;
  employee_name: string;
  emp_no: string;
  department?: { _id: string; name: string };
  department_id?: string;
  designation?: { _id: string; name: string };
  division?: { _id: string; name: string };
  division_id?: string;
  first_name?: string;
  last_name?: string;
}
// Icon Wrappers for compatibility
const LoanIcon = () => <Banknote className="w-4 h-4" />;
const AdvanceIcon = () => <Wallet className="w-4 h-4" />;

const LoanSkeleton = () => (
  <tr className="animate-pulse border-b border-slate-100 dark:border-slate-800">
    <td className="px-4 py-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-700"></div>
        <div>
          <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded mb-1"></div>
          <div className="h-3 w-20 bg-slate-200 dark:bg-slate-700 rounded"></div>
        </div>
      </div>
    </td>
    <td className="px-4 py-4"><div className="h-4 w-20 bg-slate-200 dark:bg-slate-700 rounded"></div></td>
    <td className="px-4 py-4"><div className="h-4 w-16 bg-slate-200 dark:bg-slate-700 rounded"></div></td>
    <td className="px-4 py-4"><div className="h-6 w-24 bg-slate-200 dark:bg-slate-700 rounded-full"></div></td>
    <td className="px-4 py-4"><div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded"></div></td>
    <td className="px-4 py-4"><div className="h-8 w-8 bg-slate-200 dark:bg-slate-700 rounded-lg"></div></td>
  </tr>
);

const LoanCardSkeleton = () => (
  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 animate-pulse">
    <div className="flex items-start justify-between mb-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-700"></div>
        <div>
          <div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded mb-1"></div>
          <div className="h-3 w-16 bg-slate-200 dark:bg-slate-700 rounded"></div>
        </div>
      </div>
      <div className="h-6 w-20 bg-slate-200 dark:bg-slate-700 rounded-full"></div>
    </div>
    <div className="space-y-3">
      <div className="h-4 w-full bg-slate-200 dark:bg-slate-700 rounded"></div>
      <div className="h-4 w-3/4 bg-slate-200 dark:bg-slate-700 rounded"></div>
    </div>
    <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-between">
      <div className="h-8 w-20 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
      <div className="h-8 w-20 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
    </div>
  </div>
);

export default function LoansPage() {
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [activeTab, setActiveTab] = useState<'loans' | 'advances' | 'pending' | 'guarantor_requests'>('loans');
  const [loans, setLoans] = useState<LoanApplication[]>([]);
  const [advances, setAdvances] = useState<LoanApplication[]>([]);
  const [pendingLoans, setPendingLoans] = useState<LoanApplication[]>([]);
  const [pendingAdvances, setPendingAdvances] = useState<LoanApplication[]>([]);
  const [guarantorRequests, setGuarantorRequests] = useState<LoanApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLoan, setSelectedLoan] = useState<LoanApplication | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [actionComment, setActionComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Edit dialog state
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editFormData, setEditFormData] = useState({
    amount: '',
    reason: '',
    duration: '',
    remarks: '',
    status: '',
  });

  // Apply dialog state
  const [showApplyDialog, setShowApplyDialog] = useState(false);

  // Payment form state (inline in detail dialog)
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentData, setPaymentData] = useState({
    amount: '',
    paymentDate: new Date().toISOString().split('T')[0],
    remarks: '',
    payrollCycle: '',
  });
  // Disbursement dialog state
  const [showDisbursementDialog, setShowDisbursementDialog] = useState(false);
  const [disbursementData, setDisbursementData] = useState({
    disbursementMethod: 'bank_transfer',
    transactionReference: '',
    remarks: '',
  });
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);

  // Settlement preview state
  const [settlementPreview, setSettlementPreview] = useState<any>(null);
  const [loadingSettlement, setLoadingSettlement] = useState(false);
  const [showSettlementDialog, setShowSettlementDialog] = useState(false);
  const [applyType, setApplyType] = useState<'loan' | 'salary_advance'>('loan');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [showEmployeeDropdown, setShowEmployeeDropdown] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [loanSettings, setLoanSettings] = useState<any>(null);
  const [resolvedLoanSettings, setResolvedLoanSettings] = useState<any>(null);
  const [loadingResolvedSettings, setLoadingResolvedSettings] = useState(false);
  const [interestCalculation, setInterestCalculation] = useState<{
    principal: number;
    interestRate: number;
    duration: number;
    emiAmount: number;
    totalInterest: number;
    totalAmount: number;
  } | null>(null);

  const [guarantorSearch, setGuarantorSearch] = useState('');
  const [showGuarantorDropdown, setShowGuarantorDropdown] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    amount: '',
    reason: '',
    duration: '',
    remarks: '',
    needAmount: '', // Optional higher amount request
    guarantorIds: [] as string[],
  });

  // User detection and role-based UI
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isEmployee, setIsEmployee] = useState(false);

  // Permission Check
  const hasManagePermission = currentUser ? canManageLoans(currentUser) : false;

  // Eligibility calculator state (from backend)
  const [eligibilityData, setEligibilityData] = useState<any>(null);
  const [loadingEligibility, setLoadingEligibility] = useState(false);
  const [eligibilityError, setEligibilityError] = useState<string | null>(null);

  // Approval state (for final authority)
  const [approvalAmount, setApprovalAmount] = useState<string>('');
  const [approvalInterestRate, setApprovalInterestRate] = useState<string>('');
  const [approvalValidation, setApprovalValidation] = useState<{ level: 'warning' | 'error'; message: string } | null>(null);


  // User detection on mount
  useEffect(() => {
    const user = auth.getUser();
    if (user) {
      setCurrentUser(user);
      setIsEmployee(user.role === 'employee');
    }
  }, []);

  useEffect(() => {
    loadData();
    loadEmployees();
    loadLoanSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentUser]);

  useEffect(() => {
    if (showDetailDialog && selectedLoan) {
      loadTransactions(selectedLoan._id);
      // Load settlement preview for loans
      if (selectedLoan.requestType === 'loan' && ['disbursed', 'active'].includes(selectedLoan.status)) {
        loadSettlementPreview(selectedLoan._id);
      }

      // Pre-fill approval amount/rate (final authority)
      if (selectedLoan.amount) {
        setApprovalAmount(selectedLoan.amount.toString());
      }
      if (selectedLoan.requestType === 'loan' && selectedLoan.loanConfig?.interestRate !== undefined) {
        setApprovalInterestRate(selectedLoan.loanConfig.interestRate.toString());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDetailDialog, selectedLoan?._id]);

  // Fetch eligibility when viewing/editing a salary advance
  useEffect(() => {
    if ((showDetailDialog || showEditDialog) && selectedLoan && selectedLoan.requestType === 'salary_advance') {
      const empNo = selectedLoan.employeeId?.emp_no;
      if (empNo) {
        fetchEligibility(empNo);
      }
    }
  }, [showDetailDialog, showEditDialog, selectedLoan?._id]);

  // Validate approval amount
  useEffect(() => {
    if (selectedLoan?.requestType === 'salary_advance' && approvalAmount && eligibilityData) {
      const amount = parseFloat(approvalAmount);
      const basicPay = selectedLoan.employeeId?.gross_salary || 0;
      const maxLimit = eligibilityData.finalMaxAllowed || 0;

      if (amount > basicPay) {
        setApprovalValidation({ level: 'error', message: `Amount (₹${amount.toLocaleString()}) exceeds basic pay (₹${basicPay.toLocaleString()})!` });
      } else if (amount > maxLimit) {
        setApprovalValidation({ level: 'warning', message: `Amount (₹${amount.toLocaleString()}) exceeds the calculated eligibility limit (₹${maxLimit.toLocaleString()}).` });
      } else {
        setApprovalValidation(null);
      }
    } else {
      setApprovalValidation(null);
    }
  }, [approvalAmount, eligibilityData, selectedLoan]);

  // Handle click outside for dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showEmployeeDropdown || showGuarantorDropdown) {
        const target = event.target as HTMLElement;
        if (!target.closest('.relative')) {
          setShowEmployeeDropdown(false);
          setShowGuarantorDropdown(false);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEmployeeDropdown, showGuarantorDropdown]);

  useEffect(() => {
    if (applyType === 'loan' && formData.amount && formData.duration && loanSettings) {
      calculateInterest();
    } else {
      setInterestCalculation(null);
    }
  }, [formData.amount, formData.duration, applyType, loanSettings]);

  // Fetch eligibility when employee selected for salary advance
  useEffect(() => {
    if (applyType === 'salary_advance' && selectedEmployee?.emp_no) {
      fetchEligibility(selectedEmployee.emp_no);
    } else {
      setEligibilityData(null);
      setEligibilityError(null);
    }
  }, [selectedEmployee, applyType]);

  // Fetch resolved loan settings when employee is selected
  useEffect(() => {
    const fetchResolvedSettings = async () => {
      if (!selectedEmployee) {
        console.log('[Loan Settings] No employee selected');
        setResolvedLoanSettings(null);
        return;
      }

      // Extract department_id - handle both object and string formats
      const deptId = typeof selectedEmployee.department === 'object'
        ? selectedEmployee.department?._id
        : selectedEmployee.department_id;

      // Extract division_id - handle both object and string formats
      const divId = typeof selectedEmployee.division === 'object'
        ? selectedEmployee.division?._id
        : selectedEmployee.division_id;

      console.log('[Loan Settings] Selected employee:', {
        name: selectedEmployee.employee_name,
        emp_no: selectedEmployee.emp_no,
        department: selectedEmployee.department,
        department_id: selectedEmployee.department_id,
        division: selectedEmployee.division,
        division_id: selectedEmployee.division_id,
        extractedDeptId: deptId,
        extractedDivId: divId
      });

      if (deptId) {
        try {
          setLoadingResolvedSettings(true);
          const settingsType = applyType === 'loan' ? 'loans' : 'salary_advance';

          console.log('[Loan Settings] Fetching resolved settings:', {
            deptId,
            divId,
            settingsType
          });

          const response = await api.getResolvedDepartmentSettings(
            deptId,
            settingsType,
            divId || undefined
          );

          console.log('[Loan Settings] API Response:', response);

          if (response.success && response.data) {
            setResolvedLoanSettings(response.data[settingsType]);
            console.log('[Loan Settings] Resolved settings loaded:', response.data[settingsType]);
          }
        } catch (error) {
          console.error('[Loan Settings] Error fetching resolved settings:', error);
          setResolvedLoanSettings(null);
        } finally {
          setLoadingResolvedSettings(false);
        }
      } else {
        console.log('[Loan Settings] No department_id found, cannot fetch settings');
        setResolvedLoanSettings(null);
      }
    };

    fetchResolvedSettings();
  }, [selectedEmployee, applyType]);

  const loadData = async () => {
    try {
      setLoading(true);
      console.log('[Superadmin Loans] Loading data...');

      // Load all loans - show ALL loans in loans tab (like leaves page)
      const loansRes = await api.getLoans({ requestType: 'loan', limit: 100 });
      console.log('[Superadmin Loans] Loans response:', loansRes);
      if (loansRes.success && loansRes.data) {
        const allLoans = Array.isArray(loansRes.data) ? loansRes.data : [];
        console.log('[Superadmin Loans] All loans:', allLoans);
        setLoans(allLoans);
      } else {
        setLoans([]);
      }

      // Load all advances - show ALL advances in advances tab (like leaves page)
      const advancesRes = await api.getLoans({ requestType: 'salary_advance', limit: 100 });
      console.log('[Superadmin Loans] Advances response:', advancesRes);
      if (advancesRes.success && advancesRes.data) {
        const allAdvances = Array.isArray(advancesRes.data) ? advancesRes.data : [];
        console.log('[Superadmin Loans] All advances:', allAdvances);
        setAdvances(allAdvances);
      } else {
        setAdvances([]);
      }

      // Load pending approvals - only for pending tab
      const pendingRes = await api.getPendingLoanApprovals();
      console.log('[Superadmin Loans] Pending response:', pendingRes);
      if (pendingRes.success && pendingRes.data) {
        const pending = Array.isArray(pendingRes.data) ? pendingRes.data : [];
        console.log('[Superadmin Loans] All pending:', pending);
        setPendingLoans(pending.filter((l: LoanApplication) => l.requestType === 'loan'));
        setPendingAdvances(pending.filter((a: LoanApplication) => a.requestType === 'salary_advance'));
      } else {
        setPendingLoans([]);
        setPendingAdvances([]);
      }

      // Load guarantor requests
      const guarantorRes = await api.getGuarantorRequests();
      if (guarantorRes.success && guarantorRes.data) {
        setGuarantorRequests(guarantorRes.data || []);
      } else {
        setGuarantorRequests([]);
      }
    } catch (err) {
      console.error('[Superadmin Loans] Error loading data:', err);
      setMessage({ type: 'error', text: 'Failed to load loans and advances' });
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (loanId: string, action: 'approve' | 'reject' | 'forward') => {
    if (action === 'approve' && approvalValidation?.level === 'error') {
      Swal.fire({
        icon: 'error',
        title: 'Validation Error',
        text: approvalValidation.message,
      });
      return;
    }

    try {
      setSaving(true);
      const payload: any = {
        action,
        comments: actionComment,
      };

      if (action === 'approve') {
        if (approvalAmount) payload.approvalAmount = parseFloat(approvalAmount);
        if (approvalInterestRate) payload.approvalInterestRate = parseFloat(approvalInterestRate);
      }

      const response = await api.processLoanAction(loanId, payload);
      if (response.success) {
        setMessage({ type: 'success', text: `Loan ${action}d successfully` });
        setShowDetailDialog(false);
        setActionComment('');
        loadData();
      } else {
        setMessage({ type: 'error', text: response.error || 'Failed to process action' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'An error occurred' });
    } finally {
      setSaving(false);
    }
  };

  const handleGuarantorAction = async (loanId: string, action: 'accepted' | 'rejected') => {
    try {
      const { value: remarks } = await Swal.fire({
        title: `Are you sure you want to ${action} this request?`,
        input: 'textarea',
        inputLabel: 'Remarks (Optional)',
        inputPlaceholder: 'Enter your remarks here...',
        showCancelButton: true,
        confirmButtonText: action.charAt(0).toUpperCase() + action.slice(1),
        confirmButtonColor: action === 'accepted' ? '#10b981' : '#ef4444',
      });

      if (remarks !== undefined) {
        setSaving(true);
        const response = await api.processGuarantorAction(loanId, action, remarks);
        if (response.success) {
          Swal.fire('Success!', `Request ${action} successfully.`, 'success');
          loadData();
        } else {
          Swal.fire('Error!', response.error || `Failed to ${action} request.`, 'error');
        }
      }
    } catch (error) {
      console.error('Error processing guarantor action:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleDisburse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLoan) return;

    try {
      setSaving(true);
      setMessage(null);

      const response = await api.disburseLoan(selectedLoan._id, {
        disbursementMethod: disbursementData.disbursementMethod,
        transactionReference: disbursementData.transactionReference,
        remarks: disbursementData.remarks,
      });

      if (response.success) {
        setMessage({ type: 'success', text: 'Funds released successfully. Transaction recorded.' });
        setShowDisbursementDialog(false);
        setDisbursementData({ disbursementMethod: 'bank_transfer', transactionReference: '', remarks: '' });

        // Reload loan data and transactions
        const loanRes = await api.getLoan(selectedLoan._id);
        if (loanRes.success) {
          setSelectedLoan(loanRes.data);
        }
        loadTransactions(selectedLoan._id);
        loadData();
      } else {
        setMessage({ type: 'error', text: response.error || 'Failed to release funds' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'An error occurred' });
    } finally {
      setSaving(false);
    }
  };

  const loadTransactions = async (loanId: string) => {
    try {
      setLoadingTransactions(true);
      const response = await api.getLoanTransactions(loanId);
      if (response.success && response.data) {
        setTransactions(response.data.transactions || []);
      }
    } catch (err) {
      console.error('Error loading transactions:', err);
    } finally {
      setLoadingTransactions(false);
    }
  };

  const loadSettlementPreview = async (loanId: string) => {
    try {
      setLoadingSettlement(true);
      const response = await api.getSettlementPreview(loanId);
      if (response.success && response.data) {
        setSettlementPreview(response.data);
      }
    } catch (err) {
      console.error('Error loading settlement preview:', err);
      setSettlementPreview(null);
    } finally {
      setLoadingSettlement(false);
    }
  };

  const handleEdit = () => {
    if (!selectedLoan) return;

    setEditFormData({
      amount: selectedLoan.amount.toString(),
      reason: selectedLoan.reason || '',
      duration: selectedLoan.duration.toString(),
      remarks: selectedLoan.remarks || '',
      status: selectedLoan.status,
    });
    setShowEditDialog(true);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLoan) return;

    try {
      setSaving(true);
      const user = auth.getUser();
      const isSuperAdmin = user?.role === 'super_admin';

      const updateData: any = {
        amount: parseFloat(editFormData.amount),
        reason: editFormData.reason,
        duration: parseInt(editFormData.duration),
        remarks: editFormData.remarks,
        changeReason: `Edited by ${user?.name || 'Admin'}`,
      };

      // If Super Admin is changing status, include statusChangeReason
      if (isSuperAdmin && editFormData.status && editFormData.status !== selectedLoan.status) {
        updateData.status = editFormData.status;
        updateData.statusChangeReason = `Status changed from ${selectedLoan.status} to ${editFormData.status}`;
      }

      const response = await api.updateLoan(selectedLoan._id, updateData);

      if (response.success) {
        Swal.fire({
          icon: 'success',
          title: 'Success!',
          text: `${selectedLoan.requestType === 'loan' ? 'Loan' : 'Salary advance'} updated successfully`,
          timer: 2000,
          showConfirmButton: false,
        });
        setShowEditDialog(false);
        setShowDetailDialog(false);
        setSelectedLoan(null);
        loadData();
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Failed',
          text: response.error || 'Failed to update',
        });
      }
    } catch (err: any) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: err.message || 'Failed to update',
      });
    } finally {
      setSaving(false);
    }
  };

  const togglePaymentForm = () => {
    if (!selectedLoan) return;

    if (!showPaymentForm) {
      // Pre-fill EMI amount for loans
      const emiAmount = selectedLoan.requestType === 'loan' && selectedLoan.loanConfig?.emiAmount
        ? selectedLoan.loanConfig.emiAmount
        : selectedLoan.requestType === 'salary_advance' && selectedLoan.advanceConfig?.deductionPerCycle
          ? selectedLoan.advanceConfig.deductionPerCycle
          : '';

      setPaymentData({
        amount: emiAmount.toString(),
        paymentDate: new Date().toISOString().split('T')[0],
        remarks: '',
        payrollCycle: '',
      });
    }
    setShowPaymentForm(!showPaymentForm);
  };

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLoan) return;

    try {
      setSaving(true);
      setMessage(null);

      if (!paymentData.amount || parseFloat(paymentData.amount) <= 0) {
        setMessage({ type: 'error', text: 'Please enter a valid payment amount' });
        return;
      }

      const payload = {
        amount: parseFloat(paymentData.amount),
        paymentDate: paymentData.paymentDate,
        remarks: paymentData.remarks,
        payrollCycle: paymentData.payrollCycle || undefined,
      };

      let response;
      if (selectedLoan.requestType === 'loan') {
        response = await api.payEMI(selectedLoan._id, payload);
      } else {
        response = await api.payAdvance(selectedLoan._id, payload);
      }

      if (response.success) {
        Swal.fire({
          icon: 'success',
          title: 'Success!',
          text: `${selectedLoan.requestType === 'loan' ? 'EMI' : 'Advance'} payment recorded successfully`,
          timer: 2000,
          showConfirmButton: false,
        });
        setShowPaymentForm(false);
        setPaymentData({ amount: '', paymentDate: new Date().toISOString().split('T')[0], remarks: '', payrollCycle: '' });

        // Reload loan data and transactions
        const loanRes = await api.getLoan(selectedLoan._id);
        if (loanRes.success) {
          setSelectedLoan(loanRes.data);
        }
        loadTransactions(selectedLoan._id);
        if (selectedLoan.requestType === 'loan') {
          loadSettlementPreview(selectedLoan._id);
        }
        loadData();
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Failed',
          text: response.error || 'Failed to record payment',
        });
      }
    } catch (err: any) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: err.message || 'An error occurred',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleEarlySettlement = async () => {
    if (!selectedLoan || !settlementPreview) return;

    try {
      setSaving(true);
      const payload = {
        amount: settlementPreview.current.settlementAmount,
        paymentDate: new Date().toISOString().split('T')[0],
        remarks: `Early settlement - Interest saved: ₹${settlementPreview.current.interestSavings.toLocaleString()}`,
        isEarlySettlement: true,
      };

      const response = await api.payEMI(selectedLoan._id, payload);

      if (response.success) {
        Swal.fire({
          icon: 'success',
          title: 'Settlement Complete!',
          html: `
            <div class="text-left">
              <p class="mb-2">Early settlement payment recorded successfully!</p>
              <p class="text-sm text-gray-600 mb-1"><strong>Amount Paid:</strong> ₹${settlementPreview.current.settlementAmount.toLocaleString()}</p>
              <p class="text-sm text-green-600 mb-1"><strong>Interest Saved:</strong> ₹${settlementPreview.current.interestSavings.toLocaleString()}</p>
              <p class="text-sm text-gray-600"><strong>Months Used:</strong> ${settlementPreview.current.actualMonthsUsed} of ${settlementPreview.current.originalDuration}</p>
            </div>
          `,
          timer: 3000,
        });
        setShowSettlementDialog(false);
        setShowDetailDialog(false);
        setSelectedLoan(null);
        loadData();
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Failed',
          text: response.error || 'Failed to process early settlement',
        });
      }
    } catch (err: any) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: err.message || 'Failed to process early settlement',
      });
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  // Fetch eligibility from backend
  const fetchEligibility = async (empNo: string) => {
    try {
      setLoadingEligibility(true);
      setEligibilityError(null);

      const token = auth.getToken();
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'}/loans/calculate-eligibility?empNo=${empNo}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (data.success && data.data) {
        setEligibilityData(data.data);
      } else {
        setEligibilityError(data.message || 'Failed to calculate eligibility');
        setEligibilityData(null);
      }
    } catch (error: any) {
      console.error('Error fetching eligibility:', error);
      setEligibilityError(error.message || 'Error calculating eligibility');
      setEligibilityData(null);
    } finally {
      setLoadingEligibility(false);
    }
  };

  const loadEmployees = async () => {
    try {
      if (!currentUser) return;

      // For employees: Load only self
      if (isEmployee) {
        const identifier = (currentUser as any).emp_no || currentUser.employeeId;
        if (identifier) {
          try {
            const response = await api.getEmployee(identifier);
            if (response.success && response.data) {
              setEmployees([response.data]);
              // Auto-select for employee
              setSelectedEmployee(response.data);
            }
          } catch (err) {
            console.error('Error loading employee details:', err);
          }
        }
      } else {
        // For HOD/HR/Admin: Load all employees
        const response = await api.getEmployees({ is_active: true });
        if (response.success && response.data) {
          setEmployees(response.data || []);
        }
      }
    } catch (err) {
      console.error('Error loading employees:', err);
    }
  };

  const loadLoanSettings = async () => {
    try {
      const response = await api.getLoanSettings('loan');
      if (response.success && response.data) {
        setLoanSettings(response.data);
      }
    } catch (err) {
      console.error('Error loading loan settings:', err);
    }
  };

  const calculateInterest = () => {
    const principal = parseFloat(formData.amount);
    const duration = parseInt(formData.duration);
    if (!principal || !duration || !loanSettings) return;

    const interestRate = loanSettings.settings?.interestRate || 0;
    const isInterestApplicable = loanSettings.settings?.isInterestApplicable || false;

    if (!isInterestApplicable || interestRate === 0) {
      const emiAmount = principal / duration;
      setInterestCalculation({
        principal,
        interestRate: 0,
        duration,
        emiAmount: Math.round(emiAmount),
        totalInterest: 0,
        totalAmount: principal,
      });
    } else {
      // Simple Interest Calculation: SI = (P * R * T) / 100
      const totalInterest = (principal * interestRate * (duration / 12)) / 100;
      const totalAmount = principal + totalInterest;
      const emiAmount = totalAmount / duration;

      setInterestCalculation({
        principal,
        interestRate,
        duration,
        emiAmount: Math.round(emiAmount),
        totalInterest: Math.round(totalInterest),
        totalAmount: Math.round(totalAmount),
      });
    }
  };

  const getEmployeeName = (emp: Employee) => {
    if (emp.employee_name) return emp.employee_name;
    if (emp.first_name && emp.last_name) return `${emp.first_name} ${emp.last_name}`;
    if (emp.first_name) return emp.first_name;
    return emp.emp_no;
  };

  const getEmployeeInitials = (emp: Employee) => {
    const name = getEmployeeName(emp);
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
    }
    return (name[0] || 'E').toUpperCase();
  };

  const openApplyDialog = (type: 'loan' | 'salary_advance') => {
    setApplyType(type);
    setFormData({ amount: '', reason: '', duration: '', remarks: '', needAmount: '', guarantorIds: [] });
    setSelectedEmployee(null);
    setEmployeeSearch('');
    setInterestCalculation(null);
    setShowApplyDialog(true);
  };

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setMessage(null);

      if (!selectedEmployee) {
        setMessage({ type: 'error', text: 'Please select an employee' });
        return;
      }

      if (!formData.amount || !formData.reason) {
        setMessage({ type: 'error', text: 'Please fill all required fields' });
        return;
      }

      if (applyType === 'loan' && !formData.duration) {
        setMessage({ type: 'error', text: 'Duration is required for loans' });
        return;
      }

      if (applyType === 'loan' && (!formData.guarantorIds || formData.guarantorIds.length < 2)) {
        setMessage({ type: 'error', text: 'At least 2 unique guarantors are required for loan applications' });
        return;
      }

      const payload: any = {
        requestType: applyType,
        amount: parseFloat(formData.amount),
        reason: formData.reason,
        remarks: formData.remarks,
        needAmount: formData.needAmount ? parseFloat(formData.needAmount) : undefined,
        empNo: selectedEmployee.emp_no,
      };

      if (applyType === 'loan') {
        payload.duration = parseInt(formData.duration);
        payload.guarantorIds = formData.guarantorIds;
      } else {
        payload.duration = formData.duration ? parseInt(formData.duration) : 1;
      }

      const response = await api.applyLoan(payload);

      if (response.success) {
        setMessage({ type: 'success', text: `${applyType === 'loan' ? 'Loan' : 'Salary advance'} applied successfully for ${getEmployeeName(selectedEmployee)}` });
        setShowApplyDialog(false);
        setFormData({ amount: '', reason: '', duration: '', remarks: '', needAmount: '', guarantorIds: [] });
        setSelectedEmployee(null);
        setEmployeeSearch('');
        loadData();
      } else {
        setMessage({ type: 'error', text: response.error || 'Failed to submit application' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'An error occurred' });
    } finally {
      setSaving(false);
    }
  };

  const filteredEmployees = employees.filter((emp) => {
    const search = employeeSearch.toLowerCase();
    return (
      getEmployeeName(emp).toLowerCase().includes(search) ||
      emp.emp_no.toLowerCase().includes(search) ||
      emp.department?.name.toLowerCase().includes(search)
    );
  });

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      hod_approved: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      hod_rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      manager_approved: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
      manager_rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      hr_approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      hr_rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      disbursed: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
      active: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
      completed: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
    };
    return colors[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
  };



  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 pb-10">
      {/* Sticky Header */}
      <div className="sticky top-4 z-40 px-4 mb-8">
        <div className="max-w-[1920px] mx-auto bg-white/70 dark:bg-slate-900/70 backdrop-blur-2xl rounded-[2.5rem] border border-white/20 dark:border-slate-800 shadow-2xl shadow-slate-200/50 dark:shadow-none min-h-[4.5rem] flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 sm:px-8 py-4 sm:py-0">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
              <Banknote className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-black bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 uppercase tracking-tight">
                Loans & Advances
              </h1>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                Workspace <span className="h-1 w-1 rounded-full bg-slate-300"></span> Finance
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto overflow-x-auto hide-scrollbar">
            {/* Search Input in Header if space permits, or keep it below */}

            <button
              onClick={() => openApplyDialog('loan')}
              className="group h-10 sm:h-11 px-4 sm:px-6 rounded-xl sm:rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[9px] sm:text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-slate-900/10 dark:shadow-white/10 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Apply Request</span>
              <span className="sm:hidden">Apply</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1920px] mx-auto px-6">

        {/* Stats Cards - Kept as requested but wrapped to fit layout */}
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: 'Total Active Loans',
              value: loans.length,
              icon: <Banknote className="w-5 h-5" />,
              color: 'emerald',
              gradient: 'from-emerald-500 to-emerald-600',
              shadow: 'shadow-emerald-500/20'
            },
            {
              label: 'Active Salary Advances',
              value: advances.length,
              icon: <Wallet className="w-5 h-5" />,
              color: 'teal',
              gradient: 'from-teal-500 to-teal-600',
              shadow: 'shadow-teal-500/20'
            },
            {
              label: 'Pending Approvals',
              value: pendingLoans.length + pendingAdvances.length,
              icon: <Clock className="w-5 h-5" />,
              color: 'amber',
              gradient: 'from-amber-500 to-amber-600',
              shadow: 'shadow-amber-500/20',
              isWarning: true
            },
            {
              label: 'Total Disbursed',
              value: loans.filter(l => l.status === 'approved' || l.status === 'disbursed').length + advances.filter(a => a.status === 'approved' || a.status === 'disbursed').length,
              icon: <CheckCircle2 className="w-5 h-5" />,
              color: 'green',
              gradient: 'from-green-500 to-green-600',
              shadow: 'shadow-green-500/20'
            }
          ].map((stat, idx) => (
            <div
              key={idx}
              className="group relative overflow-hidden rounded-3xl border border-slate-200/60 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md dark:border-slate-800/60 dark:bg-slate-900"
            >
              <div className="flex items-center gap-4">
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${stat.gradient} ${stat.shadow} text-white transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3`}>
                  {stat.icon}
                </div>
                <div>
                  <div className={`text-2xl font-black tracking-tight ${stat.isWarning ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
                    {stat.value}
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {stat.label}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Tab Navigation & Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="inline-flex items-center p-1 rounded-xl bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 backdrop-blur-sm shadow-inner overflow-x-auto scrollbar-hide">
            {[
              { id: 'loans', label: 'Loans', icon: Banknote, count: loans.length, activeColor: 'emerald' },
              { id: 'advances', label: 'Advances', icon: Wallet, count: advances.length, activeColor: 'teal' },
              { id: 'pending', label: 'Pending', icon: Clock, count: pendingLoans.length + pendingAdvances.length, activeColor: 'amber' },
              { id: 'guarantor_requests', label: 'Guarantor Requests', icon: CheckCircle2, count: guarantorRequests.length, activeColor: 'blue' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`group relative flex items-center gap-2 px-4 sm:px-6 py-2 rounded-lg text-xs font-bold transition-all duration-300 whitespace-nowrap ${activeTab === tab.id
                  ? `bg-white dark:bg-slate-700 text-${tab.id === 'pending' ? 'amber-600' : tab.id === 'advances' ? 'teal-600' : tab.id === 'guarantor_requests' ? 'blue-600' : 'emerald-600'} dark:text-${tab.id === 'pending' ? 'amber-400' : tab.id === 'advances' ? 'teal-400' : tab.id === 'guarantor_requests' ? 'blue-400' : 'emerald-400'} shadow-sm ring-1 ring-slate-200/50 dark:ring-0`
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
              >
                <tab.icon className={`w-3.5 h-3.5 ${activeTab === tab.id
                  ? `text-${tab.id === 'pending' ? 'amber-600' : tab.id === 'advances' ? 'teal-600' : tab.id === 'guarantor_requests' ? 'blue-600' : 'emerald-600'} dark:text-${tab.id === 'pending' ? 'amber-400' : tab.id === 'advances' ? 'teal-400' : tab.id === 'guarantor_requests' ? 'blue-400' : 'emerald-400'}`
                  : 'text-slate-400 group-hover:text-slate-600'}`} />
                <span>{tab.label}</span>
                {tab.count > 0 && (
                  <span className={`flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-md text-[10px] font-black ${activeTab === tab.id
                    ? `bg-${tab.id === 'pending' ? 'amber-50' : tab.id === 'advances' ? 'teal-50' : tab.id === 'guarantor_requests' ? 'blue-50' : 'emerald-50'} text-${tab.id === 'pending' ? 'amber-600' : tab.id === 'advances' ? 'teal-600' : tab.id === 'guarantor_requests' ? 'blue-600' : 'emerald-600'} dark:bg-${tab.id === 'pending' ? 'amber-900/30' : tab.id === 'advances' ? 'teal-900/30' : tab.id === 'guarantor_requests' ? 'blue-900/30' : 'emerald-900/30'}`
                    : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                    }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {/* Search Input */}
            {(activeTab === 'loans' || activeTab === 'advances') && (
              <div className="relative flex-1 sm:min-w-[200px]">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <Search className="w-3.5 h-3.5" />
                </div>
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full h-9 rounded-xl border border-slate-200/60 bg-white py-1 pl-9 pr-4 text-xs font-bold transition-all focus:border-emerald-400 focus:outline-none focus:ring-4 focus:ring-emerald-400/10 dark:border-slate-700/60 dark:bg-slate-800 dark:text-white"
                />
              </div>
            )}

            {/* View Toggle */}
            <div className="flex items-center gap-1 bg-slate-100/50 dark:bg-slate-800/50 p-1 rounded-xl border border-slate-200/50 dark:border-slate-700/50 shrink-0">
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-lg transition-all ${viewMode === 'list'
                  ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm'
                  : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
                  }`}
                title="List View"
              >
                <LayoutList className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('card')}
                className={`p-2 rounded-lg transition-all ${viewMode === 'card'
                  ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm'
                  : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
                  }`}
                title="Card View"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Messages */}
        {message && (
          <div className={`mb-6 rounded-xl border px-4 py-3 flex items-center justify-between ${message.type === 'success'
            ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400'
            : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
            }`}>
            <span>{message.text}</span>
            <button onClick={() => setMessage(null)} className="text-current hover:opacity-70">×</button>
          </div>
        )}


        {/* Content */}
        <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 overflow-hidden">
          {activeTab === 'loans' && (
            <>
              {viewMode === 'list' ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 dark:bg-slate-900">
                      <tr>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Employee</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Amount</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Duration</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Date</th>
                        <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {loading ? (
                        [...Array(5)].map((_, i) => <LoanSkeleton key={i} />)
                      ) : loans.filter((item) => {
                        if (searchTerm) {
                          const searchLower = searchTerm.toLowerCase();
                          return (
                            (item.employeeId?.employee_name || '').toLowerCase().includes(searchLower) ||
                            (item.emp_no || item.employeeId?.emp_no || '').toLowerCase().includes(searchLower) ||
                            item.reason.toLowerCase().includes(searchLower)
                          );
                        }
                        return true;
                      }).length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                            <div className="flex flex-col items-center justify-center">
                              <Banknote className="w-12 h-12 text-slate-300 mb-3" />
                              <p className="text-lg font-medium text-slate-900 dark:text-white">No loans found</p>
                              <p className="text-sm text-slate-500">Try adjusting your search or filters</p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        loans.filter((item) => {
                          if (searchTerm) {
                            const searchLower = searchTerm.toLowerCase();
                            return (
                              (item.employeeId?.employee_name || '').toLowerCase().includes(searchLower) ||
                              (item.emp_no || item.employeeId?.emp_no || '').toLowerCase().includes(searchLower) ||
                              item.reason.toLowerCase().includes(searchLower)
                            );
                          }
                          return true;
                        }).map((loan) => (
                          <tr
                            key={loan._id}
                            className="group hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors"
                          >
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-700 dark:text-emerald-400 font-bold text-sm">
                                  {(loan.employeeId?.employee_name || loan.emp_no || 'E')[0]}
                                </div>
                                <div>
                                  <div className="font-semibold text-slate-900 dark:text-white">
                                    {loan.employeeId?.employee_name || loan.emp_no || 'Unknown'}
                                  </div>
                                  <div className="text-xs text-slate-500 font-medium">{loan.emp_no || loan.employeeId?.emp_no || 'N/A'}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="text-sm font-bold text-slate-900 dark:text-white">
                                ₹{loan.amount.toLocaleString()}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300">
                                <Calendar className="w-3.5 h-3.5" />
                                {loan.duration} months
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-full capitalize ${getStatusColor(loan.status)}`}>
                                <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                                {loan.status?.replace('_', ' ') || '-'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-slate-500 font-medium">
                              {new Date(loan.appliedAt).toLocaleDateString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button
                                onClick={() => {
                                  setSelectedLoan(loan);
                                  setShowDetailDialog(true);
                                }}
                                className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-all"
                              >
                                <ChevronRight className="w-5 h-5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6">
                  {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {[...Array(6)].map((_, i) => <LoanCardSkeleton key={i} />)}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {loans.filter((item) => {
                        if (searchTerm) {
                          const searchLower = searchTerm.toLowerCase();
                          return (
                            (item.employeeId?.employee_name || '').toLowerCase().includes(searchLower) ||
                            (item.emp_no || item.employeeId?.emp_no || '').toLowerCase().includes(searchLower) ||
                            item.reason.toLowerCase().includes(searchLower)
                          );
                        }
                        return true;
                      }).length === 0 ? (
                        <div className="col-span-full flex flex-col items-center justify-center py-12 text-center">
                          <Banknote className="w-16 h-16 text-slate-200 mb-4" />
                          <p className="text-xl font-bold text-slate-900 dark:text-white">No loans found</p>
                        </div>
                      ) : (
                        loans.filter((item) => {
                          if (searchTerm) {
                            const searchLower = searchTerm.toLowerCase();
                            return (
                              (item.employeeId?.employee_name || '').toLowerCase().includes(searchLower) ||
                              (item.emp_no || item.employeeId?.emp_no || '').toLowerCase().includes(searchLower) ||
                              item.reason.toLowerCase().includes(searchLower)
                            );
                          }
                          return true;
                        }).map((loan) => (
                          <div
                            key={loan._id}
                            onClick={() => {
                              setSelectedLoan(loan);
                              setShowDetailDialog(true);
                            }}
                            className="group relative cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900"
                          >
                            <div className="flex items-start justify-between mb-4">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-700 dark:text-emerald-400 font-bold text-sm">
                                  {(loan.employeeId?.employee_name || loan.emp_no || 'E')[0]}
                                </div>
                                <div>
                                  <h3 className="font-bold text-slate-900 dark:text-white line-clamp-1">
                                    {loan.employeeId?.employee_name || loan.emp_no || 'Unknown'}
                                  </h3>
                                  <p className="text-xs text-slate-500 font-medium">{loan.emp_no || loan.employeeId?.emp_no}</p>
                                </div>
                              </div>
                              <div className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg ${getStatusColor(loan.status)}`}>
                                {loan.status?.replace('_', ' ')}
                              </div>
                            </div>

                            <div className="space-y-3">
                              <div className="flex justify-between items-center p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                                <span className="text-xs font-semibold text-slate-500 uppercase">Amount</span>
                                <span className="text-base font-bold text-slate-900 dark:text-white">₹{loan.amount.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between items-center px-2">
                                <span className="text-xs text-slate-500">Duration</span>
                                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{loan.duration} Months</span>
                              </div>
                              <div className="flex justify-between items-center px-2">
                                <span className="text-xs text-slate-500">Applied</span>
                                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                                  {new Date(loan.appliedAt).toLocaleDateString('en-IN', {
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric',
                                  })}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {activeTab === 'advances' && (
            <>
              {viewMode === 'list' ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 dark:bg-slate-900">
                      <tr>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Employee</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Amount</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Date</th>
                        <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {loading ? (
                        [...Array(5)].map((_, i) => <LoanSkeleton key={i} />)
                      ) : advances.filter((item) => {
                        if (searchTerm) {
                          const searchLower = searchTerm.toLowerCase();
                          return (
                            (item.employeeId?.employee_name || '').toLowerCase().includes(searchLower) ||
                            (item.emp_no || item.employeeId?.emp_no || '').toLowerCase().includes(searchLower) ||
                            item.reason.toLowerCase().includes(searchLower)
                          );
                        }
                        return true;
                      }).length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                            <div className="flex flex-col items-center justify-center">
                              <Wallet className="w-12 h-12 text-slate-300 mb-3" />
                              <p className="text-lg font-medium text-slate-900 dark:text-white">No advances found</p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        advances.filter((item) => {
                          if (searchTerm) {
                            const searchLower = searchTerm.toLowerCase();
                            return (
                              (item.employeeId?.employee_name || '').toLowerCase().includes(searchLower) ||
                              (item.emp_no || item.employeeId?.emp_no || '').toLowerCase().includes(searchLower) ||
                              item.reason.toLowerCase().includes(searchLower)
                            );
                          }
                          return true;
                        }).map((advance) => (
                          <tr
                            key={advance._id}
                            className="group hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors"
                          >
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center text-teal-700 dark:text-teal-400 font-bold text-sm">
                                  {(advance.employeeId?.employee_name || advance.emp_no || 'E')[0]}
                                </div>
                                <div>
                                  <div className="font-semibold text-slate-900 dark:text-white">
                                    {advance.employeeId?.employee_name || advance.emp_no || 'Unknown'}
                                  </div>
                                  <div className="text-xs text-slate-500 font-medium">{advance.emp_no || advance.employeeId?.emp_no || 'N/A'}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="text-sm font-bold text-slate-900 dark:text-white">
                                ₹{advance.amount.toLocaleString()}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-full capitalize ${getStatusColor(advance.status)}`}>
                                <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                                {advance.status?.replace('_', ' ') || '-'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-slate-500 font-medium">
                              {new Date(advance.appliedAt).toLocaleDateString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button
                                onClick={() => {
                                  setSelectedLoan(advance);
                                  setShowDetailDialog(true);
                                }}
                                className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-all"
                              >
                                <ChevronRight className="w-5 h-5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6">
                  {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {[...Array(6)].map((_, i) => <LoanCardSkeleton key={i} />)}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {advances.filter((item) => {
                        if (searchTerm) {
                          const searchLower = searchTerm.toLowerCase();
                          return (
                            (item.employeeId?.employee_name || '').toLowerCase().includes(searchLower) ||
                            (item.emp_no || item.employeeId?.emp_no || '').toLowerCase().includes(searchLower) ||
                            item.reason.toLowerCase().includes(searchLower)
                          );
                        }
                        return true;
                      }).length === 0 ? (
                        <div className="col-span-full flex flex-col items-center justify-center py-12 text-center">
                          <Wallet className="w-16 h-16 text-slate-200 mb-4" />
                          <p className="text-xl font-bold text-slate-900 dark:text-white">No advances found</p>
                        </div>
                      ) : (
                        advances.filter((item) => {
                          if (searchTerm) {
                            const searchLower = searchTerm.toLowerCase();
                            return (
                              (item.employeeId?.employee_name || '').toLowerCase().includes(searchLower) ||
                              (item.emp_no || item.employeeId?.emp_no || '').toLowerCase().includes(searchLower) ||
                              item.reason.toLowerCase().includes(searchLower)
                            );
                          }
                          return true;
                        }).map((advance) => (
                          <div
                            key={advance._id}
                            onClick={() => {
                              setSelectedLoan(advance);
                              setShowDetailDialog(true);
                            }}
                            className="group relative cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900"
                          >
                            <div className="flex items-start justify-between mb-4">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center text-teal-700 dark:text-teal-400 font-bold text-sm">
                                  {(advance.employeeId?.employee_name || advance.emp_no || 'E')[0]}
                                </div>
                                <div>
                                  <h3 className="font-bold text-slate-900 dark:text-white line-clamp-1">
                                    {advance.employeeId?.employee_name || advance.emp_no || 'Unknown'}
                                  </h3>
                                  <p className="text-xs text-slate-500 font-medium">{advance.emp_no || advance.employeeId?.emp_no}</p>
                                </div>
                              </div>
                              <div className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg ${getStatusColor(advance.status)}`}>
                                {advance.status?.replace('_', ' ')}
                              </div>
                            </div>

                            <div className="space-y-3">
                              <div className="flex justify-between items-center p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                                <span className="text-xs font-semibold text-slate-500 uppercase">Amount</span>
                                <span className="text-base font-bold text-slate-900 dark:text-white">₹{advance.amount.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between items-center px-2">
                                <span className="text-xs text-slate-500">Applied</span>
                                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                                  {new Date(advance.appliedAt).toLocaleDateString('en-IN', {
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric',
                                  })}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {activeTab === 'pending' && (
            <div className="p-4 space-y-4">
              {/* Pending Loans */}
              {pendingLoans.length > 0 && (
                <div>
                  <h3 className="text-base font-bold text-slate-800 dark:text-slate-200 mb-4 flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white">
                      <LoanIcon />
                    </div>
                    Pending Loans ({pendingLoans.length})
                  </h3>
                  <div className="space-y-4">
                    {pendingLoans.map((loan) => (
                      <div key={loan._id} className="rounded-2xl border-2 border-amber-200/50 bg-gradient-to-br from-amber-50/80 to-yellow-50/50 p-5 dark:border-amber-800/30 dark:from-amber-900/20 dark:to-yellow-900/10 shadow-sm hover:shadow-md transition-all duration-300">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="font-medium text-slate-900 dark:text-white">
                                {loan.employeeId?.employee_name || loan.emp_no || 'Unknown'}
                              </span>
                              <span className="text-xs text-slate-500">({loan.emp_no || loan.employeeId?.emp_no || 'N/A'})</span>
                              <span className={`px-2 py-0.5 text-xs font-medium rounded ${getStatusColor(loan.status)}`}>
                                {loan.status.replace('_', ' ')}
                              </span>
                            </div>
                            <div className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                              <div><strong>Amount:</strong> ₹{loan.amount.toLocaleString()} | <strong>Duration:</strong> {loan.duration} months</div>
                              <div><strong>Reason:</strong> {loan.reason}</div>
                            </div>
                          </div>
                          <div className="flex gap-3">
                            {hasManagePermission && (
                              <button
                                onClick={() => {
                                  setSelectedLoan(loan);
                                  setShowDetailDialog(true);
                                }}
                                className="px-5 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-green-500 to-green-600 rounded-xl hover:from-green-600 hover:to-green-700 flex items-center gap-2 transition-all duration-300 shadow-md shadow-green-500/30 hover:shadow-lg"
                              >
                                <CheckCircle2 className="w-4 h-4" /> Approve
                              </button>
                            )}
                            {hasManagePermission && (
                              <button
                                onClick={() => {
                                  setSelectedLoan(loan);
                                  setShowDetailDialog(true);
                                }}
                                className="px-5 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-red-500 to-red-600 rounded-xl hover:from-red-600 hover:to-red-700 flex items-center gap-2 transition-all duration-300 shadow-md shadow-red-500/30 hover:shadow-lg"
                              >
                                <XCircle className="w-4 h-4" /> Reject
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Pending Advances */}
              {pendingAdvances.length > 0 && (
                <div>
                  <h3 className="text-base font-bold text-slate-800 dark:text-slate-200 mb-4 flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center text-white">
                      <AdvanceIcon />
                    </div>
                    Pending Advances ({pendingAdvances.length})
                  </h3>
                  <div className="space-y-4">
                    {pendingAdvances.map((advance) => (
                      <div key={advance._id} className="rounded-2xl border-2 border-amber-200/50 bg-gradient-to-br from-amber-50/80 to-yellow-50/50 p-5 dark:border-amber-800/30 dark:from-amber-900/20 dark:to-yellow-900/10 shadow-sm hover:shadow-md transition-all duration-300">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="font-medium text-slate-900 dark:text-white">
                                {advance.employeeId?.employee_name || advance.emp_no || 'Unknown'}
                              </span>
                              <span className="text-xs text-slate-500">({advance.emp_no || advance.employeeId?.emp_no || 'N/A'})</span>
                              <span className={`px-2 py-0.5 text-xs font-medium rounded ${getStatusColor(advance.status)}`}>
                                {advance.status.replace('_', ' ')}
                              </span>
                            </div>
                            <div className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                              <div><strong>Amount:</strong> ₹{advance.amount.toLocaleString()}</div>
                              <div><strong>Reason:</strong> {advance.reason}</div>
                            </div>
                          </div>
                          <div className="flex gap-3">
                            {hasManagePermission && (
                              <button
                                onClick={() => {
                                  setSelectedLoan(advance);
                                  setShowDetailDialog(true);
                                }}
                                className="px-5 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-green-500 to-green-600 rounded-xl hover:from-green-600 hover:to-green-700 flex items-center gap-2 transition-all duration-300 shadow-md shadow-green-500/30 hover:shadow-lg"
                              >
                                <CheckCircle2 className="w-4 h-4" /> Approve
                              </button>
                            )}
                            {hasManagePermission && (
                              <button
                                onClick={() => {
                                  setSelectedLoan(advance);
                                  setShowDetailDialog(true);
                                }}
                                className="px-5 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-red-500 to-red-600 rounded-xl hover:from-red-600 hover:to-red-700 flex items-center gap-2 transition-all duration-300 shadow-md shadow-red-500/30 hover:shadow-lg"
                              >
                                <XCircle className="w-4 h-4" /> Reject
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {pendingLoans.length === 0 && pendingAdvances.length === 0 && (
                <div className="text-center py-12 text-slate-500">
                  No pending approvals
                </div>
              )}
            </div>
          )}

          {activeTab === 'guarantor_requests' && (
            <div className="p-6">
              <h3 className="text-xl font-black text-slate-800 dark:text-slate-200 mb-6 flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                Guarantor Requests
              </h3>
              
              {guarantorRequests.length === 0 ? (
                <div className="text-center py-20 bg-slate-50/50 dark:bg-slate-900/20 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-800">
                  <Banknote className="w-16 h-16 text-slate-300 mx-auto mb-4 opacity-50" />
                  <p className="text-xl font-bold text-slate-900 dark:text-white mb-1">No requests to guarantee</p>
                  <p className="text-slate-500">You haven't been requested as a guarantor for any loans yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {guarantorRequests.map((req) => {
                    const myGuarantorInfo = req.guarantors?.find((g: any) => {
                      const currentUserId = currentUser?.employeeRef || currentUser?.id;
                      if (!currentUserId) return false;
                      const gId = typeof g.employeeId === 'object' ? g.employeeId?._id : g.employeeId;
                      return gId?.toString() === currentUserId.toString();
                    });
                    
                    return (
                      <div key={req._id} className="group relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl dark:border-slate-800 dark:bg-slate-900">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/30 dark:to-indigo-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-black text-lg">
                              {(req.employeeId?.employee_name || 'E')[0]}
                            </div>
                            <div>
                              <div className="font-bold text-slate-900 dark:text-white line-clamp-1">
                                {req.employeeId?.employee_name || 'Unknown'}
                              </div>
                              <div className="text-xs font-bold text-slate-500">{req.emp_no || 'N/A'}</div>
                            </div>
                          </div>
                          <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                            myGuarantorInfo?.status === 'accepted' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                            myGuarantorInfo?.status === 'rejected' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                            'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                          }`}>
                            {myGuarantorInfo?.status || 'pending'}
                          </div>
                        </div>

                        <div className="space-y-3 mb-6">
                          <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50">
                            <span className="text-xs font-bold text-slate-500 uppercase">Amount</span>
                            <span className="text-lg font-black text-slate-900 dark:text-white">₹{req.amount.toLocaleString()}</span>
                          </div>
                          <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50">
                            <span className="text-xs font-bold text-slate-500 uppercase block mb-1">Reason</span>
                            <p className="text-sm text-slate-700 dark:text-slate-300 line-clamp-2 italic">"{req.reason}"</p>
                          </div>
                        </div>

                        {myGuarantorInfo?.status === 'pending' ? (
                          <div className="flex gap-3">
                            <button
                              onClick={() => handleGuarantorAction(req._id, 'accepted')}
                              className="flex-1 py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-2xl text-xs font-black shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40 transition-all flex items-center justify-center gap-2"
                            >
                              <CheckCircle2 className="w-4 h-4" /> Accept
                            </button>
                            <button
                              onClick={() => handleGuarantorAction(req._id, 'rejected')}
                              className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-2xl text-xs font-black hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-all flex items-center justify-center gap-2 border border-transparent hover:border-red-200 dark:hover:border-red-800"
                            >
                              <XCircle className="w-4 h-4" /> Reject
                            </button>
                          </div>
                        ) : (
                          <button
                            disabled
                            className="w-full py-3 bg-slate-50 dark:bg-slate-800/50 text-slate-400 rounded-2xl text-xs font-black flex items-center justify-center gap-2 border border-slate-100 dark:border-slate-800"
                          >
                            <Clock className="w-4 h-4" /> Action Taken
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Detail Dialog */}
        {showDetailDialog && selectedLoan && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => {
              setShowDetailDialog(false);
              setSelectedLoan(null);
              setTransactions([]);
              setShowPaymentForm(false);
              setShowDisbursementDialog(false);
              setSettlementPreview(null);
            }} />
            <div className="relative z-50 w-full max-w-2xl rounded-2xl bg-white shadow-2xl dark:bg-slate-900 max-h-[90vh] overflow-hidden flex flex-col">
              {/* Header */}
              <div className={`p-6 bg-gradient-to-r ${selectedLoan.requestType === 'loan'
                ? 'from-blue-500 to-indigo-600'
                : 'from-purple-500 to-red-600'
                } text-white`}>
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold">
                    {selectedLoan.requestType === 'loan' ? 'Loan' : 'Salary Advance'} Details
                  </h2>
                  <button
                    onClick={() => {
                      setShowDetailDialog(false);
                      setSelectedLoan(null);
                      setTransactions([]);
                      setShowPaymentForm(false);
                      setShowDisbursementDialog(false);
                    }}
                    className="p-2 text-white/80 hover:text-white hover:bg-white/20 rounded-lg transition-colors"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6 overflow-y-auto">
                {/* Status Badge & Dates */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`px-4 py-2 text-sm font-semibold rounded-xl capitalize ${getStatusColor(selectedLoan.status)}`}>
                    {selectedLoan.status?.replace('_', ' ') || 'Unknown'}
                  </span>
                  <div className="flex gap-4 text-sm text-slate-500">
                    <span>Applied: {new Date(selectedLoan.appliedAt).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}</span>
                  </div>
                </div>

                {/* Employee Info */}
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50">
                  <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wide">Employee Details</h3>
                  <div className="flex items-start gap-4">
                    <div className={`w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0 ${selectedLoan.requestType === 'loan' ? 'bg-blue-500' : 'bg-purple-500'
                      }`}>
                      {(selectedLoan.employeeId?.employee_name || selectedLoan.emp_no || 'E')[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-lg text-slate-900 dark:text-white">
                        {selectedLoan.employeeId?.employee_name || selectedLoan.emp_no || 'Unknown'}
                      </p>
                      <p className="text-sm text-slate-500">{selectedLoan.emp_no || selectedLoan.employeeId?.emp_no || 'N/A'}</p>
                      {selectedLoan.department && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {selectedLoan.department.name && (
                            <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 rounded-lg inline-flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                              </svg>
                              {selectedLoan.department.name}
                            </span>
                          )}
                          {selectedLoan.designation?.name && (
                            <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300 rounded-lg inline-flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                              {selectedLoan.designation.name}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Eligibility Information - For Salary Advance (View Only) */}
                {selectedLoan.requestType === 'salary_advance' && eligibilityData && (
                  <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800">
                    <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-3 uppercase tracking-wide flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      Eligibility Information
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white/70 dark:bg-slate-800/70 p-3 rounded-xl">
                        <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Attendance</div>
                        <div className="font-bold text-lg text-green-600 dark:text-green-400">{eligibilityData.attendancePercentage}%</div>
                      </div>
                      <div className="bg-white/70 dark:bg-slate-800/70 p-3 rounded-xl">
                        <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Days Worked</div>
                        <div className="font-bold text-lg text-slate-900 dark:text-white">{eligibilityData.daysWorked} / {eligibilityData.daysElapsedInMonth}</div>
                      </div>
                      <div className="bg-white/70 dark:bg-slate-800/70 p-3 rounded-xl">
                        <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Prorated Amount</div>
                        <div className="font-bold text-lg text-blue-600 dark:text-blue-400">₹{eligibilityData.proratedAmount.toLocaleString()}</div>
                      </div>
                      <div className="bg-white/70 dark:bg-slate-800/70 p-3 rounded-xl">
                        <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Eligible Amount</div>
                        <div className="font-bold text-lg text-green-600 dark:text-green-400">₹{eligibilityData.eligibleAmount.toLocaleString()}</div>
                      </div>
                      <div className="bg-white/70 dark:bg-slate-800/70 p-3 rounded-xl">
                        <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Max Limit</div>
                        <div className="font-bold text-lg text-purple-600 dark:text-purple-400">₹{eligibilityData.maxLimitAmount.toLocaleString()}</div>
                      </div>
                      <div className="bg-white/70 dark:bg-slate-800/70 p-3 rounded-xl">
                        <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Final Max Allowed</div>
                        <div className="font-bold text-lg text-indigo-600 dark:text-indigo-400">₹{eligibilityData.finalMaxAllowed.toLocaleString()}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Details Grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-500 uppercase font-semibold mb-1">Type</p>
                    <p className="text-sm font-medium text-slate-900 dark:text-white capitalize">
                      {selectedLoan.requestType === 'loan' ? 'Loan' : 'Salary Advance'}
                    </p>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-500 uppercase font-semibold mb-1">Amount</p>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">₹{selectedLoan.amount.toLocaleString()}</p>
                  </div>
                  {selectedLoan.requestType === 'loan' && (
                    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                      <p className="text-xs text-slate-500 uppercase font-semibold mb-1">Duration</p>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">
                        {selectedLoan.duration} months
                      </p>
                    </div>
                  )}
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-500 uppercase font-semibold mb-1">Status</p>
                    <span className={`inline-flex px-2.5 py-1 text-xs font-medium rounded-lg capitalize ${getStatusColor(selectedLoan.status)}`}>
                      {selectedLoan.status?.replace('_', ' ') || '-'}
                    </span>
                  </div>
                </div>

                {/* Reason */}
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                  <p className="text-xs text-slate-500 uppercase font-semibold mb-2">Reason</p>
                  <p className="text-sm text-slate-700 dark:text-slate-300">
                    {selectedLoan.reason || 'Not specified'}
                  </p>
                </div>

                {/* Guarantors Status */}
                {selectedLoan.requestType === 'loan' && selectedLoan.guarantors && selectedLoan.guarantors.length > 0 && (
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-blue-500 uppercase font-semibold tracking-wide mb-3 flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Guarantor Status ({selectedLoan.guarantors.filter(g => g.status === 'accepted').length}/{selectedLoan.guarantors.length} Accepted)
                    </p>
                    <div className="space-y-3">
                      {selectedLoan.guarantors.map((guarantor: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 transition-all hover:border-blue-200 dark:hover:border-blue-800">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs ${
                              guarantor.status === 'accepted' ? 'bg-emerald-500' : 
                              guarantor.status === 'rejected' ? 'bg-red-500' : 'bg-amber-500'
                            }`}>
                              {getEmployeeInitials(guarantor)}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-900 dark:text-white">{guarantor.name}</p>
                              <p className="text-[10px] text-slate-500 font-medium">{guarantor.emp_no}</p>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-wider rounded-md ${
                              guarantor.status === 'accepted' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                              guarantor.status === 'rejected' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                              'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                            }`}>
                              {guarantor.status}
                            </span>
                            {guarantor.actionAt && (
                              <p className="text-[9px] text-slate-400 font-medium">
                                {new Date(guarantor.actionAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Change History */}
                {selectedLoan.changeHistory && selectedLoan.changeHistory.length > 0 && (
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-blue-500 uppercase font-semibold tracking-wide mb-3">
                      Change History ({selectedLoan.changeHistory.length})
                    </p>
                    <div className="space-y-3">
                      {selectedLoan.changeHistory.map((change: any, idx: number) => (
                        <div key={idx} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-blue-500 uppercase">
                              {change.field.replace(/([A-Z])/g, ' $1').trim()}
                            </span>
                            <span className="text-xs text-slate-500">
                              {new Date(change.modifiedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </span>
                          </div>
                          <div className="text-sm">
                            <span className="text-slate-400 dark:text-slate-500 line-through">
                              {typeof change.originalValue === 'number'
                                ? change.field === 'amount'
                                  ? `₹${change.originalValue.toLocaleString()}`
                                  : change.originalValue
                                : change.originalValue || 'N/A'}
                            </span>
                            <span className="font-semibold text-green-600 dark:text-green-400 ml-2">
                              → {typeof change.newValue === 'number'
                                ? change.field === 'amount'
                                  ? `₹${change.newValue.toLocaleString()}`
                                  : change.newValue
                                : change.newValue || 'N/A'}
                            </span>
                          </div>
                          {change.reason && (
                            <p className="text-xs text-slate-500 mt-1">{change.reason}</p>
                          )}
                          <p className="text-xs text-slate-400 mt-1">
                            Modified by {change.modifiedByName} ({change.modifiedByRole})
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Loan Calculation */}
                {selectedLoan.requestType === 'loan' && selectedLoan.loanConfig && (
                  <div className="p-4 rounded-xl border-2 border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20">
                    <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-3">Loan Calculation</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">EMI Amount</p>
                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">₹{selectedLoan.loanConfig.emiAmount?.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Total Amount (with interest)</p>
                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">₹{selectedLoan.loanConfig.totalAmount?.toLocaleString()}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Early Settlement Calculator - Only for active/disbursed loans */}
                {selectedLoan.requestType === 'loan' && ['disbursed', 'active'].includes(selectedLoan.status) && (
                  <div className="p-4 rounded-xl border-2 border-green-200 bg-gradient-to-br from-green-50 to-green-50 dark:from-green-900/20 dark:to-green-900/20 dark:border-green-800">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold text-green-900 dark:text-green-100 flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-5m-3 5h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                        Early Settlement Calculator
                      </h3>
                      {loadingSettlement && (
                        <span className="text-xs text-green-600 animate-pulse">Calculating...</span>
                      )}
                    </div>

                    {settlementPreview && settlementPreview.current ? (
                      <div className="space-y-4">
                        {/* Current Settlement */}
                        <div className="p-3 rounded-lg bg-white dark:bg-slate-800 border border-green-200 dark:border-green-700">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-semibold text-green-700 dark:text-green-300">If Paid Now</p>
                            <span className="px-2 py-1 text-xs font-bold text-white bg-green-600 rounded">Current</span>
                          </div>
                          <div className="space-y-1">
                            <div className="flex justify-between items-center">
                              <span className="text-xs text-slate-600 dark:text-slate-400">Settlement Amount:</span>
                              <span className="text-lg font-bold text-green-700 dark:text-green-300">₹{settlementPreview.current.settlementAmount.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-slate-500">Principal:</span>
                              <span className="font-medium">₹{settlementPreview.current.remainingPrincipal.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-slate-500">Interest (for {settlementPreview.current.actualMonthsUsed} months):</span>
                              <span className="font-medium">₹{settlementPreview.current.settlementInterest.toLocaleString()}</span>
                            </div>
                            <div className="pt-2 border-t border-green-200 dark:border-green-700">
                              <div className="flex justify-between items-center">
                                <span className="text-xs font-semibold text-green-600 dark:text-green-400">Interest Saved:</span>
                                <span className="text-sm font-bold text-green-600 dark:text-green-400">₹{settlementPreview.current.interestSavings.toLocaleString()}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Next Month Settlement */}
                        {settlementPreview.nextMonth && (
                          <div className="p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">If Paid Next Month</p>
                              <span className="px-2 py-1 text-xs font-medium text-slate-600 bg-slate-100 dark:bg-slate-700 rounded">Projected</span>
                            </div>
                            <div className="space-y-1">
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-slate-600 dark:text-slate-400">Settlement Amount:</span>
                                <span className="text-base font-bold text-slate-700 dark:text-slate-300">₹{settlementPreview.nextMonth.settlementAmount.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between items-center text-xs">
                                <span className="text-slate-500">Interest Saved:</span>
                                <span className="font-medium text-slate-600">₹{settlementPreview.nextMonth.interestSavings.toLocaleString()}</span>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Pay Full Amount Button */}
                        <button
                          onClick={() => setShowSettlementDialog(true)}
                          disabled={saving}
                          className="w-full px-4 py-3 text-sm font-semibold text-white bg-gradient-to-r from-green-600 to-green-600 rounded-xl hover:from-green-700 hover:to-green-700 transition-all shadow-md hover:shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Pay Full Amount (₹{settlementPreview.current.settlementAmount.toLocaleString()})
                        </button>
                      </div>
                    ) : !loadingSettlement ? (
                      <p className="text-xs text-slate-500 text-center py-2">Unable to calculate settlement preview</p>
                    ) : null}
                  </div>
                )}

                {/* Advance Config */}
                {selectedLoan.requestType === 'salary_advance' && selectedLoan.advanceConfig && (
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-500 uppercase font-semibold mb-2">Deduction Details</p>
                    <p className="text-sm text-slate-700 dark:text-slate-300">
                      ₹{selectedLoan.advanceConfig.deductionPerCycle?.toLocaleString()} per cycle
                    </p>
                  </div>
                )}

                {/* Repayment Status */}
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-slate-500 uppercase font-semibold">Repayment Status</p>
                    {['disbursed', 'active', 'approved'].includes(selectedLoan.status) && (
                      <button
                        onClick={togglePaymentForm}
                        className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all shadow-md hover:shadow-lg flex items-center gap-2 ${showPaymentForm
                          ? 'text-slate-700 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300'
                          : 'text-white bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700'
                          }`}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {showPaymentForm ? 'Cancel' : (selectedLoan.requestType === 'loan' ? 'Pay EMI' : 'Record Payment')}
                      </button>
                    )}
                  </div>
                  {selectedLoan.repayment ? (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-slate-500 mb-1">Total Paid</p>
                        <p className="text-lg font-bold text-green-600 dark:text-green-400">₹{selectedLoan.repayment.totalPaid?.toLocaleString() || 0}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 mb-1">Remaining Balance</p>
                        <p className="text-lg font-bold text-slate-900 dark:text-slate-100">₹{selectedLoan.repayment.remainingBalance?.toLocaleString() || (selectedLoan.requestType === 'loan' ? (selectedLoan.loanConfig?.totalAmount || selectedLoan.amount) : selectedLoan.amount)}</p>
                      </div>
                      {selectedLoan.requestType === 'loan' && (
                        <>
                          <div>
                            <p className="text-xs text-slate-500 mb-1">EMIs Paid</p>
                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                              {selectedLoan.repayment.installmentsPaid || 0} / {selectedLoan.repayment.totalInstallments || selectedLoan.duration}
                            </p>
                          </div>
                          {selectedLoan.repayment.nextPaymentDate && (
                            <div>
                              <p className="text-xs text-slate-500 mb-1">Next Payment Due</p>
                              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                {new Date(selectedLoan.repayment.nextPaymentDate).toLocaleDateString('en-IN', {
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                })}
                              </p>
                            </div>
                          )}
                        </>
                      )}
                      {selectedLoan.requestType === 'salary_advance' && (
                        <div>
                          <p className="text-xs text-slate-500 mb-1">Cycles Paid</p>
                          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                            {selectedLoan.repayment.installmentsPaid || 0} / {selectedLoan.repayment.totalInstallments || selectedLoan.duration}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        {selectedLoan.requestType === 'loan'
                          ? `Total Amount: ₹${(selectedLoan.loanConfig?.totalAmount || selectedLoan.amount).toLocaleString()}`
                          : `Total Amount: ₹${selectedLoan.amount.toLocaleString()}`
                        }
                      </p>
                      <p className="text-xs text-slate-400 mt-1">No payments recorded yet</p>
                    </div>
                  )}
                </div>

                {/* Payment Form Section - Inline */}
                {showPaymentForm && ['disbursed', 'active', 'approved'].includes(selectedLoan.status) && (
                  <div className="p-4 rounded-xl border-2 border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-900/20">
                    <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-4 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {selectedLoan.requestType === 'loan' ? 'Record EMI Payment' : 'Record Advance Payment'}
                    </h3>

                    <form onSubmit={handlePayment} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                            Amount *
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            required
                            value={paymentData.amount}
                            onChange={(e) => setPaymentData({ ...paymentData, amount: e.target.value })}
                            placeholder="Enter payment amount"
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                          {selectedLoan.requestType === 'loan' && selectedLoan.loanConfig?.emiAmount && (
                            <p className="text-xs text-slate-500 mt-1">
                              EMI Amount: ₹{selectedLoan.loanConfig.emiAmount.toLocaleString()}
                            </p>
                          )}
                          {selectedLoan.requestType === 'salary_advance' && selectedLoan.advanceConfig?.deductionPerCycle && (
                            <p className="text-xs text-slate-500 mt-1">
                              Deduction per cycle: ₹{selectedLoan.advanceConfig.deductionPerCycle.toLocaleString()}
                            </p>
                          )}
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                            Payment Date *
                          </label>
                          <input
                            type="date"
                            required
                            value={paymentData.paymentDate}
                            onChange={(e) => setPaymentData({ ...paymentData, paymentDate: e.target.value })}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                          Payroll Cycle (Optional)
                        </label>
                        <input
                          type="text"
                          value={paymentData.payrollCycle}
                          onChange={(e) => setPaymentData({ ...paymentData, payrollCycle: e.target.value })}
                          placeholder="e.g., 2024-11"
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                          Remarks (Optional)
                        </label>
                        <textarea
                          value={paymentData.remarks}
                          onChange={(e) => setPaymentData({ ...paymentData, remarks: e.target.value })}
                          placeholder="Add any remarks for this transaction..."
                          rows={3}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                        />
                      </div>

                      <div className="flex gap-3 pt-2">
                        <button
                          type="button"
                          onClick={togglePaymentForm}
                          className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-200 rounded-lg hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={saving}
                          className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg hover:from-blue-600 hover:to-blue-700 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                          {saving ? (
                            <>
                              Processing...
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                              Record Payment
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {/* Transaction History */}
                {selectedLoan.status !== 'pending' && selectedLoan.status !== 'draft' && (
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs text-slate-500 uppercase font-semibold">Transaction History</p>
                      <button
                        onClick={() => loadTransactions(selectedLoan._id)}
                        className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                      >
                        Refresh
                      </button>
                    </div>
                    {loadingTransactions ? (
                      <div className="text-center py-4 text-slate-500">
                        <span className="ml-2">Loading transactions...</span>
                      </div>
                    ) : transactions.length > 0 ? (
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {transactions.map((txn, idx) => (
                          <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`px-2 py-0.5 text-xs font-semibold rounded capitalize ${txn.transactionType === 'disbursement'
                                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                  : txn.transactionType === 'emi_payment'
                                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                    : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                  }`}>
                                  {txn.transactionType?.replace('_', ' ')}
                                </span>
                              </div>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {new Date(txn.transactionDate || txn.createdAt).toLocaleDateString('en-IN', {
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </p>
                              {txn.remarks && (
                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 italic">{txn.remarks}</p>
                              )}
                              {txn.payrollCycle && (
                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Cycle: {txn.payrollCycle}</p>
                              )}
                            </div>
                            <div className="text-right ml-4">
                              <p className={`text-base font-bold ${txn.transactionType === 'disbursement' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                                }`}>
                                {txn.transactionType === 'disbursement' ? '-' : '+'}₹{txn.amount?.toLocaleString()}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-6 text-slate-500 text-sm">
                        <svg className="w-12 h-12 mx-auto mb-2 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <p>No transactions yet</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Release Funds Section - For Approved Loans */}
                {selectedLoan.status === 'approved' && (
                  <div className="p-4 rounded-xl border-2 border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-900/20">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-sm font-semibold text-green-900 dark:text-green-100 flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Release Funds
                        </h3>
                        <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                          Disburse ₹{selectedLoan.requestType === 'loan' ? (selectedLoan.loanConfig?.totalAmount || selectedLoan.amount) : selectedLoan.amount} to {selectedLoan.employeeId?.employee_name || selectedLoan.emp_no}
                        </p>
                      </div>
                      {hasManagePermission && (
                        <button
                          onClick={() => setShowDisbursementDialog(true)}
                          className="px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-green-500 to-green-600 rounded-lg hover:from-green-600 hover:to-green-700 transition-all shadow-md hover:shadow-lg flex items-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Release Funds
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Edit Button (for Super Admin/HR - not final approved/disbursed) */}
                {(() => {
                  const canEdit = hasManagePermission && !['approved', 'disbursed', 'active', 'completed'].includes(selectedLoan.status);

                  return canEdit && (
                    <button
                      onClick={handleEdit}
                      className="w-full px-4 py-2 text-sm font-semibold text-white bg-blue-500 rounded-xl hover:bg-blue-600 transition-colors mb-4"
                    >
                      Edit {selectedLoan.requestType === 'loan' ? 'Loan' : 'Advance'}
                    </button>
                  );
                })()}

                {/* Action Section */}
                {hasManagePermission && !['approved', 'rejected', 'cancelled', 'disbursed', 'active', 'completed'].includes(selectedLoan.status) && (
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-4">
                    {/* Approval Amount Modification */}
                    {(selectedLoan.requestType === 'salary_advance' || (selectedLoan.requestType === 'loan' && ['super_admin', 'hr', 'sub_admin'].includes(currentUser?.role))) && (
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                          Approval Amount (₹)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={approvalAmount}
                          onChange={(e) => setApprovalAmount(e.target.value)}
                          className={`w-full rounded-xl border px-4 py-2.5 text-sm dark:bg-slate-900 dark:text-white ${approvalValidation?.level === 'error'
                            ? 'border-red-500 ring-2 ring-red-200 dark:ring-red-900'
                            : approvalValidation?.level === 'warning'
                              ? 'border-yellow-500 ring-2 ring-yellow-200 dark:ring-yellow-900'
                              : 'border-slate-200 dark:border-slate-700'
                            }`}
                        />
                        {approvalValidation && (
                          <p className={`text-xs mt-1.5 font-medium flex items-center gap-1 ${approvalValidation.level === 'error' ? 'text-red-500' : 'text-yellow-600'
                            }`}>
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            {approvalValidation.message}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Interest Rate Modification (Loans only) */}
                    {selectedLoan.requestType === 'loan' && ['super_admin', 'hr', 'sub_admin'].includes(currentUser?.role) && (
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                          Approval Interest Rate (%)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={approvalInterestRate}
                          onChange={(e) => setApprovalInterestRate(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 transition-all"
                        />
                      </div>
                    )}

                    {/* Dynamic Recalculation for Loan Approvals */}
                    {selectedLoan.requestType === 'loan' && approvalAmount && (
                      (() => {
                        const principal = parseFloat(approvalAmount);
                        const rate = parseFloat(approvalInterestRate) || 0;
                        const duration = selectedLoan.duration || 1;

                        let emi = principal / duration;
                        let totalAmt = principal;

                        if (rate > 0) {
                          // Simple Interest Calculation: SI = (P * R * T) / 100
                          const totalInterest = (principal * rate * (duration / 12)) / 100;
                          totalAmt = principal + totalInterest;
                          emi = totalAmt / duration;
                        }

                        return (
                          <div className="p-3 bg-blue-50 dark:bg-blue-900/10 rounded-xl space-y-2 border border-blue-100 dark:border-blue-800/50 mb-4 animate-in fade-in duration-300">
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-slate-500 dark:text-slate-400">Monthly EMI (approx)</span>
                              <span className="font-bold text-blue-700 dark:text-blue-300">₹{Math.round(emi).toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-slate-500 dark:text-slate-400">Total Interest</span>
                              <span className="font-semibold text-slate-700 dark:text-slate-300">₹{Math.round(totalAmt - principal).toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs pt-1 border-t border-blue-100 dark:border-blue-800/50 mt-1">
                              <span className="text-slate-600 dark:text-slate-300 font-medium">Total Repayment</span>
                              <span className="font-bold text-slate-900 dark:text-white">₹{Math.round(totalAmt).toLocaleString()}</span>
                            </div>
                          </div>
                        );
                      })()
                    )}

                    <p className="text-xs text-slate-500 uppercase font-semibold">Take Action</p>

                    {/* Comment */}
                    <textarea
                      value={actionComment}
                      onChange={(e) => setActionComment(e.target.value)}
                      placeholder="Add a comment (optional)..."
                      rows={2}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />

                    {/* Action Buttons */}
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handleAction(selectedLoan._id, 'approve')}
                        disabled={saving}
                        className="px-4 py-2.5 text-sm font-semibold text-white bg-green-500 rounded-xl hover:bg-green-600 transition-colors flex items-center gap-2 disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-4 h-4" /> Approve
                      </button>
                      <button
                        onClick={() => handleAction(selectedLoan._id, 'reject')}
                        disabled={saving}
                        className="px-4 py-2.5 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors flex items-center gap-2 disabled:opacity-50"
                      >
                        <XCircle className="w-4 h-4" /> Reject
                      </button>
                    </div>
                  </div>
                )}

                {/* Close Button */}
                <button
                  onClick={() => {
                    setShowDetailDialog(false);
                    setSelectedLoan(null);
                    setTransactions([]);
                    setShowPaymentForm(false);
                    setShowDisbursementDialog(false);
                  }}
                  className="w-full px-4 py-3 text-sm font-medium text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Disbursement Dialog */}
        {showDisbursementDialog && selectedLoan && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowDisbursementDialog(false)} />
            <div className="relative z-50 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                    Release Funds
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Disburse ₹{selectedLoan.amount.toLocaleString()} to {selectedLoan.employeeId?.employee_name || selectedLoan.emp_no}
                  </p>
                </div>
                <button
                  onClick={() => setShowDisbursementDialog(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleDisburse} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Disbursement Method *
                  </label>
                  <select
                    required
                    value={disbursementData.disbursementMethod}
                    onChange={(e) => setDisbursementData({ ...disbursementData, disbursementMethod: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="cash">Cash</option>
                    <option value="cheque">Cheque</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Transaction Reference
                  </label>
                  <input
                    type="text"
                    value={disbursementData.transactionReference}
                    onChange={(e) => setDisbursementData({ ...disbursementData, transactionReference: e.target.value })}
                    placeholder="e.g., TXN123456789"
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Remarks
                  </label>
                  <textarea
                    value={disbursementData.remarks}
                    onChange={(e) => setDisbursementData({ ...disbursementData, remarks: e.target.value })}
                    placeholder="Add any remarks for this disbursement..."
                    rows={3}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white resize-none"
                  />
                </div>

                {message && (
                  <div className={`rounded-lg px-4 py-2 text-sm ${message.type === 'success'
                    ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                    : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                    }`}>
                    {message.text}
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowDisbursementDialog(false)}
                    className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-green-500 to-green-600 rounded-xl hover:from-green-600 hover:to-green-700 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {saving ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Processing...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        Release Funds
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit Dialog */}
        {showEditDialog && selectedLoan && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowEditDialog(false)} />
            <div className="relative z-50 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-6">
                Edit {selectedLoan.requestType === 'loan' ? 'Loan' : 'Salary Advance'}
              </h2>

              <form onSubmit={handleUpdate} className="space-y-4">
                {/* Eligibility Information - For Salary Advance */}
                {selectedLoan.requestType === 'salary_advance' && eligibilityData && (
                  <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 p-4 rounded-xl border border-blue-200 dark:border-blue-800 mb-4">
                    <h5 className="font-semibold text-sm mb-3 text-blue-900 dark:text-blue-100">Eligibility Information</h5>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="bg-white/70 dark:bg-slate-800/70 p-2 rounded">
                        <div className="text-gray-600 dark:text-gray-400">Attendance</div>
                        <div className="font-bold text-green-600 dark:text-green-400">{eligibilityData.attendancePercentage}%</div>
                      </div>
                      <div className="bg-white/70 dark:bg-slate-800/70 p-2 rounded">
                        <div className="text-gray-600 dark:text-gray-400">Days Worked</div>
                        <div className="font-bold text-slate-900 dark:text-white">{eligibilityData.daysWorked} / {eligibilityData.daysElapsedInMonth}</div>
                      </div>
                      <div className="bg-white/70 dark:bg-slate-800/70 p-2 rounded">
                        <div className="text-gray-600 dark:text-gray-400">Prorated</div>
                        <div className="font-bold text-blue-600 dark:text-blue-400">₹{eligibilityData.proratedAmount.toLocaleString()}</div>
                      </div>
                      <div className="bg-white/70 dark:bg-slate-800/70 p-2 rounded">
                        <div className="text-gray-600 dark:text-gray-400">Eligible</div>
                        <div className="font-bold text-green-600 dark:text-green-400">₹{eligibilityData.eligibleAmount.toLocaleString()}</div>
                      </div>
                      <div className="bg-white/70 dark:bg-slate-800/70 p-2 rounded">
                        <div className="text-gray-600 dark:text-gray-400">Max Limit</div>
                        <div className="font-bold text-purple-600 dark:text-purple-400">₹{eligibilityData.finalMaxAllowed.toLocaleString()}</div>
                      </div>
                      <div className="bg-white/70 dark:bg-slate-800/70 p-2 rounded">
                        <div className="text-gray-600 dark:text-gray-400">Basic Pay</div>
                        <div className="font-bold text-indigo-600 dark:text-indigo-400">₹{selectedLoan.employeeId?.gross_salary?.toLocaleString() || 'N/A'}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Amount */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Amount (₹) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={selectedLoan.requestType === 'salary_advance' && selectedLoan.employeeId?.gross_salary ? selectedLoan.employeeId.gross_salary : undefined}
                    value={editFormData.amount}
                    onChange={(e) => {
                      setEditFormData({ ...editFormData, amount: e.target.value });
                      console.log('[Edit] Amount:', e.target.value, 'Basic Pay:', selectedLoan.employeeId?.gross_salary);
                    }}
                    required
                    className={`w-full rounded-xl border px-4 py-2.5 text-sm dark:bg-slate-800 dark:text-white ${selectedLoan.requestType === 'salary_advance' &&
                      selectedLoan.employeeId?.gross_salary &&
                      parseFloat(editFormData.amount) > selectedLoan.employeeId.gross_salary
                      ? 'border-red-500 ring-2 ring-red-200 dark:ring-red-900'
                      : 'border-slate-200 dark:border-slate-700'
                      }`}
                  />
                  {selectedLoan.requestType === 'salary_advance' &&
                    selectedLoan.employeeId?.gross_salary &&
                    parseFloat(editFormData.amount) > selectedLoan.employeeId.gross_salary && (
                      <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                        <p className="text-sm text-red-600 dark:text-red-400 font-semibold flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          Amount exceeds basic pay!
                        </p>
                        <p className="text-xs text-red-500 dark:text-red-400 mt-1">
                          Maximum allowed: ₹{selectedLoan.employeeId.gross_salary.toLocaleString()}
                        </p>
                      </div>
                    )}
                </div>

                {/* Duration */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Duration ({selectedLoan.requestType === 'loan' ? 'Months' : 'Cycles'}) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={editFormData.duration}
                    onChange={(e) => setEditFormData({ ...editFormData, duration: e.target.value })}
                    required
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                {/* Reason */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Reason / Purpose *
                  </label>
                  <textarea
                    value={editFormData.reason}
                    onChange={(e) => setEditFormData({ ...editFormData, reason: e.target.value })}
                    required
                    rows={3}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                {/* Remarks */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Remarks
                  </label>
                  <textarea
                    value={editFormData.remarks}
                    onChange={(e) => setEditFormData({ ...editFormData, remarks: e.target.value })}
                    rows={2}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                {/* Status (Super Admin only) */}
                {(() => {
                  const user = auth.getUser();
                  const isSuperAdmin = user?.role === 'super_admin';
                  return isSuperAdmin && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Status (Super Admin)
                      </label>
                      <select
                        value={editFormData.status || selectedLoan.status}
                        onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        <option value="pending">Pending</option>
                        <option value="hod_approved">HOD Approved</option>
                        <option value="hr_approved">HR Approved</option>
                        <option value="approved">Approved</option>
                        <option value="hod_rejected">HOD Rejected</option>
                        <option value="hr_rejected">HR Rejected</option>
                        <option value="rejected">Rejected</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </div>
                  );
                })()}

                {/* Dynamic Interest Preview for Loans */}
                {selectedLoan.requestType === 'loan' && editFormData.amount && editFormData.duration && (
                  (() => {
                    const principal = parseFloat(editFormData.amount);
                    const duration = parseInt(editFormData.duration);
                    if (!principal || !duration) return null;

                    const interestRate = resolvedLoanSettings?.interestRate ?? loanSettings?.settings?.interestRate ?? 0;
                    const isInterestApplicable = resolvedLoanSettings?.isInterestApplicable ?? loanSettings?.settings?.isInterestApplicable ?? false;

                    if (!isInterestApplicable || interestRate === 0) {
                      const emiAmount = principal / duration;
                      return (
                        <div className="p-3 bg-blue-50 dark:bg-blue-900/10 rounded-xl space-y-2 border border-blue-100 dark:border-blue-800/50 mb-4 animate-in fade-in duration-300">
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-500 dark:text-slate-400">Monthly EMI (est)</span>
                            <span className="font-bold text-blue-700 dark:text-blue-300">₹{Math.round(emiAmount).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between items-center text-xs pt-1 border-t border-blue-100 dark:border-blue-800/50 mt-1">
                            <span className="text-slate-600 dark:text-slate-300 font-medium">Total Repayment</span>
                            <span className="font-bold text-slate-900 dark:text-white">₹{Math.round(principal).toLocaleString()}</span>
                          </div>
                        </div>
                      );
                    }

                    // Simple Interest Calculation: SI = (P * R * T) / 100
                    const totalInterest = (principal * interestRate * (duration / 12)) / 100;
                    const totalAmount = principal + totalInterest;
                    const emiAmount = totalAmount / duration;

                    return (
                      <div className="p-3 bg-blue-50 dark:bg-blue-900/10 rounded-xl space-y-2 border border-blue-100 dark:border-blue-800/50 mb-4 animate-in fade-in duration-300">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-500 dark:text-slate-400">Monthly EMI (est)</span>
                          <span className="font-bold text-blue-700 dark:text-blue-300">₹{Math.round(emiAmount).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-500 dark:text-slate-400">Total Interest ({interestRate}%)</span>
                          <span className="font-semibold text-slate-700 dark:text-slate-300">₹{Math.round(totalInterest).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs pt-1 border-t border-blue-100 dark:border-blue-800/50 mt-1">
                          <span className="text-slate-600 dark:text-slate-300 font-medium">Total Repayment</span>
                          <span className="font-bold text-slate-900 dark:text-white">₹{Math.round(totalAmount).toLocaleString()}</span>
                        </div>
                      </div>
                    );
                  })()
                )}

                {/* Buttons */}
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowEditDialog(false)}
                    className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 px-4 py-2.5 text-sm font-semibold text-white rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Early Settlement Confirmation Dialog */}
        {showSettlementDialog && selectedLoan && settlementPreview && settlementPreview.current && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowSettlementDialog(false)} />
            <div className="relative z-50 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                    Confirm Early Settlement
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Pay full amount and save on interest
                  </p>
                </div>
                <button
                  onClick={() => setShowSettlementDialog(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Settlement Breakdown */}
                <div className="p-4 rounded-xl border-2 border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20">
                  <h3 className="text-sm font-semibold text-green-900 dark:text-green-100 mb-3">Settlement Breakdown</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-600 dark:text-slate-400">Remaining Principal:</span>
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">₹{settlementPreview.current.remainingPrincipal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-600 dark:text-slate-400">Interest (for {settlementPreview.current.actualMonthsUsed} months):</span>
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">₹{settlementPreview.current.settlementInterest.toLocaleString()}</span>
                    </div>
                    <div className="pt-2 border-t border-green-200 dark:border-green-700">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-base font-semibold text-green-700 dark:text-green-300">Total Settlement Amount:</span>
                        <span className="text-xl font-bold text-green-700 dark:text-green-300">₹{settlementPreview.current.settlementAmount.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Savings Highlight */}
                <div className="p-4 rounded-xl border border-green-200 bg-gradient-to-r from-green-50 to-green-50 dark:from-green-900/30 dark:to-green-900/30 dark:border-green-700">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center">
                      <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">You will save</p>
                      <p className="text-2xl font-bold text-green-600 dark:text-green-400">₹{settlementPreview.current.interestSavings.toLocaleString()}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-500">in interest by paying early</p>
                    </div>
                  </div>
                </div>

                {/* Loan Details */}
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-slate-500 dark:text-slate-400 mb-1">Original Duration:</p>
                      <p className="font-semibold text-slate-900 dark:text-white">{settlementPreview.current.originalDuration} months</p>
                    </div>
                    <div>
                      <p className="text-slate-500 dark:text-slate-400 mb-1">Months Used:</p>
                      <p className="font-semibold text-slate-900 dark:text-white">{settlementPreview.current.actualMonthsUsed} months</p>
                    </div>
                    <div>
                      <p className="text-slate-500 dark:text-slate-400 mb-1">Original Total:</p>
                      <p className="font-semibold text-slate-900 dark:text-white">₹{settlementPreview.current.originalTotalAmount.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 dark:text-slate-400 mb-1">Remaining Months:</p>
                      <p className="font-semibold text-slate-900 dark:text-white">{settlementPreview.current.remainingMonths} months</p>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowSettlementDialog(false)}
                    className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleEarlySettlement}
                    disabled={saving}
                    className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-green-600 to-green-600 rounded-xl hover:from-green-700 hover:to-green-700 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {saving ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Processing...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        Confirm Settlement
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Apply Dialog */}
        {showApplyDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowApplyDialog(false)} />
            <div className="relative z-50 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
              {/* Type Toggle */}
              <div className="flex gap-2 mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setApplyType('loan');
                    setInterestCalculation(null);
                  }}
                  className={`flex-1 py-3 rounded-xl font-medium text-sm transition-all ${applyType === 'loan'
                    ? 'bg-blue-500 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                >
                  <span className="flex items-center justify-center gap-2">
                    <LoanIcon />
                    Loan
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setApplyType('salary_advance');
                    setInterestCalculation(null);
                  }}
                  className={`flex-1 py-3 rounded-xl font-medium text-sm transition-all ${applyType === 'salary_advance'
                    ? 'bg-purple-500 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                >
                  <span className="flex items-center justify-center gap-2">
                    <AdvanceIcon />
                    Salary Advance
                  </span>
                </button>
              </div>

              <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-6">
                Apply for {applyType === 'loan' ? 'Loan' : 'Salary Advance'}
              </h2>

              <form onSubmit={handleApply} className="space-y-4">
                {/* Employee Selection */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Apply For Employee *
                  </label>
                  <div className="relative">
                    {selectedEmployee ? (
                      <div className="flex items-center justify-between p-3 rounded-xl border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white font-semibold">
                            {getEmployeeInitials(selectedEmployee)}
                          </div>
                          <div>
                            <div className="font-medium text-slate-900 dark:text-white">
                              {getEmployeeName(selectedEmployee)}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {selectedEmployee.emp_no}
                            </div>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {selectedEmployee.department?.name && (
                                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-800 dark:text-blue-300 rounded">
                                  {selectedEmployee.department.name}
                                </span>
                              )}
                              {selectedEmployee.designation?.name && (
                                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-800 dark:text-green-300 rounded">
                                  {selectedEmployee.designation.name}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedEmployee(null);
                            setEmployeeSearch('');
                          }}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <Search className="w-4 h-4" />
                        </div>
                        <input
                          type="text"
                          value={employeeSearch}
                          onChange={(e) => {
                            setEmployeeSearch(e.target.value);
                            setShowEmployeeDropdown(true);
                          }}
                          onFocus={() => setShowEmployeeDropdown(true)}
                          placeholder="Search by name, emp no, or department..."
                          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20"
                        />

                        {/* Employee Dropdown */}
                        {showEmployeeDropdown && (
                          <div className="absolute z-10 w-full mt-1 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                            {filteredEmployees.length === 0 ? (
                              <div className="p-4 text-center text-sm text-slate-500">
                                {employeeSearch ? 'No employees found' : 'Type to search employees'}
                              </div>
                            ) : (
                              filteredEmployees.slice(0, 10).map((emp) => (
                                <button
                                  key={emp._id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedEmployee(emp);
                                    setEmployeeSearch('');
                                    setShowEmployeeDropdown(false);
                                  }}
                                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700 text-left transition-colors border-b border-slate-100 dark:border-slate-700 last:border-0"
                                >
                                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-slate-400 to-slate-500 flex items-center justify-center text-white text-sm font-medium">
                                    {getEmployeeInitials(emp)}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium text-slate-900 dark:text-white truncate">
                                      {getEmployeeName(emp)}
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                      {emp.emp_no} • {emp.department?.name || 'No Department'} • {emp.designation?.name || 'No Designation'}
                                    </div>
                                  </div>
                                </button>
                              ))
                            )}
                            {filteredEmployees.length > 10 && (
                              <div className="px-4 py-2 text-center text-xs text-slate-500 bg-slate-50 dark:bg-slate-900">
                                Showing 10 of {filteredEmployees.length} results. Type more to filter.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Division-Specific Settings Display */}
                {selectedEmployee && (
                  <div className="mb-4">
                    {loadingResolvedSettings && (
                      <div className="text-sm text-blue-600 mb-2 flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                        Loading applicable settings...
                      </div>
                    )}

                    {resolvedLoanSettings && !loadingResolvedSettings && (
                      <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 p-4 rounded-xl border border-green-200 dark:border-green-800">
                        <h4 className="font-semibold text-sm mb-3 text-green-900 dark:text-green-100 flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Applicable Settings
                          {selectedEmployee.division && (
                            <span className="ml-auto text-[10px] px-2 py-0.5 bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200 rounded-full font-bold">
                              {selectedEmployee.division.name}
                            </span>
                          )}
                        </h4>

                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {resolvedLoanSettings.interestRate !== undefined && (
                            <div className="bg-white/50 dark:bg-slate-800/50 p-2 rounded-lg">
                              <span className="text-gray-600 dark:text-gray-400">Interest Rate:</span>
                              <span className="ml-2 font-semibold text-slate-900 dark:text-white">{resolvedLoanSettings.interestRate}%</span>
                            </div>
                          )}
                          {resolvedLoanSettings.minAmount !== undefined && (
                            <div className="bg-white/50 dark:bg-slate-800/50 p-2 rounded-lg">
                              <span className="text-gray-600 dark:text-gray-400">Min Amount:</span>
                              <span className="ml-2 font-semibold text-slate-900 dark:text-white">₹{resolvedLoanSettings.minAmount?.toLocaleString() || 'N/A'}</span>
                            </div>
                          )}
                          {resolvedLoanSettings.maxAmount !== undefined && (
                            <div className="bg-white/50 dark:bg-slate-800/50 p-2 rounded-lg">
                              <span className="text-gray-600 dark:text-gray-400">Max Amount:</span>
                              <span className="ml-2 font-semibold text-slate-900 dark:text-white">
                                {resolvedLoanSettings.maxAmount ? `₹${resolvedLoanSettings.maxAmount.toLocaleString()}` : 'Unlimited'}
                              </span>
                            </div>
                          )}
                          {resolvedLoanSettings.minTenure !== undefined && (
                            <div className="bg-white/50 dark:bg-slate-800/50 p-2 rounded-lg">
                              <span className="text-gray-600 dark:text-gray-400">Duration:</span>
                              <span className="ml-2 font-semibold text-slate-900 dark:text-white">
                                {resolvedLoanSettings.minTenure}-{resolvedLoanSettings.maxTenure} months
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Eligibility Calculator - ONLY for Salary Advance */}
                {applyType === 'salary_advance' && selectedEmployee && (
                  <div className="mb-4">
                    {loadingEligibility && (
                      <div className="text-sm text-blue-600 mb-2 flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                        Calculating eligibility...
                      </div>
                    )}

                    {eligibilityError && (
                      <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg mb-2">
                        {eligibilityError}
                      </div>
                    )}

                    {eligibilityData && !loadingEligibility && (
                      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 p-4 rounded-xl border border-blue-200 dark:border-blue-800">
                        <h4 className="font-semibold text-sm mb-3 text-blue-900 dark:text-blue-100 flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          Eligibility Calculator
                        </h4>

                        {/* Attendance Info */}
                        <div className="grid grid-cols-2 gap-2 mb-3 text-xs bg-white/50 dark:bg-slate-800/50 p-2 rounded-lg">
                          <div>
                            <span className="text-gray-600 dark:text-gray-400">Days Worked:</span>
                            <span className="ml-2 font-semibold text-slate-900 dark:text-white">{eligibilityData.daysWorked} / {eligibilityData.daysElapsedInMonth}</span>
                          </div>
                          <div>
                            <span className="text-gray-600 dark:text-gray-400">Attendance:</span>
                            <span className="ml-2 font-semibold text-green-600 dark:text-green-400">{eligibilityData.attendancePercentage}%</span>
                          </div>
                        </div>

                        {/* Amount Options */}
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={() => {
                              setFormData({ ...formData, amount: eligibilityData.proratedAmount.toString() });
                              console.log('Selected Prorated Amount:', eligibilityData.proratedAmount);
                            }}
                            className="w-full text-left p-3 border-2 border-blue-200 dark:border-blue-700 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-800/50 transition-all hover:shadow-md bg-white dark:bg-slate-800"
                          >
                            <div className="flex justify-between items-center">
                              <div>
                                <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Prorated Amount (Based on Attendance)</div>
                                <div className="font-bold text-lg text-blue-600 dark:text-blue-400">₹{eligibilityData.proratedAmount.toLocaleString()}</div>
                              </div>
                              <div className="text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900 px-2 py-1 rounded">Select</div>
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setFormData({ ...formData, amount: eligibilityData.eligibleAmount.toString() });
                              console.log('Selected Eligible Amount:', eligibilityData.eligibleAmount);
                            }}
                            className="w-full text-left p-3 border-2 border-green-200 dark:border-green-700 rounded-lg hover:bg-green-100 dark:hover:bg-green-800/50 transition-all hover:shadow-md bg-white dark:bg-slate-800"
                          >
                            <div className="flex justify-between items-center">
                              <div>
                                <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Eligible Amount (Full Prorated)</div>
                                <div className="font-bold text-lg text-green-600 dark:text-green-400">₹{eligibilityData.eligibleAmount.toLocaleString()}</div>
                              </div>
                              <div className="text-xs font-semibold text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900 px-2 py-1 rounded">Select</div>
                            </div>
                          </button>

                          <div className="p-3 bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                            <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Max Limit ({eligibilityData.maxPercentage}% of Basic Pay)</div>
                            <div className="font-bold text-lg text-gray-700 dark:text-gray-300">₹{eligibilityData.maxLimitAmount.toLocaleString()}</div>
                          </div>
                        </div>

                        <div className="mt-3 pt-3 border-t border-blue-200 dark:border-blue-700">
                          <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Final Max Allowed:</div>
                          <div className="text-xl font-bold text-blue-600 dark:text-blue-400">
                            ₹{eligibilityData.finalMaxAllowed.toLocaleString()}
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            You can request up to this amount
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Amount (₹) *
                  </label>
                  <input
                    type="number"
                    required
                    min={resolvedLoanSettings?.minAmount || 1}
                    max={resolvedLoanSettings?.maxAmount || (applyType === 'salary_advance' && eligibilityData ? eligibilityData.finalMaxAllowed : undefined)}
                    step="0.01"
                    value={formData.amount}
                    onChange={(e) => {
                      setFormData({ ...formData, amount: e.target.value });
                      console.log('Amount entered:', e.target.value, 'Min:', resolvedLoanSettings?.minAmount, 'Max:', resolvedLoanSettings?.maxAmount);
                    }}
                    className={`w-full rounded-lg border px-4 py-2 text-sm dark:bg-slate-800 ${resolvedLoanSettings && parseFloat(formData.amount) && (
                      parseFloat(formData.amount) < (resolvedLoanSettings.minAmount || 0) ||
                      (resolvedLoanSettings.maxAmount && parseFloat(formData.amount) > resolvedLoanSettings.maxAmount)
                    )
                      ? 'border-red-500 ring-2 ring-red-200 dark:ring-red-900'
                      : applyType === 'salary_advance' && eligibilityData && parseFloat(formData.amount) > eligibilityData.finalMaxAllowed
                        ? 'border-red-500 ring-2 ring-red-200 dark:ring-red-900'
                        : 'border-slate-200 dark:border-slate-700'
                      }`}
                  />
                  {/* Validation warnings for resolved settings */}
                  {resolvedLoanSettings && parseFloat(formData.amount) && (
                    <>
                      {parseFloat(formData.amount) < (resolvedLoanSettings.minAmount || 0) && (
                        <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                          <p className="text-sm text-red-600 dark:text-red-400 font-semibold flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            Amount is below minimum!
                          </p>
                          <p className="text-xs text-red-500 dark:text-red-400 mt-1">
                            Minimum amount: ₹{resolvedLoanSettings.minAmount?.toLocaleString()}
                          </p>
                        </div>
                      )}
                      {resolvedLoanSettings.maxAmount && parseFloat(formData.amount) > resolvedLoanSettings.maxAmount && (
                        <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                          <p className="text-sm text-red-600 dark:text-red-400 font-semibold flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            Amount exceeds maximum!
                          </p>
                          <p className="text-xs text-red-500 dark:text-red-400 mt-1">
                            Maximum amount: ₹{resolvedLoanSettings.maxAmount.toLocaleString()}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                  {applyType === 'salary_advance' && (
                    <div className="mt-2">
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Need Amount (₹) <span className="text-xs font-normal text-slate-400">(Optional - for higher requests)</span>
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="1"
                        value={formData.needAmount}
                        onChange={(e) => setFormData({ ...formData, needAmount: e.target.value })}
                        placeholder="Enter amount if you need more than eligible limit"
                        className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                      />
                    </div>
                  )}
                  {applyType === 'salary_advance' && eligibilityData && parseFloat(formData.amount) > eligibilityData.finalMaxAllowed && (
                    <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                      <p className="text-sm text-red-600 dark:text-red-400 font-semibold flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        Amount exceeds maximum allowed limit!
                      </p>
                      <p className="text-xs text-red-500 dark:text-red-400 mt-1">
                        Maximum allowed: ₹{eligibilityData.finalMaxAllowed.toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>

                {/* Duration - Only for loans */}
                {applyType === 'loan' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Duration (months) *
                    </label>
                    <input
                      type="number"
                      required
                      min={resolvedLoanSettings?.minTenure || 1}
                      max={resolvedLoanSettings?.maxTenure || undefined}
                      value={formData.duration}
                      onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
                      className={`w-full rounded-lg border px-4 py-2 text-sm dark:bg-slate-800 ${resolvedLoanSettings && parseFloat(formData.duration) && (
                        parseFloat(formData.duration) < (resolvedLoanSettings.minTenure || 0) ||
                        (resolvedLoanSettings.maxTenure && parseFloat(formData.duration) > resolvedLoanSettings.maxTenure)
                      )
                        ? 'border-red-500 ring-2 ring-red-200 dark:ring-red-900'
                        : 'border-slate-200 dark:border-slate-700'
                        }`}
                    />
                    {/* Validation warnings for duration */}
                    {resolvedLoanSettings && parseFloat(formData.duration) && (
                      <>
                        {parseFloat(formData.duration) < (resolvedLoanSettings.minTenure || 0) && (
                          <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                            <p className="text-sm text-red-600 dark:text-red-400 font-semibold flex items-center gap-2">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                              Duration is below minimum!
                            </p>
                            <p className="text-xs text-red-500 dark:text-red-400 mt-1">
                              Minimum duration: {resolvedLoanSettings.minTenure} months
                            </p>
                          </div>
                        )}
                        {resolvedLoanSettings.maxTenure && parseFloat(formData.duration) > resolvedLoanSettings.maxTenure && (
                          <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                            <p className="text-sm text-red-600 dark:text-red-400 font-semibold flex items-center gap-2">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                              Duration exceeds maximum!
                            </p>
                            <p className="text-xs text-red-500 dark:text-red-400 mt-1">
                              Maximum duration: {resolvedLoanSettings.maxTenure} months
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Interest Calculation Display - Only for loans */}
                {applyType === 'loan' && interestCalculation && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
                    <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-3">Loan Calculation</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-600 dark:text-slate-400">Principal Amount:</span>
                        <span className="font-medium text-slate-900 dark:text-slate-100">₹{interestCalculation.principal.toLocaleString()}</span>
                      </div>
                      {interestCalculation.interestRate > 0 && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">Interest Rate:</span>
                            <span className="font-medium text-slate-900 dark:text-slate-100">{interestCalculation.interestRate}% p.a.</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">Total Interest:</span>
                            <span className="font-medium text-slate-900 dark:text-slate-100">₹{interestCalculation.totalInterest.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">Total Amount (Principal + Interest):</span>
                            <span className="font-medium text-slate-900 dark:text-slate-100">₹{interestCalculation.totalAmount.toLocaleString()}</span>
                          </div>
                        </>
                      )}
                      <div className="flex justify-between pt-2 border-t border-blue-200 dark:border-blue-800">
                        <span className="font-semibold text-blue-900 dark:text-blue-100">EMI per Month:</span>
                        <span className="font-bold text-blue-900 dark:text-blue-100">₹{interestCalculation.emiAmount.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Guarantors Selection - Only for loans */}
                {applyType === 'loan' && (
                  <div className="relative mb-4">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Guarantors (Select at least 2) *
                    </label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {formData.guarantorIds.map(id => {
                        const emp = employees.find(e => e._id === id);
                        if (!emp) return null;
                        return (
                          <div key={id} className="flex items-center gap-2 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-3 py-1.5 rounded-full text-sm font-medium border border-blue-200 dark:border-blue-800">
                            <span>{getEmployeeName(emp)}</span>
                            <button
                              type="button"
                              onClick={() => setFormData({ ...formData, guarantorIds: formData.guarantorIds.filter(gid => gid !== id) })}
                              className="hover:text-blue-900 dark:hover:text-blue-100"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Search className="h-4 w-4 text-slate-400" />
                      </div>
                      <input
                        type="text"
                        placeholder="Search for guarantors..."
                        value={guarantorSearch}
                        onChange={(e) => {
                          setGuarantorSearch(e.target.value);
                          setShowGuarantorDropdown(true);
                        }}
                        onFocus={() => setShowGuarantorDropdown(true)}
                        className="w-full rounded-lg border border-slate-200 bg-white pl-10 pr-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                      />
                      
                      {showGuarantorDropdown && guarantorSearch && (
                        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl">
                          {employees
                            .filter(emp => 
                              !formData.guarantorIds.includes(emp._id) && 
                              emp._id !== selectedEmployee?._id &&
                              (getEmployeeName(emp).toLowerCase().includes(guarantorSearch.toLowerCase()) || emp.emp_no.toLowerCase().includes(guarantorSearch.toLowerCase()))
                            )
                            .slice(0, 5)
                            .map(emp => (
                              <button
                                key={emp._id}
                                type="button"
                                onClick={() => {
                                  setFormData({ ...formData, guarantorIds: [...formData.guarantorIds, emp._id] });
                                  setGuarantorSearch('');
                                  setShowGuarantorDropdown(false);
                                }}
                                className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center gap-3 border-b border-slate-100 dark:border-slate-700 last:border-0"
                              >
                                <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-xs">
                                  {getEmployeeInitials(emp)}
                                </div>
                                <div>
                                  <div className="text-sm font-semibold">{getEmployeeName(emp)}</div>
                                  <div className="text-xs text-slate-500 dark:text-slate-400">{emp.emp_no} • {emp.department?.name || 'No Dept'}</div>
                                </div>
                              </button>
                            ))}
                          {employees.filter(emp => !formData.guarantorIds.includes(emp._id) && emp._id !== selectedEmployee?._id && (getEmployeeName(emp).toLowerCase().includes(guarantorSearch.toLowerCase()) || emp.emp_no.toLowerCase().includes(guarantorSearch.toLowerCase()))).length === 0 && (
                            <div className="p-4 text-center text-sm text-slate-500 dark:text-slate-400">No employees found</div>
                          )}
                        </div>
                      )}
                    </div>
                    {formData.guarantorIds.length < 2 && (
                      <p className="mt-1 text-xs text-red-500 font-medium">Selection of at least 2 guarantors is mandatory.</p>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Reason *
                  </label>
                  <textarea
                    required
                    value={formData.reason}
                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                    rows={3}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Remarks
                  </label>
                  <textarea
                    value={formData.remarks}
                    onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                    rows={2}
                  />
                </div>

                {/* Buttons */}
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowApplyDialog(false)}
                    className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className={`flex-1 px-4 py-2.5 text-sm font-semibold text-white rounded-xl transition-all disabled:opacity-50 ${applyType === 'loan'
                      ? 'bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600'
                      : 'bg-gradient-to-r from-purple-500 to-red-500 hover:from-purple-600 hover:to-red-600'
                      }`}
                  >
                    {saving ? 'Submitting...' : `Apply ${applyType === 'loan' ? 'Loan' : 'Salary Advance'}`}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Toast Container */}
        <ToastContainer
          position="top-right"
          autoClose={3000}
          hideProgressBar={false}
          newestOnTop={false}
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
          theme="light"
        />
      </div>
    </div>
  );
}


