const { Worker } = require('bullmq');
const { redisConfig } = require('../../config/redis');
const { extractISTComponents, createISTDate } = require('../../shared/utils/dateUtils');

// Start the workers
const startWorkers = () => {
    console.log('🚀 Starting BullMQ Workers...');

    // Payroll Worker
    const payrollWorker = new Worker('payrollQueue', async (job) => {
        console.log(`[Worker] Processing payroll job: ${job.id} (Name: ${job.name}, action: ${job.data?.action || 'n/a'})`);

        const { employeeId, month, userId, batchId, action, departmentId, divisionId } = job.data;

        try {
            const PayrollCalculationService = require('../../payroll/services/payrollCalculationService');

            if (action === 'recalculate_batch') {
                const PayrollBatch = require('../../payroll/model/PayrollBatch');
                const batch = await PayrollBatch.findById(batchId).populate('employeePayrolls');

                if (!batch) throw new Error('Batch not found');

                console.log(`[Worker] Recalculating batch ${batchId} with ${batch.employeePayrolls.length} employees`);

                for (let i = 0; i < batch.employeePayrolls.length; i++) {
                    const payroll = batch.employeePayrolls[i];
                    const empId = payroll.employeeId?._id || payroll.employeeId;
                    await PayrollCalculationService.calculatePayrollNew(empId, batch.month, userId, {
                        source: 'payregister',
                        consumeRecalculationPermission: false
                    });

                    // Update progress
                    await job.updateProgress({
                        processed: i + 1,
                        total: batch.employeePayrolls.length,
                        percentage: Math.round(((i + 1) / batch.employeePayrolls.length) * 100)
                    });
                }

                if (['approved', 'freeze', 'complete'].includes(batch.status) && batch.hasValidRecalculationPermission()) {
                    batch.consumeRecalculationPermission?.();
                    await batch.save();
                }

                console.log(`[Worker] Batch ${batchId} recalculation complete`);
            } else if (action === 'second_salary_batch') {
                const { calculateSecondSalary } = require('../../payroll/services/secondSalaryCalculationService');
                const SecondSalaryBatchService = require('../../payroll/services/secondSalaryBatchService');
                const Employee = require('../../employees/model/Employee');
                const Department = require('../../departments/model/Department');
                const allowanceDeductionResolverService = require('../../payroll/services/allowanceDeductionResolverService');

                let employees;
                if (job.data.employeeIds && Array.isArray(job.data.employeeIds) && job.data.employeeIds.length > 0) {
                    employees = await Employee.find({ _id: { $in: job.data.employeeIds } });
                    console.log(`[Worker] Calculating 2nd salary for ${employees.length} employees (from controller list)`);
                } else {
                    const { getSecondSalaryEmployeeQuery } = require('../../payroll/services/payrollEmployeeQueryHelper');
                    const { getPayrollDateRange } = require('../../shared/utils/dateUtils');
                    const { year: curYear, month: curMonth } = extractISTComponents(new Date());
                    const [year, monthNum] = month ? month.split('-').map(Number) : [curYear, curMonth];
                    const { startDate, endDate } = month ? await getPayrollDateRange(year, monthNum) : { startDate: null, endDate: null };
                    const leftDateRange = (startDate && endDate) ? { start: new Date(startDate), end: new Date(endDate) } : undefined;
                    const query = getSecondSalaryEmployeeQuery({ departmentId, divisionId, leftDateRange });
                    employees = await Employee.find(query);
                    console.log(`[Worker] Calculating 2nd salary for ${employees.length} employees (from query)`);
                }

                // Optimization: Pre-fetch department and settings for context
                const sharedContext = {
                    department: (departmentId && departmentId !== 'all') ? await Department.findById(departmentId) : null,
                    includeMissing: (departmentId && departmentId !== 'all') ? await allowanceDeductionResolverService.getIncludeMissingFlag(departmentId, divisionId) : undefined
                };

                const batchIds = new Set();

                for (let i = 0; i < employees.length; i++) {
                    const employee = employees[i];
                    try {
                        const result = await calculateSecondSalary(employee._id, month, userId, sharedContext);
                        if (result.batchId) batchIds.add(result.batchId.toString());
                    } catch (err) {
                        console.error(`[Worker] Failed 2nd salary for ${employee.emp_no}:`, err.message);
                    }

                    // Update progress
                    await job.updateProgress({
                        processed: i + 1,
                        total: employees.length,
                        percentage: Math.round(((i + 1) / employees.length) * 100),
                        currentEmployee: employee.employee_name
                    });
                }

                // Recalculate totals for all affected batches
                for (const bId of batchIds) {
                    await SecondSalaryBatchService.recalculateBatchTotals(bId);
                }
                console.log(`[Worker] 2nd Salary batch calculation complete`);
            } else if (action === 'payroll_bulk_calculate') {
                const Employee = require('../../employees/model/Employee');
                const Department = require('../../departments/model/Department');
                const allowanceDeductionResolverService = require('../../payroll/services/allowanceDeductionResolverService');
                const PayrollBatchService = require('../../payroll/services/payrollBatchService');
                const { buildPayrollBulkEmployeeQuery } = require('../../payroll/services/payrollEmployeeQueryHelper');
                const { EJSON } = require('bson');
                const { getPayrollDateRange } = require('../../shared/utils/dateUtils');

                let employees;
                const { year: curYear, month: curMonth } = extractISTComponents(new Date());
                const [year, monthNum] = month ? month.split('-').map(Number) : [curYear, curMonth];
                const { startDate, endDate } = month ? await getPayrollDateRange(year, monthNum) : { startDate: null, endDate: null };
                const leftStart = startDate && endDate ? new Date(startDate + 'T00:00:00.000Z') : null;
                const leftEnd = startDate && endDate ? new Date(endDate + 'T23:59:59.999Z') : null;

                const legacyEmployeeIds =
                    job.data.employeeIds && Array.isArray(job.data.employeeIds) && job.data.employeeIds.length > 0;
                if (!legacyEmployeeIds && leftStart && leftEnd) {
                    const scopeDeserialized =
                        job.data.scopeFilter != null ? EJSON.deserialize(job.data.scopeFilter) : null;
                    const empQuery = buildPayrollBulkEmployeeQuery(
                        scopeDeserialized,
                        divisionId,
                        departmentId,
                        leftStart,
                        leftEnd
                    );
                    employees = await Employee.find(empQuery);
                    console.log(`[Worker] Bulk calculating payroll for ${employees.length} employees (bulk employee query)`);
                } else if (legacyEmployeeIds) {
                    employees = await Employee.find({ _id: { $in: job.data.employeeIds } });
                    console.log(`[Worker] Bulk calculating payroll for ${employees.length} employees (legacy job: employeeIds)`);
                } else {
                    const { getRegularPayrollEmployeeQuery } = require('../../payroll/services/payrollEmployeeQueryHelper');
                    const leftDateRange = (startDate && endDate) ? { start: new Date(startDate), end: new Date(endDate) } : undefined;
                    const query = getRegularPayrollEmployeeQuery({ departmentId, divisionId, leftDateRange });
                    employees = await Employee.find(query);
                    console.log(`[Worker] Bulk calculating payroll for ${employees.length} employees (legacy job: dept/div query)`);
                }

                // Optimization: Pre-fetch department and settings for context
                const sharedContext = {
                    department: (departmentId && departmentId !== 'all') ? await Department.findById(departmentId) : null,
                    includeMissing: (departmentId && departmentId !== 'all') ? await allowanceDeductionResolverService.getIncludeMissingFlag(departmentId, divisionId) : undefined
                };

                const batchIds = new Set();
                const useLegacy = job.data.strategy === 'legacy';
                const useDynamic = job.data.strategy === 'dynamic';
                const opts = { source: useLegacy ? 'all' : 'payregister' };

                let useOutputColumnsEngine = false;
                if (useDynamic) {
                    const PayrollConfiguration = require('../../payroll/model/PayrollConfiguration');
                    const config = await PayrollConfiguration.get();
                    useOutputColumnsEngine = Array.isArray(config?.outputColumns) && config.outputColumns.length > 0;
                }

                const payrollFromOutputColumns = useOutputColumnsEngine
                    ? require('../../payroll/services/payrollCalculationFromOutputColumnsService')
                    : null;

                const secondSalaryEmployees = employees.filter((e) => Number(e.second_salary) > 0);
                const overallTotal = employees.length + secondSalaryEmployees.length;

                for (let i = 0; i < employees.length; i++) {
                    const employee = employees[i];
                    try {
                        let result;
                        if (useOutputColumnsEngine && payrollFromOutputColumns) {
                            result = await payrollFromOutputColumns.calculatePayrollFromOutputColumns(
                                employee._id.toString(),
                                month,
                                userId,
                                { source: 'payregister', arrearsSettlements: [] }
                            );
                        } else {
                            result = await PayrollCalculationService.calculatePayrollNew(
                                employee._id.toString(),
                                month,
                                userId,
                                { ...opts, consumeRecalculationPermission: false },
                                sharedContext
                            );
                        }
                        if (result.batchId) batchIds.add(result.batchId.toString());
                    } catch (err) {
                        console.error(`[Worker] Failed bulk payroll for ${employee.emp_no || employee._id}:`, err.message);
                    }

                    const overallProcessed = i + 1;
                    await job.updateProgress({
                        phase: 'regular',
                        processed: i + 1,
                        total: employees.length,
                        overallProcessed,
                        overallTotal,
                        percentage: overallTotal ? Math.round((overallProcessed / overallTotal) * 100) : 100,
                        currentEmployee: employee.employee_name,
                    });
                }

                // Recalculate totals for all affected batches
                for (const bId of batchIds) {
                    await PayrollBatchService.recalculateBatchTotals(bId);
                    const batchDoc = await require('../../payroll/model/PayrollBatch').findById(bId);
                    if (batchDoc && ['approved', 'freeze', 'complete'].includes(batchDoc.status) && batchDoc.hasValidRecalculationPermission()) {
                        batchDoc.consumeRecalculationPermission?.();
                        await batchDoc.save();
                    }
                }
                console.log(`[Worker] Bulk regular payroll calculation complete`);

                const { calculateSecondSalaryForPayRegister } = require('../../payroll/services/secondSalaryCalculationService');
                const SecondSalaryBatchService = require('../../payroll/services/secondSalaryBatchService');
                const secondBatchIds = new Set();

                for (let j = 0; j < secondSalaryEmployees.length; j++) {
                    const employee = secondSalaryEmployees[j];
                    try {
                        const result = await calculateSecondSalaryForPayRegister(
                            employee._id.toString(),
                            month,
                            userId,
                            job.data.strategy || 'new',
                            sharedContext
                        );
                        const bid = result?.batchId;
                        if (bid) secondBatchIds.add(bid.toString());
                    } catch (err) {
                        console.error(`[Worker] Failed 2nd salary after bulk for ${employee.emp_no || employee._id}:`, err.message);
                    }

                    const overallProcessed = employees.length + j + 1;
                    await job.updateProgress({
                        phase: 'second_salary',
                        processed: j + 1,
                        total: secondSalaryEmployees.length,
                        overallProcessed,
                        overallTotal,
                        percentage: overallTotal ? Math.round((overallProcessed / overallTotal) * 100) : 100,
                        currentEmployee: employee.employee_name,
                    });
                }

                for (const bId of secondBatchIds) {
                    await SecondSalaryBatchService.recalculateBatchTotals(bId);
                }
                console.log(`[Worker] Bulk payroll + 2nd salary calculation complete`);
            } else {
                await PayrollCalculationService.calculatePayrollNew(employeeId, month, userId, { source: 'payregister' });
            }
        } catch (error) {
            console.error(`[Worker] Payroll job ${job.id} failed:`, error.message);
            throw error;
        }
    }, { connection: redisConfig });

    // Attendance Sync Worker
    const attendanceSyncWorker = new Worker('attendanceSyncQueue', async (job) => {
        console.log(`[Worker] Processing attendance sync job: ${job.id}`);

        try {
            const { syncAttendanceFromMSSQL } = require('../../attendance/services/attendanceSyncService');
            const stats = await syncAttendanceFromMSSQL();
            console.log(`[Worker] Attendance sync complete: ${stats.message}`);
            return stats;
        } catch (error) {
            console.error(`[Worker] Attendance sync job ${job.id} failed:`, error.message);
            throw error;
        }
    }, { connection: redisConfig });

    // Application Action Worker
    const applicationWorker = new Worker('applicationQueue', async (job) => {
        const { type, applicationIds, bulkSettings, approverId, comments } = job.data;
        console.log(`[Worker] Processing ${type} for ${applicationIds.length} applications`);

        const EmployeeApplication = require('../../employee-applications/model/EmployeeApplication');
        const Employee = require('../../employees/model/Employee');
        const EmployeeApplicationFormSettings = require('../../employee-applications/model/EmployeeApplicationFormSettings');
        const { resolveQualificationLabels, transformApplicationToEmployee } = require('../../employee-applications/services/fieldMappingService');
        const { generatePassword, sendCredentials } = require('../../shared/services/passwordNotificationService');
        const sqlHelper = require('../../employees/config/sqlHelper');

        const results = {
            successCount: 0,
            failCount: 0,
            errors: []
        };

        for (let i = 0; i < applicationIds.length; i++) {
            const id = applicationIds[i];
            try {
                if (type === 'approve-bulk') {
                    // Approval logic - use bulkSettings instead of approvalData
                    const { approvedSalary, doj, comments: bulkComments, employeeAllowances, employeeDeductions, ctcSalary, calculatedSalary } = bulkSettings || {};
                    const application = await EmployeeApplication.findById(id);

                    if (!application) throw new Error(`Application ${id} not found`);
                    if (application.status !== 'pending') throw new Error(`Application ${id} is already ${application.status}`);

                    const finalSalary = approvedSalary !== undefined ? approvedSalary : application.proposedSalary;
                    const finalDOJ = doj ? createISTDate(extractISTComponents(doj).dateStr) : createISTDate(extractISTComponents(new Date()).dateStr);

                    application.status = 'approved';
                    application.approvedSalary = finalSalary;
                    application.doj = finalDOJ;
                    application.approvedBy = approverId;
                    application.approvedAt = new Date();
                    application.approvalComments = bulkComments || comments || 'Bulk approved';

                    // Normalization logic
                    const normalize = (list) => Array.isArray(list) ? list.filter(item => item && (item.masterId || item.name)).map(item => ({ ...item, isOverride: true })) : [];
                    application.employeeAllowances = employeeAllowances ? normalize(employeeAllowances) : (application.employeeAllowances || []);
                    application.employeeDeductions = employeeDeductions ? normalize(employeeDeductions) : (application.employeeDeductions || []);

                    // Transform to Employee
                    const appObj = application.toObject();
                    const settings = await EmployeeApplicationFormSettings.getActiveSettings();
                    if (settings && appObj.qualifications) appObj.qualifications = resolveQualificationLabels(appObj.qualifications, settings);

                    const { permanentFields, dynamicFields } = transformApplicationToEmployee(appObj, { gross_salary: finalSalary, doj: finalDOJ });
                    const employeeData = { ...permanentFields, dynamicFields: dynamicFields || {}, password: await generatePassword(permanentFields, null), is_active: true };

                    await Employee.create(employeeData);
                    await application.save();

                    // Optional MSSQL Sync
                    if (sqlHelper.isHRMSConnected?.() && !await sqlHelper.employeeExistsMSSQL(employeeData.emp_no)) {
                        await sqlHelper.createEmployeeMSSQL(employeeData).catch(e => console.error(`MSSQL Error for ${employeeData.emp_no}:`, e.message));
                    }

                    // Send Credentials
                    await sendCredentials(employeeData, employeeData.password, { email: true, sms: true }).catch(e => console.error(`Notification Error:`, e.message));

                } else if (type === 'reject-bulk') {
                    // Rejection logic
                    const application = await EmployeeApplication.findById(id);
                    if (!application) throw new Error(`Application ${id} not found`);
                    if (application.status !== 'pending') throw new Error(`Application ${application.emp_no} is already ${application.status}`);

                    application.status = 'rejected';
                    application.rejectedBy = approverId;
                    application.rejectionComments = comments || 'Bulk rejected';
                    application.rejectedAt = new Date();
                    await application.save();
                }

                results.successCount++;
            } catch (err) {
                results.failCount++;
                results.errors.push({ id, message: err.message });
            }

            // Update Progress
            await job.updateProgress({
                processed: i + 1,
                total: applicationIds.length,
                percentage: Math.round(((i + 1) / applicationIds.length) * 100)
            });
        }

        console.log(`[Worker] ${type} complete: ${results.successCount} success, ${results.failCount} fail`);
        return results;
    }, { connection: redisConfig });

    // Attendance Upload Worker
    const attendanceUploadWorker = new Worker('attendanceUploadQueue', async (job) => {
        const { fileBuffer, userId, originalName, rowCount } = job.data;
        console.log(`[Worker] Processing attendance upload: ${originalName} (${rowCount} rows) for User ${userId}`);

        const XLSX = require('xlsx');
        const AttendanceRawLog = require('../../attendance/model/AttendanceRawLog');
        const { processAndAggregateLogs } = require('../../attendance/services/attendanceSyncService');
        const { detectExtraHoursForEmployeeDates } = require('../../attendance/services/extraHoursService');
        const { io } = require('../../server'); // Import io from server.js

        try {
            // Reconstruct buffer
            const buffer = Buffer.from(fileBuffer, 'base64');
            const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellNF: true });
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const data = XLSX.utils.sheet_to_json(worksheet);

            // Need to reconstruct the parsing logic from controller
            // For simplicity, we'll implement a robust parser here or ideally move it to a service
            // Re-using the parseLegacyRows/parseSimpleRows logic would be better if they were in a service
            // Since they are currently in the controller, I will implement a basic version or 
            // Better: Move parsing logic to a service if possible. 
            // For now, I'll copy the essentials to ensure functionality.

            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            let isLegacy = false;
            let headerIdx = -1;
            for (let i = 0; i < 10; i++) {
                if (rows[i] && rows[i].includes('SNO') && rows[i].includes('E .NO') && rows[i].includes('PDate')) {
                    isLegacy = true; headerIdx = i; break;
                }
            }

            const { parseLegacyRows, parseSimpleRows } = require('../../attendance/services/attendanceUploadService');

            let rawLogs = [];
            if (isLegacy) {
                const legacyResult = parseLegacyRows(rows, headerIdx);
                rawLogs = legacyResult.rawLogs;
            } else {
                const simpleResult = parseSimpleRows(data);
                rawLogs = simpleResult.rawLogs;
            }

            // Parsing handled above via attendanceUploadService


            // Bulk Insert
            if (rawLogs.length > 0) {
                const bulkOps = rawLogs.map(log => ({
                    updateOne: {
                        filter: { employeeNumber: log.employeeNumber, timestamp: log.timestamp, type: log.type },
                        update: { $setOnInsert: log },
                        upsert: true
                    }
                }));
                await AttendanceRawLog.bulkWrite(bulkOps, { ordered: false });

                // Aggregate
                const stats = await processAndAggregateLogs(rawLogs, false);

                // Extra hours: only for (employee, date) we just processed (+ yesterday/tomorrow for overnight)
                const entries = rawLogs.map(log => ({
                    employeeNumber: log.employeeNumber,
                    date: log.date || (log.timestamp ? new Date(log.timestamp).toISOString().slice(0, 10) : null),
                })).filter(e => e.date);
                if (entries.length > 0) {
                    await detectExtraHoursForEmployeeDates(entries, { includeAdjacentDays: true });
                }

                const { app, io } = require('../../server'); // Import from server.js
                const activeIo = io || (app && typeof app.get === 'function' ? app.get('io') : null);

                // Notify User
                if (activeIo) {
                    activeIo.to(`user_${userId}`).emit('toast_notification', {
                        type: 'success',
                        message: `Attendance upload of "${originalName}" completed successfully! ${rawLogs.length} logs processed.`,
                        title: 'Attendance Upload Complete'
                    });
                }
            }

            return { success: true, count: rawLogs.length };
        } catch (error) {
            console.error(`[Worker] Attendance upload failed:`, error);
            const { app, io } = require('../../server');
            const activeIo = io || (app && typeof app.get === 'function' ? app.get('io') : null);

            if (activeIo) {
                activeIo.to(`user_${userId}`).emit('toast_notification', {
                    type: 'error',
                    message: `Attendance upload of "${originalName}" failed: ${error.message}`,
                    title: 'Attendance Upload Failed'
                });
            }
            throw error;
        }
    }, { connection: redisConfig });

    // Roster Sync Worker
    const rosterSyncWorker = new Worker('rosterSyncQueue', async (job) => {
        const { entries, userId } = job.data;
        console.log(`[Worker] Processing roster sync job: ${job.id} with ${entries.length} entries`);

        try {
            const AttendanceDaily = require('../../attendance/model/AttendanceDaily');

            let syncedCount = 0;
            let removedCount = 0;

            for (const entry of entries) {
                if (!entry.date) continue;

                const empNo = String(entry.employeeNumber || '').toUpperCase();

                if (entry.status === 'WO' || entry.status === 'HOL') {
                    // Create or update AttendanceDaily for this WO/HOL day (only for saved roster entries)
                    let dailyRecord = await AttendanceDaily.findOne({
                        employeeNumber: empNo,
                        date: entry.date
                    });

                    // Re-processing for days with existing punches when they are changed to WO/HOL in roster
                    // This ensures the status correctly becomes WEEK_OFF/HOLIDAY even with raw logs present.
                    const hasPunches = dailyRecord && (
                        (dailyRecord.totalWorkingHours > 0) ||
                        (dailyRecord.shifts && dailyRecord.shifts.length > 0 && dailyRecord.shifts.some(s => s && s.inTime))
                    );

                    if (hasPunches) {
                        try {
                            const { reprocessAttendanceForEmployeeDate } = require('../../attendance/services/attendanceSyncService');
                            await reprocessAttendanceForEmployeeDate(empNo, entry.date);
                        } catch (reprocessErr) {
                            console.error(`[Worker] Failed to reprocess attendance for ${empNo} on ${entry.date} (Off day with punches):`, reprocessErr.message);
                        }
                        continue;
                    }

                    const updateFields = {
                        status: entry.status === 'WO' ? 'WEEK_OFF' : 'HOLIDAY',
                        shifts: [], // Clear shifts
                        totalWorkingHours: 0,
                        totalOTHours: 0,
                        notes: entry.status === 'WO' ? 'Week Off' : 'Holiday'
                    };

                    if (!dailyRecord) {
                        dailyRecord = new AttendanceDaily({
                            employeeNumber: empNo,
                            date: entry.date,
                            ...updateFields,
                            source: ['roster-sync']
                        });
                    } else {
                        Object.keys(updateFields).forEach(key => {
                            dailyRecord[key] = updateFields[key];
                        });
                        if (!dailyRecord.source || !dailyRecord.source.includes('roster-sync')) {
                            dailyRecord.source = dailyRecord.source || [];
                            if (!dailyRecord.source.includes('roster-sync')) dailyRecord.source.push('roster-sync');
                        }
                    }

                    await dailyRecord.save();
                    syncedCount++;
                } else if (entry.shiftId) {
                    // It's a shift. Check if currently WO/HOL and remove if so
                    // We only remove if source is roster-sync or status is plainly WO/HOL without punches
                    const existing = await AttendanceDaily.findOne({
                        employeeNumber: empNo,
                        date: entry.date
                    });

                    if (existing && (existing.status === 'WEEK_OFF' || existing.status === 'HOLIDAY')) {
                        // Only remove if it doesn't have punches (totalWorkingHours == 0)
                        if (!existing.totalWorkingHours || existing.totalWorkingHours === 0) {
                            await AttendanceDaily.deleteOne({ _id: existing._id });
                            removedCount++;
                        }
                    }

                    // TRIGGER RE-PROCESSING: Re-evaluate this day's attendance against the new rostered shift
                    // This handles cases where punches already exist but need to be re-run for lateness/early-out etc.
                    try {
                        const { reprocessAttendanceForEmployeeDate } = require('../../attendance/services/attendanceSyncService');
                        await reprocessAttendanceForEmployeeDate(empNo, entry.date);
                    } catch (reprocessErr) {
                        console.error(`[Worker] Failed to reprocess attendance for ${empNo} on ${entry.date}:`, reprocessErr.message);
                    }
                }
            }

            console.log(`[Worker] Roster sync complete: ${syncedCount} synced, ${removedCount} removed`);

            // Notify user via socket if available
            try {
                const { app, io } = require('../../server'); // Import from server.js
                const activeIo = io || (app && typeof app.get === 'function' ? app.get('io') : null);

                if (activeIo) {
                    activeIo.to(`user_${userId}`).emit('toast_notification', {
                        type: 'success',
                        message: `Roster sync complete: ${syncedCount} days updated.`,
                        title: 'Roster Sync Complete'
                    });
                }
            } catch (notifyErr) {
                console.warn('[Worker] Failed to notify user:', notifyErr.message);
            }

            return { success: true, synced: syncedCount, removed: removedCount };

        } catch (error) {
            console.error(`[Worker] Roster sync failed:`, error);
            throw error;
        }
    }, { connection: redisConfig });

    payrollWorker.on('error', (err) => {
        console.error('[Worker] Payroll worker error (check Redis):', err.message);
    });

    payrollWorker.on('completed', (job) => {
        console.log(`[Worker] Job ${job.id} has completed!`);
    });

    payrollWorker.on('failed', (job, err) => {
        console.error(`[Worker] Job ${job.id} has failed with ${err.message}`);
    });

    attendanceSyncWorker.on('completed', (job) => {
        console.log(`[Worker] Attendance Sync Job ${job.id} completed successfully`);
    });

    applicationWorker.on('completed', (job) => {
        console.log(`[Worker] Application Job ${job.id} (${job.data.type}) completed successfully`);
    });

    applicationWorker.on('failed', (job, err) => {
        console.error(`[Worker] Application Job ${job.id} failed: ${err.message}`);
    });

    rosterSyncWorker.on('completed', (job) => {
        console.log(`[Worker] Roster Sync Job ${job.id} completed successfully`);
    });

    rosterSyncWorker.on('failed', (job, err) => {
        console.error(`[Worker] Roster Sync Job ${job.id} failed: ${err.message}`);
    });

    console.log('✅ BullMQ Workers are ready');
};

module.exports = { startWorkers };
