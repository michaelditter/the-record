// Shamir round-trip harness for the Town Seal.
// Loads the vendored secrets.js exactly as the browser would (as a global),
// then hammers split->combine with random 32-byte keys across random k-of-n
// subsets, asserting EXACT hex equality, and asserts k-1 shares do NOT
// reconstruct the original secret.
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const SECRETS_PATH = process.argv[2] ||
  '/Users/michaelditter/projects/the-record/web/vendor/secrets.min.js';

// Emulate the browser: secrets.js is UMD; under a bare `this` with no module,
// it attaches to the root object. We give it a root with a WebCrypto `crypto`.
const src = readFileSync(SECRETS_PATH, 'utf8');
const root = { crypto: webcrypto };
const fn = new Function('root', 'module', 'exports', 'window',
  src + '\n;return (typeof secrets !== "undefined" ? secrets : root.secrets);');
const secrets = fn.call(root, root, undefined, undefined, root);
if (!secrets || typeof secrets.share !== 'function') {
  throw new Error('secrets.js did not expose share(); global not found');
}

// The town key hex is 64 chars (32 bytes). secrets.js default bits=8 config
// splits over GF(256). Use the library defaults (init not required).
const cfg = secrets.getConfig();
console.log('secrets config:', JSON.stringify(cfg));
if (!cfg.hasCSPRNG) throw new Error('secrets.js reports no CSPRNG in this env');

function randKeyHex() {
  const b = new Uint8Array(32);
  webcrypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// pick k distinct indices from [0,n)
function pickSubset(n, k) {
  const idx = [...Array(n).keys()];
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, k).sort((a, b) => a - b);
}

const ROUNDS = 200;
let ok = 0;
const configs = [];
for (let r = 0; r < ROUNDS; r++) {
  // random n in [3,7], random k in [2,n]
  const n = 3 + Math.floor(Math.random() * 5);       // 3..7
  const k = 2 + Math.floor(Math.random() * (n - 1)); // 2..n
  const key = randKeyHex();
  const shares = secrets.share(key, n, k);
  if (shares.length !== n) throw new Error(`round ${r}: expected ${n} shares, got ${shares.length}`);

  // several k-subsets must each reconstruct exactly
  for (let s = 0; s < 3; s++) {
    const subset = pickSubset(n, k).map((i) => shares[i]);
    const got = secrets.combine(subset);
    // secrets.combine may drop leading zero nibbles -> normalize to 64 chars
    const norm = got.padStart(64, '0');
    if (norm !== key) {
      throw new Error(`round ${r} (n=${n},k=${k}) subset reconstruct MISMATCH\n  want ${key}\n  got  ${norm}`);
    }
  }

  // k-1 shares must NOT reconstruct the secret
  if (k - 1 >= 1) {
    const under = pickSubset(n, k - 1).map((i) => shares[i]);
    const got = secrets.combine(under).padStart(64, '0');
    if (got === key) {
      throw new Error(`round ${r} (n=${n},k=${k}): k-1=${k - 1} shares RECONSTRUCTED the secret — Shamir broken`);
    }
  }
  ok++;
  configs.push(`${k}-of-${n}`);
}

console.log(`PASS: ${ok}/${ROUNDS} random round-trips exact; k-1 never reconstructed.`);
console.log('sample configs tested:', [...new Set(configs)].sort().join(', '));

// Explicit 3-of-5 default check (the ceremony default)
const key = randKeyHex();
const sh = secrets.share(key, 5, 3);
// every 3-subset of 5 = C(5,3)=10 combinations, all must match
let combos = 0;
for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) for (let c = b + 1; c < 5; c++) {
  const got = secrets.combine([sh[a], sh[b], sh[c]]).padStart(64, '0');
  if (got !== key) throw new Error(`3-of-5 combo (${a},${b},${c}) mismatch`);
  combos++;
}
// every 2-subset (below threshold) must fail
for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) {
  const got = secrets.combine([sh[a], sh[b]]).padStart(64, '0');
  if (got === key) throw new Error(`3-of-5: 2 shares reconstructed — broken`);
}
console.log(`PASS: default 3-of-5 — all ${combos} of 10 triples reconstruct exactly; all 10 pairs fail.`);
console.log('ALL SHAMIR TESTS PASSED');
