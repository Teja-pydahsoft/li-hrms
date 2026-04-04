const express = require('express');
const router = express.Router();
const payrollController = require('./controllers/payrollController');
const payrollConfigurationController = require('./controllers/payrollConfigurationController');
const statutoryDeductionController = require('./controllers/statutoryDeductionController');
const { protect, authorize } = require('../authentication/middleware/authMiddleware');
const { applyScopeFilter } = require('../shared/middleware/dataScopeMiddleware');

// All routes require authentication
router.use(protect);

// Calculate payroll (Super Admin, Sub Admin, HR)
router.post('/calculate', authorize('manager', 'super_admin', 'sub_admin', 'hr'), payrollController.calculatePayroll);

// Bulk calculate payroll (Super Admin, Sub Admin, HR) - with scope filtering
router.post('/bulk-calculate', applyScopeFilter, authorize('manager', 'super_admin', 'sub_admin', 'hr'), payrollController.calculatePayrollBulk);

// Recalculate payroll (Super Admin, Sub Admin, HR)
router.post('/recalculate', authorize('manager', 'super_admin', 'sub_admin', 'hr'), payrollController.recalculatePayroll);

// Get payslip (with scope filtering)
router.get('/payslip/:employeeId/:month', applyScopeFilter, payrollController.getPayslip);

// Get payroll records (with scope filtering)
router.get('/', applyScopeFilter, payrollController.getPayrollRecords);

// Get single payroll record by ID
router.get('/record/:id', payrollController.getPayrollRecordById);

// Get payroll transactions
router.get('/:payrollRecordId/transactions', payrollController.getPayrollTransactions);

// Get payroll transactions with analytics for a month
router.get('/transactions/analytics', payrollController.getPayrollTransactionsWithAnalytics);

// Get attendance data for a range of months
router.get('/attendance-range', payrollController.getAttendanceDataRange);

// Payroll configuration (order of steps + output columns)
router.get('/config', payrollConfigurationController.getPayrollConfig);
router.put('/config', authorize('manager', 'super_admin', 'sub_admin', 'hr'), payrollConfigurationController.upsertPayrollConfig);

// Statutory deductions config (ESI, PF, Profession Tax)
router.get('/statutory-config', statutoryDeductionController.getStatutoryConfig);
router.put('/statutory-config', authorize('manager', 'super_admin', 'sub_admin', 'hr'), statutoryDeductionController.upsertStatutoryConfig);

// Export payroll payslips as Excel (with scope filtering)
router.get('/export', applyScopeFilter, payrollController.exportPayrollExcel);

// Paysheet bundle: Regular + 2nd salary + Comparison Excel (must be before /paysheet)
router.get('/paysheet/export-bundle', applyScopeFilter, payrollController.exportPaysheetBundleExcel);

// Default month for paysheet (pay-cycle aware; previous completed period)
router.get('/paysheet/default-month', applyScopeFilter, payrollController.getPaysheetDefaultMonth);

// Get paysheet data (headers + rows) for table – uses config output columns (with scope filtering)
router.get('/paysheet', applyScopeFilter, payrollController.getPaysheetData);

// Approve payroll (Super Admin, Sub Admin, HR)
router.put('/:payrollRecordId/approve', authorize('manager', 'super_admin', 'sub_admin', 'hr'), payrollController.approvePayroll);

// Process payroll (Super Admin, Sub Admin, HR)
router.put('/:payrollRecordId/process', authorize('manager', 'super_admin', 'sub_admin', 'hr'), payrollController.processPayroll);

// Get single payroll record (must be last to avoid route conflicts)
router.get('/:employeeId/:month', payrollController.getPayrollRecord);

module.exports = router;

