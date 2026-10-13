/*
 * OCR end-to-end: a scanned page (an image with no text layer) goes through
 * OCR, detection, redaction and export. The exported page is then OCR'd again
 * to show the redacted text is no longer readable.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');

async function makeSourcePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const p = doc.addPage([612, 792]);
  const lines = [
    'TOWN OF EXAMPLE - EMPLOYEE RECORD',
    'Name: Jane Q. Public',
    'Social Security No. 123-45-6789',
    'Home phone (603) 555-0142',
    'Position: Road agent. Hired 2019. This line is public.',
  ];
  lines.forEach((l, i) => p.drawText(l, { x: 72, y: 700 - i * 30, size: 14, font }));
  return doc.save();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const src = await makeSourcePdf();
  const exe = fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined;
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForFunction(() => window.RSA91A && window.RSA91A.app);
  await page.evaluate(() => window.RSA91A.app.go('studio'));

  // "Scan" the PDF: render page 1 to a PNG in the browser and open that PNG.
  const scanB64 = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const doc = await window.RSA91A.engine.SourceDocument.open(bytes, 'src.pdf', 'application/pdf');
    const canvas = document.createElement('canvas');
    await doc.render(0, canvas, 200 / 72);
    doc.destroy();
    return canvas.toDataURL('image/png').split(',')[1];
  }, Buffer.from(src).toString('base64'));
  fs.writeFileSync(path.join(OUT, 'scan.png'), Buffer.from(scanB64, 'base64'));

  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.RSA91A.studio.open(new File([bytes], 'scan.png', { type: 'image/png' }));
  }, scanB64);
  const textless = await page.evaluate(() => window.RSA91A.studio.state.textless);
  assert.deepStrictEqual(textless, [1], 'image page should have no text layer');

  const t0 = Date.now();
  // Count main-thread timer ticks while OCR runs: a responsive page keeps ticking.
  const { done, ticks, mode } = await page.evaluate(async () => {
    let ticks = 0;
    const iv = setInterval(() => { ticks++; }, 10);
    const done = await window.RSA91A.studio.runOcr();
    clearInterval(iv);
    return { done, ticks, mode: window.RSA91A.ocr.mode };
  });
  const ocrMs = Date.now() - t0;
  assert.strictEqual(done, 1);
  assert.strictEqual(mode, 'worker', 'OCR should run in a worker, got ' + mode);
  console.log('Main-thread ticks during OCR:', ticks, 'over', ocrMs, 'ms');
  assert.ok(ticks > ocrMs / 100, 'main thread was blocked during OCR: ' + ticks + ' ticks in ' + ocrMs + ' ms');
  const pageText = await page.evaluate(async () => (await window.RSA91A.studio.state.doc.pageText(0)).text);
  console.log('OCR took', ocrMs, 'ms. Text:', JSON.stringify(pageText));
  assert.match(pageText, /123-45-6789/, 'OCR missed the SSN');
  assert.match(pageText, /Jane Q+\. Public/, 'OCR missed the name');
  assert.match(pageText, /555-0142/, 'OCR missed the phone');

  const marks = await page.evaluate(async () => {
    const S = window.RSA91A.studio.state;
    S.terms = 'Jane Q. Public';
    S.defaultReason = 'Personal identifiers.';
    await window.RSA91A.studio.scan();
    return S.marks.map((m) => ({ text: m.text, label: m.label, ocr: m.ocr }));
  });
  console.log('Marks:', marks);
  const texts = marks.map((m) => m.text);
  for (const want of ['123-45-6789', '(603) 555-0142']) assert.ok(texts.includes(want), 'detector missed ' + want + ' on OCR text');
  assert.ok(texts.some((t) => /^Jane Q+\. Public$/.test(t)), 'term (exact or near) missed the name: ' + JSON.stringify(texts));
  assert.ok(marks.every((m) => m.ocr && m.label.startsWith('OCR: ')), 'OCR marks should be labeled');

  await page.evaluate(async () => { for (const m of window.RSA91A.studio.state.marks) m.status = 'accepted'; if (!await window.RSA91A.studio.signOff('Test Reviewer')) throw new Error('sign-off refused'); window.RSA91A.studio.render(); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'ocr-review.png') });

  const dlP = page.waitForEvent('download', { timeout: 60000 });
  await page.evaluate(async () => {
    const r = window.RSA91A.store.state.settings.redaction;
    r.batesPrefix = 'OCR-'; r.batesStart = 1; r.dpi = 200; r.bates = true;
    await window.RSA91A.studio.doExport();
  });
  const dl = await dlP;
  const outPath = path.join(OUT, 'ocr-redacted.pdf');
  await dl.saveAs(outPath);
  const report = await page.evaluate(() => window.RSA91A.studio.state.lastExport.report);
  assert.ok(report.pass, 'verification failed');

  // Re-open the redacted output and OCR it: the sensitive strings must be unreadable.
  const outText = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const doc = await window.RSA91A.engine.SourceDocument.open(bytes, 'out.pdf', 'application/pdf');
    await doc.ocrPage(0, 300);
    const t = (await doc.pageText(0)).text;
    doc.destroy();
    return t;
  }, fs.readFileSync(outPath).toString('base64'));
  console.log('OCR of redacted output:', JSON.stringify(outText));
  for (const s of ['123-45-6789', 'Jane', 'Public', '555-0142']) assert.ok(!outText.includes(s), 'redacted output still shows ' + s);
  assert.match(outText, /Road agent/, 'public line should survive');
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    window.RSA91A.studio.state.marks = [];
    await window.RSA91A.studio.open(new File([bytes], 'out.pdf', { type: 'application/pdf' }));
  }, fs.readFileSync(outPath).toString('base64'));
  await page.waitForTimeout(400);
  await page.locator('#page-wrap').screenshot({ path: path.join(OUT, 'ocr-redacted-page.png') });

  await browser.close();
  const real = errors.filter((e) => !/fake worker/i.test(e));
  assert.deepStrictEqual(real, [], 'browser console errors');
  console.log('OCR E2E PASS');
}

main().catch((e) => { console.error('OCR E2E FAIL:', e); process.exit(1); });
