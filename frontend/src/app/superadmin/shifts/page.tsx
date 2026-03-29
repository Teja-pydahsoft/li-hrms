'use client';

import { useState, useEffect } from 'react';
import { api, Shift } from '@/lib/api';
import Spinner from '@/components/Spinner';
import { LayoutGrid, Table2 } from 'lucide-react';

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

export default function ShiftsPage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [allowedDurations, setAllowedDurations] = useState<number[]>([]);

  // Form state
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [duration, setDuration] = useState<number | ''>('');
  const [payableShifts, setPayableShifts] = useState<number>(1);
  const [suggestedPayableShifts, setSuggestedPayableShifts] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [illegalTimingWarning, setIllegalTimingWarning] = useState('');

  const [lastChanged, setLastChanged] = useState<'start' | 'end' | 'duration' | null>(null);
  const [color, setColor] = useState('#3b82f6');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  useEffect(() => {
    loadShifts();
    loadAllowedDurations();
  }, []);

  const loadShifts = async () => {
    try {
      setLoading(true);
      const response = await api.getShifts();
      if (response.success && response.data) {
        setShifts(response.data);
      }
    } catch (err) {
      console.error('Error loading shifts:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadAllowedDurations = async () => {
    try {
      const response = await api.getAllowedDurations();
      console.log('Durations API response:', response);

      if (response.success) {
        // The API returns { success: true, data: [array of numbers], durations: [full objects] }
        // We need the array of numbers for the dropdown
        const durations = response.data || [];
        setAllowedDurations(Array.isArray(durations) ? durations : []);
        console.log('Loaded durations:', durations);
      } else {
        console.warn('Failed to load durations:', response.message);
        setAllowedDurations([]);
      }
    } catch (err) {
      console.error('Error loading durations:', err);
      setAllowedDurations([]);
    }
  };

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

    setColor('#3b82f6'); // Reset to default blue
    setLastChanged(null);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingShift(null);
    resetForm();
  };

  return (
    <div className="relative min-h-screen">
      <div className="relative z-10 mx-auto max-w-[1920px] px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Shift Management</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Create and manage work shifts</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3">
            {!loading && shifts.length > 0 && (
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

        {/* Shifts Grid */}
        {loading ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm py-12 shadow-xl dark:border-slate-700 dark:bg-slate-900/80">
            <Spinner />
            <p className="mt-4 text-sm font-medium text-slate-600 dark:text-slate-400">Loading shifts...</p>
          </div>
        ) : shifts.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-8 text-center shadow-xl dark:border-slate-700 dark:bg-slate-900/80">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/30 dark:to-indigo-900/30">
              <svg className="h-6 w-6 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-base font-semibold text-slate-900 dark:text-slate-100">No shifts found</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Create your first shift to get started</p>
          </div>
        ) : viewMode === 'table' ? (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white/90 shadow-xl backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/90">
            <table className="min-w-[720px] w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/90 dark:border-slate-700 dark:bg-slate-800/80">
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200" scope="col">
                    Color
                  </th>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200" scope="col">
                    Name
                  </th>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200" scope="col">
                    Time
                  </th>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200" scope="col">
                    Duration
                  </th>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200" scope="col">
                    Payable
                  </th>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200" scope="col">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700 dark:text-slate-200" scope="col">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {shifts.map((shift) => (
                  <tr
                    key={shift._id}
                    className="border-b border-slate-100 transition-colors hover:bg-slate-50/80 dark:border-slate-800 dark:hover:bg-slate-800/40"
                  >
                    <td className="px-4 py-3 align-middle">
                      <div
                        className="h-3 w-14 rounded-full border border-slate-200/80 dark:border-slate-600"
                        style={{ backgroundColor: shift.color || '#3b82f6' }}
                        title={shift.color || '#3b82f6'}
                      />
                    </td>
                    <td className="px-4 py-3 align-middle font-medium text-slate-900 dark:text-slate-100">
                      <span className="line-clamp-2">{shift.name}</span>
                    </td>
                    <td className="px-4 py-3 align-middle whitespace-nowrap text-slate-600 dark:text-slate-400">
                      {shift.startTime} – {shift.endTime}
                    </td>
                    <td className="px-4 py-3 align-middle whitespace-nowrap text-slate-600 dark:text-slate-400">
                      {shift.duration} h
                    </td>
                    <td className="px-4 py-3 align-middle whitespace-nowrap text-slate-600 dark:text-slate-400">
                      {shift.payableShifts ?? 1}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${shift.isActive
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                      >
                        {shift.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-middle text-right">
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shifts.map((shift) => (
              <div
                key={shift._id}
                className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white/80 backdrop-blur-sm p-4 shadow-lg transition-all hover:border-blue-300 hover:shadow-xl dark:border-slate-700 dark:bg-slate-900/80"
              >
                {/* Gradient accent */}
                {/* Gradient accent - Dynamic Color */}
                <div
                  className="absolute top-0 left-0 h-1 w-full"
                  style={{ backgroundColor: shift.color || '#3b82f6' }}
                ></div>

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
                  <span
                    className={`ml-2 flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${shift.isActive
                      ? 'bg-green-100 text-green-700 shadow-sm dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                  >
                    {shift.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>

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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
