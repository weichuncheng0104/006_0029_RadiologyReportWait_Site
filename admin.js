// Admin page: password gate, token handling, edit weeks, save via GitHub Contents API.
import { WEEK_OPTIONS, weekStyle, validateData, formatTaipei, formatLastUpdate, sha256Hex, PASSWORD_SHA256 } from './core.js';
import { getFile, putFile } from './github.js';

const $ = (id) => document.getElementById(id);
const AUTH_KEY = 'rrw_auth';
const TOKEN_KEY = 'rrw_token';

const store = {
  get(s, k) { try { return s().getItem(k); } catch { return null; } },
  set(s, k, v) { try { s().setItem(k, v); } catch { /* storage unavailable */ } },
  del(s, k) { try { s().removeItem(k); } catch { /* storage unavailable */ } },
};
const LOCAL = () => window.localStorage;
const SESSION = () => window.sessionStorage;

let current = null; // { data, sha }

function show(id) {
  for (const s of ['login', 'token-panel', 'editor']) $(s).hidden = s !== id;
}

function setMsg(id, text, kind) {
  $(id).textContent = text;
  $(id).className = `msg ${kind ?? ''}`;
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

function toTokenPanel(message) {
  setMsg('token-msg', message ?? '', 'err');
  show('token-panel');
}

async function loadData() {
  const token = store.get(LOCAL, TOKEN_KEY);
  if (!token) { toTokenPanel(); return; }
  try {
    const r = await getFile(token);
    const v = validateData(r.data);
    if (!v.ok) throw new Error('data.json 格式錯誤，請聯絡管理者');
    current = { data: v.data, sha: r.sha };
    setMsg('save-msg', '');
    renderEditor();
  } catch (e) {
    if (e.status === 401) store.del(LOCAL, TOKEN_KEY);
    toTokenPanel(e.message);
  }
}

async function save() {
  const token = store.get(LOCAL, TOKEN_KEY);
  if (!token) { toTokenPanel(); return; }
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
    if (e.status === 401) {
      store.del(LOCAL, TOKEN_KEY);
      toTokenPanel(e.message);
    } else {
      setMsg('save-msg', e.message, 'err');
    }
  } finally {
    $('save-btn').disabled = false;
  }
}

async function login() {
  if ((await sha256Hex($('pw').value)) !== PASSWORD_SHA256) {
    setMsg('login-msg', '密碼錯誤', 'err');
    return;
  }
  store.set(SESSION, AUTH_KEY, '1');
  $('pw').value = '';
  setMsg('login-msg', '');
  loadData();
}

$('login-btn').addEventListener('click', login);
$('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
$('token-btn').addEventListener('click', () => {
  const t = $('token').value.trim();
  if (!t) return;
  store.set(LOCAL, TOKEN_KEY, t);
  $('token').value = '';
  setMsg('token-msg', '');
  loadData();
});
$('save-btn').addEventListener('click', save);
$('reload-btn').addEventListener('click', loadData);
$('change-token-btn').addEventListener('click', () => { store.del(LOCAL, TOKEN_KEY); toTokenPanel(); });

if (store.get(SESSION, AUTH_KEY) === '1') loadData(); else show('login');
