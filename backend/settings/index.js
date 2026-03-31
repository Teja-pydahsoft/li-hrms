const express = require('express');
const router = express.Router();
const settingsController = require('./controllers/settingsController');
const leavePolicySettingsController = require('./controllers/leavePolicySettingsController');
const { protect, authorize } = require('../authentication/middleware/authMiddleware');

// All routes require authentication
router.use(protect);

// Principal feature control routes (Super Admin only)

// ==========================================
// LEAVE POLICY SETTINGS ROUTES (Must come before /:key)
// ==========================================

// Get leave policy settings
router.get('/leave-policy', authorize('hr', 'sub_admin', 'super_admin', 'manager', 'hod'), leavePolicySettingsController.getSettings);

// Update leave policy settings
router.put('/leave-policy', authorize('hr', 'sub_admin', 'super_admin'), leavePolicySettingsController.updateSettings);

// Initialize leave policy settings (force create)
router.post('/leave-policy/init', authorize('super_admin'), leavePolicySettingsController.initSettings);

// Reset leave policy settings (Admin only)
router.post('/leave-policy/reset', authorize('super_admin'), leavePolicySettingsController.resetSettings);

// Preview EL calculation
router.post('/leave-policy/preview', authorize('hr', 'sub_admin', 'super_admin'), leavePolicySettingsController.previewELCalculation);

// Get all settings
router.get('/', settingsController.getAllSettings);

// Get single setting
router.get('/:key', settingsController.getSetting);

// Create or update setting (Super Admin, Sub Admin)
router.post('/', authorize('manager', 'super_admin', 'sub_admin'), settingsController.upsertSetting);
router.put('/:key', authorize('manager', 'super_admin', 'sub_admin'), settingsController.upsertSetting);

// Delete setting (Super Admin only)
router.delete('/:key', authorize('super_admin'), settingsController.deleteSetting);

module.exports = router;

