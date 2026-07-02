# Run your own relay — own the recording layer

Posting to public relays (`relay.damus.io`, `nos.lol`, …) already works and is
durable. But those are run by other people. The strongest version of *"a medium
you control"* is to run your own relay, so your town's records also live on
infrastructure **you** own. It costs about **$5 a month** and runs on a Raspberry
Pi if you'd rather not rent a server.

We use [`nostr-rs-relay`](https://github.com/scsibug/nostr-rs-relay) — Rust,
lightweight, no external database. The files are in [`relay/`](relay/).

## What you need
- A small **VPS** (1 vCPU / 1–2 GB RAM is plenty — Netcup, DigitalOcean, Hetzner, OVH), or a Raspberry Pi at home.
- A **domain/subdomain** you can point at it, e.g. `relay.yourtown.org`.
- **Docker** + **Docker Compose** installed (`curl -fsSL https://get.docker.com | sh`).

## 1. Edit the config
In [`relay/config.toml`](relay/config.toml), set your `relay_url`, `name`, and
`description`. Defaults are sane; the limits are fine for a town.

## 2. Start it
```bash
cd relay
docker compose up -d
docker compose logs -f       # watch it boot
```
The relay is now listening on **127.0.0.1:8080** (localhost only, by default, so
it is never exposed to the internet before you put TLS in front of it). Test it
by pointing any Nostr client (or this repo's CLI) at `ws://localhost:8080`:
```bash
THE_RECORD_RELAYS=ws://localhost:8080 node ../cli/record.mjs "first record on my own relay"
```

## 3. Put it on the internet with HTTPS
Relays must be served over `wss://` (TLS). [Caddy](https://caddyserver.com)
does this automatically.

1. Point `relay.yourtown.org`'s DNS **A record** at your server's IP, and wait
   for it to propagate (`dig +short relay.yourtown.org` should return your IP)
   **before** starting Caddy — Caddy needs working DNS to issue the TLS cert.
2. The relay is already bound to `127.0.0.1:8080` by default (step 2 above), so
   it is only reachable through Caddy. Nothing to change here.
3. Open your firewall for HTTP/HTTPS so Caddy can complete the ACME challenge
   and serve `wss://` (e.g. `sudo ufw allow 80,443/tcp`).
4. Install Caddy and use the provided [`relay/Caddyfile`](relay/Caddyfile) (edit the domain):
   ```bash
   sudo apt install -y caddy          # or your platform's install
   sudo cp Caddyfile /etc/caddy/Caddyfile   # edit the domain first
   sudo systemctl reload caddy
   ```
Caddy fetches and renews the TLS certificate for you. Your relay is live at
**`wss://relay.yourtown.org`**.

## 4. Use it
Add it everywhere you publish so your records land on your own infrastructure
*and* the public relays (redundancy):
- **CLI:** `THE_RECORD_RELAYS=wss://relay.yourtown.org node cli/record.mjs "…"`
- **Web app / site:** add the URL to the `RELAYS` array in `web/record.js` (or the site patch).

## Making it a private town relay (optional)
By default anyone can post to your relay — that's the commons. To accept writes
only from your town's keys, use the `[authorization]` `pubkey_whitelist` section
in `config.toml` (see the
[nostr-rs-relay reference](https://github.com/scsibug/nostr-rs-relay/blob/master/config.toml)).

## Keeping it healthy (the honest part)
- **Disk** grows with events — watch it; the limits in `config.toml` cap abuse.
- **Spam** is real on open relays; the rate limits help, and a whitelist removes it entirely.
- **Updates:** `docker compose pull && docker compose up -d` now and then.

## First-boot gotchas
- **Volume permissions.** The container runs as `user: 1000:1000` and writes its
  database to a fresh named volume. If the first boot fails with a permission or
  "unable to open database" error, the volume isn't owned by that UID. Fix it
  with `docker compose run --rm --user root relay chown -R 1000:1000 /usr/src/app/db`,
  or drop the `user:` line if your host maps differently.
- **DNS before TLS.** Don't start Caddy until `dig +short relay.yourtown.org`
  returns your server's IP, or the certificate request will fail.
- **Firewall.** Ports 80 and 443 must be open for Caddy's ACME challenge.

That's it. You're now part of the network that keeps your town's record — not
just a renter of someone else's.
