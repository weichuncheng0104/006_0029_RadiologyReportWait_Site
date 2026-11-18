import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WEEK_OPTIONS, weekStyle, validateData, formatTaipei, buildDataUrl,
  encodeBase64Utf8, decodeBase64Utf8, formatLastUpdate,
  encryptToken, decryptToken,
} from '../core.js';

test('weekStyle maps weeks to label and colors', () => {
  assert.equal(WEEK_OPTIONS.length, 5);
  assert.equal(weekStyle(1).bg, '#1e7b34');
  assert.equal(weekStyle(1).label, '一週');
  assert.equal(weekStyle(2).bg, '#a6dba0');
  assert.equal(weekStyle(3).bg, '#ffd84d');
  assert.equal(weekStyle(4).bg, '#f08c3a');
  assert.equal(weekStyle(4).label, '四週');
  assert.equal(weekStyle(5).bg, '#d64545');
  assert.equal(weekStyle(5).label, '四週以上');
});

test('weekStyle returns gray placeholder for invalid values', () => {
  assert.deepEqual(weekStyle(7), { label: '—', bg: '#d0d0d0', fg: '#333' });
  assert.equal(weekStyle(undefined).label, '—');
  assert.equal(weekStyle('2').label, '—');
});

test('validateData rejects bad shapes and tolerates bad weeks', () => {
  assert.equal(validateData({ items: [] }).ok, false);
  assert.equal(validateData(null).ok, false);
  assert.equal(validateData({ lastUpdate: null, items: [{ id: 'ct' }] }).ok, false);
  assert.equal(validateData({ lastUpdate: 5, items: [{ id: 'ct', name: 'CT', weeks: 1 }] }).ok, false);
  const r = validateData({ lastUpdate: null, items: [{ id: 'ct', name: 'CT', weeks: 9 }] });
  assert.equal(r.ok, true);
  assert.equal(r.data.items[0].id, 'ct');
});

test('formatTaipei formats in Asia/Taipei', () => {
  const d = new Date('2026-11-13T16:30:05Z');
  assert.equal(formatTaipei(d, true), '2026-11-14 00:30:05');
  assert.equal(formatTaipei(d, false), '2026-11-14 00:30');
});

test('buildDataUrl adds cache-busting param', () => {
  assert.equal(buildDataUrl('./', 123), './data.json?t=123');
});

test('base64 utf-8 round trip and newline tolerance', () => {
  assert.equal(decodeBase64Utf8(encodeBase64Utf8('甲狀腺／頸部超音波')), '甲狀腺／頸部超音波');
  assert.equal(decodeBase64Utf8(encodeBase64Utf8('x').replace(/(.{2})/, '$1\n')), 'x');
});

test('encryptToken/decryptToken round trip with password', async () => {
  const blob = await encryptToken('FAKE_TOKEN_X', 'pw', 1000);
  assert.equal(blob.v, 1);
  assert.equal(blob.kdf, 'PBKDF2-SHA256');
  assert.equal(blob.iter, 1000);
  assert.ok(!JSON.stringify(blob).includes('FAKE_TOKEN_X'));
  assert.equal(await decryptToken(blob, 'pw'), 'FAKE_TOKEN_X');
});

test('decryptToken rejects wrong password and tampered data', async () => {
  const blob = await encryptToken('FAKE_TOKEN_X', 'pw', 1000);
  await assert.rejects(decryptToken(blob, 'wrong'));
  await assert.rejects(decryptToken({ ...blob, ct: blob.ct.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) }, 'pw'));
  await assert.rejects(decryptToken(null, 'pw'));
});

test('encryptToken uses fresh salt and iv each time', async () => {
  const a = await encryptToken('t', 'pw', 1000);
  const b = await encryptToken('t', 'pw', 1000);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});

test('core.js no longer exports a password hash', async () => {
  const mod = await import('../core.js');
  assert.equal('PASSWORD_SHA256' in mod, false);
});

test('formatLastUpdate falls back to dash for null or unparseable values', () => {
  assert.equal(formatLastUpdate(null), '—');
  assert.equal(formatLastUpdate('not a date'), '—');
  assert.equal(formatLastUpdate('2026-11-13T16:30:05Z'), '2026-11-14 00:30');
});

// ---- RIS pending-list parsing (all fixtures below are fabricated) ----
import {
  parseRisText, classifyItem, daysBetween, computeActual, actualStyle, taipeiDateString,
} from '../core.js';

function rec(no, date, status, items, extra = []) {
  const cols = Array(16).fill('x');
  cols[0] = String(no);
  cols[2] = `${date} 08:30:00`;
  cols[8] = status;
  cols[13] = items.join('\r\n');
  cols[14] = '測試甲';
  cols[15] = 'A000000';
  return cols.join('\t') + extra.join('');
}

test('parseRisText splits multi-line item records and keeps only safe fields', () => {
  const text = [
    rec(1, '2026/10/01', '檢查畢 尚未處理', ['CHEST PA', 'SPINE L-S AP']),
    rec(2, '2026/10/02', '已發送', ['腹部超音波']),
    ['3', 'x', '2026/10/03 09:00:00'].join('\t'), // too few columns -> skipped
    rec(4, 'bad-date', '檢查畢 編輯中', ['MRI']), // bad date -> skipped
  ].join('\r\n') + '\r\n';
  const r = parseRisText(text);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { examDate: '2026-10-01', status: '檢查畢 尚未處理', items: ['CHEST PA', 'SPINE L-S AP'] });
  assert.deepEqual(Object.keys(r[0]).sort(), ['examDate', 'items', 'status']);
  assert.deepEqual(r[1].items, ['腹部超音波']);
});

test('parseRisText handles continuation lines with trailing tabs and blank items', () => {
  const head = ['1', 'x', '2026/10/05 08:00:00', 'x', 'x', 'x', 'x', 'x', '檢查畢 編輯中', 'x', 'x', 'x', 'x', 'CHEST PA'].join('	');
  const text = [head, 'KNEE AP', '', 'HIP AP\t\t', rec(2, '2026/10/06', '已發送', ['X'])].join('\r\n') + '\r\n';
  const r = parseRisText(text);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0].items, ['CHEST PA', 'KNEE AP', 'HIP AP']);
});

test('classifyItem: one positive per category', () => {
  const cases = {
    mammo: 'Bil Mammography', bmd: '骨骼密度檢查', mri: 'MRI BRAIN', ct: 'HEART256CT',
    breast_us: '乳房超音波', thyroid_us: '甲狀腺超音波', carotid_us: '頸動脈超音波',
    vascular_us: '四肢血流超音波', abd_us: '腹部超音波', other_us: '婦科超音波',
    xray: 'Bil-FOOT AP',
  };
  for (const [id, name] of Object.entries(cases)) assert.equal(classifyItem(name), id, name);
  assert.equal(classifyItem('EXTREMITY CTV'), 'ct');
  assert.equal(classifyItem('BRAIN CTA'), 'ct');
  assert.equal(classifyItem('MRA NECK'), 'mri');
  assert.equal(classifyItem('周邊靜脈血管超音波'), 'vascular_us');
  assert.equal(classifyItem('R-T HAND AP'), 'xray');
  assert.equal(classifyItem('L HAND OBL'), 'xray');
  assert.equal(classifyItem('頭頸部軟組織超音波'), 'thyroid_us');
});

test('classifyItem: exclusions and unknowns return null', () => {
  for (const n of ['COPY Ｘ光光碟片', '超音波導引切片', '甲狀腺穿刺 Thyroid puncture', '電腦斷層導引下組織切片', 'F波 F wave', '核子斷層檢查術 SPECT', '', 'random thing']) {
    assert.equal(classifyItem(n), null, n);
  }
  assert.equal(classifyItem('ct'), null); // CT is case-sensitive
});

test('daysBetween counts calendar days and clamps negatives', () => {
  assert.equal(daysBetween('2026-10-01', '2026-10-01'), 0);
  assert.equal(daysBetween('2026-09-30', '2026-10-01'), 1);
  assert.equal(daysBetween('2026-10-20', '2026-10-01'), 0);
  assert.equal(daysBetween('2026-02-27', '2026-03-02'), 3);
});

test('computeActual filters status, classifies per item, takes max days', () => {
  const records = [
    { examDate: '2026-10-01', status: ' 檢查畢 尚未處理 ', items: ['CHEST PA', 'COPY Ｘ光光碟片', 'Mystery Item'] },
    { examDate: '2026-10-10', status: '檢查畢 編輯中', items: ['CHEST PA', 'MRI BRAIN'] },
    { examDate: '2026-09-01', status: '已發送', items: ['CHEST PA'] },
    { examDate: '2026-09-01', status: '尚未處理', items: ['CHEST PA'] },
  ];
  const ids = ['xray', 'ct', 'mri'];
  const r = computeActual(records, '2026-10-20', ids);
  assert.equal(r.pendingTotal, 2);
  assert.deepEqual(r.days, { xray: 19, ct: null, mri: 10 });
  assert.deepEqual(r.counts, { xray: 2, ct: 0, mri: 1 });
  assert.deepEqual(r.matched.xray, { 'CHEST PA': 2 });
  assert.deepEqual(r.unclassified, { 'COPY Ｘ光光碟片': 1, 'Mystery Item': 1 });
});

test('actualStyle boundaries 7/8/14/15/21/22/28/29/null', () => {
  const lab = (d) => actualStyle(d).label;
  assert.equal(lab(0), '一週');
  assert.equal(lab(7), '一週');
  assert.equal(lab(8), '兩週');
  assert.equal(lab(14), '兩週');
  assert.equal(lab(15), '三週');
  assert.equal(lab(21), '三週');
  assert.equal(lab(22), '四週');
  assert.equal(lab(28), '四週');
  assert.equal(lab(29), '四週以上');
  assert.equal(lab(null), '無待打報告');
  assert.equal(lab(undefined), '無待打報告');
  assert.deepEqual(actualStyle(5), { label: '一週', bg: '#1e7b34', fg: '#ffffff' });
  assert.deepEqual(actualStyle(25), { label: '四週', bg: '#f08c3a', fg: '#1a1a1a' });
  assert.deepEqual(actualStyle(null), { label: '無待打報告', bg: '#d0d0d0', fg: '#333' });
});

test('taipeiDateString uses Asia/Taipei date', () => {
  assert.equal(taipeiDateString(new Date('2026-11-13T16:30:05Z')), '2026-11-14');
  assert.equal(taipeiDateString(new Date('2026-11-13T15:59:59Z')), '2026-11-13');
});

test('validateData: actual optional, captureDate must be a string when present', () => {
  const items = [{ id: 'ct', name: 'CT', weeks: 1 }];
  assert.equal(validateData({ lastUpdate: null, items }).ok, true);
  assert.equal(validateData({ lastUpdate: null, items, actual: { captureDate: '2026-10-20' } }).ok, true);
  assert.equal(validateData({ lastUpdate: null, items, actual: { captureDate: 5 } }).ok, false);
  assert.equal(validateData({ lastUpdate: null, items, actual: {} }).ok, false);
});

// ---- review fixes ----
import { buildNextData } from '../core.js';

test('parseRisText skips nonexistent calendar dates and reports the skipped count', () => {
  const text = [
    rec(1, '2026/02/30', '檢查畢 尚未處理', ['CHEST PA']),
    rec(2, '2026/13/01', '檢查畢 尚未處理', ['CHEST PA']),
    rec(3, '2026/02/28', '檢查畢 尚未處理', ['CHEST PA']),
    rec(4, 'bad-date', '檢查畢 尚未處理', ['CHEST PA']),
  ].join('\r\n') + '\r\n';
  const stats = {};
  const r = parseRisText(text, stats);
  assert.equal(Array.isArray(r), true);
  assert.deepEqual(r.map((x) => x.examDate), ['2026-02-28']);
  assert.equal(stats.skipped, 3);
});

test('validateData: actualDays must be a non-negative integer or null when present', () => {
  const mk = (extra) => ({ lastUpdate: null, items: [{ id: 'ct', name: 'CT', weeks: 1, ...extra }] });
  assert.equal(validateData(mk({})).ok, true);
  assert.equal(validateData(mk({ actualDays: null })).ok, true);
  assert.equal(validateData(mk({ actualDays: 0 })).ok, true);
  assert.equal(validateData(mk({ actualDays: 12 })).ok, true);
  for (const bad of [-1, 1.5, '3', NaN, undefined]) {
    assert.equal(validateData(mk({ actualDays: bad })).ok, false, String(bad));
  }
});

const BASE = {
  lastUpdate: '2026-01-01T00:00:00.000Z',
  items: [{ id: 'ct', name: 'CT', weeks: 1 }, { id: 'mri', name: 'MRI', weeks: 2 }],
};

test('buildNextData with ris adds only actual, actualDays and completionRate', () => {
  const ris = { days: { ct: 9 }, counts: { ct: 1 }, done: { ct: 1 }, captureDate: '2026-10-20', examStart: '2026-09-01', examEnd: '2026-09-30' };
  const n = buildNextData(BASE, { ct: 3, mri: 4 }, ris, '2026-11-01T00:00:00.000Z');
  assert.deepEqual(n.actual, { captureDate: '2026-10-20', uploadedAt: '2026-11-01T00:00:00.000Z', examStart: '2026-09-01', examEnd: '2026-09-30' });
  assert.equal(n.lastUpdate, '2026-11-01T00:00:00.000Z');
  assert.deepEqual(n.items, [
    { id: 'ct', name: 'CT', weeks: 3, actualDays: 9, completionRate: 50 },
    { id: 'mri', name: 'MRI', weeks: 4, actualDays: null, completionRate: null },
  ]);
  assert.equal(Object.hasOwn(n.items[1], 'actualDays') && n.items[1].actualDays === null, true);
  assert.deepEqual(Object.keys(n).sort(), ['actual', 'items', 'lastUpdate']);
  assert.deepEqual(Object.keys(n.items[0]).sort(), ['actualDays', 'completionRate', 'id', 'name', 'weeks']);
});

test('buildNextData without ris keeps previous actual and actualDays', () => {
  const prev = {
    ...BASE, actual: { captureDate: '2026-10-01', uploadedAt: 'u' },
    items: [{ id: 'ct', name: 'CT', weeks: 1, actualDays: 5 }, { id: 'mri', name: 'MRI', weeks: 2 }],
  };
  const n = buildNextData(prev, { ct: 2, mri: 2 }, null, 'now');
  assert.deepEqual(n.actual, prev.actual);
  assert.deepEqual(n.items, [
    { id: 'ct', name: 'CT', weeks: 2, actualDays: 5 },
    { id: 'mri', name: 'MRI', weeks: 2 },
  ]);
  assert.deepEqual(Object.keys(buildNextData(BASE, { ct: 1, mri: 1 }, null, 'now')).sort(), ['items', 'lastUpdate']);
  assert.equal(BASE.items[0].weeks, 1); // input not mutated
});

// ---- history.csv ----
import {
  csvParse, csvSerialize, historyColumns, buildHistoryRow, upsertHistory, taipeiDateTimeString,
  WAIT_PALETTE, legendEntries, actualStyle as actualStyle2,
} from '../core.js';

const HITEMS = [{ id: 'ct', name: 'CT' }, { id: 'mri', name: 'MRI' }];
const hrow = (fileTime, extra = {}) => buildHistoryRow({
  fileTime, captureDate: '2026-11-14', analyzedAt: '2026-11-14 10:00:00', records: 10, pendingTotal: 3,
  days: { ct: 5, mri: null }, counts: { ct: 2, mri: 0 }, ...extra,
}, HITEMS);

test('csv round trip with comma, quote, newline, CRLF output', () => {
  const rows = [['a', 'b,c', 'say "hi"', 'x\ny'], ['', '1', '2', '3']];
  const text = csvSerialize(rows);
  assert.ok(text.endsWith('\r\n'));
  assert.ok(text.includes('"b,c"') && text.includes('"say ""hi"""'));
  assert.deepEqual(csvParse(text), rows);
});

test('csvParse tolerates BOM and LF', () => {
  assert.deepEqual(csvParse('﻿a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
});

test('buildHistoryRow: null days -> empty string, zero count kept', () => {
  const r = hrow('2026-11-14 09:00:00');
  assert.equal(r['MRI_最長天數'], '');
  assert.equal(r['MRI_未完成件數'], '0');
  assert.equal(r['CT_最長天數'], '5');
});

test('upsertHistory: new file, same ID overwrites, sorted', () => {
  const cols = historyColumns(HITEMS);
  let t = upsertHistory('', hrow('2026-11-14 09:00:00'), cols);
  t = upsertHistory(t, hrow('2026-11-13 09:00:00'), cols);
  t = upsertHistory(t, hrow('2026-11-14 09:00:00', { pendingTotal: 99 }), cols);
  const rows = csvParse(t);
  assert.equal(rows.length, 3);
  assert.equal(rows[1][0], '2026-11-13 09:00:00');
  assert.equal(rows[2][0], '2026-11-14 09:00:00');
  assert.equal(rows[2][rows[0].indexOf('未打報告筆數')], '99');
  assert.ok(!t.startsWith('﻿'));
});

test('upsertHistory keeps legacy-only columns and tolerates BOM/LF input', () => {
  const cols = historyColumns(HITEMS);
  const old = '﻿檔案時間(ID),擷取日,舊類_最長天數,CT_最長天數\n2026-11-01 08:00:00,2026-11-01,7,4\n';
  const rows = csvParse(upsertHistory(old, hrow('2026-11-14 09:00:00'), cols));
  const n = cols.length;
  assert.deepEqual(rows[0].slice(0, n), cols);
  assert.equal(rows[0][n], '舊類_最長天數');
  assert.equal(rows[1][n], '7');
  assert.equal(rows[1][cols.indexOf('CT_最長天數')], '4');
  assert.equal(rows[2][n], '');
});

test('upsertHistory same-ID overwrite keeps legacy-only values', () => {
  const cols = historyColumns(HITEMS);
  const old = '檔案時間(ID),舊類_最長天數\r\n2026-11-14 09:00:00,7\r\n';
  const rows = csvParse(upsertHistory(old, hrow('2026-11-14 09:00:00', { pendingTotal: 5 }), cols));
  assert.equal(rows.length, 2);
  const n = cols.length;
  assert.equal(rows[0][n], '舊類_最長天數');
  assert.equal(rows[1][n], '7');
  assert.equal(rows[1][cols.indexOf('未打報告筆數')], '5');
});

test('taipeiDateTimeString', () => {
  assert.equal(taipeiDateTimeString(new Date('2026-11-14T02:03:04Z')), '2026-11-14 10:03:04');
});

// ---- shared palette ----
test('estimated and actual columns share colours per label', () => {
  const same = (a, b) => { assert.equal(a.bg, b.bg); assert.equal(a.fg, b.fg); assert.equal(a.label, b.label); };
  same(weekStyle(1), actualStyle2(5));
  same(weekStyle(2), actualStyle2(14));
  same(weekStyle(3), actualStyle2(21));
  same(weekStyle(4), actualStyle2(28));
  same(weekStyle(5), actualStyle2(29));
  assert.equal(actualStyle2(28).label, '四週');
  assert.equal(actualStyle2(28).bg, WAIT_PALETTE.week4.bg);
});

test('legendEntries: five shared entries; grey only with actual', () => {
  const base = legendEntries(false);
  assert.deepEqual(base.map((e) => e.label), ['一週', '兩週', '三週', '四週', '四週以上']);
  const withActual = legendEntries(true);
  assert.equal(withActual.length, 6);
  assert.equal(withActual[5].label, '無待打報告');
  assert.equal(withActual[0].bg, WAIT_PALETTE.week1.bg);
});

// ---- expected_history.csv ----
import { expectedColumns, buildExpectedRow, appendCsvRow } from '../core.js';

const eItems = [
  { id: 'a', name: 'X光', weeks: 1 },
  { id: 'b', name: '電腦斷層', weeks: 4 },
];

test('expectedColumns: ID first, then one column per item in order', () => {
  assert.deepEqual(expectedColumns(eItems), ['存檔時間', 'X光_預計週數(5=四週以上)', '電腦斷層_預計週數(5=四週以上)']);
});

test('buildExpectedRow: numeric weeks from item.weeks', () => {
  const row = buildExpectedRow('2026-11-14 09:00:00', eItems);
  assert.equal(row['存檔時間'], '2026-11-14 09:00:00');
  assert.equal(row['X光_預計週數(5=四週以上)'], '1');
  assert.equal(row['電腦斷層_預計週數(5=四週以上)'], '4');
});

test('appendCsvRow: same timestamp twice gives two rows, order kept, no upsert', () => {
  const cols = expectedColumns(eItems);
  let t = appendCsvRow('', buildExpectedRow('2026-11-14 09:00:00', eItems), cols);
  t = appendCsvRow(t, buildExpectedRow('2026-11-13 09:00:00', eItems), cols);
  t = appendCsvRow(t, buildExpectedRow('2026-11-14 09:00:00', eItems), cols);
  const rows = csvParse(t);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.slice(1).map((r) => r[0]), ['2026-11-14 09:00:00', '2026-11-13 09:00:00', '2026-11-14 09:00:00']);
  assert.ok(t.endsWith('\r\n'));
});

test('appendCsvRow keeps legacy-only columns last with old values, tolerates BOM/LF', () => {
  const cols = expectedColumns(eItems);
  const old = '﻿存檔時間,舊欄,X光_預計週數(5=四週以上)\n2026-11-01 08:00:00,keep,2\n';
  const rows = csvParse(appendCsvRow(old, buildExpectedRow('2026-11-14 09:00:00', eItems), cols));
  assert.deepEqual(rows[0], [...cols, '舊欄']);
  assert.deepEqual(rows[1], ['2026-11-01 08:00:00', '2', '', 'keep']);
  assert.deepEqual(rows[2], ['2026-11-14 09:00:00', '1', '4', '']);
});

// ---- completion rate (2026-11-16) ----
import { completionRate, formatRate } from '../core.js';

test('computeActual: done counts only 檢查畢 已發送; 尚未處理 excluded everywhere; exam range from all records', () => {
  const records = [
    { examDate: '2026-10-12', status: '檢查畢 已發送', items: ['CHEST PA', 'MRI BRAIN'] },
    { examDate: '2026-10-20', status: '檢查畢 尚未處理', items: ['CHEST PA'] },
    { examDate: '2026-10-21', status: '檢查畢 編輯中', items: ['CHEST PA'] },
    { examDate: '2026-10-05', status: '尚未處理', items: ['CHEST PA', 'MRI BRAIN'] },
    { examDate: '2026-11-16', status: '已發送', items: ['CHEST PA'] },
    { examDate: '2026-10-15', status: '檢查畢 已發送', items: ['Mystery Item', 'COPY Ｘ光光碟片'] },
  ];
  const r = computeActual(records, '2026-11-16', ['xray', 'mri', 'ct']);
  assert.deepEqual(r.done, { xray: 1, mri: 1, ct: 0 });
  assert.deepEqual(r.counts, { xray: 2, mri: 0, ct: 0 });
  assert.equal(r.examStart, '2026-10-05');
  assert.equal(r.examEnd, '2026-11-16');
});

test('completionRate: done/(done+pending) %, 1 decimal; null when no items', () => {
  assert.equal(completionRate(1455, 78), 94.9);
  assert.equal(completionRate(1, 2), 33.3);
  assert.equal(completionRate(2, 1), 66.7);
  assert.equal(completionRate(0, 5), 0);
  assert.equal(completionRate(5, 0), 100);
  assert.equal(completionRate(0, 0), null);
  assert.equal(formatRate(94.9), '94.9');
  assert.equal(formatRate(100), '100.0');
  assert.equal(formatRate(0), '0.0');
  assert.equal(formatRate(null), '—');
  assert.equal(formatRate(undefined), '—');
});

test('buildNextData with ris adds completionRate and exam range', () => {
  const ris = { days: { ct: 9 }, counts: { ct: 1, mri: 0 }, done: { ct: 3, mri: 0 },
    captureDate: '2026-11-16', examStart: '2026-10-12', examEnd: '2026-11-16' };
  const n = buildNextData(BASE, { ct: 3, mri: 4 }, ris, 'now');
  assert.deepEqual(n.actual, { captureDate: '2026-11-16', uploadedAt: 'now', examStart: '2026-10-12', examEnd: '2026-11-16' });
  assert.deepEqual(n.items, [
    { id: 'ct', name: 'CT', weeks: 3, actualDays: 9, completionRate: 75 },
    { id: 'mri', name: 'MRI', weeks: 4, actualDays: null, completionRate: null },
  ]);
});

test('validateData: completionRate null or 0..100 number; exam range strings when present', () => {
  const mk = (extra, actual) => ({ lastUpdate: null, items: [{ id: 'ct', name: 'CT', weeks: 1, ...extra }], ...(actual ? { actual } : {}) });
  for (const ok of [null, 0, 94.9, 100]) assert.equal(validateData(mk({ completionRate: ok })).ok, true, String(ok));
  for (const bad of [-1, 100.1, '9', NaN, undefined, Infinity]) assert.equal(validateData(mk({ completionRate: bad })).ok, false, String(bad));
  assert.equal(validateData(mk({}, { captureDate: 'd', examStart: 'a', examEnd: 'b' })).ok, true);
  assert.equal(validateData(mk({}, { captureDate: 'd', examStart: 5, examEnd: 'b' })).ok, false);
  assert.equal(validateData(mk({}, { captureDate: 'd', examStart: 'a' })).ok, false);
});

test('history columns/row carry exam range, done count and rate', () => {
  assert.deepEqual(historyColumns(HITEMS), ['檔案時間(ID)', '擷取日', '檢查日起', '檢查日迄', '分析時間', '紀錄數', '未打報告筆數',
    'CT_最長天數', 'CT_未完成件數', 'CT_已完成件數', 'CT_完成率(%)',
    'MRI_最長天數', 'MRI_未完成件數', 'MRI_已完成件數', 'MRI_完成率(%)']);
  const r = hrow('2026-11-16 07:00:00', { examStart: '2026-10-12', examEnd: '2026-11-16', done: { ct: 6, mri: 0 } });
  assert.equal(r['檢查日起'], '2026-10-12');
  assert.equal(r['檢查日迄'], '2026-11-16');
  assert.equal(r['CT_已完成件數'], '6');
  assert.equal(r['CT_完成率(%)'], '75.0');
  assert.equal(r['MRI_已完成件數'], '0');
  assert.equal(r['MRI_完成率(%)'], '');
});

test('upsertHistory: old-format csv keeps its rows, new columns blank for them', () => {
  const oldHeader = ['檔案時間(ID)', '擷取日', '分析時間', '紀錄數', '未打報告筆數', 'CT_最長天數', 'CT_未完成件數', 'MRI_最長天數', 'MRI_未完成件數'];
  const oldText = csvSerialize([oldHeader, ['2026-10-20 08:00:00', '2026-10-20', 'x', '9', '2', '49', '2', '', '0']]);
  const cols = historyColumns(HITEMS);
  const t = upsertHistory(oldText, hrow('2026-11-16 07:00:00', { examStart: '2026-10-12', examEnd: '2026-11-16', done: { ct: 6, mri: 0 } }), cols);
  const rows = csvParse(t);
  assert.deepEqual(rows[0], cols);
  assert.equal(rows.length, 3);
  const old = Object.fromEntries(cols.map((c, i) => [c, rows[1][i]]));
  assert.equal(old['CT_最長天數'], '49');
  assert.equal(old['CT_完成率(%)'], '');
  assert.equal(old['檢查日起'], '');
});

test('computeActual: capture-day exams count; multiple same-category items in one record count per item', () => {
  const records = [
    { examDate: '2026-11-16', status: '檢查畢 已發送', items: ['CHEST PA', 'KNEE AP', 'MRI BRAIN'] },
    { examDate: '2026-11-16', status: '檢查畢 尚未處理', items: ['CHEST PA', 'SPINE LAT'] },
  ];
  const r = computeActual(records, '2026-11-16', ['xray', 'mri']);
  assert.deepEqual(r.done, { xray: 2, mri: 1 });
  assert.deepEqual(r.counts, { xray: 2, mri: 0 });
  assert.deepEqual(r.days, { xray: 0, mri: null });
  assert.equal(completionRate(r.done.xray, r.counts.xray), 50);
});

test('buildNextData without ris keeps previous completionRate and exam range', () => {
  const prev = {
    lastUpdate: 'old',
    actual: { captureDate: '2026-11-16', uploadedAt: 'u', examStart: '2026-10-12', examEnd: '2026-11-16' },
    items: [{ id: 'ct', name: 'CT', weeks: 1, actualDays: 13, completionRate: 94.9 }],
  };
  const n = buildNextData(prev, { ct: 2 }, null, 'now');
  assert.deepEqual(n.actual, prev.actual);
  assert.deepEqual(n.items, [{ id: 'ct', name: 'CT', weeks: 2, actualDays: 13, completionRate: 94.9 }]);
  assert.equal(validateData(n).ok, true);
});

// ---- Bookmarklet JSON (mjb3w001-list/1); fabricated rows only ----
import { parseRisJson } from '../core.js';

const JSON_COLUMNS = ['seq', 'report_index', '檢查日', '病歷號', '會診單號', '姓名', '性別', '年齡', '狀態', '音', '診別', '科別', '檢查地', '檢查項目', '報告醫師', '改派者'];
const FIXTURE = [
  ['2026/10/01', '檢查畢 尚未處理', ['CHEST PA', 'SPINE L-S AP']],
  ['2026/10/02', '檢查畢 已發送', ['腹部超音波', 'CT BRAIN']],
  ['2026/10/03', '檢查畢 編輯中', ['MRI L-SPINE']],
  ['2026/10/04', '尚未處理', ['CHEST PA']],
  ['2026/10/05', '檢查畢 尚未處理', []],
  ['bad-date', '檢查畢 已發送', ['CHEST PA']],
];
function jsonRow(i, [date, status, items]) {
  const r = Array(16).fill('x');
  r[0] = String(i + 1); r[1] = i; r[2] = `${date} 08:30:00`; r[8] = status; r[13] = items.join('\n');
  return r;
}
function bookmarkJson(over = {}) {
  const rows = FIXTURE.map((f, i) => jsonRow(i, f));
  return {
    schema: 'mjb3w001-list/1', captured_at: '2026-10-08T00:42:10.840Z', captured_at_local: '2026-10-08 08:42:10',
    route: '/WEBRIS/MJB/MJB3W001.do', query: {}, columns: JSON_COLUMNS,
    reported_total: rows.length, harvested: rows.length, rows, warnings: [], ...over,
  };
}

test('parseRisJson yields the same stats as the equivalent txt', () => {
  const text = FIXTURE.map(([d, s, items], i) => rec(i + 1, d, s, items)).join('\r\n') + '\r\n';
  const sj = {}; const st = {};
  const fromJson = parseRisJson(bookmarkJson(), sj);
  const fromTxt = parseRisText(text, st);
  assert.deepEqual(fromJson, fromTxt);
  assert.equal(sj.skipped, 1);
  assert.equal(st.skipped, 1);
  const ids = ['xray', 'ct', 'mri', 'abd_us'];
  assert.deepEqual(computeActual(fromJson, '2026-10-08', ids), computeActual(fromTxt, '2026-10-08', ids));
});

test('parseRisJson locates columns by name, not position', () => {
  const obj = bookmarkJson();
  const order = [...JSON_COLUMNS.keys()].reverse();
  obj.columns = order.map((k) => JSON_COLUMNS[k]);
  obj.rows = obj.rows.map((r) => order.map((k) => r[k]));
  assert.deepEqual(parseRisJson(obj), parseRisJson(bookmarkJson()));
});

test('parseRisJson rejects files that could silently skew the stats', () => {
  const bad = [
    [{ schema: 'nhi-harvest/2' }, /不支援/],
    [{ harvested: 5 }, /筆數/],
    [{ reported_total: 7, harvested: 7 }, /筆數/],
    [{ warnings: ['x'] }, /警告/],
    [{ warnings: undefined }, /警告/],
    [{ columns: JSON_COLUMNS.map((c) => (c === '狀態' ? 'status' : c)) }, /缺少/],
  ];
  for (const [over, re] of bad) assert.throws(() => parseRisJson(bookmarkJson(over)), re);
  assert.throws(() => parseRisJson(null), /不支援/);
  const unknown = bookmarkJson();
  unknown.rows[0][8] = '檢查畢 已作廢';
  assert.throws(() => parseRisJson(unknown), /未知狀態/);
  const noPrefix = bookmarkJson();
  for (const r of noPrefix.rows) r[8] = r[8].replace('檢查畢 ', '');
  assert.throws(() => parseRisJson(noPrefix), /檢查畢/);
});

test('parseRisJson rejects non-array rows and any missing key column', () => {
  const obj = bookmarkJson(); obj.rows[0] = 5;
  assert.throws(() => parseRisJson(obj), /列格式/);
  for (const name of ['檢查日', '狀態', '檢查項目']) {
    assert.throws(() => parseRisJson(bookmarkJson({ columns: JSON_COLUMNS.map((c) => (c === name ? 'zz' : c)) })), /缺少/);
  }
});

test('parseRisJson rejects truncated rows and non-string key cells', () => {
  const short = bookmarkJson(); short.rows[0] = short.rows[0].slice(0, 13);
  assert.throws(() => parseRisJson(short), /列格式/);
  const nullItems = bookmarkJson(); nullItems.rows[0][13] = null;
  assert.throws(() => parseRisJson(nullItems), /列格式/);
  const emptyItems = bookmarkJson(); emptyItems.rows[0][13] = ''; // legitimate: list rows with no item
  assert.deepEqual(parseRisJson(emptyItems)[0].items, []);
});

import { parseCapturedAt } from '../core.js';
test('parseCapturedAt accepts strict ISO UTC only', () => {
  assert.equal(parseCapturedAt('2026-11-18T00:42:10.840Z').toISOString(), '2026-11-18T00:42:10.840Z');
  assert.equal(taipeiDateString(parseCapturedAt('2026-10-07T16:30:00Z')), '2026-10-08');
  for (const bad of [null, undefined, 0, 1731890530000, '', '2026-11-18 08:42:10', '2026-11-18T08:42:10', '2026-02-30T00:00:00Z', 'x']) {
    assert.throws(() => parseCapturedAt(bad), /captured_at/, String(bad));
  }
});
