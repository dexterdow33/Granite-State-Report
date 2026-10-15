const test = require('node:test');
const assert = require('node:assert');
const det = require('../../js/core/detectors.js');

const found = (text, ids) => det.scan(text, ids).map((m) => text.slice(m.start, m.end));

test('SSN/ITIN: formatted numbers found, never-issued ranges skipped', () => {
  assert.deepStrictEqual(found('SSN 123-45-6789 and 000-12-3456 and 666-12-3456 and 123-00-4567, ITIN 912-78-5678', ['ssn']), ['123-45-6789', '912-78-5678']);
});

test('card numbers must pass Luhn', () => {
  assert.deepStrictEqual(found('Visa 4111 1111 1111 1111; bad 4111 1111 1111 1112', ['card']), ['4111 1111 1111 1111']);
});

test('routing numbers need context and a valid checksum', () => {
  assert.deepStrictEqual(found('Routing: 011000015', ['routing']), ['011000015']);
  assert.deepStrictEqual(found('Invoice 011000015', ['routing']), []);
  assert.deepStrictEqual(found('Routing: 011000016', ['routing']), []);
});

test('account numbers after a keyword', () => {
  assert.deepStrictEqual(found('Acct #: 55-1234-99', ['account']), ['55-1234-99']);
});

test('phone and email', () => {
  assert.deepStrictEqual(found('Call (603) 555-0142 or 603.555.0199, mail jane.doe@example.org', ['phone', 'email']),
    ['(603) 555-0142', '603.555.0199', 'jane.doe@example.org']);
});

test('DOB only near a birth keyword', () => {
  assert.deepStrictEqual(found('DOB: 04/12/1981. Meeting 05/01/2026.', ['dob']), ['04/12/1981']);
});

test('street address', () => {
  assert.deepStrictEqual(found('Lives at 42 Pleasant Street, Concord', ['address']), ['42 Pleasant Street']);
});

test('terms are whole-word and case-insensitive', () => {
  const text = 'John Smith met JOHN  SMITH; Smithson is different.';
  const m = det.scanTerms(text, ['john smith', 'Smith']);
  const got = m.map((x) => text.slice(x.start, x.end));
  assert.deepStrictEqual(got.sort(), ['JOHN  SMITH', 'John Smith', 'SMITH', 'Smith'].sort());
});

test('fuzzy terms tolerate OCR misreads but respect word boundaries', () => {
  const text = 'Name: Jane QQ. Public. Address 42 Pleasant St. Mr Smithson and Jane Q Pub1ic attended.';
  const got = det.scanTermsFuzzy(text, ['Jane Q. Public', 'Smith', 'Q.']).map((m) => text.slice(m.start, m.end));
  assert.deepStrictEqual(got, ['Jane QQ. Public', 'Jane Q Pub1ic']);
  assert.deepStrictEqual(det.scanTermsFuzzy('exact Jane Q. Public here', ['Jane Q. Public']).map((m) => m.label), ['Term (near match, 0 edits): Jane Q. Public']);
});

test('custom regex and zero-length safety', () => {
  const text = 'Case 216-2026-CV-00123 filed';
  assert.deepStrictEqual(det.scanRegex(text, '\\d{3}-\\d{4}-CV-\\d{5}').map((m) => text.slice(m.start, m.end)), ['216-2026-CV-00123']);
  assert.deepStrictEqual(det.scanRegex('abc', 'x*'), []);
});
