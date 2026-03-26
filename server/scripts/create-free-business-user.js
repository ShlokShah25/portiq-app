/**
 * Create (or upgrade) an admin with Business plan limits and full app access without Razorpay.
 *
 * From repo root with MONGODB_URI in .env:
 *   node server/scripts/create-free-business-user.js <username> <email> <password>
 *   node server/scripts/create-free-business-user.js <username> <password>
 *
 * Or via env (email optional):
 *   FREE_BUSINESS_USERNAME=... FREE_BUSINESS_EMAIL=... FREE_BUSINESS_PASSWORD=... node server/scripts/create-free-business-user.js
 *
 * If the username already exists, updates plan to business, sets complimentaryAccess, and
 * sets the password from args/env.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('../models/Admin');

const mongoUri =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/workplace_visitor_management';

async function main() {
  const rest = process.argv.slice(2);
  let username;
  let email;
  let password;

  if (rest.length >= 3) {
    username = rest[0].trim();
    email = rest[1].trim().toLowerCase() || undefined;
    password = rest[2];
  } else if (rest.length === 2) {
    username = rest[0].trim();
    password = rest[1];
    email = undefined;
  } else {
    username = (process.env.FREE_BUSINESS_USERNAME || '').trim();
    email = String(process.env.FREE_BUSINESS_EMAIL || '')
      .trim()
      .toLowerCase() || undefined;
    password = process.env.FREE_BUSINESS_PASSWORD || '';
  }

  if (!username || !password) {
    console.error(
      'Usage: node server/scripts/create-free-business-user.js <username> <email> <password>'
    );
    console.error(
      '   or: node server/scripts/create-free-business-user.js <username> <password>'
    );
    console.error(
      '   or: FREE_BUSINESS_USERNAME=... FREE_BUSINESS_EMAIL=... FREE_BUSINESS_PASSWORD=... node server/scripts/create-free-business-user.js'
    );
    process.exit(1);
  }

  if (password.length < 6) {
    console.error('Password must be at least 6 characters.');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);

  const existing = await Admin.findOne({ username });
  if (existing) {
    existing.plan = 'business';
    existing.productType = 'workplace';
    existing.complimentaryAccess = true;
    existing.hasActiveSubscription = false;
    if (email) existing.email = email;
    existing.password = password;
    await existing.save();
    console.log('✅ Updated existing user to complimentary Business:', username);
    if (email) console.log('   email:', email);
  } else {
    await Admin.create({
      username,
      email,
      password,
      plan: 'business',
      productType: 'workplace',
      complimentaryAccess: true,
      hasActiveSubscription: false,
      role: 'admin',
    });
    console.log('✅ Created complimentary Business user:', username);
    if (email) console.log('   email:', email);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
