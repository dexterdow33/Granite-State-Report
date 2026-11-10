/* RSA91A-Engine: request tracker view. */
(function (root) {
  'use strict';
  const NS = root.RSA91A;
  const { h, $, clear, toast, download, formDialog, confirmDialog, csv } = NS.ui;
  const { store, deadlines, letters } = NS;

  const STATUSES = [
    { value: 'received', label: 'Received' },
    { value: 'acknowledged', label: 'Acknowledged (time estimate sent)' },
    { value: 'partial', label: 'Partially produced' },
    { value: 'produced', label: 'Produced in full' },
    { value: 'denied', label: 'Denied' },
    { value: 'withdrawn', label: 'Withdrawn' },
    { value: 'closed', label: 'Closed' },
  ];
  const CLOSED = new Set(['produced', 'denied', 'withdrawn', 'closed']);

  const STATE_TEXT = {
    open: (s) => s.businessDaysLeft + ' business day' + (s.businessDaysLeft === 1 ? '' : 's') + ' left',
    'due-today': () => 'Due today',
    overdue: () => 'Past 5-day window',
    answered: () => 'Answered on time',
    'answered-late': () => 'Answered late',
  };

  let filter = '';

  function statusOf(r) {
    return deadlines.responseStatus(r, deadlines.todayISO(), store.state.settings);
  }

  function requestFields(r) {
    return [
      { name: 'receivedDate', label: 'Date request received / sent', type: 'date', value: r.receivedDate || deadlines.todayISO(), required: true },
      { name: 'requesterName', label: 'Requester', value: r.requesterName },
      { name: 'requesterAddress', label: 'Requester mailing address / email', type: 'textarea', rows: 2, value: r.requesterAddress },
      { name: 'agency', label: 'Public body or agency', value: r.agency, required: true },
      { name: 'agencyAddress', label: 'Agency address / records custodian', type: 'textarea', rows: 2, value: r.agencyAddress },
      { name: 'description', label: 'Records requested (reasonably described)', type: 'textarea', rows: 4, value: r.description, required: true },
      { name: 'format', label: 'Format', type: 'select', value: r.format || 'electronic', options: [
        { value: 'electronic', label: 'Electronic copies' }, { value: 'paper', label: 'Paper copies' }, { value: 'inspect', label: 'Inspection in person' }] },
      { name: 'status', label: 'Status', type: 'select', value: r.status || 'received', options: STATUSES },
      { name: 'firstResponseDate', label: 'Date of first written response (production, denial, or acknowledgment)', type: 'date', value: r.firstResponseDate,
        help: 'Leave blank until a response goes out. This stops the 5-business-day clock in the tracker.' },
      { name: 'estimateDate', label: 'Estimated decision date given in acknowledgment', type: 'date', value: r.estimateDate },
      { name: 'fee', label: 'Copy cost charged (actual cost)', value: r.fee },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 3, value: r.notes },
    ];
  }

  async function edit(existing) {
    const r = existing ? Object.assign({}, existing) : {};
    const values = await formDialog(existing ? 'Edit ' + existing.id : 'New Right-to-Know request', requestFields(r), existing ? 'Save' : 'Create');
    if (!values) return;
    try {
      deadlines.parseISO(values.receivedDate);
    } catch (e) {
      toast(e.message, 'error');
      return;
    }
    const merged = Object.assign(r, values);
    if (!merged.id) {
      merged.id = store.nextId();
      merged.created = new Date().toISOString();
      merged.history = [];
      merged.productions = [];
    }
    merged.history = merged.history || [];
    merged.history.push({ at: new Date().toISOString(), event: existing ? 'Edited' : 'Created' });
    if (CLOSED.has(merged.status) && !merged.closedDate) merged.closedDate = deadlines.todayISO();
    store.upsertRequest(merged);
    toast((existing ? 'Saved ' : 'Created ') + merged.id, 'ok');
  }

  function badge(r) {
    const s = statusOf(r);
    const text = STATE_TEXT[s.state](s);
    const cls = CLOSED.has(r.status) && !r.firstResponseDate ? 'muted' : s.state;
    return h('span', { class: 'badge ' + cls, title: 'Response due ' + letters.longDate(s.dueDate) }, text);
  }

  function summary(reqs) {
    let open = 0; let soon = 0; let overdue = 0;
    for (const r of reqs) {
      if (CLOSED.has(r.status)) continue;
      open++;
      const s = statusOf(r);
      if (s.state === 'overdue') overdue++;
      else if (s.state === 'due-today' || (s.state === 'open' && s.businessDaysLeft <= 2)) soon++;
    }
    const card = (n, label, cls) => h('div', { class: 'stat ' + (cls || '') }, h('strong', {}, String(n)), h('span', {}, label));
    return h('div', { class: 'stats' },
      card(open, 'Open requests'),
      card(soon, 'Due within 2 business days', soon ? 'warn' : ''),
      card(overdue, 'Past the 5-day window, no response', overdue ? 'bad' : ''),
      card(reqs.length, 'All requests'));
  }

  function render() {
    const host = $('#view-requests');
    clear(host);
    const reqs = store.state.requests;
    const q = filter.toLowerCase();
    const shown = reqs.filter((r) => !q || [r.id, r.requesterName, r.agency, r.description, r.notes].join(' ').toLowerCase().includes(q));

    host.appendChild(h('div', { class: 'toolbar' },
      h('h1', {}, 'Requests'),
      h('div', { class: 'spacer' }),
      h('input', { type: 'search', placeholder: 'Filter requests', value: filter, 'aria-label': 'Filter requests',
        oninput: (e) => { filter = e.target.value; render(); $('#view-requests input[type=search]').focus(); } }),
      h('button', { class: 'ghost', onclick: exportCsv }, 'Export CSV'),
      h('button', { class: 'primary', onclick: () => edit(null) }, 'New request')));

    host.appendChild(summary(reqs));

    if (!reqs.length) {
      host.appendChild(h('div', { class: 'empty' },
        h('p', {}, 'No requests yet. Log every Right-to-Know request here, whether you are sending it or answering it. The tracker counts the 5-business-day response window under RSA 91-A:4, IV(b).'),
        h('button', { class: 'primary', onclick: () => edit(null) }, 'Log the first request')));
      return;
    }

    const table = h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ['ID', 'Received', 'Requester', 'Agency', 'Records', '5-day window', 'Status', 'Files', ''].map((c) => h('th', {}, c)))));
    const tbody = h('tbody');
    for (const r of shown) {
      const s = statusOf(r);
      tbody.appendChild(h('tr', {},
        h('td', { class: 'mono' }, r.id),
        h('td', {}, r.receivedDate),
        h('td', {}, r.requesterName || ''),
        h('td', {}, r.agency || ''),
        h('td', { class: 'desc', title: r.description || '' }, (r.description || '').slice(0, 90) + ((r.description || '').length > 90 ? '...' : '')),
        h('td', {}, h('div', {}, s.dueDate), badge(r)),
        h('td', {}, (STATUSES.find((x) => x.value === r.status) || STATUSES[0]).label),
        h('td', {}, shelfCell(r)),
        h('td', { class: 'actions' },
          h('button', { class: 'small', onclick: () => edit(r) }, 'Edit'),
          h('button', { class: 'small', onclick: () => NS.app.go('letters', { requestId: r.id }) }, 'Letter'),
          h('button', { class: 'small', onclick: () => NS.app.go('studio', { requestId: r.id, openShelf: !!(r.shelf && r.shelf.length) }) }, (r.shelf && r.shelf.length) ? 'Open files' : 'Redact'),
          h('button', { class: 'small danger', onclick: () => remove(r) }, 'Delete'))));
    }
    table.appendChild(tbody);
    host.appendChild(h('div', { class: 'table-wrap' }, table));
    host.appendChild(h('p', { class: 'help' },
      'Due dates count 5 business days after the day of receipt, skipping weekends and the holidays listed in Settings. ',
      'The statute does not spell out a counting method; confirm the convention you use in Settings.'));
  }

  function shelfCell(r) {
    const files = r.shelf || [];
    if (!files.length) return h('span', { class: 'help' }, 'none');
    const signed = files.filter((f) => f.reviewed).length;
    return h('span', { title: files.map((f) => f.name).join('\n') }, files.length + ' on shelf, ' + signed + ' signed off');
  }

  async function remove(r) {
    if (!await confirmDialog('Delete ' + r.id + '? This cannot be undone unless you have a backup file.', 'Delete')) return;
    for (const f of r.shelf || []) { try { await NS.filestore.deleteFile(f.id); } catch (e) { /* storage unavailable */ } }
    store.removeRequest(r.id);
    toast('Deleted ' + r.id);
  }

  function exportCsv() {
    const rows = [['ID', 'Received', 'Requester', 'Agency', 'Records requested', 'Format', 'Status', 'Response due', 'First response', 'Window', 'Estimate date', 'Fee', 'Notes']];
    for (const r of store.state.requests) {
      const s = statusOf(r);
      rows.push([r.id, r.receivedDate, r.requesterName, r.agency, r.description, r.format, r.status, s.dueDate, r.firstResponseDate, s.state, r.estimateDate, r.fee, r.notes]);
    }
    download(csv(rows), 'RSA91A_Requests_' + deadlines.todayISO() + '.csv', 'text/csv');
  }

  NS.tracker = { render, edit, STATUSES };
})(typeof self !== 'undefined' ? self : this);
