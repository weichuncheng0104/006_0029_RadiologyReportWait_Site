import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPO, getFile, putFile, describeApiError } from '../github.js';
import { encodeBase64Utf8, decodeBase64Utf8 } from '../core.js';

function fakeFetch(status, body, log) {
  return async (url, init) => {
    log.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}

test('REPO constants', () => {
  assert.deepEqual(REPO, { owner: 'weichuncheng0104', repo: '006_0029_RadiologyReportWait_Site', path: 'data.json', branch: 'main' });
});

test('getFile sends auth and decodes content', async () => {
  const log = [];
  const content = encodeBase64Utf8('{"items":[{"id":"ct","name":"CT","weeks":2}]}');
  const r = await getFile('T', fakeFetch(200, { content, sha: 'abc' }, log));
  assert.ok(log[0].url.includes('/contents/data.json?ref=main'));
  assert.ok(log[0].url.startsWith('https://api.github.com/repos/weichuncheng0104/006_0029_RadiologyReportWait_Site/'));
  assert.equal(log[0].init.headers.Authorization, 'Bearer T');
  assert.equal(log[0].init.cache, 'no-store');
  assert.equal(r.data.items[0].weeks, 2);
  assert.equal(r.sha, 'abc');
});

test('putFile sends PUT with sha and valid JSON content', async () => {
  const log = [];
  const data = { lastUpdate: '2026-11-13T00:00:00.000Z', items: [{ id: 'ct', name: 'CT', weeks: 3 }] };
  const sha = await putFile('T', data, 'abc', fakeFetch(200, { content: { sha: 'def' } }, log));
  assert.equal(sha, 'def');
  assert.equal(log[0].init.method, 'PUT');
  const body = JSON.parse(log[0].init.body);
  assert.equal(body.sha, 'abc');
  assert.equal(body.branch, 'main');
  const parsed = JSON.parse(decodeBase64Utf8(body.content));
  assert.equal(parsed.items[0].name, 'CT');
});

test('non-2xx rejects with ApiError', async () => {
  await assert.rejects(getFile('T', fakeFetch(401, {}, [])), (e) => e.status === 401 && e.message.includes('Token 無效或已過期'));
});

test('network failure rejects with status 0', async () => {
  const boom = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(putFile('T', { items: [] }, 'abc', boom), (e) => e.status === 0 && e.message.includes('無法連線'));
});

test('describeApiError messages', () => {
  assert.ok(describeApiError(403).includes('權限不足'));
  assert.ok(describeApiError(404).includes('權限不足'));
  assert.ok(describeApiError(409).includes('重新載入'));
  assert.ok(describeApiError(422).includes('驗證失敗'));
  assert.ok(!describeApiError(422).includes('重新載入'));
  assert.equal(describeApiError(500), 'GitHub 回應錯誤（HTTP 500）');
});

import { getText, putText, ApiError } from '../github.js';

test('getText: 404 -> null; 200 -> text+sha; 401/403 throw', async () => {
  const log = [];
  assert.equal(await getText('T', 'history.csv', fakeFetch(404, {}, log)), null);
  assert.ok(log[0].url.includes('/contents/history.csv?ref=main'));
  const r = await getText('T', 'history.csv', fakeFetch(200, { content: encodeBase64Utf8('a,b\r\n'), sha: 's1' }, []));
  assert.deepEqual(r, { text: 'a,b\r\n', sha: 's1' });
  for (const st of [401, 403]) {
    await assert.rejects(() => getText('T', 'history.csv', fakeFetch(st, {}, [])), (e) => e instanceof ApiError && e.status === st);
  }
});

test('getText: files over 1MB (encoding none) throw instead of reading as empty', async () => {
  await assert.rejects(() => getText('T', 'history.csv', fakeFetch(200, { content: '', encoding: 'none', sha: 's1' }, [])), /過大/);
});

test('putText omits sha when undefined, sends it when given', async () => {
  const log = [];
  const s = await putText('T', 'history.csv', 'x,y\r\n', undefined, 'Add analysis X', fakeFetch(201, { content: { sha: 'n1' } }, log));
  assert.equal(s, 'n1');
  const b = JSON.parse(log[0].init.body);
  assert.ok(!('sha' in b));
  assert.equal(b.message, 'Add analysis X');
  assert.equal(decodeBase64Utf8(b.content), 'x,y\r\n');
  await putText('T', 'history.csv', 'z', 'old', 'm', fakeFetch(200, { content: { sha: 'n2' } }, log));
  assert.equal(JSON.parse(log[1].init.body).sha, 'old');
  assert.ok(log[1].init.method === 'PUT' && log[1].url.endsWith('/contents/history.csv'));
});
