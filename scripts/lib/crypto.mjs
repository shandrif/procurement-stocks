// Envelope encryption shared with assets/vault.js (browser).
//   keyring.json  — RSA-OAEP public key + private key sealed with
//                   AES-GCM(PBKDF2-SHA256(userId:password, salt))
//   *.enc.json    — gzip(JSON) sealed with a fresh AES-256-GCM key, which is
//                   wrapped by the RSA public key.
// The daily import only needs the public key, so no password ever lives in
// the repository or in the scheduled job.

import { webcrypto as crypto } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const subtle = crypto.subtle;
export const PBKDF2_ITERATIONS = 600_000;
const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const enc = new TextEncoder();

async function deriveKek(userId, password, salt, iterations) {
  const base = await subtle.importKey('raw', enc.encode(`${userId.trim().toLowerCase()}:${password}`), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function createKeyring(userId, password) {
  const pair = await subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
  );
  const pkcs8 = await subtle.exportKey('pkcs8', pair.privateKey);
  const spki = await subtle.exportKey('spki', pair.publicKey);
  return { v: 1, publicKey: b64(spki), ...(await sealPrivateKey(pkcs8, userId, password)) };
}

async function sealPrivateKey(pkcs8, userId, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const kek = await deriveKek(userId, password, salt, PBKDF2_ITERATIONS);
  const sealed = await subtle.encrypt({ name: 'AES-GCM', iv }, kek, pkcs8);
  return { kdf: { name: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, salt: b64(salt) }, iv: b64(iv), privateKey: b64(sealed) };
}

export async function rekeyKeyring(keyring, oldUser, oldPassword, newUser, newPassword) {
  const kek = await deriveKek(oldUser, oldPassword, unb64(keyring.kdf.salt), keyring.kdf.iterations);
  let pkcs8;
  try {
    pkcs8 = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(keyring.iv) }, kek, unb64(keyring.privateKey));
  } catch {
    throw new Error('Current user ID or password is wrong.');
  }
  return { v: 1, publicKey: keyring.publicKey, ...(await sealPrivateKey(pkcs8, newUser, newPassword)) };
}

export async function sealJson(value, keyring) {
  const publicKey = await subtle.importKey('spki', unb64(keyring.publicKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['wrapKey']);
  const dataKey = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = await subtle.encrypt({ name: 'AES-GCM', iv }, dataKey, gzipSync(enc.encode(JSON.stringify(value))));
  const wrapped = await subtle.wrapKey('raw', dataKey, publicKey, { name: 'RSA-OAEP' });
  return { v: 1, key: b64(wrapped), iv: b64(iv), data: b64(body) };
}
