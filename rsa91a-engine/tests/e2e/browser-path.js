// Finds a Chromium build for the browser tests. Set CHROMIUM_PATH to override.
const fs = require('fs');
const candidates = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].filter(Boolean);
module.exports = candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
