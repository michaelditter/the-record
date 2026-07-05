// Full-path test for the Town Seal declaration:
//   generate key -> split -> reconstruct from a k-subset -> build the CRP
//   charter EXACTLY as seal.js does -> sign -> verifyRecord.
// Confirms the published declaration is signature-valid AND CRP-compliant, and
// that the reconstructed key derives the same npub as the original (so recovery
// yields the town seal).
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import * as NT from '/Users/michaelditter/projects/the-record/node_modules/nostr-tools/lib/esm/index.js';
import * as RC from '/Users/michaelditter/projects/the-record/web/vendor/record-core.mjs';

// load vendored secrets.js as the browser would
const src = readFileSync('/Users/michaelditter/projects/the-record/web/vendor/secrets.min.js', 'utf8');
const root = { crypto: webcrypto };
const secrets = new Function('root', src + '\n;return (typeof secrets!=="undefined"?secrets:root.secrets);').call(root, root);

const bytesToHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
function hexToBytes(hex) {
  const s = String(hex).trim().toLowerCase().padStart(64, '0');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const townName = 'Goshen', townState = 'CT', k = 3, n = 5;
const officers = [
  { name: 'Mariann Wolcott', role: 'Town Clerk' },
  { name: 'A. Salisbury', role: 'First Selectman' },
  { name: 'J. Norton', role: 'Treasurer' },
  { name: 'E. Beecher', role: 'Fire Chief' },
  { name: 'C. Meyers', role: 'Records Officer' }
];

// 1. generate + split + reconstruct
const sk = NT.generateSecretKey();
const skHex = bytesToHex(sk);
const originalNpub = NT.nip19.npubEncode(NT.getPublicKey(sk));
const shares = secrets.share(skHex, n, k);
const reconHex = secrets.combine([shares[0], shares[2], shares[4]]).padStart(64, '0');
if (reconHex !== skHex) throw new Error('reconstruct mismatch');
const reconNpub = NT.nip19.npubEncode(NT.getPublicKey(hexToBytes(reconHex)));
if (reconNpub !== originalNpub) throw new Error('reconstructed key derives a DIFFERENT npub');
console.log('PASS: 3-of-5 reconstruct yields the same town npub:', reconNpub);

// 2. build the declaration exactly like seal.js
const townLine = townState ? (townName + ', ' + townState) : townName;
const content =
  'The town of ' + townLine + ' adopts this public seal on July 5, 2026. ' +
  'Records signed by this key are the town official record. ' +
  'The signing key is held ' + k + '-of-' + n + ' by named officers, ' +
  'so no one person can sign alone and no one loss can lose the town its seal.';
const officerExtra = [['threshold', k + '-of-' + n]];
officers.forEach((o) => officerExtra.push(['officer', o.name, o.role || '']));

const tpl = RC.buildCharter({
  content,
  title: 'Town Seal of ' + townLine,
  summary: 'Public municipal seal, held ' + k + '-of-' + n + ' by named officers.',
  d: 'town-seal',
  client: 'the-record',
  town: { name: townName, state: townState },
  extraTags: officerExtra
});

// 3. sign with the reconstructed key (proves recovery can sign as the town)
const event = RC.signRecord(tpl, hexToBytes(reconHex), NT);

// 4. verify
const v = RC.verifyRecord(event, NT);
console.log('verifyRecord ->', JSON.stringify(v));
if (!v.valid) throw new Error('signature invalid');
if (!v.crpCompliant) throw new Error('NOT CRP-compliant: ' + v.reasons.join('; '));

// 5. confirm the on-wire shape: kind, d, town scope, threshold, officers; and
//    that NO share and NO secret hex appears anywhere in the event.
const tags = event.tags;
const has = (name, val) => tags.some((t) => t[0] === name && (val === undefined || t[1] === val));
const townSlug = RC.townSlug(townName, townState); // town-ct-goshen
if (event.kind !== 30023) throw new Error('wrong kind');
if (!has('d', 'town-seal')) throw new Error('missing d=town-seal');
if (!tags.some((t) => t[0] === 't' && t[1] === townSlug)) throw new Error('missing town scope ' + townSlug);
if (!has('threshold', '3-of-5')) throw new Error('missing threshold tag');
const officerTagCount = tags.filter((t) => t[0] === 'officer').length;
if (officerTagCount !== n) throw new Error('expected ' + n + ' officer tags, got ' + officerTagCount);
console.log('PASS: kind 30023, d=town-seal, t=' + townSlug + ', threshold=3-of-5, ' + officerTagCount + ' officer tags.');

// key-leak scan: the secret hex and every share must be absent from the event JSON
const blob = JSON.stringify(event);
if (blob.includes(skHex)) throw new Error('LEAK: secret hex is in the published event');
for (const sh of shares) { if (blob.includes(sh)) throw new Error('LEAK: a share is in the published event'); }
if (/nsec1/.test(blob)) throw new Error('LEAK: an nsec is in the published event');
console.log('PASS: published event contains no secret hex, no share, no nsec.');
console.log('officer tags sample:', JSON.stringify(tags.filter((t) => t[0] === 'officer').slice(0, 2)));
console.log('ALL CRP TESTS PASSED');
