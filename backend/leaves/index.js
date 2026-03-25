const express = require('express');
const router = express.Router();
const leaveController = require('./controllers/leaveController');
const odController = require('./controllers/odController');
const cclController = require('./controllers/cclController');
const settingsController = require('./controllers/leaveSettingsController');
const leaveRegisterController = require('./controllers/leaveRegisterController');
const earnedLeaveController = require('./controllers/earnedLeaveController');
const annualCLResetController = require('./controllers/annualCLResetController');
const accrualController = require('./controllers/accrualController');
const { protect, authorize } = require('../authentication/middleware/authMiddleware');
const { applyScopeFilter } = require('../shared/middleware/dataScopeMiddleware');

// All routes require authentication
router.use(protect);

// ==========================================
// SETTINGS ROUTES (Must come before dynamic routes)
// ==========================================

// Initialize default settings
router.post('/settings/initialize', authorize('super_admin'), settingsController.initializeSettings);

// Get settings for leave, OD, or CCL
router.get('/settings/:type', settingsController.getSettings);

// Save settings
router.post('/settings/:type', authorize('super_admin'), settingsController.saveSettings);

// Get types (leave types, OD types, or CCL)
router.get('/types/:type', settingsController.getTypes);

// Add new type
router.post('/types/:type', authorize('super_admin'), settingsController.addType);

// ==========================================
// CCL (COMPENSATORY CASUAL LEAVE) ROUTES
// ==========================================

// Get users for Assigned By dropdown
router.get('/ccl/assigned-by-users', cclController.getAssignedByUsers);

// Validate date (holiday/week-off check)
router.get('/ccl/validate-date', cclController.validateCCLDate);

// Get my CCL requests
router.get('/ccl/my', cclController.getMyCCLs);

// Get pending CCL approvals
router.get('/ccl/pending-approvals', authorize('manager', 'hod', 'hr', 'sub_admin', 'super_admin'), cclController.getPendingApprovals);

// Get all CCL requests (scoped)
router.get('/ccl', authorize('employee', 'manager', 'hod', 'hr', 'sub_admin', 'super_admin'), applyScopeFilter, cclController.getCCLs);

// Get single CCL request
router.get('/ccl/:id', cclController.getCCL);

// Apply for CCL
router.post('/ccl', cclController.applyCCL);

// Process CCL action (approve/reject)
router.put('/ccl/:id/action', authorize('manager', 'hod', 'hr', 'sub_admin', 'super_admin'), cclController.processCCLAction);

// Cancel CCL
router.put('/ccl/:id/cancel', cclController.cancelCCL);

// ==========================================
// OD (ON DUTY) ROUTES - MUST COME BEFORE /:id routes!
// ==========================================

// Get my ODs
router.get('/od/my', odController.getMyODs);

// Check if date is holiday for an employee
router.get('/od/check-holiday', odController.checkHoliday);

// Get pending OD approvals
router.get('/od/pending-approvals', authorize('manager', 'hod', 'hr', 'sub_admin', 'super_admin'), odController.getPendingApprovals);

// Get all ODs (scoped by division/department) - employee allowed; applyScopeFilter restricts to own/scope
router.get('/od', authorize('employee', 'manager', 'hod', 'hr', 'sub_admin', 'super_admin'), applyScopeFilter, odController.getODs);

// Get single OD
router.get('/od/:id', odController.getOD);

// Apply for OD
router.post('/od', odController.applyOD);

// Update OD
router.put('/od/:id', odController.updateOD);

// Cancel OD
router.put('/od/:id/cancel', odController.cancelOD);

// Process OD action (approve/reject/forward)
router.put('/od/:id/action', authorize('manager', 'hod', 'hr', 'sub_admin', 'super_admin'), odController.processODAction);

// Revoke OD approval (within 2-3 hours)
router.put('/od/:id/revoke', authorize('manager', 'hod', 'hr', 'sub_admin', 'super_admin'), odController.revokeODApproval);

// Update OD outcome
router.put('/od/:id/outcome', odController.updateODOutcome);

// Delete OD
router.delete('/od/:id', authorize('employee', 'sub_admin', 'super_admin'), odController.deleteOD);

// ==========================================
// LEAVE REGISTER ROUTES
// ==========================================
router.get('/register', authorize('employee', 'manager', 'hod', 'hr', 'sub_admin', 'super_admin'), applyScopeFilter, leaveRegisterController.getRegister);
router.get('/register/employee/:employeeId', authorize('manager', 'hod', 'hr', 'sub_admin', 'super_admin'), leaveRegisterController.getEmployeeRegister);
router.get('/register/employee/:employeeId/ledger/:leaveType', authorize('manager', 'hod', 'hr', 'sub_admin', 'super_admin'), leaveRegisterController.getEmployeeLedger);
router.post('/register/adjust', authorize('hr', 'sub_admin', 'super_admin'), leaveRegisterController.adjustLeaveBalance);

// ==========================================
// EARNED LEAVE ROUTES
// ==========================================
// Calculate EL for employee
router.post('/earned/calculate', authorize('employee', 'manager', 'hod', 'hr', 'sub_admin', 'super_admin'), earnedLeaveController.calculateEL);

// Get EL balance
router.get('/earned/balance/:employeeId', authorize('employee', 'manager', 'hod', 'hr', 'sub_admin', 'super_admin'), earnedLeaveController.getELBalance);

// Update EL for all employees (Admin/HR only)
router.post('/earned/update-all', authorize('hr', 'sub_admin', 'super_admin'), earnedLeaveController.updateAllEL);

// Get EL history
router.get('/earned/history/:employeeId', authorize('hr', 'sub_admin', 'super_admin'), earnedLeaveController.getELHistory);

// ==========================================
// ANNUAL CL RESET ROUTES
// ==========================================
// Perform annual CL reset (HR/Admin only)
router.post('/annual-reset', authorize('hr', 'sub_admin', 'super_admin'), annualCLResetController.performAnnualReset);

// Get CL reset status
router.get('/annual-reset/status', authorize('hr', 'sub_admin', 'super_admin'), annualCLResetController.getResetStatus);

// Get next CL reset date
router.get('/annual-reset/next-date', authorize('employee', 'manager', 'hod', 'hr', 'sub_admin', 'super_admin'), annualCLResetController.getNextResetDate);

// Preview annual CL reset
router.post('/annual-reset/preview', authorize('hr', 'sub_admin', 'super_admin'), annualCLResetController.previewReset);

// Apply initial CL balance from policy to all employees (manual; not annual reset)
router.post('/initial-cl-sync', authorize('hr', 'sub_admin', 'super_admin'), annualCLResetController.performInitialCLSync);

// ==========================================
// ACCRUAL ROUTES (run monthly CL/EL accrual; no cron – call manually or from external scheduler)
// ==========================================
router.post('/accrual/run-monthly', authorize('hr', 'sub_admin', 'super_admin'), accrualController.runMonthlyAccruals);

// ==========================================
// LEAVE ROUTES
// ==========================================

// Get my leaves
router.get('/my', leaveController.getMyLeaves);

// Get pending approvals
router.get('/pending-approvals', authorize('manager', 'hod', 'hr', 'sub_admin', 'super_admin'), leaveController.getPendingApprovals);

// Get leave statistics
router.get('/stats', leaveController.getLeaveStats);

// Dashboard counts (global or filtered) for superadmin
router.get('/dashboard-stats', authorize('employee', 'manager', 'hod', 'hr', 'sub_admin', 'super_admin'), applyScopeFilter, leaveController.getDashboardStats);

// Get approved records for a date (for conflict checking)
router.get('/approved-records', leaveController.getApprovedRecordsForDate);

// Get leave conflicts for attendance date
router.get('/conflicts', leaveController.getLeaveConflicts);

// Revoke leave for attendance
router.post('/:id/revoke-for-attendance', authorize('manager', 'super_admin', 'sub_admin', 'hr', 'hod'), leaveController.revokeLeaveForAttendance);

// Update leave for attendance (multi-day leave adjustments)
router.post('/:id/update-for-attendance', authorize('manager', 'super_admin', 'sub_admin', 'hr', 'hod'), leaveController.updateLeaveForAttendance);

// Get all leaves (with filters) - employee allowed; applyScopeFilter restricts to own/scope
router.get('/', authorize('employee', 'manager', 'hod', 'hr', 'sub_admin', 'super_admin'), applyScopeFilter, leaveController.getLeaves);

// Export PDF report
router.get('/export/pdf', authorize('manager', 'hod', 'hr', 'sub_admin', 'super_admin'), applyScopeFilter, leaveController.exportReportPDF);

// Export XLSX report
router.get('/export/xlsx', authorize('manager', 'hod', 'hr', 'sub_admin', 'super_admin'), applyScopeFilter, leaveController.exportReportXLSX);

// Apply for leave
router.post('/', leaveController.applyLeave);

// Get single leave - MUST be after all specific routes like /my, /pending-approvals, /stats, /od/*
router.get('/:id', leaveController.getLeave);

// Update leave
router.put('/:id', leaveController.updateLeave);

// Cancel leave
router.put('/:id/cancel', leaveController.cancelLeave);

// Process leave action (approve/reject/forward)
router.put('/:id/action', authorize('manager', 'hod', 'hr', 'sub_admin', 'super_admin'), leaveController.processLeaveAction);

// Revoke leave approval (within 2-3 hours)
router.put('/:id/revoke', authorize('manager', 'hod', 'hr', 'sub_admin', 'super_admin'), leaveController.revokeLeaveApproval);

// Delete leave
router.delete('/:id', authorize('employee', 'sub_admin', 'super_admin'), leaveController.deleteLeave);

// ==========================================
// LEAVE SPLIT ROUTES
// ==========================================

// Validate splits before creating
router.post('/:id/validate-splits', authorize('manager', 'hod', 'hr', 'sub_admin', 'super_admin'), leaveController.validateLeaveSplits);

// Create splits for a leave
router.post('/:id/split', authorize('manager', 'hod', 'hr', 'sub_admin', 'super_admin'), leaveController.createLeaveSplits);

// Get splits for a leave
router.get('/:id/splits', leaveController.getLeaveSplits);

// Get split summary for a leave
router.get('/:id/split-summary', leaveController.getLeaveSplitSummary);

// Update a single split
router.put('/:id/splits/:splitId', authorize('manager', 'hod', 'hr', 'sub_admin', 'super_admin'), leaveController.updateLeaveSplit);

// Delete a split
router.delete('/:id/splits/:splitId', authorize('manager', 'hod', 'hr', 'sub_admin', 'super_admin'), leaveController.deleteLeaveSplit);

module.exports = router;

