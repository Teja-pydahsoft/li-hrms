/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import { QRCodeSVG } from 'qrcode.react';
import LocationPhotoCapture from '@/components/LocationPhotoCapture';
import Spinner from '@/components/Spinner';
import { useAuth } from '@/contexts/AuthContext';
import {
  Plus,
  Check,
  X,
  Calendar,
  Briefcase,
  Clock3,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Search,
  Filter,
  Eye,
  AlertCircle,
  Clock,
  ChevronRight,
  RotateCw,
  QrCode,
  FileText,
  Timer,
  Zap,
  MapPin,
  Scan,
  ImageIcon,
  Map,
  Navigation,
  ArrowRight,
  CheckCircle,
  Trash2,
  CheckSquare,
  ClipboardList,
  Activity
} from 'lucide-react';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { getEmployeeInitials } from '@/lib/utils';

import {
  canApproveOT,
  canRejectOT,
  canApplyOT,
  canApprovePermission,
  canRejectPermission,
  canApplyPermission
} from '@/lib/permissions';

// Premium Stat Card
const StatCard = ({ title, value, icon: Icon, bgClass, iconClass, dekorClass, trend, loading }: { title: string, value: number | string, icon: any, bgClass: string, iconClass: string, dekorClass?: string, trend?: { value: string, positive: boolean }, loading?: boolean }) => (
  <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 transition-all hover:shadow-xl dark:border-slate-800 dark:bg-slate-900">
    <div className="flex items-center justify-between gap-3 sm:gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 truncate">{title}</p>
        <div className="mt-1 sm:mt-2 flex items-baseline gap-2">
          {loading ? (
            <div className="h-6 w-16 bg-slate-200 dark:bg-slate-700 rounded animate-pulse"></div>
          ) : (
            <h3 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">{value}</h3>
          )}
          {!loading && trend && (
            <span className={`text-[9px] sm:text-[10px] font-black px-1.5 py-0.5 rounded-md ${trend.positive ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'}`}>
              {trend.value}
            </span>
          )}
        </div>
      </div>
      <div className={`flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-2xl shrink-0 ${bgClass} ${iconClass}`}>
        <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
      </div>
    </div>
    {dekorClass && <div className={`absolute -right-4 -bottom-4 h-20 w-20 sm:h-24 sm:w-24 rounded-full ${dekorClass}`} />}
  </div>
);

const Portal = ({ children }: { children: React.ReactNode }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  return mounted ? createPortal(children, document.body) : null;
};

// Toast Notification Component
interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

const ToastNotification = ({ toast, onClose }: { toast: Toast; onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 3000);

    return () => clearTimeout(timer);
  }, [onClose]);

  const bgColors = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    info: 'bg-blue-500',
    warning: 'bg-yellow-500',
  };

  const icons = {
    success: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
    error: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    ),
    info: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    warning: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
  };

  return (
    <div
      className={`${bgColors[toast.type]} mb-2 flex items-center gap-3 rounded-lg px-4 py-3 text-white shadow-lg transition-all duration-300 animate-in slide-in-from-right`}
    >
      <div className="flex-shrink-0">{icons[toast.type]}</div>
      <p className="flex-1 text-sm font-medium">{toast.message}</p>
      <button
        onClick={onClose}
        className="flex-shrink-0 rounded p-1 hover:bg-white/20 transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};

interface Employee {
  _id: string;
  emp_no: string;
  employee_name: string;
  department?: { _id: string; name: string; division?: { name: string } };
  designation?: { _id: string; name: string };
}

interface Shift {
  _id: string;
  name: string;
  startTime: string;
  endTime: string;
  duration: number;
}

interface ConfusedShift {
  _id: string;
  employeeNumber: string;
  date: string;
  inTime: string;
  outTime?: string;
  possibleShifts: Array<{
    shiftId: string;
    shiftName: string;
    startTime: string;
    endTime: string;
  }>;
  requiresManualSelection: boolean;
}

interface OTRequest {
  _id: string;
  employeeId: Employee;
  employeeNumber: string;
  date: string;
  shiftId: Shift;
  otInTime: string;
  otOutTime: string;
  otHours: number;
  status: 'pending' | 'approved' | 'rejected' | 'manager_approved' | 'manager_rejected';
  requestedBy: { name: string; email: string };
  approvedBy?: { name: string; email: string };
  rejectedBy?: { name: string; email: string };
  requestedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  comments?: string;
  workflow?: {
    currentStepRole: string;
    nextApproverRole: string;
    nextApprover: string;
    isCompleted: boolean;
    approvalChain: Array<{
      stepOrder: number;
      role: string;
      label: string;
      status: string;
      isCurrent: boolean;
    }>;
  };
}

interface PermissionRequest {
  _id: string;
  employeeId: Employee;
  employeeNumber: string;
  date: string;
  permissionStartTime: string;
  permissionEndTime: string;
  permissionHours: number;
  purpose: string;
  status: 'pending' | 'approved' | 'rejected' | 'manager_approved' | 'manager_rejected' | 'checked_out' | 'checked_in';
  requestedBy: { name: string; email: string };
  approvedBy?: { name: string; email: string };
  rejectedBy?: { name: string; email: string };
  requestedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  qrCode?: string;
  outpassUrl?: string;
  comments?: string;
  gateOutTime?: string;
  gateInTime?: string;
  workflow?: {
    currentStepRole: string;
    nextApproverRole: string;
    nextApprover: string;
    isCompleted: boolean;
    approvalChain: Array<{
      stepOrder: number;
      role: string;
      label: string;
      status: string;
      isCurrent: boolean;
    }>;
  };
}

// Helper to get IST "Today" (YYYY-MM-DD)
const getTodayIST = () => {
  const now = new Date();
  const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  return `${istNow.getFullYear()}-${String(istNow.getMonth() + 1).padStart(2, '0')}-${String(istNow.getDate()).padStart(2, '0')}`;
};

export default function OTAndPermissionsPage() {

  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'ot' | 'permissions' | 'pending'>('ot');
  const [dataLoading, setDataLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [otRequests, setOTRequests] = useState<OTRequest[]>([]);
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [shifts, setShifts] = useState<Shift[]>([]);

  // Filters
  const [otFilters, setOTFilters] = useState({ status: '', employeeNumber: '', startDate: '', endDate: '' });
  const [permissionFilters, setPermissionFilters] = useState({ status: '', employeeNumber: '', startDate: '', endDate: '' });

  // Dialogs
  const [showOTDialog, setShowOTDialog] = useState(false);
  const [showPermissionDialog, setShowPermissionDialog] = useState(false);
  const [showQRDialog, setShowQRDialog] = useState(false);
  const [selectedQR, setSelectedQR] = useState<PermissionRequest | null>(null);
  const [showEvidenceDialog, setShowEvidenceDialog] = useState(false);
  const [selectedEvidenceItem, setSelectedEvidenceItem] = useState<any | null>(null);

  // Toast notifications
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Toast helper functions
  const showToast = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  };

  // Form data
  const [otFormData, setOTFormData] = useState({
    employeeId: '',
    employeeNumber: '',
    date: getTodayIST(),
    otOutTime: '',
    shiftId: '',
    manuallySelectedShiftId: '',
    comments: '',
  });

  const [permissionFormData, setPermissionFormData] = useState({
    employeeId: '',
    employeeNumber: '',
    date: getTodayIST(),
    permissionStartTime: '',
    permissionEndTime: '',
    purpose: '',
    comments: '',
  });

  const [confusedShift, setConfusedShift] = useState<ConfusedShift | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [attendanceData, setAttendanceData] = useState<any>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [validationError, setValidationError] = useState<string>('');
  const [permissionValidationError, setPermissionValidationError] = useState<string>('');

  const stats = useMemo(() => {
    const counts = {
      approvedOT: 0,
      approvedPermissions: 0,
      pendingOT: 0,
      pendingPermissions: 0,
      rejectedOT: 0,
      rejectedPermissions: 0
    };

    otRequests.forEach(req => {
      if (req.status === 'approved') counts.approvedOT += req.otHours;
      else if (req.status === 'pending') counts.pendingOT++;
      else if (req.status === 'rejected') counts.rejectedOT++;
    });

    permissions.forEach(req => {
      if (req.status === 'approved' || req.status === 'checked_in' || req.status === 'checked_out') counts.approvedPermissions++;
      else if (req.status === 'pending') counts.pendingPermissions++;
      else if (req.status === 'rejected') counts.rejectedPermissions++;
    });

    return counts;
  }, [otRequests, permissions]);

  // Evidence State
  // Derived State
  const pendingOTs = otRequests.filter(req => req.status === 'pending');
  const pendingPermissions = permissions.filter(req => req.status === 'pending');
  const totalPending = pendingOTs.length + pendingPermissions.length;

  const isEmployee = currentUser?.role === 'employee';

  // Dynamic Column Logic
  const { showDivision, showDepartment, showEmployeeCol } = useMemo(() => {
    if (isEmployee) return { showDivision: false, showDepartment: false, showEmployeeCol: false };

    const isHOD = currentUser?.role === 'hod';
    if (isHOD) return { showDivision: false, showDepartment: false, showEmployeeCol: true };

    let dataToCheck: any[] = [];
    if (activeTab === 'ot') dataToCheck = otRequests;
    else if (activeTab === 'permissions') dataToCheck = permissions;
    else dataToCheck = [...otRequests, ...permissions];

    const uniqueDivisions = new Set(dataToCheck.map(item => item.employeeId?.department?.division?.name).filter(Boolean));

    return {
      showDivision: uniqueDivisions.size > 1,
      showDepartment: true,
      showEmployeeCol: true
    };
  }, [otRequests, permissions, activeTab, currentUser, isEmployee]);

  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [locationData, setLocationData] = useState<any | null>(null);

  useEffect(() => {
    if (currentUser) {
      loadData();
    }
  }, [activeTab, otFilters, permissionFilters, isEmployee, currentUser]);

  const canPerformAction = (item: any) => {
    if (!item || !currentUser) return false;
    if (item.status === 'approved' || item.status === 'rejected' || (item.workflow && item.workflow.isCompleted)) return false;

    // Super Admin can always act (emergency override)
    if (currentUser.role === 'super_admin') return true;

    // Check dynamic workflow
    if (item.workflow && item.workflow.approvalChain) {
      const currentStep = item.workflow.approvalChain.find((step: any) => step.isCurrent);
      if (currentStep) {
        return currentStep.role === currentUser.role;
      }
    }

    // Use Centralized Permissions for legacy/fallback logic
    // We determine the type of item by checking for specific fields
    const isOT = 'otHours' in item || 'otInTime' in item;
    const isPermission = 'permissionHours' in item || 'permissionStartTime' in item;

    if (isOT) {
      return canApproveOT(currentUser as any);
    }

    if (isPermission) {
      return canApprovePermission(currentUser as any);
    }

    return false;
  };

  // Auto-fetch attendance when OT dialog opens with employee and date
  useEffect(() => {
    if (showOTDialog && otFormData.employeeId && otFormData.employeeNumber && otFormData.date && !attendanceData && !attendanceLoading) {
      handleEmployeeSelect(otFormData.employeeId, otFormData.employeeNumber, otFormData.date);
    }
  }, [showOTDialog]);

  // Auto-fill for Employee Role
  useEffect(() => {
    if (isEmployee && currentUser) {
      // Robustly get ID and Emp No
      const empId = (currentUser as any)._id || currentUser.id;
      const empNo = currentUser.emp_no || currentUser.employeeId;

      if (empId && empNo) {
        if (showOTDialog) {
          setOTFormData(prev => ({ ...prev, employeeId: empId, employeeNumber: empNo }));
          // Only fetch if date is set (it is default initialized)
          if (otFormData.date) {
            handleEmployeeSelect(empId, empNo, otFormData.date);
          }
        }

        if (showPermissionDialog) {
          setPermissionFormData(prev => ({ ...prev, employeeId: empId, employeeNumber: empNo }));
          // Check attendance for permission
          if (permissionFormData.date) {
            api.getAttendanceDetail(empNo, permissionFormData.date).then(attendanceRes => {
              if (!attendanceRes.success || !attendanceRes.data || !attendanceRes.data.shifts || attendanceRes.data.shifts.length === 0 || !attendanceRes.data.shifts[0].inTime) {
                setPermissionValidationError('No attendance record found or employee has no in-time for this date. Permission cannot be created without attendance.');
              } else {
                setPermissionValidationError('');
              }
            }).catch(console.error);
          }
        }
      } else {
        console.warn('Current user missing employee details:', currentUser);
      }
    }
  }, [showOTDialog, showPermissionDialog, isEmployee, currentUser]);

  const loadData = async () => {
    setDataLoading(true);
    try {
      if (activeTab === 'ot') {
        const otRes = await api.getOTRequests(otFilters);
        if (otRes.success) {
          setOTRequests(otRes.data || []);
        }
      } else if (activeTab === 'permissions') {
        const permRes = await api.getPermissions(permissionFilters);
        if (permRes.success) {
          setPermissions(permRes.data || []);
        }
      } else if (activeTab === 'pending') {
        // Load both for pending dashboard
        const [otRes, permRes] = await Promise.all([
          api.getOTRequests({ ...otFilters, status: 'pending' }), // Optimize filters if backend supports?
          // Actually, we probably want ALL pending, ignoring date filters?
          // Or respect filters? The user might filter pending by date.
          // Let's use the current filters but maybe force status 'pending' if the user hasn't selected it?
          // But 'otFilters' has 'status'. If user switches to Pending tab, we might want to ignore the 'status' filter in the state 
          // and fetch ALL pending?
          // In Leaves page, 'pending' tab uses 'pendingLeaves' variable which comes from 'leaves' array.
          // 'leaves' array is loaded with NO status filter (all leaves).
          // Here, 'otRequests' only loads with 'otFilters'.
          // If I act like Leaves page, I should load ALL OT and ALL Perms (or at least pending ones).
          // Let's load ALL Pending for now.
          api.getPermissions({ ...permissionFilters, status: 'pending' })
        ]);

        // Wait, if I load specific 'pending' here, I overwrite 'otRequests' with ONLY pending items.
        // If I switch back to 'OT' tab later, it reloads 'ot' data. This is fine.
        if (otRes.success) setOTRequests(otRes.data || []);
        if (permRes.success) setPermissions(permRes.data || []);
      }

      // Load employees and shifts
      const [employeesRes, shiftsRes] = await Promise.all([
        !isEmployee ? api.getEmployees({ is_active: true }) : Promise.resolve({ success: true, data: [] }),
        api.getShifts(),
      ]);

      if (!isEmployee && employeesRes && employeesRes.success) {
        if (Array.isArray(employeesRes.data)) {
          const employeesList = employeesRes.data;
          console.log('Loaded employees:', employeesList.length);
          setEmployees(employeesList);
        } else {
          console.error('Expected array for employees but got:', typeof employeesRes.data);
          setEmployees([]);
        }
      } else if (!isEmployee) {
        console.error('Failed to load employees. Response:', JSON.stringify(employeesRes));
        // Only show toast if there's a meaningful message
        if (employeesRes && (employeesRes as any).message) {
          showToast((employeesRes as any).message, 'error');
        }
      }

      if (shiftsRes.success) {
        setShifts(shiftsRes.data || []);
      }
    } catch (error: any) {
      console.error('Error loading data:', error);
      // Try to print full error if object
      try {
        if (typeof error === 'object') console.error(JSON.stringify(error));
      } catch (e) { /* ignore */ }
    } finally {
      setDataLoading(false);
      setInitialLoading(false);
    }
  };

  const handleEmployeeSelect = async (employeeId: string, employeeNumber: string, date: string) => {
    // Find employee by _id or emp_no
    const employee = employees.find(e => (e._id === employeeId) || (e.emp_no === employeeId) || (e.emp_no === employeeNumber));
    setSelectedEmployee(employee || null);
    setValidationError('');
    setAttendanceData(null);
    setConfusedShift(null);
    setSelectedShift(null);

    if (!employeeId || !employeeNumber || !date) {
      return;
    }

    setAttendanceLoading(true);
    try {
      // Fetch attendance detail for the selected employee and date
      const attendanceRes = await api.getAttendanceDetail(employeeNumber, date);

      if (attendanceRes.success && attendanceRes.data) {
        const attendance = attendanceRes.data;
        setAttendanceData(attendance);

        // Check for ConfusedShift
        const confusedRes = await api.checkConfusedShift(employeeNumber, date);
        if (confusedRes.success && (confusedRes as any).hasConfusedShift) {
          setConfusedShift((confusedRes as any).data);
          setOTFormData(prev => ({ ...prev, employeeId, employeeNumber, date }));
        } else {
          // Get shift from attendance
          if (attendance.shifts && attendance.shifts.length > 0) {
            const firstShift = attendance.shifts[0];
            const shiftId = (firstShift.shiftId && typeof firstShift.shiftId === 'object') ? (firstShift.shiftId as any)._id : firstShift.shiftId;

            // Try to find full shift object in shifts list
            const shift = shifts.find(s => s._id === shiftId);

            if (shift) {
              setSelectedShift(shift);
              setOTFormData(prev => ({ ...prev, employeeId, employeeNumber, date, shiftId: shift._id }));

              // Auto-suggest OT out time (shift end time + 1 hour as default)
              const [endHour, endMin] = shift.endTime.split(':').map(Number);
              const suggestedOutTime = new Date(date);
              suggestedOutTime.setHours(endHour + 1, endMin, 0, 0);
              const suggestedOutTimeStr = suggestedOutTime.toISOString().slice(0, 16);
              setOTFormData(prev => ({ ...prev, otOutTime: suggestedOutTimeStr }));
            } else if (firstShift.shiftId && typeof firstShift.shiftId === 'object') {
              // Shift not found in global list but present in attendance (populated)
              const shiftData = firstShift.shiftId as any;
              setSelectedShift({
                _id: shiftData._id,
                name: shiftData.name || 'Unknown',
                startTime: shiftData.startTime || '',
                endTime: shiftData.endTime || '',
                duration: shiftData.duration || 0,
              });
              setOTFormData(prev => ({ ...prev, employeeId, employeeNumber, date, shiftId: shiftData._id }));

              // Auto-suggest OT out time
              if (shiftData.endTime) {
                const [endHour, endMin] = shiftData.endTime.split(':').map(Number);
                const suggestedOutTime = new Date(date);
                suggestedOutTime.setHours(endHour + 1, endMin, 0, 0);
                const suggestedOutTimeStr = suggestedOutTime.toISOString().slice(0, 16);
                setOTFormData(prev => ({ ...prev, otOutTime: suggestedOutTimeStr }));
              }
            } else {
              // Fallback if shiftId is just an ID but not found in list, or missing
              // Try using embedded fields if available
              if (firstShift.shiftName) {
                setSelectedShift({
                  _id: shiftId as string,
                  name: firstShift.shiftName || 'Unknown',
                  startTime: firstShift.shiftStartTime || '',
                  endTime: firstShift.shiftEndTime || '',
                  duration: firstShift.duration || 0,
                });
                setOTFormData(prev => ({ ...prev, employeeId, employeeNumber, date, shiftId: shiftId as string }));
              }
            }
          } else {
            setValidationError('No shift assigned to this attendance. Please assign a shift first.');
          }
        }
      } else {
        // No attendance found
        setValidationError(attendanceRes.message || 'No attendance record found for this date. OT cannot be created without attendance.');
        setAttendanceData(null);
      }
    } catch (error: any) {
      console.error('Error fetching attendance:', error);
      setValidationError('Failed to fetch attendance data');
      setAttendanceData(null);
    } finally {
      setAttendanceLoading(false);
    }
  };

  const handleCreateOT = async () => {
    const missingFields = [];
    if (!otFormData.employeeId) missingFields.push('Employee');
    if (!otFormData.employeeNumber) missingFields.push('Employee Number');
    if (!otFormData.date) missingFields.push('Date');
    if (!otFormData.otOutTime) missingFields.push('OT Out Time');

    if (missingFields.length > 0) {
      const msg = `Please fill all required fields: ${missingFields.join(', ')}`;
      setValidationError(msg);
      showToast(msg, 'error');
      return;
    }

    if (!attendanceData || !attendanceData.shifts || attendanceData.shifts.length === 0 || !attendanceData.shifts[0].inTime) {
      const errorMsg = 'Attendance record not found or incomplete. OT cannot be created without attendance.';
      setValidationError(errorMsg);
      showToast(errorMsg, 'error');
      return;
    }

    if (confusedShift && !otFormData.manuallySelectedShiftId) {
      const errorMsg = 'Please select a shift (required for ConfusedShift)';
      setValidationError(errorMsg);
      showToast(errorMsg, 'error');
      return;
    }

    // 3. Create Request
    setDataLoading(true);
    setValidationError('');

    let payload: any = { ...otFormData };

    // Handle Evidence Upload (Lazy Upload)
    if (evidenceFile) {
      try {
        showToast('Uploading evidence...', 'info');
        const uploadRes = await api.uploadEvidence(evidenceFile);
        // API returns { success, url, key, filename } at top level (no .data wrapper)
        if (uploadRes.success && uploadRes.url) {
          payload.photoEvidence = {
            url: uploadRes.url,
            key: uploadRes.key,
            exifLocation: (evidenceFile as any).exifLocation
          };
        } else {
          showToast('Failed to upload evidence photo', 'error');
          setDataLoading(false);
          return;
        }
      } catch (uploadErr) {
        console.error("Upload failed", uploadErr);
        showToast('Failed to upload evidence photo', 'error');
        setDataLoading(false);
        return;
      }
    }

    // Add Location Data
    if (locationData) {
      payload.geoLocation = locationData;
    }

    try {
      const res = await api.createOT(payload);
      if (res.success) {
        showToast('OT request created successfully', 'success');
        setShowOTDialog(false);
        resetOTForm();
        loadData();
      } else {
        const errorMsg = res.message || 'Error creating OT request';
        setValidationError(errorMsg);
        if ((res as any).validationErrors && (res as any).validationErrors.length > 0) {
          const validationMsg = (res as any).validationErrors.join('. ');
          setValidationError(validationMsg);
          showToast(validationMsg, 'error');
        } else {
          showToast(errorMsg, 'error');
        }
      }
    } catch (error: any) {
      console.error('Error creating OT:', error);
      const errorMsg = error.message || 'Error creating OT request';
      setValidationError(errorMsg);
      showToast(errorMsg, 'error');
    } finally {
      setDataLoading(false);
    }
  };

  const handleCreatePermission = async () => {
    const missingFields = [];
    if (!permissionFormData.employeeId) missingFields.push('Employee');
    if (!permissionFormData.employeeNumber) missingFields.push('Employee Number');
    if (!permissionFormData.date) missingFields.push('Date');
    if (!permissionFormData.permissionStartTime) missingFields.push('Start Time');
    if (!permissionFormData.permissionEndTime) missingFields.push('End Time');
    if (!permissionFormData.purpose) missingFields.push('Purpose');

    if (missingFields.length > 0) {
      const msg = `Please fill all required fields: ${missingFields.join(', ')}`;
      setPermissionValidationError(msg);
      showToast(msg, 'error');
      return;
    }

    // Additional check: verify attendance exists
    if (permissionFormData.employeeNumber && permissionFormData.date) {
      try {
        const attendanceRes = await api.getAttendanceDetail(permissionFormData.employeeNumber, permissionFormData.date);
        if (!attendanceRes.success || !attendanceRes.data) {
          const errorMsg = 'No attendance record found for this date. Permission cannot be created without attendance.';
          setPermissionValidationError(errorMsg);
          showToast(errorMsg, 'error');
          return;
        }
      } catch (error) {
        console.error('Error checking attendance:', error);
        const errorMsg = 'Failed to verify attendance. Please try again.';
        setPermissionValidationError(errorMsg);
        showToast(errorMsg, 'error');
        return;
      }
    }

    // 3. Create Request
    setDataLoading(true);
    setPermissionValidationError('');

    let payload: any = { ...permissionFormData };

    // Handle Evidence Upload (Lazy Upload)
    if (evidenceFile) {
      try {
        showToast('Uploading evidence...', 'info');
        const uploadRes = await api.uploadEvidence(evidenceFile);
        // API returns { success, url, key, filename } at top level (no .data wrapper)
        if (uploadRes.success && uploadRes.url) {
          payload.photoEvidence = {
            url: uploadRes.url,
            key: uploadRes.key,
            exifLocation: (evidenceFile as any).exifLocation
          };
        } else {
          showToast('Failed to upload evidence photo', 'error');
          setDataLoading(false);
          return;
        }
      } catch (uploadErr) {
        console.error("Upload failed", uploadErr);
        showToast('Failed to upload evidence photo', 'error');
        setDataLoading(false);
        return;
      }
    }

    // Add Location Data
    if (locationData) {
      payload.geoLocation = locationData;
    }

    try {
      const res = await api.createPermission(payload);
      if (res.success) {
        showToast('Permission request created successfully', 'success');
        setShowPermissionDialog(false);
        resetPermissionForm();
        loadData();
      } else {
        const errorMsg = res.message || 'Error creating permission request';
        setPermissionValidationError(errorMsg);
        if ((res as any).validationErrors && (res as any).validationErrors.length > 0) {
          const validationMsg = (res as any).validationErrors.join('. ');
          setPermissionValidationError(validationMsg);
          showToast(validationMsg, 'error');
        } else {
          showToast(errorMsg, 'error');
        }
      }
    } catch (error: any) {
      console.error('Error creating permission:', error);
      const errorMsg = error.message || 'Error creating permission request';
      setPermissionValidationError(errorMsg);
      showToast(errorMsg, 'error');
    } finally {
      setDataLoading(false);
    }
  };

  const handleApprove = async (type: 'ot' | 'permission', id: string) => {
    if (!window.confirm(`Are you sure you want to approve this ${type === 'ot' ? 'OT' : 'permission'} request?`)) {
      return;
    }

    setDataLoading(true);
    try {
      const res = type === 'ot' ? await api.approveOT(id) : await api.approvePermission(id);
      if (res.success) {
        showToast(`${type === 'ot' ? 'OT' : 'Permission'} request approved successfully`, 'success');
        loadData();

        // If permission, show QR code
        if (type === 'permission' && res.data?.qrCode) {
          setSelectedQR(res.data);
          setShowQRDialog(true);
        }
      } else {
        showToast(res.message || `Error approving ${type} request`, 'error');
      }
    } catch (error) {
      console.error(`Error approving ${type}:`, error);
      showToast(`Error approving ${type} request`, 'error');
    } finally {
      setDataLoading(false);
    }
  };

  const handleReject = async (type: 'ot' | 'permission', id: string) => {
    const reason = window.prompt(`Enter rejection reason for this ${type === 'ot' ? 'OT' : 'permission'} request:`);
    if (reason === null) return;

    setDataLoading(true);
    try {
      const res = type === 'ot' ? await api.rejectOT(id, reason) : await api.rejectPermission(id, reason);
      if (res.success) {
        showToast(`${type === 'ot' ? 'OT' : 'Permission'} request rejected`, 'info');
        loadData();
      } else {
        showToast(res.message || `Error rejecting ${type} request`, 'error');
      }
    } catch (error) {
      console.error(`Error rejecting ${type}:`, error);
      showToast(`Error rejecting ${type} request`, 'error');
    } finally {
      setDataLoading(false);
    }
  };

  // Auto-generate Gate Pass when dialog opens
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    if (showQRDialog && selectedQR && !dataLoading) {
      if (!selectedQR.gateOutTime) {
        // Needs OUT pass
        if (!selectedQR.qrCode || !selectedQR.qrCode.startsWith('OUT:')) {
          // Add a small delay to avoid state updates during render
          timeoutId = setTimeout(() => {
            handleGenerateGatePass('OUT');
          }, 500);
        }
      } else if (!selectedQR.gateInTime) {
        // Needs IN pass, check 5 min delay
        const now = new Date();
        const gateOutTime = new Date(selectedQR.gateOutTime);
        const diffMs = now.getTime() - gateOutTime.getTime();
        const minutesPassed = diffMs / (1000 * 60);

        if (minutesPassed >= 5 && (!selectedQR.qrCode || !selectedQR.qrCode.startsWith('IN:'))) {
          timeoutId = setTimeout(() => {
            handleGenerateGatePass('IN');
          }, 500);
        }
      }
    }

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showQRDialog, selectedQR, dataLoading]);

  const handleGenerateGatePass = async (type: 'OUT' | 'IN') => {
    if (!selectedQR) return;

    try {
      setDataLoading(true);
      const res = type === 'OUT'
        ? await api.generateGateOutQR(selectedQR._id)
        : await api.generateGateInQR(selectedQR._id);

      if (res.success) {
        showToast(`Gate ${type} Pass generated successfully`, 'success');
        // Update local state to show QR
        const secret = res.qrSecret;
        // Re-fetch data to get updated permission object (timings etc)
        // Or manually update selectedQR for immediate feedback
        setSelectedQR(prev => prev ? { ...prev, qrCode: secret, [`gate${type === 'OUT' ? 'Out' : 'In'}Secret`]: secret } : null);
        loadData(); // To refresh grid status
      } else {
        showToast(res.message || `Failed to generate Gate ${type} Pass`, 'error');
        if (res.waitTime) {
          // Could show specific timer
        }
      }
    } catch (error: any) {
      console.error('Error generating gate pass:', error);
      showToast(error.message || 'Failed to generate gate pass', 'error');
    } finally {
      setDataLoading(false);
    }
  };

  const resetOTForm = () => {
    setOTFormData({
      employeeId: '',
      employeeNumber: '',
      date: getTodayIST(),
      otOutTime: '',
      shiftId: '',
      manuallySelectedShiftId: '',
      comments: '',
    });
    setConfusedShift(null);
    setSelectedEmployee(null);
    setSelectedShift(null);
    setAttendanceData(null);
    setAttendanceData(null);
    setValidationError('');
    setEvidenceFile(null);
    setLocationData(null);
  };

  const formatTime = (time: string | null) => {
    if (!time) return '-';
    try {
      const date = new Date(time);
      if (isNaN(date.getTime())) return time;
      return date.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata'
      });
    } catch {
      return time;
    }
  };

  const resetPermissionForm = () => {
    setPermissionFormData({
      employeeId: '',
      employeeNumber: '',
      date: getTodayIST(),
      permissionStartTime: '',
      permissionEndTime: '',
      purpose: '',
      comments: '',
    });
    setPermissionValidationError('');
    setEvidenceFile(null);
    setLocationData(null);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      case 'rejected':
        return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
      case 'pending':
      case 'manager_approved':
        return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
      case 'checked_out':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
      case 'checked_in':
        return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
      default:
        return 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400';
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    try {
      // If it's already YYYY-MM-DD, try to keep it simple but safe
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [y, m, d] = dateStr.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        return date.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
      }
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      return date.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="relative min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-300 pt-4">
      <ToastContainer position="top-right" autoClose={3000} hideProgressBar={false} />

      {/* Decorative Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -right-[10%] w-[40%] h-[40%] rounded-full bg-blue-500/5 blur-[120px] dark:bg-blue-500/10" />
        <div className="absolute -bottom-[10%] -left-[10%] w-[40%] h-[40%] rounded-full bg-emerald-500/5 blur-[120px] dark:bg-emerald-500/10" />
      </div>

      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 pb-10 pt-1">
        {/* Sticky Header */}
        <div className="sticky top-4 z-40 md:px-4 mb-2 md:mb-8">
          <div className="max-w-[1920px] mx-auto md:bg-white/70 md:dark:bg-slate-900/70 md:backdrop-blur-2xl md:rounded-[2.5rem] md:border md:border-white/20 md:dark:border-slate-800 md:shadow-2xl md:shadow-slate-200/50 md:dark:shadow-none min-h-[4.5rem] flex flex-col md:flex-row items-stretch md:items-center
         justify-between gap-2 md:gap-4 px-0 sm:px-8 py-2 md:py-0">
            <div className="flex items-center gap-4 px-2">
              <div className="hidden md:flex h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 items-center justify-center text-white shadow-lg shadow-blue-500/20">
                <Clock3 className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-base md:text-xl font-black bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 uppercase tracking-tight whitespace-nowrap">
                  OT & Permissions
                </h1>
                <p className="hidden md:flex text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] items-center gap-2">
                  Workspace <span className="h-1 w-1 rounded-full bg-slate-300"></span> Management
                </p>
              </div>
            </div>

            <div className="w-full md:w-auto mt-1 md:mt-0">
              {(canApplyOT(currentUser as any) || canApplyPermission(currentUser as any)) && (
                <div className="grid grid-cols-2 gap-3 md:flex md:items-center md:gap-2 px-1 md:px-0">
                  <button
                    onClick={() => setShowOTDialog(true)}
                    className="group h-10 md:h-11 p-1 sm:px-6 rounded-xl md:rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs md:text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-slate-900/10 dark:shadow-white/10 shrink-0"
                  >
                    <Plus className="w-5 h-5 sm:w-3.5 sm:h-3.5" />
                    <span className="inline">Apply OT</span>
                  </button>
                  <button
                    onClick={() => setShowPermissionDialog(true)}
                    className="group h-10 md:h-11 p-1 sm:px-6 rounded-xl md:rounded-2xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 text-xs md:text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-[0.98] transition-all shadow-sm shrink-0"
                  >
                    <Plus className="w-5 h-5 sm:w-3.5 sm:h-3.5" />
                    <span className="inline">Apply Permission</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <main className="flex-1 max-w-[1920px] mx-auto w-full px-2 sm:px-8 py-4 sm:py-8 space-y-6 sm:space-y-8">
          {/* Stats Grid - Desktop */}
          <div className="hidden md:grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-4 animate-in fade-in slide-in-from-top-4 duration-500">
            <StatCard
              title="Approved OT Hours"
              value={stats.approvedOT}
              icon={Timer}
              bgClass="bg-emerald-500/10"
              iconClass="text-emerald-600 dark:text-emerald-400"
              dekorClass="bg-emerald-500/5"
              loading={initialLoading}
            />
            <StatCard
              title="Approved Permissions"
              value={stats.approvedPermissions}
              icon={CheckCircle2}
              bgClass="bg-blue-500/10"
              iconClass="text-blue-600 dark:text-blue-400"
              dekorClass="bg-blue-500/5"
              loading={initialLoading}
            />
            <StatCard
              title="Pending Requests"
              value={stats.pendingOT + stats.pendingPermissions}
              icon={Clock3}
              bgClass="bg-amber-500/10"
              iconClass="text-amber-600 dark:text-amber-400"
              dekorClass="bg-amber-500/5"
              loading={initialLoading}
            />
            <StatCard
              title="Rejected Requests"
              value={stats.rejectedOT + stats.rejectedPermissions}
              icon={XCircle}
              bgClass="bg-rose-500/10"
              iconClass="text-rose-600 dark:text-rose-400"
              dekorClass="bg-rose-500/5"
              loading={initialLoading}
            />
          </div>

          {/* Stats Grid - Mobile */}
          {/* Stats Grid - Mobile */}
          <div className="md:hidden grid grid-cols-2 gap-3 mb-6 animate-in fade-in slide-in-from-top-4 duration-500">
            {/* OT Stats Card */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-3 opacity-10">
                <Timer className="w-12 h-12 text-emerald-500" />
              </div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">OT Stats</h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                    <span className="text-xs text-slate-600 dark:text-slate-400">Approved</span>
                  </div>
                  <span className="text-sm font-bold text-slate-900 dark:text-white">{stats.approvedOT}h</span>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                    <span className="text-xs text-slate-600 dark:text-slate-400">Pending</span>
                  </div>
                  <span className="text-sm font-bold text-slate-900 dark:text-white">{stats.pendingOT}</span>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-rose-500"></div>
                    <span className="text-xs text-slate-600 dark:text-slate-400">Rejected</span>
                  </div>
                  <span className="text-sm font-bold text-slate-900 dark:text-white">{stats.rejectedOT}</span>
                </div>
              </div>
            </div>

            {/* Permission Stats Card */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-3 opacity-10">
                <ShieldCheck className="w-12 h-12 text-blue-500" />
              </div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Perm Stats</h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                    <span className="text-xs text-slate-600 dark:text-slate-400">Approved</span>
                  </div>
                  <span className="text-sm font-bold text-slate-900 dark:text-white">{stats.approvedPermissions}</span>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                    <span className="text-xs text-slate-600 dark:text-slate-400">Pending</span>
                  </div>
                  <span className="text-sm font-bold text-slate-900 dark:text-white">{stats.pendingPermissions}</span>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-rose-500"></div>
                    <span className="text-xs text-slate-600 dark:text-slate-400">Rejected</span>
                  </div>
                  <span className="text-sm font-bold text-slate-900 dark:text-white">{stats.rejectedPermissions}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Controls Section */}
          <div className="mb-6 animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="md:p-5 md:rounded-[2.5rem] md:border md:border-white/20 md:dark:border-slate-800 md:bg-white/60 md:dark:bg-slate-900/60 md:backdrop-blur-xl md:shadow-xl md:shadow-slate-200/50 md:dark:shadow-none transition-all">
              <div className="flex flex-wrap items-center gap-2 md:gap-6">
                {/* Search & Toggle */}
                <div className="flex items-center gap-2 w-full md:w-auto md:flex-1">
                  <div className="flex-1 min-w-[200px] relative group">
                    <div className="absolute inset-0 bg-blue-500/5 rounded-2xl blur-xl transition-opacity opacity-0 group-focus-within:opacity-100" />
                    <input
                      type="text"
                      placeholder="Search Employee..."
                      value={activeTab === 'ot' ? otFilters.employeeNumber : permissionFilters.employeeNumber}
                      onChange={(e) => {
                        if (activeTab === 'ot') setOTFilters(prev => ({ ...prev, employeeNumber: e.target.value }));
                        else setPermissionFilters(prev => ({ ...prev, employeeNumber: e.target.value }));
                      }}
                      className="relative w-full h-10 md:h-11 pl-4 pr-12 rounded-xl md:rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs md:text-sm font-semibold focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all dark:text-white shadow-sm"
                    />
                    {/* Embedded Search Button */}
                    <button
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-blue-500 text-white shadow-lg shadow-blue-500/20 active:scale-95 transition-all"
                    >
                      <Search className="w-4 h-4" />
                    </button>
                  </div>
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className={`md:hidden h-10 w-10 flex items-center justify-center rounded-xl border transition-all ${showFilters
                      ? 'bg-blue-500 border-blue-500 text-white'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                      }`}
                  >
                    <Filter className="w-5 h-5" />
                  </button>
                </div>

                <div className={`grid grid-cols-2 gap-2 w-full md:flex md:w-auto md:items-center md:gap-4 ${showFilters ? 'grid' : 'hidden md:flex'}`}>
                  {/* Status Filter */}
                  <div className="relative">
                    <Filter className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <select
                      value={activeTab === 'ot' ? otFilters.status : permissionFilters.status}
                      onChange={(e) => {
                        if (activeTab === 'ot') setOTFilters(prev => ({ ...prev, status: e.target.value }));
                        else setPermissionFilters(prev => ({ ...prev, status: e.target.value }));
                      }}
                      className="h-10 pl-9 pr-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all appearance-none cursor-pointer w-full"
                    >
                      <option value="">All Status</option>
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </div>

                  {/* Date Range */}
                  <div className="col-span-2 flex items-center flex-nowrap gap-2 px-0 py-0 bg-transparent border-0 md:px-3 md:py-1.5 md:rounded-xl md:bg-slate-100 md:dark:bg-slate-800 md:border md:border-slate-200 md:dark:border-slate-700">
                    <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <input
                      type="date"
                      value={activeTab === 'ot' ? otFilters.startDate : permissionFilters.startDate}
                      onChange={(e) => {
                        if (activeTab === 'ot') setOTFilters(prev => ({ ...prev, startDate: e.target.value }));
                        else setPermissionFilters(prev => ({ ...prev, startDate: e.target.value }));
                      }}
                      className="bg-transparent text-xs font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer w-full sm:w-auto min-w-[100px]"
                    />
                    <span className="text-slate-300 dark:text-slate-600 font-bold shrink-0">→</span>
                    <input
                      type="date"
                      value={activeTab === 'ot' ? otFilters.endDate : permissionFilters.endDate}
                      onChange={(e) => {
                        if (activeTab === 'ot') setOTFilters(prev => ({ ...prev, endDate: e.target.value }));
                        else setPermissionFilters(prev => ({ ...prev, endDate: e.target.value }));
                      }}
                      className="bg-transparent text-xs font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer w-full sm:w-auto min-w-[100px]"
                    />
                  </div>
                </div>
              </div>
              {/* Tab Switcher */}

            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div className="grid grid-cols-3 md:flex items-center p-1 rounded-xl bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 backdrop-blur-sm shadow-inner w-full md:w-auto gap-1 md:gap-0">
              {[
                { id: 'ot', label: 'Overtime', icon: Clock3, count: 0, activeClass: 'text-blue-500', badgeClass: 'bg-blue-500 text-white' },
                { id: 'permissions', label: 'Permissions', icon: ShieldCheck, count: 0, activeClass: 'text-emerald-500', badgeClass: 'bg-emerald-500 text-white' },
                { id: 'pending', label: 'Pending', icon: AlertCircle, count: totalPending, activeClass: 'text-amber-500', badgeClass: 'bg-amber-500 text-white' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`group relative flex items-center justify-center gap-2 px-3 md:px-6 py-2 rounded-lg text-[10px] md:text-xs font-black uppercase tracking-widest transition-all duration-300
                  ${activeTab === tab.id
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-200/50 dark:ring-0'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                    }
                `}
                >
                  <tab.icon className={`w-3.5 h-3.5 ${activeTab === tab.id ? tab.activeClass : 'text-slate-400 group-hover:text-slate-600'}`} />
                  <span>{tab.label}</span>
                  {tab.count > 0 && (
                    <span className={`flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-md text-[10px] font-black ${activeTab === tab.id
                      ? tab.badgeClass
                      : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                      }`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          {
            activeTab === 'pending' ? (
              <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
                {/* Pending OT Requests */}
                <div className="space-y-6">
                  <div className="flex items-center gap-3 ml-2">
                    <div className="w-2 h-8 bg-blue-500 rounded-full" />
                    <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Pending Overtime</h3>
                    <span className="px-3 py-1 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-black">
                      {dataLoading ? '...' : pendingOTs.length}
                    </span>
                  </div>

                  {dataLoading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {[...Array(3)].map((_, i) => (
                        <div key={i} className="group relative flex flex-col justify-between rounded-[2.5rem] border border-white/20 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-6 shadow-xl shadow-slate-200/50 dark:shadow-none animate-pulse">
                          <div className="flex items-start justify-between gap-4 mb-6">
                            <div className="flex items-center gap-4">
                              <div className="h-12 w-12 rounded-2xl bg-slate-200 dark:bg-slate-700" />
                              <div className="space-y-2">
                                <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded" />
                                <div className="h-3 w-20 bg-slate-200 dark:bg-slate-700 rounded" />
                              </div>
                            </div>
                            <div className="h-6 w-20 bg-slate-200 dark:bg-slate-700 rounded-xl" />
                          </div>
                          <div className="h-24 bg-slate-50 dark:bg-slate-800 rounded-2xl mb-6" />
                          <div className="flex gap-3">
                            <div className="flex-1 h-10 bg-slate-200 dark:bg-slate-700 rounded-xl" />
                            <div className="flex-1 h-10 bg-slate-200 dark:bg-slate-700 rounded-xl" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : pendingOTs.length === 0 ? (
                    <div className="rounded-[2.5rem] border-2 border-dashed border-slate-200 dark:border-slate-800 p-12 text-center bg-white/30 dark:bg-slate-900/30 backdrop-blur-sm">
                      <Clock className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-600 mb-4" />
                      <h3 className="text-lg font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Clear Workspace</h3>
                      <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">No overtime requests requiring your approval.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {pendingOTs.map((ot) => (
                        <div key={ot._id} className="group relative flex flex-col justify-between rounded-[2.5rem] border border-white/20 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-6 shadow-xl shadow-slate-200/50 dark:shadow-none hover:-translate-y-1 transition-all duration-300">
                          {/* Header */}
                          <div className="flex items-start justify-between gap-4 mb-6">
                            <div className="flex items-center gap-4">
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-blue-500 to-blue-600 text-white font-black text-xs shadow-lg shadow-blue-500/20">
                                {getEmployeeInitials({
                                  employee_name: ot.employeeId?.employee_name || '',
                                  first_name: ot.employeeId?.employee_name?.split(' ')[0],
                                  last_name: '',
                                  emp_no: ''
                                } as any)}
                              </div>
                              <div>
                                <h4 className="font-black text-slate-900 dark:text-white text-sm line-clamp-1 group-hover:text-blue-600 transition-colors">
                                  {ot.employeeId?.employee_name || ot.employeeNumber}
                                </h4>
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-0.5">
                                  {ot.employeeNumber}
                                </p>
                              </div>
                            </div>
                            <span className="px-3 py-1 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-amber-500/20">
                              PENDING
                            </span>
                          </div>

                          {/* Content Grid */}
                          <div className="grid grid-cols-2 gap-4 mb-6 p-4 rounded-2xl bg-slate-50/50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                            <div className="space-y-1">
                              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Date</p>
                              <p className="text-xs font-bold text-slate-900 dark:text-white">{formatDate(ot.date)}</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Duration</p>
                              <p className="text-xs font-black text-blue-600 dark:text-blue-400">{ot.otHours} hrs</p>
                            </div>
                            <div className="col-span-2 space-y-1">
                              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Time Window</p>
                              <p className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                <Timer className="w-3 h-3 text-slate-400" />
                                {formatTime(ot.otInTime)} <ChevronRight className="w-3 h-3 text-slate-300" /> {formatTime(ot.otOutTime)}
                              </p>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => handleApprove('ot', ot._id)}
                              className="flex-1 h-10 rounded-xl bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 transition-all flex items-center justify-center gap-2"
                            >
                              <Check className="h-3.5 w-3.5" /> Approve
                            </button>
                            <button
                              onClick={() => handleReject('ot', ot._id)}
                              className="flex-1 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px] font-black uppercase tracking-widest hover:bg-rose-500 hover:text-white transition-all flex items-center justify-center gap-2"
                            >
                              <X className="h-3.5 w-3.5" /> Reject
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Pending Permissions Requests */}
                <div className="space-y-6">
                  <div className="flex items-center gap-3 ml-2">
                    <div className="w-2 h-8 bg-emerald-500 rounded-full" />
                    <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Pending Permissions</h3>
                    <span className="px-3 py-1 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-black">
                      {dataLoading ? '...' : pendingPermissions.length}
                    </span>
                  </div>

                  {dataLoading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {[...Array(3)].map((_, i) => (
                        <div key={i} className="group relative flex flex-col justify-between rounded-[2.5rem] border border-white/20 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-6 shadow-xl shadow-slate-200/50 dark:shadow-none animate-pulse">
                          <div className="flex items-start justify-between gap-4 mb-6">
                            <div className="flex items-center gap-4">
                              <div className="h-12 w-12 rounded-2xl bg-slate-200 dark:bg-slate-700" />
                              <div className="space-y-2">
                                <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded" />
                                <div className="h-3 w-20 bg-slate-200 dark:bg-slate-700 rounded" />
                              </div>
                            </div>
                            <div className="h-6 w-20 bg-slate-200 dark:bg-slate-700 rounded-xl" />
                          </div>
                          <div className="h-24 bg-slate-50 dark:bg-slate-800 rounded-2xl mb-6" />
                          <div className="flex gap-3">
                            <div className="flex-1 h-10 bg-slate-200 dark:bg-slate-700 rounded-xl" />
                            <div className="flex-1 h-10 bg-slate-200 dark:bg-slate-700 rounded-xl" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : pendingPermissions.length === 0 ? (
                    <div className="rounded-[2.5rem] border-2 border-dashed border-slate-200 dark:border-slate-800 p-12 text-center bg-white/30 dark:bg-slate-900/30 backdrop-blur-sm">
                      <Plus className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-600 mb-4" />
                      <h3 className="text-lg font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Clear Workspace</h3>
                      <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">No permission requests requiring your approval.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {pendingPermissions.map((perm) => (
                        <div key={perm._id} className="group relative flex flex-col justify-between rounded-[2.5rem] border border-white/20 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-6 shadow-xl shadow-slate-200/50 dark:shadow-none hover:-translate-y-1 transition-all duration-300">
                          {/* Header */}
                          <div className="flex items-start justify-between gap-4 mb-6">
                            <div className="flex items-center gap-4">
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-emerald-500 to-emerald-600 text-white font-black text-xs shadow-lg shadow-emerald-500/20">
                                {getEmployeeInitials({
                                  employee_name: perm.employeeId?.employee_name || '',
                                  first_name: perm.employeeId?.employee_name?.split(' ')[0],
                                  last_name: '',
                                  emp_no: ''
                                } as any)}
                              </div>
                              <div>
                                <h4 className="font-black text-slate-900 dark:text-white text-sm line-clamp-1 group-hover:text-emerald-600 transition-colors">
                                  {perm.employeeId?.employee_name || perm.employeeNumber}
                                </h4>
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-0.5">
                                  {perm.employeeNumber}
                                </p>
                              </div>
                            </div>
                            <span className="px-3 py-1 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-amber-500/20">
                              PENDING
                            </span>
                          </div>

                          {/* Content Grid */}
                          <div className="grid grid-cols-2 gap-4 mb-6 p-4 rounded-2xl bg-slate-50/50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                            <div className="space-y-1">
                              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Date</p>
                              <p className="text-xs font-bold text-slate-900 dark:text-white">{formatDate(perm.date)}</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Hours</p>
                              <p className="text-xs font-black text-emerald-600 dark:text-emerald-400">{perm.permissionHours} hrs</p>
                            </div>
                            <div className="col-span-2 space-y-1">
                              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Time Range</p>
                              <p className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                <Timer className="w-3 h-3 text-slate-400" />
                                {formatTime(perm.permissionStartTime)} <ChevronRight className="w-3 h-3 text-slate-400" /> {formatTime(perm.permissionEndTime)}
                              </p>
                            </div>
                            {perm.purpose && (
                              <div className="col-span-2 pt-2 border-t border-slate-200/50 dark:border-slate-700/50">
                                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 italic line-clamp-2">
                                  &quot;{perm.purpose}&quot;
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-3">
                            {canPerformAction(perm) && (
                              <>
                                <button
                                  onClick={() => handleApprove('permission', perm._id)}
                                  className="flex-1 h-10 rounded-xl bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 transition-all flex items-center justify-center gap-2"
                                >
                                  <Check className="h-3.5 w-3.5" /> Approve
                                </button>
                                <button
                                  onClick={() => handleReject('permission', perm._id)}
                                  className="flex-1 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px] font-black uppercase tracking-widest hover:bg-rose-500 hover:text-white transition-all flex items-center justify-center gap-2"
                                >
                                  <X className="h-3.5 w-3.5" /> Reject
                                </button>
                              </>
                            )}
                            {['approved', 'checked_out', 'checked_in'].includes(perm.status) && perm.qrCode && (
                              <button
                                onClick={() => {
                                  setSelectedQR(perm);
                                  setShowQRDialog(true);
                                }}
                                className="w-full h-10 rounded-xl bg-blue-500 text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-500/20 hover:bg-blue-600 transition-all flex items-center justify-center gap-2"
                              >
                                <QrCode className="h-3.5 w-3.5" /> Gate Pass
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              activeTab === 'ot' ? (
                <div className="relative group animate-in fade-in slide-in-from-bottom-4 duration-700">
                  <div className="absolute -inset-1 bg-linear-to-r from-blue-500/10 to-transparent rounded-4xl blur-xl opacity-0 group-hover:opacity-100 transition duration-1000" />
                  <div className="relative overflow-hidden rounded-[2.5rem] border border-white/20 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl shadow-2xl shadow-slate-200/50 dark:shadow-none">
                    <div className="hidden md:block overflow-x-auto scrollbar-hide">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200/60 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/50">
                            {showEmployeeCol && <th scope="col" className="px-8 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 whitespace-nowrap">Employee</th>}
                            {showDivision && <th scope="col" className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 whitespace-nowrap">Division</th>}
                            {showDepartment && <th scope="col" className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 whitespace-nowrap">Department</th>}
                            <th scope="col" className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 whitespace-nowrap">Date</th>
                            <th scope="col" className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 whitespace-nowrap">Shift</th>
                            <th scope="col" className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 text-center whitespace-nowrap">In Time</th>
                            <th scope="col" className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 text-center whitespace-nowrap">Out Time</th>
                            <th scope="col" className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 text-center whitespace-nowrap">Hours</th>
                            <th scope="col" className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 text-center whitespace-nowrap">Status</th>
                            <th scope="col" className="px-8 py-5 text-right text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 whitespace-nowrap">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {dataLoading ? (
                            [...Array(5)].map((_, i) => (
                              <tr key={i} className="animate-pulse">
                                {showEmployeeCol && (
                                  <td className="px-8 py-4">
                                    <div className="flex items-center gap-4">
                                      <div className="h-10 w-10 rounded-2xl bg-slate-200 dark:bg-slate-700" />
                                      <div className="space-y-1.5">
                                        <div className="h-3 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
                                        <div className="h-2 w-16 bg-slate-200 dark:bg-slate-700 rounded" />
                                      </div>
                                    </div>
                                  </td>
                                )}
                                {showDivision && <td className="px-6 py-4"><div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded" /></td>}
                                {showDepartment && <td className="px-6 py-4"><div className="h-4 w-28 bg-slate-200 dark:bg-slate-700 rounded" /></td>}
                                <td className="px-6 py-4"><div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded" /></td>
                                <td className="px-6 py-4"><div className="h-4 w-20 bg-slate-200 dark:bg-slate-700 rounded" /></td>
                                <td className="px-6 py-4"><div className="h-4 w-12 bg-slate-200 dark:bg-slate-700 rounded mx-auto" /></td>
                                <td className="px-6 py-4"><div className="h-4 w-12 bg-slate-200 dark:bg-slate-700 rounded mx-auto" /></td>
                                <td className="px-6 py-4"><div className="h-4 w-10 bg-slate-200 dark:bg-slate-700 rounded mx-auto" /></td>
                                <td className="px-6 py-4"><div className="h-6 w-20 bg-slate-200 dark:bg-slate-700 rounded-lg mx-auto" /></td>
                                <td className="px-8 py-4"><div className="h-8 w-16 bg-slate-200 dark:bg-slate-700 rounded-lg ml-auto" /></td>
                              </tr>
                            ))
                          ) : otRequests.length === 0 ? (
                            <tr>
                              <td colSpan={10} className="px-8 py-20 text-center">
                                <div className="flex flex-col items-center gap-3">
                                  <div className="w-16 h-16 rounded-3xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center">
                                    <Clock className="w-8 h-8 text-slate-300" />
                                  </div>
                                  <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">No OT requests found</p>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            otRequests.map((ot) => (
                              <tr key={ot._id} className="group/row hover:bg-blue-50/30 dark:hover:bg-blue-500/5 transition-colors duration-300">
                                {showEmployeeCol && (
                                  <td className="px-8 py-4">
                                    <div className="flex items-center gap-4">
                                      <div className="h-10 w-10 min-w-10 rounded-2xl bg-linear-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-black text-xs shadow-lg shadow-blue-500/20">
                                        {getEmployeeInitials({ employee_name: ot.employeeId?.employee_name || '', first_name: '', last_name: '', emp_no: '' } as any)}
                                      </div>
                                      <div className="min-w-0">
                                        <div className="font-bold text-slate-900 dark:text-white text-sm truncate max-w-[180px]">
                                          {ot.employeeId?.employee_name || ot.employeeNumber}
                                        </div>
                                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-0.5">
                                          {ot.employeeNumber}
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                )}
                                {showDivision && <td className="px-6 py-4 text-xs font-bold text-slate-600 dark:text-slate-400 whitespace-nowrap">{ot.employeeId?.department?.division?.name || '-'}</td>}
                                {showDepartment && <td className="px-6 py-4 text-xs font-bold text-slate-600 dark:text-slate-400 whitespace-nowrap">{ot.employeeId?.department?.name || '-'}</td>}
                                <td className="px-6 py-4 whitespace-nowrap text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">{formatDate(ot.date)}</td>
                                <td className="px-6 py-4 text-xs font-bold text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                  {ot.shiftId?.name || '-'}
                                </td>
                                <td className="px-6 py-4 text-center text-xs font-bold text-slate-900 dark:text-white whitespace-nowrap">{formatTime(ot.otInTime)}</td>
                                <td className="px-6 py-4 text-center text-xs font-bold text-slate-900 dark:text-white whitespace-nowrap">{formatTime(ot.otOutTime)}</td>
                                <td className="px-6 py-4 text-center">
                                  <span className="px-3 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-black text-xs whitespace-nowrap">
                                    {ot.otHours}h
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <span className={`inline-flex items-center px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm whitespace-nowrap ${ot.status === 'approved' ? 'bg-emerald-500 text-white shadow-emerald-500/20' :
                                    ot.status === 'rejected' ? 'bg-rose-500 text-white shadow-rose-500/20' :
                                      'bg-amber-500 text-white shadow-amber-500/20'
                                    }`}>
                                    {ot.status}
                                  </span>
                                </td>
                                <td className="px-8 py-4 text-right">
                                  <div className="flex items-center justify-end gap-2 transition-opacity">
                                    {canPerformAction(ot) && (
                                      <>
                                        <button
                                          onClick={() => handleApprove('ot', ot._id)}
                                          className="h-9 px-4 rounded-xl bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500 hover:text-white text-[10px] font-black uppercase tracking-widest transition-all shadow-sm"
                                        >
                                          Approve
                                        </button>
                                        <button
                                          onClick={() => handleReject('ot', ot._id)}
                                          className="h-9 px-4 rounded-xl bg-rose-500/10 text-rose-600 hover:bg-rose-500 hover:text-white text-[10px] font-black uppercase tracking-widest transition-all shadow-sm"
                                        >
                                          Reject
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Card View for OT */}
                    <div className="md:hidden space-y-4 p-4">
                      {dataLoading ? (
                        [...Array(3)].map((_, i) => (
                          <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm animate-pulse">
                            <div className="flex justify-between items-start mb-3">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-700"></div>
                                <div className="space-y-2">
                                  <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded"></div>
                                  <div className="h-3 w-20 bg-slate-200 dark:bg-slate-700 rounded"></div>
                                </div>
                              </div>
                              <div className="h-6 w-20 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
                            </div>
                            <div className="h-16 bg-slate-50 dark:bg-slate-800 rounded-xl"></div>
                          </div>
                        ))
                      ) : otRequests.length === 0 ? (
                        <div className="text-center py-10 text-slate-500 text-sm italic">
                          No OT requests found
                        </div>
                      ) : (
                        otRequests.map((ot) => (
                          <div
                            key={ot._id}
                            className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm active:scale-[0.98] transition-all"
                          >
                            <div className="flex justify-between items-start mb-3">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-700 dark:text-blue-400 font-bold text-xs shrink-0">
                                  {getEmployeeInitials({ employee_name: ot.employeeId?.employee_name || '', first_name: '', last_name: '', emp_no: '' } as any)}
                                </div>
                                <div>
                                  <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                                    {ot.employeeId?.employee_name || ot.employeeNumber}
                                  </h4>
                                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                    {ot.employeeNumber}
                                  </p>
                                </div>
                              </div>
                              <span className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-widest ${ot.status === 'approved' ? 'bg-emerald-500/10 text-emerald-600' :
                                ot.status === 'rejected' ? 'bg-rose-500/10 text-rose-600' :
                                  'bg-amber-500/10 text-amber-600'
                                }`}>
                                {ot.status}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-3 text-sm text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl mb-3">
                              <div className="flex flex-col">
                                <span className="text-[10px] uppercase font-bold text-slate-400">Date</span>
                                <span className="font-semibold text-slate-900 dark:text-white">{formatDate(ot.date)}</span>
                              </div>
                              <div className="flex flex-col">
                                <span className="text-[10px] uppercase font-bold text-slate-400">Hours</span>
                                <span className="font-semibold text-blue-600 dark:text-blue-400">{ot.otHours}h</span>
                              </div>
                              <div className="col-span-2 border-t border-slate-200 dark:border-slate-700 pt-2 flex justify-between items-center">
                                <span className="text-[10px] uppercase font-bold text-slate-400">Time</span>
                                <span className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                                  {formatTime(ot.otInTime)} <ChevronRight className="w-3 h-3 text-slate-400" /> {formatTime(ot.otOutTime)}
                                </span>
                              </div>
                            </div>

                            {canPerformAction(ot) && (
                              <div className="flex gap-2 mt-3">
                                <button
                                  onClick={() => handleApprove('ot', ot._id)}
                                  className="flex-1 h-9 rounded-lg bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500 hover:text-white text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                                >
                                  <Check className="h-3.5 w-3.5" /> Approve
                                </button>
                                <button
                                  onClick={() => handleReject('ot', ot._id)}
                                  className="flex-1 h-9 rounded-lg bg-rose-500/10 text-rose-600 hover:bg-rose-500 hover:text-white text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                                >
                                  <X className="h-3.5 w-3.5" /> Reject
                                </button>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="relative group animate-in fade-in slide-in-from-bottom-4 duration-700">
                  <div className="absolute -inset-1 bg-linear-to-r from-emerald-500/10 to-transparent rounded-4xl blur-xl opacity-0 group-hover:opacity-100 transition duration-1000" />
                  <div className="relative overflow-hidden rounded-[2.5rem] border border-white/20 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl shadow-2xl shadow-slate-200/50 dark:shadow-none">
                    <div className="hidden md:block overflow-x-auto scrollbar-hide">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200/60 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/50">
                            {showEmployeeCol && <th scope="col" className="px-8 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 whitespace-nowrap">Employee</th>}
                            {showDivision && <th scope="col" className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 whitespace-nowrap">Division</th>}
                            {showDepartment && <th scope="col" className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 whitespace-nowrap">Department</th>}
                            <th scope="col" className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 whitespace-nowrap">Date</th>
                            <th scope="col" className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 text-center whitespace-nowrap">Time Range</th>
                            <th scope="col" className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 text-center whitespace-nowrap">Hours</th>
                            <th scope="col" className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 whitespace-nowrap">Purpose</th>
                            <th scope="col" className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 text-center whitespace-nowrap">Status</th>
                            <th scope="col" className="px-8 py-5 text-right text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 whitespace-nowrap">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {dataLoading ? (
                            [...Array(5)].map((_, i) => (
                              <tr key={i} className="animate-pulse">
                                {showEmployeeCol && (
                                  <td className="px-8 py-4">
                                    <div className="flex items-center gap-4">
                                      <div className="h-10 w-10 rounded-2xl bg-slate-200 dark:bg-slate-700" />
                                      <div className="space-y-1.5">
                                        <div className="h-3 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
                                        <div className="h-2 w-16 bg-slate-200 dark:bg-slate-700 rounded" />
                                      </div>
                                    </div>
                                  </td>
                                )}
                                {showDivision && <td className="px-6 py-4"><div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded" /></td>}
                                {showDepartment && <td className="px-6 py-4"><div className="h-4 w-28 bg-slate-200 dark:bg-slate-700 rounded" /></td>}
                                <td className="px-6 py-4"><div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded" /></td>
                                <td className="px-6 py-4"><div className="h-4 w-20 bg-slate-200 dark:bg-slate-700 rounded mx-auto" /></td>
                                <td className="px-6 py-4"><div className="h-4 w-12 bg-slate-200 dark:bg-slate-700 rounded mx-auto" /></td>
                                <td className="px-6 py-4"><div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded" /></td>
                                <td className="px-6 py-4"><div className="h-6 w-20 bg-slate-200 dark:bg-slate-700 rounded-lg mx-auto" /></td>
                                <td className="px-8 py-4"><div className="h-8 w-16 bg-slate-200 dark:bg-slate-700 rounded-lg ml-auto" /></td>
                              </tr>
                            ))
                          ) : permissions.length === 0 ? (
                            <tr>
                              <td colSpan={10} className="px-8 py-20 text-center">
                                <div className="flex flex-col items-center gap-3">
                                  <div className="w-16 h-16 rounded-3xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center">
                                    <Plus className="w-8 h-8 text-slate-300" />
                                  </div>
                                  <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">No permission requests found</p>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            permissions.map((perm) => (
                              <tr key={perm._id} className="group/row hover:bg-emerald-50/30 dark:hover:bg-emerald-500/5 transition-colors duration-300">
                                {showEmployeeCol && (
                                  <td className="px-8 py-4">
                                    <div className="flex items-center gap-4">
                                      <div className="h-10 w-10 min-w-10 rounded-2xl bg-linear-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white font-black text-xs shadow-lg shadow-emerald-500/20">
                                        {getEmployeeInitials({ employee_name: perm.employeeId?.employee_name || '', first_name: '', last_name: '', emp_no: '' } as any)}
                                      </div>
                                      <div className="min-w-0">
                                        <div className="font-bold text-slate-900 dark:text-white text-sm truncate max-w-[180px]">
                                          {perm.employeeId?.employee_name || perm.employeeNumber}
                                        </div>
                                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-0.5">
                                          {perm.employeeNumber}
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                )}
                                {showDivision && <td className="px-6 py-4 text-xs font-bold text-slate-600 dark:text-slate-400 whitespace-nowrap">{perm.employeeId?.department?.division?.name || '-'}</td>}
                                {showDepartment && <td className="px-6 py-4 text-xs font-bold text-slate-600 dark:text-slate-400 whitespace-nowrap">{perm.employeeId?.department?.name || '-'}</td>}
                                <td className="px-6 py-4 whitespace-nowrap text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">{formatDate(perm.date)}</td>
                                <td className="px-6 py-4 text-center text-xs font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                  <span className="px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 flex items-center gap-2">
                                    <Timer className="w-3 h-3" />
                                    {formatTime(perm.permissionStartTime)} - {formatTime(perm.permissionEndTime)}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <span className="px-3 py-1 rounded-lg bg-emerald-5 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-black text-xs whitespace-nowrap">
                                    {perm.permissionHours}h
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-xs font-bold text-slate-600 dark:text-slate-400 max-w-[150px] truncate" title={perm.purpose}>{perm.purpose}</td>
                                <td className="px-6 py-4 text-center">
                                  <span className={`inline-flex items-center px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm whitespace-nowrap ${perm.status === 'approved' ? 'bg-emerald-500 text-white shadow-emerald-500/20' :
                                    perm.status === 'rejected' ? 'bg-rose-500 text-white shadow-rose-500/20' :
                                      perm.status === 'checked_out' ? 'bg-blue-500 text-white shadow-blue-500/20' :
                                        perm.status === 'checked_in' ? 'bg-emerald-500 text-white shadow-emerald-500/20' :
                                          'bg-amber-500 text-white shadow-amber-500/20'
                                    }`}>
                                    {perm.status.replace(/_/g, ' ')}
                                  </span>
                                </td>
                                <td className="px-8 py-4 text-right">
                                  <div className="flex items-center justify-end gap-2 transition-opacity">
                                    {canPerformAction(perm) && (
                                      <>
                                        <button
                                          onClick={() => handleApprove('permission', perm._id)}
                                          className="h-9 px-4 rounded-xl bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500 hover:text-white text-[10px] font-black uppercase tracking-widest transition-all shadow-sm"
                                        >
                                          Approve
                                        </button>
                                        <button
                                          onClick={() => handleReject('permission', perm._id)}
                                          className="h-9 px-4 rounded-xl bg-rose-500/10 text-rose-600 hover:bg-rose-500 hover:text-white text-[10px] font-black uppercase tracking-widest transition-all shadow-sm"
                                        >
                                          Reject
                                        </button>
                                      </>
                                    )}
                                    {['approved', 'checked_out', 'checked_in'].includes(perm.status) && perm.qrCode && (
                                      <button
                                        onClick={() => {
                                          setSelectedQR(perm);
                                          setShowQRDialog(true);
                                        }}
                                        className="h-9 px-4 rounded-xl bg-blue-500/10 text-blue-600 hover:bg-blue-500 hover:text-white text-[10px] font-black uppercase tracking-widest transition-all shadow-sm flex items-center gap-2"
                                      >
                                        <QrCode className="w-3.5 h-3.5" />
                                        Gate Pass
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Card View for Permissions */}
                    <div className="md:hidden space-y-4 p-4">
                      {dataLoading ? (
                        [...Array(3)].map((_, i) => (
                          <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm animate-pulse">
                            <div className="flex justify-between items-start mb-3">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-700"></div>
                                <div className="space-y-2">
                                  <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded"></div>
                                  <div className="h-3 w-20 bg-slate-200 dark:bg-slate-700 rounded"></div>
                                </div>
                              </div>
                              <div className="h-6 w-20 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
                            </div>
                            <div className="h-16 bg-slate-50 dark:bg-slate-800 rounded-xl"></div>
                          </div>
                        ))
                      ) : permissions.length === 0 ? (
                        <div className="text-center py-10 text-slate-500 text-sm italic">
                          No permission requests found
                        </div>
                      ) : (
                        permissions.map((perm) => (
                          <div
                            key={perm._id}
                            className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm active:scale-[0.98] transition-all"
                          >
                            <div className="flex justify-between items-start mb-3">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-700 dark:text-emerald-400 font-bold text-xs shrink-0">
                                  {getEmployeeInitials({ employee_name: perm.employeeId?.employee_name || '', first_name: '', last_name: '', emp_no: '' } as any)}
                                </div>
                                <div>
                                  <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                                    {perm.employeeId?.employee_name || perm.employeeNumber}
                                  </h4>
                                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                    {perm.employeeNumber}
                                  </p>
                                </div>
                              </div>
                              <span className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-widest ${perm.status === 'approved' ? 'bg-emerald-500/10 text-emerald-600' :
                                perm.status === 'rejected' ? 'bg-rose-500/10 text-rose-600' :
                                  'bg-amber-500/10 text-amber-600'
                                }`}>
                                {perm.status.replace(/_/g, ' ')}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-3 text-sm text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl mb-3">
                              <div className="flex flex-col">
                                <span className="text-[10px] uppercase font-bold text-slate-400">Date</span>
                                <span className="font-semibold text-slate-900 dark:text-white">{formatDate(perm.date)}</span>
                              </div>
                              <div className="flex flex-col">
                                <span className="text-[10px] uppercase font-bold text-slate-400">Hours</span>
                                <span className="font-semibold text-emerald-600 dark:text-emerald-400">{perm.permissionHours}h</span>
                              </div>
                              <div className="col-span-2 border-t border-slate-200 dark:border-slate-700 pt-2 flex justify-between items-center">
                                <span className="text-[10px] uppercase font-bold text-slate-400">Time</span>
                                <span className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                                  {formatTime(perm.permissionStartTime)} <ChevronRight className="w-3 h-3 text-slate-400" /> {formatTime(perm.permissionEndTime)}
                                </span>
                              </div>
                              {perm.purpose && (
                                <div className="col-span-2 border-t border-slate-200 dark:border-slate-700 pt-2">
                                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Purpose</span>
                                  <p className="text-xs italic text-slate-600 dark:text-slate-400 truncate">{perm.purpose}</p>
                                </div>
                              )}
                            </div>

                            <div className="flex gap-2 mt-3">
                              {canPerformAction(perm) && (
                                <>
                                  <button
                                    onClick={() => handleApprove('permission', perm._id)}
                                    className="flex-1 h-9 rounded-lg bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500 hover:text-white text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                                  >
                                    <Check className="h-3.5 w-3.5" /> Approve
                                  </button>
                                  <button
                                    onClick={() => handleReject('permission', perm._id)}
                                    className="flex-1 h-9 rounded-lg bg-rose-500/10 text-rose-600 hover:bg-rose-500 hover:text-white text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                                  >
                                    <X className="h-3.5 w-3.5" /> Reject
                                  </button>
                                </>
                              )}
                              {['approved', 'checked_out', 'checked_in'].includes(perm.status) && perm.qrCode && (
                                <button
                                  onClick={() => {
                                    setSelectedQR(perm);
                                    setShowQRDialog(true);
                                  }}
                                  className="flex-1 h-9 rounded-lg bg-blue-500/10 text-blue-600 hover:bg-blue-500 hover:text-white text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                                >
                                  <QrCode className="w-3.5 h-3.5" /> Gate Pass
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )
            )
          }

          {/* OT Dialog */}
          {
            showOTDialog && (
              <Portal>
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                  <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setShowOTDialog(false)} />
                  <div className="relative z-50 w-full max-w-lg overflow-hidden rounded-[2.5rem] border border-white/20 bg-white dark:bg-slate-900 shadow-2xl animate-in zoom-in-95 duration-300 flex flex-col max-h-[90vh]">
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 sm:p-8 border-b border-slate-100 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md">
                      <div className="flex items-center gap-3 sm:gap-4">
                        <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-2xl bg-blue-500/10 flex items-center justify-center">
                          <Timer className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                          <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Apply Overtime</h2>
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-500">Workspace Request</p>
                        </div>
                      </div>
                      <button
                        onClick={() => { setShowOTDialog(false); resetOTForm(); }}
                        className="h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-all active:scale-95"
                      >
                        <X className="h-4 w-4 sm:h-5 sm:w-5" />
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-4 sm:space-y-6">
                      {validationError && (
                        <div className="flex gap-3 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 animate-in slide-in-from-top-2 duration-300">
                          <XCircle className="w-5 h-5 shrink-0" />
                          <p className="text-xs font-bold leading-relaxed">{validationError}</p>
                        </div>
                      )}

                      {!isEmployee && (
                        <div className="space-y-2">
                          <label className="text-[10px] font-black underline decoration-blue-500/30 underline-offset-4 uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400 ml-1">
                            Select Employee <span className="text-rose-500">*</span>
                          </label>
                          <select
                            value={otFormData.employeeId}
                            onChange={(e) => {
                              const employee = employees.find(emp => (emp._id === e.target.value) || (emp.emp_no === e.target.value));
                              if (employee && employee.emp_no) {
                                setOTFormData(prev => ({ ...prev, employeeId: employee._id || employee.emp_no, employeeNumber: employee.emp_no }));
                                handleEmployeeSelect(employee._id || employee.emp_no, employee.emp_no, otFormData.date);
                              }
                            }}
                            className="w-full h-10 sm:h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all dark:text-white appearance-none cursor-pointer"
                          >
                            <option value="">Choose an employee...</option>
                            {employees.map((emp, i) => (
                              <option key={`ot-emp-${i}`} value={emp._id || emp.emp_no}>
                                {emp.emp_no} - {emp.employee_name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="space-y-2">
                        <label className="text-[10px] font-black underline decoration-blue-500/30 underline-offset-4 uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400 ml-1">
                          Select Date <span className="text-rose-500">*</span>
                        </label>
                        <div className="relative group">
                          <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                          <input
                            type="date"
                            min={new Date().toISOString().split('T')[0]}
                            value={otFormData.date}
                            onChange={(e) => {
                              setOTFormData(prev => ({ ...prev, date: e.target.value }));
                              if (otFormData.employeeId) handleEmployeeSelect(otFormData.employeeId, otFormData.employeeNumber, e.target.value);
                            }}
                            className="w-full h-10 sm:h-12 pl-12 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all dark:text-white cursor-pointer"
                          />
                        </div>
                      </div>

                      {attendanceLoading ? (
                        <div className="flex items-center gap-3 p-4 rounded-2xl bg-blue-500/5 border border-blue-500/10">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                          <p className="text-xs font-bold text-blue-600/70">Syncing attendance data...</p>
                        </div>
                      ) : (attendanceData || confusedShift) && (
                        <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-4">
                          <div className="flex items-center gap-2 flex-wrap text-slate-900 dark:text-white uppercase tracking-wider mb-2">
                            <Activity className="w-4 h-4 text-blue-500" />
                            Attendance Info
                          </div>

                          {attendanceData && (
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-1">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">In Time</p>
                                <p className="text-xs font-bold text-slate-900 dark:text-white">{formatTime(attendanceData.shifts && attendanceData.shifts.length > 0 ? attendanceData.shifts[0].inTime : null)}</p>
                              </div>
                              <div className="space-y-1">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Out Time</p>
                                <p className="text-xs font-bold text-slate-900 dark:text-white">{formatTime(attendanceData.shifts && attendanceData.shifts.length > 0 ? attendanceData.shifts[0].outTime : null)}</p>
                              </div>
                            </div>
                          )}

                          {confusedShift && (
                            <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                              <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest leading-relaxed">
                                MULTIPLE SHIFTS DETECTED. PLEASE SELECT:
                              </p>
                              <select
                                value={otFormData.manuallySelectedShiftId}
                                onChange={(e) => {
                                  const sid = e.target.value;
                                  setOTFormData(prev => ({ ...prev, manuallySelectedShiftId: sid }));
                                  const s = confusedShift.possibleShifts.find(ps => ps.shiftId === sid);
                                  if (s) {
                                    setSelectedShift({ _id: s.shiftId, name: s.shiftName, startTime: s.startTime, endTime: s.endTime, duration: 0 });
                                    if (s.endTime) {
                                      const out = new Date(otFormData.date);
                                      const [h, m] = s.endTime.split(':').map(Number);
                                      out.setHours(h + 1, m, 0, 0);
                                      setOTFormData(prev => ({ ...prev, otOutTime: out.toISOString().slice(0, 16) }));
                                    }
                                  }
                                }}
                                className="w-full h-10 px-3 rounded-lg border border-amber-500/30 bg-white dark:bg-slate-900 text-xs font-bold focus:ring-4 focus:ring-amber-500/10 outline-none transition-all dark:text-white cursor-pointer"
                              >
                                <option value="">Pick Shift...</option>
                                {confusedShift.possibleShifts.map((s, idx) => (
                                  <option key={idx} value={s.shiftId}>{s.shiftName} ({s.startTime}-{s.endTime})</option>
                                ))}
                              </select>
                            </div>
                          )}

                          {(selectedShift || (confusedShift && otFormData.manuallySelectedShiftId)) && (
                            <div className="px-3 py-2 rounded-xl bg-blue-500/5 border border-blue-500/10">
                              <p className="text-[9px] font-black text-blue-500 uppercase tracking-widest mb-1">Proposed OT Start (Shift End)</p>
                              <p className="text-sm font-black text-blue-600 dark:text-blue-400">
                                {selectedShift?.endTime || confusedShift?.possibleShifts.find(s => s.shiftId === otFormData.manuallySelectedShiftId)?.endTime}
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {!attendanceLoading && !attendanceData && otFormData.employeeId && otFormData.date && (
                        <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/10 flex gap-3 text-amber-600 dark:text-amber-400">
                          <AlertCircle className="w-5 h-5 shrink-0" />
                          <p className="text-[10px] font-bold leading-relaxed uppercase tracking-wider">No attendance record for this date.</p>
                        </div>
                      )}

                      <div className="space-y-2">
                        <label className="text-[10px] font-black underline decoration-blue-500/30 underline-offset-4 uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400 ml-1">
                          OT End Date & Time <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="datetime-local"
                          value={otFormData.otOutTime}
                          onChange={(e) => setOTFormData(prev => ({ ...prev, otOutTime: e.target.value }))}
                          className="w-full h-10 sm:h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all dark:text-white cursor-pointer"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-black underline decoration-blue-500/30 underline-offset-4 uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400 ml-1">
                          Comments
                        </label>
                        <textarea
                          placeholder="Add any specific details here..."
                          value={otFormData.comments}
                          onChange={(e) => setOTFormData(prev => ({ ...prev, comments: e.target.value }))}
                          className="w-full p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all dark:text-white min-h-[100px] resize-none"
                        />
                      </div>

                      <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                        <LocationPhotoCapture
                          label="Submission Proof"
                          onCapture={(loc, photo) => {
                            setEvidenceFile(photo.file);
                            setLocationData(loc);
                            (photo.file as any).exifLocation = photo.exifLocation;
                          }}
                          onClear={() => { setEvidenceFile(null); setLocationData(null); }}
                        />
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="sticky bottom-0 z-10 p-4 sm:p-8 border-t border-slate-100 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md flex items-center justify-end gap-3">
                      <button
                        onClick={() => { setShowOTDialog(false); resetOTForm(); }}
                        className="h-10 sm:h-12 px-4 sm:px-6 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 dark:hover:text-white transition-all"
                      >
                        Dismiss
                      </button>
                      <button
                        onClick={handleCreateOT}
                        disabled={dataLoading}
                        className="h-10 sm:h-12 px-5 sm:px-8 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[10px] font-black uppercase tracking-widest shadow-xl shadow-slate-900/10 dark:shadow-white/10 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                      >
                        {dataLoading ? 'Processing...' : 'Submit Request'}
                      </button>
                    </div>
                  </div>
                </div>
              </Portal>
            )
          }


          {/* Permission Dialog */}
          {
            showPermissionDialog && (
              <Portal>
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                  <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setShowPermissionDialog(false)} />
                  <div className="relative z-50 w-full max-w-lg overflow-hidden rounded-[2.5rem] border border-white/20 bg-white dark:bg-slate-900 shadow-2xl animate-in zoom-in-95 duration-300 flex flex-col max-h-[90vh]">
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 sm:p-8 border-b border-slate-100 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md">
                      <div className="flex items-center gap-3 sm:gap-4">
                        <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                          <Zap className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div>
                          <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Apply Permission</h2>
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-500">Short Duration Break</p>
                        </div>
                      </div>
                      <button
                        onClick={() => { setShowPermissionDialog(false); resetPermissionForm(); }}
                        className="h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-all active:scale-95"
                      >
                        <X className="h-4 w-4 sm:h-5 sm:w-5" />
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-4 sm:space-y-6">
                      {permissionValidationError && (
                        <div className="flex gap-3 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 animate-in slide-in-from-top-2 duration-300">
                          <XCircle className="w-5 h-5 shrink-0" />
                          <p className="text-xs font-bold leading-relaxed">{permissionValidationError}</p>
                        </div>
                      )}

                      {!isEmployee && (
                        <div className="space-y-2">
                          <label className="text-[10px] font-black underline decoration-emerald-500/30 underline-offset-4 uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400 ml-1">
                            Employee No <span className="text-rose-500">*</span>
                          </label>
                          <select
                            value={permissionFormData.employeeId}
                            onChange={async (e) => {
                              const val = e.target.value;
                              if (!val) {
                                setPermissionFormData(prev => ({ ...prev, employeeId: '', employeeNumber: '' }));
                                setPermissionValidationError('');
                                return;
                              }
                              const emp = employees.find(e => (e._id === val) || (e.emp_no === val));
                              if (emp && emp.emp_no) {
                                setPermissionFormData(prev => ({ ...prev, employeeId: emp._id || emp.emp_no, employeeNumber: emp.emp_no }));
                                setPermissionValidationError('');
                                if (permissionFormData.date) {
                                  try {
                                    const res = await api.getAttendanceDetail(emp.emp_no, permissionFormData.date);
                                    if (!res.success || !res.data || !res.data.shifts || res.data.shifts.length === 0 || !res.data.shifts[0].inTime) setPermissionValidationError('No active attendance for this date.');
                                  } catch (err) { console.error(err); }
                                }
                              }
                            }}
                            className="w-full h-10 sm:h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none transition-all dark:text-white appearance-none cursor-pointer"
                          >
                            <option value="">Choose employee...</option>
                            {employees.map((emp, i) => (
                              <option key={`p-emp-${i}`} value={emp._id || emp.emp_no}>{emp.emp_no} - {emp.employee_name}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="space-y-2">
                        <label className="text-[10px] font-black underline decoration-emerald-500/30 underline-offset-4 uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400 ml-1">
                          Application Date <span className="text-rose-500">*</span>
                        </label>
                        <div className="relative group">
                          <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-emerald-500 transition-colors" />
                          <input
                            type="date"
                            min={new Date().toISOString().split('T')[0]}
                            value={permissionFormData.date}
                            onChange={async (e) => {
                              const d = e.target.value;
                              setPermissionFormData(prev => ({ ...prev, date: d }));
                              if (permissionFormData.employeeNumber && d) {
                                try {
                                  const res = await api.getAttendanceDetail(permissionFormData.employeeNumber, d);
                                  if (!res.success || !res.data || !res.data.shifts || res.data.shifts.length === 0 || !res.data.shifts[0].inTime) setPermissionValidationError('No active attendance for this date.');
                                  else setPermissionValidationError('');
                                } catch (err) { console.error(err); }
                              }
                            }}
                            className="w-full h-10 sm:h-12 pl-12 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none transition-all dark:text-white cursor-pointer"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Start Time <span className="text-rose-500">*</span></label>
                          <input
                            type="datetime-local"
                            value={permissionFormData.permissionStartTime}
                            onChange={(e) => setPermissionFormData(prev => ({ ...prev, permissionStartTime: e.target.value }))}
                            className="w-full h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold focus:ring-4 focus:ring-emerald-500/10 outline-none transition-all dark:text-white cursor-pointer"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">End Time <span className="text-rose-500">*</span></label>
                          <input
                            type="datetime-local"
                            value={permissionFormData.permissionEndTime}
                            onChange={(e) => setPermissionFormData(prev => ({ ...prev, permissionEndTime: e.target.value }))}
                            className="w-full h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold focus:ring-4 focus:ring-emerald-500/10 outline-none transition-all dark:text-white cursor-pointer"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-black underline decoration-emerald-500/30 underline-offset-4 uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400 ml-1">
                          Purpose of Break <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          placeholder="e.g., Personal errand, Medical..."
                          value={permissionFormData.purpose}
                          onChange={(e) => setPermissionFormData(prev => ({ ...prev, purpose: e.target.value }))}
                          className="w-full h-10 sm:h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none transition-all dark:text-white"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Comments</label>
                        <textarea
                          value={permissionFormData.comments}
                          onChange={(e) => setPermissionFormData(prev => ({ ...prev, comments: e.target.value }))}
                          className="w-full p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none transition-all dark:text-white min-h-[80px] resize-none"
                        />
                      </div>

                      <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                        <LocationPhotoCapture
                          label="Check-in Photo (Required)"
                          onCapture={(loc, photo) => {
                            setEvidenceFile(photo.file);
                            setLocationData(loc);
                            (photo.file as any).exifLocation = photo.exifLocation;
                          }}
                          onClear={() => { setEvidenceFile(null); setLocationData(null); }}
                        />
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="sticky bottom-0 z-10 p-4 sm:p-8 border-t border-slate-100 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md flex items-center justify-end gap-3">
                      <button
                        onClick={() => { setShowPermissionDialog(false); resetPermissionForm(); }}
                        className="h-10 sm:h-12 px-4 sm:px-6 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 dark:hover:text-white transition-all"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleCreatePermission}
                        disabled={dataLoading}
                        className="h-10 sm:h-12 px-5 sm:px-8 rounded-2xl bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest shadow-xl shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                      >
                        {dataLoading ? 'Processing...' : 'Request Permission'}
                      </button>
                    </div>
                  </div>
                </div>
              </Portal>
            )
          }

          {/* QR Code Dialog */}
          {
            showQRDialog && selectedQR && (
              <Portal>
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                  <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-300" onClick={() => { setShowQRDialog(false); setSelectedQR(null); }} />
                  <div className="relative z-50 w-full max-w-2xl rounded-[2.5rem] overflow-hidden bg-white dark:bg-slate-900 border border-white/20 shadow-2xl animate-in zoom-in-95 duration-300 flex flex-col">
                    {/* Header */}
                    <div className="flex flex-col items-center p-6 sm:p-8 text-center bg-gradient-to-b from-blue-500/5 to-transparent border-b border-slate-100 dark:border-slate-800">
                      <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mb-4">
                        <QrCode className="w-8 h-8 text-blue-500" />
                      </div>
                      <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Gate Pass</h2>
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-500 mt-1">Permission Active</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2">
                      {/* Left Column: Employee Info and Timeline */}
                      <div className="p-6 sm:p-8 border-b md:border-b-0 md:border-r border-slate-100 dark:border-slate-800 flex flex-col space-y-8">
                        {/* Employee Info */}
                        <div className="w-full p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 text-left">
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Employee Info</p>
                          <p className="text-sm font-bold text-slate-900 dark:text-white line-clamp-1">{selectedQR.employeeId?.employee_name}</p>
                          <p className="text-[10px] font-bold text-slate-500 mt-2">{formatDate(selectedQR.date)}</p>
                        </div>

                        {/* Timeline */}
                        <div className="relative border-l-2 border-slate-200 dark:border-slate-700 ml-2 space-y-8 pb-4">
                          {/* Gate Out Step */}
                          <div className="relative pl-6">
                            <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-4 border-white dark:border-slate-900 ${(selectedQR as any).gateOutTime ? 'bg-emerald-500' : 'bg-orange-500'}`} />
                            <div className="flex items-center justify-between mb-2">
                              <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-widest">
                                Gate Out
                              </h3>
                              {/* Status Badge */}
                              {(selectedQR as any).gateOutTime ? (
                                <span className="px-2 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase tracking-widest rounded-lg flex items-center gap-1">
                                  <Check className="w-3 h-3" /> Verified {formatTime((selectedQR as any).gateOutTime)}
                                </span>
                              ) : (
                                <span className="px-2 py-1 bg-orange-500/10 text-orange-600 dark:text-orange-400 text-[10px] font-black uppercase tracking-widest rounded-lg">
                                  Pending
                                </span>
                              )}
                            </div>

                            {!(selectedQR as any).gateOutTime && (
                              <div className="mt-4 p-4 rounded-2xl bg-white border border-slate-100 dark:border-slate-800 dark:bg-slate-900 shadow-sm flex flex-col items-center gap-4">
                                {(selectedQR as any).gateOutSecret || (selectedQR.qrCode && selectedQR.qrCode.startsWith('OUT:')) ? (
                                  <>
                                    <div className="relative p-2 rounded-xl bg-white border-4 border-orange-500/20 shadow-xl shadow-orange-500/5">
                                      <QRCodeSVG value={(selectedQR as any).gateOutSecret || selectedQR.qrCode} size={160} level="H" includeMargin={true} />
                                    </div>
                                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                                      <Scan className="w-3 h-3 text-orange-500" /> Scan to Exit
                                    </div>
                                  </>
                                ) : (
                                  <div className="h-32 flex items-center text-xs text-slate-400 font-bold uppercase tracking-widest">Generating QR...</div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Gate In Step */}
                          <div className="relative pl-6">
                            <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-4 border-white dark:border-slate-900 ${(selectedQR as any).gateInTime ? 'bg-emerald-500' : (!(selectedQR as any).gateOutTime ? 'bg-slate-300 dark:bg-slate-700' : 'bg-blue-500')}`} />
                            <div className="flex items-center justify-between mb-2">
                              <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-widest">
                                Gate In
                              </h3>
                              {/* Status Badge */}
                              {(selectedQR as any).gateInTime ? (
                                <span className="px-2 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase tracking-widest rounded-lg flex items-center gap-1">
                                  <Check className="w-3 h-3" /> Verified {formatTime((selectedQR as any).gateInTime)}
                                </span>
                              ) : (!(selectedQR as any).gateOutTime ? (
                                <span className="px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-400 text-[10px] font-black uppercase tracking-widest rounded-lg">
                                  Awaiting Exit
                                </span>
                              ) : (
                                <span className="px-2 py-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-black uppercase tracking-widest rounded-lg">
                                  Pending
                                </span>
                              ))}
                            </div>

                            {/* Content for Gate In */}
                            {(selectedQR as any).gateOutTime && !(selectedQR as any).gateInTime && (
                              <div className="mt-4 p-4 rounded-2xl bg-white border border-slate-100 dark:border-slate-800 dark:bg-slate-900 shadow-sm flex flex-col items-center gap-4">
                                {(() => {
                                  const diff = (new Date().getTime() - new Date((selectedQR as any).gateOutTime).getTime()) / 60000;
                                  if (diff < 5) {
                                    return (
                                      <div className="w-full text-center space-y-2 py-4">
                                        <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                          <div className="h-full bg-blue-500 animate-[shimmer_2s_infinite]" style={{ width: `${(diff / 5) * 100}%` }} />
                                        </div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Entry QR unlocks in {Math.ceil(5 - diff)}m</p>
                                      </div>
                                    );
                                  }

                                  if ((selectedQR as any).gateInSecret || (selectedQR.qrCode && selectedQR.qrCode.startsWith('IN:'))) {
                                    return (
                                      <>
                                        <div className="relative p-2 rounded-xl bg-white border-4 border-emerald-500/20 shadow-xl shadow-emerald-500/5">
                                          <QRCodeSVG value={(selectedQR as any).gateInSecret || selectedQR.qrCode} size={160} level="H" includeMargin={true} />
                                        </div>
                                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                                          <Scan className="w-3 h-3 text-emerald-500" /> Scan to Enter
                                        </div>
                                      </>
                                    );
                                  }

                                  return (
                                    <div className="h-32 flex items-center text-xs text-slate-400 font-bold uppercase tracking-widest">Generating QR...</div>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right Column: Summary */}
                      <div className="p-6 sm:p-8 flex flex-col justify-center bg-slate-50/50 dark:bg-slate-900/50 relative">
                        {/* Trip Completed Global Message */}
                        {(selectedQR as any).gateOutTime && (selectedQR as any).gateInTime ? (
                          <div className="w-full p-6 rounded-3xl bg-emerald-500/5 border border-emerald-500/10 text-center animate-in zoom-in-95 duration-500">
                            <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-600 flex items-center justify-center mx-auto mb-3">
                              <Check className="w-6 h-6" />
                            </div>
                            <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Trip Completed</h3>
                            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.2em] mt-1 mb-4">Both passes verified</p>

                            <div className="grid grid-cols-2 gap-2 border-t border-emerald-500/10 pt-4 mt-2">
                              <div className="flex flex-col items-center border-r border-emerald-500/10">
                                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Requested</span>
                                <span className="text-sm font-black text-slate-900 dark:text-white">{selectedQR.permissionHours || (selectedQR as any).otHours} hrs</span>
                              </div>
                              <div className="flex flex-col items-center">
                                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Spent Time</span>
                                {(() => {
                                  const diffMs = new Date((selectedQR as any).gateInTime).getTime() - new Date((selectedQR as any).gateOutTime).getTime();
                                  const diffMins = Math.floor(diffMs / 60000);
                                  const hours = Math.floor(diffMins / 60);
                                  const mins = diffMins % 60;
                                  return (
                                    <span className={`text-sm font-black ${hours > (selectedQR.permissionHours || (selectedQR as any).otHours || 0) ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                      {hours > 0 ? `${hours}h ` : ''}{mins}m
                                    </span>
                                  );
                                })()}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-10">
                            <Scan className="w-32 h-32" />
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => { setShowQRDialog(false); setSelectedQR(null); }}
                      className="w-full h-16 border-t border-slate-100 dark:border-slate-800 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all font-bold"
                    >
                      Close Pass
                    </button>
                  </div>
                </div>
              </Portal>
            )
          }


          {/* Evidence Viewer Dialog */}
          {
            showEvidenceDialog && selectedEvidenceItem && (
              <Portal>
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                  <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setShowEvidenceDialog(false)} />
                  <div className="relative z-50 w-full max-w-2xl overflow-hidden rounded-[2.5rem] border border-white/20 bg-white dark:bg-slate-900 shadow-2xl animate-in zoom-in-95 duration-300 flex flex-col max-h-[90vh]">
                    {/* Header */}
                    <div className="flex items-center justify-between p-6 sm:p-8 border-b border-slate-100 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md">
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-2xl bg-blue-500/10 flex items-center justify-center">
                          <MapPin className="w-6 h-6 text-blue-500" />
                        </div>
                        <div className="min-w-0">
                          <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight truncate">Evidence View</h2>
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-500 truncate">
                            {selectedEvidenceItem.employeeName} • {formatDate(selectedEvidenceItem.date)}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => setShowEvidenceDialog(false)}
                        className="h-10 w-10 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-all active:scale-95"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Photo Section */}
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4">
                            <ImageIcon className="w-3.5 h-3.5" />
                            Visual Proof
                          </div>
                          {selectedEvidenceItem.photoEvidence ? (
                            <div className="group relative rounded-[2rem] overflow-hidden border-4 border-white dark:border-slate-800 shadow-2xl shadow-slate-200 dark:shadow-none transition-transform hover:scale-[1.02]">
                              <img
                                src={selectedEvidenceItem.photoEvidence.url}
                                alt="Site Evidence"
                                className="w-full h-auto object-cover aspect-[4/5]"
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          ) : (
                            <div className="aspect-[4/5] rounded-[2rem] bg-slate-100 dark:bg-slate-800 flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-700">
                              <ImageIcon className="w-12 h-12 mb-2 opacity-20" />
                              <p className="text-[10px] font-black uppercase tracking-widest">No Photo Provided</p>
                            </div>
                          )}
                        </div>

                        {/* Map/Location Section */}
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4">
                            <Map className="w-3.5 h-3.5" />
                            Geospatial Log
                          </div>
                          {selectedEvidenceItem.geoLocation ? (
                            <div className="space-y-6">
                              <div className="rounded-[2rem] overflow-hidden border-4 border-white dark:border-slate-800 shadow-2xl shadow-slate-200 dark:shadow-none h-[300px]">
                                <iframe
                                  width="100%"
                                  height="100%"
                                  style={{ border: 0 }}
                                  loading="lazy"
                                  allowFullScreen
                                  src={`https://www.google.com/maps/embed/v1/place?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&q=${selectedEvidenceItem.geoLocation.latitude},${selectedEvidenceItem.geoLocation.longitude}`}
                                />
                              </div>

                              <div className="p-5 rounded-2xl bg-blue-500/5 border border-blue-500/10 space-y-4">
                                <div className="flex items-start gap-4">
                                  <div className="h-10 w-10 shrink-0 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500">
                                    <Navigation className="w-5 h-5" />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-[10px] font-black underline decoration-blue-500/30 underline-offset-4 uppercase tracking-widest text-slate-400 mb-1">Precise Coordinates</p>
                                    <p className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate">
                                      {selectedEvidenceItem.geoLocation.latitude.toFixed(6)}, {selectedEvidenceItem.geoLocation.longitude.toFixed(6)}
                                    </p>
                                  </div>
                                </div>

                                <div className="flex items-start gap-4">
                                  <div className="h-10 w-10 shrink-0 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500">
                                    <Clock className="w-5 h-5" />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-[10px] font-black underline decoration-amber-500/30 underline-offset-4 uppercase tracking-widest text-slate-400 mb-1">Time Captured</p>
                                    <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                      {new Date(selectedEvidenceItem.geoLocation.capturedAt).toLocaleString()}
                                    </p>
                                  </div>
                                </div>

                                {selectedEvidenceItem.geoLocation.address && (
                                  <div className="flex items-start gap-4 pt-2 border-t border-slate-200 dark:border-slate-700">
                                    <div className="h-10 w-10 shrink-0 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                                      <MapPin className="w-5 h-5" />
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Resolved Address</p>
                                      <p className="text-[10px] font-bold text-slate-700 dark:text-slate-300 leading-relaxed italic">
                                        {selectedEvidenceItem.geoLocation.address}
                                      </p>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center min-h-20 border border-slate-200 dark:border-slate-700">
                              <Navigation className="w-12 h-12 mb-2 opacity-20" />
                              <p className="text-[10px] font-black uppercase tracking-widest">No Geo-Data Available</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="p-8 border-t border-slate-100 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md flex justify-end">
                      <button
                        onClick={() => setShowEvidenceDialog(false)}
                        className="h-12 px-8 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[10px] font-black uppercase tracking-widest shadow-xl shadow-slate-900/10 dark:shadow-white/10 transition-all hover:scale-[1.02] active:scale-[0.98]"
                      >
                        Acknowledge Evidence
                      </button>
                    </div>
                  </div>
                </div>
              </Portal>
            )
          }
        </main >
      </div >
    </div >
  );
}



