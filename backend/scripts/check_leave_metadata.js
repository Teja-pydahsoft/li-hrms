const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

async function getLeaveMetadata() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const Leave = require('../leaves/model/Leave');
        
        const pipeline = [
            {
                $group: {
                    _id: {
                        leaveType: "$leaveType",
                        leaveNature: "$leaveNature",
                        isPaid: "$isPaid"
                    },
                    count: { $sum: 1 }
                }
            },
            {
                $project: {
                    _id: 0,
                    leaveType: "$_id.leaveType",
                    leaveNature: "$_id.leaveNature",
                    isPaid: "$_id.isPaid",
                    count: "$count"
                }
            },
            { $sort: { leaveType: 1, leaveNature: 1 } }
        ];

        const results = await Leave.aggregate(pipeline);
        console.log('--- Leave Types, Natures, and Paid Status in Database ---');
        console.table(results);
        
        const distinctTypes = [...new Set(results.map(r => r.leaveType))];
        const distinctNatures = [...new Set(results.map(r => r.leaveNature))];
        const distinctPaid = [...new Set(results.map(r => r.isPaid))];
        
        console.log('\nDistinct Leave Types:', distinctTypes);
        console.log('Distinct Leave Natures:', distinctNatures);
        console.log('Distinct Paid Status:', distinctPaid);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
    }
}

getLeaveMetadata();
