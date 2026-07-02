#!/usr/bin/env node
// ============================================================
// Steward's Watch — relay health monitor + auto re-inscription daemon.
//
// The book's promise is that a civic record is durable because it is redundant:
// it lives on several independent relays, so no single operator can memory-hole
// it. Steward's Watch makes that promise a *live guarantee* instead of a hope.
//
// Given a manifest of civic records (event ids), it asks EVERY configured relay,
// one at a time, whether it still holds each record. It reports coverage (this
// record is on 3 of 5 relays) and, for any relay that dropped a record, it
// re-inscribes: fetch the record from a relay that still has it, verify its
// signature with record-core, and re-broadcast it to the relays that are missing
// it. A record present nowhere is reported loudly as at-risk — never fabricated.
//
// Honest framing: this makes redundancy *checkable and self-healing*, not
// records eternal. A record lives as long as one relay keeps a copy; the watch
// widens that margin by copying it back onto relays that dropped it, but it
// cannot resurrect a record that has fallen off every relay it knows about.
//
//   node watch/steward.mjs <manifest.json>              one-shot check + heal
//   node watch/steward.mjs <manifest.json> --json       machine-readable report
//   node watch/steward.mjs <manifest.json> --watch --interval=600   loop
//
// Part of the You Cannot Eat Code tool family. MIT.
// ============================================================
import * as NostrTools from 'nostr-tools';
import { verifyRecord, publishRecord, CRP } from '@youcannoteat/record-core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const C = { b: '\x1b[1m', d: '\x1b[2m', y: '\x1b[33m', g: '\x1b[32m', r: '\x1b[31m', c: '\x1b[36m', x: '\x1b[0m' };

const FETCH_TIMEOUT_MS = 6000;   // per-relay fetch bound; a hung relay counts as absent
const PUBLISH_TIMEOUT_MS = 8000; // per-relay re-broadcast bound (record-core default)

const USAGE = `${C.b}Steward's Watch${C.x} — relay health monitor + auto re-inscription.

  ${C.y}node watch/steward.mjs${C.x} <manifest.json>
  ${C.y}node watch/steward.mjs${C.x} <manifest.json> ${C.c}--watch --interval=600${C.x}
  ${C.y}node watch/steward.mjs${C.x} <manifest.json> ${C.c}--json${C.x}

Options
  ${C.c}--watch${C.x}              keep running; re-check on an interval
  ${C.c}--interval=${C.x}<sec>     seconds between checks in --watch mode (default 600)
  ${C.c}--json${C.x}               emit strict JSON (for a site badge to consume)
  ${C.c}--help${C.x}, ${C.c}-h${C.x}           show this

Manifest (JSON): either a bare array of hex event ids, or
  { "relays": ["wss://relay.example"], "events": [{ "id": "<hex>", "author": "<hex-optional>" }] }
If "relays" is omitted, the record-core default relay set is used.

For each record: every relay is asked whether it still holds it. Coverage is
reported (present on X/Y; which relays are missing). A record present somewhere
but dropped by some relays is fetched, its signature verified, and re-broadcast
to the relays that lost it. A record present nowhere is flagged at-risk. This
makes redundancy checkable and self-healing, not records eternal.`;

// ---- args ---------------------------------------------------------
function parseArgs(argv) {
  const out = { manifest: null, watch: false, interval: 600, json: false, help: false };
  for (const a of argv) {
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--watch') out.watch = true;
    else if (a === '--json') out.json = true;
    else if (a.startsWith('--interval=')) {
      const n = Number(a.slice('--interval='.length));
      if (Number.isFinite(n) && n > 0) out.interval = Math.floor(n);
    } else if (a.startsWith('--')) {
      // unknown flag: ignore rather than crash a scheduled run
    } else if (!out.manifest) out.manifest = a;
  }
  return out;
}

// ---- manifest -----------------------------------------------------
const HEX64 = /^[0-9a-f]{64}$/i;

function loadManifest(path) {
  let raw;
  try {
    raw = readFileSync(resolve(path), 'utf8');
  } catch (e) {
    throw new Error(`cannot read manifest "${path}": ${(e && e.message) || e}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`manifest "${path}" is not valid JSON: ${(e && e.message) || e}`);
  }

  let relays = [];
  let rawEvents;
  if (Array.isArray(data)) {
    rawEvents = data;
  } else if (data && typeof data === 'object') {
    if (Array.isArray(data.relays)) relays = data.relays;
    rawEvents = Array.isArray(data.events) ? data.events : [];
  } else {
    throw new Error('manifest must be a JSON array of ids or an object { relays, events }');
  }

  // Normalize relays: strings, trimmed, unique. Empty -> defaults.
  relays = [...new Set(relays.map((r) => String(r).trim()).filter(Boolean))];
  if (!relays.length) relays = [...CRP.DEFAULT_RELAYS];

  // Normalize events: accept "<id>" or { id, author }. Dedupe by id.
  const seen = new Set();
  const events = [];
  for (const ev of rawEvents) {
    let id;
    let author;
    if (typeof ev === 'string') id = ev.trim();
    else if (ev && typeof ev === 'object') {
      id = String(ev.id || '').trim();
      if (ev.author) author = String(ev.author).trim();
    }
    if (!id) continue;
    if (!HEX64.test(id)) {
      throw new Error(`manifest event id is not a 64-char hex string: "${id}"`);
    }
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(author ? { id, author } : { id });
  }
  if (!events.length) throw new Error('manifest lists no event ids to check');
  return { relays, events };
}

// ---- fetch one record from ONE relay, bounded --------------------
// Returns the event object if that single relay holds it, else null. A hung or
// dead relay resolves to null within FETCH_TIMEOUT_MS rather than hanging.
async function fetchFromRelay(pool, relay, id) {
  let timer;
  const timeout = new Promise((res) => {
    timer = setTimeout(() => res({ __timeout: true }), FETCH_TIMEOUT_MS);
  });
  try {
    const got = await Promise.race([
      pool.get([relay], { ids: [id] }, { maxWait: FETCH_TIMEOUT_MS }).catch(() => null),
      timeout
    ]);
    if (got && got.__timeout) return null;
    return got || null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- check + heal one record -------------------------------------
async function checkEvent(pool, relays, ev) {
  const present = [];   // relays that hold it
  const missing = [];   // relays that don't (or timed out)
  let verified = null;  // a signature-verified copy, if we got one
  let sawInvalid = false;

  // Ask each relay in turn. (Serial keeps memory/socket use tiny and the output
  // deterministic; the record set per town is small.)
  for (const relay of relays) {
    const got = await fetchFromRelay(pool, relay, ev.id);
    if (!got) { missing.push(relay); continue; }
    present.push(relay);
    // Verify the first copy we see (and re-verify until we have a good one).
    if (!verified) {
      const v = verifyRecord(got, NostrTools);
      if (v.valid) verified = got;
      else sawInvalid = true;
    }
  }

  const result = {
    id: ev.id,
    present,
    missing,
    reinscribed: 0,
    atRisk: present.length === 0,
    invalid: false,
    reinscribedTo: [],
    reinscribeErrors: []
  };

  // Present nowhere: at-risk, nothing to re-broadcast. Never fabricate.
  if (present.length === 0) return result;

  // Present, but every copy we fetched failed signature verification. Do NOT
  // re-broadcast an unverifiable event — that would spread a forgery.
  if (!verified) {
    result.invalid = sawInvalid;
    return result;
  }

  // Present on all relays: nothing to heal.
  if (missing.length === 0) return result;

  // Re-inscribe the verified copy onto the relays that dropped it.
  try {
    const report = await publishRecord(verified, missing, NostrTools, { timeoutMs: PUBLISH_TIMEOUT_MS });
    result.reinscribed = report.accepted;
    result.reinscribedTo = report.per.filter((p) => p.ok).map((p) => p.relay);
    result.reinscribeErrors = report.per.filter((p) => !p.ok).map((p) => ({ relay: p.relay, error: p.error }));
  } catch (e) {
    result.reinscribeErrors = missing.map((relay) => ({ relay, error: String((e && e.message) || e) }));
  }
  return result;
}

// ---- one full pass over the manifest ------------------------------
async function runOnce({ relays, events }) {
  const pool = new NostrTools.SimplePool();
  const out = [];
  try {
    for (const ev of events) {
      out.push(await checkEvent(pool, relays, ev));
    }
  } finally {
    try { pool.close(relays); } catch (e) { /* pool already closing */ }
  }
  return { checkedAt: new Date().toISOString(), relayCount: relays.length, events: out };
}

// ---- reporting ----------------------------------------------------
function toJson(pass) {
  // Strict, stable shape for a site badge to consume.
  return {
    checkedAt: pass.checkedAt,
    events: pass.events.map((e) => ({
      id: e.id,
      present: e.present,
      missing: e.missing,
      reinscribed: e.reinscribed,
      atRisk: e.atRisk
    }))
  };
}

function short(id) { return id.slice(0, 8) + '…' + id.slice(-4); }

function printHuman(pass) {
  const total = pass.relayCount;
  let atRisk = 0;
  let healed = 0;
  console.log(`${C.b}Steward's Watch${C.x} ${C.d}${pass.checkedAt}${C.x}`);
  console.log(`${C.d}Checking ${pass.events.length} record(s) across ${total} relay(s).${C.x}\n`);

  for (const e of pass.events) {
    const cov = `${e.present.length}/${total}`;
    if (e.atRisk) {
      atRisk++;
      console.log(`  ${C.r}✗ ${short(e.id)}  AT RISK — present on 0/${total} relays.${C.x}`);
      console.log(`    ${C.r}No relay we asked still holds this record. It may be lost.${C.x}`);
      console.log(`    ${C.d}${e.id}${C.x}`);
      continue;
    }
    if (e.invalid) {
      console.log(`  ${C.y}⚠ ${short(e.id)}  present on ${cov}, but the copy failed signature verification — not re-broadcast.${C.x}`);
      console.log(`    ${C.d}${e.id}${C.x}`);
      continue;
    }
    if (e.missing.length === 0) {
      console.log(`  ${C.g}✓ ${short(e.id)}  fully redundant — present on ${cov} relays.${C.x}`);
      continue;
    }
    // Present but incomplete: report the heal.
    const mark = e.reinscribed > 0 ? C.g : C.y;
    console.log(`  ${mark}● ${short(e.id)}  present on ${cov}; ${e.missing.length} relay(s) had dropped it.${C.x}`);
    if (e.reinscribed > 0) {
      healed++;
      console.log(`    ${C.g}re-inscribed to ${e.reinscribed}/${e.missing.length}:${C.x} ${e.reinscribedTo.join(', ')}`);
    }
    for (const err of e.reinscribeErrors) {
      console.log(`    ${C.y}could not re-inscribe to ${err.relay}: ${err.error}${C.x}`);
    }
  }

  console.log('');
  const parts = [`${pass.events.length} checked`];
  if (healed) parts.push(`${C.g}${healed} healed${C.x}`);
  if (atRisk) parts.push(`${C.r}${atRisk} at risk${C.x}`);
  console.log(`${C.b}Summary:${C.x} ${parts.join(' · ')}`);
  if (atRisk) {
    console.log(`${C.d}At-risk records live nowhere we can see. Re-inscription cannot resurrect them; a record lives only as long as one relay keeps a copy.${C.x}`);
  }
}

// ---- main ---------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return; }
  if (!args.manifest) {
    console.error(`${C.r}Error:${C.x} a manifest path is required.\n`);
    console.log(USAGE);
    process.exit(1);
  }

  let manifest;
  try {
    manifest = loadManifest(args.manifest);
  } catch (e) {
    if (args.json) console.log(JSON.stringify({ error: String((e && e.message) || e) }));
    else console.error(`${C.r}Error:${C.x} ${(e && e.message) || e}`);
    process.exit(1);
  }

  const doPass = async () => {
    const pass = await runOnce(manifest);
    if (args.json) console.log(JSON.stringify(toJson(pass)));
    else printHuman(pass);
    return pass;
  };

  if (!args.watch) {
    await doPass();
    return;
  }

  // --watch: loop forever, one pass every `interval` seconds, until Ctrl-C.
  if (!args.json) {
    console.log(`${C.d}Watch mode: re-checking every ${args.interval}s. Ctrl-C to stop.${C.x}\n`);
  }
  let stopped = false;
  const stop = () => { stopped = true; };
  process.on('SIGINT', () => { stop(); process.exit(0); });
  process.on('SIGTERM', () => { stop(); process.exit(0); });

  // eslint-disable-next-line no-constant-condition
  while (!stopped) {
    try {
      await doPass();
    } catch (e) {
      if (args.json) console.log(JSON.stringify({ error: String((e && e.message) || e) }));
      else console.error(`${C.r}Pass failed:${C.x} ${(e && e.message) || e}`);
    }
    if (stopped) break;
    if (!args.json) console.log(`${C.d}— next check in ${args.interval}s —${C.x}\n`);
    await new Promise((res) => setTimeout(res, args.interval * 1000));
  }
}

main().catch((e) => {
  console.error(`${C.r}Error:${C.x} ${(e && e.message) || e}`);
  process.exit(1);
});
