require('dotenv').config();
const mongoose = require('mongoose');

async function resetLeaveData() {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb+srv://team:SriPyRa2456@cluster0.cobwab6.mongodb.net/hrms';
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoURI);
    
    console.log('Clearing Leave Register...');
    const regResult = await mongoose.connection.collection('leave_register').deleteMany({});
    console.log(`- Deleted ${regResult.deletedCount} register entries.`);
    
    console.log('Clearing Leave Applications...');
    const leaveResult = await mongoose.connection.collection('leaves').deleteMany({});
    console.log(`- Deleted ${leaveResult.deletedCount} leave applications.`);
    
    console.log('Resetting Employee Leave Balances...');
    const empResult = await mongoose.connection.collection('employees').updateMany({}, {
      $set: {
        paidLeaves: 0,
        casualLeaves: 0,
        sickLeaves: 0,
        maternityLeaves: 0,
        onDutyLeaves: 0,
        compensatoryOffs: 0,
        allottedLeaves: 0
      }
    });
    console.log(`- Updated ${empResult.modifiedCount} employees.`);
    
    console.log('\n✅ Successfully reset all leave data to scratch.');
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error resetting leave data:', err);
    process.exit(1);
  }
}

resetLeaveData();
