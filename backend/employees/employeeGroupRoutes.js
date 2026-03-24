const express = require('express');
const router = express.Router();
const employeeGroupController = require('./controllers/employeeGroupController');
const { protect, authorize } = require('../authentication/middleware/authMiddleware');

router.use(protect);

router.get('/', employeeGroupController.getEmployeeGroups);
router.get('/:id', employeeGroupController.getEmployeeGroup);

router.post(
  '/',
  authorize('manager', 'super_admin', 'sub_admin', 'hr'),
  employeeGroupController.createEmployeeGroup
);
router.put(
  '/:id',
  authorize('manager', 'super_admin', 'sub_admin', 'hr'),
  employeeGroupController.updateEmployeeGroup
);
router.delete(
  '/:id',
  authorize('super_admin', 'sub_admin'),
  employeeGroupController.deleteEmployeeGroup
);

module.exports = router;
