const Admin = require('../models/Admin');
const bcrypt = require('bcryptjs');

/**
 * Initialize default admin user if none exists
 */
async function initAdmin() {
  try {
    const adminCount = await Admin.countDocuments();
    
    if (adminCount === 0) {
      // Create default admin user
      const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
      const hashedPassword = await bcrypt.hash(defaultPassword, 10);
      
      const defaultAdmin = new Admin({
        username: process.env.DEFAULT_ADMIN_USERNAME || 'admin',
        password: hashedPassword,
        role: 'super_admin'
      });
      
      await defaultAdmin.save();
      console.log('✅ Default admin user created');
      console.log(`   Username: ${defaultAdmin.username}`);
      console.log(`   Password: ${defaultPassword}`);
      console.log('   ⚠️  Please change the default password after first login!');
    } else {
      console.log('✅ Admin user(s) already exist');
    }
  } catch (error) {
    console.error('❌ Error initializing admin:', error);
  }
}

module.exports = initAdmin;
