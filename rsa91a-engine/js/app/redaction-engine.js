/*
 * RSA91A-Engine: secure redaction engine (browser).
 *
 * How the output is made safe:
 *  1. Every page is rendered to pixels at the chosen resolution.
 *  2. Accepted redaction boxes are painted onto those pixels.
 *  3. A brand-new PDF is built from the images alone. No text layer, fonts,
 *     annotations, form fields, attachments, scripts, bookmarks, hidden
 *     layers, or document metadata from the source file are carried over.
 *  4. The output is re-opened and checked: text layer, annotations,
 *     attachments, scripts, metadata, and page count.
 *
 * Covering text with a black shape (the common failure) leaves the words in
 * the file. This engine never does that; there is nothing under the box.
 */
(function (root) {
  'use strict';

  const NS = root.RSA91A = root.RSA91A || {};
  const { textmap, detectors } = NS;

  let workerReady = null;
  function ensurePdfJs() {
    if (workerReady) return workerReady;
    const pdfjsLib = root.pdfjsLib;
    if (!pdfjsLib) throw new Error('PDF library failed to load (js/vendor/pdf.min.js).');
    if (location.protocol === 'file:') {
      // Browsers block Web Workers from file:// pages. Load the worker code as a
      // plain script so pdf.js runs it on the main thread instead.
      workerReady = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/vendor/pdf.worker.min.js';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Could not load js/vendor/pdf.worker.min.js'));
        document.head.appendChild(s);
      });
    } else {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';
      workerReady = Promise.resolve();
    }
    return workerReady;
  }

  async function sha256Hex(bytes) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      return 'unavailable';
    }
  }

  /** Wraps a JPEG or PNG in a one-page PDF so images go through the same pipeline. */
  async function imageToPdf(bytes, mime) {
    const { PDFDocument } = root.PDFLib;
    const doc = await PDFDocument.create();
    const img = mime === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const page = doc.addPage([img.width * 0.75, img.height * 0.75]); // 96 dpi -> points
    page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
    return doc.save();
  }

  class SourceDocument {
    static async open(bytes, fileName, mime) {
      await ensurePdfJs();
      const original = new Uint8Array(bytes);
      const hash = await sha256Hex(original);
      let pdfBytes = original;
      let isImage = false;
      if (mime === 'image/png' || mime === 'image/jpeg') {
        pdfBytes = new Uint8Array(await imageToPdf(original, mime));
        isImage = true;
      }
      const task = root.pdfjsLib.getDocument({
        data: pdfBytes.slice(),
        isEvalSupported: false,
        enableXfa: false,
        disableFontFace: false,
      });
      let pdf;
      try {
        pdf = await task.promise;
      } catch (e) {
        if (e && e.name === 'PasswordException') {
          throw new Error('This PDF is password-protected. Remove the password in the program that created it, then open it again.');
        }
        throw e;
      }
      const d = new SourceDocument();
      d.pdf = pdf;
      d.fileName = fileName;
      d.sha256 = hash;
      d.byteLength = original.byteLength;
      d.isImage = isImage;
      d.numPages = pdf.numPages;
      d.textCache = new Map();
      d.measureCanvas = document.createElement('canvas').getContext('2d');
      return d;
    }

    async page(i) {
      return this.pdf.getPage(i + 1);
    }

    /** Cached text for page i: { items, text, segments, measure, styles }. */
    async pageText(i) {
      if (this.textCache.has(i)) return this.textCache.get(i);
      const page = await this.page(i);
      const tc = await page.getTextContent({ includeMarkedContent: false });
      const items = tc.items.filter((it) => typeof it.str === 'string');
      const { text, segments } = textmap.buildPageText(items);
      const ctx = this.measureCanvas;
      const styles = tc.styles || {};
      const measure = (str, it) => {
        const fam = (styles[it.fontName] && styles[it.fontName].fontFamily) || 'sans-serif';
        ctx.font = '100px ' + fam;
        return ctx.measureText(str).width;
      };
      const entry = { items, text, segments, measure };
      this.textCache.set(i, entry);
      return entry;
    }

    /** Does page i have any extractable text? (Scanned pages usually do not.) */
    async hasText(i) {
      const t = await this.pageText(i);
      return t.text.replace(/\s+/g, '').length > 0;
    }

    /** Pages (0-based) with no text layer and no OCR text yet. */
    async textlessPages() {
      const out = [];
      for (let i = 0; i < this.numPages; i++) if (!await this.hasText(i)) out.push(i);
      return out;
    }

    /**
     * Runs OCR on page i and installs the result as that page's text layer,
     * shaped like pdf.js text items so detection, geometry and textUnder work
     * unchanged. dpi controls the render resolution fed to the engine.
     * Returns { words, meanConf }.
     */
    async ocrPage(i, dpi, onStatus) {
      const scale = (dpi || 300) / 72;
      const canvas = document.createElement('canvas');
      const viewport = await this.render(i, canvas, scale);
      const result = await NS.ocr.recognize(canvas, dpi || 300, onStatus);
      canvas.width = 0; canvas.height = 0;

      // Group words by OCR line, in reading order, and turn each word into an
      // item positioned in PDF user space. A trailing space is folded into the
      // word (with width reaching the next word) so joins are explicit.
      const lines = new Map();
      for (const w of result.words) {
        if (!lines.has(w.line)) lines.set(w.line, []);
        lines.get(w.line).push(w);
      }
      const items = [];
      for (const ws of lines.values()) {
        ws.sort((a, b) => a.x0 - b.x0);
        for (let k = 0; k < ws.length; k++) {
          const w = ws[k];
          const last = k === ws.length - 1;
          const [px0, py1] = viewport.convertToPdfPoint(w.x0, w.y1); // bottom-left
          const [px1, py0] = viewport.convertToPdfPoint(w.x1, w.y0); // top-right
          const size = Math.abs(py0 - py1) || 8;
          let width = Math.abs(px1 - px0);
          let str = w.text;
          if (!last) {
            const [nx0] = viewport.convertToPdfPoint(ws[k + 1].x0, ws[k + 1].y0);
            width = Math.max(width, Math.abs(nx0 - px0));
            str += ' ';
          }
          // Text sits on a baseline; the box bottom is close enough for
          // redaction geometry, which pads every side anyway.
          const baseline = Math.min(py0, py1) + size * 0.2;
          items.push({
            str, transform: [size, 0, 0, size, Math.min(px0, px1), baseline], width, height: size,
            hasEOL: last, fontName: 'ocr', conf: w.conf,
          });
        }
      }
      const { text, segments } = textmap.buildPageText(items);
      const measure = (s) => s.length; // monospace estimate; OCR boxes are per word anyway
      this.textCache.set(i, { items, text, segments, measure, ocr: true, meanConf: result.meanConf });
      this.ocrPages = this.ocrPages || new Set();
      this.ocrPages.add(i);
      return result;
    }

    /** True when page i's text came from OCR rather than the file. */
    isOcr(i) {
      return !!(this.ocrPages && this.ocrPages.has(i));
    }

    /**
     * Finds sensitive data. opts: { detectorIds, terms, regexes: [{source, flags}] }
     * Returns proposed marks: { page, rects, text, type, label }.
     */
    async scan(opts, onProgress) {
      const out = [];
      for (let i = 0; i < this.numPages; i++) {
        const t = await this.pageText(i);
        let matches = detectors.scan(t.text, opts.detectorIds);
        matches = matches.concat(detectors.scanTerms(t.text, opts.terms));
        // OCR misreads characters; on OCR pages also accept near matches of each term.
        if (t.ocr) matches = matches.concat(detectors.scanTermsFuzzy(t.text, opts.terms));
        for (const r of opts.regexes || []) matches = matches.concat(detectors.scanRegex(t.text, r.source, r.flags));
        matches = detectors.mergeOverlaps(matches);
        for (const m of matches) {
          const rects = textmap.rangeToRects(t.items, t.segments, m.start, m.end, t.measure);
          if (rects.length) out.push({ page: i, rects, text: t.text.slice(m.start, m.end), type: m.type, label: (t.ocr ? 'OCR: ' : '') + m.label, ocr: !!t.ocr });
        }
        // Form-field values and comment text print on the page but are not part of
        // the text layer. Scan them too and propose covering the whole field/note.
        for (const a of await this.annotations(i)) {
          const val = annotationText(a);
          if (!val || !a.rect) continue;
          let hits = detectors.scan(val, opts.detectorIds).concat(detectors.scanTerms(val, opts.terms));
          for (const r of opts.regexes || []) hits = hits.concat(detectors.scanRegex(val, r.source, r.flags));
          if (hits.length) {
            out.push({ page: i, rects: [normRect(a.rect)], text: val, type: 'annotation',
              label: (a.subtype === 'Widget' ? 'Form field' : 'Comment') + ': ' + hits[0].label });
          }
        }
        if (onProgress) onProgress(i + 1, this.numPages);
      }
      return out;
    }

    /** Annotations (form fields, comments, stamps) on page i. */
    async annotations(i) {
      const page = await this.page(i);
      return (await page.getAnnotations({ intent: 'display' })).filter((a) => a.subtype !== 'Link');
    }

    /** Text lying under a rectangle (PDF space); used to log what a manual box covers. */
    async textUnder(i, rect) {
      const t = await this.pageText(i);
      const parts = [];
      for (const seg of t.segments) {
        const it = t.items[seg.item];
        for (let k = 0; k < it.str.length; k++) {
          const [r] = textmap.rangeToRects(t.items, t.segments, seg.start + k, seg.start + k + 1, t.measure, 0);
          const cx = (r[0] + r[2]) / 2;
          const cy = (r[1] + r[3]) / 2;
          if (cx >= rect[0] && cx <= rect[2] && cy >= rect[1] && cy <= rect[3]) parts.push({ pos: seg.start + k, ch: it.str[k] });
        }
      }
      if (!parts.length) return '';
      let s = '';
      let last = -2;
      for (const p of parts) {
        if (last >= 0 && p.pos !== last + 1) s += ' ';
        s += p.ch;
        last = p.pos;
      }
      return s.trim();
    }

    /** Renders page i into canvas at `scale` (1 = 72 dpi). Returns the viewport. */
    async render(i, canvas, scale) {
      const page = await this.page(i);
      const viewport = page.getViewport({ scale });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvasContext: ctx,
        viewport,
        annotationMode: root.pdfjsLib.AnnotationMode.ENABLE,
        intent: 'display',
      }).promise;
      return viewport;
    }

    destroy() {
      if (this.pdf) this.pdf.destroy();
    }
  }

  function annotationText(a) {
    const parts = [];
    const v = a.fieldValue;
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) parts.push(v.join(' '));
    if (a.contentsObj && a.contentsObj.str) parts.push(a.contentsObj.str);
    if (a.titleObj && a.titleObj.str) parts.push(a.titleObj.str);
    return parts.join(' ').trim();
  }

  function normRect(r) {
    return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
  }

  function toViewportRect(viewport, r) {
    return normRect(viewport.convertToViewportRectangle(r));
  }

  function paintBox(ctx, vr, color, label, pxPerPt) {
    const [x0, y0, x1, y1] = vr;
    const w = x1 - x0;
    const h = y1 - y0;
    ctx.fillStyle = color;
    ctx.fillRect(Math.floor(x0), Math.floor(y0), Math.ceil(w) + 1, Math.ceil(h) + 1);
    if (!label) return;
    let size = Math.min(h * 0.62, 11 * pxPerPt);
    if (size < 5 * pxPerPt) return;
    ctx.font = 'bold ' + size + 'px Helvetica, Arial, sans-serif';
    const text = label.replace(/^RSA\s+/, '');
    if (ctx.measureText(text).width > w * 0.92) return;
    ctx.fillStyle = color === '#ffffff' ? '#000000' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x0 + w / 2, y0 + h / 2);
  }

  function canvasToBytes(canvas, format, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (!blob) return reject(new Error('Could not encode page image.'));
        resolve(new Uint8Array(await blob.arrayBuffer()));
      }, format === 'png' ? 'image/png' : 'image/jpeg', quality);
    });
  }

  function batesLabel(prefix, n, digits) {
    return (prefix || '') + String(n).padStart(digits || 6, '0');
  }

  function wrapText(text, font, size, maxWidth) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const out = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        out.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
    return out;
  }

  // pdf-lib's standard fonts only encode WinAnsi; replace anything else.
  function ascii(s) {
    return String(s || '')
      .replace(/[‘’]/g, '\'').replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-').replace(/…/g, '...')
      .replace(/[^\x20-\x7E\n]/g, '?');
  }

  /**
   * Builds the redacted PDF.
   * marks: accepted marks [{ page, rects, citation }] (citation = display cite)
   * withheld: Map(pageIndex -> { cite, reason })
   * options: { dpi, format ('jpeg'|'png'), quality, color, labels, bates: { prefix, start, digits } | null, title }
   */
  async function exportRedacted(src, marks, withheld, options, onProgress) {
    const { PDFDocument, StandardFonts, rgb } = root.PDFLib;
    const o = Object.assign({ dpi: 200, format: 'jpeg', quality: 0.92, color: '#000000', labels: true }, options);
    const scale = o.dpi / 72;
    const out = await PDFDocument.create();
    const helv = await out.embedFont(StandardFonts.Helvetica);
    const helvBold = await out.embedFont(StandardFonts.HelveticaBold);
    const canvas = document.createElement('canvas');
    const stamps = [];
    const byPage = new Map();
    for (const m of marks) {
      if (!byPage.has(m.page)) byPage.set(m.page, []);
      byPage.get(m.page).push(m);
    }

    for (let i = 0; i < src.numPages; i++) {
      const pdfPage = await src.page(i);
      const vp1 = pdfPage.getViewport({ scale: 1 });
      const W = vp1.width;
      const H = vp1.height;
      const page = out.addPage([W, H]);
      const bates = o.bates ? batesLabel(o.bates.prefix, (o.bates.start || 1) + i, o.bates.digits) : null;

      if (withheld && withheld.has(i)) {
        const w = withheld.get(i);
        page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
        const lines = ['PAGE WITHHELD IN FULL', ascii(w.cite || '')];
        let y = H * 0.62;
        for (const [k, text] of lines.entries()) {
          const f = k === 0 ? helvBold : helv;
          const size = k === 0 ? 20 : 14;
          page.drawText(text, { x: (W - f.widthOfTextAtSize(text, size)) / 2, y, size, font: f });
          y -= size + 12;
        }
        for (const l of wrapText(ascii(w.reason), helv, 11, W * 0.7)) {
          page.drawText(l, { x: (W - helv.widthOfTextAtSize(l, 11)) / 2, y, size: 11, font: helv });
          y -= 15;
        }
        stamps.push('PAGE WITHHELD IN FULL', ascii(w.cite || ''), ...wrapText(ascii(w.reason), helv, 11, W * 0.7));
      } else {
        const viewport = await src.render(i, canvas, scale);
        const ctx = canvas.getContext('2d');
        for (const m of byPage.get(i) || []) {
          for (const r of m.rects) paintBox(ctx, toViewportRect(viewport, r), o.color, o.labels ? m.citation : null, scale);
        }
        const imgBytes = await canvasToBytes(canvas, o.format, o.quality);
        const img = o.format === 'png' ? await out.embedPng(imgBytes) : await out.embedJpg(imgBytes);
        page.drawImage(img, { x: 0, y: 0, width: W, height: H });
      }

      if (bates) {
        const size = 8;
        const tw = helv.widthOfTextAtSize(bates, size);
        page.drawRectangle({ x: W - tw - 22, y: 10, width: tw + 8, height: size + 6, color: rgb(1, 1, 1) });
        page.drawText(bates, { x: W - tw - 18, y: 13, size, font: helv, color: rgb(0, 0, 0) });
        stamps.push(bates);
      }
      canvas.width = 0; canvas.height = 0;
      if (onProgress) onProgress(i + 1, src.numPages);
    }

    // Replace every metadata field pdf-lib would otherwise fill in.
    out.setTitle(ascii(o.title || 'Redacted record'), { showInWindowTitleBar: false });
    out.setAuthor('');
    out.setSubject('');
    out.setKeywords([]);
    out.setProducer('RSA91A-Engine');
    out.setCreator('RSA91A-Engine');
    const now = new Date();
    out.setCreationDate(now);
    out.setModificationDate(now);
    const bytes = await out.save({ useObjectStreams: true });
    return { bytes, stamps };
  }

  /**
   * Re-opens the output and confirms nothing leaked.
   * sensitive: strings that must not appear. allowed: strings the engine itself stamped.
   */
  async function verify(bytes, expectedPages, sensitive, allowed) {
    await ensurePdfJs();
    const pdf = await root.pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    const report = { checks: [], pass: true, sha256: await sha256Hex(bytes), bytes: bytes.byteLength };
    const add = (name, ok, detail) => {
      report.checks.push({ name, ok, detail });
      if (!ok) report.pass = false;
    };

    add('Page count matches source', pdf.numPages === expectedPages, pdf.numPages + ' of ' + expectedPages);

    let stray = '';
    let annots = 0;
    const found = new Set();
    const allowedNorm = (allowed || []).map((s) => s.replace(/\s+/g, ''));
    for (let i = 1; i <= pdf.numPages; i++) {
      const p = await pdf.getPage(i);
      const tc = await p.getTextContent();
      let pageText = tc.items.map((it) => it.str || '').join(' ');
      const flat = pageText.replace(/\s+/g, '');
      let rest = flat;
      for (const a of allowedNorm) if (a) rest = rest.split(a).join('');
      stray += rest;
      for (const s of sensitive || []) {
        const n = s.replace(/\s+/g, '');
        if (n.length >= 3 && flat.toLowerCase().includes(n.toLowerCase())) found.add(s);
      }
      annots += (await p.getAnnotations()).length;
    }
    add('No text layer beyond engine stamps', stray.length === 0, stray.length ? stray.length + ' unexpected characters' : 'Only Bates / slip-sheet text present');
    add('No redacted string appears in output', found.size === 0, found.size ? found.size + ' found' : (sensitive || []).length + ' strings checked');
    add('No annotations or form fields', annots === 0, annots + ' found');
    const attachments = await pdf.getAttachments();
    add('No embedded files', !attachments || Object.keys(attachments).length === 0, attachments ? Object.keys(attachments).length + ' found' : 'none');
    const js = await pdf.getJSActions();
    add('No scripts', !js || Object.keys(js).length === 0, js ? 'present' : 'none');
    const outline = await pdf.getOutline();
    add('No bookmarks carried over', !outline || outline.length === 0, outline ? outline.length + ' found' : 'none');
    const meta = await pdf.getMetadata();
    const info = meta.info || {};
    const leaked = ['Author', 'Subject', 'Keywords'].filter((k) => info[k]);
    add('Metadata stripped', leaked.length === 0 && !meta.metadata, leaked.length ? 'Present: ' + leaked.join(', ') : 'Producer: ' + (info.Producer || '') + '; no XMP');
    pdf.destroy();
    report.leaks = Array.from(found);
    return report;
  }

  /** Public redaction log (Vaughn-style index). Never includes the redacted content. */
  async function buildLogPdf(meta, rows) {
    const { PDFDocument, StandardFonts, rgb } = root.PDFLib;
    const doc = await PDFDocument.create();
    const f = await doc.embedFont(StandardFonts.Helvetica);
    const fb = await doc.embedFont(StandardFonts.HelveticaBold);
    const W = 612;
    const H = 792;
    const M = 50;
    let page = doc.addPage([W, H]);
    let y = H - M;
    const text = (s, x, size, font, color) => page.drawText(ascii(s), { x, y, size, font: font || f, color: color || rgb(0, 0, 0) });
    const newPage = () => { page = doc.addPage([W, H]); y = H - M; };

    text('Redaction Log', M, 18, fb); y -= 24;
    for (const [k, v] of meta) {
      for (const [n, l] of wrapText(ascii(k + ': ' + v), f, 9.5, W - 2 * M).entries()) {
        text(l, M + (n ? 12 : 0), 9.5); y -= 13;
      }
    }
    y -= 8;
    const cols = [
      { h: '#', x: M, w: 22 },
      { h: 'Page', x: M + 22, w: 70 },
      { h: 'Scope', x: M + 92, w: 70 },
      { h: 'Exemption', x: M + 162, w: 90 },
      { h: 'Reason', x: M + 252, w: W - M - (M + 252) },
    ];
    const header = () => {
      page.drawRectangle({ x: M - 4, y: y - 4, width: W - 2 * M + 8, height: 16, color: rgb(0.92, 0.92, 0.92) });
      for (const c of cols) text(c.h, c.x, 9, fb);
      y -= 18;
    };
    header();
    for (const r of rows) {
      const cells = [String(r.n), r.page, r.scope, r.cite, r.reason].map((v, k) => wrapText(ascii(v), f, 8.5, cols[k].w - 6));
      const height = Math.max(...cells.map((c) => c.length)) * 11 + 4;
      if (y - height < M) { newPage(); header(); }
      for (const [k, c] of cells.entries()) {
        let yy = y;
        for (const l of c) { page.drawText(l, { x: cols[k].x, y: yy, size: 8.5, font: f }); yy -= 11; }
      }
      y -= height;
      page.drawLine({ start: { x: M - 4, y: y + 6 }, end: { x: W - M + 4, y: y + 6 }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
    }
    y -= 10;
    if (y < M + 30) newPage();
    for (const l of wrapText('This log lists each redaction and page withheld, the exemption relied on, and the reason. It does not reproduce the withheld content.', f, 8, W - 2 * M)) {
      text(l, M, 8, f, rgb(0.3, 0.3, 0.3)); y -= 10;
    }
    doc.setProducer('RSA91A-Engine');
    doc.setCreator('RSA91A-Engine');
    doc.setTitle('Redaction Log');
    return doc.save();
  }

  /** Concatenates several PDFs (as bytes) into one, in order. Used for a combined batch output. */
  async function mergePdfs(list, title) {
    const { PDFDocument } = root.PDFLib;
    const out = await PDFDocument.create();
    for (const bytes of list) {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      for (const p of pages) out.addPage(p);
    }
    out.setTitle(ascii(title || 'Redacted production'));
    out.setAuthor(''); out.setSubject(''); out.setKeywords([]);
    out.setProducer('RSA91A-Engine'); out.setCreator('RSA91A-Engine');
    const now = new Date();
    out.setCreationDate(now); out.setModificationDate(now);
    return out.save({ useObjectStreams: true });
  }

  NS.engine = { SourceDocument, exportRedacted, verify, buildLogPdf, mergePdfs, sha256Hex, batesLabel, toViewportRect, normRect, ascii, wrapText };
})(typeof self !== 'undefined' ? self : this);
