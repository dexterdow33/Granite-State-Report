/*
 * End-to-end check of the redaction engine in a real browser.
 *
 * Builds a booby-trapped PDF (sensitive text, invisible white text, a filled
 * form field, author/keyword metadata, a rotated page), runs the app's own
 * scan -> accept -> export pipeline in headless Chromium from file://, then
 * inspects the output independently in Node with pdf.js and a raw byte scan.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');
const SECRETS = ['123-45-6789', 'Jane Q. Public', 'jane.public@example.org', '(603) 555-0142', '04/12/1981', 'INVISIBLE-SECRET', 'HIDDEN-FIELD-VALUE', 'Secret Author', '987-65-4321'];

async function makeFixture() {
  const doc = await PDFDocument.create();
  doc.setAuthor('Secret Author');
  doc.setKeywords(['INVISIBLE-SECRET']);
  doc.setTitle('Personnel file');
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const p1 = doc.addPage([612, 792]);
  const lines = [
    'Town of Example - Personnel Record',
    'Employee: Jane Q. Public',
    'SSN: 123-45-6789     DOB: 04/12/1981',
    'Phone: (603) 555-0142   Email: jane.public@example.org',
    'Direct deposit routing: 011000015',
    'Position: Road agent. Salary and dates of service are public.',
  ];
  lines.forEach((l, i) => p1.drawText(l, { x: 72, y: 700 - i * 24, size: 12, font }));
  p1.drawText('INVISIBLE-SECRET', { x: 72, y: 500, size: 12, font, color: rgb(1, 1, 1) });
  const form = doc.getForm();
  const tf = form.createTextField('notes');
  tf.setText('HIDDEN-FIELD-VALUE');
  tf.addToPage(p1, { x: 72, y: 420, width: 250, height: 24 });

  const p2 = doc.addPage([612, 792]);
  p2.drawText('Memo re: Jane Q. Public - performance review', { x: 72, y: 700, size: 12, font });
  p2.drawText('Nothing else on this page is exempt.', { x: 72, y: 676, size: 12, font });

  const p3 = doc.addPage([612, 792]);
  p3.setRotation(degrees(90));
  p3.drawText('Rotated page. Spouse SSN 987-65-4321.', { x: 72, y: 700, size: 12, font });

  return doc.save();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const fixture = await makeFixture();
  fs.writeFileSync(path.join(OUT, 'fixture.pdf'), fixture);

  const exe = fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined;
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForFunction(() => window.RSA91A && window.RSA91A.app);

  // Tracker: create a request through the store and confirm the table renders it.
  await page.evaluate(() => {
    const { store } = window.RSA91A;
    store.upsertRequest({ id: store.nextId(), receivedDate: '2026-09-28', requesterName: 'Test Requester', agency: 'Town of Example', description: 'Personnel file of the road agent', status: 'received', productions: [], history: [] });
  });
  await page.screenshot({ path: path.join(OUT, 'ui-requests.png') });
  const reqId = await page.evaluate(() => window.RSA91A.store.state.requests[0].id);

  await page.evaluate((id) => window.RSA91A.app.go('studio', { requestId: id }), reqId);
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.RSA91A.studio.open(new File([bytes], 'personnel.pdf', { type: 'application/pdf' }));
  }, Buffer.from(fixture).toString('base64'));

  const scanned = await page.evaluate(async () => {
    const S = window.RSA91A.studio.state;
    S.terms = 'Jane Q. Public\nHIDDEN-FIELD-VALUE';
    S.defaultCitation = '91-A:5,IV';
    S.defaultReason = 'Personal identifiers; no public interest in disclosure outweighs the privacy interest.';
    await window.RSA91A.studio.scan();
    return S.marks.map((m) => ({ page: m.page, text: m.text, type: m.type }));
  });
  console.log('Proposed marks:', scanned);
  const texts = scanned.map((m) => m.text);
  for (const want of ['123-45-6789', 'Jane Q. Public', 'jane.public@example.org', '(603) 555-0142', '04/12/1981', '011000015', '987-65-4321']) {
    assert.ok(texts.includes(want), 'detector missed ' + want);
  }
  assert.ok(scanned.some((m) => m.page === 1 && m.text === 'Jane Q. Public'), 'term on page 2 missed');
  assert.ok(scanned.some((m) => m.page === 2), 'rotated page 3 missed');
  assert.ok(scanned.some((m) => m.type === 'annotation' && m.text === 'HIDDEN-FIELD-VALUE'), 'form field value missed');

  // Reviewer accepts everything, withholds nothing, signs off; screenshot the review state.
  await page.evaluate(async () => {
    const S = window.RSA91A.studio.state;
    for (const m of S.marks) m.status = 'accepted';
    if (!await window.RSA91A.studio.signOff('Test Reviewer', 'e2e')) throw new Error('sign-off refused');
  });
  await page.evaluate(() => window.RSA91A.studio.render());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'ui-studio.png') });

  const downloadP = page.waitForEvent('download');
  await page.evaluate(async () => {
    const r = window.RSA91A.store.state.settings.redaction;
    r.batesPrefix = 'TEST-'; r.batesStart = 1; r.dpi = 150;
    await window.RSA91A.studio.doExport();
  });
  const dl = await downloadP;
  const outPath = path.join(OUT, 'redacted.pdf');
  await dl.saveAs(outPath);
  const report = await page.evaluate(() => window.RSA91A.studio.state.lastExport.report);
  console.log('In-app verification:', report.pass ? 'PASS' : 'FAIL', report.checks.map((c) => (c.ok ? 'ok ' : 'XX ') + c.name).join(' | '));
  assert.ok(report.pass, 'in-app verification failed');

  // Production was recorded on the linked request.
  const prod = await page.evaluate((id) => window.RSA91A.store.getRequest(id).productions, reqId);
  assert.strictEqual(prod.length, 1);
  assert.strictEqual(prod[0].batesFirst, 'TEST-000001');

  // Public log PDF builds and never contains the redacted content.
  const logB64 = await page.evaluate(async () => {
    const bytes = await window.RSA91A.engine.buildLogPdf([['Request', 'RTK-TEST']],
      [{ n: 1, page: 'TEST-000001 (p. 1)', scope: 'Partial redaction', cite: 'RSA 91-A:5, IV', reason: 'Personal identifiers.' }]);
    let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s);
  });
  fs.writeFileSync(path.join(OUT, 'log.pdf'), Buffer.from(logB64, 'base64'));

  // Letters: production letter pulls exemption entries.
  const letter = await page.evaluate((id) => {
    const { letters, store } = window.RSA91A;
    const req = store.getRequest(id);
    return letters.production(req, store.state.settings, { entries: req.productions[0].entries, date: '2026-09-30' });
  }, reqId);
  assert.match(letter, /RSA 91-A:5, IV/);
  await page.evaluate((id) => window.RSA91A.app.go('letters', { requestId: id }), reqId);
  await page.screenshot({ path: path.join(OUT, 'ui-letters.png') });

  // Render a redacted page in the browser for a visual check.
  await page.evaluate(() => { window.RSA91A.studio.state.marks = []; window.RSA91A.app.go('studio'); });
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.RSA91A.studio.open(new File([bytes], 'check.pdf', { type: 'application/pdf' }));
  }, fs.readFileSync(outPath).toString('base64'));
  await page.waitForTimeout(300);
  await page.locator('#page-wrap').screenshot({ path: path.join(OUT, 'redacted-page1.png') });

  await browser.close();

  // ---- Independent inspection in Node ----
  const out = fs.readFileSync(outPath);
  const raw = out.toString('latin1');
  for (const s of SECRETS) assert.ok(!raw.includes(s), 'raw bytes contain ' + s);

  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(out), isEvalSupported: false }).promise;
  assert.strictEqual(pdf.numPages, 3);
  let allText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i);
    const tc = await p.getTextContent();
    allText += tc.items.map((it) => it.str).join('');
    assert.strictEqual((await p.getAnnotations()).length, 0, 'annotations on page ' + i);
  }
  assert.strictEqual(allText.replace(/\s/g, ''), 'TEST-000001TEST-000002TEST-000003', 'unexpected text: ' + allText);
  const meta = await pdf.getMetadata();
  assert.ok(!meta.info.Author && !meta.info.Keywords, 'metadata leaked');
  assert.strictEqual(meta.info.Producer, 'RSA91A-Engine');
  const p3 = await pdf.getPage(3);
  const vp = p3.getViewport({ scale: 1 });
  assert.ok(vp.width > vp.height, 'rotated page kept its landscape orientation');

  const realErrors = errors.filter((e) => !/Setting up fake worker/.test(e));
  assert.deepStrictEqual(realErrors, [], 'browser console errors');
  console.log('E2E PASS. Output text layer:', JSON.stringify(allText), 'bytes:', out.length);
}

main().catch((e) => { console.error('E2E FAIL:', e); process.exit(1); });
