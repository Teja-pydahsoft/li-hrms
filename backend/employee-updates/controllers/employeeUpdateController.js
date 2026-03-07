const EmployeeUpdateApplication = require('../model/EmployeeUpdateApplication');
const Employee = require('../../employees/model/Employee');
const EmployeeHistory = require('../../employees/model/EmployeeHistory');
const Settings = require('../../settings/model/Settings');
const mongoose = require('mongoose');

/**
 * @desc    Create an update request (Employee)
 * @route   POST /api/employee-updates
 * @access  Private (Employee)
 */
exports.createRequest = async (req, res) => {
    try {
        const { requestedChanges, comments } = req.body;

        // 1. Get the profile update configuration
        const configSetting = await Settings.findOne({ key: 'profile_update_request_config' });
        const config = configSetting?.value || { enabled: false, requestableFields: [], allowQualifications: false };

        if (!config.enabled) {
            return res.status(403).json({
                success: false,
                message: 'Profile update requests are currently disabled by administrator'
            });
        }

        // 2. Validate and filter requested changes
        const filteredChanges = {};
        let hasChanges = false;

        // System fields mapping (for reference, these are some common fields)
        const allowedSystemFields = ['employee_name', 'personal_email', 'phone', 'address', 'blood_group'];

        for (const key in requestedChanges) {
            // Check if the field is allowed either in system fields or dynamic fields
            if (config.requestableFields.includes(key)) {
                filteredChanges[key] = requestedChanges[key];
                hasChanges = true;
            }
        }

        // Handle qualifications separately if enabled
        if (requestedChanges.qualifications && config.allowQualifications) {
            filteredChanges.qualifications = requestedChanges.qualifications;
            hasChanges = true;
        }

        if (!hasChanges) {
            return res.status(400).json({
                success: false,
                message: 'No valid or allowed fields requested for update'
            });
        }

        // 3. Find the employee record for the current user
        const query = { $or: [] };
        if (mongoose.Types.ObjectId.isValid(req.user.employeeId)) {
            query.$or.push({ _id: req.user.employeeId });
        }
        if (req.user.emp_no) {
            query.$or.push({ emp_no: req.user.emp_no });
        } else if (req.user.employeeId && !mongoose.Types.ObjectId.isValid(req.user.employeeId)) {
            // If employeeId is not an ObjectId, it's likely the emp_no
            query.$or.push({ emp_no: req.user.employeeId });
        }

        if (query.$or.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid employee identification found in user session'
            });
        }

        const employee = await Employee.findOne(query);
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee record not found for the current user'
            });
        }

        // 4. Create the request
        const request = await EmployeeUpdateApplication.create({
            employeeId: employee._id,
            emp_no: employee.emp_no,
            requestedChanges: filteredChanges,
            status: 'pending',
            createdBy: req.user._id,
            comments: comments || ''
        });

        res.status(201).json({
            success: true,
            data: request,
            message: 'Update request submitted successfully for approval'
        });
    } catch (error) {
        console.error('Error creating update request:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Server error while creating update request'
        });
    }
};

/**
 * @desc    Get all update requests (Superadmin)
 * @route   GET /api/employee-updates
 * @access  Private (Superadmin, Sub Admin)
 */
exports.getRequests = async (req, res) => {
    try {
        const { status } = req.query;
        const query = {};
        if (status) query.status = status;

        const requests = await EmployeeUpdateApplication.find(query)
            .populate('employeeId', 'employee_name profilePhoto department designation dynamicFields personal_email phone address blood_group qualifications')
            .populate('createdBy', 'name')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            data: requests
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * @desc    Approve an update request (Superadmin)
 * @route   PUT /api/employee-updates/:id/approve
 * @access  Private (Superadmin)
 */
exports.approveRequest = async (req, res) => {
    try {
        const request = await EmployeeUpdateApplication.findById(req.params.id);
        if (!request) {
            return res.status(404).json({ success: false, message: 'Request not found' });
        }

        if (request.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Request is already processed' });
        }

        const employee = await Employee.findById(request.employeeId);
        if (!employee) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }

        // 1. Separate permanent fields from dynamic fields
        // This is a bit tricky as we don't know which fields are which without FormSettings
        // But we can check the Employee model schema or common fields.
        const permanentFields = ['employee_name', 'personal_email', 'phone', 'address', 'blood_group', 'qualifications'];

        const updates = { ...request.requestedChanges };
        const permanentUpdates = {};
        const dynamicUpdates = { ...(employee.dynamicFields || {}) };
        let hasPermanent = false;
        let hasDynamic = false;

        for (const key in updates) {
            if (permanentFields.includes(key)) {
                permanentUpdates[key] = updates[key];
                hasPermanent = true;
            } else {
                dynamicUpdates[key] = updates[key];
                hasDynamic = true;
            }
        }

        // 2. Apply updates to the Employee record
        if (hasPermanent) {
            Object.assign(employee, permanentUpdates);
        }
        if (hasDynamic) {
            employee.dynamicFields = dynamicUpdates;
            employee.markModified('dynamicFields');
        }

        await employee.save();

        // 3. Log to History
        await EmployeeHistory.create({
            emp_no: employee.emp_no,
            event: 'employee_updated',
            performedBy: req.user._id,
            details: {
                updateRequestId: request._id,
                changes: updates,
                type: 'profile_update_request'
            }
        }).catch(err => console.error('Failed to log history:', err));

        // 4. Update request status
        request.status = 'approved';
        request.approvedBy = req.user._id;
        await request.save();

        res.json({
            success: true,
            message: 'Request approved and employee updated'
        });
    } catch (error) {
        console.error('Error approving request:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * @desc    Reject an update request (Superadmin)
 * @route   PUT /api/employee-updates/:id/reject
 * @access  Private (Superadmin)
 */
exports.rejectRequest = async (req, res) => {
    try {
        const { comments } = req.body;
        const request = await EmployeeUpdateApplication.findById(req.params.id);

        if (!request) {
            return res.status(404).json({ success: false, message: 'Request not found' });
        }

        if (request.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Request is already processed' });
        }

        request.status = 'rejected';
        request.approvedBy = req.user._id;
        if (comments) request.comments = comments;

        await request.save();

        res.json({
            success: true,
            message: 'Request rejected'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};
