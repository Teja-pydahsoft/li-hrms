const Settings = require('../../settings/model/Settings');

/**
 * Helper to construct a Date object for a specific date and time in IST (+05:30)
 * ensures consistency regardless of server timezone.
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} timeStr - HH:mm
 * @returns {Date}
 */
function createISTDate(dateStr, timeStr = '00:00') {
    return new Date(`${dateStr}T${timeStr}:00+05:30`);
}

/**
 * Extract date components in IST
 * @param {Date|string} dateInput 
 * @returns {{year: number, month: number, day: number, dateStr: string}}
 */
function extractISTComponents(dateInput) {
    const d = new Date(dateInput);
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
    });
    const parts = formatter.formatToParts(d);
    const components = {};
    parts.forEach(({ type, value }) => {
        if (type !== 'literal') components[type] = parseInt(value);
    });

    const year = components.year;
    const month = components.month;
    const day = components.day;
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    return { year, month, day, dateStr };
}

/**
 * Get the date range for a payroll month based on settings
 * @param {number} year - Target year (e.g., 2026)
 * @param {number} monthNumber - Target month number (1-12)
 * @returns {Promise<{startDate: string, endDate: string, totalDays: number}>}
 */
async function getPayrollDateRange(year, monthNumber) {
    const Settings = require('../../settings/model/Settings');
    const startDaySetting = await Settings.findOne({ key: 'payroll_cycle_start_day' });
    const endDaySetting = await Settings.findOne({ key: 'payroll_cycle_end_day' });

    const startDay = startDaySetting ? parseInt(startDaySetting.value) : 1;
    const endDay = endDaySetting ? parseInt(endDaySetting.value) : 31;

    if (startDay === 1 && endDay >= 28) {
        // Treat as full calendar month
        const startDate = `${year}-${String(monthNumber).padStart(2, '0')}-01`;
        // Last day of month - construct via IST to be safe
        const lastDayDate = new Date(year, monthNumber, 0); // This is local, but since it's just getting days in month, it's mostly okay. 
        // More robust:
        const nextMonthFirstDay = createISTDate(`${monthNumber === 12 ? year + 1 : year}-${String(monthNumber === 12 ? 1 : monthNumber + 1).padStart(2, '0')}-01`);
        const lastDayInMonth = new Date(nextMonthFirstDay.getTime() - 1000).getDate();

        // Use the minimum of endDay and actual last day
        const resolvedEndDay = Math.min(endDay, lastDayInMonth);
        const endDate = `${year}-${String(monthNumber).padStart(2, '0')}-${String(resolvedEndDay).padStart(2, '0')}`;

        return {
            startDate,
            endDate,
            totalDays: resolvedEndDay,
            startDay,
            endDay
        };
    }

    // Dynamic logic:
    let startDateStr, endDateStr;

    if (startDay < endDay) {
        // Same month (e.g., 1st to 15th)
        const nextMonthFirstDay = createISTDate(`${monthNumber === 12 ? year + 1 : year}-${String(monthNumber === 12 ? 1 : monthNumber + 1).padStart(2, '0')}-01`);
        const lastDayInMonth = new Date(nextMonthFirstDay.getTime() - 1000).getDate();

        const resolvedStartDay = Math.min(startDay, lastDayInMonth);
        const resolvedEndDay = Math.min(endDay, lastDayInMonth);

        startDateStr = `${year}-${String(monthNumber).padStart(2, '0')}-${String(resolvedStartDay).padStart(2, '0')}`;
        endDateStr = `${year}-${String(monthNumber).padStart(2, '0')}-${String(resolvedEndDay).padStart(2, '0')}`;
    } else {
        // Spans months (e.g., 26th of prev to 25th of current)
        const prevMonth = monthNumber === 1 ? 12 : monthNumber - 1;
        const prevYear = monthNumber === 1 ? year - 1 : year;

        const currMonthFirstDay = createISTDate(`${year}-${String(monthNumber).padStart(2, '0')}-01`);
        const prevMonthLastDay = new Date(currMonthFirstDay.getTime() - 1000).getDate();

        const resolvedStartDay = Math.min(startDay, prevMonthLastDay);
        startDateStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(resolvedStartDay).padStart(2, '0')}`;

        const nextMonthFirstDay = createISTDate(`${monthNumber === 12 ? year + 1 : year}-${String(monthNumber === 12 ? 1 : monthNumber + 1).padStart(2, '0')}-01`);
        const currMonthLastDay = new Date(nextMonthFirstDay.getTime() - 1000).getDate();

        const resolvedEndDay = Math.min(endDay, currMonthLastDay);
        endDateStr = `${year}-${String(monthNumber).padStart(2, '0')}-${String(resolvedEndDay).padStart(2, '0')}`;
    }

    // Calculate total days
    const start = createISTDate(startDateStr);
    const end = createISTDate(endDateStr);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    return {
        startDate: startDateStr,
        endDate: endDateStr,
        totalDays: diffDays,
        startDay,
        endDay
    };
}

/**
 * Get all dates between two date strings (inclusive)
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {string[]}
 */
function getAllDatesInRange(startDate, endDate) {
    const result = [];
    let d = createISTDate(startDate);
    const e = createISTDate(endDate);
    while (d <= e) {
        const { dateStr } = extractISTComponents(d);
        result.push(dateStr);
        d.setDate(d.getDate() + 1);
    }
    return result;
}

/**
 * Get today's date as YYYY-MM-DD in IST (Asia/Kolkata).
 * Use this for cron/scheduling so behaviour is correct on UTC or any server timezone.
 * @param {Date} [now] - Optional; defaults to new Date()
 * @returns {string} e.g. '2025-12-26'
 */
function getTodayISTDateString(now = new Date()) {
    return extractISTComponents(now).dateStr;
}

/**
 * YYYY-MM plus delta calendar months.
 * @param {string} ym - YYYY-MM
 * @param {number} delta
 * @returns {string} YYYY-MM
 */
function addCalendarMonthsToYm(ym, delta) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Which payroll month key (YYYY-MM as used by PayrollRecord.month) contains today (IST),
 * using getPayrollDateRange + payroll_cycle_start_day / payroll_cycle_end_day from settings.
 * @returns {Promise<string>} YYYY-MM
 */
async function getPayrollMonthKeyContainingToday() {
    const dateStr = getTodayISTDateString();
    const [ty, tm] = dateStr.split('-').map(Number);
    let y = ty;
    let m = tm;
    for (let step = 0; step < 24; step++) {
        const range = await getPayrollDateRange(y, m);
        if (dateStr >= range.startDate && dateStr <= range.endDate) {
            return `${y}-${String(m).padStart(2, '0')}`;
        }
        m -= 1;
        if (m < 1) {
            m = 12;
            y -= 1;
        }
    }
    y = ty;
    m = tm;
    for (let step = 0; step < 24; step++) {
        const range = await getPayrollDateRange(y, m);
        if (dateStr >= range.startDate && dateStr <= range.endDate) {
            return `${y}-${String(m).padStart(2, '0')}`;
        }
        m += 1;
        if (m > 12) {
            m = 1;
            y += 1;
        }
    }
    return `${ty}-${String(tm).padStart(2, '0')}`;
}

/**
 * Default month for paysheet UI: previous payroll period relative to the one containing today.
 * @returns {Promise<{ month: string, containingMonth: string }>}
 */
async function getDefaultPaysheetMonthKey() {
    const containing = await getPayrollMonthKeyContainingToday();
    const month = addCalendarMonthsToYm(containing, -1);
    return { month, containingMonth: containing };
}

module.exports = {
    createISTDate,
    extractISTComponents,
    getTodayISTDateString,
    getPayrollDateRange,
    getAllDatesInRange,
    addCalendarMonthsToYm,
    getPayrollMonthKeyContainingToday,
    getDefaultPaysheetMonthKey,
};
