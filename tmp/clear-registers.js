require('dotenv').config({ path: 'backend/.env' });
const mongoose = require('mongoose');

async function clear() {
    try {
        const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/hrms';
        console.log('Connecting to', uri);
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
        console.log('Connected! Using native MongoDB collection to deleteMany...');
        const result = await mongoose.connection.db.collection('leave_register').deleteMany({});
        console.log(`Successfully deleted ${result.deletedCount} leave register records from the database.`);
        await mongoose.disconnect();
        console.log('Disconnected properly.');
        process.exit(0);
    } catch (e) {
        console.error('Error clearing leave registers:', e.message);
        process.exit(1);
    }
}
clear();
