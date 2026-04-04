/**
 * Shared query builder for payroll employee selection.
 * Used by: shared/jobs/worker.js (bulk regular + second salary), secondSalaryService.js,
 * payrollController bulk calculate, and scripts that need the same employee lists.
 *
 * When leftDateRange is provided, includes: active employees OR employees who left in that month.
 */

const mongoose = require('mongoose');

function toObjectIdIfValid(id) {
  if (id == null || id === '' || id === 'all') return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  const s = String(id);
  if (mongoose.Types.ObjectId.isValid(s) && String(new mongoose.Types.ObjectId(s)) === s) {
    return new mongoose.Types.ObjectId(s);
  }
  return null;
}

/**
 * Full employee match for POST /payroll/bulk-calculate (and worker replay).
 * Combines data-scope filter + division/department + payroll-month employment rule (active or left in period).
 * Uses $and so req.scopeFilter.$or is preserved (spread + overwriting $or was incorrect).
 *
 * @param {Object|null|undefined} scopeFilter - req.scopeFilter from applyScopeFilter (may be {})
 * @param {string|null|undefined} divisionId
 * @param {string|null|undefined} departmentId
 * @param {Date} rangeStart - UTC start (inclusive) of payroll period for leftDate
 * @param {Date} rangeEnd - UTC end (inclusive) of payroll period for leftDate
 * @returns {Object} MongoDB query for Employee.find()
 */
function buildPayrollBulkEmployeeQuery(scopeFilter, divisionId, departmentId, rangeStart, rangeEnd, designationId, employeeGroupId) {
  const employmentOr = {
    $or: [
      { is_active: true, leftDate: null },
      { leftDate: { $gte: rangeStart, $lte: rangeEnd } },
    ],
  };

  const andParts = [];

  if (scopeFilter && typeof scopeFilter === 'object' && Object.keys(scopeFilter).length > 0) {
    andParts.push(scopeFilter);
  }
  andParts.push(employmentOr);

  const div = toObjectIdIfValid(divisionId);
  const dept = toObjectIdIfValid(departmentId);
  const des = toObjectIdIfValid(designationId);
  const grp = toObjectIdIfValid(employeeGroupId);
  if (div) andParts.push({ division_id: div });
  if (dept) andParts.push({ department_id: dept });
  if (des) andParts.push({ designation_id: des });
  if (grp) andParts.push({ employee_group_id: grp });

  if (andParts.length === 1) return andParts[0];
  return { $and: andParts };
}

/**
 * Employee filter for paysheet + export-bundle: same scoping as bulk payroll (scope + dept/div + employment rule).
 * Avoids overwriting req.scopeFilter.$or when merging resignation rules.
 *
 * @param {Object|null|undefined} scopeFilter
 * @param {string|null|undefined} divisionId
 * @param {string|null|undefined} departmentId
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 * @param {{ status?: string, search?: string, designationId?: string, employeeGroupId?: string }} [options]
 */
function buildPaysheetEmployeeFilter(scopeFilter, divisionId, departmentId, rangeStart, rangeEnd, options = {}) {
  const { status, search, designationId, employeeGroupId } = options;
  const divF = toObjectIdIfValid(divisionId);
  const depF = toObjectIdIfValid(departmentId);
  const desF = toObjectIdIfValid(designationId);
  const grpF = toObjectIdIfValid(employeeGroupId);

  if (status === 'inactive') {
    const parts = [];
    if (scopeFilter && typeof scopeFilter === 'object' && Object.keys(scopeFilter).length > 0) {
      parts.push(scopeFilter);
    }
    const deptDiv = {};
    if (depF) deptDiv.department_id = depF;
    if (divF) deptDiv.division_id = divF;
    if (Object.keys(deptDiv).length > 0) parts.push(deptDiv);
    if (desF) parts.push({ designation_id: desF });
    if (grpF) parts.push({ employee_group_id: grpF });
    parts.push({ is_active: false });
    if (search && String(search).trim()) {
      const term = String(search).trim();
      parts.push({
        $or: [
          { employee_name: { $regex: term, $options: 'i' } },
          { emp_no: { $regex: term, $options: 'i' } },
        ],
      });
    }
    if (parts.length === 1) return parts[0];
    return { $and: parts };
  }

  const scope =
    scopeFilter && typeof scopeFilter === 'object' && Object.keys(scopeFilter).length > 0 ? scopeFilter : null;
  const divArg = divisionId && divisionId !== 'all' ? divisionId : undefined;
  const depArg = departmentId && departmentId !== 'all' ? departmentId : undefined;
  const desArg = designationId && designationId !== 'all' ? designationId : undefined;
  const groupArg = employeeGroupId && employeeGroupId !== 'all' ? employeeGroupId : undefined;
  let q = buildPayrollBulkEmployeeQuery(scope, divArg, depArg, rangeStart, rangeEnd, desArg, groupArg);

  if (status === 'active') {
    q = { $and: [q, { is_active: true }] };
  }

  if (search && String(search).trim()) {
    const term = String(search).trim();
    q = {
      $and: [
        q,
        {
          $or: [
            { employee_name: { $regex: term, $options: 'i' } },
            { emp_no: { $regex: term, $options: 'i' } },
          ],
        },
      ],
    };
  }

  return q;
}

/**
 * Query for regular (bulk) payroll: same as worker.js payroll_bulk_calculate
 * @param {Object} opts - { divisionId, departmentId, leftDateRange?: { start: Date, end: Date } }
 * @returns {Object} MongoDB query for Employee.find()
 */
function getRegularPayrollEmployeeQuery(opts = {}) {
  const { divisionId, departmentId, leftDateRange } = opts;
  const query = {};

  if (leftDateRange && leftDateRange.start != null && leftDateRange.end != null) {
    // Use UTC so period boundaries are consistent (e.g. 26 Dec = 26 Dec 00:00 UTC);
    // avoids including employees who left on 25 Dec when period is 26 Dec–25 Jan (server TZ could shift 26 Dec 00:00 local into 25 Dec UTC).
    const startStr = typeof leftDateRange.start === 'string' ? leftDateRange.start : leftDateRange.start.toISOString().split('T')[0];
    const endStr = typeof leftDateRange.end === 'string' ? leftDateRange.end : leftDateRange.end.toISOString().split('T')[0];
    const start = new Date(startStr + 'T00:00:00.000Z');
    const end = new Date(endStr + 'T23:59:59.999Z');
    query.$or = [
      { is_active: true, leftDate: null },
      { leftDate: { $gte: start, $lte: end } },
    ];
  } else {
    query.is_active = true;
  }

  if (departmentId && departmentId !== 'all') query.department_id = departmentId;
  if (divisionId && divisionId !== 'all') query.division_id = divisionId;
  return query;
}

/**
 * Query for second salary payroll: same employee set as regular payroll
 * (active or left in month + division/department). second_salary can be 0; calculation handles it.
 * @param {Object} opts - { divisionId, departmentId, leftDateRange?: { start: Date, end: Date } }
 * @returns {Object} MongoDB query for Employee.find()
 */
function getSecondSalaryEmployeeQuery(opts = {}) {
  return getRegularPayrollEmployeeQuery(opts);
}

module.exports = {
  buildPayrollBulkEmployeeQuery,
  buildPaysheetEmployeeFilter,
  getRegularPayrollEmployeeQuery,
  getSecondSalaryEmployeeQuery,
};
