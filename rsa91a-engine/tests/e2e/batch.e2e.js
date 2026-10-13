/*
 * Batch end-to-end: two files linked to one request are scanned, reviewed and
 * exported as one production with a single Bates sequence. The zip is opened
 * with Python's zipfile and each PDF's Bates stamps are read back with pdf.js.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');

async function makePdf(lines, pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([612, 792]);
    page.drawText('Page ' + (p + 1), { x: 72, y: 740, size: 12, font });
    lines.forEach((l, i) => page.drawText(l, { x: 72, y: 700 - i * 24, size: 12, font }));
  }
  return doc.save();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const a = await makePdf(['Invoice from Example Paving LLC', 'Contact: Jane Q. Public, (603) 555-0142', 'Tax ID 123-45-6789'], 3);
  const b = await makePdf(['Payroll summary', 'Employee: Jane Q. Public', 'Direct deposit routing: 011000015'], 2);

  const exe = fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined;
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForFunction(() => window.RSA91A && window.RSA91A.app);

  const reqId = await page.evaluate(() => {
    const { store } = window.RSA91A;
    const id = store.nextId();
    store.upsertRequest({ id, receivedDate: '2026-10-01', requesterName: 'Batch Requester', agency: 'Town of Example', description: 'Paving invoices and payroll', status: 'received', productions: [], history: [] });
    return id;
  });
  await page.evaluate((id) => window.RSA91A.app.go('studio', { requestId: id }), reqId);
  await page.evaluate(async ([a64, b64]) => {
    const f = (b64, name) => new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type: 'application/pdf' });
    await window.RSA91A.studio.open([f(a64, 'invoices.pdf'), f(b64, 'payroll.pdf')]);
  }, [Buffer.from(a).toString('base64'), Buffer.from(b).toString('base64')]);
  const batchInfo = await page.evaluate(() => ({ n: window.RSA91A.studio.state.docs.length, cur: window.RSA91A.studio.state.cur, pager: document.querySelector('#pager-label').textContent }));
  assert.strictEqual(batchInfo.n, 2);
  assert.strictEqual(batchInfo.cur, 0);
  console.log('Pager:', batchInfo.pager);

  await page.evaluate(async () => {
    const S = window.RSA91A.studio.state;
    S.terms = 'Jane Q. Public';
    S.defaultReason = 'Personal identifiers of a private individual.';
    const r = window.RSA91A.store.state.settings.redaction;
    r.batesPrefix = 'TOWN-'; r.batesStart = 100; r.bates = true; r.dpi = 150;
    await window.RSA91A.studio.scanAll();
  });
  const perFile = await page.evaluate(() => { window.RSA91A.studio.stash(); return window.RSA91A.studio.state.docs.map((e) => ({ name: e.name, marks: e.marks.map((m) => m.text) })); });
  console.log('Marks per file:', JSON.stringify(perFile));
  assert.ok(perFile[0].marks.includes('123-45-6789') && perFile[0].marks.includes('(603) 555-0142'), 'file 1 detection');
  assert.ok(perFile[1].marks.includes('011000015') && perFile[1].marks.includes('Jane Q. Public'), 'file 2 detection');
  assert.strictEqual(perFile[0].marks.filter((t) => t === 'Jane Q. Public').length, 3, 'term on every page of file 1');

  // Switch to file 2 via the UI list, withhold its page 2, then accept everything.
  await page.click('.doc-row:nth-child(2) .doc-name');
  await page.waitForTimeout(300);
  const pager2 = await page.textContent('#pager-label');
  assert.match(pager2, /File 2 of 2 · Page 1 of 2 · TOWN-000103/, 'Bates continues across files: ' + pager2);
  await page.click('button[title="Next page (PgDn)"]');
  await page.waitForTimeout(200);
  await page.click('text=Withhold this entire page');
  await page.evaluate(() => { for (const e of window.RSA91A.studio.state.docs) for (const m of e.marks) m.status = 'accepted'; for (const m of window.RSA91A.studio.state.marks) m.status = 'accepted'; });
  await page.evaluate(() => window.RSA91A.studio.render());
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'batch-review.png') });

  const downloads = [];
  page.on('download', (d) => downloads.push(d));
  await page.evaluate(async () => { window.RSA91A.studio.state.mergeOutput = true; await window.RSA91A.studio.exportBatch(); });
  await page.waitForFunction(() => window.RSA91A.studio.state.lastBatch !== null);
  const batch = await page.evaluate(() => { const b = window.RSA91A.studio.state.lastBatch; return { pass: b.pass, pages: b.pages, first: b.batesFirst, last: b.batesLast, files: b.files.map((f) => f.outName) }; });
  console.log('Batch:', batch);
  assert.ok(batch.pass, 'batch verification');
  assert.strictEqual(batch.pages, 5);
  assert.strictEqual(batch.first, 'TOWN-000100');
  assert.strictEqual(batch.last, 'TOWN-000104');
  await page.waitForTimeout(500);
  assert.strictEqual(downloads.length, 2, 'zip + internal csv downloads, got ' + downloads.length);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsa91a-batch-'));
  const saved = {};
  for (const d of downloads) { const p = path.join(dir, d.suggestedFilename()); await d.saveAs(p); saved[d.suggestedFilename()] = p; }
  const zipName = Object.keys(saved).find((n) => n.endsWith('.zip'));
  const csvName = Object.keys(saved).find((n) => n.endsWith('.csv'));
  assert.ok(zipName && csvName, 'downloads: ' + Object.keys(saved));
  assert.match(zipName, new RegExp('^' + reqId + '_PRODUCTION_'));
  assert.match(csvName, /INTERNAL_AUDIT_do_not_release\.csv$/);
  fs.copyFileSync(saved[zipName], path.join(OUT, 'production.zip'));

  // Open the zip with Python; extract the PDFs.
  const listing = execFileSync('python3', ['-I', '-c', `
import zipfile, sys, os
z = zipfile.ZipFile(sys.argv[1]); print(z.testzip()); z.extractall(sys.argv[2]); print('\\n'.join(sorted(z.namelist())))
`, saved[zipName], dir]).toString().trim().split('\n');
  assert.strictEqual(listing[0], 'None', 'zip integrity');
  const names = listing.slice(1);
  console.log('Zip contents:', names);
  assert.ok(names.includes('01_invoices_REDACTED_' + new Date().toISOString().slice(0, 10) + '.pdf') || names.some((n) => /^01_invoices_REDACTED_/.test(n)));
  assert.ok(names.some((n) => /^02_payroll_REDACTED_/.test(n)));
  assert.ok(names.includes('REDACTION_LOG.pdf') && names.includes('MANIFEST.txt'));
  assert.ok(names.some((n) => /^COMBINED_/.test(n)), 'combined pdf requested');
  assert.ok(!names.some((n) => /INTERNAL/.test(n)), 'internal audit must not be inside the production zip');

  // Read Bates stamps back from each PDF with pdf.js.
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const textOf = async (file) => {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), isEvalSupported: false }).promise;
    const out = [];
    for (let i = 1; i <= pdf.numPages; i++) out.push((await (await pdf.getPage(i)).getTextContent()).items.map((it) => it.str).join('').replace(/\s/g, ''));
    return out;
  };
  const t1 = await textOf(path.join(dir, names.find((n) => /^01_/.test(n))));
  const t2 = await textOf(path.join(dir, names.find((n) => /^02_/.test(n))));
  assert.deepStrictEqual(t1, ['TOWN-000100', 'TOWN-000101', 'TOWN-000102']);
  assert.strictEqual(t2[0], 'TOWN-000103');
  assert.ok(t2[1].startsWith('PAGEWITHHELDINFULL') && t2[1].endsWith('TOWN-000104'), 'slip sheet + Bates: ' + t2[1]);
  const tc = await textOf(path.join(dir, names.find((n) => /^COMBINED_/.test(n))));
  assert.strictEqual(tc.length, 5);
  assert.strictEqual(tc[4].slice(-11), 'TOWN-000104');
  const logText = (await textOf(path.join(dir, 'REDACTION_LOG.pdf'))).join(' ');
  assert.ok(logText.includes('01_invoices') && logText.includes('02_payroll') && logText.includes('Pagewithheld'), 'log mentions both files and the withheld page');
  assert.ok(!logText.includes('123-45-6789') && !logText.includes('JaneQ.Public'), 'public log must not contain withheld content');
  for (const s of ['123-45-6789', '(603) 555-0142', '011000015', 'Jane Q. Public']) {
    for (const f of names.filter((n) => n.endsWith('.pdf'))) assert.ok(!fs.readFileSync(path.join(dir, f), 'latin1').includes(s), s + ' found in ' + f);
  }
  const csvText = fs.readFileSync(saved[csvName], 'utf8');
  assert.ok(csvText.includes('123-45-6789') && csvText.includes('TOWN-000104') && csvText.includes('Page withheld'), 'internal audit has covered text and withheld row');

  const prod = await page.evaluate((id) => window.RSA91A.store.getRequest(id).productions, reqId);
  assert.strictEqual(prod.length, 1);
  assert.strictEqual(prod[0].files.length, 2);
  assert.strictEqual(prod[0].batesFirst, 'TOWN-000100');
  assert.strictEqual(prod[0].batesLast, 'TOWN-000104');
  assert.strictEqual(prod[0].pages, 5);

  await browser.close();
  const real = errors.filter((e) => !/fake worker/i.test(e));
  assert.deepStrictEqual(real, [], 'browser console errors');
  console.log('BATCH E2E PASS');
}

main().catch((e) => { console.error('BATCH E2E FAIL:', e); process.exit(1); });
