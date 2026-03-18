const ResignationSettings = require('../model/ResignationSettings');

// @desc    Get resignation policy settings
// @route   GET /api/resignations/settings
// @access  Private
exports.getSettings = async (req, res) => {
  try {
    let settings = await ResignationSettings.getActiveSettings();
    let data;
    if (!settings) {
      data = {
        noticePeriodDays: 0,
        workflow: {
          isEnabled: true,
          steps: [],
          finalAuthority: { role: 'hr', anyHRCanApprove: true },
          allowHigherAuthorityToApproveLowerLevels: false,
        },
        isActive: true,
        isDefault: true,
      };
    } else {
      const plain = settings.toObject ? settings.toObject() : { ...settings };
      data = {
        noticePeriodDays: Number(plain.noticePeriodDays) >= 0 ? Number(plain.noticePeriodDays) : 0,
        workflow: plain.workflow || {
          isEnabled: true,
          steps: [],
          finalAuthority: { role: 'hr', anyHRCanApprove: true },
          allowHigherAuthorityToApproveLowerLevels: false,
        },
        isActive: plain.isActive !== false,
      };
      if (!data.workflow.finalAuthority) {
        data.workflow.finalAuthority = { role: 'hr', anyHRCanApprove: true };
      }
    }
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Error fetching resignation settings:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch resignation settings',
    });
  }
};

// @desc    Save resignation policy settings
// @route   POST /api/resignations/settings
// @access  Private (Super Admin)
exports.saveSettings = async (req, res) => {
  try {
    const { noticePeriodDays, workflow } = req.body;
    let settings = await ResignationSettings.getActiveSettings();
    if (!settings) {
      settings = await ResignationSettings.findOne({}) || new ResignationSettings({});
    }
    if (noticePeriodDays !== undefined) settings.noticePeriodDays = Math.max(0, Number(noticePeriodDays) || 0);
    if (workflow) {
      settings.workflow = settings.workflow || {};
      if (workflow.isEnabled !== undefined) settings.workflow.isEnabled = !!workflow.isEnabled;
      if (workflow.steps) settings.workflow.steps = workflow.steps;
      if (workflow.finalAuthority) settings.workflow.finalAuthority = workflow.finalAuthority;
      if (workflow.allowHigherAuthorityToApproveLowerLevels !== undefined) {
        settings.workflow.allowHigherAuthorityToApproveLowerLevels = !!workflow.allowHigherAuthorityToApproveLowerLevels;
      }
    }
    settings.updatedBy = req.user?._id;
    settings.isActive = true;
    await settings.save();
    await ResignationSettings.updateMany({ _id: { $ne: settings._id } }, { isActive: false });
    res.status(200).json({
      success: true,
      message: 'Resignation policy settings saved successfully',
      data: settings,
    });
  } catch (error) {
    console.error('Error saving resignation settings:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to save resignation settings',
    });
  }
};
