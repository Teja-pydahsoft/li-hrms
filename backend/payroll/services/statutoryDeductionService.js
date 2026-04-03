const StatutoryDeductionConfig = require('../model/StatutoryDeductionConfig');

/** Known dynamic salary field keys for Dearness (PF basic+DA when dearnessAllowance not passed). */
const DA_SALARY_KEYS = ['dearness_allowance', 'DEARNESS_ALLOWANCE', 'dearnessAllowance', 'DA', 'da'];

function dearnessFromAllSalaries(allSalaries) {
  if (!allSalaries || typeof allSalaries !== 'object') return 0;
  for (const k of DA_SALARY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(allSalaries, k)) continue;
    const v = Number(allSalaries[k]);
    if (!Number.isNaN(v)) return v;
  }
  return 0;
}

function shallowSalariesMap(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  return { ...obj };
}

/**
 * Calculate statutory deductions for an employee for a month.
 * Only employee share is deducted from salary; employer share is for reporting.
 * Respects employee-level flags: applyESI, applyPF, applyProfessionTax (default true = apply).
 * When paidDays and totalDaysInMonth are provided, amounts are prorated by (paidDays / totalDaysInMonth).
 * @param {Object} params
 * @param {number} params.basicPay - Basic pay (full month)
 * @param {number} params.grossSalary - Gross salary (after allowances) - used for ESI
 * @param {number} params.earnedSalary - Earned salary (prorated) - optional for proration
 * @param {number} [params.dearnessAllowance=0] - DA if PF base is basic_da; if 0, DA may be read from allSalaries (common field ids)
 * @param {Object} [params.employee] - Employee doc; if applyESI/applyPF/applyProfessionTax are false, that deduction is skipped (amount 0).
 * @param {number} [params.paidDays] - Paid days in the month (for proration). When set with totalDaysInMonth, statutory is prorated.
 * @param {number} [params.totalDaysInMonth] - Total days in month (pay cycle). When set with paidDays, statutory is prorated.
 * @param {Record<string, number|string>} [params.allSalaries={}] - Optional override map merged on top of employee.salaries
 * @param {number} [params.professionTaxSlabBase] - When set (finite, >= 0), Profession Tax slab is chosen from this amount (not prorated). When omitted, slab uses prorated basic pay.
 * @returns {Promise<{ breakdown: Array<{ name, code, employeeAmount, employerAmount }>, totalEmployeeShare, totalEmployerShare }>}
 */
async function calculateStatutoryDeductions({ basicPay = 0, grossSalary = 0, earnedSalary = 0, dearnessAllowance = 0, employee = null, paidDays = null, totalDaysInMonth = null, allSalaries = {}, professionTaxSlabBase = undefined }) {
  const config = await StatutoryDeductionConfig.get();
  const fromEmployee = shallowSalariesMap(employee?.salaries);
  const fromArg = shallowSalariesMap(allSalaries);
  const mergedAllSalaries = { ...fromEmployee, ...fromArg };
  const resolvedDearness = Number(dearnessAllowance) || dearnessFromAllSalaries(mergedAllSalaries);
  const breakdown = [];
  let totalEmployeeShare = 0;
  let totalEmployerShare = 0;
  const applyESI = employee == null || (employee && employee.applyESI !== false);
  const applyPF = employee == null || (employee && employee.applyPF !== false);
  const applyPT = employee == null || (employee && employee.applyProfessionTax !== false);

  const prorate = (amount) => {
    if (amount == null || amount === 0) return amount;
    if (typeof paidDays === 'number' && typeof totalDaysInMonth === 'number' && totalDaysInMonth > 0 && paidDays >= 0) {
      const ratio = Math.min(1, Math.max(0, paidDays / totalDaysInMonth));
      return Math.round(amount * ratio * 100) / 100;
    }
    return amount;
  };

  // ESI: calculated on (wageBasePercentOfBasic % of basic) OR a specific wageBaseField. 
  // When enabled, wage ceiling applies: applicable when basic ≤ ceiling (0 = no ceiling).
  if (applyESI && config.esi && config.esi.enabled) {
    const basic = Number(basicPay) || 0;
    const wageCeiling = config.esi.wageCeiling || 0;
    const empPct = config.esi.employeePercent ?? 0.75;
    const emprPct = config.esi.employerPercent ?? 3.25;
    
    let esiWage = 0;
    if (config.esi.wageBaseField && mergedAllSalaries && mergedAllSalaries[config.esi.wageBaseField] !== undefined) {
      // Use the value from the specific salary field (direct amount, no percentage needed usually)
      esiWage = Number(mergedAllSalaries[config.esi.wageBaseField]) || 0;
    } else {
      // Fallback to percentage of basic
      const wageBasePct = Math.min(100, Math.max(0, config.esi.wageBasePercentOfBasic ?? 50));
      esiWage = basic * (wageBasePct / 100);
    }

    const applicable = basic > 0 && (wageCeiling <= 0 || basic <= wageCeiling);
    if (applicable) {
      const empAmount = prorate(Math.round((esiWage * empPct / 100) * 100) / 100);
      const emprAmount = prorate(Math.round((esiWage * emprPct / 100) * 100) / 100);
      totalEmployeeShare += empAmount;
      totalEmployerShare += emprAmount;
      breakdown.push({
        name: 'ESI',
        code: 'ESI',
        employeeAmount: empAmount,
        employerAmount: emprAmount,
      });
    }
  }

  // PF: on Basic (or Basic + DA). Upper limit (wage ceiling): if salary ≥ ceiling, calculate on ceiling amount; else calculate on full basic. So contribution base = min(basic or basic+DA, wageCeiling).
  if (applyPF && config.pf && config.pf.enabled) {
    const empPct = config.pf.employeePercent ?? 12;
    const emprPct = config.pf.employerPercent ?? 12;

    let contributionBase = 0;
    if (config.pf.wageBaseField && mergedAllSalaries && mergedAllSalaries[config.pf.wageBaseField] !== undefined) {
      // Use specific salary field as base
      contributionBase = Number(mergedAllSalaries[config.pf.wageBaseField]) || 0;
    } else {
      // Fallback: Apply on Basic (or Basic + DA)
      const base = (config.pf.base === 'basic_da')
        ? (Number(basicPay) || 0) + (Number(resolvedDearness) || 0)
        : (Number(basicPay) || 0);
      contributionBase = base;
    }

    // Apply wage ceiling: PF mandatory if base <= ceiling; above that optional/capped? 
    // Common rule: if base > ceiling, contribution is on ceiling.
    const wageCeiling = config.pf.wageCeiling || 15000;
    const finalBase = contributionBase > 0 ? (wageCeiling > 0 ? Math.min(contributionBase, wageCeiling) : contributionBase) : 0;

    if (finalBase > 0) {
      const empAmount = prorate(Math.round((finalBase * empPct / 100) * 100) / 100);
      const emprAmount = prorate(Math.round((finalBase * emprPct / 100) * 100) / 100);
      totalEmployeeShare += empAmount;
      totalEmployerShare += emprAmount;
      breakdown.push({
        name: 'PF',
        code: 'PF',
        employeeAmount: empAmount,
        employerAmount: emprAmount,
      });
    }
  }

  // Profession Tax: employee only; slab-based on basic pay (slab where basicPay falls → amount)
  if (applyPT && config.professionTax && config.professionTax.enabled && Array.isArray(config.professionTax.slabs) && config.professionTax.slabs.length > 0) {
    // Default: prorate basic by paidDays/totalDaysInMonth, then choose slab from that base.
    // Optional override (dynamic payroll): use professionTaxSlabBase as-is for slab selection (no proration on that base).
    let basicForSlab;
    if (typeof professionTaxSlabBase === 'number' && Number.isFinite(professionTaxSlabBase) && professionTaxSlabBase >= 0) {
      basicForSlab = professionTaxSlabBase;
    } else {
      const basic = Number(basicPay) || 0;
      basicForSlab = prorate(basic);
    }
    const sorted = [...config.professionTax.slabs].filter(s => s && typeof s.min === 'number').sort((a, b) => a.min - b.min);
    let amount = 0;
    for (const slab of sorted) {
      const max = slab.max == null || slab.max === undefined ? 1e9 : Number(slab.max);
      if (basicForSlab >= Number(slab.min) && basicForSlab <= max) {
        amount = Number(slab.amount) || 0;
        break;
      }
    }
    // IMPORTANT: do NOT prorate again after slab selection, because the slab
    // is already chosen using the prorated base.
    totalEmployeeShare += amount;
    breakdown.push({
      name: 'Profession Tax',
      code: 'PT',
      employeeAmount: amount,
      employerAmount: 0,
    });
  }

  return {
    breakdown,
    totalEmployeeShare,
    totalEmployerShare,
  };
}

module.exports = {
  calculateStatutoryDeductions,
};
