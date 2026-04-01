/**
 * Resolve a configurable form-group field on an employee.
 * Salaries group: values come only from employee.salaries (schema field).
 * Other groups: root, then dynamicFields (flat or nested by group id).
 */
export function getEmployeeGroupedDynamicFieldValue(
  employee: Record<string, any> | null | undefined,
  groupId: string,
  fieldId: string
): any {
  if (!employee) return undefined;

  if (groupId === 'salaries') {
    const s = employee.salaries;
    if (s && typeof s === 'object' && !Array.isArray(s) && fieldId in s) {
      return s[fieldId];
    }
    return undefined;
  }

  const root = employee[fieldId];
  if (root !== undefined && root !== null && root !== '') return root;

  const df = employee.dynamicFields;
  if (df && typeof df === 'object') {
    const flat = df[fieldId];
    if (flat !== undefined && flat !== null && flat !== '') return flat;
    const byGroup = df[groupId];
    if (byGroup && typeof byGroup === 'object' && !Array.isArray(byGroup)) {
      const v = byGroup[fieldId];
      if (v !== undefined && v !== null && v !== '') return v;
    }
  }

  const rootGroup = employee[groupId];
  if (rootGroup && typeof rootGroup === 'object' && !Array.isArray(rootGroup)) {
    const v = rootGroup[fieldId];
    if (v !== undefined && v !== null && v !== '') return v;
  }

  return undefined;
}
