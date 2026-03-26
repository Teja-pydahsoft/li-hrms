const AttendanceDaily = require('../model/AttendanceDaily');
const Employee = require('../../employees/model/Employee');
const Leave = require('../../leaves/model/Leave');
const Division = require('../../departments/model/Division');
const Department = require('../../departments/model/Department');
const PreScheduledShift = require('../../shifts/model/PreScheduledShift');
const dateCycleService = require('../../leaves/services/dateCycleService');
const biometricReportService = require('../services/biometricReportService');
const dayjs = require('dayjs');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const { calculateMonthlySummary } = require('../services/summaryCalculationService');
const MonthlyAttendanceSummary = require('../model/MonthlyAttendanceSummary');

// Date format DD-Mon-YY (e.g. 01-Dec-25)
function formatPDate(d) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = String(d.getDate()).padStart(2, '0');
    const mon = months[d.getMonth()];
    const yy = String(d.getFullYear()).slice(-2);
    return `${day}-${mon}-${yy}`;
}

// Time format HH.MM (e.g. 7.57, 20.00)
function formatTime(d) {
    if (!d) return '';
    const date = new Date(d);
    const h = date.getHours();
    const m = date.getMinutes();
    return `${h}.${String(m).padStart(2, '0')}`;
}

/**
 * @desc    Get attendance summary report
 * @route   GET /api/attendance/reports/summary
 * @access  Private
 */
exports.getAttendanceReport = async (req, res) => {
    try {
        let { startDate, endDate, departmentId, divisionId, employeeId, designationId, groupBy, month, year } = req.query;

        // --- NEW: Payroll Month Logic ---
        if (month && year) {
            const period = await dateCycleService.getPayrollCycleForMonth(parseInt(year), parseInt(month));
            startDate = dayjs(period.startDate).format('YYYY-MM-DD');
            endDate = dayjs(period.endDate).format('YYYY-MM-DD');
        }

        const query = {};
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = startDate;
            if (endDate) query.date.$lte = endDate;
        }

        if (employeeId && employeeId !== 'all') {
            const empIds = String(employeeId).split(',').filter(id => id && id !== 'all');
            if (empIds.length > 0) {
                const employees = await Employee.find({ _id: { $in: empIds } }).select('emp_no');
                if (employees.length > 0) {
                    query.employeeNumber = { $in: employees.map(e => e.emp_no) };
                }
            }
        }

        // Apply filters by fetching relevant employee IDs first if department/division/designation is set
        if ((departmentId && departmentId !== 'all') || (divisionId && divisionId !== 'all') || (designationId && designationId !== 'all')) {
            const empFilter = { is_active: { $ne: false } };
            
            if (designationId && designationId !== 'all') {
                const desigIds = String(designationId).split(',').filter(id => id && id !== 'all');
                empFilter.designation_id = desigIds.length > 1 ? { $in: desigIds } : desigIds[0];
            }

            if (departmentId && departmentId !== 'all') {
                const deptIds = String(departmentId).split(',').filter(id => id && id !== 'all');
                empFilter.department_id = deptIds.length > 1 ? { $in: deptIds } : deptIds[0];
            } else if (divisionId && divisionId !== 'all') {
                const divIds = String(divisionId).split(',').filter(id => id && id !== 'all');
                const divIdsCount = divIds.length;
                
                // If only division is set, find all departments linked to these divisions
                const divisions = await Division.find({ _id: { $in: divIds } }).select('departments').lean();
                let divisionLinkedDeptIds = [];
                divisions.forEach(div => {
                    if (div.departments) divisionLinkedDeptIds = [...divisionLinkedDeptIds, ...div.departments];
                });
                
                const depts = await Department.find({
                    $or: [
                        { divisions: { $in: divIds } },
                        { _id: { $in: divisionLinkedDeptIds } }
                    ]
                }).select('_id');
                const deptIds = depts.map(d => d._id);
                
                empFilter.$or = [
                    { division_id: { $in: divIds } },
                    { department_id: { $in: deptIds } }
                ];
            }

            const employees = await Employee.find(empFilter).select('emp_no');
            const empNos = employees.map(e => e.emp_no);
            
            if (query.employeeNumber) {
                // If specific employees were already selected, intersect them
                const existingEmpNos = query.employeeNumber.$in || [query.employeeNumber];
                query.employeeNumber = { $in: empNos.filter(eno => existingEmpNos.includes(eno)) };
            } else {
                query.employeeNumber = { $in: empNos };
            }
        }

        const limit = parseInt(req.query.limit) || 50;
        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * limit;
        const PRE = await PreScheduledShift.find({
            date: { $gte: startDate, $lte: endDate },
            status: { $in: ['WO', 'HOL'] }
        }).select('employeeNumber status');

        const nonWorkingMap = {}; // empNo -> { wo: 0, hol: 0 }
        PRE.forEach(p => {
            if (!nonWorkingMap[p.employeeNumber]) nonWorkingMap[p.employeeNumber] = { wo: 0, hol: 0 };
            if (p.status === 'WO') nonWorkingMap[p.employeeNumber].wo++;
            if (p.status === 'HOL') nonWorkingMap[p.employeeNumber].hol++;
        });

        const [attendance, total, statsData, onLeaveCount] = await Promise.all([
            AttendanceDaily.find(query)
                .sort({ date: -1, employeeNumber: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            AttendanceDaily.countDocuments(query),
            AttendanceDaily.aggregate([
                { $match: query },
                {
                    $group: {
                        _id: null,
                        present: { $sum: "$payableShifts" },
                        absent: { $sum: { $cond: [{ $eq: ["$status", "ABSENT"] }, 1, 0] } },
                        late: { $sum: { $cond: [{ $gt: ["$totalLateInMinutes", 0] }, 1, 0] } }
                    }
                }
            ]),
            // Fetch leaves for the count
            Leave.countDocuments({
                status: 'approved',
                isActive: true,
                $or: [
                    { fromDate: { $lte: endDate || new Date() }, toDate: { $gte: startDate || new Date() } }
                ],
                // Apply same employee filters if present
                ...(query.employeeNumber ? { emp_no: query.employeeNumber } : {})
            })
        ]);

        const sDate = dayjs(startDate || new Date());
        const eDate = dayjs(endDate || new Date());
        const daysInRange = Math.max(1, eDate.diff(sDate, 'day') + 1);

        const statsRaw = statsData[0] || { present: 0, absent: 0, late: 0, od: 0 };
        
        // Calculate total employees for overall stats
        let overallEmpFilter = { is_active: { $ne: false } };
        if (designationId && designationId !== 'all') {
            const desigIds = String(designationId).split(',').filter(id => id && id !== 'all');
            overallEmpFilter.designation_id = desigIds.length > 1 ? { $in: desigIds } : desigIds[0];
        }
        if (departmentId && departmentId !== 'all') {
            const deptIds = String(departmentId).split(',').filter(id => id && id !== 'all');
            overallEmpFilter.department_id = deptIds.length > 1 ? { $in: deptIds } : deptIds[0];
        } else if (divisionId && divisionId !== 'all') {
            const divIds = String(divisionId).split(',').filter(id => id && id !== 'all');
            const divisions = await Division.find({ _id: { $in: divIds } }).select('departments').lean();
            let divisionLinkedDeptIds = [];
            divisions.forEach(div => {
                if (div.departments) divisionLinkedDeptIds = [...divisionLinkedDeptIds, ...div.departments];
            });
            const depts = await Department.find({
                $or: [{ divisions: { $in: divIds } }, { _id: { $in: divisionLinkedDeptIds } }]
            }).select('_id');
            const deptIds = depts.map(d => d._id);
            overallEmpFilter.$or = [
                { division_id: { $in: divIds } },
                { department_id: { $in: deptIds } }
            ];
        }
        const totalEmployeesCard = await Employee.countDocuments(overallEmpFilter);
        const allRelevantEmps = await Employee.find(overallEmpFilter).select('emp_no');
        const allEmpNos_all = allRelevantEmps.map(e => e.emp_no);

        let totalWO_all = 0, totalHOL_all = 0;
        allEmpNos_all.forEach(eno => {
            const nw = nonWorkingMap[eno] || { wo: 0, hol: 0 };
            totalWO_all += nw.wo;
            totalHOL_all += nw.hol;
        });
        const avgWO_all = totalEmployeesCard > 0 ? totalWO_all / totalEmployeesCard : 0;
        const avgHOL_all = totalEmployeesCard > 0 ? totalHOL_all / totalEmployeesCard : 0;
        const expectedWorkingDaysOverall = Math.max(0, daysInRange - avgWO_all - avgHOL_all);
        
        const trueOverallAbsent = Math.max(0, (expectedWorkingDaysOverall * totalEmployeesCard) - (statsRaw.present || 0) - (statsRaw.od || 0) - (onLeaveCount || 0));

        const stats = {
            present: Number((statsRaw.present || 0).toFixed(1)),
            absent: Number(trueOverallAbsent.toFixed(1)),
            late: statsRaw.late || 0,
            onLeave: onLeaveCount || 0,
            daysInRange: daysInRange
        };

        // --- NEW: Grouped Summaries Logic ---
        let summaries = [];
        if (groupBy === 'division' || groupBy === 'department' || groupBy === 'employee') {
            const groupField = groupBy === 'division' ? 'division_id' : (groupBy === 'department' ? 'department_id' : '_id');
            
            // Fetch all relevant children (Divisions or Departments)
            let children = [];
            if (groupBy === 'division') {
                children = await Division.find({ isActive: { $ne: false } }).select('name').lean();
            } else if (groupBy === 'department') {
                // Normalize divisionId to a single ID for child filtering
                const activeDivId = Array.isArray(divisionId) ? divisionId[0] : (String(divisionId).split(',').filter(id => id && id !== 'all')[0]);
                if (!activeDivId) return res.status(400).json({ success: false, message: 'Division ID is required for department grouping' });
                
                // Get departments linked in both directions (Department.divisions AND Division.departments)
                const division = await Division.findById(activeDivId).select('departments').lean();
                const divisionLinkedDeptIds = (division && division.departments) ? division.departments : [];

                children = await Department.find({ 
                    isActive: { $ne: false },
                    $or: [
                        { divisions: activeDivId },
                        { _id: { $in: divisionLinkedDeptIds } }
                    ]
                }).select('_id name').lean();
            } else if (groupBy === 'employee') {
                const activeDivId = Array.isArray(divisionId) ? divisionId[0] : (String(divisionId).split(',').filter(id => id && id !== 'all')[0]);
                const activeDeptId = Array.isArray(departmentId) ? departmentId[0] : (String(departmentId).split(',').filter(id => id && id !== 'all')[0]);
                
                if (!activeDeptId) {
                    return res.status(400).json({ success: false, message: 'Department ID is required for employee grouping' });
                }
                
                // Prioritize department_id for employee grouping
                const empFilter = { is_active: { $ne: false }, department_id: activeDeptId };
                
                if (designationId && designationId !== 'all') {
                    const desigIds = String(designationId).split(',').filter(id => id && id !== 'all');
                    empFilter.designation_id = desigIds.length > 1 ? { $in: desigIds } : desigIds[0];
                }

                if (activeDivId) {
                    // Division is already implicitly handled by depts, but we can add it for strictness if needed
                }
                
                const emps = await Employee.find(empFilter).select('employee_name emp_no').lean();
                children = emps.map(e => ({ 
                    _id: e._id, 
                    name: `${e.employee_name} (${e.emp_no})`, 
                    employee_name: e.employee_name, 
                    emp_no: e.emp_no 
                }));
            }

            // For each child, calculate stats
            for (const child of children) {
                let childEmpNos = [];
                let total = 0;

                if (groupBy === 'employee') {
                    childEmpNos = [child.emp_no];
                    total = 1;
                } else {
                    const childEmpFilter = { is_active: { $ne: false } };
                    
                    if (groupBy === 'division') {
                        // Get departments linked to this division
                        const division = await Division.findById(child._id).select('departments').lean();
                        const divisionLinkedDeptIds = (division && division.departments) ? division.departments : [];
                        const depts = await Department.find({
                            $or: [
                                { divisions: child._id },
                                { _id: { $in: divisionLinkedDeptIds } }
                            ]
                        }).select('_id');
                        const deptIds = depts.map(d => d._id);
                        
                        childEmpFilter.$or = [
                            { division_id: child._id },
                            { department_id: { $in: deptIds } }
                        ];
                    } else {
                        // groupBy department
                        childEmpFilter.department_id = child._id;
                        // If we are showing departments for a specific division, filter employees by that division too
                        if (divisionId && divisionId !== 'all') {
                            childEmpFilter.division_id = divisionId;
                        }
                    }
                    
                    const childEmployees = await Employee.find(childEmpFilter).select('emp_no');
                    childEmpNos = childEmployees.map(e => e.emp_no);
                    total = childEmployees.length;
                }
                
                const childQuery = { ...query, employeeNumber: { $in: childEmpNos } };
                
                const [childStatsData, childLeaveCount] = await Promise.all([
                    AttendanceDaily.aggregate([
                        { $match: childQuery },
                        {
                            $group: {
                                _id: null,
                                present: { $sum: "$payableShifts" },
                                absent: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } },
                                late: { $sum: { $cond: [{ $gt: ['$totalLateInMinutes', 0] }, 1, 0] } },
                                od: { $sum: { $cond: [{ $gt: ['$odHours', 0] }, 1, 0] } },
                                lateMinutes: { $sum: "$totalLateInMinutes" },
                                onDuty: { $sum: { $cond: [{ $gt: ["$odHours", 0] }, 1, 0] } }
                            }
                        }
                    ]),
                    Leave.countDocuments({
                        status: 'approved',
                        isActive: true,
                        $or: [{ fromDate: { $lte: endDate || new Date() }, toDate: { $gte: startDate || new Date() } }],
                        emp_no: { $in: childEmpNos }
                    })
                ]);

                const cStats = childStatsData[0] || { present: 0, absent: 0, holiday: 0, late: 0, od: 0 };
                
                // Calculate expected working days for this child group
                let totalWO = 0, totalHOL = 0;
                childEmpNos.forEach(eno => {
                    const nw = nonWorkingMap[eno] || { wo: 0, hol: 0 };
                    totalWO += nw.wo;
                    totalHOL += nw.hol;
                });
                const avgWO = total > 0 ? totalWO / total : 0;
                const avgHOL = total > 0 ? totalHOL / total : 0;
                
                const expectedWorkingDays = Math.max(0, daysInRange - avgWO - avgHOL);
                const trueAbsent = Math.max(0, expectedWorkingDays - (cStats.present || 0) - (cStats.od || 0) - (childLeaveCount || 0));

                summaries.push({
                    id: child._id,
                    name: child.name || child.employee_name,
                    totalCount: total,
                    present: Number((cStats.present || 0).toFixed(1)),
                    absent: Number(trueAbsent.toFixed(1)),
                    avgPresent: total > 0 ? Number(((cStats.present || 0) / total).toFixed(1)) : 0,
                    avgAbsent: total > 0 ? Number((trueAbsent / total).toFixed(1)) : 0,
                    late: cStats.late,
                    lateMinutes: cStats.lateMinutes || 0,
                    onDuty: cStats.onDuty || 0,
                    onLeave: childLeaveCount,
                    presentPercent: expectedWorkingDays > 0 ? 
                        Math.min(100, (((cStats.present || 0) + (cStats.od || 0)) / (expectedWorkingDays * total) * 100)).toFixed(1) : "0.0",
                    lates: cStats.late,
                    leave: childLeaveCount,
                    od: cStats.od,
                    wo: Number(avgWO.toFixed(1)),
                    hol: Number(avgHOL.toFixed(1)),
                    totalPresent: cStats.present,
                    totalAbsent: trueAbsent,
                    totalLate: cStats.late,
                    totalOD: cStats.od,
                    totalWO: Number(avgWO.toFixed(1)),
                    totalHOL: Number(avgHOL.toFixed(1))
                });
            }
        }

        // Manual join for employee details
        const allEmpNos = [...new Set(attendance.map(a => a.employeeNumber))];
        const employeesDetails = await Employee.find({ emp_no: { $in: allEmpNos } })
            .select('emp_no employee_name department_id division_id')
            .populate('department_id', 'name')
            .populate('division_id', 'name')
            .lean();

        const employeeMap = employeesDetails.reduce((acc, e) => {
            acc[e.emp_no] = e;
            return acc;
        }, {});

        const reports = attendance.map(record => ({
            ...record,
            employee: employeeMap[record.employeeNumber] || { emp_no: record.employeeNumber, employee_name: 'Unknown' }
        }));

        res.status(200).json({
            success: true,
            totalCount: total, // Match frontend expectation if needed
            total,
            page,
            totalPages: Math.ceil(total / limit),
            stats,
            summaries, // New grouped summaries
            data: reports
        });
    } catch (error) {
        console.error('Error in getAttendanceReport:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Get raw biometric logs (Thumb Reports)
 * @route   GET /api/attendance/reports/thumb
 * @access  Private
 */
exports.getThumbReports = async (req, res) => {
    try {
        const { startDate, endDate, employeeId, limit, page, search } = req.query;

        const filters = {
            startDate,
            endDate,
            limit: parseInt(limit) || 50,
            page: parseInt(page) || 1
        };

        const PRE = await PreScheduledShift.find({
            date: { $gte: startDate, $lte: endDate },
            status: { $in: ['WO', 'HOL'] }
        }).select('employeeNumber status');

        const nonWorkingMap = {}; // empNo -> { wo: 0, hol: 0 }
        PRE.forEach(p => {
            if (!nonWorkingMap[p.employeeNumber]) nonWorkingMap[p.employeeNumber] = { wo: 0, hol: 0 };
            if (p.status === 'WO') nonWorkingMap[p.employeeNumber].wo++;
            if (p.status === 'HOL') nonWorkingMap[p.employeeNumber].hol++;
        });

        if (employeeId && employeeId !== 'all') {
            const employee = await Employee.findById(employeeId).select('emp_no');
            if (employee) {
                filters.employeeId = employee.emp_no;
            }
        } else if (search) {
            const employees = await Employee.find({
                $or: [
                    { employee_name: { $regex: search, $options: 'i' } },
                    { emp_no: { $regex: search, $options: 'i' } }
                ]
            }).select('emp_no').lean();
            filters.employeeIds = employees.map(e => e.emp_no);
        }

        const result = await biometricReportService.getThumbReports(filters);
        const { logs, total, totalPages } = result;

        // Map employee names for the logs
        const empIds = [...new Set(logs.map(l => l.employeeId))];
        const employees = await Employee.find({ emp_no: { $in: empIds } })
            .select('emp_no employee_name')
            .lean();

        const empMap = employees.reduce((acc, e) => {
            acc[e.emp_no] = e.employee_name;
            return acc;
        }, {});

        const data = logs.map(log => ({
            ...log,
            employeeName: empMap[log.employeeId] || 'Unknown'
        }));

        res.status(200).json({
            success: true,
            count: data.length,
            total,
            page: result.page,
            totalPages,
            data
        });
    } catch (error) {
        console.error('Error in getThumbReports:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Export attendance report as XLSX (Advanced IN/OUT Pairing, 36h window)
 * @route   GET /api/attendance/reports/export
 * @access  Private
 */
exports.exportAttendanceReport = async (req, res) => {
    try {
        let { startDate, endDate, departmentId, divisionId, employeeId, designationId, search, strict, groupBy, month, year } = req.query;

        // --- NEW: Payroll Month Logic ---
        if (month && year) {
            const period = await dateCycleService.getPayrollCycleForMonth(parseInt(year), parseInt(month));
            startDate = dayjs(period.startDate).format('YYYY-MM-DD');
            endDate = dayjs(period.endDate).format('YYYY-MM-DD');
        }

        if (!startDate || !endDate) {
            return res.status(400).json({ success: false, message: 'startDate and endDate are required' });
        }

        const daysInRange = dayjs(endDate).diff(dayjs(startDate), 'day') + 1;

        const isStrict = strict === 'true';

        // ── 0. Build base query for AttendanceDaily ─────────────────────────────
        const query = {};
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = startDate;
            if (endDate) query.date.$lte = endDate;
        }

        // ── 1. Fetch employee map ────────────────────────────────────────────────
        const empQuery = { is_active: { $ne: false }, ...(req.scopeFilter || {}) };
        if (designationId && designationId !== 'all') {
            const desigIds = String(designationId).split(',').filter(id => id && id !== 'all');
            empQuery.designation_id = desigIds.length > 1 ? { $in: desigIds } : desigIds[0];
        }
        if (departmentId && departmentId !== 'all') {
            const deptIds = String(departmentId).split(',').filter(id => id && id !== 'all');
            empQuery.department_id = deptIds.length > 1 ? { $in: deptIds } : deptIds[0];
        }
        if (divisionId && divisionId !== 'all') {
            const divIds = String(divisionId).split(',').filter(id => id && id !== 'all');
            empQuery.division_id = divIds.length > 1 ? { $in: divIds } : divIds[0];
        }
        if (employeeId && employeeId !== 'all') {
            const empIds = String(employeeId).split(',').filter(id => id && id !== 'all');
            empQuery._id = empIds.length > 1 ? { $in: empIds } : empIds[0];
        }
        if (search) {
            empQuery.$or = [
                { employee_name: { $regex: search, $options: 'i' } },
                { emp_no: { $regex: search, $options: 'i' } }
            ];
        }

        const employees = await Employee.find(empQuery)
            .populate('department_id', 'name')
            .populate('division_id', 'name')
            .select('emp_no employee_name department_id division_id')
            .lean();

        const empNosFromHRMS = employees.map(e => String(e.emp_no).toUpperCase());
        if (empNosFromHRMS.length > 0 && (departmentId || divisionId || employeeId || search)) {
            query.employeeNumber = { $in: empNosFromHRMS };
        }
        const empMap = employees.reduce((acc, e) => {
            acc[String(e.emp_no).toUpperCase()] = {
                emp_no: e.emp_no,
                employee_name: (e.employee_name || '').trim() || e.emp_no,
                department: e.department_id?.name || '',
                division: e.division_id?.name || ''
            };
            return acc;
        }, {});

        // ── 2. Fetch raw logs from Atlas (expand range by 36h for cross-midnight OUTs) ──
        const start = new Date(startDate);
        const end = new Date(endDate);
        // Extend the fetch window: start one day before so we don't miss late INs,
        // and end 36 hours after the end date to capture cross-midnight OUTs.
        const fetchStart = new Date(start); fetchStart.setHours(0, 0, 0, 0);
        const fetchEnd = new Date(end); fetchEnd.setHours(23, 59, 59, 999);
        fetchEnd.setTime(fetchEnd.getTime() + 36 * 60 * 60 * 1000); // +36h

        const thumbFilters = {
            startDate: fetchStart.toISOString(),
            endDate: fetchEnd.toISOString(),
            limit: 100000
        };

        // Always scope the Atlas query to relevant employees:
        //  - Single employee selected → use employeeId directly
        //  - Department/division filter (or strict mode) → use the filtered HRMS emp list
        if (employeeId && empNosFromHRMS.length === 1) {
            // Single employee — use the resolved emp_no from HRMS
            thumbFilters.employeeId = empNosFromHRMS[0];
        } else if (empNosFromHRMS.length > 0) {
            // Department / division filter or strict mode — scope to matching employees
            thumbFilters.employeeIds = empNosFromHRMS;
        }

        let logs = [];
        try {
            const result = await biometricReportService.getThumbReports(thumbFilters);
            logs = result.logs || [];
        } catch (err) {
            console.warn('⚠️ Biometric Atlas logs skip: ', err.message);
            // Non-blocking error: allow Excel export to continue without logs sheet
        }

        if (logs.length === 0 && isStrict) {
            // Only fail if strict mode was requested and we have nothing
            // return res.status(404).json({ success: false, message: 'No biometric logs found' });
        }

        // ── 3. Group raw logs by empId → dateKey (use timestamp's local date) ───
        const rawLogsByEmpDate = {}; // empId → dateKey → [{ time, type }]

        const getDateKey = (date) => new Date(date).toISOString().slice(0, 10);

        logs.forEach(log => {
            const empId = String(log.employeeId).toUpperCase();

            // In strict mode skip employees not in HRMS
            if (isStrict && !empMap[empId]) return;

            // Determine logDate based on START date window (ignore logs that fall completely outside)
            const logTime = new Date(log.timestamp);
            const logDateKey = getDateKey(logTime);

            // Only include logs from within the user's requested date range's dates (for IN anchoring)
            // We still allow OUTs beyond endDate for pairing (handled in 36h logic below)
            if (!rawLogsByEmpDate[empId]) rawLogsByEmpDate[empId] = {};
            if (!rawLogsByEmpDate[empId][logDateKey]) rawLogsByEmpDate[empId][logDateKey] = [];

            let type = 'IN';
            const lt = (log.logType || '').toUpperCase();
            if (lt.includes('OUT')) type = 'OUT';

            rawLogsByEmpDate[empId][logDateKey].push({ time: logTime, type });
        });

        // ── 4. Pairing with 36-hour cross-midnight OUT lookup ──────────────────
        const byEmpDate = {}; // empId → dateKey → { pairs, totHrsStr }
        let maxPairs = 1;

        for (const empId in rawLogsByEmpDate) {
            if (!byEmpDate[empId]) byEmpDate[empId] = {};

            // Collect ALL logs for this employee sorted by time
            const allLogs = [];
            for (const dk in rawLogsByEmpDate[empId]) {
                rawLogsByEmpDate[empId][dk].forEach(l => allLogs.push({ ...l, dateKey: dk }));
            }
            allLogs.sort((a, b) => a.time - b.time);

            // Deduplicate (2-minute window for same type)
            const uniqueLogs = [];
            if (allLogs.length > 0) {
                uniqueLogs.push(allLogs[0]);
                for (let i = 1; i < allLogs.length; i++) {
                    const prev = uniqueLogs[uniqueLogs.length - 1];
                    const curr = allLogs[i];
                    if (curr.type === prev.type && (curr.time - prev.time) < 120000) continue;
                    uniqueLogs.push(curr);
                }
            }

            // State-machine pairing (strict shift, 36-hour OUT window)
            // Group results per the IN's date
            const pairsByDate = {}; // dateKey → { pairs: [], totalHours }

            let pendingIn = null;     // { time: Date, dateKey: string }
            const requestedStart = fetchStart;
            const requestedEnd = new Date(endDate); requestedEnd.setHours(23, 59, 59, 999);

            for (const log of uniqueLogs) {
                if (log.type === 'IN') {
                    // Only anchor new sessions on logs within the *requested* date range
                    const inDate = getDateKey(log.time);
                    const inDay = new Date(inDate);
                    if (inDay < new Date(startDate) || inDay > new Date(endDate)) {
                        // It's a pre/post log — only relevant if it can close a pending IN
                        // (handled in state below — but we can't start new sessions outside range)
                        if (!pendingIn) continue;
                    }

                    if (pendingIn) {
                        const gap = log.time - pendingIn.time;
                        if (gap > 3600000) { // >1h → orphan the previous IN
                            if (!pairsByDate[pendingIn.dateKey]) pairsByDate[pendingIn.dateKey] = { pairs: [], totalHours: 0 };
                            pairsByDate[pendingIn.dateKey].pairs.push({ in: pendingIn.time, out: null });
                        }
                        // ≤1h → debounce, keep the earlier IN
                        else { continue; }
                    }
                    pendingIn = { time: log.time, dateKey: getDateKey(log.time) };

                } else { // OUT
                    if (pendingIn) {
                        const gap = log.time - pendingIn.time;
                        // 36-hour window: accept OUT only if within 36h of the IN
                        if (gap <= 36 * 3600000 && gap > 0) {
                            const hrs = gap / (1000 * 60 * 60);
                            if (!pairsByDate[pendingIn.dateKey]) pairsByDate[pendingIn.dateKey] = { pairs: [], totalHours: 0 };
                            pairsByDate[pendingIn.dateKey].totalHours += hrs;
                            pairsByDate[pendingIn.dateKey].pairs.push({ in: pendingIn.time, out: log.time });
                            pendingIn = null;
                        } else if (gap > 36 * 3600000) {
                            // OUT is too far away — close the IN as orphan and let this OUT become orphan too
                            if (!pairsByDate[pendingIn.dateKey]) pairsByDate[pendingIn.dateKey] = { pairs: [], totalHours: 0 };
                            pairsByDate[pendingIn.dateKey].pairs.push({ in: pendingIn.time, out: null });
                            pendingIn = null;
                        }
                        // Else gap ≤0 (shouldn't happen) — ignore
                    }
                    // Orphan OUT — ignore
                }
            }
            // Finalize open IN
            if (pendingIn) {
                if (!pairsByDate[pendingIn.dateKey]) pairsByDate[pendingIn.dateKey] = { pairs: [], totalHours: 0 };
                pairsByDate[pendingIn.dateKey].pairs.push({ in: pendingIn.time, out: null });
            }

            // Only include dates within the requested range
            for (const dk in pairsByDate) {
                const dkDay = new Date(dk);
                if (dkDay < new Date(startDate) || dkDay > new Date(endDate)) continue;
                const d = pairsByDate[dk];
                byEmpDate[empId][dk] = {
                    pairs: d.pairs,
                    totHrsStr: d.totalHours > 0 ? d.totalHours.toFixed(2) : ''
                };
                if (d.pairs.length > maxPairs) maxPairs = d.pairs.length;
            }
        }

        // ── 5. Build grouped rows ────────────────────────────────────────────────
        // Merge employees not in HRMS empMap but seen in logs (non-strict only)
        for (const empId of Object.keys(byEmpDate)) {
            if (!empMap[empId]) {
                empMap[empId] = { emp_no: empId, employee_name: empId, department: '', division: '' };
            }
        }

        const groups = {};
        for (const empId of Object.keys(byEmpDate)) {
            const info = empMap[empId];
            const key = `${info.division}\t${info.department}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(empId);
        }

        const sortedGroups = Object.keys(groups).sort();
        const rows = [];
        let sno = 0;

        for (let g = 0; g < sortedGroups.length; g++) {
            const key = sortedGroups[g];
            const [division, department] = key.split('\t');
            const empIds = groups[key].sort((a, b) =>
                (empMap[a]?.employee_name || '').localeCompare(empMap[b]?.employee_name || ''));

            for (const empId of empIds) {
                const info = empMap[empId];
                const dates = Object.keys(byEmpDate[empId]).sort();

                for (const dk of dates) {
                    const { pairs, totHrsStr } = byEmpDate[empId][dk];
                    const row = {
                        'SNO': ++sno,
                        'E.NO': info.emp_no,
                        'EMPLOYEE NAME': info.employee_name,
                        'DIVISION': division || '',
                        'DEPARTMENT': department || '',
                        'PDate': formatPDate(new Date(dk))
                    };
                    for (let i = 0; i < maxPairs; i++) {
                        row[`IN ${i + 1}`] = pairs[i]?.in ? formatTime(pairs[i].in) : '';
                        row[`OUT ${i + 1}`] = pairs[i]?.out ? formatTime(pairs[i].out) : '';
                    }
                    row['TOT HRS'] = totHrsStr;
                    rows.push(row);
                }
            }
            // Blank rows between groups
            if (g < sortedGroups.length - 1) {
                for (let i = 0; i < 3; i++) rows.push({});
            }
        }

        // ── 6. Build dynamic header & write XLSX ────────────────────────────────
        const fixedHeaders = ['SNO', 'E.NO', 'EMPLOYEE NAME', 'DIVISION', 'DEPARTMENT', 'PDate'];
        const dynamicHeaders = [];
        for (let i = 1; i <= maxPairs; i++) dynamicHeaders.push(`IN ${i}`, `OUT ${i}`);
        const finalHeaders = [...fixedHeaders, ...dynamicHeaders, 'TOT HRS'];

        const worksheet = XLSX.utils.json_to_sheet(rows, { header: finalHeaders });
        // Column widths
        const wscols = finalHeaders.map(() => ({ wch: 13 }));
        wscols[2] = { wch: 28 }; // EMPLOYEE NAME
        worksheet['!cols'] = wscols;

        // ── 6. Build Abstract Sheet & Write XLSX ─────────────────────────────
        const workbook = XLSX.utils.book_new();

        if (groupBy === 'division' || groupBy === 'department' || groupBy === 'employee') {
            // Fetch similar summaries as in getAttendanceReport
            let children = [];
            if (groupBy === 'division') {
                const divIds = (divisionId && divisionId !== 'all') ? String(divisionId).split(',').filter(id => id && id !== 'all') : [];
                const divQuery = { is_active: { $ne: false }, ...(req.scopeFilter || {}) };
                if (divIds.length > 0) divQuery._id = { $in: divIds };
                children = await Division.find(divQuery).select('name').lean();
            } else if (groupBy === 'department') {
                const divIds = (divisionId && divisionId !== 'all') ? String(divisionId).split(',').filter(id => id && id !== 'all') : [];
                const deptQuery = { is_active: { $ne: false }, ...(req.scopeFilter || {}) };
                if (divIds.length > 0) deptQuery.divisions = { $in: divIds };
                children = await Department.find(deptQuery).select('name').lean();
            } else if (groupBy === 'employee') {
                const empQuery = { is_active: { $ne: false }, ...(req.scopeFilter || {}) };
                if (designationId && designationId !== 'all') {
                    const desigIds = String(designationId).split(',').filter(id => id && id !== 'all');
                    empQuery.designation_id = { $in: desigIds };
                }
                if (departmentId && departmentId !== 'all') {
                    const deptIds = String(departmentId).split(',').filter(id => id && id !== 'all');
                    empQuery.department_id = { $in: deptIds };
                }
                if (divisionId && divisionId !== 'all') {
                    const divIds = String(divisionId).split(',').filter(id => id && id !== 'all');
                    empQuery.division_id = { $in: divIds };
                }
                const emps = await Employee.find(empQuery).select('emp_no employee_name').lean();
                children = emps.map(e => ({ _id: e._id, name: e.employee_name, emp_no: e.emp_no }));
            }

            const PRE = await PreScheduledShift.find({
                date: { $gte: startDate, $lte: endDate },
                status: { $in: ['WO', 'HOL'] }
            }).select('employeeNumber status');

            const nonWorkingMap = {}; 
            PRE.forEach(p => {
                if (!nonWorkingMap[p.employeeNumber]) nonWorkingMap[p.employeeNumber] = { wo: 0, hol: 0 };
                if (p.status === 'WO') nonWorkingMap[p.employeeNumber].wo++;
                if (p.status === 'HOL') nonWorkingMap[p.employeeNumber].hol++;
            });

            const abstractRows = [
                ['ATTENDANCE SUMMARY REPORT'],
                ['Period', `${startDate} to ${endDate}`],
                ['Level', groupBy.toUpperCase()],
                [''],
                ['Name', 'E.NO', 'Headcount', 'P', 'A', 'L', 'OD', 'LVE', 'WO', 'HOL', 'Present %']
            ];

            for (const child of children) {
                const childEmpFilter = { is_active: { $ne: false } };
                
                if (groupBy === 'division') {
                    const division = await Division.findById(child._id).select('departments').lean();
                    const divisionLinkedDeptIds = (division && division.departments) ? division.departments : [];
                    const depts = await Department.find({
                        $or: [
                            { divisions: child._id },
                            { _id: { $in: divisionLinkedDeptIds } }
                        ]
                    }).select('_id');
                    const deptIds = depts.map(d => d._id);
                    childEmpFilter.$or = [
                        { division_id: child._id },
                        { department_id: { $in: deptIds } }
                    ];
                } else if (groupBy === 'department') {
                    childEmpFilter.department_id = child._id;
                    if (divisionId && divisionId !== 'all') {
                        childEmpFilter.division_id = divisionId;
                    }
                } else if (groupBy === 'employee') {
                    childEmpFilter.emp_no = child.emp_no;
                }

                const childEmployees = await Employee.find(childEmpFilter).select('emp_no');
                const childEmpNos = childEmployees.map(e => e.emp_no);
                const childQuery = { ...query, employeeNumber: { $in: childEmpNos } };

                const [childStatsData, childLeaveCount] = await Promise.all([
                    AttendanceDaily.aggregate([
                        { $match: childQuery },
                        { 
                            $group: { 
                                _id: null, 
                                present: { $sum: "$payableShifts" }, 
                                absent: { $sum: { $cond: [{ $eq: ["$status", "ABSENT"] }, 1, 0] } }, 
                                late: { $sum: { $cond: [{ $gt: ["$totalLateInMinutes", 0] }, 1, 0] } },
                                od: { $sum: { $cond: [{ $gt: ["$odHours", 0] }, 1, 0] } }
                            } 
                        }
                    ]),
                    Leave.countDocuments({ 
                        status: 'approved', 
                        isActive: true, 
                        $or: [{ fromDate: { $lte: endDate }, toDate: { $gte: startDate } }], 
                        emp_no: { $in: childEmpNos } 
                    })
                ]);

                const cStats = childStatsData[0] || { present: 0, absent: 0, late: 0, od: 0 };
                const total = childEmployees.length;
                
                let totalWO = 0, totalHOL = 0;
                childEmpNos.forEach(eno => {
                    const nw = nonWorkingMap[eno] || { wo: 0, hol: 0 };
                    totalWO += nw.wo;
                    totalHOL += nw.hol;
                });
                const avgWO = total > 0 ? totalWO / total : 0;
                const avgHOL = total > 0 ? totalHOL / total : 0;
                
                const expectedWorkingDays = Math.max(0, daysInRange - avgWO - avgHOL);
                const trueAbsent = Math.max(0, expectedWorkingDays - (cStats.present || 0) - (cStats.od || 0) - (childLeaveCount || 0));

                abstractRows.push([
                    child.name,
                    child.emp_no || '-',
                    total,
                    Number((cStats.present || 0).toFixed(1)),
                    Number(trueAbsent.toFixed(1)),
                    cStats.late,
                    cStats.od,
                    childLeaveCount,
                    Number(avgWO.toFixed(1)),
                    Number(avgHOL.toFixed(1)),
                    expectedWorkingDays > 0 ? Math.min(100, (((cStats.present || 0) + (cStats.od || 0)) / (expectedWorkingDays * total) * 100)).toFixed(1) + '%' : '0.0%'
                ]);
            }

            const wsSummary = XLSX.utils.aoa_to_sheet(abstractRows);
            XLSX.utils.book_append_sheet(workbook, wsSummary, 'Attendance Summary');
        } else {
            // Standard general summary sheet
            const [statsData, onLeaveCount] = await Promise.all([
                AttendanceDaily.aggregate([
                    { $match: query },
                    { 
                        $group: { 
                            _id: null, 
                            present: { $sum: "$payableShifts" }, 
                            absent: { $sum: { $cond: [{ $eq: ["$status", "ABSENT"] }, 1, 0] } }, 
                            late: { $sum: { $cond: [{ $gt: ["$totalLateInMinutes", 0] }, 1, 0] } },
                            od: { $sum: { $cond: [{ $gt: ["$odHours", 0] }, 1, 0] } }
                        } 
                    }
                ]),
                Leave.countDocuments({ status: 'approved', isActive: true, $or: [{ fromDate: { $lte: endDate }, toDate: { $gte: startDate } }], ...(query.employeeNumber ? { emp_no: query.employeeNumber } : {}) })
            ]);

            const statsRaw = statsData[0] || { present: 0, absent: 0, late: 0, od: 0 };
            
            const totalEmpQuery = { is_active: { $ne: false } };
            if (designationId && designationId !== 'all') {
                const desigIds = String(designationId).split(',').filter(id => id && id !== 'all');
                totalEmpQuery.designation_id = { $in: desigIds };
            }
            if (divisionId && divisionId !== 'all') {
                const divIds = String(divisionId).split(',').filter(id => id && id !== 'all');
                totalEmpQuery.division_id = { $in: divIds };
            }
            if (departmentId && departmentId !== 'all') {
                const deptIds = String(departmentId).split(',').filter(id => id && id !== 'all');
                totalEmpQuery.department_id = { $in: deptIds };
            }

            const totalEmployees = await Employee.countDocuments(totalEmpQuery);
            const allSelectedEmps = await Employee.find(totalEmpQuery).select('emp_no');
            const allEmpNos_sel = allSelectedEmps.map(e => e.emp_no);

            let totalWO_sel = 0, totalHOL_sel = 0;
            allEmpNos_sel.forEach(eno => {
                const nw = nonWorkingMap[eno] || { wo: 0, hol: 0 };
                totalWO_sel += nw.wo;
                totalHOL_sel += nw.hol;
            });
            const avgWO_sel = totalEmployees > 0 ? totalWO_sel / totalEmployees : 0;
            const avgHOL_sel = totalEmployees > 0 ? totalHOL_sel / totalEmployees : 0;
            const expectedWorkingDays_sel = Math.max(0, daysInRange - avgWO_sel - avgHOL_sel);
            const trueOverallAbsent_sel = Math.max(0, (expectedWorkingDays_sel * totalEmployees) - (statsRaw.present || 0) - (statsRaw.od || 0) - (onLeaveCount || 0));

            const abstractData = [
                ['GENERAL ATTENDANCE SUMMARY'], 
                ['Period', `${startDate} to ${endDate}`], 
                ['Filter', `${divisionId !== 'all' ? 'Division: ' + divisionId : 'All Divisions'} | ${departmentId !== 'all' ? 'Dept: ' + departmentId : 'All Depts'}`], 
                [''], 
                ['Metric', 'Count'], 
                ['Present (P)', Number((statsRaw.present || 0).toFixed(1))], 
                ['Absent (A)', Number(trueOverallAbsent_sel.toFixed(1))], 
                ['Late (L)', statsRaw.late], 
                ['On Duty (OD)', statsRaw.od],
                ['On Leave', onLeaveCount], 
                ['Week Off (WO)', Number(avgWO_sel.toFixed(1))],
                ['Holiday (HOL)', Number(avgHOL_sel.toFixed(1))],
                [''], 
                ['Total Headcount', totalEmployees],
                ['Expected Working Days (Avg)', expectedWorkingDays_sel.toFixed(1)]
            ];
            const wsAbstract = XLSX.utils.aoa_to_sheet(abstractData);
            XLSX.utils.book_append_sheet(workbook, wsAbstract, 'Summary Abstract');
        }

        // Sheet 2: Biometric Primary Logs
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Biometric Logs');

        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        const fname = `attendance_report_${startDate}_${endDate}.xlsx`;
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
        res.send(buffer);

    } catch (error) {
        console.error('Error in exportAttendanceReport:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Helper to draw summary boxes
 */
const drawSummaryBox = (doc, label, value, x, y, width, height, color) => {
    doc.fillColor('#f8f9fa').rect(x, y, width, height).fill();
    doc.fillColor(color).rect(x, y, 4, height).fill(); // Color strip
    doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text(label.toUpperCase(), x + 10, y + 8);
    doc.fillColor('#1e293b').fontSize(14).font('Helvetica-Bold').text(value, x + 10, y + 20);
};

/**
 * Helper to draw a modern table in PDFKit
 */
const drawPDFTableModern = (doc, headers, data, startX, startY, colWidths, options = {}) => {
    const { headerFill = '#4f46e5', rowFill = '#f8fafc', fontSize = 8, onPageAdd } = options;
    let y = startY;
    const tableWidth = colWidths.reduce((a, b) => a + b, 0);
    // Explicitly use landscape if not specified, or use current page layout
    const layout = options.layout || doc.page?.layout || 'landscape';
    const pageHeight = layout === 'landscape' ? 595.28 : 841.89;
    const threshold = pageHeight - 70; // Tighten footer space

    // Draw Header
    doc.fillColor(headerFill).rect(startX, y, tableWidth, 24).fill();
    doc.fillColor('#FFFFFF').fontSize(fontSize).font('Helvetica-Bold');
    
    let x = startX;
    headers.forEach((h, i) => {
        doc.text(h, x + 5, y + 8, { width: colWidths[i] - 10, align: 'left' });
        x += colWidths[i];
    });
    
    y += 24;
    doc.font('Helvetica').fontSize(fontSize).fillColor('#33414d');

    // Draw Rows
    data.forEach((row, rowIndex) => {
        // Special case: Section Header (String instead of Array)
        if (typeof row === 'string') {
            doc.fillColor('#f1f5f9').rect(startX, y, tableWidth, 20).fill();
            doc.fillColor('#4f46e5').fontSize(fontSize + 1).font('Helvetica-Bold').text(row.toUpperCase(), startX + 5, y + 5);
            y += 20;
            return;
        }

        // Check for page break
        if (y > threshold) {
            doc.addPage({ size: 'A4', layout: layout, margin: 25 });
            if (onPageAdd) onPageAdd();
            y = onPageAdd ? 65 : 50; 
            
            // Re-draw header
            doc.fillColor(headerFill).rect(startX, y, tableWidth, 24).fill();
            doc.fillColor('#FFFFFF').fontSize(fontSize).font('Helvetica-Bold');
            let xH = startX;
            headers.forEach((h, i) => {
                doc.text(h, xH + 5, y + 8, { width: colWidths[i] - 10, align: 'left' });
                xH += colWidths[i];
            });
            y += 24;
            doc.font('Helvetica').fontSize(fontSize).fillColor('#33414d');
        }

        if (rowIndex % 2 === 0) {
            doc.fillColor(rowFill).rect(startX, y, tableWidth, 20).fill();
        }

        doc.fillColor('#33414d');
        let xRow = startX;
        row.forEach((cell, i) => {
            doc.text(String(cell || ''), xRow + 5, y + 6, { 
                width: colWidths[i] - 10, 
                align: 'left', 
                lineBreak: false,
                ellipsis: true
            });
            xRow += colWidths[i];
        });
        y += 20;

        // Subtle row line
        doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(startX, y).lineTo(startX + tableWidth, y).stroke();
    });

    return y;
};

/**
 * @desc    Export attendance summary report as PDF
 * @route   GET /api/attendance/reports/export-pdf
 * @access  Private
 */
exports.exportAttendanceReportPDF = async (req, res) => {
    console.log('--- EXPORT PDF CALLED ---', req.query);
    try {
        let { startDate, endDate, departmentId, divisionId, employeeId, designationId, search, strict, groupBy, month, year } = req.query;

        // Sync dates for payroll months
        if (month && year) {
            const period = await dateCycleService.getPayrollCycleForMonth(parseInt(year), parseInt(month));
            startDate = dayjs(period.startDate).format('YYYY-MM-DD');
            endDate = dayjs(period.endDate).format('YYYY-MM-DD');
        }

        if (!startDate || !endDate) {
            return res.status(400).json({ success: false, message: 'startDate and endDate are required' });
        }

        const isStrict = strict === 'true';

        // --- BRANCH: Summary Report (Division/Department aggregate) ---
        if (groupBy === 'division' || groupBy === 'department') {
            let children = [];
            if (groupBy === 'division') {
                const divIds = (divisionId && divisionId !== 'all') ? String(divisionId).split(',').filter(id => id && id !== 'all') : [];
                const divQuery = { is_active: { $ne: false }, ...(req.scopeFilter || {}) };
                if (divIds.length > 0) divQuery._id = { $in: divIds };
                children = await Division.find(divQuery).select('name').lean();
            } else if (groupBy === 'department') {
                const divIds = (divisionId && divisionId !== 'all') ? String(divisionId).split(',').filter(id => id && id !== 'all') : [];
                const deptQuery = { is_active: { $ne: false }, ...(req.scopeFilter || {}) };
                if (divIds.length > 0) deptQuery.divisions = { $in: divIds };
                children = await Department.find(deptQuery).select('name').lean();
            } else {
                const empQuery = { is_active: { $ne: false } };
                if (designationId && designationId !== 'all') {
                    const desigIds = String(designationId).split(',').filter(id => id && id !== 'all');
                    empQuery.designation_id = { $in: desigIds };
                }
                if (departmentId && departmentId !== 'all') {
                    const deptIds = String(departmentId).split(',').filter(id => id && id !== 'all');
                    empFilter.department_id = { $in: deptIds };
                }
                children = await Employee.find(empQuery).select('emp_no employee_name').lean();
            }

            const PRE = await PreScheduledShift.find({
                date: { $gte: startDate, $lte: endDate },
                status: { $in: ['WO', 'HOL'] }
            }).select('employeeNumber status');

            const nonWorkingMap = {}; 
            PRE.forEach(p => {
                if (!nonWorkingMap[p.employeeNumber]) nonWorkingMap[p.employeeNumber] = { wo: 0, hol: 0 };
                if (p.status === 'WO') nonWorkingMap[p.employeeNumber].wo++;
                if (p.status === 'HOL') nonWorkingMap[p.employeeNumber].hol++;
            });

            const daysInRange = dayjs(endDate).diff(dayjs(startDate), 'day') + 1;

            const doc = new PDFDocument({ margin: 25, size: 'A4', layout: 'landscape', bufferPages: true });
            const fname = `attendance_summary_${startDate}_${endDate}.pdf`;
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
            doc.pipe(res);

            // Header Section
            doc.fillColor('#4f46e5').rect(0, 0, 842, 60).fill();
            doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold').text('HRMS ATTENDANCE SUMMARY', 30, 20);
            doc.fontSize(10).font('Helvetica').text(`Generated on ${dayjs().format('DD MMM YYYY, hh:mm A')}`, 30, 42);
            doc.fillColor('#1e293b').fontSize(12).font('Helvetica-Bold').text(`PERIOD: ${dayjs(startDate).format('DD MMM YYYY')} TO ${dayjs(endDate).format('DD MMM YYYY')}`, 30, 80, { align: 'right' });

            const headers = ['NAME / ENTITY', 'E.NO', 'PRES', 'LVE', 'OD', 'WO', 'HOL', 'OT', 'EX', 'PRM', 'L/E', 'DED', 'PAYABLE'];
            const colWidths = [185, 55, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 60];
            const tableData = [];

            const monthStr = (year && month) ? `${year}-${String(month).padStart(2, '0')}` : null;

            for (const child of children) {
                const childEmpFilter = { is_active: { $ne: false } };
                if (groupBy === 'division') {
                    const division = await Division.findById(child._id).select('departments').lean();
                    const depts = await Department.find({ $or: [{ divisions: child._id }, { _id: { $in: division?.departments || [] } }] }).select('_id');
                    childEmpFilter.$or = [{ division_id: child._id }, { department_id: { $in: depts.map(d => d._id) } }];
                } else if (groupBy === 'department') {
                    childEmpFilter.department_id = child._id;
                } else {
                    childEmpFilter.emp_no = child.emp_no;
                }

                const childEmployees = await Employee.find(childEmpFilter).select('emp_no');
                const childEmpNos = childEmployees.map(e => e.emp_no);
                const childEmpIds = childEmployees.map(e => e._id);

                let entityStats = {
                    present: 0, leaves: 0, od: 0, wo: 0, hol: 0, ot: 0, extra: 0, perm: 0, lateEarly: 0, ded: 0, payable: 0
                };

                // Use MonthlyAttendanceSummary if possible for 100% parity
                if (monthStr) {
                    const summaries = await MonthlyAttendanceSummary.find({
                        employeeId: { $in: childEmpIds },
                        month: monthStr
                    }).lean();

                    for (const emp of childEmployees) {
                        let s = summaries.find(x => String(x.employeeId) === String(emp._id));
                        if (!s) {
                            try {
                                s = await calculateMonthlySummary(emp._id, emp.emp_no, parseInt(year), parseInt(month));
                            } catch (err) { console.error('Calc failed', err); }
                        }
                        if (s) {
                            entityStats.present += (s.totalPresentDays || 0);
                            entityStats.leaves += (s.totalLeaves || 0);
                            entityStats.od += (s.totalODs || 0);
                            entityStats.wo += (s.totalWeeklyOffs || 0);
                            entityStats.hol += (s.totalHolidays || 0);
                            entityStats.ot += (s.totalOTHours || 0);
                            entityStats.extra += (s.totalExtraHours || 0);
                            entityStats.perm += (s.totalPermissionHours || 0);
                            entityStats.lateEarly += (s.lateOrEarlyCount || 0);
                            entityStats.ded += (s.totalAttendanceDeductionDays || 0);
                            entityStats.payable += (s.totalPayableShifts || 0);
                        }
                    }
                } else {
                    // Fallback to legacy aggregate if no month provided (rare for PDF)
                    const stats = await AttendanceDaily.aggregate([
                        { $match: { date: { $gte: startDate, $lte: endDate }, employeeNumber: { $in: childEmpNos } } },
                        { $group: {
                            _id: null,
                            present: { $sum: "$payableShifts" },
                            lateEarly: { $sum: { $cond: [{ $or: [{ $gt: ["$totalLateInMinutes", 0] }, { $gt: ["$totalEarlyOutMinutes", 0] }] }, 1, 0] } },
                            ot: { $sum: "$totalOTHours" },
                            extra: { $sum: "$extraHours" },
                            perm: { $sum: "$permissionHours" },
                            ded: { $sum: "$attendanceDeductionDays" }
                        }}
                    ]);
                    const s = stats[0] || {};
                    entityStats.present = s.present || 0;
                    entityStats.lateEarly = s.lateEarly || 0;
                    entityStats.ot = s.ot || 0;
                    entityStats.extra = s.extra || 0;
                    entityStats.perm = s.perm || 0;
                    entityStats.ded = s.ded || 0;
                    entityStats.payable = s.present || 0;
                    // Leaves/ODs would still be missing in this fallback case
                }
                
                tableData.push([
                    child.employee_name || child.name,
                    child.emp_no || '-',
                    entityStats.present.toFixed(1),
                    entityStats.leaves.toFixed(1),
                    entityStats.od.toFixed(1),
                    entityStats.wo.toFixed(1),
                    entityStats.hol.toFixed(1),
                    entityStats.ot.toFixed(2),
                    entityStats.extra.toFixed(2),
                    entityStats.perm.toFixed(2),
                    entityStats.lateEarly,
                    entityStats.ded.toFixed(1),
                    entityStats.payable.toFixed(1)
                ]);
            }

            drawPDFTableModern(doc, headers, tableData, 30, doc.y + 20, colWidths);
            const pages = doc.bufferedPageRange();
            for (let i = 0; i < pages.count; i++) {
                doc.switchToPage(i);
                doc.fontSize(8).fillColor('#94a3b8').text(`Generated by Antigravity HRMS | Page ${i + 1} of ${pages.count}`, 30, doc.page.height - 30, { align: 'center' });
            }
            doc.end();
            return;
        }

        // --- BRANCH: Detailed Tabular Report (Two-Section: Logs + Summary) ---
        
        // 1. Fetch employees
        const empQuery = { is_active: { $ne: false }, ...(req.scopeFilter || {}) };
        if (designationId && designationId !== 'all') {
            const desigIds = String(designationId).split(',').filter(id => id && id !== 'all');
            empQuery.designation_id = { $in: desigIds };
        }
        if (departmentId && departmentId !== 'all') {
            const deptIds = String(departmentId).split(',').filter(id => id && id !== 'all');
            empQuery.department_id = { $in: deptIds };
        }
        if (divisionId && divisionId !== 'all') {
            const divIds = String(divisionId).split(',').filter(id => id && id !== 'all');
            empQuery.division_id = { $in: divIds };
        }
        if (employeeId && employeeId !== 'all') {
            const empIds = String(employeeId).split(',').filter(id => id && id !== 'all');
            empQuery._id = { $in: empIds };
        }
        if (search) {
            empQuery.$or = [{ employee_name: { $regex: search, $options: 'i' } }, { emp_no: { $regex: search, $options: 'i' } }];
        }

        const employees = await Employee.find(empQuery)
            .populate('department_id', 'name')
            .populate('division_id', 'name')
            .select('emp_no employee_name department_id division_id')
            .lean();

        if (employees.length === 0) {
            return res.status(404).json({ success: false, message: 'No employees found with the selected filters' });
        }

        const empNos = employees.map(e => String(e.emp_no).toUpperCase());

        // 2. Fetch Biometric Logs (Gracefully handle missing URI)
        let pairedData = {};
        if (process.env.MONGODB_BIOMETRIC_URI) {
            try {
                const fetchStart = new Date(startDate); fetchStart.setHours(0,0,0,0);
                const fetchEnd = new Date(endDate); fetchEnd.setHours(23,59,59,999);
                fetchEnd.setTime(fetchEnd.getTime() + 36 * 60 * 60 * 1000); // +36h window

                const logsResult = await biometricReportService.getThumbReports({
                    startDate: fetchStart.toISOString(),
                    endDate: fetchEnd.toISOString(),
                    employeeIds: empNos,
                    limit: 100000
                });
                const logs = logsResult.logs || [];

                // Pairing logic (Mirroring reportsController.js)
                const byEmpDate = {};
                logs.forEach(log => {
                    const eid =String(log.employeeId).toUpperCase();
                    const time = new Date(log.timestamp);
                    const dk = time.toISOString().slice(0, 10);
                    if (!byEmpDate[eid]) byEmpDate[eid] = {};
                    if (!byEmpDate[eid][dk]) byEmpDate[eid][dk] = [];
                    let type = 'IN';
                    if ((log.logType || '').toUpperCase().includes('OUT')) type = 'OUT';
                    byEmpDate[eid][dk].push({ time, type });
                });

                for (const eid of Object.keys(byEmpDate)) {
                    const allLogs = [];
                    for (const dk in byEmpDate[eid]) byEmpDate[eid][dk].forEach(l => allLogs.push(l));
                    allLogs.sort((a,b) => a.time - b.time);
                    
                    const uniqueLogs = [];
                    if (allLogs.length > 0) {
                        uniqueLogs.push(allLogs[0]);
                        for(let i=1; i<allLogs.length; i++) {
                            if (allLogs[i].type === allLogs[i-1].type && (allLogs[i].time - allLogs[i-1].time) < 120000) continue;
                            uniqueLogs.push(allLogs[i]);
                        }
                    }

                    const pairsByDate = {};
                    let pendingIn = null;
                    for (const log of uniqueLogs) {
                        if (log.type === 'IN') {
                            if (pendingIn && (log.time - pendingIn.time) > 3600000) {
                                const dk = pendingIn.time.toISOString().slice(0, 10);
                                if(!pairsByDate[dk]) pairsByDate[dk] = [];
                                pairsByDate[dk].push({ in: pendingIn.time, out: null });
                            }
                            if (!pendingIn || (log.time - pendingIn.time) > 3600000) pendingIn = { time: log.time };
                        } else {
                            if (pendingIn) {
                                const gap = log.time - pendingIn.time;
                                if (gap <= 36 * 3600000 && gap > 0) {
                                   const dk = pendingIn.time.toISOString().slice(0, 10);
                                   if(!pairsByDate[dk]) pairsByDate[dk] = [];
                                   pairsByDate[dk].push({ in: pendingIn.time, out: log.time });
                                   pendingIn = null;
                                }
                            }
                        }
                    }
                    if (pendingIn) {
                        const dk = pendingIn.time.toISOString().slice(0,10);
                        if(!pairsByDate[dk]) pairsByDate[dk] = [];
                        pairsByDate[dk].push({ in: pendingIn.time, out: null });
                    }
                    pairedData[eid] = pairsByDate;
                }
            } catch (err) {
                console.error('Biometric fetch failed, using Daily Records only:', err);
            }
        }

        // 3. Fetch AttendanceDaily records
        const dailyRecords = await AttendanceDaily.find({
            date: { $gte: startDate, $lte: endDate },
            employeeNumber: { $in: empNos }
        }).lean();
        
        const dailyMap = {};
        dailyRecords.forEach(r => {
            const key = `${String(r.employeeNumber).toUpperCase()}_${r.date}`;
            dailyMap[key] = r;
        });

        // 4. Generate PDF
        // Determine days in range for the grid
        const startDayjs = dayjs(startDate);
        const endDayjs = dayjs(endDate);
        const daysArray = [];
        let curD = startDayjs;
        while (curD.isBefore(endDayjs) || curD.isSame(endDayjs, 'day')) {
            daysArray.push(curD.format('YYYY-MM-DD'));
            curD = curD.add(1, 'day');
        }

        const doc = new PDFDocument({ margin: 25, size: 'A4', layout: 'landscape', bufferPages: true });
        const fname = `attendance_report_${startDate}_${endDate}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
        doc.pipe(res);

        const pWidth = 841.89; const pHeight = 595.28; const m = 25;

        const drawMainHeader = (title, sub = `Period: ${startDate} to ${endDate}`) => {
            doc.fillColor('#4f46e5').rect(0, 0, pWidth, 45).fill();
            doc.fillColor('#ffffff').fontSize(14).font('Helvetica-Bold').text(title, m, 12);
            doc.fontSize(8).font('Helvetica').text(sub, m, 30);
            return 60; // Returns next Y
        };

        // Grouping Data
        const grouped = {};
        employees.forEach(e => {
            const div = e.division_id?.name || 'Unassigned Division';
            const dept = e.department_id?.name || 'Unassigned Department';
            if (!grouped[div]) grouped[div] = {};
            if (!grouped[div][dept]) grouped[div][dept] = [];
            grouped[div][dept].push(e);
        });

        const sumHeaders = ['NAME', 'E.NO', 'PRES', 'LVE', 'OD', 'WO', 'HOL', 'OT', 'EX', 'PRM', 'L/E', 'DED', 'PAYABLE'];
        const sumWidths = [185, 55, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 60];
        const gridHeaders = ['Employee Name', 'Emp ID', ...daysArray.map(d => dayjs(d).date().toString())];
        const gridWidthSum = daysArray.length * 19.5;
        const gridWidths = [150, 55, ...daysArray.map(() => 19.5)]; 

        const sortedDivisions = Object.keys(grouped).sort();
        let firstPageProcessed = false;

        for (const divName of sortedDivisions) {
            const sortedDepts = Object.keys(grouped[divName]).sort();
            for (const deptName of sortedDepts) {
                if (firstPageProcessed) doc.addPage({ size: 'A4', layout: 'landscape', margin: 25 });
                firstPageProcessed = true;

                let currentY = drawMainHeader(`ATTENDANCE REPORT - DIV: ${divName.toUpperCase()}`, `Department: ${deptName.toUpperCase()} | Period: ${startDate} to ${endDate}`);
                
                const deptEmps = grouped[divName][deptName].sort((a,b) => (a.employee_name || '').localeCompare(b.employee_name || ''));
                const deptSumData = [], deptGridData = [];

                const monthStr = (year && month) ? `${year}-${String(month).padStart(2, '0')}` : null;
                const summaries = monthStr ? await MonthlyAttendanceSummary.find({
                    employeeId: { $in: deptEmps.map(e => e._id) },
                    month: monthStr
                }).lean() : [];

                for (const emp of deptEmps) {
                    const eid = String(emp.emp_no).toUpperCase();
                    const eName = emp.employee_name || '-';
                    const empDaily = dailyRecords.filter(r => String(r.employeeNumber).toUpperCase() === eid);
                    
                    let summary = summaries.find(s => String(s.employeeId) === String(emp._id));
                    if (!summary && monthStr) {
                        try {
                            summary = await calculateMonthlySummary(emp._id, emp.emp_no, parseInt(year), parseInt(month));
                        } catch (err) { console.error('Calc failed', err); }
                    }

                    const gridRow = [eName, emp.emp_no];
                    daysArray.forEach(dStr => {
                        const rec = empDaily.find(r => r.date === dStr);
                        if (rec) {
                            let s = '-';
                            if (rec.status === 'PRESENT') s = 'P';
                            else if (rec.status === 'ABSENT') s = 'A';
                            else if (rec.status === 'WEEK_OFF') s = 'WO';
                            else if (rec.status === 'HOLIDAY') s = 'H';
                            else if (rec.status === 'LEAVE') s = 'L';
                            else if (rec.status === 'OD') s = 'OD';
                            else if (rec.status === 'PARTIAL') s = 'PT';
                            else if (rec.status === 'HALF_DAY') s = 'HD';
                            gridRow.push(s);
                        } else {
                            // Check if this date has a leave/OD that might not be in AttendanceDaily
                            const isWO = summary?.contributingDates?.weeklyOffs?.some(cd => cd.date === dStr);
                            const isHOL = summary?.contributingDates?.holidays?.some(cd => cd.date === dStr);
                            const isLve = summary?.contributingDates?.leaves?.some(cd => cd.date === dStr);
                            const isOD = summary?.contributingDates?.ods?.some(cd => cd.date === dStr);
                            
                            if (isLve) gridRow.push('L');
                            else if (isOD) gridRow.push('OD');
                            else if (isWO) gridRow.push('WO');
                            else if (isHOL) gridRow.push('H');
                            else gridRow.push('-');
                        }
                    });

                    deptSumData.push([
                        eName, 
                        emp.emp_no, 
                        (summary?.totalPresentDays || 0).toFixed(1),
                        (summary?.totalLeaves || 0).toFixed(1),
                        (summary?.totalODs || 0).toFixed(1),
                        (summary?.totalWeeklyOffs || 0).toFixed(1),
                        (summary?.totalHolidays || 0).toFixed(1),
                        (summary?.totalOTHours || 0).toFixed(2),
                        (summary?.totalExtraHours || 0).toFixed(2),
                        (summary?.totalPermissionHours || 0).toFixed(2),
                        summary?.lateOrEarlyCount || 0, 
                        (summary?.totalAttendanceDeductionDays || 0).toFixed(1), 
                        (summary?.totalPayableShifts || 0).toFixed(1)
                    ]);
                    deptGridData.push(gridRow);
                }

                // 1. Dept Summary Section
                doc.fillColor('#f8fafc').rect(m, currentY, pWidth - 2 * m, 20).fill();
                doc.fillColor('#4f46e5').fontSize(9).font('Helvetica-Bold').text(`SUMMARY: ${deptName.toUpperCase()}`, m + 10, currentY + 6);
                currentY += 25;

                currentY = drawPDFTableModern(doc, sumHeaders, deptSumData, m, currentY, sumWidths, { 
                    fontSize: 7, 
                    headerFill: '#4f46e5',
                    onPageAdd: () => drawMainHeader(`ATTENDANCE SUMMARY (CONT) - ${divName.toUpperCase()}`, `Dept: ${deptName.toUpperCase()}`)
                });
                
                currentY += 20;
                if (currentY > 450) {
                    doc.addPage({ size: 'A4', layout: 'landscape', margin: 25 });
                    currentY = drawMainHeader(`ATTENDANCE GRID - ${divName.toUpperCase()}`, `Dept: ${deptName.toUpperCase()}`);
                } else {
                    doc.fillColor('#f8fafc').rect(m, currentY, pWidth - 2 * m, 20).fill();
                    doc.fillColor('#4f46e5').fontSize(9).font('Helvetica-Bold').text(`DETAILED GRID: ${deptName.toUpperCase()}`, m + 10, currentY + 6);
                    currentY += 25;
                }

                // 2. Dept Grid Section
                currentY = drawPDFTableModern(doc, gridHeaders, deptGridData, m, currentY, gridWidths, { 
                    fontSize: 6, 
                    rowHeight: 15,
                    onPageAdd: () => drawMainHeader(`ATTENDANCE GRID (CONT) - ${divName.toUpperCase()}`, `Dept: ${deptName.toUpperCase()}`)
                });
            }
        }

        // Add page numbers
        const pages = doc.bufferedPageRange();
        for (let i = 0; i < pages.count; i++) {
            doc.switchToPage(i);
            const footerY = doc.page.height - 35;
            doc.fontSize(7).fillColor('#94a3b8').text(`Generated by Antigravity HRMS | Page ${i + 1} of ${pages.count}`, 0, footerY, { align: 'center', width: doc.page.width });
        }

        doc.end();

    } catch (error) {
        console.error('Error in exportAttendanceReportPDF:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};


