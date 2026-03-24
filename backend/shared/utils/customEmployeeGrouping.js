const Settings = require('../../settings/model/Settings');

const CUSTOM_GROUPING_SETTING_KEY = 'custom_employee_grouping_enabled';

/**
 * @returns {Promise<boolean>}
 */
async function isCustomEmployeeGroupingEnabled() {
  const doc = await Settings.findOne({ key: CUSTOM_GROUPING_SETTING_KEY }).lean();
  return doc?.value === true || doc?.value === 'true';
}

/**
 * Remove employee_group_id from payload when feature is off (defense in depth).
 * @param {Record<string, unknown>|null|undefined} data
 */
async function stripEmployeeGroupIfDisabled(data) {
  if (!data || typeof data !== 'object') return;
  const on = await isCustomEmployeeGroupingEnabled();
  if (!on) {
    delete data.employee_group_id;
  }
}

/**
 * @param {string|undefined|null} groupId
 * @returns {Promise<{ error: string }|null>}
 */
async function validateEmployeeGroupIfEnabled(groupId) {
  if (groupId === undefined || groupId === null || groupId === '') return null;
  const on = await isCustomEmployeeGroupingEnabled();
  if (!on) {
    return { error: 'Custom employee grouping is disabled' };
  }
  const mongoose = require('mongoose');
  if (!mongoose.Types.ObjectId.isValid(groupId)) {
    return { error: 'Invalid employee group id' };
  }
  const EmployeeGroup = require('../../employees/model/EmployeeGroup');
  const g = await EmployeeGroup.findById(groupId);
  if (!g) return { error: 'Employee group not found' };
  if (!g.isActive) return { error: 'Employee group is inactive' };
  return null;
}

/**
 * @param {Record<string, unknown>|null|undefined} data
 * @param {boolean} groupingEnabled
 */
function stripEmployeeGroupWhenDisabled(data, groupingEnabled) {
  if (!groupingEnabled && data && typeof data === 'object') {
    delete data.employee_group_id;
  }
}

module.exports = {
  CUSTOM_GROUPING_SETTING_KEY,
  isCustomEmployeeGroupingEnabled,
  stripEmployeeGroupIfDisabled,
  stripEmployeeGroupWhenDisabled,
  validateEmployeeGroupIfEnabled,
};
