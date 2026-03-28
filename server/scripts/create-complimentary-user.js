/**
 * Create (or update) an admin with complimentary full app access (no Razorpay).
 * Plan controls limits (participants, book size, recording duration, etc.).
 *
 * From repo root with MONGODB_URI in .env:
 *   node server/scripts/create-complimentary-user.js <username> <password> [starter|professional|business|institutional]
 *
 * Default plan: professional
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('../models/Admin');

const mongoUri =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/workplace_visitor_management';

const PLANS = ['starter', 'professional', 'business'];

async function main() {
  const rest = process.argv.slice(2);
  if (rest.length < 2) {
    console.error(
      'Usage: node server/scripts/create-complimentary-user.js <username> <password> [starter|professional|business|institutional]'
    );
    process.exit(1);
  }

  const username = rest[0].trim();
  const password = rest[1];
  let plan = (rest[2] || 'professional').trim().toLowerCase();
  if (!PLANS.includes(plan)) {
    console.error('Plan must be one of:', PLANS.join(', '));
    process.exit(1);
  }

  if (!username || !password) {
    console.error('Username and password are required.');
    process.exit(1);
  }
  if (password.length < 6) {
    console.error('Password must be at least 6 characters.');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);

  const existing = await Admin.findOne({ username });
  if (existing) {
    existing.plan = plan;
    existing.productType = 'workplace';
    existing.complimentaryAccess = true;
    existing.hasActiveSubscription = false;
    existing.password = password;
    await existing.save();
    console.log(`✅ Updated existing user to complimentary ${plan}:`, username);
  } else {
    await Admin.create({
      username,
      password,
      plan,
      productType: 'workplace',
      complimentaryAccess: true,
      hasActiveSubscription: false,
      role: 'admin',
    });
    console.log(`✅ Created complimentary ${plan} user:`, username);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
