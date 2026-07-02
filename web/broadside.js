// The Broadside — the 1776 print medium as the 2026 disaster-recovery layer.
//
// A one-click letterpress print-to-PDF of any record. Against a total network
// takedown, a photocopied broadside with a QR still verifies: the QR carries the
// njump link, the npub is a human-checkable fingerprint, and the record text is
// printed large enough to read across a room.
//
// Classic script. Depends on the vendored global `qrcode` (qrcode-generator
// 1.4.4) and the Federal Brass palette in style.css / broadside.css. Exposes
// window.Broadside.open({ content, npub, nevent, njump, createdAt }).
'use strict';
(function () {
  const WORDMARK = 'youcannoteat.codes';
  const CAPTION =
    'Verify on any phone. This record lives on the open network; no single platform can recall it.';

  // First and last groups of an npub, joined with an ellipsis, so a human can
  // check the byline against a known key without reading 63 characters.
  // npub1abcdef...wxyz9 — keep the "npub1" prefix and a tail for comparison.
  function fingerprint(npub) {
    const s = String(npub || '');
    if (s.length <= 18) return s;
    return s.slice(0, 12) + '…' + s.slice(-6);
  }

  function formatDate(createdAt) {
    // createdAt is Nostr seconds; fall back to now if absent.
    const ms = createdAt ? Number(createdAt) * 1000 : Date.now();
    const d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
      });
    } catch (e) {
      return d.toDateString();
    }
  }

  // Build the QR as an <img> data-URL via the vendored qrcode lib. Higher error
  // correction ('H') so a photocopied, coffee-stained broadside still scans.
  function qrMarkup(link) {
    if (!window.qrcode || !link) return '';
    try {
      const q = window.qrcode(0, 'H');
      q.addData(String(link));
      q.make();
      // cellSize 6, margin 0 (the parchment plaque supplies the quiet zone).
      return q.createImgTag(6, 0);
    } catch (e) {
      return '';
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ensureHost() {
    let host = document.getElementById('broadside-root');
    if (!host) {
      host = document.createElement('div');
      host.id = 'broadside-root';
      host.setAttribute('role', 'dialog');
      host.setAttribute('aria-modal', 'true');
      host.setAttribute('aria-label', 'Printable broadside');
      document.body.appendChild(host);
    }
    return host;
  }

  let onKeydown = null;

  function close() {
    const host = document.getElementById('broadside-root');
    if (host) { host.hidden = true; host.innerHTML = ''; }
    document.body.classList.remove('broadside-open');
    if (onKeydown) { document.removeEventListener('keydown', onKeydown); onKeydown = null; }
  }

  function open(rec) {
    rec = rec || {};
    const content = String(rec.content == null ? '' : rec.content);
    const npub = rec.npub || '';
    const njump = rec.njump || '';
    const nevent = rec.nevent || '';
    const dateStr = formatDate(rec.createdAt);
    const qr = qrMarkup(njump);

    const host = ensureHost();
    host.hidden = false;
    document.body.classList.add('broadside-open');

    // Long records get a smaller type size so a single page stays single.
    const len = content.length;
    const sizeClass = len > 520 ? 'sz-s' : len > 260 ? 'sz-m' : 'sz-l';

    host.innerHTML =
      '<div class="broadside-actions" data-print-hide>' +
        '<button class="btn" id="broadside-print" type="button">Print / Save as PDF</button>' +
        '<button class="btn btn-ghost" id="broadside-close" type="button">Close</button>' +
      '</div>' +
      '<article class="broadside ' + sizeClass + '">' +
        '<div class="bs-keyline">' +
          '<header class="bs-head">' +
            '<p class="bs-kicker">On the Record</p>' +
            '<div class="bs-rule"></div>' +
          '</header>' +
          '<div class="bs-body">' +
            '<p class="bs-content">' + escapeHtml(content) + '</p>' +
          '</div>' +
          '<div class="bs-foot">' +
            (qr ? '<div class="bs-qr">' + qr + '</div>' : '') +
            '<div class="bs-meta">' +
              (dateStr ? '<p class="bs-date">' + escapeHtml(dateStr) + '</p>' : '') +
              '<p class="bs-signer">Signed by <span class="bs-npub">' +
                escapeHtml(fingerprint(npub)) + '</span></p>' +
              (nevent ? '<p class="bs-nevent">' + escapeHtml(nevent) + '</p>' : '') +
              '<p class="bs-caption">' + escapeHtml(CAPTION) + '</p>' +
            '</div>' +
          '</div>' +
          '<footer class="bs-wordmark">' +
            '<div class="bs-rule"></div>' +
            '<p>' + escapeHtml(WORDMARK) + '</p>' +
          '</footer>' +
        '</div>' +
      '</article>';

    const printBtn = host.querySelector('#broadside-print');
    const closeBtn = host.querySelector('#broadside-close');
    if (printBtn) printBtn.onclick = () => window.print();
    if (closeBtn) closeBtn.onclick = close;

    onKeydown = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKeydown);

    // Focus the print button so Enter prints and Escape closes without a click.
    if (printBtn) { try { printBtn.focus(); } catch (e) {} }
  }

  window.Broadside = { open: open, close: close };
})();
