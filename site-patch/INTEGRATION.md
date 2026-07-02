# Make the site's Nostr panel real

> **Where this applies.** These steps patch the **separate** promo-site repo
> (`06_distribution/promo_site` in the *You Cannot Eat Code* book project), not
> this repo. The files referenced below — `index.html`, `site.js`, `cards.js`,
> and the page's `$()` / `esc()` helpers — live there, not in `the-record`. If
> you cloned only `the-record`, copy `broadside.js` into that project to follow
> along.

The promo site (`06_distribution/promo_site`) ships the "broadside" panel as an
honest **simulation** — `wireBroadcast()` fakes the signature and the relay
accepts. This patch swaps in a **real** broadcast: a genuine signed note,
published to real public relays, with a link to verify it. Three small steps.

### 1. Load the Nostr library
In `index.html`, add this line just **before** `<script src="cards.js"></script>`.
Pin the version (matching this repo's `web/index.html`) so a CDN major-version
bump can't silently break signing:

```html
<script src="https://unpkg.com/nostr-tools@2.23.5/lib/nostr.bundle.js"></script>
```

Better still, vendor the bundle: download it once to `assets/nostr.bundle.js`
and load it relatively (`<script src="assets/nostr.bundle.js"></script>`), the
same way `the-record`'s own web app does — no CDN dependency at runtime.

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
