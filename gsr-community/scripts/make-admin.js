// Usage: npm run make-admin -- someone@example.com
// Promotes an existing account to admin (moderator) and marks it verified.
const { loadConfig } = require('../src/config');
const { openDb } = require('../src/db');

const email = process.argv[2];
if (!email) {
  console.error('Usage: npm run make-admin -- <email>');
  process.exit(1);
}
const db = openDb(loadConfig());
const result = db.prepare(`
  UPDATE users SET role = 'admin', status = 'verified', verified_at = COALESCE(verified_at, datetime('now'))
  WHERE email = ?`).run(email.toLowerCase());
if (!result.changes) {
  console.error(`No account with email ${email}. Sign up on the site first.`);
  process.exit(1);
}
console.log(`${email} is now an admin.`);
