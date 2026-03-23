/**
 * Test script for employee leave initialization service
 * Tests prorated CL calculation for new employees
 */

const { calculateRemainingMonthsInFY, getCasualLeaveEntitlement } = require('./leaves/services/employeeLeaveInitializationService');
const LeavePolicySettings = require('./settings/model/LeavePolicySettings');

async function testProratedCL() {
    try {
        console.log('🧪 Testing Employee Leave Initialization Service...\n');

        // Test 1: Calculate remaining months for different DOJ dates
        console.log('📅 Testing remaining months calculation:');

        const testDates = [
            { date: '2026-04-01', expected: 12 }, // Start of FY
            { date: '2026-07-15', expected: 6 },  // Mid-year
            { date: '2026-10-01', expected: 3 },  // Late in year
            { date: '2026-12-31', expected: 1 },  // End of year
        ];

        for (const test of testDates) {
            const result = await calculateRemainingMonthsInFY(new Date(test.date));
            console.log(`  DOJ: ${test.date} → Remaining months: ${result.remainingMonths} (expected: ~${test.expected})`);
        }

        // Test 2: Get CL entitlement
        console.log('\n🎯 Testing CL entitlement calculation:');

        const settings = await LeavePolicySettings.getSettings();
        const doj = new Date('2026-07-15'); // Mid-year DOJ

        const entitlement = getCasualLeaveEntitlement(settings, doj, doj);
        console.log(`  Default CL entitlement: ${entitlement} days`);

        // Test 3: Calculate prorated CL
        console.log('\n📊 Testing prorated CL calculation:');

        const remainingMonthsResult = await calculateRemainingMonthsInFY(doj);
        const proratedCL = Math.round((entitlement * remainingMonthsResult.remainingMonths / 12) * 100) / 100;

        console.log(`  Employee joining on ${doj.toISOString().split('T')[0]}`);
        console.log(`  Full annual entitlement: ${entitlement} days`);
        console.log(`  Remaining months in FY: ${remainingMonthsResult.remainingMonths}`);
        console.log(`  Prorated CL: ${proratedCL} days`);

        console.log('\n✅ All tests completed successfully!');

    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

// Run the test
testProratedCL();