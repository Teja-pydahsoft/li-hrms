/**
 * Slice bulk Pay Register arrears/deductions for one employee.
 * Each item must include employeeId (string or ObjectId). Items without employeeId are skipped.
 * Accepts arrearId or id / deductionId or id for compatibility with API payloads.
 */
function settlementsForEmployee(employeeId, bulkArrears, bulkDeductions) {
  const eid = String(employeeId);
  const arrRaw = Array.isArray(bulkArrears) ? bulkArrears : [];
  const dedRaw = Array.isArray(bulkDeductions) ? bulkDeductions : [];

  const arrearsSettlements = [];
  for (const a of arrRaw) {
    if (!a || a.employeeId == null || String(a.employeeId) !== eid) continue;
    const arrearId = a.arrearId || a.id;
    if (!arrearId) continue;
    arrearsSettlements.push({
      arrearId: String(arrearId),
      amount: Number(a.amount) || 0,
    });
  }

  const deductionSettlements = [];
  for (const d of dedRaw) {
    if (!d || d.employeeId == null || String(d.employeeId) !== eid) continue;
    const deductionId = d.deductionId || d.id;
    if (!deductionId) continue;
    deductionSettlements.push({
      deductionId: String(deductionId),
      amount: Number(d.amount) || 0,
    });
  }

  return { arrearsSettlements, deductionSettlements };
}

module.exports = { settlementsForEmployee };
