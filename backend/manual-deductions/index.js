const express = require('express');
const router = express.Router();
const deductionController = require('./controllers/deductionController');
const { protect, authorize } = require('../authentication/middleware/authMiddleware');

router.use(protect);

router.get('/my', deductionController.getMyDeductions);
router.get('/pending-approvals', authorize('hod', 'hr', 'sub_admin', 'super_admin'), deductionController.getPendingApprovals);
router.get('/stats/summary', deductionController.getDeductionStats);
router.get('/for-payroll', authorize('hr', 'sub_admin', 'super_admin'), deductionController.getDeductionsForPayroll);
router.get('/employee/:employeeId/pending', deductionController.getEmployeePendingDeductions);
router.get('/', authorize('hod', 'hr', 'sub_admin', 'super_admin'), deductionController.getDeductions);
router.post('/bulk', authorize('hr', 'sub_admin', 'super_admin'), deductionController.createDeductionsBulk);
router.put('/bulk-approve', authorize('sub_admin', 'super_admin'), deductionController.bulkApproveDeductions);
router.post('/', authorize('hr', 'sub_admin', 'super_admin'), deductionController.createDeduction);

router.put('/:id/edit', authorize('sub_admin', 'super_admin'), deductionController.editDeduction);
router.put('/:id/transition', authorize('sub_admin', 'super_admin'), deductionController.transitionDeduction);
router.put('/:id/cancel', deductionController.cancelDeduction);
router.put('/:id/action', authorize('hod', 'hr', 'sub_admin', 'super_admin'), deductionController.processDeductionAction);
router.post('/:id/settle', authorize('hr', 'sub_admin', 'super_admin'), deductionController.processSettlement);
router.put('/:id/settlement', authorize('hr', 'sub_admin', 'super_admin'), deductionController.updateDeductionSettlement);
router.put('/:id/revoke', authorize('hod', 'hr', 'sub_admin', 'super_admin'), deductionController.revokeDeductionApproval);

router.get('/:id', deductionController.getDeductionById);
router.put('/:id', deductionController.updateDeduction);

module.exports = router;
