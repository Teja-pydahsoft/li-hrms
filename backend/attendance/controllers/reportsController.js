const AttendanceDaily = require('../model/AttendanceDaily');
const Employee = require('../../employees/model/Employee');
const biometricReportService = require('../services/biometricReportService');
const dayjs = require('dayjs');
const XLSX = require('xlsx');

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
        const { startDate, endDate, departmentId, divisionId, employeeId } = req.query;

        const query = {};
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = startDate;
            if (endDate) query.date.$lte = endDate;
        }

        if (employeeId) {
            const employee = await Employee.findById(employeeId).select('emp_no');
            if (employee) {
                query.employeeNumber = employee.emp_no;
            }
        }

        // Apply filters by fetching relevant employee IDs first if department/division is set
        if (departmentId || divisionId) {
            const empFilter = { is_active: { $ne: false } };
            if (departmentId) empFilter.department_id = departmentId;
            if (divisionId) empFilter.division_id = divisionId;

            const employees = await Employee.find(empFilter).select('emp_no');
            const empNos = employees.map(e => e.emp_no);
            query.employeeNumber = { $in: empNos };
        }

        const limit = parseInt(req.query.limit) || 50;
        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * limit;

        const [attendance, total, statsData] = await Promise.all([
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
                        present: {
                            $sum: {
                                $cond: [
                                    { $in: ["$status", ["PRESENT", "HALF_DAY"]] },
                                    1,
                                    0
                                ]
                            }
                        },
                        absent: { $sum: { $cond: [{ $eq: ["$status", "ABSENT"] }, 1, 0] } },
                        late: { $sum: { $cond: [{ $gt: ["$totalLateInMinutes", 0] }, 1, 0] } }
                    }
                }
            ])
        ]);

        const stats = statsData[0] || { present: 0, absent: 0, late: 0 };

        // Manual join for employee details
        const allEmpNos = [...new Set(attendance.map(a => a.employeeNumber))];
        const employees = await Employee.find({ emp_no: { $in: allEmpNos } })
            .select('emp_no employee_name department_id division_id')
            .populate('department_id', 'name')
            .populate('division_id', 'name')
            .lean();

        const employeeMap = employees.reduce((acc, e) => {
            acc[e.emp_no] = e;
            return acc;
        }, {});

        const reports = attendance.map(record => ({
            ...record,
            employee: employeeMap[record.employeeNumber] || { emp_no: record.employeeNumber, employee_name: 'Unknown' }
        }));

        res.status(200).json({
            success: true,
            count: reports.length,
            total,
            page,
            totalPages: Math.ceil(total / limit),
            stats,
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
        const { startDate, endDate, departmentId, divisionId, employeeId, search, strict } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ success: false, message: 'startDate and endDate are required' });
        }

        const isStrict = strict === 'true';

        // ── 1. Fetch employee map ────────────────────────────────────────────────
        const empQuery = { is_active: { $ne: false } };
        if (departmentId) empQuery.department_id = departmentId;
        if (divisionId) empQuery.division_id = divisionId;
        if (employeeId) empQuery._id = employeeId;
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

        const { logs } = await biometricReportService.getThumbReports(thumbFilters);

        if (!logs || logs.length === 0) {
            return res.status(404).json({ success: false, message: 'No biometric logs found for the selected range' });
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

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance Report');
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


