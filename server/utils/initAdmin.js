const Admin = require('../models/Admin');
const bcrypt = require('bcryptjs');

async function ensureDefaultAdmin() {
  const adminCount = await Admin.countDocuments();
  if (adminCount === 0) {
    const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    const defaultAdmin = new Admin({
      username: process.env.DEFAULT_ADMIN_USERNAME || 'admin',
      password: hashedPassword,
      role: 'super_admin',
    });

    await defaultAdmin.save();
    console.log('✅ Default admin user created');
    console.log(`   Username: ${defaultAdmin.username}`);
    console.log(`   Password: ${defaultPassword}`);
    console.log('   ⚠️  Please change the default password after first login!');
  } else {
    console.log('✅ Admin user(s) already exist');
  }
}

async function ensureEducationDemoAdmin() {
  const username = process.env.EDU_DEMO_ADMIN_USERNAME || 'school-demo-admin';
  const email =
    process.env.EDU_DEMO_ADMIN_EMAIL || 'school-demo-admin@example.com';
  const passwordPlain =
    process.env.EDU_DEMO_ADMIN_PASSWORD || 'portiq-demo-edu-123';

  const existing = await Admin.findOne({ username }).lean();
  if (existing) {
    console.log('✅ Education demo admin already present:', {
      username: existing.username,
      email: existing.email,
    });
    return;
  }

  const hashed = await bcrypt.hash(passwordPlain, 10);
  const demo = new Admin({
    username,
    email,
    password: hashed,
    role: 'admin',
    productType: 'education',
    complimentaryAccess: true,
    plan: 'institutional',
  });
  await demo.save();
  console.log('✅ Education demo admin created for testing:');
  console.log(`   Username: ${username}`);
  console.log(`   Email:    ${email}`);
  console.log(`   Password: ${passwordPlain}`);
}

/**
 * Initialize built-in admin users if missing.
 */
async function initAdmin() {
  try {
    await ensureDefaultAdmin();
    await ensureEducationDemoAdmin();
  } catch (error) {
    console.error('❌ Error initializing admin:', error);
  }
}

module.exports = initAdmin;
