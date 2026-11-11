// Browser side of scripts/lib/crypto.mjs. Nothing readable is served without the login.
const subtle = crypto.subtle;
const enc = new TextEncoder();
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const tob64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const KEY_SLOT = 'hm-stock-session';

async function getJson(path) {
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return res.json();
}

export class WrongLogin extends Error {}

export async function unlock(userId, password) {
  const keyring = await getJson('data/keyring.json');
  const base = await subtle.importKey('raw', enc.encode(`${userId.trim().toLowerCase()}:${password}`), 'PBKDF2', false, ['deriveKey']);
  const kek = await subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64(keyring.kdf.salt), iterations: keyring.kdf.iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  try {
    return await subtle.decrypt({ name: 'AES-GCM', iv: b64(keyring.iv) }, kek, b64(keyring.privateKey));
  } catch {
    throw new WrongLogin('That user ID and password don’t match.');
  }
}

export function remember(pkcs8, persist) {
  const value = tob64(pkcs8);
  try {
    sessionStorage.setItem(KEY_SLOT, value);
    if (persist) localStorage.setItem(KEY_SLOT, value);
  } catch {}
}

export function recall() {
  try {
    const v = sessionStorage.getItem(KEY_SLOT) || localStorage.getItem(KEY_SLOT);
    return v ? b64(v).buffer : null;
  } catch { return null; }
}

export function forget() {
  try { sessionStorage.removeItem(KEY_SLOT); localStorage.removeItem(KEY_SLOT); } catch {}
}

async function privateKeyFrom(pkcs8) {
  return subtle.importKey('pkcs8', pkcs8, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['unwrapKey']);
}

async function open(envelope, privateKey) {
  const dataKey = await subtle.unwrapKey('raw', b64(envelope.key), privateKey, { name: 'RSA-OAEP' }, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const gz = await subtle.decrypt({ name: 'AES-GCM', iv: b64(envelope.iv) }, dataKey, b64(envelope.data));
  const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

export async function loadAll(pkcs8) {
  const key = await privateKeyFrom(pkcs8);
  const [inventoryEnv, historyEnv] = await Promise.all([
    getJson('data/inventory.enc.json'),
    getJson('data/history.enc.json').catch(() => ({ days: [] })),
  ]);
  const inventory = await open(inventoryEnv, key);
  const history = (await Promise.all(historyEnv.days.map((d) => open(d.entry, key).catch(() => null)))).filter(Boolean);
  return { inventory, history };
}
