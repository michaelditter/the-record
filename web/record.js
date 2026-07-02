// The Record — browser client. Mirrors core/record.mjs against window.NostrTools.
'use strict';
(function () {
  const NT = window.NostrTools;
  const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.nostr.band'];
  const TAGS = [['t', 'therecord'], ['t', 'youcannoteat'], ['client', 'the-record']];
  const LS_KEY = 'the_record_nsec';
  const $ = (s) => document.querySelector(s);

  const text = $('#text'), publishBtn = $('#publish'), signerStatus = $('#signer-status'), idbar = $('#idbar');
  let mode = null; // 'nip07' | 'local' | 'new'

  const hasExt = () => !!window.nostr && typeof window.nostr.signEvent === 'function';
  const localNsec = () => { try { return localStorage.getItem(LS_KEY); } catch (e) { return null; } };

  if (!NT) {
    signerStatus.innerHTML = 'Could not load the Nostr library — check your connection and reload.';
    publishBtn.disabled = true;
  }

  function addBtn(label, fn) {
    const b = document.createElement('button');
    b.className = 'btn'; b.type = 'button'; b.textContent = label; b.onclick = fn;
    idbar.appendChild(b);
  }

  function refreshSigner() {
    if (!mode) mode = hasExt() ? 'nip07' : (localNsec() ? 'local' : 'new');
    signerStatus.innerHTML =
      mode === 'nip07' ? 'Signing with your <b>Nostr extension</b><span class="pill">key never touches this page</span>'
        : mode === 'local' ? 'Signing with your <b>saved key</b> on this device'
          : 'A <b>new identity</b> is created the first time you publish';
    idbar.innerHTML = '';
    if (hasExt() && mode !== 'nip07') addBtn('Use my Nostr extension', () => { mode = 'nip07'; refreshSigner(); });
    addBtn('Paste my nsec', pasteNsec);
    if (localNsec()) addBtn('Forget my key', () => { try { localStorage.removeItem(LS_KEY); } catch (e) {} mode = null; refreshSigner(); });
  }

  function pasteNsec() {
    const v = window.prompt('Paste your nsec (secret key). It stays on this device.');
    if (!v) return;
    try { if (NT.nip19.decode(v.trim()).type !== 'nsec') throw 0; localStorage.setItem(LS_KEY, v.trim()); mode = 'local'; refreshSigner(); }
    catch (e) { alert('That does not look like an nsec key.'); }
  }

  text.addEventListener('input', () => { $('#count').textContent = text.value.length; });

  async function signEvent(content) {
    const tmpl = { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: TAGS, content };
    if (mode === 'nip07') return await window.nostr.signEvent(tmpl); // extension fills pubkey/id/sig
    let sk;
    if (mode === 'local') sk = NT.nip19.decode(localNsec()).data;
    else {
      sk = NT.generateSecretKey();
      const nsec = NT.nip19.nsecEncode(sk);
      try { localStorage.setItem(LS_KEY, nsec); } catch (e) {}
      showNewKey(nsec, NT.nip19.npubEncode(NT.getPublicKey(sk)));
      mode = 'local';
    }
    return NT.finalizeEvent(tmpl, sk);
  }

  const withTimeout = (p, ms, relay) => Promise.race([
    Promise.resolve(p).then(() => ({ relay, ok: true })),
    new Promise((r) => setTimeout(() => r({ relay, ok: false, error: 'timeout' }), ms))
  ]).catch((e) => ({ relay, ok: false, error: String((e && e.message) || e) }));

  async function publish() {
    const content = text.value.trim();
    if (!content) { text.focus(); return; }
    publishBtn.disabled = true; publishBtn.textContent = 'Signing…';
    try {
      const event = await signEvent(content);
      publishBtn.textContent = 'Broadcasting…';
      const pool = new NT.SimplePool();
      const per = await Promise.all(pool.publish(RELAYS, event).map((p, i) => withTimeout(p, 8000, RELAYS[i])));
      try { pool.close(RELAYS); } catch (e) {}
      showResult(event, per);
    } catch (e) { alert('Could not publish: ' + ((e && e.message) || e)); }
    finally { publishBtn.disabled = false; publishBtn.textContent = 'Sign & publish'; refreshSigner(); }
  }

  function showResult(event, per) {
    const nevent = NT.nip19.neventEncode({ id: event.id, relays: RELAYS.slice(0, 2), author: event.pubkey });
    const link = 'https://njump.me/' + nevent;
    const accepted = per.filter((r) => r.ok).length;
    $('#result-title').textContent = accepted > 0
      ? `On the record — live on ${accepted}/${per.length} relays.`
      : 'No relay accepted it — check your connection and try again.';
    const relaysEl = $('#relays');
    relaysEl.textContent = '';
    per.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'row';
      const name = document.createElement('span');
      name.textContent = r.relay;
      const status = document.createElement('span');
      status.className = r.ok ? 'ok' : 'bad';
      status.textContent = r.ok ? '✓ accepted' : '✗ ' + (r.error || 'failed');
      row.appendChild(name);
      row.appendChild(status);
      relaysEl.appendChild(row);
    });
    const a = $('#verify-link'); a.href = link; a.textContent = link;
    $('#copy-link').onclick = () => navigator.clipboard.writeText(link);
    const qr = $('#qr');
    if (window.qrcode && accepted > 0) {
      try { const q = window.qrcode(0, 'M'); q.addData(link); q.make(); qr.innerHTML = q.createImgTag(4, 8); qr.hidden = false; }
      catch (e) { qr.hidden = true; }
    }
    // The broadside: the 1776 print layer as a disaster-recovery copy. Offer it
    // once a record exists (accepted or not — a signed record still verifies).
    const cta = $('#broadside-cta');
    if (cta && window.Broadside) {
      const npub = NT.nip19.npubEncode(event.pubkey);
      cta.hidden = false;
      $('#print-broadside').onclick = () => window.Broadside.open({
        content: event.content, npub, nevent, njump: link, createdAt: event.created_at
      });
    }
    $('#result').classList.add('on');
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showNewKey(nsec, npub) {
    const k = $('#keyout');
    k.innerHTML =
      '<b>This is your new identity — save it now.</b><br>' +
      'Public name: <code>' + npub + '</code><br>' +
      'Secret key (back this up — anyone with it can post as you):<br><code>' + nsec + '</code><br>' +
      '<button class="btn btn-ghost" id="dl-key" type="button" style="margin-top:.6rem;padding:.4em 1em;font-size:.66rem">Download key</button>';
    k.hidden = false;
    k.querySelector('#dl-key').onclick = () => {
      const blob = new Blob([nsec + '\n'], { type: 'text/plain' });
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = u; a.download = 'the-record-key.txt'; a.click();
      setTimeout(() => URL.revokeObjectURL(u), 2000);
    };
  }

  publishBtn.addEventListener('click', publish);
  text.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') publish(); });
  refreshSigner();
})();
