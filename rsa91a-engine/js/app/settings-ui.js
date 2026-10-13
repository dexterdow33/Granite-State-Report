/* RSA91A-Engine: settings, citation library, and help views. */
(function (root) {
  'use strict';
  const NS = root.RSA91A;
  const { h, $, clear, toast, download, pickFile, formDialog, confirmDialog } = NS.ui;
  const { store, deadlines, citations } = NS;

  function renderSettings() {
    const host = $('#view-settings');
    clear(host);
    const s = store.state.settings;
    const p = s.profile;
    const text = (label, key, obj, type) => h('label', {}, h('span', {}, label),
      h('input', { type: type || 'text', value: obj[key] || '', oninput: (e) => { obj[key] = e.target.value; store.save(); } }));
    const addr = h('textarea', { rows: 3, oninput: (e) => { p.address = e.target.value; store.save(); } });
    addr.value = p.address || '';
    const hol = h('textarea', { rows: 8, class: 'mono', placeholder: 'YYYY-MM-DD, one per line' });
    hol.value = (s.holidays || []).join('\n');
    hol.addEventListener('change', () => {
      const lines = hol.value.split('\n').map((l) => l.trim().slice(0, 10)).filter(Boolean);
      const bad = lines.filter((l) => { try { deadlines.parseISO(l); return false; } catch (e) { return true; } });
      if (bad.length) return toast('Not valid dates: ' + bad.join(', '), 'error');
      s.holidays = [...new Set(lines)].sort();
      store.save();
      toast('Holidays saved (' + s.holidays.length + ').', 'ok');
    });
    const yearInput = h('input', { type: 'number', value: new Date().getFullYear(), min: 2000, max: 2100, style: 'width:6em' });

    host.appendChild(h('div', { class: 'toolbar' }, h('h1', {}, 'Settings')));
    host.appendChild(h('div', { class: 'cols' },
      h('section', { class: 'panel' },
        h('h3', {}, 'Letterhead and signature'),
        h('p', { class: 'help' }, 'Used in every letter. Leave blank what you do not want printed.'),
        text('Organization', 'orgName', p), h('label', {}, h('span', {}, 'Address'), addr),
        text('Phone', 'phone', p), text('Email', 'email', p, 'email'),
        text('Signer name', 'signerName', p), text('Signer title', 'signerTitle', p),
        text('Request ID prefix', 'idPrefix', s)),
      h('section', { class: 'panel' },
        h('h3', {}, 'Business-day calendar'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.countReceiptDay, onchange: (e) => { s.countReceiptDay = e.target.checked; store.save(); } }),
          ' Count the day of receipt as business day 1'),
        h('p', { class: 'help' }, 'Off (default): the day after receipt is day 1. RSA 91-A:4, IV(b) says "within 5 business days" of the request and does not define the count. Pick the reading your office or counsel uses.'),
        h('label', {}, h('span', {}, 'Holidays (skipped when counting)'), hol),
        h('div', { class: 'row' }, yearInput,
          h('button', { class: 'small', onclick: () => {
            const y = Number(yearInput.value);
            const add = deadlines.federalHolidays(y).map((x) => x.date);
            s.holidays = [...new Set((s.holidays || []).concat(add))].sort();
            store.save(); renderSettings(); toast('Added ' + add.length + ' U.S. federal holidays for ' + y + '.', 'ok');
          } }, 'Add U.S. federal holidays')),
        h('p', { class: 'alert warn' }, 'New Hampshire state and municipal holiday calendars differ from the federal list. Check the list against the agency\'s own calendar and add or remove dates.')),
      h('section', { class: 'panel' },
        h('h3', {}, 'Data and backup'),
        h('p', {}, 'All data stays in this browser on this computer. Nothing is sent anywhere.'),
        !store.storageOk ? h('p', { class: 'alert bad' }, 'Browser storage is unavailable here (private window or blocked site data). Your work will be lost when you close this tab unless you download a backup.') : null,
        h('p', { class: 'help' }, 'Last backup: ' + (store.state.lastBackup ? store.state.lastBackup.replace('T', ' ').slice(0, 16) : 'never')),
        h('div', { class: 'row wrap' },
          h('button', { class: 'primary', onclick: () => { download(store.exportJSON(), 'RSA91A_Backup_' + deadlines.todayISO() + '.json', 'application/json'); renderSettings(); } }, 'Download backup'),
          h('button', { class: 'ghost', onclick: async () => {
            const f = await pickFile('application/json,.json');
            if (!f) return;
            if (!await confirmDialog('Restoring replaces all requests and settings in this browser with the backup. Continue?', 'Restore')) return;
            try { store.importJSON(await f.text()); toast('Backup restored.', 'ok'); NS.app.go('requests'); } catch (e) { toast(e.message, 'error'); }
          } }, 'Restore from backup')))));
  }

  function renderCitations() {
    const host = $('#view-citations');
    clear(host);
    const all = citations.all(store.state.userCitations);
    host.appendChild(h('div', { class: 'toolbar' }, h('h1', {}, 'Citation library'), h('div', { class: 'spacer' }),
      h('button', { class: 'primary', onclick: addCitation }, 'Add a citation')));
    host.appendChild(h('p', { class: 'alert' }, citations.VERIFY_NOTE));
    for (const c of all) {
      const src = c.userSupplied ? 'User-added. Not checked by RSA91A-Engine.' : (c.unconfirmed ? 'NOT CONFIRMED against a post-2021 edition. Source: ' : 'Checked against: ') + c.source.split(',').map((k) => citations.SOURCES[k.trim()]).join('; ');
      host.appendChild(h('article', { class: 'cite-card' + (c.userSupplied ? ' user' : '') + (c.unconfirmed ? ' unconfirmed' : '') },
        h('div', { class: 'row' }, h('h3', {}, c.cite), h('span', { class: 'tag' }, c.kind), h('div', { class: 'spacer' }),
          c.userSupplied ? h('button', { class: 'small danger', onclick: async () => {
            if (!await confirmDialog('Remove ' + c.cite + '?', 'Remove')) return;
            store.state.userCitations = store.state.userCitations.filter((x) => x.id !== c.id); store.save(); renderCitations();
          } }, 'Remove') : null),
        h('p', { class: 'title' }, c.title),
        h('p', {}, c.summary),
        h('p', { class: 'help' }, src)));
    }
  }

  async function addCitation() {
    const v = await formDialog('Add a citation', [
      { name: 'cite', label: 'Citation (as it should print)', required: true, help: 'Example: a paragraph of RSA 91-A:5 not in the built-in list, or another statute that makes a record confidential.' },
      { name: 'title', label: 'Short title', required: true },
      { name: 'summary', label: 'What it covers (your words or quoted text you have checked)', type: 'textarea', rows: 4 },
      { name: 'kind', label: 'Type', type: 'select', value: 'exemption', options: [{ value: 'exemption', label: 'Exemption / confidentiality' }, { value: 'access', label: 'Access or procedure' }] },
    ], 'Add');
    if (!v) return;
    v.id = 'user-' + Date.now();
    store.state.userCitations.push(v);
    store.save();
    renderCitations();
    toast('Added ' + v.cite + '. It is marked user-added everywhere it appears.', 'ok');
  }

  function renderHelp() {
    const host = $('#view-help');
    if (host.dataset.built) return;
    host.dataset.built = '1';
    const sec = (title, ...body) => h('section', { class: 'panel' }, h('h3', {}, title), ...body.map((b) => typeof b === 'string' ? h('p', {}, b) : b));
    host.appendChild(h('div', { class: 'toolbar' }, h('h1', {}, 'Guide')));
    host.appendChild(h('div', { class: 'cols' },
      sec('Workflow',
        h('ol', {},
          h('li', {}, 'Log the request under Requests. The tracker shows the 5-business-day window under RSA 91-A:4, IV(b).'),
          h('li', {}, 'Open every file for the request in the Redaction Studio at once. Each file keeps its own marks; one export numbers them all in one Bates sequence.'),
          h('li', {}, 'If the records are not ready, draft an Acknowledgment with a time estimate and log it as sent.'),
          h('li', {}, 'Open each record in the Redaction Studio, linked to the request. Scan, review every proposed mark, add boxes by hand, pick the exemption and state the reason.'),
          h('li', {}, 'Export. The engine rebuilds the file and verifies it. Only a passing file is saved.'),
          h('li', {}, 'Download the redaction log for the requester, and keep the internal audit log.'),
          h('li', {}, 'Draft the Production or Denial letter; it pulls exemptions and reasons from the last export.'))),
      sec('How the redaction works',
        'Each page is rendered to an image, the accepted boxes are painted into the image, and a new PDF is built from the images alone. The words under a box are not hidden; they are gone. Fonts, hidden text, form fields, comments, attachments, scripts, bookmarks, layers, and metadata from the original do not carry over.',
        'After export the engine opens its own output and checks: page count, no text beyond Bates stamps, none of the redacted strings, no annotations, no attachments, no scripts, no bookmarks, and no author or XMP metadata. If any check fails, the file is not saved.',
        'Trade-off: the output is not text-searchable, and files are larger than the original. 200 dpi JPEG is a good default; use 300 dpi PNG for fine print or exhibits.'),
      sec('OCR for scanned pages',
        'A scan is a picture. The scanner cannot read it until OCR turns the picture into text. The Studio offers OCR whenever a page has no text layer; the engine runs on your computer, in the browser, and sends nothing anywhere. On OCR pages the scanner also accepts near matches of your terms, because OCR often misreads a character or two, and every mark from an OCR page is labeled "OCR:".',
        'The OCR text is used only to find and place redactions. It is never written into the output file. OCR runs in the background, so you can keep reviewing while pages are read.'),
      sec('Batch productions',
        'A request usually covers several records. Open them together (pick several files, or add files to an open batch). "Scan all files" runs OCR where needed and the detectors on every file with the same terms and settings. "Next to review" moves through the files in order. Switch files from the list in the sidebar; each keeps its own marks and withheld pages.',
        'Export production writes one Bates sequence across the files in the order listed, then downloads a zip holding one redacted PDF per file, a single redaction log, a manifest with SHA-256 hashes, and, if you ask, one combined PDF. The internal audit log, which contains the covered text, downloads as a separate file: keep it, never send it.'),
      sec('Limits you need to know',
        h('ul', {},
          h('li', {}, 'Automatic detection reads the PDF text layer. Scanned pages have none; the Studio lists them and offers OCR. OCR misses and misreads words, so review those pages by eye as well. Only English is included.'),
          h('li', {}, 'Detectors miss things and flag things that are not sensitive. They are a first pass for a human reviewer, never a substitute.'),
          h('li', {}, 'Password-protected PDFs must be unlocked in the program that created them before opening.'),
          h('li', {}, 'Data lives in this browser. Download a backup regularly (Settings).'))),
      sec('Legal note',
        'RSA91A-Engine drafts documents and applies the redactions you choose. It does not decide what the law requires and is not legal advice. Exemptions are construed narrowly and the withholding body bears the burden of justifying each one. Confirm the current text of every cited provision at gc.nh.gov, and consult counsel on close calls.')));
  }

  NS.settingsUi = { renderSettings, renderCitations, renderHelp };
})(typeof self !== 'undefined' ? self : this);
