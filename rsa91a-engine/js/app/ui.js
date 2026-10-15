/* RSA91A-Engine: small DOM helpers. All user data goes through textContent. */
(function (root) {
  'use strict';
  const NS = root.RSA91A = root.RSA91A || {};

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const $ = (sel, scope) => (scope || document).querySelector(sel);
  const $$ = (sel, scope) => Array.from((scope || document).querySelectorAll(sel));

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  function toast(msg, kind) {
    const host = $('#toasts');
    const t = h('div', { class: 'toast ' + (kind || 'info'), role: 'status' }, msg);
    host.appendChild(t);
    setTimeout(() => t.classList.add('out'), 4200);
    setTimeout(() => t.remove(), 4800);
  }

  function download(data, name, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(file);
    });
  }

  /** Opens the file picker. With multiple=true resolves to an array of files (possibly empty). */
  function pickFile(accept, multiple) {
    return new Promise((resolve) => {
      const input = h('input', { type: 'file', accept, multiple: multiple ? true : null });
      input.addEventListener('change', () => resolve(multiple ? Array.from(input.files) : (input.files[0] || null)));
      input.click();
    });
  }

  /** Modal form. fields: [{ name, label, type, options, value, required, rows, help }] */
  function formDialog(title, fields, submitLabel) {
    return new Promise((resolve) => {
      const form = h('form', { method: 'dialog', class: 'form' });
      for (const f of fields) {
        const id = 'f-' + f.name;
        let input;
        if (f.type === 'select') {
          input = h('select', { id, name: f.name }, f.options.map((o) => h('option', { value: o.value, selected: o.value === f.value ? true : null }, o.label)));
        } else if (f.type === 'textarea') {
          input = h('textarea', { id, name: f.name, rows: f.rows || 4 });
          input.value = f.value || '';
        } else if (f.type === 'checkbox') {
          input = h('input', { id, name: f.name, type: 'checkbox', checked: !!f.value });
        } else {
          input = h('input', { id, name: f.name, type: f.type || 'text', value: f.value || '' });
        }
        if (f.required) input.required = true;
        form.appendChild(h('label', { for: id, class: f.type === 'checkbox' ? 'check' : null },
          f.type === 'checkbox' ? [input, ' ', f.label] : [h('span', {}, f.label), input]));
        if (f.help) form.appendChild(h('p', { class: 'help' }, f.help));
      }
      const dlg = h('dialog', { class: 'modal' },
        h('h2', {}, title), form);
      form.appendChild(h('div', { class: 'row end' },
        h('button', { type: 'button', class: 'ghost', onclick: () => { dlg.close(); } }, 'Cancel'),
        h('button', { type: 'submit', class: 'primary' }, submitLabel || 'Save')));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const out = {};
        for (const f of fields) {
          const el = form.elements[f.name];
          out[f.name] = f.type === 'checkbox' ? el.checked : el.value;
        }
        dlg.dataset.ok = '1';
        dlg.close();
        resolve(out);
      });
      dlg.addEventListener('close', () => {
        if (!dlg.dataset.ok) resolve(null);
        dlg.remove();
      });
      document.body.appendChild(dlg);
      dlg.showModal();
    });
  }

  function confirmDialog(message, okLabel) {
    return new Promise((resolve) => {
      const dlg = h('dialog', { class: 'modal small' },
        h('p', {}, message),
        h('div', { class: 'row end' },
          h('button', { class: 'ghost', onclick: () => { dlg.close(); resolve(false); } }, 'Cancel'),
          h('button', { class: 'primary', onclick: () => { dlg.close(); resolve(true); } }, okLabel || 'OK')));
      dlg.addEventListener('close', () => dlg.remove());
      dlg.addEventListener('cancel', () => resolve(false));
      document.body.appendChild(dlg);
      dlg.showModal();
    });
  }

  function csv(rows) {
    return rows.map((r) => r.map((v) => {
      const s = v === null || v === undefined ? '' : String(v);
      // Neutralize spreadsheet formula injection.
      const safe = /^[=+\-@\t\r]/.test(s) ? '\'' + s : s;
      return /[",\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
    }).join(',')).join('\r\n');
  }

  NS.ui = { h, $, $$, clear, toast, download, readFile, pickFile, formDialog, confirmDialog, csv };
})(typeof self !== 'undefined' ? self : this);
