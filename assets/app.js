import { unlock, remember, recall, forget, loadAll, WrongLogin } from './vault.js';
import { sparkline, lineChart } from './charts.js';

const $ = (s, root = document) => root.querySelector(s);
const fmt = new Intl.NumberFormat('en-US');
const fmt1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const TZ = 'Asia/Riyadh';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS = {
  out: { label: 'Out of stock', rank: 0, color: 'var(--out)' },
  critical: { label: 'Critical', rank: 1, color: 'var(--crit)' },
  low: { label: 'Low', rank: 2, color: 'var(--low)' },
  ok: { label: 'Healthy', rank: 3, color: 'var(--ok)' },
};
const ORDER = ['out', 'critical', 'low', 'ok'];
const badge = (s) => `<span class="badge badge--${s}">${STATUS[s].label}</span>`;

const newViewState = () => ({ filters: { q: '', status: 'all', category: '', location: '', mode: 'location' }, sort: null, limit: 150 });
const state = {
  data: null,
  records: [],
  view: 'overview',
  views: { inventory: newViewState(), critical: newViewState(), out: newViewState() },
};
// state.filters / sort / limit always refer to the view on screen (overview borrows inventory's).
const vs = () => state.views[state.view] ?? state.views.inventory;
Object.defineProperties(state, {
  filters: { get: () => vs().filters },
  sort: { get: () => vs().sort, set: (v) => { vs().sort = v; } },
  limit: { get: () => vs().limit, set: (v) => { vs().limit = v; } },
});

/* ---------------- Boot & auth ---------------- */

async function boot() {
  const key = recall();
  if (key) {
    try { await start(key); return; } catch (e) { console.warn(e); forget(); }
  }
  showLogin();
}

function finishBoot() { const b = $('#boot'); if (!b) return; b.classList.add('is-done'); setTimeout(() => b.remove(), 300); }

function showLogin() {
  $('#app').hidden = true;
  $('#login').classList.remove('is-leaving');
  $('#login').hidden = false;
  finishBoot();
  setTimeout(() => $('#login-user').focus(), 50);
}

$('#toggle-pass').addEventListener('click', () => {
  const input = $('#login-pass');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('#toggle-pass').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

$('#login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const user = $('#login-user').value, pass = $('#login-pass').value;
  const err = $('#login-error'), btn = $('#login-submit'), card = $('#login-form');
  err.hidden = true;
  if (!user.trim() || !pass) { return fail('Enter your user ID and password.'); }
  btn.disabled = true; btn.classList.add('is-loading'); btn.querySelector('.btn-label').textContent = 'Signing in…';
  try {
    const key = await unlock(user, pass);
    remember(key, $('#login-remember').checked);
    $('#login').classList.add('is-leaving');
    await new Promise((r) => setTimeout(r, reduceMotion() ? 0 : 480));
    await start(key);
    $('#app').classList.add('is-entering');
    setTimeout(() => $('#app').classList.remove('is-entering'), 900);
    $('#login-pass').value = '';
  } catch (e) {
    $('#login').classList.remove('is-leaving');
    fail(e instanceof WrongLogin ? e.message : `Couldn't load the stock data. ${e.message}`);
  } finally {
    btn.disabled = false; btn.classList.remove('is-loading'); btn.querySelector('.btn-label').textContent = 'Sign in';
  }
  function fail(msg) {
    err.textContent = msg; err.hidden = false;
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    wiggle();
    $('#login-pass').select();
  }
});

/* Clay scene: shapes drift toward the pointer, nearer shapes move more. */
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const scene = $('#clay-scene');
let raf = 0;
$('#login').addEventListener('pointermove', (e) => {
  if (reduceMotion() || e.pointerType !== 'mouse') return;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    scene.style.setProperty('--mx', ((e.clientX / innerWidth) - 0.5).toFixed(3));
    scene.style.setProperty('--my', ((e.clientY / innerHeight) - 0.5).toFixed(3));
  });
});
$('#login').addEventListener('pointerleave', () => { scene.style.setProperty('--mx', 0); scene.style.setProperty('--my', 0); });
function wiggle() {
  const m = $('.login-mark');
  m.classList.remove('is-wiggle'); void m.offsetWidth; m.classList.add('is-wiggle');
}
$('.login-mark').addEventListener('click', wiggle);

$('#btn-logout').addEventListener('click', () => {
  forget();
  state.data = null; state.records = [];
  $('#page').innerHTML = '';
  viewEls.clear();
  showLogin();
});

$('#btn-theme').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('hm-theme', root.dataset.theme); } catch {}
  invalidateViews();
  render();
});

$('#btn-refresh').addEventListener('click', async () => {
  const btn = $('#btn-refresh');
  btn.classList.remove('is-spinning'); void btn.offsetWidth; btn.classList.add('is-spinning');
  try {
    const before = state.data?.inventory.generatedAt;
    await start(recall(), { keepView: true });
    toast(state.data.inventory.generatedAt === before ? 'Already up to date' : 'New stock data loaded');
  } catch (e) { toast(`Couldn't reload: ${e.message}`); }
});

async function start(key, { keepView = false } = {}) {
  const data = await loadAll(key);
  state.data = data;
  const { fields, rows } = data.inventory;
  state.records = rows.map((r, id) => {
    const o = { id };
    fields.forEach((f, i) => (o[f] = r[i]));
    o.cover = o.usage > 0 ? o.qty / o.usage : null;
    return o;
  });
  state.has = {
    min: state.records.some((r) => r.min != null),
    cover: state.records.some((r) => r.cover != null),
    uom: state.records.some((r) => r.uom),
    code: state.records.some((r) => r.code),
    value: state.records.some((r) => r.unitCost),
    movement: state.records.some((r) => r.stockOut != null || r.stockIn != null),
    opening: state.records.some((r) => r.opening != null),
    inUse: state.records.some((r) => r.inUse != null),
    multiLoc: new Set(state.records.map((r) => r.location)).size > 1,
  };
  if (!state.has.multiLoc) Object.values(state.views).forEach((v) => (v.filters.mode = 'location'));
  invalidateViews();
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#sample-banner').hidden = !data.inventory.source?.sample;
  $('#updated-at').textContent = updatedLabel(data.inventory.generatedAt);
  const s = data.inventory.summary;
  $('#count-all').textContent = compact.format(state.records.length);
  $('#count-critical').textContent = s.critical || '';
  $('#count-out').textContent = s.out || '';
  finishBoot();
  if (!keepView) state.view = viewFromHash();
  render();
}

function updatedLabel(iso) {
  const d = new Date(iso);
  const day = (x) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(x);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d);
  const today = day(new Date()), that = day(d);
  const yest = day(new Date(Date.now() - 864e5));
  const when = that === today ? 'today' : that === yest ? 'yesterday' : new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
  return `Updated ${when} at ${time}`;
}

/* ---------------- Routing ---------------- */

function viewFromHash() {
  const v = location.hash.replace('#', '');
  return ['overview', 'inventory', 'critical', 'out'].includes(v) ? v : 'overview';
}
window.addEventListener('popstate', () => {
  if (!state.data) return;
  const v = viewFromHash();
  if (v !== state.view) { state.view = v; render(); }
});
$('#tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) go(tab.dataset.view);
});
function go(view, filters) {
  if (filters && state.views[view]) {
    Object.assign(state.views[view].filters, filters);
    state.views[view].sort = null;
    state.views[view].limit = 150;
    viewEls.get(view)?.setAttribute('data-dirty', '');
  }
  if (view === state.view && !filters) return;
  state.view = view;
  if (location.hash !== `#${view}`) history.pushState(null, '', `#${view}`);
  render();
}

/* Each view keeps its DOM once built, so switching tabs only hides/shows it.
   The swap is one fade on one layer: old view fades out (ease-in, 120ms),
   new view is built if needed while nothing is visible, then fades up. */
const viewEls = new Map();
let swapTimer = 0;
const OUT_MS = 120;

function invalidateViews() { viewEls.forEach((el) => el.setAttribute('data-dirty', '')); }

function viewEl(view) {
  let el = viewEls.get(view);
  if (!el) {
    el = document.createElement('section');
    el.className = 'view';
    el.dataset.view = view;
    el.setAttribute('data-dirty', '');
    $('#page').append(el);
    viewEls.set(view, el);
  }
  return el;
}

function build(el) {
  const prev = state.view;
  state.view = el.dataset.view; // builders read the active view's state
  el.innerHTML = '';
  if (el.dataset.view === 'overview') renderOverview(el); else renderTableView(el, el.dataset.view);
  state.view = prev;
  el.removeAttribute('data-dirty');
}

function render() {
  if (!state.data) return;
  document.querySelectorAll('.tab').forEach((t) => {
    if (t.dataset.view === state.view) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  moveIndicator();

  const next = viewEl(state.view);
  const prev = [...viewEls.values()].find((el) => el.classList.contains('is-active'));
  clearTimeout(swapTimer);
  viewEls.forEach((el) => { if (el !== next && el !== prev) el.classList.remove('is-active', 'is-leaving', 'is-entering'); });

  const show = () => {
    if (prev && prev !== next) prev.classList.remove('is-active', 'is-leaving');
    next.classList.add('is-active', 'is-entering');
    if (next.hasAttribute('data-dirty')) build(next);
    window.scrollTo(0, 0);
    // two frames: let the hidden-state styles apply before transitioning in
    requestAnimationFrame(() => requestAnimationFrame(() => next.classList.remove('is-entering')));
    if (!prebuilt) idle(prebuild);
  };

  if (prev === next) {
    if (next.hasAttribute('data-dirty')) build(next);
    next.classList.add('is-active'); next.classList.remove('is-leaving', 'is-entering');
    return;
  }
  if (!prev || reduceMotion()) return show();
  prev.classList.add('is-leaving');
  swapTimer = setTimeout(show, OUT_MS);
}

// Build the other tabs in idle time so the first switch is already instant.
let prebuilt = false;
const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 300));
function prebuild(deadline) {
  prebuilt = true;
  for (const v of ['inventory', 'critical', 'out', 'overview']) {
    if (v === state.view || v === 'overview') continue;
    const el = viewEl(v);
    if (el.hasAttribute('data-dirty')) { build(el); warm(el); }
    if (deadline?.timeRemaining && deadline.timeRemaining() < 4) { prebuilt = false; return idle(prebuild); }
  }
}

// Render a hidden view once (invisibly) so the browser caches its layout and paint;
// content-visibility: hidden then keeps that cache for an instant first show.
function warm(el) {
  el.classList.add('is-warm');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('is-warm')));
}

/* Sliding pill under the active tab: transform + width on one small element. */
function moveIndicator({ animate = true } = {}) {
  const tabs = $('#tabs'), pill = $('#tab-pill'), tab = tabs.querySelector('.tab[aria-current]');
  if (!pill || !tab) return;
  if (!animate || !pill.dataset.ready) pill.style.transition = 'none';
  pill.style.width = `${tab.offsetWidth}px`;
  pill.style.transform = `translateX(${tab.offsetLeft}px)`;
  if (!animate || !pill.dataset.ready) { void pill.offsetWidth; pill.style.transition = ''; pill.dataset.ready = '1'; }
  if (tabs.scrollWidth > tabs.clientWidth) tab.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
}
window.addEventListener('resize', debounce(() => moveIndicator({ animate: false }), 100));
document.fonts?.ready.then(() => moveIndicator({ animate: false }));

/* ---------------- Overview ---------------- */

function renderOverview(page) {
  const { inventory, history } = state.data;
  const s = inventory.summary;
  const prev = history.length > 1 ? history.at(-2).summary : null;
  const series = (k) => history.map((h) => h.summary[k]);
  const pct = (n) => (s.records ? Math.round((n / s.records) * 100) : 0);

  page.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">${esc(dateLine(inventory.generatedAt))}</p>
        <h1 class="page-title">Inventory overview</h1>
        <p class="page-sub">${fmt.format(s.items)} items${s.locations > 1 ? ` across ${fmt.format(s.locations)} locations` : ''}. ${headline(s)}</p>
      </div>
    </div>
    <section class="grid" id="kpis"></section>
    <section class="grid" style="margin-top:16px">
      <article class="card span-4">
        <div class="card-head"><div><h2 class="card-title">Stock health</h2><p class="card-sub">${fmt.format(s.records)} stock lines</p></div></div>
        <div class="health-bar" role="img" aria-label="Stock health">${ORDER.map((k) => s[k] ? `<span class="seg--${k}" style="flex:${s[k]}"></span>` : '').join('')}</div>
        <div class="legend">${ORDER.map((k) => `
          <button class="legend-row" data-status="${k}"><span class="dot dot--${k}"></span><span>${STATUS[k].label}</span><span class="num">${fmt.format(s[k])}</span><span class="pct">${pct(s[k])}%</span></button>`).join('')}
        </div>
        <p class="card-sub rule-note">${ruleText(inventory.thresholds)}</p>
      </article>
      <article class="card span-8">
        <div class="card-head">
          <div><h2 class="card-title">Out of stock and critical, by day</h2><p class="card-sub">From each morning's import</p></div>
          <div class="chart-legend"><span><i class="dot dot--out"></i>Out of stock</span><span><i class="dot dot--critical"></i>Critical</span></div>
        </div>
        <div id="trend"></div>
      </article>
      <article class="card span-6">
        <div class="card-head"><div><h2 class="card-title">By category</h2><p class="card-sub">Stock lines by status, most urgent first</p></div></div>
        <div class="bars" id="by-category"></div>
      </article>
      ${state.has.multiLoc || !state.has.movement ? `<article class="card span-6">
        <div class="card-head"><div><h2 class="card-title">By location</h2><p class="card-sub">Stock lines by status, most urgent first</p></div></div>
        <div class="bars" id="by-location"></div>
      </article>` : `<article class="card span-6">
        <div class="card-head"><div><h2 class="card-title">Most issued</h2><p class="card-sub">Units issued, and what's left on hand</p></div></div>
        <div class="bars bars--wide" id="most-issued"></div>
      </article>`}
      <article class="card span-12">
        <div class="card-head">
          <div><h2 class="card-title">Order first</h2><p class="card-sub">Out of stock items that are issued most, then critical items with the least left</p></div>
          <button class="link" data-go="critical">See all critical</button>
        </div>
        <div class="attention" id="attention"></div>
      </article>
    </section>`;

  // KPI tiles
  const kpis = $('#kpis', page);
  const tile = (opts) => {
    const t = document.createElement(opts.go ? 'button' : 'article');
    t.className = `card kpi span-3 ${opts.mod ?? ''}`;
    if (opts.go) t.dataset.go = opts.go;
    t.innerHTML = `
      <span class="kpi-label"><span class="dot ${opts.dot ?? ''}"></span>${opts.label}</span>
      <span class="kpi-value">${opts.value}</span>
      <span class="kpi-foot"><span>${opts.foot}</span></span>`;
    if (opts.spark?.length > 1) t.querySelector('.kpi-foot').append(sparkline(opts.spark, opts.color));
    kpis.append(t);
  };
  tile({ label: 'Items tracked', value: fmt.format(s.items), foot: state.has.multiLoc ? `${fmt.format(s.records)} lines · ${fmt.format(s.locations)} locations` : state.has.inUse ? `${fmt.format(s.inUse)} units in use` : `${fmt.format(s.records)} lines`, spark: series('items'), color: 'var(--ink-3)' });
  tile({
    label: 'Units on hand', value: compact.format(s.units),
    foot: state.has.value ? `SAR ${compact.format(s.value)} value ${delta(s.units, prev?.units, { pct: true, upGood: true })}`
      : state.has.movement ? `${compact.format(s.stockIn ?? 0)} in · ${compact.format(s.stockOut ?? 0)} out ${delta(s.units, prev?.units, { pct: true, upGood: true })}`
      : delta(s.units, prev?.units, { pct: true, upGood: true, label: true }),
    spark: series('units'), color: 'var(--ok)',
  });
  tile({ label: 'Critical', value: fmt.format(s.critical), foot: `${pct(s.critical)}% of lines ${delta(s.critical, prev?.critical)}`, spark: series('critical'), color: 'var(--crit)', mod: 'kpi--critical', dot: 'dot--critical', go: 'critical' });
  tile({ label: 'Out of stock', value: fmt.format(s.out), foot: `${pct(s.out)}% of lines ${delta(s.out, prev?.out)}`, spark: series('out'), color: 'var(--out)', mod: 'kpi--out', dot: 'dot--out', go: 'out' });

  // Trend
  const trend = $('#trend', page);
  if (history.length < 2) {
    trend.innerHTML = `<div class="empty-chart">The trend appears after the second daily import.<br>Today: ${fmt.format(s.out)} out of stock, ${fmt.format(s.critical)} critical.</div>`;
  } else {
    const draw = () => lineChart(trend, {
      labels: history.map((h) => shortDay(h.day)),
      series: [
        { name: 'Out of stock', color: cssVar('--out'), values: series('out') },
        { name: 'Critical', color: cssVar('--crit'), values: series('critical') },
      ],
    });
    requestAnimationFrame(draw);
    onResize(draw);
  }

  breakdown($('#by-category', page), 'category');
  if ($('#by-location', page)) breakdown($('#by-location', page), 'location');
  else mostIssued($('#most-issued', page));

  // Attention list
  const outs = state.records.filter((r) => r.status === 'out').sort((a, b) => demand(b) - demand(a) || a.item.localeCompare(b.item));
  const crits = state.records.filter((r) => r.status === 'critical').sort((a, b) => coverRank(a) - coverRank(b));
  const list = [...outs, ...crits].slice(0, 10);
  $('#attention', page).innerHTML = list.length ? list.map((r) => `
    <button class="attention-row" data-item="${esc(r.item)}">
      <span><span class="item-name">${esc(nameOf(r))}</span><span class="where">${esc([state.has.multiLoc && r.location, r.code, r.category].filter(Boolean).join(' · '))}</span></span>
      <span class="num muted">${qtyText(r)} left${r.cover != null && r.qty > 0 ? ` · ${fmt1.format(r.cover)} days` : r.stockOut ? ` · ${fmt.format(r.stockOut)} issued` : ''}</span>
      ${badge(r.status)}
    </button>`).join('') : `<div class="empty"><strong>Nothing urgent</strong>No lines are out of stock or critical today.</div>`;

}

$('#page').addEventListener('click', (e) => { if (state.view === 'overview') overviewClicks(e); });
function overviewClicks(e) {
  const go_ = e.target.closest('[data-go]');
  if (go_) return go(go_.dataset.go, { status: 'all', category: '', location: '', q: '' });
  const st = e.target.closest('[data-status]');
  if (st) return go('inventory', { status: st.dataset.status, category: '', location: '', q: '', mode: 'location' });
  const bar = e.target.closest('[data-filter]');
  if (bar) return go('inventory', { status: 'all', category: '', location: '', q: '', mode: 'location', [bar.dataset.filter]: bar.dataset.value });
  const item = e.target.closest('[data-item]');
  if (item) openItem(item.dataset.item);
}

function headline(s) {
  if (!s.out && !s.critical) return 'Nothing is out of stock or critical.';
  const parts = [];
  if (s.out) parts.push(`${fmt.format(s.out)} out of stock`);
  if (s.critical) parts.push(`${fmt.format(s.critical)} critical`);
  return `${parts.join(' and ')} need ordering.`;
}

const nameOf = (r) => r.short || r.item;
const sameName = (r) => !r.short || r.short.trim().toLowerCase() === r.item.trim().toLowerCase();
const demand = (r) => r.usage ?? r.stockOut ?? 0;

function ruleText(t) {
  if (state.has.min) return `Critical means at or below the minimum level. Low means within ${t.lowFactor}× of it.`;
  if (state.has.cover) return `Critical means under ${t.criticalDays} days of cover at the average daily use.`;
  if (state.has.movement) return `Critical: ${t.criticalQty} or fewer left, or less than ${t.criticalCoverPct}% of the units issued. Low: ${t.criticalQty * t.lowFactor} or fewer, or under ${t.lowCoverPct}%.`;
  return `Critical: ${t.criticalQty} or fewer left. Low: ${t.criticalQty * t.lowFactor} or fewer.`;
}

function mostIssued(container) {
  const list = state.records.filter((r) => r.stockOut > 0).sort((a, b) => b.stockOut - a.stockOut).slice(0, 8);
  const max = Math.max(1, ...list.map((r) => r.stockOut));
  container.innerHTML = list.map((r, i) => `
    <button class="bar-row" data-item="${esc(r.item)}" title="${esc(r.item)}">
      <span class="label">${esc(nameOf(r))}</span>
      <span class="bar-track" style="width:${Math.max(4, (r.stockOut / max) * 100)}%"><span style="flex:1;background:${STATUS[r.status].color};animation-delay:${i * 40}ms"></span></span>
      <span class="num">${fmt.format(r.stockOut)} <span style="color:var(--ink-3);font-weight:500">out · ${fmt.format(r.qty)} left</span></span>
    </button>`).join('');
}

function breakdown(container, key) {
  const groups = new Map();
  for (const r of state.records) {
    const g = groups.get(r[key]) ?? { name: r[key], out: 0, critical: 0, low: 0, ok: 0, total: 0 };
    g[r.status]++; g.total++;
    groups.set(r[key], g);
  }
  const list = [...groups.values()].sort((a, b) => (b.out + b.critical) - (a.out + a.critical) || b.total - a.total);
  const max = Math.max(...list.map((g) => g.total));
  const shown = list.slice(0, 8);
  container.innerHTML = shown.map((g, i) => `
    <button class="bar-row" data-filter="${key}" data-value="${esc(g.name)}" title="${esc(g.name)}: ${g.out} out, ${g.critical} critical, ${g.low} low, ${g.ok} healthy">
      <span class="label">${esc(g.name)}</span>
      <span class="bar-track" style="width:${Math.max(4, (g.total / max) * 100)}%">${ORDER.map((k) => g[k] ? `<span class="seg--${k}" style="flex:${g[k]};animation-delay:${i * 40}ms"></span>` : '').join('')}</span>
      <span class="num">${g.out + g.critical ? `<span style="color:var(--out-ink)">${g.out + g.critical}</span><span style="color:var(--ink-3);font-weight:500"> / ${g.total}</span>` : `<span style="color:var(--ink-3);font-weight:500">${g.total}</span>`}</span>
    </button>`).join('') + (list.length > shown.length ? `<p class="card-sub" style="margin:0">+ ${list.length - shown.length} more in the inventory view</p>` : '');
}

/* ---------------- Table views ---------------- */

const VIEW_COPY = {
  inventory: { title: 'Inventory', sub: 'Every stock line from the latest import.' },
  critical: { title: 'Critical stock', sub: 'About to run out. Order these next.' },
  out: { title: 'Out of stock', sub: 'Nothing left on hand. The most-issued items are listed first.' },
};

function renderTableView(page, view) {
  const locked = view === 'critical' || view === 'out' ? view : null;
  const f = state.filters;
  const copy = VIEW_COPY[view];
  const base = locked ? state.records.filter((r) => r.status === locked) : state.records;
  const uniq = (k) => [...new Set(base.map((r) => r[k]))].sort((a, b) => String(a).localeCompare(String(b)));
  const counts = Object.fromEntries(ORDER.map((k) => [k, state.records.filter((r) => r.status === k).length]));

  page.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">${esc(dateLine(state.data.inventory.generatedAt))}</p>
        <h1 class="page-title">${copy.title}</h1>
        <p class="page-sub">${copy.sub}${view === 'critical' ? ` ${ruleText(state.data.inventory.thresholds).split(' Low:')[0]}` : ''}</p>
      </div>
      <button class="btn btn-secondary" id="export">
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 3v10m0 0-4-4m4 4 4-4M4 15v2h12v-2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Export CSV
      </button>
    </div>
    <div class="toolbar">
      <label class="search">
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m13.5 13.5 3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        <input class="input" id="q" type="search" placeholder="${state.has.multiLoc ? 'Search item, code or location' : 'Search item or code'}" value="${esc(f.q)}" aria-label="Search">
      </label>
      <select class="select" id="f-category" aria-label="Category"><option value="">All categories</option>${uniq('category').map((c) => `<option ${c === f.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      ${state.has.multiLoc ? `<select class="select" id="f-location" aria-label="Location"><option value="">All locations</option>${uniq('location').map((c) => `<option ${c === f.location ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <div class="seg-control" role="group" aria-label="Group rows">
        <button data-mode="location" aria-pressed="${f.mode === 'location'}">By location</button>
        <button data-mode="item" aria-pressed="${f.mode === 'item'}">By item</button>
      </div>` : ''}
    </div>
    ${locked ? '' : `<div class="chips" id="chips" style="margin:-4px 0 16px">
      <button class="chip" data-chip="all" aria-pressed="${f.status === 'all'}">All <span class="num">${fmt.format(state.records.length)}</span></button>
      ${ORDER.map((k) => `<button class="chip" data-chip="${k}" aria-pressed="${f.status === k}"><span class="dot dot--${k}"></span>${STATUS[k].label} <span class="num">${fmt.format(counts[k])}</span></button>`).join('')}
    </div>`}
    <div class="card table-card"><div id="table"></div></div>`;

  const refresh = () => drawTable($('#table', page), base, locked);
  $('#q', page).addEventListener('input', debounce((e) => { f.q = e.target.value; state.limit = 150; refresh(); }, 120));
  $('#f-category', page).addEventListener('change', (e) => { f.category = e.target.value; refresh(); });
  $('#f-location', page)?.addEventListener('change', (e) => { f.location = e.target.value; refresh(); });
  page.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    f.mode = b.dataset.mode; state.sort = null;
    page.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    refresh();
  }));
  $('#chips', page)?.addEventListener('click', (e) => {
    const c = e.target.closest('[data-chip]'); if (!c) return;
    f.status = c.dataset.chip;
    page.querySelectorAll('[data-chip]').forEach((x) => x.setAttribute('aria-pressed', x === c));
    refresh();
  });
  $('#export', page).addEventListener('click', () => exportCsv(currentRows(base, locked), view));
  refresh();
}

function currentRows(base, locked) {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  let rows = base.filter((r) =>
    (locked || f.status === 'all' || r.status === f.status) &&
    (!f.category || r.category === f.category) &&
    (!f.location || r.location === f.location) &&
    (!q || `${r.item} ${r.short ?? ''} ${r.code} ${r.location}`.toLowerCase().includes(q)));
  if (f.mode === 'item') rows = aggregate(rows);
  return sortRows(rows, locked);
}

function aggregate(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = r.item.toLowerCase();
    const a = map.get(k) ?? { item: r.item, code: r.code, category: r.category, uom: r.uom, qty: 0, min: null, usage: null, locations: 0, outAt: 0, critAt: 0, status: 'ok' };
    a.qty += Math.max(0, r.qty);
    for (const k of ['opening', 'stockIn', 'stockOut', 'inUse']) if (r[k] != null) a[k] = (a[k] ?? 0) + r[k];
    a.short ??= r.short;
    if (r.min != null) a.min = (a.min ?? 0) + r.min;
    if (r.usage != null) a.usage = (a.usage ?? 0) + r.usage;
    a.locations++;
    if (r.status === 'out') a.outAt++;
    if (r.status === 'critical') a.critAt++;
    if (STATUS[r.status].rank < STATUS[a.status].rank) a.status = r.status;
    map.set(k, a);
  }
  return [...map.values()].map((a) => ({ ...a, cover: a.usage > 0 ? a.qty / a.usage : null }));
}

const coverRank = (r) => (r.cover != null ? r.cover : r.min ? r.qty / r.min * 7 : r.stockOut > 0 ? r.qty / r.stockOut : r.qty);

function sortRows(rows, locked) {
  const s = state.sort;
  if (!s) {
    return rows.sort((a, b) => STATUS[a.status].rank - STATUS[b.status].rank ||
      (a.status === 'out' ? demand(b) - demand(a) : coverRank(a) - coverRank(b)) ||
      a.item.localeCompare(b.item));
  }
  const dir = s.dir === 'asc' ? 1 : -1;
  return rows.sort((a, b) => {
    let x = a[s.key], y = b[s.key];
    if (s.key === 'status') { x = STATUS[x].rank; y = STATUS[y].rank; }
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * dir;
  });
}

function columns(mode) {
  const h = state.has;
  if (mode === 'item') {
    return [
      { key: 'item', label: 'Item' },
      { key: 'category', label: 'Category', cls: 'hide-sm' },
      { key: 'locations', label: 'Locations', n: true, cls: 'hide-sm' },
      { key: 'qty', label: 'On hand', n: true },
      h.cover && { key: 'cover', label: 'Days cover', n: true, cls: 'hide-sm' },
      { key: 'outAt', label: 'Out at', n: true, cls: 'hide-sm' },
      { key: 'critAt', label: 'Critical at', n: true, cls: 'hide-sm' },
      { key: 'status', label: 'Worst location' },
    ].filter(Boolean);
  }
  return [
    { key: 'item', label: 'Item' },
    { key: 'category', label: 'Category', cls: 'hide-sm' },
    h.multiLoc && { key: 'location', label: 'Location' },
    h.opening && { key: 'opening', label: 'Opening', n: true, cls: 'hide-sm' },
    h.movement && { key: 'stockIn', label: 'Stock in', n: true, cls: 'hide-sm' },
    h.movement && { key: 'stockOut', label: 'Stock out', n: true, cls: 'hide-sm' },
    { key: 'qty', label: 'On hand', n: true },
    h.inUse && { key: 'inUse', label: 'In use', n: true, cls: 'hide-sm' },
    h.min && { key: 'min', label: 'Min', n: true, cls: 'hide-sm' },
    h.cover && { key: 'cover', label: 'Days cover', n: true, cls: 'hide-sm' },
    { key: 'status', label: 'Status' },
  ].filter(Boolean);
}

function drawTable(host, base, locked) {
  const rows = currentRows(base, locked);
  const cols = columns(state.filters.mode);
  const s = state.sort;
  if (!rows.length) {
    host.innerHTML = `<div class="empty"><strong>${locked === 'out' ? 'Nothing is out of stock' : locked === 'critical' ? 'Nothing is critical' : 'No matching stock lines'}</strong>${base.length ? 'Try clearing the search or filters.' : 'Good news for today.'}</div>`;
    return;
  }
  const shown = rows.slice(0, state.limit);
  host.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead><tr>${cols.map((c) => `<th class="${c.n ? 'n' : ''} ${c.cls ?? ''}" ${s?.key === c.key ? `aria-sort="${s.dir === 'asc' ? 'ascending' : 'descending'}"` : ''}><button data-sort="${c.key}">${c.label}<svg class="sort-ind" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M3 7.5 6 4.5l3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></th>`).join('')}</tr></thead>
        <tbody>${shown.map((r) => `<tr data-item="${esc(r.item)}" tabindex="0">${cols.map((c) => cell(c, r)).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>
    <div class="table-foot">
      <span>Showing ${fmt.format(shown.length)} of ${fmt.format(rows.length)} ${state.filters.mode === 'item' ? 'items' : 'lines'}</span>
      ${rows.length > shown.length ? '<button class="btn btn-secondary" id="more">Show more</button>' : ''}
    </div>`;
  host.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.sort;
    const numeric = cols.find((c) => c.key === key)?.n;
    state.sort = state.sort?.key === key ? { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: numeric ? 'desc' : 'asc' };
    drawTable(host, base, locked);
  }));
  host.querySelector('#more')?.addEventListener('click', () => { state.limit += 300; drawTable(host, base, locked); });
  const tbody = host.querySelector('tbody');
  tbody.addEventListener('click', (e) => { const tr = e.target.closest('tr'); if (tr) openItem(tr.dataset.item); });
  tbody.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const tr = e.target.closest('tr'); if (tr) openItem(tr.dataset.item); } });
}

function cell(c, r) {
  const cls = `${c.n ? 'n' : ''} ${c.cls ?? ''}`;
  switch (c.key) {
    case 'item': {
      const sub = [r.code, sameName(r) ? '' : r.item].filter(Boolean).join(' · ');
      return `<td class="item-cell"><span class="item-name">${esc(nameOf(r))}</span>${sub ? `<span class="item-code" title="${esc(sub)}">${esc(sub)}</span>` : ''}</td>`;
    }
    case 'status': return `<td>${badge(r.status)}</td>`;
    case 'qty': {
      const ref = r.min ? r.min * 2 : null;
      const meter = ref ? `<span class="mini-meter hide-sm"><span style="width:${Math.min(100, (Math.max(0, r.qty) / ref) * 100)}%;background:${STATUS[r.status].color}"></span></span>` : '';
      return `<td class="${cls}"><span class="qty-cell">${meter}<span>${qtyText(r)}</span></span></td>`;
    }
    case 'min': return `<td class="${cls} muted">${r.min != null ? fmt.format(r.min) : '—'}</td>`;
    case 'cover': return `<td class="${cls} muted">${r.cover != null ? `${fmt1.format(r.cover)} d` : '—'}</td>`;
    case 'outAt': return `<td class="${cls}" style="${r.outAt ? 'color:var(--out-ink);font-weight:600' : ''}">${r.outAt || '—'}</td>`;
    case 'critAt': return `<td class="${cls}" style="${r.critAt ? 'color:var(--crit-ink);font-weight:600' : ''}">${r.critAt || '—'}</td>`;
    default: return `<td class="${cls} ${c.n ? 'muted' : 'muted'}">${c.n ? (r[c.key] == null ? '—' : fmt.format(r[c.key])) : esc(r[c.key])}</td>`;
  }
}

const qtyText = (r) => `${fmt.format(r.qty)}${r.uom ? ` <span style="color:var(--ink-3);font-size:var(--fs-xs)">${esc(r.uom)}</span>` : ''}`;

function exportCsv(rows, view) {
  const cols = columns(state.filters.mode).map((c) => c.key);
  cols.splice(1, 0, 'code');
  if (state.has.short || state.records.some((r) => r.short)) cols.splice(1, 0, 'short');
  if (!state.has.multiLoc) { const i = cols.indexOf('location'); if (i > -1) cols.splice(i, 1); }
  const head = cols.map((c) => c === 'cover' ? 'days_cover' : c);
  const line = (vals) => vals.map((v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',');
  const csv = [line(head), ...rows.map((r) => line(cols.map((c) => c === 'status' ? STATUS[r.status].label : c === 'cover' && r.cover != null ? r.cover.toFixed(1) : r[c])))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `stock-${view}-${new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Exported ${fmt.format(rows.length)} rows`);
}

/* ---------------- Item drawer ---------------- */

let lastFocus = null;
function openItem(name) {
  const lines = state.records.filter((r) => r.item === name).sort((a, b) => STATUS[a.status].rank - STATUS[b.status].rank || a.qty - b.qty);
  if (!lines.length) return;
  const agg = aggregate(lines)[0];
  const root = $('#drawer');
  $('#drawer-eyebrow').textContent = [agg.category, agg.code].filter(Boolean).join(' · ');
  $('#drawer-title').textContent = nameOf(lines[0]);
  const max = Math.max(1, ...lines.map((l) => Math.max(l.qty, l.min ?? 0)));
  const trend = state.data.history.filter((h) => h.perItem && name in h.perItem);

  const mv = state.has.movement ? movement(agg) : '';
  $('#drawer-body').innerHTML = `
    ${sameName(lines[0]) ? '' : `<p class="card-sub" style="margin:-8px 0 0">${esc(name)}</p>`}
    <div class="stat-row">
      <div class="stat"><p class="eyebrow">On hand</p><div class="v">${fmt.format(agg.qty)}${agg.uom ? ` <small style="font-size:var(--fs-xs);color:var(--ink-3)">${esc(agg.uom)}</small>` : ''}</div></div>
      ${state.has.multiLoc ? `
      <div class="stat"><p class="eyebrow">${agg.cover != null ? 'Days cover' : 'Locations'}</p><div class="v">${agg.cover != null ? fmt1.format(agg.cover) : agg.locations}</div></div>
      <div class="stat"><p class="eyebrow">Need ordering</p><div class="v">${agg.outAt + agg.critAt} <small style="font-size:var(--fs-xs);color:var(--ink-3)">of ${agg.locations} location${agg.locations === 1 ? '' : 's'}</small></div></div>` : `
      <div class="stat"><p class="eyebrow">${state.has.movement ? 'Issued' : 'Days cover'}</p><div class="v">${state.has.movement ? fmt.format(agg.stockOut ?? 0) : agg.cover != null ? fmt1.format(agg.cover) : '—'}</div></div>
      <div class="stat"><p class="eyebrow">Status</p><div class="v">${badge(agg.status)}</div></div>`}
    </div>
    ${mv}
    ${lines.some((l) => l.note) ? `<p class="card-sub" style="margin:0">Note: ${esc(lines.map((l) => l.note).filter(Boolean).join(' · '))}</p>` : ''}
    <section ${state.has.multiLoc ? '' : 'hidden'}>
      <div class="card-head"><h3 class="card-title">By location</h3><span class="card-sub">${agg.outAt} out · ${agg.critAt} critical</span></div>
      <div class="bars">${lines.map((l, i) => `
        <div class="bar-row" title="${esc(l.location)}">
          <span class="label">${esc(l.location)}</span>
          <span class="bar-track" style="position:relative;overflow:visible">
            <span style="flex:none;width:${Math.max(l.qty > 0 ? 2 : 0, (Math.max(0, l.qty) / max) * 100)}%;background:${STATUS[l.status].color};border-radius:5px;animation-delay:${i * 30}ms"></span>
            ${l.min ? `<i style="position:absolute;left:${(l.min / max) * 100}%;top:-3px;bottom:-3px;width:2px;border-radius:1px;background:var(--ink-2)" title="Min ${fmt.format(l.min)}"></i>` : ''}
          </span>
          <span class="num">${fmt.format(l.qty)}</span>
        </div>`).join('')}
      </div>
      ${state.has.min ? '<p class="card-sub" style="margin-top:12px">The dark tick marks the minimum level.</p>' : ''}
    </section>
    <section>
      <div class="card-head"><h3 class="card-title">Total on hand, by day</h3></div>
      <div id="item-trend">${trend.length < 2 ? '<div class="empty-chart" style="height:140px">The trend appears after the second daily import.</div>' : ''}</div>
    </section>`;

  root.hidden = false;
  lastFocus = document.activeElement;
  requestAnimationFrame(() => {
    root.classList.add('is-open');
    $('.drawer', root).focus();
    if (trend.length >= 2) {
      lineChart($('#item-trend'), { labels: trend.map((h) => shortDay(h.day)), series: [{ name: 'On hand', color: cssVar('--ok'), values: trend.map((h) => h.perItem[name]) }], height: 180 });
    }
  });
}

function movement(a) {
  const opening = a.opening ?? 0, inn = a.stockIn ?? 0, out = a.stockOut ?? 0;
  const expected = opening + inn - out;
  const row = (label, v, cls = '') => `<div class="mv-row ${cls}"><span>${label}</span><span class="num">${v}</span></div>`;
  return `<section>
    <div class="card-head"><h3 class="card-title">Stock movement</h3>${a.inUse != null ? `<span class="card-sub">${fmt.format(a.inUse)} in use</span>` : ''}</div>
    <div class="mv">
      ${row('Opening quantity', fmt.format(opening))}
      ${row('Stock in', `+ ${fmt.format(inn)}`, 'mv-in')}
      ${row('Stock out', `− ${fmt.format(out)}`, 'mv-out')}
      ${row('On hand', fmt.format(a.qty), 'mv-total')}
    </div>
    ${expected !== a.qty ? `<p class="form-error" style="margin:12px 0 0">Opening + in − out gives ${fmt.format(expected)}, but the file shows ${fmt.format(a.qty)} on hand. Worth a recount.</p>` : ''}
  </section>`;
}

function closeDrawer() {
  const root = $('#drawer');
  if (root.hidden) return;
  root.classList.add('is-closing');
  root.classList.remove('is-open');
  setTimeout(() => { root.hidden = true; root.classList.remove('is-closing'); lastFocus?.focus?.(); }, 240);
}
$('#drawer').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDrawer(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
  if (e.key === 'Tab' && !$('#drawer').hidden) {
    const items = [...$('#drawer').querySelectorAll('button, [tabindex]:not([tabindex="-1"])')];
    if (!items.length) return;
    const first = items[0], last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { const q = $('.view.is-active #q'); if (q) { e.preventDefault(); q.focus(); } }
});

/* ---------------- Helpers ---------------- */

function delta(now, before, { pct = false, upGood = false, label = false } = {}) {
  if (before == null) return label ? 'First import' : '';
  const d = now - before;
  if (!d) return `<span class="delta delta--flat">· no change</span>`;
  const good = upGood ? d > 0 : d < 0;
  const val = pct && before ? `${fmt1.format(Math.abs((d / before) * 100))}%` : fmt.format(Math.abs(d));
  return `<span class="delta delta--${good ? 'good' : 'bad'}" title="vs previous import">${d > 0 ? '↑' : '↓'} ${val}</span>`;
}
const dateLine = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
const shortDay = (day) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
let resizeFns = [];
function onResize(fn) { resizeFns = [fn]; }
window.addEventListener('resize', debounce(() => {
  if (state.view === 'overview') resizeFns.forEach((f) => f());
  else viewEls.get('overview')?.setAttribute('data-dirty', '');
}, 150));

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  $('#toaster').append(t);
  setTimeout(() => { t.classList.add('is-leaving'); setTimeout(() => t.remove(), 220); }, 2600);
}

boot();
