'use client';

import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { api, Division, Department, Designation } from '@/lib/api';
import { QRCodeSVG } from 'qrcode.react';
import { Check, QrCode, Scan } from 'lucide-react';
import LocationPhotoCapture from '@/components/LocationPhotoCapture';
import Spinner from '@/components/Spinner';
import EmployeeSelect from '@/components/EmployeeSelect';

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
  department?: { _id: string; name: string };
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
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: { name: string; email: string };
  approvedBy?: { name: string; email: string };
  rejectedBy?: { name: string; email: string };
  requestedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  comments?: string;
  photoEvidence?: {
    url: string;
    key: string;
    filename?: string;
    exifLocation?: {
      latitude: number;
      longitude: number;
    };
  };
  geoLocation?: {
    latitude: number;
    longitude: number;
    address?: string;
    capturedAt: string;
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
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: { name: string; email: string };
  approvedBy?: { name: string; email: string };
  rejectedBy?: { name: string; email: string };
  requestedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  qrCode?: string;
  gateOutSecret?: string;
  gateInSecret?: string;
  gateOutTime?: string;
  gateInTime?: string;
  outpassUrl?: string;
  comments?: string;
  photoEvidence?: {
    url: string;
    key: string;
    filename?: string;
    exifLocation?: {
      latitude: number;
      longitude: number;
    };
  };
  geoLocation?: {
    latitude: number;
    longitude: number;
    address?: string;
    capturedAt: string;
  };
}

export default function OTAndPermissionsPage() {
  const [activeTab, setActiveTab] = useState<'ot' | 'permissions'>('ot');
  const [loading, setLoading] = useState(false);
  const [otRequests, setOTRequests] = useState<OTRequest[]>([]);
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);

  // Filters
  const [otFilters, setOTFilters] = useState({ status: '', employeeNumber: '', startDate: '', endDate: '' });
  const [permissionFilters, setPermissionFilters] = useState({ status: '', employeeNumber: '', startDate: '', endDate: '' });

  // Dialogs
  const [showOTDialog, setShowOTDialog] = useState(false);
  const [showPermissionDialog, setShowPermissionDialog] = useState(false);
  const [showQRDialog, setShowQRDialog] = useState(false);
  const [selectedQR, setSelectedQR] = useState<PermissionRequest | null>(null);

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
    date: new Date().toISOString().split('T')[0],
    otOutTime: '',
    shiftId: '',
    manuallySelectedShiftId: '',
    comments: '',
  });

  const [permissionFormData, setPermissionFormData] = useState({
    employeeId: '',
    employeeNumber: '',
    date: new Date().toISOString().split('T')[0],
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

  // Photo Evidence & Location State (Shared for both dialogs since only one is open at a time)
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [locationData, setLocationData] = useState<{
    latitude: number;
    longitude: number;
    address?: string;
    capturedAt: Date;
  } | null>(null);

  // View Evidence State
  const [showEvidenceDialog, setShowEvidenceDialog] = useState(false);
  const [selectedEvidenceItem, setSelectedEvidenceItem] = useState<{
    type: 'ot' | 'permission';
    photoEvidence?: {
      url: string;
      key: string;
      filename?: string;
      exifLocation?: {
        latitude: number;
        longitude: number;
      };
    };
    geoLocation?: {
      latitude: number;
      longitude: number;
      address?: string;
      capturedAt: Date | string;
    };
    employeeName: string;
    date: string;
  } | null>(null);

  // Advanced Filters State
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [selectedDivision, setSelectedDivision] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedDesignation, setSelectedDesignation] = useState('');

  const loadFilterOptions = async () => {
    try {
      const [divRes, deptRes, desigRes] = await Promise.all([
        api.getDivisions(),
        api.getDepartments(),
        api.getAllDesignations(),
      ]);
      if (divRes.success) setDivisions(divRes.data || []);
      if (deptRes.success) setDepartments(deptRes.data as any[] || []);
      if (desigRes.success) setDesignations(desigRes.data || []);
    } catch (error) {
      console.error('Error loading filter options:', error);
    }
  };

  const filteredDepartmentsByDivision = useMemo(() => {
    if (!selectedDivision) return departments;
    const division = divisions.find(d => d._id === selectedDivision);
    if (!division || !division.departments) return departments;
    return departments.filter(dept =>
      (division.departments || []).some(d => (typeof d === 'string' ? d : (d as any)._id) === dept._id)
    );
  }, [selectedDivision, divisions, departments]);

  const applyAdvancedFilters = (item: OTRequest | PermissionRequest) => {
    const emp = item.employeeId as any;
    if (!emp) return true;

    if (selectedDivision) {
      const divId = typeof emp.division === 'object' ? emp.division._id : emp.division;
      if (divId !== selectedDivision) return false;
    }
    if (selectedDepartment) {
      const deptId = typeof emp.department === 'object' ? emp.department._id : emp.department;
      if (deptId !== selectedDepartment) return false;
    }
    if (selectedDesignation) {
      const desigId = typeof emp.designation === 'object' ? emp.designation._id : emp.designation;
      if (desigId !== selectedDesignation) return false;
    }

    return true;
  };

  useEffect(() => {
    loadData();
    loadFilterOptions();
  }, [activeTab, otFilters, permissionFilters]);

  // Auto-fetch attendance when OT dialog opens with employee and date
  useEffect(() => {
    if (showOTDialog && otFormData.employeeId && otFormData.employeeNumber && otFormData.date && !attendanceData && !attendanceLoading) {
      handleEmployeeSelect(otFormData.employeeId, otFormData.employeeNumber, otFormData.date);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOTDialog]);

  const handleGenerateGatePass = async (type: 'OUT' | 'IN') => {
    if (!selectedQR) return;

    setLoading(true);
    try {
      if (type === 'OUT') {
        const res = await api.generateGateOutQR(selectedQR._id);
        if (res.success) {
          setSelectedQR({ ...selectedQR, qrCode: res.qrSecret, gateOutSecret: res.qrSecret });
          showToast('Exit gate pass generated', 'success');
        } else {
          showToast(res.message || 'Error generating exit pass', 'error');
        }
      } else {
        const res = await api.generateGateInQR(selectedQR._id);
        if (res.success) {
          setSelectedQR({ ...selectedQR, qrCode: res.qrSecret, gateInSecret: res.qrSecret });
          showToast('Entry gate pass generated', 'success');
        } else {
          showToast(res.message || 'Error generating entry pass', 'error');
        }
      }
    } catch (error) {
      console.error(`Error generating ${type} pass:`, error);
      showToast(`Error generating ${type === 'OUT' ? 'exit' : 'entry'} pass`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Auto-generate Gate Pass when dialog opens
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    if (showQRDialog && selectedQR && !loading) {
      const qrCodeData = selectedQR as any; // Cast to access gate properties
      if (!qrCodeData.gateOutTime) {
        // Needs OUT pass
        if (!qrCodeData.qrCode || !qrCodeData.qrCode.startsWith('OUT:')) {
          // Add a small delay to avoid state updates during render
          timeoutId = setTimeout(() => {
            handleGenerateGatePass('OUT');
          }, 500);
        }
      } else if (!qrCodeData.gateInTime) {
        // Needs IN pass, check 5 min delay
        const now = new Date();
        const gateOutTime = new Date(qrCodeData.gateOutTime);
        const diffMs = now.getTime() - gateOutTime.getTime();
        const minutesPassed = diffMs / (1000 * 60);

        if (minutesPassed >= 5 && (!qrCodeData.qrCode || !qrCodeData.qrCode.startsWith('IN:'))) {
          timeoutId = setTimeout(() => {
            handleGenerateGatePass('IN');
          }, 500);
        }
      }
    }

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showQRDialog, selectedQR, loading]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'ot') {
        const otRes = await api.getOTRequests(otFilters);
        if (otRes.success) {
          setOTRequests(otRes.data || []);
        }
      } else {
        const permRes = await api.getPermissions(permissionFilters);
        if (permRes.success) {
          setPermissions(permRes.data || []);
        }
      }

      // Load employees and shifts
      const [employeesRes, shiftsRes] = await Promise.all([
        api.getEmployees({ is_active: true }),
        api.getShifts(),
      ]);

      if (employeesRes.success) {
        const employeesList = employeesRes.data || [];
        console.log('Loaded employees:', employeesList.length, employeesList);
        setEmployees(employeesList);
      } else {
        console.error('Failed to load employees:', employeesRes);
        showToast('Failed to load employees', 'error');
      }

      if (shiftsRes.success) {
        setShifts(shiftsRes.data || []);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
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
          if (attendance.shiftId) {
            const shiftId = typeof attendance.shiftId === 'string' ? attendance.shiftId : attendance.shiftId._id;
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
            } else {
              // Shift not found in shifts list, try to get from attendance data
              if (attendance.shiftId && typeof attendance.shiftId === 'object') {
                const shiftData = attendance.shiftId;
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
    if (!otFormData.employeeId || !otFormData.employeeNumber || !otFormData.date || !otFormData.otOutTime) {
      setValidationError('Please fill all required fields');
      showToast('Please fill all required fields', 'error');
      return;
    }

    if (!attendanceData || !attendanceData.inTime) {
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

    // Photo Evidence Check
    if (!evidenceFile) {
      const errorMsg = 'Photo evidence is required for OT requests';
      setValidationError(errorMsg);
      showToast(errorMsg, 'error');
      return;
    }

    setLoading(true);
    setValidationError('');
    try {
      // Upload Evidence
      let uploadedEvidence = undefined;
      let geoData = undefined;

      // Lazy Upload
      if (evidenceFile) {
        try {
          const uploadRes = await api.uploadEvidence(evidenceFile) as any;
          if (!uploadRes.success) throw new Error('Upload failed');

          uploadedEvidence = {
            url: uploadRes.url,
            key: uploadRes.key,
            filename: uploadRes.filename,
            exifLocation: (evidenceFile as any).exifLocation
          };

          if (locationData) {
            geoData = {
              latitude: locationData.latitude,
              longitude: locationData.longitude,
              address: locationData.address || '',
              capturedAt: locationData.capturedAt.toISOString()
            };
          }
        } catch (uploadError) {
          console.error('Evidence upload failed:', uploadError);
          showToast('Failed to upload photo evidence', 'error');
          setLoading(false);
          return;
        }
      }
      const res = await api.createOT({
        ...otFormData,
        photoEvidence: uploadedEvidence,
        geoLocation: geoData
      });
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
      setLoading(false);
    }
  };

  const handleCreatePermission = async () => {
    if (!permissionFormData.employeeId || !permissionFormData.employeeNumber || !permissionFormData.date ||
      !permissionFormData.permissionStartTime || !permissionFormData.permissionEndTime || !permissionFormData.purpose) {
      const errorMsg = 'Please fill all required fields';
      setPermissionValidationError(errorMsg);
      showToast(errorMsg, 'error');
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



    // Photo Evidence Check
    if (!evidenceFile) {
      const errorMsg = 'Photo evidence is required for Permission requests';
      setPermissionValidationError(errorMsg);
      showToast(errorMsg, 'error');
      return;
    }

    setLoading(true);
    setPermissionValidationError('');
    try {
      // Upload Evidence

      let uploadedEvidence = undefined;
      let geoData = undefined;

      // Lazy Upload
      if (evidenceFile) {
        try {
          const uploadRes = await api.uploadEvidence(evidenceFile) as any;
          if (!uploadRes.success) throw new Error('Upload failed');

          uploadedEvidence = {
            url: uploadRes.url,
            key: uploadRes.key,
            filename: uploadRes.filename,
            exifLocation: (evidenceFile as any).exifLocation
          };

          if (locationData) {
            geoData = {
              latitude: locationData.latitude,
              longitude: locationData.longitude,
              address: locationData.address || '',
              capturedAt: locationData.capturedAt.toISOString()
            };
          }
        } catch (uploadError) {
          console.error('Evidence upload failed:', uploadError);
          setPermissionValidationError('Failed to upload photo evidence');
          showToast('Failed to upload photo evidence', 'error');
          setLoading(false);
          return;
        }
      }
      const res = await api.createPermission({
        ...permissionFormData,
        photoEvidence: uploadedEvidence,
        geoLocation: geoData
      });
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
      setLoading(false);
    }
  };

  const handleApprove = async (type: 'ot' | 'permission', id: string) => {
    if (!window.confirm(`Are you sure you want to approve this ${type === 'ot' ? 'OT' : 'permission'} request?`)) {
      return;
    }

    setLoading(true);
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
      setLoading(false);
    }
  };

  const handleReject = async (type: 'ot' | 'permission', id: string) => {
    const reason = window.prompt(`Enter rejection reason for this ${type === 'ot' ? 'OT' : 'permission'} request:`);
    if (reason === null) return;

    setLoading(true);
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
      setLoading(false);
    }
  };

  const resetOTForm = () => {
    setOTFormData({
      employeeId: '',
      employeeNumber: '',
      date: new Date().toISOString().split('T')[0],
      otOutTime: '',
      shiftId: '',
      manuallySelectedShiftId: '',
      comments: '',
    });
    setConfusedShift(null);
    setSelectedEmployee(null);
    setSelectedShift(null);
    setAttendanceData(null);
    setValidationError('');
    setEvidenceFile(null);
    setLocationData(null);
  };

  const formatTime = (time: string | null) => {
    if (!time) return '-';
    try {
      const date = new Date(time);
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
    } catch {
      return time;
    }
  };

  const resetPermissionForm = () => {
    setPermissionFormData({
      employeeId: '',
      employeeNumber: '',
      date: new Date().toISOString().split('T')[0],
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
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400';
      case 'rejected':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400';
      default:
        return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-400';
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <div className="relative min-h-screen">
      {/* Toast Notifications Container */}
      <div className="fixed right-4 top-4 z-[100] flex flex-col gap-2">
        {toasts.map((toast) => (
          <ToastNotification key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
        ))}
      </div>

      {/* Background */}
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(to_right,#e2e8f01f_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f01f_1px,transparent_1px)] bg-[size:28px_28px] dark:bg-[linear-gradient(to_right,rgba(148,163,184,0.12)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.12)_1px,transparent_1px)]" />
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-green-50/40 via-green-50/35 to-transparent dark:from-slate-900/60 dark:via-slate-900/65 dark:to-slate-900/80" />

      <div className="relative z-10 mx-auto max-w-[1920px] px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">OT & Permissions Management</h1>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Manage overtime requests and permission applications</p>
          </div>

          <div className="flex items-center gap-3">
            {/* Tabs - Same size as attendance page toggle */}
            <div className="flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
              <button
                onClick={() => setActiveTab('ot')}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${activeTab === 'ot'
                  ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-lg shadow-blue-500/30'
                  : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
                  }`}
              >
                <svg className="mr-2 inline h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Overtime Requests ({otRequests.length})
              </button>
              <button
                onClick={() => setActiveTab('permissions')}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${activeTab === 'permissions'
                  ? 'bg-gradient-to-r from-green-500 to-green-500 text-white shadow-lg shadow-green-500/30'
                  : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
                  }`}
              >
                <svg className="mr-2 inline h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Permissions ({permissions.length})
              </button>
            </div>

            <button
              onClick={() => {
                setActiveTab('ot');
                setShowOTDialog(true);
              }}
              className="rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 px-3 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition-all hover:from-blue-600 hover:to-indigo-600"
            >
              <svg className="mr-2 inline h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Create OT Request
            </button>
            <button
              onClick={() => {
                setActiveTab('permissions');
                setShowPermissionDialog(true);
              }}
              className="rounded-xl bg-gradient-to-r from-green-500 to-green-500 px-3 py-2 text-sm font-semibold text-white shadow-lg shadow-green-500/30 transition-all hover:from-green-600 hover:to-green-600"
            >
              <svg className="mr-2 inline h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Create Permission
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-5 rounded-xl border border-slate-200 bg-white/80 backdrop-blur-sm p-3 dark:border-slate-700 dark:bg-slate-900/80">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Employee Number</label>
              <input
                type="text"
                value={activeTab === 'ot' ? otFilters.employeeNumber : permissionFilters.employeeNumber}
                onChange={(e) => {
                  if (activeTab === 'ot') {
                    setOTFilters(prev => ({ ...prev, employeeNumber: e.target.value }));
                  } else {
                    setPermissionFilters(prev => ({ ...prev, employeeNumber: e.target.value }));
                  }
                }}
                placeholder="Filter by employee"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Status</label>
              <select
                value={activeTab === 'ot' ? otFilters.status : permissionFilters.status}
                onChange={(e) => {
                  if (activeTab === 'ot') {
                    setOTFilters(prev => ({ ...prev, status: e.target.value }));
                  } else {
                    setPermissionFilters(prev => ({ ...prev, status: e.target.value }));
                  }
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              >
                <option value="">All Status</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Start Date</label>
              <input
                type="date"
                value={activeTab === 'ot' ? otFilters.startDate : permissionFilters.startDate}
                onChange={(e) => {
                  if (activeTab === 'ot') {
                    setOTFilters(prev => ({ ...prev, startDate: e.target.value }));
                  } else {
                    setPermissionFilters(prev => ({ ...prev, startDate: e.target.value }));
                  }
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">End Date</label>
              <input
                type="date"
                value={activeTab === 'ot' ? otFilters.endDate : permissionFilters.endDate}
                onChange={(e) => {
                  if (activeTab === 'ot') {
                    setOTFilters(prev => ({ ...prev, endDate: e.target.value }));
                  } else {
                    setPermissionFilters(prev => ({ ...prev, endDate: e.target.value }));
                  }
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Division</label>
              <select
                value={selectedDivision}
                onChange={(e) => {
                  setSelectedDivision(e.target.value);
                  setSelectedDepartment('');
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              >
                <option value="">All Divisions</option>
                {divisions.map((div) => (
                  <option key={div._id} value={div._id}>{div.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Department</label>
              <select
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              >
                <option value="">All Departments</option>
                {filteredDepartmentsByDivision.map((dept) => (
                  <option key={dept._id} value={dept._id}>{dept.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Designation</label>
              <select
                value={selectedDesignation}
                onChange={(e) => setSelectedDesignation(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              >
                <option value="">All Designations</option>
                {designations.map((desig) => (
                  <option key={desig._id} value={desig._id}>{desig.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner />
          </div>
        ) : activeTab === 'ot' ? (
          <div className="rounded-xl border border-slate-200 bg-white/80 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/80">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">Employee</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">Date</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">Shift</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">OT In</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">OT Out</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">OT Hours</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">Status</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {otRequests.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                        No OT requests found
                      </td>
                    </tr>
                  ) : (
                    otRequests.filter(applyAdvancedFilters).map((ot) => (
                      <tr key={ot._id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-3 py-2.5">
                          <div className="text-sm font-medium text-slate-900 dark:text-white">
                            {ot.employeeId?.employee_name || ot.employeeNumber}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">{ot.employeeNumber}</div>
                        </td>
                        <td className="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-400">{formatDate(ot.date)}</td>
                        <td className="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-400">
                          {ot.shiftId?.name || '-'}
                        </td>
                        <td className="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-400">{formatTime(ot.otInTime)}</td>
                        <td className="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-400">{formatTime(ot.otOutTime)}</td>
                        <td className="px-3 py-2.5 text-sm font-medium text-slate-900 dark:text-white">{ot.otHours} hrs</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getStatusColor(ot.status)}`}>
                            {ot.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex gap-2">
                            {ot.status === 'pending' && (
                              <>
                                <button
                                  onClick={() => handleApprove('ot', ot._id)}
                                  className="rounded-lg bg-green-500 px-3 py-1 text-xs font-medium text-white hover:bg-green-600"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => handleReject('ot', ot._id)}
                                  className="rounded-lg bg-red-500 px-3 py-1 text-xs font-medium text-white hover:bg-red-600"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            {/* View Evidence Button */}
                            {((ot as any).photoEvidence || (ot as any).geoLocation) && (
                              <button
                                onClick={() => {
                                  setSelectedEvidenceItem({
                                    type: 'ot',
                                    photoEvidence: (ot as any).photoEvidence,
                                    geoLocation: (ot as any).geoLocation,
                                    employeeName: ot.employeeId?.employee_name || ot.employeeNumber,
                                    date: ot.date
                                  });
                                  setShowEvidenceDialog(true);
                                }}
                                className="rounded-lg bg-sky-500 px-3 py-1 text-xs font-medium text-white hover:bg-sky-600"
                              >
                                Evidence
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
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white/80 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/80">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">Employee</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">Date</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">Time Range</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">Hours</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">Purpose</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">Status</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {permissions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                        No permission requests found
                      </td>
                    </tr>
                  ) : (
                    permissions.filter(applyAdvancedFilters).map((perm) => (
                      <tr key={perm._id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-3 py-2.5">
                          <div className="text-sm font-medium text-slate-900 dark:text-white">
                            {perm.employeeId?.employee_name || perm.employeeNumber}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">{perm.employeeNumber}</div>
                        </td>
                        <td className="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-400">{formatDate(perm.date)}</td>
                        <td className="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-400">
                          {formatTime(perm.permissionStartTime)} - {formatTime(perm.permissionEndTime)}
                        </td>
                        <td className="px-3 py-2.5 text-sm font-medium text-slate-900 dark:text-white">{perm.permissionHours} hrs</td>
                        <td className="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-400">{perm.purpose}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getStatusColor(perm.status)}`}>
                            {perm.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex gap-2">
                            {perm.status === 'pending' && (
                              <>
                                <button
                                  onClick={() => handleApprove('permission', perm._id)}
                                  className="rounded-lg bg-green-500 px-3 py-1 text-xs font-medium text-white hover:bg-green-600"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => handleReject('permission', perm._id)}
                                  className="rounded-lg bg-red-500 px-3 py-1 text-xs font-medium text-white hover:bg-red-600"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            {/* View Evidence Button */}
                            {((perm as any).photoEvidence || (perm as any).geoLocation) && (
                              <button
                                onClick={() => {
                                  setSelectedEvidenceItem({
                                    type: 'permission',
                                    photoEvidence: (perm as any).photoEvidence,
                                    geoLocation: (perm as any).geoLocation,
                                    employeeName: perm.employeeId?.employee_name || perm.employeeNumber,
                                    date: perm.date
                                  });
                                  setShowEvidenceDialog(true);
                                }}
                                className="rounded-lg bg-sky-500 px-3 py-1 text-xs font-medium text-white hover:bg-sky-600"
                              >
                                Evidence
                              </button>
                            )}
                            {['approved', 'checked_out', 'checked_in'].includes(perm.status) && perm.qrCode && (
                              <button
                                onClick={() => {
                                  setSelectedQR(perm);
                                  setShowQRDialog(true);
                                }}
                                className="rounded-lg bg-blue-500 px-3 py-1 text-xs font-medium text-white hover:bg-blue-600"
                              >
                                View QR
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
          </div>
        )}

        {/* OT Dialog */}
        {showOTDialog && (
          <Portal>
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowOTDialog(false)} />
              <div className="relative z-50 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
                <div className="mb-6 flex items-center justify-between">
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">create OT Request</h2>
                  <button
                    onClick={() => {
                      setShowOTDialog(false);
                      resetOTForm();
                    }}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="space-y-4">
                  {/* Validation Error */}
                  {validationError && (
                    <div className="rounded-lg border-2 border-red-300 bg-red-50 p-3 dark:border-red-700 dark:bg-red-900/20">
                      <div className="flex items-center gap-2">
                        <svg className="h-5 w-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-sm font-medium text-red-800 dark:text-red-300">{validationError}</p>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Employee *</label>
                    <EmployeeSelect
                      value={otFormData.employeeId}
                      onChange={(employee) => {
                        if (employee && employee.emp_no) {
                          const employeeId = employee._id || employee.emp_no;
                          handleEmployeeSelect(employeeId, employee.emp_no, otFormData.date);
                        } else {
                          // Clear employee selection
                          setOTFormData(prev => ({ ...prev, employeeId: '', employeeNumber: '' }));
                          setAttendanceData(null);
                          setSelectedShift(null);
                          setConfusedShift(null);
                        }
                      }}
                      placeholder="Search Employee..."
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Date *</label>
                    <input
                      type="date"
                      min={new Date().toISOString().split('T')[0]}
                      value={otFormData.date}
                      onChange={(e) => {
                        setOTFormData(prev => ({ ...prev, date: e.target.value }));
                        if (otFormData.employeeId && otFormData.employeeNumber) {
                          handleEmployeeSelect(otFormData.employeeId, otFormData.employeeNumber, e.target.value);
                        }
                      }}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                  </div>

                  {/* Attendance Information */}
                  {attendanceLoading && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"></div>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Loading attendance data...</p>
                      </div>
                    </div>
                  )}

                  {attendanceData && !attendanceLoading && (
                    <div className="rounded-lg border-2 border-green-200 bg-green-50 p-4 dark:border-green-700 dark:bg-green-900/20">
                      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-green-900 dark:text-green-200">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Attendance Information
                      </h3>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded bg-white/50 p-2 dark:bg-slate-800/50">
                          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Status</p>
                          <p className="mt-1 font-semibold text-slate-900 dark:text-white">{attendanceData.status || '-'}</p>
                        </div>
                        <div className="rounded bg-white/50 p-2 dark:bg-slate-800/50">
                          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">In Time</p>
                          <p className="mt-1 font-semibold text-slate-900 dark:text-white">{formatTime(attendanceData.inTime)}</p>
                        </div>
                        <div className="rounded bg-white/50 p-2 dark:bg-slate-800/50">
                          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Out Time</p>
                          <p className="mt-1 font-semibold text-slate-900 dark:text-white">{formatTime(attendanceData.outTime)}</p>
                        </div>
                        <div className="rounded bg-white/50 p-2 dark:bg-slate-800/50">
                          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Hours</p>
                          <p className="mt-1 font-semibold text-slate-900 dark:text-white">{attendanceData.totalHours ? `${attendanceData.totalHours.toFixed(2)}h` : '-'}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Show message if no attendance but employee and date are selected */}
                  {!attendanceLoading && !attendanceData && otFormData.employeeId && otFormData.date && (
                    <div className="rounded-lg border-2 border-orange-200 bg-orange-50 p-4 dark:border-orange-700 dark:bg-orange-900/20">
                      <div className="flex items-center gap-2">
                        <svg className="h-5 w-5 text-orange-600 dark:text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <p className="text-sm font-medium text-orange-800 dark:text-orange-300">No attendance record found for this date</p>
                      </div>
                    </div>
                  )}

                  {confusedShift && (
                    <div className="rounded-lg border-2 border-yellow-300 bg-yellow-50 p-4 dark:border-yellow-600 dark:bg-yellow-900/20">
                      <div className="mb-2 flex items-center gap-2">
                        <svg className="h-5 w-5 text-yellow-600 dark:text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span className="font-semibold text-yellow-800 dark:text-yellow-300">ConfusedShift Detected</span>
                      </div>
                      <p className="mb-3 text-sm text-yellow-700 dark:text-yellow-400">
                        Multiple shifts match for this attendance. Please manually select the correct shift.
                      </p>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-yellow-800 dark:text-yellow-300">Select Shift *</label>
                        <select
                          value={otFormData.manuallySelectedShiftId}
                          onChange={(e) => {
                            const selectedShiftId = e.target.value;
                            setOTFormData(prev => ({ ...prev, manuallySelectedShiftId: selectedShiftId }));

                            // Find and set the selected shift
                            const selectedShiftData = confusedShift.possibleShifts.find(s => s.shiftId === selectedShiftId);
                            if (selectedShiftData) {
                              const shiftFromList = shifts.find(s => s._id === selectedShiftId);
                              if (shiftFromList) {
                                setSelectedShift(shiftFromList);
                              } else {
                                // Create shift object from confused shift data
                                setSelectedShift({
                                  _id: selectedShiftData.shiftId,
                                  name: selectedShiftData.shiftName,
                                  startTime: selectedShiftData.startTime,
                                  endTime: selectedShiftData.endTime,
                                  duration: 0,
                                });
                              }

                              // Auto-suggest OT out time based on selected shift
                              if (selectedShiftData.endTime) {
                                const [endHour, endMin] = selectedShiftData.endTime.split(':').map(Number);
                                const suggestedOutTime = new Date(otFormData.date);
                                suggestedOutTime.setHours(endHour + 1, endMin, 0, 0);
                                const suggestedOutTimeStr = suggestedOutTime.toISOString().slice(0, 16);
                                setOTFormData(prev => ({ ...prev, otOutTime: suggestedOutTimeStr }));
                              }
                            }
                          }}
                          className="w-full rounded-xl border border-yellow-300 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500 dark:border-yellow-600 dark:bg-slate-900 dark:text-white"
                          required
                        >
                          <option value="">Select Shift</option>
                          {confusedShift.possibleShifts.map((shift, index) => {
                            const shiftObj = shifts.find(s => s._id === shift.shiftId);
                            return (
                              <option key={`confused-shift-${shift.shiftId}-${index}`} value={shift.shiftId}>
                                {shift.shiftName} ({shift.startTime} - {shift.endTime})
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Shift Information - Show for both normal and confused shift (after selection) */}
                  {(selectedShift || (confusedShift && otFormData.manuallySelectedShiftId)) && attendanceData && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-700 dark:bg-blue-900/20">
                      <h3 className="mb-2 text-sm font-semibold text-blue-900 dark:text-blue-200">Shift Information</h3>
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="font-medium text-blue-800 dark:text-blue-300">Shift:</span>{' '}
                          <span className="text-blue-900 dark:text-blue-200">
                            {selectedShift?.name || confusedShift?.possibleShifts.find(s => s.shiftId === otFormData.manuallySelectedShiftId)?.shiftName || '-'}
                          </span>
                        </div>
                        <div>
                          <span className="font-medium text-blue-800 dark:text-blue-300">Shift Time:</span>{' '}
                          <span className="text-blue-900 dark:text-blue-200">
                            {selectedShift ? `${selectedShift.startTime} - ${selectedShift.endTime}` :
                              confusedShift?.possibleShifts.find(s => s.shiftId === otFormData.manuallySelectedShiftId) ?
                                `${confusedShift.possibleShifts.find(s => s.shiftId === otFormData.manuallySelectedShiftId)?.startTime} - ${confusedShift.possibleShifts.find(s => s.shiftId === otFormData.manuallySelectedShiftId)?.endTime}` : '-'}
                          </span>
                        </div>
                        <div className="mt-3 rounded bg-white/50 p-2 dark:bg-slate-800/50">
                          <span className="font-semibold text-blue-900 dark:text-blue-200">OT In Time (Shift End):</span>{' '}
                          <span className="text-lg font-bold text-blue-700 dark:text-blue-300">
                            {selectedShift?.endTime || confusedShift?.possibleShifts.find(s => s.shiftId === otFormData.manuallySelectedShiftId)?.endTime || '-'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">OT Out Time *</label>
                    <input
                      type="datetime-local"
                      value={otFormData.otOutTime}
                      onChange={(e) => setOTFormData(prev => ({ ...prev, otOutTime: e.target.value }))}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      required
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Comments</label>
                    <textarea
                      value={otFormData.comments}
                      onChange={(e) => setOTFormData(prev => ({ ...prev, comments: e.target.value }))}
                      rows={3}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                  </div>

                  {/* Photo Evidence */}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-700/50">
                    <LocationPhotoCapture
                      label="Live Photo Evidence"
                      onCapture={(loc, photo) => {
                        setEvidenceFile(photo.file);
                        setLocationData(loc);
                        (photo.file as any).exifLocation = photo.exifLocation;
                      }}
                      onClear={() => {
                        setEvidenceFile(null);
                        setLocationData(null);
                      }}
                    />
                  </div>

                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => {
                        setShowOTDialog(false);
                        resetOTForm();
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateOT}
                      disabled={loading}
                      className="rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-500/30 hover:from-blue-600 hover:to-indigo-600 disabled:opacity-50"
                    >
                      {loading ? 'Creating...' : 'Create OT Request'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </Portal>
        )}

        {/* Permission Dialog */}
        {showPermissionDialog && (
          <Portal>
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowPermissionDialog(false)} />
              <div className="relative z-50 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
                <div className="mb-6 flex items-center justify-between">
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">Create Permission Request</h2>
                  <button
                    onClick={() => {
                      setShowPermissionDialog(false);
                      resetPermissionForm();
                    }}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="space-y-3">
                  {/* Validation Error */}
                  {permissionValidationError && (
                    <div className="rounded-lg border-2 border-red-300 bg-red-50 p-3 dark:border-red-700 dark:bg-red-900/20">
                      <div className="flex items-center gap-2">
                        <svg className="h-5 w-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-sm font-medium text-red-800 dark:text-red-300">{permissionValidationError}</p>
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Employee *</label>
                    <EmployeeSelect
                      value={permissionFormData.employeeId}
                      onChange={async (employee) => {
                        if (!employee) {
                          setPermissionFormData(prev => ({
                            ...prev,
                            employeeId: '',
                            employeeNumber: '',
                          }));
                          setPermissionValidationError('');
                          return;
                        }

                        if (employee && employee.emp_no) {
                          const employeeId = employee._id || employee.emp_no;
                          setPermissionFormData(prev => ({
                            ...prev,
                            employeeId: employeeId,
                            employeeNumber: employee.emp_no,
                          }));
                          setPermissionValidationError('');

                          // Check attendance when employee is selected
                          if (permissionFormData.date) {
                            try {
                              const attendanceRes = await api.getAttendanceDetail(employee.emp_no, permissionFormData.date);
                              if (!attendanceRes.success || !attendanceRes.data || !attendanceRes.data.inTime) {
                                setPermissionValidationError('No attendance record found or employee has no in-time for this date. Permission cannot be created without attendance.');
                              } else {
                                setPermissionValidationError('');
                              }
                            } catch (error) {
                              console.error('Error checking attendance:', error);
                            }
                          }
                        } else {
                          setPermissionFormData(prev => ({
                            ...prev,
                            employeeId: '',
                            employeeNumber: '',
                          }));
                          setPermissionValidationError('');
                        }
                      }}
                      placeholder="Search Employee..."
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Date *</label>
                    <input
                      type="date"
                      min={new Date().toISOString().split('T')[0]}
                      value={permissionFormData.date}
                      onChange={async (e) => {
                        setPermissionFormData(prev => ({ ...prev, date: e.target.value }));
                        // Check attendance when date changes
                        if (permissionFormData.employeeNumber && e.target.value) {
                          try {
                            const attendanceRes = await api.getAttendanceDetail(permissionFormData.employeeNumber, e.target.value);
                            if (!attendanceRes.success || !attendanceRes.data || !attendanceRes.data.inTime) {
                              setPermissionValidationError('No attendance record found or employee has no in-time for this date. Permission cannot be created without attendance.');
                            } else {
                              setPermissionValidationError('');
                            }
                          } catch (error) {
                            console.error('Error checking attendance:', error);
                          }
                        }
                      }}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                  </div>

                  {/* Attendance Validation Message for Permission */}
                  {permissionFormData.employeeNumber && permissionFormData.date && (
                    <div className="rounded-lg border-2 border-orange-200 bg-orange-50 p-3 dark:border-orange-700 dark:bg-orange-900/20">
                      <div className="flex items-center gap-2">
                        <svg className="h-5 w-5 text-orange-600 dark:text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-sm font-medium text-orange-800 dark:text-orange-300">
                          Note: Permission requires attendance with in-time for the selected date. Please ensure the employee has marked attendance.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Permission Start Time *</label>
                      <input
                        type="datetime-local"
                        value={permissionFormData.permissionStartTime}
                        onChange={(e) => setPermissionFormData(prev => ({ ...prev, permissionStartTime: e.target.value }))}
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Permission End Time *</label>
                      <input
                        type="datetime-local"
                        value={permissionFormData.permissionEndTime}
                        onChange={(e) => setPermissionFormData(prev => ({ ...prev, permissionEndTime: e.target.value }))}
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Purpose *</label>
                    <input
                      type="text"
                      value={permissionFormData.purpose}
                      onChange={(e) => setPermissionFormData(prev => ({ ...prev, purpose: e.target.value }))}
                      placeholder="Enter purpose for permission"
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      required
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Comments</label>
                    <textarea
                      value={permissionFormData.comments}
                      onChange={(e) => setPermissionFormData(prev => ({ ...prev, comments: e.target.value }))}
                      rows={3}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                  </div>

                  {/* Photo Evidence */}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-700/50">
                    <LocationPhotoCapture
                      label="Live Photo Evidence"
                      onCapture={(loc, photo) => {
                        setEvidenceFile(photo.file);
                        setLocationData(loc);
                        (photo.file as any).exifLocation = photo.exifLocation;
                      }}
                      onClear={() => {
                        setEvidenceFile(null);
                        setLocationData(null);
                      }}
                    />
                  </div>

                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => {
                        setShowPermissionDialog(false);
                        resetPermissionForm();
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreatePermission}
                      disabled={loading}
                      className="rounded-xl bg-gradient-to-r from-green-500 to-green-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-green-500/30 hover:from-green-600 hover:to-green-600 disabled:opacity-50"
                    >
                      {loading ? 'Creating...' : 'Create Permission'}
                    </button>
                  </div>
                </div>
              </div>
            </div> </Portal>
        )}

        {/* Evidence Viewer Dialog */}
        {showEvidenceDialog && selectedEvidenceItem && (
          <Portal>
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowEvidenceDialog(false)} />
              <div className="relative z-50 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">Evidence & Location</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {selectedEvidenceItem.employeeName} • {formatDate(selectedEvidenceItem.date)}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowEvidenceDialog(false)}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="space-y-6">
                  {/* Photo Section */}
                  {selectedEvidenceItem.photoEvidence ? (
                    <div className="relative group rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm">
                      <img
                        src={selectedEvidenceItem.photoEvidence.url}
                        alt="Evidence"
                        className="w-full h-64 object-cover"
                      />
                      <a
                        href={selectedEvidenceItem.photoEvidence.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-all"
                      >
                        <div className="bg-white/90 dark:bg-slate-900/90 text-slate-800 dark:text-white px-4 py-2 rounded-full font-medium text-sm shadow-lg opacity-0 group-hover:opacity-100 transform scale-95 group-hover:scale-100 transition-all flex items-center gap-2">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                          Open Full Size
                        </div>
                      </a>
                    </div>
                  ) : (
                    <div className="h-32 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
                      <svg className="h-8 w-8 text-slate-300 dark:text-slate-600 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                      <span className="text-sm text-slate-400">No photo evidence</span>
                    </div>
                  )}

                  {/* Location Section */}
                  {selectedEvidenceItem.geoLocation ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="p-1.5 rounded-lg bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        </div>
                        <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">Location Details</h3>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="block text-xs uppercase tracking-wider text-slate-500 font-bold mb-1">Coordinates</span>
                          <span className="font-mono text-slate-700 dark:text-slate-300">
                            {selectedEvidenceItem.geoLocation.latitude.toFixed(6)}, {selectedEvidenceItem.geoLocation.longitude.toFixed(6)}
                          </span>
                        </div>
                        <div>
                          <span className="block text-xs uppercase tracking-wider text-slate-500 font-bold mb-1">Captured At</span>
                          <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                            <svg className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            {selectedEvidenceItem.geoLocation.capturedAt ? new Date(selectedEvidenceItem.geoLocation.capturedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : 'Unknown'}
                          </span>
                        </div>
                        {selectedEvidenceItem.geoLocation.address && (
                          <div className="col-span-2 mt-1 py-2 border-t border-slate-200 dark:border-slate-700">
                            <span className="block text-xs uppercase tracking-wider text-slate-500 font-bold mb-1">Detailed Address</span>
                            <span className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                              {selectedEvidenceItem.geoLocation.address}
                            </span>
                          </div>
                        )}
                        <div className="col-span-2 mt-1">
                          <a
                            href={`https://www.google.com/maps?q=${selectedEvidenceItem.geoLocation.latitude},${selectedEvidenceItem.geoLocation.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline transition-colors"
                          >
                            Open in Google Maps
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                          </a>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50 text-center text-sm text-slate-400">
                      No location data available
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Portal>
        )}

        {/* QR Code Dialog */}
        {showQRDialog && selectedQR && (
          <Portal>
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowQRDialog(false)} />
              <div className="relative z-50 w-full max-w-2xl rounded-[2.5rem] overflow-hidden bg-white dark:bg-slate-900 border border-white/20 shadow-2xl animate-in zoom-in-95 duration-300 flex flex-col">
                <div className="absolute right-4 top-4 z-10">
                  {/* Custom Header in dynamic UI, just the close button used from original */}
                  <button
                    onClick={() => {
                      setShowQRDialog(false);
                      setSelectedQR(null);
                    }}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

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
                      <p className="text-sm font-bold text-slate-900 dark:text-white line-clamp-1">{selectedQR.employeeId?.employee_name || selectedQR.employeeNumber}</p>
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
        )}
      </div>
    </div >
  );
}

