/*
 * Shelf and sign-off end-to-end. Files opened with a request linked are kept
 * in IndexedDB with their marks and sign-off; after a page reload they come
 * back from the shelf. Export refuses unsigned files; a sign-off goes stale
 * when marks change.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');

async function makePdf(lines) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  lines.forEach((l, i) => page.drawText(l, { x: 72, y: 700 - i * 24, size: 12, font }));
  return Buffer.from(await doc.save()).toString('base64');
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const a = await makePdf(['Contract with Example Paving LLC', 'Owner SSN 123-45-6789']);
  const b = await makePdf(['Payroll note', 'Call (603) 555-0142']);
  const exe = fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined;
  const browser = await chromium.launch({ executablePath: exe });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const url = 'file://' + path.join(ROOT, 'index.html');
  await page.goto(url);
  await page.waitForFunction(() => window.RSA91A && window.RSA91A.app);

  const reqId = await page.evaluate(() => {
    const { store } = window.RSA91A;
    const id = store.nextId();
    store.upsertRequest({ id, receivedDate: '2026-10-06', requesterName: 'Shelf Requester', agency: 'Town of Example', description: 'Paving contract and payroll note', status: 'received', productions: [], history: [] });
    return id;
  });
  await page.evaluate((id) => window.RSA91A.app.go('studio', { requestId: id }), reqId);
  await page.evaluate(async ([a64, b64]) => {
    const f = (b64, name) => new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type: 'application/pdf' });
    await window.RSA91A.studio.open([f(a64, 'contract.pdf'), f(b64, 'payroll-note.pdf')]);
  }, [a, b]);
  await page.waitForTimeout(300);
  const shelved = await page.evaluate((id) => ({ shelf: window.RSA91A.store.getRequest(id).shelf, ids: window.RSA91A.studio.state.docs.map((e) => e.shelfId) }), reqId);
  console.log('Auto-shelved:', JSON.stringify(shelved));
  assert.strictEqual(shelved.shelf.length, 2, 'both files on the shelf');
  assert.ok(shelved.ids.every(Boolean), 'entries carry shelf ids');

  // Scan all, accept everything in file 1, sign it off; leave file 2 unsigned.
  await page.evaluate(async () => {
    const st = window.RSA91A.studio; const S = st.state;
    S.defaultReason = 'Personal identifiers.';
    await st.scanAll();
    await st.activate(0);
    for (const m of S.marks) m.status = 'accepted';
    if (!await st.signOff('Pat Reviewer', 'first pass')) throw new Error('sign-off refused');
    await st.persistAll();
  });
  const unsignedExport = await page.evaluate(async () => { await window.RSA91A.studio.exportBatch(); return window.RSA91A.studio.state.lastBatch; });
  assert.strictEqual(unsignedExport, null, 'export must refuse while payroll-note.pdf is unsigned');
  const summary1 = await page.evaluate((id) => window.RSA91A.store.getRequest(id).shelf.map((f) => ({ name: f.name, marks: f.marks, reviewed: f.reviewed && f.reviewed.by })), reqId);
  console.log('Shelf summary before reload:', JSON.stringify(summary1));
  assert.strictEqual(summary1[0].reviewed, 'Pat Reviewer');
  assert.ok(summary1[0].marks >= 1 && summary1[1].marks >= 1, 'marks saved for both files');
  await page.screenshot({ path: path.join(OUT, 'shelf-before-reload.png') });

  // Reload: nothing is open, the shelf remembers everything.
  await page.reload();
  await page.waitForFunction(() => window.RSA91A && window.RSA91A.app);
  await page.evaluate(() => window.RSA91A.app.go('requests'));
  const cell = await page.textContent('table.grid tbody tr td:nth-child(8)');
  assert.match(cell, /2 on shelf, 1 signed off/, 'tracker shows shelf: ' + cell);
  await page.click('table.grid button:has-text("Open files")');
  await page.waitForFunction(() => window.RSA91A.studio.state.docs.length === 2, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  const restored = await page.evaluate(() => { const st = window.RSA91A.studio; st.stash(); return st.state.docs.map((e) => ({ name: e.name, marks: e.marks.length, accepted: e.marks.filter((m) => m.status === 'accepted').length, reviewed: e.reviewed && e.reviewed.by, valid: st.reviewValid(e), shelfId: !!e.shelfId })); });
  console.log('Restored from shelf:', JSON.stringify(restored));
  assert.strictEqual(restored[0].name, 'contract.pdf');
  assert.ok(restored[0].marks >= 1 && restored[0].accepted === restored[0].marks, 'file 1 marks restored as accepted');
  assert.strictEqual(restored[0].reviewed, 'Pat Reviewer');
  assert.ok(restored[0].valid, 'sign-off still valid after reload');
  assert.ok(restored[1].marks >= 1 && !restored[1].reviewed, 'file 2 marks restored, unsigned');
  await page.screenshot({ path: path.join(OUT, 'shelf-after-reload.png') });

  // Changing a mark after sign-off makes it stale.
  const stale = await page.evaluate(async () => {
    const st = window.RSA91A.studio; const S = st.state;
    await st.activate(0);
    S.marks[0].status = 'rejected';
    st.render();
    return { valid: st.reviewValid(S), text: document.querySelector('#studio-sidebar').textContent.includes('is stale') };
  });
  assert.ok(!stale.valid && stale.text, 'sign-off should be stale after a mark changed');

  // Re-sign file 1, sign file 2, export the production through the UI button.
  await page.evaluate(async () => {
    const st = window.RSA91A.studio; const S = st.state;
    S.marks[0].status = 'accepted';
    if (!await st.signOff('Pat Reviewer', 'second pass')) throw new Error('re-sign refused');
    await st.activate(1);
    for (const m of S.marks) m.status = 'accepted';
    if (!await st.signOff('Sam Supervisor')) throw new Error('sign-off 2 refused');
    const r = window.RSA91A.store.state.settings.redaction; r.batesPrefix = 'SHELF-'; r.batesStart = 1; r.bates = true; r.dpi = 150;
  });
  const downloads = [];
  page.on('download', (d) => downloads.push(d));
  await page.click('button:has-text("Export production")');
  await page.waitForFunction(() => window.RSA91A.studio.state.lastBatch !== null, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const batch = await page.evaluate(() => { const b = window.RSA91A.studio.state.lastBatch; return { pass: b.pass, first: b.batesFirst, last: b.batesLast }; });
  assert.ok(batch.pass && batch.first === 'SHELF-000001' && batch.last === 'SHELF-000002', JSON.stringify(batch));
  assert.strictEqual(downloads.length, 2);
  const prod = await page.evaluate((id) => window.RSA91A.store.getRequest(id).productions, reqId);
  assert.deepStrictEqual(prod[0].files.map((f) => f.reviewedBy), ['Pat Reviewer', 'Sam Supervisor']);

  // Remove one file from the shelf; the other stays.
  await page.evaluate(async (id) => { const s = window.RSA91A.store.getRequest(id).shelf; await window.RSA91A.shelf.remove(id, s[1].id); }, reqId);
  const after = await page.evaluate((id) => window.RSA91A.store.getRequest(id).shelf.map((f) => f.name), reqId);
  assert.deepStrictEqual(after, ['contract.pdf']);
  const usage = await page.evaluate(() => window.RSA91A.filestore.usage());
  assert.strictEqual(usage.files, 1);

  await browser.close();
  const real = errors.filter((e) => !/fake worker/i.test(e));
  assert.deepStrictEqual(real, [], 'browser console errors');
  console.log('SHELF E2E PASS');
}

main().catch((e) => { console.error('SHELF E2E FAIL:', e); process.exit(1); });
