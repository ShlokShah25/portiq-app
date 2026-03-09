const mongoose = require('mongoose');
const Admin = require('./server/models/Admin');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/workplace_visitor_management';

async function debugAdmin() {
  try {
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    const username = 'admin';
    const password = 'admin123';

    // Find admin
    const admin = await Admin.findOne({ username });
    
    if (!admin) {
      console.log('❌ Admin not found! Creating one...');
      const hashedPassword = await bcrypt.hash(password, 10);
      const newAdmin = new Admin({
        username,
        password: hashedPassword,
        role: 'super_admin'
      });
      await newAdmin.save();
      console.log('✅ Admin created');
    } else {
      console.log('✅ Admin found:', admin.username);
      console.log('   Role:', admin.role);
      console.log('   Password hash:', admin.password.substring(0, 20) + '...');
      
      // Test password comparison
      console.log('\n🔐 Testing password comparison...');
      const testPassword = 'admin123';
      const isMatch = await admin.comparePassword(testPassword);
      console.log(`   Password "${testPassword}" matches: ${isMatch}`);
      
      if (!isMatch) {
        console.log('\n⚠️  Password mismatch! Resetting password...');
        // Directly update password without triggering pre-save hook
        const hashedPassword = await bcrypt.hash(password, 10);
        await Admin.updateOne(
          { _id: admin._id },
          { $set: { password: hashedPassword } }
        );
        console.log('✅ Password reset complete');
        
        // Verify again
        const updatedAdmin = await Admin.findById(admin._id);
        const verifyMatch = await updatedAdmin.comparePassword(password);
        console.log(`   Verification: Password "${password}" matches: ${verifyMatch}`);
      }
    }

    console.log('\n📋 Final Login Credentials:');
    console.log(`   Username: ${username}`);
    console.log(`   Password: ${password}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

debugAdmin();
