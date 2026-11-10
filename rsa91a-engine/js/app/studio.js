/* RSA91A-Engine: Redaction Studio view. */
(function (root) {
  'use strict';
  const NS = root.RSA91A;
  const { h, $, clear, toast, download, readFile, pickFile, confirmDialog, csv } = NS.ui;
  const { store, detectors, citations, deadlines, engine, zip, shelf, filestore } = NS;

  /*
   * A batch is a list of document entries. The fields on S that describe the
   * current document (doc, marks, withheld, ...) are views of docs[cur];
   * stash() writes them back and restore(i) loads another entry. Exports
   * number pages across the whole batch in one Bates sequence.
   */
  const S = {
    docs: [],
    cur: -1,
    doc: null,
    page: 0,
    zoom: 1,
    viewport: null,
    marks: [],
    withheld: new Map(),
    selected: null,
    nextId: 1,
    requestId: '',
    defaultCitation: '91-A:5,IV',
    defaultReason: '',
    detectorIds: new Set(detectors.DETECTORS.filter((d) => d.defaultOn).map((d) => d.id)),
    terms: '',
    regex: '',
    textless: [],
    annotated: [],
    ocrConf: {},
    reviewed: null,
    shelfId: null,
    busy: false,
    preview: false,
    lastExport: null,
    lastBatch: null,
    mergeOutput: false,
    renderToken: 0,
    shelfOk: null,
    saveTimers: new Map(),
  };

  const DOC_FIELDS = ['doc', 'page', 'marks', 'withheld', 'selected', 'nextId', 'textless', 'annotated', 'ocrConf', 'lastExport', 'reviewed', 'shelfId'];
  const exemptionOptions = () => citations.exemptions(store.state.userCitations);
  const citeOf = (id) => {
    const c = citations.byId(id, store.state.userCitations);
    return c ? c.cite : '';
  };

  // ---------- documents and batch ----------

  function stash() {
    if (S.cur < 0 || !S.docs[S.cur]) return;
    const e = S.docs[S.cur];
    for (const k of DOC_FIELDS) e[k] = S[k];
    persistEntry(e);
  }

  /** Saves a shelf file's review state (marks, withheld pages, sign-off), debounced per file. */
  function persistEntry(e, immediate) {
    if (!e || !e.shelfId || !S.requestId) return Promise.resolve();
    const write = () => shelf.saveReview(S.requestId, e.shelfId, {
      marks: e.marks, withheld: [...e.withheld], reviewed: e.reviewed || null, ocrConf: e.ocrConf || {},
    }).then(() => { e.savedAt = new Date().toISOString(); }).catch((err) => console.warn('Shelf save failed:', err));
    if (immediate) { clearTimeout(S.saveTimers.get(e.shelfId)); S.saveTimers.delete(e.shelfId); return write(); }
    clearTimeout(S.saveTimers.get(e.shelfId));
    S.saveTimers.set(e.shelfId, setTimeout(write, 600));
    return Promise.resolve();
  }

  async function persistAll() {
    stash();
    for (const e of S.docs) await persistEntry(e, true);
  }

  function restore(i) {
    const e = S.docs[i];
    S.cur = i;
    for (const k of DOC_FIELDS) S[k] = e[k];
  }

  function emptyEntry(doc) {
    return { doc, name: doc.fileName, page: 0, marks: [], withheld: new Map(), selected: null, nextId: 1, textless: [], annotated: [], ocrConf: {}, lastExport: null, reviewed: null, shelfId: null, bytes: null, mime: '' };
  }

  /** First page index of entry i within the batch Bates sequence. */
  function pageOffset(i) {
    let n = 0;
    for (let k = 0; k < i; k++) n += S.docs[k].doc.numPages;
    return n;
  }

  function totalPages() {
    return S.docs.reduce((a, e) => a + e.doc.numPages, 0);
  }

  function mimeOf(file) {
    return file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
  }

  /**
   * Opens one file or several. Several files form a batch (or extend one when
   * opts.append is set). Each document keeps its own marks; export numbers all
   * of them in one Bates sequence.
   */
  async function open(files, opts) {
    const list = (Array.isArray(files) || (files && typeof files.length === 'number' && !(files instanceof File))) ? Array.from(files) : (files ? [files] : []);
    const good = list.filter((f) => ['application/pdf', 'image/png', 'image/jpeg'].includes(mimeOf(f)));
    if (!good.length) return toast('Open PDF, PNG, or JPEG files.', 'error');
    if (good.length < list.length) toast((list.length - good.length) + ' file(s) skipped: not PDF, PNG, or JPEG.', 'warn');
    const items = [];
    for (const f of good) items.push({ name: f.name, mime: mimeOf(f), bytes: new Uint8Array(await readFile(f)) });
    return openItems(items, opts);
  }

  /** Opens every file on the linked request's shelf (or the given ids), restoring review state. */
  async function openFromShelf(ids, opts) {
    if (!S.requestId) return toast('Link a request first.', 'error');
    const items = [];
    try {
      const files = await shelf.list(S.requestId);
      const wanted = ids ? files.filter((f) => ids.includes(f.id)) : files;
      if (!wanted.length) return toast('Nothing on the shelf for this request.', 'info');
      setBusy('Loading from shelf...');
      for (const f of wanted) {
        const { file, review } = await shelf.load(f.id);
        items.push({ name: file.name, mime: file.mime, bytes: file.bytes, shelfId: file.id, sha256: file.sha256, review });
      }
    } catch (e) {
      setBusy(null);
      return toast('Shelf unavailable: ' + e.message, 'error');
    }
    // Skip files already open in this batch.
    const openIds = new Set(S.docs.map((e) => e.shelfId).filter(Boolean));
    const fresh = items.filter((it) => !openIds.has(it.shelfId));
    if (!fresh.length) { setBusy(null); return toast('Those files are already open.', 'info'); }
    return openItems(fresh, Object.assign({ append: S.docs.length > 0 }, opts || {}, { fromShelf: true }));
  }

  /**
   * items: [{ name, mime, bytes, shelfId?, sha256?, review? }]. Several items
   * form a batch (or extend one with opts.append).
   */
  async function openItems(good, opts) {
    const append = !!(opts && opts.append) && S.docs.length;
    if (!append) {
      stash();
      const unsaved = S.docs.some((e) => e.marks.length);
      if (unsaved && !await confirmDialog('Close the current document(s)? Unsaved redaction marks will be lost unless you saved the session.', 'Open new files')) return;
      for (const e of S.docs) e.doc.destroy();
      S.docs = [];
      S.cur = -1;
      S.lastBatch = null;
    } else {
      stash();
    }
    let opened = 0;
    const added = [];
    try {
      for (const [k, item] of good.entries()) {
        setBusy('Opening ' + item.name + (good.length > 1 ? ' (' + (k + 1) + ' of ' + good.length + ')' : '') + '...');
        const doc = await engine.SourceDocument.open(item.bytes.slice(), item.name, item.mime);
        const e = emptyEntry(doc);
        e.bytes = item.bytes;
        e.mime = item.mime;
        e.shelfId = item.shelfId || null;
        for (let i = 0; i < doc.numPages; i++) {
          if (!await doc.hasText(i)) e.textless.push(i + 1);
          if ((await doc.annotations(i)).length) e.annotated.push(i + 1);
        }
        if (item.review) {
          e.marks = item.review.marks || [];
          e.withheld = new Map(item.review.withheld || []);
          e.reviewed = item.review.reviewed || null;
          e.nextId = e.marks.reduce((a, m) => Math.max(a, m.id), 0) + 1;
        }
        S.docs.push(e);
        added.push(e);
        opened++;
      }
      restore(append ? S.docs.length - opened : 0);
      await fitWidth();
      // Files opened while a request is linked go on its shelf, so they are
      // still there next time, with whatever review happens later.
      if (S.requestId && !(opts && opts.fromShelf) && store.state.settings.shelfAuto !== false) await shelveEntries(added, true);
      renderSidebar();
      const pages = totalPages();
      toast('Opened ' + opened + ' file' + (opened === 1 ? '' : 's') + ' (' + pages + ' page' + (pages === 1 ? '' : 's') + ')' + (opts && opts.fromShelf ? ' from the shelf' : ''), 'ok');
    } catch (e) {
      console.error(e);
      toast('Could not open file: ' + e.message, 'error');
      if (S.cur < 0 && S.docs.length) { restore(0); await fitWidth(); }
      renderSidebar();
    } finally {
      setBusy(null);
    }
  }

  async function activate(i) {
    if (i === S.cur || !S.docs[i]) return;
    stash();
    restore(i);
    await fitWidth();
    renderSidebar();
  }

  /** Puts open files (that are not yet on it) onto the linked request's shelf. */
  async function shelveEntries(entries, quiet) {
    if (!S.requestId) return toast('Link a request first.', 'error');
    stash();
    const todo = (entries || S.docs).filter((e) => !e.shelfId && e.bytes);
    if (!todo.length) { if (!quiet) toast('Every open file is already on the shelf.', 'info'); return; }
    try {
      const recs = await shelf.add(S.requestId, todo.map((e) => ({
        name: e.doc.fileName, mime: e.mime, bytes: e.bytes,
        review: { marks: e.marks, withheld: [...e.withheld], reviewed: e.reviewed || null, ocrConf: e.ocrConf || {} },
      })));
      recs.forEach((r, k) => { todo[k].shelfId = r.id; if (r.duplicate) { todo[k].reviewed = todo[k].reviewed || null; } });
      if (S.cur >= 0) S.shelfId = S.docs[S.cur].shelfId;
      S.shelfOk = true;
      if (!quiet) toast(todo.length + ' file(s) kept on the shelf for ' + S.requestId + '.', 'ok');
      else toast('Kept on the shelf for ' + S.requestId + '.', 'info');
    } catch (e) {
      S.shelfOk = false;
      console.warn(e);
      toast('Could not keep files on the shelf: ' + e.message, 'warn');
    }
    renderSidebar();
  }

  /** True when the file's sign-off still matches its marks. */
  function reviewValid(e) {
    return !!(e.reviewed && e.reviewed.fingerprint === shelf.fingerprint(e.marks, e.withheld));
  }

  /** Signs off the current file. Refuses while proposed marks remain. */
  async function signOff(by, note) {
    if (!S.doc) return false;
    const proposed = S.marks.filter((m) => m.status === 'proposed').length;
    if (proposed) { toast(proposed + ' mark(s) still need a decision. Accept or reject each one before signing off.', 'error'); return false; }
    const name = String(by || '').trim();
    if (!name) { toast('Enter the reviewer\'s name.', 'error'); return false; }
    S.reviewed = { by: name, at: new Date().toISOString(), note: String(note || '').trim(), fingerprint: shelf.fingerprint(S.marks, S.withheld),
      accepted: S.marks.filter((m) => m.status === 'accepted').length, withheld: S.withheld.size, pages: S.doc.numPages };
    store.state.settings.reviewerName = name;
    store.save();
    stash();
    await persistEntry(S.docs[S.cur], true);
    renderSidebar();
    toast('Signed off: ' + S.doc.fileName + ' by ' + name + '.', 'ok');
    return true;
  }

  function clearSignOff() {
    S.reviewed = null;
    stash();
    renderSidebar();
  }

  function setBusy(msg) {
    S.busy = !!msg;
    const el = $('#studio-busy');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  // ---------- page rendering ----------

  async function renderPage() {
    const wrap = $('#page-wrap');
    if (!wrap || !S.doc) return;
    const token = ++S.renderToken;
    const canvas = $('#page-canvas');
    const dpr = window.devicePixelRatio || 1;
    const page = await S.doc.page(S.page);
    const vp = page.getViewport({ scale: S.zoom });
    const tmp = document.createElement('canvas');
    await S.doc.render(S.page, tmp, S.zoom * dpr);
    if (token !== S.renderToken) return;
    canvas.width = tmp.width;
    canvas.height = tmp.height;
    canvas.getContext('2d').drawImage(tmp, 0, 0);
    canvas.style.width = vp.width + 'px';
    canvas.style.height = vp.height + 'px';
    wrap.style.width = vp.width + 'px';
    wrap.style.height = vp.height + 'px';
    S.viewport = vp;
    drawOverlay();
    updatePager();
  }

  function drawOverlay() {
    const ov = $('#page-overlay');
    if (!ov || !S.viewport) return;
    clear(ov);
    if (S.withheld.has(S.page)) {
      const w = S.withheld.get(S.page);
      ov.appendChild(h('div', { class: 'withheld-cover' }, h('strong', {}, 'PAGE WITHHELD IN FULL'), h('span', {}, citeOf(w.citationId)), h('span', {}, w.reason || '')));
    }
    for (const m of S.marks) {
      if (m.page !== S.page || m.status === 'rejected') continue;
      for (const r of m.rects) {
        const [x0, y0, x1, y1] = engine.toViewportRect(S.viewport, r);
        const el = h('div', {
          class: 'mark ' + m.status + (S.selected === m.id ? ' selected' : '') + (S.preview ? ' preview' : ''),
          style: `left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px`,
          title: (m.label || 'Manual box') + (m.text ? ': ' + m.text : '') + ' [' + (citeOf(m.citationId) || 'no exemption') + ']',
          dataset: { id: String(m.id) },
        });
        el.addEventListener('mousedown', (e) => { e.stopPropagation(); select(m.id); });
        el.addEventListener('dblclick', (e) => { e.stopPropagation(); toggle(m); });
        ov.appendChild(el);
      }
    }
  }

  function updatePager() {
    const p = $('#pager-label');
    if (p && S.doc) {
      const b = batesFor(S.page);
      p.textContent = (S.docs.length > 1 ? 'File ' + (S.cur + 1) + ' of ' + S.docs.length + ' · ' : '') + 'Page ' + (S.page + 1) + ' of ' + S.doc.numPages + (b ? ' · ' + b : '');
    }
    const z = $('#zoom-label');
    if (z) z.textContent = Math.round(S.zoom * 100) + '%';
  }

  async function goPage(i) {
    if (!S.doc) return;
    S.page = Math.max(0, Math.min(S.doc.numPages - 1, i));
    await renderPage();
    renderMarkList();
    renderPageTools();
  }

  async function fitWidth() {
    if (!S.doc) return;
    const page = await S.doc.page(S.page);
    const vp = page.getViewport({ scale: 1 });
    const avail = ($('#viewer') ? $('#viewer').clientWidth : 900) - 48;
    S.zoom = Math.max(0.3, Math.min(3, avail / vp.width));
    await renderPage();
  }

  // ---------- drawing manual boxes ----------

  function attachDrawing() {
    const ov = $('#page-overlay');
    let start = null;
    let rubber = null;
    const pos = (e) => {
      const b = ov.getBoundingClientRect();
      return [e.clientX - b.left, e.clientY - b.top];
    };
    ov.addEventListener('mousedown', (e) => {
      if (!S.doc || e.button !== 0) return;
      start = pos(e);
      rubber = h('div', { class: 'rubber' });
      ov.appendChild(rubber);
      select(null);
    });
    window.addEventListener('mousemove', (e) => {
      if (!start) return;
      const [x, y] = pos(e);
      Object.assign(rubber.style, {
        left: Math.min(x, start[0]) + 'px', top: Math.min(y, start[1]) + 'px',
        width: Math.abs(x - start[0]) + 'px', height: Math.abs(y - start[1]) + 'px',
      });
    });
    window.addEventListener('mouseup', async (e) => {
      if (!start) return;
      const [x, y] = pos(e);
      const s = start;
      start = null;
      rubber.remove();
      if (Math.abs(x - s[0]) < 4 || Math.abs(y - s[1]) < 4) return;
      const p0 = S.viewport.convertToPdfPoint(s[0], s[1]);
      const p1 = S.viewport.convertToPdfPoint(x, y);
      const rect = engine.normRect([p0[0], p0[1], p1[0], p1[1]]);
      const text = await S.doc.textUnder(S.page, rect);
      addMarks([{ page: S.page, rects: [rect], text, type: 'manual', label: 'Manual box' }], 'accepted', 'manual');
    });
  }

  // ---------- marks ----------

  function addMarksTo(entry, list, status, source) {
    let added = 0;
    for (const m of list) {
      const dup = entry.marks.find((x) => x.page === m.page && x.status !== 'rejected' &&
        JSON.stringify(x.rects) === JSON.stringify(m.rects));
      if (dup) continue;
      entry.marks.push(Object.assign({
        id: entry.nextId++, status, source, citationId: S.defaultCitation, reason: S.defaultReason, created: new Date().toISOString(),
      }, m));
      added++;
    }
    return added;
  }

  function addMarks(list, status, source) {
    const added = addMarksTo(S, list, status, source);
    drawOverlay();
    renderMarkList();
    return added;
  }

  function select(id) {
    S.selected = id;
    drawOverlay();
    renderMarkList();
    if (id !== null) {
      const row = document.querySelector('.mark-row[data-id="' + id + '"]');
      if (row) row.scrollIntoView({ block: 'nearest' });
    }
  }

  function toggle(m) {
    m.status = m.status === 'accepted' ? 'proposed' : 'accepted';
    drawOverlay();
    renderMarkList();
  }

  function removeMark(id) {
    S.marks = S.marks.filter((m) => m.id !== id);
    if (S.selected === id) S.selected = null;
    drawOverlay();
    renderMarkList();
  }

  function bulk(status, pageOnly) {
    for (const m of S.marks) {
      if (m.status !== 'proposed') continue;
      if (pageOnly && m.page !== S.page) continue;
      m.status = status;
    }
    drawOverlay();
    renderMarkList();
  }

  // ---------- OCR and scanning ----------

  /** OCR every page of `entry` that still has no text. Returns pages processed. */
  async function runOcrFor(entry, label) {
    const todo = await entry.doc.textlessPages();
    if (!todo.length) return 0;
    let done = 0;
    for (const i of todo) {
      const where = (label ? label + ' ' : '') + 'page ' + (i + 1) + ' of ' + entry.doc.numPages;
      const r = await entry.doc.ocrPage(i, 300, (msg) => setBusy(msg || ('OCR ' + where + '...')));
      setBusy('OCR ' + where + '...');
      entry.ocrConf[i] = r.meanConf;
      done++;
    }
    entry.textless = (await entry.doc.textlessPages()).map((i) => i + 1);
    return done;
  }

  async function runOcr() {
    if (!S.doc) return 0;
    setBusy('Preparing OCR...');
    let done = 0;
    try {
      done = await runOcrFor(S);
      renderSidebar();
      if (done) toast('OCR read ' + done + ' page(s). OCR misses and misreads words; review those pages by eye.', 'warn');
    } catch (e) {
      console.error(e);
      toast('OCR failed: ' + e.message, 'error');
    } finally {
      setBusy(null);
    }
    return done;
  }

  function scanOptions() {
    const regexes = [];
    if (S.regex.trim()) {
      new RegExp(S.regex); // throws on a bad pattern
      regexes.push({ source: S.regex.trim(), flags: 'gi' });
    }
    return { detectorIds: Array.from(S.detectorIds), terms: S.terms.split('\n').map((t) => t.trim()).filter(Boolean), regexes };
  }

  async function scanFor(entry, opts, label) {
    const found = await entry.doc.scan(opts, (i, n) => setBusy('Scanning ' + (label ? label + ' ' : '') + 'page ' + i + ' of ' + n + '...'));
    return addMarksTo(entry, found, 'proposed', 'auto');
  }

  async function scan() {
    if (!S.doc) return toast('Open a document first.', 'error');
    if (S.textless.length && await confirmDialog(S.textless.length + ' page(s) have no text layer, so the scanner cannot read them. Run OCR on those pages first? (The OCR engine loads once, about 12 MB, and stays offline.)', 'Run OCR')) {
      await runOcr();
    }
    let opts;
    try { opts = scanOptions(); } catch (e) { return toast('Custom pattern is not a valid regular expression: ' + e.message, 'error'); }
    setBusy('Scanning...');
    try {
      const added = await scanFor(S, opts);
      drawOverlay();
      renderMarkList();
      toast(added + ' new proposed redaction' + (added === 1 ? '' : 's') + ' found. Review each one before export.', added ? 'ok' : 'info');
      if (S.textless.length) toast(S.textless.length + ' page(s) have no text layer. Check them by eye and draw boxes by hand.', 'warn');
    } catch (e) {
      console.error(e);
      toast('Scan failed: ' + e.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  /** OCR (where needed) and scan every document in the batch with the current settings. */
  async function scanAll() {
    if (!S.docs.length) return;
    stash();
    let opts;
    try { opts = scanOptions(); } catch (e) { return toast('Custom pattern is not a valid regular expression: ' + e.message, 'error'); }
    const textless = S.docs.reduce((a, e) => a + e.textless.length, 0);
    let doOcr = false;
    if (textless) doOcr = await confirmDialog(textless + ' page(s) across the batch have no text layer. Run OCR on them first?', 'Run OCR');
    let added = 0;
    try {
      for (const [k, e] of S.docs.entries()) {
        const label = 'file ' + (k + 1) + '/' + S.docs.length;
        if (doOcr) await runOcrFor(e, label);
        added += await scanFor(e, opts, label);
      }
      restore(S.cur);
      renderSidebar();
      drawOverlay();
      toast(added + ' new proposed redaction' + (added === 1 ? '' : 's') + ' across ' + S.docs.length + ' files. Review every file before export.', added ? 'ok' : 'info');
    } catch (e) {
      console.error(e);
      toast('Batch scan failed: ' + e.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  // ---------- sidebar ----------

  function citationSelect(value, onchange) {
    return h('select', { onchange: (e) => onchange(e.target.value) },
      exemptionOptions().map((c) => h('option', { value: c.id, selected: c.id === value ? true : null }, c.cite + (c.userSupplied ? ' (user-added)' : ''))));
  }

  function entrySummary(e) {
    const counts = { proposed: 0, accepted: 0 };
    for (const m of e.marks) if (counts[m.status] !== undefined) counts[m.status]++;
    const bits = [e.doc.numPages + ' p.'];
    if (counts.proposed) bits.push(counts.proposed + ' to review');
    if (counts.accepted) bits.push(counts.accepted + ' accepted');
    if (e.withheld.size) bits.push(e.withheld.size + ' withheld');
    if (e.textless.length) bits.push(e.textless.length + ' no text');
    if (e.lastExport) bits.push(e.lastExport.report.pass ? 'exported' : 'FAILED');
    return bits.join(', ');
  }

  function batchSection() {
    stash();
    const r = store.state.settings.redaction;
    const list = h('div', { class: 'doc-list batch-list' }, S.docs.map((e, i) => {
      const proposed = e.marks.filter((m) => m.status === 'proposed').length;
      const b0 = r.bates === false ? null : engine.batesLabel(r.batesPrefix, (r.batesStart || 1) + pageOffset(i), r.batesDigits || 6);
      return h('div', { class: 'doc-row' + (i === S.cur ? ' current' : '') + (proposed ? ' pending' : ''), onclick: () => activate(i) },
        h('div', { class: 'doc-name' }, (i + 1) + '. ' + e.name),
        h('div', { class: 'doc-sub' }, entrySummary(e) + (b0 ? ' · ' + b0 : '')),
        h('button', { class: 'small danger', title: 'Remove from batch', onclick: async (ev) => {
          ev.stopPropagation();
          if (!await confirmDialog('Remove ' + e.name + (e.marks.length ? ' and its ' + e.marks.length + ' marks' : '') + ' from the batch?', 'Remove')) return;
          e.doc.destroy();
          S.docs.splice(i, 1);
          if (!S.docs.length) { S.cur = -1; for (const k of DOC_FIELDS) S[k] = emptyEntry({ fileName: '', numPages: 0 })[k]; S.doc = null; renderSidebar(); return; }
          S.cur = -1;
          restore(Math.min(i, S.docs.length - 1));
          await fitWidth();
          renderSidebar();
        } }, 'x'));
    }));
    const pending = S.docs.reduce((a, e) => a + e.marks.filter((m) => m.status === 'proposed').length, 0);
    return h('section', {},
      h('h3', {}, 'Batch: ' + S.docs.length + ' files, ' + totalPages() + ' pages'),
      list,
      h('div', { class: 'row wrap' },
        h('button', { class: 'small', onclick: scanAll }, 'Scan all files'),
        h('button', { class: 'small ghost', onclick: async () => open(await pickFile('application/pdf,image/png,image/jpeg', true), { append: true }) }, 'Add files'),
        h('button', { class: 'small', disabled: S.cur <= 0, onclick: () => activate(S.cur - 1) }, 'Prev file'),
        h('button', { class: 'small', disabled: S.cur >= S.docs.length - 1, onclick: () => activate(S.cur + 1) }, 'Next file')),
      h('p', { class: 'help' }, 'One Bates sequence runs across the files in this order. ' + (pending ? pending + ' mark(s) still need review.' : 'All marks reviewed.')));
  }

  function renderSidebar() {
    const sb = $('#studio-sidebar');
    if (!sb) return;
    clear(sb);
    const reqs = store.state.requests;

    sb.appendChild(h('section', {},
      h('h3', {}, '1. Document' + (S.docs.length > 1 ? 's' : '')),
      h('div', { class: 'row wrap' },
        h('button', { class: 'primary', onclick: async () => open(await pickFile('application/pdf,image/png,image/jpeg', true)) }, S.doc ? 'Open other files' : 'Open PDF or image files'),
        S.doc ? h('button', { class: 'ghost', onclick: async () => open(await pickFile('application/pdf,image/png,image/jpeg', true), { append: true }) }, 'Add to batch') : null),
      S.doc ? h('dl', { class: 'meta' },
        h('dt', {}, 'File'), h('dd', {}, S.doc.fileName),
        h('dt', {}, 'Pages'), h('dd', {}, String(S.doc.numPages)),
        h('dt', {}, 'SHA-256'), h('dd', { class: 'mono small', title: S.doc.sha256 }, S.doc.sha256.slice(0, 16) + '...')) : h('p', { class: 'help' }, 'Pick one file, or several to redact as one production. Or drag files onto the page area.'),
      (S.annotated || []).length ? h('p', { class: 'alert warn' }, 'Form fields or comments on page(s) ' + S.annotated.join(', ') + '. Their visible content is printed into the output; the scan checks their values, but review them by eye.') : null,
      S.textless.length ? h('div', { class: 'alert warn' },
        h('p', {}, 'No text layer on page(s) ' + S.textless.join(', ') + '. These are likely scans. Run OCR so the scanner can read them, then still review those pages by eye.'),
        h('button', { class: 'small', onclick: () => runOcr() }, 'Run OCR on ' + S.textless.length + ' page(s)')) : null,
      Object.keys(S.ocrConf || {}).length ? h('p', { class: 'help' }, 'OCR text on page(s) ' + Object.keys(S.ocrConf).map((k) => (Number(k) + 1) + ' (' + Math.round(S.ocrConf[k]) + '% confidence)').join(', ') + '. Marks from OCR pages are labeled "OCR:".') : null,
      h('label', {}, h('span', {}, 'Linked request'),
        h('select', { onchange: (e) => { S.requestId = e.target.value; } },
          h('option', { value: '' }, 'None'),
          reqs.map((r) => h('option', { value: r.id, selected: r.id === S.requestId ? true : null }, r.id + ' - ' + (r.requesterName || r.agency || '')))))));

    if (S.requestId) sb.appendChild(shelfSection());
    if (S.docs.length > 1) sb.appendChild(batchSection());

    const detList = h('div', { class: 'checks' }, detectors.DETECTORS.map((d) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: S.detectorIds.has(d.id), onchange: (e) => { if (e.target.checked) S.detectorIds.add(d.id); else S.detectorIds.delete(d.id); } }),
      ' ' + d.label)));
    const terms = h('textarea', { rows: 4, placeholder: 'One per line: names, case numbers, addresses...' });
    terms.value = S.terms;
    terms.addEventListener('input', (e) => { S.terms = e.target.value; });
    sb.appendChild(h('section', {},
      h('h3', {}, '2. Find sensitive information'),
      detList,
      h('label', {}, h('span', {}, 'Names and terms'), terms),
      h('label', {}, h('span', {}, 'Custom pattern (regular expression)'),
        h('input', { type: 'text', value: S.regex, placeholder: 'e.g. \\d{3}-\\d{4}-CV-\\d{5}', oninput: (e) => { S.regex = e.target.value; } })),
      h('div', { class: 'row wrap' },
        h('button', { class: 'primary', disabled: !S.doc, onclick: scan }, S.docs.length > 1 ? 'Scan this file' : 'Scan document'),
        S.docs.length > 1 ? h('button', { class: 'primary', onclick: scanAll }, 'Scan all files') : null),
      h('p', { class: 'help' }, 'Detectors propose. Nothing is redacted until you accept it. Draw a box on the page to redact anything by hand.')));

    const reason = h('textarea', { rows: 2, placeholder: 'Why the exemption applies (required in a written denial)' });
    reason.value = S.defaultReason;
    reason.addEventListener('input', (e) => { S.defaultReason = e.target.value; });
    const cite = citations.byId(S.defaultCitation, store.state.userCitations);
    sb.appendChild(h('section', {},
      h('h3', {}, '3. Default exemption for new marks'),
      citationSelect(S.defaultCitation, (v) => { S.defaultCitation = v; renderSidebar(); }),
      cite ? h('p', { class: 'help' }, cite.summary) : null,
      cite && cite.balancing ? h('p', { class: 'help strong' }, 'Balancing test applies. For each redaction, record the privacy interest, the public interest in disclosure, and why nondisclosure outweighs it.') : null,
      reason,
      h('button', { class: 'ghost small', onclick: () => {
        let n = 0;
        for (const m of S.marks) if (m.status !== 'rejected') { m.citationId = S.defaultCitation; m.reason = S.defaultReason; n++; }
        renderMarkList(); drawOverlay(); toast('Applied to ' + n + ' marks.');
      } }, 'Apply to all marks in this file')));

    sb.appendChild(h('section', {}, h('h3', {}, '4. Review marks'), h('div', { id: 'mark-list' })));
    sb.appendChild(h('section', {}, h('h3', {}, '5. This page'), h('div', { id: 'page-tools' })));
    sb.appendChild(signOffSection());
    sb.appendChild(exportSection());
    renderMarkList();
    renderPageTools();
    updatePager();
  }

  function shelfSection() {
    const req = store.getRequest(S.requestId);
    const files = (req && req.shelf) || [];
    const openIds = new Set(S.docs.map((e) => e.shelfId).filter(Boolean));
    const unshelved = S.docs.filter((e) => !e.shelfId && e.bytes).length;
    const list = h('div', { class: 'doc-list shelf-list' }, files.map((f) => h('div', { class: 'doc-row' + (openIds.has(f.id) ? ' current' : '') },
      h('div', { class: 'doc-name' }, f.name),
      h('div', { class: 'doc-sub' }, Math.round(f.size / 1024) + ' KB · ' + (f.marks || 0) + ' marks · ' + (f.reviewed ? 'signed off by ' + f.reviewed.by : 'not signed off') + (openIds.has(f.id) ? ' · open' : '')),
      h('div', { class: 'doc-actions' },
        openIds.has(f.id) ? null : h('button', { class: 'small', onclick: () => openFromShelf([f.id]) }, 'Open'),
        h('button', { class: 'small danger', title: 'Remove from shelf', onclick: async () => {
          if (!await confirmDialog('Remove ' + f.name + ' from the shelf for ' + S.requestId + '? Its saved marks and sign-off go with it.', 'Remove')) return;
          try { await shelf.remove(S.requestId, f.id); for (const e of S.docs) if (e.shelfId === f.id) e.shelfId = null; if (S.cur >= 0) S.shelfId = S.docs[S.cur].shelfId; } catch (e) { toast('Could not remove: ' + e.message, 'error'); }
          renderSidebar();
        } }, 'x')))));
    return h('section', {},
      h('h3', {}, 'Shelf for ' + S.requestId + ' (' + files.length + ' file' + (files.length === 1 ? '' : 's') + ')'),
      files.length ? list : h('p', { class: 'help' }, 'No files on the shelf yet. Files you open while this request is linked are kept here, with their marks and sign-off, until you remove them.'),
      h('div', { class: 'row wrap' },
        files.some((f) => !openIds.has(f.id)) ? h('button', { class: 'small', onclick: () => openFromShelf() }, 'Open all') : null,
        unshelved ? h('button', { class: 'small', onclick: () => shelveEntries() }, 'Keep ' + unshelved + ' open file(s) on the shelf') : null),
      h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: store.state.settings.shelfAuto !== false, onchange: (e) => { store.state.settings.shelfAuto = e.target.checked; store.save(); } }), ' Keep files I open on this request\'s shelf'),
      S.shelfOk === false ? h('p', { class: 'alert warn' }, 'File storage is unavailable in this browser here (private window, or site data blocked). Files will not be kept between sessions.') : null);
  }

  function signOffSection() {
    if (!S.doc) return h('section', {}, h('h3', {}, '6. Sign-off'), h('p', { class: 'help' }, 'Open a document.'));
    const proposed = S.marks.filter((m) => m.status === 'proposed').length;
    const valid = reviewValid(S);
    const stale = S.reviewed && !valid;
    const nameInput = h('input', { type: 'text', placeholder: 'Reviewer name', value: store.state.settings.reviewerName || store.state.settings.profile.signerName || '' });
    const noteInput = h('input', { type: 'text', placeholder: 'Note (optional)' });
    const status = valid
      ? h('p', { class: 'alert ok' }, 'Signed off by ' + S.reviewed.by + ' on ' + S.reviewed.at.replace('T', ' ').slice(0, 16) + ' (' + S.reviewed.accepted + ' redaction(s), ' + S.reviewed.withheld + ' page(s) withheld)' + (S.reviewed.note ? ' · ' + S.reviewed.note : ''))
      : stale
        ? h('p', { class: 'alert warn' }, 'Sign-off by ' + S.reviewed.by + ' is stale: the marks changed since. Review and sign off again.')
        : h('p', { class: 'help' }, proposed ? proposed + ' mark(s) still need a decision before this file can be signed off.' : 'Every mark has a decision. Sign off to allow export.');
    return h('section', {},
      h('h3', {}, '6. Sign-off' + (S.docs.length > 1 ? ' (this file)' : '')),
      status,
      valid ? h('button', { class: 'small ghost', onclick: clearSignOff }, 'Withdraw sign-off') : h('div', {},
        h('div', { class: 'grid2' }, h('label', {}, h('span', {}, 'Reviewed by'), nameInput), h('label', {}, h('span', {}, 'Note'), noteInput)),
        h('button', { class: 'primary', disabled: proposed > 0, onclick: () => signOff(nameInput.value, noteInput.value) }, 'Sign off this file')),
      h('p', { class: 'help' }, 'Export needs a current sign-off on every file. Changing any mark after signing makes the sign-off stale. The name and time go in the redaction log and the audit trail.'));
  }

  function renderMarkList() {
    const host = $('#mark-list');
    if (!host) return;
    clear(host);
    const counts = { proposed: 0, accepted: 0, rejected: 0 };
    for (const m of S.marks) counts[m.status]++;
    host.appendChild(h('p', { class: 'counts' },
      h('span', { class: 'pill proposed' }, counts.proposed + ' to review'),
      h('span', { class: 'pill accepted' }, counts.accepted + ' accepted'),
      h('span', { class: 'pill rejected' }, counts.rejected + ' rejected'),
      h('span', { class: 'pill' }, S.withheld.size + ' pages withheld')));
    host.appendChild(h('div', { class: 'row wrap' },
      h('button', { class: 'small', onclick: () => bulk('accepted', true) }, 'Accept page'),
      h('button', { class: 'small', onclick: () => bulk('accepted', false) }, 'Accept all'),
      h('button', { class: 'small ghost', onclick: () => bulk('rejected', true) }, 'Reject page'),
      h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: S.preview, onchange: (e) => { S.preview = e.target.checked; drawOverlay(); } }), ' Preview as final')));

    const list = h('div', { class: 'mark-list' });
    const pageMarks = S.marks.filter((m) => m.page === S.page);
    const others = S.marks.length - pageMarks.length;
    if (!pageMarks.length) list.appendChild(h('p', { class: 'help' }, 'No marks on this page.'));
    for (const m of pageMarks) {
      const reason = h('input', { type: 'text', value: m.reason || '', placeholder: 'Reason', oninput: (e) => { m.reason = e.target.value; } });
      list.appendChild(h('div', { class: 'mark-row ' + m.status + (S.selected === m.id ? ' selected' : ''), dataset: { id: String(m.id) }, onclick: () => { if (S.selected !== m.id) select(m.id); } },
        h('div', { class: 'row' },
          h('span', { class: 'tag' }, m.label || 'Manual box'),
          h('div', { class: 'spacer' }),
          m.status !== 'accepted' ? h('button', { class: 'small', onclick: (e) => { e.stopPropagation(); m.status = 'accepted'; drawOverlay(); renderMarkList(); } }, 'Accept') : null,
          m.status !== 'rejected' ? h('button', { class: 'small ghost', onclick: (e) => { e.stopPropagation(); m.status = 'rejected'; drawOverlay(); renderMarkList(); } }, 'Reject') : null,
          h('button', { class: 'small danger', title: 'Delete mark', onclick: (e) => { e.stopPropagation(); removeMark(m.id); } }, 'x')),
        m.text ? h('div', { class: 'excerpt mono' }, m.text) : null,
        citationSelect(m.citationId, (v) => { m.citationId = v; drawOverlay(); }),
        reason));
    }
    host.appendChild(list);
    if (others) host.appendChild(h('p', { class: 'help' }, others + ' mark(s) on other pages. ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); nextProposed(); } }, 'Jump to next page with marks to review')));
  }

  function nextProposed() {
    const pages = [...new Set(S.marks.filter((m) => m.status === 'proposed').map((m) => m.page))].sort((a, b) => a - b);
    if (!pages.length) {
      // Move on to the next file in the batch that still has proposed marks.
      stash();
      const k = S.docs.findIndex((e, i) => i !== S.cur && e.marks.some((m) => m.status === 'proposed'));
      if (k >= 0) { activate(k).then(nextProposed); return; }
      return toast('No proposed marks left to review.', 'ok');
    }
    const next = pages.find((p) => p > S.page);
    goPage(next === undefined ? pages[0] : next);
  }

  function renderPageTools() {
    const host = $('#page-tools');
    if (!host) return;
    clear(host);
    if (!S.doc) return host.appendChild(h('p', { class: 'help' }, 'Open a document.'));
    if (S.withheld.has(S.page)) {
      const w = S.withheld.get(S.page);
      const reason = h('input', { type: 'text', value: w.reason || '', placeholder: 'Reason', oninput: (e) => { w.reason = e.target.value; } });
      host.appendChild(h('div', {},
        h('p', {}, 'This page will be replaced with a "withheld" slip sheet.'),
        citationSelect(w.citationId, (v) => { w.citationId = v; drawOverlay(); }), reason,
        h('button', { class: 'small', onclick: () => { S.withheld.delete(S.page); drawOverlay(); renderPageTools(); renderMarkList(); } }, 'Release this page')));
    } else {
      host.appendChild(h('button', { class: 'small', onclick: () => {
        S.withheld.set(S.page, { citationId: S.defaultCitation, reason: S.defaultReason });
        drawOverlay(); renderPageTools(); renderMarkList();
      } }, 'Withhold this entire page'));
    }
  }

  // ---------- export ----------

  function exportSection() {
    const r = store.state.settings.redaction;
    const saveR = () => store.save();
    const batch = S.docs.length > 1;
    return h('section', {},
      h('h3', {}, '7. Export'),
      h('div', { class: 'grid2' },
        h('label', {}, h('span', {}, 'Resolution'), h('select', { onchange: (e) => { r.dpi = Number(e.target.value); saveR(); } },
          [150, 200, 300].map((d) => h('option', { value: d, selected: r.dpi === d ? true : null }, d + ' dpi')))),
        h('label', {}, h('span', {}, 'Image format'), h('select', { onchange: (e) => { r.format = e.target.value; saveR(); } },
          h('option', { value: 'jpeg', selected: r.format === 'jpeg' ? true : null }, 'JPEG (smaller)'),
          h('option', { value: 'png', selected: r.format === 'png' ? true : null }, 'PNG (lossless)'))),
        h('label', {}, h('span', {}, 'Bates prefix'), h('input', { type: 'text', value: r.batesPrefix, placeholder: 'e.g. TOWN-', oninput: (e) => { r.batesPrefix = e.target.value; saveR(); } })),
        h('label', {}, h('span', {}, 'Bates start'), h('input', { type: 'number', min: 1, value: r.batesStart || 1, oninput: (e) => { r.batesStart = Math.max(1, Number(e.target.value) || 1); saveR(); } }))),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: r.bates !== false, onchange: (e) => { r.bates = e.target.checked; saveR(); } }), ' Stamp Bates numbers'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: r.labels, onchange: (e) => { r.labels = e.target.checked; saveR(); } }), ' Print exemption on each box'),
      batch ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.mergeOutput, onchange: (e) => { S.mergeOutput = e.target.checked; } }), ' Also include one combined PDF of all files') : null,
      batch
        ? h('button', { class: 'primary block', onclick: exportBatch }, 'Export production (' + S.docs.length + ' files, one Bates sequence)')
        : h('button', { class: 'primary block', disabled: !S.doc, onclick: doExport }, 'Export redacted PDF'),
      batch ? h('button', { class: 'block', disabled: !S.doc, onclick: doExport }, 'Export this file only') : null,
      h('div', { id: 'verify-report' }, S.lastBatch ? batchReportView(S.lastBatch) : (S.lastExport ? reportView(S.lastExport.report) : null)),
      !batch ? h('div', { class: 'row wrap' },
        h('button', { class: 'small', disabled: !S.lastExport, onclick: exportPublicLog }, 'Redaction log (PDF)'),
        h('button', { class: 'small', disabled: !S.lastExport, onclick: exportInternalLog }, 'Internal audit log (CSV)')) : null,
      h('div', { class: 'row wrap' },
        h('button', { class: 'small ghost', disabled: !S.doc, onclick: saveSession }, 'Save session'),
        h('button', { class: 'small ghost', disabled: !S.doc, onclick: loadSession }, 'Load session')),
      h('p', { class: 'help' }, batch
        ? 'The production is a zip: one redacted PDF per file, numbered in one Bates sequence, plus the redaction log. The internal audit log downloads separately; do not send it to the requester.'
        : 'Every page of the output is an image; text under the boxes no longer exists in the file. The output is not text-searchable.'));
  }

  function reportView(rep) {
    return h('div', { class: 'report ' + (rep.pass ? 'pass' : 'fail') },
      h('strong', {}, rep.pass ? 'Verification passed' : 'VERIFICATION FAILED - do not release'),
      h('ul', {}, rep.checks.map((c) => h('li', { class: c.ok ? 'ok' : 'bad' }, (c.ok ? 'PASS ' : 'FAIL ') + c.name + ' - ' + c.detail))));
  }

  function batchReportView(b) {
    return h('div', { class: 'report ' + (b.pass ? 'pass' : 'fail') },
      h('strong', {}, b.pass ? 'Production verified: ' + b.files.length + ' files, ' + b.pages + ' pages, ' + (b.batesFirst ? b.batesFirst + ' - ' + b.batesLast : 'no Bates') : 'VERIFICATION FAILED - production not saved'),
      h('ul', {}, b.files.map((f) => h('li', { class: f.report.pass ? 'ok' : 'bad' }, (f.report.pass ? 'PASS ' : 'FAIL ') + f.outName + (f.report.pass ? '' : ': ' + f.report.checks.filter((c) => !c.ok).map((c) => c.name).join('; '))))));
  }

  /** Bates label for page i of the current document, counting earlier batch files. */
  function batesFor(i, entryIndex) {
    const r = store.state.settings.redaction;
    if (r.bates === false) return null;
    const off = pageOffset(entryIndex === undefined ? Math.max(S.cur, 0) : entryIndex);
    return engine.batesLabel(r.batesPrefix, (r.batesStart || 1) + off + i, r.batesDigits || 6);
  }

  function pageRef(i, entryIndex) {
    const b = batesFor(i, entryIndex);
    return b ? b + ' (p. ' + (i + 1) + ')' : 'p. ' + (i + 1);
  }

  async function confirmExportable(entries) {
    const unsigned = entries.filter((e) => !reviewValid(e));
    if (unsigned.length) {
      toast('Not exported: ' + unsigned.length + ' file(s) without a current sign-off: ' + unsigned.map((e) => e.doc.fileName).join(', ') + '. Review and sign off each file first.', 'error');
      return false;
    }
    const proposed = entries.reduce((a, e) => a + e.marks.filter((m) => m.status === 'proposed').length, 0);
    if (proposed && !await confirmDialog(proposed + ' proposed mark(s) have not been reviewed. They will NOT be redacted. Export anyway?', 'Export anyway')) return false;
    const missing = entries.reduce((a, e) => a +
      e.marks.filter((m) => m.status === 'accepted' && !e.withheld.has(m.page) && (!m.citationId || !String(m.reason || '').trim())).length +
      [...e.withheld.values()].filter((w) => !w.citationId || !String(w.reason || '').trim()).length, 0);
    if (missing && !await confirmDialog(missing + ' redaction(s) have no stated reason. The reason goes in the redaction log and the denial letter, and the withholding body bears the burden of justifying each exemption. Export anyway?', 'Export anyway')) return false;
    const any = entries.some((e) => e.marks.some((m) => m.status === 'accepted') || e.withheld.size);
    if (!any && !await confirmDialog('No redactions are accepted. Export clean flattened copies anyway?', 'Export')) return false;
    return true;
  }

  /** Renders and verifies one entry. Returns { bytes, report, outName, accepted, withheld, stamps }. */
  async function exportEntry(entry, batesStart, label) {
    const r = store.state.settings.redaction;
    const accepted = entry.marks.filter((m) => m.status === 'accepted' && !entry.withheld.has(m.page));
    const withheld = new Map([...entry.withheld].map(([p, w]) => [p, { cite: citeOf(w.citationId), reason: w.reason }]));
    const { bytes, stamps } = await engine.exportRedacted(entry.doc,
      accepted.map((m) => ({ page: m.page, rects: m.rects, citation: citeOf(m.citationId) })),
      withheld,
      {
        dpi: r.dpi, format: r.format, labels: r.labels, color: r.color,
        bates: r.bates === false ? null : { prefix: r.batesPrefix, start: batesStart, digits: r.batesDigits || 6 },
        title: 'Redacted - ' + entry.doc.fileName.replace(/\.[^.]+$/, ''),
      },
      (i, n) => setBusy('Rendering ' + (label ? label + ' ' : '') + 'page ' + i + ' of ' + n + '...'));
    setBusy('Verifying ' + (label || 'output') + '...');
    const sensitive = entry.marks.filter((m) => m.status === 'accepted' && m.text).map((m) => m.text);
    const report = await engine.verify(bytes, entry.doc.numPages, sensitive, stamps);
    const outName = entry.doc.fileName.replace(/\.[^.]+$/, '') + '_REDACTED_' + deadlines.todayISO() + '.pdf';
    return { bytes, report, outName, at: new Date().toISOString(), accepted, withheld: new Map(entry.withheld), stamps };
  }

  async function doExport() {
    if (!S.doc || S.busy) return;
    if (!await confirmExportable([S])) return;
    const r = store.state.settings.redaction;
    setBusy('Rendering...');
    try {
      const result = await exportEntry(S, (r.batesStart || 1) + pageOffset(Math.max(S.cur, 0)));
      S.lastExport = result;
      S.lastBatch = null;
      renderSidebar();
      if (!result.report.pass) {
        toast('Verification failed. The file was not saved. See the report.', 'error');
        return;
      }
      download(result.bytes, result.outName, 'application/pdf');
      recordProduction([{ entry: S, index: Math.max(S.cur, 0), result, outName: result.outName, report: result.report }], result.outName, result.report.sha256);
      toast('Exported and verified: ' + result.outName, 'ok');
    } catch (e) {
      console.error(e);
      toast('Export failed: ' + e.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  function productionBase() {
    return (S.requestId || 'Production').replace(/[^A-Za-z0-9_-]+/g, '_') + '_PRODUCTION_' + deadlines.todayISO();
  }

  /** Redacts every file in the batch in one Bates sequence and downloads a zip plus the internal audit log. */
  async function exportBatch() {
    if (!S.docs.length || S.busy) return;
    stash();
    if (!await confirmExportable(S.docs)) return;
    const r = store.state.settings.redaction;
    setBusy('Rendering batch...');
    try {
      const files = [];
      let running = r.batesStart || 1;
      for (const [k, e] of S.docs.entries()) {
        const result = await exportEntry(e, running, 'file ' + (k + 1) + '/' + S.docs.length);
        e.lastExport = result;
        files.push({ entry: e, index: k, result, outName: String(k + 1).padStart(2, '0') + '_' + result.outName, report: result.report, batesStart: running });
        running += e.doc.numPages;
      }
      const pages = totalPages();
      const batch = {
        at: new Date().toISOString(), files, pages, pass: files.every((f) => f.report.pass),
        batesFirst: batesFor(0, 0), batesLast: batesFor(S.docs[S.docs.length - 1].doc.numPages - 1, S.docs.length - 1),
      };
      S.lastBatch = batch;
      restore(S.cur);
      renderSidebar();
      if (!batch.pass) {
        toast('Verification failed on ' + files.filter((f) => !f.report.pass).length + ' file(s). Nothing was saved. See the report.', 'error');
        return;
      }
      setBusy('Building production zip...');
      const base = productionBase();
      const logBytes = await engine.buildLogPdf(batchMeta(batch, base + '.zip'), batchLogRows(files).map((x) => ({ n: x.n, page: x.pageRef, scope: x.scope, cite: x.cite || '-', reason: x.reason || '-' })));
      const entries = files.map((f) => ({ name: f.outName, data: f.result.bytes }));
      entries.push({ name: 'REDACTION_LOG.pdf', data: logBytes });
      entries.push({ name: 'MANIFEST.txt', data: manifestText(batch, files) });
      if (S.mergeOutput) {
        setBusy('Merging combined PDF...');
        entries.push({ name: 'COMBINED_' + base + '.pdf', data: await engine.mergePdfs(files.map((f) => f.result.bytes), 'Redacted production ' + (S.requestId || '')) });
      }
      const zipBytes = zip.build(entries);
      download(zipBytes, base + '.zip', 'application/zip');
      download(csv(internalRows(files, batch)), base + '_INTERNAL_AUDIT_do_not_release.csv', 'text/csv');
      recordProduction(files, base + '.zip', await engine.sha256Hex(zipBytes));
      toast('Production exported and verified: ' + files.length + ' files, ' + pages + ' pages, ' + (batch.batesFirst ? batch.batesFirst + ' to ' + batch.batesLast : 'no Bates') + '.', 'ok');
    } catch (e) {
      console.error(e);
      toast('Batch export failed: ' + e.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  function batchMeta(batch, zipName) {
    const p = store.state.settings.profile;
    return [
      ['Request', S.requestId || 'Not linked'],
      ['Production', zipName + ' (' + batch.files.length + ' files, ' + batch.pages + ' pages)'],
      ['Files', batch.files.map((f) => f.outName + ' = ' + f.entry.doc.fileName).join('; ')],
      ['Reviewed by', batch.files.map((f) => f.outName + ': ' + reviewedText(f.entry)).join('; ')],
      ['Bates range', batch.batesFirst ? batch.batesFirst + ' - ' + batch.batesLast : 'None'],
      ['Prepared by', [p.signerName, p.signerTitle, p.orgName].filter(Boolean).join(', ') || '-'],
      ['Date', deadlines.todayISO()],
    ];
  }

  function manifestText(batch, files) {
    const lines = ['RSA91A-Engine production', 'Request: ' + (S.requestId || 'not linked'), 'Date: ' + deadlines.todayISO(),
      'Bates range: ' + (batch.batesFirst ? batch.batesFirst + ' - ' + batch.batesLast : 'none'), ''];
    for (const f of files) {
      const n = f.entry.doc.numPages;
      lines.push(f.outName + '  ' + n + ' page(s)  ' + (batesFor(0, f.index) ? batesFor(0, f.index) + ' - ' + batesFor(n - 1, f.index) : '') + '  source SHA-256 ' + f.entry.doc.sha256 + '  output SHA-256 ' + f.report.sha256 + '  reviewed by ' + reviewedText(f.entry));
    }
    lines.push('', 'Every page is an image. Text under a redaction box does not exist in these files.');
    return lines.join('\n');
  }

  /** Log rows for one or more exported files: [{ n, index, page, pageRef, scope, citationId, cite, reason, mark, file }]. */
  function batchLogRows(files) {
    const items = [];
    for (const f of files) {
      for (const m of f.result.accepted) items.push({ index: f.index, file: f.outName, page: m.page, scope: 'Partial redaction', citationId: m.citationId, reason: m.reason, mark: m });
      for (const [p, w] of f.result.withheld) items.push({ index: f.index, file: f.outName, page: p, scope: 'Page withheld', citationId: w.citationId, reason: w.reason });
    }
    items.sort((a, b) => a.index - b.index || a.page - b.page);
    return items.map((it, k) => Object.assign({ n: k + 1, pageRef: (files.length > 1 ? it.file + ', ' : '') + pageRef(it.page, it.index), cite: citeOf(it.citationId) }, it));
  }

  function logRows() {
    return batchLogRows([{ entry: S, index: Math.max(S.cur, 0), result: S.lastExport, outName: S.lastExport.outName, report: S.lastExport.report }]);
  }

  function reviewedText(e) {
    return e.reviewed ? e.reviewed.by + ' on ' + e.reviewed.at.replace('T', ' ').slice(0, 16) + (e.reviewed.note ? ' (' + e.reviewed.note + ')' : '') : 'not signed off';
  }

  function internalRows(files, batch) {
    const rows = [['#', 'File', 'Page', 'Bates', 'Scope', 'Source', 'Detector', 'Covered text (INTERNAL - do not release)', 'Exemption', 'Reason', 'Reviewed by', 'Exported at', 'Source file', 'Source SHA-256', 'Output file', 'Output SHA-256', 'Verification']];
    for (const r of batchLogRows(files)) {
      const f = files[r.index] || files.find((x) => x.index === r.index);
      rows.push([r.n, r.file, r.page + 1, batesFor(r.page, r.index) || '', r.scope, r.mark ? r.mark.source : 'page', r.mark ? r.mark.label : '', r.mark ? r.mark.text : '',
        r.cite, r.reason, reviewedText(f.entry), batch ? batch.at : f.result.at, f.entry.doc.fileName, f.entry.doc.sha256, f.outName, f.report.sha256, f.report.pass ? 'PASS' : 'FAIL']);
    }
    return rows;
  }

  function recordProduction(files, outName, outputSha256) {
    if (!S.requestId) return;
    const req = store.getRequest(S.requestId);
    if (!req) return;
    const groups = new Map();
    for (const r of batchLogRows(files)) {
      const key = r.citationId + '|' + (r.reason || '');
      if (!groups.has(key)) groups.set(key, { citationId: r.citationId, reason: r.reason, pages: [] });
      const g = groups.get(key);
      const ref = batesFor(r.page, r.index) || (files.length > 1 ? r.file + ' p. ' : '') + String(r.page + 1);
      if (!g.pages.includes(ref)) g.pages.push(ref);
    }
    const first = files[0]; const last = files[files.length - 1];
    const pages = files.reduce((a, f) => a + f.entry.doc.numPages, 0);
    req.productions = req.productions || [];
    req.productions.push({
      date: deadlines.todayISO(), file: outName, outputSha256, pages,
      sourceFile: files.map((f) => f.entry.doc.fileName).join('; '),
      sourceSha256: files.map((f) => f.entry.doc.sha256).join('; '),
      files: files.map((f) => ({ name: f.outName, source: f.entry.doc.fileName, pages: f.entry.doc.numPages, sha256: f.report.sha256, reviewedBy: f.entry.reviewed ? f.entry.reviewed.by : '', reviewedAt: f.entry.reviewed ? f.entry.reviewed.at : '' })),
      batesFirst: batesFor(0, first.index), batesLast: batesFor(last.entry.doc.numPages - 1, last.index),
      entries: [...groups.values()].map((g) => ({ citationId: g.citationId, reason: g.reason, pages: g.pages.join(', ') })),
    });
    req.history = req.history || [];
    req.history.push({ at: new Date().toISOString(), event: 'Redacted production ' + outName + ' (' + files.length + ' file' + (files.length === 1 ? '' : 's') + ', ' + pages + ' pages)' });
    store.upsertRequest(req);
  }

  async function exportPublicLog() {
    const e = S.lastExport;
    const p = store.state.settings.profile;
    const meta = [
      ['Request', S.requestId || 'Not linked'],
      ['Source document', S.doc.fileName + ' (' + S.doc.numPages + ' pages)'],
      ['Produced file', e.outName],
      ['Bates range', batesFor(0) ? batesFor(0) + ' - ' + batesFor(S.doc.numPages - 1) : 'None'],
      ['Reviewed by', reviewedText(S)],
      ['Prepared by', [p.signerName, p.signerTitle, p.orgName].filter(Boolean).join(', ') || '-'],
      ['Date', deadlines.todayISO()],
    ];
    const rows = logRows().map((r) => ({ n: r.n, page: r.pageRef, scope: r.scope, cite: r.cite || '-', reason: r.reason || '-' }));
    const bytes = await engine.buildLogPdf(meta, rows);
    download(bytes, e.outName.replace(/\.pdf$/, '_LOG.pdf'), 'application/pdf');
  }

  function exportInternalLog() {
    const e = S.lastExport;
    const files = [{ entry: S, index: Math.max(S.cur, 0), result: e, outName: e.outName, report: e.report }];
    download(csv(internalRows(files, null)), e.outName.replace(/\.pdf$/, '_INTERNAL_AUDIT.csv'), 'text/csv');
  }

  // ---------- sessions ----------

  function saveSession() {
    stash();
    const data = {
      app: 'RSA91A-Engine', type: 'redaction-session', version: 2, saved: new Date().toISOString(), requestId: S.requestId,
      defaultCitation: S.defaultCitation, defaultReason: S.defaultReason, terms: S.terms, regex: S.regex,
      docs: S.docs.map((e) => ({ sourceFile: e.doc.fileName, sourceSha256: e.doc.sha256, marks: e.marks, withheld: [...e.withheld], reviewed: e.reviewed || null })),
      // Fields kept for sessions saved by 1.x readers.
      sourceFile: S.doc ? S.doc.fileName : '', sourceSha256: S.doc ? S.doc.sha256 : '', marks: S.marks, withheld: [...S.withheld],
    };
    const base = S.docs.length > 1 ? productionBase() : (S.doc ? S.doc.fileName.replace(/\.[^.]+$/, '') : 'session');
    download(JSON.stringify(data, null, 2), base + '_session.json', 'application/json');
  }

  async function loadSession() {
    const f = await pickFile('application/json,.json');
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'RSA91A-Engine' || data.type !== 'redaction-session') throw new Error('Not a redaction session file.');
      stash();
      const saved = Array.isArray(data.docs) ? data.docs : [{ sourceFile: data.sourceFile, sourceSha256: data.sourceSha256, marks: data.marks || [], withheld: data.withheld || [] }];
      let applied = 0;
      const unmatched = [];
      for (const d of saved) {
        const e = S.docs.find((x) => x.doc.sha256 === d.sourceSha256);
        if (!e) { unmatched.push(d.sourceFile); continue; }
        e.marks = d.marks || [];
        e.withheld = new Map(d.withheld || []);
        e.reviewed = d.reviewed || null;
        e.nextId = e.marks.reduce((a, m) => Math.max(a, m.id), 0) + 1;
        e.selected = null;
        applied++;
      }
      if (!applied && saved.length === 1 && S.docs.length === 1 && await confirmDialog('This session was saved for a different file (' + saved[0].sourceFile + '). Marks may not line up. Load anyway?', 'Load anyway')) {
        const e = S.docs[0];
        e.marks = saved[0].marks || []; e.withheld = new Map(saved[0].withheld || []);
        e.nextId = e.marks.reduce((a, m) => Math.max(a, m.id), 0) + 1; e.selected = null;
        applied = 1;
      }
      S.requestId = data.requestId || S.requestId;
      S.defaultCitation = data.defaultCitation || S.defaultCitation;
      S.defaultReason = data.defaultReason || '';
      if (typeof data.terms === 'string') S.terms = data.terms;
      if (typeof data.regex === 'string') S.regex = data.regex;
      if (S.cur >= 0) restore(S.cur);
      renderSidebar();
      drawOverlay();
      toast('Session loaded for ' + applied + ' file(s).' + (unmatched.length ? ' Not open: ' + unmatched.join(', ') : ''), applied ? 'ok' : 'warn');
    } catch (e) {
      toast('Could not load session: ' + e.message, 'error');
    }
  }

  // ---------- view ----------

  function render(params) {
    const host = $('#view-studio');
    if (params && params.requestId) S.requestId = params.requestId;
    if (host.dataset.built) {
      renderSidebar();
      drawOverlay();
      if (params && params.openShelf) openFromShelf();
      return;
    }
    if (params && params.openShelf) setTimeout(() => openFromShelf(), 0);
    host.dataset.built = '1';
    host.appendChild(h('div', { class: 'studio' },
      h('aside', { id: 'studio-sidebar', class: 'sidebar' }),
      h('div', { class: 'viewer-col' },
        h('div', { class: 'toolbar viewer-tools' },
          h('button', { class: 'small', title: 'Previous page (PgUp)', onclick: () => goPage(S.page - 1) }, 'Prev'),
          h('span', { id: 'pager-label' }, 'No document'),
          h('button', { class: 'small', title: 'Next page (PgDn)', onclick: () => goPage(S.page + 1) }, 'Next'),
          h('span', { class: 'sep' }),
          h('button', { class: 'small', title: 'Zoom out', onclick: () => { S.zoom = Math.max(0.3, S.zoom / 1.2); renderPage(); } }, '-'),
          h('span', { id: 'zoom-label' }, '100%'),
          h('button', { class: 'small', title: 'Zoom in', onclick: () => { S.zoom = Math.min(4, S.zoom * 1.2); renderPage(); } }, '+'),
          h('button', { class: 'small', onclick: fitWidth }, 'Fit width'),
          h('span', { class: 'sep' }),
          h('button', { class: 'small', onclick: nextProposed }, 'Next to review'),
          h('div', { class: 'spacer' }),
          h('span', { class: 'help' }, 'Drag to draw a box. Double-click a box to toggle. Del removes the selected box.')),
        h('div', { id: 'viewer', class: 'viewer' },
          h('div', { id: 'studio-busy', class: 'busy', hidden: true }),
          h('div', { id: 'page-wrap', class: 'page-wrap' },
            h('canvas', { id: 'page-canvas' }),
            h('div', { id: 'page-overlay', class: 'overlay' }))))));
    attachDrawing();
    const viewer = $('#viewer');
    viewer.addEventListener('dragover', (e) => { e.preventDefault(); viewer.classList.add('drop'); });
    viewer.addEventListener('dragleave', () => viewer.classList.remove('drop'));
    viewer.addEventListener('drop', (e) => {
      e.preventDefault();
      viewer.classList.remove('drop');
      if (e.dataTransfer.files.length) open(Array.from(e.dataTransfer.files), { append: S.docs.length > 0 && e.shiftKey });
    });
    document.addEventListener('keydown', (e) => {
      if ($('#view-studio').hidden || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (e.key === 'PageDown') { e.preventDefault(); goPage(S.page + 1); }
      if (e.key === 'PageUp') { e.preventDefault(); goPage(S.page - 1); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && S.selected !== null) { e.preventDefault(); removeMark(S.selected); }
      if (e.key === 'a' && S.selected !== null) { const m = S.marks.find((x) => x.id === S.selected); if (m) { m.status = 'accepted'; drawOverlay(); renderMarkList(); } }
      if (e.key === 'r' && S.selected !== null) { const m = S.marks.find((x) => x.id === S.selected); if (m) { m.status = 'rejected'; drawOverlay(); renderMarkList(); } }
    });
    renderSidebar();
  }

  // Flush pending shelf saves when the page is left.
  window.addEventListener('beforeunload', () => { stash(); for (const e of S.docs) persistEntry(e, true); });

  NS.studio = { render, open, openFromShelf, shelveEntries, activate, state: S, scan, scanAll, doExport, exportBatch, runOcr, stash, signOff, clearSignOff, reviewValid, persistAll };
})(typeof self !== 'undefined' ? self : this);
