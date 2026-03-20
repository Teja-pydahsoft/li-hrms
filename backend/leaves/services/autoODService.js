const mongoose = require('mongoose');
const OD = require('../model/OD');
const AttendanceDaily = require('../../attendance/model/AttendanceDaily');
const Employee = require('../../employees/model/Employee');
const LeaveSettings = require('../model/LeaveSettings');

/**
 * Scan AttendanceDaily for holiday/week-off punches and create OD requests
 * @param {string} dateStr - Date to scan (YYYY-MM-DD)
 */
const processAutoODForDate = async (dateStr) => {
    try {
        const query = {
            date: dateStr,
            status: { $in: ['HOLIDAY', 'WEEK_OFF'] },
            totalWorkingHours: { $gt: 0 }
        };

        const attendanceRecords = await AttendanceDaily.find(query);
        if (attendanceRecords.length === 0) return;

        console.log(`[AutoOD] Found ${attendanceRecords.length} holiday/week-off attendance records with punches for ${dateStr}.`);

        for (const record of attendanceRecords) {
            await processAutoODForEmployee(record.employeeNumber, dateStr, record);
        }
    } catch (error) {
        console.error('[AutoOD] Error processing date:', dateStr, error);
    }
};

/**
 * Check and create OD for a specific employee and date
 * @param {string} employeeNumber - Employee number
 * @param {string} dateStr - Date (YYYY-MM-DD)
 * @param {Object} record - AttendanceDaily record
 */
const processAutoODForEmployee = async (employeeNumber, dateStr, record) => {
    try {
        if (!record || !['HOLIDAY', 'WEEK_OFF'].includes(record.status) || record.totalWorkingHours <= 0) {
            return;
        }

        // 1. Check if OD already exists for this date and employee
        const recordDate = new Date(record.date + 'T12:00:00Z');
        const existingOD = await OD.findOne({
            emp_no: record.employeeNumber,
            fromDate: { $lte: recordDate },
            toDate: { $gte: recordDate },
            isActive: true,
            status: { $nin: ['cancelled', 'rejected'] }
        });

        if (existingOD) {
            return; // Already exists
        }

        // 2. Extract punch details for fields and remarks
        let punchDetails = '';
        let startT = null;
        let endT = null;
        
        if (record.shifts && record.shifts.length > 0) {
            const sortedShifts = [...record.shifts].sort((a, b) => new Date(a.inTime) - new Date(b.inTime));
            const firstIn = sortedShifts[0].inTime;
            const lastOut = sortedShifts[sortedShifts.length - 1].outTime;
            
            const formatTime = (date) => {
                if (!date) return null;
                const d = new Date(date);
                // Extract HH:mm in IST
                return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
            };

            const formatTimeDisplay = (date) => {
                if (!date) return 'N/A';
                return new Date(date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
            };
            
            startT = formatTime(firstIn);
            endT = formatTime(lastOut);
            punchDetails = ` [IN: ${formatTimeDisplay(firstIn)}, OUT: ${formatTimeDisplay(lastOut)}, Duration: ${record.totalWorkingHours} hrs]`;
        }

        // 3. Get OD workflow settings
        const workflowSettings = await LeaveSettings.getActiveSettings('od');

        // 4. Fetch employee with full details for workflow and snapshotting
        const employee = await Employee.findOne({ emp_no: record.employeeNumber })
            .populate('division_id', 'name')
            .populate('department_id', 'name');

        if (!employee) {
            console.log(`[AutoOD] Employee ${record.employeeNumber} not found in MongoDB. Skipping.`);
            return;
        }

        // 5. Initialize workflow (Mirroring odController.js logic)
        const approvalSteps = [];
        const reportingManagers = employee.dynamicFields?.reporting_to || employee.dynamicFields?.reporting_to_ || [];
        const hasReportingManager = Array.isArray(reportingManagers) && reportingManagers.length > 0;

        if (hasReportingManager) {
            approvalSteps.push({
                stepOrder: 1,
                role: 'reporting_manager',
                label: 'Reporting Manager Approval',
                status: 'pending',
                isCurrent: true
            });
        } else if (workflowSettings?.workflow?.steps?.length) {
            workflowSettings.workflow.steps.forEach((s, i) => {
                approvalSteps.push({
                    stepOrder: i + 1,
                    role: s.approverRole,
                    label: s.stepName || `${s.approverRole?.toUpperCase()} Approval`,
                    status: 'pending',
                    isCurrent: i === 0,
                });
            });
        } else {
            approvalSteps.push(
                { stepOrder: 1, role: 'hod', label: 'HOD Approval', status: 'pending', isCurrent: true },
                { stepOrder: 2, role: 'hr', label: 'HR Approval', status: 'pending', isCurrent: false }
            );
        }

        const workflowData = {
            currentStepRole: approvalSteps[0]?.role || 'hod',
            nextApproverRole: approvalSteps[0]?.role || 'hod',
            currentStep: approvalSteps[0]?.role || 'hod',
            nextApprover: approvalSteps[0]?.role || 'hod',
            approvalChain: approvalSteps,
            finalAuthority: workflowSettings?.workflow?.finalAuthority?.role || 'hr',
            reportingManagerIds: hasReportingManager ? reportingManagers.map(m => (m._id || m).toString()) : [],
            history: [
                {
                    step: 'system',
                    action: 'submitted',
                    actionBy: null, // System generated
                    actionByName: 'System (Auto-OD)',
                    actionByRole: 'system',
                    comments: `Auto-generated OD for work on holiday/week-off.${punchDetails}`,
                    timestamp: new Date(),
                },
            ],
        };

        // 5.5 Find a user to act as "appliedBy" (system or the employee themselves)
        const User = require('../../users/model/User');
        let applicantUser = await User.findOne({ employeeRef: employee._id });
        if (!applicantUser) {
            // Fallback to any super_admin if employee has no user account
            applicantUser = await User.findOne({ role: 'super_admin' });
        }

        // 6. Create OD record
        const od = new OD({
            employeeId: employee._id,
            emp_no: employee.emp_no,
            odType: 'OFFICIAL',
            odType_extended: 'full_day',
            fromDate: new Date(record.date + 'T00:00:00+05:30'),
            toDate: new Date(record.date + 'T00:00:00+05:30'),
            numberOfDays: 1,
            isHalfDay: false,
            odStartTime: startT,
            odEndTime: endT,
            durationHours: record.totalWorkingHours,
            isCOEligible: true, // Always true for auto-OD since it triggers on holidays
            purpose: 'Work on Holiday/Week-off',
            placeVisited: 'Organization Campus (Auto)',
            contactNumber: employee.phone_number || 'N/A',
            remarks: `Auto-generated by system based on biometric punches detected on a holiday/week-off.${punchDetails}`,
            status: 'pending',
            isActive: true,
            appliedBy: applicantUser ? applicantUser._id : null, 
            division_id: employee.division_id?._id || employee.division_id,
            division_name: employee.division_id?.name || 'N/A',
            department: employee.department_id?._id || employee.department_id,
            department_name: employee.department_id?.name || 'N/A',
            appliedAt: new Date(),
            workflow: workflowData,
        });

        await od.save();
        console.log(`[AutoOD] ✅ Created pending OD for ${employee.emp_no} on ${dateStr}${punchDetails}`);
    } catch (error) {
        console.error(`[AutoOD] Error processing ${employeeNumber} on ${dateStr}:`, error);
    }
};

module.exports = { processAutoODForDate, processAutoODForEmployee };

module.exports = { processAutoODForDate, processAutoODForEmployee };
