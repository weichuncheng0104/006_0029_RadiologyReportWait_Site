import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WEEK_OPTIONS, weekStyle, validateData, formatTaipei, buildDataUrl,
  encodeBase64Utf8, decodeBase64Utf8, sha256Hex, PASSWORD_SHA256, formatLastUpdate,
} from '../core.js';

test('weekStyle maps weeks to label and colors', () => {
  assert.equal(WEEK_OPTIONS.length, 4);
  assert.equal(weekStyle(1).bg, '#1e7b34');
  assert.equal(weekStyle(1).label, '一週');
  assert.equal(weekStyle(2).bg, '#a6dba0');
  assert.equal(weekStyle(3).bg, '#ffd84d');
  assert.equal(weekStyle(4).bg, '#d64545');
  assert.equal(weekStyle(4).label, '四週以上');
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

test('sha256Hex matches standard vector; password hash is well formed', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.match(PASSWORD_SHA256, /^[0-9a-f]{64}$/);
  assert.notEqual(await sha256Hex('wrong'), PASSWORD_SHA256);
});

test('formatLastUpdate falls back to dash for null or unparseable values', () => {
  assert.equal(formatLastUpdate(null), '—');
  assert.equal(formatLastUpdate('not a date'), '—');
  assert.equal(formatLastUpdate('2026-11-13T16:30:05Z'), '2026-11-14 00:30');
});
