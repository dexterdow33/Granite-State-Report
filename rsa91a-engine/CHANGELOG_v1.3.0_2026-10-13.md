# RSA91A-Engine 1.3.0 change note (2026-10-13)

## New
- **Request shelf.** Files opened in the Redaction Studio while a request is linked stay on that request's shelf between sessions, in the browser's own database (IndexedDB), with marks, withheld pages, OCR confidence and sign-off. The Requests table gets a Files column and an "Open files" button. Remove a file from the shelf at any time; deleting a request deletes its files. A duplicate file (same SHA-256) is not stored twice. Auto-shelving can be switched off per browser.
- **Sign-off before export.** Each file must be signed off by name (optional note) once every proposed mark has a decision. The sign-off carries a fingerprint of the accepted marks and withheld pages; change a mark and it goes stale. Export, single or batch, refuses any file without a current sign-off. Reviewer name and time appear in the public redaction log, the manifest, the internal audit CSV and the production record on the request.

## Changed
- Studio sidebar sections renumbered: 6 is Sign-off, 7 is Export.
- Settings shows shelf storage usage and says the JSON backup does not contain shelf files.
- Guide and README describe the shelf and sign-off.

## Tests
- Unit: 28 pass. Browser: redaction, UI, OCR, batch and new shelf test pass.

## Not done, needs you
- The private repo dexterdow33/rsa91a-engine does not exist yet, so the move is still a bundle you push yourself (see MOVE_TO_PRIVATE_REPO.md).
- RSA 91-A:4 paragraphs IV (copy-cost subparagraph) and V still unconfirmed against gc.nh.gov; the app marks both.
