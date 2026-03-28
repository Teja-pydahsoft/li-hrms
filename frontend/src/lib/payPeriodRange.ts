/**
 * Payroll month date range aligned with attendance / payroll settings
 * (same rules as workspace attendance month + payroll_cycle_start_day / payroll_cycle_end_day).
 */

export function getPayPeriodRangeForCalendarMonth(
  year: number,
  month1Based: number,
  payrollCycleStartDay: number,
  payrollCycleEndDay: number | null | undefined
): { from: string; to: string } {
  const startDay =
    payrollCycleStartDay >= 1 && payrollCycleStartDay <= 31 ? payrollCycleStartDay : 1;
  const rawEnd = payrollCycleEndDay;
  const endD =
    rawEnd != null && !Number.isNaN(Number(rawEnd)) && Number(rawEnd) >= 1 && Number(rawEnd) <= 31
      ? Number(rawEnd)
      : startDay > 1
        ? startDay - 1
        : 31;

  if (startDay <= 1) {
    const lastDay = new Date(year, month1Based, 0).getDate();
    const actualEnd = Math.min(endD, lastDay);
    return {
      from: `${year}-${String(month1Based).padStart(2, '0')}-01`,
      to: `${year}-${String(month1Based).padStart(2, '0')}-${String(actualEnd).padStart(2, '0')}`,
    };
  }

  let startYear = year;
  let startMonth = month1Based - 1;
  if (startMonth < 1) {
    startMonth = 12;
    startYear -= 1;
  }
  const from = `${startYear}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;

  const endDateObj = new Date(year, month1Based - 1, endD);
  const ey = endDateObj.getFullYear();
  const em = endDateObj.getMonth() + 1;
  const ed = endDateObj.getDate();
  const to = `${ey}-${String(em).padStart(2, '0')}-${String(ed).padStart(2, '0')}`;
  return { from, to };
}

export type LeaveODPayPeriodOption = {
  value: string;
  label: string;
  range: { from: string; to: string };
};

export function buildLeaveODPayPeriodOptions(args: {
  payrollCycleStartDay: number;
  payrollCycleEndDay: number | null | undefined;
  monthsBack: number;
  getDefaultRange: () => { from: string; to: string };
  defaultLabel?: string;
}): LeaveODPayPeriodOption[] {
  const {
    payrollCycleStartDay,
    payrollCycleEndDay,
    monthsBack,
    getDefaultRange,
    defaultLabel = 'Current period (default)',
  } = args;

  const opts: LeaveODPayPeriodOption[] = [
    {
      value: '__default__',
      label: defaultLabel,
      range: getDefaultRange(),
    },
  ];

  const now = new Date();
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const range = getPayPeriodRangeForCalendarMonth(y, m, payrollCycleStartDay, payrollCycleEndDay);
    const label = d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    opts.push({
      value: `full:${y}-${String(m).padStart(2, '0')}`,
      label,
      range,
    });
  }
  return opts;
}

export function matchLeaveODPayPeriodSelectValue(
  dateRange: { from: string; to: string },
  options: LeaveODPayPeriodOption[],
  /** Live match for "default" range (e.g. through today) so it stays correct when options are memoized. */
  getDefaultRange?: () => { from: string; to: string }
): string {
  if (getDefaultRange) {
    const d = getDefaultRange();
    if (d.from === dateRange.from && d.to === dateRange.to) return '__default__';
  }
  for (const o of options) {
    if (o.value === '__default__') continue;
    if (o.range.from === dateRange.from && o.range.to === dateRange.to) return o.value;
  }
  return '__custom__';
}
