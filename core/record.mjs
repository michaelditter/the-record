// ============================================================
// The Record — core publish logic (Node / ESM).
// Sign a kind-1 note and broadcast it to real Nostr relays.
// The browser app (web/record.js) mirrors this against window.NostrTools.
// ============================================================
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
import * as nip19 from 'nostr-tools/nip19';

// Free, public relays that accept anonymous writes (verify current status at nostr.watch).
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.nostr.band'
];

// Tags make every record discoverable: search #therecord / #youcannoteat on any Nostr client.
export const DEFAULT_TAGS = [
  ['t', 'therecord'],
  ['t', 'youcannoteat'],
  ['client', 'the-record']
];

const withTimeout = (p, ms, relay) =>
  Promise.race([
    Promise.resolve(p).then(() => ({ relay, ok: true, error: null })),
    new Promise((res) => setTimeout(() => res({ relay, ok: false, error: 'timeout' }), ms))
  ]).catch((e) => ({ relay, ok: false, error: String((e && e.message) || e) }));

/**
 * publishRecord({ text, sk?, relays?, extraTags? })
 *  - text: the record (required)
 *  - sk:   Uint8Array secret key. If omitted, a new one is generated and returned (as nsec) to save.
 * Returns { id, npub, note1, nevent, link, accepted, total, perRelay, nsec, generated, event }.
 */
export async function publishRecord({ text, sk, relays = DEFAULT_RELAYS, extraTags = [] } = {}) {
  if (!text || !String(text).trim()) throw new Error('Nothing to record — text is empty.');
  let generated = false;
  if (!sk) { sk = generateSecretKey(); generated = true; }
  const pk = getPublicKey(sk);

  const event = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [...DEFAULT_TAGS, ...extraTags],
      content: String(text).trim()
    },
    sk
  );

  const pool = new SimplePool();
  const perRelay = await Promise.all(
    pool.publish(relays, event).map((p, i) => withTimeout(p, 8000, relays[i]))
  );
  try { pool.close(relays); } catch (e) { /* ignore */ }

  const accepted = perRelay.filter((r) => r.ok).length;
  const nevent = nip19.neventEncode({ id: event.id, relays: relays.slice(0, 2), author: pk });

  return {
    id: event.id,
    pubkey: pk,
    npub: nip19.npubEncode(pk),
    note1: nip19.noteEncode(event.id),
    nevent,
    link: `https://njump.me/${nevent}`,
    accepted,
    total: relays.length,
    perRelay,
    nsec: generated ? nip19.nsecEncode(sk) : null, // only surfaced when we generated it
    generated,
    event
  };
}

/** Decode an nsec string to a Uint8Array secret key. */
export function skFromNsec(nsec) {
  const { type, data } = nip19.decode(String(nsec).trim());
  if (type !== 'nsec') throw new Error('That is not an nsec secret key.');
  return data;
}

/** Generate a fresh identity: { nsec, npub }. */
export function newIdentity() {
  const sk = generateSecretKey();
  return { nsec: nip19.nsecEncode(sk), npub: nip19.npubEncode(getPublicKey(sk)) };
}
