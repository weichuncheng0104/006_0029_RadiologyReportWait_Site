// Public board: clock, data.json fetch, table rendering.
import { legendEntries, weekStyle, actualStyle, formatRate, validateData, formatTaipei, formatLastUpdate, buildDataUrl } from './core.js?v=20261116b';

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

function renderRows(items, actual, hasRate) {
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
    if (hasRate) {
      const r = document.createElement('td');
      r.className = 'rate';
      r.textContent = Object.hasOwn(it, 'completionRate') ? formatRate(it.completionRate) : '—';
      tr.append(r);
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
      $('actual-th').textContent = `${actual.captureDate.replaceAll('-', '/')}：最長報告等待時間`;
      $('actual-th').hidden = false;
      $('board').classList.add('has-actual');
    }
    // Completion-rate column only for uploads that recorded the exam date range.
    const hasRate = Boolean(actual && actual.examStart);
    if (hasRate) {
      const slash = (d) => d.replaceAll('-', '/');
      // Zero-width spaces give narrow screens break points inside the long date range.
      $('rate-th').textContent = `${slash(actual.examStart)}-\u200b${slash(actual.examEnd)}\u200b報告完成率(%)`;
      $('rate-th').hidden = false;
      $('board').classList.add('has-rate');
    }
    renderLegend(Boolean(actual));
    renderRows(v.data.items, actual, hasRate);
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
