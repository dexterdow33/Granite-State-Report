// Copies the third-party browser builds into js/vendor so the app runs offline
// with no install step. Run after `npm install`.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'js', 'vendor');
fs.mkdirSync(out, { recursive: true });

const files = [
  ['node_modules/pdfjs-dist/build/pdf.min.js', 'pdf.min.js'],
  ['node_modules/pdfjs-dist/build/pdf.worker.min.js', 'pdf.worker.min.js'],
  ['node_modules/pdfjs-dist/LICENSE', 'LICENSE-pdfjs.txt'],
  ['node_modules/pdf-lib/dist/pdf-lib.min.js', 'pdf-lib.min.js'],
  ['node_modules/pdf-lib/LICENSE.md', 'LICENSE-pdf-lib.txt'],
];

for (const [src, dest] of files) {
  fs.copyFileSync(path.join(root, src), path.join(out, dest));
  console.log('vendored', dest);
}

// OCR: the engine must run inside a web worker, and the app opens from
// file://, where a worker can neither import scripts nor fetch. So the core
// (WebAssembly embedded as base64), the gunzip and the English model are all
// vendored as JavaScript *strings*; ocr.js joins them into one Blob and starts
// the worker from it. The same strings feed the main-thread fallback.
const asString = (src, name) => 'window.RSA91A_OCR_SRC = window.RSA91A_OCR_SRC || {};\n' +
  'window.RSA91A_OCR_SRC[' + JSON.stringify(name) + '] = ' + JSON.stringify(fs.readFileSync(path.join(root, src), 'utf8')) + ';\n';
const ocrSources = [
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'coreSimd', 'tesseract-core-simd-lstm.src.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'core', 'tesseract-core-lstm.src.js'],
  ['node_modules/zlibjs/bin/gunzip.min.js', 'gunzip', 'gunzip.src.js'],
];
for (const [src, name, dest] of ocrSources) {
  fs.writeFileSync(path.join(out, dest), asString(src, name));
  console.log('vendored', dest, '(as string)');
}
for (const [src, dest] of [
  ['node_modules/tesseract.js-core/LICENSE', 'LICENSE-tesseract.js-core.txt'],
  ['node_modules/zlibjs/LICENSE', 'LICENSE-zlibjs.txt'],
  ['node_modules/wasm-feature-detect/dist/umd/index.js', 'wasm-feature-detect.js'],
]) {
  fs.copyFileSync(path.join(root, src), path.join(out, dest));
  console.log('vendored', dest);
}
const gz = fs.readFileSync(path.join(root, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'));
fs.writeFileSync(path.join(out, 'eng.traineddata.js'),
  '// eng.traineddata (tesseract_best int8 LSTM), gzip, base64. Source: @tesseract.js-data/eng 4.0.0_best_int.\n' +
  'window.RSA91A_TESSDATA = window.RSA91A_TESSDATA || {};\n' +
  'window.RSA91A_TESSDATA.eng = "' + gz.toString('base64') + '";\n');
console.log('vendored eng.traineddata.js', Math.round(gz.length / 1024), 'KB gz');
for (const stale of ['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js', 'gunzip.min.js']) {
  const f = path.join(out, stale);
  if (fs.existsSync(f)) { fs.unlinkSync(f); console.log('removed', stale); }
}
