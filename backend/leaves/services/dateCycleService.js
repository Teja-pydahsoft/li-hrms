const Settings = require('../../settings/model/Settings');
const LeavePolicySettings = require('../../settings/model/LeavePolicySettings');
const { extractISTComponents, createISTDate } = require('../../shared/utils/dateUtils');

/**
 * Date and Cycle Utility Service
 * Handles financial year and payroll cycle calculations
 */

class DateCycleService {
    /**
     * Get payroll cycle settings (startDay, endDay from settings – not hardcoded).
     * Returns numeric 1–31 so period resolution works for any configured cycle.
     */
    async getPayrollCycleSettings() {
        try {
            const settings = await Settings.getSettingsByCategory('payroll');
            const startDay = Math.min(31, Math.max(1, parseInt(settings.payroll_cycle_start_day, 10) || 1));
            const endDay = Math.min(31, Math.max(1, parseInt(settings.payroll_cycle_end_day, 10) || 31));
            return { startDay, endDay };
        } catch (error) {
            console.error('Error getting payroll cycle settings:', error);
            return { startDay: 1, endDay: 31 };
        }
    }

    /**
     * Get leave policy settings (financial year)
     */
    async getLeavePolicySettings() {
        try {
            return await LeavePolicySettings.getSettings();
        } catch (error) {
            console.error('Error getting leave policy settings:', error);
            // Default to calendar year
            return {
                financialYear: {
                    startMonth: 1,
                    startDay: 1,
                    useCalendarYear: true
                }
            };
        }
    }

    /**
     * Get payroll cycle for a given date.
     * Pay cycle is always read from settings (startDay, endDay) – not hardcoded.
     * Uses IST (Asia/Kolkata) so which period a date belongs to is correct regardless of server TZ.
     * Dates outside a period are not included; each date resolves to exactly one period.
     * Returns { startDate, endDate, month, year, isCustomCycle }
     */
    async getPayrollCycleForDate(date = new Date()) {
        const payrollSettings = await this.getPayrollCycleSettings();
        const startDay = Number(payrollSettings.startDay) || 1;
        const endDay = Number(payrollSettings.endDay) || 31;

        // Resolve the calendar day in IST so server timezone does not change the period
        const ist = extractISTComponents(new Date(date));
        const day = ist.day;
        const month1Based = ist.month; // 1-12
        const year = ist.year;

        // Calendar month: 1st to last day of month
        if (startDay === 1 && endDay >= 28) {
            const startDate = createISTDate(`${year}-${String(month1Based).padStart(2, '0')}-01`);
            const lastDay = new Date(year, month1Based, 0).getDate();
            const endDate = createISTDate(`${year}-${String(month1Based).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`, '23:59');
            return {
                startDate,
                endDate,
                month: month1Based,
                year,
                isCustomCycle: false
            };
        }

        // Custom cycle (e.g. startDay–endDay): period is startDay of month to endDay of next month (in IST).
        // Example: 26–25 → 26 Jan–25 Feb = Feb period. So 26, 30, 31 Jan belong to Feb; 1–25 Jan belong to Jan period.
        let cycleStartDate, cycleEndDate;

        if (day >= startDay) {
            // In IST: date is on or after startDay → period that starts this month
            cycleStartDate = createISTDate(`${year}-${String(month1Based).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`);
            const nextMonth = month1Based === 12 ? 1 : month1Based + 1;
            const nextYear = month1Based === 12 ? year + 1 : year;
            const lastDayNext = new Date(nextYear, nextMonth, 0).getDate();
            const endDayActual = Math.min(endDay, lastDayNext);
            cycleEndDate = createISTDate(`${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(endDayActual).padStart(2, '0')}`, '23:59');
        } else {
            // In IST: date is before startDay → period that ended this month (started previous month)
            const prevMonth = month1Based === 1 ? 12 : month1Based - 1;
            const prevYear = month1Based === 1 ? year - 1 : year;
            cycleStartDate = createISTDate(`${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`);
            const lastDayCur = new Date(year, month1Based, 0).getDate();
            const endDayActual = Math.min(endDay, lastDayCur);
            cycleEndDate = createISTDate(`${year}-${String(month1Based).padStart(2, '0')}-${String(endDayActual).padStart(2, '0')}`, '23:59');
        }

        const endIST = extractISTComponents(cycleEndDate);
        const cycleMonth = endIST.month;
        const cycleYear = endIST.year;

        return {
            startDate: cycleStartDate,
            endDate: cycleEndDate,
            month: cycleMonth,
            year: cycleYear,
            isCustomCycle: true
        };
    }

    /**
     * Check if a date (in IST) falls inside a payroll period [startDate, endDate].
     * Use when you need to exclude dates that do not belong to the period.
     */
    isDateInPayrollPeriod(date, startDate, endDate) {
        const d = extractISTComponents(new Date(date)).dateStr;
        const start = extractISTComponents(new Date(startDate)).dateStr;
        const end = extractISTComponents(new Date(endDate)).dateStr;
        return d >= start && d <= end;
    }

    /**
     * Get financial year for a given date
     */
    async getFinancialYearForDate(date = new Date()) {
        const leaveSettings = await this.getLeavePolicySettings();
        const targetDate = new Date(date);
        
        if (leaveSettings.financialYear.useCalendarYear) {
            return {
                startDate: new Date(targetDate.getFullYear(), 0, 1), // Jan 1
                endDate: new Date(targetDate.getFullYear(), 11, 31), // Dec 31
                year: targetDate.getFullYear(),
                name: `${targetDate.getFullYear()}`,
                isCustomYear: false
            };
        }

        // Custom financial year
        const { startMonth, startDay } = leaveSettings.financialYear;
        let fyStartDate, fyEndDate, fyYear;

        if (targetDate.getMonth() + 1 > startMonth || 
            (targetDate.getMonth() + 1 === startMonth && targetDate.getDate() >= startDay)) {
            // Date falls in current financial year
            fyStartDate = new Date(targetDate.getFullYear(), startMonth - 1, startDay);
            fyEndDate = new Date(targetDate.getFullYear() + 1, startMonth - 1, startDay - 1);
            fyYear = targetDate.getFullYear();
        } else {
            // Date falls in previous financial year
            fyStartDate = new Date(targetDate.getFullYear() - 1, startMonth - 1, startDay);
            fyEndDate = new Date(targetDate.getFullYear(), startMonth - 1, startDay - 1);
            fyYear = targetDate.getFullYear() - 1;
        }

        return {
            startDate: fyStartDate,
            endDate: fyEndDate,
            year: fyYear,
            name: `${fyYear}-${fyYear + 1}`,
            isCustomYear: true
        };
    }

    /**
     * Get payroll cycle and financial year info for a date
     */
    async getPeriodInfo(date = new Date()) {
        const [payrollCycle, financialYear] = await Promise.all([
            this.getPayrollCycleForDate(date),
            this.getFinancialYearForDate(date)
        ]);

        return {
            date,
            payrollCycle,
            financialYear
        };
    }

    /**
     * Get all payroll cycles in a date range
     */
    async getPayrollCyclesInRange(startDate, endDate) {
        const cycles = [];
        const currentDate = new Date(startDate);
        
        while (currentDate <= endDate) {
            const cycle = await this.getPayrollCycleForDate(currentDate);
            
            // Avoid duplicate cycles
            if (!cycles.find(c => c.startDate.getTime() === cycle.startDate.getTime())) {
                cycles.push(cycle);
            }
            
            // Move to next cycle start - handle month end properly
            const nextCycleDate = new Date(cycle.endDate);
            nextCycleDate.setDate(nextCycleDate.getDate() + 1);
            
            // Ensure we don't get stuck in infinite loop
            if (nextCycleDate <= currentDate) {
                nextCycleDate.setMonth(nextCycleDate.getMonth() + 1);
                nextCycleDate.setDate(1);
            }
            
            currentDate.setTime(nextCycleDate.getTime());
        }
        
        return cycles.sort((a, b) => a.startDate - b.startDate);
    }

    /**
     * Calculate remaining payroll periods in financial year from a given date
     * Used for prorated leave allocation based on payroll cycles
     */
    async calculateRemainingPayrollPeriodsInFY(dateOfJoining, fyEnd, payrollCycle) {
        try {
            const doj = new Date(dateOfJoining);
            const endDate = new Date(fyEnd);
            
            // Get all payroll cycles from DOJ to FY end
            const allCycles = await this.getPayrollCyclesInRange(doj, endDate);
            
            // Count cycles where DOJ falls within the cycle or cycles that start after DOJ
            let remainingPeriods = 0;
            
            for (const cycle of allCycles) {
                // If DOJ is within this cycle or cycle starts after DOJ, count it
                if (doj <= cycle.endDate) {
                    remainingPeriods++;
                }
            }
            
            // If DOJ is in the middle of a cycle, we still count it as a full period
            // for prorated calculation purposes (simplified approach)
            
            return Math.max(1, remainingPeriods); // At least 1 period
            
        } catch (error) {
            console.error('Error calculating remaining payroll periods:', error);
            return 12; // Fallback to 12 months
        }
    }
}

module.exports = new DateCycleService();
