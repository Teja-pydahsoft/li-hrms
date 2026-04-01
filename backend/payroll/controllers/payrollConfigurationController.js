const PayrollConfiguration = require('../model/PayrollConfiguration');
const EmployeeApplicationFormSettings = require('../../employee-applications/model/EmployeeApplicationFormSettings');

function buildEmployeeSalaryFieldOptionsFromSettings(settings) {
  const salariesGroup = (settings?.groups || []).find((g) => g && g.id === 'salaries');
  const fields = (salariesGroup?.fields || []).filter((f) => f && f.id && f.isEnabled !== false);
  return fields.map((f) => ({
    value: `employee.salaries.${f.id}`,
    label: `Salary: ${f.label || f.id}`,
  }));
}

exports.getPayrollConfig = async (req, res) => {
  try {
    const config = await PayrollConfiguration.get();
    let employeeSalaryFieldOptions = [];
    try {
      const formSettings = await EmployeeApplicationFormSettings.getActiveSettings();
      employeeSalaryFieldOptions = buildEmployeeSalaryFieldOptionsFromSettings(formSettings);
    } catch (e) {
      console.warn('getPayrollConfig employee salary fields:', e.message);
    }
    const plain = config && typeof config.toObject === 'function' ? config.toObject() : { ...(config || {}) };
    return res.status(200).json({
      success: true,
      data: { ...plain, employeeSalaryFieldOptions },
    });
  } catch (error) {
    console.error('getPayrollConfig error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to get payroll config' });
  }
};

exports.upsertPayrollConfig = async (req, res) => {
  try {
    const { enabled, steps, outputColumns, statutoryProratePaidDaysColumnHeader, statutoryProrateTotalDaysColumnHeader } = req.body || {};
    const normalizedOutputColumns = Array.isArray(outputColumns)
      ? outputColumns.map((c, i) => {
          const header = (c.header != null && String(c.header).trim()) ? String(c.header).trim() : `Column ${i + 1}`;
          const formulaStr = (c.formula != null && String(c.formula).trim()) ? String(c.formula).trim() : '';
          const source = (c.source === 'formula' || formulaStr.length > 0) ? 'formula' : 'field';
          return {
            header,
            source,
            field: source === 'formula' ? '' : (c.field || ''),
            formula: source === 'formula' ? formulaStr : '',
            order: typeof c.order === 'number' ? c.order : i,
          };
        })
      : [];
    const payload = {
      enabled: !!enabled,
      steps: Array.isArray(steps) ? steps : [],
      outputColumns: normalizedOutputColumns,
    };
    if (statutoryProratePaidDaysColumnHeader !== undefined) payload.statutoryProratePaidDaysColumnHeader = statutoryProratePaidDaysColumnHeader;
    if (statutoryProrateTotalDaysColumnHeader !== undefined) payload.statutoryProrateTotalDaysColumnHeader = statutoryProrateTotalDaysColumnHeader;
    const config = await PayrollConfiguration.upsert(payload);
    return res.status(200).json({ success: true, data: config });
  } catch (error) {
    console.error('upsertPayrollConfig error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to save payroll config' });
  }
};
