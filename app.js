// Public board: clock, data.json fetch, table rendering.
import { WEEK_OPTIONS, weekStyle, validateData, formatTaipei, buildDataUrl } from './core.js';

const $ = (id) => document.getElementById(id);

function tick() {
  $('now').textContent = formatTaipei(new Date(), true);
}

function renderLegend() {
  $('legend').replaceChildren(...WEEK_OPTIONS.map((o) => {
    const li = document.createElement('li');
    li.textContent = o.label;
    li.style.background = o.bg;
    li.style.color = o.fg;
    return li;
  }));
}

function renderRows(items) {
  $('rows').replaceChildren(...items.map((it) => {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.textContent = it.name;
    const wait = document.createElement('td');
    const s = weekStyle(it.weeks);
    wait.className = 'wait';
    wait.textContent = s.label;
    wait.style.background = s.bg;
    wait.style.color = s.fg;
    tr.append(name, wait);
    return tr;
  }));
}

async function load() {
  try {
    const res = await fetch(buildDataUrl('./', Date.now()), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const v = validateData(await res.json());
    if (!v.ok) throw new Error(v.error);
    renderRows(v.data.items);
    $('last-update').textContent = v.data.lastUpdate ? formatTaipei(new Date(v.data.lastUpdate), false) : '—';
  } catch {
    $('error').hidden = false;
    $('board').hidden = true;
  }
}

tick();
setInterval(tick, 1000);
renderLegend();
load();
