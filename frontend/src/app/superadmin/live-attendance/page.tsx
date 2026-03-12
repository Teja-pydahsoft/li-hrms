'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FiGrid } from 'react-icons/fi';
import { LuUsers, LuClock, LuCircleCheck, LuActivity, LuCalendar, LuFilter, LuRefreshCw, LuSearch, LuDownload, LuLayers } from 'react-icons/lu';
import { api, LiveAttendanceReportData, LiveAttendanceFilterOption, LiveAttendanceEmployee } from '@/lib/api';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toast } from 'react-hot-toast';


// Extended type for multi-shift support (extends the base API type)
interface MultiShiftSegment {
  segmentIndex: number;
  shift: string;
  shiftStartTime: string | null;
  shiftEndTime: string | null;
  inTime: string | null;
  outTime: string | null;
  hoursWorked: number;
  isActive: boolean;
  isComplete: boolean;
  isLate: boolean;
  lateMinutes: number;
  isEarlyOut: boolean;
  earlyOutMinutes: number;
}

type ExtendedEmployee = LiveAttendanceEmployee & {
  isMultiShift?: boolean;
  shiftCount?: number;
  segments?: MultiShiftSegment[];
};

export default function LiveAttendancePage() {
  const [reportData, setReportData] = useState<LiveAttendanceReportData | null>(null);
  const [isMultiShiftMode, setIsMultiShiftMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [sortBy, setSortBy] = useState<'latest' | 'oldest'>('latest');
  const [showFilters, setShowFilters] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  // Filter states
  const [divisions, setDivisions] = useState<LiveAttendanceFilterOption[]>([]);
  const [departments, setDepartments] = useState<LiveAttendanceFilterOption[]>([]);
  const [shifts, setShifts] = useState<LiveAttendanceFilterOption[]>([]);
  const [selectedDiv, setSelectedDiv] = useState('');
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedShift, setSelectedShift] = useState('');

  // Fetch filter options
  const fetchFilterOptions = async () => {
    try {
      const response = await api.getLiveAttendanceFilterOptions();
      if (response.success && response.data) {
        setDivisions(response.data.divisions);
        setDepartments(response.data.departments);
        setShifts(response.data.shifts);
      }
    } catch (error) {
      console.error('Error fetching filter options:', error);
    }
  };

  // Fetch report data
  const fetchReportData = useCallback(async () => {
    try {
      const response = await api.getLiveAttendanceReport({
        date: selectedDate,
        division: selectedDiv,
        department: selectedDept,
        shift: selectedShift
      });

      if (response.success) {
        setReportData(response.data as LiveAttendanceReportData);
        setIsMultiShiftMode(!!(response.data as any)?.isMultiShift);
      }
    } catch (error) {
      console.error('Error fetching report data:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, selectedDiv, selectedDept, selectedShift]);

  // Initial data fetch
  useEffect(() => {
    fetchFilterOptions();
    fetchReportData();
  }, [fetchReportData]);

  // Auto-refresh every minute for live updates
  useEffect(() => {
    const interval = setInterval(() => {
      fetchReportData();
    }, 60000); // 60 seconds

    return () => clearInterval(interval);
  }, [fetchReportData]);

  // Format time in IST
  const formatTime = (dateTimeString: string | null) => {
    if (!dateTimeString) return '-';
    const date = new Date(dateTimeString);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  };

  // Format hours worked
  const formatHoursWorked = (hours: number) => {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}h ${m}m`;
  };

  // Sort employees
  const sortEmployees = (employees: ExtendedEmployee[]) => {
    return [...employees].sort((a, b) => {
      const timeA = new Date(a.inTime).getTime();
      const timeB = new Date(b.inTime).getTime();
      return sortBy === 'latest' ? timeB - timeA : timeA - timeB;
    });
  };

  // Get yesterday's date
  const getYesterday = () => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return date.toISOString().split('T')[0];
  };

  const handleExportPDF = () => {
    if (!reportData) return;
    setExportingPdf(true);
    const toastId = toast.loading('Generating Live Attendance PDF...');

    try {
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      let currentY = 15;

      // Header Styling
      doc.setFillColor(79, 70, 229); // indigo-600
      doc.rect(0, 0, pageWidth, 40, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(22);
      doc.setFont('helvetica', 'bold');
      doc.text('LIVE ATTENDANCE PULSE', 15, 18);

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Generated on: ${new Date().toLocaleString()}`, 15, 25);
      doc.text(`Report Date: ${selectedDate}`, 15, 30);

      // Filter info
      const filterText = [
        selectedDiv ? `Division: ${divisions.find(d => d.id === selectedDiv)?.name}` : 'All Divisions',
        selectedDept ? `Department: ${departments.find(d => d.id === selectedDept)?.name}` : 'All Departments',
        selectedShift ? `Shift: ${shifts.find(s => s.id === selectedShift)?.name}` : 'All Shifts'
      ].join(' | ');
      doc.text(filterText, 15, 35);

      currentY = 50;

      // Summary Cards (Stylized as a table or blocks)
      doc.setTextColor(30, 41, 59); // slate-800
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('Workforce Summary', 15, currentY);
      currentY += 8;

      autoTable(doc, {
        startY: currentY,
        head: [['Metric', 'Value', 'Percentage']],
        body: [
          ['Total Active Employees', reportData.summary.totalActiveEmployees.toString(), '100%'],
          ['Currently Working', reportData.summary.currentlyWorking.toString(), `${Math.round((reportData.summary.currentlyWorking / reportData.summary.totalActiveEmployees) * 100)}%`],
          ['Shift Completed', reportData.summary.completedShift.toString(), `${Math.round((reportData.summary.completedShift / reportData.summary.totalActiveEmployees) * 100)}%`],
          ['Total Present', reportData.summary.totalPresent.toString(), `${Math.round((reportData.summary.totalPresent / reportData.summary.totalActiveEmployees) * 100)}%`],
          ['Absent', reportData.summary.absentEmployees.toString(), `${Math.round((reportData.summary.absentEmployees / reportData.summary.totalActiveEmployees) * 100)}%`],
        ],
        theme: 'striped',
        headStyles: { fillColor: [79, 70, 229] },
        styles: { fontSize: 9 },
        margin: { left: 15, right: 15 }
      });

      currentY = (doc as any).lastAutoTable.finalY + 15;

      // Shift Breakdown
      if (reportData.summary.shiftBreakdown.length > 0) {
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Shift Utilization Breakdown', 15, currentY);
        currentY += 8;

        const shiftBody = reportData.summary.shiftBreakdown.map(s => [
          s.name,
          s.working.toString(),
          s.completed.toString(),
          `${s.working + s.completed}`,
          `${Math.round(((s.working + s.completed) / reportData.summary.totalActiveEmployees) * 100)}%`
        ]);

        autoTable(doc, {
          startY: currentY,
          head: [['Shift Name', 'Working', 'Completed', 'Total', 'Workforce Share']],
          body: shiftBody,
          theme: 'grid',
          headStyles: { fillColor: [79, 70, 229] },
          styles: { fontSize: 9 },
          margin: { left: 15, right: 15 }
        });

        currentY = (doc as any).lastAutoTable.finalY + 15;
      }

      // Department Breakdown
      if (reportData.summary.departmentBreakdown && reportData.summary.departmentBreakdown.length > 0) {
        if (currentY > 240) { doc.addPage(); currentY = 20; }
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Department Analytics', 15, currentY);
        currentY += 8;

        const deptBody = reportData.summary.departmentBreakdown.map(d => [
          d.divisionName,
          d.name,
          d.totalEmployees.toString(),
          d.present.toString(),
          d.working.toString(),
          d.completed.toString(),
          d.absent.toString(),
          `${Math.round((d.present / (d.totalEmployees || 1)) * 100)}%`
        ]);

        autoTable(doc, {
          startY: currentY,
          head: [['Division', 'Department', 'Total Emp', 'Present', 'Working', 'Completed', 'Absent', 'Att. %']],
          body: deptBody,
          theme: 'grid',
          headStyles: { fillColor: [234, 88, 12] }, // orange-600
          styles: { fontSize: 8 },
          margin: { left: 15, right: 15 }
        });

        currentY = (doc as any).lastAutoTable.finalY + 15;
      }

      // Currently Working Table
      if (reportData.currentlyWorking.length > 0) {
        if (currentY > 240) { doc.addPage(); currentY = 20; }
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(`Currently Working (${reportData.currentlyWorking.length})`, 15, currentY);
        currentY += 8;

        const workingBody = sortEmployees(reportData.currentlyWorking).map(emp => [
          `${emp.name}\n(${emp.empNo})`,
          `${emp.shift}\n${emp.department}`,
          formatTime(emp.inTime),
          formatHoursWorked(emp.hoursWorked),
          emp.isLate ? `Late (${emp.lateMinutes}m)` : 'On Time'
        ]);

        autoTable(doc, {
          startY: currentY,
          head: [['Employee', 'Shift/Dept', 'Punch In', 'Duration', 'Live Status']],
          body: workingBody,
          theme: 'striped',
          headStyles: { fillColor: [22, 163, 74] }, // green-600
          styles: { fontSize: 8 },
          margin: { left: 15, right: 15 }
        });

        currentY = (doc as any).lastAutoTable.finalY + 15;
      }

      // Completed Shift Table
      if (reportData.completedShift.length > 0) {
        if (currentY > 240) { doc.addPage(); currentY = 20; }
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(`Shift Completed (${reportData.completedShift.length})`, 15, currentY);
        currentY += 8;

        const completedBody = reportData.completedShift.map(emp => [
          `${emp.name}\n(${emp.empNo})`,
          `${emp.shift}\n${emp.designation}`,
          `${formatTime(emp.inTime)} - ${formatTime(emp.outTime)}`,
          formatHoursWorked(emp.hoursWorked),
          [
            'Completed',
            emp.isLate ? `Late In (${emp.lateMinutes}m)` : null,
            emp.isEarlyOut ? `Early Out (${emp.earlyOutMinutes}m)` : null
          ].filter(Boolean).join('\n')
        ]);

        autoTable(doc, {
          startY: currentY,
          head: [['Employee', 'Shift/Desig', 'Time Window', 'Duration', 'Metrics']],
          body: completedBody,
          theme: 'striped',
          headStyles: { fillColor: [147, 51, 234] }, // purple-600
          styles: { fontSize: 8 },
          margin: { left: 15, right: 15 }
        });
      }

      const filename = `Live_Attendance_${selectedDate}_${new Date().getTime()}.pdf`;
      doc.save(filename);
      toast.success('PDF generated successfully!', { id: toastId });
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Failed to generate PDF.', { id: toastId });
    } finally {
      setExportingPdf(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-indigo-500/10">
      {/* Background Orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] rounded-full bg-indigo-500/5 blur-[120px]" />
        <div className="absolute top-[20%] -right-[10%] w-[35%] h-[35%] rounded-full bg-purple-500/5 blur-[120px]" />
        <div className="absolute -bottom-[10%] left-[20%] w-[30%] h-[30%] rounded-full bg-blue-500/5 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto w-full px-4 py-8 sm:px-8 lg:px-12 xl:px-16 space-y-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-600 shadow-sm border border-indigo-500/20">
                <LuActivity className="h-7 w-7" />
              </div>
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
                  Live Attendance <span className="text-indigo-600">Pulse</span>
                </h1>
                <div className="flex items-center gap-2 mt-1">
                  <div className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </div>
                  <p className="text-sm font-medium text-slate-500 border-l border-slate-200 pl-2">
                    System active and monitoring in real-time
                  </p>
                  {isMultiShiftMode && (
                    <span className="flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full border border-violet-300 bg-violet-50 text-[10px] font-black uppercase tracking-widest text-violet-600">
                      <LuLayers className="h-3 w-3" />
                      Multi-Shift Mode
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Last Synced</p>
              <p className="text-sm font-mono font-bold text-indigo-600">{new Date().toLocaleTimeString()}</p>
            </div>
            <button
              onClick={handleExportPDF}
              disabled={exportingPdf || !reportData}
              className="group flex items-center gap-2 rounded-2xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition-all hover:bg-indigo-700 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <LuDownload className={`h-4 w-4 ${exportingPdf ? 'animate-bounce' : ''}`} />
              {exportingPdf ? 'Exporting...' : 'Export PDF'}
            </button>
            <button
              onClick={fetchReportData}
              className="group flex items-center gap-2 rounded-2xl bg-white px-6 py-3 text-sm font-bold text-slate-900 border border-slate-200 shadow-sm transition-all hover:bg-slate-50 hover:border-slate-300 active:scale-95"
            >
              <LuRefreshCw className={`h-4 w-4 transition-transform group-hover:rotate-180 duration-500 ${loading ? 'animate-spin' : ''}`} />
              Refresh Data
            </button>
          </div>
        </div>

        {/* Date Selection and Filters */}
        <div className="rounded-3xl border border-slate-200 bg-white/70 p-4 backdrop-blur-xl shadow-sm border-b-2 border-slate-300/20 overflow-hidden relative group transition-all hover:shadow-md">
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          <div className="relative flex flex-wrap items-center gap-4">
            {/* Date Selection */}
            <div className="flex items-center gap-2 bg-slate-100/50 p-1.5 rounded-2xl border border-slate-200">
              <button
                onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
                className={`rounded-xl px-4 py-2 text-sm font-bold transition-all ${selectedDate === new Date().toISOString().split('T')[0]
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                  }`}
              >
                Today
              </button>
              <button
                onClick={() => setSelectedDate(getYesterday())}
                className={`rounded-xl px-4 py-2 text-sm font-bold transition-all ${selectedDate === getYesterday()
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                  }`}
              >
                Yesterday
              </button>
              <div className="h-6 w-px bg-slate-200 mx-2" />
              <div className="relative group/input">
                <LuCalendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors group-hover/input:text-indigo-600" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="rounded-xl border-none bg-transparent py-2 pl-10 pr-4 text-sm font-bold text-slate-900 focus:ring-0 cursor-pointer"
                />
              </div>
            </div>

            {/* Filter Toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`ml-auto flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-bold transition-all border ${showFilters
                ? 'bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-600/20'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-300'}`}
            >
              <LuFilter className={`h-4 w-4 ${showFilters ? 'fill-current' : ''}`} />
              Advanced Filters
            </button>
          </div>

          {/* Filters Dropdown */}
          {showFilters && (
            <div className="mt-4 grid grid-cols-1 gap-6 border-t border-slate-100 pt-6 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">
                  Division
                </label>
                <div className="relative group/select">
                  <select
                    value={selectedDiv}
                    onChange={(e) => setSelectedDiv(e.target.value)}
                    className="w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 transition-all focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 group-hover/select:border-slate-300"
                  >
                    <option value="" className="bg-white">All Divisions</option>
                    {divisions.map((div) => (
                      <option key={div.id} value={div.id} className="bg-white">
                        {div.name}
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                    <FiGrid className="h-4 w-4" />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">
                  Department
                </label>
                <div className="relative group/select">
                  <select
                    value={selectedDept}
                    onChange={(e) => setSelectedDept(e.target.value)}
                    className="w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 transition-all focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 group-hover/select:border-slate-300"
                  >
                    <option value="" className="bg-white">All Departments</option>
                    {departments.map((dept) => (
                      <option key={dept.id} value={dept.id} className="bg-white">
                        {dept.name}
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                    <FiGrid className="h-4 w-4" />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">
                  Shift
                </label>
                <div className="relative group/select">
                  <select
                    value={selectedShift}
                    onChange={(e) => setSelectedShift(e.target.value)}
                    className="w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 transition-all focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 group-hover/select:border-slate-300"
                  >
                    <option value="" className="bg-white">All Shifts</option>
                    {shifts.map((shift) => (
                      <option key={shift.id} value={shift.id} className="bg-white">
                        {shift.name}
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                    <FiGrid className="h-4 w-4" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Summary Cards */}
        {reportData && (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {/* Total Workforce Card */}
            <div className="relative group overflow-hidden rounded-3xl border border-slate-200 bg-white/70 p-6 backdrop-blur-xl shadow-sm transition-all hover:border-indigo-300 hover:shadow-md">
              <div className="absolute top-0 right-0 -mr-8 -mt-8 h-24 w-24 rounded-full bg-slate-100 blur-2xl group-hover:bg-indigo-50 transition-colors" />
              <div className="relative flex flex-col justify-between h-full space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-inner">
                  <LuUsers className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Total Workforce</p>
                  <p className="mt-1 text-3xl font-black text-slate-900">{reportData.summary.totalActiveEmployees}</p>
                </div>
              </div>
            </div>

            {/* Currently Working Card */}
            <div className="relative group overflow-hidden rounded-3xl border border-green-200 bg-green-50/50 p-6 backdrop-blur-xl shadow-sm transition-all hover:bg-green-50 hover:border-green-300 hover:shadow-md">
              <div className="absolute top-0 right-0 -mr-8 -mt-8 h-24 w-24 rounded-full bg-green-100/50 blur-2xl group-hover:bg-green-100 transition-colors" />
              <div className="relative flex flex-col justify-between h-full space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-green-100 text-green-600 group-hover:bg-green-600 group-hover:text-white transition-all shadow-inner">
                  <LuClock className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-green-600/80">Active Now</p>
                  <p className="mt-1 text-3xl font-black text-green-700">{reportData.summary.currentlyWorking}</p>
                </div>
              </div>
            </div>

            {/* Completed Shift Card */}
            <div className="relative group overflow-hidden rounded-3xl border border-purple-200 bg-purple-50/50 p-6 backdrop-blur-xl shadow-sm transition-all hover:bg-purple-50 hover:border-purple-300 hover:shadow-md">
              <div className="absolute top-0 right-0 -mr-8 -mt-8 h-24 w-24 rounded-full bg-purple-100/50 blur-2xl group-hover:bg-purple-100 transition-colors" />
              <div className="relative flex flex-col justify-between h-full space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-100 text-purple-600 group-hover:bg-purple-600 group-hover:text-white transition-all shadow-inner">
                  <LuCircleCheck className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-purple-600/80">Completed</p>
                  <p className="mt-1 text-3xl font-black text-purple-700">{reportData.summary.completedShift}</p>
                </div>
              </div>
            </div>

            {/* Total Present Card */}
            <div className="relative group overflow-hidden rounded-3xl border border-indigo-200 bg-indigo-50/50 p-6 backdrop-blur-xl shadow-sm transition-all hover:bg-indigo-50 hover:border-indigo-300 hover:shadow-md">
              <div className="absolute top-0 right-0 -mr-8 -mt-8 h-24 w-24 rounded-full bg-indigo-100/50 blur-2xl group-hover:bg-indigo-100 transition-colors" />
              <div className="relative flex flex-col justify-between h-full space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-inner">
                    <LuActivity className="h-6 w-6" />
                  </div>
                  <span className="text-xl font-black text-indigo-600/30">
                    {Math.round((reportData.summary.totalPresent / reportData.summary.totalActiveEmployees) * 100)}%
                  </span>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-600/80">Total Present</p>
                  <p className="mt-1 text-3xl font-black text-indigo-700">{reportData.summary.totalPresent}</p>
                </div>
              </div>
            </div>

            {/* Absent Card */}
            <div className="relative group overflow-hidden rounded-3xl border border-orange-200 bg-orange-50/50 p-6 backdrop-blur-xl shadow-sm transition-all hover:bg-orange-50 hover:border-orange-300 hover:shadow-md">
              <div className="absolute top-0 right-0 -mr-8 -mt-8 h-24 w-24 rounded-full bg-orange-100/50 blur-2xl group-hover:bg-orange-100 transition-colors" />
              <div className="relative flex flex-col justify-between h-full space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-600 group-hover:bg-orange-600 group-hover:text-white transition-all shadow-inner">
                    <LuUsers className="h-6 w-6" />
                  </div>
                  <span className="text-xl font-black text-orange-600/30">
                    {Math.round((reportData.summary.absentEmployees / reportData.summary.totalActiveEmployees) * 100)}%
                  </span>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600/80">Absent</p>
                  <p className="mt-1 text-3xl font-black text-orange-700">{reportData.summary.absentEmployees}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Shift Overview Breakdown */}
        {reportData && reportData.summary.shiftBreakdown.length > 0 && (
          <div className="rounded-3xl border border-slate-200 bg-white/70 p-8 backdrop-blur-xl shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-500">
                Shift Utilization Breakdown
              </h2>
              <div className="h-px flex-1 bg-slate-100 mx-6" />
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {reportData.summary.shiftBreakdown.map((s) => (
                <div key={s.name} className="group relative rounded-2xl border border-slate-200 bg-white/50 p-5 transition-all hover:bg-white hover:border-indigo-200 hover:shadow-sm hover:-translate-y-1">
                  <div className="flex items-start justify-between mb-4">
                    <div className="space-y-1">
                      <p className="text-sm font-black text-slate-900 group-hover:text-indigo-600 transition-colors">{s.name}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Workforce Share
                      </p>
                    </div>
                    <div className="rounded-lg bg-indigo-50 px-2 py-1 text-[10px] font-black text-indigo-600 border border-indigo-100">
                      {Math.round(((s.working + s.completed) / reportData.summary.totalActiveEmployees) * 100)}%
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider">
                        <span className="text-slate-400">Status Split</span>
                        <div className="flex gap-2">
                          <span className="text-green-600">{Math.round((s.working / (s.working + s.completed || 1)) * 100)}%</span>
                          <span className="text-slate-300">/</span>
                          <span className="text-purple-600">{Math.round((s.completed / (s.working + s.completed || 1)) * 100)}%</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 font-bold">Working / Completed</span>
                        <span className="font-mono font-black text-indigo-600">{s.working} / {s.completed}</span>
                      </div>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 border border-slate-200 p-px flex">
                      <div
                        className="h-full bg-green-500 transition-all duration-1000"
                        style={{ width: `${(s.working / (s.working + s.completed || 1)) * 100}%` }}
                      />
                      <div
                        className="h-full bg-purple-500 transition-all duration-1000"
                        style={{ width: `${(s.completed / (s.working + s.completed || 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Department Analytics Table */}
        {reportData && reportData.summary.departmentBreakdown && (
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 p-6 bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-100 text-orange-600 border border-orange-200 shadow-sm">
                  <LuUsers className="h-5 w-5" />
                </div>
                <h2 className="text-xl font-black text-slate-900 italic tracking-tight uppercase">
                  Department <span className="text-orange-600">Analytics</span>
                </h2>
              </div>
            </div>
            <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr className="bg-slate-50/80">
                    {['Division', 'Department', 'Total Emp', 'Present', 'Working', 'Completed', 'Absent', 'Attendance %'].map((header) => (
                      <th key={header} className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.summary.departmentBreakdown.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
                            <LuUsers className="h-8 w-8 text-slate-400" />
                          </div>
                          <div className="text-sm font-semibold text-slate-500">
                            No department data available
                          </div>
                          <div className="text-xs text-slate-400">
                            Department analytics will appear here once employees are assigned to divisions and departments
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    reportData.summary.departmentBreakdown.map((dept) => (
                      <tr key={`${dept.divisionId}_${dept.id}`} className="group/row transition-all hover:bg-orange-50/30">
                        <td className="px-6 py-4 text-sm font-bold text-indigo-600">
                          {dept.divisionName}
                        </td>
                        <td className="px-6 py-4 text-sm font-black text-slate-900 group-hover/row:text-orange-600 transition-colors">
                          {dept.name}
                        </td>
                        <td className="px-6 py-4 text-sm font-bold text-slate-600">
                          {dept.totalEmployees}
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-black text-indigo-600 border border-indigo-100">
                            {dept.present}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm font-bold text-green-600">
                          {dept.working}
                        </td>
                        <td className="px-6 py-4 text-sm font-bold text-purple-600">
                          {dept.completed}
                        </td>
                        <td className="px-6 py-4 text-sm font-bold text-red-500">
                          {dept.absent}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 w-16 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${(dept.present / (dept.totalEmployees || 1)) * 100 >= 90 ? 'bg-green-500' :
                                  (dept.present / (dept.totalEmployees || 1)) * 100 >= 75 ? 'bg-indigo-500' : 'bg-orange-500'
                                  }`}
                                style={{ width: `${Math.min(100, (dept.present / (dept.totalEmployees || 1)) * 100)}%` }}
                              />
                            </div>
                            <span className="text-xs font-black text-slate-500">
                              {Math.round((dept.present / (dept.totalEmployees || 1)) * 100)}%
                            </span>
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

        {/* Currently Working Table */}
        {reportData && reportData.currentlyWorking.length > 0 && (
          <div className="group rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-slate-100 p-6 sm:flex-row sm:items-center sm:justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-green-600"></span>
                </div>
                <h2 className="text-xl font-black text-slate-900 italic tracking-tight uppercase">
                  Currently <span className="text-green-600">Working</span>
                  <span className="ml-2 text-xs font-bold not-italic text-slate-500 uppercase tracking-widest bg-slate-100 px-2 py-1 rounded-lg">
                    {reportData.currentlyWorking.length} Active
                  </span>
                </h2>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative group/filter">
                  <LuSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-hover/filter:text-indigo-600 transition-colors h-4 w-4" />
                  <input placeholder="Quick search..." className="bg-white border border-slate-200 rounded-xl py-2 pl-10 pr-4 text-xs font-bold text-slate-900 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all w-48 shadow-sm" />
                </div>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'latest' | 'oldest')}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 transition-all hover:bg-slate-50 hover:border-slate-300 focus:border-indigo-500 cursor-pointer shadow-sm"
                >
                  <option value="latest">Latest First</option>
                  <option value="oldest">Oldest First</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
              <table className="w-full text-left border-collapse min-w-[1000px]">
                <thead>
                  <tr className="bg-slate-50/80">
                    {['Employee', 'Shift Info', 'Punched In', 'Progress', 'Hours', 'Live Status'].map((header) => (
                      <th key={header} className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortEmployees(reportData.currentlyWorking).map((employee) => (
                    <React.Fragment key={String(employee.id)}>
                      <tr
                        className="group/row transition-all hover:bg-indigo-50/30"
                      >
                        <td className="px-6 py-5">
                          <div className="flex flex-col">
                            <span className="text-sm font-black text-slate-900 group-hover/row:text-indigo-600 transition-colors">{employee.name}</span>
                            <span className="text-[10px] font-mono font-bold text-slate-400">{employee.empNo}</span>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-bold text-slate-600">{employee.shift}</span>
                            <span className="text-[10px] text-slate-400 uppercase font-black">{employee.department}</span>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-2">
                            <LuClock className="h-3 w-3 text-green-600" />
                            <span className="text-sm font-black text-green-700 font-mono italic">
                              {formatTime(employee.inTime)}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <div className="w-24">
                            <div className="h-1.5 w-full rounded-full bg-slate-100 border border-slate-200 overflow-hidden">
                              <div className="h-full rounded-full bg-green-500 shadow-sm" style={{ width: `${Math.min(100, (employee.hoursWorked / 8) * 100)}%` }} />
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <div className="inline-flex items-center gap-1.5 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">
                            <span className="text-xs font-black text-indigo-600 font-mono">
                              {formatHoursWorked(employee.hoursWorked)}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex flex-wrap gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-lg bg-green-50 px-2.5 py-1 text-[10px] font-black text-green-600 uppercase tracking-wider border border-green-100">
                              <span className="h-1 w-1 rounded-full bg-green-500 animate-pulse" />
                              Working
                            </span>
                            {(employee as ExtendedEmployee).isMultiShift && (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-violet-50 px-2 py-0.5 text-[10px] font-black text-violet-600 uppercase tracking-wider border border-violet-100">
                                <LuLayers className="h-2.5 w-2.5" />
                                {(employee as ExtendedEmployee).shiftCount} shifts
                              </span>
                            )}
                            {employee.isLate && (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-orange-50 px-2.5 py-1 text-[10px] font-black text-orange-600 uppercase tracking-wider border border-orange-100">
                                Late {employee.lateMinutes}m
                              </span>
                            )}
                            {employee.otHours > 0 && (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-purple-50 px-2.5 py-1 text-[10px] font-black text-purple-600 uppercase tracking-wider border border-purple-100">
                                OT {employee.otHours.toFixed(1)}h
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                      {/* Multi-shift segment detail rows */}
                      {(employee as ExtendedEmployee).isMultiShift && (employee as ExtendedEmployee).segments?.map((seg, si) => (
                        <tr key={`${employee.id}-seg-${si}`} className="bg-violet-50/40 border-l-2 border-violet-300">
                          <td className="pl-10 pr-4 py-2" colSpan={2}>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black text-violet-500 uppercase tracking-widest">Shift {seg.segmentIndex}</span>
                              <span className="text-[10px] font-bold text-slate-500">{seg.shift}</span>
                              {seg.isActive && <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />}
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            <span className="text-xs font-mono font-bold text-green-700">{formatTime(seg.inTime)}</span>
                            <span className="mx-1 text-slate-300">—</span>
                            <span className="text-xs font-mono font-bold text-red-600">{seg.outTime ? formatTime(seg.outTime) : '...'}</span>
                          </td>
                          <td className="px-4 py-2" colSpan={2}>
                            <span className="text-[10px] font-bold text-indigo-600">{formatHoursWorked(seg.hoursWorked)}</span>
                          </td>
                          <td className="px-4 py-2">
                            {seg.isActive
                              ? <span className="text-[10px] font-black text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-100">Active</span>
                              : <span className="text-[10px] font-black text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-100">Done</span>}
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Completed Shift Table */}
        {reportData && reportData.completedShift.length > 0 && (
          <div className="group rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 p-6 bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-100 text-purple-600 border border-purple-200 shadow-sm">
                  <LuCircleCheck className="h-5 w-5" />
                </div>
                <h2 className="text-xl font-black text-slate-900 italic tracking-tight uppercase">
                  Shift <span className="text-purple-600">Completed</span>
                  <span className="ml-2 text-xs font-bold not-italic text-slate-500 uppercase tracking-widest bg-slate-100 px-2 py-1 rounded-lg">
                    {reportData.completedShift.length} Finished
                  </span>
                </h2>
              </div>
            </div>
            <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
              <table className="w-full text-left border-collapse min-w-[1000px]">
                <thead>
                  <tr className="bg-slate-50/80">
                    {['Employee', 'Shift Info', 'Time Window', 'Duration', 'Metrics'].map((header) => (
                      <th key={header} className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.completedShift.map((employee) => (
                    <React.Fragment key={String(employee.id)}>
                      <tr
                        className="group/row transition-all hover:bg-purple-50/30"
                      >
                        <td className="px-6 py-5">
                          <div className="flex flex-col">
                            <span className="text-sm font-black text-slate-900 group-hover/row:text-purple-600 transition-colors">{employee.name}</span>
                            <span className="text-[10px] font-mono font-bold text-slate-400">{employee.empNo}</span>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-slate-600">{employee.shift}</span>
                            <span className="text-[10px] text-slate-400 uppercase font-black italic">{employee.designation}</span>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                              <span className="text-xs font-black text-slate-700 font-mono uppercase">{formatTime(employee.inTime)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                              <span className="text-xs font-black text-slate-700 font-mono uppercase">{formatTime(employee.outTime)}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <div className="inline-flex items-center gap-1.5 bg-purple-50 px-3 py-1 rounded-full border border-purple-100">
                            <span className="text-xs font-black text-purple-600 font-mono tracking-tighter">
                              {formatHoursWorked(employee.hoursWorked)} TOTAL
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex flex-wrap gap-2">
                            <span className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-600 uppercase tracking-wider border border-blue-100">
                              DONE
                            </span>
                            {(employee as ExtendedEmployee).isMultiShift && (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-violet-50 px-2 py-0.5 text-[10px] font-black text-violet-600 uppercase tracking-wider border border-violet-100">
                                <LuLayers className="h-2.5 w-2.5" />
                                {(employee as ExtendedEmployee).shiftCount} shifts
                              </span>
                            )}
                            {employee.isLate && (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-orange-50 px-2 py-0.5 text-[10px] font-black text-orange-600 uppercase tracking-wider border border-orange-100">
                                LATE {employee.lateMinutes}m
                              </span>
                            )}
                            {employee.isEarlyOut && (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-600 uppercase tracking-wider border border-amber-100">
                                EARLY {employee.earlyOutMinutes}m
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                      {/* Multi-shift segment detail rows */}
                      {(employee as ExtendedEmployee).isMultiShift && (employee as ExtendedEmployee).segments?.map((seg, si) => (
                        <tr key={`${employee.id}-cseg-${si}`} className="bg-violet-50/40 border-l-2 border-violet-300">
                          <td className="pl-10 pr-4 py-2" colSpan={2}>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black text-violet-500 uppercase tracking-widest">Shift {seg.segmentIndex}</span>
                              <span className="text-[10px] font-bold text-slate-500">{seg.shift}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            <span className="text-xs font-mono font-bold text-green-700">{formatTime(seg.inTime)}</span>
                            <span className="mx-1 text-slate-300">—</span>
                            <span className="text-xs font-mono font-bold text-red-600">{seg.outTime ? formatTime(seg.outTime) : '...'}</span>
                          </td>
                          <td className="px-4 py-2" colSpan={2}>
                            <span className="text-[10px] font-bold text-indigo-600">{formatHoursWorked(seg.hoursWorked)}</span>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Empty State */}
        {reportData && reportData.currentlyWorking.length === 0 && reportData.completedShift.length === 0 && (
          <div className="rounded-3xl border border-slate-200 bg-white/70 p-20 text-center backdrop-blur-xl shadow-sm">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-slate-100 text-slate-300">
              <LuActivity className="h-10 w-10 opacity-40" />
            </div>
            <h3 className="text-xl font-black text-slate-900 italic tracking-tight uppercase">No Pulse Detected</h3>
            <p className="mt-2 text-sm font-bold text-slate-500 uppercase tracking-widest">
              There are no attendance records for the selected filters today.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
