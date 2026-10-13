# RSA91A-Engine product page — NinthStateSoftware.com

Draft v1, 2026-09-30. Copy is ready to paste. Items in [brackets] need your decision or a fact you hold.

---

## Hero

**RSA91A-Engine**

**Right-to-Know requests, tracked. Records, redacted for good.**

Built for New Hampshire town clerks, records custodians, school districts, police departments, newsrooms and the citizens who file requests. Runs on your computer, in your browser. No account, no cloud, no monthly fee.

[Buy now — $PRICE] [Try the free demo] [Watch the 3-minute tour]

---

## The problem

RSA 91-A gives a public body five business days to respond. Miss it and you pay the requester's attorney's fees. Release a record with a Social Security number under a black box that a reader can copy out, and you have a breach. Most towns handle both with a spreadsheet, a PDF viewer and hope.

---

## What RSA91A-Engine does

### Counts the clock so you don't have to
Log a request. The tracker computes the fifth business day, skips weekends and your holiday list, and turns red before you're late. One screen shows every open request, what's due in the next two business days, and what's already past the window.

### Removes what you redact
Every other tool draws a box over the text. RSA91A-Engine rebuilds the page. Each page is rendered to an image, the boxes are burned in, and a new PDF is built from the images alone. The words under the box are gone. So are hidden text, form fields, comments, attachments, scripts and metadata from the original.

Then it checks its own work. The output is reopened and tested for leftover text, every redacted string, annotations, attachments, scripts, bookmarks and metadata. A file that fails is not saved.

### Reads scans
Most town records are scans, and a scan is a picture. Built-in OCR turns the picture into text on your computer, so the scanner below works on scanned pages too. It even tolerates the character misreads OCR makes when matching names you list.

### Handles the whole request at once
A request is rarely one file. Open them all, scan them all with the same terms, review file by file, and export one production: one Bates sequence across every file, one redaction log, one zip. OCR runs in the background, so you keep working while scans are read.

### Finds the sensitive stuff first
The scanner proposes redactions for Social Security and taxpayer ID numbers, bank and card numbers, phone numbers, emails, dates of birth, home addresses and any names or terms you list. It also reads filled-in form fields. Every hit is a proposal. A person accepts or rejects each one, draws boxes by hand, and withholds whole pages when needed.

### Puts the exemption on the record
Each redaction carries the exemption relied on and a stated reason. Export a redaction log the requester can read, with page and Bates numbers, that never repeats the withheld content. Keep an internal audit log with file fingerprints for your own records.

### Writes the letters
Acknowledgment with a time estimate. Production cover letter. Denial with reasons, pulled straight from your redaction log. For requesters: the request itself and the follow-up when the window has passed. Edit, then send as text or PDF. Logging a letter as sent stops the clock on the tracker.

---

## Who it's for

| You are | You get |
|---|---|
| A town or city clerk | The 5-day tracker, letters on your letterhead, and redactions that hold up |
| A school district or police records office | Personnel and investigative files redacted with the exemption printed on each box |
| A newsroom or citizen requester | A log of every request you've sent, and a follow-up letter the day the window closes |
| Counsel for a public body | A Vaughn-style redaction log and an audit trail with SHA-256 hashes |

---

## Built for New Hampshire

- Cites RSA 91-A:4 and RSA 91-A:5 by paragraph, checked against New Hampshire Supreme Court opinions through 2025.
- Add your own citations for other statutes that make records confidential.
- Every citation carries a reminder to confirm current text at gc.nh.gov. Statutes change; this software tells you to check.

---

## Your data stays yours

RSA91A-Engine runs entirely in your web browser from files on your computer. It makes no network connections. Nothing you type, open or redact ever leaves your machine. There is no account to create and nothing for us to lose.

---

## Plain answers

**Is the redacted PDF searchable?**
No. Every page is an image. That is the cost of guaranteed removal. You keep the original for your own search.

**Can it read scanned documents?**
Yes. Built-in OCR turns a scanned page into searchable text on your computer, so the same automatic detection runs on scans. OCR is not perfect, so the app labels those marks and asks you to review scanned pages by eye too. English only.

**Does it give legal advice?**
No. It drafts documents and applies redactions you choose. Whether an exemption applies is your call, or your lawyer's.

**What does it run on?**
Windows, Mac or Linux, in Chrome, Edge or Firefox. Unzip and open. No install.

**How do I back up?**
One button in Settings downloads everything. The app reminds you weekly.

---

## Pricing

[Choose and fill in. Suggested structure:]

| | Single user | Organization |
|---|---|---|
| Price | $[ ] one-time | $[ ] one-time |
| Users | 1 person, 2 computers | Everyone at one public body, firm or newsroom |
| Updates | [1 year included] | [1 year included] |
| Support | Email | Email, priority |

[Decide: one-time vs. annual; whether the demo is time-limited or feature-limited.]

---

## Footer

RSA91A-Engine is a product of Ninth State Software [VERIFY entity name], [city], New Hampshire. Not affiliated with the State of New Hampshire. RSA91A-Engine drafts documents and applies user-selected redactions; it does not provide legal advice.

© 2026 Ninth State Software. [License terms] · [Privacy] · [Contact]

---

## Notes for building the page

- Screenshots: use `screenshots/1_requests.png` through `5_citations.png` from the repo. They contain sample data only.
- Facts in this copy I did not verify and you should before publishing: the attorney's-fee consequence is real (RSA 91-A:8, I, as quoted in *Brandano v. SAU 16*, N.H. Nov. 3, 2023), but the phrase "you pay the requester's attorney's fees" is a simplification. The statute requires the court to find the lawsuit was necessary and that the body knew or should have known it was violating the chapter. Consider softening to "and you can be liable for the requester's attorney's fees."
- No pricing, refund or support commitments are asserted anywhere in the software. Whatever you publish here becomes the contract; match Section 9 of LICENSE.txt to it.
- Do not claim certification, endorsement or compliance with any state guidance. None exists for this product.
