const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');

const { PNG, client } = require('./helpers');

test('signup, verify, approve, post, comment', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhr-'));
  const { app, db, config } = createApp({ dataDir });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  const alice = client(base);
  await alice.call('/');
  let res = await alice.post('/signup', {
    email: 'alice@example.com', password: 'correct horse battery', display_name: 'Alice',
    town: 'Concord', county: 'Merrimack', adult: '1', rules: '1',
  });
  assert.equal(res.headers.get('location'), '/verify');

  // Unverified members cannot read content.
  res = await alice.call('/s/discussion');
  assert.equal(res.headers.get('location'), '/verify');

  // Missing CSRF is rejected.
  res = await alice.call('/posts', { method: 'POST', body: new URLSearchParams({ title: 'x' }) });
  assert.equal(res.status, 403);

  // Passport without proof of address is rejected.
  const form = (docType, withAddress) => {
    const fd = new FormData();
    fd.set('_csrf', alice.csrf());
    fd.set('doc_type', docType);
    fd.set('id_front', new Blob([PNG], { type: 'image/png' }), 'front.png');
    fd.set('selfie', new Blob([PNG], { type: 'image/png' }), 'selfie.png');
    if (withAddress) fd.set('address_proof', new Blob([PNG], { type: 'image/png' }), 'bill.png');
    return fd;
  };
  res = await alice.call('/verify', { method: 'POST', body: form('us_passport', false) });
  assert.equal(res.status, 400);
  assert.equal(fs.readdirSync(config.privateUploadDir).length, 0, 'rejected upload files are deleted');

  // A fake "image" fails the magic-byte check.
  const bad = form('nh_driver_license', false);
  bad.set('id_front', new Blob(['not an image'], { type: 'image/png' }), 'front.png');
  res = await alice.call('/verify', { method: 'POST', body: bad });
  assert.equal(res.status, 400);

  res = await alice.call('/verify', { method: 'POST', body: form('us_passport', true) });
  assert.equal(res.status, 302);
  assert.equal(fs.readdirSync(config.privateUploadDir).length, 3);

  // Uploaded IDs are never reachable without admin rights.
  res = await alice.call('/admin/verifications/1/file/0');
  assert.equal(res.status, 404);

  // Promote a moderator and approve.
  const mod = client(base);
  await mod.call('/');
  await mod.post('/signup', {
    email: 'mod@example.com', password: 'moderator password', display_name: 'Mod',
    town: 'Keene', county: 'Cheshire', adult: '1', rules: '1',
  });
  db.prepare("UPDATE users SET role = 'admin', status = 'verified' WHERE email = 'mod@example.com'").run();
  res = await mod.call('/admin/verifications/1/file/0');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  res = await mod.post('/admin/verifications/1', { decision: 'approve' });
  assert.equal(res.status, 302);
  assert.equal(fs.readdirSync(config.privateUploadDir).length, 0, 'ID files deleted after decision');

  // Alice can now post and comment.
  res = await alice.post('/posts', {
    section: 'marketplace', county: 'Merrimack', title: 'Cord of seasoned oak', body: 'Split and stacked.\n\nPickup in Concord.', price: '325',
  });
  assert.equal(res.status, 302);
  const postUrl = res.headers.get('location');
  res = await alice.post(`${postUrl}/comments`, { body: 'Still available?' });
  res = await alice.call(postUrl);
  const html = await res.text();
  assert.match(html, /Cord of seasoned oak/);
  assert.match(html, /\$325\.00/);
  assert.match(html, /Still available\?/);

  // Output is escaped.
  res = await alice.post('/posts', { section: 'discussion', county: 'Merrimack', title: '<script>x</script>', body: 'hi' });
  res = await alice.call(res.headers.get('location'));
  assert.doesNotMatch(await res.text(), /<script>x<\/script>/);

  // Price on a non-marketplace post is refused.
  res = await alice.post('/posts', { section: 'discussion', county: 'Merrimack', title: 't', body: 'b', price: '5' });
  assert.equal(res.status, 400);
});
