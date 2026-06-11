# Make the site's Nostr panel real

The promo site (`06_distribution/promo_site`) ships the "broadside" panel as an
honest **simulation** — `wireBroadcast()` fakes the signature and the relay
accepts. This patch swaps in a **real** broadcast: a genuine signed note,
published to real public relays, with a link to verify it. Three small steps.

### 1. Load the Nostr library
In `index.html`, add this line just **before** `<script src="cards.js"></script>`:

```html
<script src="https://unpkg.com/nostr-tools/lib/nostr.bundle.js"></script>
```

### 2. Replace the function
In `site.js`, delete the existing `function wireBroadcast() { … }` (the block
under `5c · BROADCAST`) and paste the one from `broadside.js` in this folder.
It reuses the page's `$()` and `esc()` helpers and the `--fb-*` tokens, so the
panel looks identical — it just does the real thing now.

### 3. Update the honesty tag (optional but recommended)
In `index.html`, in the broadcast panel, change:

```html
<span class="sim-tag">simulated relays — live protocol in v2</span>
```
to:
```html
<span class="sim-tag">live on the open network — click verify</span>
```

### What changes for the visitor
They type a line, hit **Sign & broadcast**, and it is genuinely signed and sent
to `relay.damus.io`, `nos.lol`, `relay.primal.net`, and `relay.nostr.band`. The
panel shows the real per-relay accepts and a **verify ↗** link (njump.me) that
opens the note on the open network. No platform can recall it. The full tool —
web app, CLI, run-your-own-relay — lives at <https://github.com/michaelditter/the-record>.

### Notes
- A key is generated once and kept in `localStorage` (`yce_nostr_nsec`) so the
  site has a stable byline. It is the *site visitor's* throwaway key, not yours.
- Relays change; edit the `RELAYS` array if one stops accepting writes
  (check status at https://nostr.watch).
