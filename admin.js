// Admin page: password unlocks the encrypted token, edit weeks, save via GitHub Contents API.
import { WEEK_OPTIONS, weekStyle, validateData, formatTaipei, formatLastUpdate, decryptToken } from './core.js';
import { getFile, putFile } from './github.js';

const $ = (id) => document.getElementById(id);
const TOKEN_FAILURE = 'Token 已失效或權限不足，請管理者更新';

let token = null;   // decrypted PAT, memory only
let current = null; // { data, sha }

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

async function loadData() {
  try {
    const r = await getFile(token);
    const v = validateData(r.data);
    if (!v.ok) throw new Error('data.json 格式錯誤，請聯絡管理者');
    current = { data: v.data, sha: r.sha };
    setMsg('save-msg', '');
    renderEditor();
  } catch (e) {
    if (current) setMsg('save-msg', errorText(e), 'err');
    else setMsg('login-msg', errorText(e), 'err');
  }
}

async function save() {
  const sels = [...document.querySelectorAll('#rows select')];
  if (sels.some((s) => s.value === '')) { setMsg('save-msg', '每一項都要選擇週數', 'err'); return; }
  const weeksById = Object.fromEntries(sels.map((s) => [s.dataset.id, Number(s.value)]));
  const next = {
    ...current.data,
    lastUpdate: new Date().toISOString(),
    items: current.data.items.map((it) => ({ ...it, weeks: weeksById[it.id] })),
  };
  $('save-btn').disabled = true;
  setMsg('save-msg', '儲存中…');
  try {
    const sha = await putFile(token, next, current.sha);
    current = { data: next, sha };
    $('last-update').textContent = formatTaipei(new Date(next.lastUpdate), false);
    setMsg('save-msg', '已儲存，約 1 分鐘後前台更新', 'ok');
  } catch (e) {
    setMsg('save-msg', errorText(e), 'err');
  } finally {
    $('save-btn').disabled = false;
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

// Clean up credentials stored by the earlier token-in-browser version; never read or reuse them.
for (const [s, k] of [[() => window.localStorage, 'rrw_token'], [() => window.sessionStorage, 'rrw_auth']]) {
  try { s().removeItem(k); } catch { /* storage unavailable */ }
}

show('login');
