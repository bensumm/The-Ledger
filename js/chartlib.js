import { fmt } from './format.js';

/*
 * chartlib.js — a reusable INTERACTIVE SVG chart (CL, PLAN-APP-PARITY).
 *
 * WHY THIS EXISTS. js/charts.js (svgLine/svgBars) is a static 480×150 snapshot — no pan, no zoom,
 * no rescale. This is the interactive successor the whole app can adopt over time (Trends
 * diurnal/history, later Scan/Watch sparklines). charts.js stays intact; chartlib is ADDITIVE.
 *
 * THE PAN/ZOOM MODEL (decided — SVG-with-viewBox semantics, JS-recomputed; NOT canvas, NOT a CSS
 * transform). The SVG coordinate space is a FIXED viewBox (0 0 W H, crisp at any device zoom). What
 * moves is the DATA WINDOW [vLo, vHi] on the x-axis — a slice of the full data extent [tMin, tMax].
 * Every pan/zoom mutates [vLo, vHi] and RE-RENDERS the SVG innerHTML from that slice. Re-rendering
 * (rather than transforming a pre-drawn path) is deliberate: it lets the **y-axis auto-rescale to the
 * visible x-window** (zoom into a flat region and you still see detail) and keeps stroke widths /
 * label sizes constant. Event listeners live on the persistent <svg> element, so wiping its innerHTML
 * each render does not drop them.
 *   - PAN  = pointer drag: shift [vLo, vHi] by −Δt (clamped inside [tMin, tMax]).
 *   - ZOOM = wheel (and trackpad pinch = wheel+ctrlKey), about the cursor: scale the span, hold the
 *            cursor's data-time fixed. Two-pointer touch pinch is also supported (bonus).
 *   - SPAN buttons (2h/1d/1w/3mo/All) snap [vLo,vHi] to a duration anchored at the newest data;
 *     spans with no more data than they'd show are disabled.
 *
 * CONFIG SHAPE — createChart(container, {
 *     series:  [{ t, v, cls? }]         // t = x (unix seconds for time charts, or any numeric domain
 *                                        //   e.g. hour-of-day 0..23); v = y value; cls = optional
 *                                        //   per-point css class (bars only — colours a single bar).
 *     refs:    [{ v, label?, cls? }]     // horizontal reference lines (always in x-view); v folded
 *                                        //   into the y-domain so the line stays visible.
 *     bands:   [{ lo, hi, label?, cls? }]// shaded horizontal band(s); lo/hi fold into the y-domain.
 *     markers: [{ t, label?, cls? }]     // vertical markers at a data-x (e.g. "now").
 *     kind:    'line' | 'bars'           // default 'line'. bars render from the visible y-min baseline
 *                                        //   (so a price shape's variation shows, not hugging zero).
 *     yFmt:    v => string               // y label/tooltip formatter (default the app's fmt()).
 *     xFmt:    t => string               // x label/tooltip formatter (default local time of unix t).
 *     spans:   [{label, s}] | false      // span buttons; false hides them (e.g. hour-of-day charts).
 *     span:    label | seconds | 'All'   // initial window (default 'All').
 *   })
 * RETURNS a handle: { setSpan(span), destroy() }.
 *
 * NEVER THROWS on a missing container or empty series — it degrades to a "Not enough data yet." note
 * and returns a no-op handle (the app must not crash on load; the momVerdict optional-degradation
 * precedent). Theme-aware via the existing chart css classes (pline/parea/refln/vbar/axislbl/…) plus
 * a few chartlib-only classes in styles.css, all off the palette variables.
 */

const NS = 'http://www.w3.org/2000/svg';
const W = 480, H = 180, padL = 46, padR = 12, padT = 12, padB = 22;
const PLOT_W = W - padL - padR, PLOT_H = H - padT - padB;

export const DEFAULT_SPANS = [
  { label: '2h', s: 2 * 3600 },
  { label: '1d', s: 86400 },
  { label: '1w', s: 7 * 86400 },
  { label: '3mo', s: 90 * 86400 },
  { label: 'All', s: null },
];

const NOOP = { setSpan() {}, destroy() {} };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const finite = n => typeof n === 'number' && isFinite(n);

function defaultXFmt(t) {
  const d = new Date(t * 1000);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function createChart(container, config = {}) {
  if (!container || !container.appendChild) return NOOP;
  const kind = config.kind === 'bars' ? 'bars' : 'line';
  const yFmt = typeof config.yFmt === 'function' ? config.yFmt : fmt;
  const xFmt = typeof config.xFmt === 'function' ? config.xFmt : defaultXFmt;
  const refs = (config.refs || []).filter(r => r && finite(r.v));
  const bands = (config.bands || []).filter(b => b && finite(b.lo) && finite(b.hi));
  const markers = (config.markers || []).filter(m => m && finite(m.t));
  const series = (config.series || [])
    .filter(p => p && finite(p.t) && finite(p.v))
    .sort((a, b) => a.t - b.t);
  // optional SECOND line (line-kind only) — e.g. a forecast HIGH beside the LOW to draw a cone. Additive:
  // absent config.overlay ⇒ [] ⇒ byte-identical to a single-series chart. `fillBetween` shades the region
  // between series and overlay (the forecast uncertainty cone) instead of the default under-line area.
  const overlay = (config.overlay || [])
    .filter(p => p && finite(p.t) && finite(p.v))
    .sort((a, b) => a.t - b.t);
  const fillBetween = config.fillBetween === true && overlay.length >= 2;

  container.innerHTML = '';
  if (series.length < 2) {
    container.innerHTML = '<div class="mini">Not enough data yet.</div>';
    return NOOP;
  }

  const tMin = series[0].t, tMax = series[series.length - 1].t;
  const fullSpan = Math.max(tMax - tMin, 1e-9);
  // minSpan = the max ZOOM-IN limit: keep ~4 sample points in view so you can't zoom into empty
  // space between prints (the "wayyy too deep" bug). Density-based off the median sample gap — NOT a
  // fraction of fullSpan, which on a long sparse series (90d of 6h points) allowed a sub-sample window.
  const gaps = [];
  for (let i = 1; i < series.length; i++) gaps.push(series[i].t - series[i - 1].t);
  gaps.sort((a, b) => a - b);
  const medGap = gaps[Math.floor(gaps.length / 2)] || fullSpan / 20;
  const minSpan = Math.min(fullSpan, Math.max(medGap * 4, 1));

  let vLo = tMin, vHi = tMax;   // visible data window

  // --- DOM scaffold ---------------------------------------------------------------------------
  container.classList.add('ichart');
  const spanCfg = config.spans === false ? null : (Array.isArray(config.spans) ? config.spans : DEFAULT_SPANS);
  let spanRow = null;
  if (spanCfg) {
    spanRow = document.createElement('div');
    spanRow.className = 'chartspans';
    spanCfg.forEach(sp => {
      // a bounded span is meaningful only if there's MORE data than it would show; 'All' always shows.
      const enabled = sp.s == null || sp.s < fullSpan * 0.98;
      const b = document.createElement('button');
      b.className = 'chartspan'; b.textContent = sp.label; b.dataset.s = sp.s == null ? 'all' : String(sp.s);
      if (!enabled) { b.disabled = true; b.title = 'no extra history at this zoom'; }
      else b.onclick = () => setSpan(sp.s == null ? 'All' : sp.s);
      spanRow.appendChild(b);
    });
    container.appendChild(spanRow);
  }
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'chart ichart-svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('tabindex', '0');
  container.appendChild(svg);
  const tip = document.createElement('div');
  tip.className = 'charttip'; tip.style.display = 'none';
  container.appendChild(tip);

  // --- scales (recomputed each render from the visible window) --------------------------------
  let X, Y, yMin, yMax;
  function computeScales() {
    const span = Math.max(vHi - vLo, 1e-9);
    X = t => padL + ((t - vLo) / span) * PLOT_W;
    const vis = series.filter(p => p.t >= vLo && p.t <= vHi);
    let mn = Infinity, mx = -Infinity;
    for (const p of vis) { if (p.v < mn) mn = p.v; if (p.v > mx) mx = p.v; }
    for (const p of overlay) { if (p.t >= vLo && p.t <= vHi) { if (p.v < mn) mn = p.v; if (p.v > mx) mx = p.v; } }
    for (const r of refs) { if (r.v < mn) mn = r.v; if (r.v > mx) mx = r.v; }
    for (const b of bands) { if (b.lo < mn) mn = b.lo; if (b.hi > mx) mx = b.hi; }
    if (!isFinite(mn) || !isFinite(mx)) { mn = 0; mx = 1; }
    if (kind === 'bars' && mn > 0) mn = mn - (mx - mn) * 0.08;   // a hair of headroom under the shortest bar
    if (mn === mx) { mn *= 0.999; mx = mx * 1.001 + 1; }
    yMin = mn; yMax = mx;
    Y = v => padT + PLOT_H * (1 - (v - yMin) / (yMax - yMin));
  }

  function render() {
    computeScales();
    const span = vHi - vLo;
    const vis = series.filter(p => p.t >= vLo && p.t <= vHi);
    let s = '';
    // y gridlines + labels (4 divisions)
    for (let i = 0; i <= 4; i++) {
      const v = yMin + (yMax - yMin) * (i / 4), y = Y(v).toFixed(1);
      s += `<line class="cgrid" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/>`;
      s += `<text class="axislbl" x="${padL - 4}" y="${(+y + 3).toFixed(1)}" text-anchor="end">${esc(yFmt(v))}</text>`;
    }
    // bands (behind the series)
    for (const b of bands) {
      const y1 = Y(b.hi), y2 = Y(b.lo);
      s += `<rect class="${b.cls || 'cband'}" x="${padL}" y="${Math.min(y1, y2).toFixed(1)}" width="${PLOT_W}" height="${Math.abs(y2 - y1).toFixed(1)}"/>`;
      if (b.label) s += `<text class="axislbl reflbl" x="${W - padR}" y="${(Y(b.hi) - 2).toFixed(1)}" text-anchor="end">${esc(b.label)}</text>`;
    }
    // series
    if (kind === 'bars') {
      const base = Y(yMin);
      // bar width from median spacing in the current window (clamped so sparse windows don't over-fatten)
      const bw = Math.max(2, Math.min(PLOT_W / Math.max(vis.length, 1) * 0.7, PLOT_W / 6));
      for (const p of vis) {
        const x = X(p.t), y = Y(p.v);
        s += `<rect class="${p.cls ? 'vbar ' + p.cls : 'vbar'}" x="${(x - bw / 2).toFixed(1)}" y="${Math.min(y, base).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.abs(base - y).toFixed(1)}"><title>${esc(xFmt(p.t))} · ${esc(yFmt(p.v))}</title></rect>`;
      }
    } else {
      let d = '';
      vis.forEach((p, k) => { d += (k ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.v).toFixed(1) + ' '; });
      const visOv = overlay.filter(p => p.t >= vLo && p.t <= vHi);
      let dOv = '';
      visOv.forEach((p, k) => { dOv += (k ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.v).toFixed(1) + ' '; });
      if (vis.length >= 2) {
        if (fillBetween && visOv.length >= 2) {
          // shade the cone BETWEEN the two lines: main forward, overlay backward → closed polygon.
          let back = '';
          for (let k = visOv.length - 1; k >= 0; k--) back += 'L' + X(visOv[k].t).toFixed(1) + ' ' + Y(visOv[k].v).toFixed(1) + ' ';
          s += `<path class="fcone" d="${d + back} Z"/>`;
        } else {
          const area = d + `L ${X(vis[vis.length - 1].t).toFixed(1)} ${(H - padB)} L ${X(vis[0].t).toFixed(1)} ${(H - padB)} Z`;
          s += `<path class="parea" d="${area}"/>`;
        }
        if (visOv.length >= 2) s += `<path class="pline overlay" d="${dOv}"/>`;
        s += `<path class="pline" d="${d}"/>`;
      }
    }
    // reference lines
    for (const r of refs) {
      const y = Y(r.v).toFixed(1);
      s += `<line class="${r.cls || 'refln'}" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/>`;
      if (r.label) s += `<text class="axislbl reflbl" x="${W - padR}" y="${(+y - 2).toFixed(1)}" text-anchor="end">${esc(r.label)}</text>`;
    }
    // vertical markers
    for (const m of markers) {
      if (m.t < vLo || m.t > vHi) continue;
      const x = X(m.t).toFixed(1);
      s += `<line class="${m.cls || 'nowmark'}" x1="${x}" x2="${x}" y1="${padT}" y2="${H - padB}"/>`;
      if (m.label) s += `<text class="axislbl" x="${x}" y="${padT - 3}" text-anchor="middle">${esc(m.label)}</text>`;
    }
    // x-axis labels (up to 4 ticks across the visible window)
    for (let i = 0; i <= 3; i++) {
      const t = vLo + span * (i / 3), x = X(t);
      s += `<text class="axislbl" x="${x.toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === 3 ? 'end' : 'middle'}">${esc(xFmt(t))}</text>`;
    }
    // hover crosshair + dot (persistent-per-render; pointermove sets their attrs)
    s += '<line class="cxhair" x1="0" x2="0" y1="' + padT + '" y2="' + (H - padB) + '" style="display:none"/>';
    s += '<circle class="cxdot" r="3.5" cx="0" cy="0" style="display:none"/>';
    svg.innerHTML = s;
    if (spanRow) markActiveSpan();
  }

  function markActiveSpan() {
    const cur = vHi - vLo;
    const isAll = Math.abs(cur - fullSpan) < fullSpan * 0.02;
    spanRow.querySelectorAll('.chartspan').forEach(b => {
      const raw = b.dataset.s;
      const on = raw === 'all' ? isAll : Math.abs((+raw) - cur) < Math.max((+raw) * 0.02, minSpan);
      b.classList.toggle('on', on && !b.disabled);
    });
  }

  // --- interaction ----------------------------------------------------------------------------
  // enforceMin=true for pan/wheel/pinch (respect the max-zoom-in floor); false for an explicit span
  // button, so "1d" lands exactly on 1 day even if that's tighter than the density floor.
  function clampWindow(lo, hi, enforceMin = true) {
    let span = hi - lo;
    if (span > fullSpan) span = fullSpan;
    if (enforceMin && span < minSpan) span = minSpan;
    if (span < 1e-9) span = 1e-9;
    if (lo < tMin) { lo = tMin; hi = lo + span; }
    if (hi > tMax) { hi = tMax; lo = hi - span; }
    if (lo < tMin) lo = tMin;
    return [lo, hi];
  }
  // client px → data-t (inverse x scale), robust to the viewBox letterboxing.
  function dataAt(clientX) {
    const r = svg.getBoundingClientRect();
    const fx = (clientX - r.left) / r.width * W;   // px in viewBox units
    const frac = (fx - padL) / PLOT_W;
    return vLo + frac * (vHi - vLo);
  }

  function zoomAbout(clientX, factor) {
    const ct = dataAt(clientX);
    let span = (vHi - vLo) * factor;
    span = Math.max(minSpan, Math.min(fullSpan, span));
    const frac = (ct - vLo) / Math.max(vHi - vLo, 1e-9);   // cursor's fractional position, held fixed
    let lo = ct - frac * span, hi = lo + span;
    [vLo, vHi] = clampWindow(lo, hi);
    render();
  }

  const onWheel = e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 0.82 : 1 / 0.82;
    zoomAbout(e.clientX, factor);
  };

  // pointer tracking handles BOTH single-pointer pan and two-pointer pinch (touch).
  const pointers = new Map();   // id → clientX
  let panStart = null;          // { x, lo, hi } during a single-pointer drag
  let pinchStart = null;        // { dist, lo, hi } during a two-pointer pinch

  const onPointerDown = e => {
    pointers.set(e.pointerId, e.clientX);
    try { svg.setPointerCapture(e.pointerId); } catch (_) {}
    if (pointers.size === 2) {
      const xs = [...pointers.values()];
      pinchStart = { dist: Math.abs(xs[0] - xs[1]) || 1, lo: vLo, hi: vHi, mid: (xs[0] + xs[1]) / 2 };
      panStart = null;
    } else {
      panStart = { x: e.clientX, lo: vLo, hi: vHi };
    }
  };
  const onPointerMove = e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e.clientX);
    if (pinchStart && pointers.size === 2) {
      const xs = [...pointers.values()];
      const dist = Math.abs(xs[0] - xs[1]) || 1;
      const span0 = pinchStart.hi - pinchStart.lo;
      let span = span0 * (pinchStart.dist / dist);
      span = Math.max(minSpan, Math.min(fullSpan, span));
      const ct = dataAt(pinchStart.mid);
      const frac = (ct - pinchStart.lo) / Math.max(span0, 1e-9);
      [vLo, vHi] = clampWindow(ct - frac * span, ct - frac * span + span);
      render();
      return;
    }
    if (panStart) {
      const r = svg.getBoundingClientRect();
      const dt = (e.clientX - panStart.x) / r.width * W / PLOT_W * (panStart.hi - panStart.lo);
      [vLo, vHi] = clampWindow(panStart.lo - dt, panStart.hi - dt);
      render();
      return;
    }
    hover(e);
  };
  const endPointer = e => {
    pointers.delete(e.pointerId);
    try { svg.releasePointerCapture(e.pointerId); } catch (_) {}
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) panStart = null;
  };

  function hover(e) {
    const t = dataAt(e.clientX);
    // nearest visible point
    const vis = series.filter(p => p.t >= vLo && p.t <= vHi);
    if (!vis.length) { tip.style.display = 'none'; return; }
    let best = vis[0], bd = Infinity;
    for (const p of vis) { const d = Math.abs(p.t - t); if (d < bd) { bd = d; best = p; } }
    const cr = container.getBoundingClientRect();
    tip.innerHTML = `<b>${esc(xFmt(best.t))}</b><br>${esc(yFmt(best.v))}`;
    tip.style.display = 'block';
    let left = e.clientX - cr.left + 12;
    if (left + 120 > cr.width) left = e.clientX - cr.left - 120;
    tip.style.left = Math.max(2, left) + 'px';
    tip.style.top = Math.max(2, e.clientY - cr.top - 8) + 'px';
    const hair = svg.querySelector('.cxhair'), dot = svg.querySelector('.cxdot');
    if (hair && dot) {
      const x = X(best.t), y = Y(best.v);
      hair.setAttribute('x1', x); hair.setAttribute('x2', x); hair.style.display = '';
      dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.style.display = '';
    }
  }
  const onLeave = () => {
    tip.style.display = 'none';
    const hair = svg.querySelector('.cxhair'), dot = svg.querySelector('.cxdot');
    if (hair) hair.style.display = 'none'; if (dot) dot.style.display = 'none';
  };

  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);
  svg.addEventListener('pointerleave', onLeave);

  // --- public handle --------------------------------------------------------------------------
  function setSpan(span) {
    if (span === 'All' || span == null) { vLo = tMin; vHi = tMax; }
    else {
      const secs = typeof span === 'number' ? span : (DEFAULT_SPANS.find(s => s.label === span) || {}).s;
      if (secs == null) { vLo = tMin; vHi = tMax; }
      else [vLo, vHi] = clampWindow(tMax - secs, tMax, false);   // explicit span: exact duration, bypass the zoom floor
    }
    render();
  }

  // initial window
  if (config.span != null) setSpan(config.span);
  else render();

  return {
    setSpan,
    destroy() {
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerup', endPointer);
      svg.removeEventListener('pointercancel', endPointer);
      svg.removeEventListener('pointerleave', onLeave);
      container.innerHTML = '';
      container.classList.remove('ichart');
    },
  };
}
