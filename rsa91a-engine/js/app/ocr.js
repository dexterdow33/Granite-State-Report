/*
 * RSA91A-Engine: offline OCR for scanned pages.
 *
 * Runs Tesseract (WebAssembly) in a web worker so the page stays responsive.
 * The app opens from file:// with no server, where a worker can neither
 * import scripts nor fetch, so the worker is self-contained: the core (with
 * its WebAssembly embedded), the gunzip, the English model and the worker
 * logic below are joined into one Blob and the worker starts from that. If
 * the browser refuses a Blob worker, the same engine runs on the main thread.
 *
 * Output is a list of words with pixel boxes in the recognized image. OCR is
 * imperfect; every word carries a confidence, and the studio labels OCR text.
 */
(function (root) {
  'use strict';
  const NS = root.RSA91A = root.RSA91A || {};

  const VENDOR = 'js/vendor/';
  const state = { mode: null, ready: null, worker: null, api: null, module: null, seq: 0, pending: new Map(), statusCb: null };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  async function pickCore() {
    try {
      if (!root.wasmFeatureDetect) await loadScript(VENDOR + 'wasm-feature-detect.js');
      if (await root.wasmFeatureDetect.simd()) return ['coreSimd', 'tesseract-core-simd-lstm.src.js'];
    } catch (e) { /* fall through */ }
    return ['core', 'tesseract-core-lstm.src.js'];
  }

  async function loadSources() {
    const [coreKey, coreFile] = await pickCore();
    const SRC = root.RSA91A_OCR_SRC || {};
    if (!SRC[coreKey]) await loadScript(VENDOR + coreFile);
    if (!root.RSA91A_OCR_SRC.gunzip) await loadScript(VENDOR + 'gunzip.src.js');
    if (!root.RSA91A_TESSDATA || !root.RSA91A_TESSDATA.eng) await loadScript(VENDOR + 'eng.traineddata.js');
    return { core: root.RSA91A_OCR_SRC[coreKey], gunzip: root.RSA91A_OCR_SRC.gunzip, eng: root.RSA91A_TESSDATA.eng };
  }

  /*
   * Engine driver. Runs inside the worker, or on the main thread as fallback.
   * It is written as a function and stringified into the worker Blob, so it
   * must not close over anything outside itself.
   */
  function engineDriver(scope, Core, Zlib, engB64) {
    let TessModule = null;
    let api = null;
    function b64(s) {
      const bin = atob(s);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    async function init(onStatus) {
      onStatus('Starting OCR engine...');
      TessModule = await Core({});
      onStatus('Loading English model...');
      const data = new Zlib.Gunzip(b64(engB64)).decompress();
      TessModule.FS.writeFile('/eng.traineddata', data);
      api = new TessModule.TessBaseAPI();
      if (api.Init(null, 'eng', 1 /* OEM LSTM_ONLY */) === -1) throw new Error('OCR engine failed to initialize.');
      api.SetVariable('tessedit_pageseg_mode', '3'); // fully automatic page segmentation
      api.SetVariable('preserve_interword_spaces', '1');
      onStatus('');
    }
    function recognize(pngBytes, dpi) {
      api.SetVariable('user_defined_dpi', String(Math.round(dpi || 300)));
      TessModule.FS.writeFile('/input', pngBytes);
      if (api.SetImageFile(1, 0) === 1) throw new Error('OCR could not read the page image.');
      api.Recognize(null);
      const tsv = api.GetTSVText();
      const meanConf = api.MeanTextConf();
      try { TessModule.FS.unlink('/input'); } catch (e) { /* ignore */ }
      const words = [];
      for (const row of tsv.split('\n')) {
        const c = row.split('\t');
        if (c.length < 12 || c[0] !== '5') continue; // level 5 = word
        const text = c.slice(11).join('\t').trim();
        if (!text) continue;
        const left = Number(c[6]); const top = Number(c[7]); const w = Number(c[8]); const h = Number(c[9]);
        words.push({ text, conf: Number(c[10]), x0: left, y0: top, x1: left + w, y1: top + h, line: c[2] + '.' + c[3] + '.' + c[4] });
      }
      return { words, meanConf };
    }
    return { init, recognize };
  }

  /* Worker body: message loop around the driver. Stringified into the Blob. */
  function workerMain() {
    /* global TesseractCore, Zlib, RSA91A_TESSDATA, RSA91A_ENGINE_DRIVER */
    const driver = RSA91A_ENGINE_DRIVER(self, TesseractCore, Zlib, RSA91A_TESSDATA.eng);
    let ready = null;
    self.onmessage = async (ev) => {
      const { id, action, png, dpi } = ev.data;
      const status = (text) => self.postMessage({ id, status: text });
      try {
        if (!ready) ready = driver.init(status);
        await ready;
        if (action === 'init') return self.postMessage({ id, ok: true });
        if (action === 'recognize') {
          const result = driver.recognize(new Uint8Array(png), dpi);
          return self.postMessage({ id, ok: true, result });
        }
        throw new Error('Unknown OCR action ' + action);
      } catch (e) {
        self.postMessage({ id, error: String(e && e.message || e) });
      }
    };
  }

  function buildWorkerBlob(src) {
    // The worker scope has no `window`; the vendored strings assign to it.
    const parts = [
      'var window = self;\n',
      src.core, '\n',
      src.gunzip, '\n',
      'var RSA91A_TESSDATA = { eng: ' + JSON.stringify(src.eng) + ' };\n',
      'var RSA91A_ENGINE_DRIVER = ' + engineDriver.toString() + ';\n',
      '(' + workerMain.toString() + ')();\n',
    ];
    return new Blob(parts, { type: 'text/javascript' });
  }

  function call(action, payload, transfer, onStatus) {
    return new Promise((resolve, reject) => {
      const id = ++state.seq;
      state.pending.set(id, { resolve, reject, onStatus });
      state.worker.postMessage(Object.assign({ id, action }, payload), transfer || []);
    });
  }

  function onWorkerMessage(ev) {
    const { id, status, ok, result, error } = ev.data;
    const p = state.pending.get(id);
    if (!p) return;
    if (status !== undefined) { if (p.onStatus) p.onStatus(status); return; }
    state.pending.delete(id);
    if (ok) p.resolve(result);
    else p.reject(new Error(error || 'OCR failed.'));
  }

  async function startWorker(src, onStatus) {
    const url = URL.createObjectURL(buildWorkerBlob(src));
    try {
      const w = new Worker(url);
      w.onmessage = onWorkerMessage;
      const failed = new Promise((_, reject) => { w.onerror = (e) => reject(new Error('OCR worker error: ' + (e.message || 'unknown'))); });
      state.worker = w;
      await Promise.race([call('init', {}, null, onStatus), failed]);
      state.mode = 'worker';
    } catch (e) {
      try { if (state.worker) state.worker.terminate(); } catch (e2) { /* ignore */ }
      state.worker = null;
      state.pending.clear();
      throw e;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function startMainThread(src, onStatus) {
    // Load the core and gunzip as Blob scripts (inline scripts are blocked by CSP).
    for (const text of [src.core, src.gunzip]) {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
      try { await loadScript(url); } finally { URL.revokeObjectURL(url); }
    }
    if (typeof root.TesseractCore !== 'function' || !root.Zlib) throw new Error('OCR core did not load.');
    state.api = engineDriver(root, root.TesseractCore, root.Zlib, src.eng);
    await state.api.init(onStatus);
    state.mode = 'main';
  }

  /** Loads the engine once. Resolves when recognize() can be called. */
  function ready(onStatus) {
    if (state.ready) return state.ready;
    const status = onStatus || (() => {});
    state.ready = (async () => {
      status('Loading OCR engine (first use only)...');
      const src = await loadSources();
      try {
        await startWorker(src, status);
      } catch (e) {
        console.warn('OCR worker unavailable, running on the main thread:', e.message);
        await startMainThread(src, status);
      }
      status('');
      return state.mode;
    })();
    state.ready.catch(() => { state.ready = null; });
    return state.ready;
  }

  function canvasToPng(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (!blob) return reject(new Error('Could not encode page for OCR.'));
        resolve(new Uint8Array(await blob.arrayBuffer()));
      }, 'image/png');
    });
  }

  /**
   * Recognizes the text in a canvas rendered at `dpi`.
   * Returns { words: [{ text, conf, x0, y0, x1, y1, line }], meanConf } with
   * pixel coordinates in the canvas. `line` is a line id for grouping.
   */
  async function recognize(canvas, dpi, onStatus) {
    await ready(onStatus);
    const png = await canvasToPng(canvas);
    if (state.mode === 'worker') {
      return call('recognize', { png: png.buffer, dpi }, [png.buffer], onStatus);
    }
    return state.api.recognize(png, dpi);
  }

  NS.ocr = { ready, recognize, get loaded() { return !!state.mode; }, get mode() { return state.mode; } };
})(typeof self !== 'undefined' ? self : this);
