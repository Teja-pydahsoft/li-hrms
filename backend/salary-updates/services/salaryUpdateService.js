const xlsx = require('xlsx');
const mongoose = require('mongoose');
const Employee = require('../../employees/model/Employee');
const AllowanceDeductionMaster = require('../../allowances-deductions/model/AllowanceDeductionMaster');
const Division = require('../../departments/model/Division');
const Department = require('../../departments/model/Department');
const Designation = require('../../departments/model/Designation');
const EmployeeGroup = require('../../employees/model/EmployeeGroup');
const SecondSalarySyncService = require('../../payroll/services/secondSalarySyncService');
const { getTodayISTDateString } = require('../../shared/utils/dateUtils');

/** Field IDs that store ObjectIds; we show names in template and resolve names on upload */
const REF_FIELD_IDS = ['division_id', 'department_id', 'designation_id', 'employee_group_id'];

/** Top-level Employee schema paths (excluding _id, __v, timestamps, dynamicFields). Non-schema fields go into dynamicFields. */
const EMPLOYEE_TOP_LEVEL_PATHS = new Set(
    Object.keys(Employee.schema.paths).filter(
        p => !['_id', '__v', 'created_at', 'updated_at', 'dynamicFields'].includes(p)
    )
);

/** Static header->fieldId map so upload works even when form settings are missing or structure differs. */
const normalizeHeader = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const STATIC_HEADER_TO_FIELD = {
    [normalizeHeader('Employee ID')]: null,
    [normalizeHeader('emp_no')]: null,
    [normalizeHeader('employee_name')]: 'employee_name',
    [normalizeHeader('Employee Name')]: 'employee_name',
    [normalizeHeader('division_id')]: 'division_id',
    [normalizeHeader('Division')]: 'division_id',
    [normalizeHeader('department_id')]: 'department_id',
    [normalizeHeader('Department')]: 'department_id',
    [normalizeHeader('designation_id')]: 'designation_id',
    [normalizeHeader('Designation')]: 'designation_id',
    [normalizeHeader('second_salary')]: 'second_salary',
    [normalizeHeader('Second Salary')]: 'second_salary',
    [normalizeHeader('gross_salary')]: 'gross_salary',
    [normalizeHeader('Gross Salary')]: 'gross_salary',
    [normalizeHeader('proposedSalary')]: 'proposedSalary',
    [normalizeHeader('Proposed Salary')]: 'proposedSalary',
    [normalizeHeader('employee_group_id')]: 'employee_group_id',
    [normalizeHeader('Employee Group')]: 'employee_group_id',
    [normalizeHeader('employee_group')]: 'employee_group_id',
};

/**
 * Service to handle second salary updates
 */
const processSecondSalaryUpload = async (fileBuffer) => {
    try {
        const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);

        if (!data || data.length === 0) {
            return {
                success: false,
                message: 'No data found in the uploaded file',
                stats: { total: 0, updated: 0, failed: 0 }
            };
        }

        let updatedCount = 0;
        let failedCount = 0;
        const errors = [];

        // Process each row
        for (const row of data) {
            // Normalize keys to lowercase to be safe
            const normalizeKey = (obj, key) => {
                const found = Object.keys(obj).find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '') === key.toLowerCase().replace(/[^a-z0-9]/g, ''));
                return found ? obj[found] : undefined;
            };

            const empNo = normalizeKey(row, 'empno') || normalizeKey(row, 'employeeid');
            const secondSalary = normalizeKey(row, 'secondsalary');

            if (!empNo) {
                failedCount++;
                errors.push({ row, error: 'Missing Employee ID' });
                continue;
            }

            if (secondSalary === undefined || secondSalary === null || secondSalary === '') {
                failedCount++;
                errors.push({ empNo, error: 'Missing Second Salary value' });
                continue;
            }

            const salaryValue = Number(secondSalary);
            if (isNaN(salaryValue)) {
                failedCount++;
                errors.push({ empNo, error: `Invalid salary value: ${secondSalary}` });
                continue;
            }

            try {
                const doc = await Employee.findOneAndUpdate(
                    { emp_no: empNo },
                    { $set: { second_salary: salaryValue } },
                    { new: true }
                );

                if (!doc) {
                    failedCount++;
                    errors.push({ empNo, error: 'Employee not found' });
                } else {
                    updatedCount++;
                    // Trigger sync for current month
                    const currentMonth = getTodayISTDateString().slice(0, 7);
                    SecondSalarySyncService.syncEmployee(doc._id, currentMonth, 'system')
                        .catch(err => console.error('[SalaryUpdate] Second Salary sync failed:', err));
                }
            } catch (err) {
                failedCount++;
                errors.push({ empNo, error: err.message });
            }
        }

        return {
            success: true,
            message: `Processed ${data.length} records. Updated: ${updatedCount}, Failed: ${failedCount}`,
            stats: {
                total: data.length,
                updated: updatedCount,
                failed: failedCount,
                errors: errors.length > 0 ? errors : undefined
            }
        };

    } catch (error) {
        console.error('Error processing second salary upload:', error);
        throw new Error('Failed to process Excel file: ' + error.message);
    }
};

/**
 * Generates data for the salary update template by fetching all active employees.
 */
const generateSalaryUpdateTemplateData = async () => {
    try {
        const employees = await Employee.find({ is_active: true }, 'emp_no').sort({ emp_no: 1 });

        return employees.map(emp => ({
            'Employee ID': emp.emp_no,
            'Second Salary': ''
        }));
    } catch (error) {
        console.error('Error fetching employees for template:', error);
        throw new Error('Failed to fetch employees for template: ' + error.message);
    }
};

/**
 * Dynamic Employee Update - Template Generator
 */
const generateEmployeeUpdateTemplateData = async (selectedFieldIds) => {
    try {
        // Ensure we always have a flat array of single field ids (no comma-separated strings)
        const fieldIds = [];
        (Array.isArray(selectedFieldIds) ? selectedFieldIds : [selectedFieldIds]).forEach(item => {
            const s = String(item).trim();
            if (!s) return;
            if (s.includes(',')) {
                s.split(',').forEach(f => { const t = f.trim(); if (t) fieldIds.push(t); });
            } else {
                fieldIds.push(s);
            }
        });
        const ids = [...new Set(fieldIds)];
        if (ids.length === 0) throw new Error('No field ids provided');

        const FormSettings = require('../../employee-applications/model/EmployeeApplicationFormSettings');
        const settings = await FormSettings.getActiveSettings();

        const fieldMap = {};
        if (settings && settings.groups) {
            settings.groups.forEach(group => {
                (group.fields || []).forEach(field => {
                    if (field && field.id) fieldMap[field.id] = field.label || field.id;
                });
            });
        }

        const employees = await Employee.find({ is_active: true }).sort({ emp_no: 1 }).lean();

        // Fetch ref collections to show names instead of ObjectIds in template
        const [divisions, departments, designations, employeeGroups] = await Promise.all([
            Division.find({ isActive: true }).select('_id name code').lean(),
            Department.find({ isActive: true }).select('_id name code').lean(),
            Designation.find({ isActive: true }).select('_id name code').lean(),
            EmployeeGroup.find({}).select('_id name code isActive').lean(),
        ]);
        const divisionIdToName = {};
        const departmentIdToName = {};
        const designationIdToName = {};
        const employeeGroupIdToName = {};
        divisions.forEach(d => { divisionIdToName[String(d._id)] = d.name || d.code || ''; });
        departments.forEach(d => { departmentIdToName[String(d._id)] = d.name || d.code || ''; });
        designations.forEach(d => { designationIdToName[String(d._id)] = d.name || d.code || ''; });
        employeeGroups.forEach(g => { employeeGroupIdToName[String(g._id)] = g.name || g.code || ''; });

        const headers = ['Employee ID'];
        ids.forEach(id => {
            // proposedSalary is shown and stored as Gross Salary
            headers.push(id === 'proposedSalary' ? 'Gross Salary' : (fieldMap[id] || id));
        });

        const data = employees.map(emp => {
            const row = { 'Employee ID': emp.emp_no };
            const base = { ...emp };
            const dynamic = base.dynamicFields || {};
            const unified = { ...base, ...dynamic };

            ids.forEach(id => {
                const label = id === 'proposedSalary' ? 'Gross Salary' : (fieldMap[id] || id);
                let val = id === 'proposedSalary' ? unified.gross_salary : unified[id];
                // Show name instead of ObjectId for division/department/designation
                if (REF_FIELD_IDS.includes(id) && (val != null)) {
                    const idStr = String(val);
                    if (id === 'division_id') val = divisionIdToName[idStr] || '';
                    else if (id === 'department_id') val = departmentIdToName[idStr] || '';
                    else if (id === 'designation_id') val = designationIdToName[idStr] || '';
                    else if (id === 'employee_group_id') val = employeeGroupIdToName[idStr] || '';
                    else val = idStr;
                }
                if (val === undefined || val === null) val = '';
                if (val && typeof val === 'object' && val.constructor && (val.constructor.name === 'ObjectID' || val.constructor.name === 'ObjectId')) val = String(val);
                if (val && Object.prototype.toString.call(val) === '[object Date]') val = val.toISOString ? val.toISOString().slice(0, 10) : String(val);
                row[label] = val;
            });
            return row;
        });

        return { data, headers };
    } catch (error) {
        console.error('Error generating dynamic template:', error);
        throw error;
    }
};

/**
 * Build lookup maps: name/code -> _id for Division, Department, Designation (resolve names on upload)
 */
const buildRefLookups = async () => {
    const [divisions, departments, designations, employeeGroups] = await Promise.all([
        Division.find({ isActive: true }).select('_id name code').lean(),
        Department.find({ isActive: true }).select('_id name code').lean(),
        Designation.find({ isActive: true }).select('_id name code').lean(),
        EmployeeGroup.find({}).select('_id name code isActive').lean(),
    ]);
    const byKey = (list) => {
        const map = {};
        list.forEach(item => {
            const id = item._id;
            if (item.name != null && String(item.name).trim()) map[String(item.name).trim().toLowerCase()] = id;
            if (item.code != null && String(item.code).trim()) map[String(item.code).trim().toUpperCase()] = id;
        });
        return map;
    };
    return {
        divisionByKey: byKey(divisions),
        departmentByKey: byKey(departments),
        designationByKey: byKey(designations),
        employeeGroupByKey: byKey(employeeGroups),
    };
};

/**
 * Resolve a cell value to ObjectId for ref fields: accept name, code, or existing ObjectId string
 */
const resolveRefValue = (value, fieldId, lookups) => {
    if (value === undefined || value === null || value === '') return null;
    const str = String(value).trim();
    if (!str) return null;
    if (mongoose.Types.ObjectId.isValid(str) && str.length === 24) return new mongoose.Types.ObjectId(str);
    const byKey = fieldId === 'division_id' ? lookups.divisionByKey
        : fieldId === 'department_id' ? lookups.departmentByKey
            : fieldId === 'designation_id' ? lookups.designationByKey
                : fieldId === 'employee_group_id' ? lookups.employeeGroupByKey : null;
    if (!byKey) return null;
    return byKey[str.toLowerCase()] || byKey[str.toUpperCase()] || null;
};

/**
 * Dynamic Employee Update - Process Upload
 */
const processEmployeeUpdateUpload = async (fileBuffer) => {
    try {
        const FormSettings = require('../../employee-applications/model/EmployeeApplicationFormSettings');
        const settings = await FormSettings.getActiveSettings();

        // Map labels/IDs to internal field IDs (template headers can be label or field id; normalize like upload headers)
        const labelToIdMap = {};
        if (settings && settings.groups) {
            settings.groups.forEach(group => {
                (group.fields || []).forEach(field => {
                    if (field && field.id) {
                        const normalizedLabel = (field.label || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        const normalizedId = (field.id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        labelToIdMap[normalizedLabel] = field.id;
                        labelToIdMap[normalizedId] = field.id;
                        labelToIdMap[(field.id || '').toLowerCase()] = field.id;
                    }
                });
            });
        }

        const lookups = await buildRefLookups();

        const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        if (!data || data.length === 0) return { success: false, message: 'No data found', stats: { total: 0, updated: 0, failed: 0 } };

        let updatedCount = 0;
        let failedCount = 0;
        const errors = [];

        for (const row of data) {
            const updateData = {};
            let empNo = '';

            // Map columns to fields (trim header so Excel BOM/spaces don't break matching)
            const headerNorm = (h) => String(h).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
            Object.keys(row).forEach(header => {
                const normalizedHeader = headerNorm(header);

                if (normalizedHeader === 'employeeid' || normalizedHeader === 'empno') {
                    empNo = row[header];
                    return;
                }
                const fieldId = labelToIdMap[normalizedHeader] || STATIC_HEADER_TO_FIELD[normalizedHeader];
                if (!fieldId || fieldId === 'emp_no') return;

                let cellValue = row[header];
                if (REF_FIELD_IDS.includes(fieldId)) {
                    const resolved = resolveRefValue(cellValue, fieldId, lookups);
                    if (resolved !== null) {
                        updateData[fieldId] = resolved;
                    } else if (cellValue !== undefined && cellValue !== null && String(cellValue).trim() !== '') {
                        errors.push({ empNo: empNo || '(unknown)', error: `Unknown ${fieldId.replace('_id', '')} (use name or code): "${cellValue}"` });
                    }
                } else {
                    updateData[fieldId] = cellValue;
                }
            });

            if (!empNo) {
                failedCount++;
                errors.push({ row, error: 'Missing Employee ID' });
                continue;
            }

            const normalizedEmpNo = String(empNo).trim().toUpperCase();
            if (!normalizedEmpNo) {
                failedCount++;
                errors.push({ row, error: 'Missing Employee ID' });
                continue;
            }

            if (Object.keys(updateData).length === 0) {
                failedCount++;
                errors.push({ empNo: normalizedEmpNo, error: 'No updateable fields found in row' });
                continue;
            }

            try {
                const doc = await Employee.findOne({ emp_no: normalizedEmpNo });
                if (!doc) {
                    failedCount++;
                    errors.push({ empNo: normalizedEmpNo, error: 'Employee not found' });
                    continue;
                }

                // Coerce and set each field: schema at top level, rest in dynamicFields (findOne+save so Mixed persists)
                // proposedSalary from template/upload is persisted as gross_salary
                const numericFields = ['second_salary', 'gross_salary', 'proposedSalary', 'experience', 'paidLeaves', 'allottedLeaves'];
                Object.keys(updateData).forEach(fieldId => {
                    const persistAs = fieldId === 'proposedSalary' ? 'gross_salary' : fieldId;
                    let value = updateData[fieldId];
                    if (numericFields.includes(fieldId)) {
                        const n = Number(value);
                        value = Number.isFinite(n) ? n : (value === '' || value === null || value === undefined ? null : value);
                    }
                    if (EMPLOYEE_TOP_LEVEL_PATHS.has(persistAs)) {
                        doc.set(persistAs, value);
                    } else {
                        if (!doc.dynamicFields || typeof doc.dynamicFields !== 'object') {
                            doc.dynamicFields = {};
                        }
                        doc.dynamicFields[persistAs] = value;
                        doc.markModified('dynamicFields');
                    }
                });

                await doc.save();
                updatedCount++;

                // Trigger sync if second_salary was updated
                if (updateData.second_salary !== undefined) {
                    const currentMonth = getTodayISTDateString().slice(0, 7);
                    SecondSalarySyncService.syncEmployee(doc._id, currentMonth, 'system')
                        .catch(err => console.error('[EmployeeUpdate] Second Salary sync failed:', err));
                }
            } catch (err) {
                failedCount++;
                errors.push({ empNo: normalizedEmpNo, error: err.message });
            }
        }

        return {
            success: true,
            message: `Processed ${data.length} records. Updated: ${updatedCount}, Failed: ${failedCount}`,
            stats: { total: data.length, updated: updatedCount, failed: failedCount, errors: errors.length > 0 ? errors : undefined }
        };
    } catch (error) {
        console.error('Error processing bulk employee update:', error);
        throw error;
    }
};

module.exports = {
    processSecondSalaryUpload,
    generateSalaryUpdateTemplateData,
    generateEmployeeUpdateTemplateData,
    processEmployeeUpdateUpload,

    /**
     * Bulk Employee Allowances/Deductions Update - Template Generator
     * Exports all active employees and all active A&D masters.
     * Deductions are shown as negative values in Excel.
     */
    generateEmployeeADUpdateTemplateData: async () => {
        const masters = await AllowanceDeductionMaster.find({ isActive: true })
            .select('name category globalRule departmentRules')
            .sort({ category: 1, name: 1 });

        const employees = await Employee.find({ is_active: true })
            .select('emp_no employeeAllowances employeeDeductions division_id department_id')
            .sort({ emp_no: 1 });

        const headers = ['Employee ID'];
        const masterHeaders = masters.map(m => `${m.name} (${m.category})`);
        headers.push(...masterHeaders);

        // Helper to resolve rule for an employee from a master
        const resolveRule = (master, divisionId, departmentId) => {
            if (!master) return null;

            const divIdStr = divisionId ? String(divisionId) : null;
            const deptIdStr = departmentId ? String(departmentId) : null;

            // 1. Check for Division + Department specific rule
            if (divIdStr && deptIdStr && master.departmentRules) {
                const divDeptRule = master.departmentRules.find(r =>
                    r.divisionId && String(r.divisionId) === divIdStr &&
                    r.departmentId && String(r.departmentId) === deptIdStr
                );
                if (divDeptRule) return divDeptRule;
            }

            // 2. Check for Department only rule
            if (deptIdStr && master.departmentRules) {
                const deptRule = master.departmentRules.find(r =>
                    !r.divisionId &&
                    r.departmentId && String(r.departmentId) === deptIdStr
                );
                if (deptRule) return deptRule;
            }

            // 3. Fallback to Global Rule
            return master.globalRule;
        };

        const data = employees.map(emp => {
            const row = { 'Employee ID': emp.emp_no };

            const allowMap = new Map();
            (Array.isArray(emp.employeeAllowances) ? emp.employeeAllowances : []).forEach(a => {
                if (a?.masterId) allowMap.set(String(a.masterId), a);
            });
            const deductMap = new Map();
            (Array.isArray(emp.employeeDeductions) ? emp.employeeDeductions : []).forEach(d => {
                if (d?.masterId) deductMap.set(String(d.masterId), d);
            });

            masters.forEach(m => {
                const key = `${m.name} (${m.category})`;
                const id = String(m._id);

                // Priority 1: Employee Override
                let activeRule = m.category === 'deduction' ? deductMap.get(id) : allowMap.get(id);

                // Priority 2: Master Resolution (Division/Dept/Global)
                if (!activeRule) {
                    activeRule = resolveRule(m, emp.division_id, emp.department_id);
                }

                let value = '';
                if (activeRule) {
                    // 1. Try to respect the explicitly set type
                    if (activeRule.type === 'percentage') {
                        value = activeRule.percentage;
                    } else if (activeRule.type === 'fixed') {
                        value = activeRule.amount;
                    }

                    // 2. Fallback: If value is missing (null/undefined), check any available numeric field
                    if (value === null || value === undefined || value === '') {
                        if (activeRule.amount !== null && activeRule.amount !== undefined) {
                            value = activeRule.amount;
                        } else if (activeRule.percentage !== null && activeRule.percentage !== undefined) {
                            value = activeRule.percentage;
                        }
                    }

                    // 3. Ensure we return an empty string for null/undefined rather than the value null/undefined
                    if (value === null || value === undefined) {
                        value = '';
                    }
                }

                // Show deductions as negative values in the Excel
                if (m.category === 'deduction' && value !== '' && value !== null && value !== undefined) {
                    const n = Number(value);
                    value = Number.isFinite(n) ? -Math.abs(n) : value;
                }

                row[key] = value;
            });

            return row;
        });

        return { data, headers };

    },
    /**
     * Bulk Employee Allowances/Deductions Update - Process Upload
     * Updates only existing masters (identified by Name (Category) header).
     * Deductions can be provided as negative or positive; they are stored as positive amounts/percentages.
     * Blank cell => remove override for that master from employee overrides.
     */
    processEmployeeADUpdateUpload: async (fileBuffer) => {
        const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = xlsx.utils.sheet_to_json(sheet);

        if (!rows || rows.length === 0) {
            return { success: false, message: 'No data found', stats: { total: 0, updated: 0, failed: 0 } };
        }

        const masters = await AllowanceDeductionMaster.find({ isActive: true })
            .select('name category globalRule')
            .sort({ category: 1, name: 1 });

        // Map "Name (Category)" -> Master Object
        const masterByHeader = new Map();
        masters.forEach(m => {
            masterByHeader.set(`${m.name} (${m.category})`, m);
        });

        const normalizeKey = (obj, key) => {
            const found = Object.keys(obj).find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '') === key.toLowerCase().replace(/[^a-z0-9]/g, ''));
            return found ? obj[found] : undefined;
        };

        let updatedCount = 0;
        let failedCount = 0;
        const errors = [];

        for (const row of rows) {
            const empNo = normalizeKey(row, 'empno') || normalizeKey(row, 'employeeid');
            if (!empNo) {
                failedCount++;
                errors.push({ row, error: 'Missing Employee ID' });
                continue;
            }

            try {
                const employee = await Employee.findOne({ emp_no: String(empNo).trim().toUpperCase() });
                if (!employee) {
                    failedCount++;
                    errors.push({ empNo, error: 'Employee not found' });
                    continue;
                }

                const nextAllowances = Array.isArray(employee.employeeAllowances) ? [...employee.employeeAllowances] : [];
                const nextDeductions = Array.isArray(employee.employeeDeductions) ? [...employee.employeeDeductions] : [];

                const upsertOverride = (arr, masterId, overrideObj) => {
                    const idx = arr.findIndex(x => String(x.masterId) === String(masterId));
                    if (idx >= 0) arr[idx] = { ...arr[idx].toObject?.() || arr[idx], ...overrideObj };
                    else arr.push(overrideObj);
                };
                const removeOverride = (arr, masterId) => arr.filter(x => String(x.masterId) !== String(masterId));

                Object.keys(row).forEach(header => {
                    // Find master by exact header match from template
                    const master = masterByHeader.get(header);
                    if (!master) return;

                    const masterId = String(master._id);

                    const cell = row[header];
                    const isBlank = cell === undefined || cell === null || cell === '';

                    const targetArr = master.category === 'deduction' ? nextDeductions : nextAllowances;

                    if (isBlank) {
                        if (master.category === 'deduction') {
                            const filtered = removeOverride(targetArr, masterId);
                            nextDeductions.length = 0;
                            nextDeductions.push(...filtered);
                        } else {
                            const filtered = removeOverride(targetArr, masterId);
                            nextAllowances.length = 0;
                            nextAllowances.push(...filtered);
                        }
                        return;
                    }

                    const n = Number(cell);
                    if (!Number.isFinite(n)) return;
                    const valueAbs = Math.abs(n);

                    const rule = master.globalRule || {};
                    const overrideObj = {
                        masterId,
                        name: master.name,
                        category: master.category,
                        type: rule.type,
                        amount: rule.type === 'fixed' ? valueAbs : null,
                        percentage: rule.type === 'percentage' ? valueAbs : null,
                        percentageBase: rule.type === 'percentage' ? (rule.percentageBase || null) : null,
                        minAmount: rule.minAmount ?? null,
                        maxAmount: rule.maxAmount ?? null,
                        basedOnPresentDays: rule.type === 'fixed' ? (rule.basedOnPresentDays || false) : false,
                        isOverride: true,
                    };

                    if (master.category === 'deduction') upsertOverride(nextDeductions, masterId, overrideObj);
                    else upsertOverride(nextAllowances, masterId, overrideObj);
                });

                employee.employeeAllowances = nextAllowances;
                employee.employeeDeductions = nextDeductions;
                await employee.save();
                updatedCount++;
            } catch (err) {
                failedCount++;
                errors.push({ empNo, error: err.message });
            }
        }

        return {
            success: true,
            message: `Processed ${rows.length} records. Updated: ${updatedCount}, Failed: ${failedCount}`,
            stats: { total: rows.length, updated: updatedCount, failed: failedCount, errors: errors.length > 0 ? errors : undefined }
        };
    }
};