#!/usr/bin/env node
// ============================================================
// The Record — CLI.  Put a signed, uncensorable record on Nostr.
//   the-record "We voted 4–1 to keep the town green a commons."
//   echo "..." | the-record
//   the-record whoami        → show your public name (npub)
// Key lives in ~/.the-record/key (nsec) or $THE_RECORD_NSEC.
// Add your own relay with $THE_RECORD_RELAYS=wss://relay.mytown.org
// ============================================================
import { publishRecord, skFromNsec, newIdentity, DEFAULT_RELAYS } from '../core/record.mjs';
import { getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const C = { b: '\x1b[1m', d: '\x1b[2m', y: '\x1b[33m', g: '\x1b[32m', r: '\x1b[31m', x: '\x1b[0m' };
const KEY_DIR = join(homedir(), '.the-record');
const KEY_FILE = join(KEY_DIR, 'key');

function relays() {
  const extra = (process.env.THE_RECORD_RELAYS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...new Set([...DEFAULT_RELAYS, ...extra])];
}

function loadOrCreateKey() {
  if (process.env.THE_RECORD_NSEC) return { nsec: process.env.THE_RECORD_NSEC.trim(), fresh: false };
  if (existsSync(KEY_FILE)) return { nsec: readFileSync(KEY_FILE, 'utf8').trim(), fresh: false };
  const id = newIdentity();
  mkdirSync(KEY_DIR, { recursive: true });
  writeFileSync(KEY_FILE, id.nsec + '\n', { mode: 0o600 });
  try { chmodSync(KEY_FILE, 0o600); } catch (e) {}
  return { nsec: id.nsec, npub: id.npub, fresh: true };
}

function readStdin() {
  return new Promise((res) => {
    if (process.stdin.isTTY) return res('');
    let d = ''; process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (d += c));
    process.stdin.on('end', () => res(d.trim()));
  });
}

const USAGE = `${C.b}the-record${C.x} — put a signed, uncensorable record on Nostr.

  ${C.y}the-record${C.x} "your record in your own words"
  echo "..." | ${C.y}the-record${C.x}
  ${C.y}the-record whoami${C.x}        show your public name (npub)
  ${C.y}the-record keypath${C.x}       where your secret key is stored

Your identity lives in ${C.d}${KEY_FILE}${C.x} (or $THE_RECORD_NSEC).
Add your own relay: ${C.d}THE_RECORD_RELAYS=wss://relay.mytown.org${C.x}
A record is ${C.b}public and unrecallable${C.x} — that is the point. Back up your key.`;

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--help' || args[0] === '-h') { console.log(USAGE); return; }
  if (args[0] === 'keypath') { console.log(KEY_FILE); return; }
  if (args[0] === 'whoami') {
    // whoami must never mint an identity — only report an existing one.
    const nsec = process.env.THE_RECORD_NSEC
      ? process.env.THE_RECORD_NSEC.trim()
      : (existsSync(KEY_FILE) ? readFileSync(KEY_FILE, 'utf8').trim() : null);
    if (!nsec) {
      console.log(`${C.y}No identity yet.${C.x} One is created the first time you record. Key path: ${C.d}${KEY_FILE}${C.x}`);
      return;
    }
    console.log(npubEncode(getPublicKey(skFromNsec(nsec))));
    return;
  }

  let text = args.join(' ').trim();
  if (!text) text = await readStdin();
  if (!text) { console.log(USAGE); process.exit(1); }

  const key = loadOrCreateKey();
  if (key.fresh) {
    console.log(`${C.y}● New identity created — this is now your public name.${C.x}`);
    console.log(`  ${C.b}Back up your secret key${C.x} (anyone who has it can post as you):`);
    console.log(`  ${C.d}${KEY_FILE}${C.x}\n`);
  }

  const sk = skFromNsec(key.nsec);
  process.stdout.write(`${C.d}Signing and broadcasting to ${relays().length} relays…${C.x}\n`);
  const out = await publishRecord({ text, sk, relays: relays() });

  console.log('');
  out.perRelay.forEach((r) => {
    const mark = r.ok ? `${C.g}✓ accepted${C.x}` : `${C.r}✗ ${r.error}${C.x}`;
    console.log(`  ${r.relay.padEnd(26)} ${mark}`);
  });
  console.log('');
  if (out.accepted > 0) {
    console.log(`${C.g}${C.b}On the record.${C.x} Live on ${out.accepted}/${out.total} relays — no platform can recall it.`);
    console.log(`${C.b}Verify / share:${C.x} ${out.link}`);
    console.log(`${C.d}signed by ${out.npub}${C.x}`);
    process.exit(0);
  } else {
    console.log(`${C.r}No relay accepted it.${C.x} Check your connection or the relay list, then try again.`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(`${C.r}Error:${C.x} ${(e && e.message) || e}`); process.exit(1); });
