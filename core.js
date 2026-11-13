// Pure logic shared by the board (app.js) and the admin page (admin.js).

export const WEEK_OPTIONS = [
  { value: 1, label: '一週', bg: '#1e7b34', fg: '#ffffff' },
  { value: 2, label: '兩週', bg: '#a6dba0', fg: '#1a1a1a' },
  { value: 3, label: '三週', bg: '#ffd84d', fg: '#1a1a1a' },
  { value: 4, label: '四週以上', bg: '#d64545', fg: '#ffffff' },
];

const INVALID_STYLE = { label: '—', bg: '#d0d0d0', fg: '#333' };

export function weekStyle(weeks) {
  const opt = WEEK_OPTIONS.find((o) => o.value === weeks);
  return opt ? { label: opt.label, bg: opt.bg, fg: opt.fg } : { ...INVALID_STYLE };
}

export function validateData(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'not an object' };
  if (!Array.isArray(obj.items) || obj.items.length === 0) return { ok: false, error: 'items missing' };
  if (obj.lastUpdate !== null && typeof obj.lastUpdate !== 'string') return { ok: false, error: 'bad lastUpdate' };
  const bad = obj.items.some((it) => !it || typeof it.id !== 'string' || typeof it.name !== 'string');
  if (bad) return { ok: false, error: 'bad item' };
  return { ok: true, data: obj };
}

const TAIPEI_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

export function formatTaipei(date, withSeconds) {
  const p = Object.fromEntries(TAIPEI_FMT.formatToParts(date).map((x) => [x.type, x.value]));
  const base = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  return withSeconds ? `${base}:${p.second}` : base;
}

export function formatLastUpdate(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? formatTaipei(d, false) : '—';
}

export function buildDataUrl(base, now) {
  return `${base}data.json?t=${now}`;
}

export function encodeBase64Utf8(s) {
  let bin = '';
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function decodeBase64Utf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// --- Password-encrypted token (PBKDF2-SHA256 -> AES-GCM). The blob is public; only the password unlocks it.

function bytesToB64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64ToBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export async function encryptToken(token, password, iterations = 600000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: iterations, salt: bytesToB64(salt), iv: bytesToB64(iv), ct: bytesToB64(new Uint8Array(ct)) };
}

export async function decryptToken(blob, password) {
  if (!blob || blob.v !== 1 || !Number.isInteger(blob.iter)) throw new Error('bad token blob');
  const key = await deriveKey(password, b64ToBytes(blob.salt), blob.iter);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(blob.iv) }, key, b64ToBytes(blob.ct));
  return new TextDecoder().decode(pt);
}
