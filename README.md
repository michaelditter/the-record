# The Record

**Put it on the record. In your name. On a network no one owns.**

A tiny, real tool to publish a signed, uncensorable public record to [Nostr](https://nostr.com) — an open relay protocol. You sign a note with a key only you hold, and broadcast it to several independent relays. The signature is your byline. No platform can edit it, and no platform can take it back.

This is the **recording method** from the book *[You Cannot Eat Code](https://youcannoteat.codes)* — made real. The book's first law: *keep a portable, attributed record of your judgment in a medium you control.* This is that: the shared sign-and-publish core is under 90 lines, and the whole tool (core + CLI + web app + site patch) is small enough to read in a sitting.

> A pamphlet, once printed, belonged to everyone who held a copy. A signed note on an open relay protocol works the same way.

---

## What it's for

- A **town** posts a decision its residents can verify and no server can memory-hole.
- A **person** makes a public, timestamped, attributed commitment — or stakes a claim to an idea, first.
- A **maker** timestamps work in a medium they own, not a platform's database.

No accounts. No money. No tokens. Just a signature and the open network.

## Three ways to use it

### 1. The web app — no install
Open the app, write your record, hit **Sign & publish**. You get a link (and a QR) anyone can verify on any Nostr client.
→ demo deploying at `record.youcannoteat.codes` (not live yet) · run it now from the [repo](https://github.com/michaelditter/the-record): `npm run web` then open <http://127.0.0.1:4555> (serves on localhost only)

It signs three ways, safest first:
1. **Your Nostr browser extension** (Alby, nos2x) — your key never touches the page.
2. **Bring your own `nsec`** — paste a key you already have.
3. **Generate one** — shown once, with a clear "save this" step.

### 2. The CLI — scriptable
Requires **Node 18+**. The web app above needs no install; the CLI does one `npm install` for its one dependency.
```bash
npm install
node cli/record.mjs "The town voted 4–1 to keep the green a commons. — recorded 2026-06-11"
echo "minutes…" | node cli/record.mjs        # pipe from a file
node cli/record.mjs whoami                    # your public name (npub)
```
It prints the per-relay result and a verify link:
```
On the record. Live on 4/4 relays — no platform can recall it.
Verify / share: https://njump.me/nevent1…
```
Your key lives in `~/.the-record/key` (or `$THE_RECORD_NSEC`). Add your own relay with `THE_RECORD_RELAYS=wss://relay.mytown.org`.

### 3. Run your own relay — own the recording layer
A ~$5/month VPS (or a Raspberry Pi) is enough to host your town's relay, so your records also live on infrastructure you control. **[→ RELAY.md](RELAY.md)**

---

## Clerk Minutes — a town's record of itself

The legal-notice newspaper is dying, and no civic tool gives a town an un-recallable, vendor-free record of its own proceedings. **Clerk Minutes** does, for free.

Open `web/minutes.html` (same `npm run web`, then browse to `/minutes.html`). A town clerk enters the town, state, board or body (e.g. *Board of Selectmen*), and meeting date, picks a type (**Minutes / Agenda / Notice**), and pastes the text that was already approved. Hit **Sign & record**, and it is signed with the **Town Seal** (a Nostr key the clerk holds) and broadcast to several independent relays. No account, no vendor, no server keeps the draft.

- **Town-scoped.** Every record carries `t=town-<state>-<name>` (e.g. `town-ct-goshen`), so a whole town's public record is one `#t` query away from any relay. The town, not the platform.
- **Minutes are the record of record.** Long-form minutes are published as a kind-30023 replaceable, addressable document with a stable address `d = <board>-<date>-<type>` and title `"<Board> <Type>, <date>"`. Short agendas and notices under ~900 characters are published as a plain kind-1 civic record, typed `notice` or `minutes`.
- **Two links, honestly labeled.** A kind-30023 record is **replaceable by its keyholder**: if the body later adopts a corrected set, re-recording with the same board/date/type replaces the address in place. So the tool shows both the **immutable `nevent`** (this exact signed version — *cite this for the official minutes of record*) **and the `naddr`** (the address, which always resolves to the latest correction).
- **How a citizen verifies.** Open the verify link, or paste the `nevent` into any Nostr client (njump.me). The client checks the signature against the Town Seal's public key, so anyone can confirm the town signed this text and that not one character has changed. No account needed.

**Signing, safest first** (mirrors The Charter): a **Nostr browser extension** if present (the seal never touches the page), else **paste the Town Seal's `nsec`** (stored only in this browser, never transmitted), else a seal is **generated and shown once** with a download/print step and a plain warning. Key material never leaves the device.

---

## The Town Seal — a municipal key with public succession

Every clerk asks the same question the first time you hand them a key: *what happens when I retire, or lose my laptop?* A single private key is a single point of failure, and a town cannot bet its official record on one person's hard drive. **The Town Seal** answers it in the open.

Open `web/seal.html` (same `npm run web`, then browse to `/seal.html`). It runs a **key ceremony** you can do at a public meeting, on a screen the room can see:

1. **Name the town and the officers.** Enter town and state, the names and roles of *N* officers (default 5), and the threshold *k* (default 3).
2. **Generate the key, in the room.** A fresh Nostr secret key is generated in the browser (`crypto.getRandomValues`). This is the one moment the whole key exists.
3. **Split it with Shamir Secret Sharing.** The 32-byte secret is split into *N* shares over GF(256) using [`secrets.js-grempe`](https://github.com/grempe/secrets.js) (vendored, pinned to 2.0.0). The tool self-checks that *k* shares rebuild the exact key before it shows a single card.
4. **Hand out the shares, once.** Each officer gets a **printable card** with their name, role, their one share, the town's public seal (npub), and a plain warning. A **Print all cards** button lays out one card per page. The shares are shown this once and are never stored.
5. **Publish only the seal.** One signed **kind-30023** declaration goes to the relays: *"The town of Goshen, CT adopts this public seal on <date>. Records signed by this key are the town official record. The signing key is held 3-of-5 by named officers."* It carries the officers' **names and roles** and the **threshold** as tags, is town-scoped (`t=town-ct-goshen`), and is built and verified with the shared Civic Record Protocol core. It **never** carries a share or the secret. The key is signed with once, then dropped from memory.

The result: the town's public identity is a single npub anyone can verify, and the private key that produces it is **never in one place again**. When the clerk retires, the town does not lose its seal. When a laptop dies, nothing is lost. When the town needs to sign, *k* officers meet and reconstruct the key.

### Recover / practice

The same page has a **Recover** tab. Paste any *k* shares and the town key is reconstructed **in the browser**, its npub derived and shown, and (if you paste the published seal npub) confirmed to match. Officers should rehearse this before they ever need it. Shares are combined only in page memory. They are never saved and never sent anywhere.

### The honest security note

Shamir Secret Sharing protects the town against **losing or compromising a single share**: a share below the threshold is worthless, so a lost card or one careless officer does not endanger the seal. It does **not** protect against **k officers colluding** — any *k* of them, gathered, *are* the town key. That is not a flaw; it is the whole design. You choose *k* and you choose the officers precisely to set how many honest people it takes to act, and how many dishonest ones it would take to defect. Choose *k* high enough that no faction can reach it alone, and low enough that the town can still assemble a quorum when a laptop dies. Reconstructing the key (in Recover, or to sign) reveals the full secret in that browser for a moment, so do it on a trusted device and reload when done. A seal is **durable, not eternal**: the declaration lives as long as one relay keeps a copy, and because a kind-30023 record is replaceable by its keyholder, cite the immutable `nevent` for the exact adopting version.

**Key safety, enforced in code.** No secret key and no share is ever written to `localStorage` or sent over any network. The only thing that touches the wire is the signed, public declaration, which by construction contains neither. Round-trip correctness is proven by a Node harness (200 random splits, exact hex reconstruction across random *k*-of-*N* subsets, with *k−1* shares proven not to reconstruct).

---

## How it works

- **Your key is your byline.** A note is signed (BIP-340 / secp256k1). Anyone can verify the signature; only you can produce it.
- **Relays are redundant copies.** You publish to several independent relays. The record is durable because it isn't in one place.
- **Verify anywhere.** Open `njump.me/<id>` or any Nostr client. The record is the same everywhere because it's signed.
- **No center.** No company sits in the middle. That's the whole point.

Every record is tagged `#therecord` and `#youcannoteat` — search those on any Nostr client to find them.

## Honest about the sharp edges

- **Public and unrecallable — by design.** Don't post anything private, or anything you'd regret carving in stone.
- **Back up your key.** Anyone who has your secret key can post as you; lose it and you lose the name. Prefer a browser extension (above) so the key never touches a web page.
- **Durable, not eternal.** A record lives as long as *one* relay keeps a copy. Publishing to several makes it resilient — and you can be one of those relays ([RELAY.md](RELAY.md)).
- **Relays change.** The default relay list is in `core/record.mjs`; if one stops accepting writes, swap it (check status at [nostr.watch](https://nostr.watch)).

## Steward's Watch — keep the redundancy honest

A record is durable because it is redundant: it lives on several independent relays, so no single operator can memory-hole it. **Steward's Watch** turns that from a hope into a live guarantee. Give it a manifest of record ids and it asks *every* relay, one at a time, whether it still holds each record. It reports coverage (this record is on 3 of 5 relays), and when a relay has dropped a record it re-inscribes it: fetch the record from a relay that still has it, verify the signature with record-core, and re-broadcast it to the relays that lost it. A record that no relay still holds is reported loudly as at-risk. It is never fabricated.

**Manifest** (`watch/example-manifest.json`) is JSON. Either a bare array of hex event ids, or an object with an optional relay list:
```json
{
  "relays": ["wss://relay.damus.io", "wss://nos.lol"],
  "events": [{ "id": "<64-char hex event id>", "author": "<hex pubkey, optional>" }]
}
```
If you omit `relays`, the default relay set from record-core is used.

**Two commands:**
```bash
node watch/steward.mjs watch/example-manifest.json                 # one-shot: check + heal
node watch/steward.mjs watch/example-manifest.json --watch --interval=600   # loop every 600s
```
Add `--json` for a strict machine-readable report a site badge can consume:
```json
{ "checkedAt": "...", "events": [{ "id": "...", "present": [...], "missing": [...], "reinscribed": 2, "atRisk": false }] }
```

**Honest note:** this makes redundancy *checkable and self-healing*, not records eternal. Steward's Watch widens the margin by copying a record back onto relays that dropped it, but it cannot resurrect one that has fallen off every relay it knows about. A record lives only as long as one relay keeps a copy. Run your own relay ([RELAY.md](RELAY.md)) and you are one of those copies.

## Layout

```
core/record.mjs   the shared sign-and-publish logic
cli/record.mjs    the command-line tool
watch/steward.mjs relay health monitor + auto re-inscription (Steward's Watch)
web/              the no-install web app (Federal Brass)
relay/            run your own relay (Docker + Caddy) — see RELAY.md
site-patch/       make the book site's Nostr panel real — see site-patch/INTEGRATION.md
```

## Verify this repo actually works
Run `node cli/record.mjs "hello from the record"`, open the link it prints, and you'll see your signed note live on the public network — readable from multiple relays, owned by no one. That's the proof.

Built with [nostr-tools](https://github.com/nbd-wtf/nostr-tools). MIT licensed. Part of *You Cannot Eat Code* — the first of one real tool per recording layer.
