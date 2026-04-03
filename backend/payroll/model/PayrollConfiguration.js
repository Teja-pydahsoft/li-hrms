const mongoose = require('mongoose');

/**
 * Payroll Configuration (single document for the application).
 * We use only outputColumns for the paysheet; config.steps are not used to control payroll calculation.
 * - outputColumns: paysheet columns. source=field → value from service/controller (getValueByPath(payslip, field)).
 *   source=formula → value from before columns (earlier in list) + context from payslip.
 */
/** Per-step component: links to dynamic allowance/deduction master + optional formula override */
const stepComponentSchema = new mongoose.Schema({
  id: { type: String, required: true },
  /** Reference to AllowanceDeductionMaster when component is a dynamic allowance/deduction */
  masterId: { type: mongoose.Schema.Types.ObjectId, ref: 'AllowanceDeductionMaster', default: null },
  name: { type: String, default: '' },
  type: { type: String, enum: ['fixed', 'percentage', 'formula'], default: 'fixed' },
  amount: { type: Number, default: 0 },
  percentage: { type: Number, default: 0 },
  base: { type: String, enum: ['basic', 'gross'], default: 'basic' },
  /** Optional formula override for this component (overrides master rule when set) */
  formula: { type: String, default: '' },
  order: { type: Number, default: 0 },
}, { _id: false });

const stepSchema = new mongoose.Schema({
  id: { type: String, required: true },
  type: { type: String, required: true },
  label: { type: String, default: '' },
  order: { type: Number, default: 0 },
  enabled: { type: Boolean, default: true },
  /** Optional formula for this step (e.g. basic pay = perDayBasicPay * paidDays) */
  formula: { type: String, default: '' },
  /** Components (allowances in allowances step, deductions in other_deductions step) */
  components: { type: [stepComponentSchema], default: [] },
  config: { type: mongoose.Schema.Types.Mixed },
}, { _id: false });

const outputColumnSchema = new mongoose.Schema({
  header: { type: String, required: true, default: 'Column' },
  source: { type: String, enum: ['field', 'formula'], default: 'field' },
  field: { type: String, default: '' },
  formula: { type: String, default: '' },
  order: { type: Number, default: 0 },
}, { _id: false });

const payrollConfigurationSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  steps: { type: [stepSchema], default: [] },
  outputColumns: { type: [outputColumnSchema], default: [] },
  /** Header of the output column whose value is used as paid days for statutory proration (e.g. "Paid Days", "Present Days"). That column must appear before statutory columns in order. */
  statutoryProratePaidDaysColumnHeader: { type: String, default: '' },
  /** Header of the output column whose value is used as total days in month for statutory proration. If empty, record.attendance.totalDaysInMonth is used. */
  statutoryProrateTotalDaysColumnHeader: { type: String, default: '' },
  /**
   * Dynamic payroll only: header of an output column whose numeric value is used to pick the Profession Tax slab (min/max).
   * If empty, slab uses prorated basic pay (current behavior). Column must appear before statutory columns in order.
   */
  professionTaxSlabEarningsColumnHeader: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

/**
 * Build a normalized configuration payload (steps + outputColumns) with validated numeric ranges.
 */
function normalizeConfigPayload(payload = {}) {
  const update = {};
  if (payload.enabled !== undefined) update.enabled = !!payload.enabled;
  if (Array.isArray(payload.steps)) {
    update.steps = payload.steps.map((s, i) => {
      const order = typeof s.order === 'number' ? s.order : i;
      const components = Array.isArray(s.components)
        ? s.components.map((c, j) => {
            const amount = typeof c.amount === 'number' && Number.isFinite(c.amount) ? c.amount : 0;
            const percentage = typeof c.percentage === 'number' && Number.isFinite(c.percentage) ? c.percentage : 0;
            const safePct = Math.max(0, Math.min(100, percentage));
            return {
              id: c.id || `comp_${j}`,
              masterId: c.masterId ? (mongoose.Types.ObjectId.isValid(c.masterId) ? new mongoose.Types.ObjectId(c.masterId) : null) : null,
              name: c.name != null ? String(c.name) : '',
              type: ['fixed', 'percentage', 'formula'].includes(c.type) ? c.type : 'fixed',
              amount,
              percentage: safePct,
              base: c.base === 'gross' ? 'gross' : 'basic',
              formula: c.formula != null ? String(c.formula) : (c.formula || ''),
              order: typeof c.order === 'number' ? c.order : j,
            };
          })
        : [];
      return {
        id: s.id || `step_${i}`,
        type: s.type,
        label: s.label != null ? String(s.label) : '',
        order,
        enabled: s.enabled !== false,
        formula: s.formula != null ? String(s.formula) : (s.formula || ''),
        components,
        config: s.config,
      };
    });
  }
  if (Array.isArray(payload.outputColumns)) {
    update.outputColumns = payload.outputColumns.map((c, i) => {
      const header = (c.header != null && String(c.header).trim()) ? String(c.header).trim() : `Column ${i + 1}`;
      const order = typeof c.order === 'number' ? c.order : i;
      const formulaStr = (c.formula != null && String(c.formula).trim()) ? String(c.formula).trim() : '';
      const explicitSource = c.source === 'formula' ? 'formula' : (c.source === 'field' ? 'field' : null);
      const source = explicitSource || (formulaStr.length > 0 ? 'formula' : 'field');
      const field = source === 'formula' ? '' : (c.field || '');
      const formula = source === 'formula' ? formulaStr : '';
      return { header, source, field, formula, order };
    });
  }
  if (payload.statutoryProratePaidDaysColumnHeader !== undefined) {
    update.statutoryProratePaidDaysColumnHeader = String(payload.statutoryProratePaidDaysColumnHeader || '').trim();
  }
  if (payload.statutoryProrateTotalDaysColumnHeader !== undefined) {
    update.statutoryProrateTotalDaysColumnHeader = String(payload.statutoryProrateTotalDaysColumnHeader || '').trim();
  }
  if (payload.professionTaxSlabEarningsColumnHeader !== undefined) {
    update.professionTaxSlabEarningsColumnHeader = String(payload.professionTaxSlabEarningsColumnHeader || '').trim();
  }
  return update;
}

payrollConfigurationSchema.statics.get = async function () {
  // Do not include 'enabled' here to avoid conflicts with $set on enabled.
  // Schema default (false) will be applied on insert.
  const defaults = { steps: [], outputColumns: [] };
  const doc = await this.findOneAndUpdate(
    {},
    { $setOnInsert: defaults },
    { new: true, upsert: true }
  );
  return doc;
};

payrollConfigurationSchema.statics.upsert = async function (payload) {
  const update = normalizeConfigPayload(payload);
  const hasUpdates = update && Object.keys(update).length > 0;

  // Build insert-only defaults for fields that are NOT present in the update,
  // so we never send the same path in both $setOnInsert and $set.
  const insertDefaults = {};
  if (!update.steps) insertDefaults.steps = [];
  if (!update.outputColumns) insertDefaults.outputColumns = [];

  const updateOps = {};
  if (Object.keys(insertDefaults).length > 0) {
    updateOps.$setOnInsert = insertDefaults;
  }

  if (hasUpdates) {
    updateOps.$set = update;
  }

  // If there are no updates and no defaults, simply ensure a document exists by upserting an empty object.
  if (!hasUpdates && Object.keys(insertDefaults).length === 0) {
    return this.findOneAndUpdate({}, {}, { new: true, upsert: true });
  }

  const doc = await this.findOneAndUpdate(
    {},
    updateOps,
    { new: true, upsert: true }
  );
  return doc;
};

module.exports = mongoose.models.PayrollConfiguration || mongoose.model('PayrollConfiguration', payrollConfigurationSchema);
