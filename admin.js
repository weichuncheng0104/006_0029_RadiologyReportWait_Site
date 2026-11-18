// Admin page: password unlocks the encrypted token, edit weeks, save via GitHub Contents API.
import {
  WEEK_OPTIONS, weekStyle, validateData, formatTaipei, formatLastUpdate, decryptToken,
  parseRisText, parseRisJson, parseCapturedAt, computeActual, actualStyle, completionRate, formatRate, taipeiDateString, buildNextData,
  taipeiDateTimeString, historyColumns, buildHistoryRow, upsertHistory,
  expectedColumns, buildExpectedRow, appendCsvRow,
} from './core.js?v=20261118b';
import { getFile, putFile, getText, putText } from './github.js?v=20261118b';

const $ = (id) => document.getElementById(id);
const HISTORY_PATH = 'history.csv';
const EXPECTED_PATH = 'expected_history.csv';
const TOKEN_FAILURE = 'Token 已失效或權限不足，請管理者更新';

let token = null;   // decrypted PAT, memory only
let current = null; // { data, sha }
let ris = null;     // { records, result, captureDate, skipped } from the uploaded list; memory only
let saving = false; // true for the whole save sequence (history -> data.json -> expected log)

// Re-enable Save only when no save sequence is in flight.
function enableSave() {
  $('save-btn').disabled = saving;
}
let risGen = 0;     // selection counter: only the latest file selection may set `ris`

function show(id) {
  for (const s of ['login', 'editor']) $(s).hidden = s !== id;
}

function setMsg(id, text, kind) {
  $(id).textContent = text;
  $(id).className = `msg ${kind ?? ''}`;
}

function errorText(e) {
  return [401, 403, 404].includes(e.status) ? TOKEN_FAILURE : e.message;
}

function isValidWeeks(w) {
  return WEEK_OPTIONS.some((o) => o.value === w);
}

function paint(sel) {
  const s = weekStyle(Number(sel.value));
  sel.style.background = s.bg;
  sel.style.color = s.fg;
}

function renderEditor() {
  const { data } = current;
  $('last-update').textContent = formatLastUpdate(data.lastUpdate);
  $('rows').replaceChildren(...data.items.map((it) => {
    const tr = document.createElement('tr');
    tr.className = 'admin-row';
    const name = document.createElement('td');
    name.textContent = it.name;
    const cell = document.createElement('td');
    const sel = document.createElement('select');
    sel.dataset.id = it.id;
    if (!isValidWeeks(it.weeks)) sel.add(new Option('—（請選擇）', ''));
    for (const o of WEEK_OPTIONS) sel.add(new Option(o.label, String(o.value)));
    sel.value = isValidWeeks(it.weeks) ? String(it.weeks) : '';
    sel.addEventListener('change', () => paint(sel));
    paint(sel);
    cell.append(sel);
    tr.append(name, cell);
    return tr;
  }));
  show('editor');
}

function renderRis() {
  const { records, captureDate } = ris;
  const ids = current.data.items.map((it) => it.id);
  ris.result = computeActual(records, captureDate, ids);
  const { result } = ris;
  const unclassifiedKinds = Object.keys(result.unclassified).length;
  const pendingItems = Object.values(result.counts).reduce((a, b) => a + b, 0)
    + Object.values(result.unclassified).reduce((a, b) => a + b, 0);
  $('ris-summary').textContent = `檔案時間(ID) ${ris.fileTime}；檢查日 ${result.examStart ?? '—'}～${result.examEnd ?? '—'}；紀錄數 ${records.length}；略過 ${ris.skipped} 筆格式錯誤；未打報告 ${result.pendingTotal} 筆、${pendingItems} 項；未分類 ${unclassifiedKinds} 種`;
  $('ris-rows').replaceChildren(...current.data.items.map((it) => {
    const s = actualStyle(result.days[it.id]);
    const tr = document.createElement('tr');
    const rate = formatRate(completionRate(result.done[it.id], result.counts[it.id]));
    const cells = [it.name, String(result.counts[it.id]), result.days[it.id] === null ? '—' : String(result.days[it.id]), s.label,
      String(result.done[it.id]), rate]
      .map((t) => { const td = document.createElement('td'); td.textContent = t; return td; });
    cells[3].style.background = s.bg;
    cells[3].style.color = s.fg;
    tr.append(...cells);
    return tr;
  }));
  const li = ([n, c]) => { const e = document.createElement('li'); e.textContent = `${n}：${c}`; return e; };
  const byCount = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  $('ris-unclassified').replaceChildren(...byCount(result.unclassified).map(li));
  $('ris-matched').replaceChildren(...current.data.items.map((it) => {
    const box = document.createElement('div');
    const h = document.createElement('strong');
    h.textContent = it.name;
    const ul = document.createElement('ul');
    ul.append(...byCount(result.matched[it.id]).map(li));
    box.append(h, ul);
    return box;
  }));
  $('ris-result').hidden = false;
}

function clearRis(msg) {
  risGen += 1; // invalidate any in-flight parse
  ris = null;
  $('ris-result').hidden = true;
  $('ris-file').value = '';
  $('ris-date').value = '';
  setMsg('ris-msg', msg ?? '');
  enableSave();
}

async function onRisFile() {
  const gen = ++risGen;
  const file = $('ris-file').files[0];
  ris = null;
  $('ris-result').hidden = true;
  if (!file) { setMsg('ris-msg', ''); enableSave(); return; }
  $('save-btn').disabled = true; // no save while parsing
  try {
    const text = await file.text();
    if (gen !== risGen) return; // a newer selection superseded this one
    const stats = {};
    let records; let when = new Date(file.lastModified);
    if (text.trimStart().startsWith('{')) {
      // Bookmarklet JSON: its own capture timestamp is more accurate than the file's mtime.
      let obj;
      try { obj = JSON.parse(text); } catch { throw new Error('JSON 無法解析，請確認檔案完整'); }
      records = parseRisJson(obj, stats);
      when = parseCapturedAt(obj.captured_at);
    } else {
      records = parseRisText(text, stats);
    }
    if (records.length === 0) { setMsg('ris-msg', '讀不到任何有效紀錄，請確認檔案格式', 'err'); return; }
    $('ris-date').value = taipeiDateString(when);
    ris = {
      records, result: null, captureDate: $('ris-date').value, skipped: stats.skipped,
      fileTime: taipeiDateTimeString(when),
    };
    setMsg('ris-msg', '已解析（尚未儲存，按下方「儲存」才會發佈）', 'ok');
    renderRis();
  } catch (e) {
    if (gen === risGen) setMsg('ris-msg', `解析失敗：${e.message}`, 'err');
  } finally {
    if (gen === risGen) enableSave();
  }
}

function onRisDate() {
  if (!ris) return;
  const v = $('ris-date').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    ris.captureDate = null; // never keep a stale date
    $('ris-result').hidden = true;
    setMsg('ris-msg', '請選擇擷取日', 'err');
    return;
  }
  ris.captureDate = v;
  setMsg('ris-msg', '已解析（尚未儲存，按下方「儲存」才會發佈）', 'ok');
  renderRis();
}

async function loadData() {
  try {
    const r = await getFile(token);
    const v = validateData(r.data);
    if (!v.ok) throw new Error('data.json 格式錯誤，請聯絡管理者');
    current = { data: v.data, sha: r.sha };
    clearRis('已清除上傳的待報清單（重新載入）');
    setMsg('save-msg', '');
    renderEditor();
  } catch (e) {
    if (current) setMsg('save-msg', errorText(e), 'err');
    else setMsg('login-msg', errorText(e), 'err');
  }
}

async function save() {
  if (saving) return;
  const sels = [...document.querySelectorAll('#rows select')];
  if (sels.some((s) => s.value === '')) { setMsg('save-msg', '每一項都要選擇週數', 'err'); return; }
  const weeksById = Object.fromEntries(sels.map((s) => [s.dataset.id, Number(s.value)]));
  if (ris && !ris.captureDate) { setMsg('ris-msg', '請選擇擷取日', 'err'); setMsg('save-msg', '請選擇擷取日', 'err'); return; }
  const next = buildNextData(
    current.data, weeksById,
    ris ? { ...ris.result, captureDate: ris.captureDate } : null,
    new Date().toISOString(),
  );
  const savedAt = taipeiDateTimeString(new Date()); // row ID: Taipei time at the moment of pressing save
  saving = true;
  $('save-btn').disabled = true;
  $('reload-btn').disabled = true; // reload would swap `current` mid-sequence
  setMsg('save-msg', '儲存中…');
  let historyDone = false;
  try {
    if (ris) {
      const items = current.data.items;
      const row = buildHistoryRow({
        fileTime: ris.fileTime, captureDate: ris.captureDate, analyzedAt: taipeiDateTimeString(new Date(next.lastUpdate)),
        examStart: ris.result.examStart, examEnd: ris.result.examEnd,
        records: ris.records.length, pendingTotal: ris.result.pendingTotal,
        days: ris.result.days, counts: ris.result.counts, done: ris.result.done,
      }, items);
      const old = await getText(token, HISTORY_PATH);
      const text = upsertHistory(old ? old.text : '', row, historyColumns(items));
      await putText(token, HISTORY_PATH, text, old ? old.sha : undefined, `Add analysis ${ris.fileTime}`);
      historyDone = true;
    }
    const sha = await putFile(token, next, current.sha);
    current = { data: next, sha };
    $('last-update').textContent = formatTaipei(new Date(next.lastUpdate), false);
    clearRis('已儲存，上傳狀態已清除');
    try {
      const items = next.items;
      const oldExp = await getText(token, EXPECTED_PATH);
      const text = appendCsvRow(oldExp ? oldExp.text : '', buildExpectedRow(savedAt, items), expectedColumns(items));
      await putText(token, EXPECTED_PATH, text, oldExp ? oldExp.sha : undefined, `Log expected weeks ${savedAt}`);
      setMsg('save-msg', '已儲存，約 1 分鐘後前台更新', 'ok');
    } catch (e2) {
      setMsg('save-msg', `公告表已更新，但預計等候記錄寫入失敗；再按一次儲存可補記（時間為補存當下）（${errorText(e2)}）`, 'err');
    }
  } catch (e) {
    const t = errorText(e);
    const retry = e.status === 409 ? '請按「重新載入」後重新選檔再存（分析記錄不會重複）' : '請重試儲存';
    setMsg('save-msg', historyDone ? `分析記錄已寫入，但公告表更新失敗，${retry}（${t}）` : t, 'err');
  } finally {
    saving = false;
    $('save-btn').disabled = false;
    $('reload-btn').disabled = false;
  }
}

// Download a CSV from the repo via the Contents API, with a UTF-8 BOM prepended.
async function downloadCsv(btnId, path, filename, emptyMsg) {
  $(btnId).disabled = true;
  setMsg('save-msg', '下載中…');
  try {
    const r = await getText(token, path);
    if (!r) { setMsg('save-msg', emptyMsg, 'err'); return; }
    const blob = new Blob(['﻿' + r.text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMsg('save-msg', '');
  } catch (e) {
    setMsg('save-msg', errorText(e), 'err');
  } finally {
    $(btnId).disabled = false;
  }
}

async function login() {
  $('login-btn').disabled = true;
  setMsg('login-msg', '驗證中…');
  try {
    let blob;
    try {
      const res = await fetch(`./token.enc.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error();
      blob = await res.json();
    } catch {
      setMsg('login-msg', '無法載入金鑰檔，請稍後再試', 'err');
      return;
    }
    try {
      token = await decryptToken(blob, $('pw').value);
    } catch {
      setMsg('login-msg', '密碼錯誤', 'err');
      return;
    }
    $('pw').value = '';
    setMsg('login-msg', '');
    await loadData();
  } finally {
    $('login-btn').disabled = false;
  }
}

$('login-btn').addEventListener('click', login);
$('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$('login-btn').disabled) login(); });
$('save-btn').addEventListener('click', save);
$('reload-btn').addEventListener('click', loadData);
$('download-btn').addEventListener('click', () => downloadCsv('download-btn', HISTORY_PATH, '每日等待時間分析.csv', '尚無分析記錄'));
$('download-expected-btn').addEventListener('click', () => downloadCsv('download-expected-btn', EXPECTED_PATH, '預計等候時間記錄.csv', '尚無預計等候記錄'));
$('ris-file').addEventListener('change', onRisFile);
$('ris-date').addEventListener('change', onRisDate);

// Clean up credentials stored by the earlier token-in-browser version; never read or reuse them.
for (const [s, k] of [[() => window.localStorage, 'rrw_token'], [() => window.sessionStorage, 'rrw_auth']]) {
  try { s().removeItem(k); } catch { /* storage unavailable */ }
}

show('login');
