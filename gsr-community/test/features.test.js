const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { PNG, client, startApp } = require('./helpers');
const { createPartner, plainText } = require('../src/partner');

const STORY = 'https://granitestatereport.com/2026/09/28/sample-story/';

// Stands in for granitestatereport.com's WordPress REST API.
function fakeWordPress() {
  const posts = [{
    link: STORY,
    title: { rendered: 'Sample story &#8211; budget &amp; bonds' },
    excerpt: { rendered: '<p>Sample excerpt text.</p>\n' },
    date: '2026-09-28T09:00:00',
  }];
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const slug = u.searchParams.get('slug');
    const body = slug ? posts.filter((p) => p.link.includes(`/${slug}/`)) : posts;
    return { ok: true, json: async () => body };
  };
  return { fetchImpl, calls };
}

test('partner helpers', () => {
  assert.equal(plainText('<p>A &amp; B &#8211; C</p>'), 'A & B – C');
  const p = createPartner({ partner: { url: 'https://granitestatereport.com', host: 'granitestatereport.com' } }, async () => ({ ok: false }));
  assert.equal(p.canonical('https://www.granitestatereport.com/a/b?x=1#c'), 'https://granitestatereport.com/a/b/');
  assert.equal(p.canonical('http://granitestatereport.com/a/'), null, 'http refused');
  assert.equal(p.canonical('https://granitestatereport.com.evil.example/a/'), null, 'lookalike host refused');
  assert.equal(p.canonical('javascript:alert(1)'), null);
});

test('GSR discussion threads', async (t) => {
  const wp = fakeWordPress();
  const { base, member, db } = startApp(t, { fetch: wp.fetchImpl });

  // Logged out: bounced to login, then returned to the thread.
  const visitor = client(base);
  await visitor.call('/');
  let res = await visitor.call(`/discuss?url=${encodeURIComponent(STORY)}`);
  assert.match(res.headers.get('location'), /^\/login\?next=%2Fdiscuss/);

  const alice = await member('alice@example.com');
  res = await alice.call(`/discuss?url=${encodeURIComponent('https://example.com/not-gsr/')}`);
  assert.equal(res.status, 400);
  res = await alice.call(`/discuss?url=${encodeURIComponent('https://granitestatereport.com/2026/01/01/no-such-story/')}`);
  assert.equal(res.status, 404, 'unpublished slug refused');

  res = await alice.call(`/discuss?url=${encodeURIComponent(STORY)}`);
  assert.equal(res.status, 302);
  const thread = res.headers.get('location');
  res = await alice.call(`/discuss?url=${encodeURIComponent(STORY.replace('https://', 'https://www.') + '?utm_source=x')}`);
  assert.equal(res.headers.get('location'), thread, 'same story, same thread');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM posts WHERE section = 'news'").get().n, 1);

  const html = await (await alice.call(thread)).text();
  assert.match(html, /Sample story – budget &amp; bonds/);
  assert.match(html, /story from/);
  assert.doesNotMatch(html, />Edit</, 'nobody edits a newsroom thread');

  // Home page lists partner stories with Discuss links.
  const home = await (await alice.call('/')).text();
  assert.match(home, /Latest from/);
  assert.match(home, /discuss\?url=https%3A%2F%2Fgranitestatereport\.com/);

  // Members cannot post straight into the News section.
  res = await alice.post('/posts', { section: 'news', county: 'Merrimack', title: 'x', body: 'y' });
  assert.equal(res.status, 400);

  // The system account cannot log in.
  const bob = client(base);
  await bob.call('/');
  res = await bob.post('/login', { email: 'system@localhost', password: 'disabled' });
  assert.equal(res.status, 401);

  // Login returns to a safe local path only.
  const carol = await member('carol@example.com');
  await carol.post('/logout', {});
  res = await carol.post('/login', { email: 'carol@example.com', password: 'long enough password', next: '//evil.example' });
  assert.equal(res.headers.get('location'), '/');
  await carol.post('/logout', {});
  res = await carol.post('/login', { email: 'carol@example.com', password: 'long enough password', next: '/s/help' });
  assert.equal(res.headers.get('location'), '/s/help');
});

test('password reset', async (t) => {
  const { base, member, mail } = startApp(t);
  const alice = await member('alice@example.com');
  const other = client(base);
  await other.call('/');

  let res = await other.post('/forgot', { email: 'nobody@example.com' });
  assert.equal(res.status, 200);
  assert.equal(mail.length, 0, 'no mail for unknown address, same page shown');

  await other.post('/forgot', { email: 'alice@example.com' });
  assert.equal(mail.length, 1);
  const token = mail[0].text.match(/\/reset\/([\w-]+)/)[1];

  res = await other.post(`/reset/${token}`, { password: 'short' });
  assert.equal(res.status, 400);
  res = await other.post(`/reset/${token}`, { password: 'a brand new password' });
  assert.equal(res.headers.get('location'), '/');

  res = await alice.call('/s/help');
  assert.match(res.headers.get('location'), /^\/login/, 'old sessions are signed out');
  res = await other.post(`/reset/${token}`, { password: 'another new password' });
  assert.match(await res.text(), /invalid or expired/, 'token is single use');

  const fresh = client(base);
  await fresh.call('/');
  res = await fresh.post('/login', { email: 'alice@example.com', password: 'a brand new password' });
  assert.equal(res.status, 302);
});

test('verification email, edit, delete account, stale upload purge', async (t) => {
  const { member, mail, db, config, purgeStaleUploads } = startApp(t);
  const upload = (c) => {
    const fd = new FormData();
    fd.set('_csrf', c.csrf());
    fd.set('doc_type', 'nh_driver_license');
    fd.set('id_front', new Blob([PNG], { type: 'image/png' }), 'front.png');
    fd.set('selfie', new Blob([PNG], { type: 'image/png' }), 'selfie.png');
    return c.call('/verify', { method: 'POST', body: fd });
  };

  // Approval sends mail.
  const alice = await member('alice@example.com', { verified: false });
  await upload(alice);
  const mod = await member('mod@example.com');
  db.prepare("UPDATE users SET role = 'admin' WHERE email = 'mod@example.com'").run();
  await mod.post('/admin/verifications/1', { decision: 'approve' });
  assert.match(mail.at(-1).subject, /verified/);
  assert.equal(mail.at(-1).to, 'alice@example.com');

  // Edit own post; others cannot.
  let res = await alice.post('/posts', { section: 'help', county: 'Merrimack', title: 'Need a ride', body: 'Tuesday.' });
  const postUrl = res.headers.get('location');
  res = await alice.post(`${postUrl}/edit`, { county: 'Belknap', title: 'Need a ride Tuesday', body: 'To Laconia.' });
  assert.equal(res.status, 302);
  const html = await (await alice.call(postUrl)).text();
  assert.match(html, /Need a ride Tuesday/);
  assert.match(html, /edited/);
  res = await mod.call(`${postUrl}/edit`);
  assert.equal(res.status, 404);

  // Stale pending uploads are purged.
  const bob = await member('bob@example.com', { verified: false });
  await upload(bob);
  assert.equal(fs.readdirSync(config.privateUploadDir).length, 2);
  db.prepare("UPDATE verifications SET submitted_at = datetime('now', '-31 days') WHERE status = 'pending'").run();
  assert.equal(purgeStaleUploads(), 1);
  assert.equal(fs.readdirSync(config.privateUploadDir).length, 0);
  assert.equal(db.prepare("SELECT status FROM users WHERE email = 'bob@example.com'").get().status, 'unverified');
  assert.match(await (await bob.call('/verify')).text(), /expired before review/);

  // Deleting an account removes pending ID files and all content.
  const carol = await member('carol@example.com', { verified: false });
  await upload(carol);
  assert.equal(fs.readdirSync(config.privateUploadDir).length, 2);
  res = await carol.post('/account/delete', { password: 'wrong password' });
  assert.equal(res.status, 400);
  await carol.post('/account/delete', { password: 'long enough password' });
  assert.equal(fs.readdirSync(config.privateUploadDir).length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'carol@example.com'").get().n, 0);
  await alice.post('/account/delete', { password: 'long enough password' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM posts WHERE user_id NOT IN (SELECT id FROM users)').get().n, 0);
});
