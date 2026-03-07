const AllowanceDeductionMaster = require('../model/AllowanceDeductionMaster');
const Department = require('../../departments/model/Department');
const Employee = require('../../employees/model/Employee');
const XLSX = require('xlsx');

/** Batch size for template download to avoid loading all employees into memory */
const TEMPLATE_DOWNLOAD_BATCH_SIZE = 500;

/**
 * @desc    Get all allowances and deductions
 * @route   GET /api/allowances-deductions
 * @access  Private
 */
exports.getAllAllowancesDeductions = async (req, res) => {
  try {
    const { category, isActive } = req.query;
    const query = {};

    if (category) {
      query.category = category;
    }

    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    const items = await AllowanceDeductionMaster.find(query)
      .populate('departmentRules.divisionId', 'name code')
      .populate('departmentRules.departmentId', 'name code')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .sort({ name: 1 });

    res.status(200).json({
      success: true,
      count: items.length,
      data: items,
    });
  } catch (error) {
    console.error('Error fetching allowances/deductions:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching allowances/deductions',
      error: error.message,
    });
  }
};

/**
 * @desc    Get only allowances
 * @route   GET /api/allowances-deductions/allowances
 * @access  Private
 */
exports.getAllowances = async (req, res) => {
  try {
    const { isActive } = req.query;
    const query = { category: 'allowance' };

    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    const allowances = await AllowanceDeductionMaster.find(query)
      .populate('departmentRules.divisionId', 'name code')
      .populate('departmentRules.departmentId', 'name code')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .sort({ name: 1 });

    res.status(200).json({
      success: true,
      count: allowances.length,
      data: allowances,
    });
  } catch (error) {
    console.error('Error fetching allowances:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching allowances',
      error: error.message,
    });
  }
};

/**
 * @desc    Get only deductions
 * @route   GET /api/allowances-deductions/deductions
 * @access  Private
 */
exports.getDeductions = async (req, res) => {
  try {
    const { isActive } = req.query;
    const query = { category: 'deduction' };

    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    const deductions = await AllowanceDeductionMaster.find(query)
      .populate('departmentRules.divisionId', 'name code')
      .populate('departmentRules.departmentId', 'name code')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .sort({ name: 1 });

    res.status(200).json({
      success: true,
      count: deductions.length,
      data: deductions,
    });
  } catch (error) {
    console.error('Error fetching deductions:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching deductions',
      error: error.message,
    });
  }
};

/**
 * @desc    Get single allowance/deduction
 * @route   GET /api/allowances-deductions/:id
 * @access  Private
 */
exports.getAllowanceDeduction = async (req, res) => {
  try {
    const item = await AllowanceDeductionMaster.findById(req.params.id)
      .populate('departmentRules.divisionId', 'name code')
      .populate('departmentRules.departmentId', 'name code')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Allowance/Deduction not found',
      });
    }

    res.status(200).json({
      success: true,
      data: item,
    });
  } catch (error) {
    console.error('Error fetching allowance/deduction:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching allowance/deduction',
      error: error.message,
    });
  }
};

/**
 * @desc    Create allowance/deduction master
 * @route   POST /api/allowances-deductions
 * @access  Private (Super Admin, Sub Admin, HR)
 */
exports.createAllowanceDeduction = async (req, res) => {
  try {
    const { name, category, description, globalRule, isActive } = req.body;

    // Validate required fields
    if (!name || !category || !globalRule) {
      return res.status(400).json({
        success: false,
        message: 'Name, category, and global rule are required',
      });
    }

    // Validate global rule
    if (!globalRule.type || !['fixed', 'percentage'].includes(globalRule.type)) {
      return res.status(400).json({
        success: false,
        message: 'Global rule type must be "fixed" or "percentage"',
      });
    }

    if (globalRule.type === 'fixed' && (globalRule.amount === null || globalRule.amount === undefined)) {
      return res.status(400).json({
        success: false,
        message: 'Amount is required when type is fixed',
      });
    }

    if (globalRule.type === 'percentage') {
      if (globalRule.percentage === null || globalRule.percentage === undefined) {
        return res.status(400).json({
          success: false,
          message: 'Percentage is required when type is percentage',
        });
      }
      if (!globalRule.percentageBase || !['basic', 'gross'].includes(globalRule.percentageBase)) {
        return res.status(400).json({
          success: false,
          message: 'Percentage base (basic/gross) is required when type is percentage',
        });
      }
    }

    const item = await AllowanceDeductionMaster.create({
      name,
      category,
      description: description || null,
      globalRule,
      isActive: isActive !== undefined ? isActive : true,
      createdBy: req.user._id,
    });

    await item.populate('createdBy', 'name email');

    res.status(201).json({
      success: true,
      message: `${category === 'allowance' ? 'Allowance' : 'Deduction'} created successfully`,
      data: item,
    });
  } catch (error) {
    console.error('Error creating allowance/deduction:', error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Allowance/Deduction with this name already exists',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error creating allowance/deduction',
      error: error.message,
    });
  }
};

/**
 * @desc    Update allowance/deduction master
 * @route   PUT /api/allowances-deductions/:id
 * @access  Private (Super Admin, Sub Admin, HR)
 */
exports.updateAllowanceDeduction = async (req, res) => {
  try {
    const { name, description, globalRule, isActive } = req.body;

    const item = await AllowanceDeductionMaster.findById(req.params.id);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Allowance/Deduction not found',
      });
    }

    // Update fields
    if (name !== undefined) item.name = name;
    if (description !== undefined) item.description = description;
    if (isActive !== undefined) item.isActive = isActive;

    // Update global rule if provided
    if (globalRule) {
      // Validate global rule
      if (globalRule.type && !['fixed', 'percentage'].includes(globalRule.type)) {
        return res.status(400).json({
          success: false,
          message: 'Global rule type must be "fixed" or "percentage"',
        });
      }

      if (globalRule.type === 'fixed' && (globalRule.amount === null || globalRule.amount === undefined)) {
        return res.status(400).json({
          success: false,
          message: 'Amount is required when type is fixed',
        });
      }

      if (globalRule.type === 'percentage') {
        if (globalRule.percentage === null || globalRule.percentage === undefined) {
          return res.status(400).json({
            success: false,
            message: 'Percentage is required when type is percentage',
          });
        }
        if (!globalRule.percentageBase || !['basic', 'gross'].includes(globalRule.percentageBase)) {
          return res.status(400).json({
            success: false,
            message: 'Percentage base (basic/gross) is required when type is percentage',
          });
        }
      }

      item.globalRule = { ...item.globalRule, ...globalRule };
    }

    item.updatedBy = req.user._id;
    await item.save();

    await item.populate('departmentRules.departmentId', 'name code');
    await item.populate('updatedBy', 'name email');

    res.status(200).json({
      success: true,
      message: 'Allowance/Deduction updated successfully',
      data: item,
    });
  } catch (error) {
    console.error('Error updating allowance/deduction:', error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Allowance/Deduction with this name already exists',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error updating allowance/deduction',
      error: error.message,
    });
  }
};

/**
 * @desc    Add or update department rule (can be division-department specific)
 * @route   PUT /api/allowances-deductions/:id/department-rule
 * @access  Private (Super Admin, Sub Admin, HR)
 */
exports.addOrUpdateDepartmentRule = async (req, res) => {
  try {
    const { divisionId, departmentId, type, amount, percentage, percentageBase, minAmount, maxAmount, basedOnPresentDays } = req.body;

    if (!departmentId) {
      return res.status(400).json({
        success: false,
        message: 'Department ID is required',
      });
    }

    // Verify department exists
    const department = await Department.findById(departmentId);
    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    // Verify division exists if provided
    if (divisionId) {
      const Division = require('../../departments/model/Division');
      const division = await Division.findById(divisionId);
      if (!division) {
        return res.status(404).json({
          success: false,
          message: 'Division not found',
        });
      }
    }

    const item = await AllowanceDeductionMaster.findById(req.params.id);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Allowance/Deduction not found',
      });
    }

    // Validate rule
    if (!type || !['fixed', 'percentage'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Type must be "fixed" or "percentage"',
      });
    }

    if (type === 'fixed' && (amount === null || amount === undefined)) {
      return res.status(400).json({
        success: false,
        message: 'Amount is required when type is fixed',
      });
    }

    if (type === 'percentage') {
      if (percentage === null || percentage === undefined) {
        return res.status(400).json({
          success: false,
          message: 'Percentage is required when type is percentage',
        });
      }
      if (!percentageBase || !['basic', 'gross'].includes(percentageBase)) {
        return res.status(400).json({
          success: false,
          message: 'Percentage base (basic/gross) is required when type is percentage',
        });
      }
    }

    // Check if division-department combination already exists
    const existingRuleIndex = item.departmentRules.findIndex((rule) => {
      const ruleDiv = rule.divisionId ? rule.divisionId.toString() : null;
      const reqDiv = divisionId || null;
      const ruleDept = rule.departmentId.toString();
      const reqDept = departmentId.toString();

      return ruleDiv === reqDiv && ruleDept === reqDept;
    });

    const departmentRule = {
      divisionId: divisionId || null,
      departmentId,
      type,
      amount: type === 'fixed' ? amount : null,
      percentage: type === 'percentage' ? percentage : null,
      percentageBase: type === 'percentage' ? percentageBase : null,
      minAmount: minAmount || null,
      maxAmount: maxAmount || null,
      basedOnPresentDays: type === 'fixed' ? (basedOnPresentDays || false) : false,
    };

    if (existingRuleIndex >= 0) {
      // Update existing rule
      item.departmentRules[existingRuleIndex] = departmentRule;
    } else {
      // Add new rule
      item.departmentRules.push(departmentRule);
    }

    item.updatedBy = req.user._id;
    await item.save();

    await item.populate('departmentRules.divisionId', 'name code');
    await item.populate('departmentRules.departmentId', 'name code');
    await item.populate('updatedBy', 'name email');

    res.status(200).json({
      success: true,
      message: divisionId
        ? 'Division-department specific rule updated successfully'
        : 'Department rule updated successfully',
      data: item,
    });
  } catch (error) {
    console.error('Error updating department rule:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating department rule',
      error: error.message,
    });
  }
};

/**
 * @desc    Remove department rule (can be division-department specific)
 * @route   DELETE /api/allowances-deductions/:id/department-rule/:deptId?divisionId=xxx
 * @access  Private (Super Admin, Sub Admin, HR)
 */
exports.removeDepartmentRule = async (req, res) => {
  try {
    const { id, deptId } = req.params;
    const { divisionId } = req.query;

    const item = await AllowanceDeductionMaster.findById(id);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Allowance/Deduction not found',
      });
    }

    // Find rule matching division-department combination
    const ruleIndex = item.departmentRules.findIndex((rule) => {
      const ruleDiv = rule.divisionId ? rule.divisionId.toString() : null;
      const reqDiv = divisionId || null;
      const ruleDept = rule.departmentId.toString();
      const reqDept = deptId.toString();

      return ruleDiv === reqDiv && ruleDept === reqDept;
    });

    if (ruleIndex === -1) {
      return res.status(404).json({
        success: false,
        message: divisionId
          ? 'Division-department specific rule not found'
          : 'Department rule not found',
      });
    }

    item.departmentRules.splice(ruleIndex, 1);
    item.updatedBy = req.user._id;
    await item.save();

    await item.populate('departmentRules.departmentId', 'name code');
    await item.populate('updatedBy', 'name email');

    res.status(200).json({
      success: true,
      message: 'Department rule removed successfully',
      data: item,
    });
  } catch (error) {
    console.error('Error removing department rule:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing department rule',
      error: error.message,
    });
  }
};

/**
 * @desc    Get resolved rule for a department
 * @route   GET /api/allowances-deductions/:id/resolved/:deptId
 * @access  Private
 */
exports.getResolvedRule = async (req, res) => {
  try {
    const { id, deptId } = req.params;

    const item = await AllowanceDeductionMaster.findById(id);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Allowance/Deduction not found',
      });
    }

    // Check for department override
    const deptRule = item.departmentRules.find(
      (rule) => rule.departmentId.toString() === deptId.toString()
    );

    // Return department rule if exists, else global rule
    const resolvedRule = deptRule || item.globalRule;

    res.status(200).json({
      success: true,
      data: {
        master: {
          _id: item._id,
          name: item.name,
          category: item.category,
        },
        rule: resolvedRule,
        source: deptRule ? 'department' : 'global',
        department: deptRule ? await Department.findById(deptId).select('name code') : null,
      },
    });
  } catch (error) {
    console.error('Error getting resolved rule:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting resolved rule',
      error: error.message,
    });
  }
};

/**
 * Build one template row from an employee doc (aggregation shape: deptDoc, divDoc, designDoc).
 * @param {Object} emp - Employee doc with deptDoc, divDoc, designDoc from $lookup
 * @param {Object[]} allowances - Allowance masters
 * @param {Object[]} deductions - Deduction masters
 * @returns {Record<string, string|number>}
 */
function buildRowFromEmp(emp, allowances, deductions) {
  const deptDoc = emp.deptDoc;
  const divDoc = emp.divDoc;
  const designDoc = emp.designDoc;

  const row = {
    'Employee ID': emp.emp_no,
    'Name': emp.employee_name,
    'Department': (deptDoc && deptDoc.name) ? deptDoc.name : '',
    'Designation': (designDoc && designDoc.name) ? designDoc.name : ''
  };

  const allowMap = new Map();
  (Array.isArray(emp.employeeAllowances) ? emp.employeeAllowances : []).forEach(a => {
    if (a && a.masterId) allowMap.set(String(a.masterId), a);
  });
  const deductMap = new Map();
  (Array.isArray(emp.employeeDeductions) ? emp.employeeDeductions : []).forEach(d => {
    if (d && d.masterId) deductMap.set(String(d.masterId), d);
  });

  const deptId = emp.department_id ? String(emp.department_id) : null;
  const divId = emp.division_id ? String(emp.division_id) : null;

  const resolveAmount = (master, overrideMap) => {
    const override = overrideMap.get(String(master._id));
    if (override) {
      if (override.type === 'percentage') return 0;
      return override.amount !== null && override.amount !== undefined ? override.amount : 0;
    }
    if (deptId && master.departmentRules?.length > 0) {
      if (divId) {
        const divRule = master.departmentRules.find(r =>
          r.divisionId && String(r.divisionId) === divId &&
          r.departmentId && String(r.departmentId) === deptId
        );
        if (divRule) {
          if (divRule.type === 'percentage') return 0;
          return divRule.amount != null ? divRule.amount : 0;
        }
      }
      const deptRule = master.departmentRules.find(r =>
        !r.divisionId && r.departmentId && String(r.departmentId) === deptId
      );
      if (deptRule) {
        if (deptRule.type === 'percentage') return 0;
        return deptRule.amount != null ? deptRule.amount : 0;
      }
    }
    if (master.globalRule) {
      if (master.globalRule.type === 'percentage') return 0;
      return master.globalRule.amount != null ? master.globalRule.amount : 0;
    }
    return 0;
  };

  allowances.forEach(allowance => {
    row[`${allowance.name} (${allowance.category})`] = resolveAmount(allowance, allowMap);
  });
  deductions.forEach(deduction => {
    const amount = resolveAmount(deduction, deductMap);
    row[`${deduction.name} (${deduction.category})`] = -Math.abs(amount);
  });

  return row;
}

/**
 * @desc    Download A&D Template with Master Amounts (batched to avoid OOM, output XLSX)
 * @route   GET /api/allowances-deductions/template
 * @access  Private
 */
exports.downloadTemplate = async (req, res) => {
  console.log('Starting downloadTemplate...');
  try {
    const allowances = await AllowanceDeductionMaster.find({ category: 'allowance', isActive: true }).sort({ name: 1 });
    const deductions = await AllowanceDeductionMaster.find({ category: 'deduction', isActive: true }).sort({ name: 1 });
    console.log(`Found ${allowances.length} allowances and ${deductions.length} deductions.`);

    const pipeline = [
      { $match: { is_active: true } },
      { $sort: { emp_no: 1 } },
      {
        $lookup: {
          from: 'departments',
          localField: 'department_id',
          foreignField: '_id',
          as: 'deptDoc'
        }
      },
      { $unwind: { path: '$deptDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'divisions',
          localField: 'division_id',
          foreignField: '_id',
          as: 'divDoc'
        }
      },
      { $unwind: { path: '$divDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'designations',
          localField: 'designation_id',
          foreignField: '_id',
          as: 'designDoc'
        }
      },
      { $unwind: { path: '$designDoc', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          emp_no: 1,
          employee_name: 1,
          department_id: 1,
          division_id: 1,
          designation_id: 1,
          employeeAllowances: 1,
          employeeDeductions: 1,
          deptDoc: 1,
          divDoc: 1,
          designDoc: 1
        }
      }
    ];

    const rows = [];
    let skip = 0;

    while (true) {
      const batch = await Employee.aggregate([
        ...pipeline,
        { $skip: skip },
        { $limit: TEMPLATE_DOWNLOAD_BATCH_SIZE }
      ]);
      if (batch.length === 0) break;

      for (const emp of batch) {
        try {
          rows.push(buildRowFromEmp(emp, allowances, deductions));
        } catch (err) {
          console.error(`Error processing employee ${emp.emp_no}:`, err);
          throw err;
        }
      }
      skip += TEMPLATE_DOWNLOAD_BATCH_SIZE;
      console.log(`Template download: processed batch, total rows ${rows.length}...`);
    }

    console.log('Generating Excel...');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'A&D Template');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename="AD_Template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
    console.log(`Template download complete. Total rows: ${rows.length}.`);
  } catch (error) {
    console.error('Error downloading template:', error);
    res.status(500).json({
      success: false,
      message: 'Error downloading template',
      error: error.message
    });
  }
};

/**
 * @desc    Delete allowance/deduction master
 * @route   DELETE /api/allowances-deductions/:id
 * @access  Private (Super Admin, Sub Admin)
 */
exports.deleteAllowanceDeduction = async (req, res) => {
  try {
    const item = await AllowanceDeductionMaster.findById(req.params.id);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Allowance/Deduction not found',
      });
    }

    await item.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Allowance/Deduction deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting allowance/deduction:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting allowance/deduction',
      error: error.message,
    });
  }
};

/**
 * @desc    Bulk update employee allowances/deductions from Excel
 * @route   POST /api/allowances-deductions/bulk-update
 * @access  Private (Super Admin)
 */
exports.bulkUpdateAllowancesDeductions = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload an Excel file',
      });
    }

    const { buffer } = req.file;
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    // Use header: 1 (array of arrays) so we process EVERY column by index - avoids losing columns
    // when Excel changes headers or sheet_to_json object keys get overwritten
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    const headers = Array.isArray(rawData[0]) ? rawData[0] : [];
    const dataRows = rawData.slice(1).filter(row => Array.isArray(row) && row.some(cell => cell !== '' && cell != null));

    if (!dataRows.length) {
      return res.status(400).json({
        success: false,
        message: 'The uploaded file is empty or has no data rows',
      });
    }

    // 1. Fetch all active allowances & deductions to map names -> IDs/details
    const [allowances, deductions] = await Promise.all([
      AllowanceDeductionMaster.find({ category: 'allowance', isActive: true }),
      AllowanceDeductionMaster.find({ category: 'deduction', isActive: true }),
    ]);

    // Create lookup maps: exact "Name (category)" AND normalized key -> Master Object
    // Normalized key = lowercase, alphanumeric only (handles Excel changing "PF (deduction)" to "PF (Deduction)" or adding spaces)
    const headerMap = new Map();
    const normalizedHeaderMap = new Map();

    const normalizeHeader = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    const addToMap = (list) => {
      list.forEach(item => {
        const headerKey = `${item.name} (${item.category})`;
        headerMap.set(headerKey, item);
        normalizedHeaderMap.set(normalizeHeader(headerKey), item);
      });
    };

    addToMap(allowances);
    addToMap(deductions);

    const findMasterByHeader = (header) => headerMap.get(header) || normalizedHeaderMap.get(normalizeHeader(header));

    const findEmpNoFromRowArr = (rowArr) => {
      const empIdNorm = normalizeHeader('Employee ID');
      const empNoNorm = 'empno';
      const empNoUnderscore = 'emp_no';
      for (let i = 0; i < headers.length; i++) {
        const h = headers[i];
        if (!h) continue;
        const n = normalizeHeader(h);
        if (n === empIdNorm || n === empNoNorm || n === empNoUnderscore) {
          const v = rowArr[i];
          if (v !== undefined && v !== null && v !== '') return v;
        }
      }
      return undefined;
    };

    const results = {
      updated: 0,
      failed: 0,
      errors: [],
    };

    // 2. Process each row (by column index - never miss a column)
    for (const [index, rowArr] of dataRows.entries()) {
      const empNo = findEmpNoFromRowArr(rowArr);

      if (!empNo) {
        results.errors.push(`Row ${index + 2}: Missing Employee ID`);
        results.failed++;
        continue;
      }

      const employee = await Employee.findOne({ emp_no: String(empNo).trim().toUpperCase() });
      if (!employee) {
        results.errors.push(`Row ${index + 2}: Employee with ID ${empNo} not found`);
        results.failed++;
        continue;
      }

      const newAllowances = [];
      const newDeductions = [];

      // Process EVERY column by index - no column lost to duplicate keys or Excel quirks
      for (let colIdx = 0; colIdx < headers.length; colIdx++) {
        const header = headers[colIdx];
        const master = findMasterByHeader(header);
        if (!master) continue;

        let val = rowArr[colIdx];
        if (val === '' || val === null || val === undefined) continue;

        if (master.category === 'deduction' && val < 0) val = Math.abs(val);
        const amount = Number(val);
        if (!Number.isFinite(amount)) continue;

        const overrideObj = {
          masterId: master._id,
          name: master.name,
          category: master.category,
          type: 'fixed',
          amount: amount,
          basedOnPresentDays: master.departmentRules?.[0]?.basedOnPresentDays || master.globalRule?.basedOnPresentDays || false,
          isOverride: true
        };

        if (master.category === 'allowance') {
          newAllowances.push(overrideObj);
        } else {
          newDeductions.push(overrideObj);
        }
      }

      // Update employee
      // We REPLACE existing overrides with the ones found in the sheet for the columns present.
      // However, we should preserve overrides for components NOT in the sheet?
      // Usually bulk upload implies "this is the state".
      // But if the sheet only had "Bonus", we shouldn't wipe "HRA".
      // The template download includes ALL active components. So safe to replace?
      // Let's merge: Remove old overrides for components present in the sheet, keep others.
      // Actually, since template has ALL active components, we can probably rebuild the lists.
      // But safest is: 
      // 1. Keep existing overrides for masters NOT in headerMap (maybe inactive ones?)
      // 2. Use new values for masters IN headerMap

      // Filter out assignments in existing arrays that match masters we are updating
      const mapKeys = Array.from(headerMap.values()).map(m => String(m._id));

      const keptAllowances = (employee.employeeAllowances || []).filter(
        a => a.masterId && !mapKeys.includes(String(a.masterId))
      );
      const keptDeductions = (employee.employeeDeductions || []).filter(
        d => d.masterId && !mapKeys.includes(String(d.masterId))
      );

      employee.employeeAllowances = [...keptAllowances, ...newAllowances];
      employee.employeeDeductions = [...keptDeductions, ...newDeductions];

      await employee.save();
      results.updated++;
    }

    res.status(200).json({
      success: true,
      message: `Processed ${dataRows.length} rows. Updated: ${results.updated}, Failed: ${results.failed}`,
      errors: results.errors,
    });

  } catch (error) {
    console.error('Error in bulk update:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing bulk update',
      error: error.message,
    });
  }
};
