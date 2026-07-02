// ============================================================
// The Record — core publish logic (Node / ESM).
// Thin adapter over @youcannoteat/record-core (the Civic Record Protocol
// reference implementation), so The Record and the rest of the tool family
// share one signing/publishing/verifying core. A fix in record-core is a fix
// here. The browser app (web/record.js) mirrors this against window.NostrTools.
// Spec: github.com/michaelditter/civic-record-protocol
// ============================================================
import * as NostrTools from 'nostr-tools';
import {
  CRP, buildRecord, signRecord, publishRecord as publishToRelays, recordLinks
} from '@youcannoteat/record-core';

const { generateSecretKey, getPublicKey, nip19 } = NostrTools;

// Free, public relays that accept anonymous writes (verify current status at nostr.watch).
export const DEFAULT_RELAYS = [...CRP.DEFAULT_RELAYS];

// The tags every record carries. record-core adds ['client','the-record'],
// ['t','youcannoteat'], and ['t','civic-record']; we also keep the legacy
// ['t','therecord'] hashtag so existing searches keep working.
export const DEFAULT_TAGS = [
  ['t', 'therecord'],
  ['t', 'youcannoteat'],
  ['client', 'the-record']
];

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

  // Build via record-core (CRP tags), keeping the legacy 'therecord' hashtag for continuity.
  const template = buildRecord({
    content: String(text).trim(),
    client: 'the-record',
    extraTags: [['t', 'therecord'], ...extraTags]
  });
  const event = signRecord(template, sk, NostrTools);
  const links = recordLinks(event, NostrTools, relays);
  const report = await publishToRelays(event, relays, NostrTools);

  return {
    id: event.id,
    pubkey: pk,
    npub: nip19.npubEncode(pk),
    note1: nip19.noteEncode(event.id),
    nevent: links.nevent,
    link: links.njump,
    accepted: report.accepted,
    total: report.total,
    perRelay: report.per, // [{ relay, ok, error }]
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
