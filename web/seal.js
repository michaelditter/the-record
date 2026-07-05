// ============================================================
// The Town Seal — browser client.
//
// Turns a fresh Nostr keypair into a town's public municipal identity with
// public succession. The town secret key is generated in-page, split with
// Shamir Secret Sharing (secrets.js, GF(256)) among named officers, and then
// only the town npub is ever made public.
//
// KEY SAFETY (this is a key-custody tool, so this is the whole point):
//   - The town secret key exists in memory only across generate -> split ->
//     sign, then is dropped. It is NEVER written to localStorage and NEVER
//     sent over any network.
//   - Individual Shamir shares are shown once, on printable cards, and are
//     NEVER stored and NEVER transmitted.
//   - The published seal declaration carries officer NAMES, ROLES, the
//     threshold, and the town npub — never a share, never the secret.
//
// Depends on window.NostrTools (vendored), window.secrets (Shamir, vendored),
// and window.RecordCore (the Civic Record Protocol core, vendored).
// ============================================================
'use strict';
(function () {
  // Resolve libraries lazily. record-core loads via <script type="module">,
  // which runs AFTER this classic script, so window.RecordCore is not yet set
  // at IIFE start. Read from window at call time, not at boot.
  const NT = () => window.NostrTools;
  const RC = () => window.RecordCore;
  const SS = () => window.secrets;
  const $ = (s) => document.querySelector(s);

  // record-core's DEFAULT_RELAYS if available at call time, else this exact
  // fallback (identical to the CRP defaults).
  const relays = () => {
    const rc = RC();
    return (rc && rc.CRP && rc.CRP.DEFAULT_RELAYS)
      ? rc.CRP.DEFAULT_RELAYS.slice()
      : ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.nostr.band'];
  };

  // Ceremony state. Held in module scope so it clears on reload. `sk` is the
  // one Uint8Array that must never escape this page.
  let sk = null;            // town secret key bytes (32), live only during the ceremony
  let townNpub = null;      // public seal
  let shares = null;        // array of hex share strings (shown once, never persisted)
  let officers = [];        // [{ name, role }]

  // Report a missing library only when the user actually acts, and never
  // permanently disable the ceremony on a library that simply loads a beat late.
  function librariesReady() {
    const nt = NT(), ss = SS(), rc = RC();
    if (!nt || typeof nt.generateSecretKey !== 'function') return 'the Nostr library';
    if (!ss || typeof ss.share !== 'function') return 'the Shamir library';
    if (!rc || typeof rc.buildCharter !== 'function') return 'the record core';
    return null;
  }

  // ---- helpers ----------------------------------------------------
  const bytesToHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  function hexToBytes(hex) {
    const s = String(hex).trim().toLowerCase().padStart(64, '0');
    if (!/^[0-9a-f]{64}$/.test(s)) throw new Error('not a 32-byte hex key');
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  const clampInt = (v, lo, hi, dflt) => {
    const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(hi, Math.max(lo, n));
  };
  function todayLong() {
    try { return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }

  // ---- tabs -------------------------------------------------------
  function showTab(which) {
    const cer = which === 'ceremony';
    $('#tab-ceremony').classList.toggle('on', cer);
    $('#tab-recovery').classList.toggle('on', !cer);
    $('#tab-ceremony').setAttribute('aria-selected', String(cer));
    $('#tab-recovery').setAttribute('aria-selected', String(!cer));
    $('#pane-ceremony').classList.toggle('on', cer);
    $('#pane-recovery').classList.toggle('on', !cer);
    $('#pane-ceremony').hidden = !cer;
    $('#pane-recovery').hidden = cer;
  }
  $('#tab-ceremony').addEventListener('click', () => showTab('ceremony'));
  $('#tab-recovery').addEventListener('click', () => showTab('recovery'));

  // ---- officer rows -----------------------------------------------
  function renderOfficers() {
    const n = clampInt($('#officer-count').value, 2, 20, 5);
    const wrap = $('#officers');
    // preserve any typed values across re-render
    const prev = [...wrap.querySelectorAll('.officer-row')].map((row) => ({
      name: row.querySelector('.o-name').value,
      role: row.querySelector('.o-role').value
    }));
    wrap.innerHTML = '<p class="officers-head">The ' + n + ' officers who each hold a share</p>';
    for (let i = 0; i < n; i++) {
      const row = document.createElement('div');
      row.className = 'officer-row';
      const idx = document.createElement('span');
      idx.className = 'idx'; idx.textContent = (i + 1) + '.';
      const name = document.createElement('input');
      name.type = 'text'; name.className = 'o-name'; name.placeholder = 'Officer name'; name.autocomplete = 'off';
      const role = document.createElement('input');
      role.type = 'text'; role.className = 'o-role'; role.placeholder = 'Role (e.g. Town Clerk)'; role.autocomplete = 'off';
      if (prev[i]) { name.value = prev[i].name || ''; role.value = prev[i].role || ''; }
      row.appendChild(idx); row.appendChild(name); row.appendChild(role);
      wrap.appendChild(row);
    }
    syncKN();
  }

  function syncKN() {
    const n = clampInt($('#officer-count').value, 2, 20, 5);
    let k = clampInt($('#threshold').value, 2, n, Math.min(3, n));
    if (k > n) k = n;
    $('#lede-k').textContent = k;
    $('#lede-n').textContent = n;
  }

  $('#officer-count').addEventListener('input', renderOfficers);
  $('#threshold').addEventListener('input', syncKN);

  // ---- generate + split -------------------------------------------
  function collectOfficers() {
    const rows = [...$('#officers').querySelectorAll('.officer-row')];
    return rows.map((row, i) => ({
      name: (row.querySelector('.o-name').value || '').trim() || ('Officer ' + (i + 1)),
      role: (row.querySelector('.o-role').value || '').trim()
    }));
  }

  function generate() {
    const missing = librariesReady();
    if (missing) { $('#gen-status').textContent = 'Could not load ' + missing + ' — reload the page and try again.'; return; }
    const townName = $('#town-name').value.trim();
    const townState = $('#town-state').value.trim();
    if (!townName) { $('#town-name').focus(); $('#gen-status').textContent = 'Enter the town name.'; return; }
    const n = clampInt($('#officer-count').value, 2, 20, 5);
    const k = clampInt($('#threshold').value, 2, n, Math.min(3, n));
    $('#officer-count').value = n; $('#threshold').value = k; syncKN();

    officers = collectOfficers();

    // The one moment the whole key exists. Generate -> derive npub -> split.
    const nt = NT(), ss = SS();
    sk = nt.generateSecretKey();                 // 32 secure bytes (crypto)
    const skHex = bytesToHex(sk);
    townNpub = nt.nip19.npubEncode(nt.getPublicKey(sk));

    // Shamir-split the 64-char secret hex into N shares, threshold k.
    shares = ss.share(skHex, n, k);

    // Sanity: prove in-page that any k shares rebuild the exact key before we
    // ever show a card. If this fails we do NOT proceed (never hand out bad shares).
    const check = ss.combine(shares.slice(0, k)).padStart(64, '0');
    if (check !== skHex) {
      sk = null; shares = null;
      $('#gen-status').textContent = 'Split self-check failed — nothing generated. Reload and retry.';
      return;
    }

    renderCards(townName, townState, k, n);
    preparePublish(townName, townState, k, n);
    $('#gen-status').innerHTML = 'Key generated and split <b>' + k + '-of-' + n + '</b>. Print the cards, then publish the seal.';
    $('#cards-area').hidden = false;
    $('#publish-area').hidden = false;
    $('#generate').disabled = true; // one ceremony per page load; reload to redo
    $('#cards-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderCards(townName, townState, k, n) {
    const cards = $('#cards');
    cards.innerHTML = '';
    const townLine = townState ? (townName + ', ' + townState) : townName;
    officers.forEach((off, i) => {
      const card = document.createElement('div');
      card.className = 'card';
      const inner = document.createElement('div');
      inner.className = 'card-inner';

      const mark = document.createElement('p');
      mark.className = 'seal-mark'; mark.textContent = 'Town Seal · Share ' + (i + 1) + ' of ' + n;
      const nm = document.createElement('h3');
      nm.className = 'officer-name'; nm.textContent = off.name;
      const rl = document.createElement('p');
      rl.className = 'officer-role'; rl.textContent = off.role || 'Officer';
      const tw = document.createElement('p');
      tw.className = 'card-town'; tw.textContent = 'Seal of ' + townLine;

      const shLbl = document.createElement('p');
      shLbl.className = 'field-lbl'; shLbl.textContent = 'Your secret share (keep private)';
      const shVal = document.createElement('div');
      shVal.className = 'share-val'; shVal.textContent = shares[i];

      const npLbl = document.createElement('p');
      npLbl.className = 'field-lbl'; npLbl.textContent = 'The town public seal (npub)';
      const npVal = document.createElement('div');
      npVal.className = 'npub-val'; npVal.textContent = townNpub;

      const warn = document.createElement('p');
      warn.className = 'card-warn';
      warn.innerHTML =
        '<b>Keep this share private.</b> It is yours alone. Any <b>' + k + '</b> of the <b>' + n +
        '</b> shares can reconstruct the town key and sign as the town. Losing your one share (below ' +
        k + ') is safe: the town simply re-splits a new key. But ' + k + ' shares gathered by anyone who ' +
        'is not the town, in the open, is a breach. Do not photograph it, email it, or store it online.';

      [mark, nm, rl, tw, shLbl, shVal, npLbl, npVal, warn].forEach((el) => inner.appendChild(el));
      card.appendChild(inner);
      cards.appendChild(card);
    });
  }

  // ---- publish the seal declaration -------------------------------
  function declarationText(townName, townState, k, n) {
    const townLine = townState ? (townName + ', ' + townState) : townName;
    return 'The town of ' + townLine + ' adopts this public seal on ' + todayLong() + '. ' +
      'Records signed by this key are the town official record. ' +
      'The signing key is held ' + k + '-of-' + n + ' by named officers, ' +
      'so no one person can sign alone and no one loss can lose the town its seal.';
  }

  function preparePublish(townName, townState, k, n) {
    const content = declarationText(townName, townState, k, n);
    $('#pub-preview').textContent = content;
    // stash the parameters for the publish handler
    $('#publish').dataset.town = townName;
    $('#publish').dataset.state = townState;
    $('#publish').dataset.k = String(k);
    $('#publish').dataset.n = String(n);
  }

  // Officer names/roles + threshold as tags. NEVER a share, NEVER the secret.
  function officerTags(k, n) {
    const tags = [['threshold', k + '-of-' + n]];
    officers.forEach((off) => {
      // ['officer', name, role] — role may be empty string
      tags.push(['officer', off.name, off.role || '']);
    });
    return tags;
  }

  async function publish() {
    if (!sk) { $('#pub-status').textContent = 'Generate the key first.'; return; }
    const rc = RC(), nt = NT();
    const btn = $('#publish');
    const townName = btn.dataset.town, townState = btn.dataset.state;
    const k = parseInt(btn.dataset.k, 10), n = parseInt(btn.dataset.n, 10);
    btn.disabled = true; btn.textContent = 'Signing…';
    try {
      const content = declarationText(townName, townState, k, n);
      // Build a CRP charter (kind 30023), town-scoped, d="town-seal".
      const tpl = rc.buildCharter({
        content,
        title: 'Town Seal of ' + (townState ? (townName + ', ' + townState) : townName),
        summary: 'Public municipal seal, held ' + k + '-of-' + n + ' by named officers.',
        d: 'town-seal',
        client: 'the-record',
        town: { name: townName, state: townState },
        extraTags: officerTags(k, n)
      });
      const event = rc.signRecord(tpl, sk, nt);   // the one signing use of the key

      // Key's job is done. Drop it from memory immediately after signing.
      try { sk.fill(0); } catch (e) { /* not fillable */ }
      sk = null;

      btn.textContent = 'Broadcasting…';
      const report = await rc.publishRecord(event, relays(), nt);
      showResult(event, report);
    } catch (e) {
      $('#pub-status').textContent = 'Could not publish: ' + ((e && e.message) || e);
    } finally {
      btn.disabled = false; btn.textContent = 'Sign & publish the seal';
    }
  }

  function showResult(event, report) {
    const links = RC().recordLinks(event, NT(), relays());
    const accepted = report.accepted, total = report.total;
    $('#result-title').textContent = accepted > 0
      ? 'Sealed — live on ' + accepted + '/' + total + ' relays.'
      : 'No relay accepted it — check your connection and try again.';

    const npEl = $('#seal-npub');
    npEl.innerHTML = '';
    const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = 'The town public seal';
    const code = document.createElement('code'); code.textContent = townNpub;
    npEl.appendChild(lbl); npEl.appendChild(code);

    const relaysEl = $('#relays');
    relaysEl.textContent = '';
    report.per.forEach((r) => {
      const row = document.createElement('div'); row.className = 'row';
      const name = document.createElement('span'); name.textContent = r.relay;
      const status = document.createElement('span');
      status.className = r.ok ? 'ok' : 'bad';
      status.textContent = r.ok ? '✓ accepted' : '✗ ' + (r.error || 'failed');
      row.appendChild(name); row.appendChild(status); relaysEl.appendChild(row);
    });

    const a = $('#verify-link'); a.href = links.njump; a.textContent = links.njump;
    $('#copy-link').onclick = () => { try { navigator.clipboard.writeText(links.njump); } catch (e) {} };
    $('#pub-status').innerHTML = 'The key has been discarded from memory. The town is held only in the shares now.';
    $('#result').classList.add('on');
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- recovery / practice ----------------------------------------
  function recover() {
    const out = $('#recover-out');
    out.className = 'recover-out'; out.hidden = false;
    const nt = NT(), ss = SS();
    if (!nt || !ss || typeof ss.combine !== 'function') {
      out.innerHTML = '<div class="verdict no">Libraries still loading — reload the page and try again.</div>';
      return;
    }
    const raw = $('#shares-in').value.split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (raw.length < 2) {
      out.innerHTML = '<div class="verdict no">Paste at least the threshold number of shares (2 or more).</div>';
      return;
    }
    let skHex, npub;
    try {
      // Combine only in memory. Never sent anywhere.
      skHex = ss.combine(raw).padStart(64, '0');
      const bytes = hexToBytes(skHex);            // validates 32-byte hex
      npub = nt.nip19.npubEncode(nt.getPublicKey(bytes));
      try { bytes.fill(0); } catch (e) {}
    } catch (e) {
      out.innerHTML = '<div class="verdict no">Could not reconstruct a key from those shares. ' +
        'Check that you pasted whole, unaltered shares (and at least k of them).</div>';
      return;
    }

    const expected = $('#expected-npub').value.trim();
    const rows =
      '<div class="row"><span class="k">Reconstructed npub</span><span class="v">' + npub + '</span></div>';
    let verdict = '';
    if (expected) {
      if (expected === npub) {
        out.classList.add('match');
        verdict = '<div class="verdict ok">Match. These shares reconstruct the town seal. Recovery works.</div>';
      } else {
        out.classList.add('mismatch');
        verdict = '<div class="verdict no">No match. This is a different key than the town seal npub you entered. ' +
          'Wrong shares, too few, or a typo.</div>';
      }
    } else {
      verdict = '<div class="verdict">Confirm this matches the npub on your town seal declaration.</div>';
    }
    out.innerHTML = rows + verdict;
  }

  // ---- wire up ----------------------------------------------------
  $('#generate').addEventListener('click', generate);
  $('#publish').addEventListener('click', publish);
  $('#print-cards').addEventListener('click', () => window.print());
  $('#recover').addEventListener('click', recover);

  renderOfficers();
  showTab('ceremony');
})();
