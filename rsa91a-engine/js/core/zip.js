/*
 * RSA91A-Engine: minimal ZIP writer (store method, no compression).
 *
 * Batch productions bundle several PDFs, a log and an audit file into one
 * download. PDFs built from JPEG/PNG pages do not compress further, so
 * storing is fine and keeps this small and dependency-free.
 */
(function (root) {
  'use strict';

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(d) {
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    return { date, time };
  }

  function encodeName(name) {
    return new TextEncoder().encode(name.replace(/\\/g, '/').replace(/^\/+/, ''));
  }

  /**
   * entries: [{ name, data: Uint8Array|string, date?: Date }]
   * Returns a Uint8Array holding the archive.
   */
  function build(entries) {
    const files = entries.map((e) => {
      const data = typeof e.data === 'string' ? new TextEncoder().encode(e.data) : new Uint8Array(e.data);
      return { name: encodeName(e.name), data, crc: crc32(data), dt: dosDateTime(e.date || new Date()) };
    });
    let size = 0;
    for (const f of files) size += 30 + f.name.length + f.data.length + 46 + f.name.length;
    size += 22;
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    let pos = 0;
    const offsets = [];
    const u16 = (v) => { view.setUint16(pos, v, true); pos += 2; };
    const u32 = (v) => { view.setUint32(pos, v >>> 0, true); pos += 4; };
    const put = (bytes) => { out.set(bytes, pos); pos += bytes.length; };

    for (const f of files) {
      offsets.push(pos);
      u32(0x04034b50); u16(20); u16(0x0800 /* UTF-8 names */); u16(0 /* store */);
      u16(f.dt.time); u16(f.dt.date); u32(f.crc); u32(f.data.length); u32(f.data.length);
      u16(f.name.length); u16(0);
      put(f.name); put(f.data);
    }
    const cdStart = pos;
    files.forEach((f, i) => {
      u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0);
      u16(f.dt.time); u16(f.dt.date); u32(f.crc); u32(f.data.length); u32(f.data.length);
      u16(f.name.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(offsets[i]);
      put(f.name);
    });
    const cdSize = pos - cdStart;
    u32(0x06054b50); u16(0); u16(0); u16(files.length); u16(files.length); u32(cdSize); u32(cdStart); u16(0);
    return out;
  }

  const api = { build, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RSA91A = root.RSA91A || {}; root.RSA91A.zip = api; }
})(typeof self !== 'undefined' ? self : this);
