require('dotenv').config();
const User = require('../users/model/User');
const { connectMongoDB, closeMongoDB } = require('../config/database');

const seedSuperAdmin = async () => {
  try {
    // Connect to MongoDB
    await connectMongoDB();

    // // Check if super admin already exists
    // const existingAdmin = await User.findOne({ role: 'super_admin' });

    // if (existingAdmin) {
    //   console.log('⚠️  Super Admin already exists');
    //   console.log(`   Email: ${existingAdmin.email}`);
    //   await closeMongoDB();
    //   process.exit(0);
    // }

    // Create super admin
    const superAdmin = await User.create({
      email: 'teja@hrms.com',
      password: 'Admin@123',
      name: 'Super Admin',
      role: 'super_admin',
      roles: ['super_admin'],
      isActive: true,
    });

    console.log('✅ Super Admin created successfully!');
    console.log(`   Email: ${superAdmin.email}`);
    console.log(`   Password: ${'Admin@123'}`);
    console.log('   ⚠️  Please change the password after first login!');

    await closeMongoDB();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding super admin:', error.message);
    console.error('   Full error:', error);
    await closeMongoDB().catch(() => { });
    if (process.env.NODE_ENV !== "test") process.exit(1);
  }
};

// Run seed
seedSuperAdmin();

