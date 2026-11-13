// Pure logic shared by the board (app.js) and the admin page (admin.js).

export const WEEK_OPTIONS = [
  { value: 1, label: '一週', bg: '#1e7b34', fg: '#ffffff' },
  { value: 2, label: '兩週', bg: '#a6dba0', fg: '#1a1a1a' },
  { value: 3, label: '三週', bg: '#ffd84d', fg: '#1a1a1a' },
  { value: 4, label: '四週以上', bg: '#d64545', fg: '#ffffff' },
];

const INVALID_STYLE = { label: '—', bg: '#d0d0d0', fg: '#333' };

// SHA-256 of the admin password. The plaintext must never be committed here (public repo).
export const PASSWORD_SHA256 = '5e03aa760425d580d53e9a82d579c393b1ab402ddb25680b341ef6b1c363d5aa';

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

export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
