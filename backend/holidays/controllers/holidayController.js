const Holiday = require('../model/Holiday');
const HolidayGroup = require('../model/HolidayGroup');
const User = require('../../users/model/User');
const Division = require('../../departments/model/Division');
const Department = require('../../departments/model/Department');
const Employee = require('../../employees/model/Employee');
const PreScheduledShift = require('../../shifts/model/PreScheduledShift');
const cacheService = require('../../shared/services/cacheService');
const { rosterSyncQueue } = require('../../shared/jobs/queueManager');

// Normalize to YYYY-MM-DD from a Date or date string (avoids timezone shifting calendar day)
function toDateString(d) {
    const x = new Date(d);
    const y = x.getUTCFullYear();
    const m = String(x.getUTCMonth() + 1).padStart(2, '0');
    const day = String(x.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// Helper to sync holiday to shift roster
async function syncHolidayToRoster(holiday) {
    try {
        const { date, endDate, scope, applicableTo, targetGroupIds, groupId, name } = holiday;
        const startStr = toDateString(date);
        const endStr = endDate ? toDateString(endDate) : startStr;

        const dates = [];
        let current = new Date(startStr + 'T12:00:00Z');
        const stop = new Date(endStr + 'T12:00:00Z');
        while (current <= stop) {
            dates.push(toDateString(current));
            current.setUTCDate(current.getUTCDate() + 1);
        }

        // 1. Identify Target Employees
        let empFilter = { is_active: { $ne: false } };
        if (scope === 'GROUP') {
            const group = await HolidayGroup.findById(groupId);
            if (!group) return;

            const mappingConditions = group.divisionMapping.map(m => ({
                division_id: m.division,
                ...(m.departments && m.departments.length > 0 ? { department_id: { $in: m.departments } } : {}),
                ...(m.employeeGroups && m.employeeGroups.length > 0 ? { employee_group_id: { $in: m.employeeGroups } } : {})
            }));
            empFilter.$or = mappingConditions;
        } else if (applicableTo === 'SPECIFIC_GROUPS') {
            const groups = await HolidayGroup.find({ _id: { $in: targetGroupIds } });
            const allMappings = [];
            for (const g of groups) {
                (g.divisionMapping || []).forEach(m => {
                    allMappings.push({
                        division_id: m.division,
                        ...(m.departments && m.departments.length > 0 ? { department_id: { $in: m.departments } } : {}),
                        ...(m.employeeGroups && m.employeeGroups.length > 0 ? { employee_group_id: { $in: m.employeeGroups } } : {})
                    });
                });
            }
            if (allMappings.length > 0) empFilter.$or = allMappings;
            else return; // No targets
        }

        const employees = await Employee.find(empFilter).select('emp_no');
        const empNos = employees.map(e => e.emp_no);

        if (empNos.length === 0) return;

        // 2. Update Roster (Bulk update/upsert)
        // Note: For large datasets, use bulkWrite for performance
        for (const day of dates) {
            for (const empNo of empNos) {
                await PreScheduledShift.findOneAndUpdate(
                    { employeeNumber: empNo, date: day },
                    {
                        $set: {
                            status: 'HOL',
                            shiftId: null,
                            notes: `Holiday: ${name}`
                        },
                        $setOnInsert: { scheduledBy: holiday.createdBy }
                    },
                    { upsert: true }
                );
            }
        }

        console.log(`Synced holiday "${name}" to roster for ${empNos.length} employees across ${dates.length} days.`);
    } catch (err) {
        console.error('Error syncing holiday to roster:', err);
    }
}

function getDateRangeStrings(startInput, endInput) {
    const startStr = toDateString(startInput);
    const endStr = endInput ? toDateString(endInput) : startStr;
    const dates = [];
    let current = new Date(startStr + 'T12:00:00Z');
    const stop = new Date(endStr + 'T12:00:00Z');
    while (current <= stop) {
        dates.push(toDateString(current));
        current.setUTCDate(current.getUTCDate() + 1);
    }
    return dates;
}

async function resolveEmployeesForHolidayScope({ scope, groupId, applicableTo, targetGroupIds }) {
    const baseFilter = (typeof Employee.getCurrentlyActiveFilter === 'function')
        ? Employee.getCurrentlyActiveFilter()
        : { is_active: { $ne: false } };
    if (scope === 'GROUP') {
        const group = await HolidayGroup.findById(groupId).lean();
        if (!group || !group.divisionMapping || group.divisionMapping.length === 0) return [];
        const mappingConditions = group.divisionMapping.map(m => ({
            division_id: m.division,
                ...(m.departments && m.departments.length > 0 ? { department_id: { $in: m.departments } } : {}),
                ...(m.employeeGroups && m.employeeGroups.length > 0 ? { employee_group_id: { $in: m.employeeGroups } } : {})
        }));
        const emps = await Employee.find({ ...baseFilter, $or: mappingConditions }).select('emp_no').lean();
        return emps.map(e => String(e.emp_no || '').toUpperCase()).filter(Boolean);
    }

    if (scope === 'GLOBAL' && applicableTo === 'SPECIFIC_GROUPS') {
        const groups = await HolidayGroup.find({ _id: { $in: targetGroupIds || [] }, isActive: true }).lean();
        const allMappings = [];
        for (const g of groups) {
            (g.divisionMapping || []).forEach(m => {
                allMappings.push({
                    division_id: m.division,
                        ...(m.departments && m.departments.length > 0 ? { department_id: { $in: m.departments } } : {}),
                        ...(m.employeeGroups && m.employeeGroups.length > 0 ? { employee_group_id: { $in: m.employeeGroups } } : {})
                });
            });
        }
        if (allMappings.length === 0) return [];
        const emps = await Employee.find({ ...baseFilter, $or: allMappings }).select('emp_no').lean();
        return emps.map(e => String(e.emp_no || '').toUpperCase()).filter(Boolean);
    }

    const emps = await Employee.find(baseFilter).select('emp_no').lean();
    return emps.map(e => String(e.emp_no || '').toUpperCase()).filter(Boolean);
}

async function guessShiftFromWeekdayPattern(employeeNumber, dateStr) {
    const targetWeekday = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
    const lookbackStart = new Date(`${dateStr}T00:00:00Z`);
    lookbackStart.setUTCDate(lookbackStart.getUTCDate() - 63);
    const fromStr = toDateString(lookbackStart);

    const candidates = await PreScheduledShift.find({
        employeeNumber,
        date: { $gte: fromStr, $lt: dateStr },
        shiftId: { $ne: null },
        status: { $ne: 'HOL' }
    }).select('date shiftId').sort({ date: -1 }).lean();

    for (const row of candidates) {
        const wd = new Date(`${row.date}T00:00:00Z`).getUTCDay();
        if (wd === targetWeekday && row.shiftId) return row.shiftId;
    }
    return null;
}

async function applyRosterEntriesAndSync(entries, userId) {
    if (!entries || entries.length === 0) return { affected: 0 };

    const bulkOps = entries.map(entry => {
        const updateDoc = {
            employeeNumber: entry.employeeNumber,
            date: entry.date,
            notes: entry.status === 'HOL' ? 'Holiday' : (entry.status === 'WO' ? 'Week Off' : null)
        };
        if (entry.status === 'HOL' || entry.status === 'WO') {
            updateDoc.status = entry.status;
            updateDoc.shiftId = null;
        } else if (entry.shiftId) {
            updateDoc.shiftId = entry.shiftId;
            updateDoc.status = null;
        }

        return {
            updateOne: {
                filter: { employeeNumber: entry.employeeNumber, date: entry.date },
                update: { $set: updateDoc, $setOnInsert: { scheduledBy: userId } },
                upsert: true
            }
        };
    });

    await PreScheduledShift.bulkWrite(bulkOps, { ordered: false });
    await rosterSyncQueue.add('syncRoster', { entries, userId }).catch(err => console.error('Failed to enqueue roster sync:', err));
    return { affected: entries.length };
}

// @desc    Get all holidays (Master + Groups)
// @route   GET /api/holidays/admin
// @access  Private (Super Admin, HR)
exports.getAllHolidaysAdmin = async (req, res) => {
    try {
        const { year } = req.query;
        let query = {};

        if (year) {
            query = {
                $or: [
                    { date: { $gte: new Date(`${year}-01-01`), $lte: new Date(`${year}-12-31`) } },
                    { endDate: { $gte: new Date(`${year}-01-01`), $lte: new Date(`${year}-12-31`) } }
                ]
            };
        }

        const holidays = await Holiday.find(query)
            .populate('targetGroupIds', 'name')
            .populate('groupId', 'name')
            .sort({ date: 1 });

        const groups = await HolidayGroup.find({ isActive: true })
            .populate('divisionMapping.division', 'name')
            .populate('divisionMapping.departments', 'name')
            .populate('divisionMapping.employeeGroups', 'name code');

        res.status(200).json({
            success: true,
            data: {
                holidays,
                groups
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching holidays',
            error: error.message
        });
    }
};

// @desc    Get holidays for a specific user (Computed)
// @route   GET /api/holidays/my
// @access  Private
exports.getMyHolidays = async (req, res) => {
    try {
        const userId = req.user.userId;
        const user = await User.findById(userId)
            .populate('division')
            .populate('department')
            .populate('groupMapping', 'name')
            .select('division department role groupMapping');

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const { year } = req.query;
        const dateQuery = year ? {
            $or: [
                { date: { $gte: new Date(`${year}-01-01`), $lte: new Date(`${year}-12-31`) } },
                { endDate: { $gte: new Date(`${year}-01-01`), $lte: new Date(`${year}-12-31`) } }
            ]
        } : {};

        // 1. Identify User's Group
        // Find groups that match user's division + department + custom employee group (if configured).
        const userGroupIds = (user.groupMapping || [])
            .map(g => (g && g._id ? g._id.toString() : g?.toString()))
            .filter(Boolean);

        const allGroups = await HolidayGroup.find({ isActive: true }).lean();
        const applicableGroups = allGroups.filter((g) => {
            const maps = g.divisionMapping || [];
            return maps.some((m) => {
                const divMatch = m.division?.toString() === user.division?._id?.toString();
                if (!divMatch) return false;

                const deptMatch = !m.departments || m.departments.length === 0
                    ? true
                    : m.departments.some((d) => d?.toString() === user.department?._id?.toString());
                if (!deptMatch) return false;

                const grpMatch = !m.employeeGroups || m.employeeGroups.length === 0
                    ? true
                    : userGroupIds.length > 0 && m.employeeGroups.some((eg) => userGroupIds.includes(eg?.toString()));

                return grpMatch;
            });
        });

        const groupIds = applicableGroups.map(g => g._id);

        // 2. Fetch Master Holidays
        // - Global (applicableTo: 'ALL')
        // - Partial (applicableTo: 'SPECIFIC_GROUPS' and user's group is in targetGroupIds)
        const masterHolidays = await Holiday.find({
            ...dateQuery,
            isMaster: true,
            $or: [
                { applicableTo: 'ALL' },
                {
                    applicableTo: 'SPECIFIC_GROUPS',
                    targetGroupIds: { $in: groupIds }
                }
            ]
        }).lean();

        // 3. Fetch Group Specific Holidays
        const groupHolidays = await Holiday.find({
            ...dateQuery,
            scope: 'GROUP',
            groupId: { $in: groupIds }
        }).lean();

        // 4. Merge and Handle Overrides
        // If a group holiday overrides a master holiday, replace it
        const masterMap = new Map(masterHolidays.map(h => [h._id.toString(), h]));

        // Process group holidays
        const finalHolidays = [];

        // Add all group holidays first (they might be additions or overrides)
        for (const gh of groupHolidays) {
            if (gh.overridesMasterId) {
                // This is an override, remove the master from the map
                masterMap.delete(gh.overridesMasterId.toString());
            }
            finalHolidays.push(gh);
        }

        // Add remaining master holidays
        finalHolidays.push(...masterMap.values());

        // Sort by date
        finalHolidays.sort((a, b) => new Date(a.date) - new Date(b.date));

        res.status(200).json({
            success: true,
            count: finalHolidays.length,
            data: finalHolidays
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching user holidays',
            error: error.message
        });
    }
};

// @desc    Create/Update Holiday Group
// @route   POST /api/holidays/groups
// @access  Private (Super Admin)
exports.saveHolidayGroup = async (req, res) => {
    try {
        const { _id, name, description, divisionMapping, isActive } = req.body;

        const hasOverlap = (a = [], b = []) => {
            if (a.length === 0 || b.length === 0) return true; // empty means ALL
            return a.some(v => b.includes(v));
        };

        const normalizeMapping = (m) => ({
            division: m.division?.toString(),
            departments: (m.departments || []).map(d => d.toString()),
            employeeGroups: (m.employeeGroups || []).map(g => g.toString())
        });

        const inputMappings = (divisionMapping || []).map(normalizeMapping).filter(m => m.division);

        // 0. Validation: duplicates inside the same payload
        for (let i = 0; i < inputMappings.length; i++) {
            for (let j = i + 1; j < inputMappings.length; j++) {
                const a = inputMappings[i];
                const b = inputMappings[j];
                if (a.division !== b.division) continue;

                const deptOverlap = hasOverlap(a.departments, b.departments);
                const groupOverlap = hasOverlap(a.employeeGroups, b.employeeGroups);

                if (deptOverlap && groupOverlap) {
                    return res.status(400).json({
                        success: false,
                        message: `Duplicate mapping rows detected in this form (rows ${i + 1} and ${j + 1}) for the same division scope. Please refine departments or employee groups.`
                    });
                }
            }
        }

        // 1. Validation: Mapping Exclusivity
        // Ensure that (Division, Department, EmployeeGroup) scope doesn't overlap with another group
        const allGroups = await HolidayGroup.find({ _id: { $ne: _id }, isActive: true });

        for (const mapping of inputMappings) {
            const currentDivisionId = mapping.division;
            const currentDeptIds = mapping.departments;
            const currentEmpGroupIds = mapping.employeeGroups;

            for (const existingGroup of allGroups) {
                for (const existingMapping of existingGroup.divisionMapping) {
                    if (existingMapping.division.toString() === currentDivisionId) {
                        const existingDeptIds = existingMapping.departments.map(d => d.toString());
                        const existingEmpGroupIds = (existingMapping.employeeGroups || []).map(g => g.toString());
                        const deptOverlap = hasOverlap(currentDeptIds, existingDeptIds);
                        const groupOverlap = hasOverlap(currentEmpGroupIds, existingEmpGroupIds);

                        if (deptOverlap && groupOverlap) {
                            return res.status(400).json({
                                success: false,
                                message: `Some Division/Department/Employee Group scope is already mapped in group: ${existingGroup.name}. Duplicate mappings are not allowed.`
                            });
                        }
                    }
                }
            }
        }

        let group;
        if (_id) {
            group = await HolidayGroup.findById(_id);
            if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

            group.name = name;
            group.description = description;
            group.divisionMapping = divisionMapping;
            group.isActive = isActive !== undefined ? isActive : group.isActive;
            await group.save();
        } else {
            group = await HolidayGroup.create({
                name,
                description,
                divisionMapping,
                isActive: true,
                createdBy: req.user.userId
            });
        }

        res.status(200).json({
            success: true,
            data: group
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error saving holiday group',
            error: error.message
        });
    }
};

// @desc    Create/Update Holiday (Master or Group)
// @route   POST /api/holidays
// @access  Private (Super Admin)
exports.saveHoliday = async (req, res) => {
    try {
        const { _id, name, date, endDate, type, isMaster, scope, applicableTo, targetGroupIds, groupId, overridesMasterId, description, rosterFillMode } = req.body;
        let createdMessage = null;

        // Validation
        if (scope === 'GROUP' && !groupId) {
            return res.status(400).json({ success: false, message: 'Group ID is required for Group Scope holidays' });
        }

        let holiday;
        // --- UPDATE LOGIC ---
        if (_id) {
            holiday = await Holiday.findById(_id);
            if (!holiday) return res.status(404).json({ success: false, message: 'Holiday not found' });

            const wasGlobal = holiday.scope === 'GLOBAL';
            const isNowGlobal = scope === 'GLOBAL';

            // Update the main holiday
            holiday.name = name;
            holiday.date = date;
            holiday.endDate = endDate || null;
            holiday.type = type;
            holiday.isMaster = isMaster;
            holiday.scope = scope;
            holiday.applicableTo = applicableTo;
            holiday.targetGroupIds = applicableTo === 'SPECIFIC_GROUPS' ? targetGroupIds : [];
            holiday.groupId = scope === 'GROUP' ? groupId : undefined;
            holiday.overridesMasterId = overridesMasterId;
            holiday.description = description;

            // If updating a Group Copy (that has a source), break the sync
            if (holiday.sourceHolidayId) {
                holiday.isSynced = false;
            }

            await holiday.save();

            // PROPAGATION: If Global Holiday Updated
            if (isNowGlobal) {
                // Find all synced copies and update them
                await Holiday.updateMany(
                    { sourceHolidayId: holiday._id, isSynced: true },
                    {
                        $set: {
                            name,
                            date,
                            endDate: endDate || null,
                            type,
                            description
                        }
                    }
                );
            }
        }
        // --- CREATE LOGIC ---
        else {
            // Special Case: Bulk Create for Specific Groups (Individually, No Global Master)
            if (scope === 'GLOBAL' && applicableTo === 'SPECIFIC_GROUPS' && targetGroupIds && targetGroupIds.length > 0) {
                const holidaysToCreate = targetGroupIds.map(gid => ({
                    name,
                    date,
                    endDate: endDate || null,
                    type,
                    isMaster: false,
                    scope: 'GROUP',
                    groupId: gid,
                    description,
                    createdBy: req.user.userId,
                    isSynced: false // Independent
                }));

                const createdHolidays = await Holiday.insertMany(holidaysToCreate);
                holiday = createdHolidays[0];
                createdMessage = `Created ${createdHolidays.length} group holidays`;
            } else {
                holiday = await Holiday.create({
                    name,
                    date,
                    endDate: endDate || null,
                    type,
                    isMaster,
                    scope,
                    applicableTo,
                    targetGroupIds: applicableTo === 'SPECIFIC_GROUPS' ? targetGroupIds : [],
                    groupId: scope === 'GROUP' ? groupId : undefined,
                    overridesMasterId,
                    description,
                    createdBy: req.user.userId,
                    // Default new holidays to synced (if they become copies later logic handles it, but here it's main)
                    isSynced: true
                });

                // PROPAGATION: If Global Holiday Created -> Create Synced Copies for ALL or SPECIFIC Groups
                if (scope === 'GLOBAL') {
                    let groupFilter = { isActive: true };

                    // If targeting specific groups, filter by ID
                    if (applicableTo === 'SPECIFIC_GROUPS' && targetGroupIds && targetGroupIds.length > 0) {
                        groupFilter._id = { $in: targetGroupIds };
                    }

                    const targetedGroups = await HolidayGroup.find(groupFilter);

                    const copies = targetedGroups.map(group => ({
                        name,
                        date,
                        endDate: endDate || null,
                        type,
                        isMaster: false, // Copies are not "Master" definitions, they are instances
                        scope: 'GROUP',
                        groupId: group._id,
                        description,
                        createdBy: req.user.userId,
                        sourceHolidayId: holiday._id, // Link to Parent
                        isSynced: true // Synced by default
                    }));

                    if (copies.length > 0) {
                        await Holiday.insertMany(copies);
                    }
                }
            }
        }

        const effectiveScope = scope;
        const effectiveApplicableTo = applicableTo || 'ALL';
        const effectiveGroupId = scope === 'GROUP' ? groupId : undefined;
        const effectiveTargetGroupIds = effectiveApplicableTo === 'SPECIFIC_GROUPS' ? (targetGroupIds || []) : [];
        const matchedEmployees = await resolveEmployeesForHolidayScope({
            scope: effectiveScope,
            groupId: effectiveGroupId,
            applicableTo: effectiveApplicableTo,
            targetGroupIds: effectiveTargetGroupIds
        });
        const holidayDates = getDateRangeStrings(date, endDate);
        const fillStatus = rosterFillMode === 'WEEK_OFF' ? 'WO' : 'HOL';
        const rosterEntries = [];
        for (const empNo of matchedEmployees) {
            for (const day of holidayDates) {
                rosterEntries.push({
                    employeeNumber: empNo,
                    date: day,
                    status: fillStatus
                });
            }
        }
        await applyRosterEntriesAndSync(rosterEntries, req.user.userId);

        res.status(200).json({
            success: true,
            data: holiday,
            ...(createdMessage ? { message: createdMessage } : {})
        });

        // Keep legacy background sync (safe no-op override) for backward compatibility.
        syncHolidayToRoster(holiday).catch(err => console.error('Roster Sync Error:', err));

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error saving holiday',
            error: error.message
        });
    }
};

// @desc    Delete Holiday
// @route   DELETE /api/holidays/:id
// @access  Private (Super Admin)
exports.deleteHoliday = async (req, res) => {
    try {
        const { onDeleteAction = 'RESTORE_PATTERN' } = req.body || {};
        const holiday = await Holiday.findById(req.params.id);
        if (!holiday) return res.status(404).json({ success: false, message: 'Holiday not found' });

        const deleteDates = getDateRangeStrings(holiday.date, holiday.endDate);
        const employeeNumbers = await resolveEmployeesForHolidayScope({
            scope: holiday.scope,
            groupId: holiday.groupId,
            applicableTo: holiday.applicableTo,
            targetGroupIds: holiday.targetGroupIds
        });

        // If deleting a Global Holiday -> Delete it AND all synced copies
        if (holiday.scope === 'GLOBAL') {
            // Delete copies that are still synced
            await Holiday.deleteMany({ sourceHolidayId: holiday._id, isSynced: true });

            // For copies that are NOT synced (overridden), detach them (clear sourceHolidayId)
            await Holiday.updateMany(
                { sourceHolidayId: holiday._id, isSynced: false },
                { $set: { sourceHolidayId: null } }
            );
        }

        // If deleting a Group Copy -> Just delete it (Opt-out)
        // No extra logic needed, just standard delete below

        await holiday.deleteOne();

        const rosterEntries = [];
        if (onDeleteAction === 'WEEK_OFF') {
            for (const empNo of employeeNumbers) {
                for (const day of deleteDates) {
                    rosterEntries.push({ employeeNumber: empNo, date: day, status: 'WO' });
                }
            }
        } else {
            for (const empNo of employeeNumbers) {
                for (const day of deleteDates) {
                    const shiftId = await guessShiftFromWeekdayPattern(empNo, day);
                    if (shiftId) rosterEntries.push({ employeeNumber: empNo, date: day, shiftId });
                    else rosterEntries.push({ employeeNumber: empNo, date: day, status: 'WO' });
                }
            }
        }
        await applyRosterEntriesAndSync(rosterEntries, req.user.userId);

        res.status(200).json({ success: true, message: 'Holiday deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error deleting holiday', error: error.message });
    }
};

// @desc    Delete Holiday Group
// @route   DELETE /api/holidays/groups/:id
// @access  Private (Super Admin)
exports.deleteHolidayGroup = async (req, res) => {
    try {
        const group = await HolidayGroup.findById(req.params.id);
        if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

        // Check if used in holidays
        const associatedHolidays = await Holiday.countDocuments({ groupId: group._id });
        if (associatedHolidays > 0) {
            return res.status(400).json({
                success: false,
                message: `Cannot delete group: It has ${associatedHolidays} holidays associated with it. Delete the holidays first.`
            });
        }

        await group.deleteOne();

        res.status(200).json({ success: true, message: 'Holiday Group deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error deleting group', error: error.message });
    }
};
