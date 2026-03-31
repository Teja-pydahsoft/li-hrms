const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const Leave = require('../leaves/model/Leave');
const LeaveSettings = require('../leaves/model/LeaveSettings');
const Employee = require('../employees/model/Employee');
const summaryCalculationService = require('../attendance/services/summaryCalculationService');
const { extractISTComponents } = require('../shared/utils/dateUtils');

async function runGlobalFix() {
    try {
        console.log('Connecting to Database...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected.');

        // --- Step 1: Update LeaveSettings ---
        console.log('\n--- 1. Updating LeaveSettings (LOP Type Configuration) ---');
        const settings = await LeaveSettings.findOne({ type: 'leave', isActive: true });
        if (!settings) {
            console.warn('⚠️ No active "leave" settings found.');
        } else {
            let updatedSettings = false;
            settings.types = settings.types.map(t => {
                if (t.code === 'LOP' || t.name === 'LOP') {
                    if (t.leaveNature !== 'lop' || t.isPaid !== false) {
                        console.log(`- Fixing LOP definition (Nature: ${t.leaveNature} -> lop, Paid: ${t.isPaid} -> false)`);
                        t.leaveNature = 'lop';
                        t.isPaid = false;
                        updatedSettings = true;
                    }
                }
                return t;
            });
            
            if (updatedSettings) {
                await settings.save();
                console.log('✅ LeaveSettings updated.');
            } else {
                console.log('✅ LeaveSettings already correct.');
            }
        }

        // --- Step 2: Identify & Update Leave Records ---
        console.log('\n--- 2. Updating Leave Records (leaveType: "LOP") ---');
        
        // Find all active LOP leaves (even if already fixed, to ensure we recalculate accurately)
        const allLopLeaves = await Leave.find({
            leaveType: 'LOP',
            isActive: true
        }).select('employeeId emp_no fromDate leaveNature').lean();

        if (allLopLeaves.length === 0) {
            console.log('✅ No Leave records found for "LOP".');
        } else {
            console.log(`- Found ${allLopLeaves.length} LOP records.`);
            
            // Filter only those that need nature update
            const mismatchIds = allLopLeaves
                .filter(l => l.leaveNature !== 'lop')
                .map(l => l._id);

            if (mismatchIds.length > 0) {
                const updateResult = await Leave.updateMany(
                    { _id: { $in: mismatchIds } },
                    { $set: { leaveNature: 'lop' } }
                );
                console.log(`✅ Updated ${updateResult.modifiedCount} records to "lop" nature.`);
            }

            // Extract unique (employeeId, month, year) for ALL LOP leaves (ensures synching)
            const affectedSlots = new Map();
            for (const l of allLopLeaves) {
                const components = extractISTComponents(l.fromDate);
                const key = `${l.employeeId}_${components.year}_${components.month}`;
                affectedSlots.set(key, {
                    employeeId: l.employeeId,
                    emp_no: l.emp_no,
                    year: components.year,
                    monthNumber: components.month
                });
            }


            // --- Step 3: Recalculate Summaries ---
            console.log(`\n--- 3. Triggering Recalculations for ${affectedSlots.size} unique Month-Employee slots ---`);
            let count = 0;
            for (const slot of affectedSlots.values()) {
                count++;
                process.stdout.write(`- [${count}/${affectedSlots.size}] Recalculating ${slot.emp_no} for ${slot.monthNumber}/${slot.year}... `);
                try {
                    await summaryCalculationService.calculateMonthlySummary(
                        slot.employeeId,
                        slot.emp_no,
                        slot.year,
                        slot.monthNumber
                    );
                    process.stdout.write('DONE\n');
                } catch (err) {
                    process.stdout.write(`FAILED: ${err.message}\n`);
                }
            }
        }

        console.log('\n=== Global LOP Migration Completed Successfully ===');

    } catch (error) {
        console.error('\n❌ Error during global fix:', error);
    } finally {
        await mongoose.disconnect();
    }
}

runGlobalFix();
