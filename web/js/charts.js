'use strict';

/* ============================================================ 手写 SVG 图表
   不依赖任何第三方库，完全离线可用。
   每个函数返回一段 SVG 字符串。 */

const CHART = {
  grid: '#eceff5',
  axis: '#9aa5b8',
  income: '#27ae60',
  expense: '#eb5757',
  line: '#4f7ef7'
};

function polar(cx, cy, r, angle) {
  return { x: cx + r * Math.sin(angle), y: cy - r * Math.cos(angle) };
}

function donutPath(cx, cy, rOut, rIn, a0, a1) {
  const large = (a1 - a0) > Math.PI ? 1 : 0;
  const p1 = polar(cx, cy, rOut, a0);
  const p2 = polar(cx, cy, rOut, a1);
  const p3 = polar(cx, cy, rIn, a1);
  const p4 = polar(cx, cy, rIn, a0);
  return [
    'M', p1.x.toFixed(2), p1.y.toFixed(2),
    'A', rOut, rOut, 0, large, 1, p2.x.toFixed(2), p2.y.toFixed(2),
    'L', p3.x.toFixed(2), p3.y.toFixed(2),
    'A', rIn, rIn, 0, large, 0, p4.x.toFixed(2), p4.y.toFixed(2),
    'Z'
  ].join(' ');
}

/** 环形图 */
function donutChart(items, opts) {
  const o = opts || {};
  const size = o.size || 220;
  const cx = size / 2, cy = size / 2;
  const rOut = size / 2 - 6;
  const rIn = rOut - (o.thickness || 30);
  const total = items.reduce((s, x) => s + x.value, 0);

  if (!total) {
    return '<div class="chart-empty">这个月还没有数据</div>';
  }

  let parts = '';
  function segment(it, shape) {
    const percent = (it.value / total * 100).toFixed(1) + '%';
    const drill = o.drilldown;
    const attrs = drill ? ' data-act="category-records" data-category-id="' + esc(it.id) +
      '" data-month="' + esc(drill.month) + '" data-kind="' + esc(drill.kind) +
      '" data-pool-id="' + esc(drill.poolId || 'all') + '" data-account-id="' + esc(drill.accountId || 'all') + '"' : '';
    return '<g class="donut-segment" tabindex="0" role="' + (drill ? 'button' : 'img') + '" aria-label="' +
      esc(it.label + '，' + fmtMoney(it.value) + '，占比 ' + percent + (drill ? '，查看对应流水' : '')) +
      '" data-label="' + esc(it.label) + '" data-money="' + esc(fmtMoney(it.value)) + '" data-percent="' + percent + '"' + attrs + '>' + shape + '</g>';
  }
  if (items.length === 1) {
    const rMid = (rOut + rIn) / 2;
    parts = segment(items[0], '<circle cx="' + cx + '" cy="' + cy + '" r="' + rMid.toFixed(2) + '" fill="none" stroke="' +
      esc(items[0].color) + '" stroke-width="' + (rOut - rIn) + '"/>');
  } else {
    let angle = 0;
    items.forEach(it => {
      const span = (it.value / total) * Math.PI * 2;
      const d = donutPath(cx, cy, rOut, rIn, angle, angle + span);
      parts += segment(it, '<path d="' + d + '" fill="' + esc(it.color) + '" stroke="#fff" stroke-width="1.5"/>');
      angle += span;
    });
  }

  const centerTitle = o.centerTitle || '合计';
  const centerValue = o.centerValue || fmtMoney(total);

  return '<div class="donut-chart" style="--donut-size:' + size + 'px"><svg class="chart-svg donut-svg" viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" role="group" aria-label="' + esc(centerTitle + '分类占比') + '">' +
    parts +
    '<text x="' + cx + '" y="' + (cy - 16) + '" text-anchor="middle" class="ch-center-label" data-default="' + esc(centerTitle) + '">' + esc(centerTitle) + '</text>' +
    '<text x="' + cx + '" y="' + (cy + 9) + '" text-anchor="middle" class="ch-center-value" data-default="' + esc(centerValue) + '">' + esc(centerValue) + '</text>' +
    '<text x="' + cx + '" y="' + (cy + 29) + '" text-anchor="middle" class="ch-center-percent"></text>' +
    '</svg><div class="donut-tooltip" aria-hidden="true"><strong></strong><span></span><small>' + (o.drilldown ? '点击查看对应流水 →' : '分类金额与占比') + '</small></div></div>';
}

function highlightDonut(segment) {
  const chart = segment.closest('.donut-chart');
  const label = segment.dataset.label;
  chart.classList.add('is-inspecting');
  chart.querySelectorAll('.donut-segment').forEach(el => el.classList.toggle('is-highlighted', el === segment));
  chart.querySelector('.ch-center-label').textContent = Array.from(label).length > 8 ? Array.from(label).slice(0, 8).join('') + '…' : label;
  chart.querySelector('.ch-center-value').textContent = segment.dataset.money;
  chart.querySelector('.ch-center-percent').textContent = '占比 ' + segment.dataset.percent;
  chart.querySelector('.donut-tooltip strong').textContent = label;
  chart.querySelector('.donut-tooltip span').textContent = segment.dataset.money + ' · ' + segment.dataset.percent;
}

function resetDonut(chart) {
  chart.classList.remove('is-inspecting');
  chart.querySelectorAll('.donut-segment').forEach(el => el.classList.remove('is-highlighted'));
  chart.querySelectorAll('[data-default]').forEach(el => { el.textContent = el.dataset.default; });
  chart.querySelector('.ch-center-percent').textContent = '';
}

document.addEventListener('pointerover', e => {
  const segment = e.target.closest('.donut-segment');
  if (segment) highlightDonut(segment);
});
document.addEventListener('pointerout', e => {
  const segment = e.target.closest('.donut-segment');
  if (!segment || segment.contains(e.relatedTarget)) return;
  const chart = segment.closest('.donut-chart');
  const focused = chart.querySelector('.donut-segment:focus');
  if (focused) highlightDonut(focused);
  else resetDonut(chart);
});
document.addEventListener('focusin', e => {
  const segment = e.target.closest('.donut-segment');
  if (segment) highlightDonut(segment);
});
document.addEventListener('focusout', e => {
  const segment = e.target.closest('.donut-segment');
  if (segment) resetDonut(segment.closest('.donut-chart'));
});
document.addEventListener('keydown', e => {
  const segment = e.target.closest('.donut-segment[data-act]');
  if (segment && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    segment.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
});

/** 分组柱状图：收入 / 支出 */
function barsChart(data, opts) {
  const o = opts || {};
  const W = 1120, H = o.height || 300;
  const padL = 62, padR = 16, padT = 18, padB = 34;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  if (!data.length) return '<div class="chart-empty">暂无数据</div>';

  const max = Math.max(1, ...data.map(d => Math.max(d.income, d.expense)));
  const step = innerW / data.length;
  const barW = Math.min(18, Math.max(6, step / 3.6));

  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const y = padT + innerH - (innerH * i / 4);
    const val = max * i / 4;
    grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="' + CHART.grid + '" stroke-width="1"/>';
    grid += '<text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" class="ch-axis">' + fmtShort(val) + '</text>';
  }

  let bars = '';
  data.forEach((d, i) => {
    const centerX = padL + step * i + step / 2;
    const hi = Math.max(0, innerH * (d.income / max));
    const he = Math.max(0, innerH * (d.expense / max));
    const yIn = padT + innerH - hi;
    const yEx = padT + innerH - he;

    if (d.income > 0) {
      bars += '<rect x="' + (centerX - barW - 2).toFixed(1) + '" y="' + yIn.toFixed(1) + '" width="' + barW + '" height="' + hi.toFixed(1) +
        '" rx="3" fill="' + CHART.income + '"><title>' + monthLabel(d.key) + ' 收入 ' + fmtMoney(d.income) + '</title></rect>';
    }
    if (d.expense > 0) {
      bars += '<rect x="' + (centerX + 2).toFixed(1) + '" y="' + yEx.toFixed(1) + '" width="' + barW + '" height="' + he.toFixed(1) +
        '" rx="3" fill="' + CHART.expense + '"><title>' + monthLabel(d.key) + ' 支出 ' + fmtMoney(d.expense) + '</title></rect>';
    }
    bars += '<text x="' + centerX.toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle" class="ch-axis">' + esc(d.label) + '</text>';
  });

  return '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img">' +
    grid +
    '<line x1="' + padL + '" y1="' + (padT + innerH) + '" x2="' + (W - padR) + '" y2="' + (padT + innerH) + '" stroke="' + CHART.axis + '" stroke-width="1"/>' +
    bars + '</svg>';
}

/** 折线 / 面积图 */
function lineChart(data, opts) {
  const o = opts || {};
  const W = 1120, H = o.height || 280;
  const padL = 62, padR = 16, padT = 18, padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const color = o.color || CHART.line;

  if (!data.length) return '<div class="chart-empty">暂无数据</div>';

  const values = data.map(d => d.value);
  let min = Math.min(...values, 0);
  let max = Math.max(...values, 1);
  if (min === max) max = min + 1;
  const span = max - min;
  min = min - span * 0.08;
  max = max + span * 0.12;
  if (min > 0 && min < span * 0.5) min = 0;

  const x = i => padL + (data.length === 1 ? innerW / 2 : innerW * i / (data.length - 1));
  const y = v => padT + innerH - innerH * ((v - min) / (max - min));

  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const yy = padT + innerH - (innerH * i / 4);
    const val = min + (max - min) * i / 4;
    grid += '<line x1="' + padL + '" y1="' + yy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + yy.toFixed(1) + '" stroke="' + CHART.grid + '" stroke-width="1"/>';
    grid += '<text x="' + (padL - 8) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end" class="ch-axis">' + fmtShort(val) + '</text>';
  }

  const pts = data.map((d, i) => x(i).toFixed(1) + ',' + y(d.value).toFixed(1));
  const area = 'M' + x(0).toFixed(1) + ',' + (padT + innerH).toFixed(1) + ' L' + pts.join(' L') +
    ' L' + x(data.length - 1).toFixed(1) + ',' + (padT + innerH).toFixed(1) + ' Z';

  let dots = '';
  data.forEach((d, i) => {
    dots += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(d.value).toFixed(1) + '" r="3.5" fill="#fff" stroke="' + color + '" stroke-width="2">' +
      '<title>' + monthLabel(d.key) + ' ' + fmtMoney(d.value) + '</title></circle>';
    dots += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" class="ch-axis">' + esc(d.label) + '</text>';
  });

  const gradId = 'grad_' + Math.random().toString(36).slice(2, 8);
  return '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img">' +
    '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.28"/>' +
    '<stop offset="100%" stop-color="' + color + '" stop-opacity="0.02"/>' +
    '</linearGradient></defs>' +
    grid +
    '<path d="' + area + '" fill="url(#' + gradId + ')"/>' +
    '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
    dots +
    '</svg>';
}

/** 图例列表 */
function legendList(items, total) {
  if (!items.length) return '<div class="chart-empty small">暂无数据</div>';
  return '<ul class="legend">' + items.map(it => {
    const pct = total > 0 ? (it.value / total * 100) : 0;
    return '<li><span class="dot" style="background:' + esc(it.color) + '"></span>' +
      '<span class="lg-name">' + esc(it.label) + '</span>' +
      '<span class="lg-pct">' + pct.toFixed(1) + '%</span>' +
      '<span class="lg-val">' + fmtMoney(it.value) + '</span></li>';
  }).join('') + '</ul>';
}
