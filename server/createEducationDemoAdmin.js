/* Utility script to create a complimentary education admin for local testing.
 *
 * Usage (from repo root, with MongoDB env vars configured):
 *   node server/createEducationDemoAdmin.js
 */

const mongoose = require('mongoose');
const Admin = require('./models/Admin');

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    // eslint-disable-next-line no-console
    console.error('Missing MONGO_URI / MONGODB_URI environment variable.');
    process.exit(1);
  }

  await mongoose.connect(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  const username = 'school-demo-admin';
  const email = 'school-demo-admin@example.com';
  const password = 'portiq-demo-edu-123';

  let admin = await Admin.findOne({ username });
  if (!admin) {
    admin = new Admin({
      username,
      email,
      password,
      role: 'admin',
      productType: 'education',
      complimentaryAccess: true,
      plan: 'institutional',
    });
    await admin.save();
    // eslint-disable-next-line no-console
    console.log('Created education demo admin:', {
      username,
      email,
      password,
    });
  } else {
    // eslint-disable-next-line no-console
    console.log('Education demo admin already exists:', {
      username: admin.username,
      email: admin.email,
    });
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to create education demo admin:', err);
  process.exit(1);
});

