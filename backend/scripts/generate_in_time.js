const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Models
const AttendanceRawLog = require('../attendance/model/AttendanceRawLog');
const Employee = require('../employees/model/Employee');
const Shift = require('../shifts/model/Shift');
const Settings = require('../settings/model/Settings');

// Services
const { getShiftsForEmployee } = require('../shifts/services/shiftDetectionService');
const { processMultiShiftAttendance } = require('../attendance/services/multiShiftProcessingService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/hrms';

async function generateInTime() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB');

        const targetDate = '2026-03-02';
        const empNo = '2145';

        console.log(`Simulating IN log for Employee: ${empNo} on ${targetDate}`);

        const emp = await Employee.findOne({ emp_no: empNo, is_active: { $ne: false } });
        if (!emp) {
            console.log(`Active employee ${empNo} not found`);
            process.exit(1);
        }

        const generalConfig = await Settings.getSettingsByCategory('general');

        console.log(`\nProcessing Employee: ${emp.employee_name} (${emp.emp_no})`);

        // 1. Get shifts for today
        const shiftResult = await getShiftsForEmployee(emp.emp_no, targetDate);
        let shifts = shiftResult.shifts;

        if (shifts.length === 0) {
            console.log('No assigned shift found, using default General Shift');
            const defaultShift = await Shift.findOne({ isActive: true });
            if (defaultShift) shifts = [defaultShift];
            else {
                shifts = [await Shift.findOne()];
            }
        }

        if (shifts.length === 0 || !shifts[0]) {
            console.log('No shifts exist in system');
            process.exit(1);
        }

        const shift = shifts[0];
        console.log(`- Shift: ${shift.name} (${shift.startTime} - ${shift.endTime})`);

        // Generate IN Punch based on shift start time
        const [inH, inM] = shift.startTime.split(':').map(Number);

        // Use local timezone
        const inTimestamp = new Date(`${targetDate}T${String(inH).padStart(2, '0')}:${String(inM).padStart(2, '0')}:00+05:30`);

        // Add minimal random jitter (-2 to +5 mins)
        inTimestamp.setMinutes(inTimestamp.getMinutes() + Math.floor(Math.random() * 8) - 2);

        // CREATE IN LOG
        await AttendanceRawLog.findOneAndUpdate(
            { employeeNumber: emp.emp_no, date: targetDate, type: 'IN' },
            {
                employeeNumber: emp.emp_no,
                timestamp: inTimestamp,
                type: 'IN',
                subType: 'CHECK-IN',
                source: 'biometric-realtime',
                date: targetDate,
                rawData: { simulated: true }
            },
            { upsert: true, new: true }
        );
        console.log(`  [OK] IN Punch created at ${inTimestamp.toLocaleTimeString()}`);

        const allLogs = await AttendanceRawLog.find({
            employeeNumber: emp.emp_no,
            date: targetDate
        }).sort({ timestamp: 1 }).lean();

        const processedLogs = allLogs.map(log => ({
            timestamp: new Date(log.timestamp),
            type: log.type,
            punch_state: log.type === 'IN' ? 0 : (log.type === 'OUT' ? 1 : null),
            _id: log._id
        }));

        await processMultiShiftAttendance(emp.emp_no, targetDate, processedLogs, generalConfig);
        console.log(`  [FINISH] Attendance processed for ${emp.emp_no}`);

        console.log('\nSimulation completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('Error during simulation:', error);
        process.exit(1);
    }
}

generateInTime();
