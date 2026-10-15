const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const zip = require('../../js/core/zip.js');

test('crc32 matches the reference value for "123456789"', () => {
  assert.strictEqual(zip.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});

test('archive round-trips through Python zipfile', () => {
  const bytes = zip.build([
    { name: 'a/first.txt', data: 'hello zip' },
    { name: 'second.bin', data: new Uint8Array([0, 1, 2, 255, 254]) },
  ]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsa91a-zip-'));
  const file = path.join(dir, 't.zip');
  fs.writeFileSync(file, bytes);
  const out = execFileSync('python3', ['-I', '-c', `
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
print(z.testzip())
print(z.read('a/first.txt').decode())
print(list(z.read('second.bin')))
`, file]).toString();
  assert.strictEqual(out.trim().split('\n')[0], 'None');
  assert.strictEqual(out.trim().split('\n')[1], 'hello zip');
  assert.strictEqual(out.trim().split('\n')[2], '[0, 1, 2, 255, 254]');
});
