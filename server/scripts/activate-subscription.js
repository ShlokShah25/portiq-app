/**
 * One-off script: set hasActiveSubscription: true for a user (MongoDB).
 *
 * Usage (from repo root, with MONGODB_URI in .env or env):
 *   node server/scripts/activate-subscription.js you@company.com
 *   node server/scripts/activate-subscription.js usernameWithNoEmail
 *
 * For Railway: paste your MONGODB_URI when running locally, or use MongoDB Atlas UI:
 *   db.admins.updateOne(
 *     { $or: [ { email: "you@company.com" }, { username: "you@company.com" } ] },
 *     { $set: { hasActiveSubscription: true } }
 *   );
 */
// Load .env from current working directory (run from repo root: npm run activate-subscription -- email)
require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('../models/Admin');

const mongoUri =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/workplace_visitor_management';

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node server/scripts/activate-subscription.js <email-or-username>');
    process.exit(1);
  }

  const key = arg.trim();
  const emailKey = key.toLowerCase();

  await mongoose.connect(mongoUri);
  const admin = await Admin.findOne({
    $or: [{ username: key }, { email: emailKey }],
  });

  if (!admin) {
    console.error('No admin found for:', key);
    process.exit(1);
  }

  admin.hasActiveSubscription = true;
  await admin.save();

  console.log('✅ hasActiveSubscription set to true for:', admin.username);
  if (admin.email) console.log('   email:', admin.email);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
