// Pure logic shared by the board (app.js) and the admin page (admin.js).

// Single source of truth for wait-time colours (estimated column, actual column, legend).
export const WAIT_PALETTE = {
  week1: { label: '一週', bg: '#1e7b34', fg: '#ffffff' },
  week2: { label: '兩週', bg: '#a6dba0', fg: '#1a1a1a' },
  week3: { label: '三週', bg: '#ffd84d', fg: '#1a1a1a' },
  week4: { label: '四週', bg: '#f08c3a', fg: '#1a1a1a' },
  week4plus: { label: '四週以上', bg: '#d64545', fg: '#ffffff' },
  none: { label: '無待打報告', bg: '#d0d0d0', fg: '#333' },
};

export const WEEK_OPTIONS = [
  { value: 1, ...WAIT_PALETTE.week1 },
  { value: 2, ...WAIT_PALETTE.week2 },
  { value: 3, ...WAIT_PALETTE.week3 },
  { value: 4, ...WAIT_PALETTE.week4plus },
];

// Legend entries for the board; the grey "no pending" entry only when actual data is shown.
export function legendEntries(hasActual) {
  const { week1, week2, week3, week4, week4plus, none } = WAIT_PALETTE;
  return [week1, week2, week3, week4, week4plus, ...(hasActual ? [none] : [])].map((e) => ({ ...e }));
}

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
  const badDays = obj.items.some((it) => Object.hasOwn(it, 'actualDays')
    && it.actualDays !== null && !(Number.isInteger(it.actualDays) && it.actualDays >= 0));
  if (badDays) return { ok: false, error: 'bad actualDays' };
  const badRate = obj.items.some((it) => Object.hasOwn(it, 'completionRate') && it.completionRate !== null
    && !(Number.isFinite(it.completionRate) && it.completionRate >= 0 && it.completionRate <= 100));
  if (badRate) return { ok: false, error: 'bad completionRate' };
  if (obj.actual !== undefined && (!obj.actual || typeof obj.actual.captureDate !== 'string')) return { ok: false, error: 'bad actual' };
  if (obj.actual && (Object.hasOwn(obj.actual, 'examStart') || Object.hasOwn(obj.actual, 'examEnd'))
    && (typeof obj.actual.examStart !== 'string' || typeof obj.actual.examEnd !== 'string')) return { ok: false, error: 'bad exam range' };
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

// --- RIS pending-report list: parsing, classification, wait-time stats. Only exam date, status and item names are read.

const PENDING_STATUSES = new Set(['檢查畢 尚未處理', '檢查畢 編輯中']);
const DONE_STATUS = '檢查畢 已發送'; // completion-rate numerator; exams not yet performed (尚未處理) count nowhere
const EXCLUDE_RE = /COPY|光碟|導引|穿刺|切片|specimen|內視鏡|鏡檢|SPECT|核子/i;
// Ordered rules: first hit wins. CT is case-sensitive (avoids matching words like "duct").
const CATEGORY_RULES = [
  ['mammo', /mammo/i],
  ['bmd', /骨骼密度|densitometry/i],
  ['mri', /MRI|MRA/i],
  ['ct', /CT|電腦斷層|256切/],
  ['breast_us', /乳房超音波/i],
  ['thyroid_us', /甲狀|頭頸部軟組織超音波/i],
  ['carotid_us', /頸動脈/i],
  ['vascular_us', /四肢血流|周邊(靜|動)脈血管超音波/i],
  ['abd_us', /腹部超音波/i],
  ['other_us', /超音波|echo|microsonography/i],
  ['xray', /CHEST|K\.?U\.?B|SPINE|PELVIS|Pelcis|\bHIP\b|KNEE|SHOUL|Shouder|PATELLA|WRIST|\bHAND\b|FOOT|ANKLE|ELBOW|FOREARM|\bARM\b|HUMERUS|FEMORAL|\bLEG\b|FINGER|CLAVICLE|SCAPHOID|CALCANEUS|SKULL|SINUS|MASTOID|MANDIBLE|T\.M\.J|NASAL BONE|ZYGOMA|SACRUM|COCCYX|SI-joint|\bRIB\b|STERNUM|ABDOMEN|BONEAGE|SCANOGRAPHY|NECK SOFT|LOWER EXT|胸部X光|X光片|骨頭及關節|骨盆及髖關節|上肢骨/i],
];

export function classifyItem(name) {
  const s = String(name ?? '');
  if (EXCLUDE_RE.test(s)) return null;
  for (const [id, re] of CATEGORY_RULES) if (re.test(s)) return id;
  return null;
}

function isRealDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Optional `stats` object receives { skipped }: number of records dropped as malformed.
export function parseRisText(text, stats) {
  const raw = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\d+\t/.test(line)) raw.push(line);
    else if (raw.length && line.trim() !== '') raw[raw.length - 1] += `\n${line}`;
  }
  const out = [];
  let skipped = 0;
  for (const r of raw) {
    const cols = r.split('\t');
    if (cols.length < 14) { skipped += 1; continue; }
    const m = /^(\d{4})\/(\d{2})\/(\d{2})\b/.exec(cols[2].trim());
    if (!m || !isRealDate(Number(m[1]), Number(m[2]), Number(m[3]))) { skipped += 1; continue; }
    const items = cols[13].split('\n').map((x) => x.trim()).filter(Boolean);
    out.push({ examDate: `${m[1]}-${m[2]}-${m[3]}`, status: cols[8], items });
  }
  if (stats) stats.skipped = skipped;
  return out;
}

// 007 MJB3W001 bookmarklet JSON (schema mjb3w001-list/1). Fail-loud: throws on anything that could silently skew the stats.
export const RIS_JSON_SCHEMA = 'mjb3w001-list/1';
const KNOWN_STATUSES = new Set([DONE_STATUS, ...PENDING_STATUSES, '尚未處理', '已發送', '編輯中']);

export function parseRisJson(obj, stats) {
  if (!obj || obj.schema !== RIS_JSON_SCHEMA) throw new Error(`不支援的 JSON 格式（需為 ${RIS_JSON_SCHEMA}）`);
  const rows = obj.rows;
  if (!Array.isArray(rows) || obj.harvested !== obj.reported_total || rows.length !== obj.reported_total) {
    throw new Error('JSON 筆數與頁面「共N筆」不符，請重新擷取');
  }
  if (!Array.isArray(obj.warnings) || obj.warnings.length > 0) throw new Error('JSON 含擷取警告，請重新擷取');
  const cols = Array.isArray(obj.columns) ? obj.columns : [];
  const iDate = cols.indexOf('檢查日'); const iStatus = cols.indexOf('狀態'); const iItems = cols.indexOf('檢查項目');
  if (iDate < 0 || iStatus < 0 || iItems < 0) throw new Error('JSON 缺少 檢查日／狀態／檢查項目 欄');
  const out = [];
  let skipped = 0; let examined = 0;
  for (const r of rows) {
    if (!Array.isArray(r) || r.length !== cols.length || [iDate, iStatus, iItems].some((i) => typeof r[i] !== 'string')) {
      throw new Error('JSON 列格式錯誤，請重新擷取');
    }
    const status = String(r[iStatus] ?? '').trim();
    if (!KNOWN_STATUSES.has(status)) throw new Error(`JSON 含未知狀態值「${status}」`);
    if (status.startsWith('檢查畢')) examined += 1;
    const m = /^(\d{4})\/(\d{2})\/(\d{2})\b/.exec(String(r[iDate] ?? '').trim());
    if (!m || !isRealDate(Number(m[1]), Number(m[2]), Number(m[3]))) { skipped += 1; continue; }
    const items = String(r[iItems] ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
    out.push({ examDate: `${m[1]}-${m[2]}-${m[3]}`, status, items });
  }
  // Real lists are mostly 檢查畢; none at all means the check-mark prefix was lost upstream.
  if (rows.length > 0 && examined === 0) throw new Error('JSON 狀態欄沒有任何「檢查畢」，疑似擷取遺漏，請重新擷取');
  if (stats) stats.skipped = skipped;
  return out;
}

// Bookmarklet capture time: strict ISO UTC string; returns a Date or throws (feeds the capture date and history ID).
export function parseCapturedAt(s) {
  const ok = typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(s);
  const d = ok ? new Date(s) : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 19) !== s.slice(0, 19)) {
    throw new Error('JSON 缺少有效的擷取時間 captured_at');
  }
  return d;
}

function dayNumber(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function daysBetween(examDate, captureDate) {
  return Math.max(0, dayNumber(captureDate) - dayNumber(examDate));
}

export function computeActual(records, captureDate, categoryIds) {
  const days = {}; const counts = {}; const matched = {}; const done = {};
  for (const id of categoryIds) { days[id] = null; counts[id] = 0; matched[id] = {}; done[id] = 0; }
  const unclassified = {};
  let pendingTotal = 0;
  let examStart = null; let examEnd = null;
  for (const r of records) {
    if (examStart === null || r.examDate < examStart) examStart = r.examDate;
    if (examEnd === null || r.examDate > examEnd) examEnd = r.examDate;
    const status = String(r.status).trim();
    if (status === DONE_STATUS) {
      for (const name of r.items) { const id = classifyItem(name); if (id !== null && id in done) done[id] += 1; }
      continue;
    }
    if (!PENDING_STATUSES.has(status)) continue;
    pendingTotal += 1;
    const d = daysBetween(r.examDate, captureDate);
    for (const name of r.items) {
      const id = classifyItem(name);
      if (id === null || !(id in days)) { unclassified[name] = (unclassified[name] ?? 0) + 1; continue; }
      counts[id] += 1;
      matched[id][name] = (matched[id][name] ?? 0) + 1;
      if (days[id] === null || d > days[id]) days[id] = d;
    }
  }
  return { days, counts, matched, unclassified, pendingTotal, done, examStart, examEnd };
}

// Report completion rate (%) = done / (done + pending), one decimal; null when the category has no examined items.
export function completionRate(done, pending) {
  const total = done + pending;
  return total === 0 ? null : Math.round((1000 * done) / total) / 10;
}

export function formatRate(rate) {
  return rate === null || rate === undefined ? '—' : rate.toFixed(1);
}

export function actualStyle(days) {
  const P = WAIT_PALETTE;
  if (days === null || days === undefined) return { ...P.none };
  if (days <= 7) return { ...P.week1 };
  if (days <= 14) return { ...P.week2 };
  if (days <= 21) return { ...P.week3 };
  if (days <= 28) return { ...P.week4 };
  return { ...P.week4plus };
}

export function taipeiDateString(date) {
  return formatTaipei(date, false).slice(0, 10);
}

// Assemble the data.json payload to save. risResult: { days, counts, done, captureDate, examStart, examEnd } | null.
export function buildNextData(data, weeksById, risResult, nowIso) {
  const next = {
    ...data,
    lastUpdate: nowIso,
    items: data.items.map((it) => ({
      ...it,
      weeks: weeksById[it.id],
      ...(risResult ? {
        actualDays: risResult.days[it.id] ?? null,
        completionRate: completionRate(risResult.done[it.id] ?? 0, risResult.counts[it.id] ?? 0),
      } : {}),
    })),
  };
  if (risResult) {
    next.actual = { captureDate: risResult.captureDate, uploadedAt: nowIso, examStart: risResult.examStart, examEnd: risResult.examEnd };
  }
  return next;
}

export function taipeiDateTimeString(date) {
  return formatTaipei(date, true);
}

// RFC 4180 parser: returns array of rows (arrays of strings). Tolerates BOM, CRLF and LF.
export function csvParse(text) {
  const src = text.replace(/^﻿/, '');
  const rows = [];
  let row = []; let field = ''; let inQ = false; let any = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (inQ) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else inQ = false;
      } else field += c;
    } else if (c === '"') { inQ = true; any = true; }
    else if (c === ',') { row.push(field); field = ''; any = true; }
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      if (any || field !== '') { row.push(field); rows.push(row); }
      row = []; field = ''; any = false;
    } else { field += c; any = true; }
  }
  if (any || field !== '') { row.push(field); rows.push(row); }
  return rows;
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Serialize rows (arrays of values) with CRLF line endings, trailing CRLF.
export function csvSerialize(rows) {
  return rows.map((r) => r.map(csvCell).join(',') + '\r\n').join('');
}

export const HISTORY_ID_COL = '檔案時間(ID)';

export function historyColumns(items) {
  return [HISTORY_ID_COL, '擷取日', '檢查日起', '檢查日迄', '分析時間', '紀錄數', '未打報告筆數',
    ...items.flatMap((it) => [`${it.name}_最長天數`, `${it.name}_未完成件數`, `${it.name}_已完成件數`, `${it.name}_完成率(%)`])];
}

export function buildHistoryRow({ fileTime, captureDate, examStart, examEnd, analyzedAt, records, pendingTotal, days, counts, done = {} }, items) {
  const row = {
    [HISTORY_ID_COL]: fileTime, 擷取日: captureDate, 檢查日起: examStart ?? '', 檢查日迄: examEnd ?? '', 分析時間: analyzedAt,
    紀錄數: String(records), 未打報告筆數: String(pendingTotal),
  };
  for (const it of items) {
    const d = days[it.id];
    const rate = completionRate(done[it.id] ?? 0, counts[it.id] ?? 0);
    row[`${it.name}_最長天數`] = d === null || d === undefined ? '' : String(d);
    row[`${it.name}_未完成件數`] = String(counts[it.id] ?? 0);
    row[`${it.name}_已完成件數`] = String(done[it.id] ?? 0);
    row[`${it.name}_完成率(%)`] = rate === null ? '' : rate.toFixed(1);
  }
  return row;
}

// Parse existing CSV text; header = current columns + legacy-only columns (appended last), rows keyed by header name.
function mergeWithOld(csvText, columns) {
  const old = csvParse(csvText || '');
  const oldHeader = old.length ? old[0] : [];
  const header = [...columns, ...oldHeader.filter((h) => !columns.includes(h))];
  const objs = old.slice(1).map((r) => Object.fromEntries(oldHeader.map((h, i) => [h, r[i] ?? ''])));
  return { header, objs };
}

// Upsert one row (keyed by ID column) into existing CSV text; header = current columns + legacy-only columns.
export function upsertHistory(csvText, row, columns) {
  const { header, objs } = mergeWithOld(csvText, columns);
  const byId = new Map();
  for (const obj of objs) if (obj[HISTORY_ID_COL]) byId.set(obj[HISTORY_ID_COL], obj);
  // Merge over the old row so legacy-only columns keep their values on a same-ID overwrite.
  byId.set(row[HISTORY_ID_COL], { ...(byId.get(row[HISTORY_ID_COL]) ?? {}), ...row });
  const ids = [...byId.keys()].sort();
  return csvSerialize([header, ...ids.map((id) => header.map((h) => byId.get(id)[h] ?? ''))]);
}

export const EXPECTED_ID_COL = '存檔時間';

export function expectedColumns(items) {
  return [EXPECTED_ID_COL, ...items.map((it) => `${it.name}_預計週數(4=四週以上)`)];
}

export function buildExpectedRow(savedAt, items) {
  const row = { [EXPECTED_ID_COL]: savedAt };
  for (const it of items) row[`${it.name}_預計週數(4=四週以上)`] = String(it.weeks);
  return row;
}

// Append one row (never upsert, never reorder); header = current columns + legacy-only columns.
export function appendCsvRow(csvText, row, columns) {
  const { header, objs } = mergeWithOld(csvText, columns);
  return csvSerialize([header, ...[...objs, row].map((o) => header.map((h) => o[h] ?? ''))]);
}
