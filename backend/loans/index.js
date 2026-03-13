const express = require('express');
const router = express.Router();
const loanController = require('./controllers/loanController');
const settingsController = require('./controllers/loanSettingsController');
const { protect, authorize } = require('../authentication/middleware/authMiddleware');
const { applyScopeFilter } = require('../shared/middleware/dataScopeMiddleware');

// All routes require authentication
router.use(protect);
router.use(applyScopeFilter);

// ==========================================
// SETTINGS ROUTES (Must come before dynamic routes)
// ==========================================

// Get settings for loan or salary_advance
router.get('/settings/:type', settingsController.getSettings);

// Save settings
router.post('/settings/:type', authorize('manager', 'super_admin'), settingsController.saveSettings);
router.put('/settings/:type', authorize('manager', 'super_admin'), settingsController.saveSettings);

// Get users for workflow configuration
router.get('/settings/:type/users', authorize('manager', 'super_admin'), settingsController.getUsersForWorkflow);

// Get workflow configuration
router.get('/settings/:type/workflow', settingsController.getWorkflow);

// Update workflow configuration
router.put('/settings/:type/workflow', authorize('manager', 'super_admin'), settingsController.updateWorkflow);

// ==========================================
// LOAN ROUTES
// ==========================================

// Get my loans
router.get('/my', loanController.getMyLoans);

// Get pending approvals
router.get('/pending-approvals', authorize('manager', 'hod', 'hr', 'sub_admin', 'super_admin'), loanController.getPendingApprovals);

// Get all loans (with filters)
router.get('/', authorize('manager', 'hod', 'hr', 'sub_admin', 'super_admin'), loanController.getLoans);

// Apply for loan/advance
router.post('/', loanController.applyLoan);

// Get guarantor requests
router.get('/guarantor-requests', loanController.getGuarantorRequests);

// Calculate eligibility - MUST be before /:id
router.get('/calculate-eligibility', loanController.calculateEligibility);

// Get single loan - MUST be after all specific routes like /my, /pending-approvals, /calculate-eligibility, /guarantor-requests
router.get('/:id', loanController.getLoan);

// Process guarantor action
router.put('/:id/guarantor-action', loanController.processGuarantorAction);
router.put('/:id', loanController.updateLoan);

// Cancel loan
router.put('/:id/cancel', loanController.cancelLoan);

// Process loan action (approve/reject/forward)
router.put('/:id/action', authorize('manager', 'hod', 'hr', 'sub_admin', 'super_admin'), loanController.processLoanAction);

// Disburse loan
router.put('/:id/disburse', authorize('manager', 'hr', 'sub_admin', 'super_admin'), loanController.disburseLoan);

// Record EMI payment
router.post('/:id/pay-emi', authorize('manager', 'hr', 'sub_admin', 'super_admin'), loanController.payEMI);

// Record advance deduction
router.post('/:id/pay-advance', authorize('manager', 'hr', 'sub_admin', 'super_admin'), loanController.payAdvance);

// Get transaction history
router.get('/:id/transactions', loanController.getTransactions);

// Get early settlement preview
router.get('/:id/settlement-preview', loanController.getSettlementPreview);

module.exports = router;

