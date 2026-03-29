'use client';

import { useState, useEffect } from 'react';
import { api, Shift, Division, Department, Designation } from '@/lib/api';
import Spinner from '@/components/Spinner';
import {
  canViewShifts,
  canEditShift  // Used as canManageShifts
} from '@/lib/permissions';
import { auth } from '@/lib/auth';
import { LayoutGrid, Table2 } from 'lucide-react';

export default function ShiftsPage() {
  // User Scope & RBAC
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [scopedDivisions, setScopedDivisions] = useState<Division[]>([]);
  const [scopedDepartments, setScopedDepartments] = useState<Department[]>([]);
  const [scopedDesignations, setScopedDesignations] = useState<Designation[]>([]);
  const [showAllShifts, setShowAllShifts] = useState(false);

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [allowedDurations, setAllowedDurations] = useState<number[]>([]);
  const [color, setColor] = useState('#3b82f6');

  const SHIFT_COLORS = [
    '#3b82f6', // blue-500
    '#ef4444', // red-500
    '#f59e0b', // amber-500
    '#10b981', // emerald-500
    '#8b5cf6', // violet-500
    '#ec4899', // pink-500
    '#06b6d4', // cyan-500
    '#f43f5e', // rose-500
    '#14b8a6', // teal-500
    '#6366f1', // indigo-500
  ];

  // UI State
  const [showForm, setShowForm] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Form State
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [duration, setDuration] = useState<number | ''>('');
  const [payableShifts, setPayableShifts] = useState<number>(1);
  const [suggestedPayableShifts, setSuggestedPayableShifts] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [illegalTimingWarning, setIllegalTimingWarning] = useState('');
  const [lastChanged, setLastChanged] = useState<'start' | 'end' | 'duration' | null>(null);

  // Permissions
  const [resolvedEmployeeShifts, setResolvedEmployeeShifts] = useState<Shift[]>([]);

  // Permission checks using read/write pattern
  // Write permission enables ALL actions (create, edit, delete shifts)
  // Read permission blocks all actions (view only)
  // Future: When implementing granular permissions, only permissions.ts needs updating
  const user = auth.getUser();
  const hasViewPermission = user ? canViewShifts(user as any) : false;
  const hasManagePermission = user ? canEditShift(user as any) : false; // Write permission for ALL actions
  const canViewStructuredShifts = hasViewPermission;
  const canManageShifts = hasManagePermission;

  // Skeleton Component
  const ShiftCardSkeleton = () => (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="absolute top-0 left-0 h-0.5 w-full bg-slate-200 dark:bg-slate-700 animate-pulse"></div>
      <div className="animate-pulse space-y-3">
        <div className="h-5 w-1/2 rounded bg-slate-200 dark:bg-slate-700"></div>
        <div className="space-y-2">
          <div className="h-3 w-3/4 rounded bg-slate-200 dark:bg-slate-700"></div>
          <div className="h-3 w-1/2 rounded bg-slate-200 dark:bg-slate-700"></div>
          <div className="h-3 w-1/4 rounded bg-slate-200 dark:bg-slate-700"></div>
        </div>
      </div>
    </div>
  );

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAllowedDurations = async () => {
    try {
      const response = await api.getAllowedDurations();
      if (response.success) {
        const durations = response.data || [];
        setAllowedDurations(Array.isArray(durations) ? durations : []);
      } else {
        setAllowedDurations([]);
      }
    } catch (err) {
      console.error('Error loading durations:', err);
      setAllowedDurations([]);
    }
  };

  const loadShifts = async () => {
    const response = await api.getShifts();
    if (response.success && response.data) {
      setShifts(response.data);
    }
    loadAllowedDurations();
  };

  const loadDivisionsAndDepartments = async () => {
    try {
      // Use efficient backend endpoint for scoped data
      const response = await api.getScopedShiftData();
      if (response.success && response.data) {
        setScopedDivisions(response.data.divisions);
        setScopedDepartments(response.data.departments);
        setScopedDesignations(response.data.designations);
      }
    } catch (err) {
      console.error("Error loading scoped structure", err);
    }
  };

  const resolveEmployeeShifts = async (user: any) => {
    try {
      const [divRes, deptRes, shiftsRes] = await Promise.all([
        api.getDivisions(true),
        api.getDepartments(true),
        api.getShifts(true) // Fetch all active shifts for resolution
      ]);

      let finalShifts: Shift[] = [];

      if (divRes.success && deptRes.success && shiftsRes.success) {
        const allDivisions = divRes.data || [];
        const allDepartments = deptRes.data || [];
        const allShifts = shiftsRes.data || [];

        // Helper: Resolve mixed array of IDs/Objects to Shift[]
        const resolveShiftsList = (list: (string | any)[] | undefined): Shift[] => {
          if (!list || list.length === 0) return [];
          return list.map(item => {
            let val = item;
            if (val && typeof val === 'object' && 'shiftId' in val) val = val.shiftId;

            if (typeof val === 'string') {
              return allShifts.find((s: any) => s._id === val) || null;
            }
            return val;
          }).filter(Boolean) as Shift[];
        };

        const userDivId = user.division?._id || user.division || user.employeeRef?.division?._id || user.employeeRef?.division;
        const userDeptId = user.department?._id || user.department || user.employeeRef?.department?._id || user.employeeRef?.department;
        const userDesigId = user.designation?._id || user.designation || user.employeeRef?.designation?._id || user.employeeRef?.designation;

        let designationShiftsFound = false;
        if (userDeptId && userDesigId) {
          const deptObj = allDepartments.find((d: any) => d._id === userDeptId);
          if (deptObj && deptObj.designations) {
            const desigObj = deptObj.designations.find((desig: any) => desig._id === userDesigId);

            if (desigObj && typeof desigObj !== 'string') {
              // A. Department Specific Override in Designation
              if (desigObj.departmentShifts && desigObj.departmentShifts.length > 0) {
                const deptOverride = desigObj.departmentShifts.find((ds: any) =>
                  (ds.department?._id === userDeptId || ds.department === userDeptId)
                );
                if (deptOverride && deptOverride.shifts && deptOverride.shifts.length > 0) {
                  finalShifts = resolveShiftsList(deptOverride.shifts);
                  designationShiftsFound = true;
                }
              }

              // B. Division Defaults Override in Designation
              if (!designationShiftsFound && desigObj.divisionDefaults && desigObj.divisionDefaults.length > 0 && userDivId) {
                const divOverride = desigObj.divisionDefaults.find((dd: any) =>
                  (dd.division?._id === userDivId || dd.division === userDivId)
                );
                if (divOverride && divOverride.shifts && divOverride.shifts.length > 0) {
                  finalShifts = resolveShiftsList(divOverride.shifts);
                  designationShiftsFound = true;
                }
              }

              // C. Global Designation Shifts
              if (!designationShiftsFound && desigObj.shifts && desigObj.shifts.length > 0) {
                finalShifts = resolveShiftsList(desigObj.shifts);
                designationShiftsFound = true;
              }
            }
          }
        }

        if (!designationShiftsFound && userDeptId) {
          const deptObj = allDepartments.find((d: any) => d._id === userDeptId);
          if (deptObj && deptObj.shifts && deptObj.shifts.length > 0) {
            finalShifts = resolveShiftsList(deptObj.shifts);
            designationShiftsFound = true;
          }
        }

        if (!designationShiftsFound && userDivId) {
          const divObj = allDivisions.find((d: any) => d._id === userDivId);
          if (divObj && divObj.shifts && divObj.shifts.length > 0) {
            finalShifts = resolveShiftsList(divObj.shifts);
          }
        }
      }

      setResolvedEmployeeShifts(finalShifts);
    } catch (error) {
      console.error("Error resolving employee shifts", error);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const userRes = await api.getCurrentUser();
      if (userRes.success && userRes.data) {
        const user = userRes.data.user;
        setCurrentUser(user);

        const isStructuredViewRole = canViewShifts(user as any);

        if (isStructuredViewRole) {
          await Promise.all([
            loadDivisionsAndDepartments(),
            loadShifts()
          ]);
        } else {
          await resolveEmployeeShifts(user);
        }
      }
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Calculate duration from start and end time
  const calculateDuration = (start: string, end: string): number | null => {
    if (!start || !end) return null;

    const [startHour, startMin] = start.split(':').map(Number);
    const [endHour, endMin] = end.split(':').map(Number);

    let startMinutes = startHour * 60 + startMin;
    let endMinutes = endHour * 60 + endMin;

    // Handle overnight shifts
    if (endMinutes <= startMinutes) {
      endMinutes += 24 * 60;
    }

    const durationMinutes = endMinutes - startMinutes;
    const durationHours = Math.round((durationMinutes / 60) * 100) / 100;
    return durationHours;
  };

  // Calculate end time from start time and duration
  const calculateEndTime = (start: string, dur: number): string | null => {
    if (!start || !dur) return null;

    const [startHour, startMin] = start.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = startMinutes + dur * 60;
    const endHours = Math.floor(endMinutes / 60) % 24;
    const endMins = endMinutes % 60;
    return `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`;
  };

  // Check if duration is in allowed list
  const validateDuration = (dur: number | null): boolean => {
    if (dur === null) return true; // No validation if duration is not calculated yet
    // Check if duration matches any allowed duration (with small tolerance for floating point)
    return allowedDurations.some(allowed => Math.abs(allowed - dur) < 0.01);
  };

  // Handle start time change
  const handleStartTimeChange = (value: string) => {
    setStartTime(value);
    setLastChanged('start');
    setIllegalTimingWarning('');

    // If duration is set, recalculate end time
    if (duration && value) {
      const calculatedEnd = calculateEndTime(value, Number(duration));
      if (calculatedEnd) {
        setEndTime(calculatedEnd);
      }
    }
    // If end time is set, recalculate duration
    else if (endTime && value) {
      const calculatedDur = calculateDuration(value, endTime);
      if (calculatedDur !== null) {
        setDuration(calculatedDur);
        // Calculate suggested payable shifts
        const suggested = calculatedDur / 8;
        setSuggestedPayableShifts(Math.round(suggested * 100) / 100);

        if (!validateDuration(calculatedDur)) {
          setIllegalTimingWarning(`Illegal timings: Calculated duration (${calculatedDur} hours) is not in the allowed durations list.`);
        } else {
          setIllegalTimingWarning('');
        }
      }
    }
  };

  // Handle end time change
  const handleEndTimeChange = (value: string) => {
    setEndTime(value);
    setLastChanged('end');
    setIllegalTimingWarning('');

    // Calculate duration from start and end time
    if (startTime && value) {
      const calculatedDur = calculateDuration(startTime, value);
      if (calculatedDur !== null) {
        setDuration(calculatedDur);
        if (!validateDuration(calculatedDur)) {
          setIllegalTimingWarning(`Illegal timings: Calculated duration (${calculatedDur} hours) is not in the allowed durations list.`);
        } else {
          setIllegalTimingWarning('');
        }
      }
    }
  };

  // Handle duration change
  const handleDurationChange = (value: number | '') => {
    setDuration(value);
    setLastChanged('duration');
    setIllegalTimingWarning('');

    // Calculate end time from start time and duration
    if (startTime && value) {
      const calculatedEnd = calculateEndTime(startTime, Number(value));
      if (calculatedEnd) {
        setEndTime(calculatedEnd);
      }
    }

    // Calculate suggested payable shifts (duration / 8)
    if (value) {
      const suggested = Number(value) / 8;
      setSuggestedPayableShifts(Math.round(suggested * 100) / 100); // Round to 2 decimal places
    } else {
      setSuggestedPayableShifts(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Final validation
    if (!startTime || !endTime || !duration) {
      setError('Start time, end time, and duration are required');
      return;
    }

    // Calculate final duration to validate
    const finalDuration = calculateDuration(startTime, endTime);
    if (finalDuration !== null && !validateDuration(finalDuration)) {
      // Just set a warning but allow proceeding
      setIllegalTimingWarning(`Note: The duration (${finalDuration} hours) is not in the standard allowed durations list.`);
    }

    try {
      const data: any = {
        name,
        startTime,
        endTime,
        duration: Number(duration),
        payableShifts: payableShifts || 1,
        color,
      };

      let response;
      if (editingShift) {
        response = await api.updateShift(editingShift._id, data);
      } else {
        response = await api.createShift(data);
      }

      if (response.success) {
        setShowForm(false);
        setEditingShift(null);
        resetForm();
        loadShifts();
        loadDivisionsAndDepartments();
      } else {
        setError(response.message || 'Failed to save shift');
      }
    } catch (err) {
      setError('An error occurred');
      console.error(err);
    }
  };

  const handleEdit = (shift: Shift) => {
    setEditingShift(shift);
    setName(shift.name);
    setStartTime(shift.startTime);
    setEndTime(shift.endTime);
    setDuration(shift.duration);
    setPayableShifts(shift.payableShifts || 1);
    // Calculate suggested payable shifts for editing
    if (shift.duration) {
      const suggested = shift.duration / 8;
      setSuggestedPayableShifts(Math.round(suggested * 100) / 100);
    } else {
      setSuggestedPayableShifts(null);
    }
    setColor(shift.color || '#3b82f6');
    setLastChanged(null);
    setIllegalTimingWarning('');
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this shift?')) return;

    try {
      const response = await api.deleteShift(id);
      if (response.success) {
        loadShifts();
      } else {
        alert(response.message || 'Failed to delete shift');
      }
    } catch (err) {
      console.error('Error deleting shift:', err);
    }
  };

  const resetForm = () => {
    setName('');
    setStartTime('');
    setEndTime('');
    setDuration('');
    setPayableShifts(1);
    setSuggestedPayableShifts(null);
    setError('');
    setIllegalTimingWarning('');
    setColor('#3b82f6');
    setLastChanged(null);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingShift(null);
    resetForm();
  };

  // Permissions
  // This line was duplicated, keeping the first one.
  // const canManageShifts = ['super_admin', 'sub_admin', 'hr'].includes(currentUser?.role);

  // Helper to render Shift Card (extracted for reuse across sections)
  const renderShiftCard = (shift: Shift, allowManageOverride?: boolean) => (
    <div
      key={shift._id}
      className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white/80 backdrop-blur-sm p-4 shadow-lg transition-all hover:border-blue-300 hover:shadow-xl dark:border-slate-700 dark:bg-slate-900/80"
    >
      <div className="absolute top-0 left-0 h-1 w-full" style={{ backgroundColor: shift.color || '#3b82f6' }}></div>

      <div className="mb-3 flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">{shift.name}</h3>
          <div className="mt-1.5 space-y-1 text-xs">
            <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
              <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="truncate">{shift.startTime} - {shift.endTime}</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
              <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{shift.duration} hours</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
              <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-medium">{shift.payableShifts || 1} payable shift{(shift.payableShifts || 1) !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
        <span className={`ml-2 flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${shift.isActive
          ? 'bg-green-100 text-green-700 shadow-sm dark:bg-green-900/30 dark:text-green-400'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
          }`}>
          {shift.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      {(allowManageOverride !== undefined ? allowManageOverride : canManageShifts) && (
        <div className="flex gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
          <button
            onClick={() => handleEdit(shift)}
            style={{ backgroundColor: shift.color || '#3b82f6' }}
            className="flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-md transition-all hover:opacity-90"
          >
            Edit
          </button>
          <button
            onClick={() => handleDelete(shift._id)}
            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition-all hover:bg-red-50 dark:border-red-800 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-900/20"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );

  const dedupeShifts = (list: Shift[]) =>
    Array.from(new Map(list.map((s) => [s._id, s])).values());

  const renderShiftsDisplay = (shiftList: Shift[], allowManageOverride?: boolean) => {
    const list = dedupeShifts(shiftList);
    if (list.length === 0) return null;
    const allowActions = allowManageOverride !== undefined ? allowManageOverride : canManageShifts;

    if (viewMode === 'grid') {
      return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((s) => renderShiftCard(s, allowManageOverride))}
        </div>
      );
    }

    return (
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white/90 shadow-lg backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/90">
        <table className="min-w-[680px] w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/90 dark:border-slate-700 dark:bg-slate-800/80">
              <th className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-200 sm:px-4 sm:py-3" scope="col">
                Color
              </th>
              <th className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-200 sm:px-4 sm:py-3" scope="col">
                Name
              </th>
              <th className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-200 sm:px-4 sm:py-3" scope="col">
                Time
              </th>
              <th className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-200 sm:px-4 sm:py-3" scope="col">
                Duration
              </th>
              <th className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-200 sm:px-4 sm:py-3" scope="col">
                Payable
              </th>
              <th className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-200 sm:px-4 sm:py-3" scope="col">
                Status
              </th>
              {allowActions && (
                <th
                  className="px-3 py-2.5 text-right font-semibold text-slate-700 dark:text-slate-200 sm:px-4 sm:py-3"
                  scope="col"
                >
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {list.map((shift) => (
              <tr
                key={shift._id}
                className="border-b border-slate-100 transition-colors hover:bg-slate-50/80 dark:border-slate-800 dark:hover:bg-slate-800/40"
              >
                <td className="px-3 py-2.5 align-middle sm:px-4 sm:py-3">
                  <div
                    className="h-3 w-12 rounded-full border border-slate-200/80 sm:w-14 dark:border-slate-600"
                    style={{ backgroundColor: shift.color || '#3b82f6' }}
                    title={shift.color || '#3b82f6'}
                  />
                </td>
                <td className="px-3 py-2.5 align-middle font-medium text-slate-900 sm:px-4 sm:py-3 dark:text-slate-100">
                  <span className="line-clamp-2">{shift.name}</span>
                </td>
                <td className="px-3 py-2.5 align-middle whitespace-nowrap text-slate-600 sm:px-4 sm:py-3 dark:text-slate-400">
                  {shift.startTime} – {shift.endTime}
                </td>
                <td className="px-3 py-2.5 align-middle whitespace-nowrap text-slate-600 sm:px-4 sm:py-3 dark:text-slate-400">
                  {shift.duration} h
                </td>
                <td className="px-3 py-2.5 align-middle whitespace-nowrap text-slate-600 sm:px-4 sm:py-3 dark:text-slate-400">
                  {shift.payableShifts ?? 1}
                </td>
                <td className="px-3 py-2.5 align-middle sm:px-4 sm:py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${shift.isActive
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                  >
                    {shift.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                {allowActions && (
                  <td className="px-3 py-2.5 align-middle text-right sm:px-4 sm:py-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleEdit(shift)}
                        style={{ backgroundColor: shift.color || '#3b82f6' }}
                        className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 touch-manipulation min-h-[36px]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(shift._id)}
                        className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 dark:border-red-800 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-900/20 touch-manipulation min-h-[36px]"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const showViewModeToggle =
    !loading && (canViewStructuredShifts || resolvedEmployeeShifts.length > 0);

  return (
    <div className="relative min-h-screen">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(to_right,#e2e8f01f_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f01f_1px,transparent_1px)] bg-[size:28px_28px] dark:bg-[linear-gradient(to_right,rgba(148,163,184,0.12)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.12)_1px,transparent_1px)]" />
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-green-50/40 via-green-50/35 to-transparent dark:from-slate-900/60 dark:via-slate-900/65 dark:to-slate-900/80" />

      <div className="relative z-10 mx-auto max-w-[1920px] px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Shift Management</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {canManageShifts ? 'Create and manage work shifts' : 'View available shifts and schedules'}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3">
            {showViewModeToggle && (
              <div
                className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900"
                role="group"
                aria-label="Shifts display mode"
              >
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  aria-pressed={viewMode === 'grid'}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors touch-manipulation min-h-[40px] sm:min-h-0 ${viewMode === 'grid'
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
                    }`}
                >
                  <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden />
                  Cards
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  aria-pressed={viewMode === 'table'}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors touch-manipulation min-h-[40px] sm:min-h-0 ${viewMode === 'table'
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
                    }`}
                >
                  <Table2 className="h-4 w-4 shrink-0" aria-hidden />
                  Table
                </button>
              </div>
            )}
            {canManageShifts && (
              <button
                onClick={() => {
                  resetForm();
                  setShowForm(true);
                }}
                className="rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition-all hover:from-blue-600 hover:to-indigo-600 touch-manipulation min-h-[44px] sm:min-h-0"
              >
                <svg className="mr-2 inline h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create Shift
              </button>
            )}
          </div>
        </div>

        {/* Create/Edit Shift Dialog */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    {editingShift ? 'Edit Shift' : 'Create New Shift'}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                    {editingShift ? 'Update shift information' : 'Add a new shift to the system'}
                  </p>
                </div>
                <button
                  onClick={handleCancel}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Shift Name *
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition-all focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    placeholder="e.g., Morning Shift"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Shift Color
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {SHIFT_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColor(c)}
                        className={`h-8 w-8 rounded-full border-2 transition-all ${color === c
                          ? 'border-slate-600 dark:border-white scale-110 shadow-md ring-2 ring-offset-2 ring-blue-500/50 dark:ring-offset-slate-900'
                          : 'border-transparent hover:scale-105 hover:shadow-sm'
                          }`}
                        style={{ backgroundColor: c }}
                        title={c}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Start Time *
                  </label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => handleStartTimeChange(e.target.value)}
                    required
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition-all focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    End Time *
                  </label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => handleEndTimeChange(e.target.value)}
                    required
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition-all focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Duration (hours) *
                  </label>
                  <select
                    value={duration}
                    onChange={(e) => handleDurationChange(e.target.value ? Number(e.target.value) : '')}
                    required
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition-all focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">Select duration</option>
                    {allowedDurations.map((dur) => (
                      <option key={dur} value={dur}>
                        {dur} hours
                      </option>
                    ))}
                    {/* Add current duration as an option if it's not in the allowed list */}
                    {duration && !allowedDurations.some(d => Math.abs(d - Number(duration)) < 0.01) && (
                      <option key="custom" value={duration}>
                        {duration} hours (Custom)
                      </option>
                    )}
                  </select>
                  {allowedDurations.length === 0 && (
                    <p className="mt-1.5 text-xs text-orange-600 dark:text-orange-400">
                      No durations configured. Please configure durations in Settings → Shifts tab.
                    </p>
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Payable Shifts *
                  </label>
                  {suggestedPayableShifts !== null && suggestedPayableShifts !== payableShifts && (
                    <p className="mb-1 text-[10px] text-blue-600 dark:text-blue-400">
                      Suggested: {suggestedPayableShifts} (based on duration ÷ 8)
                    </p>
                  )}
                  <input
                    type="number"
                    value={payableShifts}
                    onChange={(e) => setPayableShifts(Number(e.target.value) || 1)}
                    min="0"
                    step="0.01"
                    required
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition-all focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    placeholder="1"
                  />
                  <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                    Number of standard shifts (8 hours) this shift counts as
                  </p>
                </div>

                {illegalTimingWarning && (
                  <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-400">
                    {illegalTimingWarning}
                  </div>
                )}

                {error && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                    {error}
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="submit"
                    className="flex-1 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-500 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-blue-500/30 transition-all hover:from-blue-600 hover:to-indigo-600"
                  >
                    {editingShift ? 'Update' : 'Create'} Shift
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* STRUCTURED VIEWS */}
        {loading ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm py-12 shadow-xl dark:border-slate-700 dark:bg-slate-900/80">
            <Spinner />
            <p className="mt-4 text-sm font-medium text-slate-600 dark:text-slate-400">Loading shifts...</p>
          </div>
        ) : canViewStructuredShifts ? (
          <div className="space-y-8">
            {/* 1. Division Defaults */}
            {scopedDivisions.length > 0 && scopedDivisions.map(division => {
              const divisionShifts = (division.shifts || []).map(s => {
                let val: any = s;
                if (val && typeof val === 'object' && 'shiftId' in val) val = val.shiftId;
                const shiftId = typeof val === 'string' ? val : val?._id;
                return typeof val === 'string' ? shifts.find(allS => allS._id === shiftId) : val;
              }).filter(Boolean) as Shift[];

              if (divisionShifts.length === 0) return null;

              return (
                <div key={division._id} className="space-y-4">
                  <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <div className="h-6 w-1 rounded-full bg-orange-500" />
                    {division.name} <span className="text-sm font-normal text-slate-500">Division Defaults</span>
                  </h2>
                  {renderShiftsDisplay(divisionShifts)}
                </div>
              );
            })}

            {/* 2. Department Specific */}
            {scopedDepartments.length > 0 && scopedDepartments.map(dept => {
              // Collect all effective shifts for this department
              // 1. Direct Department Shifts
              const directShifts = (dept.shifts || []).map(s => {
                let val: any = s;
                if (val && typeof val === 'object' && 'shiftId' in val) val = val.shiftId;
                const shiftId = typeof val === 'string' ? val : val?._id;
                return typeof val === 'string' ? shifts.find(allS => allS._id === shiftId) : val;
              }).filter(Boolean) as Shift[];

              // 2. Division-Specific Department Shifts (from divisionDefaults)
              // Only include if the division is in our scopedDivisions list
              const divDefaultShifts = (dept.divisionDefaults || []).flatMap(dd => {
                // Check if this division is relevant to the user
                const divId = typeof dd.division === 'string' ? dd.division : dd.division?._id;
                if (scopedDivisions.some(sd => sd._id === divId)) {
                  return dd.shifts || [];
                }
                return [];
              }).map(s => {
                let val: any = s;
                if (val && typeof val === 'object' && 'shiftId' in val) val = val.shiftId;
                const shiftId = typeof val === 'string' ? val : (val as any)?._id; 
                return typeof val === 'string' ? shifts.find(allS => allS._id === shiftId) : val;
              }).filter(Boolean) as Shift[];

              const allDeptShifts = [...directShifts, ...divDefaultShifts];

              if (allDeptShifts.length === 0 && scopedDesignations.every(d => d.department !== dept._id)) return null;

              return (
                <div key={dept._id} className="space-y-4">
                  {allDeptShifts.length > 0 && (
                    <>
                      <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                        <div className="h-6 w-1 rounded-full bg-purple-500" />
                        {dept.name} <span className="text-sm font-normal text-slate-500">Department Specific</span>
                      </h2>
                      {renderShiftsDisplay(allDeptShifts)}
                    </>
                  )}

                  {/* 3. Designation Specific (Nested under Department) */}
                  {(() => {
                    const deptDesignations = scopedDesignations.filter(d =>
                      (d.department && (typeof d.department === 'string' ? d.department : d.department._id) === dept._id) ||
                      (dept.designations && dept.designations.some(dd => (typeof dd === 'string' ? dd : dd._id) === d._id))
                    );

                    if (deptDesignations.length === 0) return null;

                    return (
                      <div className="mt-6 pl-4 border-l-2 border-slate-200 dark:border-slate-700 space-y-6">
                        {deptDesignations.map(des => {
                          let effectiveShifts: any[] = des.shifts || [];

                          // Check Department Overrides (departmentShifts)
                          if (des.departmentShifts && des.departmentShifts.length > 0) {
                            const deptOverride = des.departmentShifts.find(ds =>
                              (typeof ds.department === 'string' ? ds.department : ds.department._id) === dept._id
                            );
                            if (deptOverride && deptOverride.shifts && deptOverride.shifts.length > 0) {
                              effectiveShifts = deptOverride.shifts;
                            }
                          }

                          // Resolve Objects
                          const resolvedDesShifts = effectiveShifts.map(s => {
                            let val: any = s;
                            if (val && typeof val === 'object' && 'shiftId' in val) val = val.shiftId;
                            const shiftId = typeof val === 'string' ? val : (val as any)?._id;
                            return typeof val === 'string' ? shifts.find(allS => allS._id === shiftId) : val;
                          }).filter(Boolean) as Shift[];

                          if (resolvedDesShifts.length === 0) return null;

                          return (
                            <div key={des._id} className="space-y-3">
                              <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                <div className="h-2 w-2 rounded-full bg-indigo-400" />
                                {des.name} <span className="text-xs font-normal text-slate-400">Designation Shifts</span>
                              </h3>
                              {renderShiftsDisplay(resolvedDesShifts)}
                            </div>
                          )
                        })}
                      </div>
                    );
                  })()}
                </div>
              );
            })}

            {/* 3. All Shifts (Lazy Load / Button) */}
            <div className="pt-8 border-t border-slate-200 dark:border-slate-800">
              {!showAllShifts ? (
                <button
                  onClick={() => setShowAllShifts(true)}
                  className="w-full py-4 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-600 dark:border-slate-700 dark:text-slate-400 transition-colors"
                >
                  Load All Available Shifts
                </button>
              ) : (
                <div className="space-y-4 animate-in fade-in duration-500">
                  <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <div className="h-6 w-1 rounded-full bg-slate-500" />
                    All Available Shifts
                  </h2>
                  {renderShiftsDisplay(shifts, false)}
                </div>
              )}
            </div>

          </div>
        ) : (
          <div className="space-y-8">
            {resolvedEmployeeShifts.length > 0 ? (
              <div className="space-y-4">
                <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <div className="h-6 w-1 rounded-full bg-blue-500" />
                  Your Assigned Shifts
                </h2>
                {renderShiftsDisplay(resolvedEmployeeShifts, false)}
                <p className="text-sm text-slate-500 mt-2">
                  These are the specific shifts assigned to you based on your designation, department, or division (in that order of priority).
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm py-16 px-4 text-center shadow-xl dark:border-slate-700 dark:bg-slate-900/80">
                <div className="mb-4 h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center dark:bg-slate-800">
                  <svg className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">No Shifts Assigned</h3>
                <p className="mt-2 text-sm text-slate-500 max-w-sm dark:text-slate-400">
                  No specific shifts have been assigned to your designation, department, or division. Please contact your HR administrator.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

