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

        // 2. Extract punch details FIRST (needed regardless of create/update path)
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

        // 1. Check if OD already exists for this date and employee
        // ODs are stored with fromDate = IST midnight = UTC prev-day 18:30
        // So we must use a FULL IST calendar day window to match reliably
        const dayStart = new Date(dateStr + 'T00:00:00+05:30'); // IST midnight = UTC 18:30 prev day
        const dayEnd   = new Date(dateStr + 'T23:59:59+05:30'); // IST end of day = UTC 18:29 same day

        console.log(`[AutoOD] Checking for existing OD: emp=${record.employeeNumber}, dateStr=${dateStr}, window=[${dayStart.toISOString()} → ${dayEnd.toISOString()}]`);

        // Look for ANY active OD on this date — pending, approved, partially-approved
        const existingActiveOD = await OD.findOne({
            emp_no: record.employeeNumber,
            fromDate: { $gte: dayStart, $lte: dayEnd },
            isActive: true,
            status: { $nin: ['cancelled', 'rejected'] }
        });

        if (existingActiveOD) {
            // UPDATE the existing OD with fresh punch details
            const prevStartT = existingActiveOD.odStartTime;
            const prevEndT   = existingActiveOD.odEndTime;
            const prevHours  = existingActiveOD.durationHours;

            existingActiveOD.odStartTime   = startT   || existingActiveOD.odStartTime;
            existingActiveOD.odEndTime     = endT     || existingActiveOD.odEndTime;
            existingActiveOD.durationHours = record.totalWorkingHours || existingActiveOD.durationHours;

            const updateNote = `Biometric punches updated by system.${punchDetails}`;
            existingActiveOD.workflow.history.push({
                step: 'system',
                action: 'status_changed',
                actionBy: null,
                actionByName: 'System (Auto-OD)',
                actionByRole: 'system',
                comments: updateNote,
                timestamp: new Date(),
            });

            await existingActiveOD.save();
            console.log(`[AutoOD] ✏️  Updated existing OD (${existingActiveOD._id}) for ${record.employeeNumber} on ${dateStr} — was [${prevStartT}→${prevEndT} ${prevHours}hrs], now [${startT}→${endT} ${record.totalWorkingHours}hrs]`);
            return;
        }

        // Check if there is a fully-rejected OD on this date.
        // If so we CAN create a new one; add a note about the previous rejection.
        const rejectedOD = await OD.findOne({
            emp_no: record.employeeNumber,
            fromDate: { $gte: dayStart, $lte: dayEnd },
            isActive: true,
            status: { $in: ['rejected', 'cancelled'] }
        }).sort({ updatedAt: -1 });

        let previousRejectionNote = '';
        if (rejectedOD) {
            const rejectedAt = rejectedOD.updatedAt ? new Date(rejectedOD.updatedAt).toLocaleDateString('en-IN') : 'N/A';
            previousRejectionNote = ` | Note: A previous OD (${rejectedOD.status}) on this date was found (${rejectedAt}). New OD auto-generated.`;
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

        // 5. Initialize workflow — exactly mirrors odController.js
        const approvalSteps = [];
        const reportingManagers = employee.dynamicFields?.reporting_to || employee.dynamicFields?.reporting_to_ || [];
        const hasReportingManager = Array.isArray(reportingManagers) && reportingManagers.length > 0;

        // Phase 1: Always set the FIRST step (reporting_manager if available, else HOD as fallback)
        if (hasReportingManager) {
            approvalSteps.push({
                stepOrder: 1,
                role: 'reporting_manager',
                label: 'Reporting Manager Approval',
                status: 'pending',
                isCurrent: true
            });
        } else {
            // Guaranteed fallback — HOD is always first if no reporting manager
            approvalSteps.push({
                stepOrder: 1,
                role: 'hod',
                label: 'HOD Approval',
                status: 'pending',
                isCurrent: true
            });
        }

        // Phase 2: Append remaining steps from workflow settings (skip HOD — already added above)
        if (workflowSettings?.workflow?.steps?.length > 0) {
            workflowSettings.workflow.steps.forEach(step => {
                if (step.approverRole !== 'hod') {
                    approvalSteps.push({
                        stepOrder: approvalSteps.length + 1,
                        role: step.approverRole,
                        label: step.stepName || `${step.approverRole?.toUpperCase()} Approval`,
                        status: 'pending',
                        isCurrent: false,
                    });
                }
            });
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
