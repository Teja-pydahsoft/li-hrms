const express = require('express');
const router = express.Router();
const employeeController = require('./controllers/employeeController');
const { protect, authorize } = require('../authentication/middleware/authMiddleware');
const { applyScopeFilter } = require('../shared/middleware/dataScopeMiddleware');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// All routes are protected
router.use(protect);

// Get employee settings
router.get('/settings', employeeController.getSettings);

// Update employee settings (dataSource, deleteTarget, auto_generate_employee_number)
router.put('/settings', authorize('manager', 'super_admin', 'sub_admin'), employeeController.updateSettings);

// Get next employee number (for UI when auto-generate is ON)
router.get('/next-emp-no', employeeController.getNextEmpNo);

// Get resolved allowance/deduction defaults for a department/gross salary (optional employee overrides via empNo)
router.get('/components/defaults', employeeController.getAllowanceDeductionDefaults);

// Get employee count
router.get('/count', applyScopeFilter, employeeController.getEmployeeCount);

// Get all employees (with data scope filtering)
router.get('/', applyScopeFilter, employeeController.getAllEmployees);

// Export employees
router.post('/export', applyScopeFilter, employeeController.exportEmployees);

// Get single employee
router.get('/:empNo', employeeController.getEmployee);

// Employee history (Super Admin only)
router.get('/:empNo/history', authorize('super_admin'), employeeController.getEmployeeHistory);

// Create employee (Super Admin, Sub Admin, HR)
router.post('/', authorize('manager', 'super_admin', 'sub_admin', 'hr'), upload.any(), employeeController.createEmployee);

// Resend credentials (Super Admin)
router.post('/:empNo/resend-credentials', authorize('super_admin'), employeeController.resendEmployeePassword);

// Reset credentials (Super Admin)
router.post('/:empNo/reset-credentials', authorize('super_admin'), employeeController.resetEmployeeCredentials);

// Bulk resend credentials (Super Admin)
router.post('/bulk-resend-credentials', authorize('super_admin'), employeeController.bulkResendCredentials);

// Bulk export passwords (Super Admin)
router.post('/bulk-export-passwords', authorize('super_admin'), employeeController.bulkExportEmployeePasswords);

// Update employee (Super Admin, Sub Admin, HR)
router.put('/:empNo', authorize('manager', 'super_admin', 'sub_admin', 'hr'), upload.any(), employeeController.updateEmployee);

// Set employee left date (Super Admin, Sub Admin, HR)
router.put('/:empNo/left-date', authorize('manager', 'super_admin', 'sub_admin', 'hr'), employeeController.setLeftDate);

// Remove employee left date / Reactivate (Super Admin, Sub Admin, HR)
router.delete('/:empNo/left-date', authorize('manager', 'super_admin', 'sub_admin', 'hr'), employeeController.removeLeftDate);

// Delete employee (Super Admin, Sub Admin)
router.delete('/:empNo', authorize('super_admin', 'sub_admin'), employeeController.deleteEmployee);

module.exports = router;
