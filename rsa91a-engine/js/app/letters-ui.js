/* RSA91A-Engine: letter drafting view. */
(function (root) {
  'use strict';
  const NS = root.RSA91A;
  const { h, $, clear, toast, download } = NS.ui;
  const { store, letters, citations, deadlines, engine } = NS;

  const L = { requestId: '', template: 'request', date: '', estimateDate: '', reason: '', costEstimate: '', producedDescription: '', fee: '', partial: false, entries: [], text: '' };

  function req() {
    return store.getRequest(L.requestId);
  }

  function prefillEntries() {
    const r = req();
    const last = r && r.productions && r.productions[r.productions.length - 1];
    L.entries = last ? last.entries.map((e) => Object.assign({}, e)) : [];
    if (last) L.producedDescription = last.file + ' (' + last.pages + ' pages' + (last.batesFirst ? ', ' + last.batesFirst + ' - ' + last.batesLast : '') + ')';
  }

  function generate() {
    const r = req();
    if (!r) return toast('Pick a request first.', 'error');
    const tpl = letters.TEMPLATES.find((t) => t.id === L.template);
    const settings = Object.assign({}, store.state.settings, { userCitations: store.state.userCitations });
    try {
      L.text = tpl.fn(r, settings, {
        date: L.date || deadlines.todayISO(), estimateDate: L.estimateDate, reason: L.reason, costEstimate: L.costEstimate,
        producedDescription: L.producedDescription, fee: L.fee, partial: L.partial, entries: L.entries,
      });
    } catch (e) {
      return toast(e.message, 'error');
    }
    render();
  }

  async function toPdf() {
    const { PDFDocument, StandardFonts } = root.PDFLib;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    const size = 11.5;
    const lead = 15;
    const M = 72;
    let page = doc.addPage([612, 792]);
    let y = 792 - M;
    for (const para of engine.ascii(L.text).split('\n')) {
      const lines = para.trim() === '' ? [''] : engine.wrapText(para, font, size, 612 - 2 * M);
      for (const line of lines) {
        if (y < M) { page = doc.addPage([612, 792]); y = 792 - M; }
        if (line) page.drawText(line, { x: M, y, size, font });
        y -= lead;
      }
    }
    doc.setProducer('RSA91A-Engine');
    doc.setCreator('RSA91A-Engine');
    doc.setTitle('Letter ' + (L.requestId || ''));
    return doc.save();
  }

  function fileBase() {
    return 'RSA91A_' + L.template + '_' + (L.requestId || 'draft') + '_' + (L.date || deadlines.todayISO());
  }

  function logResponse() {
    const r = req();
    if (!r) return;
    const date = L.date || deadlines.todayISO();
    if (!r.firstResponseDate) r.firstResponseDate = date;
    if (L.template === 'acknowledgment') { r.status = 'acknowledged'; r.estimateDate = L.estimateDate || r.estimateDate; }
    if (L.template === 'denial') r.status = L.partial ? 'partial' : 'denied';
    if (L.template === 'production') r.status = L.entries.length ? 'partial' : 'produced';
    r.history = r.history || [];
    r.history.push({ at: new Date().toISOString(), event: 'Letter logged as sent: ' + L.template + ' dated ' + date });
    store.upsertRequest(r);
    toast('Logged on ' + r.id + '. The 5-day clock now shows as answered.', 'ok');
  }

  function entryEditor() {
    const ex = citations.exemptions(store.state.userCitations);
    const wrap = h('div', { class: 'entries' });
    L.entries.forEach((e, i) => {
      wrap.appendChild(h('div', { class: 'entry' },
        h('select', { onchange: (ev) => { e.citationId = ev.target.value; } }, ex.map((c) => h('option', { value: c.id, selected: c.id === e.citationId ? true : null }, c.cite))),
        h('input', { type: 'text', placeholder: 'Record or pages', value: e.description || e.pages || '', oninput: (ev) => { e.description = ev.target.value; e.pages = ''; } }),
        h('input', { type: 'text', placeholder: 'Specific reason', value: e.reason || '', oninput: (ev) => { e.reason = ev.target.value; } }),
        h('button', { class: 'small danger', onclick: () => { L.entries.splice(i, 1); render(); } }, 'x')));
    });
    wrap.appendChild(h('button', { class: 'small', onclick: () => { L.entries.push({ citationId: ex[0].id, reason: '', description: '' }); render(); } }, 'Add withheld item'));
    return wrap;
  }

  function render(params) {
    if (params && params.requestId && params.requestId !== L.requestId) {
      L.requestId = params.requestId;
      prefillEntries();
    }
    const host = $('#view-letters');
    clear(host);
    const reqs = store.state.requests;
    const tpl = letters.TEMPLATES.find((t) => t.id === L.template);
    const field = (label, input) => h('label', {}, h('span', {}, label), input);

    const opts = [];
    if (L.template === 'acknowledgment') {
      opts.push(field('Estimated decision date', h('input', { type: 'date', value: L.estimateDate, oninput: (e) => { L.estimateDate = e.target.value; } })));
      const t = h('textarea', { rows: 3, oninput: (e) => { L.reason = e.target.value; } }); t.value = L.reason;
      opts.push(field('Specific reason more time is needed', t));
      const ce = h('textarea', { rows: 3, placeholder: 'Leave blank if no per-communication charge applies', oninput: (e) => { L.costEstimate = e.target.value; } }); ce.value = L.costEstimate;
      opts.push(field('Itemized cost estimate (required by RSA 91-A:4, IV(b)(3) when a paragraph VIII charge applies: more than 250 electronic communications)', ce));
    }
    if (L.template === 'production' || L.template === 'denial') {
      if (L.template === 'production') {
        const t = h('textarea', { rows: 2, oninput: (e) => { L.producedDescription = e.target.value; } }); t.value = L.producedDescription;
        opts.push(field('What is enclosed', t));
        opts.push(field('Copy cost (leave blank if none)', h('input', { type: 'text', value: L.fee, oninput: (e) => { L.fee = e.target.value; } })));
      } else {
        opts.push(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: L.partial, onchange: (e) => { L.partial = e.target.checked; } }), ' Partial denial (some records released)'));
      }
      opts.push(h('div', {}, h('span', { class: 'label' }, 'Withheld items and reasons'), entryEditor()));
      opts.push(h('button', { class: 'small ghost', onclick: () => { prefillEntries(); render(); } }, 'Reload from last redacted production'));
    }

    const ta = h('textarea', { class: 'letter', rows: 28, spellcheck: 'true', oninput: (e) => { L.text = e.target.value; } });
    ta.value = L.text;

    host.appendChild(h('div', { class: 'toolbar' }, h('h1', {}, 'Letters')));
    host.appendChild(h('div', { class: 'letters' },
      h('div', { class: 'panel' },
        field('Request', h('select', { onchange: (e) => { L.requestId = e.target.value; prefillEntries(); render(); } },
          h('option', { value: '' }, reqs.length ? 'Choose a request' : 'Log a request first'),
          reqs.map((r) => h('option', { value: r.id, selected: r.id === L.requestId ? true : null }, r.id + ' - ' + (r.requesterName || r.agency || ''))))),
        field('Letter', h('select', { onchange: (e) => { L.template = e.target.value; render(); } },
          letters.TEMPLATES.map((t) => h('option', { value: t.id, selected: t.id === L.template ? true : null }, t.label)))),
        field('Letter date', h('input', { type: 'date', value: L.date || deadlines.todayISO(), oninput: (e) => { L.date = e.target.value; } })),
        opts,
        h('button', { class: 'primary block', onclick: generate }, 'Draft letter'),
        h('p', { class: 'alert' }, citations.VERIFY_NOTE)),
      h('div', { class: 'panel grow' },
        L.text ? h('div', { class: 'row wrap' },
          h('button', { class: 'small', onclick: async () => { try { await navigator.clipboard.writeText(L.text); toast('Copied.', 'ok'); } catch (e) { ta.select(); toast('Press Ctrl+C to copy.'); } } }, 'Copy'),
          h('button', { class: 'small', onclick: () => download(L.text, fileBase() + '.txt', 'text/plain') }, 'Download .txt'),
          h('button', { class: 'small', onclick: async () => download(await toPdf(), fileBase() + '.pdf', 'application/pdf') }, 'Download PDF'),
          tpl.side === 'agency' ? h('button', { class: 'small ghost', onclick: logResponse }, 'Log as sent (stops the 5-day clock)') : null) : null,
        L.text ? ta : h('div', { class: 'empty' }, h('p', {}, 'Choose a request and a letter, then Draft. Edit the draft here before sending. Replace every [BRACKETED] placeholder.')))));
  }

  NS.lettersUi = { render };
})(typeof self !== 'undefined' ? self : this);
