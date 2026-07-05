// ============================================================
// Clerk Minutes — a town clerk signs approved minutes, an agenda, or a legal
// notice as a civic record and broadcasts it to the open Nostr network.
//
// The problem: legal-notice newspapers are dying, and no civic tool gives a town
// an un-recallable, vendor-free record of its own proceedings. This does, free.
//
// Built on the shared Civic Record Protocol core (window.RecordCore) so it speaks
// the exact same on-wire grammar as The Record and The Charter, and on
// window.NostrTools so signing never touches a server. All key material stays in
// this browser: the Town Seal is a Nostr key the clerk holds, never transmitted.
// ============================================================
'use strict';
(function () {
  const NT = window.NostrTools;
  const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.nostr.band'];
  const LS_KEY = 'clerk_minutes_nsec';       // the Town Seal, if generated/pasted here
  const LS_SIGNER = 'clerk_minutes_signer';  // 'ext' | 'local' — remembers the clerk's choice
  const $ = (s) => document.querySelector(s);
  // Escape HTML so remote text (relay error strings, pasted field values) can never inject markup.
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // A kind-1 short notice above this many characters is treated as long-form and
  // recorded as a kind-30023 replaceable document instead (see chooseKind).
  const LONG_CHARS = 900;

  // ---- record type selector (Minutes / Agenda / Notice) ----
  let recType = 'minutes';
  const typeRow = $('#type-row');
  typeRow.addEventListener('click', (e) => {
    const seg = e.target.closest('.seg');
    if (!seg) return;
    recType = seg.getAttribute('data-type');
    Array.prototype.forEach.call(typeRow.querySelectorAll('.seg'), (b) =>
      b.setAttribute('aria-pressed', String(b === seg)));
  });

  // default meeting date = today (ISO date)
  try { $('#date').value = new Date().toISOString().slice(0, 10); } catch (e) {}

  const bodyText = $('#body-text');
  bodyText.addEventListener('input', () => { $('#count').textContent = bodyText.value.length; });

  function val(id) { const el = $(id); return (el && el.value.trim()) || ''; }

  // A stable, human-readable slug for the addressable `d` tag and the file names.
  const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ---- kind choice, explained -------------------------------------
  // Minutes are the *record of record*: a body may later adopt a corrected set,
  // and a citizen wants both "the exact version I'm citing" and "the latest."
  // That is exactly what a kind-30023 replaceable, addressable document gives
  // (immutable nevent for a version, naddr for the address). So Minutes ALWAYS
  // use buildCharter. Agendas and Notices are usually short, one-shot postings
  // with no correction lifecycle, so under LONG_CHARS they use buildRecord (a
  // plain kind-1 civic record, typed 'notice' or 'minutes'). A long agenda or
  // notice is promoted to a charter so it, too, gets a citable stable address.
  function chooseKind(text) {
    if (recType === 'minutes') return 'charter';
    return text.length > LONG_CHARS ? 'charter' : 'record';
  }

  // ---- signing (NIP-07 preferred; else a dedicated Town Seal in this browser) ----
  const hasExt = () => !!window.nostr && typeof window.nostr.signEvent === 'function';
  let useExt = false;
  try { useExt = localStorage.getItem(LS_SIGNER) === 'ext'; } catch (e) {}
  const localNsec = () => { try { return localStorage.getItem(LS_KEY); } catch (e) { return null; } };

  function addBtn(label, fn) {
    const b = document.createElement('button');
    b.className = 'btn btn-ghost'; b.type = 'button'; b.style.cssText = 'padding:.5em 1em;font-size:.68rem';
    b.textContent = label; b.onclick = fn;
    $('#idbar').appendChild(b);
  }

  function refreshSigner() {
    const s = $('#signer-status');
    if (hasExt() && useExt) {
      s.innerHTML = 'Signing with your <b>Nostr extension</b> as the Town Seal. your secret key never touches this page.';
    } else if (localNsec()) {
      s.innerHTML = 'Signing with a <b>Town Seal stored in this browser</b>. It stays on this device until you remove it.';
    } else if (hasExt()) {
      s.innerHTML = 'A Nostr extension was detected. Use it as your Town Seal, or paste your seal’s nsec below.';
    } else {
      s.innerHTML = 'A <b>Town Seal key</b> will be created and shown once when you record. Save it. it signs every future record for your town.';
    }
    $('#idbar').innerHTML = '';
    if (hasExt() && !useExt) addBtn('Use my Nostr extension', () => { try { localStorage.setItem(LS_SIGNER, 'ext'); } catch (e) {} useExt = true; refreshSigner(); });
    addBtn('Paste the Town Seal (nsec)', pasteNsec);
    if (localNsec()) addBtn('Remove seal from this browser', removeSeal);
  }

  // Pasting an nsec follows the-charter's safety exactly: it is stored only in
  // this browser's localStorage (never transmitted), gated behind an explicit
  // clerk action, and removable. It is never sent anywhere. signing is local.
  function pasteNsec() {
    const v = window.prompt('Paste your Town Seal secret key (nsec). It stays on this device and is never sent anywhere.');
    if (!v) return;
    try {
      if (NT.nip19.decode(v.trim()).type !== 'nsec') throw new Error('not an nsec');
      localStorage.setItem(LS_KEY, v.trim());
      useExt = false; try { localStorage.setItem(LS_SIGNER, 'local'); } catch (e) {}
      refreshSigner();
    } catch (e) { alert('That does not look like an nsec key.'); }
  }

  function removeSeal() {
    if (!confirm('Remove the Town Seal from this browser? Save it first. without it you cannot sign the next record under the same town identity. This cannot be undone here.')) return;
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    refreshSigner();
  }

  // Generate a Town Seal on first use, shown once with a save/print step. This is
  // the same one-time-show pattern the-charter uses: the key is stored locally so
  // the next record signs under the same town identity, and the clerk is warned.
  function localSk() {
    let n = localNsec();
    if (!n) { n = NT.nip19.nsecEncode(NT.generateSecretKey()); try { localStorage.setItem(LS_KEY, n); } catch (e) {} }
    return NT.nip19.decode(n).data;
  }

  const withTimeout = (p, ms, relay) => Promise.race([
    Promise.resolve(p).then(() => ({ relay, ok: true })),
    new Promise((r) => setTimeout(() => r({ relay, ok: false, error: 'timeout' }), ms))
  ]).catch((e) => ({ relay, ok: false, error: String((e && e.message) || e) }));

  // ---- sign & record ----
  $('#sign').addEventListener('click', async () => {
    if (!NT) { alert('Nostr library not loaded — check your connection and reload.'); return; }
    if (!window.RecordCore) { alert('Shared record core not loaded yet — reload and try again.'); return; }

    const town = val('#town'), state = val('#state'), board = val('#board'), date = val('#date');
    const text = bodyText.value.trim();
    if (!town || !state) { alert('Enter the town name and state so the record is scoped to your town.'); return; }
    if (!board) { alert('Enter the board or body (e.g. Board of Selectmen).'); return; }
    if (!date) { alert('Enter the meeting date.'); return; }
    if (!text) { alert('Paste the approved text to record.'); return; }

    if (!confirm('This will sign your town’s ' + recType + ' with the Town Seal and broadcast it publicly to live Nostr relays. It is real and cannot be un-published (a relay may keep a copy indefinitely). Record it now?')) return;

    const kind = chooseKind(text);
    // Stable address: <board>-<date>-<type>. Re-recording a corrected version with
    // the SAME board/date/type replaces the old address (the naddr always resolves
    // to the latest), while each version keeps its own immutable nevent.
    const d = [slugify(board), slugify(date), recType].filter(Boolean).join('-');
    const title = board + ' ' + titleCase(recType) + ', ' + date;
    // town object -> record-core adds t=town-<state>-<name> (townSlug) plus a
    // human ['town', name, state] tag, so a whole town's record is one #t query away.
    const townArg = { name: town, state: state };

    let tmpl;
    if (kind === 'charter') {
      // kind 30023 replaceable/addressable long-form: the minutes of record.
      tmpl = window.RecordCore.buildCharter({
        content: text,
        title: title,
        summary: title,
        d: d,
        client: 'the-record',
        town: townArg,
        extraTags: [['published_at', String(Math.floor(Date.now() / 1000))]]
      });
    } else {
      // kind 1 short civic record for a brief agenda/notice. type is a CRP type
      // ('notice' for a notice, 'minutes' for a brief agenda/minutes posting).
      const crpType = recType === 'notice' ? 'notice' : 'minutes';
      tmpl = window.RecordCore.buildRecord({
        content: text,
        client: 'the-record',
        type: crpType,
        town: townArg,
        // keep the same human-readable anchors as the charter path, as plain tags
        extraTags: [['title', title], ['meeting_date', date], ['body', board]]
      });
    }

    const btn = $('#sign'); btn.disabled = true; btn.textContent = 'Signing…';
    let newKey = null;
    try {
      let event, pk;
      if (hasExt() && useExt) {
        event = await window.nostr.signEvent(tmpl); pk = event.pubkey;
      } else {
        const had = localNsec();
        const sk = localSk(); pk = NT.getPublicKey(sk);
        if (!had) newKey = { nsec: NT.nip19.nsecEncode(sk), npub: NT.nip19.npubEncode(pk) };
        event = NT.finalizeEvent(tmpl, sk);
      }
      btn.textContent = 'Recording…';
      const pool = new NT.SimplePool();
      const per = await Promise.all(pool.publish(RELAYS, event).map((p, i) => withTimeout(p, 8000, RELAYS[i])));
      // grace period so a slow-but-accepting relay can finish after the 8s timeout.
      setTimeout(() => { try { pool.close(RELAYS); } catch (e) {} }, 4000);

      // nevent pins the EXACT signed version by its immutable event id. For a
      // kind-30023 charter we also encode the naddr (the address; a later signature
      // by the same seal replaces it, so it always resolves to the latest version).
      const nevent = NT.nip19.neventEncode({ id: event.id, relays: RELAYS.slice(0, 2), author: pk });
      const naddr = kind === 'charter'
        ? NT.nip19.naddrEncode({ identifier: d, pubkey: pk, kind: 30023, relays: RELAYS.slice(0, 2) })
        : null;
      showResult(per, { nevent: nevent, naddr: naddr, id: event.id, kind: kind, title: title }, newKey);
    } catch (e) { alert('Could not record: ' + ((e && e.message) || e)); }
    finally { btn.disabled = false; btn.textContent = 'Sign & record'; refreshSigner(); }
  });

  function showResult(per, links, newKey) {
    const accepted = per.filter((r) => r.ok).length;
    $('#result-title').textContent = accepted > 0 ? 'On the record — live on ' + accepted + '/' + per.length + ' relays.' : 'No relay accepted it.';
    $('#relays').innerHTML = per.map((r) =>
      '<div class="row"><span>' + esc(r.relay) + '</span><span class="' + (r.ok ? 'ok' : 'bad') + '">' + (r.ok ? '✓ accepted' : '✗ ' + esc(r.error || 'failed')) + '</span></div>'
    ).join('');

    const thisUrl = 'https://njump.me/' + links.nevent;
    const latestUrl = links.naddr ? 'https://njump.me/' + links.naddr : null;
    const raw = $('#verify-raw');
    raw.hidden = false;
    let html =
      '<div><b>Verify this record:</b> <a href="' + esc(thisUrl) + '" target="_blank" rel="noopener">' + esc(thisUrl) + '</a></div>' +
      '<div><b>The minutes of record</b> (this exact signed version, immutable): <code>' + esc(links.nevent) + '</code></div>';
    if (latestUrl) {
      html += '<div><b>Latest version</b> (the address; a later signed correction by the same seal replaces it): <a href="' + esc(latestUrl) + '" target="_blank" rel="noopener">' + esc(latestUrl) + '</a></div>';
    }
    html += '<div>Event id: <code>' + esc(links.id) + '</code></div>';
    raw.innerHTML = html;

    const how = $('#how-verify');
    how.hidden = false;
    let honest = links.kind === 'charter'
      ? 'This is a <b>replaceable record</b> (kind 30023): the keyholder can publish a corrected version. Cite the immutable <b>nevent</b> above for the official minutes of record. the naddr always resolves to the latest correction.'
      : 'This is a short civic record (kind 1): once signed and broadcast it cannot be edited or recalled.';
    how.innerHTML =
      '<b>How a citizen verifies this:</b> open the verify link, or paste the nevent into any Nostr client (e.g. njump.me). ' +
      'The client checks the signature against the Town Seal’s public key, so anyone can confirm your town signed this text and that not one character has changed. no account needed. ' +
      honest;

    const k = $('#keyout');
    if (newKey) {
      k.hidden = false;
      k.innerHTML =
        '<b>Your Town Seal — save it now.</b> This key signs every record for your town, and <b>anyone who holds it can post as your town.</b> ' +
        'It is stored in this browser until you remove it. Save it somewhere safe (a password manager, or print it) before you close this page.' +
        '<br>Public seal (npub): <code>' + esc(newKey.npub) + '</code>' +
        '<br>Secret key (nsec): <code>' + esc(newKey.nsec) + '</code>' +
        '<div class="btn-row" style="margin-top:.7rem">' +
        '<button class="btn btn-ghost" id="dl-key" type="button" style="padding:.5em 1em;font-size:.68rem">Download seal file</button>' +
        '<button class="btn btn-ghost" id="print-key" type="button" style="padding:.5em 1em;font-size:.68rem">Print the seal</button>' +
        '</div>';
      const dl = $('#dl-key');
      if (dl) dl.addEventListener('click', () => {
        const body = 'Clerk Minutes — Town Seal\n\nKeep this secret key safe and private. Anyone who holds it can post as your town.\n\nPublic seal (npub): ' + newKey.npub + '\nSecret key (nsec): ' + newKey.nsec + '\n';
        const blob = new Blob([body], { type: 'text/plain' });
        const u = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = u; a.download = 'town-seal.txt'; a.click();
        setTimeout(() => URL.revokeObjectURL(u), 2000);
      });
      const pr = $('#print-key');
      if (pr) pr.addEventListener('click', () => {
        const w = window.open('', '_blank');
        if (!w) { alert('Allow pop-ups to print the seal.'); return; }
        w.document.write('<pre style="font:14px monospace;padding:2rem;white-space:pre-wrap">Clerk Minutes — Town Seal\n\nKeep this secret key safe and private.\nAnyone who holds it can post as your town.\n\nPublic seal (npub): ' + esc(newKey.npub) + '\nSecret key (nsec): ' + esc(newKey.nsec) + '</pre>');
        w.document.close(); w.focus(); w.print();
      });
    } else k.hidden = true;

    $('#result').classList.add('on');
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (!NT) {
    $('#signer-status').innerHTML = 'Could not load the Nostr library — check your connection and reload.';
    $('#sign').disabled = true;
  } else {
    refreshSigner();
  }
})();
