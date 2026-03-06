const express = require('express');
const router = express.Router();
const payRegisterController = require('./controllers/payRegisterController');
const { protect, authorize } = require('../authentication/middleware/authMiddleware');

// All routes require authentication
router.use(protect);

// All routes exclude employee role (only super_admin, sub_admin, hr, hod can access)
router.use((req, res, next) => {
  if (req.user && req.user.role === 'employee') {
    return res.status(403).json({
      success: false,
      error: 'Access denied. Employees cannot access pay register.',
    });
  }
  next();
});

// IMPORTANT: More specific routes must come before parameterized routes
// Bulk upload monthly summary
router.post('/upload-summary/:month', payRegisterController.uploadSummaryBulk);

// Export monthly summary as Excel
router.get('/export-summary/:month', payRegisterController.exportSummaryExcel);

// Get all employees with pay registers for a month (must come before /:employeeId routes)
router.get('/employees/:month', payRegisterController.getEmployeesWithPayRegister);

// Get pay register for employee and month
router.get('/:employeeId/:month', payRegisterController.getPayRegister);

// Create pay register
router.post('/:employeeId/:month', payRegisterController.createPayRegister);

// Update pay register
router.put('/:employeeId/:month', payRegisterController.updatePayRegister);

// Update single daily record
router.put('/:employeeId/:month/daily/:date', payRegisterController.updateDailyRecord);

// Sync pay register from sources
router.post('/:employeeId/:month/sync', payRegisterController.syncPayRegister);

// Get edit history
router.get('/:employeeId/:month/history', payRegisterController.getEditHistory);

module.exports = router;

