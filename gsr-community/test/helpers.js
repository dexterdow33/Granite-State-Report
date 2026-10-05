const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
  '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

// Minimal cookie-jar client around fetch.
function client(base) {
  const jar = {};
  const call = async (url, opts = {}) => {
    const res = await fetch(base + url, {
      redirect: 'manual', ...opts,
      headers: { ...(opts.headers || {}), cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') },
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar[pair.slice(0, i)] = pair.slice(i + 1);
    }
    return res;
  };
  const csrf = () => decodeURIComponent(jar.gsrc_csrf);
  const post = (url, fields) => call(url, { method: 'POST', body: new URLSearchParams({ _csrf: csrf(), ...fields }) });
  return { call, post, csrf, jar };
}

// Starts an app on a random port with a temp data dir. Returns helpers for common setup.
function startApp(t, deps = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhr-'));
  const mail = [];
  const made = createApp({ dataDir }, { mailer: { send: async (m) => { mail.push(m); } }, ...deps });
  const server = made.app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  async function member(email, { verified = true } = {}) {
    const c = client(base);
    await c.call('/');
    await c.post('/signup', {
      email, password: 'long enough password', display_name: email.split('@')[0],
      town: 'Concord', county: 'Merrimack', adult: '1', rules: '1',
    });
    if (verified) made.db.prepare("UPDATE users SET status = 'verified', verified_at = datetime('now') WHERE email = ?").run(email);
    return c;
  }
  return { ...made, base, mail, member };
}

module.exports = { PNG, client, startApp };
