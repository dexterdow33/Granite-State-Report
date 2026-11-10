const test = require('node:test');
const assert = require('node:assert');
const L = require('../../js/core/letters.js');
const C = require('../../js/core/citations.js');

const settings = { holidays: [], profile: { signerName: 'Pat Example', orgName: 'Example Org', phone: '555-0100' } };
const req = { id: 'RTK-2026-0001', agency: 'Town of Example', receivedDate: '2026-09-28', description: 'All invoices from Vendor X, 2025.', requesterName: 'Pat Example' };

test('request letter states the 5-business-day date and cites only library provisions', () => {
  const t = L.request(req, settings);
  assert.match(t, /October 5, 2026/);
  assert.match(t, /RSA 91-A:4, IV\(b\)/);
  const cited = new Set((t.match(/RSA 91-A:\d+, [IVXL]+(?:-a)?(?:\([a-z]\))?/g) || []));
  const known = new Set(C.CITATIONS.map((c) => c.cite));
  for (const c of cited) assert.ok(known.has(c), 'unknown citation in template: ' + c);
});

test('no template invents a media-requester category', () => {
  for (const tpl of L.TEMPLATES) {
    const t = tpl.fn(req, settings, { entries: [{ citationId: '91-A:5,IV', reason: 'r' }] });
    assert.doesNotMatch(t, /media requ/i);
  }
});

test('denial lists each exemption with its reason', () => {
  const t = L.denial(req, settings, { entries: [
    { citationId: '91-A:5,XII', description: 'Memo from town counsel, 3/2/2025', reason: 'Legal advice to the select board.' },
    { citationId: '91-A:5,IV', pages: '4-5', reason: 'Employee home address.' },
  ] });
  assert.match(t, /RSA 91-A:4, IV\(b\)\(2\)/);
  assert.match(t, /RSA 91-A:5, XII \(Attorney-client/);
  assert.match(t, /Memo from town counsel, 3\/2\/2025: Legal advice/);
  assert.match(t, /Page\(s\) 4-5: Employee home address/);
});

test('user citations cannot overwrite built-ins', () => {
  const all = C.all([{ id: '91-A:5,IV', cite: 'FAKE' }, { id: 'local-1', cite: 'Local Rule 1' }]);
  assert.strictEqual(all.find((c) => c.id === '91-A:5,IV').cite, 'RSA 91-A:5, IV');
  assert.ok(all.find((c) => c.id === 'local-1').userSupplied);
});

test('every citation in every template is in the library', () => {
  const known = new Set(C.CITATIONS.map((c) => c.cite));
  const opts = { entries: [{ citationId: '91-A:5,IV', reason: 'r' }], fee: '$1.00', costEstimate: '300 e-mails x $0.50 = $150.00' };
  for (const tpl of L.TEMPLATES) {
    const t = tpl.fn(req, settings, opts);
    for (const c of (t.match(/RSA 91-A:\d+, [IVXL]+(?:-a)?(?:\([a-z]\))?/g) || [])) {
      assert.ok(known.has(c), tpl.id + ' cites a provision not in the library: ' + c);
    }
  }
});

test('denial cites RSA 91-A:4, IV(c); copy costs cite IV(d)', () => {
  assert.match(L.denial(req, settings, { entries: [] }), /RSA 91-A:4, IV\(c\) requires/);
  assert.match(L.production(req, settings, { entries: [], fee: '$2.00' }), /RSA 91-A:4, IV\(d\)/);
  assert.match(L.request(req, settings), /RSA 91-A:4, IV\(d\)/);
});

test('acknowledgment carries the itemized estimate only when one is given', () => {
  const withEst = L.acknowledgment(req, settings, { estimateDate: '2026-10-20', reason: 'Volume', costEstimate: '300 e-mails x $0.50 = $150.00' });
  assert.match(withEst, /Itemized estimate of the cost of making the records available \(RSA 91-A:4, IV\(b\)\(3\) and VIII\):\n300 e-mails/);
  const without = L.acknowledgment(req, settings, { estimateDate: '2026-10-20', reason: 'Volume' });
  assert.doesNotMatch(without, /Itemized estimate/);
});

test('RSA 91-A:4 entries rest on the current statute text and none is unconfirmed', () => {
  const four = C.CITATIONS.filter((c) => c.cite.startsWith('RSA 91-A:4'));
  assert.ok(four.length >= 10);
  for (const c of four) {
    assert.ok(!c.unconfirmed, c.cite + ' is still marked unconfirmed');
    assert.ok(c.source.split(',').map((s) => s.trim()).includes('GC'), c.cite + ' lacks the statute source');
  }
  assert.ok(C.byId('91-A:4,IV(d)'));
  assert.strictEqual(C.byId('91-A:4,IV'), null);
});

test('paragraph IX is described as a fee waiver, not an access tier', () => {
  const ix = C.byId('91-A:4,IX');
  assert.strictEqual(ix.kind, 'fees');
  assert.match(ix.summary, /creates no separate right of access/);
});
