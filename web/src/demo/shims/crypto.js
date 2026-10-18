// createHash('sha256') sinkron untuk rantai hash BKU di browser
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export function createHash(alg) {
  if (alg !== 'sha256') throw new Error(`Algoritma ${alg} tidak didukung di mode demo`);
  const h = sha256.create();
  const api = {
    update: (s) => { h.update(typeof s === 'string' ? utf8ToBytes(s) : s); return api; },
    digest: (fmt) => (fmt === 'hex' ? bytesToHex(h.digest()) : h.digest()),
  };
  return api;
}

export default { createHash };
