/**
 * Attendance Routes
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { protect, authorize } = require('../authentication/middleware/authMiddleware');
const { applyScopeFilter } = require('../shared/middleware/dataScopeMiddleware');

// Controllers
const attendanceController = require('./controllers/attendanceController');
const attendanceSettingsController = require('./controllers/attendanceSettingsController');
const attendanceDeductionSettingsController = require('./controllers/attendanceDeductionSettingsController');
const earlyOutSettingsController = require('./controllers/earlyOutSettingsController');
const attendanceSyncController = require('./controllers/attendanceSyncController');
const attendanceUploadController = require('./controllers/attendanceUploadController');
const monthlySummaryController = require('./controllers/monthlySummaryController');
const liveAttendanceReportController = require('./controllers/liveAttendanceReportController');
const reportsController = require('./controllers/reportsController');

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'text/csv') {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) and CSV files are allowed'), false);
    }
  },
});

// All routes require authentication
router.use(protect);

// Attendance Data Routes (with scope filtering)
router.get('/calendar', applyScopeFilter, attendanceController.getAttendanceCalendar);
router.get('/list', applyScopeFilter, attendanceController.getAttendanceList);
router.get('/detail', applyScopeFilter, attendanceController.getAttendanceDetail);
router.get('/employees', applyScopeFilter, attendanceController.getEmployeesWithAttendance);
router.get('/monthly', applyScopeFilter, attendanceController.getMonthlyAttendance);
router.get('/activity/recent', applyScopeFilter, attendanceController.getRecentActivity);
router.get('/:employeeNumber/:date/available-shifts', attendanceController.getAvailableShifts);

// Update outTime for PARTIAL attendance (Super Admin, Sub Admin, HR, HOD)
router.put('/:employeeNumber/:date/outtime', authorize('manager', 'super_admin', 'sub_admin', 'hr', 'hod'), attendanceController.updateOutTime);

// Update inTime for attendance check-in correction (Super Admin, HR)
router.put('/:employeeNumber/:date/intime', authorize('super_admin', 'sub_admin', 'hr'), attendanceController.updateInTime);

// Assign shift to attendance record (Super Admin, Sub Admin, HR, HOD)
router.put('/:employeeNumber/:date/shift', authorize('manager', 'super_admin', 'sub_admin', 'hr', 'hod'), attendanceController.assignShift);

// Settings Routes (Super Admin, Sub Admin only)
router.get('/settings', attendanceSettingsController.getSettings);
router.put('/settings', authorize('super_admin', 'sub_admin'), attendanceSettingsController.updateSettings);

// Deduction Settings Routes (Must come before dynamic routes)
// Get attendance deduction settings
router.get('/settings/deduction', attendanceDeductionSettingsController.getSettings);

// Save attendance deduction settings
router.post('/settings/deduction', authorize('super_admin', 'sub_admin'), attendanceDeductionSettingsController.saveSettings);
router.put('/settings/deduction', authorize('super_admin', 'sub_admin'), attendanceDeductionSettingsController.saveSettings);

// Early-Out Settings Routes
// Get early-out settings
router.get('/settings/early-out', earlyOutSettingsController.getSettings);

// Save early-out settings
router.post('/settings/early-out', authorize('super_admin', 'sub_admin'), earlyOutSettingsController.saveSettings);
router.put('/settings/early-out', authorize('super_admin', 'sub_admin'), earlyOutSettingsController.saveSettings);

// Early-Out Deduction Range Routes
router.post('/settings/early-out/ranges', authorize('super_admin', 'sub_admin'), earlyOutSettingsController.addRange);
router.put('/settings/early-out/ranges/:rangeId', authorize('super_admin', 'sub_admin'), earlyOutSettingsController.updateRange);
router.delete('/settings/early-out/ranges/:rangeId', authorize('super_admin', 'sub_admin'), earlyOutSettingsController.deleteRange);

// Sync Routes (Super Admin, Sub Admin only)
router.post('/sync', authorize('super_admin', 'sub_admin'), attendanceSyncController.manualSync);
router.get('/sync/status', attendanceSyncController.getSyncStatus);

// Upload Routes (Super Admin, Sub Admin, HR)
router.post('/upload', authorize('manager', 'super_admin', 'sub_admin', 'hr'), upload.single('file'), attendanceUploadController.uploadExcel);
router.get('/upload/template', attendanceUploadController.downloadTemplate);

// Monthly Summary Routes
router.get('/monthly-summary', applyScopeFilter, monthlySummaryController.getAllMonthlySummaries);
router.get('/monthly-summary/:employeeId', applyScopeFilter, monthlySummaryController.getEmployeeMonthlySummary);
router.post('/monthly-summary/calculate/:employeeId', authorize('manager', 'super_admin', 'sub_admin', 'hr'), monthlySummaryController.calculateEmployeeSummary);
router.post('/monthly-summary/calculate-all', applyScopeFilter, authorize('manager', 'super_admin', 'sub_admin', 'hr'), monthlySummaryController.calculateAllSummaries);
router.post('/monthly-summary/clear-and-recalculate', applyScopeFilter, authorize('manager', 'super_admin', 'sub_admin', 'hr'), monthlySummaryController.clearAndRecalculateSummaries);

// Live Attendance Report Routes (Super Admin, Sub Admin, HR)
router.get('/reports/live', authorize('super_admin', 'sub_admin', 'hr'), liveAttendanceReportController.getLiveAttendanceReport);
router.get('/reports/live/filters', authorize('super_admin', 'sub_admin', 'hr'), liveAttendanceReportController.getFilterOptions);

// General Attendance and Biometric Report Routes
router.get('/reports/summary', reportsController.getAttendanceReport);
router.get('/reports/thumb', reportsController.getThumbReports);
router.get('/reports/export', applyScopeFilter, authorize('manager', 'super_admin', 'sub_admin', 'hr', 'hod'), reportsController.exportAttendanceReport);
router.get('/reports/export-pdf', applyScopeFilter, authorize('manager', 'super_admin', 'sub_admin', 'hr', 'hod'), reportsController.exportAttendanceReportPDF);

module.exports = router;

