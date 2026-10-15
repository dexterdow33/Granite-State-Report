# RSA91A-Engine

Software for New Hampshire Right-to-Know requests under RSA chapter 91-A. It tracks requests, drafts letters and redacts PDFs securely. It runs entirely offline in a web browser: no install, no server, no account, and no data leaves the computer.

Sold by Ninth State Software (NinthStateSoftware.com).

## What it does

**Request tracker**
- Logs every request, whether you are sending it or answering it.
- Counts the 5-business-day response window under RSA 91-A:4, IV. Weekends and a holiday list you edit are skipped.
- Dashboard of open requests, requests due within 2 business days, and requests past the window with no response.
- CSV export, plus a JSON backup and restore.

**Redaction Studio (secure redaction engine)**
- Opens PDF, PNG and JPEG files.
- Automatic detection of:
  - SSNs and ITINs
  - payment cards (Luhn-checked)
  - bank routing numbers (ABA-checked)
  - account numbers
  - phone numbers and email addresses
  - dates of birth
  - street addresses, IP addresses and any numeric date (these three are opt-in)
- Custom name and term lists, and custom regular-expression patterns.
- Every detection is a proposal. A reviewer accepts or rejects each one and can draw boxes by hand.
- Each redaction carries an exemption citation and a stated reason.
- You can withhold an entire page; it is replaced with a slip sheet that shows the exemption.
- Bates numbering, and optional exemption labels printed on each box.
- **True removal.** Every page is rendered to an image, the boxes are burned into the image, and a new PDF is built from the images alone. None of the following survives from the original: text, fonts, hidden or white text, form fields, comments, attachments, scripts, bookmarks, layers or metadata.
- **Self-verification.** After export, the engine re-opens its own output and checks:
  - page count
  - text layer (only Bates stamps allowed)
  - every redacted string
  - annotations, attachments, scripts and bookmarks
  - metadata

  A file that fails any check is not saved.
- **Offline OCR for scans.** Pages with no text layer (scans, photos, faxes) can be read with a built-in OCR engine (Tesseract, WebAssembly, English model included). The scanner then runs on the OCR text, and on those pages it also accepts near matches of your terms, because OCR misreads characters. Marks from OCR pages are labeled so reviewers look harder. The engine loads on first use, about 12 MB from the app's own files; nothing is downloaded. It runs in a web worker, so the screen stays responsive while pages are read.
- **Request shelf.** Files opened while a request is linked are kept on that request's shelf, in the browser's own database, with their marks, withheld pages and sign-off. Close the app, come back next week, click "Open files" on the request, and everything is where you left it. Files can be removed from the shelf; deleting a request clears its shelf.
- **Sign-off.** Each file must be signed off by name before it can be exported, and only once every mark has a decision. The sign-off records who, when, an optional note, and a fingerprint of the marks; if any mark changes afterward the sign-off goes stale and must be redone. Reviewer names appear in the redaction log, the manifest, the audit CSV and the production record.
- **Batch productions.** Open several files at once (or add files to an open batch). Each file keeps its own marks; "Scan all files" OCRs and scans every file with the same settings; "Next to review" walks through every file. One export redacts every file in one Bates sequence and downloads a production zip: one redacted PDF per file, a combined redaction log, a manifest with hashes, and optionally one merged PDF. The internal audit log downloads separately so it cannot be sent by mistake. The production is recorded on the linked request and feeds the production and denial letters.
- Warns when a page has no text layer and offers OCR; those pages still deserve a review by eye.
- **Public redaction log (PDF).** A Vaughn-style index listing each redaction's page or Bates number, scope, exemption and reason. It never reproduces the withheld content.
- **Internal audit log (CSV).** Includes the covered text, the detector used, and SHA-256 hashes of the source and output files for chain of custody.
- Save and reload a review session.

**Letters**
- Requester side: the initial request, and a follow-up when the window has passed.
- Agency side: acknowledgment with a time estimate, a production cover letter, and a denial with reasons.
- Production and denial letters pull exemptions and reasons from the last redacted production.
- Output as editable text, .txt or PDF.
- "Log as sent" marks the request as answered on the tracker.

**Citation library**
- The built-in entries are limited to provisions checked against New Hampshire Supreme Court opinions (see below).
- Users can add their own citations. These are marked "user-added" everywhere they appear.

## Running it

Unzip and open `index.html` in Chrome, Edge or Firefox. That's it.

## Legal content and its sources

The built-in citations cover RSA 91-A:4, I, I-a, IV(a), IV(b), IV (copy costs), V and VI; RSA 91-A:5, IV and XII; and RSA 91-A:8, I. Each was checked against the statutory text quoted in New Hampshire Supreme Court opinions, and each entry names its source and the statute edition that source cites:

- *Union Leader Corp. v. N.H. Dep't of Safety*, 2024 N.H. 35: RSA 91-A:4, I (2023).
- *Colquhoun v. City of Nashua*, No. 2021-0253 (Oct. 26, 2022): RSA 91-A:4, IV(a) (Supp. 2021).
- *Brandano v. Superintendent of SAU 16*, No. 2022-0084 (order, Nov. 3, 2023): RSA 91-A:4, IV(b) and RSA 91-A:8, I (2023).
- *Stone v. City of Claremont*, 2024 N.H. 11: RSA 91-A:4, VI (2023); cites IV(a)-(c).
- *Michaud v. Town of Campton Police Dep't*, 2024 N.H. 19, and *Keene Publishing Corp. v. Fall Mountain Regional School District*, 2025 N.H. 35: RSA 91-A:4, I-a and RSA 91-A:5, IV and XII (2023).
- *Taylor v. School Administrative Unit #55*, No. 2016-0702 (Sept. 21, 2017): RSA 91-A:4, IV and V (Supp. 2016). Paragraph IV was later divided into lettered subparagraphs. Two entries rest on this older text and are marked **not confirmed** in the app: the copy-cost sentences (paragraph IV, subparagraph unknown) and paragraph V.

The primary statute site, gc.nh.gov, was not reachable from the build environment, so no entry was checked against the statute page itself. Statutes change. The app tells users to confirm current text at gc.nh.gov before relying on any citation. **RSA91A-Engine is a drafting and redaction tool, not legal advice.**

RSA 91-A:4, IV(b) says "within 5 business days" and does not define how to count. By default the day after receipt is business day 1; users can change this in Settings. The built-in holiday helper adds U.S. federal holidays only. New Hampshire state and municipal calendars differ, and the app says so.

## Development

The browser tests include an OCR run: a page is rasterized to an image, OCR'd, redacted and exported, then the output is OCR'd to show the identifiers are unreadable.

```
npm install          # dev dependencies only (pdf.js, pdf-lib, Playwright for tests)
npm run vendor       # copy browser builds into js/vendor (already committed)
npm test             # unit tests: deadlines, detectors, text geometry, letters
npm run test:e2e     # headless Chromium: scan, redact, export, leak check, UI, OCR, batch, shelf
npm run build        # dist/RSA91A-Engine-<version>.zip for sale/download
```

Layout:

```
index.html            app shell
css/app.css           styles (light and dark)
js/core/              pure logic, also loaded by Node tests
  deadlines.js        business-day math, federal holiday helper
  detectors.js        sensitive-data detectors
  citations.js        citation library with sources
  letters.js          letter templates
  textmap.js          maps text matches to page rectangles
  zip.js              ZIP writer for production bundles
js/app/               browser UI
  ocr.js              offline OCR (Tesseract WebAssembly in a self-contained worker)
  redaction-engine.js rasterize, burn in, rebuild, verify, log PDF, OCR text layer
  studio.js           Redaction Studio (batch, shelf, sign-off)
  filestore.js        IndexedDB wrapper for shelf files and review state
  shelf.js            request shelf: add, list, remove, load, save review, sign-off fingerprint
  tracker.js          request tracker
  letters-ui.js       letter drafting
  settings-ui.js      settings, citations, guide
js/vendor/            pdf.js 3.11.174 (Apache-2.0), pdf-lib 1.17.1 (MIT),
                      Tesseract core 6.1.2 and eng.traineddata (Apache-2.0) and
                      zlib.js gunzip (MIT), each vendored as a JavaScript string so
                      the OCR worker can be built from a Blob under file://;
                      wasm-feature-detect (Apache-2.0)
```

## Known limits

- The redacted output is not text-searchable, because every page is an image. That is the price of guaranteed removal. OCR is not included.
- OCR is imperfect. It misses and misreads words, especially on poor scans, handwriting and small print. Treat its marks as a first pass and review OCR pages by eye. Only English is included.
- Requests and settings are stored in the browser's local storage; shelf files and their review state in the browser's IndexedDB. The JSON backup covers requests, settings and the shelf summary, not the shelf files themselves. Users should download backups and keep their own originals; the app reminds them weekly. Private windows and blocked site data make the shelf unavailable; the app says so.
- Password-protected PDFs must be unlocked before opening.
