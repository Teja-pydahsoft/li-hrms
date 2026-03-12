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
        const { requestedChanges, comments, type = 'profile' } = req.body;

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
            if (type === 'bank') {
                const bankFields = ['bank_account_no', 'bank_name', 'bank_place', 'ifsc_code', 'salary_mode'];
                if (bankFields.includes(key)) {
                    filteredChanges[key] = requestedChanges[key];
                    hasChanges = true;
                }
            } else if (config.requestableFields.includes(key)) {
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

        // 3. Find the employee record (from body if admin, or from session)
        const query = { $or: [] };
        
        if (req.body.employeeId) {
            // Target specific employee (likely Admin/Manager initiated)
            if (mongoose.Types.ObjectId.isValid(req.body.employeeId)) {
                query.$or.push({ _id: req.body.employeeId });
            } else {
                query.$or.push({ emp_no: req.body.employeeId });
            }
        } else {
            // Self-service (Employee initiated, use session)
            if (mongoose.Types.ObjectId.isValid(req.user.employeeId)) {
                query.$or.push({ _id: req.user.employeeId });
            }
            if (req.user.emp_no) {
                query.$or.push({ emp_no: req.user.emp_no });
            }
        }

        if (query.$or.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid employee identification found in request or session'
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
        const fieldMapping = {
            'personal_email': 'email',
            'phone': 'phone_number',
            'date_of_birth': 'dob',
            'joining_date': 'doj'
        };

        const previousValues = {};
        for (const key in filteredChanges) {
            const actualKey = fieldMapping[key] || key;
            if (employee[actualKey] !== undefined) {
                previousValues[key] = employee[actualKey];
            } else if (employee.dynamicFields && employee.dynamicFields[actualKey] !== undefined) {
                previousValues[key] = employee.dynamicFields[actualKey];
            } else {
                previousValues[key] = null;
            }
        }

        const request = await EmployeeUpdateApplication.create({
            employeeId: employee._id,
            emp_no: employee.emp_no,
            requestedChanges: filteredChanges,
            previousValues,
            status: 'pending',
            type,
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
            .populate('employeeId', 'employee_name profilePhoto department designation dynamicFields email phone_number address blood_group qualifications dob doj gender marital_status')
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
        const permanentFields = [
            'employee_name', 'email', 'phone_number', 'address',
            'blood_group', 'qualifications', 'dob', 'doj',
            'gender', 'marital_status',
            'bank_account_no', 'bank_name', 'bank_place', 'ifsc_code', 'salary_mode'
        ];

        // Mapping for frontend aliases
        const fieldMapping = {
            'personal_email': 'email',
            'phone': 'phone_number',
            'date_of_birth': 'dob',
            'joining_date': 'doj'
        };

        const updates = { ...request.requestedChanges };
        const permanentUpdates = {};
        const dynamicUpdates = { ...(employee.dynamicFields || {}) };
        let hasPermanent = false;
        let hasDynamic = false;

        for (let key in updates) {
            // Apply mapping if exists
            const actualKey = fieldMapping[key] || key;
            const value = updates[key];

            if (permanentFields.includes(actualKey)) {
                permanentUpdates[actualKey] = value;
                hasPermanent = true;
            } else {
                dynamicUpdates[actualKey] = value;
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

        if (permanentUpdates.qualifications) {
            employee.markModified('qualifications');
        }

        await employee.save();

        // 2b. Sync with User model if necessary
        if (permanentUpdates.employee_name || permanentUpdates.email) {
            const User = require('../../users/model/User');
            const userUpdate = {};
            if (permanentUpdates.employee_name) userUpdate.name = permanentUpdates.employee_name;
            if (permanentUpdates.email) userUpdate.email = permanentUpdates.email;

            await User.findOneAndUpdate(
                { employeeRef: employee._id },
                { $set: userUpdate }
            ).catch(err => console.error('Failed to sync User model:', err));
        }

        // 3. Log to History with detailed changes
        const historyChanges = Object.keys(updates).map(key => ({
            field: key,
            previous: request.previousValues ? request.previousValues[key] : null,
            current: updates[key]
        }));

        await EmployeeHistory.create({
            emp_no: employee.emp_no,
            event: 'employee_updated',
            performedBy: req.user._id,
            performedByName: req.user.name || null,
            performedByRole: req.user.role || null,
            details: {
                updateRequestId: request._id,
                changes: historyChanges,
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
