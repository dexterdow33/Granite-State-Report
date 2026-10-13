/*
 * RSA91A-Engine: the request shelf.
 *
 * Files attached to a request stay on the shelf between sessions, with their
 * review state (marks, withheld pages, OCR confidence, sign-off). The request
 * record in the settings store keeps a light summary of the shelf so the
 * tracker can show it without touching file storage.
 */
(function (root) {
  'use strict';
  const NS = root.RSA91A = root.RSA91A || {};
  const { filestore, store, engine } = NS;

  function newId() {
    const a = new Uint8Array(12);
    crypto.getRandomValues(a);
    return 'f_' + Array.from(a).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function summarize(requestId, files, reviews) {
    const req = store.getRequest(requestId);
    if (!req) return;
    req.shelf = files.map((f, i) => {
      const r = reviews ? reviews[i] : null;
      return { id: f.id, name: f.name, size: f.size, sha256: f.sha256, added: f.added, reviewed: r && r.reviewed ? { by: r.reviewed.by, at: r.reviewed.at } : null, marks: r && r.marks ? r.marks.length : 0 };
    });
    store.upsertRequest(req);
  }

  async function refreshSummary(requestId) {
    const files = await filestore.listFiles(requestId);
    const reviews = await filestore.getReviews(files.map((f) => f.id));
    summarize(requestId, files, reviews);
    return files;
  }

  /**
   * Adds files to a request's shelf. items: [{ name, mime, bytes: Uint8Array, sha256?, review? }]
   * Returns the stored metadata records.
   */
  async function add(requestId, items) {
    const existing = await filestore.listFiles(requestId);
    let order = existing.length ? Math.max(...existing.map((f) => f.order)) + 1 : 0;
    const out = [];
    for (const it of items) {
      const sha256 = it.sha256 || await engine.sha256Hex(it.bytes);
      const dup = existing.find((f) => f.sha256 === sha256);
      if (dup) { out.push(Object.assign({ duplicate: true }, dup)); continue; }
      const rec = { id: newId(), requestId, name: it.name, mime: it.mime, size: it.bytes.byteLength, sha256, added: new Date().toISOString(), order: order++, bytes: it.bytes };
      await filestore.putFile(rec);
      if (it.review) await filestore.putReview(Object.assign({ id: rec.id, saved: new Date().toISOString() }, it.review));
      out.push({ id: rec.id, requestId, name: rec.name, mime: rec.mime, size: rec.size, sha256, added: rec.added, order: rec.order });
    }
    await refreshSummary(requestId);
    return out;
  }

  async function list(requestId) {
    return refreshSummary(requestId);
  }

  async function remove(requestId, id) {
    await filestore.deleteFile(id);
    await refreshSummary(requestId);
  }

  /** Loads a file's bytes and review state. */
  async function load(id) {
    const file = await filestore.getFile(id);
    if (!file) throw new Error('File is no longer on the shelf.');
    const review = await filestore.getReview(id);
    return { file, review };
  }

  /** Saves review state for a shelf file and refreshes the request summary. */
  async function saveReview(requestId, id, review) {
    await filestore.putReview(Object.assign({ id, saved: new Date().toISOString() }, review));
    await refreshSummary(requestId);
  }

  /** Stable fingerprint of what would be redacted; a sign-off is valid only while it matches. */
  function fingerprint(marks, withheld) {
    const accepted = marks.filter((m) => m.status === 'accepted').map((m) => [m.page, m.rects, m.citationId || '', m.reason || '']);
    accepted.sort((a, b) => a[0] - b[0] || JSON.stringify(a[1]).localeCompare(JSON.stringify(b[1])));
    const pages = [...withheld].map(([p, w]) => [p, w.citationId || '', w.reason || '']).sort((a, b) => a[0] - b[0]);
    const proposed = marks.filter((m) => m.status === 'proposed').length;
    return JSON.stringify({ accepted, pages, proposed });
  }

  NS.shelf = { add, list, remove, load, saveReview, refreshSummary, fingerprint };
})(typeof self !== 'undefined' ? self : this);
