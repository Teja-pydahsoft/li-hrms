const AttendanceDaily = require('../model/AttendanceDaily');
const AttendanceRawLog = require('../model/AttendanceRawLog');
const Leave = require('../../leaves/model/Leave');
const OD = require('../../leaves/model/OD');
const { calculateMonthlySummary } = require('./summaryCalculationService');
const { extractISTComponents } = require('../../shared/utils/dateUtils');
const dateCycleService = require('../../leaves/services/dateCycleService');

/**
 * Get attendance data for calendar view (Single Employee)
 */
exports.getCalendarViewData = async (employee, year, month) => {
  const targetYear = parseInt(year);
  const targetMonth = parseInt(month);

  // Resolve the payroll period using dateCycleService
  // Use 15th of the month as anchor to find the period that covers/ends in this month
  const anchorDateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-15`;
  const periodInfo = await dateCycleService.getPeriodInfo(new Date(anchorDateStr));
  
  const startDateStr = extractISTComponents(periodInfo.payrollCycle.startDate).dateStr;
  const endDateStr = extractISTComponents(periodInfo.payrollCycle.endDate).dateStr;

  // Fetch attendance records for the month
  const records = await AttendanceDaily.find({
    employeeNumber: employee.emp_no,
    date: { $gte: startDateStr, $lte: endDateStr },
  })
    .populate('shifts.shiftId', 'name startTime endTime duration payableShifts')
    .sort({ date: 1 });

  // Fetch approved leaves and ODs
  const startDateObj = periodInfo.payrollCycle.startDate;
  const endDateObj = periodInfo.payrollCycle.endDate;

  const approvedLeaves = await Leave.find({
    employeeId: employee._id,
    status: 'approved',
    $or: [
      { fromDate: { $lte: endDateObj }, toDate: { $gte: startDateObj } },
    ],
    isActive: true,
  })
    .populate('approvals.final.approvedBy', 'name email')
    .populate('approvals.hr.approvedBy', 'name email')
    .populate('approvals.hod.approvedBy', 'name email')
    .populate('appliedBy', 'name email');

  const approvedODs = await OD.find({
    employeeId: employee._id,
    status: 'approved',
    $or: [
      { fromDate: { $lte: endDateObj }, toDate: { $gte: startDateObj } },
    ],
    isActive: true,
  })
    .populate('approvals.final.approvedBy', 'name email')
    .populate('approvals.hr.approvedBy', 'name email')
    .populate('approvals.hod.approvedBy', 'name email')
    .populate('appliedBy', 'name email');

  // Create maps for leaves and ODs by date
  const leaveMap = {};
  approvedLeaves.forEach(leave => {
    const leaveStart = new Date(leave.fromDate);
    const leaveEnd = new Date(leave.toDate);
    leaveStart.setHours(0, 0, 0, 0);
    leaveEnd.setHours(23, 59, 59, 999);

    let currentDate = new Date(leaveStart);
    let dayCounter = 1;
    while (currentDate <= leaveEnd) {
      const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
      if (dateStr >= startDate && dateStr <= endDateStr) {
        let approvedBy = null;
        let approvedAt = null;
        if (leave.approvals?.final?.status === 'approved' && leave.approvals.final.approvedBy) {
          approvedBy = leave.approvals.final.approvedBy;
          approvedAt = leave.approvals.final.approvedAt;
        } else if (leave.approvals?.hr?.status === 'approved' && leave.approvals.hr.approvedBy) {
          approvedBy = leave.approvals.hr.approvedBy;
          approvedAt = leave.approvals.hr.approvedAt;
        } else if (leave.approvals?.hod?.status === 'approved' && leave.approvals.hod.approvedBy) {
          approvedBy = leave.approvals.hod.approvedBy;
          approvedAt = leave.approvals.hod.approvedAt;
        }

        leaveMap[dateStr] = {
          leaveId: leave._id,
          leaveType: leave.leaveType,
          isHalfDay: leave.isHalfDay,
          halfDayType: leave.halfDayType,
          purpose: leave.purpose,
          fromDate: leave.fromDate,
          toDate: leave.toDate,
          numberOfDays: leave.numberOfDays,
          dayInLeave: dayCounter,
          appliedAt: leave.appliedAt || leave.createdAt,
          approvedBy: approvedBy ? {
            name: approvedBy.name || approvedBy.email,
            email: approvedBy.email
          } : null,
          approvedAt: approvedAt,
        };
      }
      currentDate.setDate(currentDate.getDate() + 1);
      dayCounter++;
    }
  });

  const odMap = {};
  approvedODs.forEach(od => {
    const odStart = new Date(od.fromDate);
    const odEnd = new Date(od.toDate);
    odStart.setHours(0, 0, 0, 0);
    odEnd.setHours(23, 59, 59, 999);

    let currentDate = new Date(odStart);
    let dayCounter = 1;
    while (currentDate <= odEnd) {
      const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
      if (dateStr >= startDate && dateStr <= endDateStr) {
        let approvedBy = null;
        let approvedAt = null;
        if (od.approvals?.final?.status === 'approved' && od.approvals.final.approvedBy) {
          approvedBy = od.approvals.final.approvedBy;
          approvedAt = od.approvals.final.approvedAt;
        } else if (od.approvals?.hr?.status === 'approved' && od.approvals.hr.approvedBy) {
          approvedBy = od.approvals.hr.approvedBy;
          approvedAt = od.approvals.hr.approvedAt;
        } else if (od.approvals?.hod?.status === 'approved' && od.approvals.hod.approvedBy) {
          approvedBy = od.approvals.hod.approvedBy;
          approvedAt = od.approvals.hod.approvedAt;
        }

        odMap[dateStr] = {
          odId: od._id,
          odType: od.odType,
          odType_extended: od.odType_extended,
          isHalfDay: od.isHalfDay,
          halfDayType: od.halfDayType,
          purpose: od.purpose,
          placeVisited: od.placeVisited,
          fromDate: od.fromDate,
          toDate: od.toDate,
          numberOfDays: od.numberOfDays,
          durationHours: od.durationHours,
          odStartTime: od.odStartTime,
          odEndTime: od.odEndTime,
          reason: od.purpose,
          purpose: od.purpose,
          photo: od.photoEvidence?.url,
          photoEvidence: od.photoEvidence,
          geoLocation: od.geoLocation,
          dayInOD: dayCounter,
          appliedAt: od.appliedAt || od.createdAt,
          approvedBy: approvedBy ? {
            name: approvedBy.name || approvedBy.email,
            email: approvedBy.email
          } : null,
          approvedAt: approvedAt,
        };
      }
      currentDate.setDate(currentDate.getDate() + 1);
      dayCounter++;
    }
  });

  // Create merged attendance map
  const attendanceMap = {};
  records.forEach(record => {
    const hasLeave = !!leaveMap[record.date];
    const odInfo = odMap[record.date];
    const hasOD = !!odInfo;
    const hasAttendance = record.status === 'PRESENT' || record.status === 'PARTIAL';
    const odIsHourBased = odInfo?.odType_extended === 'hours';
    const odIsHalfDay = odInfo?.odType_extended === 'half_day' || odInfo?.isHalfDay;
    const isConflict = (hasLeave || (hasOD && !odIsHourBased && !odIsHalfDay)) && hasAttendance;

    attendanceMap[record.date] = {
      date: record.date,
      // Map from first/last shift for display, or use shifts array in frontend
      // inTime and outTime are now provided within the shifts array for multi-shift support
      totalHours: record.totalWorkingHours, // Use aggregate
      status: record.status,
      shiftId: record.shifts && record.shifts.length > 0 ? record.shifts[0].shiftId : null,
      shiftName: record.shifts && record.shifts.length > 0 && record.shifts[0].shiftId ? record.shifts[0].shiftId.name : null,
      isLateIn: record.totalLateInMinutes > 0,
      isEarlyOut: record.totalEarlyOutMinutes > 0,
      lateInMinutes: record.totalLateInMinutes || 0,
      earlyOutMinutes: record.totalEarlyOutMinutes || 0,
      earlyOutDeduction: record.earlyOutDeduction || null,
      expectedHours: record.totalExpectedHours || (record.shifts && record.shifts.length > 0 && record.shifts[0].shiftId ? record.shifts[0].shiftId.duration : null),
      otHours: Math.max(record.otHours || 0, record.totalOTHours || 0),
      extraHours: record.extraHours || 0,
      permissionHours: record.permissionHours || 0,
      permissionCount: record.permissionCount || 0,
      hasLeave: hasLeave,
      leaveInfo: leaveMap[record.date] || null,
      hasOD: hasOD,
      odInfo: odMap[record.date] || null,
      isConflict: isConflict,
      isEdited: record.isEdited || false,
      editHistory: record.editHistory || [],
      source: record.source || [],
      shifts: record.shifts || []
    };
  });

  // Fill in missing dates with Leave/OD info
  Object.keys(leaveMap).forEach(dateStr => {
    if (!attendanceMap[dateStr]) {
      attendanceMap[dateStr] = {
        date: dateStr,
        status: 'LEAVE',
        hasLeave: true,
        leaveInfo: leaveMap[dateStr],
        hasOD: !!odMap[dateStr],
        odInfo: odMap[dateStr] || null,
        isConflict: false,
      };
    }
  });

  Object.keys(odMap).forEach(dateStr => {
    if (!attendanceMap[dateStr]) {
      attendanceMap[dateStr] = {
        date: dateStr,
        status: 'OD',
        hasLeave: !!leaveMap[dateStr],
        leaveInfo: leaveMap[dateStr] || null,
        hasOD: true,
        odInfo: odMap[dateStr],
        isConflict: false,
      };
    }
  });

  return attendanceMap;
};

/**
 * Get attendance data for table view (Multiple Employees)
 */
exports.getMonthlyTableViewData = async (employees, year, month, startQueryDate, endQueryDate) => {
  const targetYear = parseInt(year);
  const targetMonth = parseInt(month);

  let startDate = startQueryDate;
  let endDateStr = endQueryDate;

  // If dates not provided, resolve using payroll cycle
  if (!startDate || !endDateStr) {
    const anchorDateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-15`;
    const periodInfo = await dateCycleService.getPeriodInfo(new Date(anchorDateStr));
    
    if (!startDate) startDate = extractISTComponents(periodInfo.payrollCycle.startDate).dateStr;
    if (!endDateStr) endDateStr = extractISTComponents(periodInfo.payrollCycle.endDate).dateStr;
  }

  const startDateObj = new Date(startDate);
  const endDateObj = new Date(endDateStr);
  endDateObj.setHours(23, 59, 59, 999);

  // Helper function to get dates in range
  const getDatesInRange = (start, end) => {
    const dates = [];
    const current = new Date(start);
    const last = new Date(end);

    current.setHours(0, 0, 0, 0);
    last.setHours(0, 0, 0, 0);

    while (current <= last) {
      dates.push(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  };

  const datesInRange = getDatesInRange(startDate, endDateStr);

  // Get all attendance records for the month (Using .lean() and projections)
  const empNos = employees.map(e => e.emp_no);
  const attendanceRecords = await AttendanceDaily.find({
    employeeNumber: { $in: empNos },
    date: { $gte: startDate, $lte: endDateStr },
  })
    .select('employeeNumber date status shifts totalWorkingHours totalLateInMinutes totalEarlyOutMinutes totalExpectedHours totalOTHours extraHours permissionHours permissionCount notes earlyOutDeduction isEdited editHistory')
    .populate('shifts.shiftId', 'name startTime endTime duration payableShifts')
    .sort({ employeeNumber: 1, date: 1 })
    .lean();

  // Get all approved leaves
  const empIds = employees.map(e => e._id);
  const allLeaves = await Leave.find({
    employeeId: { $in: empIds },
    status: 'approved',
    $or: [
      { fromDate: { $lte: endDateObj }, toDate: { $gte: startDateObj } },
    ],
    isActive: true,
  })
    .select('employeeId fromDate toDate leaveType isHalfDay halfDayType numberOfDays')
    .populate('employeeId', 'emp_no')
    .lean();

  // Get all approved ODs
  const allODs = await OD.find({
    employeeId: { $in: empIds },
    status: 'approved',
    $or: [
      { fromDate: { $lte: endDateObj }, toDate: { $gte: startDateObj } },
    ],
    isActive: true,
  })
    .select('employeeId fromDate toDate odType odType_extended isHalfDay halfDayType odStartTime odEndTime purpose placeVisited photoEvidence geoLocation')
    .populate('employeeId', 'emp_no')
    .lean();

  // Create Leave Map
  const leaveMapByEmployee = {};
  allLeaves.forEach(leave => {
    const empNo = leave.employeeId?.emp_no || leave.emp_no;
    if (!empNo) return;
    if (!leaveMapByEmployee[empNo]) leaveMapByEmployee[empNo] = {};

    const leaveStart = new Date(leave.fromDate);
    const leaveEnd = new Date(leave.toDate);
    leaveStart.setHours(0, 0, 0, 0);
    leaveEnd.setHours(23, 59, 59, 999);

    let currentDate = new Date(leaveStart);
    while (currentDate <= leaveEnd) {
      const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
      if (dateStr >= startDate && dateStr <= endDateStr) {
        leaveMapByEmployee[empNo][dateStr] = {
          leaveId: leave._id,
          leaveType: leave.leaveType,
          isHalfDay: leave.isHalfDay,
          halfDayType: leave.halfDayType,
          numberOfDays: leave.numberOfDays,
        };
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }
  });

  // Create OD Map
  const odMapByEmployee = {};
  allODs.forEach(od => {
    const empNo = od.employeeId?.emp_no || od.emp_no;
    if (!empNo) return;
    if (!odMapByEmployee[empNo]) odMapByEmployee[empNo] = {};

    const odStart = new Date(od.fromDate);
    const odEnd = new Date(od.toDate);
    odStart.setHours(0, 0, 0, 0);
    odEnd.setHours(23, 59, 59, 999);

    let currentDate = new Date(odStart);
    while (currentDate <= odEnd) {
      const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
      if (dateStr >= startDate && dateStr <= endDateStr) {
        odMapByEmployee[empNo][dateStr] = {
          odId: od._id,
          odType: od.odType,
          odType_extended: od.odType_extended,
          isHalfDay: od.isHalfDay,
          halfDayType: od.halfDayType,
          odStartTime: od.odStartTime,
          odEndTime: od.odEndTime,
          placeVisited: od.placeVisited,
          reason: od.purpose,
          purpose: od.purpose,
          photo: od.photoEvidence?.url,
          photoEvidence: od.photoEvidence,
          geoLocation: od.geoLocation,
        };
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }
  });

  // Create Attendance Map
  const attendanceMap = {};
  attendanceRecords.forEach(record => {
    if (!attendanceMap[record.employeeNumber]) attendanceMap[record.employeeNumber] = {};
    attendanceMap[record.employeeNumber][record.date] = record;
  });

  // Optimize Summary Retrieval: Fetch all summaries at once instead of in a loop
  const MonthlyAttendanceSummary = require('../model/MonthlyAttendanceSummary');
  const monthStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
  const preCalculatedSummaries = await MonthlyAttendanceSummary.find({
    employeeId: { $in: empIds },
    month: monthStr
  }).lean();

  const summaryDataMap = {};
  preCalculatedSummaries.forEach(s => {
    summaryDataMap[s.emp_no] = s;
  });

  // Handle missing summaries (only calculate for those that don't exist)
  for (const emp of employees) {
    if (!summaryDataMap[emp.emp_no]) {
      try {
        const newSummary = await calculateMonthlySummary(emp._id, emp.emp_no, targetYear, targetMonth);
        summaryDataMap[emp.emp_no] = newSummary.toObject();
      } catch (err) {
        console.error(`Failed to calculate missing summary for ${emp.emp_no}:`, err);
      }
    }
  }

  // Recalculate Summaries (Verification Logic)
  // The previous summaryPromises block is replaced by the optimized summary retrieval above.
  // The verification logic is now integrated into the final response mapping or can be done here if needed.

  // Build final response structure
  return employees.map(emp => {
    const dailyAttendance = {};
    for (const dateStr of datesInRange) {
      const record = attendanceMap[emp.emp_no]?.[dateStr] || null;
      const leaveInfo = leaveMapByEmployee[emp.emp_no]?.[dateStr] || null;
      const odInfo = odMapByEmployee[emp.emp_no]?.[dateStr] || null;
      const hasLeave = !!leaveInfo;
      const hasOD = !!odInfo;
      const hasAttendance = !!record && (record.status === 'PRESENT' || record.status === 'PARTIAL');
      const odIsHourBased = odInfo?.odType_extended === 'hours';
      const odIsHalfDay = odInfo?.odType_extended === 'half_day' || odInfo?.isHalfDay;
      const isConflict = (hasLeave || (hasOD && !odIsHourBased && !odIsHalfDay)) && hasAttendance;

      let status = 'ABSENT';
      if (record) status = record.status;
      else if (hasLeave) status = 'LEAVE';
      else if (hasOD) status = 'OD';
      else if (new Date(dateStr) > new Date()) status = '-';

      dailyAttendance[dateStr] = {
        date: dateStr,
        status: status,
        // inTime and outTime are now provided within the shifts array for multi-shift support
        totalHours: record?.totalWorkingHours || null,
        lateInMinutes: record?.totalLateInMinutes || 0,
        earlyOutMinutes: record?.totalEarlyOutMinutes || 0,
        isLateIn: record?.totalLateInMinutes > 0,
        isEarlyOut: record?.totalEarlyOutMinutes > 0,
        shiftId: record?.shifts && record.shifts.length > 0 ? record.shifts[0].shiftId : null,
        shifts: record?.shifts || [],
        expectedHours: record?.totalExpectedHours || (record?.shifts && record.shifts.length > 0 && record.shifts[0].shiftId ? record.shifts[0].shiftId.duration : 0),
        otHours: Math.max(record?.otHours || 0, record?.totalOTHours || 0),
        extraHours: record?.extraHours || 0,
        permissionHours: record?.permissionHours || 0,
        permissionCount: record?.permissionCount || 0,
        notes: record?.notes || '',
        earlyOutDeduction: record?.earlyOutDeduction || null,
        hasLeave,
        leaveInfo,
        hasOD,
        odInfo,
        isConflict,
        isEdited: record?.isEdited || false,
        editHistory: record?.editHistory || [],
        source: record?.source || []
      };
    }

    return {
      _id: emp._id, // Keep for legacy if needed
      employee: emp,
      dailyAttendance: dailyAttendance,
      presentDays: summaryDataMap[emp.emp_no]?.totalPresentDays || 0,
      payableShifts: summaryDataMap[emp.emp_no]?.totalPayableShifts || 0,
      summary: summaryDataMap[emp.emp_no] || null
    };
  });
};
