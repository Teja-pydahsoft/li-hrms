const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Since the model might not be registered yet, we define the schema reference or just import it
// But better to import the model file so it registers with mongoose
const PayRegisterSummary = require('../pay-register/model/PayRegisterSummary');

async function removeSummaries() {
    try {
        const uri = process.env.MONGODB_URI;
        if (!uri) {
            console.error('MONGODB_URI not found in .env');
            process.exit(1);
        }

        console.log('Connecting to:', uri.replace(/:([^:@]+)@/, ':****@')); // Hide password in logs
        await mongoose.connect(uri);
        console.log('Connected to MongoDB');

        const month = '2026-02';
        const result = await PayRegisterSummary.deleteMany({ month });

        console.log(`-----------------------------------------`);
        console.log(`Successfully deleted ${result.deletedCount} summaries for ${month}`);
        console.log(`-----------------------------------------`);

        await mongoose.connection.close();
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

removeSummaries();
