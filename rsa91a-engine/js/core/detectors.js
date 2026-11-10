/*
 * RSA91A-Engine: sensitive-data detectors.
 *
 * Each detector scans plain text and returns character ranges. The redaction
 * studio maps those ranges back onto page coordinates. Detectors propose; a
 * human reviewer decides. Nothing is redacted until the reviewer accepts it.
 */
(function (root) {
  'use strict';

  function luhnValid(digits) {
    let sum = 0;
    let dbl = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = digits.charCodeAt(i) - 48;
      if (dbl) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
      dbl = !dbl;
    }
    return digits.length >= 13 && sum % 10 === 0;
  }

  function abaRoutingValid(d) {
    if (!/^\d{9}$/.test(d)) return false;
    const n = d.split('').map(Number);
    const sum = 3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8]);
    return sum % 10 === 0 && d !== '000000000';
  }

  function ssnValid(area, group, serial) {
    // 9xx areas are never SSNs but are used for ITINs, which are just as sensitive.
    if (area === '000' || area === '666') return false;
    if (group === '00' || serial === '0000') return false;
    return true;
  }

  // Keeps only the clause directly before a match, so a keyword in an
  // earlier sentence does not vouch for a later date.
  function sameClause(ctx) {
    const cut = Math.max(ctx.lastIndexOf('. '), ctx.lastIndexOf(';'), ctx.lastIndexOf('\n'));
    return cut >= 0 ? ctx.slice(cut + 1) : ctx;
  }

  const STREET_SUFFIX = '(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Boulevard|Blvd|Court|Ct|Way|Place|Pl|Terrace|Ter|Circle|Cir|Highway|Hwy|Route|Rte|Parkway|Pkwy|Square|Sq|Trail|Tr|Hill|Pike)';

  const DETECTORS = [
    {
      id: 'ssn',
      label: 'Social Security number / ITIN',
      defaultOn: true,
      scan(text) {
        const out = [];
        const re = /\b(\d{3})[- ](\d{2})[- ](\d{4})\b/g;
        let m;
        while ((m = re.exec(text))) {
          if (ssnValid(m[1], m[2], m[3])) out.push([m.index, m.index + m[0].length]);
        }
        return out;
      },
    },
    {
      id: 'ssn-bare',
      label: 'Nine-digit number (possible unformatted SSN)',
      defaultOn: false,
      scan(text) {
        const out = [];
        const re = /(?<![\d-])(\d{3})(\d{2})(\d{4})(?![\d-])/g;
        let m;
        while ((m = re.exec(text))) {
          if (ssnValid(m[1], m[2], m[3])) out.push([m.index, m.index + m[0].length]);
        }
        return out;
      },
    },
    {
      id: 'card',
      label: 'Payment card number (Luhn-checked)',
      defaultOn: true,
      scan(text) {
        const out = [];
        const re = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
        let m;
        while ((m = re.exec(text))) {
          const digits = m[0].replace(/[ -]/g, '');
          if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) {
            out.push([m.index, m.index + m[0].length]);
          }
        }
        return out;
      },
    },
    {
      id: 'routing',
      label: 'Bank routing number (ABA-checked, near "routing"/"ABA")',
      defaultOn: true,
      scan(text) {
        const out = [];
        const re = /(?<!\d)\d{9}(?!\d)/g;
        let m;
        while ((m = re.exec(text))) {
          const ctx = text.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
          if (abaRoutingValid(m[0]) && /(routing|aba|rtn)/.test(ctx)) {
            out.push([m.index, m.index + m[0].length]);
          }
        }
        return out;
      },
    },
    {
      id: 'account',
      label: 'Account number (digits after "account"/"acct")',
      defaultOn: true,
      scan(text) {
        const out = [];
        const re = /\b(?:account|acct)\.?\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,}\d)/gi;
        let m;
        while ((m = re.exec(text))) {
          const start = m.index + m[0].length - m[1].length;
          out.push([start, start + m[1].length]);
        }
        return out;
      },
    },
    {
      id: 'phone',
      label: 'Phone number',
      defaultOn: true,
      scan(text) {
        const out = [];
        const re = /(?<![\d-])(?:\+?1[ .-]?)?(?:\(\d{3}\)\s?|\d{3}[ .-])\d{3}[ .-]\d{4}(?![\d-])/g;
        let m;
        while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length]);
        return out;
      },
    },
    {
      id: 'email',
      label: 'Email address',
      defaultOn: true,
      scan(text) {
        const out = [];
        const re = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
        let m;
        while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length]);
        return out;
      },
    },
    {
      id: 'dob',
      label: 'Date near "DOB"/"birth"',
      defaultOn: true,
      scan(text) {
        const out = [];
        const re = /\b(?:0?[1-9]|1[0-2])[/.-](?:0?[1-9]|[12]\d|3[01])[/.-](?:19|20)?\d{2}\b/g;
        let m;
        while ((m = re.exec(text))) {
          const ctx = sameClause(text.slice(Math.max(0, m.index - 30), m.index)).toLowerCase();
          if (/(dob|d\.o\.b|birth|born)/.test(ctx)) out.push([m.index, m.index + m[0].length]);
        }
        return out;
      },
    },
    {
      id: 'date',
      label: 'Any numeric date',
      defaultOn: false,
      scan(text) {
        const out = [];
        const re = /\b(?:0?[1-9]|1[0-2])[/.-](?:0?[1-9]|[12]\d|3[01])[/.-](?:19|20)?\d{2}\b/g;
        let m;
        while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length]);
        return out;
      },
    },
    {
      id: 'address',
      label: 'Street address',
      defaultOn: false,
      scan(text) {
        const out = [];
        const re = new RegExp('\\b\\d{1,6}\\s+(?:[A-Z][A-Za-z.\'-]*\\s+){1,4}' + STREET_SUFFIX + '\\b\\.?', 'g');
        let m;
        while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length]);
        return out;
      },
    },
    {
      id: 'ip',
      label: 'IP address',
      defaultOn: false,
      scan(text) {
        const out = [];
        const re = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
        let m;
        while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length]);
        return out;
      },
    },
  ];

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** Whole-word, case-insensitive matches of each term (names, case numbers, etc.). */
  function scanTerms(text, terms) {
    const out = [];
    for (const raw of terms || []) {
      const term = raw.trim();
      if (!term) continue;
      const pattern = escapeRegExp(term).replace(/\s+/g, '\\s+');
      const re = new RegExp('(?<![\\p{L}\\p{N}])' + pattern + '(?![\\p{L}\\p{N}])', 'giu');
      let m;
      while ((m = re.exec(text))) out.push({ start: m.index, end: m.index + m[0].length, type: 'term', label: 'Term: ' + term });
    }
    return out;
  }

  /**
   * Approximate whole-term matches, for OCR text. Allows up to k character
   * edits (insert, delete, substitute) per term, k = floor(len / 7), min 1,
   * and only for terms of 5+ characters. Sellers' algorithm with start
   * tracking; case-insensitive; runs of whitespace count as one space.
   */
  function scanTermsFuzzy(text, terms, maxEditsFn) {
    const out = [];
    const hay = text.toLowerCase();
    const kFor = maxEditsFn || ((len) => Math.max(1, Math.floor(len / 7)));
    for (const raw of terms || []) {
      const term = raw.trim().replace(/\s+/g, ' ').toLowerCase();
      if (term.length < 5) continue;
      const k = kFor(term.length);
      const m = term.length;
      const n = hay.length;
      // cost[i] and start[i] for the current column j (position in hay).
      let cost = new Array(m + 1);
      let start = new Array(m + 1);
      let pcost = new Array(m + 1);
      let pstart = new Array(m + 1);
      for (let i = 0; i <= m; i++) { pcost[i] = i; pstart[i] = 0; }
      const hits = [];
      for (let j = 1; j <= n; j++) {
        const ch = hay[j - 1] === '\n' || hay[j - 1] === '\t' ? ' ' : hay[j - 1];
        cost[0] = 0; start[0] = j;
        for (let i = 1; i <= m; i++) {
          const sub = pcost[i - 1] + (term[i - 1] === ch ? 0 : 1);
          const del = pcost[i] + 1; // skip a hay char
          const ins = cost[i - 1] + 1; // skip a term char
          let c = sub; let s = pstart[i - 1];
          if (del < c) { c = del; s = pstart[i]; }
          if (ins < c) { c = ins; s = start[i - 1]; }
          cost[i] = c; start[i] = s;
        }
        if (cost[m] <= k) hits.push({ start: start[m], end: j, cost: cost[m] });
        [pcost, cost] = [cost, pcost];
        [pstart, start] = [start, pstart];
      }
      // Keep the best (lowest-cost, then longest) hit among overlapping ones,
      // and require word boundaries so "smithson" does not match "smith".
      hits.sort((a, b) => a.start - b.start || a.cost - b.cost || (b.end - b.start) - (a.end - a.start));
      let last = null;
      for (const h of hits) {
        const before = h.start > 0 ? hay[h.start - 1] : ' ';
        const after = h.end < n ? hay[h.end] : ' ';
        if (/[\p{L}\p{N}]/u.test(before) || /[\p{L}\p{N}]/u.test(after)) continue;
        if (last && h.start < last.end) {
          if (h.cost < last.cost) { out.pop(); } else continue;
        }
        last = h;
        out.push({ start: h.start, end: h.end, type: 'term-fuzzy', label: 'Term (near match, ' + h.cost + ' edit' + (h.cost === 1 ? '' : 's') + '): ' + raw.trim() });
      }
    }
    return out;
  }

  /** User-supplied regular expression. Throws on invalid pattern. */
  function scanRegex(text, source, flags) {
    const re = new RegExp(source, (flags || 'gi').includes('g') ? flags || 'gi' : (flags || '') + 'g');
    const out = [];
    let m;
    let guard = 0;
    while ((m = re.exec(text))) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      out.push({ start: m.index, end: m.index + m[0].length, type: 'regex', label: 'Pattern: /' + source + '/' });
      if (++guard > 100000) break;
    }
    return out;
  }

  /** Runs the enabled detectors. enabledIds: array of detector ids. */
  function scan(text, enabledIds) {
    const enabled = new Set(enabledIds || DETECTORS.filter((d) => d.defaultOn).map((d) => d.id));
    const out = [];
    for (const d of DETECTORS) {
      if (!enabled.has(d.id)) continue;
      for (const [start, end] of d.scan(text)) out.push({ start, end, type: d.id, label: d.label });
    }
    return mergeOverlaps(out);
  }

  /** Drops matches fully contained in an earlier/longer match. */
  function mergeOverlaps(matches) {
    const sorted = matches.slice().sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const out = [];
    for (const m of sorted) {
      const prev = out[out.length - 1];
      if (prev && m.start >= prev.start && m.end <= prev.end) continue;
      out.push(m);
    }
    return out;
  }

  const api = { DETECTORS, scan, scanTerms, scanTermsFuzzy, scanRegex, mergeOverlaps, luhnValid, abaRoutingValid };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RSA91A = root.RSA91A || {}; root.RSA91A.detectors = api; }
})(typeof self !== 'undefined' ? self : this);
