# The Record

**Put it on the record. Permanently. In your name. On a network no one owns.**

A tiny, real tool to publish a signed, uncensorable public record to [Nostr](https://nostr.com) — an open relay protocol. You sign a note with a key only you hold, and broadcast it to several independent relays. The signature is your byline. No platform can edit it, and no platform can take it back.

This is the **recording method** from the book *[You Cannot Eat Code](https://youcannoteat.codes)* — made real. The book's first law: *keep a portable, attributed record of your judgment in a medium you control.* This is that, in about a hundred lines of code.

> A pamphlet, once printed, belonged to everyone who held a copy. A signed note on an open relay protocol works the same way.

---

## What it's for

- A **town** posts a decision its residents can verify and no server can memory-hole.
- A **person** makes a public, timestamped, attributed commitment — or stakes a claim to an idea, first.
- A **maker** timestamps work in a medium they own, not a platform's database.

No accounts. No money. No tokens. Just a signature and the open network.

## Three ways to use it

### 1. The web app — no install
Open the app, write your record, hit **Sign & publish**. You get a permanent link (and a QR) anyone can verify on any Nostr client.
→ live at **[record.youcannoteat.codes](https://youcannoteat.codes)** · or run it locally: `npm run web` then open <http://127.0.0.1:4555>

It signs three ways, safest first:
1. **Your Nostr browser extension** (Alby, nos2x) — your key never touches the page.
2. **Bring your own `nsec`** — paste a key you already have.
3. **Generate one** — shown once, with a clear "save this" step.

### 2. The CLI — scriptable
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

## Layout

```
core/record.mjs   the shared sign-and-publish logic
cli/record.mjs    the command-line tool
web/              the no-install web app (Federal Brass)
relay/            run your own relay (Docker + Caddy) — see RELAY.md
site-patch/       make the book site's Nostr panel real — see site-patch/INTEGRATION.md
```

## Verify this repo actually works
Run `node cli/record.mjs "hello from the record"`, open the link it prints, and you'll see your signed note live on the public network — readable from multiple relays, owned by no one. That's the proof.

Built with [nostr-tools](https://github.com/nbd-wtf/nostr-tools). MIT licensed. Part of *You Cannot Eat Code* — the first of one real tool per recording layer.
