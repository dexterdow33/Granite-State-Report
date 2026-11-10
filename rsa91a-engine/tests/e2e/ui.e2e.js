// Click-through of the UI with real clicks and form fills; fails on any console error.
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { chromium } = require('playwright');

(async () => {
  const OUT = path.join(__dirname, 'out');
  fs.mkdirSync(OUT, { recursive: true });
  const exe = require('./browser-path.js');
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', '..', 'index.html'));

  await page.click('text=Log the first request');
  await page.fill('#f-requesterName', 'Alex Reporter');
  await page.fill('#f-agency', 'Town of Example Select Board');
  await page.fill('#f-receivedDate', '2026-09-21');
  await page.fill('#f-description', 'Invoices paid to Example Paving LLC, January 1 - June 30, 2026.');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('table.grid tbody tr');
  const badge = await page.textContent('table.grid .badge');
  assert.strictEqual(badge.trim(), 'Past 5-day window');
  await page.screenshot({ path: path.join(OUT, 'ui-tracker.png') });

  await page.click('table.grid button:has-text("Letter")');
  await page.selectOption('#view-letters select >> nth=1', 'acknowledgment');
  await page.click('text=Draft letter');
  const text = await page.inputValue('textarea.letter');
  assert.match(text, /RSA 91-A:4, IV/);
  const dlP = page.waitForEvent('download');
  await page.click('text=Download PDF');
  const dl = await dlP;
  assert.match(dl.suggestedFilename(), /^RSA91A_acknowledgment_RTK-/);
  await page.click('text=Log as sent');
  await page.click('nav [data-view=requests]');
  assert.strictEqual((await page.textContent('table.grid .badge')).trim(), 'Answered late');

  for (const v of ['citations', 'settings', 'help', 'studio']) {
    await page.click('nav [data-view=' + v + ']');
    await page.waitForTimeout(100);
  }
  await page.click('nav [data-view=settings]');
  await page.click('text=Add U.S. federal holidays');
  const hol = await page.inputValue('#view-settings textarea.mono');
  assert.ok(hol.includes('-11-26'), 'Thanksgiving added');
  await page.screenshot({ path: path.join(OUT, 'ui-settings.png') });
  await page.click('nav [data-view=citations]');
  await page.screenshot({ path: path.join(OUT, 'ui-citations.png'), fullPage: true });

  await browser.close();
  const real = errors.filter((e) => !/fake worker/i.test(e));
  assert.deepStrictEqual(real, []);
  console.log('UI E2E PASS');
})().catch((e) => { console.error('UI E2E FAIL:', e); process.exit(1); });
