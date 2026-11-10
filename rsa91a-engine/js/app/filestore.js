/*
 * RSA91A-Engine: browser-local file storage (IndexedDB).
 *
 * The request shelf keeps the original files for a request between sessions.
 * File bytes are large, so they live here rather than in the JSON settings
 * store. Review state (marks, withheld pages, sign-off) lives in a second
 * object store so saving a review never rewrites the bytes.
 *
 * Everything stays in this browser on this computer. Private windows and
 * blocked site data make IndexedDB unavailable; every call then rejects and
 * the UI says the shelf is unavailable.
 */
(function (root) {
  'use strict';
  const NS = root.RSA91A = root.RSA91A || {};

  const DB_NAME = 'rsa91a-engine';
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        return reject(new Error('File storage is not available in this browser here.'));
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('files')) {
          const files = db.createObjectStore('files', { keyPath: 'id' });
          files.createIndex('requestId', 'requestId', { unique: false });
        }
        if (!db.objectStoreNames.contains('reviews')) db.createObjectStore('reviews', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Could not open file storage.'));
      req.onblocked = () => reject(new Error('File storage is blocked by another open tab.'));
    });
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
  }

  function tx(storeNames, mode, fn) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(storeNames, mode);
      let result;
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error || new Error('File storage error.'));
      t.onabort = () => reject(t.error || new Error('File storage transaction aborted.'));
      const out = fn(t);
      if (out && typeof out.then === 'function') out.then((r) => { result = r; }, reject);
      else result = out;
    }));
  }

  function reqToPromise(r) {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  /** Stores a file. record: { id, requestId, name, mime, size, sha256, added, bytes: Uint8Array } */
  function putFile(record) {
    return tx(['files'], 'readwrite', (t) => { t.objectStore('files').put(record); });
  }

  function getFile(id) {
    return tx(['files'], 'readonly', (t) => reqToPromise(t.objectStore('files').get(id)));
  }

  /** Files for a request, without bytes (metadata only), in insertion order. */
  function listFiles(requestId) {
    return tx(['files'], 'readonly', (t) => {
      const idx = t.objectStore('files').index('requestId');
      return reqToPromise(idx.getAll(requestId)).then((rows) => rows
        .map((r) => ({ id: r.id, requestId: r.requestId, name: r.name, mime: r.mime, size: r.size, sha256: r.sha256, added: r.added, order: r.order || 0 }))
        .sort((a, b) => a.order - b.order || a.added.localeCompare(b.added)));
    });
  }

  function deleteFile(id) {
    return tx(['files', 'reviews'], 'readwrite', (t) => { t.objectStore('files').delete(id); t.objectStore('reviews').delete(id); });
  }

  /** Review state for a file: { id, marks, withheld: [[page, info]], reviewed, ocrConf, saved } */
  function putReview(review) {
    return tx(['reviews'], 'readwrite', (t) => { t.objectStore('reviews').put(review); });
  }

  function getReview(id) {
    return tx(['reviews'], 'readonly', (t) => reqToPromise(t.objectStore('reviews').get(id)));
  }

  function getReviews(ids) {
    return tx(['reviews'], 'readonly', (t) => Promise.all(ids.map((id) => reqToPromise(t.objectStore('reviews').get(id)))));
  }

  /** Rough usage: total bytes of stored files. */
  function usage() {
    return tx(['files'], 'readonly', (t) => reqToPromise(t.objectStore('files').getAll()).then((rows) => ({
      files: rows.length, bytes: rows.reduce((a, r) => a + (r.size || 0), 0),
    })));
  }

  function available() {
    return openDb().then(() => true, () => false);
  }

  NS.filestore = { putFile, getFile, listFiles, deleteFile, putReview, getReview, getReviews, usage, available };
})(typeof self !== 'undefined' ? self : this);
