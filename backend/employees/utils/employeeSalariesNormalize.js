const EmployeeApplicationFormSettings = require('../../employee-applications/model/EmployeeApplicationFormSettings');

async function getSalariesGroupFieldIds() {
  try {
    const settings = await EmployeeApplicationFormSettings.getActiveSettings();
    const g = (settings?.groups || []).find((x) => x.id === 'salaries');
    return (g?.fields || []).filter((f) => f && f.id && f.isEnabled !== false).map((f) => f.id);
  } catch {
    return [];
  }
}

/** Remove salary bucket keys from dynamicFields so they are not stored twice (values live on employee.salaries only). */
function stripSalaryKeysFromDynamicField(df, fieldIds) {
  if (!df || typeof df !== 'object') return {};
  const out = { ...df };
  delete out.salaries;
  for (const id of fieldIds) delete out[id];
  return out;
}

/**
 * Persist salary components only from request `salaries` (JSON) merged onto existing map on update.
 * Strips `dynamicFields.salaries` and per-field ids from the dynamic payload without reading values from there.
 */
async function normalizeEmployeeSalariesPayload(employeeData, dynamicFields, existingSalaries = {}) {
  const fieldIds = await getSalariesGroupFieldIds();
  let df = { ...(dynamicFields || {}) };
  df = stripSalaryKeysFromDynamicField(df, fieldIds);

  let salaries =
    existingSalaries && typeof existingSalaries === 'object' && !Array.isArray(existingSalaries)
      ? { ...existingSalaries }
      : {};

  let explicit = employeeData.salaries;
  if (typeof explicit === 'string') {
    try {
      explicit = JSON.parse(explicit);
    } catch {
      explicit = null;
    }
  }
  if (explicit && typeof explicit === 'object' && !Array.isArray(explicit)) {
    salaries = { ...salaries, ...explicit };
  }

  return { salaries, dynamicFields: df, fieldIds };
}

module.exports = {
  getSalariesGroupFieldIds,
  stripSalaryKeysFromDynamicField,
  normalizeEmployeeSalariesPayload,
};
