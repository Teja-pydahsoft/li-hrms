const express = require('express');
const router = express.Router();
const resignationSettingsController = require('./controllers/resignationSettingsController');
const resignationController = require('./controllers/resignationController');
const { protect, authorize } = require('../authentication/middleware/authMiddleware');

router.use(protect);

// Settings
router.get('/settings', resignationSettingsController.getSettings);
router.post('/settings', authorize('super_admin'), resignationSettingsController.saveSettings);

// Resignation requests (employee can submit for self only; others for eligible employees)
router.post('/', authorize('employee', 'manager', 'hod', 'hr', 'sub_admin', 'super_admin'), resignationController.createResignationRequest);
router.get('/pending-approvals', authorize('manager', 'hod', 'hr', 'sub_admin', 'super_admin'), resignationController.getPendingApprovals);
router.put('/:id/approve', authorize('manager', 'hod', 'hr', 'sub_admin', 'super_admin'), resignationController.approveResignationRequest);
router.put('/:id/lwd', authorize('manager', 'hod', 'hr', 'sub_admin', 'super_admin'), resignationController.updateLWD);
router.get('/', resignationController.getResignationRequests);

module.exports = router;
