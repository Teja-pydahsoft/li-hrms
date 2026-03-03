const Settings = require('../../settings/model/Settings');
const LeavePolicySettings = require('../../settings/model/LeavePolicySettings');

/**
 * Date and Cycle Utility Service
 * Handles financial year and payroll cycle calculations
 */

class DateCycleService {
    /**
     * Get payroll cycle settings
     */
    async getPayrollCycleSettings() {
        try {
            const settings = await Settings.getSettingsByCategory('payroll');
            return {
                startDay: settings.payroll_cycle_start_day || 1,
                endDay: settings.payroll_cycle_end_day || 31
            };
        } catch (error) {
            console.error('Error getting payroll cycle settings:', error);
            // Default to calendar month
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
     * Get payroll cycle for a given date
     * Returns { startDate, endDate, month, year }
     */
    async getPayrollCycleForDate(date = new Date()) {
        const payrollSettings = await this.getPayrollCycleSettings();
        const targetDate = new Date(date);
        
        const { startDay, endDay } = payrollSettings;
        
        // If cycle is calendar month (1st to 31st)
        if (startDay === 1 && endDay === 31) {
            const monthStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
            const monthEnd = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0); // Last day of month
            
            return {
                startDate: monthStart,
                endDate: monthEnd,
                month: targetDate.getMonth() + 1,
                year: targetDate.getFullYear(),
                isCustomCycle: false
            };
        }

        // Custom cycle (e.g., 26th to 25th)
        let cycleStartDate, cycleEndDate, cycleMonth, cycleYear;

        if (targetDate.getDate() >= startDay) {
            // Date falls in current month's cycle
            cycleStartDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), startDay);
            
            // Calculate end date properly for next month
            const nextMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 1);
            cycleEndDate = new Date(nextMonth);
            cycleEndDate.setDate(endDay);
            
            // If endDay exceeds days in next month, adjust to last day of next month
            const lastDayOfNextMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 2, 0).getDate();
            if (endDay > lastDayOfNextMonth) {
                cycleEndDate.setDate(lastDayOfNextMonth);
            }
            
            cycleMonth = targetDate.getMonth() + 1;
            cycleYear = targetDate.getFullYear();
        } else {
            // Date falls in previous month's cycle
            const prevMonth = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
            prevMonth.setMonth(prevMonth.getMonth() - 1);
            
            cycleStartDate = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), startDay);
            
            // Calculate end date for current month
            cycleEndDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), endDay);
            
            // If endDay exceeds days in current month, adjust to last day of current month
            const lastDayOfCurrentMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();
            if (endDay > lastDayOfCurrentMonth) {
                cycleEndDate.setDate(lastDayOfCurrentMonth);
            }
            
            // Cycle started in prevMonth — use 1-based month (1-12) for that month
            cycleMonth = prevMonth.getMonth() + 1;
            cycleYear = prevMonth.getFullYear();
        }

        return {
            startDate: cycleStartDate,
            endDate: cycleEndDate,
            month: cycleMonth,
            year: cycleYear,
            isCustomCycle: true
        };
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
     * Format period info for display
     */
    formatPeriodInfo(periodInfo) {
        const { payrollCycle, financialYear } = periodInfo;
        
        return {
            payrollCycle: {
                display: `${payrollCycle.startDate.toLocaleDateString()} - ${payrollCycle.endDate.toLocaleDateString()}`,
                monthYear: `${payrollCycle.month}/${payrollCycle.year}`,
                isCustom: payrollCycle.isCustomCycle
            },
            financialYear: {
                display: financialYear.name,
                isCustom: financialYear.isCustomYear
            }
        };
    }
}

module.exports = new DateCycleService();
