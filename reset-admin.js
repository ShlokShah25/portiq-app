const mongoose = require('mongoose');
const Admin = require('./server/models/Admin');
require('dotenv').config();

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/workplace_visitor_management';

async function resetAdmin() {
  try {
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    const username = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
    const password = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';

    // Find or create admin
    let admin = await Admin.findOne({ username });
    
    if (admin) {
      console.log(`📝 Found existing admin: ${username}`);
      // Update password
      const bcrypt = require('bcryptjs');
      admin.password = await bcrypt.hash(password, 10);
      await admin.save();
      console.log(`✅ Password reset for: ${username}`);
    } else {
      console.log(`➕ Creating new admin: ${username}`);
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash(password, 10);
      admin = new Admin({
        username,
        password: hashedPassword,
        role: 'super_admin'
      });
      await admin.save();
      console.log(`✅ Admin created: ${username}`);
    }

    console.log('\n📋 Login Credentials:');
    console.log(`   Username: ${username}`);
    console.log(`   Password: ${password}`);
    console.log('\n⚠️  Please change the password after first login!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

resetAdmin();
