/* ============================================================
   The Record — REAL Nostr broadside for the You Cannot Eat Code site.
   Drop-in replacement for the simulated wireBroadcast() in
   06_distribution/promo_site/site.js. Publishes a genuine signed
   note to real relays and links to verify it. See INTEGRATION.md.
   Requires the nostr-tools browser bundle on the page (window.NostrTools).
   Uses the site's existing $() and esc() helpers and --fb-* tokens.
   ============================================================ */
function wireBroadcast() {
  const stage = $('#broadcast-stage');
  const input = $('#broadcast-input');
  const btn = $('#broadcast-btn');
  const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.nostr.band'];
  const LS = 'yce_nostr_nsec';
  const NT = window.NostrTools;

  function sk() {
    let n;
    try { n = localStorage.getItem(LS); } catch (e) {}
    if (!n) { n = NT.nip19.nsecEncode(NT.generateSecretKey()); try { localStorage.setItem(LS, n); } catch (e) {} }
    return NT.nip19.decode(n).data;
  }
  function mark(row, ok, err) {
    const s = row.querySelector('[data-ok]');
    s.textContent = ok ? 'accepted ✓' : ('✗ ' + (err || 'failed'));
    s.style.color = ok ? 'var(--fb-brass-bright)' : 'var(--fb-oxblood)';
  }
  function broadcast(text) {
    if (!NT) { stage.innerHTML = '<span style="color:var(--fb-parchment-deep)">Nostr library not loaded — add the nostr-tools script (see INTEGRATION.md).</span>'; return; }
    const ev = NT.finalizeEvent({
      kind: 1, created_at: Math.floor(Date.now() / 1000),
      tags: [['t', 'youcannoteat'], ['client', 'youcannoteat.codes']], content: text
    }, sk());
    const nevent = NT.nip19.neventEncode({ id: ev.id, relays: RELAYS.slice(0, 2), author: ev.pubkey });
    const npub = NT.nip19.npubEncode(ev.pubkey);
    stage.innerHTML =
      `<div style="color:var(--fb-brass-bright);margin-bottom:.5em">"${esc(text)}"</div>` +
      `<div style="color:var(--fb-parchment-deep);font-size:.72rem;line-height:1.7">signed by ${esc(npub.slice(0, 18))}…<br>broadcasting to ${RELAYS.length} relays…</div>` +
      `<div id="relay-list" style="margin-top:.6em;display:grid;gap:.25em"></div>`;
    const list = $('#relay-list', stage);
    const rows = RELAYS.map((r) => {
      const d = document.createElement('div');
      d.style.cssText = 'display:flex;justify-content:space-between;color:var(--fb-parchment-deep);font-size:.72rem';
      d.innerHTML = `<span>${r}</span><span data-ok>…</span>`;
      list.appendChild(d);
      return d;
    });
    const pool = new NT.SimplePool();
    pool.publish(RELAYS, ev).forEach((p, i) => {
      Promise.resolve(p).then(() => mark(rows[i], true)).catch((e) => mark(rows[i], false, String(e && e.message || e)));
      setTimeout(() => { if (rows[i].querySelector('[data-ok]').textContent === '…') mark(rows[i], false, 'timeout'); }, 8000);
    });
    setTimeout(() => {
      const v = document.createElement('div');
      v.style.cssText = 'margin-top:.6em;font-size:.72rem;line-height:1.7';
      v.innerHTML = `<a href="https://njump.me/${nevent}" target="_blank" rel="noopener" style="color:var(--fb-brass-bright)">verify on the open network ↗</a> — no platform can recall it`;
      stage.appendChild(v);
    }, 600);
  }
  function render(note) {
    if (!note) { stage.innerHTML = '<span style="color:var(--fb-parchment-deep)">No note yet. A signed broadside, once out, cannot be recalled.</span>'; return; }
    broadcast(note);
  }
  btn.addEventListener('click', () => render(input.value.trim() || 'You cannot eat code.'));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
  render('');
}
