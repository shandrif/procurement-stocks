// Small SVG charts drawn to the HM palette. No dependencies.
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
const fmt = new Intl.NumberFormat('en-US');

export function sparkline(values, color) {
  const w = 96, h = 28, pad = 3;
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'spark', 'aria-hidden': 'true' });
  if (!values || values.length < 2) return svg;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => [pad + (i * (w - pad * 2)) / (values.length - 1), h - pad - ((v - min) / span) * (h - pad * 2)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  svg.append(el('path', { d: `${d}L${pts.at(-1)[0]},${h}L${pts[0][0]},${h}Z`, fill: color, opacity: '0.10' }));
  svg.append(el('path', { d, fill: 'none', stroke: color, 'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  const last = pts.at(-1);
  svg.append(el('circle', { cx: last[0], cy: last[1], r: '2.5', fill: color }));
  return svg;
}

// Round axis top so each of the 4 gridlines lands on a whole, readable step.
function niceMax(v) {
  const raw = Math.max(1, v / 4);
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= raw && Number.isInteger(m)) ?? Math.ceil(raw);
  return step * 4;
}

// series: [{ name, color, values }] · labels: string[]
export function lineChart(container, { labels, series, height = 240, format = (v) => fmt.format(v) }) {
  container.innerHTML = '';
  container.classList.add('chart');
  const width = Math.max(320, container.clientWidth || 640);
  const m = { t: 12, r: 12, b: 28, l: 40 };
  const iw = width - m.l - m.r, ih = height - m.t - m.b;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const x = (i) => m.l + (labels.length === 1 ? iw / 2 : (i * iw) / (labels.length - 1));
  const y = (v) => m.t + ih - (v / max) * ih;

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img' });
  for (let k = 0; k <= 4; k++) {
    const v = (max / 4) * k, yy = y(v);
    svg.append(el('line', { x1: m.l, x2: width - m.r, y1: yy, y2: yy, class: 'grid-line' }));
    const t = el('text', { x: m.l - 8, y: yy + 4, 'text-anchor': 'end', class: 'axis' }); t.textContent = format(Math.round(v)); svg.append(t);
  }
  const step = Math.ceil(labels.length / Math.max(2, Math.floor(iw / 72)));
  labels.forEach((lab, i) => {
    if (i % step && i !== labels.length - 1) return;
    const t = el('text', { x: x(i), y: height - 8, 'text-anchor': i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle', class: 'axis' });
    t.textContent = lab; svg.append(t);
  });
  for (const s of series) {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    svg.append(el('path', { d: `${d}L${x(s.values.length - 1)},${y(0)}L${x(0)},${y(0)}Z`, fill: s.color, class: 'area' }));
    const path = el('path', { d, stroke: s.color, class: 'series series-path' });
    svg.append(path);
    requestAnimationFrame(() => path.style.setProperty('--len', Math.ceil(path.getTotalLength() || 1000)));
  }
  const hover = el('g', { opacity: '0' });
  const vline = el('line', { y1: m.t, y2: m.t + ih, class: 'hover-line' });
  hover.append(vline);
  const dots = series.map((s) => { const c = el('circle', { r: '4', fill: s.color, stroke: 'var(--surface)', 'stroke-width': '2' }); hover.append(c); return c; });
  svg.append(hover);
  container.append(svg);

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  container.append(tip);

  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * width;
    const i = Math.max(0, Math.min(labels.length - 1, Math.round(((px - m.l) / iw) * (labels.length - 1))));
    hover.setAttribute('opacity', '1');
    vline.setAttribute('x1', x(i)); vline.setAttribute('x2', x(i));
    series.forEach((s, k) => { dots[k].setAttribute('cx', x(i)); dots[k].setAttribute('cy', y(s.values[i])); });
    tip.innerHTML = `<div>${labels[i]}</div>` + series.map((s) => `<div><span style="color:${s.color}">●</span> ${s.name} <b>${format(s.values[i])}</b></div>`).join('');
    const left = (x(i) / width) * r.width;
    tip.style.left = `${Math.min(r.width - tip.offsetWidth, Math.max(0, left - tip.offsetWidth / 2))}px`;
    tip.classList.add('is-on');
  };
  const leave = () => { hover.setAttribute('opacity', '0'); tip.classList.remove('is-on'); };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', leave);
}
