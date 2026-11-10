# Third-party notices

RSA91A-Engine includes the following open-source components, unmodified, in `js/vendor/`.
Both licenses permit use in commercial, closed-source products provided these notices are kept.

| Component | Version | License | File |
|---|---|---|---|
| PDF.js (pdfjs-dist), Mozilla Foundation | 3.11.174 | Apache License 2.0 | `js/vendor/LICENSE-pdfjs.txt` |
| pdf-lib, Andrew Dillon | 1.17.1 | MIT | `js/vendor/LICENSE-pdf-lib.txt` |
| tesseract.js-core (Tesseract OCR compiled to WebAssembly), tesseract.js contributors | 6.1.2 | Apache License 2.0 | `js/vendor/LICENSE-tesseract.js-core.txt` |
| English OCR model `eng.traineddata` (tessdata_best, int8), from the @tesseract.js-data/eng package 1.0.0 | 4.0.0_best_int | Apache License 2.0 (tesseract-ocr/tessdata_best); package MIT | `js/vendor/LICENSE-tesseract.js-core.txt` (same Apache 2.0 text) |
| zlib.js gunzip, imaya | 0.3.1 | MIT | `js/vendor/LICENSE-zlibjs.txt` |
| wasm-feature-detect, Google LLC | 1.8.0 | Apache License 2.0 | `js/vendor/LICENSE-tesseract.js-core.txt` (same Apache 2.0 text) |

The OCR components are loaded only when a user runs OCR. Nothing is downloaded at run time; every file ships in `js/vendor/`. The Tesseract core, the model and the gunzip are stored as JavaScript strings (`*.src.js`, `eng.traineddata.js`) and assembled into a web worker at run time; their contents are unmodified.
