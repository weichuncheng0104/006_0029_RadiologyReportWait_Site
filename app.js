// Public board: clock, data.json fetch, table rendering.
import { legendEntries, weekStyle, actualStyle, validateData, formatTaipei, formatLastUpdate, buildDataUrl } from './core.js?v=20261114c';

const $ = (id) => document.getElementById(id);

function tick() {
  $('now').textContent = formatTaipei(new Date(), true);
}

function renderLegend(hasActual) {
  $('legend').replaceChildren(...legendEntries(hasActual).map((o) => {
    const li = document.createElement('li');
    li.textContent = o.label;
    li.style.background = o.bg;
    li.style.color = o.fg;
    return li;
  }));
}

function renderRows(items, actual) {
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
    if (actual) {
      const a = document.createElement('td');
      // Missing key (old/partial data) shows a grey dash; null means no pending reports.
      const as = Object.hasOwn(it, 'actualDays') ? actualStyle(it.actualDays) : weekStyle(undefined);
      a.className = 'wait';
      a.textContent = as.label;
      a.style.background = as.bg;
      a.style.color = as.fg;
      tr.append(a);
    }
    return tr;
  }));
}

async function load() {
  try {
    const res = await fetch(buildDataUrl('./', Date.now()), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const v = validateData(await res.json());
    if (!v.ok) throw new Error(v.error);
    const actual = v.data.actual ?? null;
    if (actual) {
      $('actual-th').textContent = `${actual.captureDate.replaceAll('-', '/')}：報告等待時間`;
      $('actual-th').hidden = false;
      $('board').classList.add('has-actual');
    }
    renderLegend(Boolean(actual));
    renderRows(v.data.items, actual);
    $('last-update').textContent = formatLastUpdate(v.data.lastUpdate);
  } catch {
    $('error').hidden = false;
    $('board').hidden = true;
  }
}

tick();
setInterval(tick, 1000);
renderLegend(false);
load();
